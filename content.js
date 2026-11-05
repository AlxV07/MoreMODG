const STORAGE_KEYS = { home: 'modgHome', data: 'modgData', enabled: 'modgEnabled' };
const START_CALENDAR_WEEK = 36;
const MAX_MODG_WEEK = 32;
const LOG_PREFIX = '[MoreMODG]';
let homeSelectionHandled = false;

function debug(message, details) {
  if (details === undefined) console.info(`${LOG_PREFIX} ${message}`);
  else console.info(`${LOG_PREFIX} ${message}`, details);
}

function debugError(message, error) {
  console.error(`${LOG_PREFIX} ${message}`, error);
}

function studentHomePath(url = location.href) {
  const parsed = new URL(url);
  const match = parsed.pathname.match(/^\/students\/([^/]+)\/?$/);
  return match ? `${parsed.origin}/students/${match[1]}` : null;
}

function absoluteUrl(path) { return new URL(path, location.origin).href; }

function cleanText(value) { return value.replace(/\s+/g, ' ').trim(); }

function safeAssignmentHTML(source, baseUrl) {
  const template = document.createElement('template');
  template.innerHTML = source;
  template.content.querySelectorAll('script, style, iframe, object, embed, form').forEach((node) => node.remove());
  template.content.querySelectorAll('*').forEach((node) => {
    [...node.attributes].forEach((attribute) => {
      if (/^on/i.test(attribute.name) || attribute.name === 'srcdoc') node.removeAttribute(attribute.name);
    });
    if (node.matches('a[href]')) {
      const href = new URL(node.getAttribute('href'), baseUrl);
      if (!/^https?:$/.test(href.protocol)) node.removeAttribute('href');
      else { node.href = href.href; node.target = '_blank'; node.rel = 'noopener noreferrer'; }
    }
  });
  return template.innerHTML;
}

function parseSyllabusIndex(html, url) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const results = [];
  const seen = new Set();
  const add = (title, href) => {
    const absolute = new URL(href, url).href;
    if (seen.has(absolute)) return;
    seen.add(absolute);
    results.push({ title: cleanText(title || 'Syllabus'), url: absolute });
  };
  doc.querySelectorAll('#syllabi-table tbody tr').forEach((row) => {
    const link = row.querySelector('a[href^="/syllabi/"], a[href^="/customsyllabi/"]');
    if (link) add(row.cells[0]?.textContent || 'Syllabus', link.getAttribute('href'));
  });

  // DataTables may render the table only after the page scripts run 
  // the embedded array is the site's own source data and works as a fallback
  if (!results.length) {
    const year = doc.documentElement.innerHTML.match(/(?:var|let|const)\s+year\s*=\s*["']([^"']+)["']/)?.[1];
    const match = doc.documentElement.innerHTML.match(/(?:var|let|const)\s+syllabi\s*=\s*(\[[\s\S]*?\]);/);
    if (match) {
      try {
        JSON.parse(match[1]).forEach((item) => {
          const href = item.SyllabusType === 'custom'
            ? `/customsyllabi/${item.SyllabusID}/assignments?xsection=students&xid=${item.StudentYearID}`
            : `/syllabi/${item.SyllabusID}/${year || ''}`;
          add(item.Title, href);
        });
        debug('Used embedded syllabi data fallback.', { count: results.length });
      } catch (error) {
        debugError('Could not parse embedded syllabi data.', error);
      }
    }
  }
  debug('Parsed syllabus index.', { tableRows: doc.querySelectorAll('#syllabi-table tbody tr').length, links: results.length, url });
  return results;
}

function parseSyllabus(html, url, title) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const blocks = [];
  doc.querySelectorAll('.assignment-panel').forEach((panel) => {
    const heading = cleanText(panel.querySelector('h2')?.textContent || '');
    const match = heading.match(/Week\s+(\d+)\s*,\s*Day\s+(\d+)/i);
    if (!match) return;
    const content = panel.querySelector('.prose');
    blocks.push({
      week: Number(match[1]),
      day: Number(match[2]),
      heading,
      html: safeAssignmentHTML(content?.innerHTML || '<p>No assignment listed.</p>', url)
    });
  });
  if (!blocks.length) throw new Error(`No week/day assignments found for ${title}.`);
  return { title, url, weeks: blocks };
}

