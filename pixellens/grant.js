// Asks for the optional "downloads" permission and saves the files that were waiting for it (see
// queueDownload in background.js). The browser only shows its permission prompt after a click in
// an extension page. If the permission is already there, the files are saved straight away and the
// window closes by itself.
const allow = document.getElementById('allow');
const later = document.getElementById('later');

async function download(url, filename) {
  try {
    await chrome.downloads.download(filename ? { url, filename, conflictAction: 'uniquify' } : { url, conflictAction: 'uniquify' });
  } catch (err) {
    // A name the browser rejects: let it name the file from the response instead
    if (filename) await download(url, '');
    else console.warn('[PixelLens] Download failed:', err);
  }
}

// "Download all" keeps sending files for a while, so collect until two rounds in a row find none
async function saveWaitingFiles() {
  let emptyRounds = 0;
  for (let round = 0; round < 600 && emptyRounds < 2; round++) {
    const files = (await chrome.runtime.sendMessage({ type: 'SR_TAKE_DOWNLOADS' }).catch(() => null)) || [];
    emptyRounds = files.length ? 0 : emptyRounds + 1;
    for (const { url, filename } of files) await download(url, filename);
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  window.close();
}

chrome.permissions.contains({ permissions: ['downloads'] }).then(granted => {
  if (granted) saveWaitingFiles();
  else document.body.classList.add('ask');
});

allow.addEventListener('click', () => {
  allow.disabled = true;
  later.disabled = true;
  chrome.permissions.request({ permissions: ['downloads'] })
    .then(granted => (granted ? saveWaitingFiles() : window.close()), () => window.close());
});
later.addEventListener('click', () => window.close());
