<div align="center">
  <img src="pixellens/icons/icon128.png" width="96" alt="PixelLens logo" />
  <h1>PixelLens</h1>
  <p><strong>A closer look at the web.</strong><br />Inspect layouts. Measure spacing. Explore colors. Export sections.</p>
  <p>
    <img src="https://img.shields.io/badge/version-1.3.9-d4af37" alt="Version 1.3.9" />
    <img src="https://img.shields.io/badge/Manifest-V3-202020" alt="Manifest V3" />
    <img src="https://img.shields.io/badge/Chrome-110%2B-4285F4" alt="Chrome 110+" />
    <img src="https://img.shields.io/badge/build-local-202020" alt="Local build" />
  </p>
  <p>Personal customization by <a href="https://github.com/yousefdiab611">Yousef Diab</a></p>
  <p><a href="#العربية">العربية</a> · <a href="#installation">Installation</a> · <a href="#keyboard-shortcuts">Shortcuts</a> · <a href="#permissions--network-behavior">Permissions</a></p>
</div>

---

PixelLens is a locally loaded browser extension for exploring the visual details of a webpage from a floating toolbar. This repository contains the customized **1.3.9** build and its source files; no build step or package installation is required.

## What you can do

| Tool | Use it to |
| --- | --- |
| Element inspector | Read dimensions, margin, padding, borders and computed styles. |
| Measurements | Check distances between elements and use page rulers. |
| Color tools | Pick colors and extract palettes from images. |
| Typography | Inspect font families, sizes, weights and spacing. |
| Responsive preview | Compare layouts in multiple viewport sizes. |
| Section export | Generate HTML/CSS, Tailwind, React, Vue or Elementor output from a selected section. |
| Animation inspector | Explore animation timing and easing. |
| Page audit & assets | Inspect metadata, page weight and discover downloadable assets. |

Exports are a starting point: review the generated code and reconnect application logic yourself. A visual export does not reproduce the original site's backend or behavior.

## Installation

### Download ZIP

1. Choose **Code → Download ZIP** on this repository and extract it to a permanent folder.
2. Open `chrome://extensions` in Chrome or `edge://extensions` in Edge.
3. Enable **Developer mode** and choose **Load unpacked**.
4. Select the **`pixellens/` subfolder** containing `manifest.json` — not the repository root.
5. Open a regular website, pin PixelLens from the extensions menu, then click its icon.

The manifest requires Chrome **110+**. Edge is also a load-unpacked target; browser-specific behavior should be checked in your installed version.

### Clone with Git

```sh
git clone https://github.com/yousefdiab611/pixellens.git
cd pixellens
```

Load the inner `pixellens/` directory using the steps above.

## Quick start

1. Open the toolbar on a webpage with the extension icon or **Alt+R**.
2. Use the inspector to explore an element's dimensions and styling.
3. Switch tools to measure spacing, inspect type or sample colors.
4. Select a section and choose an export format when you need a code reference.
5. Close the toolbar using the extension icon or **Alt+R** again.

## Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| `Alt+R` | Toggle PixelLens. |
| `Alt+I` | Activate the inspector. |
| `Alt+M` | Activate distance measurement. |

These are the manifest's suggested shortcuts. Browser or operating-system conflicts may override them; adjust assignments at `chrome://extensions/shortcuts` or `edge://extensions/shortcuts`.

## Permissions & network behavior

| Permission | Why it is used |
| --- | --- |
| `activeTab` | Access the tab after you invoke the extension. |
| `scripting` | Inject the inspector scripts and styles on demand. |
| `storage` | Save preferences and temporary permission/download state. |
| `declarativeNetRequestWithHostAccess` | Support responsive framing through temporary response-header rules. |
| `downloads` — optional | Save assets after you approve the download permission. |
| HTTP/HTTPS host access — optional | Read external stylesheets from origins you approve. |

Responsive mode can temporarily remove frame-blocking response headers, including CSP, from subframe responses in the requesting tab. The worker removes its session rule when responsive mode closes or the tab is removed.

The inspector runs in the browser. Asset downloads, external stylesheets and fonts can make network requests; exported previews may reference external resources such as Google Fonts or the Tailwind CDN. This is not a guarantee of fully offline operation.

## Project layout

```text
pixellens/
├── manifest.json       # Extension metadata, permissions and shortcuts
├── background.js       # Service worker, injection and permission handling
├── content.js          # Inspector UI and tools
├── content.css         # Toolbar, panels and overlays
├── export.js           # Section-to-code export logic
├── grant.html / .js    # Optional download permission flow
├── styles.html / .js   # Optional stylesheet-origin permission flow
├── welcome.html        # Local installation welcome page
├── README.txt          # Original local-build notes
└── icons/              # Extension icons and master artwork
```

## Development

Edit files inside `pixellens/`, click **Reload** on the extension card, then refresh your test webpage and reopen PixelLens. There is no bundler or dependency install step.

For a JavaScript syntax check with Node.js installed:

```sh
for file in pixellens/*.js; do
  node --check "$file" || exit 1
done
```

This checks syntax only. Verify the actual inspector, permissions and exports in a browser before shipping changes.

## Troubleshooting

- **Nothing opens:** switch to a regular HTTP/HTTPS webpage. Browser settings pages and extension stores restrict script injection.
- **Changes do not appear:** reload the extension, refresh the webpage and reopen the toolbar.
- **Missing styles in exports:** approve the requested stylesheet origins, then retry. Site restrictions can still limit extraction.
- **Downloads do not start:** complete the optional download permission prompt and retry.
- **A preview is incomplete:** embedded content, site behavior and unavailable assets can affect responsive previews and exports.

## العربية

**PixelLens — عدسة التصميم** إضافة لفحص تفاصيل واجهات الويب: المقاسات والمسافات والألوان والخطوط، مع معاينة أحجام الشاشات وتصدير أجزاء من الصفحة ككود.

### التثبيت السريع

1. نزّل المشروع من **Code → Download ZIP** وفك الضغط في مكان ثابت.
2. افتح `chrome://extensions` أو `edge://extensions`.
3. فعّل **Developer mode** واضغط **Load unpacked**.
4. اختَر مجلد **`pixellens` الداخلي** الذي يحتوي على `manifest.json`.
5. افتح موقعًا عاديًا واضغط أيقونة الإضافة أو **Alt+R**.

استخدم **Alt+I** للفحص و**Alt+M** لقياس المسافات. التصدير نقطة بداية تحتاج مراجعة؛ لا ينقل منطق التطبيق أو الخادم. بعض أدوات التصدير والتنزيل تطلب صلاحيات إضافية عند استخدامها.

للتحديث بعد تعديل الملفات: اضغط **Reload** من صفحة الإضافات، ثم حدّث صفحة الموقع. الإضافة لا تعمل داخل صفحات إعدادات المتصفح ومتاجر الإضافات.

## Attribution & rights

This is a personal, modified build derived from **Design Toolkit — Element Inspector & Measurement 1.3.0**. The original tools and assets remain part of this codebase; it is not presented as an independently authored implementation. See the bundled [local-build notes](pixellens/README.txt).

The bundled notes describe a local build without automatic updates, activation or a trial period. Publishing this repository does not grant a license to the original work. No open-source license is asserted here; original code and assets remain subject to their respective rights holders.

هذه نسخة محلية معدّلة، والأدوات والأصول الأصلية محفوظة. وجود الملفات هنا لا يمنح ترخيصًا لإعادة استخدام العمل الأصلي أو توزيعه.