async function collectData() {
  const home = studentHomePath();
  if (!home) throw new Error('Open a student home page matching /students/{studentId}.');
  const indexUrl = new URL(`${new URL(home).pathname}/syllabi`, location.origin).href;
  debug('Starting setup.', { page: location.href, home, indexUrl });
  const indexResponse = await fetch(indexUrl, { credentials: 'include' });
  debug('Syllabi index response.', { status: indexResponse.status, ok: indexResponse.ok });
  if (!indexResponse.ok) throw new Error(`Could not load the syllabi page (${indexResponse.status}).`);
  const syllabi = parseSyllabusIndex(await indexResponse.text(), indexUrl);
  if (!syllabi.length) throw new Error('No syllabus links were found.');

  const parsed = [];
  const failures = [];
  for (const syllabus of syllabi) {
    try {
      debug('Fetching syllabus.', syllabus);
      const response = await fetch(syllabus.url, { credentials: 'include' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const parsedSyllabus = parseSyllabus(await response.text(), syllabus.url, syllabus.title);
      debug('Parsed syllabus.', { title: syllabus.title, blocks: parsedSyllabus.weeks.length });
      parsed.push(parsedSyllabus);
    } catch (error) {
      debugError(`Failed syllabus: ${syllabus.title}`, error);
      failures.push(`${syllabus.title}: ${error.message}`);
    }
  }
  if (!parsed.length) throw new Error('No syllabi could be read.');
  if (failures.length) throw new Error(`Setup stopped; ${failures.length} syllabus(es) failed: ${failures.join('; ')}`);
  return { version: 1, savedAt: new Date().toISOString(), syllabi: parsed };
}

async function setup() {
  try {
    const data = await collectData();
    await chrome.storage.local.set({ [STORAGE_KEYS.home]: studentHomePath(), [STORAGE_KEYS.data]: data, [STORAGE_KEYS.enabled]: true });
    debug('Setup saved successfully.', { syllabi: data.syllabi.length });
    renderPanel(data);
    return { ok: true, count: data.syllabi.length };
  } catch (error) {
    debugError('Setup failed. Existing saved data was not changed.', error);
    throw error;
  }
}

function calendarWeek(date = new Date()) {
  const copy = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  copy.setUTCDate(copy.getUTCDate() + 4 - (copy.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(copy.getUTCFullYear(), 0, 1));
  return Math.ceil((((copy - yearStart) / 86400000) + 1) / 7);
}

function defaultModgWeek() {
  const offset = (calendarWeek() - START_CALENDAR_WEEK + 52) % 52;
  return Math.min(MAX_MODG_WEEK, offset + 1);
}

function defaultModgDay() {
  const day = new Date().getDay(); // Sunday = 0, Monday = 1
  return Math.min(5, Math.max(1, day || 1));
}

function resetHomeSelectionOnDirectLoad() {
  if (homeSelectionHandled || !studentHomePath()) return;
  homeSelectionHandled = true;
  const navigation = performance.getEntriesByType('navigation')[0];
  const navigationType = navigation?.type || 'navigate';
  const referrer = document.referrer;
  const fromPortalPage = referrer && (() => {
    try {
      const path = new URL(referrer).pathname;
      return /\/syllabi(?:\/|$)|\/studentwork(?:\/|$)/i.test(path);
    } catch { return false; }
  })();
  if (!referrer || (navigationType !== 'back_forward' && !fromPortalPage)) {
    localStorage.removeItem('moremodgSelectedWeek');
    localStorage.removeItem('moremodgSelectedDay');
    debug('Reset week/day selection for direct home-page load.');
  } else {
    debug('Preserved week/day selection while returning within the portal.', { navigationType, referrer });
  }
}

function renderPanel(data) {
  resetHomeSelectionOnDirectLoad();
  const existing = document.getElementById('moremodg-weekly-work');
  if (existing) existing.remove();
  const heading = [...document.querySelectorAll('h3')].find((node) => cleanText(node.textContent) === 'Courseload Summary');
  const grid = heading?.parentElement?.nextElementSibling;
  if (!grid) {
    debug('Could not find Courseload Summary.');
    return;
  }
  const panel = document.createElement('div');
  panel.id = 'moremodg-weekly-work';
  panel.className = 'tw-panel tw-panel-divide col-span-full';
  panel.innerHTML = `
    <div class="tw-panel-heading tw-panel-padding-sm flex items-center justify-between">
      <h2>Unified Syllabus</h2><span class="text-xs text-gray-500">MoreMODG Enhancement</span>
    </div>
    <div class="tw-panel-padding-sm">
      <div class="flex items-center gap-2 mb-3">
        <select id="moremodg-week" class="tw-form-select text-sm flex-none w-48" aria-label="MODG week"></select>
        <select id="moremodg-day" class="tw-form-select text-sm flex-none w-28" aria-label="Day"></select>
      </div>
      <div id="moremodg-body"></div>
    </div>`;
  grid.append(panel);
  const weekSelect = panel.querySelector('#moremodg-week');
  const daySelect = panel.querySelector('#moremodg-day');
  const body = panel.querySelector('#moremodg-body');
  const weeks = [...new Set(data.syllabi.flatMap((s) => s.weeks.map((w) => w.week)))].sort((a, b) => a - b);
  const saved = Number(localStorage.getItem('moremodgSelectedWeek'));
  weeks.forEach((week) => weekSelect.add(new Option(`MODG Week ${week}`, week)));
  weekSelect.value = String(weeks.includes(saved) ? saved : weeks.includes(defaultModgWeek()) ? defaultModgWeek() : weeks[0]);
  function updateDays() {
    const week = Number(weekSelect.value);
    const days = [1, 2, 3, 4, 5];
    const savedDay = localStorage.getItem('moremodgSelectedDay');
    const previousDay = daySelect.value || savedDay || String(defaultModgDay());
    daySelect.replaceChildren(...days.map((day) => new Option(`Day ${day}`, day)));
    daySelect.add(new Option('All 5 Days', 'all'));
    daySelect.value = previousDay === 'all' || days.includes(Number(previousDay)) ? String(previousDay) : String(defaultModgDay());
    body.replaceChildren();
    data.syllabi.forEach((syllabus) => {
      const section = document.createElement('section'); section.className = 'border-t border-gray-200 mt-3 pt-3';
      section.innerHTML = `<h3 class="font-semibold text-gray-600 text-sm mb-1"><a class="tw-link"></a></h3><div class="assignment prose prose-sm max-w-none text-gray-700"></div>`;
      const syllabusLink = section.querySelector('h3 a');
      syllabusLink.textContent = syllabus.title;
      const syllabusUrl = new URL(syllabus.url);
      syllabusUrl.hash = `week-ls-${week}`;
      syllabusLink.href = syllabusUrl.href;
      syllabusLink.setAttribute('aria-label', `${syllabus.title}, Week ${week}`);
      const assignmentBody = section.querySelector('.assignment');
      const selectedDays = daySelect.value === 'all' ? days : [Number(daySelect.value)];
      selectedDays.forEach((day) => {
        const assignment = syllabus.weeks.find((w) => w.week === week && w.day === day);
        const dayBlock = document.createElement('div');
        dayBlock.className = selectedDays.length > 1 ? 'mb-3' : '';
        if (selectedDays.length > 1) dayBlock.innerHTML = `<div class="font-semibold text-gray-500 not-prose">Day ${day}</div>`;
        const content = document.createElement('div');
        content.innerHTML = assignment?.html || '<p class="italic text-gray-500">Syllabus blank</p>';
        dayBlock.appendChild(content);
        assignmentBody.appendChild(dayBlock);
      });
      body.appendChild(section);
    });
    localStorage.setItem('moremodgSelectedWeek', String(week));
    localStorage.setItem('moremodgSelectedDay', String(daySelect.value));
  }
  weekSelect.addEventListener('change', updateDays); daySelect.addEventListener('change', updateDays);
  updateDays();
}

function enhanceSyllabusPage() {
  const weekSelect = document.getElementById('select-week');
  if (!weekSelect || document.getElementById('moremodg-jump-today')) return;
  const controls = weekSelect.parentElement;
  if (!controls) return;
  controls.classList.add('relative', 'flex', 'items-center', 'gap-2', 'flex-nowrap');

  const button = document.createElement('button');
  button.id = 'moremodg-jump-today';
  button.type = 'button';
  button.className = 'btn btn-sm btn-white rounded-none border-0 whitespace-nowrap min-w-36 text-base font-normal inline-flex items-center justify-center text-center';
  button.textContent = 'Jump to Today';
  button.style.whiteSpace = 'nowrap';
  button.style.width = '10rem';
  button.style.minWidth = '10rem';
  button.style.flex = '0 0 10rem';
  button.style.overflow = 'visible';
  button.style.boxShadow = '0 1px 3px rgba(15, 23, 42, 0.22)';
  button.style.justifyContent = 'center';
  button.style.textAlign = 'center';

  const info = document.createElement('button');
  info.type = 'button';
  info.className = 'btn btn-sm btn-white rounded-none border-0 text-gray-500';
  info.textContent = 'ⓘ';
  info.style.display = 'inline-flex';
  info.style.width = '2.5rem';
  info.style.minWidth = '2.5rem';
  info.style.flex = '0 0 2.5rem';
  info.style.alignItems = 'center';
  info.style.justifyContent = 'center';
  info.setAttribute('aria-expanded', 'false');
  info.setAttribute('aria-controls', 'moremodg-week-info');
  info.setAttribute('aria-label', 'How automatic week and day selection works');
  const infoPanel = document.createElement('div');
  infoPanel.id = 'moremodg-week-info';
  infoPanel.className = 'absolute right-0 top-full z-10 mt-2 hidden w-80 rounded border border-gray-200 bg-white p-3 text-left text-xs text-gray-600 shadow-lg';
  infoPanel.textContent = 'Automatic week selection maps Week 36 of the year to MODG Week 1, then advances one MODG week per calendar week for 32 weeks. The button jumps to the exact week when available, or the closest earlier week. Day 1–5 maps to Monday–Friday in the home-page work panel. This may not be accurate for every family e.g. for families using different asynchronous schedules. (Click elsewhere to close this info blob.)';

  const actionGroup = document.createElement('div');
  actionGroup.className = 'inline-flex items-center overflow-hidden rounded-md border border-gray-300';
  actionGroup.style.flex = '0 0 auto';
  actionGroup.style.overflow = 'hidden';
  actionGroup.append(button, info);
  button.style.borderRight = '1px solid #d1d5db';
  controls.append(actionGroup, infoPanel);
  info.addEventListener('click', () => {
    const isOpen = !infoPanel.classList.contains('hidden');
    infoPanel.classList.toggle('hidden', isOpen);
    info.setAttribute('aria-expanded', String(!isOpen));
  });
  document.addEventListener('click', (event) => {
    if (!controls.contains(event.target)) {
      infoPanel.classList.add('hidden');
      info.setAttribute('aria-expanded', 'false');
    }
  });
  info.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      infoPanel.classList.add('hidden');
      info.setAttribute('aria-expanded', 'false');
      info.focus();
    }
  });
  button.addEventListener('click', () => {
    const availableWeeks = [...weekSelect.options]
      .map((option) => Number(option.value))
      .filter((week) => Number.isFinite(week) && week > 0);
    if (!availableWeeks.length) return;
    const targetWeek = defaultModgWeek();
    const earlierWeeks = availableWeeks.filter((value) => value <= targetWeek);
    const week = earlierWeeks.length ? Math.max(...earlierWeeks) : Math.min(...availableWeeks);
    weekSelect.value = String(week);
    weekSelect.dispatchEvent(new Event('change', { bubbles: true }));

    const targetAnchor = [...document.querySelectorAll(`.week-anchor[data-week="${week}"]`)].find((anchor) => {
      const panel = anchor.nextElementSibling;
      const hidden = anchor.classList.contains('hidden') || (panel && getComputedStyle(panel).display === 'none');
      return !hidden;
    }) || document.querySelector(`.week-anchor[data-week="${week}"]`);
    const targetPanel = [...document.querySelectorAll('.assignment-panel')].find((panel) => {
      const hidden = panel.classList.contains('hidden') || getComputedStyle(panel).display === 'none';
      return !hidden && new RegExp(`^Week\\s+${week}\\s*,`, 'i').test(cleanText(panel.querySelector('h2')?.textContent || ''));
    });
    (targetAnchor || targetPanel)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    debug('Jumped to the calculated syllabus week.', { requestedWeek: targetWeek, selectedWeek: week });
  });
  debug('Added Jump to Today to syllabus page.');
}

