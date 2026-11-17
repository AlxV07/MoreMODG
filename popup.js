const setupButton = document.getElementById('setup');
const statusEl = document.getElementById('status');
const savedEl = document.getElementById('saved');
const enhancementsEl = document.getElementById('enhancements');
const enabledControl = document.getElementById('enabled');
const LOG_PREFIX = '[MoreMODG]';

function setStatus(message, type = '') {
  statusEl.textContent = message;
  statusEl.className = `status ${type}`;
}

async function showSaved() {
  const data = await chrome.storage.local.get(['modgHome', 'modgData', 'modgEnabled']);
  console.info(`${LOG_PREFIX} Loaded saved state.`, data);
  const configured = Boolean(data.modgHome && data.modgData?.syllabi?.length);
  setupButton.textContent = configured ? 'Setup Again' : 'Setup';
  enabledControl.checked = Boolean(data.modgEnabled);
  enabledControl.disabled = !configured;
  enhancementsEl.classList.toggle('hidden', !data.modgEnabled);
  savedEl.classList.toggle('hidden', !configured);
  if (!configured) return;
  savedEl.classList.remove('hidden');
  const classes = data.modgData?.syllabi?.length ?? 0;
  savedEl.textContent = `Saved home: ${data.modgHome} · ${classes} syllabi`;
}

enabledControl.addEventListener('change', async () => {
  const enabled = enabledControl.checked;
  enabledControl.disabled = true;
  setupButton.disabled = true;
  try {
    await chrome.storage.local.set({ modgEnabled: enabled });
    await showSaved();
    setStatus(`Enhancements ${enabled ? 'on' : 'off'}. Your setup is saved.`, 'success');
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id && /^https:\/\/families\.modg\.org\//.test(tab.url || '')) {
        await chrome.tabs.reload(tab.id);
      }
    } catch {
      setStatus(`Enhancements ${enabled ? 'on' : 'off'}. Refresh the portal to apply the change.`, 'success');
    }
  } catch (error) {
    enabledControl.checked = !enabled;
    setStatus(error.message || 'Could not save the setting.', 'error');
  } finally {
    setupButton.disabled = false;
    await showSaved().catch(() => { enabledControl.disabled = false; });
  }
});

setupButton.addEventListener('click', async () => {
  setupButton.disabled = true;
  enabledControl.disabled = true;
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
    await showSaved().catch(() => {});
  }
});

showSaved().catch(() => {});

