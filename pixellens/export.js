// PixelLens — section export.
//
// Turns a live section of any page into code you can paste — Tailwind, HTML + CSS, React, Vue or
// an Elementor template — with a live copy to look at first and a measured score of how closely
// that copy renders.
//
// Why it works the way it does. The browser's computed values are faithful but rigid: every width
// comes back in px. The page's own rules are flexible but partial: some stylesheets can't be read.
// So each value is taken from the page's cascade where it can be read (`mx-auto` stays `auto`,
// `w-full` stays 100%), from the computed style where it can't, and the result is then rendered
// beside the original and measured. Anything that lands more than a pixel off is pinned to what
// the page actually draws. The score in the panel is that measurement, not an estimate.
//
// Loaded before content.js, which calls DTExport.build(). Nothing here changes the page except a
// data attribute on the exported nodes while they are read, removed before the call returns.
(() => {
  'use strict';

  // ── what is read ───────────────────────────────────────────────
  const MAX_NODES = 1500;
  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'LINK', 'META', 'BASE', 'TITLE', 'SOURCE', 'TRACK', 'PARAM', 'OBJECT', 'EMBED']);
  // What a display value turns into once the box is absolutely positioned or floated.
  const blockified = d => ({ inline: 'block', 'inline-block': 'block', 'inline-flex': 'flex', 'inline-grid': 'grid', 'inline-table': 'table', 'inline-flow-root': 'flow-root' }[d] || d);
  // The toolkit's own classes start with sr-; the page's screen-reader text (sr-only) stays.
  const OWN_CLASS = c => /^sr-/.test(c) && !/^sr-only/.test(c);
  const VOID = new Set(['area', 'br', 'col', 'hr', 'img', 'input', 'wbr']);
  const TEXTLESS = new Set(['img', 'video', 'iframe', 'canvas', 'audio', 'picture', 'br', 'wbr']);
  const BOOL_ATTR = /^(autoplay|muted|loop|playsinline|controls|disabled|checked|readonly|required|allowfullscreen|open|hidden|selected|multiple|download)$/;

  const PROPS = [
    'display', 'position', 'top', 'right', 'bottom', 'left', 'z-index', 'float', 'clear', 'box-sizing',
    'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height',
    'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
    'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
    'overflow-x', 'overflow-y', 'aspect-ratio', 'object-fit', 'object-position', 'vertical-align', 'visibility', 'isolation',
    'flex-direction', 'flex-wrap', 'justify-content', 'align-items', 'align-content', 'align-self', 'justify-items', 'justify-self',
    'flex-grow', 'flex-shrink', 'flex-basis', 'order', 'row-gap', 'column-gap',
    'grid-template-columns', 'grid-template-rows', 'grid-template-areas', 'grid-auto-flow', 'grid-auto-columns', 'grid-auto-rows',
    'grid-column-start', 'grid-column-end', 'grid-row-start', 'grid-row-end',
    'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
    'border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style',
    'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
    'border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius',
    'outline-width', 'outline-style', 'outline-color', 'outline-offset',
    'font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing', 'word-spacing',
    'text-align', 'text-transform', 'text-indent', 'white-space', 'word-break', 'overflow-wrap', 'text-overflow',
    'text-decoration-line', 'text-decoration-color', 'text-decoration-style', 'text-decoration-thickness', 'text-underline-offset',
    'font-feature-settings', 'font-variant-numeric', 'font-variation-settings', 'font-optical-sizing', 'font-stretch', 'font-kerning', 'font-variant-ligatures', 'font-variant-caps', 'font-size-adjust', 'text-rendering', 'hyphens', 'direction', 'writing-mode', '-webkit-font-smoothing', 'text-wrap-style', '-webkit-line-clamp', '-webkit-box-orient',
    'color', '-webkit-text-fill-color', '-webkit-text-stroke-width', '-webkit-text-stroke-color',
    'background-color', 'background-image', 'background-size', 'background-position', 'background-repeat', 'background-clip', 'background-origin', 'background-attachment',
    'opacity', 'box-shadow', 'text-shadow', 'filter', 'backdrop-filter', 'mix-blend-mode',
    'transform', 'transform-origin', 'translate', 'rotate', 'scale', 'perspective', 'clip-path', 'mask-image', 'mask-size', 'mask-position', 'mask-repeat',
    'transition-property', 'transition-duration', 'transition-timing-function', 'transition-delay',
    'animation-name', 'animation-duration', 'animation-timing-function', 'animation-delay', 'animation-iteration-count', 'animation-direction', 'animation-fill-mode', 'animation-play-state', 'animation-timeline', 'animation-range-start', 'animation-range-end',
    'cursor', 'pointer-events', 'user-select', 'list-style-type', 'list-style-position', 'list-style-image',
    'border-collapse', 'border-spacing', 'table-layout', 'scroll-snap-type', 'scroll-snap-align', 'content-visibility', 'container-type', 'container-name',
    // layout and paint containment change where a line's baseline sits (GitHub's footer links), and the rest draw differently when missing
    'contain', 'column-count', 'column-width', 'column-fill', 'column-span', 'text-align-last', 'tab-size', 'line-break', 'image-rendering', 'caret-color', 'accent-color', 'color-scheme', 'resize', 'appearance', 'backface-visibility', 'transform-style', 'box-decoration-break', 'clip', 'background-blend-mode', 'scrollbar-width', 'scrollbar-color', 'text-underline-position', 'text-decoration-skip-ink', 'mask-composite', 'mask-clip', 'mask-origin', 'mask-mode', 'border-image-source', 'border-image-slice', 'border-image-width', 'border-image-outset', 'border-image-repeat',
    'fill', 'stroke', 'stroke-width'
  ];
  const PROP_SET = new Set(PROPS);

  const INHERITED = new Set([
    'color', 'font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing', 'word-spacing',
    'text-align', 'text-transform', 'text-indent', 'white-space', 'word-break', 'overflow-wrap', 'font-feature-settings',
    'font-variant-numeric', 'font-variation-settings', 'font-optical-sizing', 'font-stretch', 'font-kerning', 'font-variant-ligatures', 'font-variant-caps', 'font-size-adjust', 'text-rendering', 'hyphens', 'direction', 'writing-mode', '-webkit-font-smoothing', 'text-wrap-style', 'visibility', 'cursor', 'list-style-type',
    'list-style-position', 'list-style-image', 'border-collapse', 'border-spacing', '-webkit-text-fill-color',
    '-webkit-text-stroke-width', '-webkit-text-stroke-color', 'text-shadow', 'pointer-events', 'fill', 'stroke', 'stroke-width',
    'text-align-last', 'tab-size', 'line-break', 'image-rendering', 'caret-color', 'accent-color', 'color-scheme', 'scrollbar-color', 'text-underline-position', 'text-decoration-skip-ink'
  ]);
  const TEXT_PROPS = new Set(['color', 'font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing', 'word-spacing', 'text-align', 'text-transform', 'text-indent', 'white-space', 'word-break', 'overflow-wrap', 'font-feature-settings', 'font-variant-numeric', 'font-variation-settings', 'font-optical-sizing', 'font-stretch', 'font-kerning', 'font-variant-ligatures', 'font-variant-caps', 'font-size-adjust', 'text-rendering', 'hyphens', '-webkit-font-smoothing', 'text-wrap-style', '-webkit-text-fill-color', '-webkit-text-stroke-width', '-webkit-text-stroke-color', 'text-shadow', 'text-decoration-line', 'text-decoration-color', 'text-decoration-style', 'text-decoration-thickness', 'text-underline-offset', 'text-overflow']);

  // The root sets the type for everything inside it, so the copy reads the same wherever it lands.
  const ROOT_TYPE = ['font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing', 'color', 'font-style', '-webkit-font-smoothing'];

  // Read from the page's own rules first: these are the values that keep layout fluid.
  const AUTHORED_FIRST = new Set([
    'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height', 'flex-basis',
    'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
    'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
    'top', 'right', 'bottom', 'left', 'row-gap', 'column-gap',
    'grid-template-columns', 'grid-template-rows', 'grid-auto-columns', 'grid-auto-rows',
    'font-size', 'line-height', 'letter-spacing', 'word-spacing', 'text-indent',
    'transform', 'translate', 'rotate', 'scale', 'transform-origin',
    'border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius',
    'background-size', 'background-position', 'object-position', 'aspect-ratio', 'outline-offset',
    'text-underline-offset', 'text-decoration-thickness'
  ]);
  // Computed values for these are resolved to px (a used width, a grid's track sizes, the centre
  // of the box); without an authored value they are left to layout, which recomputes them.
  const ONLY_AUTHORED = new Set(['width', 'height', 'grid-template-rows', 'grid-auto-rows', 'grid-auto-columns', 'transform-origin']);
  // What these go back to where no rule sets them. The reset frame reports them resolved (a
  // form's width as 1200px), which written into a breakpoint would fix the size.
  const UNSET_TO = { width: 'auto', height: 'auto', 'flex-basis': 'auto', 'max-width': 'none', 'max-height': 'none', top: 'auto', right: 'auto', bottom: 'auto', left: 'auto', 'grid-template-rows': 'none', 'grid-template-columns': 'none', 'grid-auto-rows': 'auto', 'grid-auto-columns': 'auto', 'transform-origin': '50% 50%' };
  // Colours whose default is the element's own text colour rather than a fixed value.
  const CURRENT_COLOR = new Set(['border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color', 'outline-color', 'text-decoration-color', '-webkit-text-fill-color', '-webkit-text-stroke-color']);
  const FLEX_ITEM = /^(order|align-self|justify-self|flex-grow|flex-shrink|flex-basis|grid-(column|row)-(start|end))$/;

  // Physical property → the logical longhand that sets it (left-to-right, right-to-left).
  const LOGICAL = {
    'margin-top': ['margin-block-start'], 'margin-bottom': ['margin-block-end'],
    'margin-left': ['margin-inline-start', 'margin-inline-end'], 'margin-right': ['margin-inline-end', 'margin-inline-start'],
    'padding-top': ['padding-block-start'], 'padding-bottom': ['padding-block-end'],
    'padding-left': ['padding-inline-start', 'padding-inline-end'], 'padding-right': ['padding-inline-end', 'padding-inline-start'],
    top: ['inset-block-start'], bottom: ['inset-block-end'], left: ['inset-inline-start', 'inset-inline-end'], right: ['inset-inline-end', 'inset-inline-start'],
    width: ['inline-size'], height: ['block-size'], 'min-width': ['min-inline-size'], 'max-width': ['max-inline-size'], 'min-height': ['min-block-size'], 'max-height': ['max-block-size'],
    'border-top-left-radius': ['border-start-start-radius', 'border-start-end-radius'], 'border-top-right-radius': ['border-start-end-radius', 'border-start-start-radius'],
    'border-bottom-left-radius': ['border-end-start-radius', 'border-end-end-radius'], 'border-bottom-right-radius': ['border-end-end-radius', 'border-end-start-radius']
  };
  ['width', 'style', 'color'].forEach(c => {
    LOGICAL[`border-top-${c}`] = [`border-block-start-${c}`];
    LOGICAL[`border-bottom-${c}`] = [`border-block-end-${c}`];
    LOGICAL[`border-left-${c}`] = [`border-inline-start-${c}`, `border-inline-end-${c}`];
    LOGICAL[`border-right-${c}`] = [`border-inline-end-${c}`, `border-inline-start-${c}`];
  });
  const PHYSICAL_OF = {};
  Object.entries(LOGICAL).forEach(([phys, [ltr]]) => { PHYSICAL_OF[ltr] = phys; });
  // right to left, inline-start is the right side
  const PHYSICAL_OF_RTL = {};
  Object.entries(LOGICAL).forEach(([phys, [ltr, rtlName]]) => { PHYSICAL_OF_RTL[rtlName || ltr] = phys; });
  const physical = (p, rtl) => (rtl ? PHYSICAL_OF_RTL[p] : PHYSICAL_OF[p]) || p;

  // A shorthand written with var() leaves its longhands empty in the CSSOM, so the value has to be
  // read from the shorthand and split.
  const SHORTHANDS_OF = {};
  const addSh = (prop, sh, pos, kind, rtlPos, dir) => (SHORTHANDS_OF[prop] = (SHORTHANDS_OF[prop] || []).concat({ sh, pos, kind, rtlPos: rtlPos ?? pos, dir }));
  // borders, the most specific shorthand first: `border-left` beats `border-inline`, which beats `border`
  const SIDES = ['top', 'right', 'bottom', 'left'];
  ['width', 'style', 'color'].forEach((c, ci) => {
    SIDES.forEach(s => addSh(`border-${s}-${c}`, `border-${s}`, ci, 'border'));
    addSh(`border-left-${c}`, 'border-inline-start', ci, 'border', ci, 'ltr'); addSh(`border-left-${c}`, 'border-inline-end', ci, 'border', ci, 'rtl');
    addSh(`border-right-${c}`, 'border-inline-end', ci, 'border', ci, 'ltr'); addSh(`border-right-${c}`, 'border-inline-start', ci, 'border', ci, 'rtl');
    addSh(`border-top-${c}`, 'border-block-start', ci, 'border'); addSh(`border-bottom-${c}`, 'border-block-end', ci, 'border');
    ['left', 'right'].forEach(s => addSh(`border-${s}-${c}`, 'border-inline', ci, 'border'));
    ['top', 'bottom'].forEach(s => addSh(`border-${s}-${c}`, 'border-block', ci, 'border'));
    SIDES.forEach((s, i) => addSh(`border-${s}-${c}`, `border-${c}`, i, 'box'));
    SIDES.forEach(s => addSh(`border-${s}-${c}`, 'border', ci, 'border'));
  });
  ['margin', 'padding'].forEach(b => {
    ['top', 'right', 'bottom', 'left'].forEach((s, i) => addSh(`${b}-${s}`, b, i, 'box'));
    addSh(`${b}-left`, `${b}-inline`, 0, 'pair', 1); addSh(`${b}-right`, `${b}-inline`, 1, 'pair', 0);
    addSh(`${b}-top`, `${b}-block`, 0, 'pair'); addSh(`${b}-bottom`, `${b}-block`, 1, 'pair');
  });
  ['top', 'right', 'bottom', 'left'].forEach((s, i) => addSh(s, 'inset', i, 'box'));
  addSh('left', 'inset-inline', 0, 'pair', 1); addSh('right', 'inset-inline', 1, 'pair', 0);
  addSh('top', 'inset-block', 0, 'pair'); addSh('bottom', 'inset-block', 1, 'pair');
  ['border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius'].forEach((p, i) => addSh(p, 'border-radius', i, 'box'));
  addSh('row-gap', 'gap', 0, 'pair'); addSh('column-gap', 'gap', 1, 'pair');
  // grid placement, split at its slashes: `span 3`, `1 / -1`, `a / b / c / d`
  ['column', 'row'].forEach(axis => { addSh(`grid-${axis}-start`, `grid-${axis}`, 0, 'slash'); addSh(`grid-${axis}-end`, `grid-${axis}`, 1, 'slash'); });
  [['grid-row-start', 0], ['grid-column-start', 1], ['grid-row-end', 2], ['grid-column-end', 3]].forEach(([p, i]) => addSh(p, 'grid-area', i, 'slash'));
  const SHORTHAND_NAMES = new Set(Object.values(SHORTHANDS_OF).flat().map(s => s.sh));

  // A small reset both sides agree on — the same ground Tailwind's preflight gives a project — so
  // what is left over after comparing against it is exactly what the element changes.
  const RESET = [
    ['*, ::before, ::after', 'box-sizing:border-box;margin:0;padding:0;border:0 solid'],
    ['h1, h2, h3, h4, h5, h6', 'font-size:inherit;font-weight:inherit'],
    ['a', 'color:inherit;text-decoration:inherit'],
    ['b, strong', 'font-weight:bolder'],
    ['ol, ul, menu', 'list-style:none'],
    ['img, svg, video, canvas, audio, iframe', 'display:block;vertical-align:middle'],
    ['img, video', 'max-width:100%;height:auto'],
    ['button, input, select, optgroup, textarea', 'font:inherit;color:inherit;letter-spacing:inherit;background-color:transparent;border-radius:0'],
    ['table', 'border-collapse:collapse;text-indent:0;border-color:inherit'],
    ['[hidden]', 'display:none']
  ];
  // Scoped, the tag part sits in :where() so a class on the same element always wins over it.
  const resetCss = scope => RESET.map(([sel, body]) => {
    if (!scope) return `${sel}{${body}}`;
    const scoped = sel.split(',').map(s => {
      s = s.trim();
      if (s === '*') return `${scope}, ${scope} *`;
      if (s.startsWith('::')) return `${scope}${s}, ${scope} *${s}`;
      return `${scope}:where(${s}), ${scope} :where(${s})`;
    }).join(', ');
    return `${scoped} {${body}}`;
  }).join('\n');

  // ── small helpers ──────────────────────────────────────────────
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const num = v => parseFloat(v);
  const fmtNum = n => {
    const r = Math.round(n * 100) / 100;
    return (Object.is(r, -0) ? 0 : r).toString();
  };
  const camel = s => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  const kebab = s => s.replace(/[A-Z]/g, c => '-' + c.toLowerCase());
  const isPx = v => /^-?\d*\.?\d+px$/.test(String(v).trim());
  const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // Splits on a separator only at the top level — not inside (), [] or quotes. ' ' splits on any space.
  function splitTop(text, sep) {
    const out = [];
    let depth = 0, quote = null, buf = '';
    const s = String(text);
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (quote) {
        buf += ch;
        if (ch === '\\') buf += s[++i] || '';
        else if (ch === quote) quote = null;
        continue;
      }
      if (ch === '"' || ch === "'") { quote = ch; buf += ch; continue; }
      if (ch === '\\') { buf += ch + (s[++i] || ''); continue; }
      if (ch === '(' || ch === '[') depth++;
      else if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1);
      if (depth === 0 && (sep === ' ' ? /\s/.test(ch) : ch === sep)) {
        if (sep !== ' ' || buf.trim()) out.push(buf.trim());
        buf = '';
        continue;
      }
      buf += ch;
    }
    if (buf.trim() || (sep !== ' ' && out.length)) out.push(buf.trim());
    return out;
  }

  const unescapeIdent = s => s.replace(/\\([0-9a-fA-F]{1,6}\s?|[\s\S])/g, (_, e) => (/^[0-9a-fA-F]{1,6}\s?$/.test(e) ? String.fromCodePoint(parseInt(e, 16)) : e));

  // rgb()/rgba() → #rrggbb or #rrggbbaa. Anything else (keywords, color-mix, oklch…) is kept.
  function hexColor(v) {
    const m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/i.exec(String(v).trim());
    if (!m) return v;
    const a = m[4] === undefined ? 1 : m[4].endsWith('%') ? num(m[4]) / 100 : num(m[4]);
    if (a === 0) return 'transparent';
    const h = x => Math.round(clamp(num(x), 0, 255)).toString(16).padStart(2, '0');
    const base = `#${h(m[1])}${h(m[2])}${h(m[3])}`;
    return a >= 1 ? base : base + Math.round(a * 255).toString(16).padStart(2, '0');
  }
  const colorize = v => String(v).replace(/rgba?\([^()]*\)/gi, c => hexColor(c));
  const absUrl = (u, base) => { try { return new URL(u, base).href; } catch (_) { return u; } };
  // a font file as a data: URL, fetched once per session
  const fontData = new Map();
  const fontAsData = url => {
    if (!fontData.has(url)) {
      fontData.set(url, fetch(url, { credentials: 'same-origin' })
        .then(r => (r.ok ? r.blob() : null))
        .then(b => (b && b.size < 3 * 1024 * 1024 ? new Promise(res => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = () => res(null); fr.readAsDataURL(b); }) : null))
        .catch(() => null));
    }
    return fontData.get(url);
  };

  // every candidate in a srcset, made absolute
  const absSrcset = (set, base) => {
    const out = [];
    const re = /\s*(\S+?)(?:\s+(\d*\.?\d+[wxh]))?\s*(?:,|$)/g;
    let m;
    while ((m = re.exec(set)) && m[0]) out.push(m[2] ? `${absUrl(m[1], base)} ${m[2]}` : absUrl(m[1], base));
    return out.join(', ');
  };
  const absUrls = (css, base) => String(css).replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (m, q, u) => (/^(data:|#)/.test(u) ? m : `url("${absUrl(u, base)}")`));

  // ── values: var(), calc(), units ───────────────────────────────
  let REM = 16;

  // var() substitution; `get` answers a custom property's value.
  function resolveVars(value, get, depth = 0) {
    if (!value || value.indexOf('var(') < 0 || depth > 8) return value;
    let out = '', i = 0;
    while (i < value.length) {
      const at = value.indexOf('var(', i);
      if (at < 0) { out += value.slice(i); break; }
      out += value.slice(i, at);
      let d = 0, j = at + 3;
      for (; j < value.length; j++) {
        if (value[j] === '(') d++;
        else if (value[j] === ')') { d--; if (d === 0) break; }
      }
      const [name, ...rest] = splitTop(value.slice(at + 4, j), ',');
      const fallback = rest.join(',').trim();
      let got = (get(name.trim()) || '').trim();
      if (!got && fallback) got = fallback;
      out += got;
      i = j + 1;
    }
    return out.indexOf('var(') >= 0 ? resolveVars(out, get, depth + 1) : out;
  }

  // calc() of px, rem and plain numbers is worked out; anything relative is left as written.
  function evalCalc(expr) {
    const tokens = expr.match(/\d*\.?\d+(?:e-?\d+)?(?:px|rem)?|[()+\-*/]|calc/gi);
    const leftover = expr.replace(/\d*\.?\d+(?:e-?\d+)?(?:px|rem)?|calc|[\s()+\-*/]/gi, '');
    if (!tokens || leftover) return null;
    let p = 0;
    const peek = () => tokens[p];
    const factor = () => {
      let t = tokens[p++];
      if (t === undefined) throw new Error('end');
      if (/^calc$/i.test(t)) t = tokens[p++];
      if (t === '(') { const v = sum(); if (tokens[p++] !== ')') throw new Error('paren'); return v; }
      if (t === '-') { const f = factor(); return { v: -f.v, unit: f.unit }; }
      if (t === '+') return factor();
      if (!/\d/.test(t)) throw new Error('token');
      return { v: /rem$/i.test(t) ? num(t) * REM : num(t), unit: /px|rem/i.test(t) };
    };
    const term = () => {
      let a = factor();
      while (peek() === '*' || peek() === '/') {
        const op = tokens[p++];
        const b = factor();
        a = op === '*' ? { v: a.v * b.v, unit: a.unit || b.unit } : { v: a.v / b.v, unit: a.unit };
      }
      return a;
    };
    const sum = () => {
      let a = term();
      while (peek() === '+' || peek() === '-') {
        const op = tokens[p++];
        const b = term();
        a = { v: op === '+' ? a.v + b.v : a.v - b.v, unit: a.unit || b.unit };
      }
      return a;
    };
    try {
      const r = sum();
      return p === tokens.length && isFinite(r.v) ? r : null;
    } catch (_) {
      return null;
    }
  }
  function simplifyCalc(value) {
    if (!value || value.indexOf('calc(') < 0) return value;
    return value.replace(/calc\(((?:[^()]|\((?:[^()]|\([^()]*\))*\))*)\)/g, (whole, expr) => {
      const r = evalCalc(expr);
      return r === null ? whole : r.unit ? `${fmtNum(r.v)}px` : fmtNum(r.v);
    });
  }
  const remToPx = v => String(v).replace(/(^|[\s(,])(-?\d*\.?\d+)rem\b/g, (_, pre, n) => `${pre}${fmtNum(num(n) * REM)}px`);
  const finish = v => colorize(simplifyCalc(remToPx(String(v).trim()))).replace(/\s+/g, ' ');
  // The CSSOM writes a shadow's colour first; Tailwind v4 only reads it last.
  const COLOR_TOKEN = /^(#[0-9a-f]{3,8}|(rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color|color-mix)\(.*\)|transparent|currentcolor|[a-z]+)$/i;
  // A layer with no offset, blur or spread draws nothing; Tailwind v4 stacks several of them as
  // placeholders for its ring utilities, and they would only bloat the copy.
  const emptyShadow = parts => parts.filter(p => /^-?\d*\.?\d+(px)?$/.test(p)).every(p => num(p) === 0);
  const shadowOrder = v => {
    if (/^none$/.test(v)) return v;
    const layers = splitTop(v, ',').map(sh => splitTop(sh, ' ')).filter(parts => !emptyShadow(parts)).map(parts => {
      const ci = parts.findIndex(p => COLOR_TOKEN.test(p) && p !== 'inset');
      if (ci < 0 || ci === parts.length - 1) return parts.join(' ');
      const [c] = parts.splice(ci, 1);
      return parts.concat(c).join(' ');
    });
    return layers.length ? layers.join(', ') : 'none';
  };
  const polish = (prop, v) => (/shadow$/.test(prop) ? shadowOrder(v) : v);
  // A grid's computed columns are its resolved track sizes; equal tracks were almost always 1fr.
  const gridCols = v => {
    const t = splitTop(v, ' ');
    if (t.length > 1 && t.every(x => isPx(x)) && Math.max(...t.map(num)) - Math.min(...t.map(num)) < 1) return `repeat(${t.length}, minmax(0, 1fr))`;
    return v;
  };

  // ── selectors ──────────────────────────────────────────────────
  const STATE = /(?<!\\):(hover|focus-visible|focus-within|focus|active)(?![\w-])/;
  const STATE_ALL = /(?<!\\):(hover|focus-visible|focus-within|focus|active)(?![\w-])/g;
  const PSEUDO_EL = /::?(before|after)(?![\w-])/;
  const PSEUDO_EL_ALL = /::?(before|after)(?![\w-])/g;
  const OTHER_PSEUDO_EL = /::(placeholder|marker|selection|backdrop|file-selector-button|first-line|first-letter|-webkit-[\w-]+|-moz-[\w-]+|part\(|slotted\(|cue|highlight\(|view-transition)/;

  // Specificity as [ids, classes, types] packed into one number.
  function specificity(sel) {
    let a = 0, b = 0, c = 0, i = 0;
    const s = sel;
    const readIdent = () => { while (i < s.length && /[\w\\-]/.test(s[i])) { if (s[i] === '\\') i++; i++; } };
    const readParens = () => {
      let d = 0;
      const start = i;
      for (; i < s.length; i++) { if (s[i] === '(') d++; else if (s[i] === ')') { d--; if (d === 0) { i++; break; } } }
      return s.slice(start + 1, i - 1);
    };
    while (i < s.length) {
      const ch = s[i];
      if (ch === '#') { a++; i++; readIdent(); }
      else if (ch === '.') { b++; i++; readIdent(); }
      else if (ch === '[') { b++; while (i < s.length && s[i] !== ']') i++; i++; }
      else if (ch === ':') {
        if (s[i + 1] === ':') { c++; i += 2; readIdent(); if (s[i] === '(') readParens(); continue; }
        i++;
        const start = i;
        readIdent();
        const name = s.slice(start, i).toLowerCase();
        if (s[i] === '(') {
          const args = readParens();
          if (name === 'where') continue;
          if (name === 'is' || name === 'not' || name === 'has' || name === 'matches') {
            const best = splitTop(args, ',').reduce((m, part) => Math.max(m, specificity(part)), 0);
            a += Math.floor(best / 1e6); b += Math.floor((best % 1e6) / 1e3); c += best % 1e3;
            continue;
          }
          b++;
          continue;
        }
        if (['before', 'after', 'first-line', 'first-letter'].includes(name)) c++;
        else b++;
      } else if (/[a-zA-Z_]/.test(ch) && (i === 0 || /[\s>+~(,]/.test(s[i - 1]))) { c++; readIdent(); }
      else i++;
    }
    return a * 1e6 + b * 1e3 + c;
  }

  // The compounds of a selector, split at its combinators — not at an escaped `+` inside a class
  // such as `top-[calc(50%+1rem)]`, nor inside brackets, parentheses or quotes.
  function compoundsOf(sel) {
    const out = [];
    let depth = 0, quote = null, buf = '';
    for (let i = 0; i < sel.length; i++) {
      const ch = sel[i];
      if (quote) {
        buf += ch;
        if (ch === '\\') buf += sel[++i] || '';
        else if (ch === quote) quote = null;
        continue;
      }
      if (ch === '"' || ch === "'") { quote = ch; buf += ch; continue; }
      if (ch === '\\') { buf += ch + (sel[++i] || ''); continue; }
      if (ch === '(' || ch === '[') depth++;
      else if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1);
      if (!depth && /[\s>+~]/.test(ch)) { if (buf) out.push(buf); buf = ''; continue; }
      buf += ch;
    }
    if (buf) out.push(buf);
    return out;
  }

  // The id, class or tag the rightmost compound ends in — the bucket a rule is filed under.
  function ruleKey(part) {
    const compounds = compoundsOf(part);
    const last = compounds[compounds.length - 1] || '';
    const bare = last.replace(/:(?:is|where|not|has|matches)\((?:[^()]|\([^()]*\))*\)/g, '');
    const id = bare.match(/#((?:\\.|[\w-])+)/);
    if (id) return `#${unescapeIdent(id[1])}`;
    const cls = bare.match(/\.((?:\\.|[\w-])+)/);
    if (cls) return `.${unescapeIdent(cls[1])}`;
    const tag = bare.match(/^[a-zA-Z][\w-]*/);
    if (tag) return tag[0].toLowerCase();
    // Tailwind v4 nests its variants: `:is(.group-hover\:x):is(:where(.group):hover *)`
    const inner = /:is\(((?:[^()]|\([^()]*\))*)\)/.exec(last);
    if (inner && splitTop(inner[1], ',').length === 1) return ruleKey(inner[1]);
    return '*';
  }

  // ── media queries ──────────────────────────────────────────────
  const mediaLen = v => {
    const m = /^(-?\d*\.?\d+)(px|em|rem)?$/.exec(String(v).trim());
    return m ? num(m[1]) * (m[2] === 'em' || m[2] === 'rem' ? 16 : 1) : null;
  };
  // the first whole pixel past a bound
  const after = px => Math.floor(px) + 1;

  // Conditions in the order their blocks must come so the wider screen wins, as on the page:
  // min-widths from small to large, then max-widths from large to small, the rest as they came.
  function sortConds(list) {
    const px = (n, u) => num(n) * (/em$/i.test(u) ? REM : 1);
    const key = c => {
      const min = /\b(?:min-(?:width|inline-size)\s*:\s*|(?:width|inline-size)\s*>=?\s*)(-?\d*\.?\d+)(px|r?em)/i.exec(c);
      if (min) return [0, px(min[1], min[2])];
      const max = /\b(?:max-(?:width|inline-size)\s*:\s*|(?:width|inline-size)\s*<=?\s*)(-?\d*\.?\d+)(px|r?em)/i.exec(c);
      if (max) return [1, -px(max[1], max[2])];
      return [2, 0];
    };
    return list.map((c, i) => [c, key(c), i]).sort((a, b) => a[1][0] - b[1][0] || a[1][1] - b[1][1] || a[2] - b[2]).map(x => x[0]);
  }

  // A container condition measured on a box `d` px wider than the one that will answer it in the
  // copy, with its widths moved to match: (min-width: 961px), 48px wider → (min-width: 913px).
  // em is the container's font size, as container queries count it.
  function shiftCond(cond, d, em, rem) {
    if (!d) return cond;
    return cond.replace(/\(([^()]*)\)/g, (all, inner) => {
      if (!/\b(width|inline-size)\b/i.test(inner) || /\b(height|block-size|aspect-ratio|orientation)\b/i.test(inner)) return all;
      return `(${inner.replace(/(-?\d*\.?\d+)(px|rem|em)\b/gi, (m, n, u) => {
        const px = num(n) * (/^rem$/i.test(u) ? rem : /^em$/i.test(u) ? em : 1) - d;
        return `${Math.round(px * 100) / 100}px`;
      })})`;
    });
  }

  // A media text → a test of whether it holds at a viewport width. Features that aren't about
  // width (hover, colour scheme…) are judged once, as they stand now.
  function compileMedia(text, win) {
    const queries = splitTop(text, ',').map(q => q.trim().toLowerCase());
    const bounds = [];
    const tests = queries.map(q => {
      let rest = q;
      let negate = false;
      if (/^not\s+/.test(rest)) { negate = true; rest = rest.replace(/^not\s+/, ''); }
      rest = rest.replace(/^only\s+/, '');
      if (/^print\b/.test(rest)) return () => negate;
      rest = rest.replace(/^(screen|all)\s*(and\s*)?/, '');
      const checks = [];
      const now = raw => { let ok = false; try { ok = win.matchMedia(raw).matches; } catch (_) {} return () => ok; };
      for (const raw of rest.match(/\(((?:[^()]|\([^()]*\))*)\)/g) || []) {
        const f = raw.slice(1, -1).trim();
        let m;
        if ((m = /^(min|max)-width\s*:\s*(.+)$/.exec(f))) {
          const px = mediaLen(m[2]);
          if (px === null) { checks.push(now(raw)); continue; }
          if (m[1] === 'min') { bounds.push(px); checks.push(w => w >= px); }
          else { bounds.push(after(px)); checks.push(w => w <= px); }
        } else if ((m = /^(.+?)\s*(<=|<)\s*width\s*(<=|<)\s*(.+)$/.exec(f))) {
          const lo = mediaLen(m[1]), hi = mediaLen(m[4]);
          if (lo === null || hi === null) { checks.push(now(raw)); continue; }
          bounds.push(m[2] === '<' ? after(lo) : lo, m[3] === '<=' ? after(hi) : hi);
          checks.push(w => (m[2] === '<' ? w > lo : w >= lo) && (m[3] === '<' ? w < hi : w <= hi));
        } else if ((m = /^width\s*(>=|<=|>|<)\s*(.+)$/.exec(f)) || (m = /^(.+?)\s*(<=|>=|<|>)\s*width$/.exec(f))) {
          const leftIsWidth = /^width/.test(f);
          const op = leftIsWidth ? m[1] : { '<=': '>=', '>=': '<=', '<': '>', '>': '<' }[m[2]];
          const px = mediaLen(leftIsWidth ? m[2] : m[1]);
          if (px === null) { checks.push(now(raw)); continue; }
          bounds.push(op === '>' || op === '<=' ? after(px) : px);
          checks.push({ '>=': w => w >= px, '>': w => w > px, '<=': w => w <= px, '<': w => w < px }[op]);
        } else {
          checks.push(now(raw));
        }
      }
      return w => checks.every(fn => fn(w)) !== negate;
    });
    return { test: w => tests.some(fn => fn(w)), bounds, widthDependent: bounds.length > 0 };
  }

  // ── reading the page's stylesheets ─────────────────────────────
  const FONT_HOSTS = /fonts\.googleapis\.com|use\.typekit\.net|fonts\.bunny\.net|api\.fontshare\.com|fast\.fonts\.net/;
  let indexCache = null;

  // A stylesheet from another origin (a CDN, usually) can't be read through the CSSOM, but most
  // CDNs send it with CORS headers, so it can be fetched again and parsed into a copy that can.
  // Without this the page's breakpoints and hover rules would be invisible on those sites.
  // A server that won't send CORS headers can still be read by the extension itself once the
  // person allows it: `fetchText(href)` (content.js asks the worker) answers { text } or, without
  // that permission, { needs: origin }. prepare() resolves with the origins still needed.
  const fetchedSheets = new Map(); // href → CSSStyleSheet, or null while/if it can't be had
  const sheetNeeds = new Map(); // href → origin to ask for
  // canvases that couldn't be read, with a picture of what the page shows of each
  const canvasShots = new WeakMap();
  // Whether a canvas gives its pixels back, and not a blank frame (a WebGL canvas clears its
  // buffer once the frame is shown).
  function readableCanvas(c) {
    try {
      const url = c.toDataURL('image/png');
      // an empty frame encodes to a few hundred bytes; a drawn one to far more
      return url.length > 1500 + (c.width * c.height) / 150;
    } catch (_) {
      return false;
    }
  }
  async function shootCanvases(root, shoot) {
    root.querySelectorAll('canvas, video').forEach(c => canvasShots.delete(c));
    const list = [...root.querySelectorAll('canvas, video')]
      .filter(c => {
        if (!c.getClientRects().length) return false;
        if (c.localName === 'video') {
          const src = c.currentSrc || c.src || '';
          return !c.poster && (!src || /^blob:/.test(src)) && c.videoWidth > 0;
        }
        return c.width > 8 && c.height > 8 && !readableCanvas(c);
      })
      .sort((a, b) => b.getBoundingClientRect().width * b.getBoundingClientRect().height - a.getBoundingClientRect().width * a.getBoundingClientRect().height)
      .slice(0, 3);
    for (const c of list) {
      const url = await shoot(c).catch(() => null);
      if (url) canvasShots.set(c, url); else canvasShots.delete(c);
    }
  }

  async function prepare(doc = document, { fetchText = null, timeout = 5000, root = null, shoot = null } = {}) {
    const win = doc.defaultView || window;
    const shots = root && shoot ? shootCanvases(root, shoot) : Promise.resolve();
    const jobs = [];
    const unreadable = [];
    for (const sheet of doc.styleSheets) {
      const href = sheet.href;
      if (!href || FONT_HOSTS.test(href)) continue;
      try { void sheet.cssRules; continue; } catch (_) {}
      unreadable.push(href);
      if (fetchedSheets.has(href)) continue;
      fetchedSheets.set(href, null);
      jobs.push((async () => {
        let text = null;
        // both ways start at once: a server that sends no CORS headers answers the page's own
        // request with nothing, and waiting for that before asking the worker only adds time
        const viaWorker = fetchText ? fetchText(href).catch(() => null) : Promise.resolve(null);
        try {
          const r = await fetch(href, { mode: 'cors', credentials: 'omit' });
          if (r.ok) text = await r.text();
        } catch (_) {}
        if (text == null && fetchText) {
          const r = await viaWorker;
          if (r && r.text) text = r.text;
          else if (r && r.needs) sheetNeeds.set(href, r.needs);
        }
        if (text == null) return;
        sheetNeeds.delete(href);
        const copy = new win.CSSStyleSheet({ baseURL: href });
        copy.replaceSync(text);
        fetchedSheets.set(href, copy);
      })());
    }
    if (jobs.length) {
      await Promise.race([Promise.all(jobs), new Promise(r => setTimeout(r, timeout))]);
      indexCache = null;
    }
    await shots;
    // index the stylesheets now (kept while they don't change), so reading a section later starts at once
    try { indexStylesheets(doc); } catch (_) {}
    return { needs: [...new Set(unreadable.map(h => sheetNeeds.get(h)).filter(Boolean))] };
  }
  // after permission is given: try the sheets that couldn't be read again
  function forget() {
    [...fetchedSheets].forEach(([href, sheet]) => { if (!sheet) fetchedSheets.delete(href); });
    sheetNeeds.clear();
    indexCache = null;
  }

  function sheetKey(doc) {
    let n = 0;
    const sheets = [...doc.styleSheets, ...(doc.adoptedStyleSheets || [])];
    for (const sh of sheets) { try { n += sh.cssRules.length; } catch (_) { n += 1e6; } }
    return `${sheets.length}:${n}`;
  }

  function indexStylesheets(doc) {
    const key = sheetKey(doc);
    if (indexCache && indexCache.doc === doc && indexCache.key === key && Date.now() - indexCache.at < 180000) return indexCache.idx;
    const win = doc.defaultView || window;
    const byKey = new Map();
    const keyframes = new Map();
    const fontFaces = [];
    const fontImports = [];
    const layerOrder = [];
    const media = new Map();
    let unreadable = 0;
    let order = 0;
    const layerRank = name => {
      if (name == null) return Infinity;
      let i = layerOrder.indexOf(name);
      if (i < 0) { layerOrder.push(name); i = layerOrder.length - 1; }
      return i;
    };
    const compiled = list => list.map(text => {
      if (!media.has(text)) media.set(text, compileMedia(text, win));
      return media.get(text);
    });
    const nest = (sel, parent) => (!parent ? sel : splitTop(sel, ',').map(part => (/(?<!\\)&/.test(part) ? part.replace(/(?<!\\)&/g, `:is(${parent})`) : `:is(${parent}) ${part}`)).join(', '));

    const addRule = (sel, style, ctx, base) => {
      const entry = { selector: sel, style, props: new Set(Array.from(style)), media: compiled(ctx.media), container: ctx.container || null, layer: layerRank(ctx.layer), order: order++, base };
      entry.parts = splitTop(sel, ',').map(raw => {
        const pe = raw.match(PSEUDO_EL);
        const noPe = raw.replace(PSEUDO_EL_ALL, '');
        const state = STATE.test(noPe);
        const stripped = noPe.replace(STATE_ALL, '').trim() || '*';
        return { raw: noPe, pseudoEl: pe ? pe[1] : null, ignore: OTHER_PSEUDO_EL.test(raw) || (state && stripped === '*'), state, stripped, spec: specificity(raw) };
      });
      const keys = new Set();
      entry.parts.forEach(part => { if (!part.ignore) keys.add(ruleKey(part.state ? part.stripped : part.raw)); });
      keys.forEach(k => { const b = byKey.get(k); if (b) b.push(entry); else byKey.set(k, [entry]); });
    };

    const walk = (list, ctx, base) => {
      for (let i = 0; i < list.length; i++) {
        const rule = list[i];
        try {
          const kind = rule.constructor && rule.constructor.name;
          if (kind === 'CSSNestedDeclarations') {
            if (ctx.parentSel) addRule(ctx.parentSel, rule.style, ctx, base);
          } else if (rule.type === 1) {
            const sel = nest(rule.selectorText, ctx.parentSel);
            addRule(sel, rule.style, ctx, base);
            if (rule.cssRules && rule.cssRules.length) walk(rule.cssRules, { ...ctx, parentSel: sel }, base);
          } else if (rule.type === 4) {
            walk(rule.cssRules, { ...ctx, media: ctx.media.concat(rule.media.mediaText) }, base);
          } else if (rule.type === 12) {
            if (CSS.supports(rule.conditionText)) walk(rule.cssRules, ctx, base);
          } else if (rule.type === 3) {
            const href = rule.href ? absUrl(rule.href, base) : '';
            if (FONT_HOSTS.test(href)) { fontImports.push(href); continue; }
            const m2 = rule.media && rule.media.mediaText ? ctx.media.concat(rule.media.mediaText) : ctx.media;
            const layer = rule.layerName != null ? (ctx.layer ? `${ctx.layer}.${rule.layerName}` : rule.layerName) : ctx.layer;
            try { if (rule.styleSheet) walk(rule.styleSheet.cssRules, { ...ctx, media: m2, layer }, rule.styleSheet.href || base); } catch (_) { unreadable++; }
          } else if (rule.type === 7) {
            keyframes.set(rule.name, { rule, base });
          } else if (rule.type === 5) {
            fontFaces.push({ rule, base });
          } else if (kind === 'CSSLayerBlockRule') {
            const name = ctx.layer ? `${ctx.layer}.${rule.name || `anon${order}`}` : rule.name || `anon${order}`;
            layerRank(name);
            walk(rule.cssRules, { ...ctx, layer: name }, base);
          } else if (kind === 'CSSLayerStatementRule') {
            rule.nameList.forEach(n => layerRank(ctx.layer ? `${ctx.layer}.${n}` : n));
          } else if (kind === 'CSSContainerRule') {
            // A container query depends on a box, not the screen. The copy keeps the container
            // (container-type is copied), so the rule is carried over as it is.
            walk(rule.cssRules, { ...ctx, container: rule.conditionText }, base);
          } else if (kind === 'CSSScopeRule' || kind === 'CSSStartingStyleRule') {
            // Not reproducible from here; what they draw today is in the computed values, and
            // authored lengths are checked against those before they are used.
          } else if (rule.cssRules) {
            walk(rule.cssRules, ctx, base);
          }
        } catch (_) {
          // a rule that can't be read
        }
      }
    };
    for (const sheet of [...doc.styleSheets, ...(doc.adoptedStyleSheets || [])]) {
      if (sheet.disabled) continue;
      const base = sheet.href || doc.baseURI;
      if (FONT_HOSTS.test(sheet.href || '')) { fontImports.push(sheet.href); continue; }
      const m = sheet.media && sheet.media.mediaText ? [sheet.media.mediaText] : [];
      let rules = null;
      try { rules = sheet.cssRules; } catch (_) {
        const copy = fetchedSheets.get(sheet.href);
        if (copy) rules = copy.cssRules;
      }
      if (rules) walk(rules, { media: m, layer: null, parentSel: '' }, base);
      else unreadable++;
    }
    doc.querySelectorAll('link[rel~="stylesheet"][href]').forEach(link => {
      if (FONT_HOSTS.test(link.href) && !fontImports.includes(link.href)) fontImports.push(link.href);
    });
    const idx = { byKey, keyframes, fontFaces, fontImports: [...new Set(fontImports)], unreadable };
    indexCache = { doc, key, at: Date.now(), idx };
    return idx;
  }

  // A new iframe holds about:blank, which renders in quirks mode — and quirks mode lays out lines
  // differently (an inline icon loses the space under it). The copies are measured in standards mode.
  function standards(frame) {
    const d = frame.contentDocument;
    if (!d || d.compatMode === 'CSS1Compat') return;
    d.open();
    d.write('<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>');
    d.close();
  }

  // ── the baseline every element is compared against ────────────
  function makeBaseline(doc) {
    const frame = doc.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.id = 'sr-xp-baseline';
    frame.tabIndex = -1;
    frame.style.cssText = 'position:fixed!important;left:-10000px!important;top:0!important;width:1200px!important;height:200px!important;border:0!important;visibility:hidden!important;pointer-events:none!important';
    doc.documentElement.appendChild(frame);
    standards(frame);
    const bdoc = frame.contentDocument;
    const bwin = frame.contentWindow;
    try {
      const sheet = new bwin.CSSStyleSheet();
      sheet.replaceSync(`${resetCss('')}\n.dt-probe::before,.dt-probe::after{content:""}`);
      bdoc.adoptedStyleSheets = [sheet];
    } catch (_) {}
    const cache = new Map();
    const read = (tag, pseudo) => {
      const key = `${tag}|${pseudo || ''}`;
      if (cache.has(key)) return cache.get(key);
      let el;
      try { el = tag === 'svg' ? bdoc.createElementNS('http://www.w3.org/2000/svg', 'svg') : bdoc.createElement(tag); } catch (_) { el = bdoc.createElement('div'); }
      if (tag === 'a') el.setAttribute('href', '#');
      if (pseudo) el.className = 'dt-probe';
      bdoc.body.appendChild(el);
      const cs = bwin.getComputedStyle(el, pseudo ? `::${pseudo}` : null);
      const out = {};
      PROPS.forEach(p => (out[p] = cs.getPropertyValue(p).trim()));
      el.remove();
      cache.set(key, out);
      return out;
    };
    return { read, destroy: () => frame.remove() };
  }

  // ── the cascade, for one element ───────────────────────────────
  function matchedRules(el, idx, wantPseudo = null) {
    // the page's style sheets don't reach into a shadow tree (its own rules are read as the browser draws them)
    if (inShadow(el)) return { base: [], states: [] };
    const keys = ['*', el.localName];
    if (el.id) keys.push(`#${el.id}`);
    for (const c of el.classList || []) keys.push(`.${c}`);
    const seen = new Set();
    const base = [];
    const states = [];
    for (const k of keys) {
      for (const rule of idx.byKey.get(k) || []) {
        if (seen.has(rule.order)) continue;
        seen.add(rule.order);
        let best = -1, bestState = null;
        for (const part of rule.parts) {
          if (part.ignore || part.pseudoEl !== wantPseudo) continue;
          if (part.state) {
            try { if (!bestState && el.matches(part.stripped)) bestState = part; } catch (_) {}
            continue;
          }
          try { if (part.spec > best && el.matches(part.raw)) best = part.spec; } catch (_) {}
        }
        if (best >= 0) base.push({ rule, spec: best });
        if (bestState) states.push({ rule, part: bestState });
      }
    }
    return { base, states };
  }

  // Cascade order: importance, then layer, then specificity, then source order.
  function beats(a, b) {
    if (!b) return true;
    if (a.imp !== b.imp) return a.imp;
    if (a.layer !== b.layer) return a.imp ? a.layer < b.layer : a.layer > b.layer;
    if (a.spec !== b.spec) return a.spec > b.spec;
    return a.order > b.order;
  }

  // What one declaration block says about a property, reading through logical properties and
  // shorthands written with var(). `get` resolves custom properties for the split.
  function declared(style, props, prop, rtl, get) {
    const logical = LOGICAL[prop];
    const ll = logical ? logical[rtl && logical[1] ? 1 : 0] : null;
    if (props && !props.has(prop) && !(ll && props.has(ll))) return null;
    const imp = name => style.getPropertyPriority(name) === 'important';
    let v = style.getPropertyValue(prop);
    const lv = ll ? style.getPropertyValue(ll) : '';
    // both in one block (`padding: 40px; padding-inline-start: 80px`): the later one wins
    if (v && lv) {
      const order = [...style];
      if (order.lastIndexOf(ll) > order.lastIndexOf(prop)) return { value: lv, imp: imp(ll) };
    }
    if (v) return { value: v, imp: imp(prop) };
    if (lv) return { value: lv, imp: imp(ll) };
    for (const src of SHORTHANDS_OF[prop] || []) {
      if (src.dir && src.dir !== (rtl ? 'rtl' : 'ltr')) continue;
      const sv = style.getPropertyValue(src.sh);
      if (!sv) continue;
      if (src.sh === 'border-radius' && sv.includes('/')) return null;
      if (src.kind === 'border') {
        // `1px solid red` in any order; what it leaves out goes back to its initial value
        const v = get ? resolveVars(sv, get) : sv;
        if (/var\(/.test(v)) return get ? null : { value: v, imp: imp(src.sh) }; // unread: only says var() is involved
        const parts = { 0: 'medium', 1: 'none', 2: 'currentcolor' };
        splitTop(v, ' ').forEach(t => {
          if (/^(none|hidden|dotted|dashed|solid|double|groove|ridge|inset|outset)$/i.test(t)) parts[1] = t;
          else if (/^(thin|medium|thick)$/i.test(t) || /^-?\d*\.?\d+[a-z%]*$/i.test(t) || /^(calc|min|max|clamp)\(/i.test(t)) parts[0] = t;
          else parts[2] = t;
        });
        return { value: parts[src.pos], imp: imp(src.sh) };
      }
      if (src.kind === 'slash') {
        const v = get ? resolveVars(sv, get) : sv;
        if (/var\(/.test(v)) return get ? null : { value: v, imp: imp(src.sh) };
        // a part left out repeats the one it pairs with when that is a name, else it is auto
        const parts = splitTop(v, '/').map(s => s.trim());
        const ident = s => /^-?[a-z_][\w-]*$/i.test(s || '') && !/^(auto|span)$/i.test(s);
        const pick = (i, from) => parts[i] ?? (ident(parts[from]) ? parts[from] : 'auto');
        const four = src.sh === 'grid-area'
          ? [parts[0], pick(1, 0), pick(2, 0), parts[3] ?? (ident(pick(1, 0)) ? pick(1, 0) : 'auto')]
          : [parts[0], pick(1, 0)];
        return { value: four[src.pos], imp: imp(src.sh) };
      }
      const parts = splitTop(get ? resolveVars(sv, get) : sv, ' ');
      const pos = rtl ? src.rtlPos : src.pos;
      if (src.kind === 'pair') return { value: parts[Math.min(pos, parts.length - 1)], imp: imp(src.sh) };
      const four = [parts[0], parts[1] ?? parts[0], parts[2] ?? parts[0], parts[3] ?? parts[1] ?? parts[0]];
      return { value: four[pos], imp: imp(src.sh) };
    }
    return null;
  }

  // The properties one rule sets, as the physical longhands this file works in.
  function propsOfRule(rule, rtl = false) {
    const out = new Set();
    rule.props.forEach(p => {
      const phys = physical(p, rtl);
      if (PROP_SET.has(phys)) out.add(phys);
      if (SHORTHAND_NAMES.has(p)) Object.entries(SHORTHANDS_OF).forEach(([lh, srcs]) => { if (srcs.some(s => s.sh === p)) out.add(lh); });
    });
    return out;
  }

  // The winning authored value of a property at a viewport width, before var() is substituted.
  // `keep`: hand back the CSS-wide keywords (initial…) as written, for a custom property read up the
  // tree, where `initial` stops the value being inherited.
  function authoredRaw(el, matched, prop, width, rtl, get, keep = false) {
    let best = null;
    for (const { rule, spec } of matched) {
      if (rule.container || !rule.media.every(m => m.test(width))) continue;
      const d = declared(rule.style, rule.props, prop, rtl, get);
      if (!d || !d.value) continue;
      const cand = { value: d.value, imp: d.imp, layer: rule.layer, spec, order: rule.order, base: rule.base };
      if (beats(cand, best)) best = cand;
    }
    if (el.style && el.style.length) {
      const d = declared(el.style, null, prop, rtl, get);
      if (d && d.value) {
        const cand = { value: d.value, imp: d.imp, layer: Infinity, spec: 1e9, order: 1e9, base: null };
        if (beats(cand, best)) best = cand;
      }
    }
    if (!best) return undefined;
    const v = best.value.trim();
    if (/^(inherit|initial|unset|revert|revert-layer)$/i.test(v)) return keep ? v : undefined;
    return best.base ? absUrls(v, best.base) : v;
  }

  // ── reading one section ────────────────────────────────────────
  const KEEP_ATTRS = new Set(['href', 'target', 'rel', 'alt', 'title', 'role', 'type', 'name', 'placeholder', 'for', 'tabindex', 'lang', 'dir', 'colspan', 'rowspan', 'disabled', 'checked', 'readonly', 'required', 'maxlength', 'min', 'max', 'step', 'poster', 'autoplay', 'muted', 'loop', 'playsinline', 'controls', 'allow', 'allowfullscreen', 'frameborder', 'srcdoc', 'sandbox', 'referrerpolicy', 'scope', 'datetime', 'cite', 'open', 'width', 'height', 'value', 'selected', 'multiple', 'download']);
  const ID_REFS = ['for', 'aria-labelledby', 'aria-describedby', 'aria-controls', 'aria-owns', 'list', 'form'];
  const SVG_PAINT = ['fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'stroke-dashoffset', 'opacity', 'fill-opacity', 'stroke-opacity', 'fill-rule', 'clip-rule', 'stop-color', 'stop-opacity'];

  // An inline SVG, made self-contained: paint that came from the page's CSS is written onto the
  // shapes (as currentColor where it follows the text colour, so hover colours still reach it),
  // and <use> pointing at a sprite elsewhere in the document is replaced by what it draws.
  function serializeSvg(svg, doc) {
    const win = doc.defaultView || window;
    const clone = svg.cloneNode(true);
    const src = [svg, ...svg.querySelectorAll('*')];
    const dst = [clone, ...clone.querySelectorAll('*')];
    src.forEach((node, i) => {
      const out = dst[i];
      if (!out) return;
      if (i > 0) {
        let cs, pcs;
        try { cs = win.getComputedStyle(node); pcs = win.getComputedStyle(node.parentElement || svg); } catch (_) { return; }
        SVG_PAINT.forEach(p => {
          if (out.hasAttribute(p)) return;
          const v = cs.getPropertyValue(p).trim();
          if (!v || v === pcs.getPropertyValue(p).trim()) return;
          if (/^stop-/.test(p) && node.localName !== 'stop') return;
          out.setAttribute(p, (p === 'fill' || p === 'stroke') && v === cs.color ? 'currentColor' : colorize(v.replace(/(\d)px$/, '$1')));
        });
      }
      out.removeAttribute('class');
      out.removeAttribute('style');
      [...out.attributes].forEach(a => { if (/^(data-|on)/i.test(a.name)) out.removeAttribute(a.name); });
    });
    clone.querySelectorAll('script, style, foreignObject').forEach(n => n.remove());
    clone.querySelectorAll('use').forEach(use => {
      const ref = use.getAttribute('href') || use.getAttribute('xlink:href') || '';
      if (!ref.startsWith('#')) {
        if (ref) use.setAttribute('href', absUrl(ref, doc.baseURI));
        return;
      }
      const target = doc.getElementById(ref.slice(1));
      if (!target) return;
      const g = doc.createElementNS('http://www.w3.org/2000/svg', 'g');
      [...target.childNodes].forEach(n => g.appendChild(n.cloneNode(true)));
      ['transform', 'fill', 'stroke'].forEach(a => { if (use.getAttribute(a)) g.setAttribute(a, use.getAttribute(a)); });
      if (target.getAttribute('viewBox') && !clone.getAttribute('viewBox')) clone.setAttribute('viewBox', target.getAttribute('viewBox'));
      use.replaceWith(g);
    });
    clone.querySelectorAll('image').forEach(img => {
      const h = img.getAttribute('href') || img.getAttribute('xlink:href');
      if (h && !/^data:/.test(h)) img.setAttribute('href', absUrl(h, doc.baseURI));
    });
    if (!clone.getAttribute('xmlns')) clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    return new XMLSerializer().serializeToString(clone);
  }

  // ── shadow trees ───────────────────────────────────────────────
  // A web component draws its shadow root, and what the page put inside it appears only where a
  // <slot> takes it. This follows what is drawn (the "flat tree"), not what is written.
  const inShadow = el => { const r = el.getRootNode && el.getRootNode(); return !!(r && r.host); };
  function flatChildNodes(el) {
    if (el.shadowRoot) return [...el.shadowRoot.childNodes];
    if (el.localName === 'slot' && el.assignedNodes) {
      const assigned = el.assignedNodes({ flatten: true });
      if (assigned.length) return assigned;
    }
    return [...el.childNodes];
  }
  const flatParent = el => el.assignedSlot || el.parentElement || (el.parentNode && el.parentNode.host) || null;

  // Where an element sits in layout, untransformed — so a marquee mid-scroll or a card mid-hover
  // measures the same in the copy as in the original.
  function layoutOffset(el) {
    const tree = el.getRootNode && el.getRootNode();
    if (tree && tree.host) {
      // inside a shadow tree the offset chain stops at the boundary: measure from the host
      const hb = layoutOffset(tree.host);
      const hr = tree.host.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      return { x: hb.x + (r.left - hr.left), y: hb.y + (r.top - hr.top), w: r.width, h: r.height };
    }
    if (typeof el.offsetLeft !== 'number') {
      const parent = el.parentElement;
      const r = el.getBoundingClientRect();
      if (!parent) return { x: r.left, y: r.top, w: r.width, h: r.height };
      const pb = layoutOffset(parent);
      const pr = parent.getBoundingClientRect();
      return { x: pb.x + (r.left - pr.left), y: pb.y + (r.top - pr.top), w: r.width, h: r.height };
    }
    let x = 0, y = 0, n = el;
    const w = el.offsetWidth, h = el.offsetHeight;
    while (n) {
      x += n.offsetLeft;
      y += n.offsetTop;
      const p = n.offsetParent;
      if (p) { x += p.clientLeft; y += p.clientTop; }
      n = p;
    }
    return { x, y, w, h };
  }

  const MEASURE_PROPS = ['color', 'background-color', 'font-size', 'font-weight', 'font-family', 'line-height', 'border-top-left-radius', 'opacity', 'display'];
  const firstFamily = stack => (splitTop(stack || '', ',')[0] || '').replace(/^["']|["']$/g, '').trim();

  function snapshot(root) {
    const doc = root.ownerDocument;
    const win = doc.defaultView || window;
    REM = num(win.getComputedStyle(doc.documentElement).fontSize) || 16;
    const idx = indexStylesheets(doc);
    const baseline = makeBaseline(doc);
    const W = win.innerWidth;
    const notes = new Set();
    if (idx.unreadable) notes.add(`${idx.unreadable} stylesheet${idx.unreadable === 1 ? '' : 's'} on this page can't be read from here, so some values are the browser's computed ones.`);

    // number the nodes first, so state rules can be traced to the element that triggers them
    const order = [];
    const collect = el => {
      if (order.length >= MAX_NODES) return;
      if (el !== root) {
        if (SKIP_TAGS.has(el.tagName)) return;
        if (/^sr-/.test(el.id || '') || [...(el.classList || [])].some(OWN_CLASS)) return;
      }
      order.push(el);
      if (el.localName === 'svg') return;
      for (const kid of flatChildNodes(el)) if (kid.nodeType === 1) collect(kid);
    };
    collect(root);
    const tooBig = order.length >= MAX_NODES;
    if (tooBig) notes.add(`This section is very large, so the export holds its first ${MAX_NODES} elements.`);
    const elToIndex = new Map();
    order.forEach((el, i) => { elToIndex.set(el, i); el.setAttribute('data-dtx', String(i)); });

    // ids something in the section points at keep their id
    const keepIds = new Set();
    order.forEach(el => {
      ID_REFS.forEach(a => (el.getAttribute(a) || '').split(/\s+/).forEach(id => id && keepIds.add(id)));
      const href = el.getAttribute('href');
      if (href && href.startsWith('#') && href.length > 1) keepIds.add(href.slice(1));
    });

    try {
      const rootBox = layoutOffset(root);
      const rootCs = win.getComputedStyle(root);
      const matchCache = new Map();
      const matchesFor = el => {
        if (!matchCache.has(el)) matchCache.set(el, matchedRules(el, idx).base);
        return matchCache.get(el);
      };
      const varCache = new Map();
      // A custom property's value at a viewport width: declared on the element or the nearest
      // ancestor whose rules say so at that width, the way the cascade would inherit it.
      const varAt = (el, name, width) => {
        let m = varCache.get(el);
        if (!m) { m = new Map(); varCache.set(el, m); }
        const key = `${name}|${width}`;
        if (m.has(key)) return m.get(key);
        m.set(key, '');
        // the rule that sets it here or on an ancestor, at that width; `initial` sets nothing
        const authoredAt = w => {
          for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
            const raw = authoredRaw(n, matchesFor(n), name, w, false, null, true);
            if (raw === undefined || /^\s*(inherit|unset|revert|revert-layer)\s*$/i.test(raw)) continue;
            return { n, raw: /^\s*initial\s*$/i.test(raw) ? '' : raw };
          }
          return null;
        };
        const hit = authoredAt(width);
        let out = hit ? resolveVars(hit.raw, nm => varAt(hit.n, nm, width)) : '';
        // Nothing the stylesheets say sets it: what the page shows now is the browser's (a
        // registered initial value, a script). Unless a rule for the current screen is what set
        // it now, and this narrower or wider screen simply has none.
        if (!hit && !(width !== W && authoredAt(W))) out = win.getComputedStyle(el).getPropertyValue(name).trim();
        m.set(key, out);
        return out;
      };
      // the breakpoints at which custom properties an element can inherit are redeclared
      const vbCache = new Map();
      const varBounds = el => {
        if (!el || el.nodeType !== 1) return [];
        if (vbCache.has(el)) return vbCache.get(el);
        const own = new Set(varBounds(el.parentElement));
        matchesFor(el).forEach(({ rule }) => {
          if (!rule.media.some(md => md.widthDependent)) return;
          for (const p of rule.props) if (p.startsWith('--')) { rule.media.forEach(md => md.bounds.forEach(b => own.add(b))); break; }
        });
        const out = [...own];
        vbCache.set(el, out);
        return out;
      };
      const ctx = { idx, baseline, W, win, doc, root, elToIndex, notes, keepIds, matchesFor, varAt, varBounds, rootBox, hiddenByScript: 0, outerContainers: new Set(), lineHeights: new Map(), rootInner: root.clientWidth - (num(rootCs.paddingLeft) || 0) - (num(rootCs.paddingRight) || 0) };
      const nodes = order.map((el, i) => readNode(el, i, ctx));
      const rootMargins = { l: num(rootCs.marginLeft) || 0, r: num(rootCs.marginRight) || 0, t: num(rootCs.marginTop) || 0, b: num(rootCs.marginBottom) || 0 };

      // what sits behind the section on the page: the preview's ground, and the export's own
      // when the section is transparent over something that isn't white
      let backdrop = '#ffffff', backdropImage = '';
      for (let n = root.parentElement; n; n = n.parentElement) {
        const ncs = win.getComputedStyle(n);
        if (!backdropImage && ncs.backgroundImage && ncs.backgroundImage !== 'none' && !/url\(/.test(ncs.backgroundImage)) backdropImage = ncs.backgroundImage;
        const bg = ncs.backgroundColor;
        if (bg && !/^(transparent|rgba\(0, 0, 0, 0\))$/.test(bg)) { backdrop = hexColor(bg); break; }
      }
      if (!/^#[0-9a-f]{6}$/i.test(backdrop)) backdrop = '#ffffff';
      const rootBg = nodes[0].base['background-color'];
      if ((!rootBg || rootBg === 'transparent') && !nodes[0].base['background-image'] && backdrop.toLowerCase() !== '#ffffff') {
        nodes[0].base['background-color'] = backdrop;
        nodes[0].measure.cs['background-color'] = backdrop;
        if (backdropImage) nodes[0].base['background-image'] = colorize(backdropImage);
      }

      // A section placed with position:absolute was placed against something outside it; on its
      // own, the copy sits in the flow instead.
      const unpin = props => {
        if (props.position === 'absolute') props.position = 'relative';
        ['top', 'right', 'bottom', 'left'].forEach(p => delete props[p]);
      };
      if (rootCs.position === 'absolute') {
        unpin(nodes[0].base);
        (nodes[0].ladder || []).forEach(step => unpin(step.props));
      }
      // Container queries that answered to a box outside the section answer to the section itself
      // in the copy (not to an inline root: size containment would collapse its width).
      if (ctx.outerContainers.size && !/^inline/.test(rootCs.display)) {
        nodes[0].base['container-type'] = 'inline-size';
        const names = [...ctx.outerContainers].filter(Boolean);
        if (names.length) nodes[0].base['container-name'] = [...new Set([...(nodes[0].base['container-name'] || '').split(/\s+/).filter(n => n && n !== 'none'), ...names])].join(' ');
      }
      if (ctx.hiddenByScript) notes.add(`${ctx.hiddenByScript} element${ctx.hiddenByScript === 1 ? ' is' : 's are'} hidden by the page's script, probably waiting to animate in. Scroll through the section once before exporting to include ${ctx.hiddenByScript === 1 ? 'it' : 'them'}.`);

      const parent = root.parentElement;
      let parentWidth = W;
      if (parent && parent !== doc.documentElement) {
        const pcs = win.getComputedStyle(parent);
        parentWidth = /flex|grid/.test(pcs.display)
          // an item of a grid or flex row had its own track to fill, not the parent's whole width
          ? rootBox.w + (num(rootCs.marginLeft) || 0) + (num(rootCs.marginRight) || 0)
          : parent.clientWidth - (num(pcs.paddingLeft) || 0) - (num(pcs.paddingRight) || 0);
      }

      // keyframes the section runs, written out with their custom properties filled in
      const keyframes = new Map();
      nodes.forEach(n => (n.keyframeTexts || []).forEach(([name, css]) => { if (!keyframes.has(name)) keyframes.set(name, css); }));

      const fonts = planFonts(idx, nodes, doc.location ? doc.location.origin : '', doc);
      fonts.notes.forEach(n => notes.add(n));

      return {
        source: doc.location ? doc.location.href : '',
        width: rootBox.w, height: rootBox.h, viewport: W, viewportHeight: win.innerHeight, parentWidth: Math.max(1, Math.round(parentWidth)),
        rootMargins, backdrop, colorScheme: win.getComputedStyle(doc.documentElement).colorScheme || 'normal',
        rootPositioned: /^(absolute|fixed)$/.test(rootCs.position),
        nodes, keyframes, fonts, notes: [...notes], tooBig,
        breakpoints: [...new Set(nodes.flatMap(n => [...(n.ladder || []), ...Object.values(n.pseudoLadder || {}).flat()].map(s => s.min)))].sort((a, b) => a - b)
      };
    } finally {
      order.forEach(el => el.removeAttribute('data-dtx'));
      baseline.destroy();
    }
  }

  // An authored value is used only if it describes what the page draws now: a fixed length that
  // disagrees with the computed one came from a rule this reading can't see the whole of.
  function agrees(a, computed, prop, cs) {
    if (isPx(a) && isPx(computed)) return Math.abs(num(a) - num(computed)) <= 0.5;
    if (prop === 'line-height' && /^\d*\.?\d+$/.test(a) && isPx(computed)) return Math.abs(num(a) * num(cs.fontSize) - num(computed)) <= 0.5;
    return true;
  }

  function readNode(el, i, ctx) {
    const { idx, baseline, W, win, doc, root, elToIndex, notes, keepIds, matchesFor, varAt, rootBox } = ctx;
    const tag = el.localName;
    const isSvg = tag === 'svg';
    const cs = win.getComputedStyle(el);
    const rtl = cs.direction === 'rtl';
    const isRoot = el === root;
    const parent = isRoot ? null : flatParent(el);
    const shadowNode = inShadow(el);
    const pcs = parent ? win.getComputedStyle(parent) : null;
    // A flex or grid item's minimum size defaults to auto (its content), where a plain block reads
    // 0px: min-w-0 / min-h-0 on an item is a real change and has to be written down.
    const isItem = !isRoot && /flex|grid/.test(pcs ? pcs.display : '');
    const dflt = isItem ? { ...baseline.read(tag), 'min-width': 'auto', 'min-height': 'auto' } : baseline.read(tag);
    const ddiv = baseline.read('div');
    const matched = matchesFor(el);
    const { states: stateMatches } = matchedRules(el, idx);
    const getNow = name => cs.getPropertyValue(name).trim();
    const getAt = width => name => varAt(el, name, width);
    const node = {
      i, tag, parent: parent ? elToIndex.get(parent) : null, kids: [], attrs: {}, base: {}, ladder: null, pseudo: {}, states: [],
      classes: [...(el.classList || [])].filter(c => !OWN_CLASS(c)), display: cs.display, pre: /^(pre|pre-wrap|break-spaces)$/.test(cs.whiteSpace)
    };

    // attributes worth keeping
    for (const a of el.attributes) {
      const name = a.name.toLowerCase();
      if (KEEP_ATTRS.has(name) || name.startsWith('aria-')) node.attrs[name] = a.value;
    }
    if (el.id && keepIds.has(el.id)) node.attrs.id = el.id;
    if (node.attrs.href !== undefined) {
      const h = el.getAttribute('href') || '';
      node.attrs.href = /^javascript:/i.test(h) ? '#' : /^(#|mailto:|tel:)/i.test(h) ? h : absUrl(h, doc.baseURI);
    }
    if (tag === 'img') {
      let src = el.currentSrc || el.src || '';
      if (!src || /^data:image\/(gif|svg)/.test(src)) {
        const lazy = el.getAttribute('data-src') || el.getAttribute('data-lazy-src') || el.getAttribute('data-original');
        if (lazy) src = absUrl(lazy, doc.baseURI);
      }
      node.attrs.src = src;
      node.attrs.alt = el.getAttribute('alt') || '';
      // A srcset picks one file and tells the browser its density, which sets the image's natural
      // size — and flex and grid sizing follow that. Only the candidate the page chose is kept.
      const pictureSources = el.parentElement && el.parentElement.localName === 'picture' ? [...el.parentElement.querySelectorAll('source')] : [];
      const sources = [el, ...pictureSources];
      for (const s of sources) {
        const set = s.getAttribute('srcset');
        if (!set || !el.currentSrc) continue;
        const re = /\s*(\S+?)(?:\s+(\d*\.?\d+[wx]))?\s*(?:,|$)/g;
        let m, desc = null;
        while ((m = re.exec(set)) && m[0]) { if (absUrl(m[1], doc.baseURI) === el.currentSrc) { desc = m[2] || '1x'; break; } }
        if (!desc) continue;
        if (s !== el) {
          // The picture's <source> elements come along whole, so each screen still gets its own
          // image; the img keeps its own file as the fallback.
          const own = el.getAttribute('src');
          if (own && !/^data:/.test(own)) node.attrs.src = absUrl(own, doc.baseURI);
          break;
        }
        if (desc !== '1x') {
          node.attrs.srcset = `${el.currentSrc} ${desc}`;
          if (/w$/.test(desc) && s.getAttribute('sizes')) node.attrs.sizes = s.getAttribute('sizes');
        }
        break;
      }
      // (not inside a <picture> with sources: each screen's file has its own size)
      if (!el.getAttribute('width') && el.naturalWidth && !pictureSources.length) { node.attrs.width = String(el.naturalWidth); node.attrs.height = String(el.naturalHeight); }
    }
    if (tag === 'picture') {
      // art direction: a different file per screen, chosen by media queries on <source>
      node.sources = [...el.children].filter(c => c.localName === 'source' && c.getAttribute('srcset')).map(s => {
        const out = {};
        ['media', 'type', 'sizes', 'width', 'height'].forEach(a => { if (s.getAttribute(a)) out[a] = s.getAttribute(a); });
        out.srcset = absSrcset(s.getAttribute('srcset'), doc.baseURI);
        return out;
      });
    }
    if (tag === 'video') {
      const src = el.currentSrc || el.src;
      if (src && !src.startsWith('blob:')) node.attrs.src = src;
      if (el.poster) node.attrs.poster = el.poster;
      else if (canvasShots.has(el)) {
        // a video that streams from the page has no file to link: a still of what it shows stands in
        node.attrs.poster = canvasShots.get(el);
        notes.add('A video in this section streams from the page, so it comes across as a still picture.');
      }
      if (el.autoplay) { node.attrs.autoplay = ''; node.attrs.muted = ''; node.attrs.playsinline = ''; }
      if (el.loop) node.attrs.loop = '';
    }
    if ((tag === 'iframe' || tag === 'audio') && el.src) node.attrs.src = el.src;
    if (tag === 'input' && el.type !== 'password' && el.value) node.attrs.value = el.value;
    if (tag === 'canvas') {
      // what the page shows of it: a picture taken in prepare() when the canvas can't be read
      // (it draws pictures from other sites), else the canvas's own pixels
      let src = canvasShots.get(el) || null;
      if (!src) {
        try { if (el.width * el.height <= 1500000) src = el.toDataURL('image/png'); } catch (_) {}
      }
      if (src) {
        node.tag = 'img';
        node.attrs = { src, alt: '', width: String(el.width), height: String(el.height) };
        if (canvasShots.has(el)) notes.add("A canvas in this section draws pictures from other sites, so it can't be read. It comes across as a picture of what the page shows.");
      } else {
        notes.add('A canvas in this section is drawn by script and comes across as an empty box.');
      }
    }
    if (isSvg) node.svg = serializeSvg(el, doc);

    // children: elements by index, text as text
    if (!isSvg && node.tag !== 'img') {
      const flexish = /flex|grid/.test(cs.display);
      for (const child of flatChildNodes(el)) {
        if (child.nodeType === 1) {
          if (elToIndex.has(child)) node.kids.push(elToIndex.get(child));
        } else if (child.nodeType === 3) {
          let t = child.nodeValue;
          if (!node.pre) t = t.replace(/[ \t\n\r\f]+/g, ' ');
          if (!t || (flexish && !t.replace(/[ \t\n\r\f]/g, ''))) continue;
          node.kids.push({ text: t });
        }
      }
    }
    if (el.shadowRoot) notes.add("Part of this section lives inside a web component. Its own styles can't be read, so that part is copied as it looks now and does not change with the screen.");

    // measured, for the score
    // faded out by an inline style a script set, as reveal-on-scroll libraries do before they run
    if (el.style && el.style.opacity !== '' && num(el.style.opacity) === 0 && num(cs.opacity) === 0) ctx.hiddenByScript++;
    const box = layoutOffset(el);
    // an image the page hasn't loaded yet (lazy, off screen) is drawn at a size it won't keep,
    // so it isn't held against the copy
    const unloaded = tag === 'img' && !(el.complete && el.naturalWidth);
    node.measure = { x: box.x - rootBox.x, y: box.y - rootBox.y, w: box.w, h: box.h, shown: (box.w > 0 || box.h > 0) && cs.visibility !== 'hidden' && cs.display !== 'none' && !unloaded, cs: {} };
    // The size to the fraction, for pins: offsetWidth rounds, and columns pinned 0.2px wider than
    // they are add up past their row and push the last one onto a line of its own.
    const exact = (prop, a, b, rounded) => {
      const v = cs.getPropertyValue(prop);
      if (!/px$/.test(v)) return rounded;
      const e = num(v) + (cs.boxSizing === 'border-box' ? 0 : num(cs.getPropertyValue(`padding-${a}`)) + num(cs.getPropertyValue(`padding-${b}`)) + num(cs.getPropertyValue(`border-${a}-width`)) + num(cs.getPropertyValue(`border-${b}-width`)));
      return Math.abs(e - rounded) < 1 ? e : rounded;
    };
    node.measure.ew = exact('width', 'left', 'right', box.w);
    node.measure.eh = exact('height', 'top', 'bottom', box.h);
    MEASURE_PROPS.forEach(p => (node.measure.cs[p] = cs.getPropertyValue(p).trim()));
    node.fontStack = splitTop(cs.fontFamily, ',').map(f => f.replace(/^["']|["']$/g, '').trim());
    node.weight = cs.fontWeight;
    node.fontStyle = cs.fontStyle;

    // properties a running animation or transition is moving right now: use where they rest
    const moving = new Map();
    let running = [];
    try { running = el.getAnimations ? el.getAnimations() : []; } catch (_) {}
    node.animationNames = cs.animationName && cs.animationName !== 'none' ? splitTop(cs.animationName, ',').filter(n => n && n !== 'none') : [];
    node.keyframeTexts = [];
    node.animationNames.forEach(name => {
      const k = idx.keyframes.get(name);
      if (!k) return;
      [...k.rule.cssRules].forEach(fr => [...fr.style].forEach(p => moving.set(physical(p, rtl), 'animation')));
      node.keyframeTexts.push([name, absUrls(resolveVars(k.rule.cssText, getNow), k.base)]);
    });
    running.forEach((a, n) => {
      const kind = a.constructor && a.constructor.name;
      if (kind === 'CSSTransition') {
        try {
          const frames = a.effect.getKeyframes();
          const last = frames[frames.length - 1];
          const prop = a.transitionProperty;
          if (last && last[camel(prop)] != null) moving.set(prop, String(last[camel(prop)]));
        } catch (_) {}
      } else if (kind === 'Animation' && a.effect && a.effect.getKeyframes && a.effect.target === el && !a.effect.pseudoElement) {
        try {
          const frames = a.effect.getKeyframes();
          const t = a.effect.getTiming();
          if (!frames.length || !isFinite(t.duration) || !t.duration) return;
          const name = `dt-motion-${i}-${n}`;
          const body = frames.map(f => {
            const decl = Object.entries(f).filter(([k]) => !['offset', 'computedOffset', 'easing', 'composite'].includes(k)).map(([k, v]) => `${kebab(k === 'cssFloat' ? 'float' : k)}: ${v}`);
            if (f.easing && f.easing !== 'linear') decl.push(`animation-timing-function: ${f.easing}`);
            return `${fmtNum((f.computedOffset ?? f.offset ?? 0) * 100)}% { ${decl.join('; ')} }`;
          }).join(' ');
          node.keyframeTexts.push([name, `@keyframes ${name} { ${body} }`]);
          node.base['animation-name'] = name;
          node.base['animation-duration'] = `${fmtNum(t.duration)}ms`;
          node.base['animation-timing-function'] = t.easing || 'linear';
          if (t.delay) node.base['animation-delay'] = `${fmtNum(t.delay)}ms`;
          node.base['animation-iteration-count'] = t.iterations === Infinity ? 'infinite' : String(t.iterations);
          if (t.direction && t.direction !== 'normal') node.base['animation-direction'] = t.direction;
          if (t.fill && t.fill !== 'auto' && t.fill !== 'none') node.base['animation-fill-mode'] = t.fill;
          frames.forEach(f => Object.keys(f).forEach(k => moving.set(kebab(k), 'animation')));
          notes.add('An animation here is driven by script; it has been written out as CSS keyframes.');
        } catch (_) {}
      }
    });

    // hover or focus in force right now would otherwise be read as the resting look
    const hot = new Set();
    stateMatches.forEach(({ rule, part }) => {
      let live = false;
      try { live = el.matches(part.raw); } catch (_) {}
      if (live) rule.props.forEach(p => hot.add(physical(p, rtl)));
    });

    // A var() that comes to nothing (`--x: initial`) leaves the property at its default, as if no
    // rule had set it.
    const authoredNow = prop => {
      const raw = authoredRaw(el, matched, prop, W, rtl, getNow);
      const v = raw === undefined ? '' : finish(resolveVars(raw, getNow)).trim();
      return v || undefined;
    };
    const inFlexOrGrid = /flex|grid/.test(pcs ? pcs.display : '');

    // Rules that apply only inside a size container become @container blocks of their own; the
    // base value then comes from the ordinary rules, whatever the container makes of it today.
    const containerSteps = new Map();
    matched
      .filter(m => m.rule.container && m.rule.media.every(md => md.test(W)))
      .sort((a, b) => (beats({ imp: false, layer: a.rule.layer, spec: a.spec, order: a.rule.order }, { imp: false, layer: b.rule.layer, spec: b.spec, order: b.rule.order }) ? 1 : -1))
      .forEach(({ rule }) => {
        const step = containerSteps.get(rule.container) || {};
        propsOfRule(rule, rtl).forEach(prop => {
          if (TEXTLESS.has(node.tag) && TEXT_PROPS.has(prop)) return;
          const d = declared(rule.style, rule.props, prop, rtl, getNow);
          if (!d || !d.value || /^(inherit|initial|unset|revert|revert-layer)$/.test(d.value.trim())) return;
          const v = finish(resolveVars(absUrls(d.value, rule.base), getNow)).trim();
          if (v) step[prop] = polish(prop, v);
        });
        if (Object.keys(step).length) containerSteps.set(rule.container, step);
      });
    const containerProps = new Set([...containerSteps.values()].flatMap(step => Object.keys(step)));
    // The box those rules measure is the nearest ancestor that is a container (of that name, if
    // the rule names one). When it sits outside the section, the copy has nothing to measure: the
    // section becomes the container, and the widths in the condition move by the difference
    // between the two boxes, so each rule still switches at the same screen width.
    // The section's own rules have no container above them in the copy, so they become screen
    // widths instead.
    const conds = new Map();
    containerSteps.forEach((_, cond) => {
      const name = (/^\s*([a-z_-][\w-]*)\s+[(a-z]/i.exec(cond) || [])[1];
      const named = name && !/^(not|style|scroll-state)$/i.test(name) ? name : null;
      conds.set(cond, { cond });
      for (let a = el.parentElement; a; a = a.parentElement) {
        const acs = win.getComputedStyle(a);
        if (acs.containerType === 'normal' || (named && !(acs.containerName || '').split(/\s+/).includes(named))) continue;
        if (!elToIndex.has(a)) {
          const inner = a.clientWidth - (num(acs.paddingLeft) || 0) - (num(acs.paddingRight) || 0);
          const em = num(acs.fontSize) || 16;
          if (!isRoot) {
            ctx.outerContainers.add(named || '');
            conds.set(cond, { cond: shiftCond(cond, inner - ctx.rootInner, em, REM) });
          } else if (!/\b(style|scroll-state)\(/i.test(cond)) {
            conds.set(cond, { cond: shiftCond(named ? cond.replace(/^\s*[a-z_-][\w-]*\s+/i, '') : cond, inner - W, em, REM), media: true });
          }
        }
        break;
      }
    });
    if (containerSteps.size) node.container = [...containerSteps].map(([cond, props]) => ({ ...conds.get(cond), props }));

    // The line-height passed down as written. A bare number (1.5) scales with each child's font
    // size; the px the browser reports would hold one height for all of them, at every screen.
    const ownLh = containerProps.has('line-height') ? undefined : authoredNow('line-height');
    const inheritedLh = () => {
      if (!isRoot) return ctx.lineHeights.get(parent) || 'normal';
      for (let a = root.parentElement; a; a = a.parentElement) {
        const acs = win.getComputedStyle(a);
        const raw = authoredRaw(a, matchesFor(a), 'line-height', W, win.getComputedStyle(a).direction === 'rtl', n => acs.getPropertyValue(n).trim());
        const v = raw === undefined ? '' : finish(resolveVars(raw, n => acs.getPropertyValue(n).trim())).trim();
        if (v && !/^(inherit|unset|revert)/.test(v)) return v;
      }
      return 'normal';
    };
    const passedLh = inheritedLh();
    ctx.lineHeights.set(el, ownLh !== undefined ? ownLh : passedLh);
    const factor = /^\d*\.?\d+$/.test(passedLh) ? num(passedLh) : null;
    node.lhFactor = /^\d*\.?\d+$/.test(ctx.lineHeights.get(el)) ? num(ctx.lineHeights.get(el)) : null;

    PROPS.forEach(prop => {
      if (node.base[prop] !== undefined) return;
      if (prop === 'line-height' && ownLh === undefined && factor !== null && !hot.has(prop)) {
        // the root writes the number itself; below it, a height that is that number times the
        // font size comes from the parent on its own
        if (isRoot) { node.base['line-height'] = String(factor); return; }
        if (Math.abs(num(cs.lineHeight) - factor * num(cs.fontSize)) < 0.6) return;
      }
      if (TEXTLESS.has(node.tag) && TEXT_PROPS.has(prop)) return;
      if (isSvg && /^(fill|stroke|stroke-width)$/.test(prop) && el.getAttribute(prop)) return;
      if (!inFlexOrGrid && FLEX_ITEM.test(prop)) return;
      if (prop === 'vertical-align' && !/^(inline|table-cell)/.test(cs.display)) return;
      const isHot = hot.has(prop);
      const mv = moving.get(prop);
      let v = cs.getPropertyValue(prop).trim();

      if (CURRENT_COLOR.has(prop)) {
        // these default to the text colour, so only a colour of their own is worth writing down
        if (/^border-/.test(prop)) {
          if (!num(cs.getPropertyValue(prop.replace('color', 'width')))) return;
          if (!isHot) { node.base[prop] = finish(v); return; }
        } else if (prop === 'outline-color' && cs.outlineStyle === 'none') return;
        else if (prop === 'text-decoration-color' && cs.textDecorationLine === 'none') return;
        else if (v === cs.color) return;
      }
      if (/^border-.*-style$/.test(prop) && !num(cs.getPropertyValue(prop.replace('style', 'width')))) return;

      // A box taken out of the flow reports its display blockified: an inline span reads `block`.
      // Copied that way, it would start below the line it sits on (sr-only text, badges).
      if (prop === 'display' && (/^(absolute|fixed)$/.test(cs.position) || cs.cssFloat !== 'none') && !isHot && !containerProps.has(prop)) {
        const a = authoredNow('display');
        if (a !== undefined) v = a;
        else if (v === blockified(dflt.display)) return;
      }

      if (INHERITED.has(prop) && !CURRENT_COLOR.has(prop)) {
        // what the copy would get without saying anything: the reset's value for this tag where it
        // sets one, the parent's otherwise
        const tagSets = dflt[prop] !== ddiv[prop];
        const expected = tagSets ? dflt[prop] : isRoot ? ddiv[prop] : pcs.getPropertyValue(prop).trim();
        if (!(isRoot && ROOT_TYPE.includes(prop)) && v === expected && !isHot && !containerProps.has(prop)) return;
      } else if (!AUTHORED_FIRST.has(prop) && !CURRENT_COLOR.has(prop) && v === dflt[prop] && !isHot && !mv && !containerProps.has(prop)) {
        return;
      }

      const inContainer = containerProps.has(prop);
      if (AUTHORED_FIRST.has(prop) || isHot || mv || inContainer) {
        const a = authoredNow(prop);
        // a flex or grid item is drawn grown or shrunk from the size it asks for, so the drawn
        // size disagreeing is expected there; copied as drawn, it would stop responding
        const flexed = inFlexOrGrid && /^(width|height|flex-basis)$/.test(prop);
        if (a !== undefined && (isHot || mv || inContainer || flexed || agrees(a, v, prop, cs))) v = a;
        else if (a === undefined && inContainer) return; // the default or the parent's, as the copy gets on its own
        else if (a !== undefined) { /* a rule this reading can't fully see wins: keep what's drawn */ }
        else if (ONLY_AUTHORED.has(prop) || mv === 'animation') return;
        // a grid with no columns of its own reports the implicit ones it drew, in px; with every
        // stylesheet readable that means there were none to copy
        else if (prop === 'grid-template-columns' && (!(idx.unreadable || shadowNode) || splitTop(v, ' ').length < 2)) return;
        else if (isHot) {
          // at rest this comes from the parent or the default, which the copy gets on its own
          if (INHERITED.has(prop) && !(isRoot && ROOT_TYPE.includes(prop))) return;
          v = dflt[prop];
        } else if (mv) v = mv;
        if (a === undefined && !isHot && !(isRoot && ROOT_TYPE.includes(prop))) {
          if (v === dflt[prop]) return;
          // initial values the browser reports resolved: min-size auto, insets of a box that isn't taken out of flow
          if (/^(min-width|min-height)$/.test(prop) && v === 'auto') return;
          if (prop === 'aspect-ratio' && /^auto\b/.test(v)) return; // from width/height attributes, which the copy keeps
          if (/^(top|right|bottom|left)$/.test(prop)) {
            if (!/^(absolute|fixed)$/.test(cs.position)) return;
            // a box pinned by its opposite side reports this one resolved; and with every
            // stylesheet readable, no rule means auto
            const opposite = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' }[prop];
            if (authoredNow(opposite) !== undefined || !(idx.unreadable || shadowNode)) return;
          }
        }
      }
      if ((prop === 'fill' || prop === 'stroke') && v === cs.color) v = 'currentColor';
      if (prop === 'grid-template-columns') v = gridCols(v);
      v = polish(prop, finish(v));
      if (!INHERITED.has(prop) && !CURRENT_COLOR.has(prop) && v === finish(dflt[prop] || '')) return;
      node.base[prop] = v;
    });
    // A line clamp needs display:-webkit-box, but newer Chrome reports that box as flow-root;
    // copied as reported, the clamp would stop working.
    if (/^\d+$/.test(node.base['-webkit-line-clamp'] || '')) {
      node.base.display = /^inline/.test(cs.display) ? '-webkit-inline-box' : '-webkit-box';
      node.base['-webkit-box-orient'] = 'vertical';
      if (!node.base['overflow-x'] && !node.base['overflow-y']) node.base['overflow-y'] = 'hidden';
    }
    // The reset gives images height:auto, as Tailwind's preflight does. A page without that rule
    // sizes them by their height attribute instead, so the copy says so.
    // (not a canvas: its width and height attributes are the size of its drawing buffer, and
    // the page sizes the box with CSS)
    if (/^(img|video|canvas|iframe)$/.test(node.tag) && tag !== 'canvas' && node.base.height === undefined && /^\d+(\.\d+)?$/.test(el.getAttribute('height') || '') && authoredNow('height') === undefined) {
      node.base.height = `${el.getAttribute('height')}px`;
    }
    if (isRoot) {
      // the root's type is written out, but not its defaults
      const quiet = { 'font-style': 'normal', '-webkit-font-smoothing': 'auto', 'letter-spacing': 'normal', 'font-weight': '400' };
      Object.entries(quiet).forEach(([p, v]) => { if (node.base[p] === v) delete node.base[p]; });
    }
    ['top', 'right', 'bottom', 'left'].forEach(s => {
      if (num(cs.getPropertyValue(`border-${s}-width`)) > 0 && !node.base[`border-${s}-style`]) node.base[`border-${s}-style`] = cs.getPropertyValue(`border-${s}-style`);
    });

    // width-dependent rules: a ladder from the narrowest screen up. A value written with var()
    // changes wherever the custom property does, so those breakpoints count too.
    const widthRules = matched.filter(m => m.rule.media.some(md => md.widthDependent));
    const propsOf = (rules, into) => rules.forEach(m => m.rule.props.forEach(p => {
      const phys = physical(p, rtl);
      if (PROP_SET.has(phys)) into.add(phys);
      if (SHORTHAND_NAMES.has(p)) Object.entries(SHORTHANDS_OF).forEach(([lh, srcs]) => { if (srcs.some(s => s.sh === p)) into.add(lh); });
    }));
    const props = new Set();
    const boundSet = new Set(widthRules.flatMap(m => m.rule.media.flatMap(md => md.bounds)));
    propsOf(widthRules, props);
    const vb = ctx.varBounds(el);
    if (vb.length) {
      const all = new Set();
      propsOf(matched, all);
      let viaVar = false;
      all.forEach(p => {
        // read without substituting, so a shorthand written with var() still shows it
        const raw = authoredRaw(el, matched, p, W, rtl, null);
        if (raw && raw.includes('var(')) { props.add(p); viaVar = true; }
      });
      if (viaVar) vb.forEach(b => boundSet.add(b));
    }
    if (props.size && boundSet.size) {
      // a bound past any real screen (Elementor's max-width: 99999px) changes nothing anyone sees
      const bounds = [...boundSet].filter(b => b > 1 && b < 10000).sort((a, b) => a - b);
      const usable = [...props].filter(p => !(TEXTLESS.has(node.tag) && TEXT_PROPS.has(p)) && (inFlexOrGrid || !FLEX_ITEM.test(p)));
      const at = s => Object.fromEntries(usable.map(p => {
        const raw = authoredRaw(el, matched, p, s, rtl, getAt(s));
        const v = raw === undefined ? '' : finish(resolveVars(raw, getAt(s))).trim();
        return [p, v ? polish(p, v) : undefined];
      }));
      const first = at(1);
      let prev = first;
      const ladder = [];
      bounds.forEach(s => {
        const cur = at(s);
        const diff = {};
        usable.forEach(p => {
          if (cur[p] === prev[p]) return;
          diff[p] = cur[p] === undefined ? finish(INHERITED.has(p) ? (pcs ? pcs.getPropertyValue(p) : ddiv[p]) : UNSET_TO[p] || dflt[p] || 'initial') : cur[p];
        });
        if (Object.keys(diff).length) ladder.push({ min: s, props: diff });
        prev = cur;
      });
      if (ladder.length) {
        // the base becomes what the narrowest screen gets
        usable.forEach(p => {
          if (!ladder.some(step => step.props[p] !== undefined)) return;
          if (first[p] !== undefined) node.base[p] = first[p];
          else if (INHERITED.has(p) || AUTHORED_FIRST.has(p) || dflt[p] === undefined) delete node.base[p];
          else node.base[p] = finish(dflt[p]);
        });
        node.ladder = ladder;
      }
    }

    // ch counts the "0" of whatever font is loaded when the rule is first read; a web font that
    // arrives later can leave it measured on the fallback (Arial's 0 is 12% narrower). In em it
    // is the same length, scales with the text the same way, and doesn't wait on the font.
    const hasCh = v => /(^|[\s(,])-?\d*\.?\d+ch\b/.test(v || '');
    const blocks = [node.base, ...(node.ladder || []).map(s => s.props), ...(node.container || []).map(s => s.props)];
    if (blocks.some(b => Object.values(b).some(hasCh)) && num(cs.fontSize) && el.appendChild) {
      const zero = doc.createElement('span');
      zero.textContent = '0';
      zero.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap;padding:0;border:0;margin:0;letter-spacing:normal';
      el.appendChild(zero);
      const ratio = zero.getBoundingClientRect().width / num(cs.fontSize);
      zero.remove();
      if (ratio > 0) blocks.forEach(b => Object.keys(b).forEach(p => {
        if (hasCh(b[p])) b[p] = b[p].replace(/(^|[\s(,])(-?\d*\.?\d+)ch\b/g, (_, pre, n) => `${pre}${Math.round(num(n) * ratio * 1000) / 1000}em`);
      }));
    }

    // display: none now — kept if another width or a state shows it
    if (cs.display === 'none') {
      const shownWider = node.ladder && node.ladder.some(s => s.props.display && s.props.display !== 'none');
      const shownNarrower = node.ladder && node.base.display !== 'none' && node.ladder.some(s => s.props.display === 'none');
      // hidden by a container query (`@md:hidden`) or shown by one, at another container size
      const shownInContainer = (node.container || []).some(s => s.props.display !== undefined && (s.props.display !== 'none' || node.base.display !== 'none'));
      if (!shownWider && !shownNarrower && !shownInContainer) { node.dropUnlessShown = true; node.base.display = 'none'; }
    }

    // ::before / ::after
    ['before', 'after'].forEach(pe => {
      let pcs2;
      try { pcs2 = win.getComputedStyle(el, `::${pe}`); } catch (_) { return; }
      const content = pcs2.getPropertyValue('content');
      if (!content || content === 'none' || content === 'normal' || pcs2.display === 'none') return;
      const pd = baseline.read('span', pe);
      const props = { content: absUrls(content, doc.baseURI) };
      const pm = matchedRules(el, idx, pe).base;
      PROPS.forEach(prop => {
        let v = pcs2.getPropertyValue(prop).trim();
        // a bare-number line-height comes down from the element and scales with the font size
        if (prop === 'line-height' && node.lhFactor !== null && authoredRaw(el, pm, prop, W, rtl, null) === undefined && Math.abs(num(v) - node.lhFactor * num(pcs2.fontSize)) < 0.6) return;
        if (INHERITED.has(prop) && !CURRENT_COLOR.has(prop)) { if (v === cs.getPropertyValue(prop).trim()) return; }
        else if (CURRENT_COLOR.has(prop)) { if (v === pcs2.color || (/^border-/.test(prop) && !num(pcs2.getPropertyValue(prop.replace('color', 'width'))))) return; }
        else if (/^border-.*-style$/.test(prop) && !num(pcs2.getPropertyValue(prop.replace('style', 'width')))) return;
        else if (v === pd[prop] && !AUTHORED_FIRST.has(prop)) return;
        if (AUTHORED_FIRST.has(prop)) {
          const raw = authoredRaw(el, pm, prop, W, rtl, getNow);
          const a = (raw === undefined ? '' : finish(resolveVars(raw, getNow)).trim()) || undefined;
          if (a !== undefined && agrees(a, v, prop, pcs2)) v = a;
          else if (a === undefined && v === pd[prop]) return;
          // a size no rule sets is layout's doing; written as drawn (width: 1440px) it would
          // hold the pseudo-element, and the grid or row around it, at that one screen's size
          else if (a === undefined && ONLY_AUTHORED.has(prop) && (/^inline/.test(pcs2.display) || !(idx.unreadable || shadowNode))) return;
        }
        props[prop] = polish(prop, finish(v));
      });
      node.pseudo[pe] = props;
      // its own breakpoints, as the element's ladder: from the narrowest screen up
      const pWidth = pm.filter(m => m.rule.media.some(md => md.widthDependent));
      if (pWidth.length) {
        const pProps = new Set();
        pWidth.forEach(m => propsOfRule(m.rule, rtl).forEach(p => pProps.add(p)));
        pProps.delete('content');
        const bounds = [...new Set(pWidth.flatMap(m => m.rule.media.flatMap(md => md.bounds)))].filter(b => b > 1 && b < 10000).sort((a, b) => a - b);
        const at = s => Object.fromEntries([...pProps].map(p => {
          const raw = authoredRaw(el, pm, p, s, rtl, getAt(s));
          const v = raw === undefined ? '' : finish(resolveVars(raw, getAt(s))).trim();
          return [p, v ? polish(p, v) : undefined];
        }));
        const first = at(1);
        let prev = first;
        const steps = [];
        bounds.forEach(s => {
          const cur = at(s);
          const diff = {};
          pProps.forEach(p => {
            if (cur[p] === prev[p]) return;
            diff[p] = cur[p] === undefined ? finish(INHERITED.has(p) ? cs.getPropertyValue(p) : UNSET_TO[p] || pd[p] || 'initial') : cur[p];
          });
          if (Object.keys(diff).length) steps.push({ min: s, props: diff });
          prev = cur;
        });
        if (steps.length) {
          pProps.forEach(p => {
            if (!steps.some(st => st.props[p] !== undefined)) return;
            if (first[p] !== undefined) props[p] = first[p];
            else delete props[p];
          });
          (node.pseudoLadder = node.pseudoLadder || {})[pe] = steps;
        }
      }
      // an icon font is often only ever used here, and its @font-face has to come along
      node.pseudoFonts = (node.pseudoFonts || []).concat([[splitTop(pcs2.fontFamily, ',').map(f => f.replace(/^["']|["']$/g, '').trim()), pcs2.fontWeight, pcs2.fontStyle]]);
    });

    // A field's placeholder text has its own colour, which the browser default won't match.
    if ((tag === 'input' || tag === 'textarea') && el.getAttribute('placeholder')) {
      try {
        const ph = win.getComputedStyle(el, '::placeholder');
        const props = {};
        if (ph.color && ph.color !== cs.color) props.color = finish(ph.color);
        if (num(ph.opacity) !== 1) props.opacity = ph.opacity;
        if (Object.keys(props).length) node.pseudo.placeholder = props;
      } catch (_) {}
    }

    // states — hover, focus… — and which element's hover triggers them
    stateMatches.forEach(({ rule, part }) => {
      if (!rule.media.every(m => m.test(W))) return;
      let trigger = null;
      for (let t = el; t; t = t.parentElement) {
        const ti = elToIndex.get(t);
        if (ti === undefined) break;
        try { if (el.matches(part.raw.replace(STATE_ALL, `[data-dtx="${ti}"]`))) { trigger = ti; break; } } catch (_) { break; }
      }
      if (trigger === null) return;
      const which = (part.raw.match(STATE) || [])[1];
      const decls = {};
      const touched = new Set();
      rule.props.forEach(p => {
        const phys = physical(p, rtl);
        if (PROP_SET.has(phys)) touched.add(phys);
        if (SHORTHAND_NAMES.has(p)) Object.entries(SHORTHANDS_OF).forEach(([lh, srcs]) => { if (srcs.some(s => s.sh === p)) touched.add(lh); });
      });
      touched.forEach(prop => {
        const d = declared(rule.style, rule.props, prop, rtl, getNow);
        if (!d || !d.value || /^(inherit|initial|unset|revert|revert-layer)$/.test(d.value.trim())) return;
        const v = finish(resolveVars(absUrls(d.value, rule.base), getNow)).trim();
        if (v) decls[prop] = polish(prop, v);
      });
      if (!Object.keys(decls).length) return;
      const pseudoEl = part.pseudoEl || null;
      const existing = node.states.find(s => s.state === which && s.trigger === trigger && s.pseudoEl === pseudoEl);
      if (existing) Object.assign(existing.props, decls);
      else node.states.push({ state: which, trigger, pseudoEl, props: decls, order: rule.order });
    });
    node.states.sort((a, b) => a.order - b.order);
    if (node.dropUnlessShown && node.states.some(s => s.props.display && s.props.display !== 'none')) node.dropUnlessShown = false;
    return node;
  }

  // ── fonts ──────────────────────────────────────────────────────
  // Families on Google Fonts load anywhere; a site's own font files usually only load on that site.
  const GOOGLE = 'Inter|Inter Tight|Roboto|Roboto Flex|Roboto Mono|Roboto Slab|Roboto Condensed|Open Sans|Lato|Montserrat|Poppins|Source Sans 3|Source Serif 4|Source Code Pro|Raleway|Nunito|Nunito Sans|Ubuntu|Merriweather|Playfair Display|Rubik|Work Sans|Noto Sans|Noto Serif|PT Sans|PT Serif|Lora|Mulish|Manrope|DM Sans|DM Serif Display|DM Mono|Fira Sans|Fira Code|Barlow|Karla|Josefin Sans|Quicksand|Oswald|Heebo|IBM Plex Sans|IBM Plex Mono|IBM Plex Serif|IBM Plex Sans Arabic|Space Grotesk|Space Mono|Plus Jakarta Sans|Outfit|Sora|Lexend|Figtree|Onest|Geist|Geist Mono|Archivo|Cabin|Bitter|Libre Baskerville|Libre Franklin|Crimson Text|Crimson Pro|Inconsolata|JetBrains Mono|Titillium Web|Hind|Mukta|Cairo|Tajawal|Almarai|Noto Kufi Arabic|Noto Naskh Arabic|Noto Sans Arabic|Readex Pro|Be Vietnam Pro|Urbanist|Red Hat Display|Red Hat Text|Epilogue|Syne|Bricolage Grotesque|Instrument Sans|Instrument Serif|Albert Sans|Public Sans|Schibsted Grotesk|Hanken Grotesk|Chivo|Overpass|Assistant|Prompt|Kanit|Exo 2|Dosis|Abel|Anton|Bebas Neue|Archivo Black|Caveat|Pacifico|Dancing Script|Lobster|Comfortaa|Righteous|Fraunces|EB Garamond|Cormorant Garamond|Cormorant|Spectral|Alegreya|Zilla Slab|Arvo|Vollkorn|Abril Fatface|Prata|Unbounded|Golos Text|Rethink Sans|Wix Madefor Display|Wix Madefor Text|Gabarito|Mona Sans|Hubot Sans|Atkinson Hyperlegible|Lexend Deca|Signika|Asap|Catamaran|Varela Round|Questrial|Teko|Saira|Encode Sans|Kumbh Sans|Familjen Grotesk|Newsreader|Literata|Young Serif|Bodoni Moda|Darker Grotesque|Commissioner|Montserrat Alternates|Noto Sans JP|Noto Sans KR|Noto Sans SC|Noto Sans TC|Mada|Changa|El Messiri|Lalezar|Reem Kufi|Amiri|Markazi Text|Harmattan|Lateef|Vazirmatn|Silkscreen|Press Start 2P|VT323'.split('|');
  const GOOGLE_LC = new Map(GOOGLE.map(f => [f.toLowerCase(), f]));
  // names sites give fonts that Google publishes under another name
  const GOOGLE_ALIAS = { geistsans: 'Geist', 'geist sans': 'Geist', geistmono: 'Geist Mono', intervariable: 'Inter', 'inter var': 'Inter', interdisplay: 'Inter' };
  const googleName = clean => {
    const key = clean.toLowerCase().replace(/ variable$/, '');
    return GOOGLE_LC.get(clean.toLowerCase()) || GOOGLE_LC.get(key) || (GOOGLE_ALIAS[key.replace(/\s+/g, '')] || GOOGLE_ALIAS[key] || null);
  };
  // Google families with an optical-size axis, and the weights their variable file spans. Asked for
  // by weight alone, Google serves the text cut, which sets headings ~8% wider than Inter Display.
  const GOOGLE_OPSZ = { Inter: ['14..32', '100..900'], 'Roboto Flex': ['8..144', '100..1000'], 'Roboto Serif': ['8..144', '100..900'], Fraunces: ['9..144', '100..900'], Literata: ['7..72', '200..900'], Newsreader: ['6..72', '200..800'], 'Source Serif 4': ['8..60', '200..900'], 'Bodoni Moda': ['6..96', '400..900'] };
  // Whether the page's own file for a family has that axis: with it, the same text sets to another
  // width once optical sizing is switched off.
  function hasOpsz(doc, family) {
    if (!doc.body) return false;
    const probe = doc.createElement('span');
    probe.style.cssText = `position:absolute;left:-99999px;top:0;white-space:nowrap;font-size:72px;font-family:${quoteFamily(family)},monospace`;
    probe.textContent = 'Hamburgefonstiv 0123';
    doc.body.appendChild(probe);
    const auto = probe.getBoundingClientRect().width;
    probe.style.fontOpticalSizing = 'none';
    const off = probe.getBoundingClientRect().width;
    probe.remove();
    return Math.abs(auto - off) > 0.5;
  }
  // next/font names a family "__Inter_d65c78"; the real name is in there.
  const cleanFamily = f => {
    const m = /^__(.+?)_([0-9a-f]{5,8})$/i.exec(f);
    return m ? m[1].replace(/_/g, ' ') : f;
  };
  const quoteFamily = f => (/^[a-z][\w-]*$/i.test(f) ? f : `"${f}"`);

  // A face's font-weight descriptor as a range: "400" → [400, 400], "100 900" → [100, 900].
  const faceWeights = v => {
    const t = String(v || '400').trim().split(/\s+/).map(x => (x === 'normal' ? 400 : x === 'bold' ? 700 : num(x) || 400));
    return [t[0], t[1] ?? t[0]];
  };
  // The face a browser draws a weight with, as CSS font matching picks it: one that spans the
  // weight; else, from 400 to 500, heavier ones up to 500 first; lighter first below 400 and
  // heavier first above 500.
  function bestFace(faces, w) {
    const span = faces.find(f => f.w[0] <= w && w <= f.w[1]);
    if (span) return span;
    const below = faces.filter(f => f.w[1] < w).sort((a, b) => b.w[1] - a.w[1]);
    const above = faces.filter(f => f.w[0] > w).sort((a, b) => a.w[0] - b.w[0]);
    if (w >= 400 && w <= 500) return above.find(f => f.w[0] <= 500) || below[0] || above[0];
    return w < 400 ? below[0] || above[0] : above[0] || below[0];
  }

  function planFonts(idx, nodes, pageOrigin, doc = null) {
    const used = new Map(); // family (lower case) → weights and styles drawn with it
    const note = (stack, weight, style) => (stack || []).slice(0, 3).forEach(f => {
      const k = f.toLowerCase();
      if (!used.has(k)) used.set(k, { weights: new Set(), italic: false, combos: new Set() });
      const u = used.get(k);
      u.weights.add(String(Math.round(num(weight) / 100) * 100 || 400));
      if (style === 'italic') u.italic = true;
      u.combos.add(`${num(weight) || 400}|${/^(italic|oblique)/.test(style || '') ? 'italic' : 'normal'}`);
    });
    nodes.forEach(n => {
      note(n.fontStack, n.weight, n.fontStyle);
      (n.pseudoFonts || []).forEach(([stack, weight, style]) => note(stack, weight, style));
    });
    const rename = new Map();
    const previewFaces = [];
    const exportFaces = [];
    const google = new Map();
    const selfHosted = new Set();
    const localFaces = new Map(); // family (lower case) → its faces that aren't on Google
    idx.fontFaces.forEach(({ rule, base }) => {
      const fam = (rule.style.getPropertyValue('font-family') || '').replace(/^["']|["']$/g, '').trim();
      const u = used.get(fam.toLowerCase());
      if (!u) return;
      const css = absUrls(rule.cssText, base);
      previewFaces.push(css);
      const clean = cleanFamily(fam);
      const isFallback = /\bfallback$/i.test(clean);
      // Fontsource names a variable font "Inter Variable"; on Google it is plain "Inter"
      const g = googleName(clean);
      if (g && !isFallback && g !== fam) rename.set(fam, quoteFamily(g));
      else if (clean !== fam) rename.set(fam, quoteFamily(clean));
      if (g && !isFallback) {
        const entry = google.get(g) || { weights: new Set(), italic: false, opsz: false };
        u.weights.forEach(w => entry.weights.add(w));
        entry.italic = entry.italic || u.italic;
        if (GOOGLE_OPSZ[g] && !entry.opsz && doc) entry.opsz = hasOpsz(doc, fam);
        google.set(g, entry);
        return;
      }
      const list = localFaces.get(fam.toLowerCase()) || [];
      list.push({
        css: clean !== fam ? css.replace(new RegExp(`(["']?)${escapeRe(fam)}\\1`), quoteFamily(clean)) : css,
        w: faceWeights(rule.style.getPropertyValue('font-weight')),
        italic: /^(italic|oblique)/.test(rule.style.getPropertyValue('font-style') || ''),
        order: list.length
      });
      localFaces.set(fam.toLowerCase(), list);
      // A font file from the site's own domain usually won't load anywhere else; one from a public
      // CDN already crossed domains to reach this page, so it will.
      const fileUrl = (/url\("(?!data:)([^"]+)"\)/.exec(css) || [])[1];
      let sameSite = false;
      try { sameSite = !!fileUrl && new URL(fileUrl).origin === pageOrigin; } catch (_) {}
      if (sameSite && !isFallback) selfHosted.add(clean);
    });
    // Only the faces the section draws with go out: a site lists every weight in both styles and
    // three formats, and a download carrying all of them runs to megabytes.
    localFaces.forEach((faces, fam) => {
      const keep = new Set();
      used.get(fam).combos.forEach(combo => {
        const [w, st] = combo.split('|');
        const styled = faces.filter(f => f.italic === (st === 'italic'));
        const face = bestFace(styled.length ? styled : faces, num(w));
        if (face) keep.add(face);
      });
      faces.filter(f => keep.has(f)).forEach(f => exportFaces.push(f.css));
    });
    const exportLinks = new Set(idx.fontImports);
    google.forEach((e, fam) => {
      const ws = [...e.weights].sort((a, b) => a - b);
      let axis = e.italic ? `ital,wght@${ws.map(w => `0,${w}`).concat(ws.map(w => `1,${w}`)).join(';')}` : `wght@${ws.join(';')}`;
      // the variable file, whole: optical sizes and every weight (510 stays 510)
      if (e.opsz) {
        const [o, w] = GOOGLE_OPSZ[fam];
        axis = e.italic ? `ital,opsz,wght@0,${o},${w};1,${o},${w}` : `opsz,wght@${o},${w}`;
      }
      exportLinks.add(`https://fonts.googleapis.com/css2?family=${fam.replace(/ /g, '+')}:${axis}&display=swap`);
    });
    const notes = [];
    if (selfHosted.size) notes.push(`${[...selfHosted].join(', ')} ${selfHosted.size === 1 ? 'is' : 'are'} served by this site, so only load there. A downloaded HTML or Elementor file carries ${selfHosted.size === 1 ? 'it' : 'them'} inside; copied code needs the font files hosted next to it. Check the font license before using ${selfHosted.size === 1 ? 'it' : 'them'} in production.`);
    return { rename, previewFaces, previewLinks: [...idx.fontImports], exportFaces, exportLinks: [...exportLinks], notes, pageOrigin };
  }

  // ── names ──────────────────────────────────────────────────────
  const UTILITY = /^-?(?:m[trblxyse]?|p[trblxyse]?|w|h|size|min|max|gap|space|top|left|right|bottom|inset|z|order|col|row|grid|flex|basis|grow|shrink|items|justify|content|self|place|text|font|leading|tracking|bg|from|via|to|border|rounded|shadow|opacity|ring|outline|fill|stroke|object|overflow|cursor|select|transition|duration|ease|delay|animate|transform|translate|rotate|scale|skew|origin|aspect|line|list|decoration|underline|whitespace|break|truncate|sr|not|backdrop|blur|brightness|contrast|drop|filter|mix|isolation|columns|divide|accent|caret|pointer|scroll|snap|touch|will|appearance|align|indent|hyphens|clear|float|box|table|caption|visible|invisible|collapse|static|fixed|absolute|relative|sticky|block|inline|hidden|contents|container|antialiased|subpixel|uppercase|lowercase|capitalize|normal|italic|isolate|group|peer|dark|lg|md|sm|xl|2xl|js|is|has)(?:-|$)/;
  const semantic = c => c.length >= 3 && c.length <= 32 && /^[a-z][a-z0-9]*(?:[-_]{1,2}[a-z0-9]+)*$/i.test(c) && !UTILITY.test(c) && !/[0-9a-f]{5,}|\d{3,}|^(sc|css|jsx|emotion|svelte|astro|framer|chakra|mui|ant|el|v)-/i.test(c) && !/^[a-z]{1,3}[A-Z0-9]/.test(c);
  function roleName(node) {
    const t = node.tag;
    if (/^h[1-6]$/.test(t)) return 'title';
    const map = { section: 'section', header: 'header', footer: 'footer', nav: 'nav', main: 'main', article: 'article', aside: 'aside', p: 'text', a: 'link', button: 'button', img: 'image', picture: 'picture', svg: 'icon', ul: 'list', ol: 'list', li: 'item', label: 'label', input: 'input', textarea: 'input', select: 'select', form: 'form', video: 'video', figure: 'figure', figcaption: 'caption', blockquote: 'quote', span: 'span', strong: 'strong', em: 'em', small: 'small', table: 'table', tr: 'row', td: 'cell', th: 'cell', iframe: 'embed', hr: 'divider' };
    if (map[t]) return map[t];
    const d = node.base.display || node.display || '';
    if (/grid/.test(d)) return 'grid';
    if (/flex/.test(d)) return /column/.test(node.base['flex-direction'] || '') ? 'stack' : 'row';
    return 'box';
  }

  // ── building ──────────────────────────────────────────────────
  function build(root, opts = {}) {
    const run = opts.withRealWidth || (fn => fn());
    const model = run(() => snapshot(root));
    // nodes hidden now and never shown are dropped, with what's inside them
    const dropped = new Set();
    model.nodes.forEach(n => { if ((n.dropUnlessShown && n.i !== 0) || (n.parent != null && dropped.has(n.parent))) dropped.add(n.i); });
    model.nodes.forEach(n => { n.kids = n.kids.filter(k => typeof k !== 'number' || !dropped.has(k)); });
    model.dropped = dropped;
    model.pins = new Map();
    assignNames(model);
    return makeExport(model);
  }

  function depthBetween(model, anc, i) {
    let d = 0;
    for (let n = model.nodes[i]; n && n.i !== anc; n = model.nodes[n.parent]) d++;
    return d;
  }
  function signature(model, n) {
    const rel = n.states.map(s => [s.state, s.trigger === n.i ? 0 : depthBetween(model, s.trigger, n.i), s.pseudoEl, s.props]);
    return JSON.stringify([n.tag === 'svg' ? 'svg' : '', n.base, n.ladder, n.container || null, n.pseudo, n.pseudoLadder || null, rel, model.pins.get(n.i) || null]);
  }

  function assignNames(model) {
    const used = new Map();
    const bySig = new Map();
    model.nodes.forEach(n => {
      if (model.dropped.has(n.i)) return;
      const sig = signature(model, n);
      if (n.i !== 0 && bySig.has(sig)) { n.cls = bySig.get(sig); return; }
      const fromPage = n.classes.find(semantic);
      let name = (fromPage || roleName(n)).toLowerCase().replace(/_+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/^-+|-+$/g, '').slice(0, 32) || 'box';
      if (/^\d/.test(name)) name = `x-${name}`;
      const count = (used.get(name) || 0) + 1;
      used.set(name, count);
      if (count > 1) name = `${name}-${count}`;
      n.cls = name;
      bySig.set(sig, name);
    });
    // the element whose hover drives someone else's look is a named group
    model.triggers = new Map();
    model.nodes.forEach(n => n.states.forEach(s => {
      if (s.trigger !== n.i && !model.dropped.has(s.trigger)) model.triggers.set(s.trigger, model.nodes[s.trigger].cls);
    }));
    // an element with nothing of its own to say carries no class
    model.nodes.forEach(n => {
      n.bare = n.i !== 0 && !Object.keys(n.base).length && !n.ladder && !n.container && !Object.keys(n.pseudo).length && !n.states.length && !model.pins.has(n.i) && !model.triggers.has(n.i);
    });
  }

  // ── CSS text ───────────────────────────────────────────────────
  const ORDER = PROPS.reduce((m, p, i) => ((m[p] = i), m), {});
  const ANIM_KEYS = ['animation-name', 'animation-duration', 'animation-timing-function', 'animation-delay', 'animation-iteration-count', 'animation-direction', 'animation-fill-mode', 'animation-play-state'];
  const ANIM_DEFAULTS = ['none', '0s', 'ease', '0s', '1', 'normal', 'none', 'running'];
  function animationShorthand(p, sep = ', ') {
    const lists = ANIM_KEYS.map(k => splitTop(p[k] || '', ','));
    const pick = (k, i) => (lists[k].length && lists[k][0] ? lists[k][i % lists[k].length] : ANIM_DEFAULTS[k]);
    return lists[0].map((name, i) => {
      const rest = [2, 3, 4, 5, 6, 7].map(k => [k, pick(k, i)]).filter(([k, v]) => v !== ANIM_DEFAULTS[k]).map(([, v]) => v);
      // a delay can only be read as one after a duration, which is always written
      return [name, pick(1, i), ...rest].join(' ');
    }).join(sep);
  }
  function compact(props) {
    const p = { ...props };
    const out = [];
    const sides = ['top', 'right', 'bottom', 'left'];
    const four = (keys, short) => {
      const vals = keys.map(k => p[k]);
      if (vals.some(v => v === undefined)) return;
      const [t, r, b, l] = vals;
      out.push([short, t === r && r === b && b === l ? t : t === b && r === l ? `${t} ${r}` : r === l ? `${t} ${r} ${b}` : `${t} ${r} ${b} ${l}`]);
      keys.forEach(k => delete p[k]);
    };
    four(sides.map(s => `margin-${s}`), 'margin');
    four(sides.map(s => `padding-${s}`), 'padding');
    // two equal sides on one axis read better as margin-inline / padding-block
    ['margin', 'padding'].forEach(b => {
      [['inline', 'left', 'right'], ['block', 'top', 'bottom']].forEach(([axis, a1, a2]) => {
        if (p[`${b}-${a1}`] !== undefined && p[`${b}-${a1}`] === p[`${b}-${a2}`]) {
          out.push([`${b}-${axis}`, p[`${b}-${a1}`]]);
          delete p[`${b}-${a1}`];
          delete p[`${b}-${a2}`];
        }
      });
    });
    if (p['overflow-x'] !== undefined && p['overflow-x'] === p['overflow-y']) { out.push(['overflow', p['overflow-x']]); delete p['overflow-x']; delete p['overflow-y']; }
    four(['border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius'], 'border-radius');
    const bw = sides.map(s => p[`border-${s}-width`]), bs = sides.map(s => p[`border-${s}-style`]), bc = sides.map(s => p[`border-${s}-color`]);
    if ([...bw, ...bs, ...bc].every(v => v !== undefined) && new Set(bw).size === 1 && new Set(bs).size === 1 && new Set(bc).size === 1) {
      out.push(['border', `${bw[0]} ${bs[0]} ${bc[0]}`]);
      sides.forEach(s => ['width', 'style', 'color'].forEach(k => delete p[`border-${s}-${k}`]));
    }
    if (p['row-gap'] !== undefined && p['row-gap'] === p['column-gap']) { out.push(['gap', p['row-gap']]); delete p['row-gap']; delete p['column-gap']; }
    if (p['transition-property'] !== undefined && p['transition-duration'] !== undefined) {
      const [props2, dur, ease, delay] = ['transition-property', 'transition-duration', 'transition-timing-function', 'transition-delay'].map(k => splitTop(p[k] || '', ','));
      const pick = (arr, i, d) => (arr.length && arr[0] ? arr[i % arr.length] : d);
      out.push(['transition', props2.map((pr, i) => [pr, pick(dur, i, '0s'), pick(ease, i, 'ease'), pick(delay, i, '0s')].filter((x, j) => !(j === 3 && /^0m?s$/.test(x))).join(' ')).join(', ')]);
      ['transition-property', 'transition-duration', 'transition-timing-function', 'transition-delay'].forEach(k => delete p[k]);
    }
    if (p['animation-name'] !== undefined && p['animation-duration'] !== undefined) {
      out.push(['animation', animationShorthand(p)]);
      ANIM_KEYS.forEach(k => delete p[k]);
    }
    Object.keys(p).sort((a, b) => (ORDER[a] ?? 999) - (ORDER[b] ?? 999)).forEach(k => out.push([k, p[k]]));
    return out;
  }
  const decls = (props, indent = '  ') => compact(props).map(([k, v]) => `${indent}${k}: ${v};`).join('\n');

  // ── the output ────────────────────────────────────────────────
  function makeExport(model) {
    const nodes = model.nodes;
    const live = n => !model.dropped.has(n.i);
    const root = nodes[0];
    const pinsFor = i => model.pins.get(i) || null;
    // A pin is a size measured at one screen width, so it holds only between the breakpoints
    // around that width; wider and narrower screens keep the page's own rules.
    const pinRange = () => {
      const below = model.breakpoints.filter(b => b <= model.viewport);
      const above = model.breakpoints.filter(b => b > model.viewport);
      return { min: below.length ? below[below.length - 1] : 0, max: above.length ? above[0] - 0.02 : Infinity };
    };
    const pinsEverywhere = () => { const r = pinRange(); return r.min === 0 && r.max === Infinity; };
    const pinMedia = () => {
      const r = pinRange();
      return [r.min > 0 ? `(min-width: ${fmtNum(r.min)}px)` : '', r.max !== Infinity ? `(max-width: ${fmtNum(r.max)}px)` : ''].filter(Boolean).join(' and ');
    };
    const fontFix = v => {
      let out = v;
      model.fonts.rename.forEach((clean, raw) => { out = out.replace(new RegExp(`(["']?)${escapeRe(raw)}\\1`, 'g'), clean); });
      return out;
    };
    const withFonts = (props, forPreview) => (!props || forPreview || props['font-family'] === undefined || !model.fonts.rename.size ? props : { ...props, 'font-family': fontFix(props['font-family']) });

    function cssText({ forPreview = false } = {}) {
      const scope = `.${root.cls}`;
      const blocks = [];
      const faces = forPreview ? model.fonts.previewFaces : model.fonts.exportFaces;
      if (faces.length) blocks.push(faces.join('\n'));
      blocks.push(resetCss(scope));
      const emitted = new Set();
      const mediaBlocks = new Map();
      const stateBlocks = [];
      const pseudoBlocks = [];
      const addMedia = (min, text) => { const l = mediaBlocks.get(min) || []; l.push(text); mediaBlocks.set(min, l); };
      const containerBlocks = new Map();
      const pinBlocks = [];
      nodes.forEach(n => {
        if (!live(n) || emitted.has(n.cls)) return;
        emitted.add(n.cls);
        const sel = n.i === 0 ? scope : `${scope} .${n.cls}`;
        const own = withFonts({ ...n.base }, forPreview);
        const pins = pinsFor(n.i);
        if (pins && pinsEverywhere()) Object.assign(own, pins);
        if (Object.keys(own).length) blocks.push(`${sel} {\n${decls(own)}\n}`);
        (n.ladder || []).forEach(step => addMedia(step.min, `  ${sel} {\n${decls(withFonts(step.props, forPreview), '    ')}\n  }`));
        if (pins && !pinsEverywhere()) pinBlocks.push(`  ${sel} {\n${decls(pins, '    ')}\n  }`);
        (n.container || []).forEach(step => {
          const at = `${step.media ? '@media' : '@container'} ${step.cond}`;
          const l = containerBlocks.get(at) || [];
          l.push(`  ${sel} {\n${decls(withFonts(step.props, forPreview), '    ')}\n  }`);
          containerBlocks.set(at, l);
        });
        // next to the element's own rule, so its breakpoints (in the media blocks below) come later
        ['before', 'after'].forEach(pe => {
          if (!n.pseudo[pe]) return;
          const { content, ...rest } = n.pseudo[pe];
          const body = decls(withFonts(rest, forPreview));
          blocks.push(`${sel}::${pe} {\n  content: ${content};${body ? `\n${body}` : ''}\n}`);
          ((n.pseudoLadder || {})[pe] || []).forEach(step => addMedia(step.min, `  ${sel}::${pe} {\n${decls(withFonts(step.props, forPreview), '    ')}\n  }`));
        });
        if (n.pseudo.placeholder) pseudoBlocks.push(`${sel}::placeholder {\n${decls(n.pseudo.placeholder)}\n}`);
        n.states.forEach(s => {
          const trig = s.trigger === n.i ? null : nodes[s.trigger];
          const pe = s.pseudoEl ? `::${s.pseudoEl}` : '';
          const selector = trig ? `${trig.i === 0 ? scope : `${scope} .${trig.cls}`}:${s.state} .${n.cls}${pe}` : `${sel}:${s.state}${pe}`;
          stateBlocks.push(`${selector} {\n${decls(withFonts(s.props, forPreview))}\n}`);
        });
      });
      [...mediaBlocks.keys()].sort((a, b) => a - b).forEach(min => blocks.push(`@media (min-width: ${fmtNum(min)}px) {\n${mediaBlocks.get(min).join('\n')}\n}`));
      if (pinBlocks.length) blocks.push(`@media ${pinMedia()} {\n${pinBlocks.join('\n')}\n}`);
      sortConds([...containerBlocks.keys()]).forEach(at => blocks.push(`${at} {\n${containerBlocks.get(at).join('\n')}\n}`));
      blocks.push(...pseudoBlocks, ...stateBlocks);
      model.keyframes.forEach(css => blocks.push(css));
      return blocks.join('\n\n');
    }

    const clsOf = n => (n.bare ? '' : n.cls);
    const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\u00a0/g, '&nbsp;');
    const escAttr = s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    const escClass = s => String(s).replace(/"/g, '&quot;').replace(/</g, '&lt;');
    const INLINE = d => /^inline|^contents$|^ruby/.test(d || '');
    // Children can go one per line unless the line breaks would add or remove space that shows:
    // real text, or two inline boxes side by side. In HTML a line break is a space, so only
    // inline boxes that touched need keeping together; JSX and Vue drop line breaks between
    // tags altogether, so there any two inline boxes in a row must stay on one line.
    const flowsInline = (n, dropsBreaks = false) => {
      if (/flex|grid/.test(n.display || '')) return false;
      // a ::before or ::after in the line is an inline box too: a line break beside it would show
      // as a space (Stripe's word joiner before an arrow icon)
      const pseudoInLine = ['before', 'after'].some(pe => { const p = n.pseudo[pe]; return p && !/^(absolute|fixed)$/.test(p.position || '') && (!p.display || INLINE(p.display)); });
      if (pseudoInLine && n.kids.some(k => typeof k === 'number' && INLINE(nodes[k].display))) return true;
      let prevInline = false;
      let gap = false;
      for (const k of n.kids) {
        if (typeof k !== 'number') {
          if (k.text.replace(/[ \t\n\r\f]/g, '')) return true;
          gap = true;
          continue;
        }
        const inl = INLINE(nodes[k].display);
        if (inl && prevInline && (!gap || dropsBreaks)) return true;
        prevInline = inl;
        gap = false;
      }
      return false;
    };

    // Test builds mark every element with data-dt, so a copy can be matched to the page
    // element by element; nothing a person downloads carries them.
    let markerMode = false;

    // markup, shared by every format; `classOf` decides what goes in class=""
    function markup(classOf, { forPreview = false } = {}) {
      forPreview = forPreview || markerMode;
      const headOf = n => {
        const attrs = [];
        const cls = classOf(n);
        if (cls) attrs.push(`class="${escClass(cls)}"`);
        if (forPreview) attrs.push(`data-dt="${n.i}"`);
        Object.entries(n.attrs).forEach(([k, v]) => attrs.push(v === '' && BOOL_ATTR.test(k) ? k : `${k}="${escAttr(v)}"`));
        return `<${n.tag}${attrs.length ? ' ' + attrs.join(' ') : ''}>`;
      };
      const svgOf = n => {
        const cls = classOf(n);
        return n.svg.replace(/^<svg\b/, `<svg${cls ? ` class="${escClass(cls)}"` : ''}${forPreview ? ` data-dt="${n.i}"` : ''}`);
      };
      const sourceTags = n => (n.sources || []).map(s => `<source ${Object.entries(s).map(([k, v]) => `${k}="${escAttr(v)}"`).join(' ')}>`);
      const inline = n => {
        if (n.svg) return svgOf(n);
        if (VOID.has(n.tag)) return headOf(n);
        return headOf(n) + sourceTags(n).join('') + n.kids.map(k => (typeof k === 'number' ? inline(nodes[k]) : esc(k.text))).join('') + `</${n.tag}>`;
      };
      const lines = [];
      const open = (n, depth) => {
        const pad = '  '.repeat(depth);
        if (n.svg || VOID.has(n.tag)) { lines.push(pad + (n.svg ? svgOf(n) : headOf(n))); return; }
        if (!n.kids.length) { lines.push(`${pad}${headOf(n)}</${n.tag}>`); return; }
        if (n.pre || flowsInline(n)) {
          const body = n.kids.map(k => (typeof k === 'number' ? inline(nodes[k]) : esc(k.text))).join('');
          lines.push(`${pad}${headOf(n)}${sourceTags(n).join('')}${n.pre ? body : body.replace(/^ +| +$/g, '')}</${n.tag}>`);
          return;
        }
        lines.push(pad + headOf(n));
        sourceTags(n).forEach(t => lines.push('  '.repeat(depth + 1) + t));
        n.kids.forEach(k => {
          if (typeof k === 'number') open(nodes[k], depth + 1);
          else if (k.text.trim()) lines.push('  '.repeat(depth + 1) + esc(k.text.trim()));
        });
        lines.push(`${pad}</${n.tag}>`);
      };
      open(root, 0);
      return lines.join('\n');
    }

    const header = format => `Exported with PixelLens${model.source ? ` from ${model.source.split('#')[0]}` : ''} — ${format}.`;
    const fontLinkTags = () => model.fonts.exportLinks.map(h => `<link rel="stylesheet" href="${escAttr(h)}">`).join('\n');

    // ── HTML + CSS
    function htmlFormat() {
      const links = fontLinkTags();
      return `<!-- ${header('HTML + CSS')} -->\n${links ? links + '\n' : ''}${markup(clsOf)}\n\n<style>\n${cssText()}\n</style>\n`;
    }

    // ── Tailwind
    const twCache = new Map();
    function twClasses(n) {
      const key = `${n.i}|${n.cls}`;
      if (twCache.has(key)) return twCache.get(key);
      const out = [];
      const own = withFonts({ ...n.base }, false);
      // Tailwind v4's preflight clears a field's background as the copy's reset does; v3's leaves
      // it white
      if (/^(input|select|textarea)$/.test(n.tag) && own['background-color'] === undefined) own['background-color'] = 'transparent';
      const pins = pinsFor(n.i);
      if (pins && pinsEverywhere()) Object.assign(own, pins);
      out.push(...toTailwind(own, ''));
      // `after` names a pseudo-element (`before:`), which Tailwind wants after the breakpoint
      const ladderTw = (ladder, after = '') => {
        if (ladder.every(step => BP[step.min])) {
          ladder.forEach(step => out.push(...toTailwind(withFonts(step.props, false), bpVariant(step.min) + after)));
          return;
        }
        // Tailwind (v3 and v4 alike) sorts min-[992px] before md:, so mixed breakpoints would
        // override each other in the wrong order. Ranges that don't overlap, each carrying all
        // that is in force there, give the same result whatever the order.
        let state = {};
        ladder.forEach((step, k) => {
          state = { ...state, ...step.props };
          const next = ladder[k + 1];
          const range = `[@media(min-width:${fmtNum(step.min)}px)${next ? `_and_(max-width:${fmtNum(next.min - 0.02)}px)` : ''}]:`;
          out.push(...toTailwind(withFonts(state, false), range + after));
        });
      };
      ladderTw(n.ladder || []);
      if (pins && !pinsEverywhere()) out.push(...toTailwind(pins, `[@media${pinMedia().replace(/ /g, '_')}]:`));
      // Container steps likewise: Tailwind sorts these variants as text (1001px before 961px), so
      // plain minimum widths become ranges that don't overlap.
      const minOf = cond => {
        const m = /^\s*(?:([a-z_-][\w-]*)\s+)?\(\s*(?:min-(?:width|inline-size)\s*:|(?:width|inline-size)\s*>=)\s*(-?\d*\.?\d+)px\s*\)\s*$/i.exec(cond);
        return m ? { name: m[1] || '', min: num(m[2]) } : null;
      };
      const ranges = new Map();
      (n.container || []).forEach(step => {
        const m = minOf(step.cond);
        if (!m) { out.push(...toTailwind(withFonts(step.props, false), `[${step.media ? '@media' : '@container'}_${twArb(step.cond)}]:`)); return; }
        const g = `${step.media ? '@media' : `@container${m.name ? `_${m.name}` : ''}`}`;
        ranges.set(g, (ranges.get(g) || []).concat({ min: m.min, props: step.props }));
      });
      ranges.forEach((list, at) => {
        let state = {};
        list.sort((a, b) => a.min - b.min).forEach((s, k) => {
          state = { ...state, ...s.props };
          const next = list[k + 1];
          out.push(...toTailwind(withFonts(state, false), `[${at}_(min-width:${fmtNum(s.min)}px)${next ? `_and_(max-width:${fmtNum(next.min - 0.02)}px)` : ''}]:`));
        });
      });
      ['before', 'after'].forEach(pe => {
        if (!n.pseudo[pe]) return;
        const { content, ...rest } = n.pseudo[pe];
        out.push(`${pe}:content-[${twArb(content)}]`, ...toTailwind(withFonts(rest, false), `${pe}:`));
        ladderTw((n.pseudoLadder || {})[pe] || [], `${pe}:`);
      });
      if (n.pseudo.placeholder) out.push(...toTailwind(n.pseudo.placeholder, 'placeholder:'));
      n.states.forEach(s => {
        const pe = s.pseudoEl ? `${s.pseudoEl}:` : '';
        const variant = s.trigger === n.i ? `${s.state}:` : `group-${s.state}/${model.triggers.get(s.trigger)}:`;
        out.push(...toTailwind(withFonts(s.props, false), variant + pe));
      });
      if (model.triggers.has(n.i)) out.unshift(`group/${model.triggers.get(n.i)}`);
      const text = [...new Set(out)].join(' ');
      twCache.set(key, text);
      return text;
    }
    function tailwindExtraCss() {
      const blocks = [];
      if (model.fonts.exportFaces.length) blocks.push(model.fonts.exportFaces.join('\n'));
      model.keyframes.forEach(css => blocks.push(css));
      return blocks.join('\n\n');
    }
    function tailwindFormat() {
      twCache.clear();
      const links = fontLinkTags();
      const extra = tailwindExtraCss();
      return `<!-- ${header('Tailwind CSS')} -->\n${links ? links + '\n' : ''}${markup(twClasses)}\n${extra ? `\n<style>\n${extra}\n</style>\n` : ''}`;
    }

    // ── React and Vue: one walk that folds repeated siblings into a list
    const JSX_ATTR = { class: 'className', for: 'htmlFor', tabindex: 'tabIndex', readonly: 'readOnly', maxlength: 'maxLength', colspan: 'colSpan', rowspan: 'rowSpan', autoplay: 'autoPlay', playsinline: 'playsInline', allowfullscreen: 'allowFullScreen', frameborder: 'frameBorder', srcdoc: 'srcDoc', crossorigin: 'crossOrigin', srcset: 'srcSet', datetime: 'dateTime', 'xlink:href': 'xlinkHref', 'xmlns:xlink': 'xmlnsXlink', 'xml:space': 'xmlSpace', viewbox: 'viewBox' };

    function shapeOf(n) {
      if (n.svg) return `svg.${n.cls}:${n.svg}`;
      return `${n.tag}.${n.cls}[${Object.keys(n.attrs).sort().join(',')}]${n.sources ? JSON.stringify(n.sources) : ''}(${n.kids.map(k => (typeof k === 'number' ? shapeOf(nodes[k]) : 'T')).join(',')})`;
    }
    function fieldsOf(n, out = [], path = 'r') {
      if (n.svg) return out;
      Object.entries(n.attrs).forEach(([k, v]) => out.push({ path: `${path}@${k}`, key: k, value: v }));
      n.kids.forEach((k, i) => {
        if (typeof k === 'number') fieldsOf(nodes[k], out, `${path}/${i}`);
        else out.push({ path: `${path}/${i}#`, key: 'text', value: k.text.trim() });
      });
      return out;
    }
    function groupRuns(kids) {
      const groups = [];
      let i = 0;
      while (i < kids.length) {
        const k = kids[i];
        if (typeof k !== 'number') { groups.push({ one: k }); i++; continue; }
        const shape = shapeOf(nodes[k]);
        let j = i + 1;
        while (j < kids.length && typeof kids[j] === 'number' && shapeOf(nodes[kids[j]]) === shape) j++;
        if (j - i >= 3) { groups.push({ run: kids.slice(i, j) }); i = j; } else { groups.push({ one: k }); i++; }
      }
      return groups;
    }

    function componentName() {
      const from = root.classes.find(semantic) || (root.cls !== 'box' ? root.cls : '') || 'section';
      const base = from.replace(/[^a-z0-9]+/gi, ' ').trim().split(/\s+/).map(w => w[0].toUpperCase() + w.slice(1)).join('');
      return /^[A-Z]/.test(base) ? base : `Section${base}`;
    }

    function framework(kind) {
      twCache.clear();
      const react = kind === 'react';
      const lists = [];
      const lines = [];
      const textEsc = s => {
        const t = String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\u00a0/g, '&nbsp;');
        return react ? t.replace(/[{}]/g, c => `{'${c}'}`) : t.replace(/\{\{/g, "{{ '{{' }}");
      };
      const attrText = (k, v, bound) => {
        const name = react ? JSX_ATTR[k] || k : k;
        if (bound) return react ? `${name}={${bound}}` : `:${k}="${bound}"`;
        if (v === '' && BOOL_ATTR.test(k)) return name;
        return `${name}="${escAttr(v)}"`;
      };
      const svgFor = (n, cls) => {
        let s = n.svg.replace(/^<svg\b/, `<svg ${react ? 'className' : 'class'}="${escClass(cls)}"`);
        if (react) {
          s = s.replace(/<([a-zA-Z][\w:-]*)((?:\s+[^\s=>/]+(?:="[^"]*")?)*)\s*(\/?)>/g, (m, t, attrs, slash) => `<${t}${attrs.replace(/\s([a-zA-Z][\w:-]*)=/g, (mm, a) => ` ${JSX_ATTR[a.toLowerCase()] || (/[-:]/.test(a) && !/^(aria|data)-/.test(a) ? camel(a.replace(':', '-')) : a)}=`)}${slash ? ' /' : ''}>`);
        }
        return s;
      };
      const tagOpen = (n, bind, keyExpr) => {
        const attrs = [];
        const cls = twClasses(n);
        if (cls) attrs.push(`${react ? 'className' : 'class'}="${escClass(cls)}"`);
        if (keyExpr) attrs.push(react ? `key={${keyExpr}}` : `:key="${keyExpr}"`);
        Object.entries(n.attrs).forEach(([k, v]) => attrs.push(attrText(k, v, bind && bind.attr(n, k))));
        return `<${n.tag}${attrs.length ? ' ' + attrs.join(' ') : ''}`;
      };
      const selfClose = n => (react ? ' />' : VOID.has(n.tag) ? '>' : `></${n.tag}>`);
      const textOf = (n, k, i, bind) => {
        const b = bind && bind.text(n, i);
        return b ? (react ? `{${b}}` : `{{ ${b} }}`) : textEsc(k.text);
      };
      const sourceTags = n => (n.sources || []).map(s => `<source ${Object.entries(s).map(([k, v]) => `${react && k === 'srcset' ? 'srcSet' : k}="${escAttr(v)}"`).join(' ')}${react ? ' />' : '>'}`);
      const inline = (n, bind) => {
        if (n.svg) return svgFor(n, twClasses(n));
        if (VOID.has(n.tag) || !n.kids.length) return tagOpen(n, bind) + selfClose(n);
        return `${tagOpen(n, bind)}>${sourceTags(n).join('')}${n.kids.map((k, i) => (typeof k === 'number' ? inline(nodes[k], bind) : textOf(n, k, i, bind))).join('')}</${n.tag}>`;
      };
      const emit = (n, depth, bind = null, keyExpr = null) => {
        const pad = '  '.repeat(depth);
        if (n.svg) {
          let s = svgFor(n, twClasses(n));
          if (keyExpr) s = s.replace(/^<svg\b/, react ? `<svg key={${keyExpr}}` : `<svg :key="${keyExpr}"`);
          lines.push(pad + s);
          return;
        }
        const head = tagOpen(n, bind, keyExpr);
        if (VOID.has(n.tag) || !n.kids.length) { lines.push(pad + head + selfClose(n)); return; }
        if (n.pre && react) {
          lines.push(`${pad}${head}>{${JSON.stringify(n.kids.map(k => (typeof k === 'number' ? '' : k.text)).join(''))}}</${n.tag}>`);
          return;
        }
        if (n.pre || flowsInline(n, true)) {
          const body = n.kids.map((k, i) => (typeof k === 'number' ? inline(nodes[k], bind) : textOf(n, k, i, bind))).join('');
          lines.push(`${pad}${head}>${sourceTags(n).join('')}${n.pre ? body : body.replace(/^ +| +$/g, '')}</${n.tag}>`);
          return;
        }
        lines.push(`${pad}${head}>`);
        sourceTags(n).forEach(t => lines.push('  '.repeat(depth + 1) + t));
        groupRuns(n.kids).forEach(g => {
          if (g.one !== undefined) {
            if (typeof g.one === 'number') emit(nodes[g.one], depth + 1, bind);
            else if (g.one.text.trim()) {
              // inside a repeated item the text may be the item's own (a link's label)
              const b = bind && bind.text(n, n.kids.indexOf(g.one));
              lines.push('  '.repeat(depth + 1) + (b ? (react ? `{${b}}` : `{{ ${b} }}`) : textEsc(g.one.text.trim())));
            }
            return;
          }
          // a run: the first item is the template, the fields that differ become data
          const items = g.run.map(k => fieldsOf(nodes[k]));
          const varying = items[0].map((f, fi) => (items.some(it => it[fi] && it[fi].value !== f.value) ? fi : -1)).filter(fi => fi >= 0);
          const names = new Map();
          const taken = new Map();
          varying.forEach(fi => {
            const f = items[0][fi];
            const base = f.key === 'text' ? 'label' : camel(f.key);
            const c = (taken.get(base) || 0) + 1;
            taken.set(base, c);
            names.set(f.path, c > 1 ? `${base}${c}` : base);
          });
          const template = nodes[g.run[0]];
          // named for what the items are: logos, images, links, or the class they share
          const keys = varying.map(fi => items[0][fi].key);
          const sample = items.map(it => it.map(f => f.value).join(' ')).join(' ').toLowerCase();
          let listName = keys.includes('src') ? (/logo/.test(sample) ? 'logo' : 'image') : keys.includes('href') ? 'link' : (template.classes.find(semantic) || template.cls || 'item');
          listName = listName.replace(/-\d+$/, '').replace(/[^a-z0-9]+(.)/gi, (_, c) => c.toUpperCase());
          listName = /s$/.test(listName) ? `${listName}List` : `${listName}s`;
          for (let k = 2; lists.some(l => l.name === listName); k++) listName = listName.replace(/\d*$/, String(k));
          let rows = items.map(it => Object.fromEntries(varying.map(fi => [names.get(it[fi].path), it[fi].value])));
          // a marquee repeats its items so it can loop: keep one copy and repeat it in code
          let iter = listName;
          const half = rows.length / 2;
          if (varying.length && rows.length % 2 === 0 && JSON.stringify(rows.slice(0, half)) === JSON.stringify(rows.slice(half))) {
            rows = rows.slice(0, half);
            iter = `[...${listName}, ...${listName}]`;
          }
          if (!varying.length) iter = react ? `Array.from({ length: ${g.run.length} })` : String(g.run.length);
          else lists.push({ name: listName, rows });
          const pathOf = new Map();
          const index = (n2, path) => {
            pathOf.set(n2.i, path);
            n2.kids.forEach((k, i) => { if (typeof k === 'number') index(nodes[k], `${path}/${i}`); });
          };
          index(template, 'r');
          const binder = {
            attr: (n2, k) => { const nm = names.get(`${pathOf.get(n2.i)}@${k}`); return nm ? `item.${nm}` : null; },
            text: (n2, i) => { const nm = names.get(`${pathOf.get(n2.i)}/${i}#`); return nm ? `item.${nm}` : null; }
          };
          const itemVar = varying.length ? 'item' : '_';
          if (react) {
            lines.push(`${'  '.repeat(depth + 1)}{${iter}.map((${itemVar}, i) => (`);
            emit(template, depth + 2, binder, 'i');
            lines.push(`${'  '.repeat(depth + 1)}))}`);
          } else {
            const before = lines.length;
            emit(template, depth + 1, binder, 'i');
            lines[before] = lines[before].replace(/^(\s*<[\w-]+)/, `$1 v-for="(${itemVar}, i) in ${iter}"`);
          }
        });
        lines.push(`${pad}</${n.tag}>`);
      };
      emit(root, react ? 2 : 1);
      return { body: lines.join('\n'), lists };
    }

    const json = v => JSON.stringify(v, null, 2);
    function reactFormat() {
      const { body, lists } = framework('react');
      const extra = tailwindExtraCss();
      const data = lists.map(l => `const ${l.name} = ${json(l.rows)};`).join('\n\n');
      const links = model.fonts.exportLinks.length ? `// Fonts — add to your document <head>:\n${model.fonts.exportLinks.map(h => `// <link rel="stylesheet" href="${h}" />`).join('\n')}\n\n` : '';
      // dangerouslySetInnerHTML, not a text child: rendered on a server (Next.js and the like),
      // React escapes a text child, and quotes in the CSS would arrive as &quot;
      const style = extra ? `      <style dangerouslySetInnerHTML={{ __html: \`\n${extra.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${').split('\n').map(l => '        ' + l).join('\n')}\n      \` }} />\n` : '';
      const markupBlock = style ? `    <>\n${style}${body.split('\n').map(l => '  ' + l).join('\n')}\n    </>` : body;
      return `// ${header('React + Tailwind CSS')}\n${links}${data ? data + '\n\n' : ''}export default function ${componentName()}() {\n  return (\n${markupBlock}\n  );\n}\n`;
    }
    function vueFormat() {
      const { body, lists } = framework('vue');
      const extra = tailwindExtraCss();
      const data = lists.map(l => `const ${l.name} = ${json(l.rows)};`).join('\n\n');
      const links = model.fonts.exportLinks.length ? `<!-- Fonts — add to your index.html:\n${model.fonts.exportLinks.map(h => `  <link rel="stylesheet" href="${h}">`).join('\n')}\n-->\n` : '';
      return `<!-- ${header('Vue + Tailwind CSS')} -->\n${links}<template>\n${body}\n</template>\n${data ? `\n<script setup>\n${data}\n</script>\n` : ''}${extra ? `\n<style>\n${extra}\n</style>\n` : ''}`;
    }

    // ── Elementor: the HTML + CSS export inside the free HTML widget, as an importable template
    function elementorFormat() {
      const rid = () => Math.random().toString(16).slice(2, 9).padEnd(7, '0');
      const links = fontLinkTags();
      const html = `${links ? links + '\n' : ''}${markup(clsOf)}\n<style>\n${cssText()}\n</style>`;
      const zero = { unit: 'px', top: '0', right: '0', bottom: '0', left: '0', isLinked: true };
      return json({
        content: [{
          id: rid(), elType: 'section', isInner: false,
          settings: { layout: 'full_width', gap: 'no', padding: zero },
          elements: [{
            id: rid(), elType: 'column', isInner: false,
            settings: { _column_size: 100, _inline_size: null, padding: zero },
            elements: [{ id: rid(), elType: 'widget', widgetType: 'html', isInner: false, settings: { html }, elements: [] }]
          }]
        }],
        page_settings: [],
        version: '0.4',
        title: `${componentName()} (PixelLens)`,
        type: 'section'
      }) + '\n';
    }

    const FORMATS = {
      tailwind: { label: 'Tailwind', text: tailwindFormat, ext: 'html', mime: 'text/html' },
      html: { label: 'HTML', text: htmlFormat, ext: 'html', mime: 'text/html' },
      react: { label: 'React', text: reactFormat, ext: 'jsx', mime: 'text/javascript' },
      vue: { label: 'Vue', text: vueFormat, ext: 'vue', mime: 'text/plain' },
      elementor: { label: 'Elementor', text: elementorFormat, ext: 'json', mime: 'application/json' }
    };

    // The export's @font-face rules with the site's own font files written in as data: URLs, so
    // a downloaded file draws the right type wherever it is opened. Fonts from CDNs stay linked:
    // they already load across domains.
    async function embeddedFaces() {
      const origin = model.fonts.pageOrigin;
      let budget = 6 * 1024 * 1024;
      const out = [];
      for (const css of model.fonts.exportFaces) {
        // one file per face is enough for a browser: woff2 when the site has it
        const src = /\bsrc:\s*([^;]+);/.exec(css);
        const entries = src ? splitTop(src[1], ',').map(e => e.trim()) : [];
        const urlOf = e => (/^url\("(?!data:)([^"]+)"\)/.exec(e) || [])[1];
        const pick = entries.find(e => urlOf(e) && /woff2/i.test(e)) || entries.find(urlOf);
        const url = pick && urlOf(pick);
        let same = false;
        try { same = !!url && new URL(url).origin === origin; } catch (_) {}
        const data = same ? await fontAsData(url) : null;
        if (!data || data.length > budget) { out.push(css); continue; }
        budget -= data.length;
        const format = (/format\(\s*["']?([\w-]+)["']?\s*\)/i.exec(pick) || [])[1];
        out.push(css.replace(src[0], `src: url("${data}")${format ? ` format("${format}")` : ''};`));
      }
      return out;
    }

    // A file to download. The two HTML formats open on their own in a browser.
    async function file(format, { markers = false } = {}) {
      const f = FORMATS[format];
      let text;
      markerMode = markers;
      try {
        if (/^(html|tailwind|elementor)$/.test(format) && model.fonts.exportFaces.length) {
          const linked = model.fonts.exportFaces;
          model.fonts.exportFaces = await embeddedFaces();
          try { text = f.text(); } finally { model.fonts.exportFaces = linked; }
        } else {
          text = f.text();
        }
      } finally {
        markerMode = false;
      }
      const slug = componentName().replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
      const name = `${slug}${format === 'elementor' ? '.elementor' : ''}.${f.ext}`;
      const page = (head, body) => `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>${esc(componentName())}</title>\n${head}</head>\n<body style="margin:0">\n${body}\n</body>\n</html>\n`;
      if (format === 'tailwind') return { name, mime: f.mime, text: page('<script src="https://cdn.tailwindcss.com"></script>\n', text) };
      if (format === 'html') return { name, mime: f.mime, text: page('', text) };
      return { name, mime: f.mime, text };
    }

    // ── the live copy ────────────────────────────────────────────
    // vh units are pinned to the screen being shown, so the copy can be sized to its content
    const vhPx = (css, h) => css.replace(/(-?\d*\.?\d+)(?:d|s|l)?vh\b/g, (_, n) => `${fmtNum((num(n) * h) / 100)}px`);
    function previewCss(device) {
      const h = device ? device.height : model.viewportHeight;
      let css = `html,body{margin:0;padding:0}html{color-scheme:${model.colorScheme}}body{background:${model.backdrop}}`;
      if (!device) css += `body{width:${model.parentWidth}px}`;
      if (model.rootPositioned) css += `.${root.cls}{position:relative!important;inset:auto!important}`;
      return `${css}\n${vhPx(cssText({ forPreview: true }), h)}`;
    }

    function render(frame, device) {
      const doc = frame.contentDocument;
      const win = frame.contentWindow;
      const sheet = new win.CSSStyleSheet();
      try { sheet.replaceSync(previewCss(device).replace(/@import[^;]+;/g, '')); } catch (_) {}
      doc.adoptedStyleSheets = [sheet];
      doc.head.querySelectorAll('link[data-dt-font]').forEach(l => l.remove());
      model.fonts.previewLinks.forEach(h => {
        const l = doc.createElement('link');
        l.rel = 'stylesheet';
        l.href = h;
        l.setAttribute('data-dt-font', '');
        doc.head.appendChild(l);
      });
      doc.body.innerHTML = markup(clsOf, { forPreview: true });
      if (!doc.__dtGuard) {
        doc.__dtGuard = true;
        // links and buttons in the copy go nowhere
        doc.addEventListener('click', e => { if (e.target.closest && e.target.closest('a, button, [type=submit]')) e.preventDefault(); }, true);
        doc.addEventListener('submit', e => e.preventDefault(), true);
      }
      return doc;
    }

    async function settle(doc, ms = 4000) {
      const win = doc.defaultView || window;
      const deadline = Date.now() + ms;
      const until = p => Promise.race([p, new Promise(r => setTimeout(r, Math.max(0, deadline - Date.now())))]);
      // font stylesheets first: until they arrive there is no face to wait for
      await until(Promise.all([...doc.querySelectorAll('link[rel="stylesheet"]')].map(l => (l.sheet ? null : new Promise(r => { l.addEventListener('load', r, { once: true }); l.addEventListener('error', r, { once: true }); })))));
      void doc.documentElement.offsetHeight;
      const loads = [];
      if (doc.fonts) {
        const seen = new Set();
        nodes.forEach(n => {
          const fam = firstFamily((n.fontStack || []).join(','));
          const key = `${n.weight}|${n.fontStyle}|${fam}`;
          if (!fam || seen.has(key)) return;
          seen.add(key);
          loads.push(doc.fonts.load(`${n.fontStyle === 'italic' ? 'italic ' : ''}${n.weight} 16px "${fam}"`).catch(() => null));
        });
        loads.push(doc.fonts.ready);
      }
      doc.querySelectorAll('img').forEach(img => {
        // one that isn't drawn, or that has its size written down, can't move anything when it arrives
        if (!img.complete && img.getClientRects().length && !(img.hasAttribute('width') && img.hasAttribute('height'))) loads.push(new Promise(r => { img.addEventListener('load', r, { once: true }); img.addEventListener('error', r, { once: true }); }));
      });
      await until(Promise.all(loads));
      await new Promise(r => win.requestAnimationFrame(() => win.requestAnimationFrame(r)));
    }

    // How closely the copy matches what the page draws: the geometry and the main visual values
    // of every visible element, weighted by its size.
    function score(doc) {
      const byI = new Map();
      doc.querySelectorAll('[data-dt]').forEach(el => byI.set(+el.getAttribute('data-dt'), el));
      const proot = byI.get(0);
      if (!proot) return { score: 0, issues: ['The copy did not render.'], misses: [] };
      if (doc.getAnimations) doc.getAnimations().forEach(a => { try { if (a.effect && isFinite(a.effect.getComputedTiming().endTime)) a.finish(); } catch (_) {} });
      const rb = layoutOffset(proot);
      const win = doc.defaultView;
      let total = 0, weight = 0, imgMiss = 0;
      const misses = [];
      nodes.forEach(n => {
        if (!live(n) || !n.measure.shown) return;
        const m = n.measure;
        const area = Math.sqrt(Math.max(1, m.w * m.h));
        weight += area;
        const el = byI.get(n.i);
        if (!el) return;
        const b = layoutOffset(el);
        const tolW = Math.max(1.5, m.w * 0.01), tolH = Math.max(1.5, m.h * 0.01);
        const geo = [Math.abs(b.x - rb.x - m.x) <= tolW, Math.abs(b.y - rb.y - m.y) <= tolH, Math.abs(b.w - m.w) <= tolW, Math.abs(b.h - m.h) <= tolH];
        const cs = win.getComputedStyle(el);
        const checks = MEASURE_PROPS.filter(p => !(p === 'opacity' && n.animationNames.length) && !(p === 'color' && TEXTLESS.has(n.tag))).map(p => {
          const a = m.cs[p], v = cs.getPropertyValue(p).trim();
          if (p === 'font-family') return firstFamily(a).toLowerCase() === firstFamily(v).toLowerCase();
          if (/color/.test(p)) return hexColor(a) === hexColor(v);
          if (/^-?\d/.test(a) && /^-?\d/.test(v)) return Math.abs(num(a) - num(v)) <= 0.6;
          return a === v;
        });
        total += (0.6 * (geo.filter(Boolean).length / 4) + 0.4 * (checks.filter(Boolean).length / checks.length)) * area;
        if (geo.some(g => !g)) misses.push({ i: n.i, dx: b.x - rb.x - m.x, dy: b.y - rb.y - m.y, dw: b.w - m.w, dh: b.h - m.h });
        if (el.localName === 'img' && el.complete && !el.naturalWidth) imgMiss++;
      });
      const issues = [];
      if (misses.length) issues.push(`${misses.length} element${misses.length === 1 ? ' sits' : 's sit'} more than a pixel from where the page draws ${misses.length === 1 ? 'it' : 'them'}.`);
      if (imgMiss) issues.push(`${imgMiss} image${imgMiss === 1 ? '' : 's'} could not be loaded.`);
      return { score: weight ? Math.min(100, Math.round((total / weight) * 1000) / 10) : 100, issues: issues.concat(model.notes), misses };
    }

    // pin what still sits off to the size the page draws it at
    function repair(misses) {
      let changed = false;
      misses.forEach(mi => {
        const n = nodes[mi.i];
        // inline boxes and media size themselves; a pin there would only fight the image
        if (/^inline$/.test(n.display) || n.svg || /^(img|video|iframe|canvas|picture)$/.test(n.tag)) return;
        const m = n.measure;
        const pins = { ...(model.pins.get(n.i) || {}) };
        const exactPx = v => `${Math.round(v * 1000) / 1000}px`;
        if (Math.abs(mi.dw) > Math.max(1.5, m.w * 0.01) && pins.width === undefined) { pins.width = exactPx(m.ew ?? m.w); changed = true; }
        if (Math.abs(mi.dh) > Math.max(1.5, m.h * 0.01) && pins.height === undefined) { pins.height = exactPx(m.eh ?? m.h); changed = true; }
        if (Object.keys(pins).length) model.pins.set(n.i, pins);
      });
      if (changed) { assignNames(model); twCache.clear(); }
      return changed;
    }

    const frameIn = (host, cls) => {
      const frame = host.ownerDocument.createElement('iframe');
      frame.className = cls;
      frame.setAttribute('title', 'Live copy of the exported section');
      frame.setAttribute('tabindex', '-1');
      host.appendChild(frame);
      standards(frame);
      return frame;
    };

    // Renders the copy off screen at the page's own width, measures it, pins what's off and
    // measures again. Resolves with { score, issues }.
    async function measure() {
      const wrap = document.createElement('div');
      wrap.id = 'sr-xp-measure';
      wrap.style.cssText = `position:fixed!important;left:-100000px!important;top:0!important;width:${model.viewport}px!important;height:10px!important;overflow:hidden!important;visibility:hidden!important;pointer-events:none!important;contain:strict!important`;
      document.documentElement.appendChild(wrap);
      const frame = frameIn(wrap, 'sr-xp-measure-frame');
      frame.style.cssText = `width:${model.viewport}px!important;height:${Math.ceil(model.height + 400)}px!important;max-width:none!important;max-height:none!important;border:0!important;display:block!important`;
      try {
        await new Promise(r => setTimeout(r, 0));
        let doc = render(frame, null);
        await settle(doc);
        let result = score(doc);
        if (result.misses.length) {
          // a late font or image moves things; measure once more before pinning anything
          await settle(doc, 1500);
          await new Promise(r => setTimeout(r, 400));
          result = score(doc);
        }
        const firstMisses = result.misses.slice(0, 12);
        for (let pass = 0; pass < 2 && result.misses.length; pass++) {
          if (!repair(result.misses)) break;
          doc = render(frame, null);
          await settle(doc, 1500);
          result = score(doc);
        }
        return { score: result.score, issues: result.issues, pinned: model.pins.size, firstMisses };
      } finally {
        wrap.remove();
      }
    }

    // Mounts the copy into `host`. `device` = { width, height }, or null for the section as it
    // sits on the page. By default the copy scales to the host's width and the host takes its
    // height. `scale` fixes the scale instead; `screen` makes the host a device's screen, as tall
    // as the device, with the copy scrolling inside it. `onFit` hears the copy's natural size.
    function mountPreview(host, { device = null, scale: fixedScale = null, screen = false, onFit = null } = {}) {
      const sizer = host.ownerDocument.createElement('div');
      sizer.className = 'sr-xp-sizer';
      host.appendChild(sizer);
      const frame = frameIn(sizer, 'sr-xp-frame');
      let dev = device;
      let alive = true;
      let token = 0;
      const fit = () => {
        if (!alive || !frame.contentDocument) return;
        const doc = frame.contentDocument;
        const proot = doc.querySelector('[data-dt="0"]');
        const fw = dev ? dev.width : model.viewport;
        const r = proot ? layoutOffset(proot) : { x: 0, y: 0, w: fw, h: 100 };
        const cropX = dev ? 0 : r.x;
        const cropW = dev ? dev.width : Math.max(1, r.w);
        const viewH = Math.max(1, Math.ceil(r.h));
        const boxH = Math.max(viewH, screen && dev ? dev.height : 0);
        const contentH = Math.max(Math.ceil(doc.documentElement.scrollHeight), Math.ceil(r.y + boxH));
        const scale = fixedScale != null ? fixedScale : Math.min(1, (host.clientWidth || cropW) / cropW);
        // set as important: the host page's own iframe rules mustn't resize the copy
        frame.style.setProperty('width', `${fw}px`, 'important');
        frame.style.setProperty('height', `${contentH}px`, 'important');
        frame.style.setProperty('transform', `translate(${-cropX * scale}px, ${-r.y * scale}px) scale(${scale})`, 'important');
        sizer.style.setProperty('height', `${Math.max(24, Math.ceil(boxH * scale))}px`, 'important');
        if (fixedScale != null) sizer.style.setProperty('width', `${Math.ceil(cropW * scale)}px`, 'important');
        if (!screen) host.style.setProperty('height', `${Math.max(24, Math.ceil(viewH * scale))}px`, 'important');
        host.setAttribute('data-scale', String(Math.round(scale * 100)));
        if (onFit) onFit({ width: cropW, height: viewH });
      };
      const draw = async () => {
        const mine = ++token;
        frame.style.setProperty('width', `${dev ? dev.width : model.viewport}px`, 'important');
        await new Promise(r => setTimeout(r, 0));
        if (!alive || mine !== token) return;
        const doc = render(frame, dev);
        fit();
        await settle(doc, 2500);
        if (mine === token) fit();
      };
      const ready = draw();
      const ro = new ResizeObserver(() => fit());
      ro.observe(host);
      return {
        ready,
        frame,
        setDevice(d) { dev = d; return draw(); },
        refresh() { return draw(); },
        destroy() { alive = false; ro.disconnect(); sizer.remove(); }
      };
    }

    // A script can build a tree that HTML can't write down — a <div> inside a <p>, a link inside a
    // link — and the parser rebuilds such markup differently: it closes the <p> early, or moves the
    // inner link out, and the layout falls apart. So the markup is parsed the way a browser would,
    // and any element that lands somewhere else changes its tag to a neutral one until the parsed
    // tree is the same as the page's.
    const PHRASING_HOLDERS = /^(p|h[1-6]|dt|caption|legend|summary|pre)$/;
    const INTERACTIVE = /^(a|button|label|select|textarea|input|details|form|iframe|video|audio)$/;
    function fixNesting() {
      let renamed = 0;
      const rename = n => {
        if (!n) return false;
        const to = /^inline/.test(n.display || '') ? 'span' : 'div';
        if (n.tag === to) return false;
        if (/^h[1-6]$/.test(n.tag)) { n.attrs.role = 'heading'; n.attrs['aria-level'] = n.tag[1]; }
        if (n.base.display === undefined && n.display && n.display !== 'none') n.base.display = n.display;
        delete n.attrs.href;
        n.tag = to;
        renamed++;
        return true;
      };
      for (let pass = 0; pass < 6; pass++) {
        let html;
        try { html = markup(() => '', { forPreview: true }); } catch (_) { return; }
        const doc = new DOMParser().parseFromString(`<!doctype html><html><body>${html}</body></html>`, 'text/html');
        const seen = new Set();
        const fix = new Set();
        doc.querySelectorAll('[data-dt]').forEach(el => {
          const i = +el.getAttribute('data-dt');
          const n = nodes[i];
          if (!n) return;
          if (seen.has(i)) { fix.add(n); return; } // copied by the parser around a misplaced block
          seen.add(i);
          if (i === 0 || n.parent == null) return;
          const holder = el.parentElement && el.parentElement.closest('[data-dt]');
          const got = holder ? +holder.getAttribute('data-dt') : null;
          if (got === n.parent) return;
          const parent = nodes[n.parent];
          // a heading or paragraph holding blocks gives way; an interactive element nested in
          // another interactive one is the one that changes
          if (parent && PHRASING_HOLDERS.test(parent.tag)) fix.add(parent);
          else if (INTERACTIVE.test(n.tag)) fix.add(n);
          else if (parent) fix.add(parent);
        });
        nodes.forEach(n => { if (live(n) && !seen.has(n.i) && !n.svg && n.parent != null && nodes[n.parent] && !nodes[n.parent].svg) fix.add(n); });
        let changed = false;
        fix.forEach(n => { if (rename(n)) changed = true; });
        if (!changed) break;
      }
      if (renamed) model.notes.push(`${renamed} element${renamed === 1 ? ' was' : 's were'} nested in a way HTML can't write down (a block inside a paragraph, a link inside a link), so ${renamed === 1 ? 'it now uses' : 'they now use'} a neutral tag to keep the layout.`);
    }
    fixNesting();

    return {
      model,
      formats: Object.fromEntries(Object.entries(FORMATS).map(([k, f]) => [k, f.label])),
      text: format => FORMATS[format].text(),
      file,
      measure,
      mountPreview,
      componentName,
      stats: text => ({ lines: text.split('\n').length, bytes: new Blob([text]).size }),
      size: () => ({ width: model.width, height: model.height, nodes: model.nodes.length - model.dropped.size, breakpoints: model.breakpoints, notes: model.notes })
    };
  }

  // ── Tailwind ───────────────────────────────────────────────────
  // Arbitrary values: spaces become underscores, real underscores are escaped, and double quotes
  // turn single so the class survives inside class="".
  const twArb = v => String(v).trim().replace(/"/g, "'").replace(/_/g, '\\_').replace(/\s+/g, '_');
  const BP = { 640: 'sm', 768: 'md', 1024: 'lg', 1280: 'xl', 1536: '2xl' };
  const bpVariant = min => (BP[min] ? `${BP[min]}:` : `min-[${fmtNum(min)}px]:`);
  const SPACE = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 16, 20, 24, 28, 32, 36, 40, 44, 48, 52, 56, 60, 64, 72, 80, 96];
  function spacing(v, { allowAuto = true, fractions = false } = {}) {
    v = String(v).trim();
    if (v === 'auto' && allowAuto) return { neg: '', val: 'auto' };
    let neg = '';
    let s = v;
    if (/^-/.test(s)) { neg = '-'; s = s.slice(1); }
    if (s === '1px') return { neg, val: 'px' };
    if (s === '0' || s === '0px') return { neg: '', val: '0' };
    const px = /^(\d*\.?\d+)px$/.exec(s);
    if (px) { const n = num(px[1]) / 4; if (SPACE.includes(n)) return { neg, val: fmtNum(n) }; }
    if (fractions) {
      const pct = /^(\d*\.?\d+)%$/.exec(s);
      if (pct) {
        const f = num(pct[1]) / 100;
        if (f === 1) return { neg, val: 'full' };
        for (const d of [2, 3, 4, 5, 6, 12]) for (let k = 1; k < d; k++) if (Math.abs(f - k / d) < 0.00005) return { neg, val: `${k}/${d}` };
      }
    }
    return { neg: '', val: `[${twArb(v)}]` };
  }
  const sp = (prefix, v, opts) => { const r = spacing(v, opts); return `${r.neg}${prefix}-${r.val}`; };
  const SIZE_WORD = { '100%': 'full', auto: 'auto', 'max-content': 'max', 'min-content': 'min', 'fit-content': 'fit' };
  const sizeCls = (prefix, v) => {
    // min-w-auto / min-h-auto are Tailwind v4 only
    if (v === 'auto' && /^(min|max)-/.test(prefix)) return `${prefix}-[auto]`;
    if (SIZE_WORD[v]) return `${prefix}-${SIZE_WORD[v]}`;
    // only the -screen names Tailwind v3 has too (it has no max-w-screen or min-w-screen)
    if (prefix === 'w' && v === '100vw') return 'w-screen';
    if (/^(min-|max-)?h$/.test(prefix) && v === '100vh') return `${prefix}-screen`;
    if (v === 'none' && /^max/.test(prefix)) return `${prefix}-none`;
    return sp(prefix, v, { fractions: true });
  };
  const COLOR = (prefix, v) => {
    if (v === 'transparent') return `${prefix}-transparent`;
    if (/^currentcolor$/i.test(v)) return `${prefix}-current`;
    if (v === 'inherit') return `${prefix}-inherit`;
    if (/^#ffffff$/i.test(v)) return `${prefix}-white`;
    if (/^#000000$/i.test(v)) return `${prefix}-black`;
    return /^#[0-9a-f]+$/i.test(v) ? `${prefix}-[${v}]` : `${prefix}-[color:${twArb(v)}]`;
  };
  const KEYWORD = {
    display: { block: 'block', 'inline-block': 'inline-block', inline: 'inline', flex: 'flex', 'inline-flex': 'inline-flex', grid: 'grid', 'inline-grid': 'inline-grid', contents: 'contents', none: 'hidden', 'flow-root': 'flow-root', table: 'table', 'table-row': 'table-row', 'table-cell': 'table-cell', 'list-item': 'list-item', 'table-row-group': 'table-row-group', 'table-header-group': 'table-header-group' },
    position: { static: 'static', relative: 'relative', absolute: 'absolute', fixed: 'fixed', sticky: 'sticky' },
    'flex-direction': { row: 'flex-row', column: 'flex-col', 'row-reverse': 'flex-row-reverse', 'column-reverse': 'flex-col-reverse' },
    'flex-wrap': { wrap: 'flex-wrap', nowrap: 'flex-nowrap', 'wrap-reverse': 'flex-wrap-reverse' },
    'justify-content': { 'flex-start': 'justify-start', start: 'justify-start', center: 'justify-center', 'flex-end': 'justify-end', end: 'justify-end', 'space-between': 'justify-between', 'space-around': 'justify-around', 'space-evenly': 'justify-evenly', normal: 'justify-normal', stretch: 'justify-stretch' },
    'align-items': { 'flex-start': 'items-start', start: 'items-start', center: 'items-center', 'flex-end': 'items-end', end: 'items-end', baseline: 'items-baseline', stretch: 'items-stretch', normal: 'items-stretch' },
    'align-content': { 'flex-start': 'content-start', start: 'content-start', center: 'content-center', 'flex-end': 'content-end', end: 'content-end', 'space-between': 'content-between', 'space-around': 'content-around', 'space-evenly': 'content-evenly', stretch: 'content-stretch', normal: 'content-normal' },
    'align-self': { auto: 'self-auto', 'flex-start': 'self-start', start: 'self-start', center: 'self-center', 'flex-end': 'self-end', end: 'self-end', stretch: 'self-stretch', baseline: 'self-baseline' },
    'justify-items': { start: 'justify-items-start', end: 'justify-items-end', center: 'justify-items-center', stretch: 'justify-items-stretch' },
    'justify-self': { auto: 'justify-self-auto', start: 'justify-self-start', end: 'justify-self-end', center: 'justify-self-center', stretch: 'justify-self-stretch' },
    'box-sizing': { 'border-box': 'box-border', 'content-box': 'box-content' },
    'font-style': { italic: 'italic', normal: 'not-italic' },
    'text-align': { left: 'text-left', center: 'text-center', right: 'text-right', justify: 'text-justify', start: 'text-start', end: 'text-end' },
    'text-transform': { uppercase: 'uppercase', lowercase: 'lowercase', capitalize: 'capitalize', none: 'normal-case' },
    'text-decoration-line': { underline: 'underline', overline: 'overline', 'line-through': 'line-through', none: 'no-underline' },
    'text-decoration-style': { solid: 'decoration-solid', dashed: 'decoration-dashed', dotted: 'decoration-dotted', double: 'decoration-double', wavy: 'decoration-wavy' },
    'white-space': { normal: 'whitespace-normal', nowrap: 'whitespace-nowrap', pre: 'whitespace-pre', 'pre-line': 'whitespace-pre-line', 'pre-wrap': 'whitespace-pre-wrap', 'break-spaces': 'whitespace-break-spaces' },
    'word-break': { 'break-all': 'break-all', 'keep-all': 'break-keep', normal: 'break-normal' },
    'overflow-wrap': { 'break-word': 'break-words', anywhere: '[overflow-wrap:anywhere]', normal: '[overflow-wrap:normal]' },
    'text-overflow': { ellipsis: 'text-ellipsis', clip: 'text-clip' },
    visibility: { visible: 'visible', hidden: 'invisible', collapse: 'collapse' },
    isolation: { isolate: 'isolate', auto: 'isolation-auto' },
    'object-fit': { contain: 'object-contain', cover: 'object-cover', fill: 'object-fill', none: 'object-none', 'scale-down': 'object-scale-down' },
    'pointer-events': { none: 'pointer-events-none', auto: 'pointer-events-auto' },
    'user-select': { none: 'select-none', text: 'select-text', all: 'select-all', auto: 'select-auto' },
    'list-style-position': { inside: 'list-inside', outside: 'list-outside' },
    'list-style-type': { none: 'list-none', disc: 'list-disc', decimal: 'list-decimal' },
    'background-repeat': { 'no-repeat': 'bg-no-repeat', repeat: 'bg-repeat', 'repeat-x': 'bg-repeat-x', 'repeat-y': 'bg-repeat-y', round: 'bg-repeat-round', space: 'bg-repeat-space' },
    'background-clip': { text: 'bg-clip-text', 'border-box': 'bg-clip-border', 'padding-box': 'bg-clip-padding', 'content-box': 'bg-clip-content' },
    'background-origin': { 'border-box': 'bg-origin-border', 'padding-box': 'bg-origin-padding', 'content-box': 'bg-origin-content' },
    'background-attachment': { fixed: 'bg-fixed', local: 'bg-local', scroll: 'bg-scroll' },
    'background-size': { cover: 'bg-cover', contain: 'bg-contain', auto: 'bg-auto' },
    'border-collapse': { collapse: 'border-collapse', separate: 'border-separate' },
    'table-layout': { auto: 'table-auto', fixed: 'table-fixed' },
    'grid-auto-flow': { row: 'grid-flow-row', column: 'grid-flow-col', dense: 'grid-flow-dense', 'row dense': 'grid-flow-row-dense', 'column dense': 'grid-flow-col-dense' },
    'vertical-align': { baseline: 'align-baseline', top: 'align-top', middle: 'align-middle', bottom: 'align-bottom', 'text-top': 'align-text-top', 'text-bottom': 'align-text-bottom', sub: 'align-sub', super: 'align-super' },
    'mix-blend-mode': { normal: 'mix-blend-normal', multiply: 'mix-blend-multiply', screen: 'mix-blend-screen', overlay: 'mix-blend-overlay', darken: 'mix-blend-darken', lighten: 'mix-blend-lighten', difference: 'mix-blend-difference', exclusion: 'mix-blend-exclusion', 'plus-lighter': 'mix-blend-plus-lighter', 'color-dodge': 'mix-blend-color-dodge', luminosity: 'mix-blend-luminosity' },
    float: { left: 'float-left', right: 'float-right', none: 'float-none' },
    clear: { left: 'clear-left', right: 'clear-right', both: 'clear-both', none: 'clear-none' },
    '-webkit-font-smoothing': { antialiased: 'antialiased', auto: 'subpixel-antialiased' },
    'text-wrap-style': { balance: 'text-balance', pretty: 'text-pretty' },
    'scroll-snap-align': { start: 'snap-start', center: 'snap-center', end: 'snap-end', none: 'snap-align-none' }
  };
  const WEIGHT = { 100: 'thin', 200: 'extralight', 300: 'light', 400: 'normal', 500: 'medium', 600: 'semibold', 700: 'bold', 800: 'extrabold', 900: 'black' };
  const EASE = { linear: 'ease-linear', 'cubic-bezier(0.4, 0, 1, 1)': 'ease-in', 'cubic-bezier(0, 0, 0.2, 1)': 'ease-out', 'cubic-bezier(0.4, 0, 0.2, 1)': 'ease-in-out' };
  const DURATIONS = [0, 75, 100, 150, 200, 300, 500, 700, 1000];
  const ms = v => (/ms$/.test(v) ? num(v) : num(v) * 1000);
  const msCls = (pre, v) => { const d = ms(v); return DURATIONS.includes(d) ? `${pre}-${d}` : `${pre}-[${fmtNum(d)}ms]`; };
  const PLAIN_LENGTH = /^-?\d*\.?\d+(px|em|rem|%)$/;

  function toTailwind(props, variant) {
    const p = { ...props };
    const out = [];
    const add = cls => out.push(variant + cls);
    const take = k => { const v = p[k]; delete p[k]; return v; };
    const sides = ['top', 'right', 'bottom', 'left'];

    // boxes: one class for four equal sides, one per axis for pairs
    const box = (prefix, base) => {
      const [t, r, b, l] = sides.map(s => p[`${base}-${s}`]);
      const mk = (pre, v) => sp(pre, v, { allowAuto: base === 'margin' });
      if ([t, r, b, l].every(v => v !== undefined) && t === r && r === b && b === l) add(mk(prefix, t));
      else {
        if (t !== undefined && t === b) add(mk(`${prefix}y`, t)); else { if (t !== undefined) add(mk(`${prefix}t`, t)); if (b !== undefined) add(mk(`${prefix}b`, b)); }
        if (l !== undefined && l === r) add(mk(`${prefix}x`, l)); else { if (l !== undefined) add(mk(`${prefix}l`, l)); if (r !== undefined) add(mk(`${prefix}r`, r)); }
      }
      sides.forEach(s => delete p[`${base}-${s}`]);
    };
    box('p', 'padding');
    box('m', 'margin');

    const ins = sides.map(s => p[s]);
    if (ins.every(v => v !== undefined) && new Set(ins).size === 1) { add(sp('inset', ins[0], { fractions: true })); sides.forEach(take); }
    else {
      if (p.top !== undefined && p.top === p.bottom) { add(sp('inset-y', take('top'), { fractions: true })); take('bottom'); }
      if (p.left !== undefined && p.left === p.right) { add(sp('inset-x', take('left'), { fractions: true })); take('right'); }
      sides.forEach(s => { if (p[s] !== undefined) add(sp(s, take(s), { fractions: true })); });
    }

    const rad = ['border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius'];
    const rv = rad.map(k => p[k]);
    const radCls = (pre, v) => (num(v) >= 9999 ? `${pre}-full` : v === '0px' || v === '0' ? `${pre}-none` : `${pre}-[${twArb(v)}]`);
    if (rv.every(v => v !== undefined) && new Set(rv).size === 1) { add(radCls('rounded', rv[0])); rad.forEach(take); }
    else [['tl', 0], ['tr', 1], ['br', 2], ['bl', 3]].forEach(([c, i]) => { if (rv[i] !== undefined) { add(radCls(`rounded-${c}`, rv[i])); take(rad[i]); } });

    const side1 = { top: 't', right: 'r', bottom: 'b', left: 'l' };
    const bw = sides.map(s => p[`border-${s}-width`]);
    const bwCls = (pre, v) => (v === '1px' ? pre : v === '0px' || v === '0' ? `${pre}-0` : /^(2|4|8)px$/.test(v) ? `${pre}-${num(v)}` : `${pre}-[length:${twArb(v)}]`);
    if (bw.every(v => v !== undefined) && new Set(bw).size === 1) { add(bwCls('border', bw[0])); sides.forEach(s => take(`border-${s}-width`)); }
    else sides.forEach((s, i) => { if (bw[i] !== undefined) { add(bwCls(`border-${side1[s]}`, bw[i])); take(`border-${s}-width`); } });
    const bs = sides.map(s => p[`border-${s}-style`]);
    if (bs.every(v => v !== undefined) && new Set(bs).size === 1) { if (bs[0] !== 'solid') add(bs[0] === 'none' ? 'border-none' : `border-${bs[0]}`); sides.forEach(s => take(`border-${s}-style`)); }
    else sides.forEach(s => { const v = take(`border-${s}-style`); if (v !== undefined && v !== 'solid') add(`[border-${s}-style:${twArb(v)}]`); });
    const bc = sides.map(s => p[`border-${s}-color`]);
    if (bc.every(v => v !== undefined) && new Set(bc).size === 1) { add(COLOR('border', bc[0])); sides.forEach(s => take(`border-${s}-color`)); }
    else sides.forEach(s => { const v = take(`border-${s}-color`); if (v !== undefined) add(COLOR(`border-${side1[s]}`, v)); });

    if (p['row-gap'] !== undefined && p['row-gap'] === p['column-gap']) { add(sp('gap', take('row-gap'))); take('column-gap'); }
    if (p['row-gap'] !== undefined) add(sp('gap-y', take('row-gap')));
    if (p['column-gap'] !== undefined) add(sp('gap-x', take('column-gap')));

    if (p['-webkit-line-clamp'] !== undefined && p['-webkit-line-clamp'] !== 'none') {
      const n = take('-webkit-line-clamp');
      add(/^\d+$/.test(n) && +n <= 6 ? `line-clamp-${n}` : `line-clamp-[${twArb(n)}]`);
      if (p.display === '-webkit-box') take('display');
      take('-webkit-box-orient');
      if (p['overflow-y'] === 'hidden' && p['overflow-x'] === 'hidden') { take('overflow-x'); take('overflow-y'); }
    }

    if (p['overflow-x'] !== undefined && p['overflow-x'] === p['overflow-y']) { add(`overflow-${take('overflow-x')}`); take('overflow-y'); }
    ['x', 'y'].forEach(a => { const v = take(`overflow-${a}`); if (v !== undefined) add(`overflow-${a}-${v}`); });

    if (p['transition-property'] !== undefined) {
      const prop = take('transition-property');
      const durs = splitTop(take('transition-duration') || '0s', ',');
      const eases = splitTop(take('transition-timing-function') || 'ease', ',');
      const delays = splitTop(take('transition-delay') || '0s', ',');
      if (prop === 'none') add('transition-none');
      else if (new Set(durs).size === 1 && new Set(eases).size === 1 && new Set(delays).size === 1) {
        add(prop === 'all' ? 'transition-all' : `transition-[${twArb(splitTop(prop, ',').join(','))}]`);
        add(msCls('duration', durs[0]));
        add(EASE[eases[0]] || `ease-[${twArb(eases[0])}]`);
        if (ms(delays[0])) add(msCls('delay', delays[0]));
      } else {
        const list = splitTop(prop, ',').map((pr, i) => `${pr} ${durs[i % durs.length]} ${eases[i % eases.length]} ${delays[i % delays.length]}`);
        add(`[transition:${twArb(list.join(','))}]`);
      }
    } else {
      ['transition-duration', 'transition-timing-function', 'transition-delay'].forEach(k => { const v = take(k); if (v !== undefined) add(`[${k}:${twArb(v)}]`); });
    }
    if (p['animation-name'] !== undefined) {
      const sh = animationShorthand(p, ',');
      ANIM_KEYS.forEach(take);
      add(sh === 'none 0s' ? 'animate-none' : `animate-[${twArb(sh)}]`);
    }
    // The animation shorthand resets the timeline, so a scroll-driven one has to come after it
    // whatever order Tailwind writes its utilities in: a [&]: variant always sorts later.
    ['animation-timeline', 'animation-range-start', 'animation-range-end'].forEach(k => {
      const v = take(k);
      if (v !== undefined) add(`[&]:[${k}:${twArb(v)}]`);
    });

    Object.keys(p).forEach(k => {
      const v = p[k];
      if (v === undefined) return;
      if (KEYWORD[k] && KEYWORD[k][v]) { add(KEYWORD[k][v]); return; }
      switch (k) {
        case 'width': add(sizeCls('w', v)); return;
        case 'height': add(sizeCls('h', v)); return;
        case 'min-width': add(sizeCls('min-w', v)); return;
        case 'min-height': add(sizeCls('min-h', v)); return;
        case 'max-width': add(sizeCls('max-w', v)); return;
        case 'max-height': add(sizeCls('max-h', v)); return;
        case 'flex-basis': add(sizeCls('basis', v)); return;
        case 'flex-grow': add(v === '1' ? 'grow' : v === '0' ? 'grow-0' : `grow-[${twArb(v)}]`); return;
        case 'flex-shrink': add(v === '1' ? 'shrink' : v === '0' ? 'shrink-0' : `shrink-[${twArb(v)}]`); return;
        case 'order': add(/^-?\d+$/.test(v) && Math.abs(+v) <= 12 ? `${+v < 0 ? '-' : ''}order-${Math.abs(+v)}` : `order-[${twArb(v)}]`); return;
        case 'z-index': add(['0', '10', '20', '30', '40', '50', 'auto'].includes(v) ? `z-${v}` : `z-[${twArb(v)}]`); return;
        case 'grid-template-columns': { const m = /^repeat\((\d+),\s*minmax\(0(?:px)?,\s*1fr\)\)$/.exec(v); add(m ? `grid-cols-${m[1]}` : v === 'none' ? 'grid-cols-none' : `grid-cols-[${twArb(v)}]`); return; }
        case 'grid-template-rows': { const m = /^repeat\((\d+),\s*minmax\(0(?:px)?,\s*1fr\)\)$/.exec(v); add(m ? `grid-rows-${m[1]}` : v === 'none' ? 'grid-rows-none' : `grid-rows-[${twArb(v)}]`); return; }
        case 'grid-column-start': { const m = /^span (\d+)$/.exec(v); add(m && !p['grid-column-end'] ? `col-span-${m[1]}` : `col-start-[${twArb(v)}]`); return; }
        case 'grid-column-end': add(`col-end-[${twArb(v)}]`); return;
        case 'grid-row-start': { const m = /^span (\d+)$/.exec(v); add(m && !p['grid-row-end'] ? `row-span-${m[1]}` : `row-start-[${twArb(v)}]`); return; }
        case 'grid-row-end': add(`row-end-[${twArb(v)}]`); return;
        case 'grid-auto-columns': add(`auto-cols-[${twArb(v)}]`); return;
        case 'grid-auto-rows': add(`auto-rows-[${twArb(v)}]`); return;
        case 'font-family': add(`[font-family:${twArb(v)}]`); return;
        case 'font-size': add(PLAIN_LENGTH.test(v) ? `text-[${v}]` : `text-[length:${twArb(v)}]`); return;
        case 'font-weight': add(WEIGHT[v] ? `font-${WEIGHT[v]}` : `font-[${twArb(v)}]`); return;
        case 'line-height': add(v === '1' ? 'leading-none' : v === 'normal' ? 'leading-[normal]' : `leading-[${twArb(v)}]`); return;
        case 'letter-spacing': add(v === 'normal' ? 'tracking-normal' : `tracking-[${twArb(v)}]`); return;
        case 'color': add(COLOR('text', v)); return;
        case 'background-color': add(COLOR('bg', v)); return;
        case 'text-decoration-color': add(COLOR('decoration', v)); return;
        case 'outline-color': add(COLOR('outline', v)); return;
        case 'text-decoration-thickness': add(v === 'auto' ? 'decoration-auto' : `decoration-[length:${twArb(v)}]`); return;
        case 'text-underline-offset': add(v === 'auto' ? 'underline-offset-auto' : `underline-offset-[${twArb(v)}]`); return;
        case 'outline-width': add(`outline-[length:${twArb(v)}]`); return;
        case 'outline-style': add(v === 'none' ? 'outline-none' : v === 'solid' ? 'outline' : `outline-${v}`); return;
        case 'outline-offset': add(`outline-offset-[${twArb(v)}]`); return;
        case 'opacity': { const n = Math.round(num(v) * 1000) / 10; add(Number.isInteger(n) && n % 5 === 0 ? `opacity-${n}` : `opacity-[${twArb(v)}]`); return; }
        case 'box-shadow': add(v === 'none' ? 'shadow-none' : `shadow-[${twArb(v)}]`); return;
        case 'aspect-ratio': add(/^1( \/ 1)?$/.test(v) ? 'aspect-square' : /^16 \/ 9$/.test(v) ? 'aspect-video' : v === 'auto' ? 'aspect-auto' : `aspect-[${twArb(v.replace(/\s/g, ''))}]`); return;
        case 'object-position': add(v === '50% 50%' ? 'object-center' : `object-[${twArb(v)}]`); return;
        case 'background-size': add(`bg-[length:${twArb(v)}]`); return;
        case 'background-position': add(v === '50% 50%' ? 'bg-center' : `bg-[position:${twArb(v)}]`); return;
        case 'background-image': add(v === 'none' ? 'bg-none' : `bg-[image:${twArb(v)}]`); return;
        case 'transform-origin': add(/^50% 50%( 0px)?$/.test(v) ? 'origin-center' : `origin-[${twArb(v)}]`); return;
        case 'cursor': add(/^(pointer|default|wait|text|move|help|not-allowed|none|grab|grabbing|auto|progress|cell|copy|zoom-in|zoom-out|col-resize|row-resize)$/.test(v) ? `cursor-${v}` : `cursor-[${twArb(v)}]`); return;
        case 'font-variant-numeric': add(v === 'tabular-nums' ? 'tabular-nums' : `[font-variant-numeric:${twArb(v)}]`); return;
        case 'fill': add(COLOR('fill', v)); return;
        case 'stroke': add(COLOR('stroke', v)); return;
        default: add(`[${k}:${twArb(v)}]`);
      }
    });
    return out;
  }

  window.DTExport = { build, prepare, forget, version: 2 };
})();
