'use strict';
// Renders a Mermaid file to PNG with the mermaid package, inside an offscreen Electron window.
//   npx electron docs/_tools/release-docs/render-mermaid.js <in.mmd> <out.png>
const { app, BrowserWindow } = require('electron');
const fs = require('fs'); const path = require('path');
const [src, out] = process.argv.slice(-2).map(p => path.resolve(p));
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('force-device-scale-factor', '2');
app.whenReady().then(async () => {
  const lib = path.join(__dirname, 'node_modules', 'mermaid', 'dist', 'mermaid.min.js');
  const html = path.join(app.getPath('temp'), 'mermaid-render.html');
  fs.writeFileSync(html, `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#fff;font-family:Segoe UI,Arial,sans-serif"><div id="g" style="padding:24px;display:inline-block"></div><script src="file:///${lib.split(path.sep).join('/')}"></script>`);
  const win = new BrowserWindow({ width: 1800, height: 1400, show: false, enableLargerThanScreen: true, webPreferences: { offscreen: true } });
  await win.loadFile(html);
  const size = await win.webContents.executeJavaScript(`(async () => { mermaid.initialize({ startOnLoad: false, theme: 'neutral', flowchart: { htmlLabels: true, curve: 'basis', nodeSpacing: 34, rankSpacing: 54 }, themeVariables: { fontSize: '15px' } }); const { svg } = await mermaid.render('d', ${JSON.stringify(fs.readFileSync(src, 'utf8'))}); const g = document.getElementById('g'); g.innerHTML = svg; const s = g.querySelector('svg'); s.style.maxWidth = 'none'; const b = s.getBBox(); s.setAttribute('width', Math.ceil(b.width + 20)); s.setAttribute('height', Math.ceil(b.height + 20)); await new Promise(r => setTimeout(r, 400)); const r = g.getBoundingClientRect(); return { w: Math.ceil(r.width), h: Math.ceil(r.height) }; })()`);
  win.setContentSize(Math.min(size.w, 4000), Math.min(size.h, 4000));
  await new Promise(r => setTimeout(r, 700));
  const img = await win.webContents.capturePage();
  fs.writeFileSync(out, img.toPNG());
  console.log('rendered', out, JSON.stringify(img.getSize()));
  app.exit(0);
}).catch(e => { console.error(e); app.exit(1); });
