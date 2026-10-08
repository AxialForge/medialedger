'use strict';
// Shared helpers for the three documents. Uses the `docx` package that the repository already has as a
// development dependency (it builds the in-repo manual too).
const fs = require('fs');
const path = require('path');
const REPO = path.resolve(__dirname, '..', '..', '..');
const D = require(path.join(REPO, 'node_modules', 'docx'));
const { Document, Packer, Paragraph, TextRun, HeadingLevel, ImageRun, Table, TableRow, TableCell, WidthType, AlignmentType, TableOfContents, LevelFormat, BorderStyle, ShadingType, Footer, Header, PageNumber, PageBreak, TableLayoutType } = D;

const F = 'Calibri';
const PAGE_W = 9360;           // usable width in twentieths of a point (6.5 inches)
const PX_W = 624, PX_H = 760;  // the same in pixels at 96 per inch, and the tallest picture that fits a page

// **bold** and `code` inline
function rich(t, o = {}) {
  return String(t == null ? '' : t).split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean).map(x => x.startsWith('**') ? new TextRun({ text: x.slice(2, -2), bold: true, ...o }) : x.startsWith('`') ? new TextRun({ text: x.slice(1, -1), font: 'Consolas', size: (o.size || 22) - 3, shading: { type: ShadingType.CLEAR, fill: 'EEF1F5' }, ...o, bold: false }) : new TextRun({ text: x, ...o }));
}
const H1 = (t, brk = true) => new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(t)], pageBreakBefore: brk });
const H2 = t => new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(t)], keepNext: true });
const H3 = t => new Paragraph({ heading: HeadingLevel.HEADING_3, children: [new TextRun(t)], keepNext: true });
const P = (t, o = {}) => new Paragraph({ spacing: { after: 120 }, children: rich(t, o) });
const note = t => new Paragraph({ spacing: { before: 60, after: 160 }, indent: { left: 360 }, border: { left: { style: BorderStyle.SINGLE, size: 12, color: '5AA9FF', space: 8 } }, children: rich(t) });
const warn = t => new Paragraph({ spacing: { before: 60, after: 160 }, indent: { left: 360 }, border: { left: { style: BorderStyle.SINGLE, size: 12, color: 'F0B429', space: 8 } }, children: rich(t) });
const code = t => String(t).split('\n').map((l, i, a) => new Paragraph({ spacing: { after: i === a.length - 1 ? 160 : 0 }, shading: { type: ShadingType.CLEAR, fill: 'F3F5F8' }, indent: { left: 200 }, children: [new TextRun({ text: l || ' ', font: 'Consolas', size: 18 })] }));
const bullets = arr => arr.map(t => new Paragraph({ numbering: { reference: 'bul', level: 0 }, spacing: { after: 60 }, children: rich(t) }));
let stepInstance = 0;
const steps = arr => { const inst = ++stepInstance; return arr.map(t => new Paragraph({ numbering: { reference: 'num', level: 0, instance: inst }, spacing: { after: 60 }, children: rich(t) })); };

function table(header, rows, widths, { size = 18, headFill = 'DDE6F2' } = {}) {
  const total = widths.reduce((a, b) => a + b, 0);
  const scale = PAGE_W / total; const w = widths.map(x => Math.round(x * scale));
  const cell = (t, i, bold, fill) => new TableCell({ width: { size: w[i], type: WidthType.DXA }, shading: fill ? { type: ShadingType.CLEAR, fill } : undefined, margins: { top: 50, bottom: 50, left: 80, right: 80 }, children: [new Paragraph({ children: rich(t, { bold, size }) })] });
  const mk = (cells, bold, fill, head) => new TableRow({ tableHeader: !!head, cantSplit: true, children: cells.map((c, i) => cell(c, i, bold, fill)) });
  return new Table({ width: { size: PAGE_W, type: WidthType.DXA }, columnWidths: w, layout: TableLayoutType.FIXED, rows: [mk(header, true, headFill, true), ...rows.map((r, k) => mk(r, false, k % 2 ? 'F7F9FC' : undefined))] });
}

