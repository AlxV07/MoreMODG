const setupButton = document.getElementById('setup');
const statusEl = document.getElementById('status');
const savedEl = document.getElementById('saved');
const enhancementsEl = document.getElementById('enhancements');
const LOG_PREFIX = '[MoreMODG]';

function setStatus(message, type = '') {
  statusEl.textContent = message;
  statusEl.className = `status ${type}`;
}

async function showSaved() {
  const data = await chrome.storage.local.get(['modgHome', 'modgData', 'modgEnabled']);
  console.info(`${LOG_PREFIX} Loaded saved state.`, data);
  setupButton.textContent = data.modgEnabled ? 'Setup Again' : 'Setup';
  if (!data.modgHome || !data.modgEnabled) return;
  enhancementsEl.classList.remove('hidden');
  savedEl.classList.remove('hidden');
  const classes = data.modgData?.syllabi?.length ?? 0;
  savedEl.textContent = `Saved home: ${data.modgHome} · ${classes} syllabi`;
}

setupButton.addEventListener('click', async () => {
  setupButton.disabled = true;
  setStatus('Reading syllabi…');
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    console.info(`${LOG_PREFIX} Active tab.`, tab);
    if (!tab?.id) throw new Error('No active page was found.');
    const result = await chrome.tabs.sendMessage(tab.id, { type: 'MODG_SETUP' });
    console.info(`${LOG_PREFIX} Setup response.`, result);
    if (!result?.ok) throw new Error(result?.error || 'Setup failed.');
    setStatus(`Saved successfully: ${result.count} syllabi collected.`, 'success');
    enhancementsEl.classList.remove('hidden');
    await showSaved();
  } catch (error) {
    const rawMessage = error.message || 'Setup failed.';
    const message = rawMessage.includes('Could not establish connection') || rawMessage.includes('Receiving end does not exist')
      ? 'Please reload the student page, then open MoreMODG and try again.'
      : rawMessage;
    setStatus(message, 'error');
  } finally {
    setupButton.disabled = false;
  }
});

showSaved().catch(() => {});