function enhanceStudentWorkFilter() {
  const filter = [...document.querySelectorAll('select')]
    .find((select) => select.id !== 'select_schoolyear' && [...select.options]
      .some((option) => option.textContent.trim().includes('Filter by Course')));
  if (!filter || filter.options.length < 2) return;
  let style = document.getElementById('moremodg-studentwork-style');
  if (!style) {
    style = document.createElement('style');
    style.id = 'moremodg-studentwork-style';
    style.textContent = '.moremodg-course-filter { display: none !important; } .moremodg-course-list { width: 100%; }';
    document.head.appendChild(style);
  }
  const optionCount = String(filter.options.length);
  const container = filter.parentElement;
  if (!container) return;
  let list = container.querySelector('[data-moremodg-course-list]');
  if (!list) {
    list = document.createElement('div');
    list.dataset.moremodgCourseList = 'true';
    list.setAttribute('role', 'listbox');
    list.setAttribute('aria-label', 'Filter student work by course');
    list.className = 'border border-gray-300 rounded bg-white divide-y divide-gray-200 overflow-hidden moremodg-course-list';
    container.appendChild(list);
    filter.addEventListener('change', () => renderCourseList(filter, list));
  }
  filter.classList.add('moremodg-course-filter');
  filter.style.display = 'none';
  if (filter.dataset.moremodgExpanded === 'true' && filter.dataset.moremodgOptionCount === optionCount && list.dataset.moremodgValue === filter.value) {
    return;
  }
  filter.dataset.moremodgExpanded = 'true';
  filter.dataset.moremodgOptionCount = optionCount;
  filter.removeAttribute('multiple');
  filter.style.minWidth = '18rem';
  filter.setAttribute('aria-label', 'Filter student work by course');
  renderCourseList(filter, list);
  debug('Expanded student work course filter.', { options: filter.options.length });
}