/** PNG size from its header, so pictures keep their shape. */
function pngSize(file) { const b = fs.readFileSync(file); return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), data: b }; }
function picture(file, caption, { maxW = PX_W, maxH = PX_H } = {}) {
  if (!fs.existsSync(file)) return [new Paragraph({ children: [new TextRun({ text: `[picture missing: ${path.basename(file)}]`, italics: true, color: 'AA0000' })] })];
  const { w, h, data } = pngSize(file);
  const k = Math.min(maxW / w, maxH / h, 1.0 * maxW / Math.max(w, 1));
  const W = Math.round(w * k), H = Math.round(h * k);
  return [
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 120, after: 60 }, keepNext: true, children: [new ImageRun({ type: 'png', data, transformation: { width: W, height: H } })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 200 }, children: [new TextRun({ text: caption, italics: true, size: 18, color: '555555' })] }),
  ];
}

const numbering = { config: [
  { reference: 'bul', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 270 } } } }] },
  { reference: 'num', levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 360 } } } }] },
] };
const styles = { default: { document: { run: { font: F, size: 22 } } }, paragraphStyles: [
  { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 34, bold: true, color: '1F3864', font: F }, paragraph: { spacing: { before: 360, after: 160 }, outlineLevel: 0 } },
  { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 26, bold: true, color: '2E5597', font: F }, paragraph: { spacing: { before: 240, after: 100 }, outlineLevel: 1 } },
  { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 23, bold: true, color: '444444', font: F }, paragraph: { spacing: { before: 160, after: 80 }, outlineLevel: 2 } },
] };

function cover(title, subtitle, version, date, lines = []) {
  return [
    new Paragraph({ spacing: { before: 2600, after: 200 }, alignment: AlignmentType.LEFT, children: [new TextRun({ text: 'MediaLedger', size: 72, bold: true, color: '1F3864' })] }),
    new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: title, size: 44, color: '2E5597' })] }),
    new Paragraph({ spacing: { after: 900 }, children: [new TextRun({ text: subtitle, size: 24, color: '666666' })] }),
    table(['Version', 'Build date', 'Document date'], [[version, date.build, date.doc]], [3000, 3180, 3180], { size: 20 }),
    new Paragraph({ spacing: { before: 300 }, children: [] }),
    ...lines.map(l => P(l, { color: '555555', size: 20 })),
  ];
}
const toc = () => [new Paragraph({ heading: HeadingLevel.HEADING_1, pageBreakBefore: true, children: [new TextRun('Contents')] }), new TableOfContents('Contents', { hyperlink: true, headingStyleRange: '1-2' }), new Paragraph({ children: [new TextRun({ text: 'Page numbers are filled in when the document is opened in Word, or when it is exported.', italics: true, size: 16, color: '888888' })] })];

async function write(file, body, { title, header }) {
  const doc = new Document({
    creator: 'AxialForge', title, description: header, features: { updateFields: true }, styles, numbering,
    sections: [{
      properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1300, bottom: 1300, left: 1440, right: 1440 } } },
      headers: { default: new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: header, size: 16, color: '888888' })] })] }) },
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'Page ', size: 16, color: '888888' }), new TextRun({ children: [PageNumber.CURRENT], size: 16, color: '888888' }), new TextRun({ text: ' of ', size: 16, color: '888888' }), new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 16, color: '888888' })] })] }) },
      children: body.flat(Infinity).filter(Boolean),
    }],
  });
  const buf = await Packer.toBuffer(doc);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, buf);
  console.log('wrote', file, Math.round(buf.length / 1024) + ' KB');
}

module.exports = { REPO, H1, H2, H3, P, note, warn, code, bullets, steps, table, picture, cover, toc, write, rich, Paragraph, TextRun, PageBreak };
