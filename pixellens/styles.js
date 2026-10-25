// Asks for read access to the servers a site keeps its stylesheets on (see askForStyleOrigins in
// background.js). The browser only shows its permission prompt after a click in an extension
// page. Once allowed, the tab that asked rebuilds its export with the site's real rules.
const allow = document.getElementById('allow');
const later = document.getElementById('later');
const hosts = document.getElementById('hosts');

let request = { origins: [] };

chrome.storage.session.get('styleGrant').then(({ styleGrant }) => {
  request = styleGrant || request;
  if (!request.origins.length) { window.close(); return; }
  request.origins.forEach(origin => {
    const li = document.createElement('li');
    li.textContent = origin.replace(/^https?:\/\//, '');
    hosts.appendChild(li);
  });
});

allow.addEventListener('click', () => {
  allow.disabled = true;
  later.disabled = true;
  chrome.permissions.request({ origins: request.origins.map(o => `${o}/*`) })
    .then(granted => (granted ? chrome.runtime.sendMessage({ type: 'SR_STYLES_GRANTED' }).catch(() => {}) : null))
    .finally(() => window.close());
});
later.addEventListener('click', () => window.close());
