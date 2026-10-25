// PixelLens - Background Service Worker

// ── Responsive Mode framing ───────────────────────────────────
// Responsive Mode previews the page inside iframes, which many sites forbid via
// X-Frame-Options / CSP frame-ancestors. While Responsive Mode is open those headers
// are stripped — but only for sub-frames of the tab that asked, using a session rule
// that is removed again when the stage closes or the tab goes away.

// Earlier versions installed this as a permanent dynamic rule for every tab, which
// disabled clickjacking protection browser-wide. Make sure it is gone after updating.
const LEGACY_GLOBAL_RULE_ID = 1001;

const WELCOME_URL = chrome.runtime.getURL('welcome.html');

// Personal build: access is local, permanent, and independent of a licensing service.
async function licenseState() {
    return { enabled: false, licensed: true, inTrial: false, notice: null };
}

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  // First install only: open the getting-started page, where the toolkit can be tried right away
  if (reason === 'install') {
    chrome.tabs.create({ url: WELCOME_URL }).catch(() => {});
  }
  try {
    // Only touch the store when the old rule is actually there: on a fresh install Edge
    // reports "Internal error" for removing a rule that doesn't exist.
    const rules = await chrome.declarativeNetRequest.getDynamicRules();
    if (rules.some(rule => rule.id === LEGACY_GLOBAL_RULE_ID)) {
      await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [LEGACY_GLOBAL_RULE_ID] });
    }
  } catch (err) {
    console.warn('[PixelLens] Could not remove legacy rule:', err);
  }
});

// Rule ids must be >= 1 and unique among our session rules; tab ids are positive.
const ruleIdForTab = tabId => tabId + 1;

function allowFramingInTab(tabId) {
  const id = ruleIdForTab(tabId);
  return chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [id],
    addRules: [
      {
        id,
        priority: 1,
        action: {
          type: 'modifyHeaders',
          responseHeaders: [
            { header: 'x-frame-options', operation: 'remove' },
            { header: 'content-security-policy', operation: 'remove' },
            { header: 'frame-options', operation: 'remove' }
          ]
        },
        condition: {
          resourceTypes: ['sub_frame'],
          tabIds: [tabId]
        }
      }
    ]
  });
}

function disallowFramingInTab(tabId) {
  return chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [ruleIdForTab(tabId)] });
}

// ── Asset downloads ───────────────────────────────────────────
// Downloading through the browser (instead of fetch() in the page) works for cross-origin
// files on CDNs and never opens a new tab. Retries without the suggested name if the
// browser rejects it.
async function downloadFile(url, filename) {
  try {
    const options = { url, conflictAction: 'uniquify' };
    if (filename) options.filename = filename;
    await chrome.downloads.download(options);
    return { ok: true };
  } catch (err) {
    if (filename) return downloadFile(url, '');
    console.warn('[PixelLens] Download failed:', err);
    return { ok: false };
  }
}

// The "downloads" permission is optional, so installing the extension shows no warning for it.
// Until it's allowed, files wait in session storage and a small window of ours (grant.html) asks
// for it: the browser only shows its permission prompt after a click in an extension page. That
// window also saves the waiting files itself, so they don't depend on this worker picking up the
// new permission right away. Saying no, or closing the window, drops them; the next download
// asks again.
const GRANT_PAGE = 'grant.html';
const fromGrantPage = sender => sender.id === chrome.runtime.id && String(sender.url).startsWith(chrome.runtime.getURL(GRANT_PAGE));

async function queueDownload(url, filename) {
  if (typeof url !== 'string' || !/^(https?|data):/i.test(url)) return { ok: false };
  if (chrome.downloads && (await chrome.permissions.contains({ permissions: ['downloads'] }))) {
    return downloadFile(url, filename);
  }
  const { pendingDownloads = [], grantWindowId } = await chrome.storage.session.get(['pendingDownloads', 'grantWindowId']);
  await chrome.storage.session.set({ pendingDownloads: [...pendingDownloads, { url, filename }] });
  const grantOpen = typeof grantWindowId === 'number'
    && (await chrome.windows.update(grantWindowId, { focused: true }).then(() => true, () => false));
  if (!grantOpen) {
    const win = await chrome.windows.create({ url: chrome.runtime.getURL(GRANT_PAGE), type: 'popup', width: 420, height: 340, focused: true });
    await chrome.storage.session.set({ grantWindowId: win.id });
  }
  return { ok: true };
}