function renderCourseList(filter, list) {
  list.replaceChildren();
  list.dataset.moremodgValue = filter.value;
  [...filter.options].forEach((option) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'block w-full px-3 py-2 text-left text-sm hover:bg-gray-50';
    if (option.value === filter.value) item.className += ' bg-blue-50 font-semibold text-blue-800';
    item.textContent = option.textContent.trim();
    item.setAttribute('role', 'option');
    item.setAttribute('aria-selected', String(option.value === filter.value));
    item.addEventListener('click', () => {
      filter.value = option.value;
      filter.dispatchEvent(new Event('change', { bubbles: true }));
    });
    list.appendChild(item);
  });
}

function enhanceStudentWorkLayout() {
  const app = document.getElementById('studentwork-app');
  const table = document.getElementById('DataTables_Table_0_wrapper');
  if (!app || !table) return;

  const oldLayout = document.getElementById('moremodg-studentwork-layout');
  if (oldLayout?.contains(table)) {
    oldLayout.parentNode.insertBefore(table, oldLayout);
    oldLayout.remove();
  }
  const assignmentList = table.querySelector('.dt-table');
  if (!assignmentList) return;

  const filter = [...document.querySelectorAll('select')]
    .find((select) => select.id !== 'select_schoolyear' && [...select.options]
      .some((option) => option.textContent.trim().includes('Filter by Course')));
  const filterContainer = filter?.parentElement;
  let layout = document.getElementById('moremodg-studentwork-layout');
  if (!layout) {
    layout = document.createElement('div');
    layout.id = 'moremodg-studentwork-layout';
    layout.className = 'lg:flex lg:items-start lg:gap-5';
    const sidebar = document.createElement('div');
    sidebar.className = 'lg:w-64 lg:flex-none mb-4 lg:mb-0';
    assignmentList.parentNode.insertBefore(layout, assignmentList);
    layout.append(sidebar, assignmentList);
  }
  assignmentList.classList.add('flex-1', 'min-w-0', 'w-full');
  assignmentList.style.flex = '1 1 auto';
  assignmentList.style.minWidth = '0';
  assignmentList.style.width = '100%';
  const assignmentTable = assignmentList.querySelector('table');
  if (assignmentTable) assignmentTable.style.width = '100%';
  const sidebar = layout.firstElementChild;
  if (filterContainer && sidebar && !filterContainer.dataset.moremodgMoved) {
    filterContainer.dataset.moremodgMoved = 'true';
    filterContainer.classList.add('w-full');
    sidebar.appendChild(filterContainer);
    debug('Moved student work course filter beside assignments.');
  }

  const lengthSelect = document.querySelector('select[name="DataTables_Table_0_length"]');
  if (lengthSelect && lengthSelect.options.length) {
    const maximum = lengthSelect.options[lengthSelect.options.length - 1].value;
    if (lengthSelect.value !== maximum) {
      lengthSelect.value = maximum;
      lengthSelect.dispatchEvent(new Event('change', { bubbles: true }));
      debug('Set student work entries limit to maximum.', { maximum });
    }
  }
}

