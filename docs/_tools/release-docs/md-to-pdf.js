'use strict';
// Markdown to PDF through Electron's own printing. Handles what the developer guide uses: headings, paragraphs,
// fenced code, tables, numbered and bulleted lists, bold, inline code and links. Adds a header, page numbers and
// a contents list built from the headings.
//   npx electron docs/_tools/release-docs/md-to-pdf.js <in.md> <out.pdf> "<header text>"
const { app, BrowserWindow } = require('electron');
const fs = require('fs'); const path = require('path');
const [src, out, header] = process.argv.slice(-3);
const esc = (s) => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const inline = (s) => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2">$1</a>');

function toHtml(md) {
  const L = md.split(/\r?\n/); const h = []; const toc = []; let i = 0, n = 0;
  while (i < L.length) {
    const l = L[i];
    if (/^```/.test(l)) { const b = []; i++; while (i < L.length && !/^```/.test(L[i])) b.push(L[i++]); i++; h.push('<pre>' + esc(b.join('\n')) + '</pre>'); continue; }
    const m = /^(#{1,4}) (.+)/.exec(l);
    if (m) { const lv = m[1].length, id = 'h' + (++n); if (lv >= 2 && lv <= 3) toc.push({ lv, id, text: m[2] }); h.push(`<h${lv} id="${id}">${inline(m[2])}</h${lv}>`); i++; continue; }
    if (/^\|/.test(l) && /^\|[-| :]+\|$/.test(L[i + 1] || '')) {
      const cells = (r) => r.replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map(c => c.trim().replace(/\\\|/g, '|'));
      const head = cells(l); i += 2; const rows = []; while (i < L.length && /^\|/.test(L[i])) rows.push(cells(L[i++]));
      h.push('<table><thead><tr>' + head.map(c => '<th>' + inline(c) + '</th>').join('') + '</tr></thead><tbody>' + rows.map(r => '<tr>' + r.map(c => '<td>' + inline(c) + '</td>').join('') + '</tr>').join('') + '</tbody></table>'); continue;
    }
    if (/^\d+\. /.test(l)) { const b = []; while (i < L.length && /^\d+\. /.test(L[i])) b.push(L[i++].replace(/^\d+\. /, '')); h.push('<ol>' + b.map(x => '<li>' + inline(x) + '</li>').join('') + '</ol>'); continue; }
    if (/^- /.test(l)) { const b = []; while (i < L.length && /^- /.test(L[i])) b.push(L[i++].slice(2)); h.push('<ul>' + b.map(x => '<li>' + inline(x) + '</li>').join('') + '</ul>'); continue; }
    if (!l.trim()) { i++; continue; }
    const p = []; while (i < L.length && L[i].trim() && !/^(#{1,4} |```|\||- |\d+\. )/.test(L[i])) p.push(L[i++]);
    h.push('<p>' + inline(p.join(' ')) + '</p>');
  }
  const first = h.findIndex(x => x.startsWith('<h2'));
  const contents = '<div class="toc"><h2 class="notoc">Contents</h2>' + toc.map(t => `<div class="t${t.lv}"><a href="#${t.id}">${inline(t.text)}</a></div>`).join('') + '</div>';
  h.splice(first < 0 ? h.length : first, 0, contents);
  return h.join('\n');
}
const css = `@page { size: Letter; margin: 22mm 18mm 20mm 18mm; } body { font: 10.5pt/1.45 Calibri, 'Segoe UI', Arial, sans-serif; color: #1b1b1b; }
h1 { font-size: 24pt; color: #1F3864; margin: 0 0 6pt; } h2 { font-size: 16pt; color: #1F3864; margin: 22pt 0 6pt; page-break-before: always; border-bottom: 1px solid #c9d3e3; padding-bottom: 3pt; } h2.notoc { page-break-before: avoid; }
h3 { font-size: 12.5pt; color: #2E5597; margin: 14pt 0 4pt; page-break-after: avoid; } h4 { font-size: 11pt; color: #333; margin: 12pt 0 2pt; page-break-after: avoid; font-family: Consolas, monospace; }
p { margin: 0 0 6pt; } code { font: 9pt Consolas, monospace; background: #eef1f5; padding: 0 2px; border-radius: 2px; } pre { font: 8.6pt/1.35 Consolas, monospace; background: #f3f5f8; border: 1px solid #dde3ec; padding: 7pt 9pt; white-space: pre-wrap; word-break: break-word; page-break-inside: avoid; }
table { border-collapse: collapse; width: 100%; margin: 4pt 0 10pt; font-size: 9pt; } th { background: #dde6f2; text-align: left; } th, td { border: 1px solid #c4ccd8; padding: 3pt 5pt; vertical-align: top; word-break: break-word; } tr { page-break-inside: avoid; } tbody tr:nth-child(even) td { background: #f7f9fc; }
ol, ul { margin: 0 0 6pt 18pt; padding: 0; } li { margin-bottom: 2pt; } a { color: #2E5597; text-decoration: none; }
.toc { page-break-after: always; } .toc .t2 { margin-top: 5pt; font-weight: 600; } .toc .t3 { margin-left: 16pt; font-size: 9.5pt; }`;

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const html = path.join(app.getPath('temp'), 'md-to-pdf.html');
  fs.writeFileSync(html, `<!doctype html><meta charset="utf-8"><title>${esc(header)}</title><style>${css}</style><body>${toHtml(fs.readFileSync(path.resolve(src), 'utf8'))}</body>`);
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  await win.loadFile(html);
  const pdf = await win.webContents.printToPDF({ printBackground: true, pageSize: 'Letter', displayHeaderFooter: true, margins: { top: 0.85, bottom: 0.8, left: 0.7, right: 0.7 },
    headerTemplate: `<div style="font:8px Calibri,Arial;color:#888;width:100%;text-align:right;padding-right:48px">${esc(header)}</div>`,
    footerTemplate: '<div style="font:8px Calibri,Arial;color:#888;width:100%;text-align:center">Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>' });
  fs.writeFileSync(path.resolve(out), pdf);
  console.log('wrote', path.resolve(out), Math.round(pdf.length / 1024) + ' KB');
  app.exit(0);
}).catch(e => { console.error(e); app.exit(1); });