async function takePendingDownloads() {
  const { pendingDownloads = [] } = await chrome.storage.session.get('pendingDownloads');
  await chrome.storage.session.remove('pendingDownloads');
  return pendingDownloads;
}

// "Download all" sends one message per file, so the queue is changed by one request at a time
let downloadChain = Promise.resolve();
function inDownloadOrder(task) {
  const run = downloadChain.then(task);
  downloadChain = run.catch(() => {});
  return run;
}

chrome.windows.onRemoved.addListener(async windowId => {
  const { grantWindowId } = await chrome.storage.session.get('grantWindowId');
  if (windowId === grantWindowId) await chrome.storage.session.remove(['pendingDownloads', 'grantWindowId']);
});

// ── Export: stylesheets on other servers ──────────────────────
// Some sites keep their CSS on another server that doesn't let pages read it, so the export can't
// see those rules from the page (no breakpoints, no hover states, no fonts). This worker fetches
// the files itself, but only from servers the person has allowed: read access to a server is an
// optional permission, asked for in a small window of ours (styles.html), since the browser shows
// its prompt only after a click there.
const STYLES_PAGE = 'styles.html';
const fromStylesPage = sender => sender.id === chrome.runtime.id && String(sender.url).startsWith(chrome.runtime.getURL(STYLES_PAGE));

async function fetchStylesheet(url) {
  let origin;
  try { origin = new URL(url).origin; } catch (_) { return { ok: false }; }
  if (!/^https?:\/\//.test(origin)) return { ok: false };
  if (!(await chrome.permissions.contains({ origins: [`${origin}/*`] }))) return { ok: false, needs: origin };
  try {
    const res = await fetch(url, { credentials: 'omit' });
    if (!res.ok) return { ok: false };
    const type = res.headers.get('content-type') || '';
    if (type && !/css|text\/plain/i.test(type)) return { ok: false };
    const text = await res.text();
    return text.length > 8 * 1024 * 1024 ? { ok: false } : { ok: true, text };
  } catch (_) {
    return { ok: false };
  }
}

async function askForStyleOrigins(origins, tabId) {
  const list = [...new Set(Array.isArray(origins) ? origins : [])].filter(o => /^https?:\/\/[^/\s]+$/.test(o)).slice(0, 8);
  if (!list.length) return { ok: false };
  await chrome.storage.session.set({ styleGrant: { origins: list, tabId } });
  await chrome.windows.create({ url: chrome.runtime.getURL(STYLES_PAGE), type: 'popup', width: 440, height: 420, focused: true });
  return { ok: true };
}

async function stylesGranted() {
  const { styleGrant } = await chrome.storage.session.get('styleGrant');
  await chrome.storage.session.remove('styleGrant');
  if (styleGrant && typeof styleGrant.tabId === 'number') chrome.tabs.sendMessage(styleGrant.tabId, { type: 'SR_STYLES_GRANTED' }).catch(() => {});
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'SR_TAKE_DOWNLOADS') {
    if (!fromGrantPage(sender)) return false;
    inDownloadOrder(takePendingDownloads).then(sendResponse, () => sendResponse([]));
    return true; // responds asynchronously
  }

  if (msg && msg.type === 'SR_STYLES_GRANTED') {
    if (!fromStylesPage(sender)) return false;
    stylesGranted().then(() => sendResponse({ ok: true }), () => sendResponse({ ok: false }));
    return true; // responds asynchronously
  }

  const tabId = sender.tab && sender.tab.id;
  if (!msg || typeof tabId !== 'number') return false;

  if (msg.type === 'SR_CSS_FETCH') {
    fetchStylesheet(msg.url).then(sendResponse, () => sendResponse({ ok: false }));
    return true; // responds asynchronously
  }

  // A canvas that draws pictures from other sites can't be read by the page; what the tab shows
  // of it can. The picture is cropped to the canvas in the page.
  if (msg.type === 'SR_CAPTURE_TAB') {
    chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: 'jpeg', quality: 92 }).then(url => sendResponse({ url }), () => sendResponse({ url: null }));
    return true; // responds asynchronously
  }

  if (msg.type === 'SR_CSS_GRANT') {
    askForStyleOrigins(msg.origins, tabId).then(sendResponse, () => sendResponse({ ok: false }));
    return true; // responds asynchronously
  }

  if (msg.type === 'SR_LICENSE_STATE') {
    licenseState().then(sendResponse, () => sendResponse(null));
    return true; // responds asynchronously
  }

  if (msg.type === 'SR_DOWNLOAD') {
    inDownloadOrder(() => queueDownload(msg.url, msg.filename)).then(sendResponse, () => sendResponse({ ok: false }));
    return true; // responds asynchronously
  }

  if (msg.type === 'SR_ALLOW_FRAMING' || msg.type === 'SR_DISALLOW_FRAMING') {
    const update = msg.type === 'SR_ALLOW_FRAMING' ? allowFramingInTab : disallowFramingInTab;
    update(tabId)
      .then(() => sendResponse({ ok: true }))
      .catch(err => {
        console.warn('[PixelLens] Framing rule update failed:', err);
        sendResponse({ ok: false });
      });
    return true; // responds asynchronously
  }
  return false;
});

