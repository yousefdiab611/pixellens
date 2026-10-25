/* ============================================================
   Screen Ruler – content.js
   Features:
   1. Element Inspector (Box Model on-page + Floating Card + Space to Pin/Drag)
   2. Distance Measurement (Select reference, hover target, exact gap lines & badges)
   3. Page Rulers (Top & Left pixel rulers with live crosshairs tracking)
   4. Floating Bottom Toolbar (Inspect, Ruler, Parent/Child, Collapse)
   ============================================================ */
(() => {
  'use strict';

  // The toolkit builds an HTML UI, which SVG / XML files opened directly can't host.
  // Answer the toolbar icon anyway so the background worker doesn't try to re-inject.
  if (!(document instanceof HTMLDocument) || !document.documentElement) {
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
      chrome.runtime.onMessage.addListener((msg, _, reply) => {
        if (msg && /^SR_/.test(msg.type)) reply({ active: false, unsupported: true });
      });
    }
    return;
  }

  // Reloading or updating the extension orphans the copy already running in open tabs (its
  // chrome.* APIs stop working) and the next icon click injects a fresh copy, often in a
  // separate JS world. The DOM is shared, so this event tells an older copy to remove its UI
  // and listeners before the new one starts.
  const DISPOSE_EVENT = 'sr-toolkit:dispose';

  // Prevent double loading
  if (window.__screenRulerLoaded && window.__screenRulerAlive && window.__screenRulerAlive()) {
    if (window.__screenRulerToggle) {
      window.__screenRulerToggle();
    }
    return;
  }
  document.dispatchEvent(new CustomEvent(DISPOSE_EVENT));
  window.__screenRulerLoaded = true;
  window.__screenRulerAlive = () => {
    try {
      return !!(chrome.runtime && chrome.runtime.id);
    } catch (_) {
      return false;
    }
  };

  // ── State ───────────────────────────────────────────────────
  const S = {
    active: false,
    mode: 'inspect', // 'inspect' | 'measure'
    paused: false,
    pinned: false,
    curEl: null,
    isColorPicking: false,
    // Distance measurement
    selectedEl: null,
    hoveredEl: null,
    // Panel positioning & dragging
    panelX: 0,
    panelY: 0,
    dragging: false,
    dragOffX: 0,
    dragOffY: 0,
    collapsedToolbar: false,
    cursorX: 0,
    cursorY: 0,
  };

  // ── DOM References ──────────────────────────────────────────
  // Inspector
  let overlay, banner, bmSelector, bmDimensions;
  let padT, padR, padB, padL;
  let marT, marR, marB, marL;
  let bmContent, bmBorder;
  let panel;

  // Multiple Pinned Cards
  let pinnedCards = [];
  let pinnedCounter = 0;

  // Rulers
  let rulersContainer, rulerCorner, rulerH, rulerV, ctxH, ctxV;

  // Distance Measurement
  let distOverlay, distSelected, distHovered, distLinesContainer;

  // Toolbar
  let toolbar, tbBtnInspect, tbBtnRuler, tbBtnPicker, tbBtnResponsive, tbBtnSidePanel, tbBtnPause, tbBtnHideDock, dockRestoreTab;
  let isDockHidden = false;

  // Side Panel (Element & Page Inspector)
  let sidePanel, spTabEl, spTabPg, spCloseBtn, spContentArea;
  let isSidePanelOpen = false;
  let sidePanelTab = 'element'; // 'element' | 'page'
  let sidePanelCodeFormat = 'computed'; // 'computed' | 'css' | 'tailwind' | 'react'
  let sidePanelColorFormat = 'hex'; // 'hex' | 'rgb' | 'hsl'
  let sidePanelSocialPlatform = 'facebook'; // 'facebook' | 'twitter' | 'linkedin'
  let sidePanelPaletteFormat = 'css'; // 'css' | 'tailwind4' | 'tailwind3' | 'figma' | 'hex' | 'json'
  let sidePanelTargetEl = null;
  const MIN_SP_WIDTH = 300;
  // The panel can be dragged this wide at most, and never past half the window, so the page it
  // sits beside always keeps at least as much room as the panel.
  const MAX_SP_WIDTH = 800;
  const DEFAULT_SP_WIDTH = 420;
  let sidePanelWidth = DEFAULT_SP_WIDTH;
  let cachedPageData = null;
  // Remembered by the extension (the same on every site), not in the page's own localStorage. A width an older
  // version left there is taken over once and removed from the page.
  const savedPanelWidth = v => {
    const n = parseInt(v, 10);
    return n && n >= MIN_SP_WIDTH ? Math.min(n, MAX_SP_WIDTH) : 0;
  };
  const rememberPref = (key, value) => {
    try { chrome.storage.local.set({ [key]: value }); } catch (_) {}
  };
  try {
    const legacy = savedPanelWidth(localStorage.getItem('sr_sidepanel_width'));
    if (legacy) {
      sidePanelWidth = legacy;
      rememberPref('sr_sidepanel_width', legacy);
    }
    localStorage.removeItem('sr_sidepanel_width');
  } catch (_) {}
  try {
    chrome.storage.local.get('sr_sidepanel_width').then(r => {
      const saved = savedPanelWidth(r && r.sr_sidepanel_width);
      if (!saved || saved === sidePanelWidth || isSidePanelOpen) return;
      sidePanelWidth = saved;
      document.documentElement.style.setProperty('--sr-sp-width', `${saved}px`);
      if (sidePanel) sidePanel.style.width = `${saved}px`;
    }).catch(() => {});
  } catch (_) {}

  // Responsive Multi-Device Mode
  let respStage, respHeader, respBody, respSizer, respDevicesWrap, respZoomLabel, respUrlInput, respSyncBtn;
  let respZoom = 0.65;
  let respZoomAuto = true; // the zoom follows the screen size until the user picks one
  let respSyncScroll = true;
  let respDevices = [];
  let respIsSyncing = false;
  let respIdCounter = 1;
  let isResponsiveOpen = false;

  // ── Helpers ─────────────────────────────────────────────────
  const round1 = v => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? (n % 1 === 0 ? Math.round(n) : parseFloat(n.toFixed(1))) : v;
  };

  // Labels show ids/classes as written ("md:flex", "w-[120px]"); pass forCss = true to get
  // an escaped, valid CSS selector for copying and code snippets.
  function selector(el, forCss = false) {
    if (!el || !el.tagName) return '';
    const esc = forCss ? CSS.escape : (s => s);
    const tag = el.tagName.toLowerCase();
    // a <form> holding <input name="id"> (or "classList") answers with that input instead of its own value
    const rawId = typeof el.id === 'string' ? el.id : (el.getAttribute && el.getAttribute('id')) || '';
    const id = rawId ? `#${esc(rawId)}` : '';
    const names = el.classList && typeof el.classList.length === 'number'
      ? Array.from(el.classList)
      : String((el.getAttribute && el.getAttribute('class')) || '').split(/\s+/).filter(Boolean);
    const classes = names.slice(0, 5).map(c => `.${esc(c)}`).join('');
    return (id || classes) ? `${tag}${id}${classes}` : tag;
  }

  // A letter key is matched by the letter it types (so the key marked C on a Dvorak or AZERTY keyboard is the
  // one that works) and, where the layout types no Latin letter (Arabic, Russian, Option on a Mac), by its
  // place on the keyboard.
  function keyIs(e, code) {
    if (/^Key[A-Z]$/.test(code) && typeof e.key === 'string' && /^[a-z]$/i.test(e.key)) {
      return e.key.toLowerCase() === code.slice(3).toLowerCase();
    }
    return e.code === code;
  }

  // Keeps Tab inside a dialog: from its last control back to the first, and from the first (with Shift) to the last
  function trapTab(e, box) {
    if (!box) return;
    const items = Array.from(box.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'))
      .filter(node => node.getClientRects().length);
    if (!items.length) {
      e.preventDefault();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    const holder = box.querySelector('[tabindex="-1"]'); // the dialog itself, which has the focus when it opens
    if (!box.contains(active)) {
      e.preventDefault();
      first.focus();
    } else if (e.shiftKey && (active === first || active === holder)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }

  // Keys typed into form fields or editable content must reach the page untouched.
  function isTypingTarget(t) {
    if (!t || t.nodeType !== 1) return false;
    // a key typed into a field inside a shadow root arrives with the component itself as its target
    while (t.shadowRoot && t.shadowRoot.activeElement) t = t.shadowRoot.activeElement;
    return t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName);
  }

  // Resolves with the background worker's reply, or null if it can't be reached.
  function sendRuntimeMessage(msg) {
    try {
      if (!chrome.runtime || !chrome.runtime.id) return Promise.resolve(null);
      return chrome.runtime.sendMessage(msg).catch(() => null);
    } catch (_) {
      return Promise.resolve(null); // extension context invalidated
    }
  }

  // ── Free trial and license ──────────────────────────────────
  // The background worker knows when the trial ends and whether a license key is active.
  // If it can't be reached (extension reloaded), the tools stay usable.
  function getLicenseState() {
    return sendRuntimeMessage({ type: 'SR_LICENSE_STATE' });
  }
  const toolsUnlocked = state => !state || !state.enabled || state.licensed || state.inTrial;

  // Wheel/touch scrolling over toolkit panels must scroll the panel, never the page.
  // Smooth-scroll libraries (Lenis, Locomotive Scroll…) listen on window and
  // preventDefault() every wheel event, which made the panel unscrollable. Stopping
  // propagation keeps page handlers out, data-lenis-prevent is Lenis's own opt-out, and
  // outside the panel's scrollable areas the wheel is swallowed so the page stays put.
  function isolateScrolling(container, scrollableSelector) {
    container.setAttribute('data-lenis-prevent', '');
    container.addEventListener('wheel', e => {
      e.stopPropagation();
      if (!(e.target instanceof Element) || !e.target.closest(scrollableSelector)) e.preventDefault();
    }, { passive: false });
    container.addEventListener('touchmove', e => e.stopPropagation(), { passive: true });
  }

  // On pages whose Content-Security-Policy forbids inline styles, Firefox empties style=""
  // attributes in markup a content script inserts (colour swatches, bar widths, hidden menus…),
  // while styles set through the CSSOM are allowed. So toolkit markup goes in with its inline
  // styles parked in data-sr-style, and they are applied through the CSSOM.
  function setHTML(el, html) {
    el.innerHTML = html.replace(/\sstyle="/g, ' data-sr-style="');
    el.querySelectorAll('[data-sr-style]').forEach(node => {
      node.style.cssText = node.getAttribute('data-sr-style');
      node.removeAttribute('data-sr-style');
    });
  }

  // Colors. The browser reports sRGB colors as rgb()/rgba() text and keeps oklch(), lab(), color()... as written.
  // The rgb text is read directly: a canvas keeps pixels with their alpha already multiplied in, which turns
  // rgba(37, 99, 235, 0.08) into #2666E6 on the way back. Anything else goes through a canvas, drawn opaque so
  // nothing is lost, with the alpha read from the text. Answers are remembered: a page tab scan or a hover
  // asks about the same few hundred colors over and over.
  const colorCache = new Map();
  let colorProbeCtx = null;
  const clamp01 = v => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 1);
  const clamp255 = v => Math.max(0, Math.min(255, Math.round(v)));

  function makeColor(r, g, b, alpha) {
    alpha = clamp01(alpha);
    if (alpha < 0.002) return null; // nothing is painted
    return { r: clamp255(r), g: clamp255(g), b: clamp255(b), a: Math.round(alpha * 255), alpha };
  }

  // "rgb(0 0 0 / 40%)" and "hsla(210, 50%, 40%, 0.4)" become the same color with the alpha taken out, and the alpha
  function splitAlpha(text) {
    let m = /\s*\/\s*([\d.]+)(%?)\s*\)\s*$/.exec(text);
    if (m) return { opaque: text.slice(0, m.index) + ')', alpha: clamp01(m[2] ? parseFloat(m[1]) / 100 : parseFloat(m[1])) };
    m = /^(?:rgba|hsla)\(.*,\s*([\d.]+)(%?)\s*\)\s*$/i.exec(text);
    if (m) {
      const cut = text.lastIndexOf(',');
      return { opaque: text.slice(0, cut).replace(/^(rgb|hsl)a\(/i, '$1(') + ')', alpha: clamp01(m[2] ? parseFloat(m[1]) / 100 : parseFloat(m[1])) };
    }
    return { opaque: text, alpha: 1 };
  }

  function parseColorNow(text) {
    let m = /^#([0-9a-f]{3,8})$/i.exec(text);
    if (m && [3, 4, 6, 8].includes(m[1].length)) {
      const h = m[1].length <= 4 ? m[1].split('').map(c => c + c).join('') : m[1];
      const n = i => parseInt(h.slice(i, i + 2), 16);
      return makeColor(n(0), n(2), n(4), h.length === 8 ? n(6) / 255 : 1);
    }
    m = /^rgba?\(\s*([\d.]+)(%?)\s*[,\s]\s*([\d.]+)(%?)\s*[,\s]\s*([\d.]+)(%?)\s*(?:[,/]\s*([\d.]+)(%?)\s*)?\)$/i.exec(text);
    if (m) {
      const ch = (v, pct) => (pct ? parseFloat(v) * 2.55 : parseFloat(v));
      const alpha = m[7] === undefined ? 1 : m[8] ? parseFloat(m[7]) / 100 : parseFloat(m[7]);
      return makeColor(ch(m[1], m[2]), ch(m[3], m[4]), ch(m[5], m[6]), alpha);
    }
    // An invalid value (e.g. a multi-colour border "rgb(..) rgb(..)") would leave the previous fillStyle in
    // place and be misreported as that colour.
    if (!CSS.supports('color', text)) return null;
    try {
      if (!colorProbeCtx) {
        const c = document.createElement('canvas');
        c.width = c.height = 1;
        colorProbeCtx = c.getContext('2d', { willReadFrequently: true });
      }
      const ctx = colorProbeCtx;
      const { opaque, alpha } = splitAlpha(text);
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = '#000000';
      ctx.fillStyle = CSS.supports('color', opaque) ? opaque : text;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
      return makeColor(r, g, b, alpha);
    } catch {
      return null;
    }
  }

  function parseColor(raw) {
    if (!raw || raw === 'none' || raw === 'transparent') return null;
    const key = String(raw).trim();
    let col = colorCache.get(key);
    if (col === undefined) {
      col = parseColorNow(key);
      if (colorCache.size > 800) colorCache.clear();
      colorCache.set(key, col);
    }
    return col ? { ...col } : null;
  }

  function toHex(col) {
    const h = v => v.toString(16).padStart(2, '0').toUpperCase();
    return `#${h(col.r)}${h(col.g)}${h(col.b)}`;
  }

  function luminance({ r, g, b }) {
    return [r / 255, g / 255, b / 255].reduce((sum, c, i) => {
      const s = c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
      return sum + s * [0.2126, 0.7152, 0.0722][i];
    }, 0);
  }

  function contrastRatio(fg, bg) {
    const l1 = luminance(fg);
    const l2 = luminance(bg);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  }

  // Two decimals at most, no trailing zeros: 13.6, 1.35, 0.08
  const fmt2 = v => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? parseFloat(n.toFixed(2)) : v;
  };

  const mixOver = (top, base, alpha) => ({
    r: top.r * alpha + base.r * (1 - alpha),
    g: top.g * alpha + base.g * (1 - alpha),
    b: top.b * alpha + base.b * (1 - alpha)
  });

  // Text the element holds itself, not only through its children; form controls always count
  function hasOwnText(el) {
    if (/^(INPUT|TEXTAREA|SELECT|BUTTON|OPTION)$/.test(el.tagName)) return true;
    for (const n of el.childNodes) if (n.nodeType === 3 && n.nodeValue.trim()) return true;
    return false;
  }

  // The color really painted behind an element: its own background, or the nearest ancestor's, with any
  // translucent layers in between mixed in. Null when a picture or a gradient is in the way: the number would be a guess.
  function effectiveBackdrop(el) {
    const win = el.ownerDocument.defaultView || window;
    const layers = [];
    let node = el;
    for (let depth = 0; node && depth < 60; node = node.parentElement, depth++) {
      let cs;
      try { cs = win.getComputedStyle(node); } catch (_) { break; }
      if (cs.backgroundImage && cs.backgroundImage !== 'none') return null;
      const col = parseColor(cs.backgroundColor);
      if (!col) continue;
      layers.push(col);
      if (col.a >= 255) break;
    }
    let out = { r: 255, g: 255, b: 255 }; // the canvas under everything
    for (let i = layers.length - 1; i >= 0; i--) out = mixOver(layers[i], out, layers[i].alpha);
    return out;
  }

  // Contrast of an element's text against what is behind it, counting the text's own alpha and the opacity of
  // the element and its ancestors. Null when it can't be told.
  function textContrast(el) {
    const win = el.ownerDocument.defaultView || window;
    const fg = parseColor(win.getComputedStyle(el).color);
    const back = fg && effectiveBackdrop(el);
    if (!back) return null;
    let alpha = fg.alpha;
    for (let node = el, i = 0; node && i < 12; node = node.parentElement, i++) {
      const o = parseFloat(win.getComputedStyle(node).opacity);
      if (Number.isFinite(o)) alpha *= o;
    }
    return contrastRatio(mixOver(fg, back, alpha), back);
  }

  function wcagLevel(r) {
    if (r >= 7) return ['AAA', 'sr-wcag-aaa'];
    if (r >= 4.5) return ['AA', 'sr-wcag-aa'];
    return ['Fail', 'sr-wcag-fail'];
  }

  function fmtSpacing(t, r, b, l) {
    const fmt = v => {
      const n = parseFloat(v);
      return Number.isFinite(n) ? (n % 1 === 0 ? `${Math.round(n)}px` : `${round1(n)}px`) : v;
    };
    const [ft, fr, fb, fl] = [t, r, b, l].map(fmt);
    if (ft === fr && fr === fb && fb === fl) return ft;
    if (ft === fb && fr === fl) return `${ft} ${fr}`;
    if (fr === fl) return `${ft} ${fr} ${fb}`;
    return `${ft} ${fr} ${fb} ${fl}`;
  }

  // Horizontal range of the viewport that the side panel doesn't cover, as [left, right].
  function visiblePageRange() {
    const w = document.documentElement.clientWidth || window.innerWidth;
    if (!isSidePanelOpen) return [0, w];
    return sidePanel && sidePanel.classList.contains('sr-sp-left') ? [sidePanelWidth, w] : [0, w - sidePanelWidth];
  }

  // ── Build DOM ───────────────────────────────────────────────
  function buildDOM() {
    const root = document.documentElement;

    // 1. On-Page Box Model Overlay
    overlay = document.createElement('div');
    overlay.id = 'sr-bm-overlay';
    overlay.innerHTML = `
      <div id="sr-bm-banner">
        <span id="sr-bm-selector"></span>
        <span id="sr-bm-dimensions"></span>
      </div>
      <div id="sr-bm-margin-t" class="sr-bm-margin"><span class="sr-bm-num"></span></div>
      <div id="sr-bm-margin-b" class="sr-bm-margin"><span class="sr-bm-num"></span></div>
      <div id="sr-bm-margin-l" class="sr-bm-margin"><span class="sr-bm-num"></span></div>
      <div id="sr-bm-margin-r" class="sr-bm-margin"><span class="sr-bm-num"></span></div>
      <div id="sr-bm-border"></div>
      <div id="sr-bm-pad-t" class="sr-bm-pad"><span class="sr-bm-num"></span></div>
      <div id="sr-bm-pad-b" class="sr-bm-pad"><span class="sr-bm-num"></span></div>
      <div id="sr-bm-pad-l" class="sr-bm-pad"><span class="sr-bm-num"></span></div>
      <div id="sr-bm-pad-r" class="sr-bm-pad"><span class="sr-bm-num"></span></div>
      <div id="sr-bm-content"></div>
    `;
    banner = overlay.querySelector('#sr-bm-banner');
    bmSelector = overlay.querySelector('#sr-bm-selector');
    bmDimensions = overlay.querySelector('#sr-bm-dimensions');
    marT = overlay.querySelector('#sr-bm-margin-t');
    marR = overlay.querySelector('#sr-bm-margin-r');
    marB = overlay.querySelector('#sr-bm-margin-b');
    marL = overlay.querySelector('#sr-bm-margin-l');
    padT = overlay.querySelector('#sr-bm-pad-t');
    padR = overlay.querySelector('#sr-bm-pad-r');
    padB = overlay.querySelector('#sr-bm-pad-b');
    padL = overlay.querySelector('#sr-bm-pad-l');
    bmContent = overlay.querySelector('#sr-bm-content');
    bmBorder = overlay.querySelector('#sr-bm-border');
    root.appendChild(overlay);

    // 2. Floating Inspector Panel
    panel = document.createElement('div');
    panel.id = 'sr-panel';
    root.appendChild(panel);

    // 3. Distance Measurement Overlays
    distOverlay = document.createElement('div');
    distOverlay.id = 'sr-dist-overlay';
    distOverlay.innerHTML = `
      <div id="sr-dist-selected"></div>
      <div id="sr-dist-hovered"></div>
      <div id="sr-dist-lines"></div>
    `;
    distSelected = distOverlay.querySelector('#sr-dist-selected');
    distHovered = distOverlay.querySelector('#sr-dist-hovered');
    distLinesContainer = distOverlay.querySelector('#sr-dist-lines');
    root.appendChild(distOverlay);

    // 4. Page Rulers Container
    rulersContainer = document.createElement('div');
    rulersContainer.id = 'sr-rulers-container';
    rulersContainer.innerHTML = `
      <div id="sr-ruler-corner">px</div>
      <canvas id="sr-ruler-h"></canvas>
      <canvas id="sr-ruler-v"></canvas>
    `;
    rulerCorner = rulersContainer.querySelector('#sr-ruler-corner');
    rulerH = rulersContainer.querySelector('#sr-ruler-h');
    rulerV = rulersContainer.querySelector('#sr-ruler-v');
    ctxH = rulerH.getContext('2d');
    ctxV = rulerV.getContext('2d');
    root.appendChild(rulersContainer);

    // 5. Floating Bottom Toolbar
    toolbar = document.createElement('div');
    toolbar.id = 'sr-toolbar';
    toolbar.innerHTML = `
      <!-- Inspect Tool -->
      <button class="sr-tb-btn sr-tb-item sr-active" id="sr-tb-inspect">
        <svg viewBox="0 0 24 24"><path d="M3 3l7 18 3-7 7-3L3 3z"/></svg>
        <span class="sr-tooltip"><span class="sr-tt-title">Inspector</span><span class="sr-tt-key">(1)</span></span>
      </button>
      <!-- Ruler / Distance Measurement Tool -->
      <button class="sr-tb-btn sr-tb-item" id="sr-tb-ruler">
        <svg viewBox="0 0 24 24">
          <path d="M17.5 10.5L19.5 12.5M14 14L16 16M10.5 17.5L12.5 19.5"/>
          <path d="M10.5355 4.67767C11.9002 3.31296 12.5826 2.6306 13.3438 2.3153C14.3587 1.8949 15.4991 1.8949 16.5141 2.3153C17.2753 2.6306 17.9576 3.31296 19.3223 4.67767C20.687 6.04238 21.3694 6.72474 21.6847 7.48594C22.1051 8.50088 22.1051 9.64126 21.6847 10.6562C21.3694 11.4174 20.687 12.0998 19.3223 13.4645L13.4645 19.3223C12.0998 20.687 11.4174 21.3694 10.6562 21.6847C9.64126 22.1051 8.50088 22.1051 7.48594 21.6847C6.72474 21.3694 6.04238 20.687 4.67767 19.3223C3.31296 17.9576 2.6306 17.2753 2.3153 16.5141C1.8949 15.4991 1.8949 14.3587 2.3153 13.3438C2.6306 12.5826 3.31296 11.9002 4.67767 10.5355L10.5355 4.67767Z"/>
        </svg>
        <span class="sr-tooltip"><span class="sr-tt-title">Measurement</span><span class="sr-tt-key">Shift+M</span></span>
      </button>
      <!-- Color tools: the button runs the chosen tool, the arrow beside it switches between them -->
      <div class="sr-tb-split sr-tb-item" id="sr-tb-picker-group">
        <button class="sr-tb-btn" id="sr-tb-picker" data-tool="eyedropper">
          <svg class="sr-tb-ic" data-tool="eyedropper" viewBox="0 0 24 24">
            <path d="M13.435 7L7.15915 13.2759M7.15915 13.2759L4.82728 15.6077C3.92569 16.5093 3.47489 16.9601 3.23745 17.5334C3 18.1066 3 18.7441 3 20.0192V21H3.98082C5.25586 21 5.89338 21 6.46663 20.7626C7.03988 20.5251 7.49068 20.0743 8.39227 19.1727L14.2891 13.2759M7.15915 13.2759H14.2891M14.2891 13.2759L17 10.565"/>
            <path d="M19.2087 8.38869L20.82 10M19.2087 8.38869L20.0705 7.52682C20.363 7.23431 20.5093 7.08805 20.611 6.94529C21.1297 6.21676 21.1297 5.23953 20.611 4.511C20.5093 4.36824 20.363 4.22198 20.0705 3.92947C19.778 3.63697 19.6318 3.4907 19.489 3.38905C18.7605 2.87032 17.7832 2.87032 17.0547 3.38905C16.912 3.4907 16.7657 3.63695 16.4732 3.92947L15.6113 4.79133M19.2087 8.38869L15.6113 4.79133M14 3.18002L15.6113 4.79133"/>
          </svg>
          <svg class="sr-tb-ic" data-tool="image" viewBox="0 0 24 24">
            <rect x="3" y="4" width="18" height="16" rx="3"/>
            <circle cx="9" cy="10" r="1.7"/>
            <path d="M3.5 17.5l5-4.5 4 3.5 3-2.5 5 4"/>
          </svg>
          <span class="sr-tooltip"><span class="sr-tt-title">Color Picker</span><span class="sr-tt-key">C</span></span>
        </button>
        <button class="sr-tb-chev" id="sr-tb-picker-more" aria-label="More color tools" aria-haspopup="menu" aria-expanded="false">
          <svg viewBox="0 0 24 24"><path d="M6.5 9.5l5.5 5.5 5.5-5.5"/></svg>
        </button>
        <div class="sr-tb-menu" id="sr-tb-picker-menu" role="menu">
          <button class="sr-tb-menu-item" role="menuitemradio" data-tool="eyedropper">
            <svg class="sr-tb-menu-check" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>
            <svg class="sr-tb-menu-ic" viewBox="0 0 24 24">
            <path d="M13.435 7L7.15915 13.2759M7.15915 13.2759L4.82728 15.6077C3.92569 16.5093 3.47489 16.9601 3.23745 17.5334C3 18.1066 3 18.7441 3 20.0192V21H3.98082C5.25586 21 5.89338 21 6.46663 20.7626C7.03988 20.5251 7.49068 20.0743 8.39227 19.1727L14.2891 13.2759M7.15915 13.2759H14.2891M14.2891 13.2759L17 10.565"/>
            <path d="M19.2087 8.38869L20.82 10M19.2087 8.38869L20.0705 7.52682C20.363 7.23431 20.5093 7.08805 20.611 6.94529C21.1297 6.21676 21.1297 5.23953 20.611 4.511C20.5093 4.36824 20.363 4.22198 20.0705 3.92947C19.778 3.63697 19.6318 3.4907 19.489 3.38905C18.7605 2.87032 17.7832 2.87032 17.0547 3.38905C16.912 3.4907 16.7657 3.63695 16.4732 3.92947L15.6113 4.79133M19.2087 8.38869L15.6113 4.79133M14 3.18002L15.6113 4.79133"/>
          </svg>
            <span class="sr-tb-menu-label">Pick color</span>
            <span class="sr-tb-menu-key">C</span>
          </button>
          <button class="sr-tb-menu-item" role="menuitemradio" data-tool="image">
            <svg class="sr-tb-menu-check" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>
            <svg class="sr-tb-menu-ic" viewBox="0 0 24 24">
            <rect x="3" y="4" width="18" height="16" rx="3"/>
            <circle cx="9" cy="10" r="1.7"/>
            <path d="M3.5 17.5l5-4.5 4 3.5 3-2.5 5 4"/>
          </svg>
            <span class="sr-tb-menu-label">Colors from image</span>
            <span class="sr-tb-menu-key">Shift+C</span>
          </button>
        </div>
      </div>
      <!-- Responsive Mode -->
      <button class="sr-tb-btn sr-tb-item" id="sr-tb-responsive">
        <svg viewBox="0 0 24 24">
          <path d="M12 17H8C5.17157 17 3.75736 17 2.87868 16.1213C2 15.2426 2 13.8284 2 11V9C2 6.17157 2 4.75736 2.87868 3.87868C3.75736 3 5.17157 3 8 3H16C18.8284 3 20.2426 3 21.1213 3.87868C21.9466 4.70398 21.9968 6.00173 21.9998 8.5"/>
          <path d="M16 14V18C16 19.4142 16 20.1213 16.4393 20.5607C16.8787 21 17.5858 21 19 21C20.4142 21 21.1213 21 21.5607 20.5607C22 20.1213 22 19.4142 22 18V14C22 12.5858 22 11.8787 21.5607 11.4393C21.1213 11 20.4142 11 19 11C17.5858 11 16.8787 11 16.4393 11.4393C16 11.8787 16 12.5858 16 14Z"/>
          <path d="M10 21H8M10 21C10.8284 21 11.5 20.3284 11.5 19.5V17L12 17M10 21H12.5V17L12 17M12 17V21"/>
        </svg>
        <span class="sr-tooltip"><span class="sr-tt-title">Responsive</span><span class="sr-tt-key">R</span></span>
      </button>
      <!-- Side Panel Toggle -->
      <button class="sr-tb-btn sr-tb-item" id="sr-tb-sidepanel">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="4" width="18" height="16" rx="3"/>
          <line x1="10" y1="4" x2="10" y2="20"/>
        </svg>
        <span class="sr-tooltip"><span class="sr-tt-title">Toggle Side Panel</span><span class="sr-tt-key">O</span></span>
      </button>
      <div class="sr-tb-divider sr-tb-item"></div>
      <!-- Pause -->
      <button class="sr-tb-btn sr-tb-item" id="sr-tb-pause">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75">
          <rect x="6" y="5" width="3.5" height="14" rx="1.75"/>
          <rect x="14.5" y="5" width="3.5" height="14" rx="1.75"/>
        </svg>
        <span class="sr-tooltip"><span class="sr-tt-title">Pause</span><span class="sr-tt-key">P</span></span>
      </button>
      <!-- Power / Quit -->
      <button class="sr-tb-btn sr-tb-item" id="sr-tb-power">
        <svg viewBox="0 0 24 24"><path d="M18.36 6.64a9 9 0 1 1-12.73 0M12 2v10"/></svg>
        <span class="sr-tooltip"><span class="sr-tt-title">Quit</span><span class="sr-tt-key">Esc</span></span>
      </button>
      <!-- Hide Dock -->
      <button class="sr-tb-btn sr-tb-item" id="sr-tb-hide-dock">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
          <path d="M7 9l5 5 5-5"/>
          <path d="M6 18h12"/>
        </svg>
        <span class="sr-tooltip"><span class="sr-tt-title">Hide Dock</span><span class="sr-tt-key">H</span></span>
      </button>
    `;
    toolbar.style.display = 'none';
    root.appendChild(toolbar);

    // 6. Dock Restore Tab (Appears when dock is hidden)
    dockRestoreTab = document.createElement('div');
    dockRestoreTab.id = 'sr-dock-restore';
    dockRestoreTab.innerHTML = `
      <svg viewBox="0 0 24 24">
        <path d="M6 7h12"/>
        <path d="M7 16l5-5 5 5"/>
      </svg>
      <span class="sr-tooltip"><span class="sr-tt-title">Show Dock</span><span class="sr-tt-key">H</span></span>
    `;
    dockRestoreTab.style.display = 'none';
    root.appendChild(dockRestoreTab);

    tbBtnInspect = toolbar.querySelector('#sr-tb-inspect');
    tbBtnRuler = toolbar.querySelector('#sr-tb-ruler');
    tbBtnPicker = toolbar.querySelector('#sr-tb-picker');
    initColorTools();
    tbBtnResponsive = toolbar.querySelector('#sr-tb-responsive');
    tbBtnSidePanel = toolbar.querySelector('#sr-tb-sidepanel');
    tbBtnPause = toolbar.querySelector('#sr-tb-pause');
    tbBtnHideDock = toolbar.querySelector('#sr-tb-hide-dock');

    // Wire Toolbar buttons
    tbBtnInspect.addEventListener('click', () => setMode('inspect'));
    tbBtnRuler.addEventListener('click', () => setMode('measure'));
    tbBtnPicker.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      runColorTool();
    });
    tbBtnResponsive.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      setMode('responsive');
    });
    tbBtnSidePanel.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      toggleSidePanel();
    });
    tbBtnPause.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      togglePause();
    });
    toolbar.querySelector('#sr-tb-power').addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      deactivate();
    });
    tbBtnHideDock.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      hideDock();
    });
    dockRestoreTab.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      showDock();
    });

    // Build Side Panel
    buildSidePanelDOM();

    window.addEventListener('resize', handleResize);
    window.addEventListener('scroll', updateAllPinnedPositions, { capture: true, passive: true });
    window.addEventListener('scroll', onPageScroll, { capture: true, passive: true });
    window.addEventListener('blur', () => { S.dragging = false; });
  }

  function updateToolbarButtons() {
    if (tbBtnInspect) tbBtnInspect.classList.toggle('sr-active', S.mode === 'inspect');
    if (tbBtnRuler) tbBtnRuler.classList.toggle('sr-active', S.mode === 'measure');
    if (tbBtnResponsive) tbBtnResponsive.classList.toggle('sr-active', isResponsiveOpen);
    if (tbBtnSidePanel) tbBtnSidePanel.classList.toggle('sr-active', isSidePanelOpen);
    if (tbBtnPause) tbBtnPause.classList.toggle('sr-active', S.paused);
    if (tbBtnPicker) tbBtnPicker.classList.toggle('sr-active', !!S.isColorPicking);
  }

  // ── Color Picker (EyeDropper API) ──────────────────────────
  let colorPickAbort = null;

  async function pickColor() {
    if (S.isColorPicking) return;
    if (!window.EyeDropper) {
      showColorToast('Color picker is not supported in this browser', null);
      return;
    }

    S.isColorPicking = true;
    colorPickAbort = new AbortController();

    // Temporarily hide all visual overlays so user samples true pixel colors
    suspendInspectUI();

    updateToolbarButtons();

    try {
      const dropper = new EyeDropper();
      const result = await dropper.open({ signal: colorPickAbort.signal });
      const hex = result.sRGBHex.toUpperCase();

      // Auto-copy to clipboard
      const copied = await copyText(hex);

      // Show toast with color swatch
      showColorToast(hex, hex, copied);
    } catch (_) {
      // User pressed Escape or cancelled
    } finally {
      S.isColorPicking = false;
      colorPickAbort = null;

      // Restore active mode display
      resumeInspectUI();
      updateToolbarButtons();
    }
  }

  // -- Color tools -----------------------------------------------
  // The picker button runs the chosen tool; the arrow beside it switches between
  //   - Pick color         the browser's eyedropper, one pixel at a time
  //   - Colors from image  click any picture on the page and get its whole palette
  const COLOR_TOOLS = {
    eyedropper: { title: 'Color Picker', key: 'C' },
    image: { title: 'Colors from Image', key: 'Shift+C' }
  };
  let colorTool = 'eyedropper';

  function setColorTool(tool, persist) {
    if (!COLOR_TOOLS[tool]) return;
    // Firefox and Safari have no EyeDropper API: the image tool is the only one there
    if (tool === 'eyedropper' && !window.EyeDropper) tool = 'image';
    colorTool = tool;
    if (persist) {
      try { chrome.storage.local.set({ sr_color_tool: tool }); } catch (_) {}
    }
    if (!tbBtnPicker) return;
    tbBtnPicker.setAttribute('data-tool', tool);
    const title = tbBtnPicker.querySelector('.sr-tt-title');
    const key = tbBtnPicker.querySelector('.sr-tt-key');
    if (title) title.textContent = COLOR_TOOLS[tool].title;
    if (key) key.textContent = COLOR_TOOLS[tool].key;
    toolbar.querySelectorAll('#sr-tb-picker-menu .sr-tb-menu-item').forEach(item => {
      const on = item.getAttribute('data-tool') === tool;
      item.classList.toggle('sr-on', on);
      item.setAttribute('aria-checked', on ? 'true' : 'false');
    });
  }

  function colorToolMenuIsOpen() {
    return !!(toolbar && toolbar.querySelector('#sr-tb-picker-group.sr-open'));
  }

  function toggleColorToolMenu(force) {
    const group = toolbar && toolbar.querySelector('#sr-tb-picker-group');
    if (!group) return;
    const open = typeof force === 'boolean' ? force : !group.classList.contains('sr-open');
    group.classList.toggle('sr-open', open);
    const more = group.querySelector('#sr-tb-picker-more');
    if (more) more.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  // A press anywhere outside the tool group closes its menu
  function onColorMenuOutside(e) {
    if (!colorToolMenuIsOpen()) return;
    if (e.target && e.target.closest && e.target.closest('#sr-tb-picker-group')) return;
    toggleColorToolMenu(false);
  }

  function initColorTools() {
    const more = toolbar.querySelector('#sr-tb-picker-more');
    const menu = toolbar.querySelector('#sr-tb-picker-menu');
    if (!more || !menu) return;
    if (!window.EyeDropper) {
      // nothing to switch between
      more.style.display = 'none';
      setColorTool('image', false);
    } else {
      setColorTool('eyedropper', false);
      try {
        chrome.storage.local.get('sr_color_tool').then(r => {
          if (r && r.sr_color_tool === 'image') setColorTool('image', false);
        }).catch(() => {});
      } catch (_) {}
    }
    more.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      toggleColorToolMenu();
    });
    menu.addEventListener('click', e => {
      const item = e.target.closest('.sr-tb-menu-item');
      if (!item) return;
      e.preventDefault();
      e.stopPropagation();
      toggleColorToolMenu(false);
      useColorTool(item.getAttribute('data-tool'));
    });
    document.addEventListener('mousedown', onColorMenuOutside, true);
  }

  // The button: starts the chosen tool, or ends it if it is already waiting for a click
  function runColorTool() {
    if (S.isColorPicking && colorPickAbort) {
      colorPickAbort.abort();
      return;
    }
    if (colorTool === 'image') pickImageColors();
    else pickColor();
  }

  // Choosing a tool (from the menu or a key) switches the button to it and starts it
  function useColorTool(tool) {
    setColorTool(tool, true);
    if (S.isColorPicking && colorPickAbort) colorPickAbort.abort();
    if (!S.isColorPicking) runColorTool();
  }

  // While a color tool is in use the inspector's own overlays are put away, so they never stand
  // over the page's pixels, and are brought back after.
  function colorToolBusy() {
    return S.isColorPicking || !!imgPal;
  }

  function suspendInspectUI() {
    if (overlay) overlay.style.display = 'none';
    if (panel) panel.style.display = 'none';
    if (distOverlay) distOverlay.style.display = 'none';
    if (rulersContainer) rulersContainer.style.display = 'none';
  }

  function resumeInspectUI() {
    if (isResponsiveOpen) {
      if (S.mode === 'measure') updateDeviceRulersVisibility(true);
    } else {
      if (S.mode === 'inspect') {
        if (panel) panel.style.display = '';
        if (S.curEl) inspect(S.curEl);
      } else if (S.mode === 'measure') {
        if (rulersContainer) rulersContainer.style.display = 'block';
        if (distOverlay) distOverlay.style.display = 'block';
        initRulerSizes();
        drawRulers();
      }
    }
  }

  // Puts text on the clipboard. Pages served over plain http have no clipboard API at all, and some pages'
  // permissions policy shuts it, so the older way (a selected textarea and the copy command) is the fallback; it
  // only works from a click, which is where every copy here starts. What had focus and what was selected on the
  // page are put back, so copying never disturbs the page.
  async function copyText(text) {
    text = String(text);
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (_) {}
    let ta = null;
    const active = document.activeElement;
    const sel = window.getSelection ? window.getSelection() : null;
    const saved = sel ? Array.from({ length: sel.rangeCount }, (_, i) => sel.getRangeAt(i)) : [];
    try {
      ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
      document.documentElement.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, text.length);
      return !!document.execCommand('copy');
    } catch (_) {
      return false;
    } finally {
      if (ta) ta.remove();
      try {
        if (sel) {
          sel.removeAllRanges();
          saved.forEach(range => sel.addRange(range));
        }
        if (active && active !== document.body && active.focus) active.focus({ preventScroll: true });
      } catch (_) {}
    }
  }

  // Copies, and runs `done` only when it worked; says so when it did not
  function copyWithFeedback(text, done) {
    return copyText(text).then(ok => {
      if (ok) done();
      else showToast('Could not copy. Click the page once, then try again.', 2400);
    });
  }

  // -- Colors from image -----------------------------------------
  // Hover a picture on the page (an <img>, a CSS background, a video frame, a canvas), click it,
  // and its palette is read: median cut on a small copy of its pixels.
  const IMG_UI = '#sr-toolbar, #sr-dock-restore, #sr-sidepanel, #sr-imgpal, #sr-upgrade, #sr-xp-modal, #sr-imgpick-hint, #sr-imgpick-box, #sr-responsive-stage';
  const IMG_SAMPLE = 120;
  // What the card offers in its dropdown: the formats for code
  const IMG_FORMATS = [
    ['css', 'CSS variables'], ['tailwind4', 'Tailwind v4'], ['tailwind3', 'Tailwind v3'], ['json', 'JSON tokens']
  ];
  // A picture's own colors, as many as it really has: a flat logo gives a few, a photo up to this
  const IMG_WANT = 10;
  const FIGMA_LOGO = '<svg viewBox="0 0 38 57" aria-hidden="true"><path d="M19 28.5C19 23.2533 23.2533 19 28.5 19C33.7467 19 38 23.2533 38 28.5C38 33.7467 33.7467 38 28.5 38C23.2533 38 19 33.7467 19 28.5Z" fill="#1ABCFE"/><path d="M0 47.5C0 42.2533 4.25329 38 9.5 38H19V47.5C19 52.7467 14.7467 57 9.5 57C4.25329 57 0 52.7467 0 47.5Z" fill="#0ACF83"/><path d="M19 0V19H28.5C33.7467 19 38 14.7467 38 9.5C38 4.25329 33.7467 0 28.5 0H19Z" fill="#FF7262"/><path d="M0 9.5C0 14.7467 4.25329 19 9.5 19H19V0H9.5C4.25329 0 0 4.25329 0 9.5Z" fill="#F24E1E"/><path d="M0 28.5C0 33.7467 4.25329 38 9.5 38H19V19H9.5C4.25329 19 0 23.2533 0 28.5Z" fill="#A259FF"/></svg>';
  let imgPal = null;
  let imgPalFormat = 'css';
  try {
    chrome.storage.local.get('sr_imgpal_format').then(r => {
      if (r && IMG_FORMATS.some(f => f && f[0] === r.sr_imgpal_format)) imgPalFormat = r.sr_imgpal_format;
    }).catch(() => {});
  } catch (_) {}

  function pasteKey() {
    return /Mac|iPhone|iPad/.test(navigator.platform) ? '\u2318V' : 'Ctrl+V';
  }

  // Everything under a point, topmost first, looking inside open shadow roots too
  function deepStackAt(x, y) {
    const out = [];
    const seen = new Set();
    const walk = scope => {
      let hits = [];
      try { hits = scope.elementsFromPoint(x, y); } catch (_) {}
      hits.forEach(el => {
        if (seen.has(el)) return;
        seen.add(el);
        if (el.shadowRoot) walk(el.shadowRoot); // what is inside a component sits above the component
        out.push(el);
      });
    };
    walk(document);
    return out;
  }

  // The first url(...) in a CSS value. A data URL can hold quotes of its own, so a quoted address ends at the
  // quote that opened it, not at the first quote or bracket.
  function firstCssUrl(value) {
    const m = /url\(\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|((?:[^)\\\s]|\\.)*))\s*\)/i.exec(String(value || ''));
    if (!m) return '';
    return (m[1] !== undefined ? m[1] : m[2] !== undefined ? m[2] : m[3]).replace(/\\(.)/g, '$1');
  }

  function imageSourceOf(el) {
    if (!el || el.nodeType !== 1) return null;
    const tag = el.tagName;
    if (tag === 'HTML' || tag === 'BODY') return null;
    if (tag === 'IMG') {
      if (!el.complete || !el.naturalWidth || el.clientWidth < 8 || el.clientHeight < 8) return null;
      return { el, kind: 'img', url: el.currentSrc || el.src };
    }
    if (tag === 'VIDEO') {
      return el.readyState >= 2 && el.videoWidth ? { el, kind: 'video', url: el.currentSrc } : null;
    }
    if (tag === 'CANVAS') {
      return el.width && el.height ? { el, kind: 'canvas', url: '' } : null;
    }
    let bg = '';
    try { bg = getComputedStyle(el).backgroundImage; } catch (_) {}
    const bgUrl = bg && bg !== 'none' ? firstCssUrl(bg) : '';
    if (!bgUrl) return null;
    const r = el.getBoundingClientRect();
    return r.width >= 8 && r.height >= 8 ? { el, kind: 'background', url: bgUrl } : null;
  }

  function imageAt(x, y) {
    for (const el of deepStackAt(x, y)) {
      if (el.closest && el.closest(IMG_UI)) return null; // over the toolkit itself
      const src = imageSourceOf(el);
      if (src) return src;
    }
    return null;
  }

  function pickImageColors() {
    if (S.isColorPicking) return;
    S.isColorPicking = true;
    colorPickAbort = new AbortController();
    const signal = colorPickAbort.signal;
    suspendInspectUI();
    const root = document.documentElement;
    root.classList.add('sr-imgpicking');

    const box = document.createElement('div');
    box.id = 'sr-imgpick-box';
    const hint = document.createElement('div');
    hint.id = 'sr-imgpick-hint';
    hint.textContent = 'Click an image to get its colors \u00b7 Esc to cancel';
    root.appendChild(box);
    root.appendChild(hint);

    let x = -1, y = -1, queued = false;
    const ours = t => !!(t && t.closest && t.closest(IMG_UI));
    const paint = () => {
      queued = false;
      const hit = x < 0 ? null : imageAt(x, y);
      if (!hit) { box.style.display = 'none'; return; }
      const r = hit.el.getBoundingClientRect();
      box.style.cssText = `display:block;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px`;
    };
    const queue = () => {
      if (!queued) { queued = true; requestAnimationFrame(paint); }
    };
    const onMove = e => { x = e.clientX; y = e.clientY; queue(); };
    // the page must not react to the press that picks the image (a link, a slider, a lightbox)
    const swallow = e => {
      if (ours(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
    };
    const onClickCapture = e => {
      if (ours(e.target)) return;
      swallow(e);
      const hit = imageAt(e.clientX, e.clientY);
      if (!hit) { showToast('No image here. Click a picture or a banner.'); return; }
      picked = true;
      end();
      openImagePalette(hit);
    };
    const swallowed = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'dblclick', 'auxclick', 'contextmenu'];
    window.addEventListener('mousemove', onMove, true);
    window.addEventListener('scroll', queue, true);
    window.addEventListener('click', onClickCapture, true);
    swallowed.forEach(t => window.addEventListener(t, swallow, true));

    let ended = false;
    let picked = false;
    function end() {
      if (ended) return;
      ended = true;
      window.removeEventListener('mousemove', onMove, true);
      window.removeEventListener('scroll', queue, true);
      window.removeEventListener('click', onClickCapture, true);
      swallowed.forEach(t => window.removeEventListener(t, swallow, true));
      box.remove();
      hint.remove();
      root.classList.remove('sr-imgpicking');
      S.isColorPicking = false;
      colorPickAbort = null;
      if (!picked && !imgPal) resumeInspectUI();
      updateToolbarButtons();
    }
    signal.addEventListener('abort', end);
    updateToolbarButtons();
  }

  // A small copy of the picture's pixels. Throws when the picture is from another site and the
  // page may not read it.
  function sampleCanvas(source, sw, sh) {
    sw = sw || 256;
    sh = sh || 256;
    const k = Math.min(1, IMG_SAMPLE / Math.max(sw, sh));
    const w = Math.max(1, Math.round(sw * k));
    const h = Math.max(1, Math.round(sh * k));
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.imageSmoothingQuality = 'high';
    g.drawImage(source, 0, 0, w, h);
    return { data: g.getImageData(0, 0, w, h).data, w, h, canvas: c, nw: sw, nh: sh };
  }

  function loadImage(url, cors) {
    return new Promise((ok, no) => {
      const img = new Image();
      if (cors) img.crossOrigin = 'anonymous';
      img.onload = () => ok(img);
      img.onerror = () => no(new Error('load'));
      img.src = url;
    });
  }

  async function readImagePixels(hit) {
    const { el, kind, url } = hit;
    // 1. the picture as the page holds it: the same site, or a server that allows it
    try {
      if (kind === 'img') return { ...sampleCanvas(el, el.naturalWidth, el.naturalHeight), via: 'page' };
      if (kind === 'video') return { ...sampleCanvas(el, el.videoWidth, el.videoHeight), via: 'page' };
      if (kind === 'canvas') return { ...sampleCanvas(el, el.width, el.height), via: 'page' };
    } catch (_) {}
    // 2. fetched again, asking the server to allow it (a CSS background has no copy yet to try)
    if (url && kind !== 'video' && kind !== 'canvas') {
      for (const cors of kind === 'background' ? [false, true] : [true]) {
        try {
          const img = await loadImage(url, cors);
          return { ...sampleCanvas(img, img.naturalWidth, img.naturalHeight), via: 'page' };
        } catch (_) {}
      }
    }
    // 3. the last resort: a photograph of the tab, cropped to the element
    try {
      const shot = await xpShootCanvas(el);
      if (shot) {
        const img = await loadImage(shot, false);
        return { ...sampleCanvas(img, img.naturalWidth, img.naturalHeight), via: 'screen' };
      }
    } catch (_) {}
    return null;
  }

  // Median cut. The pixels are counted into 5-bit color bins, the bins are split into boxes of
  // similar colors (along the widest channel, at the median pixel), and each box gives one color.
  // The most populated box is split first, then by population x volume, so a small vivid accent
  // is not swallowed by a big flat background.
  function extractPalette(data, want) {
    const bins = new Map();
    let total = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 128) continue;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
      let bin = bins.get(key);
      if (!bin) { bin = { n: 0, r: 0, g: 0, b: 0 }; bins.set(key, bin); }
      bin.n++;
      bin.r += r;
      bin.g += g;
      bin.b += b;
      total++;
    }
    if (!total) return [];
    const mean = (bin, ch) => (ch === 0 ? bin.r : ch === 1 ? bin.g : bin.b) / bin.n;
    const makeBox = list => {
      const lo = [255, 255, 255], hi = [0, 0, 0];
      let n = 0;
      list.forEach(bin => {
        n += bin.n;
        for (let ch = 0; ch < 3; ch++) {
          const v = mean(bin, ch);
          if (v < lo[ch]) lo[ch] = v;
          if (v > hi[ch]) hi[ch] = v;
        }
      });
      return { list, n, lo, hi, vol: (hi[0] - lo[0] + 1) * (hi[1] - lo[1] + 1) * (hi[2] - lo[2] + 1) };
    };
    const splitBox = box => {
      const spans = [box.hi[0] - box.lo[0], box.hi[1] - box.lo[1], box.hi[2] - box.lo[2]];
      const ch = spans.indexOf(Math.max(spans[0], spans[1], spans[2]));
      const sorted = box.list.slice().sort((p, q) => mean(p, ch) - mean(q, ch));
      let acc = 0, cut = 0;
      for (; cut < sorted.length - 1; cut++) {
        acc += sorted[cut].n;
        if (acc >= box.n / 2) break;
      }
      cut = Math.min(cut, sorted.length - 2);
      return [makeBox(sorted.slice(0, cut + 1)), makeBox(sorted.slice(cut + 1))];
    };
    const boxes = [makeBox(Array.from(bins.values()))];
    while (boxes.length < want) {
      const byCount = boxes.length < want * 0.6;
      let best = null, top = 0;
      boxes.forEach(box => {
        if (box.list.length < 2) return;
        const score = byCount ? box.n : box.n * box.vol;
        if (score > top) { best = box; top = score; }
      });
      if (!best) break;
      boxes.splice(boxes.indexOf(best), 1, ...splitBox(best));
    }
    // Each box gives the color most of its pixels have (the pixels near the most populated bin
    // are averaged), so the palette holds colors the picture really contains, not muddy blends.
    const found = boxes.map(box => {
      let top = box.list[0];
      box.list.forEach(bin => { if (bin.n > top.n) top = bin; });
      const cx = top.r / top.n, cy = top.g / top.n, cz = top.b / top.n;
      let r = 0, g = 0, b = 0, w = 0;
      box.list.forEach(bin => {
        if (Math.hypot(bin.r / bin.n - cx, bin.g / bin.n - cy, bin.b / bin.n - cz) > 20) return;
        r += bin.r;
        g += bin.g;
        b += bin.b;
        w += bin.n;
      });
      return { r: r / w, g: g / w, b: b / w, n: box.n };
    }).sort((p, q) => q.n - p.n);
    // two boxes that landed on nearly the same color count as one
    const kept = [];
    found.forEach(c => {
      const twin = kept.find(k => Math.hypot(k.r - c.r, k.g - c.g, k.b - c.b) < 22);
      if (twin) {
        const both = twin.n + c.n;
        twin.r = (twin.r * twin.n + c.r * c.n) / both;
        twin.g = (twin.g * twin.n + c.g * c.n) / both;
        twin.b = (twin.b * twin.n + c.b * c.n) / both;
        twin.n = both;
      } else {
        kept.push({ ...c });
      }
    });
    kept.sort((p, q) => q.n - p.n);
    // a small color that lies on the line between two bigger ones is only where they blend (the
    // anti-aliased edge of a logo or a screenshot), not a color of its own
    const between = (c, p, q) => {
      const d = [q.r - p.r, q.g - p.g, q.b - p.b];
      const len2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2] || 1;
      const t = Math.max(0, Math.min(1, ((c.r - p.r) * d[0] + (c.g - p.g) * d[1] + (c.b - p.b) * d[2]) / len2));
      return Math.hypot(c.r - (p.r + d[0] * t), c.g - (p.g + d[1] * t), c.b - (p.b + d[2] * t)) < 22;
    };
    const real = kept.filter((c, i) => {
      if (c.n / total >= 0.06) return true;
      for (let x = 0; x < i; x++) for (let y = x + 1; y < i; y++) if (between(c, kept[x], kept[y])) return false;
      return true;
    });
    return real.filter((c, i) => i < 2 || c.n / total >= 0.01).map(c => {
      const col = { r: Math.round(c.r), g: Math.round(c.g), b: Math.round(c.b), a: 255 };
      const share = c.n / total;
      return {
        ...col,
        hex: toHex(col),
        share,
        pct: share >= 0.01 ? Math.round(share * 100) + '%' : '<1%',
        ink: luminance(col) > 0.4 ? '#09090b' : '#ffffff'
      };
    });
  }

  async function openImagePalette(hit) {
    closeImagePalette(true);
    const node = document.createElement('div');
    node.id = 'sr-imgpal';
    const mine = { node, hit, px: null, colors: [], failed: false };
    imgPal = mine;
    node.addEventListener('click', onImagePaletteClick);
    document.addEventListener('mousedown', onImagePalOutside, true);
    renderImagePalette();
    document.documentElement.appendChild(node);
    requestAnimationFrame(() => node.classList.add('sr-show'));
    let px = null;
    try { px = await readImagePixels(hit); } catch (_) {}
    if (imgPal !== mine) return; // closed or replaced while it was being read
    if (px) {
      mine.px = px;
      mine.colors = extractPalette(px.data, IMG_WANT);
    }
    mine.failed = !px || !mine.colors.length;
    renderImagePalette();
  }

  // A press anywhere outside the format button and its list closes the list
  function onImagePalOutside(e) {
    if (!imgPal || !imgPal.menuOpen) return;
    if (e.target && e.target.closest && e.target.closest('.sr-ip-fmt')) return;
    setFmtMenu(false);
  }

  function closeImagePalette(keepSuspended) {
    document.removeEventListener('mousedown', onImagePalOutside, true);
    const had = !!imgPal;
    if (imgPal) imgPal.node.remove();
    imgPal = null;
    if (had && !keepSuspended) resumeInspectUI();
  }

  function imageLabel(hit, px) {
    const kindName = { img: 'Image', background: 'Background image', video: 'Video frame', canvas: 'Canvas' }[hit.kind] || 'Image';
    let file = '';
    if (hit.url && !/^(data|blob):/.test(hit.url)) {
      try { file = decodeURIComponent(new URL(hit.url, location.href).pathname.split('/').pop() || ''); } catch (_) {}
    }
    return [file || kindName, px ? px.nw + '\u00d7' + px.nh : ''].filter(Boolean).join(' \u00b7 ');
  }

  function setFmtMenu(open) {
    if (!imgPal) return;
    imgPal.menuOpen = open;
    const box = imgPal.node.querySelector('.sr-ip-fmt');
    if (!box) return;
    box.classList.toggle('sr-open', open);
    const btn = box.querySelector('.sr-ip-fmt-btn');
    if (btn) btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  function onImagePaletteClick(e) {
    if (!imgPal) return;
    const t = e.target && e.target.closest ? e.target.closest('button') : null;
    e.stopPropagation();
    const inMenu = !!(t && (t.closest('.sr-ip-menu') || t.classList.contains('sr-ip-fmt-btn')));
    if (imgPal.menuOpen && !inMenu) setFmtMenu(false);
    if (!t) return;
    const fmt = t.getAttribute('data-fmt');
    if (fmt) {
      imgPalFormat = fmt;
      try { chrome.storage.local.set({ sr_imgpal_format: fmt }); } catch (_) {}
      imgPal.menuOpen = false;
      renderImagePalette();
      return;
    }
    const hex = t.getAttribute('data-hex');
    if (hex) {
      copyText(hex).then(ok => showColorToast(hex, hex, ok));
      return;
    }
    const act = t.getAttribute('data-act');
    if (act === 'fmt') setFmtMenu(!imgPal.menuOpen);
    else if (act === 'close') closeImagePalette();
    else if (act === 'again') { closeImagePalette(true); pickImageColors(); }
    else if (act === 'figma') copyImagePalette('figma', t);
    else if (act === 'copy') copyImagePalette(imgPalFormat, t);
  }

  async function copyImagePalette(format, btn) {
    if (!imgPal || !imgPal.colors.length) return;
    const ok = await copyText(paletteToCode(imgPal.colors.map(c => c.hex), format));
    if (!ok) { showToast('Could not copy. Allow clipboard access and try again.', 2400); return; }
    if (!btn || !btn.isConnected) return;
    const label = btn.querySelector('span:last-child') || btn;
    const original = label.textContent;
    btn.classList.add('sr-done');
    label.textContent = 'Copied';
    setTimeout(() => {
      if (!btn.isConnected) return;
      btn.classList.remove('sr-done');
      label.textContent = original;
    }, 2200);
  }

  function renderImagePalette() {
    if (!imgPal) return;
    const { node, hit, px, colors } = imgPal;
    const sub = imageLabel(hit, px);
    let body;
    if (imgPal.failed) {
      body = '<div class="sr-ip-empty">This picture cannot be read from here.<br>Try another one.</div>';
    } else if (!px) {
      body = '<div class="sr-ip-empty">Reading colors...</div>';
    } else {
      body = '<div class="sr-ip-grid">' + colors.map(c =>
        `<button class="sr-ip-sw" data-hex="${c.hex}" title="Copy ${c.hex}" style="background:${c.hex};color:${c.ink}"><span class="sr-ip-pct">${escapeHTML(c.pct)}</span><span>${c.hex}</span></button>`
      ).join('') + '</div>';
    }
    const current = IMG_FORMATS.find(f => f && f[0] === imgPalFormat) || IMG_FORMATS[0];
    const items = IMG_FORMATS.map(f => f
      ? `<button class="sr-ip-mi${f[0] === current[0] ? ' sr-on' : ''}" data-fmt="${f[0]}" role="menuitemradio"><svg class="sr-ip-mck" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>${f[1]}</button>`
      : '<div class="sr-ip-msep"></div>').join('');
    const open = !!imgPal.menuOpen;
    const tools = px && !imgPal.failed ? `
      <div class="sr-ip-tools">
        <button class="sr-ip-figma" data-act="figma" title="Then click your Figma canvas and press ${pasteKey()}">${FIGMA_LOGO}<span>Copy for Figma</span></button>
        <div class="sr-ip-fmt${open ? ' sr-open' : ''}">
          <div class="sr-ip-split">
          <button class="sr-ip-copy" data-act="copy"><span class="sr-ip-code">&lt;/&gt;</span><span>Copy ${current[1]}</span></button>
          <button class="sr-ip-fmt-btn" data-act="fmt" aria-haspopup="menu" aria-expanded="${open ? 'true' : 'false'}" aria-label="Choose format"><svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg></button>
          </div>
          <div class="sr-ip-menu" role="menu">${items}</div>
        </div>
      </div>
      ${px.via === 'screen' ? '<div class="sr-ip-note">Read from what is on screen, so a color can be off by a shade.</div>' : ''}` : '';
    setHTML(node, `
      <div class="sr-ip-head">
        <div class="sr-ip-thumb"></div>
        <div class="sr-ip-title"><b>Colors from image</b><span class="sr-ip-sub" title="${escapeHTML(sub)}">${escapeHTML(sub)}</span></div>
        <button class="sr-ip-link" data-act="again">Pick another</button>
        <button class="sr-ip-x" data-act="close" aria-label="Close"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
      </div>
      ${body}${tools}`);
    if (px) {
      const thumb = document.createElement('canvas');
      thumb.width = px.w;
      thumb.height = px.h;
      thumb.getContext('2d').drawImage(px.canvas, 0, 0);
      node.querySelector('.sr-ip-thumb').appendChild(thumb);
    }
  }

  function showColorToast(text, bgColor, copied = true) {
    // Remove existing toast
    const old = document.getElementById('sr-color-toast');
    if (old) old.remove();

    const toast = document.createElement('div');
    toast.id = 'sr-color-toast';
    toast.setAttribute('role', 'status');

    if (bgColor) {
      setHTML(toast, `
        <div class="sr-toast-swatch" style="background:${bgColor}"></div>
        <span class="sr-toast-hex">${text}</span>
        ${copied ? '<span class="sr-toast-copied">Copied!</span>' : ''}
      `);
    } else {
      toast.innerHTML = `<span class="sr-toast-hex">${text}</span>`;
    }

    document.documentElement.appendChild(toast);

    // Animate in
    requestAnimationFrame(() => {
      toast.classList.add('sr-toast-show');
    });

    // Remove after 1.8s
    setTimeout(() => {
      toast.classList.remove('sr-toast-show');
      toast.classList.add('sr-toast-hide');
      setTimeout(() => toast.remove(), 300);
    }, 1800);
  }

  function showToast(text, ms) {
    const old = document.getElementById('sr-quick-toast');
    if (old) old.remove();

    const toast = document.createElement('div');
    toast.id = 'sr-quick-toast';
    toast.setAttribute('role', 'status');
    toast.textContent = text;
    document.documentElement.appendChild(toast);

    requestAnimationFrame(() => {
      toast.classList.add('sr-toast-show');
    });

    setTimeout(() => {
      toast.classList.remove('sr-toast-show');
      toast.classList.add('sr-toast-hide');
      setTimeout(() => toast.remove(), 260);
    }, ms || 1400);
  }

  function togglePause(forceState) {
    S.paused = typeof forceState === 'boolean' ? forceState : !S.paused;
    if (tbBtnPause) {
      tbBtnPause.classList.toggle('sr-active', S.paused);
      const ttTitle = tbBtnPause.querySelector('.sr-tt-title');
      if (ttTitle) ttTitle.textContent = S.paused ? 'Resume' : 'Pause';
    }
    if (panel) {
      panel.style.pointerEvents = S.paused ? 'auto' : 'none';
    }
    const modeName = S.mode === 'measure' ? 'Measurement' : 'Inspection';
    showToast(S.paused ? `⏸️ ${modeName} Paused (P)` : `▶️ ${modeName} Resumed (P)`);
    updateToolbarButtons();
  }

  function hideDock() {
    isDockHidden = true;
    if (toolbar) toolbar.classList.add('sr-tb-hidden');
    if (dockRestoreTab) {
      dockRestoreTab.style.display = 'flex';
    }
  }

  function showDock() {
    isDockHidden = false;
    if (toolbar) toolbar.classList.remove('sr-tb-hidden');
    if (dockRestoreTab) {
      dockRestoreTab.style.display = 'none';
    }
  }

  function toggleDock() {
    if (isDockHidden) {
      showDock();
    } else {
      hideDock();
    }
  }

  // ── Mode Switcher ───────────────────────────────────────────
  function setMode(newMode) {
    if (S.paused) {
      togglePause(false);
    }

    if (newMode === 'responsive') {
      if (isResponsiveOpen) {
        closeResponsiveStage();
      } else {
        openResponsiveStage();
      }
      return;
    }

    S.mode = newMode;
    updateToolbarButtons();

    if (newMode === 'inspect') {
      // Hide rulers and distance overlay
      if (rulersContainer) rulersContainer.style.display = 'none';
      if (distOverlay) distOverlay.style.display = 'none';
      if (distSelected) distSelected.style.display = 'none';
      if (distHovered) distHovered.style.display = 'none';
      S.selectedEl = null;
      S.hoveredEl = null;
      clearDistanceLines();

      if (isResponsiveOpen) {
        updateDeviceRulersVisibility(false);
        respDevices.forEach(d => {
          d.selectedEl = null;
          try {
            const doc = d.iframe ? d.iframe.contentDocument : null;
            if (doc) {
              const sel = doc.getElementById('sr-if-dist-selected');
              if (sel) sel.style.display = 'none';
              const hov = doc.getElementById('sr-if-dist-hovered');
              if (hov) hov.style.display = 'none';
              const lns = doc.getElementById('sr-if-dist-lines');
              if (lns) lns.innerHTML = '';
            }
          } catch (_) {}
        });
      } else {
        if (panel) panel.style.display = '';
        pinnedCards.forEach(c => {
          if (c.cardNode) c.cardNode.style.display = 'block';
          else if (c.node) c.node.style.display = 'block';
          if (c.overlayNode) c.overlayNode.style.display = 'block';
        });
        updateAllPinnedPositions();
        // Resume live box model inspect
        if (S.curEl) inspect(S.curEl);
      }
    } else if (newMode === 'measure') {
      // Hide box model overlay, floating panel, and pinned cards
      if (overlay) overlay.style.display = 'none';
      if (panel) {
        panel.classList.remove('sr-on');
        panel.style.display = 'none';
      }
      pinnedCards.forEach(c => {
        if (c.cardNode) c.cardNode.style.display = 'none';
        else if (c.node) c.node.style.display = 'none';
        if (c.overlayNode) c.overlayNode.style.display = 'none';
      });

      if (isResponsiveOpen) {
        updateDeviceRulersVisibility(true);
        respDevices.forEach(d => {
          try {
            const doc = d.iframe ? d.iframe.contentDocument : null;
            if (doc) {
              const bm = doc.getElementById('sr-if-bm-wrap');
              if (bm) bm.querySelectorAll('div').forEach(div => div.style.display = 'none');
            }
          } catch (_) {}
        });
      } else {
        if (rulersContainer) rulersContainer.style.display = 'block';
        if (distOverlay) distOverlay.style.display = 'block';
        initRulerSizes();
        drawRulers();

        // If we already had an active element, select it as measurement reference!
        if (S.curEl) {
          selectDistanceRef(S.curEl);
        }
      }
    }
  }

  // ── Responsive Multi-Device Mode Implementation ────────────
  const RESP_PRESETS = [
    { name: 'Phone', width: 390, height: 844, rulers: false },
    { name: 'Tablet', width: 768, height: 1024, rulers: false },
    { name: 'Desktop', width: 1280, height: 800, rulers: false },
  ];

  const RESP_DEVICE_GROUPS = [
    {
      devices: [
        { name: 'iPhone 17 Pro', width: 402, height: 874 },
        { name: 'iPhone 17 Pro Max', width: 440, height: 956 },
        { name: 'iPhone 16', width: 393, height: 852 },
        { name: 'iPhone 16 Plus', width: 430, height: 932 },
        { name: 'iPhone 12-15', width: 390, height: 844 },
        { name: 'iPhone SE', width: 375, height: 667 },
      ]
    },
    {
      devices: [
        { name: 'Galaxy S24/S25', width: 360, height: 780 },
        { name: 'Galaxy S25 Ultra', width: 412, height: 883 },
      ]
    },
    {
      devices: [
        { name: 'Pixel 9', width: 412, height: 915 },
        { name: 'Pixel 9 Pro XL', width: 448, height: 997 },
      ]
    },
    {
      devices: [
        { name: 'Android Compact', width: 360, height: 800 },
        { name: 'Android Large', width: 412, height: 915 },
      ]
    },
    {
      devices: [
        { name: 'iPad mini', width: 768, height: 1024 },
        { name: 'iPad Air 11"', width: 820, height: 1180 },
        { name: 'iPad Pro 11"', width: 834, height: 1194 },
        { name: 'iPad Pro 13"', width: 1024, height: 1366 },
      ]
    },
    {
      devices: [
        { name: 'Galaxy Tab S', width: 800, height: 1280 },
      ]
    },
    {
      devices: [
        { name: 'Laptop 1366x768', width: 1366, height: 768 },
        { name: 'Laptop 1440x900', width: 1440, height: 900 },
        { name: 'Laptop 1536x864', width: 1536, height: 864 },
        { name: 'Desktop (1280×800)', width: 1280, height: 800 },
        { name: 'Desktop Full HD', width: 1920, height: 1080 },
      ]
    }
  ];

  let onResponsiveOutsideClick = null;

  // Ask the background worker to lift (or restore) frame-blocking headers for this tab.
  function setFramingAllowed(allowed) {
    return sendRuntimeMessage({ type: allowed ? 'SR_ALLOW_FRAMING' : 'SR_DISALLOW_FRAMING' });
  }

  async function openResponsiveStage() {
    if (isResponsiveOpen) return;
    isResponsiveOpen = true;
    updateToolbarButtons();
    // The headers must be lifted before any preview iframe starts loading.
    await setFramingAllowed(true);
    if (!isResponsiveOpen) return; // closed again while waiting

    try {
      const isFirstOpen = !respStage;
      if (isFirstOpen) {
        buildResponsiveDOM();
      }

      // Cleanly hide main page overlays so they don't bleed or sit behind the stage
      if (rulersContainer) rulersContainer.style.display = 'none';
      if (distOverlay) distOverlay.style.display = 'none';
      if (overlay) overlay.style.display = 'none';
      if (panel) {
        panel.classList.remove('sr-on');
        panel.style.display = 'none';
      }
      pinnedCards.forEach(c => {
        if (c.cardNode) c.cardNode.style.display = 'none';
        else if (c.node) c.node.style.display = 'none';
        if (c.overlayNode) c.overlayNode.style.display = 'none';
      });

      if (respStage) {
        respStage.classList.add('sr-show-stage');
        respStage.style.setProperty('display', 'flex', 'important');
      }
      if (respUrlInput) {
        respUrlInput.value = window.location.href;
      }
      // Previews are unloaded on close, so load them again with the current page.
      if (!isFirstOpen) {
        navigateAllDevices(window.location.href);
      }
      // Fit the devices to the screen once the stage has its size
      respZoomAuto = true;
      requestAnimationFrame(() => {
        if (isResponsiveOpen && respZoomAuto) fitRespZoom();
      });
      updateToolbarButtons();

      if (S.mode === 'measure') {
        updateDeviceRulersVisibility(true);
      } else {
        updateDeviceRulersVisibility(false);
      }
    } catch (err) {
      console.error('[Screen Ruler] Failed to open responsive stage:', err);
    }
  }

  function closeResponsiveStage() {
    try {
      closeRespConfirm();
      closeRespAddMenu();
      isResponsiveOpen = false;
      if (respStage) {
        respStage.classList.remove('sr-show-stage');
        respStage.style.setProperty('display', 'none', 'important');
      }
      if (panel) panel.classList.remove('sr-on');

      // Unload the previews so the hidden pages stop running (media, timers, network),
      // then drop everything that still points into their documents.
      respDevices.forEach(d => {
        d.selectedEl = null;
        d.curEl = null;
        if (d.iframe) d.iframe.src = 'about:blank';
      });
      setFramingAllowed(false);
      pinnedCards = pinnedCards.filter(c => {
        if (c.el && c.el.ownerDocument !== document) {
          if (c.cardNode) c.cardNode.remove();
          if (c.overlayNode) c.overlayNode.remove();
          return false;
        }
        return true;
      });
      if (S.curEl && S.curEl.ownerDocument !== document) S.curEl = null;
      if (sidePanelTargetEl && sidePanelTargetEl.ownerDocument !== document) sidePanelTargetEl = null;

      updateToolbarButtons();

      // Only restore regular view if extension is active
      if (S.active) {
        if (S.mode === 'measure') {
          if (rulersContainer) rulersContainer.style.display = 'block';
          if (distOverlay) distOverlay.style.display = 'block';
          initRulerSizes();
          drawRulers();
          if (S.curEl) selectDistanceRef(S.curEl);
        } else if (S.mode === 'inspect') {
          if (panel) panel.style.display = '';
          pinnedCards.forEach(c => {
            if (c.cardNode) c.cardNode.style.display = 'block';
            else if (c.node) c.node.style.display = 'block';
            if (c.overlayNode) c.overlayNode.style.display = 'block';
          });
          updateAllPinnedPositions();
          if (S.curEl) inspect(S.curEl);
        }
      }
    } catch (err) {
      console.error('[Screen Ruler] Failed to close responsive stage:', err);
    }
  }

  function updateDeviceRulersVisibility(visible) {
    respDevices.forEach(d => {
      d.rulers = !!visible;
      if (d.rulerH && d.rulerV) {
        d.rulerH.style.display = visible ? 'block' : 'none';
        d.rulerV.style.display = visible ? 'block' : 'none';
        if (d.iframe) {
          d.iframe.style.paddingTop = visible ? '18px' : '0px';
          d.iframe.style.paddingLeft = visible ? '18px' : '0px';
        }
        if (visible) renderDeviceRulers(d);
      }
    });
  }

  function buildResponsiveDOM() {
    respStage = document.createElement('div');
    respStage.id = 'sr-responsive-stage';

    setHTML(respStage, `
      <!-- Top bar: the address, the view controls, the screens -->
      <div id="sr-resp-header">
        <div class="sr-resp-url-bar">
          ${icon('globe')}
          <input type="text" id="sr-resp-url-input" spellcheck="false" autocomplete="off" value="${escapeHTML(window.location.href)}" placeholder="https://..." />
          <button class="sr-resp-btn" id="sr-resp-reload" title="Reload all screens">${icon('reload')}</button>
        </div>
        <div class="sr-resp-zoom-group">
          <button class="sr-resp-btn" id="sr-resp-zoom-out" title="Zoom out (-)">${icon('minus')}</button>
          <span id="sr-resp-zoom-val">65%</span>
          <button class="sr-resp-btn" id="sr-resp-zoom-in" title="Zoom in (+)">${icon('plus')}</button>
          <button class="sr-resp-fit" id="sr-resp-fit" title="Fit every screen in the window">Fit</button>
        </div>
        <span class="sr-resp-fill"></span>
        <button class="sr-resp-switch" id="sr-resp-sync-btn" role="switch" aria-checked="true" title="When on, scrolling one screen scrolls them all"><span class="sr-resp-track"></span>Sync scroll</button>
        <span class="sr-resp-sep"></span>
        <div class="sr-resp-add-wrap">
          <button class="sr-resp-add" id="sr-resp-add-btn" title="Add a screen">${icon('plus')}Add device</button>
          <div id="sr-resp-add-menu" style="display:none;"></div>
        </div>
        <button class="sr-resp-btn sr-resp-exit" id="sr-resp-exit-btn" title="Exit responsive mode (Esc)">${icon('x')}</button>
      </div>

      <!-- Main Canvas Body -->
      <div id="sr-resp-body">
        <div id="sr-resp-sizer">
          <div id="sr-resp-devices-wrap"></div>
        </div>
      </div>

      <!-- The question asked before a screen is removed -->
      <div id="sr-resp-confirm">
        <div id="sr-resp-dialog" role="alertdialog" aria-modal="true" aria-labelledby="sr-resp-confirm-title" aria-describedby="sr-resp-confirm-text">
          <h3 id="sr-resp-confirm-title">Remove screen?</h3>
          <p id="sr-resp-confirm-text"></p>
          <div class="sr-resp-dialog-actions">
            <button type="button" class="sr-resp-dialog-btn" id="sr-resp-cancel-remove">Cancel</button>
            <button type="button" class="sr-resp-dialog-btn sr-danger" id="sr-resp-confirm-remove">Remove</button>
          </div>
        </div>
      </div>
    `);

    document.documentElement.appendChild(respStage);
    isolateScrolling(respStage, '#sr-resp-body, .sr-resp-pop-list');

    respHeader = respStage.querySelector('#sr-resp-header');
    respBody = respStage.querySelector('#sr-resp-body');
    respSizer = respStage.querySelector('#sr-resp-sizer');
    respDevicesWrap = respStage.querySelector('#sr-resp-devices-wrap');
    // Adding, removing, rotating or resizing a device changes the size the sizer must match
    if (typeof ResizeObserver === 'function') {
      new ResizeObserver(updateRespSizer).observe(respDevicesWrap);
    }
    respZoomLabel = respStage.querySelector('#sr-resp-zoom-val');
    respUrlInput = respStage.querySelector('#sr-resp-url-input');
    respSyncBtn = respStage.querySelector('#sr-resp-sync-btn');

    // Wire Exit button in responsive header
    const respExitBtn = respStage.querySelector('#sr-resp-exit-btn');
    if (respExitBtn) {
      respExitBtn.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        closeResponsiveStage();
      });
    }

    // Start at 65%; openResponsiveStage() then fits the devices to the screen
    respZoom = 0.65;
    applyRespZoom(respZoom);

    // Click the zoom label to fit every device on screen again
    respZoomLabel.title = 'Click to fit the screen';
    respZoomLabel.addEventListener('click', () => {
      fitRespZoom();
    });

    // Zoom buttons move in 5% steps; after that the zoom stops following the window size
    respStage.querySelector('#sr-resp-zoom-out').addEventListener('click', () => {
      respZoomAuto = false;
      changeRespZoom(-0.05);
    });
    respStage.querySelector('#sr-resp-zoom-in').addEventListener('click', () => {
      respZoomAuto = false;
      changeRespZoom(0.05);
    });

    respStage.querySelector('#sr-resp-fit').addEventListener('click', () => {
      fitRespZoom();
    });
    respStage.querySelector('#sr-resp-cancel-remove').addEventListener('click', closeRespConfirm);
    respStage.querySelector('#sr-resp-confirm-remove').addEventListener('click', confirmRemoveDevice);
    respStage.querySelector('#sr-resp-confirm').addEventListener('click', e => {
      if (e.target.id === 'sr-resp-confirm') closeRespConfirm();
    });

    // Wire Reload button
    respStage.querySelector('#sr-resp-reload').addEventListener('click', () => {
      reloadAllDevices();
    });

    // Wire URL input
    respUrlInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        let val = respUrlInput.value.trim();
        if (val && !/^https?:\/\//i.test(val) && !val.startsWith('file://')) {
          val = 'https://' + val;
          respUrlInput.value = val;
        }
        navigateAllDevices(val);
      }
    });

    // Wire Sync Scroll toggle
    respSyncBtn.addEventListener('click', () => {
      respSyncScroll = !respSyncScroll;
      respSyncBtn.setAttribute('aria-checked', respSyncScroll ? 'true' : 'false');
    });

    // Wire Add Device dropdown
    const addBtn = respStage.querySelector('#sr-resp-add-btn');
    const addMenu = respStage.querySelector('#sr-resp-add-menu');

    addBtn.addEventListener('click', e => {
      e.stopPropagation();
      const isVisible = addMenu.style.display === 'block';
      addMenu.style.display = isVisible ? 'none' : 'block';
      addBtn.classList.toggle('sr-active', !isVisible);
      if (!isVisible) {
        renderAddDeviceMenu(addMenu);
      }
    });

    onResponsiveOutsideClick = e => {
      if (!(e.target instanceof Element)) return;
      if (addMenu && !addMenu.contains(e.target) && e.target !== addBtn) {
        addMenu.style.display = 'none';
        addBtn.classList.remove('sr-active');
      }
    };
    document.addEventListener('click', onResponsiveOutsideClick);

    // Load initial default devices
    RESP_PRESETS.forEach(preset => {
      addDeviceToStage(preset);
    });
  }

  function changeRespZoom(delta) {
    const next = Math.max(0.25, Math.min(2.0, Math.round((respZoom + delta) * 100) / 100));
    applyRespZoom(next);
  }

  function applyRespZoom(val) {
    respZoom = Math.max(0.25, Math.min(2.0, Math.round(val * 100) / 100));
    if (respDevicesWrap) {
      respDevicesWrap.style.transform = respZoom === 1 ? 'none' : `scale(${respZoom})`;
      respDevicesWrap.style.setProperty('--sr-z', String(respZoom));
    }
    if (respZoomLabel) {
      respZoomLabel.textContent = `${Math.round(respZoom * 100)}%`;
    }
    updateRespSizer();
  }

  // Gives the sizer the devices' on-screen (scaled) size, so the stage only scrolls when they
  // really don't fit.
  function updateRespSizer() {
    if (!respSizer || !respDevicesWrap) return;
    respSizer.style.width = `${Math.ceil(respDevicesWrap.offsetWidth * respZoom)}px`;
    respSizer.style.height = `${Math.ceil(respDevicesWrap.offsetHeight * respZoom)}px`;
  }

  // Zooms so every device fits the stage's width, in the zoom buttons' 5% steps, at most 100%.
  function fitRespZoom() {
    if (!respBody || !respDevicesWrap) return;
    respZoomAuto = true;
    const cs = getComputedStyle(respBody);
    const available = respBody.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
    const needed = respDevicesWrap.offsetWidth;
    if (!(available > 0) || !(needed > 0)) return;
    applyRespZoom(Math.max(0.25, Math.min(1, Math.floor((available / needed) * 20) / 20)));
  }

  function reloadAllDevices() {
    respDevices.forEach(d => {
      if (d.iframe) {
        try {
          d.iframe.contentWindow.location.reload();
        } catch (_) {
          d.iframe.src = d.iframe.src;
        }
      }
    });
  }

  function navigateAllDevices(url) {
    respDevices.forEach(d => {
      if (d.iframe) {
        d.iframe.src = url;
      }
    });
  }

  const RESP_TABS = [['phone', 'Phones'], ['tablet', 'Tablets'], ['desktop', 'Desktop']];
  // the kind of each group in RESP_DEVICE_GROUPS, in order
  const RESP_GROUP_KINDS = ['phone', 'phone', 'phone', 'phone', 'tablet', 'tablet', 'desktop'];
  let respAddTab = 'phone';

  // What a screen is, for its icon: known from the list it was picked from, else guessed from its
  // name and then its size (turning it sideways never changes it)
  function respGuessKind(name, width, height) {
    if (/iphone|galaxy s|pixel|android|phone/i.test(name)) return 'phone';
    if (/ipad|tab/i.test(name)) return 'tablet';
    if (/laptop/i.test(name)) return 'laptop';
    if (/desktop|full hd|monitor/i.test(name)) return 'desktop';
    if (Math.min(width, height) < 500) return 'phone';
    return Math.max(width, height) < 1100 ? 'tablet' : 'desktop';
  }

  function respKindIcon(dev) {
    const kind = /laptop/i.test(dev.name) ? 'laptop' : (dev.kind || respGuessKind(dev.name, dev.width, dev.height));
    return { phone: 'smartphone', tablet: 'tablet', laptop: 'laptop', desktop: 'monitor' }[kind] || 'monitor';
  }

  // Closes the Add device panel; says whether it was open
  function closeRespAddMenu() {
    const menu = respStage && respStage.querySelector('#sr-resp-add-menu');
    if (!menu || menu.style.display !== 'block') return false;
    menu.style.display = 'none';
    const btn = respStage.querySelector('#sr-resp-add-btn');
    if (btn) btn.classList.remove('sr-active');
    return true;
  }

  // The Add device panel: search, three tabs, the list, and a size of your own
  function renderAddDeviceMenu(menu) {
    const list = [];
    RESP_DEVICE_GROUPS.forEach((group, gi) => {
      group.devices.forEach(d => list.push({ ...d, kind: RESP_GROUP_KINDS[gi] || 'desktop' }));
    });
    const rows = list.map((d, i) => `
      <button class="sr-resp-row" type="button" data-i="${i}" data-kind="${d.kind}" data-name="${escapeHTML(d.name.toLowerCase())}">
        ${icon(respKindIcon(d))}<span class="sr-resp-row-name">${escapeHTML(d.name)}</span><span class="sr-resp-row-size">${d.width} &times; ${d.height}</span>
      </button>`).join('');
    const tabs = RESP_TABS.map(t => `<button type="button" class="sr-resp-tab" data-tab="${t[0]}">${t[1]}</button>`).join('');
    setHTML(menu, `
      <div class="sr-resp-search">${icon('search')}<input type="text" id="sr-resp-search" placeholder="Search devices" spellcheck="false" autocomplete="off"></div>
      <div class="sr-resp-tabs">${tabs}</div>
      <div class="sr-resp-pop-list">${rows}<div class="sr-resp-empty" style="display:none;">No device matches</div></div>
      <div class="sr-resp-custom">
        <span>Custom size</span>
        <input type="number" id="sr-resp-cw" value="375" min="200" max="3840" aria-label="Width">
        <span>&times;</span>
        <input type="number" id="sr-resp-ch" value="667" min="200" max="3840" aria-label="Height">
        <button type="button" class="sr-resp-go" id="sr-resp-custom-add">Add</button>
      </div>
    `);

    const search = menu.querySelector('#sr-resp-search');
    const apply = () => {
      const q = search.value.trim().toLowerCase();
      let shown = 0;
      menu.querySelectorAll('.sr-resp-row').forEach(row => {
        const hit = q ? row.getAttribute('data-name').includes(q) : row.getAttribute('data-kind') === respAddTab;
        row.style.display = hit ? '' : 'none';
        if (hit) shown++;
      });
      menu.querySelector('.sr-resp-empty').style.display = shown ? 'none' : 'block';
      menu.querySelectorAll('.sr-resp-tab').forEach(tab => {
        tab.classList.toggle('sr-on', !q && tab.getAttribute('data-tab') === respAddTab);
      });
    };
    search.addEventListener('input', apply);
    menu.querySelectorAll('.sr-resp-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        respAddTab = tab.getAttribute('data-tab');
        search.value = '';
        apply();
      });
    });
    menu.querySelectorAll('.sr-resp-row').forEach(row => {
      row.addEventListener('click', () => {
        const d = list[parseInt(row.getAttribute('data-i'), 10)];
        closeRespAddMenu();
        addDeviceToStage({ name: d.name, width: d.width, height: d.height, kind: d.kind, rulers: false });
      });
    });
    const cw = menu.querySelector('#sr-resp-cw');
    const ch = menu.querySelector('#sr-resp-ch');
    const addCustom = () => {
      const w = parseInt(cw.value, 10);
      const h = parseInt(ch.value, 10);
      const ok = v => v >= 200 && v <= 3840;
      cw.classList.toggle('sr-bad', !ok(w));
      ch.classList.toggle('sr-bad', !ok(h));
      if (!ok(w) || !ok(h)) return;
      closeRespAddMenu();
      addDeviceToStage({ name: 'Custom', width: w, height: h, rulers: false });
    };
    menu.querySelector('#sr-resp-custom-add').addEventListener('click', addCustom);
    [cw, ch].forEach(input => input.addEventListener('keydown', e => { if (e.key === 'Enter') addCustom(); }));
    apply();
    requestAnimationFrame(() => search.focus());
  }

  // Taking a screen away asks first
  let respPendingRemove = null;

  function respConfirmOpen() {
    const box = respStage && respStage.querySelector('#sr-resp-confirm');
    return !!(box && box.classList.contains('sr-show'));
  }

  // Closes the question; says whether it was open
  function closeRespConfirm() {
    const was = respConfirmOpen();
    respPendingRemove = null;
    const box = respStage && respStage.querySelector('#sr-resp-confirm');
    if (box) box.classList.remove('sr-show');
    return was;
  }

  function askRemoveDevice(dev) {
    const box = respStage.querySelector('#sr-resp-confirm');
    if (!box) return;
    closeRespAddMenu();
    respPendingRemove = dev;
    respStage.querySelector('#sr-resp-confirm-title').textContent = `Remove ${dev.name}?`;
    respStage.querySelector('#sr-resp-confirm-text').textContent = `${dev.name} (${dev.width} \u00d7 ${dev.height}) will be taken off this view. You can add it again with Add device.`;
    box.classList.add('sr-show');
    respStage.querySelector('#sr-resp-confirm-remove').focus();
  }

  function confirmRemoveDevice() {
    const dev = respPendingRemove;
    closeRespConfirm();
    if (dev) removeDevice(dev);
  }

  function removeDevice(dev) {
    if (dev.iframe) dev.iframe.src = 'about:blank';
    if (dev.card) dev.card.remove();
    respDevices = respDevices.filter(d => d.id !== dev.id);
  }

  function setDeviceTitle(dev) {
    if (!dev.titleEl) return;
    setHTML(dev.titleEl, `<b>${escapeHTML(dev.name)}</b><span class="sr-resp-dev-size">${dev.width} &times; ${dev.height}</span>`);
  }

  function rotateDevice(dev) {
    const tmp = dev.width;
    dev.width = dev.height;
    dev.height = tmp;
    dev.isLandscape = !dev.isLandscape;
    dev.screen.style.width = `${dev.width}px`;
    dev.screen.style.height = `${dev.height}px`;
    setDeviceTitle(dev);
    if (dev.rulers) renderDeviceRulers(dev);
  }

  // The preview follows the system's light or dark setting, like any page opened on its own.

  function addDeviceToStage(preset) {
    const id = 'resp-dev-' + (respIdCounter++);
    const dev = {
      id,
      name: preset.name,
      width: preset.width,
      height: preset.height,
      rulers: !!preset.rulers,
      isLandscape: !!preset.isLandscape,
      kind: preset.kind || respGuessKind(preset.name, preset.width, preset.height),
    };

    const card = document.createElement('div');
    card.className = 'sr-resp-device';
    card.id = id;

    const currentUrl = (respUrlInput && respUrlInput.value) ? respUrlInput.value : window.location.href;

    setHTML(card, `
      <div class="sr-resp-device-header">
        <span class="sr-resp-dev-ico">${icon(respKindIcon(dev))}</span>
        <span class="sr-resp-dev-title"><b>${escapeHTML(dev.name)}</b><span class="sr-resp-dev-size">${dev.width} &times; ${dev.height}</span></span>
        <span class="sr-resp-dev-actions">
          <button type="button" class="sr-resp-dev-btn" data-action="rotate" title="Rotate">${icon('rotate')}</button>
          <button type="button" class="sr-resp-dev-btn sr-danger" data-action="remove" title="Remove this screen">${icon('x')}</button>
        </span>
      </div>
      <div class="sr-resp-device-screen" style="width:${dev.width}px; height:${dev.height}px;">
        <canvas class="sr-resp-ruler-h" style="display:${dev.rulers ? 'block' : 'none'};"></canvas>
        <canvas class="sr-resp-ruler-v" style="display:${dev.rulers ? 'block' : 'none'};"></canvas>
        <iframe class="sr-resp-iframe" src="${escapeHTML(currentUrl)}" sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads allow-pointer-lock" style="${dev.rulers ? 'padding-top:18px; padding-left:18px;' : ''}"></iframe>
        <!-- Resize Handles -->
        <div class="sr-resp-resize-r"></div>
        <div class="sr-resp-resize-b"></div>
        <div class="sr-resp-resize-se"></div>
      </div>
      <div class="sr-resp-dev-footer" style="display:none;">
        <span class="sr-resp-overflow-warn">
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          Content overflows horizontally
        </span>
      </div>
    `);

    respDevicesWrap.appendChild(card);

    const screen = card.querySelector('.sr-resp-device-screen');
    const iframe = card.querySelector('.sr-resp-iframe');
    const rulerH = card.querySelector('.sr-resp-ruler-h');
    const rulerV = card.querySelector('.sr-resp-ruler-v');
    const titleEl = card.querySelector('.sr-resp-dev-title');

    dev.card = card;
    dev.screen = screen;
    dev.iframe = iframe;
    dev.rulerH = rulerH;
    dev.rulerV = rulerV;
    dev.titleEl = titleEl;

    respDevices.push(dev);

    // Initial ruler render
    if (dev.rulers) {
      renderDeviceRulers(dev);
    }

    // Check horizontal content overflow on load & wire iframe inspection
    iframe.addEventListener('load', () => {
      try {
        const doc = iframe.contentDocument;
        if (doc && doc.documentElement) {
          const sw = doc.documentElement.scrollWidth;
          const footer = card.querySelector('.sr-resp-dev-footer');
          if (footer) {
            footer.style.display = sw > dev.width + 5 ? 'block' : 'none';
          }
        }
      } catch (_) {}
      wireIframeInspection(dev);
    });

    wireIframeInspection(dev);

    // The two actions on the screen's header
    card.querySelector('[data-action="rotate"]').addEventListener('click', e => {
      e.stopPropagation();
      rotateDevice(dev);
    });
    card.querySelector('[data-action="remove"]').addEventListener('click', e => {
      e.stopPropagation();
      askRemoveDevice(dev);
    });

    // Wire Drag to Resize
    wireDeviceResize(card, dev);

    // Wire Scroll Synchronization
    wireIframeScrollSync(iframe);
  }

  function wireIframeInspection(dev) {
    const iframe = dev.iframe;
    if (!iframe) return;

    try {
      const doc = iframe.contentDocument;
      if (!doc || !doc.body) return;
      if (doc._sr_wired) return;
      doc._sr_wired = true;

      // 1. Inject Stylesheet into iframe if not already present
      if (!doc.getElementById('sr-if-styles')) {
        const style = doc.createElement('style');
        style.id = 'sr-if-styles';
        style.textContent = `
          #sr-if-bm-wrap, #sr-if-dist-wrap {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            pointer-events: none;
            z-index: 2147483640;
          }
          #sr-if-bm-content {
            position: absolute;
            pointer-events: none;
            background: rgba(111, 168, 220, 0.42);
            box-sizing: border-box;
            outline: 1px solid rgba(75, 140, 205, 0.5);
            z-index: 2147483641;
            display: none;
          }
          .sr-if-bm-pad {
            position: absolute;
            pointer-events: none;
            background: rgba(147, 196, 125, 0.45);
            display: none;
            align-items: center;
            justify-content: center;
            box-sizing: border-box;
            overflow: hidden;
            z-index: 2147483642;
          }
          .sr-if-bm-mar {
            position: absolute;
            pointer-events: none;
            background: rgba(246, 178, 107, 0.42);
            display: none;
            align-items: center;
            justify-content: center;
            box-sizing: border-box;
            overflow: hidden;
            z-index: 2147483641;
          }
          #sr-if-bm-border {
            position: absolute;
            pointer-events: none;
            border: 1px dashed rgba(255, 215, 0, 0.75);
            box-sizing: border-box;
            z-index: 2147483643;
            display: none;
          }
          .sr-if-bm-num {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            font-size: 10.5px;
            font-weight: 600;
            line-height: 1;
            padding: 1px 2px;
            user-select: none;
          }
          .sr-if-bm-pad .sr-if-bm-num { color: #1f2937; }
          .sr-if-bm-mar .sr-if-bm-num { color: #7c2d12; }
          #sr-if-bm-banner {
            position: absolute;
            pointer-events: none;
            background: #0969da;
            color: #ffffff;
            border-radius: 3px;
            padding: 3px 8px;
            display: none;
            align-items: center;
            justify-content: space-between;
            gap: 10px;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, monospace;
            font-size: 11px;
            font-weight: 600;
            box-shadow: 0 2px 8px rgba(0,0,0,0.3);
            white-space: nowrap;
            overflow: hidden;
            box-sizing: border-box;
            z-index: 2147483644;
          }
          .sr-if-bm-sel { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
          .sr-if-bm-dim { flex-shrink: 0; }
          /* Distance Measurement */
          #sr-if-dist-selected {
            position: absolute;
            pointer-events: none;
            border: 1.5px solid #0969da;
            background: rgba(9, 105, 218, 0.08);
            box-sizing: border-box;
            z-index: 2147483645;
            display: none;
          }
          #sr-if-dist-hovered {
            position: absolute;
            pointer-events: none;
            border: 1.5px solid #ef4444;
            background: repeating-linear-gradient(
              45deg,
              rgba(239, 68, 68, 0.08),
              rgba(239, 68, 68, 0.08) 6px,
              transparent 6px,
              transparent 12px
            );
            box-sizing: border-box;
            z-index: 2147483645;
            display: none;
          }
          .sr-if-dist-line {
            position: absolute;
            pointer-events: none;
            background: #0969da;
            z-index: 2147483646;
          }
          .sr-if-dist-line-h { height: 1.5px; }
          .sr-if-dist-line-v { width: 1.5px; }
          .sr-if-dist-badge {
            position: absolute;
            pointer-events: none;
            background: #0969da;
            color: #ffffff;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, monospace;
            font-size: 10.5px;
            font-weight: 700;
            padding: 1px 4px;
            border-radius: 3px;
            transform: translate(-50%, -50%);
            z-index: 2147483647;
            white-space: nowrap;
            box-shadow: 0 1px 4px rgba(0,0,0,0.35);
          }
          /* Pinned Overlays inside Device */
          .sr-pinned-overlay {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            pointer-events: none;
            z-index: 2147483643;
          }
          .sr-pinned-bm-banner {
            position: absolute;
            pointer-events: none;
            z-index: 2147483644;
            background: #0969da;
            color: #ffffff;
            border-radius: 3px 3px 0 0;
            padding: 3px 8px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            box-sizing: border-box;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, monospace;
            font-size: 11px;
            line-height: 1.3;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
            white-space: nowrap;
            overflow: hidden;
          }
          .sr-pinned-bm-selector {
            font-weight: 600;
            color: #ffffff;
            min-width: 0;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }
          .sr-pinned-bm-dimensions {
            font-weight: 500;
            color: rgba(255, 255, 255, 0.92);
            flex-shrink: 0;
          }
          .sr-pinned-bm-content {
            position: absolute;
            pointer-events: none;
            z-index: 2147483642;
            background: rgba(111, 168, 220, 0.38);
            box-sizing: border-box;
            outline: 1.5px solid rgba(9, 105, 218, 0.75);
            border-radius: 2px;
          }
        `;
        (doc.head || doc.documentElement).appendChild(style);
      }

      // 2. Ensure DOM Overlay Wrappers exist inside doc
      let bmWrap = doc.getElementById('sr-if-bm-wrap');
      if (!bmWrap) {
        bmWrap = doc.createElement('div');
        bmWrap.id = 'sr-if-bm-wrap';
        bmWrap.innerHTML = `
          <div id="sr-if-bm-banner">
            <span class="sr-if-bm-sel"></span>
            <span class="sr-if-bm-dim"></span>
          </div>
          <div id="sr-if-bm-content"></div>
          <div class="sr-if-bm-pad" id="sr-if-pad-t"><span class="sr-if-bm-num"></span></div>
          <div class="sr-if-bm-pad" id="sr-if-pad-r"><span class="sr-if-bm-num"></span></div>
          <div class="sr-if-bm-pad" id="sr-if-pad-b"><span class="sr-if-bm-num"></span></div>
          <div class="sr-if-bm-pad" id="sr-if-pad-l"><span class="sr-if-bm-num"></span></div>
          <div class="sr-if-bm-mar" id="sr-if-mar-t"><span class="sr-if-bm-num"></span></div>
          <div class="sr-if-bm-mar" id="sr-if-mar-r"><span class="sr-if-bm-num"></span></div>
          <div class="sr-if-bm-mar" id="sr-if-mar-b"><span class="sr-if-bm-num"></span></div>
          <div class="sr-if-bm-mar" id="sr-if-mar-l"><span class="sr-if-bm-num"></span></div>
          <div id="sr-if-bm-border"></div>
        `;
        doc.documentElement.appendChild(bmWrap);
      }

      let distWrap = doc.getElementById('sr-if-dist-wrap');
      if (!distWrap) {
        distWrap = doc.createElement('div');
        distWrap.id = 'sr-if-dist-wrap';
        distWrap.innerHTML = `
          <div id="sr-if-dist-selected"></div>
          <div id="sr-if-dist-hovered"></div>
          <div id="sr-if-dist-lines"></div>
        `;
        doc.documentElement.appendChild(distWrap);
      }

      // A strict CSP in the previewed page blocks that <style> element in Firefox. Constructed
      // stylesheets aren't subject to CSP, so adopt one instead when the styles didn't apply.
      if (doc.defaultView && doc.defaultView.getComputedStyle(bmWrap).position !== 'absolute') {
        try {
          const styleEl = doc.getElementById('sr-if-styles');
          const sheet = new doc.defaultView.CSSStyleSheet();
          sheet.replaceSync(styleEl ? styleEl.textContent : '');
          doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, sheet];
        } catch (_) {}
      }

      const ifBanner = bmWrap.querySelector('#sr-if-bm-banner');
      const ifSel = bmWrap.querySelector('.sr-if-bm-sel');
      const ifDim = bmWrap.querySelector('.sr-if-bm-dim');
      const ifContent = bmWrap.querySelector('#sr-if-bm-content');
      const ifBorder = bmWrap.querySelector('#sr-if-bm-border');
      const ifPadT = bmWrap.querySelector('#sr-if-pad-t');
      const ifPadR = bmWrap.querySelector('#sr-if-pad-r');
      const ifPadB = bmWrap.querySelector('#sr-if-pad-b');
      const ifPadL = bmWrap.querySelector('#sr-if-pad-l');
      const ifMarT = bmWrap.querySelector('#sr-if-mar-t');
      const ifMarR = bmWrap.querySelector('#sr-if-mar-r');
      const ifMarB = bmWrap.querySelector('#sr-if-mar-b');
      const ifMarL = bmWrap.querySelector('#sr-if-mar-l');

      const ifDistSelected = distWrap.querySelector('#sr-if-dist-selected');
      const ifDistHovered = distWrap.querySelector('#sr-if-dist-hovered');
      const ifDistLines = distWrap.querySelector('#sr-if-dist-lines');

      function hideBmOverlay() {
        ifBanner.style.display = 'none';
        ifContent.style.display = 'none';
        ifBorder.style.display = 'none';
        ifPadT.style.display = 'none';
        ifPadR.style.display = 'none';
        ifPadB.style.display = 'none';
        ifPadL.style.display = 'none';
        ifMarT.style.display = 'none';
        ifMarR.style.display = 'none';
        ifMarB.style.display = 'none';
        ifMarL.style.display = 'none';
      }

      function hideDistOverlay() {
        ifDistHovered.style.display = 'none';
        ifDistLines.innerHTML = '';
      }

      function renderIframeBoxModel(target, rect, cs, sX, sY) {
        const W = round1(rect.width);
        const H = round1(rect.height);

        const mt = parseFloat(cs.marginTop) || 0;
        const mr = parseFloat(cs.marginRight) || 0;
        const mb = parseFloat(cs.marginBottom) || 0;
        const ml = parseFloat(cs.marginLeft) || 0;
        const bt = parseFloat(cs.borderTopWidth) || 0;
        const br = parseFloat(cs.borderRightWidth) || 0;
        const bb = parseFloat(cs.borderBottomWidth) || 0;
        const bl = parseFloat(cs.borderLeftWidth) || 0;
        const pt = parseFloat(cs.paddingTop) || 0;
        const pr = parseFloat(cs.paddingRight) || 0;
        const pb = parseFloat(cs.paddingBottom) || 0;
        const pl = parseFloat(cs.paddingLeft) || 0;

        const top = rect.top + sY;
        const left = rect.left + sX;
        const right = rect.right + sX;
        const bottom = rect.bottom + sY;

        // Banner
        ifSel.textContent = selector(target);
        ifDim.textContent = `${W} × ${H}`;
        let bTop = top - 24;
        if (bTop < 0) bTop = bottom;
        // Keep the banner inside the device screen; a long selector ends in an ellipsis
        const winW = doc.defaultView ? doc.defaultView.innerWidth : dev.width;
        const bLeft = Math.max(sX + 4, Math.min(sX + winW - 160, left));
        const maxW = Math.max(120, sX + winW - bLeft - 4);
        ifBanner.style.display = 'flex';
        ifBanner.style.top = `${bTop}px`;
        ifBanner.style.left = `${bLeft}px`;
        ifBanner.style.maxWidth = `${maxW}px`;
        ifBanner.style.minWidth = `${Math.min(Math.max(rect.width, 140), maxW)}px`;

        // Content
        const cW = rect.width - bl - br - pl - pr;
        const cH = rect.height - bt - bb - pt - pb;
        if (cW > 0 && cH > 0) {
          ifContent.style.display = 'block';
          ifContent.style.top = `${top + bt + pt}px`;
          ifContent.style.left = `${left + bl + pl}px`;
          ifContent.style.width = `${cW}px`;
          ifContent.style.height = `${cH}px`;
        } else {
          ifContent.style.display = 'none';
        }

        // Padding
        if (pt > 0) {
          ifPadT.style.display = 'flex';
          ifPadT.style.top = `${top + bt}px`;
          ifPadT.style.left = `${left + bl}px`;
          ifPadT.style.width = `${rect.width - bl - br}px`;
          ifPadT.style.height = `${pt}px`;
          ifPadT.querySelector('.sr-if-bm-num').textContent = round1(pt);
        } else ifPadT.style.display = 'none';

        if (pb > 0) {
          ifPadB.style.display = 'flex';
          ifPadB.style.top = `${bottom - bb - pb}px`;
          ifPadB.style.left = `${left + bl}px`;
          ifPadB.style.width = `${rect.width - bl - br}px`;
          ifPadB.style.height = `${pb}px`;
          ifPadB.querySelector('.sr-if-bm-num').textContent = round1(pb);
        } else ifPadB.style.display = 'none';

        const padMidH = rect.height - bt - bb - pt - pb;
        if (pl > 0 && padMidH > 0) {
          ifPadL.style.display = 'flex';
          ifPadL.style.top = `${top + bt + pt}px`;
          ifPadL.style.left = `${left + bl}px`;
          ifPadL.style.width = `${pl}px`;
          ifPadL.style.height = `${padMidH}px`;
          ifPadL.querySelector('.sr-if-bm-num').textContent = round1(pl);
        } else ifPadL.style.display = 'none';

        if (pr > 0 && padMidH > 0) {
          ifPadR.style.display = 'flex';
          ifPadR.style.top = `${top + bt + pt}px`;
          ifPadR.style.left = `${right - br - pr}px`;
          ifPadR.style.width = `${pr}px`;
          ifPadR.style.height = `${padMidH}px`;
          ifPadR.querySelector('.sr-if-bm-num').textContent = round1(pr);
        } else ifPadR.style.display = 'none';

        // Border
        if (bt > 0 || br > 0 || bb > 0 || bl > 0) {
          ifBorder.style.display = 'block';
          ifBorder.style.top = `${top}px`;
          ifBorder.style.left = `${left}px`;
          ifBorder.style.width = `${rect.width}px`;
          ifBorder.style.height = `${rect.height}px`;
        } else ifBorder.style.display = 'none';

        // Margins
        if (mt > 0) {
          ifMarT.style.display = 'flex';
          ifMarT.style.top = `${top - mt}px`;
          ifMarT.style.left = `${left - ml}px`;
          ifMarT.style.width = `${rect.width + ml + mr}px`;
          ifMarT.style.height = `${mt}px`;
          ifMarT.querySelector('.sr-if-bm-num').textContent = round1(mt);
        } else ifMarT.style.display = 'none';

        if (mb > 0) {
          ifMarB.style.display = 'flex';
          ifMarB.style.top = `${bottom}px`;
          ifMarB.style.left = `${left - ml}px`;
          ifMarB.style.width = `${rect.width + ml + mr}px`;
          ifMarB.style.height = `${mb}px`;
          ifMarB.querySelector('.sr-if-bm-num').textContent = round1(mb);
        } else ifMarB.style.display = 'none';

        if (ml > 0) {
          ifMarL.style.display = 'flex';
          ifMarL.style.top = `${top}px`;
          ifMarL.style.left = `${left - ml}px`;
          ifMarL.style.width = `${ml}px`;
          ifMarL.style.height = `${rect.height}px`;
          ifMarL.querySelector('.sr-if-bm-num').textContent = round1(ml);
        } else ifMarL.style.display = 'none';

        if (mr > 0) {
          ifMarR.style.display = 'flex';
          ifMarR.style.top = `${top}px`;
          ifMarR.style.left = `${right}px`;
          ifMarR.style.width = `${mr}px`;
          ifMarR.style.height = `${rect.height}px`;
          ifMarR.querySelector('.sr-if-bm-num').textContent = round1(mr);
        } else ifMarR.style.display = 'none';
      }

      function renderIframeDistances(refEl, targetEl, sX, sY) {
        if (!refEl || !targetEl || refEl === targetEl) {
          hideDistOverlay();
          return;
        }
        const rA = refEl.getBoundingClientRect();
        const rB = targetEl.getBoundingClientRect();

        // Show Red Hatched Box on target
        ifDistHovered.style.display = 'block';
        ifDistHovered.style.top = `${rB.top + sY}px`;
        ifDistHovered.style.left = `${rB.left + sX}px`;
        ifDistHovered.style.width = `${rB.width}px`;
        ifDistHovered.style.height = `${rB.height}px`;

        ifDistLines.innerHTML = '';

        function drawHLine(x1, x2, y, val) {
          if (x2 <= x1) return;
          const line = doc.createElement('div');
          line.className = 'sr-if-dist-line sr-if-dist-line-h';
          line.style.left = `${x1 + sX}px`;
          line.style.top = `${y + sY}px`;
          line.style.width = `${x2 - x1}px`;
          const badge = doc.createElement('div');
          badge.className = 'sr-if-dist-badge';
          badge.textContent = `${val}`;
          badge.style.left = `${(x1 + x2) / 2 + sX}px`;
          badge.style.top = `${y + sY}px`;
          ifDistLines.appendChild(line);
          ifDistLines.appendChild(badge);
        }

        function drawVLine(y1, y2, x, val) {
          if (y2 <= y1) return;
          const line = doc.createElement('div');
          line.className = 'sr-if-dist-line sr-if-dist-line-v';
          line.style.left = `${x + sX}px`;
          line.style.top = `${y1 + sY}px`;
          line.style.height = `${y2 - y1}px`;
          const badge = doc.createElement('div');
          badge.className = 'sr-if-dist-badge';
          badge.textContent = `${val}`;
          badge.style.left = `${x + sX}px`;
          badge.style.top = `${(y1 + y2) / 2 + sY}px`;
          ifDistLines.appendChild(line);
          ifDistLines.appendChild(badge);
        }

        const isLeft = rA.right <= rB.left;
        const isRight = rB.right <= rA.left;
        const isAbove = rA.bottom <= rB.top;
        const isBelow = rB.bottom <= rA.top;

        if (isLeft) {
          const gap = Math.round(rB.left - rA.right);
          const oT = Math.max(rA.top, rB.top);
          const oB = Math.min(rA.bottom, rB.bottom);
          const midY = oT < oB ? (oT + oB) / 2 : (rA.top + rA.bottom) / 2;
          drawHLine(rA.right, rB.left, midY, gap);
        } else if (isRight) {
          const gap = Math.round(rA.left - rB.right);
          const oT = Math.max(rA.top, rB.top);
          const oB = Math.min(rA.bottom, rB.bottom);
          const midY = oT < oB ? (oT + oB) / 2 : (rA.top + rA.bottom) / 2;
          drawHLine(rB.right, rA.left, midY, gap);
        }

        if (isAbove) {
          const gap = Math.round(rB.top - rA.bottom);
          const oL = Math.max(rA.left, rB.left);
          const oR = Math.min(rA.right, rB.right);
          const midX = oL < oR ? (oL + oR) / 2 : (rA.left + rA.right) / 2;
          drawVLine(rA.bottom, rB.top, midX, gap);
        } else if (isBelow) {
          const gap = Math.round(rA.top - rB.bottom);
          const oL = Math.max(rA.left, rB.left);
          const oR = Math.min(rA.right, rB.right);
          const midX = oL < oR ? (oL + oR) / 2 : (rA.left + rA.right) / 2;
          drawVLine(rB.bottom, rA.top, midX, gap);
        }

        if (!isLeft && !isRight && !isAbove && !isBelow) {
          const [outer, inner] = nestedPair(rA, rB);
          const topGap = Math.round(inner.top - outer.top);
          const bottomGap = Math.round(outer.bottom - inner.bottom);
          const leftGap = Math.round(inner.left - outer.left);
          const rightGap = Math.round(outer.right - inner.right);
          const midX = (inner.left + inner.right) / 2;
          const midY = (inner.top + inner.bottom) / 2;
          if (topGap > 0) drawVLine(outer.top, inner.top, midX, topGap);
          if (bottomGap > 0) drawVLine(inner.bottom, outer.bottom, midX, bottomGap);
          if (leftGap > 0) drawHLine(outer.left, inner.left, midY, leftGap);
          if (rightGap > 0) drawHLine(inner.right, outer.right, midY, rightGap);
        }
      }

      doc.addEventListener('mousemove', e => {
        if (!S.active || !isResponsiveOpen) {
          hideBmOverlay();
          hideDistOverlay();
          if (panel) panel.classList.remove('sr-on');
          return;
        }

        if (S.isColorPicking) return;
        if (S.paused) return;

        // Update device rulers crosshairs
        if (dev.rulers) {
          const rx = e.clientX + 18;
          const ry = e.clientY + 18;
          renderDeviceRulers(dev, rx, ry);
        }

        const el = doc.elementFromPoint(e.clientX, e.clientY);
        if (!el || el === doc.documentElement || el === doc.body || bmWrap.contains(el) || distWrap.contains(el)) {
          hideBmOverlay();
          hideDistOverlay();
          if (panel) panel.classList.remove('sr-on');
          return;
        }

        dev.curEl = el;
        S.curEl = el;
        const rect = el.getBoundingClientRect();
        const sX = doc.defaultView ? doc.defaultView.scrollX : 0;
        const sY = doc.defaultView ? doc.defaultView.scrollY : 0;
        const win = doc.defaultView || window;
        const cs = win.getComputedStyle(el);

        if (S.mode === 'inspect') {
          hideDistOverlay();
          renderIframeBoxModel(el, rect, cs, sX, sY);

          // Update floating property panel
          inspect(el);
          if (panel) {
            panel.style.display = '';
            panel.classList.add('sr-on');
            const ifRect = iframe.getBoundingClientRect();
            const z = respZoom || 1;
            const px = ifRect.left + (e.clientX * z);
            const py = ifRect.top + (e.clientY * z);
            positionPanel(px, py);
          }
        } else if (S.mode === 'measure') {
          hideBmOverlay();
          if (panel) {
            panel.classList.remove('sr-on');
            panel.style.display = 'none';
          }
          if (dev.selectedEl) {
            renderIframeDistances(dev.selectedEl, el, sX, sY);
          } else {
            // Preview element bounds in measure mode
            ifDistHovered.style.display = 'none';
            ifDistLines.innerHTML = '';
            ifDistSelected.style.display = 'block';
            ifDistSelected.style.top = `${rect.top + sY}px`;
            ifDistSelected.style.left = `${rect.left + sX}px`;
            ifDistSelected.style.width = `${rect.width}px`;
            ifDistSelected.style.height = `${rect.height}px`;
          }
        }
      }, { passive: true });

      if (doc.defaultView) {
        doc.defaultView.addEventListener('scroll', updateAllPinnedPositions, { capture: true, passive: true });
      }

      doc.addEventListener('mouseleave', () => {
        hideBmOverlay();
        hideDistOverlay();
        if (panel) panel.classList.remove('sr-on');
        if (dev.rulers) {
          renderDeviceRulers(dev);
        }
      });

      doc.addEventListener('click', e => {
        if (!S.active || !isResponsiveOpen || S.paused || S.isColorPicking) return;
        const el = doc.elementFromPoint(e.clientX, e.clientY);
        if (!el || el === doc.documentElement || el === doc.body || bmWrap.contains(el) || distWrap.contains(el)) {
          if (S.mode === 'measure') {
            dev.selectedEl = null;
            ifDistSelected.style.display = 'none';
            hideDistOverlay();
          }
          return;
        }

        e.preventDefault();
        e.stopPropagation();

        if (S.mode === 'inspect') {
          pinCard(el);
        } else if (S.mode === 'measure') {
          dev.selectedEl = el;
          const rect = el.getBoundingClientRect();
          const sX = doc.defaultView ? doc.defaultView.scrollX : 0;
          const sY = doc.defaultView ? doc.defaultView.scrollY : 0;
          ifDistSelected.style.display = 'block';
          ifDistSelected.style.top = `${rect.top + sY}px`;
          ifDistSelected.style.left = `${rect.left + sX}px`;
          ifDistSelected.style.width = `${rect.width}px`;
          ifDistSelected.style.height = `${rect.height}px`;
          hideDistOverlay();
        }
      }, true);

      doc.addEventListener('keydown', e => {
        if (!S.active || !isResponsiveOpen) return;
        if (isTypingTarget(e.target) && e.code !== 'Escape') return;
        const plainKey = !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey;
        if (e.code === 'Space' && plainKey && S.mode === 'inspect' && dev.curEl) {
          e.preventDefault();
          pinCard(dev.curEl);
        } else if (e.code === 'ArrowUp' && !e.metaKey && !e.ctrlKey && dev.curEl) {
          e.preventDefault();
          const parent = dev.curEl.parentElement;
          if (parent && parent !== doc.documentElement && parent !== doc.body) {
            dev.curEl = parent;
            S.curEl = parent;
            if (S.mode === 'inspect') {
              const r = parent.getBoundingClientRect();
              const sX = doc.defaultView ? doc.defaultView.scrollX : 0;
              const sY = doc.defaultView ? doc.defaultView.scrollY : 0;
              const cs = (doc.defaultView || window).getComputedStyle(parent);
              renderIframeBoxModel(parent, r, cs, sX, sY);
              inspect(parent);
            } else if (S.mode === 'measure') {
              dev.selectedEl = parent;
              const r = parent.getBoundingClientRect();
              const sX = doc.defaultView ? doc.defaultView.scrollX : 0;
              const sY = doc.defaultView ? doc.defaultView.scrollY : 0;
              ifDistSelected.style.display = 'block';
              ifDistSelected.style.top = `${r.top + sY}px`;
              ifDistSelected.style.left = `${r.left + sX}px`;
              ifDistSelected.style.width = `${r.width}px`;
              ifDistSelected.style.height = `${r.height}px`;
              hideDistOverlay();
            }
          }
        } else if (e.code === 'ArrowDown' && !e.metaKey && !e.ctrlKey && dev.curEl) {
          e.preventDefault();
          const child = dev.curEl.firstElementChild;
          if (child && !bmWrap.contains(child) && !distWrap.contains(child)) {
            dev.curEl = child;
            S.curEl = child;
            if (S.mode === 'inspect') {
              const r = child.getBoundingClientRect();
              const sX = doc.defaultView ? doc.defaultView.scrollX : 0;
              const sY = doc.defaultView ? doc.defaultView.scrollY : 0;
              const cs = (doc.defaultView || window).getComputedStyle(child);
              renderIframeBoxModel(child, r, cs, sX, sY);
              inspect(child);
            } else if (S.mode === 'measure') {
              dev.selectedEl = child;
              const r = child.getBoundingClientRect();
              const sX = doc.defaultView ? doc.defaultView.scrollX : 0;
              const sY = doc.defaultView ? doc.defaultView.scrollY : 0;
              ifDistSelected.style.display = 'block';
              ifDistSelected.style.top = `${r.top + sY}px`;
              ifDistSelected.style.left = `${r.left + sX}px`;
              ifDistSelected.style.width = `${r.width}px`;
              ifDistSelected.style.height = `${r.height}px`;
              hideDistOverlay();
            }
          }
        } else if (e.code === 'Escape') {
          if (S.mode === 'measure' && dev.selectedEl) {
            e.preventDefault();
            dev.selectedEl = null;
            ifDistSelected.style.display = 'none';
            hideDistOverlay();
          } else if (S.mode === 'inspect' && pinnedCards.length > 0) {
            e.preventDefault();
            const last = pinnedCards.pop();
            if (last) {
              if (last.overlayNode && last.overlayNode.parentNode) last.overlayNode.parentNode.removeChild(last.overlayNode);
              if (last.cardNode && last.cardNode.parentNode) last.cardNode.parentNode.removeChild(last.cardNode);
            }
          } else {
            e.preventDefault();
            closeResponsiveStage();
          }
        } else if (keyIs(e, 'KeyR') && !isTypingTarget(e.target)) {
          e.preventDefault();
          closeResponsiveStage();
        } else if (keyIs(e, 'KeyP') && !isTypingTarget(e.target)) {
          e.preventDefault();
          togglePause();
        } else if (keyIs(e, 'KeyH') && !isTypingTarget(e.target)) {
          e.preventDefault();
          toggleDock();
        } else if (['Digit1', 'Numpad1'].includes(e.code) || ['KeyM', 'KeyD', 'KeyC', 'KeyO'].some(code => keyIs(e, code))) {
          // the rest of the toolkit's keys (inspect, measure, colors, side panel) are answered by the same handler
          onKeyDown(e);
        }
      }, true);

    } catch (_) {}
  }

  function renderDeviceRulers(dev, curX, curY) {
    if (!dev.rulerH || !dev.rulerV) return;
    const dpr = window.devicePixelRatio || 1;
    const w = dev.width;
    const h = dev.height;

    // Horizontal Ruler
    dev.rulerH.width = w * dpr;
    dev.rulerH.height = 18 * dpr;
    const ctxH = dev.rulerH.getContext('2d');
    ctxH.scale(dpr, dpr);
    ctxH.fillStyle = '#141418';
    ctxH.fillRect(0, 0, w, 18);
    ctxH.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctxH.lineWidth = 1;
    ctxH.fillStyle = 'rgba(255, 255, 255, 0.6)';
    ctxH.font = '9px monospace';

    for (let x = 0; x <= w; x += 10) {
      const is100 = x % 100 === 0;
      const is50 = x % 50 === 0;
      const tickH = is100 ? 10 : (is50 ? 6 : 4);
      ctxH.beginPath();
      ctxH.moveTo(x, 18 - tickH);
      ctxH.lineTo(x, 18);
      ctxH.stroke();

      if (is100 && x > 0 && x < w - 20) {
        ctxH.fillText(x.toString(), x + 2, 10);
      }
    }

    // Red cursor crosshair line on horizontal ruler
    if (typeof curX === 'number' && curX >= 0 && curX <= w) {
      ctxH.strokeStyle = '#ef4444';
      ctxH.lineWidth = 1.5;
      ctxH.beginPath();
      ctxH.moveTo(curX, 0);
      ctxH.lineTo(curX, 18);
      ctxH.stroke();
    }

    // Vertical Ruler
    dev.rulerV.width = 18 * dpr;
    dev.rulerV.height = h * dpr;
    const ctxV = dev.rulerV.getContext('2d');
    ctxV.scale(dpr, dpr);
    ctxV.fillStyle = '#141418';
    ctxV.fillRect(0, 0, 18, h);
    ctxV.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctxV.lineWidth = 1;
    ctxV.fillStyle = 'rgba(255, 255, 255, 0.6)';
    ctxV.font = '9px monospace';

    for (let y = 0; y <= h; y += 10) {
      const is100 = y % 100 === 0;
      const is50 = y % 50 === 0;
      const tickW = is100 ? 10 : (is50 ? 6 : 4);
      ctxV.beginPath();
      ctxV.moveTo(18 - tickW, y);
      ctxV.lineTo(18, y);
      ctxV.stroke();

      if (is100 && y > 0 && y < h - 15) {
        ctxV.save();
        ctxV.translate(11, y + 2);
        ctxV.rotate(Math.PI / 2);
        ctxV.fillText(y.toString(), 0, 0);
        ctxV.restore();
      }
    }

    // Red cursor crosshair line on vertical ruler
    if (typeof curY === 'number' && curY >= 0 && curY <= h) {
      ctxV.strokeStyle = '#ef4444';
      ctxV.lineWidth = 1.5;
      ctxV.beginPath();
      ctxV.moveTo(0, curY);
      ctxV.lineTo(18, curY);
      ctxV.stroke();
    }
  }

  function wireDeviceResize(card, dev) {
    const handleR = card.querySelector('.sr-resp-resize-r');
    const handleB = card.querySelector('.sr-resp-resize-b');
    const handleSE = card.querySelector('.sr-resp-resize-se');

    function onResizeStart(e, resizeX, resizeY) {
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const startY = e.clientY;
      const startW = dev.width;
      const startH = dev.height;

      // while the edge is held the previews let the pointer through, so a drag can cross them and end over them
      if (respStage) respStage.classList.add('sr-resp-dragging');

      function onMouseMove(moveEvent) {
        if (moveEvent.buttons === 0) { onMouseUp(); return; } // the button was let go somewhere we didn't hear about
        if (resizeX) {
          const deltaX = (moveEvent.clientX - startX) / respZoom;
          dev.width = Math.max(240, Math.round(startW + deltaX));
          dev.screen.style.width = `${dev.width}px`;
        }
        if (resizeY) {
          const deltaY = (moveEvent.clientY - startY) / respZoom;
          dev.height = Math.max(300, Math.round(startH + deltaY));
          dev.screen.style.height = `${dev.height}px`;
        }
        if (dev.titleEl) setDeviceTitle(dev);
        if (dev.rulers) renderDeviceRulers(dev);
      }

      function onMouseUp() {
        window.removeEventListener('mousemove', onMouseMove, true);
        window.removeEventListener('mouseup', onMouseUp, true);
        window.removeEventListener('blur', onMouseUp);
        if (respStage) respStage.classList.remove('sr-resp-dragging');
      }

      window.addEventListener('mousemove', onMouseMove, true);
      window.addEventListener('mouseup', onMouseUp, true);
      window.addEventListener('blur', onMouseUp);
    }

    handleR.addEventListener('mousedown', e => onResizeStart(e, true, false));
    handleB.addEventListener('mousedown', e => onResizeStart(e, false, true));
    handleSE.addEventListener('mousedown', e => onResizeStart(e, true, true));
  }

  function wireIframeScrollSync(iframe) {
    iframe.addEventListener('load', () => {
      try {
        const win = iframe.contentWindow;
        if (!win) return;
        win.addEventListener('scroll', () => {
          if (!respSyncScroll || respIsSyncing) return;
          respIsSyncing = true;
          const doc = win.document;
          const max = doc.documentElement.scrollHeight - win.innerHeight;
          const ratio = max > 0 ? win.scrollY / max : 0;

          respDevices.forEach(d => {
            if (d.iframe !== iframe && d.iframe.contentWindow) {
              try {
                const dWin = d.iframe.contentWindow;
                const dDoc = dWin.document;
                const dMax = dDoc.documentElement.scrollHeight - dWin.innerHeight;
                if (dMax > 0) {
                  dWin.scrollTo(0, ratio * dMax);
                }
              } catch (_) {}
            }
          });

          setTimeout(() => { respIsSyncing = false; }, 25);
        }, { passive: true });
      } catch (_) {}
    });
  }

  // ── 8. Slide-Out Side Panel Implementation ──────────────────

  function formatColor(raw, format = 'hex') {
    const col = parseColor(raw);
    if (!col) return raw;
    if (format === 'rgb') {
      return col.a < 255
        ? `rgba(${col.r}, ${col.g}, ${col.b}, ${fmt2(col.alpha)})`
        : `rgb(${col.r}, ${col.g}, ${col.b})`;
    }
    if (format === 'hsl') {
      const r = col.r / 255, g = col.g / 255, b = col.b / 255;
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      let h, s, l = (max + min) / 2;
      if (max === min) {
        h = s = 0;
      } else {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
          case r: h = (g - b) / d + (g < b ? 6 : 0); break;
          case g: h = (b - r) / d + 2; break;
          case b: h = (r - g) / d + 4; break;
        }
        h /= 6;
      }
      const hue = Math.round(h * 360);
      const sat = Math.round(s * 100);
      const light = Math.round(l * 100);
      return col.a < 255
        ? `hsla(${hue}, ${sat}%, ${light}%, ${fmt2(col.alpha)})`
        : `hsl(${hue}, ${sat}%, ${light}%)`;
    }
    const hex = toHex(col);
    if (col.a < 255) {
      const alphaHex = Math.round(col.a).toString(16).padStart(2, '0').toUpperCase();
      return `${hex}${alphaHex}`;
    }
    return hex;
  }

  // Picks a readable file name for an asset URL, unwrapping image-optimizer URLs such as
  // Next.js "/_next/image?url=%2Fhero.jpg&w=1920". Returns '' when no name with an
  // extension can be derived, so the browser names the file from the response instead.
  function assetFileName(url) {
    try {
      const u = new URL(url, window.location.href);
      if (!/^https?:$/.test(u.protocol)) return '';
      const inner = u.searchParams.get('url');
      const path = inner ? new URL(inner, u.origin).pathname : u.pathname;
      const base = decodeURIComponent(path.split('/').pop() || '');
      return /\.[a-z0-9]{2,5}$/i.test(base) ? base : '';
    } catch (_) {
      return '';
    }
  }

  function saveWithLink(href, filename) {
    const a = document.createElement('a');
    a.href = href;
    a.download = filename;
    document.documentElement.appendChild(a);
    a.click();
    a.remove();
  }

  function downloadAsset(url, filename) {
    if (!url) return;
    const name = /\.[a-z0-9]{2,5}$/i.test(filename || '')
      ? filename.replace(/[\\/:*?"<>|\x00-\x1f]+/g, '_')
      : '';

    let absUrl = url;
    try {
      absUrl = new URL(url, window.location.href).href;
    } catch (_) {}

    // The background worker downloads through the browser itself: this works for cross-origin
    // files (CDNs), never opens a new tab, and — unlike page-started <a download> links — doesn't
    // trip the "this site wants to download multiple files" block during Download All.
    // Serialized SVGs (data: URLs) go the same way. If the extension can't be reached, fall back
    // to saving from the page.
    sendRuntimeMessage({ type: 'SR_DOWNLOAD', url: absUrl, filename: name }).then(res => {
      if (res && res.ok) return;
      if (absUrl.startsWith('data:')) {
        saveWithLink(absUrl, name || 'vector.svg');
        return;
      }
      fetch(absUrl)
        .then(r => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.blob();
        })
        .then(blob => {
          const ext = (blob.type.split('/')[1] || 'bin').split(/[+;]/)[0];
          const blobUrl = URL.createObjectURL(blob);
          saveWithLink(blobUrl, name || `asset.${ext}`);
          setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
        })
        .catch(() => window.open(absUrl, '_blank'));
    });
  }

  function buildSidePanelDOM() {
    if (sidePanel) return;

    sidePanel = document.createElement('div');
    sidePanel.id = 'sr-sidepanel';
    sidePanel.style.width = `${sidePanelWidth}px`;
    document.documentElement.style.setProperty('--sr-sp-width', `${sidePanelWidth}px`);

    sidePanel.innerHTML = `
      <div class="sr-sp-resizer" id="sr-sp-resizer" title="Drag to resize the panel · double-click to reset"></div>
      <div class="sr-sp-header">
        <div class="sr-sp-tabs">
          <button class="sr-sp-tab sr-active" id="sr-sp-tab-element">Element</button>
          <button class="sr-sp-tab" id="sr-sp-tab-page">Page</button>
        </div>
        <button class="sr-sp-close-btn" id="sr-sp-close" title="Close Panel (O / Esc)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
            <path d="M18 6L6 18M6 6l12 12"/>
          </svg>
        </button>
      </div>
      <div id="sr-sp-content-area" class="sr-sp-body"></div>
    `;

    document.documentElement.appendChild(sidePanel);
    isolateScrolling(sidePanel, '.sr-sp-body');

    spTabEl = sidePanel.querySelector('#sr-sp-tab-element');
    spTabPg = sidePanel.querySelector('#sr-sp-tab-page');
    spCloseBtn = sidePanel.querySelector('#sr-sp-close');
    spContentArea = sidePanel.querySelector('#sr-sp-content-area');

    // Drag Resizer Handling
    const resizer = sidePanel.querySelector('#sr-sp-resizer');
    if (resizer) {
      resizer.addEventListener('dblclick', () => setPanelWidth(DEFAULT_SP_WIDTH));
      let isResizing = false;
      let startX = 0;
      let startWidth = 0;

      resizer.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        isResizing = true;
        startX = e.clientX;
        startWidth = sidePanelWidth;
        resizer.classList.add('sr-active');
        document.documentElement.classList.add('sr-sp-resizing');

        const onMouseMove = (moveEvent) => {
          if (!isResizing) return;
          // The handle is on the panel's inner edge: left when docked right, right when docked left
          const delta = sidePanel.classList.contains('sr-sp-left') ? moveEvent.clientX - startX : startX - moveEvent.clientX;
          sidePanelWidth = clampPanelWidth(startWidth + delta);
          document.documentElement.style.setProperty('--sr-sp-width', `${sidePanelWidth}px`);
          sidePanel.style.width = `${sidePanelWidth}px`;
        };

        const onMouseUp = () => {
          if (!isResizing) return;
          isResizing = false;
          resizer.classList.remove('sr-active');
          document.documentElement.classList.remove('sr-sp-resizing');
          window.removeEventListener('mousemove', onMouseMove);
          window.removeEventListener('mouseup', onMouseUp);
          rememberPref('sr_sidepanel_width', sidePanelWidth);
          window.dispatchEvent(new Event('resize'));
        };

        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
      });
    }

    spTabEl.addEventListener('click', () => {
      sidePanelTab = 'element';
      spTabEl.classList.add('sr-active');
      spTabPg.classList.remove('sr-active');
      updateSidePanel();
    });

    spTabPg.addEventListener('click', () => {
      sidePanelTab = 'page';
      spTabPg.classList.add('sr-active');
      spTabEl.classList.remove('sr-active');
      updateSidePanel();
    });

    spCloseBtn.addEventListener('click', () => {
      closeSidePanel();
    });

    updateSidePanel();
  }

  // The width stays between the least that holds the panel's controls and the most it may take.
  function clampPanelWidth(w) {
    const max = Math.max(MIN_SP_WIDTH, Math.min(MAX_SP_WIDTH, Math.round(window.innerWidth * 0.5)));
    return Math.min(Math.max(MIN_SP_WIDTH, Math.round(w)), max);
  }

  function setPanelWidth(w) {
    sidePanelWidth = clampPanelWidth(w);
    document.documentElement.style.setProperty('--sr-sp-width', `${sidePanelWidth}px`);
    if (sidePanel) sidePanel.style.width = `${sidePanelWidth}px`;
    rememberPref('sr_sidepanel_width', sidePanelWidth);
    window.dispatchEvent(new Event('resize'));
  }

  function openSidePanel() {
    if (!sidePanel) buildSidePanelDOM();
    isSidePanelOpen = true;
    cachedPageData = null; // re-scan: the page may have changed since the panel was last open
    sidePanelWidth = clampPanelWidth(sidePanelWidth);
    document.documentElement.style.setProperty('--sr-sp-width', `${sidePanelWidth}px`);
    sidePanel.style.width = `${sidePanelWidth}px`;
    // Right-to-left pages keep their content against the right edge, so the panel docks on
    // the left there; docked right it would cover the page.
    const dockLeft = getComputedStyle(document.documentElement).direction === 'rtl';
    if (sidePanel.classList.contains('sr-sp-left') !== dockLeft) {
      sidePanel.style.setProperty('transition', 'none', 'important');
      sidePanel.classList.toggle('sr-sp-left', dockLeft);
      void sidePanel.offsetWidth; // settle the closed position on the new side before sliding in
      sidePanel.style.removeProperty('transition');
    }
    document.documentElement.classList.toggle('sr-sp-left', dockLeft);
    updateScrollbarGutter();
    sidePanel.classList.add('sr-sp-open');
    document.documentElement.classList.add('sr-sp-pushed');
    if (document.body) document.body.classList.add('sr-sp-pushed');
    fitFixedElements();
    watchFixedElements();
    updateToolbarButtons();
    updateSidePanel();
    window.dispatchEvent(new Event('resize'));
  }

  function closeSidePanel() {
    if (!sidePanel) return;
    isSidePanelOpen = false;
    xpCancel();
    sidePanel.classList.remove('sr-sp-open');
    unwatchFixedElements();
    document.documentElement.classList.remove('sr-sp-pushed', 'sr-sp-left');
    if (document.body) document.body.classList.remove('sr-sp-pushed');
    updateToolbarButtons();
    setTimeout(() => {
      window.dispatchEvent(new Event('resize'));
    }, 280);
  }

  function toggleSidePanel() {
    if (isSidePanelOpen) closeSidePanel();
    else openSidePanel();
  }

  function updateSidePanel(targetEl) {
    if (!sidePanel || !spContentArea) return;

    if (sidePanelTab === 'page') {
      renderSidePanelPageTab(false);
    } else {
      renderSidePanelElementTab(targetEl);
    }
  }

  function escapeHTML(str) {
    return String(str ?? '').replace(/[&<>"']/g, m => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[m]);
  }

  function highlightCSSDecl(prop, val, isStruck) {
    let valHtml = '';
    prop = escapeHTML(prop.trim());
    val = escapeHTML(val.trim());

    if (prop === 'font-family') {
      const parts = val.split(',').map(f => `<span class="sr-syn-str">${f.trim()}</span>`);
      valHtml = parts.join('<span class="sr-syn-punct">, </span>');
    } else if (/^(inline|block|inline-block|flex|inline-flex|grid|none|border-box|content-box|normal|inherit|initial|auto|relative|absolute|fixed|sticky)$/i.test(val)) {
      valHtml = `<span class="sr-syn-kw">${val}</span>`;
    } else if (/^(#[0-9a-fA-F]+|rgba?\(.+\)|hsla?\(.+\)|[0-9]+(\.[0-9]+)?(px|%|em|rem|vh|vw|deg|fr)?)$/i.test(val) || /^[\d.]+$/.test(val)) {
      valHtml = `<span class="sr-syn-num">${val}</span>`;
    } else {
      valHtml = `<span class="sr-syn-num">${val}</span>`;
    }

    const lineHtml = `  <span class="sr-syn-prop">${prop}</span><span class="sr-syn-punct">:</span> ${valHtml}<span class="sr-syn-punct">;</span>`;
    if (isStruck) {
      return `<span class="sr-syn-struck">${lineHtml}</span>`;
    }
    return lineHtml;
  }

  function highlightTailwindToken(tok) {
    tok = escapeHTML(tok.trim());
    if (/^(inline|block|inline-block|flex|inline-flex|grid|hidden|box-border|box-content|leading-normal|border-box)$/.test(tok)) {
      return `<span class="sr-syn-kw">${tok}</span>`;
    }
    if (tok.startsWith('font-[family-name:')) {
      const inner = tok.slice('font-[family-name:'.length, -1);
      return `<span class="sr-syn-prop">font-[family-name:</span><span class="sr-syn-str">${inner}</span><span class="sr-syn-punct">]</span>`;
    }
    if (tok.startsWith('font-[weight:')) {
      const inner = tok.slice('font-[weight:'.length, -1);
      return `<span class="sr-syn-prop">font-[weight:</span><span class="sr-syn-num">${inner}</span><span class="sr-syn-punct">]</span>`;
    }
    const m = tok.match(/^([a-z-]+)\[(.*)\]$/);
    if (m) {
      return `<span class="sr-syn-prop">${m[1]}[</span><span class="sr-syn-num">${m[2]}</span><span class="sr-syn-punct">]</span>`;
    }
    return `<span class="sr-syn-prop">${tok}</span>`;
  }

  // Splits a declaration block's cssText ("a: b; c: d") into [prop, value] pairs without
  // breaking on semicolons inside strings or functions such as url(data:…;base64,…).
  function splitDeclarations(cssText) {
    const chunks = [];
    let buf = '';
    let depth = 0;
    let quote = null;
    let escaped = false;
    for (const ch of cssText) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (quote) {
        if (ch === quote) quote = null;
      } else if (ch === '"' || ch === "'") {
        quote = ch;
      } else if (ch === '(') {
        depth++;
      } else if (ch === ')') {
        depth = Math.max(0, depth - 1);
      } else if (ch === ';' && depth === 0) {
        chunks.push(buf);
        buf = '';
        continue;
      }
      buf += ch;
    }
    chunks.push(buf);
    return chunks
      .map(chunk => {
        const i = chunk.indexOf(':');
        return i > 0 ? [chunk.slice(0, i).trim(), chunk.slice(i + 1).trim()] : null;
      })
      .filter(Boolean);
  }

  function getElementMatchedRules(el) {
    const matched = [];
    if (!el || !el.ownerDocument) return matched;
    // forEachCssRule walks @import, @media, @supports, @layer and native CSS nesting; a nested rule is matched by
    // its full selector and shown with it, so it reads as a rule of its own
    forEachCssRule(el.ownerDocument, (rule, parentSel) => {
      let sel = '';
      if (rule.type === 1) sel = resolveNestedSelector(rule.selectorText, parentSel);
      else if (parentSel && rule.style && !('selectorText' in rule)) sel = parentSel; // declarations inside a nested rule
      if (!sel || !rule.style || !rule.style.length) return;
      if (matchesSafe(el, sel)) matched.push({ selectorText: sel, style: rule.style });
    }, el.getRootNode && el.getRootNode());
    return matched;
  }

  function generateSidePanelCode(format, targetEl, cs, W, H, elSel, colorFormat) {
    const lines = [];
    let fullRaw = '';

    if (format === 'computed') {
      const rawLines = [];
      const pushLine = (html, raw) => {
        lines.push({ num: lines.length + 1, html, raw });
        rawLines.push(raw);
      };

      pushLine(
        `<span class="sr-syn-sel">${escapeHTML(elSel)}</span> <span class="sr-syn-punct">{</span>`,
        `${elSel} {`
      );
      pushLine(highlightCSSDecl('width', `${W}px`), `  width: ${W}px;`);
      pushLine(highlightCSSDecl('height', `${H}px`), `  height: ${H}px;`);
      if (cs.display) pushLine(highlightCSSDecl('display', cs.display), `  display: ${cs.display};`);
      if (cs.boxSizing) pushLine(highlightCSSDecl('box-sizing', cs.boxSizing), `  box-sizing: ${cs.boxSizing};`);

      const pt = parseFloat(cs.paddingTop) || 0;
      const pr = parseFloat(cs.paddingRight) || 0;
      const pb = parseFloat(cs.paddingBottom) || 0;
      const pl = parseFloat(cs.paddingLeft) || 0;
      if (pt || pr || pb || pl) {
        const padVal = fmtSpacing(pt, pr, pb, pl);
        pushLine(highlightCSSDecl('padding', padVal), `  padding: ${padVal};`);
      }

      const mt = parseFloat(cs.marginTop) || 0;
      const mr = parseFloat(cs.marginRight) || 0;
      const mb = parseFloat(cs.marginBottom) || 0;
      const ml = parseFloat(cs.marginLeft) || 0;
      if (mt || mr || mb || ml) {
        const marVal = fmtSpacing(mt, mr, mb, ml);
        pushLine(highlightCSSDecl('margin', marVal), `  margin: ${marVal};`);
      }

      if (cs.fontSize) pushLine(highlightCSSDecl('font-size', cs.fontSize), `  font-size: ${cs.fontSize};`);
      if (cs.fontFamily) pushLine(highlightCSSDecl('font-family', cs.fontFamily), `  font-family: ${cs.fontFamily};`);
      if (cs.fontWeight) pushLine(highlightCSSDecl('font-weight', cs.fontWeight), `  font-weight: ${cs.fontWeight};`);
      if (cs.lineHeight) {
        const lhVal = cs.lineHeight === 'normal' ? 'normal' : cs.lineHeight;
        pushLine(highlightCSSDecl('line-height', lhVal), `  line-height: ${lhVal};`);
      }
      if (cs.letterSpacing && cs.letterSpacing !== 'normal') {
        pushLine(highlightCSSDecl('letter-spacing', cs.letterSpacing), `  letter-spacing: ${cs.letterSpacing};`);
      }
      if (cs.color) {
        const colVal = formatColor(cs.color, colorFormat);
        pushLine(highlightCSSDecl('color', colVal), `  color: ${colVal};`);
      }
      if (parseColor(cs.backgroundColor)) {
        const bgVal = formatColor(cs.backgroundColor, colorFormat);
        pushLine(highlightCSSDecl('background-color', bgVal), `  background-color: ${bgVal};`);
      }
      if (cs.borderRadius && cs.borderRadius !== '0px') {
        pushLine(highlightCSSDecl('border-radius', cs.borderRadius), `  border-radius: ${cs.borderRadius};`);
      }
      if (cs.boxShadow && cs.boxShadow !== 'none') {
        pushLine(highlightCSSDecl('box-shadow', cs.boxShadow), `  box-shadow: ${cs.boxShadow};`);
      }

      pushLine(`<span class="sr-syn-punct">}</span>`, `}`);
      fullRaw = rawLines.join('\n');
      return { lines, fullRaw };
    }

    if (format === 'source') {
      const rawLines = [];
      const pushLine = (html, raw) => {
        lines.push({ num: lines.length + 1, html, raw });
        rawLines.push(raw);
      };

      const pushBlock = (selectorText, style) => {
        if (lines.length > 0) pushLine('&nbsp;', '');
        pushLine(
          `<span class="sr-syn-sel">${escapeHTML(selectorText)}</span> <span class="sr-syn-punct">{</span>`,
          `${selectorText} {`
        );
        // cssText keeps shorthands (padding, border…) instead of every expanded longhand
        splitDeclarations(style.cssText).forEach(([prop, val]) => {
          pushLine(highlightCSSDecl(prop, val), `  ${prop}: ${val};`);
        });
        pushLine(`<span class="sr-syn-punct">}</span>`, `}`);
      };

      // Declarations are listed as authored. Whether one is overridden depends on the
      // full cascade (specificity, order, layers), so nothing is struck through.
      getElementMatchedRules(targetEl).forEach(rule => pushBlock(rule.selectorText, rule.style));
      if (targetEl.style && targetEl.style.length > 0) {
        pushBlock('element.style', targetEl.style);
      }
      if (lines.length === 0) {
        const note = '/* No readable CSS rules match this element (cross-origin stylesheets cannot be read). */';
        pushLine(`<span class="sr-syn-punct">${escapeHTML(note)}</span>`, note);
      }
      fullRaw = rawLines.join('\n');
      return { lines, fullRaw };
    }

    if (format === 'tailwind') {
      const twTokens = [];
      twTokens.push(`w-[${W}px]`);
      twTokens.push(`h-[${H}px]`);
      if (cs.display) twTokens.push(cs.display === 'none' ? 'hidden' : cs.display);
      if (cs.boxSizing) twTokens.push(`box-${cs.boxSizing.replace('-box', '').replace('box', 'border')}`);

      const pt = parseFloat(cs.paddingTop) || 0;
      const pr = parseFloat(cs.paddingRight) || 0;
      const pb = parseFloat(cs.paddingBottom) || 0;
      const pl = parseFloat(cs.paddingLeft) || 0;
      if (pt) twTokens.push(`pt-[${pt}px]`);
      if (pb) twTokens.push(`pb-[${pb}px]`);
      if (pl) twTokens.push(`pl-[${pl}px]`);
      if (pr) twTokens.push(`pr-[${pr}px]`);

      const mt = parseFloat(cs.marginTop) || 0;
      const mr = parseFloat(cs.marginRight) || 0;
      const mb = parseFloat(cs.marginBottom) || 0;
      const ml = parseFloat(cs.marginLeft) || 0;
      if (mt) twTokens.push(`mt-[${mt}px]`);
      if (mb) twTokens.push(`mb-[${mb}px]`);
      if (ml) twTokens.push(`ml-[${ml}px]`);
      if (mr) twTokens.push(`mr-[${mr}px]`);

      const fsize = fmt2(parseFloat(cs.fontSize) || 16);
      twTokens.push(`text-[${fsize}px]`);

      if (cs.fontFamily) {
        const ffSanitized = cs.fontFamily.split(',').map(f => {
          let name = f.trim().replace(/^['"]|['"]$/g, '');
          if (name.includes(' ')) {
            return `"${name.replace(/\s+/g, '_')}"`;
          }
          return name;
        }).join(',');
        twTokens.push(`font-[family-name:${ffSanitized}]`);
      }

      const TW_WEIGHTS = { 100: 'thin', 200: 'extralight', 300: 'light', 400: 'normal', 500: 'medium', 600: 'semibold', 700: 'bold', 800: 'extrabold', 900: 'black' };
      const fweight = parseInt(cs.fontWeight, 10) || 400;
      twTokens.push(TW_WEIGHTS[fweight] ? `font-${TW_WEIGHTS[fweight]}` : `font-[${fweight}]`);

      const lh = cs.lineHeight === 'normal' ? 'leading-normal' : `leading-[${fmt2(parseFloat(cs.lineHeight) / (fsize || 16))}]`;
      twTokens.push(lh);

      // Arbitrary values can't contain spaces: use hex colours and "_" separators
      if (parseColor(cs.color)) {
        twTokens.push(`text-[${formatColor(cs.color, 'hex')}]`);
      }
      if (parseColor(cs.backgroundColor)) {
        twTokens.push(`bg-[${formatColor(cs.backgroundColor, 'hex')}]`);
      }
      if (cs.borderRadius && cs.borderRadius !== '0px') {
        twTokens.push(`rounded-[${cs.borderRadius.replace(/\s+/g, '_')}]`);
      }

      fullRaw = twTokens.join(' ');
      const htmlTokens = twTokens.map(tok => highlightTailwindToken(tok)).join(' ');
      lines.push({ num: 1, html: htmlTokens, raw: fullRaw });
      return { lines, fullRaw };
    }

    if (format === 'react') {
      const rawLines = [];
      const pushLine = (html, raw) => {
        lines.push({ num: lines.length + 1, html, raw });
        rawLines.push(raw);
      };

      const obj = {
        width: `${W}px`,
        height: `${H}px`,
        display: cs.display,
        boxSizing: cs.boxSizing,
        fontSize: cs.fontSize,
        fontFamily: cs.fontFamily,
        fontWeight: cs.fontWeight || 400,
        lineHeight: cs.lineHeight,
        color: formatColor(cs.color, colorFormat)
      };
      if (parseColor(cs.backgroundColor)) {
        obj.backgroundColor = formatColor(cs.backgroundColor, colorFormat);
      }
      if (cs.borderRadius && cs.borderRadius !== '0px') {
        obj.borderRadius = cs.borderRadius;
      }

      pushLine(`<span class="sr-syn-kw">const</span> <span class="sr-syn-sel">style</span> <span class="sr-syn-punct">=</span> <span class="sr-syn-punct">{</span>`, `const style = {`);
      for (const [k, v] of Object.entries(obj)) {
        pushLine(`  <span class="sr-syn-prop">${k}</span><span class="sr-syn-punct">:</span> <span class="sr-syn-str">${escapeHTML(JSON.stringify(String(v)))}</span><span class="sr-syn-punct">,</span>`, `  ${k}: ${JSON.stringify(String(v))},`);
      }
      pushLine(`<span class="sr-syn-punct">};</span>`, `};`);
      fullRaw = rawLines.join('\n');
      return { lines, fullRaw };
    }

    return { lines: [], fullRaw: '' };
  }

  // ── Animation Inspection ────────────────────────────────────
  const STATE_PSEUDO = /(?<!\\):(hover|focus-visible|focus-within|focus|active)(?![\w-])/;
  const STATE_PSEUDO_ALL = new RegExp(STATE_PSEUDO.source, 'g');

  // Splits a comma-separated list ("opacity, transform", "a:hover, b") without breaking
  // functions such as cubic-bezier(0.4, 0, 0.2, 1) or :is(a, b).
  const splitCssList = value => String(value || '').split(/,(?![^(]*\))/).map(s => s.trim()).filter(Boolean);
  // Computed transition/animation lists repeat to match the number of properties/names.
  const listItem = (value, i) => {
    const items = splitCssList(value);
    return items.length ? items[i % items.length] : '';
  };
  const toKebab = prop => (prop === 'cssFloat' ? 'float' : prop.replace(/^css(?=[A-Z])/, '').replace(/[A-Z]/g, c => `-${c.toLowerCase()}`));
  const formatMs = ms => {
    if (typeof ms !== 'number' || !Number.isFinite(ms)) return String(ms ?? '');
    return ms >= 1000 ? `${round1(ms / 1000)}s` : `${Math.round(ms)}ms`;
  };
  const formatIterations = n => (n === Infinity || n === 'infinite' ? 'infinite' : String(n));

  const MOTION_FALLBACK_PROPS = ['opacity', 'transform', 'translate', 'scale', 'rotate', 'background-color', 'color', 'border-color', 'box-shadow', 'filter', 'backdrop-filter'];
  // Properties whose values matter for the element's transitions ("all" expands to common ones)
  const motionProps = info => {
    const props = info.transitions.map(t => t.prop);
    return [...new Set(props.includes('all') ? [...props.filter(p => p !== 'all'), ...MOTION_FALLBACK_PROPS] : props)];
  };
  const matchesSafe = (el, sel) => {
    try {
      return el.matches(sel);
    } catch (_) {
      return false;
    }
  };

  // Current values of the given properties. While a transition on one is still running, report
  // where it is heading (its end value) rather than an in-between frame.
  function settledValues(el, props) {
    const cs = (el.ownerDocument.defaultView || window).getComputedStyle(el);
    const values = {};
    props.forEach(p => {
      values[p] = cs.getPropertyValue(p).trim();
    });
    try {
      el.getAnimations().forEach(a => {
        if (typeof a.transitionProperty !== 'string' || !(a.transitionProperty in values)) return;
        const frames = a.effect.getKeyframes();
        const key = a.transitionProperty.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
        const end = frames.length ? frames[frames.length - 1][key] : undefined;
        if (end != null) values[a.transitionProperty] = String(end);
      });
    } catch (_) {}
    return values;
  }

  // Turns a nested rule's selector ("&:hover", ".icon") into a standalone one.
  function resolveNestedSelector(sel, parentSel) {
    if (!parentSel) return sel;
    return splitCssList(sel)
      .map(part => (/(?<!\\)&/.test(part) ? part.replace(/(?<!\\)&/g, `:is(${parentSel})`) : `:is(${parentSel}) ${part}`))
      .join(', ');
  }

  // Visits every rule in the document's readable stylesheets, descending into @import,
  // matching @media / @supports, @layer, and native CSS nesting. `parentSel` is the resolved
  // selector of the enclosing style rule for nested rules, otherwise ''.
  function forEachCssRule(doc, visit, root) {
    const win = doc.defaultView || window;
    const walk = (rules, parentSel) => {
      for (let i = 0; i < rules.length; i++) {
        const rule = rules[i];
        try {
          if (rule.type === 4 && rule.media && rule.media.mediaText && !win.matchMedia(rule.media.mediaText).matches) continue;
          if (rule.type === 12 && !CSS.supports(rule.conditionText)) continue;
          visit(rule, parentSel);
          const sel = rule.type === 1 ? resolveNestedSelector(rule.selectorText, parentSel) : parentSel;
          const children = rule.type === 3 ? rule.styleSheet && rule.styleSheet.cssRules : rule.cssRules;
          if (children && children.length) walk(children, sel);
        } catch (_) {
          // Cross-origin sheets throw on cssRules
        }
      }
    };
    const sheets = Array.from(doc.styleSheets);
    // a component's own styles sit in its shadow root
    if (root && root !== doc && root.styleSheets) sheets.push(...Array.from(root.styleSheets), ...(root.adoptedStyleSheets || []));
    for (const sheet of sheets) {
      try {
        if (sheet.cssRules) walk(sheet.cssRules, '');
      } catch (_) {}
    }
  }

  function getAnimationInfo(el) {
    const info = { running: [], transitions: [], cssAnimations: [], stateRules: [], keyframes: [] };
    if (!el || !el.ownerDocument) return info;
    const doc = el.ownerDocument;
    const cs = (doc.defaultView || window).getComputedStyle(el);

    // 1. Declared transitions: they play whenever one of these properties changes (e.g. on hover)
    if (cs.transitionProperty && cs.transitionProperty !== 'none') {
      splitCssList(cs.transitionProperty).forEach((prop, i) => {
        const duration = listItem(cs.transitionDuration, i);
        if (!parseFloat(duration)) return;
        info.transitions.push({
          prop,
          duration,
          easing: listItem(cs.transitionTimingFunction, i),
          delay: listItem(cs.transitionDelay, i)
        });
      });
    }

    // 2. Declared CSS animations
    splitCssList(cs.animationName).forEach((name, i) => {
      if (name === 'none') return;
      info.cssAnimations.push({
        name,
        duration: listItem(cs.animationDuration, i),
        easing: listItem(cs.animationTimingFunction, i),
        delay: listItem(cs.animationDelay, i),
        iterations: listItem(cs.animationIterationCount, i),
        direction: listItem(cs.animationDirection, i),
        fill: listItem(cs.animationFillMode, i),
        playState: listItem(cs.animationPlayState, i)
      });
    });

    // 3. What is playing right now on the element or anything inside it: CSS animations,
    //    transitions in progress, and Web Animations API (element.animate(), Motion…)
    let playing = [];
    try {
      playing = el.getAnimations({ subtree: true });
    } catch (_) {}
    playing.slice(0, 20).forEach(anim => {
      const effect = anim.effect;
      if (!effect) return;
      const timing = effect.getComputedTiming();
      let kind = 'Web Animation';
      let name = anim.id || '';
      if (typeof anim.animationName === 'string') {
        kind = 'CSS Animation';
        name = anim.animationName;
      } else if (typeof anim.transitionProperty === 'string') {
        kind = 'Transition';
        name = anim.transitionProperty;
      }
      let frames = [];
      try {
        frames = effect.getKeyframes().map(frame => ({
          offset: frame.computedOffset,
          easing: frame.easing,
          props: Object.entries(frame).filter(([k]) => !['offset', 'computedOffset', 'easing', 'composite'].includes(k))
        }));
      } catch (_) {}
      const target = effect.target;
      const pseudo = effect.pseudoElement || '';
      info.running.push({
        anim,
        kind,
        name: name || '(unnamed)',
        target: target && target !== el ? selector(target) + pseudo : pseudo,
        targetEl: target && target !== el ? target : null,
        pseudo,
        duration: timing.duration,
        delay: timing.delay,
        iterations: timing.iterations,
        direction: timing.direction,
        fill: timing.fill,
        // A CSS animation's timing function lives on its keyframes
        easing: kind === 'CSS Animation' && frames[0] ? frames[0].easing : effect.getTiming().easing,
        playState: anim.playState,
        progress: timing.progress,
        frames
      });
    });

    // Transitioned values at selection time. Elements are usually picked with the pointer on
    // them, so these are often the :hover values; the AI brief compares them with the values
    // at copy time (pointer on the panel) to report what changes on hover — this works even
    // when the site's stylesheets can't be read.
    info.hoveredAtSelection = matchesSafe(el, ':hover');
    info.valuesAtSelection = settledValues(el, motionProps(info));

    // Without any motion the section stays hidden, so skip the stylesheet walk below
    if (!hasAnimation(info)) return info;

    // 4. @keyframes for the declared animations, and :hover / :focus / :active rules that
    //    apply to this element (usually the values its transitions animate to)
    const wantedKeyframes = new Set(info.cssAnimations.map(a => a.name));
    const keyframes = new Map(); // the last definition wins, as in the cascade
    forEachCssRule(doc, (rule, parentSel) => {
      if (rule.type === 7) {
        if (wantedKeyframes.has(rule.name)) {
          keyframes.set(rule.name, {
            name: rule.name,
            frames: Array.from(rule.cssRules).map(k => ({ key: k.keyText, decls: splitDeclarations(k.style.cssText) }))
          });
        }
        return;
      }
      if (info.stateRules.length >= 12) return;
      let fullSel = '';
      if (rule.type === 1) {
        fullSel = resolveNestedSelector(rule.selectorText, parentSel);
      } else if (parentSel && rule.style && !('selectorText' in rule)) {
        fullSel = parentSel; // CSSNestedDeclarations inside a nested rule
      }
      if (!fullSel || !rule.style || !rule.style.length || !STATE_PSEUDO.test(fullSel)) return;
      const base = fullSel.replace(STATE_PSEUDO_ALL, '').trim();
      if (!base) return;
      try {
        if (!el.matches(base)) return;
      } catch (_) {
        return;
      }
      info.stateRules.push({
        states: [...new Set(Array.from(fullSel.matchAll(STATE_PSEUDO_ALL), m => m[1]))],
        selector: fullSel,
        decls: splitDeclarations(rule.style.cssText)
      });
    }, el.getRootNode && el.getRootNode());
    info.keyframes = Array.from(keyframes.values());
    return info;
  }

  // Small SVG plot of a cubic-bezier timing function (named keywords included).
  function easingPreviewSVG(easing) {
    const NAMED = {
      ease: [0.25, 0.1, 0.25, 1],
      linear: [0, 0, 1, 1],
      'ease-in': [0.42, 0, 1, 1],
      'ease-out': [0, 0, 0.58, 1],
      'ease-in-out': [0.42, 0, 0.58, 1]
    };
    const value = String(easing || '').trim();
    let pts = NAMED[value];
    const m = value.match(/^cubic-bezier\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)$/);
    if (m) pts = m.slice(1).map(Number);
    if (!pts || pts.some(n => !Number.isFinite(n))) return '';
    const [x1, y1, x2, y2] = pts;
    const W = 56;
    const H = 28;
    const PAD = 4;
    const px = x => (PAD + x * W).toFixed(1);
    const py = y => (PAD + (1 - y) * H).toFixed(1);
    return `<svg class="sr-sp-anim-curve" viewBox="0 0 ${W + PAD * 2} ${H + PAD * 2}" aria-hidden="true"><path d="M${px(0)} ${py(0)} C${px(x1)} ${py(y1)} ${px(x2)} ${py(y2)} ${px(1)} ${py(1)}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`;
  }

  // The Animations section only appears when something on the element (or inside it) moves:
  // a CSS animation, a transition, or a running Web Animation. Hover styles alone don't count.
  function hasAnimation(info) {
    return info.running.length > 0 || info.cssAnimations.length > 0 || info.transitions.length > 0;
  }

  // Running animations that the element's declared CSS animations and transitions don't
  // already describe: JavaScript (Web Animations API) ones, pseudo-elements, and anything
  // animating inside the element.
  function extraRunningAnimations(info) {
    return info.running.filter(r => {
      if (r.target) return true;
      if (r.kind === 'CSS Animation') return !info.cssAnimations.some(a => a.name === r.name);
      return r.kind !== 'Transition';
    });
  }

  function renderAnimationSection(info) {
    if (!hasAnimation(info)) return '';
    const extra = extraRunningAnimations(info);
    const count = info.cssAnimations.length + extra.length + info.transitions.length;
    const row = (key, value) => (value === '' || value == null
      ? ''
      : `<span class="sr-sp-anim-k">${key}</span><span class="sr-sp-anim-v">${escapeHTML(String(value))}</span>`);
    const liveState = r => `${r.playState}${typeof r.progress === 'number' ? ` · ${Math.round(r.progress * 100)}%` : ''}`;
    const codeCard = lines => `
      <div class="sr-sp-code-card"><div class="sr-sp-code-body">
        ${lines.map(html => `<div class="sr-sp-code-line"><span class="sr-sp-code-content">${html}</span></div>`).join('')}
      </div></div>`;
    const card = (name, badge, target, gridHtml, easing, extraHtml = '') => `
      <div class="sr-sp-anim-card">
        <div class="sr-sp-anim-head">
          <span class="sr-sp-anim-name">${escapeHTML(name)}</span>
          <span class="sr-sp-anim-badge">${escapeHTML(badge)}</span>
        </div>
        ${target ? `<div class="sr-sp-anim-target">on ${escapeHTML(target)}</div>` : ''}
        <div class="sr-sp-anim-body">
          <div class="sr-sp-anim-grid">${gridHtml}</div>
          ${easingPreviewSVG(easing)}
        </div>
        ${extraHtml}
      </div>`;
    const group = (title, content) => `
      <div class="sr-sp-anim-group">
        <div class="sr-sp-color-grp-title">${title}</div>
        ${content}
      </div>`;
    const declsInline = decls => decls.map(([p, v]) => highlightCSSDecl(p, v).trim()).join(' ');
    const frameLines = frames => frames.map(f => {
      const decls = f.props
        .map(([p, v]) => `<span class="sr-syn-prop">${escapeHTML(toKebab(p))}</span><span class="sr-syn-punct">:</span> <span class="sr-syn-num">${escapeHTML(String(v))}</span><span class="sr-syn-punct">;</span>`)
        .join(' ');
      return `<span class="sr-syn-sel">${round1((f.offset || 0) * 100)}%</span> <span class="sr-syn-punct">{</span> ${decls} <span class="sr-syn-punct">}</span>`;
    });

    let body = `
      <button class="sr-sp-anim-ai" id="sr-sp-anim-copy-ai" title="Copy a description of this animation to paste into an AI assistant">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/></svg>
        <span class="sr-sp-anim-ai-label">Copy for AI</span>
      </button>
      <div class="sr-sp-anim-note">Paste it into ChatGPT, Claude or Gemini to recreate this animation.</div>`;

    if (info.cssAnimations.length) {
      body += group(`CSS animations (${info.cssAnimations.length})`, info.cssAnimations.map(a => {
        const live = info.running.find(r => r.kind === 'CSS Animation' && !r.target && r.name === a.name);
        const kf = info.keyframes.find(k => k.name === a.name);
        let code = '';
        if (kf) {
          code = codeCard([
            `<span class="sr-syn-kw">@keyframes</span> <span class="sr-syn-sel">${escapeHTML(kf.name)}</span> <span class="sr-syn-punct">{</span>`,
            ...kf.frames.map(f => `  <span class="sr-syn-sel">${escapeHTML(f.key)}</span> <span class="sr-syn-punct">{</span> ${declsInline(f.decls)} <span class="sr-syn-punct">}</span>`),
            '<span class="sr-syn-punct">}</span>'
          ]);
        } else if (live && live.frames.length) {
          // The stylesheet isn't readable (cross-origin): show the keyframes the browser runs
          code = codeCard(frameLines(live.frames));
        }
        return card(
          a.name,
          'CSS Animation',
          '',
          row('duration', a.duration) +
            (parseFloat(a.delay) ? row('delay', a.delay) : '') +
            row('easing', a.easing) +
            row('iterations', a.iterations) +
            (a.direction !== 'normal' ? row('direction', a.direction) : '') +
            (a.fill !== 'none' ? row('fill', a.fill) : '') +
            row('state', live ? liveState(live) : a.playState),
          a.easing,
          code
        );
      }).join(''));
    }

    if (extra.length) {
      body += group(`Playing now (${extra.length})`, extra.map(r => card(
        r.name,
        r.kind === 'Web Animation' ? 'JavaScript' : r.kind,
        r.target,
        row('duration', formatMs(r.duration)) +
          (r.delay ? row('delay', formatMs(r.delay)) : '') +
          row('easing', r.easing) +
          row('iterations', formatIterations(r.iterations)) +
          (r.direction && r.direction !== 'normal' ? row('direction', r.direction) : '') +
          (r.fill && !['none', 'auto'].includes(r.fill) ? row('fill', r.fill) : '') +
          row('state', liveState(r)),
        r.easing,
        r.frames.length ? codeCard(frameLines(r.frames)) : ''
      )).join(''));
    }

    if (info.transitions.length) {
      body += group(
        `Transitions (${info.transitions.length})`,
        '<div class="sr-sp-anim-note">Play when these properties change, e.g. on hover or focus.</div>' +
          info.transitions.map(t => card(
            t.prop,
            'Transition',
            '',
            row('duration', t.duration) + (parseFloat(t.delay) ? row('delay', t.delay) : '') + row('easing', t.easing),
            t.easing
          )).join('')
      );
    }

    if (info.stateRules.length) {
      body += group(`Hover / focus / active styles (${info.stateRules.length})`, info.stateRules.map(r => `
        <div class="sr-sp-anim-card">
          <div class="sr-sp-anim-head">
            <span class="sr-sp-anim-name">${escapeHTML(r.states.map(s => `:${s}`).join(' '))}</span>
            <span class="sr-sp-anim-badge">State</span>
          </div>
          ${codeCard([
            `<span class="sr-syn-sel">${escapeHTML(r.selector)}</span> <span class="sr-syn-punct">{</span>`,
            ...r.decls.map(([p, v]) => highlightCSSDecl(p, v)),
            '<span class="sr-syn-punct">}</span>'
          ])}
        </div>`).join(''));
    }

    return `
      <div class="sr-sp-sec">
        <div class="sr-sp-sec-hdr">
          <div class="sr-sp-sec-title-wrap">
            <svg class="sr-sp-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>
            <span class="sr-sp-sec-title">Animations (${count})</span>
          </div>
          <div class="sr-sp-sec-ctrls sr-sp-anim-ctrls">
            ${info.running.length ? '<button class="sr-sp-btn-sm" id="sr-sp-anim-replay" title="Restart the animations that are playing">Replay</button>' : ''}
            <button class="sr-sp-btn-sm" id="sr-sp-anim-rescan" title="Scan this element again">Rescan</button>
          </div>
        </div>
        <div class="sr-sp-sec-content">${body}</div>
      </div>`;
  }

  // Everything found, as CSS that can be pasted into a stylesheet.
  // `extra` can add resting values to the element's rule and a measured hover rule.
  function animationInfoToCss(info, sel, extra = {}) {
    const blocks = [];
    const decls = Object.entries(extra.resting || {}).map(([p, v]) => `  ${p}: ${v};`);
    if (info.transitions.length) {
      decls.push(`  transition: ${info.transitions.map(t => [t.prop, t.duration, t.easing, parseFloat(t.delay) ? t.delay : ''].filter(Boolean).join(' ')).join(',\n    ')};`);
    }
    if (info.cssAnimations.length) {
      decls.push(`  animation: ${info.cssAnimations.map(a => [a.name, a.duration, a.easing, a.delay, a.iterations, a.direction, a.fill].join(' ')).join(',\n    ')};`);
    }
    if (decls.length) blocks.push(`${sel} {\n${decls.join('\n')}\n}`);
    const hoverValues = Object.entries(extra.hoverValues || {});
    if (extra.hoverSelector && hoverValues.length) {
      blocks.push(`/* measured while the pointer was over it */\n${extra.hoverSelector} {\n${hoverValues.map(([p, v]) => `  ${p}: ${v};`).join('\n')}\n}`);
    }
    info.stateRules.forEach(r => {
      blocks.push(`${r.selector} {\n${r.decls.map(([p, v]) => `  ${p}: ${v};`).join('\n')}\n}`);
    });
    const written = new Set();
    info.keyframes.forEach(k => {
      written.add(k.name);
      blocks.push(`@keyframes ${k.name} {\n${k.frames.map(f => `  ${f.key} { ${f.decls.map(([p, v]) => `${p}: ${v};`).join(' ')} }`).join('\n')}\n}`);
    });
    // Keyframes the stylesheets didn't provide: cross-origin CSS, JavaScript animations, and
    // animations on pseudo-elements or elements inside this one
    // …and the rule that plays them, so the pasted CSS actually runs
    const ruled = new Set();
    info.running.forEach((r, i) => {
      if (r.kind === 'Transition' || !r.frames.length) return;
      const name = r.kind === 'CSS Animation' || /^[a-z_][\w-]*$/i.test(r.name) ? r.name : `animation-${i + 1}`;
      if (!written.has(name)) {
        written.add(name);
        const frames = r.frames
          .map(f => `  ${round1((f.offset || 0) * 100)}% { ${f.props.map(([p, v]) => `${toKebab(p)}: ${v};`).join(' ')} }`)
          .join('\n');
        const note = r.kind === 'Web Animation' ? '/* created by JavaScript (Web Animations API) */\n' : '';
        blocks.push(`${note}@keyframes ${name} {\n${frames}\n}`);
      }
      // The element's own declared CSS animations are already in its rule above
      const own = !r.targetEl && !r.pseudo;
      if (own && r.kind === 'CSS Animation' && info.cssAnimations.some(a => a.name === r.name)) return;
      const ruleSel = `${r.targetEl ? selector(r.targetEl, true) : sel}${r.pseudo}`;
      if (ruled.has(ruleSel)) return;
      ruled.add(ruleSel);
      const fill = r.fill === 'auto' ? 'none' : r.fill;
      blocks.push(`${ruleSel} {\n  animation: ${name} ${formatMs(r.duration)} ${r.easing} ${formatMs(r.delay)} ${formatIterations(r.iterations)} ${r.direction} ${fill};\n}`);
    });
    return blocks.join('\n\n');
  }

  // A self-contained brief of the element's motion, written to be pasted into an AI assistant.
  // Built when "Copy for AI" is clicked: the pointer is then on the panel, so values read now
  // are the element's resting ones and can be compared with those seen when it was selected.
  function animationInfoToPrompt(info, el) {
    const doc = el.ownerDocument;
    const win = doc.defaultView || window;
    const cs = win.getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    const sel = selector(el, true);
    const text = (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ');
    const extra = extraRunningAnimations(info);

    const props = motionProps(info);
    const declared = info.transitions.map(t => t.prop).filter(p => p !== 'all');
    const resting = settledValues(el, props);
    const hovered = {};
    if (info.hoveredAtSelection && info.valuesAtSelection) {
      props.forEach(p => {
        const seen = info.valuesAtSelection[p];
        if (seen && seen !== resting[p]) hovered[p] = seen;
      });
    }
    const hoverChanges = Object.keys(hovered);
    // Tailwind-style "group" parents are the usual hover trigger for effects like this
    const groupParent = el.parentElement ? el.parentElement.closest('.group, [class*="group/"]') : null;
    const hoverSelector = groupParent ? `${selector(groupParent, true)}:hover ${sel}` : `${sel}:hover`;

    const parents = [];
    for (let p = el.parentElement; p && p !== doc.body && parents.length < 3; p = p.parentElement) {
      parents.push(`<${p.tagName.toLowerCase()}${p.getAttribute('class') ? ` class="${p.getAttribute('class')}"` : ''}>`);
    }
    const look = [
      ['background-color', parseColor(cs.backgroundColor) ? cs.backgroundColor : ''],
      ['backdrop-filter', cs.backdropFilter && cs.backdropFilter !== 'none' ? cs.backdropFilter : ''],
      ['filter', cs.filter !== 'none' ? cs.filter : ''],
      ['border-radius', cs.borderRadius !== '0px' ? cs.borderRadius : ''],
      ['box-shadow', cs.boxShadow !== 'none' ? cs.boxShadow : '']
    ].filter(([, v]) => v);
    const unreadableSheets = Array.from(doc.styleSheets).filter(s => {
      try {
        return !s.cssRules;
      } catch (_) {
        return true;
      }
    }).length;

    const out = [
      'Recreate this animation from a web page. Match the timing, easing, values and trigger exactly.',
      '',
      '## Element',
      `- Page: ${win.location.origin}${win.location.pathname}`,
      `- Tag: <${el.tagName.toLowerCase()}>${text ? `, text: "${text.length > 80 ? `${text.slice(0, 80)}…` : text}"` : ''}`,
      `- Classes: ${el.getAttribute('class') || '(none)'}`,
      `- Size: ${round1(rect.width)} × ${round1(rect.height)} px`
    ];
    if (parents.length) out.push(`- Parents (nearest first): ${parents.join(' › ')}`);
    if (look.length) out.push(`- Look: ${look.map(([p, v]) => `${p}: ${v}`).join('; ')}`);

    const changeLines = [];
    hoverChanges.forEach(p => {
      const trigger = groupParent ? 'its nearest parent with class "group"' : 'it';
      changeLines.push(`- ${p}: ${resting[p]} → ${hovered[p]} while the pointer is over ${trigger} (measured)`);
    });
    declared.filter(p => !(p in hovered) && resting[p]).forEach(p => changeLines.push(`- ${p}: ${resting[p]} at rest`));
    if (changeLines.length) out.push('', '## What changes', ...changeLines);

    if (info.cssAnimations.length) {
      out.push('', '## CSS animations');
      info.cssAnimations.forEach(a => {
        out.push(`- ${a.name}: duration ${a.duration}, easing ${a.easing}, delay ${a.delay}, iterations ${a.iterations}, direction ${a.direction}, fill-mode ${a.fill}`);
      });
    }
    if (extra.length) {
      out.push('', '## Also animating');
      extra.forEach(r => {
        const kind = r.kind === 'Web Animation' ? 'JavaScript animation (Web Animations API)' : r.kind;
        let where = r.pseudo ? ` on its ${r.pseudo}` : '';
        if (r.targetEl) {
          where = ` on a <${r.targetEl.tagName.toLowerCase()}${r.pseudo}> inside it (classes: "${r.targetEl.getAttribute('class') || ''}", ${r.targetEl.children.length} children)`;
        }
        out.push(`- ${kind} "${r.name}"${where}: duration ${formatMs(r.duration)}, easing ${r.easing}, delay ${formatMs(r.delay)}, iterations ${formatIterations(r.iterations)}, direction ${r.direction}, fill ${r.fill}`);
      });
    }
    if (info.transitions.length) {
      out.push('', '## Transitions (they run when these properties change, e.g. on hover or focus)');
      info.transitions.forEach(t => {
        out.push(`- ${t.prop}: ${t.duration} ${t.easing}${parseFloat(t.delay) ? `, delay ${t.delay}` : ''}`);
      });
    }
    if (info.stateRules.length) {
      out.push('', '## Interaction states');
      info.stateRules.forEach(r => {
        out.push(`- ${r.states.map(s => `:${s}`).join(' ')} changes ${r.decls.map(([p]) => p).join(', ')}`);
      });
    }
    if (!info.stateRules.length && unreadableSheets) {
      out.push('', `Note: ${unreadableSheets} of the site's stylesheets come from another domain and can't be read, so hover/focus rules are taken from the measured values and class names above.`);
    }

    const restingDecls = {};
    [...declared, ...hoverChanges].forEach(p => {
      if (resting[p]) restingDecls[p] = resting[p];
    });
    const css = animationInfoToCss(info, sel, { resting: restingDecls, hoverSelector: hoverChanges.length ? hoverSelector : '', hoverValues: hovered });
    out.push('', '## CSS', '```css', css, '```');
    out.push('', 'Give me code that reproduces this animation: plain CSS, or the equivalent for my framework if I name one.');
    return out.join('\n');
  }

  // ── Measuring with the side panel open ───────────────────────
  // While the side panel is open it narrows the page to make room for itself, so everything laid
  // out to the viewport — a full-width header, a percentage, a clamp() — measures smaller than it
  // really is. The push is taken off for the moment of measuring and put straight back, in one
  // synchronous task, so no frame is ever painted without it and nothing moves on screen.
  function withRealWidth(measure) {
    const doc = document;
    const pushed = [doc.documentElement, doc.body].filter(node => node && node.classList.contains('sr-sp-pushed'));
    if (!pushed.length) return measure();
    const fit = document.getElementById('sr-fit-style');
    if (fit) fit.disabled = true;
    pushed.forEach(node => node.classList.add('sr-measuring'));
    pushed.forEach(node => node.classList.remove('sr-sp-pushed'));
    void doc.documentElement.offsetWidth; // lay the page out at its real width
    try {
      return measure();
    } finally {
      pushed.forEach(node => node.classList.add('sr-sp-pushed'));
      if (fit) fit.disabled = false;
      void doc.documentElement.offsetWidth;
      pushed.forEach(node => node.classList.remove('sr-measuring'));
    }
  }

  // ── Export: the selected section as code ────────────────────
  // The card under the element header. The section is read once the pointer has left it (so a
  // hover isn't taken for its resting look); a live copy is shown that can be hovered and
  // widened or narrowed to other screens, and that copy is measured against the page before
  // anything is copied. The engine is export.js (window.DTExport), injected just before this file.
  const XP_FORMATS = [['tailwind', 'Tailwind'], ['html', 'HTML'], ['react', 'React'], ['vue', 'Vue'], ['elementor', 'Elementor']];
  // Screens the copy can be tried on. `page` is the section at the width it has on this page.
  const XP_DEVICES = [
    ['page', 'Fit', 'As it sits on this page', null],
    ['phone', 'Phone', 'Phone', { width: 390, height: 844 }],
    ['tablet', 'Tablet', 'Tablet', { width: 820, height: 1180 }],
    ['desktop', 'Desktop', 'Desktop', { width: 1440, height: 900 }]
  ];
  const XP_FILE = { tailwind: '.html', html: '.html', react: '.jsx', vue: '.vue', elementor: '.json' };
  const XP_ICON = {
    code: '<path d="M8 6l-6 6 6 6M16 6l6 6-6 6"/>',
    expand: '<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>',
    page: '<path d="M5 4l6 15.5 2.2-6.3L19.5 11z"/>',
    desktop: '<rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>',
    tablet: '<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M11 18h2"/>',
    phone: '<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>',
    copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    download: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
    back: '<path d="M19 12H5M11 18l-6-6 6-6"/>',
    replay: '<path d="M3 12a9 9 0 1 0 2.6-6.4L3 8"/><path d="M3 3v5h5"/>',
    minus: '<path d="M5 12h14"/>',
    plus: '<path d="M12 5v14M5 12h14"/>'
  };
  // The formats' own marks, in their own colours
  const XP_LOGO = {
    tailwind: '<svg class="sr-xp-logo" viewBox="0 0 24 24" aria-hidden="true"><path fill="#38bdf8" d="M12 4.8c-3.2 0-5.2 1.6-6 4.8 1.2-1.6 2.6-2.2 4.2-1.8.91.23 1.57.89 2.29 1.62C13.67 10.62 15.03 12 18 12c3.2 0 5.2-1.6 6-4.8-1.2 1.6-2.6 2.2-4.2 1.8-.91-.23-1.57-.89-2.29-1.62C16.34 6.18 14.98 4.8 12 4.8zM6 12c-3.2 0-5.2 1.6-6 4.8 1.2-1.6 2.6-2.2 4.2-1.8.91.23 1.57.89 2.29 1.62C7.67 17.82 9.03 19.2 12 19.2c3.2 0 5.2-1.6 6-4.8-1.2 1.6-2.6 2.2-4.2 1.8-.91-.23-1.57-.89-2.29-1.62C10.34 13.38 8.98 12 6 12z"/></svg>',
    html: '<svg class="sr-xp-logo" viewBox="0 0 24 24" aria-hidden="true"><path fill="#e34f26" d="M1.5 0h21l-1.91 21.563L11.977 24l-8.564-2.438L1.5 0zm7.031 9.75l-.232-2.718 10.059.003.23-2.622L5.412 4.41l.698 8.01h9.126l-.326 3.426-2.91.804-2.955-.81-.188-2.11H6.248l.33 4.171L12 19.351l5.379-1.443.744-8.157H8.531z"/></svg>',
    react: '<svg class="sr-xp-logo" viewBox="-11.5 -10.23 23 20.46" aria-hidden="true"><circle r="2.05" fill="#61dafb"/><g fill="none" stroke="#61dafb" stroke-width="1"><ellipse rx="11" ry="4.2"/><ellipse rx="11" ry="4.2" transform="rotate(60)"/><ellipse rx="11" ry="4.2" transform="rotate(120)"/></g></svg>',
    vue: '<svg class="sr-xp-logo" viewBox="0 0 24 24" aria-hidden="true"><path fill="#41b883" d="M24 1.61h-9.94L12 5.16 9.94 1.61H0L12 22.39 24 1.61zM12 14.08 5.16 2.23h4.43L12 6.41l2.41-4.18h4.43L12 14.08z"/></svg>',
    elementor: '<svg class="sr-xp-logo" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="12" fill="#92003b"/><path fill="#ffffff" d="M7.5 6.5h2.2v11H7.5zM11.5 6.5h5v2.2h-5zM11.5 10.9h5v2.2h-5zM11.5 15.3h5v2.2h-5z"/></svg>'
  };
  const xpSvg = (name, width = 1.8) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${XP_ICON[name]}</svg>`;
  const xpLabel = format => (XP_FORMATS.find(([k]) => k === format) || XP_FORMATS[0])[1];
  const xpDeviceDef = () => XP_DEVICES.find(([k]) => k === xpDevice) || XP_DEVICES[0];
  const xpDeviceSize = () => xpDeviceDef()[3];
  const xpCard = () => (spContentArea ? spContentArea.querySelector('#sr-xp') : null);

  let xpFormat = 'tailwind';
  try {
    // taken over from an older version's copy in the page's own storage, once
    const saved = localStorage.getItem('sr_export_format');
    if (XP_FORMATS.some(([k]) => k === saved)) {
      xpFormat = saved;
      rememberPref('sr_export_format', saved);
    }
    localStorage.removeItem('sr_export_format');
  } catch (_) {}
  try {
    chrome.storage.local.get('sr_export_format').then(r => {
      if (r && XP_FORMATS.some(([k]) => k === r.sr_export_format)) xpFormat = r.sr_export_format;
    }).catch(() => {});
  } catch (_) {}
  let xpDevice = 'page';
  let xpJob = null; // the section being exported: { el, exp, result, state, alive }
  let xpPreview = null; // the live copy in the card
  let xpModal = null; // the full-screen preview, while it's open

  const xpDeviceButtons = () => XP_DEVICES.map(([k, label, title]) => `<button type="button" data-dev="${k}" aria-pressed="${k === xpDevice}" title="${title}" aria-label="${title}">${xpSvg(k)}<span>${label}</span></button>`).join('');
  const xpFormatTiles = () => XP_FORMATS.map(([k, label]) => `<button type="button" role="tab" class="sr-xp-tile" data-fmt="${k}" aria-selected="${k === xpFormat}">${XP_LOGO[k]}<span>${label}</span></button>`).join('');

  function exportCardHTML() {
    return `
      <div class="sr-xp" id="sr-xp" role="region" aria-label="Export this section as code">
        <div class="sr-xp-top">
          <div class="sr-xp-title">${xpSvg('code', 2)}<span>Export code</span></div>
          <button class="sr-xp-match" id="sr-xp-match" type="button" data-state="busy" aria-expanded="false" aria-controls="sr-xp-issues">Reading…</button>
          <button class="sr-xp-open" id="sr-xp-open" type="button" title="See it full size, on a phone, a tablet and a desktop" disabled>${xpSvg('expand')}<span>Preview</span></button>
        </div>
        <div class="sr-xp-issues" id="sr-xp-issues" hidden></div>
        <div class="sr-xp-allow" id="sr-xp-allow" hidden>
          <div class="sr-xp-allow-text" id="sr-xp-allow-text"></div>
          <button class="sr-xp-allow-btn" id="sr-xp-allow-btn" type="button">Allow reading</button>
        </div>
        <div class="sr-xp-stage">
          <div class="sr-xp-view" id="sr-xp-view"></div>
          <div class="sr-xp-wait" id="sr-xp-wait"><span class="sr-xp-spin"></span><span id="sr-xp-wait-text">Building a live copy…</span></div>
        </div>
        <div class="sr-xp-size" id="sr-xp-size"></div>
        <div class="sr-xp-tiles" role="tablist" aria-label="Code format">${xpFormatTiles()}</div>
        <div class="sr-xp-actions">
          <button class="sr-xp-main" id="sr-xp-main" type="button" disabled></button>
          <button class="sr-xp-alt sr-xp-alt-text" id="sr-xp-alt" type="button" disabled></button>
        </div>
        <div class="sr-xp-note" id="sr-xp-note" hidden></div>
      </div>`;
  }

  // Two equal buttons named for the chosen format: copy it, or download it as a file.
  function xpPaintActions(scope) {
    if (!scope) return;
    const elementor = xpFormat === 'elementor';
    const ready = !!(xpJob && xpJob.exp);
    const label = xpLabel(xpFormat);
    scope.querySelectorAll('.sr-xp-main').forEach(main => {
      setHTML(main, `${xpSvg('copy')}<span>Copy ${label}</span>`);
      main.title = `Copy the ${label} code`;
      main.disabled = !ready;
    });
    scope.querySelectorAll('.sr-xp-alt').forEach(alt => {
      setHTML(alt, `${xpSvg('download')}${alt.classList.contains('sr-xp-alt-text') ? `<span>Download ${label}</span>` : ''}`);
      alt.title = `Download as a ${XP_FILE[xpFormat]} file`;
      alt.setAttribute('aria-label', `Download ${label}`);
      alt.disabled = !ready;
    });
    scope.querySelectorAll('[data-fmt]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.fmt === xpFormat)));
    const note = scope.querySelector('#sr-xp-note');
    if (note) {
      note.hidden = !elementor;
      note.textContent = elementor ? 'In WordPress, open Templates → Saved Templates → Import and pick this file. Works with free Elementor.' : '';
    }
    const open = scope.querySelector('#sr-xp-open');
    if (open) open.disabled = !ready;
  }

  function xpPaintSize(card) {
    const el = card && card.querySelector('#sr-xp-size');
    if (!el || !xpJob || !xpJob.exp) return;
    const s = xpJob.exp.size();
    const hover = xpJob.exp.model.nodes.some(n => n.states.length);
    el.textContent = `${Math.round(s.width)} × ${Math.round(s.height)}${hover ? ' · hover the copy to try its states' : ''}`;
  }

  function xpMatch(match) {
    if (!match || !xpJob) return;
    const s = xpJob.state;
    if (s !== 'ready') {
      match.dataset.state = s === 'failed' ? 'low' : 'busy';
      match.textContent = { waiting: 'Waiting', reading: 'Reading…', measuring: 'Measuring…', failed: "Couldn't read" }[s] || 'Reading…';
      match.removeAttribute('title');
      return;
    }
    const r = xpJob.result;
    // rounded down, so it never claims more than was measured
    const pct = r ? Math.floor(r.score) : null;
    match.dataset.state = pct === null ? 'fair' : pct >= 97 ? 'good' : pct >= 90 ? 'fair' : 'low';
    match.textContent = pct === null ? 'Ready' : `${pct}% match`;
    match.title = 'Measured: the copy is drawn beside the page and compared element by element. Click for details.';
  }

  function xpPaint(card) {
    if (!card || !xpJob) return;
    xpMatch(card.querySelector('#sr-xp-match'));
    const issues = card.querySelector('#sr-xp-issues');
    if (issues && xpJob.state === 'ready') {
      const list = xpJob.result ? xpJob.result.issues : [];
      setHTML(issues, list.length
        ? list.map(i => `<div class="sr-xp-issue">${escapeHTML(i)}</div>`).join('')
        : `<div class="sr-xp-issue sr-ok">Every element sits where the page draws it, in the same colours and type.</div>`);
    }
    // The site's styles are on a server that won't let pages read them: offer to read them anyway
    const allow = card.querySelector('#sr-xp-allow');
    if (allow) {
      const needs = xpJob.needs || [];
      allow.hidden = !needs.length;
      if (needs.length) {
        const hosts = needs.map(o => o.replace(/^https?:\/\//, ''));
        card.querySelector('#sr-xp-allow-text').textContent = `This site keeps its styles on ${hosts.slice(0, 2).join(' and ')}${hosts.length > 2 ? ` and ${hosts.length - 2} more` : ''}. Allow reading them for an exact copy, with its breakpoints, hover states and fonts.`;
      }
    }
    const wait = card.querySelector('#sr-xp-wait');
    const waitText = card.querySelector('#sr-xp-wait-text');
    if (wait && !xpJob.exp) {
      wait.hidden = false;
      wait.classList.toggle('sr-failed', xpJob.state === 'failed');
      if (waitText) {
        waitText.textContent = xpJob.state === 'waiting' ? 'Move the pointer off the section so it can be read at rest'
          : xpJob.state === 'failed' ? 'This section could not be read. Try its parent or a child.'
          : 'Building a live copy…';
      }
    }
    xpPaintSize(card);
  }

  function xpMount(card) {
    if (xpPreview) { xpPreview.destroy(); xpPreview = null; }
    const view = card && card.querySelector('#sr-xp-view');
    if (!view || !xpJob || !xpJob.exp) return;
    const preview = xpJob.exp.mountPreview(view, { device: null });
    xpPreview = preview;
    preview.ready.then(() => {
      if (xpPreview !== preview) return;
      const wait = card.querySelector('#sr-xp-wait');
      if (wait) wait.hidden = true;
      xpPaintSize(card);
    });
  }

  // Taken off the panel before it re-renders. A re-render for the same section (switching the
  // code format, say) keeps what was read; only the live copy is mounted again.
  function xpDetach() {
    if (xpPreview) { xpPreview.destroy(); xpPreview = null; }
  }

  function xpCancel() {
    xpDetach();
    if (xpModal) xpModal.close();
    if (xpJob) xpJob.alive = false;
    xpJob = null;
  }

  // The page's stylesheets on other servers are fetched once the toolkit opens, while the person is
  // still choosing a section, so reading it later doesn't wait on the network.
  let xpWarmed = false;
  function xpWarmUp() {
    if (xpWarmed || !window.DTExport) return;
    xpWarmed = true;
    const run = () => { try { window.DTExport.prepare(document, { fetchText: url => sendRuntimeMessage({ type: 'SR_CSS_FETCH', url }) }).catch(() => {}); } catch (_) {} };
    if (window.requestIdleCallback) window.requestIdleCallback(run, { timeout: 1500 }); else setTimeout(run, 300);
  }

  // A picture of a canvas the page won't give up (it draws pictures from other sites): the tab is
  // shown with only that canvas visible, captured, and cropped to the canvas. The page is put back
  // as it was, scroll position included.
  async function xpShootCanvas(canvas) {
    const frames = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const scroll = { x: window.scrollX, y: window.scrollY };
    const hide = document.createElement('style');
    hide.textContent = '*,*::before,*::after{visibility:hidden!important}[data-sr-xp-shot]{visibility:visible!important}';
    canvas.setAttribute('data-sr-xp-shot', '');
    try {
      // where it already is in the window the page isn't moved (and the wait for it is saved)
      const seen = canvas.getBoundingClientRect();
      if (seen.top < 0 || seen.left < 0 || seen.bottom > window.innerHeight || seen.right > window.innerWidth) {
        canvas.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
        await frames();
      }
      const r = canvas.getBoundingClientRect();
      const x0 = Math.max(0, r.left), y0 = Math.max(0, r.top);
      const x1 = Math.min(window.innerWidth, r.right), y1 = Math.min(window.innerHeight, r.bottom);
      if (x1 - x0 < 8 || y1 - y0 < 8) return null;
      document.documentElement.appendChild(hide);
      await frames();
      const res = await sendRuntimeMessage({ type: 'SR_CAPTURE_TAB' });
      if (!res || !res.url) return null;
      const img = new Image();
      await new Promise((ok, no) => { img.onload = ok; img.onerror = no; img.src = res.url; });
      const k = img.naturalWidth / window.innerWidth;
      const out = document.createElement('canvas');
      // as large as the canvas itself, never more: it is shown at the size the page gives it
      const scale = Math.min(1, (canvas.width || canvas.videoWidth || r.width) / Math.max(1, r.width));
      // the whole canvas box; a part scrolled out of the window stays empty rather than stretching
      out.width = Math.max(1, Math.round(r.width * k * scale));
      out.height = Math.max(1, Math.round(r.height * k * scale));
      const g = out.getContext('2d');
      g.imageSmoothingQuality = 'high';
      g.drawImage(img, x0 * k, y0 * k, (x1 - x0) * k, (y1 - y0) * k, (x0 - r.left) * k * scale, (y0 - r.top) * k * scale, (x1 - x0) * k * scale, (y1 - y0) * k * scale);
      // a photograph of the tab: JPEG is a fraction of the size and encodes faster; PNG only where
      // part of the canvas is out of the window and the rest has to stay transparent
      const whole = x1 - x0 >= r.width - 1 && y1 - y0 >= r.height - 1;
      return whole ? out.toDataURL('image/jpeg', 0.9) : out.toDataURL('image/png');
    } catch (_) {
      return null;
    } finally {
      hide.remove();
      canvas.removeAttribute('data-sr-xp-shot');
      window.scrollTo(scroll.x, scroll.y);
    }
  }

  async function xpRun(job) {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const started = Date.now();
    // Arrow keys walk the tree quickly; read only where they stop.
    await wait(120);
    // Read it at rest: with the pointer over it, hover styles are in force, and a transition
    // still running would be caught halfway.
    while (job.alive && Date.now() - started < 8000) {
      let busy = false;
      try {
        busy = job.el.matches(':hover');
        // a transition gets a moment to finish; one that never does (a loop a script keeps
        // restarting) isn't waited for
        if (!busy && Date.now() - started < 1500 && job.el.getAnimations) {
          busy = job.el.getAnimations({ subtree: true }).some(a => a.constructor && a.constructor.name === 'CSSTransition' && a.playState === 'running');
        }
      } catch (_) {}
      if (!busy) break;
      if (Date.now() - started > 900 && job.state !== 'waiting') {
        job.state = 'waiting';
        xpPaint(xpCard());
      }
      await wait(80);
    }
    if (!job.alive) return;
    job.state = 'reading';
    xpPaint(xpCard());
    await new Promise(r => requestAnimationFrame(() => r())); // let "Reading…" paint before the work starts
    try {
      if (!window.DTExport) throw new Error('export engine missing');
      // stylesheets on servers that don't allow reading are fetched by the worker, where allowed
      const prep = await window.DTExport.prepare(document, { fetchText: url => sendRuntimeMessage({ type: 'SR_CSS_FETCH', url }), root: job.el, shoot: xpShootCanvas });
      job.needs = (prep && prep.needs) || [];
      if (!job.alive || !job.el.isConnected) return;
      job.exp = window.DTExport.build(job.el, { withRealWidth });
    } catch (error) {
      if (!job.alive) return;
      job.state = 'failed';
      xpPaint(xpCard());
      return;
    }
    if (!job.alive) return;
    job.state = 'measuring';
    const card = xpCard();
    xpPaintActions(card);
    xpMount(card);
    xpPaint(card);
    try {
      job.result = await job.exp.measure();
    } catch (_) {
      job.result = null;
    }
    if (!job.alive) return;
    job.state = 'ready';
    xpPaint(xpCard());
    // anything pinned while measuring changes the code, so the copies are drawn again
    if (job.result && job.result.pinned) {
      if (xpPreview) xpPreview.refresh();
      if (xpModal) xpModal.refresh();
    }
    if (xpModal) xpModal.paint();
  }

  function xpFlash(btn) {
    if (!btn) return;
    btn.classList.add('sr-ok');
    clearTimeout(btn._srFlash);
    btn._srFlash = setTimeout(() => btn.classList.remove('sr-ok'), 1400);
  }

  async function xpCopyText(btn) {
    const job = xpJob;
    if (!job || !job.exp) return;
    let text;
    try {
      text = job.exp.text(xpFormat);
    } catch (_) {
      showToast(`Could not write this section as ${xpLabel(xpFormat)}`);
      return;
    }
    if (await copyText(text)) {
      xpFlash(btn);
      showToast(`Copied as ${xpLabel(xpFormat)} · ${text.split('\n').length.toLocaleString()} lines`);
    } else {
      showToast('Could not copy. Click the page once, then try again.');
    }
  }

  async function xpDownload(btn) {
    const job = xpJob;
    if (!job || !job.exp) return;
    let file;
    try {
      // async: the site's own font files are written into the download
      file = await job.exp.file(xpFormat);
    } catch (_) {
      showToast(`Could not write this section as ${xpLabel(xpFormat)}`);
      return;
    }
    const url = URL.createObjectURL(new Blob([file.text], { type: file.mime }));
    saveWithLink(url, file.name);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    xpFlash(btn);
    showToast(`Saved ${file.name}`);
  }

  // One handler set for the card and the full-screen preview: data-fmt picks a format, data-dev
  // a screen, and the two action buttons do what xpPaintActions labelled them with.
  function xpWireControls(scope) {
    scope.querySelectorAll('[data-fmt]').forEach(b => b.addEventListener('click', () => {
      xpFormat = b.dataset.fmt;
      rememberPref('sr_export_format', xpFormat);
      xpPaintActions(xpCard());
      if (xpModal) xpModal.paint();
    }));
    scope.querySelectorAll('[data-dev]').forEach(b => b.addEventListener('click', () => {
      if (xpDevice === b.dataset.dev) return;
      xpDevice = b.dataset.dev;
      scope.querySelectorAll('[data-dev]').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.dev === xpDevice)));
      if (xpModal) xpModal.showDevice();
    }));
    scope.querySelectorAll('.sr-xp-main').forEach(b => b.addEventListener('click', () => xpCopyText(b)));
    scope.querySelectorAll('.sr-xp-alt').forEach(b => b.addEventListener('click', () => xpDownload(b)));
  }

  function wireExport(root, targetEl) {
    const card = root.querySelector('#sr-xp');
    if (!card || !targetEl) return;
    if (!xpJob || xpJob.el !== targetEl || !xpJob.alive || xpJob.state === 'failed') {
      xpCancel();
      xpJob = { el: targetEl, exp: null, result: null, state: 'reading', alive: true };
      xpRun(xpJob);
    } else if (xpJob.exp) {
      xpMount(card);
    }
    xpPaintActions(card);
    xpPaint(card);
    xpWireControls(card);
    card.querySelector('#sr-xp-open').addEventListener('click', openExportModal);
    card.querySelector('#sr-xp-allow-btn').addEventListener('click', () => {
      if (!xpJob || !xpJob.needs || !xpJob.needs.length) return;
      sendRuntimeMessage({ type: 'SR_CSS_GRANT', origins: xpJob.needs });
    });
    const match = card.querySelector('#sr-xp-match');
    match.addEventListener('click', () => {
      if (!xpJob || xpJob.state !== 'ready') return;
      const issues = card.querySelector('#sr-xp-issues');
      issues.hidden = !issues.hidden;
      match.setAttribute('aria-expanded', String(!issues.hidden));
    });
  }

  // Light colouring for the code view: tags, attribute names, strings, comments.
  function xpHighlight(text) {
    const re = /(<!--[\s\S]*?-->|\/\*[\s\S]*?\*\/|^\s*\/\/[^\n]*)|("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`[^`]*`)|(<\/?[A-Za-z][\w:.-]*|\/?>)|(\s[@:A-Za-z_][\w:.-]*)(?==)|(#[0-9a-fA-F]{3,8}\b|-?\b\d*\.?\d+(?:px|rem|em|%|s|ms|vh|vw|deg)?\b)/gm;
    let out = '', last = 0, m;
    while ((m = re.exec(text))) {
      out += escapeHTML(text.slice(last, m.index));
      const cls = m[1] ? 'sr-syn-cmt' : m[2] ? 'sr-syn-str' : m[3] ? 'sr-syn-kw' : m[4] ? 'sr-syn-prop' : 'sr-syn-num';
      out += `<span class="${cls}">${escapeHTML(m[0])}</span>`;
      last = re.lastIndex;
    }
    return out + escapeHTML(text.slice(last));
  }

  // The chrome drawn around each screen in the full-screen preview, in px: the bezel all round,
  // anything below it (a laptop's base) and how far that base reaches past the sides.
  const XP_FRAME = {
    page: { bezel: 0, below: 0, wider: 0 },
    phone: { bezel: 12, below: 0, wider: 0, status: 46 },
    tablet: { bezel: 16, below: 0, wider: 0 },
    desktop: { bezel: 14, below: 20, wider: 70 }
  };
  const XP_ZOOMS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.25, 1.5, 2];

  // The full-screen preview: the copy on its own, at the page's width or inside a phone, tablet
  // or desktop, with the code a click away. Nothing on the page underneath is touched.
  function openExportModal() {
    if (!xpJob || !xpJob.exp || xpModal) return;
    const job = xpJob;
    const opener = document.activeElement;
    const host = location.hostname.replace(/^www\./, '') || 'this page';
    const iconLink = document.querySelector('link[rel~="icon"][href]');
    const favicon = iconLink ? iconLink.href : `${location.origin}/favicon.ico`;
    const wrap = document.createElement('div');
    wrap.id = 'sr-xp-modal';
    wrap.className = 'sr-xpm';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    wrap.setAttribute('aria-label', 'Preview of the exported section');
    setHTML(wrap, `
      <div class="sr-xpm-bar" role="toolbar" aria-label="Preview">
        <button class="sr-xpm-btn sr-xpm-back" type="button" title="Back to the page (Esc)">${xpSvg('back', 2)}<span>Back</span></button>
        <div class="sr-xpm-site" title="${escapeHTML(selector(job.el))}">
          <img class="sr-xpm-favicon" alt="" src="${escapeHTML(favicon)}">
          <span class="sr-xpm-host">${escapeHTML(host)}</span>
          <span class="sr-xpm-tag">${escapeHTML(job.el.localName)}</span>
        </div>
        <div class="sr-xp-seg sr-xpm-devices" role="group" aria-label="Screen">${xpDeviceButtons()}</div>
        <div class="sr-xpm-zoom" role="group" aria-label="Zoom">
          <button class="sr-xpm-btn sr-xpm-icon" type="button" data-zoom="out" title="Zoom out" aria-label="Zoom out">${xpSvg('minus', 2)}</button>
          <button class="sr-xpm-zoomval" type="button" title="Fit to the window"></button>
          <button class="sr-xpm-btn sr-xpm-icon" type="button" data-zoom="in" title="Zoom in" aria-label="Zoom in">${xpSvg('plus', 2)}</button>
        </div>
        <button class="sr-xpm-btn sr-xpm-icon sr-xpm-replay" type="button" title="Replay its animations" aria-label="Replay its animations">${xpSvg('replay', 2)}</button>
        <button class="sr-xpm-btn sr-xpm-codebtn" type="button" aria-pressed="false" title="Show the code">${xpSvg('code', 2)}<span>Code</span></button>
        <button class="sr-xp-main" type="button"></button>
        <button class="sr-xpm-btn sr-xpm-icon sr-xp-alt" type="button"></button>
      </div>
      <div class="sr-xpm-main">
        <div class="sr-xpm-stage">
          <div class="sr-xpm-fitbox"></div>
          <div class="sr-xpm-caption"></div>
        </div>
        <div class="sr-xpm-drawer" hidden>
          <div class="sr-xp-tiles sr-compact" role="tablist" aria-label="Code format">${xpFormatTiles()}</div>
          <pre class="sr-xpm-pre" tabindex="0"><code></code></pre>
          <div class="sr-xpm-foot">
            <span class="sr-xpm-stats"></span>
            <button class="sr-xp-match" type="button" data-state="busy" tabindex="-1">Reading…</button>
          </div>
        </div>
      </div>`);
    document.documentElement.appendChild(wrap);
    const favImg = wrap.querySelector('.sr-xpm-favicon');
    favImg.addEventListener('error', () => { favImg.hidden = true; }, { once: true });

    const stage = wrap.querySelector('.sr-xpm-stage');
    const fitbox = wrap.querySelector('.sr-xpm-fitbox');
    const caption = wrap.querySelector('.sr-xpm-caption');
    const zoomVal = wrap.querySelector('.sr-xpm-zoomval');
    const drawer = wrap.querySelector('.sr-xpm-drawer');
    const codeBtn = wrap.querySelector('.sr-xpm-codebtn');
    let preview = null;
    let device = null; // the frame element
    let natural = { width: job.exp.size().width, height: job.exp.size().height };
    let zoom = 'fit';
    let scaleNow = 1;

    // The frame's full size at 100%, chrome included.
    const outer = () => {
      const [kind, , , size] = xpDeviceDef();
      const f = XP_FRAME[kind];
      const w = size ? size.width : natural.width;
      const h = size ? size.height : natural.height;
      return { w: w + f.bezel * 2 + f.wider * 2, h: h + f.bezel * 2 + f.below, inner: { w, h } };
    };
    const layout = () => {
      if (!device) return;
      const o = outer();
      const availW = Math.max(160, stage.clientWidth - 80);
      // the stage's padding and the caption under the frame take ~160px of its height
      const availH = Math.max(160, stage.clientHeight - 160);
      const kind = xpDeviceDef()[0];
      // a section on its own fits the width and scrolls; a device fits whole
      const fit = Math.min(1, availW / o.w, kind === 'page' ? Infinity : availH / o.h);
      scaleNow = zoom === 'fit' ? fit : zoom;
      fitbox.style.setProperty('width', `${Math.round(o.w * scaleNow)}px`, 'important');
      fitbox.style.setProperty('height', `${Math.round(o.h * scaleNow)}px`, 'important');
      device.style.setProperty('transform', `scale(${scaleNow})`, 'important');
      // a laptop's base reaches past the screen on both sides
      device.style.setProperty('left', `${XP_FRAME[kind].wider * scaleNow}px`, 'important');
      zoomVal.textContent = zoom === 'fit' ? `Fit · ${Math.round(scaleNow * 100)}%` : `${Math.round(scaleNow * 100)}%`;
      const [, label, , size] = xpDeviceDef();
      caption.textContent = size ? `${label} · ${size.width} × ${size.height}` : `As on the page · ${Math.round(o.inner.w)} × ${Math.round(o.inner.h)}`;
    };
    // Builds the frame for the current screen and puts the copy in it.
    const showDevice = () => {
      if (preview) { preview.destroy(); preview = null; }
      const [kind, , , size] = xpDeviceDef();
      const f = XP_FRAME[kind];
      const light = xpLuminance(job.exp.model.backdrop) > 0.55;
      setHTML(fitbox, `
        <div class="sr-xpm-device" data-kind="${kind}">
          ${kind === 'phone' ? `<div class="sr-xpm-status ${light ? '' : 'sr-dark'}"><span>9:41</span><i class="sr-xpm-island"></i><span class="sr-xpm-bars"><i></i><i></i><i></i></span></div>` : ''}
          <div class="sr-xpm-screen"></div>
          ${kind === 'desktop' ? '<div class="sr-xpm-base"><i></i></div>' : ''}
        </div>`);
      device = fitbox.querySelector('.sr-xpm-device');
      const status = device.querySelector('.sr-xpm-status');
      // the status bar takes the page's own colour, as it does on a phone
      if (status) status.style.setProperty('background', job.exp.model.backdrop, 'important');
      const o = outer();
      device.style.setProperty('width', `${o.w - f.wider * 2}px`, 'important');
      device.style.setProperty('height', `${o.h}px`, 'important');
      const screen = device.querySelector('.sr-xpm-screen');
      const statusH = f.status || 0;
      if (size) {
        screen.style.setProperty('width', `${size.width}px`, 'important');
        screen.style.setProperty('height', `${size.height - statusH}px`, 'important');
        screen.style.setProperty('background', job.exp.model.backdrop, 'important');
      }
      // the screen below a phone's status bar is the viewport the page sees
      const viewport = size ? { width: size.width, height: size.height - statusH } : null;
      preview = job.exp.mountPreview(screen, {
        device: viewport,
        scale: 1,
        screen: !!size,
        onFit: s => {
          if (size || (Math.abs(s.width - natural.width) < 1 && Math.abs(s.height - natural.height) < 1)) return;
          natural = s;
          device.style.setProperty('height', `${outer().h}px`, 'important');
          layout();
        }
      });
      layout();
    };
    const paint = () => {
      wrap.querySelectorAll('.sr-xp-match').forEach(xpMatch);
      xpPaintActions(wrap);
      if (drawer.hidden) return;
      let text = '';
      try { text = job.exp.text(xpFormat); } catch (_) { text = `Could not write this section as ${xpLabel(xpFormat)}.`; }
      const code = wrap.querySelector('.sr-xpm-pre code');
      // very long output is shown plain; colouring it would only slow the view down
      if (text.length > 400000) code.textContent = text; else setHTML(code, xpHighlight(text));
      const kb = new Blob([text]).size / 1024;
      wrap.querySelector('.sr-xpm-stats').textContent = `${text.split('\n').length.toLocaleString()} lines · ${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
    };
    const setZoom = dir => {
      const i = XP_ZOOMS.findIndex(z => z >= scaleNow - 0.001);
      const at = i < 0 ? XP_ZOOMS.length - 1 : i;
      zoom = dir === 'in' ? XP_ZOOMS[Math.min(XP_ZOOMS.length - 1, XP_ZOOMS[at] > scaleNow + 0.001 ? at : at + 1)] : XP_ZOOMS[Math.max(0, at - 1)];
      layout();
    };
    const onKey = e => {
      if (e.key === 'Tab') trapTab(e, wrap);
      if (e.key === 'Escape') { e.preventDefault(); close(); }
      // the toolkit's own shortcuts (pin, parent, child…) wait until this view is closed
      e.stopPropagation();
    };
    const ro = new ResizeObserver(() => layout());
    const close = () => {
      window.removeEventListener('keydown', onKey, true);
      ro.disconnect();
      if (preview) preview.destroy();
      wrap.remove();
      xpModal = null;
      if (opener && opener.focus && opener.isConnected) opener.focus();
    };
    xpModal = { root: wrap, paint, close, showDevice, refresh: () => preview && preview.refresh() };

    xpWireControls(wrap);
    wrap.querySelector('.sr-xpm-back').addEventListener('click', close);
    wrap.querySelector('.sr-xpm-replay').addEventListener('click', () => preview && preview.refresh());
    wrap.querySelectorAll('[data-zoom]').forEach(b => b.addEventListener('click', () => setZoom(b.dataset.zoom)));
    zoomVal.addEventListener('click', () => {
      zoom = 'fit';
      layout();
    });
    codeBtn.addEventListener('click', () => {
      drawer.hidden = !drawer.hidden;
      codeBtn.setAttribute('aria-pressed', String(!drawer.hidden));
      paint();
    });
    window.addEventListener('keydown', onKey, true);
    ro.observe(stage);
    showDevice();
    paint();
    // focus goes to the view itself, so Esc and Tab work without a ring around the first button
    wrap.tabIndex = -1;
    wrap.focus();
  }

  // 0 for black, 1 for white, from a #rrggbb colour
  function xpLuminance(hex) {
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(hex || '');
    if (!m) return 1;
    const [r, g, b] = [m[1], m[2], m[3]].map(x => parseInt(x, 16) / 255);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  function renderSidePanelElementTab(targetEl) {
    if (!spContentArea) return;
    targetEl = targetEl || sidePanelTargetEl;
    xpDetach();

    // Empty state if nothing (or an element that has since left the page) is selected.
    // <body> stays selectable here: it is listed in the Document tree.
    if (!targetEl || targetEl === document.documentElement || !targetEl.isConnected) {
      xpCancel();
      spContentArea.innerHTML = `
        <div class="sr-sp-empty">
          <svg class="sr-sp-empty-cursor" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 4l7.07 17 2.51-7.39L21 11.07 4 4z"/>
          </svg>
          <div class="sr-sp-empty-title">Click an Element to Select</div>
          <div class="sr-sp-shortcuts-list">
            <div class="sr-sp-shortcut-row"><span>Select Parent</span><span class="sr-sp-badge">↑</span></div>
            <div class="sr-sp-shortcut-row"><span>Select Child</span><span class="sr-sp-badge">↓</span></div>
            <div class="sr-sp-shortcut-row"><span>Toggle Panel</span><span class="sr-sp-badge">O</span></div>
            <div class="sr-sp-shortcut-row"><span>Deselect</span><span class="sr-sp-badge">Esc</span></div>
          </div>
        </div>
      `;
      return;
    }

    const win = (targetEl.ownerDocument && targetEl.ownerDocument.defaultView) ? targetEl.ownerDocument.defaultView : window;
    const cs = win.getComputedStyle(targetEl);
    const rect = targetEl.getBoundingClientRect();
    const W = round1(rect.width);
    const H = round1(rect.height);
    const elSel = selector(targetEl);

    // Box model metrics
    const mt = parseFloat(cs.marginTop) || 0;
    const mr = parseFloat(cs.marginRight) || 0;
    const mb = parseFloat(cs.marginBottom) || 0;
    const ml = parseFloat(cs.marginLeft) || 0;
    const bt = parseFloat(cs.borderTopWidth) || 0;
    const br = parseFloat(cs.borderRightWidth) || 0;
    const bb = parseFloat(cs.borderBottomWidth) || 0;
    const bl = parseFloat(cs.borderLeftWidth) || 0;
    const pt = parseFloat(cs.paddingTop) || 0;
    const pr = parseFloat(cs.paddingRight) || 0;
    const pb = parseFloat(cs.paddingBottom) || 0;
    const pl = parseFloat(cs.paddingLeft) || 0;
    const cW = Math.max(0, W - bl - br - pl - pr);
    const cH = Math.max(0, H - bt - bb - pt - pb);

    // Colors
    const rawFg = cs.color;
    const rawBg = cs.backgroundColor;
    const rawBrd = (bt > 0 || br > 0 || bb > 0 || bl > 0) ? cs.borderColor : null;

    const colorsList = [];
    if (parseColor(rawFg)) colorsList.push({ role: 'Text', raw: rawFg });
    if (parseColor(rawBg)) colorsList.push({ role: 'Background', raw: rawBg });
    if (rawBrd && parseColor(rawBrd)) colorsList.push({ role: 'Borders', raw: rawBrd });

    // Text content
    const innerTxt = (targetEl.innerText || targetEl.textContent || '').trim();
    const hasText = innerTxt.length > 0 && targetEl.children.length <= 8 && innerTxt.length <= 600;

    // Typography
    const ffam = cs.fontFamily ? cs.fontFamily.split(',')[0].replace(/['"]/g, '').trim() : '';
    const fsize = fmt2(parseFloat(cs.fontSize) || 16);
    const fweight = cs.fontWeight || 400;
    const lh = cs.lineHeight === 'normal' ? 'normal' : fmt2(parseFloat(cs.lineHeight) / (fsize || 16));
    const ls = cs.letterSpacing !== 'normal' ? cs.letterSpacing : null;

    // Assets
    const assets = [];
    if (targetEl.tagName === 'IMG' && (targetEl.currentSrc || targetEl.src)) {
      // currentSrc is the srcset candidate actually shown (src is often a small fallback)
      const imgSrc = targetEl.currentSrc || targetEl.src;
      assets.push({ type: 'Image', url: imgSrc, name: assetFileName(imgSrc) || 'image', w: targetEl.naturalWidth || W, h: targetEl.naturalHeight || H });
    }
    if (targetEl.tagName === 'VIDEO') {
      if (targetEl.poster) {
        assets.push({ type: 'Poster', url: targetEl.poster, name: assetFileName(targetEl.poster) || 'poster', w: W, h: H });
      }
      const videoSrc = targetEl.currentSrc || targetEl.src;
      // blob: sources (streamed video) have no file to download
      if (videoSrc && !videoSrc.startsWith('blob:')) {
        assets.push({ type: 'Video', url: videoSrc, name: assetFileName(videoSrc) || 'video', w: targetEl.videoWidth || W, h: targetEl.videoHeight || H });
      }
    }
    if (targetEl.tagName === 'SVG' || targetEl.closest('svg')) {
      const svgEl = targetEl.tagName === 'SVG' ? targetEl : targetEl.closest('svg');
      try {
        const svgStr = new XMLSerializer().serializeToString(svgEl);
        const svgUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgStr);
        assets.push({ type: 'SVG', url: svgUrl, name: 'vector.svg', w: W, h: H });
      } catch (_) {}
    }
    if (cs.backgroundImage && cs.backgroundImage !== 'none') {
      const bgUrl = firstCssUrl(cs.backgroundImage);
      if (bgUrl) {
        assets.push({ type: 'Background', url: bgUrl, name: assetFileName(bgUrl) || 'background', w: W, h: H });
      }
    }
    if (assets.length === 0 && targetEl.children.length > 0 && targetEl.children.length <= 4) {
      const childImg = targetEl.querySelector('img');
      const childSrc = childImg && (childImg.currentSrc || childImg.src);
      if (childSrc) {
        assets.push({ type: 'Image', url: childSrc, name: assetFileName(childSrc) || 'image', w: childImg.naturalWidth || W, h: childImg.naturalHeight || H });
      }
      const childSvg = targetEl.querySelector('svg');
      if (childSvg) {
        try {
          const svgStr = new XMLSerializer().serializeToString(childSvg);
          const svgUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgStr);
          assets.push({ type: 'SVG', url: svgUrl, name: 'vector.svg', w: W, h: H });
        } catch (_) {}
      }
    }

    // Animations: the section (and its AI brief) only exist when something moves
    const animInfo = getAnimationInfo(targetEl);

    // Generate Code snippet (with an escaped, valid CSS selector)
    const codeData = generateSidePanelCode(sidePanelCodeFormat, targetEl, cs, W, H, selector(targetEl, true), sidePanelColorFormat);
    const codeStr = codeData.fullRaw;

    setHTML(spContentArea, `
      <!-- Selected Element Header -->
      <div class="sr-sp-el-header">
        <div style="overflow: hidden;">
          <div class="sr-sp-el-title" title="${escapeHTML(elSel)}">${escapeHTML(elSel)}</div>
          <div class="sr-sp-el-dim">${W} × ${H}</div>
        </div>
        <button class="sr-sp-copy-icon-btn" id="sr-sp-copy-sel" title="Copy Selector">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
          </svg>
        </button>
      </div>

      <!-- Export: the selected section as code, with a live copy to check first -->
      ${exportCardHTML()}

      <!-- Box Model Section -->
      <div class="sr-sp-sec">
        <div class="sr-sp-sec-hdr">
          <div class="sr-sp-sec-title-wrap">
            <svg class="sr-sp-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>
            <span class="sr-sp-sec-title">Box Model</span>
          </div>
        </div>
        <div class="sr-sp-sec-content">
          <div class="sr-sp-bm-wrap">
            <div class="sr-sp-bm-box sr-sp-bm-margin">
              <span class="sr-sp-bm-lbl">Margin</span>
              <span class="sr-sp-bm-val">${mt ? round1(mt) : '-'}</span>
              <div class="sr-sp-bm-mid">
                <span class="sr-sp-bm-val">${ml ? round1(ml) : '-'}</span>
                <div class="sr-sp-bm-box sr-sp-bm-border" style="flex: 1; margin: 0 4px;">
                  <span class="sr-sp-bm-lbl">Border</span>
                  <span class="sr-sp-bm-val">${bt ? round1(bt) : '-'}</span>
                  <div class="sr-sp-bm-mid">
                    <span class="sr-sp-bm-val">${bl ? round1(bl) : '-'}</span>
                    <div class="sr-sp-bm-box sr-sp-bm-padding" style="flex: 1; margin: 0 4px;">
                      <span class="sr-sp-bm-lbl">Padding</span>
                      <span class="sr-sp-bm-val">${pt ? round1(pt) : '-'}</span>
                      <div class="sr-sp-bm-mid">
                        <span class="sr-sp-bm-val">${pl ? round1(pl) : '-'}</span>
                        <div class="sr-sp-bm-content" style="flex: 1; margin: 0 4px;">
                          ${round1(cW)} × ${round1(cH)}
                        </div>
                        <span class="sr-sp-bm-val">${pr ? round1(pr) : '-'}</span>
                      </div>
                      <span class="sr-sp-bm-val">${pb ? round1(pb) : '-'}</span>
                    </div>
                    <span class="sr-sp-bm-val">${br ? round1(br) : '-'}</span>
                  </div>
                  <span class="sr-sp-bm-val">${bb ? round1(bb) : '-'}</span>
                </div>
                <span class="sr-sp-bm-val">${mr ? round1(mr) : '-'}</span>
              </div>
              <span class="sr-sp-bm-val">${mb ? round1(mb) : '-'}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Animations Section -->
      ${renderAnimationSection(animInfo)}

      <!-- 3. Code Section -->
      <div class="sr-sp-sec">
        <div class="sr-sp-sec-hdr">
          <div class="sr-sp-sec-title-wrap">
            <svg class="sr-sp-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>
            <span class="sr-sp-sec-title">Code</span>
          </div>
          <div class="sr-sp-sec-ctrls">
            <select class="sr-sp-select" id="sr-sp-code-select">
              <option value="computed" ${sidePanelCodeFormat === 'computed' ? 'selected' : ''}>Computed</option>
              <option value="source" ${sidePanelCodeFormat === 'source' ? 'selected' : ''}>Source</option>
              <option value="tailwind" ${sidePanelCodeFormat === 'tailwind' ? 'selected' : ''}>Tailwind</option>
              <option value="react" ${sidePanelCodeFormat === 'react' ? 'selected' : ''}>React</option>
            </select>
          </div>
        </div>
        <div class="sr-sp-sec-content">
          <div class="sr-sp-code-card">
            <div class="sr-sp-code-body">
              ${codeData.lines.map(line => `
                <div class="sr-sp-code-line">
                  <span class="sr-sp-code-num">${line.num}</span>
                  <span class="sr-sp-code-content">${line.html}</span>
                </div>
              `).join('')}
            </div>
            <div class="sr-sp-code-footer">
              <button class="sr-sp-code-copy-btn" id="sr-sp-code-copy" title="Copy Code">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- 4. Text Content (if present) -->
      ${hasText ? `
      <div class="sr-sp-sec">
        <div class="sr-sp-sec-hdr">
          <div class="sr-sp-sec-title-wrap">
            <svg class="sr-sp-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>
            <span class="sr-sp-sec-title">Text Content</span>
          </div>
        </div>
        <div class="sr-sp-sec-content">
          <div class="sr-sp-text-card">
            <div class="sr-sp-text-val" dir="auto">${escapeHTML(innerTxt)}</div>
            <button class="sr-sp-copy-icon-btn" id="sr-sp-copy-text" title="Copy Text">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
              </svg>
            </button>
          </div>
        </div>
      </div>
      ` : ''}

      <!-- 5. Colors Section -->
      ${colorsList.length > 0 ? `
      <div class="sr-sp-sec">
        <div class="sr-sp-sec-hdr">
          <div class="sr-sp-sec-title-wrap">
            <svg class="sr-sp-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>
            <span class="sr-sp-sec-title">${colorsList.length} ${colorsList.length === 1 ? 'Color' : 'Colors'}</span>
          </div>
          <div class="sr-sp-sec-ctrls">
            <select class="sr-sp-select" id="sr-sp-color-select">
              <option value="hex" ${sidePanelColorFormat === 'hex' ? 'selected' : ''}>HEX/HEXA</option>
              <option value="rgb" ${sidePanelColorFormat === 'rgb' ? 'selected' : ''}>RGB/RGBA</option>
              <option value="hsl" ${sidePanelColorFormat === 'hsl' ? 'selected' : ''}>HSL</option>
            </select>
          </div>
        </div>
        <div class="sr-sp-sec-content">
          <div class="sr-sp-colors-list">
            ${colorsList.map(c => {
              const val = formatColor(c.raw, sidePanelColorFormat);
              return `
                <div>
                  <div class="sr-sp-color-grp-title">${c.role}</div>
                  <div class="sr-sp-color-row" data-color-val="${val}" title="Click to copy ${val}">
                    <div class="sr-sp-color-circle" style="background:${c.raw}"></div>
                    <span class="sr-sp-color-code">${val}</span>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      </div>
      ` : ''}

      <!-- 6. Typography Section -->
      ${ffam ? `
      <div class="sr-sp-sec">
        <div class="sr-sp-sec-hdr">
          <div class="sr-sp-sec-title-wrap">
            <svg class="sr-sp-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>
            <span class="sr-sp-sec-title">1 Typography Style</span>
          </div>
        </div>
        <div class="sr-sp-sec-content">
          <div class="sr-sp-typo-meta">${escapeHTML(ffam)} ${fsize}px ${fweight} ${ls ? `| ${ls}` : ''}</div>
          <div class="sr-sp-typo-preview" style="font-family: ${escapeHTML(cs.fontFamily)}; font-size: ${Math.min(32, Math.max(16, fsize))}px; font-weight: ${fweight}; line-height: 1.2; letter-spacing: ${ls || 'normal'}; color: #ffffff;">
            The quick brown fox jumps over the lazy dog
          </div>
        </div>
      </div>
      ` : ''}

      <!-- 7. Assets Section -->
      ${assets.length > 0 ? `
      <div class="sr-sp-sec">
        <div class="sr-sp-sec-hdr">
          <div class="sr-sp-sec-title-wrap">
            <svg class="sr-sp-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>
            <span class="sr-sp-sec-title">${assets.length} ${assets.length === 1 ? 'Asset' : 'Assets'}</span>
          </div>
          <div class="sr-sp-sec-ctrls">
            <button class="sr-sp-btn-sm" id="sr-sp-download-all">Download All</button>
          </div>
        </div>
        <div class="sr-sp-sec-content">
          <div class="sr-sp-assets-list">
            ${assets.map((a, i) => `
              <div class="sr-sp-asset-card">
                <img class="sr-sp-asset-thumb" src="${escapeHTML(a.url)}" alt="${escapeHTML(a.name)}"/>
                <div class="sr-sp-asset-info">
                  <div class="sr-sp-asset-name">${escapeHTML(a.name)}</div>
                  <div class="sr-sp-asset-meta">${a.type} • ${a.w}×${a.h}</div>
                </div>
                <button class="sr-sp-btn-sm sr-sp-asset-dl" data-asset-idx="${i}">Download</button>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
      ` : ''}
    `);

    wireSidePanelEvents(targetEl, assets, codeStr, innerTxt, animInfo);
  }

  function calculatePageWeight() {
    const perf = window.performance;
    const entriesOf = type => (perf && typeof perf.getEntriesByType === 'function') ? perf.getEntriesByType(type) : [];
    // transferSize is 0 for cached responses; the body sizes are still reported then.
    const sizeOf = entry => entry.transferSize || entry.encodedBodySize || entry.decodedBodySize || 0;

    let docBytes = 0;
    let imgBytes = 0;
    let scriptBytes = 0;
    let styleBytes = 0;
    let fontBytes = 0;
    let otherBytes = 0;
    // Cross-origin resources without Timing-Allow-Origin report no size at all.
    let unmeasured = 0;

    // 1. Navigation / Document HTML size
    const nav = entriesOf('navigation')[0];
    docBytes = nav ? sizeOf(nav) : 0;
    if (!docBytes && document.documentElement) {
      docBytes = new Blob([document.documentElement.outerHTML]).size;
    }

    // 2. Performance resources breakdown
    entriesOf('resource').forEach(r => {
      const size = sizeOf(r);
      if (!size) {
        unmeasured++;
        return;
      }

      const initType = (r.initiatorType || '').toLowerCase();
      const url = (r.name || '').toLowerCase();

      if (initType === 'font' || /\.(woff2?|ttf|otf|eot)(\?|#|$)/.test(url)) {
        fontBytes += size;
      } else if (initType === 'img' || initType === 'image' || /\.(png|jpe?g|webp|svg|gif|avif|ico)(\?|#|$)/.test(url)) {
        imgBytes += size;
      } else if (initType === 'script' || /\.m?js(\?|#|$)/.test(url)) {
        scriptBytes += size;
      } else if (initType === 'css' || initType === 'link' || /\.css(\?|#|$)/.test(url)) {
        styleBytes += size;
      } else {
        otherBytes += size;
      }
    });

    const totalBytes = docBytes + imgBytes + scriptBytes + styleBytes + fontBytes + otherBytes;

    return {
      totalBytes,
      docBytes,
      imgBytes,
      scriptBytes,
      styleBytes,
      fontBytes,
      otherBytes,
      unmeasured
    };
  }

  // Lists the page's real SEO / Open Graph tags; missing ones are called out as comments.
  // Each code line keeps a `raw` copy so "Copy Meta Tags" yields plain HTML, not entities.
  function extractPageMetaTags() {
    const lines = [];
    const comment = text => lines.push({ num: lines.length + 1, type: 'comment', text });
    const code = (html, raw) => lines.push({ num: lines.length + 1, type: 'code', html, raw });
    const esc = v => String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    const escText = v => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const tag = t => `<span class="sr-syn-meta-tag">${escapeHTML(t)}</span>`;
    const attr = (name, value) =>
      `<span class="sr-syn-meta-attr">${name}</span>=<span class="sr-syn-meta-val">"${escapeHTML(value)}"</span>`;
    const metaTag = (keyAttr, key, value) => code(
      `${tag('<meta')} ${attr(keyAttr, key)} ${attr('content', value)} ${tag('/>')}`,
      `<meta ${keyAttr}="${key}" content="${esc(value)}" />`
    );
    const contentOf = sel => document.querySelector(sel)?.getAttribute('content') || '';

    // SEO section
    comment('/* SEO */');
    const title = document.title;
    if (title) {
      code(`${tag('<title>')}<span class="sr-syn-meta-val">${escapeHTML(title)}</span>${tag('</title>')}`, `<title>${escText(title)}</title>`);
    } else {
      comment('/* <title> missing */');
    }

    const desc = contentOf('meta[name="description"]');
    if (desc) metaTag('name', 'description', desc);
    else comment('/* meta description missing */');

    const canon = document.querySelector('link[rel="canonical"]')?.getAttribute('href');
    if (canon) {
      code(`${tag('<link')} ${attr('rel', 'canonical')} ${attr('href', canon)} ${tag('/>')}`, `<link rel="canonical" href="${esc(canon)}" />`);
    } else {
      comment('/* canonical link missing */');
    }

    const viewport = contentOf('meta[name="viewport"]');
    if (viewport) metaTag('name', 'viewport', viewport);
    else comment('/* viewport meta missing */');

    // Open Graph
    comment('/* Open Graph */');
    const ogTags = ['og:title', 'og:description', 'og:image', 'og:url']
      .map(prop => [prop, contentOf(`meta[property="${prop}"]`)])
      .filter(([, value]) => value);
    ogTags.forEach(([prop, value]) => metaTag('property', prop, value));
    if (ogTags.length === 0) comment('/* no Open Graph tags */');

    return lines;
  }

  // Tailwind v3's preflight declares --tw-* custom properties on every element, and its
  // responsive/state variants and arbitrary values give class lists a distinctive shape.
  function looksLikeTailwind() {
    try {
      if (getComputedStyle(document.body || document.documentElement).getPropertyValue('--tw-ring-offset-width')) {
        return true;
      }
    } catch (_) {}
    const els = document.querySelectorAll('body [class]');
    const limit = Math.min(els.length, 500);
    for (let i = 0; i < limit; i++) {
      const cls = els[i].getAttribute('class') || '';
      if (/(^|\s)(sm|md|lg|xl|2xl|hover|focus|dark):[a-z-]/.test(cls) || /(^|\s)[a-z-]+-\[[^\]\s]+\](\s|$)/.test(cls)) {
        return true;
      }
    }
    return false;
  }

  function detectPageTechnologies() {
    // Content scripts run in an isolated world: page globals (window.React, __NEXT_DATA__,
    // window.ga…) and framework expandos on DOM nodes are invisible here, so every check
    // below relies on the DOM and on loaded resource URLs instead.
    const detected = [];
    const scriptSrcs = Array.from(document.querySelectorAll('script[src]')).map(s => s.src.toLowerCase());
    const resUrls = (window.performance && typeof window.performance.getEntriesByType === 'function')
      ? window.performance.getEntriesByType('resource').map(r => (r.name || '').toLowerCase())
      : [];
    const allUrls = [...scriptSrcs, ...resUrls];
    const hasUrl = (pattern) => allUrls.some(u => u.includes(pattern));

    // 1. Next.js
    const isNext = !!(document.getElementById('__NEXT_DATA__') || document.getElementById('__next')) || hasUrl('/_next/');
    if (isNext) {
      detected.push({
        name: 'Next.js',
        icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="11" fill="#000" stroke="#444"/><path d="M7 7v10M7 7l10 10M17 7v7" stroke="#fff" stroke-width="2" stroke-linecap="round"/></svg>`
      });
    }

    // 2. React
    if (isNext || document.querySelector('[data-reactroot], [data-reactid]') || hasUrl('react-dom') || hasUrl('/react.')) {
      detected.push({
        name: 'React',
        icon: `<svg width="16" height="16" viewBox="-11.5 -10.232 23 20.463" fill="none"><circle cx="0" cy="0" r="2.05" fill="#61dafb"/><g stroke="#61dafb" stroke-width="1.1"><ellipse rx="11" ry="4.2"/><ellipse rx="11" ry="4.2" transform="rotate(60)"/><ellipse rx="11" ry="4.2" transform="rotate(120)"/></g></svg>`
      });
    }

    // 3. core-js
    if (hasUrl('core-js')) {
      detected.push({
        name: 'core-js',
        icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" fill="#1e293b" stroke="#334155"/><path d="M7 12h3.5m3 0H17M12 7v3.5m0 3V17" stroke="#f6ad55" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="12" r="2" fill="#f6ad55"/></svg>`
      });
    }

    // 4. Google Analytics
    if (hasUrl('google-analytics') || hasUrl('googletagmanager')) {
      detected.push({
        name: 'Google Analytics',
        icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><rect x="15" y="4" width="5" height="16" rx="2.5" fill="#f9ab00"/><rect x="9.5" y="9" width="5" height="11" rx="2.5" fill="#e37400"/><circle cx="5" cy="17.5" r="2.5" fill="#e37400"/></svg>`
      });
    }

    // 5. Cloudflare
    if (hasUrl('cloudflare') || hasUrl('/cdn-cgi/') || hasUrl('rocket-loader')) {
      detected.push({
        name: 'Cloudflare',
        icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="#f38020"><path d="M19.4 12.3c-.3-2.6-2.5-4.6-5.1-4.6-1.9 0-3.5 1.1-4.4 2.6-.5-.2-1-.3-1.6-.3-2.3 0-4.2 1.9-4.2 4.2 0 .3 0 .6.1.9C2.4 15.6 1 17.3 1 19.3c0 2.4 2 4.4 4.4 4.4h13.9c2.6 0 4.7-2.1 4.7-4.7 0-2.3-1.6-4.2-3.8-4.6-.2-.7-.5-1.4-.8-2.1z"/></svg>`
      });
    }

    // 6. Google Ads
    if (hasUrl('googleads') || hasUrl('doubleclick.net') || hasUrl('adsbygoogle')) {
      detected.push({
        name: 'Google Ads',
        icon: `<svg width="16" height="16" viewBox="0 0 24 24"><path d="M3.7 17.3l5.5-9.6c.7-1.3 2.4-1.7 3.7-1l.7.4c1.3.7 1.7 2.4 1 3.7l-5.5 9.6c-.7 1.3-2.4 1.7-3.7 1l-.7-.4c-1.4-.8-1.8-2.4-1-3.7z" fill="#fbbc04"/><path d="M14.6 6.7c1.3.7 1.7 2.4 1 3.7l-5.5 9.6c-.7 1.3-2.4 1.7-3.7 1-.7-.4-1.2-1-1.4-1.8L14.6 6.7z" fill="#4285f4"/><circle cx="5" cy="19" r="3" fill="#34a853"/></svg>`
      });
    }

    // 7. HubSpot
    if (hasUrl('hs-scripts.com') || hasUrl('hubspot.com')) {
      detected.push({
        name: 'HubSpot',
        icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="#ff7a59"><path d="M18.8 9.3V7.2a2.3 2.3 0 001.4-2.1 2.3 2.3 0 10-4.6 0c0 .9.6 1.7 1.4 2.1v2.1a6.6 6.6 0 00-3.2 1.4l-6-4.7a2.2 2.2 0 10-1.4 1.2l5.7 4.5a6.6 6.6 0 00-1.1 3.6 6.6 6.6 0 001.2 3.8l-1.8 1.8a2.1 2.1 0 101.4 1.4l1.8-1.8a6.7 6.7 0 106.6-11.2zm-2.8 9.5a4.3 4.3 0 110-8.6 4.3 4.3 0 010 8.6z"/></svg>`
      });
    }

    // 8. Tailwind CSS
    if (looksLikeTailwind() || hasUrl('tailwind')) {
      detected.push({
        name: 'Tailwind CSS',
        icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="#38bdf8"><path d="M12 6c-2.7 0-4.4 1.3-5.1 4 1-.7 2.1-.9 3.4-.6.8.2 1.3.8 2 1.4 1 1 2.2 2.2 4.7 2.2 2.7 0 4.4-1.3 5.1-4-1 .7-2.1.9-3.4.6-.8-.2-1.3-.8-2-1.4-1-1-2.2-2.2-4.7-2.2zm-6 6c-2.7 0-4.4 1.3-5.1 4 1-.7 2.1-.9 3.4-.6.8.2 1.3.8 2 1.4 1 1 2.2 2.2 4.7 2.2 2.7 0 4.4-1.3 5.1-4-1 .7-2.1.9-3.4.6-.8-.2-1.3-.8-2-1.4-1-1-2.2-2.2-4.7-2.2z"/></svg>`
      });
    }

    // 9. Vue.js (Vue 3 marks its mount point with data-v-app, Vue 2 SSR with data-server-rendered)
    if (document.querySelector('[data-v-app], [data-server-rendered]') || hasUrl('/vue.') || hasUrl('/vue@') || hasUrl('vue.runtime')) {
      detected.push({
        name: 'Vue.js',
        icon: `<svg width="16" height="16" viewBox="0 0 24 24"><path d="M1.5 3h4.6l5.9 10.2L17.9 3h4.6L12 21 1.5 3z" fill="#41b883"/><path d="M5.4 3h3.8l2.8 4.8L14.8 3h3.8L12 14.7 5.4 3z" fill="#34495e"/></svg>`
      });
    }

    // 10. Angular
    if (document.querySelector('[ng-app], [data-ng-app], [ng-version]')) {
      detected.push({
        name: 'Angular',
        icon: `<svg width="16" height="16" viewBox="0 0 24 24"><path d="M12 2L2 5.6l1.5 12.9L12 22l8.5-3.5 1.5-12.9L12 2z" fill="#dd0031"/><path d="M12 5.5L7.2 16.2h2.2l1-2.4h3.2l1 2.4h2.2L12 5.5zm1.1 6.8h-2.2L12 9.1l1.1 3.2z" fill="#fff"/></svg>`
      });
    }

    // 11. WordPress
    if (document.querySelector('meta[name="generator"][content*="WordPress"]') || hasUrl('wp-content')) {
      detected.push({
        name: 'WordPress',
        icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="#21759b"><path d="M12 2a10 10 0 100 20 10 10 0 000-20zm0 .9a9.1 9.1 0 015.3 1.7l-4.4 12.8-3.1-9.2c.7 0 1.2-.1 1.2-.1.4 0 .4-.6 0-.6H7.1c-.4 0-.4.6 0 .6 0 0 .5.1 1.2.1l4.4 12.1-4.3-12.8a9.1 9.1 0 013.6-4.6zm-8.2 9.1c0-1.4.3-2.7.9-3.9l4.5 12.3a9.1 9.1 0 01-5.4-8.4zm9.1 8.2l3-8.8 2.5 6.9a9.1 9.1 0 01-5.5 1.9zm6.3-4.1l-2.4-7c.7 0 1.2-.1 1.2-.1.4 0 .4-.6 0-.6h-3.9c-.4 0-.4.6 0 .6 0 0 .5.1 1.1.1l2.4 7a9.1 9.1 0 001.6-6.9z"/></svg>`
      });
    }

    return detected;
  }

  function getPageData(forceRefresh = false) {
    if (cachedPageData && !forceRefresh) return cachedPageData;

    // 1. Gather page title & URL
    const pageTitle = document.title || '(untitled page)';
    const pageUrl = window.location.host
      ? window.location.host + window.location.pathname + window.location.search
      : window.location.href;
    const hostDomain = window.location.host.replace(/^www\./, '').toUpperCase();

    // 2. Gather social metadata
    const ogImg = document.querySelector('meta[property="og:image"]')?.getAttribute('content') ||
      document.querySelector('meta[name="twitter:image"]')?.getAttribute('content') ||
      '';
    const ogTitle = document.querySelector('meta[property="og:title"]')?.getAttribute('content') ||
      document.querySelector('meta[name="twitter:title"]')?.getAttribute('content') ||
      pageTitle;
    const ogDesc = document.querySelector('meta[property="og:description"]')?.getAttribute('content') ||
      document.querySelector('meta[name="description"]')?.getAttribute('content') ||
      document.querySelector('meta[name="twitter:description"]')?.getAttribute('content') ||
      '';

    // 3. Extract Meta Tags
    const metaLines = extractPageMetaTags();
    const metaCodeStr = metaLines.map(l => l.type === 'comment' ? l.text : l.raw).join('\n');

    // 4. Calculate Page Weight
    const weight = calculatePageWeight();
    const formattedTotal = (weight.totalBytes >= 1024 * 1024)
      ? `${(weight.totalBytes / (1024 * 1024)).toFixed(1)} MB`
      : `${(weight.totalBytes / 1024).toFixed(1)} KB`;

    const totalB = Math.max(1, weight.totalBytes);
    const weightSegments = [
      { key: 'doc', label: 'Document', bytes: weight.docBytes, color: '#f87171' },
      { key: 'img', label: 'Images', bytes: weight.imgBytes, color: '#fb923c' },
      { key: 'script', label: 'Scripts', bytes: weight.scriptBytes, color: '#fbbf24' },
      { key: 'style', label: 'Styles', bytes: weight.styleBytes, color: '#60a5fa' },
      { key: 'font', label: 'Fonts', bytes: weight.fontBytes, color: '#34d399' },
      { key: 'other', label: 'Other', bytes: weight.otherBytes, color: '#a1a1aa' },
    ]
      .filter(seg => seg.bytes > 0)
      // Keep tiny but non-zero segments visible
      .map(seg => ({ ...seg, pct: Math.max(1, Math.round((seg.bytes / totalB) * 100)) }));

    // 5. Detect Technologies
    const techs = detectPageTechnologies();

    // 6-7. Gather page colors & fonts in one pass, stopping once both lists are full
    const MAX_COLORS = 36;
    const MAX_FONTS = 12;
    const colorSet = new Set();
    const fontSet = new Set();
    let scanned = 0;
    for (const el of document.querySelectorAll('body *')) {
      if (colorSet.size >= MAX_COLORS && fontSet.size >= MAX_FONTS) break;
      if (++scanned > 8000) break; // a very large page: what is known by now describes it
      let cs;
      try {
        cs = window.getComputedStyle(el);
      } catch (_) {
        continue;
      }
      const raws = [cs.color, cs.backgroundColor];
      if (parseFloat(cs.borderTopWidth) > 0) raws.push(cs.borderTopColor);
      for (const raw of raws) {
        if (colorSet.size < MAX_COLORS && parseColor(raw)) colorSet.add(formatColor(raw, sidePanelColorFormat));
      }
      if (fontSet.size < MAX_FONTS && cs.fontFamily) {
        const fam = cs.fontFamily.split(',')[0].replace(/['"]/g, '').trim();
        if (fam) fontSet.add(fam);
      }
    }
    const pageColors = Array.from(colorSet);
    const pageFonts = Array.from(fontSet);

    // 8. Gather page assets: each file once, and never the toolkit's own icons (pinned cards,
    //    dock tab…), which would otherwise be counted as page SVGs
    const MAX_ASSETS = 24;
    const TOOLKIT_UI = '#sr-toolbar, #sr-dock-restore, #sr-sidepanel, #sr-responsive-stage, #sr-panel, .sr-panel, .sr-pinned-overlay, #sr-bm-overlay, #sr-dist-overlay, #sr-rulers-container, #sr-color-toast, #sr-quick-toast';
    const pageAssets = [];
    const seenAssets = new Set();
    const pageRoot = document.body || document.documentElement;
    pageRoot.querySelectorAll('img[src]').forEach(img => {
      const url = img.currentSrc || img.src;
      if (pageAssets.length >= MAX_ASSETS || !url || seenAssets.has(url) || img.closest(TOOLKIT_UI)) return;
      if (!url.startsWith('data:image/svg+xml') && img.offsetWidth > 16) {
        seenAssets.add(url);
        pageAssets.push({
          type: 'Image',
          url,
          name: assetFileName(url) || 'image',
          w: img.naturalWidth || img.offsetWidth,
          h: img.naturalHeight || img.offsetHeight
        });
      }
    });
    let svgCount = 0;
    pageRoot.querySelectorAll('svg').forEach(svg => {
      // Nested <svg> elements are part of their outer SVG
      if (pageAssets.length >= MAX_ASSETS || svg.closest(TOOLKIT_UI) || (svg.parentElement && svg.parentElement.closest('svg'))) return;
      try {
        const str = new XMLSerializer().serializeToString(svg);
        const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(str);
        if (seenAssets.has(url)) return;
        seenAssets.add(url);
        const box = svg.getBoundingClientRect();
        pageAssets.push({
          type: 'SVG',
          url,
          name: `vector-${++svgCount}.svg`,
          w: Math.round(box.width) || 24,
          h: Math.round(box.height) || 24
        });
      } catch (_) {}
    });

    cachedPageData = {
      pageTitle,
      pageUrl,
      hostDomain,
      ogImg,
      ogTitle,
      ogDesc,
      metaLines,
      metaCodeStr,
      weight,
      formattedTotal,
      weightSegments,
      techs,
      pageColors,
      pageFonts,
      pageAssets
    };
    return cachedPageData;
  }

  // ── Palette export ──────────────────────────────────────────
  // Colors get Tailwind-style names (hue family + shade from lightness) so the exported
  // variables read like a design system: --color-blue-500, --color-gray-900…
  const HUE_FAMILIES = [
    [15, 'red'], [33, 'orange'], [43, 'amber'], [60, 'yellow'], [100, 'lime'], [152, 'green'],
    [167, 'emerald'], [181, 'teal'], [194, 'cyan'], [208, 'sky'], [228, 'blue'], [248, 'indigo'],
    [264, 'violet'], [282, 'purple'], [311, 'fuchsia'], [340, 'pink'], [355, 'rose'], [361, 'red']
  ];
  const SHADE_LIGHTNESS = [[97, 50], [93, 100], [86, 200], [76, 300], [64, 400], [52, 500], [42, 600], [34, 700], [26, 800], [18, 900], [10, 950]];
  const FAMILY_ORDER = ['white', 'gray', 'black', ...new Set(HUE_FAMILIES.map(([, family]) => family))];

  function paletteTokens(colors) {
    const used = new Set();
    const tokens = [];
    colors.forEach(value => {
      const col = parseColor(value);
      if (!col) return;
      const r = col.r / 255, g = col.g / 255, b = col.b / 255;
      const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
      const lightness = (max + min) / 2;
      let family;
      if (d < 0.08) {
        family = lightness >= 0.98 ? 'white' : lightness <= 0.03 ? 'black' : 'gray';
      } else {
        const hue = (max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60;
        family = HUE_FAMILIES.find(([limit]) => hue < limit)[1];
      }
      let shade = 0;
      let name = family;
      if (family !== 'white' && family !== 'black') {
        // The nearest shade that isn't taken yet, so similar colors don't share a name
        const candidates = SHADE_LIGHTNESS
          .map(([l, s]) => [Math.abs(l - lightness * 100), s])
          .sort((x, y) => x[0] - y[0])
          .map(([, s]) => s);
        shade = candidates.find(s => !used.has(`${family}-${s}`)) || candidates[0];
        name = `${family}-${shade}`;
      }
      if (col.a < 255) name += `-a${Math.round(col.alpha * 100)}`;
      let unique = name;
      for (let i = 2; used.has(unique); i++) unique = `${name}-${i}`;
      used.add(unique);
      tokens.push({ name: unique, value, family, shade });
    });
    return tokens.sort((x, y) => FAMILY_ORDER.indexOf(x.family) - FAMILY_ORDER.indexOf(y.family) || x.shade - y.shade);
  }

  function paletteToCode(colors, format) {
    const tokens = paletteTokens(colors);
    // Figma, a HEX list and JSON tokens keep the order the colors were given in
    if (format === 'figma' || format === 'hex' || format === 'json' || format === 'rgb' || format === 'csscolor' || format === 'hsl' || format === 'hsb') {
      const names = new Map(tokens.map(t => [t.value, t.name]));
      const list = colors.map(value => ({ col: parseColor(value), name: names.get(value) })).filter(item => item.col);
      const hexOf = col => toHex(col) + (col.a < 255 ? col.a.toString(16).padStart(2, '0').toUpperCase() : '');
      const parts = col => {
        const r = col.r / 255, g = col.g / 255, b = col.b / 255;
        const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
        const h = d ? (max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60 : 0;
        const l = (max + min) / 2;
        return { h: Math.round(h) % 360, sl: Math.round((d ? d / (1 - Math.abs(2 * l - 1)) : 0) * 100), l: Math.round(l * 100), sb: Math.round((max ? d / max : 0) * 100), v: Math.round(max * 100) };
      };
      const plain = {
        rgb: col => `${col.r}, ${col.g}, ${col.b}`,
        csscolor: col => `rgb(${col.r} ${col.g} ${col.b})`,
        hsl: col => { const p = parts(col); return `${p.h}, ${p.sl}%, ${p.l}%`; },
        hsb: col => { const p = parts(col); return `${p.h}, ${p.sb}%, ${p.v}%`; }
      };
      if (plain[format]) return list.map(item => plain[format](item.col)).join(String.fromCharCode(10));
      if (format === 'hex') return list.map(item => hexOf(item.col)).join('\n');
      if (format === 'json') {
        const out = {};
        list.forEach(item => { out[item.name] = { $value: hexOf(item.col), $type: 'color' }; });
        return JSON.stringify({ color: out }, null, 2);
      }
      // Pasted onto a Figma canvas, this SVG becomes one editable rectangle per color, named after it
      const size = 120, gap = 16;
      const width = list.length * size + Math.max(0, list.length - 1) * gap;
      return [
        `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${size}" viewBox="0 0 ${width} ${size}" fill="none">`,
        ...list.map((item, i) => `  <rect id="${item.name}" x="${i * (size + gap)}" y="0" width="${size}" height="${size}" rx="16" fill="${toHex(item.col)}"${item.col.a < 255 ? ` fill-opacity="${(item.col.a / 255).toFixed(2)}"` : ''}/>`),
        '</svg>'
      ].join('\n');
    }
    if (format === 'tailwind3') {
      return [
        "/** @type {import('tailwindcss').Config} */",
        'module.exports = {',
        '  theme: {',
        '    extend: {',
        '      colors: {',
        ...tokens.map(t => `        '${t.name}': '${t.value}',`),
        '      },',
        '    },',
        '  },',
        '};'
      ].join('\n');
    }
    return [format === 'tailwind4' ? '@theme {' : ':root {', ...tokens.map(t => `  --color-${t.name}: ${t.value};`), '}'].join('\n');
  }

  function paletteExportHTML(colors, format) {
    return paletteToCode(colors, format).split('\n').map((line, i) => `
      <div class="sr-sp-meta-line"><span class="sr-sp-meta-num">${i + 1}</span><span class="sr-sp-meta-code">${escapeHTML(line)}</span></div>`).join('');
  }

  function renderSidePanelPageTab(forceRefresh = false) {
    if (!spContentArea) return;

    const data = getPageData(forceRefresh);
    const {
      pageTitle, pageUrl, hostDomain, ogImg, ogTitle, ogDesc,
      metaLines, weight, formattedTotal, weightSegments,
      techs, pageColors, pageFonts, pageAssets, metaCodeStr
    } = data;

    setHTML(spContentArea, `
      <!-- Page Header: Title, URL, Live Refresh -->
      <div class="sr-sp-pg-header">
        <div class="sr-sp-pg-title-wrap">
          <div class="sr-sp-pg-title" dir="auto" title="${escapeHTML(pageTitle)}">${escapeHTML(pageTitle)}</div>
          <div class="sr-sp-pg-url" title="${escapeHTML(pageUrl)}">${escapeHTML(pageUrl)}</div>
        </div>
        <button class="sr-sp-pg-refresh-btn" id="sr-sp-pg-refresh" title="Re-scan Page">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/>
          </svg>
        </button>
      </div>

      <!-- 1. Social Preview (Matching Image 1) -->
      <div class="sr-sp-sec">
        <div class="sr-sp-sec-hdr">
          <div class="sr-sp-sec-title-wrap">
            <svg class="sr-sp-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>
            <span class="sr-sp-sec-title">Social Preview</span>
          </div>
          <div class="sr-sp-sec-ctrls">
            <select class="sr-sp-select" id="sr-sp-social-select">
              <option value="facebook" ${sidePanelSocialPlatform === 'facebook' ? 'selected' : ''}>Facebook</option>
              <option value="twitter" ${sidePanelSocialPlatform === 'twitter' ? 'selected' : ''}>X (Twitter)</option>
              <option value="linkedin" ${sidePanelSocialPlatform === 'linkedin' ? 'selected' : ''}>LinkedIn</option>
            </select>
          </div>
        </div>
        <div class="sr-sp-sec-content">
          <div class="sr-sp-social-wrap">
            <div class="sr-sp-social-card" id="sr-sp-social-card-inner">
              ${ogImg ? `
                <img class="sr-sp-social-img" src="${escapeHTML(ogImg)}" alt="Social Preview Image"/>
              ` : `
                <div class="sr-sp-social-img" style="display:flex; align-items:center; justify-content:center; color:#71717a; font-size:12px; font-weight:500;">
                  No og:image specified
                </div>
              `}
              <div class="sr-sp-social-meta">
                <div class="sr-sp-social-domain">${escapeHTML(hostDomain)}</div>
                <div class="sr-sp-social-title" dir="auto">${escapeHTML(ogTitle)}</div>
                <div class="sr-sp-social-desc" dir="auto">${escapeHTML(ogDesc)}</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 2. Meta Tags (Matching Image 2 Pixel-Perfect) -->
      <div class="sr-sp-sec">
        <div class="sr-sp-sec-hdr">
          <div class="sr-sp-sec-title-wrap">
            <svg class="sr-sp-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>
            <span class="sr-sp-sec-title">Meta Tags</span>
          </div>
          <div class="sr-sp-sec-ctrls">
            <button class="sr-sp-copy-icon-btn" id="sr-sp-meta-copy" title="Copy Meta Tags">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
              </svg>
            </button>
          </div>
        </div>
        <div class="sr-sp-sec-content">
          <div class="sr-sp-meta-card">
            ${metaLines.map(line => `
              <div class="sr-sp-meta-line">
                <span class="sr-sp-meta-num">${line.num}</span>
                <span class="sr-sp-meta-code">${line.type === 'comment' ? `<span class="sr-syn-meta-comment">${escapeHTML(line.text)}</span>` : line.html}</span>
              </div>
            `).join('')}
          </div>
        </div>
      </div>

      <!-- 3. Page Weight (Matching Image 2) -->
      <div class="sr-sp-sec">
        <div class="sr-sp-sec-hdr">
          <div class="sr-sp-sec-title-wrap">
            <svg class="sr-sp-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>
            <span class="sr-sp-sec-title">Page Weight</span>
          </div>
        </div>
        <div class="sr-sp-sec-content">
          <div class="sr-sp-weight-display">${formattedTotal}</div>
          <div class="sr-sp-weight-track-box">
            <div class="sr-sp-weight-bar">
              ${weightSegments.map(seg => `<div class="sr-sp-weight-seg sr-sp-weight-seg-${seg.key}" style="width:${seg.pct}%;" title="${seg.label}: ${(seg.bytes / 1024).toFixed(1)} KB"></div>`).join('')}
            </div>
            <div class="sr-sp-weight-legend">
              ${weightSegments.map(seg => `
              <div class="sr-sp-weight-item">
                <span class="sr-sp-weight-dot" style="background:${seg.color};"></span>
                <span>${seg.label}</span>
              </div>`).join('')}
            </div>
          </div>
          ${weight.unmeasured > 0 ? `<div class="sr-sp-weight-footnote">${weight.unmeasured} cross-origin ${weight.unmeasured === 1 ? 'resource' : 'resources'} without size info (not counted)</div>` : ''}
        </div>
      </div>

      <!-- 4. Technologies (Matching Image 3) -->
      <div class="sr-sp-sec">
        <div class="sr-sp-sec-hdr">
          <div class="sr-sp-sec-title-wrap">
            <svg class="sr-sp-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>
            <span class="sr-sp-sec-title">${techs.length} ${techs.length === 1 ? 'Technology' : 'Technologies'}</span>
          </div>
        </div>
        <div class="sr-sp-sec-content">
          <div class="sr-sp-tech-pills">
            ${techs.map(t => `
              <div class="sr-sp-tech-pill">
                <span class="sr-sp-tech-icon">${t.icon}</span>
                <span>${escapeHTML(t.name)}</span>
              </div>
            `).join('')}
          </div>
        </div>
      </div>

      <!-- 5. Page Palette -->
      ${pageColors.length > 0 ? `
      <div class="sr-sp-sec">
        <div class="sr-sp-sec-hdr">
          <div class="sr-sp-sec-title-wrap">
            <svg class="sr-sp-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>
            <span class="sr-sp-sec-title">Palette (${pageColors.length} ${pageColors.length === 1 ? 'Color' : 'Colors'})</span>
          </div>
          <div class="sr-sp-sec-ctrls">
            <select class="sr-sp-select" id="sr-sp-palette-format" title="Export format">
              <option value="css" ${sidePanelPaletteFormat === 'css' ? 'selected' : ''}>CSS variables</option>
              <option value="tailwind4" ${sidePanelPaletteFormat === 'tailwind4' ? 'selected' : ''}>Tailwind v4</option>
              <option value="tailwind3" ${sidePanelPaletteFormat === 'tailwind3' ? 'selected' : ''}>Tailwind v3</option>
              <option value="figma" ${sidePanelPaletteFormat === 'figma' ? 'selected' : ''}>Figma (paste SVG)</option>
              <option value="hex" ${sidePanelPaletteFormat === 'hex' ? 'selected' : ''}>HEX list</option>
              <option value="json" ${sidePanelPaletteFormat === 'json' ? 'selected' : ''}>JSON tokens</option>
            </select>
            <button class="sr-sp-copy-icon-btn" id="sr-sp-palette-copy" title="Copy palette">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
              </svg>
            </button>
          </div>
        </div>
        <div class="sr-sp-sec-content">
          <div class="sr-sp-palette-grid">
            ${(() => {
              const names = new Map(paletteTokens(pageColors).map(t => [t.value, t.name]));
              return pageColors.map(col => `
              <div class="sr-sp-palette-item" style="background:${col}" data-color-val="${col}" title="${names.get(col)} · ${col}"></div>
            `).join('');
            })()}
          </div>
          <div class="sr-sp-meta-card sr-sp-palette-export">${paletteExportHTML(pageColors, sidePanelPaletteFormat)}</div>
        </div>
      </div>` : ''}

      <!-- 6. Page Typography -->
      ${pageFonts.length > 0 ? `
      <div class="sr-sp-sec">
        <div class="sr-sp-sec-hdr">
          <div class="sr-sp-sec-title-wrap">
            <svg class="sr-sp-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>
            <span class="sr-sp-sec-title">Typography (${pageFonts.length} ${pageFonts.length === 1 ? 'Font' : 'Fonts'})</span>
          </div>
        </div>
        <div class="sr-sp-sec-content">
          <div style="display: flex; flex-direction: column; gap: 8px;">
            ${pageFonts.map(font => `
              <div style="background: rgba(255, 255, 255, 0.04); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 6px; padding: 10px 12px;">
                <div style="font-size: 13px; font-weight: 700; color: #fff; font-family: &quot;${escapeHTML(font)}&quot;, sans-serif;">${escapeHTML(font)}</div>
                <div style="font-size: 11px; color: #8e8e93; margin-top: 4px; font-family: &quot;${escapeHTML(font)}&quot;, sans-serif;">The quick brown fox jumps over the lazy dog</div>
              </div>
            `).join('')}
          </div>
        </div>
      </div>` : ''}

      <!-- 7. Page Assets -->
      ${pageAssets.length > 0 ? `
      <div class="sr-sp-sec">
        <div class="sr-sp-sec-hdr">
          <div class="sr-sp-sec-title-wrap">
            <svg class="sr-sp-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>
            <span class="sr-sp-sec-title">Assets (${pageAssets.length})</span>
          </div>
          <div class="sr-sp-sec-ctrls">
            <button class="sr-sp-btn-sm" id="sr-sp-pg-dl-all">Download All</button>
          </div>
        </div>
        <div class="sr-sp-sec-content">
          <div class="sr-sp-assets-list">
            ${pageAssets.map((a, i) => `
              <div class="sr-sp-asset-card">
                <img class="sr-sp-asset-thumb" src="${escapeHTML(a.url)}" alt="${escapeHTML(a.name)}"/>
                <div class="sr-sp-asset-info">
                  <div class="sr-sp-asset-name">${escapeHTML(a.name)}</div>
                  <div class="sr-sp-asset-meta">${a.type} • ${a.w}×${a.h}</div>
                </div>
                <button class="sr-sp-btn-sm sr-sp-asset-dl" data-asset-idx="${i}">Download</button>
              </div>
            `).join('')}
          </div>
        </div>
      </div>` : ''}
    `);

    wireSidePanelPageEvents(metaCodeStr, pageAssets);
  }

  // Header controls (selects/buttons) must not toggle their accordion section, and broken
  // thumbnails are hidden. Wired here rather than with inline on*= attributes, which run in
  // the page's own JS world and are blocked by strict page CSPs.
  function wireSectionChrome() {
    spContentArea.querySelectorAll('.sr-sp-sec-ctrls').forEach(ctrls => {
      ctrls.addEventListener('click', e => e.stopPropagation());
    });
    spContentArea.querySelectorAll('img.sr-sp-asset-thumb, img.sr-sp-social-img').forEach(img => {
      img.addEventListener('error', () => { img.style.display = 'none'; });
    });
  }

  function wireSidePanelPageEvents(metaCodeStr, pageAssets) {
    if (!spContentArea) return;
    wireSectionChrome();

    // Accordion toggling
    spContentArea.querySelectorAll('.sr-sp-sec-hdr').forEach(hdr => {
      hdr.addEventListener('click', () => {
        const sec = hdr.closest('.sr-sp-sec');
        if (sec) sec.classList.toggle('sr-collapsed');
      });
    });

    // Refresh Button
    const refreshBtn = spContentArea.querySelector('#sr-sp-pg-refresh');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => {
        refreshBtn.classList.add('sr-spinning');
        setTimeout(() => {
          renderSidePanelPageTab(true);
          showToast('🔄 Page Re-scanned');
        }, 350);
      });
    }

    // Social Platform Selector
    const socialSel = spContentArea.querySelector('#sr-sp-social-select');
    if (socialSel) {
      socialSel.addEventListener('change', () => {
        sidePanelSocialPlatform = socialSel.value;
        const img = spContentArea.querySelector('.sr-sp-social-img');
        if (img) {
          if (sidePanelSocialPlatform === 'twitter') {
            img.style.aspectRatio = '2 / 1';
          } else {
            img.style.aspectRatio = '1.91 / 1';
          }
        }
      });
    }

    // Meta Tags Copy
    const copyMetaBtn = spContentArea.querySelector('#sr-sp-meta-copy');
    if (copyMetaBtn && metaCodeStr) {
      copyMetaBtn.addEventListener('click', () => {
        copyWithFeedback(metaCodeStr, () => {
          copyMetaBtn.innerHTML = `
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#34d399" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
          `;
          showToast('Copied Meta Tags to Clipboard');
          setTimeout(() => {
            copyMetaBtn.innerHTML = `
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
              </svg>
            `;
          }, 1500);
        });
      });
    }

    // Color copy
    spContentArea.querySelectorAll('[data-color-val]').forEach(item => {
      item.addEventListener('click', () => {
        const val = item.dataset.colorVal;
        copyText(val).then(ok => showColorToast(val, val, ok));
      });
    });

    // Palette export: switch the format, copy the code
    const paletteColors = cachedPageData ? cachedPageData.pageColors : [];
    const paletteFormat = spContentArea.querySelector('#sr-sp-palette-format');
    const paletteExport = spContentArea.querySelector('.sr-sp-palette-export');
    if (paletteFormat && paletteExport) {
      paletteFormat.addEventListener('change', () => {
        sidePanelPaletteFormat = paletteFormat.value;
        setHTML(paletteExport, paletteExportHTML(paletteColors, sidePanelPaletteFormat));
      });
    }
    const paletteCopy = spContentArea.querySelector('#sr-sp-palette-copy');
    if (paletteCopy) {
      paletteCopy.addEventListener('click', () => {
        const label = paletteFormat && paletteFormat.selectedOptions[0] ? paletteFormat.selectedOptions[0].textContent : 'CSS variables';
        copyWithFeedback(paletteToCode(paletteColors, sidePanelPaletteFormat), () => showToast(`Copied palette as ${label}`));
      });
    }

    // Asset downloads
    if (pageAssets) {
      spContentArea.querySelectorAll('.sr-sp-asset-dl').forEach(btn => {
        btn.addEventListener('click', () => {
          const idx = parseInt(btn.dataset.assetIdx, 10);
          if (pageAssets[idx]) {
            downloadAsset(pageAssets[idx].url, pageAssets[idx].name);
          }
        });
      });

      const dlAll = spContentArea.querySelector('#sr-sp-pg-dl-all');
      if (dlAll) {
        dlAll.addEventListener('click', () => {
          pageAssets.forEach((a, i) => {
            setTimeout(() => downloadAsset(a.url, a.name), i * 200);
          });
          showToast(`Downloading ${pageAssets.length} Assets...`);
        });
      }
    }
  }

  function wireSidePanelEvents(targetEl, assets, codeStr, innerTxt, animInfo) {
    if (!spContentArea) return;
    wireSectionChrome();

    // Animations: restart what is playing, scan again, copy the brief for an AI assistant
    const replayBtn = spContentArea.querySelector('#sr-sp-anim-replay');
    if (replayBtn && animInfo) {
      replayBtn.addEventListener('click', () => {
        animInfo.running.forEach(r => {
          try {
            r.anim.cancel();
            r.anim.play();
          } catch (_) {}
        });
        showToast('▶️ Replaying animations');
      });
    }
    const rescanBtn = spContentArea.querySelector('#sr-sp-anim-rescan');
    if (rescanBtn) {
      rescanBtn.addEventListener('click', () => updateSidePanel(targetEl));
    }
    const aiCopyBtn = spContentArea.querySelector('#sr-sp-anim-copy-ai');
    if (aiCopyBtn && animInfo) {
      aiCopyBtn.addEventListener('click', () => {
        // Built now, with the pointer away from the element (see animationInfoToPrompt)
        const animPrompt = animationInfoToPrompt(animInfo, targetEl);
        copyWithFeedback(animPrompt, () => {
          const label = aiCopyBtn.querySelector('.sr-sp-anim-ai-label');
          if (label) label.textContent = 'Copied — paste it into your AI';
          aiCopyBtn.classList.add('sr-copied');
          showToast('Animation copied for AI');
          setTimeout(() => {
            if (label) label.textContent = 'Copy for AI';
            aiCopyBtn.classList.remove('sr-copied');
          }, 1800);
        });
      });
    }

    // Accordion expand/collapse
    spContentArea.querySelectorAll('.sr-sp-sec-hdr').forEach(hdr => {
      hdr.addEventListener('click', () => {
        const sec = hdr.closest('.sr-sp-sec');
        if (sec) sec.classList.toggle('sr-collapsed');
      });
    });

    // Export card
    wireExport(spContentArea, targetEl);

    // Copy Selector
    const copySelBtn = spContentArea.querySelector('#sr-sp-copy-sel');
    if (copySelBtn && targetEl) {
      copySelBtn.addEventListener('click', () => {
        const selStr = selector(targetEl, true);
        copyWithFeedback(selStr, () => {
          copySelBtn.innerHTML = `
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#34d399" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
          `;
          showToast(`Copied Selector: ${selStr}`);
          setTimeout(() => {
            copySelBtn.innerHTML = `
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
              </svg>
            `;
          }, 1500);
        });
      });
    }

    // Code Format Switcher
    const codeSel = spContentArea.querySelector('#sr-sp-code-select');
    if (codeSel) {
      codeSel.addEventListener('change', () => {
        sidePanelCodeFormat = codeSel.value;
        updateSidePanel(targetEl);
      });
    }

    // Copy Code Button
    const copyCodeBtn = spContentArea.querySelector('#sr-sp-code-copy');
    if (copyCodeBtn && codeStr) {
      copyCodeBtn.addEventListener('click', () => {
        copyWithFeedback(codeStr, () => {
          copyCodeBtn.classList.add('sr-copied');
          copyCodeBtn.innerHTML = `
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#34d399" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
          `;
          showToast('Copied Code to Clipboard');
          setTimeout(() => {
            copyCodeBtn.classList.remove('sr-copied');
            copyCodeBtn.innerHTML = `
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
              </svg>
            `;
          }, 1500);
        });
      });
    }

    // Copy Text Button
    const copyTextBtn = spContentArea.querySelector('#sr-sp-copy-text');
    if (copyTextBtn && innerTxt) {
      copyTextBtn.addEventListener('click', () => {
        copyWithFeedback(innerTxt, () => {
          copyTextBtn.innerHTML = `
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#34d399" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
          `;
          showToast('Copied Text to Clipboard');
          setTimeout(() => {
            copyTextBtn.innerHTML = `
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
              </svg>
            `;
          }, 1500);
        });
      });
    }

    // Color Format Switcher
    const colSel = spContentArea.querySelector('#sr-sp-color-select');
    if (colSel) {
      colSel.addEventListener('change', () => {
        sidePanelColorFormat = colSel.value;
        updateSidePanel(targetEl);
      });
    }

    // Click Color Row / Palette Item to copy
    spContentArea.querySelectorAll('[data-color-val]').forEach(row => {
      row.addEventListener('click', () => {
        const val = row.dataset.colorVal;
        copyText(val).then(ok => showColorToast(val, val, ok));
      });
    });

    // Single Asset Download
    if (assets) {
      spContentArea.querySelectorAll('.sr-sp-asset-dl').forEach(btn => {
        btn.addEventListener('click', () => {
          const idx = parseInt(btn.dataset.assetIdx, 10);
          if (assets[idx]) {
            downloadAsset(assets[idx].url, assets[idx].name);
          }
        });
      });

      // Download All Assets
      const dlAllBtn = spContentArea.querySelector('#sr-sp-download-all') || spContentArea.querySelector('#sr-sp-pg-dl-all');
      if (dlAllBtn) {
        dlAllBtn.addEventListener('click', () => {
          assets.forEach((a, i) => {
            setTimeout(() => downloadAsset(a.url, a.name), i * 200);
          });
          showToast(`Downloading ${assets.length} Assets...`);
        });
      }
    }
  }

  // ── Page Rulers Implementation ──────────────────────────────
  function initRulerSizes() {
    if (!rulerH || !rulerV) return;
    const dpr = window.devicePixelRatio || 1;
    const w = window.innerWidth - 18;
    const h = window.innerHeight - 18;

    rulerH.width = w * dpr;
    rulerH.height = 18 * dpr;
    rulerH.style.width = `${w}px`;
    rulerH.style.height = `18px`;
    ctxH.scale(dpr, dpr);

    rulerV.width = 18 * dpr;
    rulerV.height = h * dpr;
    rulerV.style.width = `18px`;
    rulerV.style.height = `${h}px`;
    ctxV.scale(dpr, dpr);
  }

  function drawRulers() {
    if (S.mode !== 'measure' || !rulerH || !rulerV) return;
    const w = window.innerWidth - 18;
    const h = window.innerHeight - 18;

    // Horizontal Ruler
    ctxH.clearRect(0, 0, w, 18);
    ctxH.fillStyle = '#18181b';
    ctxH.fillRect(0, 0, w, 18);
    ctxH.strokeStyle = '#52525b';
    ctxH.fillStyle = '#a1a1aa';
    ctxH.font = '9px -apple-system, BlinkMacSystemFont, monospace';
    ctxH.lineWidth = 1;

    for (let x = 0; x <= w; x += 10) {
      if (x % 100 === 0) {
        ctxH.beginPath();
        ctxH.moveTo(x, 7);
        ctxH.lineTo(x, 18);
        ctxH.stroke();
        if (x > 0) ctxH.fillText(String(x), x + 2, 11);
      } else if (x % 50 === 0) {
        ctxH.beginPath();
        ctxH.moveTo(x, 11);
        ctxH.lineTo(x, 18);
        ctxH.stroke();
      } else {
        ctxH.beginPath();
        ctxH.moveTo(x, 14);
        ctxH.lineTo(x, 18);
        ctxH.stroke();
      }
    }

    // Red cursor mark on top ruler
    if (S.cursorX >= 18) {
      ctxH.strokeStyle = '#ef4444';
      ctxH.lineWidth = 1.5;
      ctxH.beginPath();
      ctxH.moveTo(S.cursorX - 18, 0);
      ctxH.lineTo(S.cursorX - 18, 18);
      ctxH.stroke();
    }

    // Vertical Ruler
    ctxV.clearRect(0, 0, 18, h);
    ctxV.fillStyle = '#18181b';
    ctxV.fillRect(0, 0, 18, h);
    ctxV.strokeStyle = '#52525b';
    ctxV.fillStyle = '#a1a1aa';
    ctxV.font = '9px -apple-system, BlinkMacSystemFont, monospace';
    ctxV.lineWidth = 1;

    for (let y = 0; y <= h; y += 10) {
      if (y % 100 === 0) {
        ctxV.beginPath();
        ctxV.moveTo(7, y);
        ctxV.lineTo(18, y);
        ctxV.stroke();
        if (y > 0) {
          ctxV.save();
          ctxV.translate(11, y + 2);
          ctxV.rotate(-Math.PI / 2);
          ctxV.fillText(String(y), 0, 0);
          ctxV.restore();
        }
      } else if (y % 50 === 0) {
        ctxV.beginPath();
        ctxV.moveTo(11, y);
        ctxV.lineTo(18, y);
        ctxV.stroke();
      } else {
        ctxV.beginPath();
        ctxV.moveTo(14, y);
        ctxV.lineTo(18, y);
        ctxV.stroke();
      }
    }

    // Red cursor mark on left ruler
    if (S.cursorY >= 18) {
      ctxV.strokeStyle = '#ef4444';
      ctxV.lineWidth = 1.5;
      ctxV.beginPath();
      ctxV.moveTo(0, S.cursorY - 18);
      ctxV.lineTo(18, S.cursorY - 18);
      ctxV.stroke();
    }
  }

  // 100vw includes a classic (non-overlay) scrollbar, so the pushed page would slide that many
  // pixels under the side panel. The CSS subtracts this measured width.
  function updateScrollbarGutter() {
    const width = Math.max(0, window.innerWidth - document.documentElement.clientWidth);
    document.documentElement.style.setProperty('--sr-sp-scrollbar', `${width}px`);
  }

  // ── Fixed elements and the side panel ─────────────────────────
  // The page is pushed aside by narrowing it, but a fixed element is laid out against the window,
  // not the page: a header that spans the window runs on under the panel, and what it holds,
  // centred in the window, is centred under it too. Each fixed element the panel covers is fitted
  // to the room that is left: a bar shrinks into it, anything else moves over in proportion to
  // where it sits (a button at the right edge moves the whole width, a centred one half of it).
  let fitObserver = null;
  let fitTimer = 0;
  let fitCost = 0; // how long the last pass took, so a big page is looked at less often

  function clearFixedFit() {
    clearTimeout(fitTimer);
    const sheet = document.getElementById('sr-fit-style');
    if (sheet) sheet.remove();
    document.querySelectorAll('[data-sr-fit]').forEach(e => e.removeAttribute('data-sr-fit'));
  }

  function fitFixedElements() {
    const started = performance.now();
    try {
      fitFixedElementsNow();
    } finally {
      fitCost = performance.now() - started;
    }
  }

  function fitFixedElementsNow() {
    clearFixedFit();
    if (!isSidePanelOpen || !sidePanel || !document.body) return;
    const root = document.documentElement;
    const vw = root.clientWidth;
    const W = sidePanelWidth;
    const left = root.classList.contains('sr-sp-left');
    const lo = left ? W : 0;
    const hi = left ? vw : vw - W;
    const rules = [];
    for (const el of document.body.getElementsByTagName('*')) {
      const cs = getComputedStyle(el);
      if (cs.position !== 'fixed' || cs.display === 'none' || cs.visibility === 'hidden') continue;
      if (el.closest('[id^="sr-"]')) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      if (r.left >= lo - 0.5 && r.right <= hi + 0.5) continue; // already in the room
      const id = rules.length;
      let rule;
      const tx = cs.transform && cs.transform !== 'none' ? new DOMMatrixReadOnly(cs.transform).m41 : 0;
      if (r.width > hi - lo - 1 && Math.abs(tx) < 1) {
        // a bar as wide as the window (or wider): it takes the room that is left
        const x = Math.max(r.left, lo);
        const w = hi - x;
        rule = `left:${x}px!important;right:auto!important;width:${w}px!important;max-width:${w}px!important;min-width:0!important;box-sizing:border-box!important`;
      } else if (r.width <= hi - lo) {
        const dl = Math.max(0, r.left - 0), dr = Math.max(0, vw - r.right);
        const share = left ? dr / Math.max(1, dl + dr) : dl / Math.max(1, dl + dr);
        const shift = Math.round(W * share);
        rule = `translate:${left ? shift : -shift}px 0!important`;
      } else {
        continue;
      }
      el.setAttribute('data-sr-fit', String(id));
      rules.push(`[data-sr-fit="${id}"]{${rule}}`);
    }
    if (!rules.length) return;
    const sheet = document.createElement('style');
    sheet.id = 'sr-fit-style';
    sheet.textContent = rules.join('\n');
    root.appendChild(sheet);
  }

  function scheduleFixedFit(ms = 120) {
    clearTimeout(fitTimer);
    fitTimer = setTimeout(fitFixedElements, ms);
  }

  // popups, cookie banners and menus that appear after the panel opened are fitted too
  function watchFixedElements() {
    if (fitObserver || !document.body) return;
    fitObserver = new MutationObserver(records => {
      if (records.every(r => r.target.nodeType === 1 && r.target.closest && r.target.closest('[id^="sr-"]'))) return;
      scheduleFixedFit(Math.max(600, fitCost * 10));
    });
    fitObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  }

  function unwatchFixedElements() {
    if (fitObserver) { fitObserver.disconnect(); fitObserver = null; }
    clearFixedFit();
  }

  function handleResize() {
    if (isSidePanelOpen) {
      // a narrower window takes the panel's extra width back, so the page is never squeezed out
      const fits = clampPanelWidth(sidePanelWidth);
      if (fits !== sidePanelWidth && sidePanel) {
        sidePanelWidth = fits;
        document.documentElement.style.setProperty('--sr-sp-width', `${fits}px`);
        sidePanel.style.width = `${fits}px`;
      }
      updateScrollbarGutter();
      scheduleFixedFit();
    }
    // The window or the side panel changed the stage's width: fit again unless the user zoomed
    if (isResponsiveOpen && respZoomAuto) fitRespZoom();
    // The page moved under the pointer (window resized, side panel opened or closed): redraw the
    // hovered element's box model and banner where it is now
    if (S.active && !isResponsiveOpen && S.mode === 'inspect' && S.curEl && S.curEl.isConnected && S.curEl.ownerDocument === document) {
      inspect(S.curEl);
    }
    if (S.mode === 'measure') {
      initRulerSizes();
      drawRulers();
    }
    updateAllPinnedPositions();
  }

  // ── Distance Measurement Engine ─────────────────────────────
  function positionBox(box, rect) {
    box.style.display = 'block';
    box.style.top = `${rect.top}px`;
    box.style.left = `${rect.left}px`;
    box.style.width = `${rect.width}px`;
    box.style.height = `${rect.height}px`;
  }

  function selectDistanceRef(el) {
    S.selectedEl = el;
    positionBox(distSelected, el.getBoundingClientRect());
    clearDistanceLines();
  }

  // Two boxes that overlap: the smaller is measured from the edges of the one around it, whichever of the two was selected
  function nestedPair(a, b) {
    const inside = (x, y) => x.left >= y.left - 0.5 && x.right <= y.right + 0.5 && x.top >= y.top - 0.5 && x.bottom <= y.bottom + 0.5;
    return inside(a, b) && !inside(b, a) ? [b, a] : [a, b];
  }

  function clearDistanceLines() {
    if (distLinesContainer) distLinesContainer.innerHTML = '';
  }

  function renderDistanceTo(target) {
    if (!S.selectedEl || !target || S.selectedEl === target) {
      distHovered.style.display = 'none';
      clearDistanceLines();
      return;
    }

    S.hoveredEl = target;
    const rectA = S.selectedEl.getBoundingClientRect();
    const rectB = target.getBoundingClientRect();

    // 1. Keep the reference box on its element (the page may have scrolled) and show the
    //    red hatched box on the hovered element
    positionBox(distSelected, rectA);
    positionBox(distHovered, rectB);

    clearDistanceLines();

    // 2. Compute Distances and Draw Measurement Lines & Badges
    const isLeft = rectA.right <= rectB.left;
    const isRight = rectB.right <= rectA.left;
    const isAbove = rectA.bottom <= rectB.top;
    const isBelow = rectB.bottom <= rectA.top;

    // A. Horizontal Gap (Side by Side)
    if (isLeft) {
      const gap = Math.round(rectB.left - rectA.right);
      const overlapTop = Math.max(rectA.top, rectB.top);
      const overlapBottom = Math.min(rectA.bottom, rectB.bottom);
      const midY = overlapTop < overlapBottom ? (overlapTop + overlapBottom) / 2 : (rectA.top + rectA.bottom) / 2;
      drawHorizMeasure(rectA.right, rectB.left, midY, gap);
    } else if (isRight) {
      const gap = Math.round(rectA.left - rectB.right);
      const overlapTop = Math.max(rectA.top, rectB.top);
      const overlapBottom = Math.min(rectA.bottom, rectB.bottom);
      const midY = overlapTop < overlapBottom ? (overlapTop + overlapBottom) / 2 : (rectA.top + rectA.bottom) / 2;
      drawHorizMeasure(rectB.right, rectA.left, midY, gap);
    }

    // B. Vertical Gap (Stacked Above / Below)
    if (isAbove) {
      const gap = Math.round(rectB.top - rectA.bottom);
      const overlapLeft = Math.max(rectA.left, rectB.left);
      const overlapRight = Math.min(rectA.right, rectB.right);
      const midX = overlapLeft < overlapRight ? (overlapLeft + overlapRight) / 2 : (rectA.left + rectA.right) / 2;
      drawVertMeasure(rectA.bottom, rectB.top, midX, gap);
    } else if (isBelow) {
      const gap = Math.round(rectA.top - rectB.bottom);
      const overlapLeft = Math.max(rectA.left, rectB.left);
      const overlapRight = Math.min(rectA.right, rectB.right);
      const midX = overlapLeft < overlapRight ? (overlapLeft + overlapRight) / 2 : (rectA.left + rectA.right) / 2;
      drawVertMeasure(rectB.bottom, rectA.top, midX, gap);
    }

    // C. Nested / Overlapping (Figma / Screen Ruler Alt-measure)
    if (!isLeft && !isRight && !isAbove && !isBelow) {
      const [outer, inner] = nestedPair(rectA, rectB);
      const topGap = Math.round(inner.top - outer.top);
      const bottomGap = Math.round(outer.bottom - inner.bottom);
      const leftGap = Math.round(inner.left - outer.left);
      const rightGap = Math.round(outer.right - inner.right);

      const midX = (inner.left + inner.right) / 2;
      const midY = (inner.top + inner.bottom) / 2;

      if (topGap > 0) drawVertMeasure(outer.top, inner.top, midX, topGap);
      if (bottomGap > 0) drawVertMeasure(inner.bottom, outer.bottom, midX, bottomGap);
      if (leftGap > 0) drawHorizMeasure(outer.left, inner.left, midY, leftGap);
      if (rightGap > 0) drawHorizMeasure(inner.right, outer.right, midY, rightGap);
    }
  }

  function drawHorizMeasure(x1, x2, y, val) {
    if (x2 <= x1) return;
    const line = document.createElement('div');
    line.className = 'sr-dist-line sr-dist-line-h';
    line.style.left = `${x1}px`;
    line.style.top = `${y}px`;
    line.style.width = `${x2 - x1}px`;

    const badge = document.createElement('div');
    badge.className = 'sr-dist-badge';
    badge.textContent = `${val}`;
    badge.style.left = `${(x1 + x2) / 2}px`;
    badge.style.top = `${y}px`;

    distLinesContainer.appendChild(line);
    distLinesContainer.appendChild(badge);
  }

  function drawVertMeasure(y1, y2, x, val) {
    if (y2 <= y1) return;
    const line = document.createElement('div');
    line.className = 'sr-dist-line sr-dist-line-v';
    line.style.left = `${x}px`;
    line.style.top = `${y1}px`;
    line.style.height = `${y2 - y1}px`;

    const badge = document.createElement('div');
    badge.className = 'sr-dist-badge';
    badge.textContent = `${val}`;
    badge.style.left = `${x}px`;
    badge.style.top = `${(y1 + y2) / 2}px`;

    distLinesContainer.appendChild(line);
    distLinesContainer.appendChild(badge);
  }

  // ── Element Inspector Implementation ────────────────────────
  function inspect(target) {
    if (
      !target ||
      target === document.documentElement ||
      target === document.body ||
      target.closest('.sr-panel.sr-pinned') ||
      target.closest('#sr-toolbar') ||
      target.closest('#sr-rulers-container') ||
      target.closest('.sr-pinned-overlay') ||
      target.closest('#sr-bm-overlay') ||
      target.closest('#sr-dist-overlay')
    ) {
      return;
    }

    try {
      S.curEl = target;

      const win = (target.ownerDocument && target.ownerDocument.defaultView) ? target.ownerDocument.defaultView : window;
      const cs = win.getComputedStyle(target);
      const rect = target.getBoundingClientRect();
      const W = round1(rect.width);
      const H = round1(rect.height);

      const mt = parseFloat(cs.marginTop) || 0;
      const mr = parseFloat(cs.marginRight) || 0;
      const mb = parseFloat(cs.marginBottom) || 0;
      const ml = parseFloat(cs.marginLeft) || 0;

      const bt = parseFloat(cs.borderTopWidth) || 0;
      const br = parseFloat(cs.borderRightWidth) || 0;
      const bb = parseFloat(cs.borderBottomWidth) || 0;
      const bl = parseFloat(cs.borderLeftWidth) || 0;

      const pt = parseFloat(cs.paddingTop) || 0;
      const pr = parseFloat(cs.paddingRight) || 0;
      const pb = parseFloat(cs.paddingBottom) || 0;
      const pl = parseFloat(cs.paddingLeft) || 0;

      // 1. On-page Box Model Overlay (Only for main window elements; iframes render their own native box model)
      if (target.ownerDocument === document) {
        renderBoxModelOverlay(rect, W, H, mt, mr, mb, ml, bt, br, bb, bl, pt, pr, pb, pl, target);
      } else {
        if (overlay) overlay.style.display = 'none';
      }

      // 2. Floating Panel
      renderPanel(target);
    } catch (_) {}
  }

  function renderBoxModelOverlay(rect, W, H, mt, mr, mb, ml, bt, br, bb, bl, pt, pr, pb, pl, target) {
    overlay.style.display = 'block';

    // Computed spacing is in the element's own CSS pixels, but CSS `zoom` on it or an ancestor
    // scales it on screen (the bounding rect already is). Draw in screen pixels, label in CSS ones.
    const zoom = target.currentCSSZoom || 1;
    const label = v => round1(v / zoom);
    [mt, mr, mb, ml, bt, br, bb, bl, pt, pr, pb, pl] = [mt, mr, mb, ml, bt, br, bb, bl, pt, pr, pb, pl].map(v => v * zoom);

    // Blue Banner
    bmSelector.textContent = selector(target);
    bmDimensions.textContent = `${W} × ${H}`;

    const bannerH = 24;
    let bTop = rect.top - bannerH;

    if (bTop < 0) {
      bTop = rect.bottom > window.innerHeight - 30 ? rect.top : rect.bottom;
    }
    // Stay inside the part of the page the side panel doesn't cover. A long selector is cut
    // with an ellipsis (content.css) so the size is always visible.
    const [minX, maxX] = visiblePageRange();
    const bLeft = Math.max(minX + 4, Math.min(maxX - 160, rect.left));
    const maxW = Math.max(120, maxX - bLeft - 4);

    banner.style.top = `${bTop}px`;
    banner.style.left = `${bLeft}px`;
    banner.style.maxWidth = `${maxW}px`;
    banner.style.minWidth = `${Math.min(Math.max(rect.width, 160), maxW)}px`;

    // Padding (Green)
    if (pt > 0) {
      padT.style.display = 'flex';
      padT.style.top = `${rect.top + bt}px`;
      padT.style.left = `${rect.left + bl}px`;
      padT.style.width = `${rect.width - bl - br}px`;
      padT.style.height = `${pt}px`;
      padT.querySelector('.sr-bm-num').textContent = label(pt);
    } else {
      padT.style.display = 'none';
    }

    if (pb > 0) {
      padB.style.display = 'flex';
      padB.style.top = `${rect.bottom - bb - pb}px`;
      padB.style.left = `${rect.left + bl}px`;
      padB.style.width = `${rect.width - bl - br}px`;
      padB.style.height = `${pb}px`;
      padB.querySelector('.sr-bm-num').textContent = label(pb);
    } else {
      padB.style.display = 'none';
    }

    const padMidH = rect.height - bt - bb - pt - pb;
    if (pl > 0 && padMidH > 0) {
      padL.style.display = 'flex';
      padL.style.top = `${rect.top + bt + pt}px`;
      padL.style.left = `${rect.left + bl}px`;
      padL.style.width = `${pl}px`;
      padL.style.height = `${padMidH}px`;
      padL.querySelector('.sr-bm-num').textContent = label(pl);
    } else {
      padL.style.display = 'none';
    }

    if (pr > 0 && padMidH > 0) {
      padR.style.display = 'flex';
      padR.style.top = `${rect.top + bt + pt}px`;
      padR.style.left = `${rect.right - br - pr}px`;
      padR.style.width = `${pr}px`;
      padR.style.height = `${padMidH}px`;
      padR.querySelector('.sr-bm-num').textContent = label(pr);
    } else {
      padR.style.display = 'none';
    }

    // Content Box (Light Blue)
    const contentW = rect.width - bl - br - pl - pr;
    const contentH = rect.height - bt - bb - pt - pb;
    if (contentW > 0 && contentH > 0) {
      bmContent.style.display = 'block';
      bmContent.style.top = `${rect.top + bt + pt}px`;
      bmContent.style.left = `${rect.left + bl + pl}px`;
      bmContent.style.width = `${contentW}px`;
      bmContent.style.height = `${contentH}px`;
    } else {
      bmContent.style.display = 'none';
    }

    // Margins (Peach)
    if (mt > 0) {
      marT.style.display = 'flex';
      marT.style.top = `${rect.top - mt}px`;
      marT.style.left = `${rect.left - ml}px`;
      marT.style.width = `${rect.width + ml + mr}px`;
      marT.style.height = `${mt}px`;
      marT.querySelector('.sr-bm-num').textContent = label(mt);
    } else {
      marT.style.display = 'none';
    }

    if (mb > 0) {
      marB.style.display = 'flex';
      marB.style.top = `${rect.bottom}px`;
      marB.style.left = `${rect.left - ml}px`;
      marB.style.width = `${rect.width + ml + mr}px`;
      marB.style.height = `${mb}px`;
      marB.querySelector('.sr-bm-num').textContent = label(mb);
    } else {
      marB.style.display = 'none';
    }

    if (ml > 0) {
      marL.style.display = 'flex';
      marL.style.top = `${rect.top}px`;
      marL.style.left = `${rect.left - ml}px`;
      marL.style.width = `${ml}px`;
      marL.style.height = `${rect.height}px`;
      marL.querySelector('.sr-bm-num').textContent = label(ml);
    } else {
      marL.style.display = 'none';
    }

    if (mr > 0) {
      marR.style.display = 'flex';
      marR.style.top = `${rect.top}px`;
      marR.style.left = `${rect.right}px`;
      marR.style.width = `${mr}px`;
      marR.style.height = `${rect.height}px`;
      marR.querySelector('.sr-bm-num').textContent = label(mr);
    } else {
      marR.style.display = 'none';
    }

    // Border Box Outline
    if (bt > 0 || br > 0 || bb > 0 || bl > 0) {
      bmBorder.style.display = 'block';
      bmBorder.style.top = `${rect.top}px`;
      bmBorder.style.left = `${rect.left}px`;
      bmBorder.style.width = `${rect.width}px`;
      bmBorder.style.height = `${rect.height}px`;
    } else {
      bmBorder.style.display = 'none';
    }
  }

  // Icons of the inspector card and the responsive stage: Lucide (ISC license), plus four drawn the same way where Lucide has none
  const INSPECTOR_ICONS = {
    "width": '<path d="m18 8 4 4-4 4" /><path d="M2 12h20" /><path d="m6 8-4 4 4 4" />',
    "height": '<path d="M12 2v20" /><path d="m8 18 4 4 4-4" /><path d="m8 6 4-4 4 4" />',
    "display": '<rect width="18" height="7" x="3" y="3" rx="1" /><rect width="9" height="7" x="3" y="14" rx="1" /><rect width="5" height="7" x="16" y="14" rx="1" />',
    "box": '<path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" /><path d="m3.3 7 8.7 5 8.7-5" /><path d="M12 22V12" />',
    "radius": '<path d="M21 11a8 8 0 0 0-8-8" /><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />',
    "font": '<path d="M12 4v16" /><path d="M4 7V5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2" /><path d="M9 20h6" />',
    "size": '<path d="m15 16 2.536-7.328a1.02 1.02 1 0 1 1.928 0L22 16" /><path d="M15.697 14h5.606" /><path d="m2 16 4.039-9.69a.5.5 0 0 1 .923 0L11 16" /><path d="M3.304 13h6.392" />',
    "weight": '<path d="M6 12h9a4 4 0 0 1 0 8H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h7a4 4 0 0 1 0 8" />',
    "align-left": '<path d="M21 5H3" /><path d="M15 12H3" /><path d="M17 19H3" />',
    "align-center": '<path d="M21 5H3" /><path d="M17 12H7" /><path d="M19 19H5" />',
    "align-right": '<path d="M21 5H3" /><path d="M21 12H9" /><path d="M21 19H7" />',
    "align-justify": '<path d="M3 5h18" /><path d="M3 12h18" /><path d="M3 19h18" />',
    "contrast": '<circle cx="12" cy="12" r="10" /><path d="M12 18a6 6 0 0 0 0-12v12z" />',
    "paint": '<path d="M11 7 6 2" /><path d="M18.992 12H2.041" /><path d="M21.145 18.38A3.34 3.34 0 0 1 20 16.5a3.3 3.3 0 0 1-1.145 1.88c-.575.46-.855 1.02-.855 1.595A2 2 0 0 0 20 22a2 2 0 0 0 2-2.025c0-.58-.285-1.13-.855-1.595" /><path d="m8.5 4.5 2.148-2.148a1.205 1.205 0 0 1 1.704 0l7.296 7.296a1.205 1.205 0 0 1 0 1.704l-7.592 7.592a3.615 3.615 0 0 1-5.112 0l-3.888-3.888a3.615 3.615 0 0 1 0-5.112L5.67 7.33" />',
    "textcolor": '<path d="M4 20h16" /><path d="m6 16 6-12 6 12" /><path d="M8 12h8" />',
    "smartphone": '<rect width="14" height="20" x="5" y="2" rx="2" ry="2" /><path d="M12 18h.01" />',
    "tablet": '<rect width="16" height="20" x="4" y="2" rx="2" ry="2" /><line x1="12" x2="12.01" y1="18" y2="18" />',
    "monitor": '<rect width="20" height="14" x="2" y="3" rx="2" /><line x1="8" x2="16" y1="21" y2="21" /><line x1="12" x2="12" y1="17" y2="21" />',
    "laptop": '<path d="M18 5a2 2 0 0 1 2 2v8.526a2 2 0 0 0 .212.897l1.068 2.127a1 1 0 0 1-.9 1.45H3.62a1 1 0 0 1-.9-1.45l1.068-2.127A2 2 0 0 0 4 15.526V7a2 2 0 0 1 2-2z" /><path d="M20.054 15.987H3.946" />',
    "rotate": '<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" /><path d="M21 3v5h-5" />',
    "x": '<path d="M18 6 6 18" /><path d="m6 6 12 12" />',
    "plus": '<path d="M5 12h14" /><path d="M12 5v14" />',
    "minus": '<path d="M5 12h14" />',
    "search": '<path d="m21 21-4.34-4.34" /><circle cx="11" cy="11" r="8" />',
    "globe": '<circle cx="12" cy="12" r="10" /><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" /><path d="M2 12h20" />',
    "reload": '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" /><path d="M21 3v5h-5" /><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" /><path d="M8 16H3v5" />',
    "margin": '<rect x="3" y="3" width="18" height="18" rx="2" stroke-dasharray="3 3"/><rect x="8" y="8" width="8" height="8" rx="1"/>',
    "padding": '<rect x="3" y="3" width="18" height="18" rx="2"/><rect x="8" y="8" width="8" height="8" rx="1" stroke-dasharray="2 2"/>',
    "lineheight": '<path d="M4 4h16"/><path d="M4 20h16"/><path d="M12 8v8"/><path d="m9 11 3-3 3 3"/><path d="m9 13 3 3 3-3"/>',
    "letterspacing": '<path d="M4 5v14"/><path d="M20 5v14"/><path d="m8.5 17 3.5-10 3.5 10"/><path d="M9.8 13.5h4.4"/>'
  };

  function icon(name) {
    return `<svg class="sr-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${INSPECTOR_ICONS[name] || ''}</svg>`;
  }
  function generateCardHTML(target, isPinned) {
    if (!target) return '';
    const win = (target.ownerDocument && target.ownerDocument.defaultView) ? target.ownerDocument.defaultView : window;
    const cs = win.getComputedStyle(target);
    const rect = target.getBoundingClientRect();
    const W = round1(rect.width);
    const H = round1(rect.height);

    const mt = parseFloat(cs.marginTop) || 0;
    const mr = parseFloat(cs.marginRight) || 0;
    const mb = parseFloat(cs.marginBottom) || 0;
    const ml = parseFloat(cs.marginLeft) || 0;

    const bt = parseFloat(cs.borderTopWidth) || 0;
    const br = parseFloat(cs.borderRightWidth) || 0;
    const bb = parseFloat(cs.borderBottomWidth) || 0;
    const bl = parseFloat(cs.borderLeftWidth) || 0;

    const pt = parseFloat(cs.paddingTop) || 0;
    const pr = parseFloat(cs.paddingRight) || 0;
    const pb = parseFloat(cs.paddingBottom) || 0;
    const pl = parseFloat(cs.paddingLeft) || 0;

    const elSelector = selector(target);
    let html = '';

    if (isPinned) {
      html += `
        <div class="sr-pinned-header">
          <div class="sr-drag-handle" title="Drag to move">
            <svg width="18" height="12" viewBox="0 0 18 12" fill="currentColor">
              <circle cx="3" cy="3" r="1.3"/>
              <circle cx="9" cy="3" r="1.3"/>
              <circle cx="15" cy="3" r="1.3"/>
              <circle cx="3" cy="9" r="1.3"/>
              <circle cx="9" cy="9" r="1.3"/>
              <circle cx="15" cy="9" r="1.3"/>
            </svg>
          </div>
          <button class="sr-pin-close" title="Close (Esc)">
            <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
              <line x1="1" y1="1" x2="9" y2="9"/>
              <line x1="9" y1="1" x2="1" y2="9"/>
            </svg>
          </button>
        </div>
        ${elSelector ? `<div class="sr-pinned-selector" title="Drag to move">${escapeHTML(elSelector)}</div>` : ''}
      `;
    } else {
      html += `
        <div class="sr-hover-header">
          <span class="sr-hover-sel" title="${escapeHTML(elSelector)}">${escapeHTML(elSelector)}</span>
          <span class="sr-hover-hint">Space to pin</span>
        </div>
      `;
    }

    // 1. BOX MODEL
    const marginVal = fmtSpacing(mt, mr, mb, ml);
    const paddingVal = fmtSpacing(pt, pr, pb, pl);

    html += `<div class="sr-sec"><div class="sr-sec-title">Box Model</div>`;
    html += rowHTML('width', `${W}px`, 'vc-dim');
    html += rowHTML('height', `${H}px`, 'vc-dim');
    html += rowHTML('display', cs.display, 'vc-kw');
    if (marginVal !== '0px') html += rowHTML('margin', marginVal, 'vc-num');
    if (paddingVal !== '0px') html += rowHTML('padding', paddingVal, 'vc-num');
    html += rowHTML('box-sizing', cs.boxSizing, 'vc-box');
    html += `</div>`;

    // 2. APPEARANCE
    const bgColor = parseColor(cs.backgroundColor);
    const fgColor = parseColor(cs.color);
    const hasAppearance = cs.borderRadius !== '0px' || bgColor || fgColor;

    if (hasAppearance) {
      html += `<div class="sr-sec"><div class="sr-sec-title">Appearance</div>`;
      if (cs.borderRadius !== '0px') {
        html += rowHTML('border-radius', cs.borderRadius, 'vc-num');
      }
      if (bgColor) {
        html += colorRowHTML('background-color', cs.backgroundColor, bgColor);
      }
      if (fgColor) {
        html += colorRowHTML('color', cs.color, fgColor);
      }
      html += `</div>`;
    }

    // 3. TEXT
    const ffam = cs.fontFamily ? cs.fontFamily.split(',')[0].replace(/['"]/g, '').trim() : '';
    const lh = cs.lineHeight === 'normal' ? 'normal' : fmt2(parseFloat(cs.lineHeight) / (parseFloat(cs.fontSize) || 16));
    const ls = cs.letterSpacing !== 'normal' ? cs.letterSpacing : null;

    html += `<div class="sr-sec"><div class="sr-sec-title">Text</div>`;
    if (ffam) html += rowHTML('font-family', ffam, 'vc-font');
    html += rowHTML('font-size', `${fmt2(parseFloat(cs.fontSize))}px`, 'vc-num');
    html += rowHTML('font-weight', cs.fontWeight, 'vc-weight');
    html += rowHTML('line-height', String(lh), 'vc-num');
    if (ls) html += rowHTML('letter-spacing', ls, 'vc-num');
    if (cs.textAlign && cs.textAlign !== 'start' && cs.textAlign !== 'left') {
      html += rowHTML('text-align', cs.textAlign, 'vc-kw');
    }
    html += `</div>`;

    // 4. ACCESSIBILITY
    const ratio = fgColor && (bgColor || hasOwnText(target)) ? textContrast(target) : null;
    if (ratio !== null) {
      const [level, lvlClass] = wcagLevel(ratio);
      html += `
        <div class="sr-sec">
          <div class="sr-sec-title">Accessibility</div>
          <div class="sr-a11y-row">
            ${icon('contrast')}<span class="sr-k">contrast:&nbsp;</span>
            <span class="sr-aa-badge">Aa</span>
            <span class="sr-contrast-val">${ratio.toFixed(2)}</span>
            <span class="sr-wcag-badge ${lvlClass}">${level}</span>
          </div>
        </div>
      `;
    }

    if (isPinned) {
      html += '<div class="sr-resize-grip"></div>';
    }

    return html;
  }

  function renderPanel(target) {
    if (!panel || !target) return;
    panel.style.display = '';
    setHTML(panel, generateCardHTML(target, false));
    panel.classList.add('sr-on');
    panel.classList.remove('sr-pinned');

    // Wire copy on click
    panel.querySelectorAll('.sr-row, .sr-color-row').forEach(row => {
      row.addEventListener('click', e => {
        e.stopPropagation();
        const val = row.getAttribute('data-val');
        if (val) copyVal(row, val);
      });
    });
  }

  // ── Pinned Box Model Overlay & Cards Management ────────────
  function createPinnedOverlay(el) {
    const targetDoc = el ? (el.ownerDocument || document) : document;
    if (!el || !el.isConnected) return null;
    try {
      const overlayDiv = targetDoc.createElement('div');
      overlayDiv.className = 'sr-pinned-overlay';

      const bannerEl = targetDoc.createElement('div');
      bannerEl.className = 'sr-pinned-bm-banner';

      const selSpan = targetDoc.createElement('span');
      selSpan.className = 'sr-pinned-bm-selector';
      selSpan.textContent = selector(el);

      const dimSpan = targetDoc.createElement('span');
      dimSpan.className = 'sr-pinned-bm-dimensions';
      const rect = el.getBoundingClientRect();
      dimSpan.textContent = `${round1(rect.width)} × ${round1(rect.height)}`;

      bannerEl.appendChild(selSpan);
      bannerEl.appendChild(dimSpan);

      const contentEl = targetDoc.createElement('div');
      contentEl.className = 'sr-pinned-bm-content';

      overlayDiv.appendChild(bannerEl);
      overlayDiv.appendChild(contentEl);
      targetDoc.documentElement.appendChild(overlayDiv);

      positionPinnedOverlay(overlayDiv, el);
      return overlayDiv;
    } catch (_) {
      return null;
    }
  }

  function positionPinnedOverlay(overlayDiv, el) {
    if (!overlayDiv || !el) return;
    try {
      const targetDoc = el.ownerDocument || document;
      const isIframe = targetDoc !== document;
      const win = targetDoc.defaultView || window;
      const sX = isIframe ? (win.scrollX || 0) : 0;
      const sY = isIframe ? (win.scrollY || 0) : 0;

      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) {
        overlayDiv.style.display = 'none';
        return;
      }
      overlayDiv.style.display = 'block';

      const bannerEl = overlayDiv.querySelector('.sr-pinned-bm-banner');
      const contentEl = overlayDiv.querySelector('.sr-pinned-bm-content');
      const dimSpan = overlayDiv.querySelector('.sr-pinned-bm-dimensions');

      if (dimSpan) {
        dimSpan.textContent = `${round1(rect.width)} × ${round1(rect.height)}`;
      }

      const winW = win.innerWidth || window.innerWidth;
      const winH = win.innerHeight || window.innerHeight;

      if (bannerEl) {
        let bTop = (rect.top + sY) - 24;
        let bLeft = rect.left + sX;
        if (bTop < sY) {
          bTop = (rect.bottom + sY) > (winH + sY - 30) ? (rect.top + sY) : (rect.bottom + sY);
        }
        // On the page, stay clear of the side panel; inside a device frame, use the frame's width
        const [minX, maxX] = isIframe ? [0, winW] : visiblePageRange();
        bLeft = Math.max(sX + minX + 4, Math.min(sX + maxX - 140, bLeft));
        const maxW = Math.max(120, sX + maxX - bLeft - 4);
        bannerEl.style.top = `${bTop}px`;
        bannerEl.style.left = `${bLeft}px`;
        bannerEl.style.maxWidth = `${maxW}px`;
        bannerEl.style.minWidth = `${Math.min(Math.max(rect.width, 140), maxW)}px`;
      }

      if (contentEl) {
        contentEl.style.top = `${rect.top + sY}px`;
        contentEl.style.left = `${rect.left + sX}px`;
        contentEl.style.width = `${rect.width}px`;
        contentEl.style.height = `${rect.height}px`;
      }
    } catch (_) {}
  }

  function updateAllPinnedPositions() {
    for (const item of pinnedCards) {
      if (item.overlayNode && item.el) {
        const targetDoc = item.el.ownerDocument || document;
        if (targetDoc.documentElement && item.el.isConnected) {
          positionPinnedOverlay(item.overlayNode, item.el);
        }
      }
    }
  }

  function pinCard(target) {
    if (!target) target = S.curEl;
    const targetDoc = target ? (target.ownerDocument || document) : document;
    if (!target || !target.isConnected) return;

    // 1. Create on-page frozen box-model overlay attached to this element
    const overlayNode = createPinnedOverlay(target);

    // 2. Create floating frozen card
    const card = document.createElement('div');
    card.className = 'sr-panel sr-pinned sr-on';

    // Position where the hover panel is, or near cursor with stagger
    let x = S.panelX || (S.cursorX + 22);
    let y = S.panelY || (S.cursorY + 22);

    const stagger = (pinnedCards.length % 6) * 20;
    x = Math.max(10, Math.min(window.innerWidth - 295, x + stagger));
    y = Math.max(10, Math.min(window.innerHeight - 390, y + stagger));

    card.style.left = `${x}px`;
    card.style.top = `${y}px`;
    card.style.display = 'block';

    setHTML(card, generateCardHTML(target, true));
    document.documentElement.appendChild(card);

    // Wire row click-to-copy
    card.querySelectorAll('.sr-row, .sr-color-row').forEach(row => {
      row.addEventListener('click', e => {
        e.stopPropagation();
        const val = row.getAttribute('data-val');
        if (val) copyVal(row, val);
      });
    });

    // Wire close button
    const closeBtn = card.querySelector('.sr-pin-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', e => {
        e.stopPropagation();
        removePinnedCard(card);
      });
    }

    // Wire dragging
    const dragHeader = card.querySelector('.sr-pinned-header');
    const dragSelector = card.querySelector('.sr-pinned-selector');
    makeCardDraggable(card, dragHeader, dragSelector);

    // 3. Immediately hide the live hover panel and live overlay so no values flicker or collide
    if (panel) {
      panel.classList.remove('sr-on');
      panel.style.display = 'none';
    }
    if (overlay) {
      overlay.style.display = 'none';
    }
    // Also hide any iframe box-model hover overlays
    document.querySelectorAll('.sr-resp-iframe').forEach(ifr => {
      try {
        const doc = ifr.contentDocument;
        if (doc) {
          const bm = doc.getElementById('sr-if-bm-wrap');
          if (bm) bm.querySelectorAll('div').forEach(d => d.style.display = 'none');
        }
      } catch (_) {}
    });
    S.curEl = null;

    pinnedCards.push({ id: ++pinnedCounter, el: target, cardNode: card, node: card, overlayNode });
  }

  function makeCardDraggable(card, header, selectorBar) {
    let dragOffX = 0;
    let dragOffY = 0;
    let isDragging = false;

    function onMouseDown(e) {
      if (e.button !== 0) return;
      if (e.target.closest('.sr-pin-close')) return;
      isDragging = true;
      S.dragging = true;
      const rect = card.getBoundingClientRect();
      dragOffX = e.clientX - rect.left;
      dragOffY = e.clientY - rect.top;

      // Bring to front while dragging
      card.style.zIndex = '2147483648';

      document.addEventListener('mousemove', onDragMove, { capture: true });
      document.addEventListener('mouseup', onDragEnd, { capture: true, once: true });
      e.preventDefault();
      e.stopPropagation();
    }

    function onDragMove(e) {
      if (!isDragging) return;
      const pw = card.offsetWidth;
      const ph = card.offsetHeight;
      const x = Math.max(8, Math.min(window.innerWidth - pw - 8, e.clientX - dragOffX));
      const y = Math.max(8, Math.min(window.innerHeight - ph - 8, e.clientY - dragOffY));
      card.style.left = `${x}px`;
      card.style.top = `${y}px`;
    }

    function onDragEnd() {
      isDragging = false;
      S.dragging = false;
      card.style.zIndex = '2147483646';
      document.removeEventListener('mousemove', onDragMove, true);
    }

    header?.addEventListener('mousedown', onMouseDown);
    selectorBar?.addEventListener('mousedown', onMouseDown);
  }

  function removePinnedCard(cardNode) {
    const idx = pinnedCards.findIndex(c => c.cardNode === cardNode || c.node === cardNode);
    if (idx !== -1) {
      const item = pinnedCards[idx];
      if (item.cardNode) item.cardNode.remove();
      else if (item.node) item.node.remove();
      if (item.overlayNode) item.overlayNode.remove();
      pinnedCards.splice(idx, 1);
    } else {
      cardNode.remove();
    }
  }

  // The icon that leads each row says what the property is
  const ROW_ICONS = {
    'width': 'width', 'height': 'height', 'display': 'display', 'margin': 'margin', 'padding': 'padding',
    'box-sizing': 'box', 'border-radius': 'radius', 'background-color': 'paint', 'color': 'textcolor',
    'font-family': 'font', 'font-size': 'size', 'font-weight': 'weight', 'line-height': 'lineheight',
    'letter-spacing': 'letterspacing'
  };
  const ALIGN_ICONS = { left: 'align-left', start: 'align-left', right: 'align-right', end: 'align-right', center: 'align-center', justify: 'align-justify' };

  function rowIcon(key, val) {
    if (key === 'text-align') return icon(ALIGN_ICONS[val] || 'align-left');
    return ROW_ICONS[key] ? icon(ROW_ICONS[key]) : '';
  }

  function rowHTML(key, val, cls) {
    const v = escapeHTML(val);
    return `
      <div class="sr-row" data-val="${v}" title="Click to copy: ${v}">
        ${rowIcon(key, val)}<span class="sr-k">${key}:&nbsp;</span>
        <span class="sr-v ${cls}">${v}</span>
        <span class="sr-copy-hint" aria-hidden="true">copied!</span>
      </div>
    `;
  }

  function colorRowHTML(key, raw, col) {
    const hex = toHex(col);
    const alphaStr = col.a < 255 ? ` / ${Math.round(col.alpha * 100)}%` : '';
    const displayVal = `${hex}${alphaStr}`;
    return `
      <div class="sr-color-row" data-val="${hex}" title="Click to copy: ${hex}">
        ${rowIcon(key, hex)}<span class="sr-k">${key}:&nbsp;</span>
        <div class="sr-swatch" style="background:${raw}"></div>
        <span class="sr-color-hex">${displayVal}</span>
        <span class="sr-copy-hint" aria-hidden="true">copied!</span>
      </div>
    `;
  }

  function copyVal(row, text) {
    copyWithFeedback(text, () => {
      row.classList.add('sr-copied');
      setTimeout(() => row.classList.remove('sr-copied'), 800);
    });
  }

  // ── Positioning ─────────────────────────────────────────────
  function positionPanel(clientX, clientY) {
    if (S.dragging) return;

    const pw = panel.offsetWidth || 275;
    const ph = panel.offsetHeight || 380;
    const [minX, maxX] = visiblePageRange(); // the side panel, when it is open, takes one end of the window
    const vh = window.innerHeight;
    const offset = 22;

    let x = clientX + offset;
    let y = clientY + offset;

    if (x + pw > maxX - 12) x = clientX - pw - offset;
    if (y + ph > vh - 12) y = vh - ph - 12;

    x = Math.max(minX + 12, Math.min(maxX - pw - 12, x));
    y = Math.max(12, Math.min(vh - ph - 12, y));

    panel.style.left = `${x}px`;
    panel.style.top = `${y}px`;

    S.panelX = x;
    S.panelY = y;
  }

  // ── Hierarchy Navigation ────────────────────────────────────
  function selectParent() {
    const el = S.mode === 'measure' ? S.selectedEl : S.curEl;
    if (!el) return;
    const root = el.getRootNode && el.getRootNode();
    const parent = el.parentElement || (root && root.host ? root.host : null);
    if (parent && parent !== document.documentElement && parent !== document.body) {
      if (S.mode === 'measure') {
        selectDistanceRef(parent);
      } else {
        inspect(parent);
      }
    }
  }

  function selectChild() {
    const el = S.mode === 'measure' ? S.selectedEl : S.curEl;
    if (!el) return;
    const child = (el.shadowRoot && el.shadowRoot.firstElementChild) || el.firstElementChild;
    if (child) {
      if (S.mode === 'measure') {
        selectDistanceRef(child);
      } else {
        inspect(child);
      }
    }
  }

  // ── Event Handlers ──────────────────────────────────────────
  let pointerSeen = false;
  let scrollRefreshQueued = false;

  function onMouseMove(e) {
    if (!S.active) return;
    if (isResponsiveOpen) return;
    if (colorToolBusy()) return;
    if (S.paused) return;

    S.cursorX = e.clientX;
    S.cursorY = e.clientY;
    pointerSeen = true;
    trackPointer(false);
  }

  // Moves over an <iframe> are delivered to the frame's own document, so the page only sees
  // the pointer enter it. Treat that as a move so frames can be inspected like any element.
  function onFrameMouseOver(e) {
    if (e.target instanceof Element && /^(IFRAME|FRAME|OBJECT|EMBED)$/.test(e.target.tagName)) {
      onMouseMove(e);
    }
  }

  // When the page scrolls under a still mouse, overlays would stay where the element used
  // to be. Re-run the hit test once per frame so they follow the content.
  function onPageScroll() {
    if (!S.active || isResponsiveOpen || S.paused || colorToolBusy() || !pointerSeen || scrollRefreshQueued) return;
    scrollRefreshQueued = true;
    requestAnimationFrame(() => {
      scrollRefreshQueued = false;
      if (!S.active || isResponsiveOpen) return;
      if (S.mode === 'measure' && S.selectedEl) {
        positionBox(distSelected, S.selectedEl.getBoundingClientRect());
      }
      trackPointer(true);
    });
  }

  // The element under a point, looking inside open shadow roots: elementFromPoint stops at a component's host
  function deepElementFromPoint(x, y) {
    let el = document.elementFromPoint(x, y);
    for (let guard = 0; el && el.shadowRoot && guard < 12; guard++) {
      const inner = el.shadowRoot.elementFromPoint(x, y);
      if (!inner || inner === el) break;
      el = inner;
    }
    return el;
  }

  // Updates overlays for whatever is under the cursor. `force` re-renders even when it's
  // the same element (its position changes while scrolling).
  function trackPointer(force) {
    // Draw rulers on cursor move
    if (S.mode === 'measure') {
      drawRulers();
    }

    if (S.dragging) return;

    const target = deepElementFromPoint(S.cursorX, S.cursorY);
    if (!target) return;

    // If mouse is over any toolkit UI (toolbar, pinned cards, rulers) or empty page / overlays:
    if (
      target.closest('.sr-panel.sr-pinned') ||
      target.closest('#sr-toolbar') ||
      target.closest('#sr-dock-restore') ||
      target.closest('#sr-rulers-container') ||
      target.closest('#sr-responsive-stage') ||
      target.closest('#sr-sidepanel') ||
      target.closest('#sr-upgrade') ||
      target.closest('#sr-xp-modal') ||
      target.closest('#sr-imgpal') ||
      target === document.documentElement ||
      target === document.body ||
      target.closest('.sr-pinned-overlay') ||
      target.closest('#sr-bm-overlay') ||
      target.closest('#sr-dist-overlay')
    ) {
      if (S.mode === 'inspect') {
        if (panel) panel.classList.remove('sr-on');
        if (overlay) overlay.style.display = 'none';
        S.curEl = null;
      }
      return;
    }

    if (S.mode === 'inspect') {
      if (force || target !== S.curEl) {
        inspect(target);
      }
      positionPanel(S.cursorX, S.cursorY);
    } else if (S.mode === 'measure') {
      if (S.selectedEl) {
        renderDistanceTo(target);
      } else {
        // Preview selection outline
        positionBox(distSelected, target.getBoundingClientRect());
      }
    }
  }

  function onClick(e) {
    if (!S.active) return;
    if (isResponsiveOpen) return;
    // While paused the page stays fully interactive
    if (colorToolBusy() || S.paused) return;
    if (
      e.target.closest('#sr-panel') ||
      e.target.closest('.sr-panel') ||
      e.target.closest('#sr-toolbar') ||
      e.target.closest('#sr-dock-restore') ||
      e.target.closest('#sr-rulers-container') ||
      e.target.closest('#sr-responsive-stage') ||
      e.target.closest('#sr-sidepanel') ||
      e.target.closest('#sr-upgrade') ||
      e.target.closest('#sr-xp-modal') ||
      e.target.closest('#sr-imgpal')
    ) {
      return;
    }

    if (S.mode === 'inspect') {
      const target = deepElementFromPoint(e.clientX, e.clientY);
      if (
        !target ||
        target.closest('#sr-panel') ||
        target.closest('.sr-panel') ||
        target.closest('#sr-toolbar') ||
        target.closest('#sr-rulers-container') ||
        target.closest('#sr-sidepanel') ||
        target === document.body ||
        target === document.documentElement
      ) {
        return;
      }
      // Selecting an element must not also activate it (follow a link, submit a form…)
      e.preventDefault();
      e.stopPropagation();
      sidePanelTargetEl = target;
      if (isSidePanelOpen && sidePanelTab === 'element') {
        updateSidePanel(target);
      }
    } else if (S.mode === 'measure') {
      e.preventDefault();
      e.stopPropagation();

      const target = deepElementFromPoint(e.clientX, e.clientY);
      if (
        !target ||
        target.closest('#sr-panel') ||
        target.closest('.sr-panel') ||
        target.closest('#sr-toolbar') ||
        target.closest('#sr-rulers-container') ||
        target.closest('#sr-sidepanel') ||
        target === document.body ||
        target === document.documentElement
      ) {
        return;
      }

      if (S.selectedEl === target) {
        // Deselect on second click
        S.selectedEl = null;
        distSelected.style.display = 'none';
        distHovered.style.display = 'none';
        clearDistanceLines();
      } else {
        selectDistanceRef(target);
      }
    }
  }

  function onKeyDown(e) {
    if (!S.active) return;
    if ((S.isColorPicking || respConfirmOpen()) && e.code !== 'Escape') return;
    if (document.getElementById('sr-upgrade')) return; // the dialog has the keyboard

    // Space → Pin in inspect mode, or Deselect in measure mode
    // (Shift+Space scrolls up; Cmd/Ctrl/Alt+Space belong to the OS or input methods)
    if (e.code === 'Space' && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey && !isTypingTarget(e.target)) {
      e.preventDefault();
      e.stopPropagation();
      if (S.mode === 'inspect') {
        pinCard(S.curEl);
      } else if (S.mode === 'measure') {
        S.selectedEl = null;
        distSelected.style.display = 'none';
        distHovered.style.display = 'none';
        clearDistanceLines();
      }
      return;
    }

    // Escape → Clear side panel selection, or close side panel, or clear measure selection, or unpin one card, or deactivate
    if (e.code === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (colorPickAbort) {
        // The eyedropper normally takes Esc itself; this covers a picker that never opened
        // (previously this Esc fell through and quit the whole toolkit)
        colorPickAbort.abort();
      } else if (colorToolMenuIsOpen()) {
        toggleColorToolMenu(false);
      } else if (imgPal && imgPal.menuOpen) {
        setFmtMenu(false);
      } else if (imgPal) {
        closeImagePalette();
      } else if (isResponsiveOpen) {
        if (!closeRespConfirm() && !closeRespAddMenu()) closeResponsiveStage();
      } else if (isSidePanelOpen && sidePanelTargetEl) {
        sidePanelTargetEl = null;
        updateSidePanel(null);
      } else if (isSidePanelOpen) {
        closeSidePanel();
      } else if (S.mode === 'measure' && S.selectedEl) {
        S.selectedEl = null;
        distSelected.style.display = 'none';
        distHovered.style.display = 'none';
        clearDistanceLines();
      } else if (pinnedCards.length > 0) {
        const last = pinnedCards.pop();
        if (last) {
          if (last.cardNode) last.cardNode.remove();
          else if (last.node) last.node.remove();
          if (last.overlayNode) last.overlayNode.remove();
        }
      } else {
        deactivate();
      }
      return;
    }

    // ArrowUp / ArrowDown → Parent / Child. Cmd/Ctrl+arrows keep jumping to the top/bottom of the
    // page (the standard way to do that on a Mac).
    if (e.code === 'ArrowUp' && !e.metaKey && !e.ctrlKey && !isTypingTarget(e.target)) {
      e.preventDefault();
      e.stopPropagation();
      selectParent();
      if (S.curEl) {
        sidePanelTargetEl = S.curEl;
        if (isSidePanelOpen && sidePanelTab === 'element') updateSidePanel(S.curEl);
      }
      return;
    }
    if (e.code === 'ArrowDown' && !e.metaKey && !e.ctrlKey && !isTypingTarget(e.target)) {
      e.preventDefault();
      e.stopPropagation();
      selectChild();
      if (S.curEl) {
        sidePanelTargetEl = S.curEl;
        if (isSidePanelOpen && sidePanelTab === 'element') updateSidePanel(S.curEl);
      }
      return;
    }

    // Key '1' → Switch to Inspector mode
    if ((e.code === 'Digit1' || e.code === 'Numpad1') && !e.ctrlKey && !e.altKey && !e.metaKey && !isTypingTarget(e.target)) {
      e.preventDefault();
      e.stopPropagation();
      setMode('inspect');
      return;
    }

    // Key 'Shift+M', 'M', or 'D' → Toggle distance measurement mode
    // (Ctrl/Cmd combos like Ctrl+D stay with the browser; Alt+M is the global shortcut below.)
    if ((keyIs(e, 'KeyM') || keyIs(e, 'KeyD')) && !e.ctrlKey && !e.altKey && !e.metaKey && !isTypingTarget(e.target)) {
      e.preventDefault();
      e.stopPropagation();
      setMode(S.mode === 'measure' ? 'inspect' : 'measure');
      return;
    }

    // Key 'C' → Color Picker (EyeDropper)
    if (keyIs(e, 'KeyC') && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey && !isTypingTarget(e.target)) {
      e.preventDefault();
      e.stopPropagation();
      useColorTool('eyedropper');
      return;
    }

    // Key 'Shift+C' - Colors from image
    if (keyIs(e, 'KeyC') && e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey && !isTypingTarget(e.target)) {
      e.preventDefault();
      e.stopPropagation();
      useColorTool('image');
      return;
    }

    // Key 'R' → Responsive Multi-Device Mode
    if (keyIs(e, 'KeyR') && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey && !isTypingTarget(e.target)) {
      e.preventDefault();
      e.stopPropagation();
      setMode('responsive');
      return;
    }

    // Key 'O' → Toggle Side Panel Drawer
    if (keyIs(e, 'KeyO') && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey && !isTypingTarget(e.target)) {
      e.preventDefault();
      e.stopPropagation();
      toggleSidePanel();
      return;
    }

    // Key 'P' → Pause / Resume Toggle
    if (keyIs(e, 'KeyP') && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey && !isTypingTarget(e.target)) {
      e.preventDefault();
      e.stopPropagation();
      togglePause();
      return;
    }

    // Key 'H' → Hide / Show Dock Toggle
    if (keyIs(e, 'KeyH') && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey && !isTypingTarget(e.target)) {
      e.preventDefault();
      e.stopPropagation();
      toggleDock();
      return;
    }
  }

  // ── Trial pill and upgrade card ─────────────────────────────
  // "7 Days Left" on a fresh install, "1 Day Left" on the last full day, then hours.
  const timeLeft = ms => {
    if (ms >= 86400000) {
      const days = Math.round(ms / 86400000);
      return `${days} ${days === 1 ? 'Day' : 'Days'} Left`;
    }
    const hours = Math.max(1, Math.ceil(ms / 3600000));
    return `${hours} ${hours === 1 ? 'Hour' : 'Hours'} Left`;
  };

  // During the trial, a small pill at the end of the dock shows the time left and opens the upgrade card.
  function renderTrialPill(state) {
    if (!toolbar) return;
    let pill = toolbar.querySelector('#sr-trial-pill');
    if (!state || !state.enabled || state.licensed || !state.inTrial) {
      if (pill) pill.remove();
      return;
    }
    if (!pill) {
      pill = document.createElement('button');
      pill.id = 'sr-trial-pill';
      pill.type = 'button';
      pill.innerHTML = '<span class="sr-trial-label"></span><span class="sr-tooltip"><span class="sr-tt-title">Free trial</span><span class="sr-tt-key">Get lifetime access</span></span>';
      pill.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        getLicenseState().then(showUpgradeCard);
      });
      toolbar.appendChild(pill);
    }
    const label = timeLeft(state.trialEndsAt - Date.now());
    pill.querySelector('.sr-trial-label').textContent = label;
    pill.setAttribute('aria-label', `Free trial, ${label.toLowerCase()}. Get lifetime access`);
  }

  // While the tools are open, check every 10 minutes whether the trial has run out, and keep the pill current.
  let licenseTimer = null;
  function watchLicense(on) {
    clearInterval(licenseTimer);
    licenseTimer = null;
    if (!on) return;
    licenseTimer = setInterval(() => {
      getLicenseState().then(state => {
        if (!S.active) return;
        if (toolsUnlocked(state)) {
          renderTrialPill(state);
          return;
        }
        deactivate();
        showUpgradeCard(state);
      });
    }, 10 * 60 * 1000);
  }

  // A license activated in another tab, for example on the thank-you page after checkout, closes an
  // upgrade card left open here and removes the trial pill.
  let cardActivating = false;
  function onStorageChanged(changes, area) {
    if (area !== 'local' || !changes.license || !changes.license.newValue || cardActivating) return;
    renderTrialPill({ enabled: true, licensed: true });
    if (document.getElementById('sr-upgrade')) {
      closeUpgradeCard();
      showToast("You're all set. PixelLens is yours for life.");
    }
  }
  try {
    chrome.storage.onChanged.addListener(onStorageChanged);
  } catch (_) {}

  function onUpgradeKeyDown(e) {
    if (e.key === 'Tab') {
      trapTab(e, document.getElementById('sr-upgrade'));
      return;
    }
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    closeUpgradeCard();
  }

  let upgradeShowTimer = null;
  function closeUpgradeCard() {
    clearTimeout(upgradeShowTimer);
    const card = document.getElementById('sr-upgrade');
    if (card) card.remove();
    window.removeEventListener('keydown', onUpgradeKeyDown, true);
  }

  const UPGRADE_ICONS = {
    close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.2 4.2L19 7"/></svg>',
    cart: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/><path d="M3 4h2.2l2.3 11.2a1.5 1.5 0 0 0 1.5 1.2h8.6a1.5 1.5 0 0 0 1.5-1.2L21 8H6.2"/></svg>',
    lock: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
    clock: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    spark: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/></svg>',
    // The PixelLens mark, the same as the website's logo
    logo: '<svg viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="7.5" fill="#0a0a0a"/><rect x="0.25" y="0.25" width="31.5" height="31.5" rx="7.25" fill="none" stroke="#ffffff" stroke-opacity="0.18" stroke-width="0.5"/><g transform="translate(6 6) scale(0.625)"><path d="M4 17V8.5A4.5 4.5 0 0 1 8.5 4H17" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round"/><path d="M12.6 12.6L28 18.5L19.3 19.3L18.5 28Z" fill="#ffffff" stroke="#ffffff" stroke-width="2.2" stroke-linejoin="round"/></g></svg>'
  };

  // People in Egypt see the price in pounds, as on the website (a dollar figure is one more calculation for them).
  // Polar still charges in US dollars, which the card says. The time zone and language are read on the
  // device, so nothing is sent anywhere to decide this.
  function upgradePrices() {
    let zone = '';
    try { zone = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (_) {}
    const egypt = zone === 'Africa/Cairo' || /-eg$/i.test(navigator.language || '');
    return egypt
      ? { egypt: true, now: 'EGP 250', full: 'EGP 520', usdNow: '$5', usdFull: '$10' }
      : { egypt: false, now: '$5', full: '$10', usdNow: '$5', usdFull: '$10' };
  }

  // The left side of the upgrade card shows what the tool does, one feature after another. Every piece is a
  // <b> drawn by the stylesheet: the card's reset rules keep opacity and transform fixed on divs, spans and
  // paragraphs, and animations can't beat those, so the moving parts use a tag the reset doesn't touch.
  const UPGRADE_SLIDE_MS = 2400;
  const uB = (cls, inner = '') => `<b class="${cls}">${inner}</b>`;
  const UPGRADE_CURSOR = '<svg viewBox="0 0 24 24"><path d="M5 3l14 7-6 2-2 6z" fill="#ffffff" stroke="#0a0a0c" stroke-width="1.5" stroke-linejoin="round"/></svg>';
  const UPGRADE_SLIDES = [
    {
      title: 'Inspect any element',
      text: 'Hover to see its size, spacing, fonts and colors.',
      art: uB('us-card s1a a-up', uB('us-bar s1b') + uB('us-bar s1c') + uB('s1d')) + uB('s1e a-clip d3') + uB('s1f a-pop d2') + uB('s1g a-up d3', 'div.card 200 × 100') + uB('us-cursor s1h', UPGRADE_CURSOR)
    },
    {
      title: 'Measure the gaps',
      text: 'The exact distance between any two elements.',
      art: uB('us-card s2a a-up', uB('us-bar s2b') + uB('us-bar s2c')) + uB('us-card s2d a-up d1') + uB('us-card s2e a-up d2') + uB('s2f a-pop d3') + uB('s2g a-x d5') + uB('s2h a-pop d6', '26') + uB('s2i a-y d7') + uB('s2j a-pop d8', '28')
    },
    {
      title: 'Pick any color',
      text: 'HEX, RGB or HSL, with its contrast ratio.',
      art: uB('s3a a-up') + uB('s3b', uB('s3c')) + uB('us-chip s3d a-up d4', '#FB7185' + uB('s3e')) + uB('us-chip s3f a-up d6', uB('s3g', 'Aa') + 'AA · 7.2:1') + uB('us-chip s3h on a-up d7', 'HEX') + uB('us-chip s3i a-up d8', 'RGB') + uB('us-chip s3j a-up d9', 'HSL')
    },
    {
      title: 'Colors from any image',
      text: 'Copy the palette into Figma or your code.',
      art: uB('s4a a-up', uB('s4b') + uB('s4c') + uB('s4d') + uB('s4e')) + uB('s4f a-pop d6') + uB('s4g a-pop d7') + uB('s4h a-pop d8') + uB('s4i a-pop d9') + uB('s4j a-pop d10') + uB('us-chip s4k a-up d12', 'Copy for Figma') + uB('us-chip s4l a-up d13', 'or as code')
    },
    {
      title: 'Sections as code for your AI',
      text: 'Tailwind, HTML, React, Vue or Elementor.',
      art: uB('us-pill s5a', 'Tailwind') + uB('us-pill s5b', 'HTML') + uB('us-pill s5c', 'React') + uB('us-pill s5d', 'Vue') + uB('us-card s5e a-up d1', uB('s5l a-clip d2') + uB('s5m a-clip d3') + uB('s5n a-clip d4') + uB('s5o a-clip d5') + uB('s5p a-clip d6') + uB('s5q a-clip d7')) + uB('s5r a-pop d12', 'Copied ✓') + uB('s5s a-left d14', 'paste it into your AI')
    },
    {
      title: 'Read any animation',
      text: 'Timing and easing, ready to copy for your AI.',
      art: uB('us-card s6a a-up', uB('s6b') + uB('s6c') + uB('s6d', '<svg viewBox="0 0 236 118"><path class="s6p" d="M16 98 C 80 98, 96 18, 220 18"/></svg>') + uB('s6e')) + uB('us-chip s6f a-up d6', '0.25s') + uB('us-chip s6g a-up d7', 'ease-out') + uB('s6h a-pop d10', 'Copy for AI')
    },
    {
      title: 'Every screen at once',
      text: 'Phones, tablets and desktops side by side.',
      art: uB('us-card s7a a-pop d1', uB('s7b') + uB('us-bar s7c') + uB('us-bar s7d')) + uB('us-card s7e a-pop d3', uB('s7f') + uB('us-bar s7g')) + uB('us-card s7h a-pop d5', uB('s7f') + uB('us-bar s7i')) + uB('s7j a-up d6', '1280') + uB('s7k a-up d7', '768') + uB('s7l a-up d8', '390') + uB('s7m a-up d10', 'Rotate · Zoom · Sync scroll')
    },
    {
      title: 'Fonts and type',
      text: 'Family, size, weight and spacing of any text.',
      art: uB('s8a a-pop', 'Aa') + uB('s8b a-x d3') + uB('s8c a-x d4') + uB('s8d a-x d5') + uB('us-chip s8e a-left d3', 'Family' + uB('s8v', 'Inter')) + uB('us-chip s8f a-left d4', 'Weight' + uB('s8v', '600')) + uB('us-chip s8g a-left d5', 'Size' + uB('s8v', '48 px')) + uB('us-chip s8h a-left d6', 'Line' + uB('s8v', '1.1')) + uB('s8i a-clip d7', 'The quick brown fox') + uB('us-chip s8j a-up d9', 'Letter spacing' + uB('s8v', '−0.02em'))
    },
    {
      title: 'Audit the whole page',
      text: 'Meta tags, social preview, page weight and assets.',
      art: uB('us-card s9a a-up', uB('s9b') + uB('us-bar s9c') + uB('us-bar s9d') + uB('s9e', 'example.com')) + uB('s9f a-up d3', 'Page weight') + uB('s9g a-up d3', '1.2 MB') + uB('s9h') + uB('s9i a-x d4') + uB('s9j a-x d5') + uB('s9k a-x d6') + uB('s9l a-x d7') + uB('us-chip s9m a-pop d9', 'hero.webp ↓') + uB('us-chip s9n a-pop d10', 'logo.svg ↓') + uB('us-chip s9o a-pop d11', 'intro.mp4 ↓')
    }
  ];

  // Plays the slides: each one for a few seconds, its caption and its bar following. A click on a bar jumps to
  // that feature. With reduced motion it stays on the first and only moves when someone picks another.
  function startUpgradeShowcase(overlay) {
    const slides = [...overlay.querySelectorAll('.sr-us-slide')];
    const caps = [...overlay.querySelectorAll('.sr-up-cap')];
    const segs = [...overlay.querySelectorAll('.sr-up-seg')];
    if (!slides.length) return;
    const reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    let current = -1;
    const show = next => {
      if (next === current) return;
      const old = slides[current];
      if (old) {
        old.classList.remove('is-on');
        if (!reduced) {
          old.classList.add('is-out');
          setTimeout(() => old.classList.remove('is-out'), 380);
        }
        caps[current].classList.remove('is-on');
      }
      current = next;
      slides[current].classList.remove('is-out');
      slides[current].classList.add('is-on');
      caps[current].classList.add('is-on');
      segs.forEach((seg, i) => {
        seg.classList.toggle('is-done', i < current || (reduced && i === current));
        seg.classList.toggle('is-on', i === current && !reduced);
      });
    };
    const queue = () => {
      clearTimeout(upgradeShowTimer);
      if (reduced) return;
      upgradeShowTimer = setTimeout(() => {
        show((current + 1) % slides.length);
        queue();
      }, UPGRADE_SLIDE_MS);
    };
    segs.forEach((seg, i) => seg.addEventListener('click', () => {
      show(i);
      queue();
    }));
    show(0);
    queue();
  }

  // Why a customer's license stopped working (set by the daily check in background.js)
  const LICENSE_NOTICES = {
    revoked: { title: 'This license was refunded', note: 'A refund ends the license. You can buy it again anytime.' },
    disabled: { title: 'This license is no longer active', note: 'If this looks wrong, write to support@designtoolkit.online.' },
    removed: { title: 'This browser was removed from your license', note: 'Paste your key below to use it here again.' }
  };

  // Shown when the trial has ended (the tools stay off until a license is active), or from the
  // trial pill. Offers checkout, at the launch price during the first 7 days, and a key field for
  // people who already bought it. The left panel plays through what the tool does, one feature after
  // another; it's decoration only, and it's hidden in narrow windows.
  function showUpgradeCard(state) {
    closeUpgradeCard();
    const inTrial = !!(state && state.inTrial);
    const notice = !inTrial && state ? LICENSE_NOTICES[state.notice] : null;
    const title = inTrial ? 'Keep every tool, for life' : notice ? notice.title : 'Your free trial has ended';
    const lead = inTrial
      ? 'Buy before your trial ends and pay half. No subscription.'
      : notice ? notice.note : 'Pay once and keep every tool. No subscription.';
    const price = upgradePrices();
    const features = ['Inspect and measure', 'Colors from any image', 'Section code for your AI', 'Animations for your AI', 'Responsive mode', 'Fonts and page audit'];
    const overlay = document.createElement('div');
    overlay.id = 'sr-upgrade';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'sr-up-title');
    overlay.innerHTML = `
      <div class="sr-up-card">
        <div class="sr-up-art" aria-hidden="true">
          <span class="sr-up-mark">${UPGRADE_ICONS.logo}</span>
          <div class="sr-us-frame"><div class="sr-us-bar"><b></b><b></b><b></b></div><div class="sr-us">${UPGRADE_SLIDES.map(slide => uB('sr-us-slide', slide.art)).join('')}</div></div>
          <div class="sr-up-art-copy">
            <div class="sr-up-caps">${UPGRADE_SLIDES.map(slide => uB('sr-up-cap', uB('sr-up-cap-title', slide.title) + uB('sr-up-cap-text', slide.text))).join('')}</div>
            <div class="sr-up-prog">${UPGRADE_SLIDES.map(() => uB('sr-up-seg', uB('sr-up-track', uB('sr-up-fill')))).join('')}</div>
          </div>
        </div>
        <div class="sr-up-main">
          <button class="sr-up-close" type="button" aria-label="Close">${UPGRADE_ICONS.close}</button>
          <div class="sr-up-head">
            <h2 class="sr-up-title" id="sr-up-title">${title}</h2>
            <p class="sr-up-lead">${lead}</p>
          </div>
          <div class="sr-up-plan">
            <div class="sr-up-plan-top">
              <div class="sr-up-plan-name"><strong>${inTrial ? `<b class="sr-up-spark">${UPGRADE_ICONS.spark}</b>` : ''}Lifetime</strong></div>
              <div class="sr-up-price">${inTrial ? `<b class="sr-up-now">${price.now}</b><b class="sr-up-was">${price.full}</b><span>one-time</span>` : (price.egypt ? `<strong>${price.full}</strong><span>one-time</span>` : '<strong>$10</strong><span>USD</span>')}</div>
            </div>
            <div class="sr-up-incl">
              <div class="sr-up-incl-head"><b class="sr-up-incl-title">Everything included</b></div>
              <div class="sr-up-feats">${features.map(feature => `<b class="sr-up-feat">${UPGRADE_ICONS.check}<b class="sr-up-feat-text">${feature}</b></b>`).join('')}</div>
              <p class="sr-up-also">Plus color picker, asset downloads, every update and 3 browsers.</p>
            </div>
            <button class="sr-up-buy" type="button">${UPGRADE_ICONS.cart}<span>${inTrial ? `Get it for ${price.now}` : 'Get lifetime access'}</span></button>
            <p class="sr-up-fine">${UPGRADE_ICONS.lock}<span>Secure checkout by Polar · 14-day refund · Key arrives by email</span></p>
            <div class="sr-up-status sr-up-buy-status" role="status"></div>
          </div>
          <form class="sr-up-form">
            <label class="sr-up-key-label" for="sr-up-key"><strong>Already bought it?</strong> Paste the license key from your email.</label>
            <div class="sr-up-key-row">
              <input class="sr-up-key" id="sr-up-key" type="text" placeholder="DT-XXXXXXXX-XXXX-XXXX-XXXX" autocomplete="off" spellcheck="false">
              <button class="sr-up-activate" type="submit">Activate</button>
            </div>
            <div class="sr-up-status sr-up-key-status" role="status"></div>
            <p class="sr-up-lost">Lost your key? <a href="https://polar.sh/designtoolkit/portal" target="_blank" rel="noopener noreferrer">Find it in your purchases</a></p>
          </form>
        </div>
      </div>`;
    document.documentElement.appendChild(overlay);
    startUpgradeShowcase(overlay);

    // Checkout messages show under the buy button, key messages under the key field
    const setStatus = (status, text, kind = '', link = null) => {
      status.textContent = text;
      status.classList.toggle('sr-up-error', kind === 'error');
      status.classList.toggle('sr-up-ok', kind === 'ok');
      if (link) {
        const a = document.createElement('a');
        a.href = link.href;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.textContent = link.text;
        status.append(' ', a);
      }
    };
    const buyStatus = overlay.querySelector('.sr-up-buy-status');
    const keyStatus = overlay.querySelector('.sr-up-key-status');
    overlay.querySelector('.sr-up-close').addEventListener('click', closeUpgradeCard);
    overlay.addEventListener('click', e => {
      if (e.target === overlay) closeUpgradeCard();
    });
    window.addEventListener('keydown', onUpgradeKeyDown, true);

    overlay.querySelector('.sr-up-buy').addEventListener('click', () => {
      setStatus(buyStatus, 'Opening checkout…');
      sendRuntimeMessage({ type: 'SR_OPEN_CHECKOUT' }).then(res => {
        if (res && res.ok) setStatus(buyStatus, 'Checkout is open in a new tab. After you pay, PixelLens activates here by itself.');
        else setStatus(buyStatus, "Couldn't open checkout. Please try again.", 'error');
      });
    });

    const form = overlay.querySelector('.sr-up-form');
    const input = overlay.querySelector('.sr-up-key');
    const activateBtn = overlay.querySelector('.sr-up-activate');
    form.addEventListener('submit', e => {
      e.preventDefault();
      activateBtn.disabled = true;
      cardActivating = true;
      setStatus(keyStatus, 'Checking your key…');
      sendRuntimeMessage({ type: 'SR_LICENSE_ACTIVATE', key: input.value }).then(res => {
        activateBtn.disabled = false;
        if (!res || !res.ok) {
          cardActivating = false;
          const manageUrl = res && typeof res.manageUrl === 'string' && res.manageUrl.startsWith('https://polar.sh/') ? res.manageUrl : null;
          setStatus(keyStatus, (res && res.error) || "Can't reach the license server. Check your connection and try again.", 'error', manageUrl ? { href: manageUrl, text: 'Open your purchases' } : null);
          return;
        }
        setStatus(keyStatus, "You're all set. PixelLens is yours for life.", 'ok');
        renderTrialPill(res.state);
        setTimeout(() => {
          cardActivating = false;
          closeUpgradeCard();
          if (!S.active) activate();
        }, 1400);
      });
    });
    // Focus the dialog itself: keyboard users start inside it, with no ring drawn on the buy button
    const card = overlay.querySelector('.sr-up-card');
    card.setAttribute('tabindex', '-1');
    card.focus({ preventScroll: true });
  }

  // ── Activation & Deactivation ───────────────────────────────
  // A script on the page can remove the nodes it doesn't know (a framework rebuilding <html>, a cleanup of
  // "foreign" elements): the toolkit's own are put back, so turning it on again shows it again.
  function reattachUI() {
    const root = document.documentElement;
    [overlay, panel, distOverlay, rulersContainer, toolbar, dockRestoreTab, sidePanel, respStage].forEach(node => {
      if (node && !node.isConnected) root.appendChild(node);
    });
  }

  function activate(mode) {
    if (!toolbar) {
      buildDOM();
    } else {
      reattachUI();
    }
    S.active = true;
    S.paused = false;
    showDock();
    if (mode) S.mode = mode;
    if (toolbar) toolbar.style.display = 'flex';
    if (panel) panel.style.display = '';

    document.removeEventListener('mousemove', onMouseMove, true);
    document.removeEventListener('mouseover', onFrameMouseOver, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('keydown', onKeyDown, true);

    document.addEventListener('mousemove', onMouseMove, { capture: true, passive: true });
    document.addEventListener('mouseover', onFrameMouseOver, { capture: true, passive: true });
    document.addEventListener('click', onClick, { capture: true });
    document.addEventListener('keydown', onKeyDown, { capture: true });

    setMode(S.mode || 'inspect');
    watchLicense(true);
    xpWarmUp();
  }

  function deactivate() {
    watchLicense(false);
    if (colorPickAbort) colorPickAbort.abort();
    closeImagePalette(true);
    toggleColorToolMenu(false);
    S.active = false;
    S.paused = false;
    if (tbBtnPause) {
      tbBtnPause.classList.remove('sr-active');
      const ttTitle = tbBtnPause.querySelector('.sr-tt-title');
      if (ttTitle) ttTitle.textContent = 'Pause';
    }
    showDock();
    if (dockRestoreTab) dockRestoreTab.style.display = 'none';
    if (isResponsiveOpen) closeResponsiveStage();
    S.curEl = null;
    S.selectedEl = null;
    S.hoveredEl = null;
    S.dragging = false;

    // Clean all pinned cards and overlays
    pinnedCards.forEach(c => {
      if (c.cardNode) c.cardNode.remove();
      else if (c.node) c.node.remove();
      if (c.overlayNode) c.overlayNode.remove();
    });
    pinnedCards = [];

    // Immediately hide all UI components
    if (toolbar) toolbar.style.display = 'none';
    if (overlay) overlay.style.display = 'none';
    if (rulersContainer) rulersContainer.style.display = 'none';
    if (distOverlay) distOverlay.style.display = 'none';
    if (respStage) {
      respStage.classList.remove('sr-show-stage');
      respStage.style.setProperty('display', 'none', 'important');
    }
    if (panel) {
      panel.classList.remove('sr-on', 'sr-pinned');
      panel.style.display = 'none';
    }
    if (isSidePanelOpen) closeSidePanel();
    sidePanelTargetEl = null;
    if (sidePanel) sidePanel.classList.remove('sr-sp-open');
    // the custom properties the side panel keeps on <html>: nothing of ours stays on the page's own element
    const rootEl = document.documentElement;
    rootEl.style.removeProperty('--sr-sp-width');
    rootEl.style.removeProperty('--sr-sp-scrollbar');
    if (!rootEl.getAttribute('style')) rootEl.removeAttribute('style');
    clearDistanceLines();
    if (tbBtnPicker) tbBtnPicker.classList.remove('sr-active');
    if (tbBtnResponsive) tbBtnResponsive.classList.remove('sr-active');
    const qToast = document.getElementById('sr-quick-toast');
    if (qToast) qToast.remove();
    const cToast = document.getElementById('sr-color-toast');
    if (cToast) cToast.remove();

    // Detach all global listeners
    document.removeEventListener('mousemove', onMouseMove, true);
    document.removeEventListener('mouseover', onFrameMouseOver, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('keydown', onKeyDown, true);
  }

  // Turns the tools on, or shows the upgrade card when the trial has ended without a license.
  // Resolves with whether the tools are on.
  function requestActivation(mode) {
    // A copy left over from before an update can't check the license; the next icon click replaces it
    if (!window.__screenRulerAlive || !window.__screenRulerAlive()) return Promise.resolve(false);
    return getLicenseState().then(state => {
      if (toolsUnlocked(state)) {
        activate(mode);
        renderTrialPill(state);
      } else {
        showUpgradeCard(state);
      }
      return S.active;
    });
  }

  function toggleInspector() {
    if (S.active) {
      deactivate();
    } else {
      requestActivation();
    }
  }

  // Export globally: only the toggle, which goes through the license check
  window.__screenRulerToggle = toggleInspector;

  // ── Extension Messages ──────────────────────────────────────
  function onRuntimeMessage(msg, _, reply) {
    if (msg.type === 'SR_TOGGLE' && S.active) {
      deactivate();
      reply?.({ active: false });
    } else if (msg.type === 'SR_TOGGLE' || msg.type === 'SR_ACTIVATE') {
      // The license check is asynchronous, so keep the channel open for the reply
      requestActivation(msg.mode).then(active => reply?.({ active }));
      return true;
    } else if (msg.type === 'SR_DEACTIVATE') {
      deactivate();
      reply?.({ active: false });
    } else if (msg.type === 'SR_GET_STATUS') {
      reply?.({ active: S.active });
    } else if (msg.type === 'SR_STYLES_GRANTED') {
      // the site's stylesheets can be read now: read the selected section again
      if (window.DTExport) window.DTExport.forget();
      if (xpJob && xpJob.el && xpJob.el.isConnected && isSidePanelOpen) {
        const el = xpJob.el;
        xpCancel();
        updateSidePanel(el);
      }
      reply?.({ ok: true });
    }
    return false;
  }

  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener(onRuntimeMessage);
  }

  // Global Keyboard Shortcuts
  function onGlobalKeyDown(e) {
    // Leave Alt/Option combos alone while typing (e.g. Option+I / Option+M on macOS)
    if (!e.altKey || e.ctrlKey || e.metaKey || isTypingTarget(e.target)) return;
    if (keyIs(e, 'KeyI')) {
      e.preventDefault();
      if (!S.active) requestActivation('inspect');
      else setMode('inspect');
    } else if (keyIs(e, 'KeyM')) {
      e.preventDefault();
      if (!S.active) requestActivation('measure');
      else setMode('measure');
    }
  }
  document.addEventListener('keydown', onGlobalKeyDown);

  // Responsive Mode lifts frame-blocking headers for this tab; restore them if the page
  // goes away while it is still open.
  function onPageHide() {
    if (isResponsiveOpen) setFramingAllowed(false);
  }
  window.addEventListener('pagehide', onPageHide);

  // Removes this copy of the toolkit completely: its UI, page classes and every listener.
  function dispose() {
    try {
      deactivate();
    } catch (_) {}
    [overlay, panel, distOverlay, rulersContainer, toolbar, dockRestoreTab, sidePanel, respStage].forEach(node => {
      if (node) node.remove();
    });
    document.querySelectorAll('#sr-color-toast, #sr-quick-toast, #sr-xp-modal, #sr-xp-measure, #sr-imgpal, #sr-imgpick-box, #sr-imgpick-hint').forEach(node => node.remove());
    closeUpgradeCard();
    document.documentElement.classList.remove('sr-sp-pushed', 'sr-sp-resizing', 'sr-sp-left', 'sr-imgpicking');
    if (document.body) document.body.classList.remove('sr-sp-pushed');
    unwatchFixedElements();
    window.removeEventListener('resize', handleResize);
    window.removeEventListener('scroll', updateAllPinnedPositions, true);
    window.removeEventListener('scroll', onPageScroll, true);
    window.removeEventListener('pagehide', onPageHide);
    document.removeEventListener('click', onResponsiveOutsideClick);
    document.removeEventListener('keydown', onGlobalKeyDown);
    document.removeEventListener(DISPOSE_EVENT, dispose);
    document.removeEventListener('mousedown', onColorMenuOutside, true);
    try {
      chrome.runtime.onMessage.removeListener(onRuntimeMessage);
      chrome.storage.onChanged.removeListener(onStorageChanged);
    } catch (_) {}
    if (window.__screenRulerToggle === toggleInspector) {
      window.__screenRulerLoaded = false;
      delete window.__screenRulerToggle;
      delete window.__screenRulerAlive;
    }
  }
  document.addEventListener(DISPOSE_EVENT, dispose);

  // The toolkit UI is built lazily by activate(), so pages where it is never opened
  // are left untouched.
})();