chrome.runtime?.onMessage?.addListener((message, sender, sendResponse) => {
  if (message?.type === 'MODG_SETUP') { setup().then(sendResponse).catch((error) => sendResponse({ ok: false, error: error.message })); return true; }
});

chrome.storage.local.get([STORAGE_KEYS.home, STORAGE_KEYS.data, STORAGE_KEYS.enabled]).then(({ modgHome, modgData, modgEnabled }) => {
  if (modgEnabled && modgHome === studentHomePath() && modgData?.syllabi?.length) renderPanel(modgData);
}).catch(() => {});

chrome.storage.local.get(STORAGE_KEYS.enabled).then(({ modgEnabled }) => {
  if (!modgEnabled) return;
  enhanceSyllabusPage();
  enhanceStudentWorkFilter();
  enhanceStudentWorkLayout();
  const studentWorkObserver = new MutationObserver(enhanceStudentWorkFilter);
  studentWorkObserver.observe(document.documentElement, { childList: true, subtree: true });
  const studentWorkLayoutObserver = new MutationObserver(enhanceStudentWorkLayout);
  studentWorkLayoutObserver.observe(document.documentElement, { childList: true, subtree: true });
  window.setTimeout(enhanceStudentWorkFilter, 250);
  window.setTimeout(enhanceStudentWorkFilter, 1000);
  window.setTimeout(enhanceStudentWorkFilter, 2500);
  window.setTimeout(enhanceStudentWorkLayout, 250);
  window.setTimeout(enhanceStudentWorkLayout, 1000);
  window.setTimeout(enhanceStudentWorkLayout, 2500);
  const studentWorkRetry = window.setInterval(() => enhanceStudentWorkFilter(), 1000);
  window.setTimeout(() => window.clearInterval(studentWorkRetry), 30000);
}).catch(() => {});