// ── designtoolkit.online ──────────────────────────────────────
chrome.tabs.onRemoved.addListener(tabId => {
  disallowFramingInTab(tabId).catch(() => {});
});

// ── Toolbar icon and keyboard shortcuts ───────────────────────
// The extension has no access to a website until the user asks for it (activeTab): clicking the
// icon, Alt+R, Alt+I or Alt+M grants access to that tab only, and the toolkit is injected on first
// use. No website, not even designtoolkit.online, loads the content script by itself.
// Pages browsers keep extensions out of: their own pages and the extension stores
const RESTRICTED_URL = /^(chrome|chrome-extension|chrome-search|chrome-untrusted|edge|brave|opera|vivaldi|arc|about|devtools|view-source):|^https:\/\/(chromewebstore\.google\.com|chrome\.google\.com\/webstore|microsoftedge\.microsoft\.com\/addons)\//i;

// Clicking the icon on such a page used to do nothing, which looks broken. Instead the welcome page
// opens and says why, and it's a page the tools work on. At most once every few seconds.
async function explainBlockedPage() {
  const { blockedNoticeAt = 0 } = await chrome.storage.session.get('blockedNoticeAt');
  if (Date.now() - blockedNoticeAt < 5000) return;
  await chrome.storage.session.set({ blockedNoticeAt: Date.now() });
  await chrome.tabs.create({ url: `${WELCOME_URL}?blocked=1` });
}

// Toggles the toolkit, or turns it on in the given mode ('inspect' or 'measure').
async function runToolkit(tab, mode) {
  if (!tab || !tab.id) return;
  if (tab.url && RESTRICTED_URL.test(tab.url)) return explainBlockedPage();
  const message = mode ? { type: 'SR_ACTIVATE', mode } : { type: 'SR_TOGGLE' };
  try {
    // Already injected in this page
    await chrome.tabs.sendMessage(tab.id, message);
  } catch (_) {
    // First use on this page, or a copy orphaned by an update: inject the stylesheet and script,
    // then turn the tools on.
    try {
      // a stylesheet left on the page by an older copy would outlive the update and fight the new one
      await chrome.scripting.removeCSS({ target: { tabId: tab.id }, files: ['content.css'] }).catch(() => {});
      await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ['content.css'] });
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['export.js', 'content.js'] });
      // executeScript resolves after content.js has run, so its listener is registered.
      await chrome.tabs.sendMessage(tab.id, { type: 'SR_ACTIVATE', mode: mode || 'inspect' }).catch(() => {});
    } catch (injectErr) {
      console.warn('[PixelLens] Dynamic injection failed:', injectErr);
      explainBlockedPage().catch(() => {});
    }
  }
}

chrome.action.onClicked.addListener(tab => {
  runToolkit(tab);
});

// Alt+I and Alt+M work on any page, like the icon: they grant access to the tab and open that tool.
chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== 'inspect' && command !== 'measure') return;
  const target = tab || (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  runToolkit(target, command);
});
