const input = document.getElementById('url');
const status = document.getElementById('status');

chrome.storage.sync.get('pippoUrl').then(({ pippoUrl }) => { input.value = pippoUrl || 'http://localhost:3700'; });

document.getElementById('save').addEventListener('click', async () => {
  const value = input.value.trim().replace(/\/+$/, '');
  if (!/^https?:\/\/[^/]+/.test(value)) { status.textContent = 'Потрібна адреса на кшталт http://localhost:3700'; return; }
  await chrome.storage.sync.set({ pippoUrl: value });
  status.textContent = 'Збережено ✓';
});
