# Vector PDF Design Guide (pdfmake)

A reusable recipe for the crisp, branded A4 business documents used in this
project (Packing List, Testing Report). Copy this into any React/JS project to
get the same look: a branded letterhead, a slim colour banner, clean bordered
tables, subtotals/totals, and a signature block — all as **true vector PDF**
(selectable text, real borders, tiny files), with **no server, no headless
Chrome, no LibreOffice**.

---

## 1. Why this stack

| | |
|---|---|
| **Engine** | [`pdfmake`](https://pdfmake.org) `^0.2.x` — declarative doc definition → vector PDF, runs 100% client-side in the browser. |
| **Not html2pdf / html2canvas** | Those rasterise the DOM to a JPEG and embed the image → blurry, heavy, non-selectable text. pdfmake draws real text + vector lines. |
| **Fonts** | Embedded TTFs in pdfmake's virtual file system (VFS). **Montserrat** (Regular + SemiBold) for everything; **Carlito** (Regular + Bold) — the OFL-licensed, metric-identical twin of **Calibri** — for dense data rows. |
| **Loading** | pdfmake + font files are **lazy-loaded** (`import()`), so ~2.5 MB of fonts never touch the initial app bundle — they load only when a PDF is first generated. |
| **Theming** | A single brand hex → a full 50–950 tint/shade ramp; the header band, section bands and totals use the 600/700 shades. |

Install:

```bash
npm install pdfmake            # ^0.2.x
npm install -D @types/pdfmake  # if TypeScript
```

---

## 2. Fonts

pdfmake ships Roboto by default. To use Montserrat + Carlito you embed the TTFs
as base64 in a VFS object and register a `fonts` map.

### 2.1 Why these fonts
- **Montserrat** — geometric, professional headings/body. SemiBold is used as the
  "bold" weight (softer than a true bold, reads well on headings).
- **Carlito** — **Calibri is proprietary and cannot be embedded.** Carlito is
  Google's OFL-licensed, *metric-compatible* clone — it looks like Calibri and is
  free to ship. Used on the item rows for a familiar spreadsheet feel.
- Both fonts include the **₹ (U+20B9)** glyph, so Indian Rupee renders correctly
  (standard PDF fonts like Helvetica do **not** — a common pdfmake gotcha).

### 2.2 Generating the VFS
Download static TTFs and base64 them into a module. Sources used here:
- Montserrat: `github.com/JulietaUla/Montserrat/…/fonts/ttf/Montserrat-{Regular,SemiBold}.ttf`
- Carlito: `github.com/google/fonts/…/ofl/carlito/Carlito-{Regular,Bold}.ttf`

```js
// scripts/gen-vfs.mjs — run once to produce src/assets/fontVfs.ts
import { writeFileSync } from 'node:fs';
const files = {
  'Montserrat-Regular.ttf':  'https://…/Montserrat-Regular.ttf',
  'Montserrat-SemiBold.ttf': 'https://…/Montserrat-SemiBold.ttf',
  'Carlito-Regular.ttf':     'https://…/Carlito-Regular.ttf',
  'Carlito-Bold.ttf':        'https://…/Carlito-Bold.ttf',
};
const vfs = {};
for (const [name, url] of Object.entries(files)) {
  const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
  vfs[name] = buf.toString('base64');          // sanity check: buf[0..3] === 00 01 00 00 for a TTF
}
writeFileSync('src/assets/fontVfs.ts', `export const fontVfs = ${JSON.stringify(vfs)};\n`);
```

### 2.3 Font registration + lazy loader

```ts
const FONTS = {
  Montserrat: { normal: 'Montserrat-Regular.ttf', bold: 'Montserrat-SemiBold.ttf',
                italics: 'Montserrat-Regular.ttf', bolditalics: 'Montserrat-SemiBold.ttf' },
  Carlito:    { normal: 'Carlito-Regular.ttf', bold: 'Carlito-Bold.ttf',
                italics: 'Carlito-Regular.ttf', bolditalics: 'Carlito-Bold.ttf' },
};

let _pdfMake: any = null;
async function loadPdfMake() {
  if (_pdfMake) return _pdfMake;
  const [mod, fonts] = await Promise.all([
    import('pdfmake/build/pdfmake'),
    import('@/assets/fontVfs'),
  ]);
  const pdfMake = mod.default ?? mod;
  pdfMake.vfs = { ...fonts.fontVfs };   // filename → base64
  pdfMake.fonts = FONTS;
  return (_pdfMake = pdfMake);
}
```

> **VFS import shape varies by version.** With a plain `module.exports = {…}` VFS,
> a dynamic `import()` puts it on `.default`. If you use pdfmake's bundled
> `vfs_fonts`, tolerate all shapes: `mod.default?.pdfMake?.vfs ?? mod.pdfMake?.vfs ?? mod.default ?? mod`.

---

## 3. Design tokens

### 3.1 Page

```ts
const doc = {
  pageSize: 'A4',
  pageMargins: [24, 22, 24, 28],                         // L, T, R, B (pt)
  defaultStyle: { font: 'Montserrat', fontSize: 9, color: '#0f172a', lineHeight: 1.05 },
};
```
Usable content width on A4 = `595.28 − 24 − 24 ≈ 547 pt` (used for the full-width rule and column math).

### 3.2 Neutral palette

| Token | Hex | Use |
|-------|-----|-----|
| `WHITE` | `#ffffff` | text on brand bands |
| `INK`   | `#0f172a` | primary text (company name, totals) |
| `GREY`  | `#475569` | secondary text (address, labels, captions) |
| `LIGHT` | `#e2e8f0` | table gridlines + core-total fill |
| zebra-1 | `#f1f5f9` | grade sub-header fill |
| zebra-2 | `#f8fafc` | subtotal-row fill |

### 3.3 Brand ramp (one hex → 50…950)

The brand colour is a single hex; a ramp function mixes it toward white (light
stops) and black (dark stops). The document uses **700** (`brandDark`) for the
banner/section bands/grand total, **600** (`brandMid`) for column headers, and
**50** (`brandLight`) for info-label backgrounds.

```ts
const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
const hexToRgb = (h: string) => { const i = parseInt(h.replace('#',''),16); return { r:(i>>16)&255, g:(i>>8)&255, b:i&255 }; };
const toHex = ({r,g,b}) => '#' + [r,g,b].map(n => clamp(n).toString(16).padStart(2,'0')).join('');
const mix = (b, t: number) => { const T = t>=0?255:0, f = Math.abs(t); return { r:b.r+(T-b.r)*f, g:b.g+(T-b.g)*f, b:b.b+(T-b.b)*f }; };
const STOPS: Record<number, number> = { 50:.92, 100:.82, 200:.65, 300:.45, 400:.22, 500:0, 600:-.15, 700:-.32, 800:-.45, 900:-.65, 950:-.78 };
export const brandShade = (hex = '#22c55e', stop = 500) => toHex(mix(hexToRgb(hex), STOPS[stop] ?? 0));
```

Example (`#1560e6` electric blue): `700 → #0e419c`, `600 → #1252c4`, `50 → #ecf2fd`.

### 3.4 Font-size reference (the whole point of the "beautiful" look)

| Element | Size (pt) | Weight | Colour | Notes |
|---|---|---|---|---|
| Company name | **16** | bold | INK | letterhead heading |
| Address / Contact / GSTIN | **9** | reg | GREY | `Contact:` prefix bold |
| **Title banner** ("PACKING LIST") | **17** | bold | WHITE on `brand-700` | `characterSpacing: 1.2`, padding `[18,7,18,7]` |
| Brand rule under header | line `1.4` | — | `brand-700` | full width (x2 = 547) |
| Info-grid label | **9** | bold | GREY on `brand-50` | e.g. CUSTOMER, WO NO. |
| Info-grid value | **9.5** | bold | INK | |
| Section band ("TOROIDAL CORES") | **10** | bold | WHITE on `brand-700` | `characterSpacing: 1` |
| Table column headers | **9** | bold | WHITE on `brand-600` | |
| **Item rows** | **10** | reg | INK, **font: Carlito** | a touch smaller than headings |
| Grade sub-header | **8.5** | bold | GREY on `#f1f5f9` | |
| Grade subtotal | **9** label / **10** values | bold | GREY on `#f8fafc` | |
| Core-type total | **10** label / **11** values | bold | INK on `#e2e8f0` | |
| Grand-total strip | **12** label / **15** values | bold | WHITE on `brand-700` | |
| Signature label / name / caption | **8** / **10** / **7.5** | bold/bold/reg | GREY/INK/GREY | ruled line under name |
| Footer (company · page x/y) | **7** | reg | GREY | on every page |

Table gridlines: `hLineWidth/vLineWidth: 0.4`, colour `LIGHT`; cell padding `~3 / 2.5`.

---

## 4. Building blocks (copy-paste)

All helpers take `brandDark = brandShade(brand,700)` etc. `brand` is your company/theme hex.

### 4.1 Header — letterhead + slim banner + vertically-centred logo

The banner uses a **`columns`** layout, *not* a 2-cell table row — a table cell
stretches to the tallest cell (making a tall block), whereas columns are
independent heights, so the banner stays a slim band.

```ts
const header = (company, title, brandDark) => {
  const info: any[] = [{ text: company.name, bold: true, fontSize: 16, color: INK, characterSpacing: 0.3 }];
  if (company.address) info.push({ text: company.address.replace(/\n+/g, ', '), fontSize: 9, color: GREY, margin: [0,2,0,0] });
  const contact = [company.phone, company.email].filter(Boolean).join('  |  ');
  if (contact) info.push({ text: [{ text: 'Contact: ', bold: true }, contact], fontSize: 9, color: GREY, margin: [0,1,0,0] });
  if (company.gstNumber) info.push({ text: `GSTIN: ${company.gstNumber}`, fontSize: 9, color: GREY, margin: [0,1,0,0] });

  const LOGO = 46;
  const textH = 20 + (info.length - 1) * 12;                 // approx text-block height
  const logoTop = Math.max(0, Math.round((textH - LOGO) / 2)); // nudge logo to vertical centre

  const left = company.logoUrl
    ? { width: '*', columns: [
        { image: company.logoUrl, width: LOGO, fit: [LOGO, LOGO], margin: [0, logoTop, 0, 0] },
        { width: '*', stack: info, margin: [8,0,0,0] },
      ] }
    : { width: '*', stack: info };

  const banner = { width: 'auto',
    table: { widths: ['auto'], body: [[
      { text: title, alignment: 'center', color: WHITE, bold: true, fontSize: 17,
        characterSpacing: 1.2, fillColor: brandDark, margin: [18,7,18,7] } ]] },
    layout: noBorders(0) };

  return { columns: [left, banner], columnGap: 12, margin: [0,0,0,6] };
};

const noBorders = (pad = 0) => ({ hLineWidth:()=>0, vLineWidth:()=>0,
  paddingLeft:()=>pad, paddingRight:()=>pad, paddingTop:()=>pad, paddingBottom:()=>pad });

const rule = (brandDark) => ({ canvas: [{ type:'line', x1:0,y1:0,x2:547,y2:0, lineWidth:1.4, lineColor:brandDark }], margin:[0,0,0,6] });
```

### 4.2 Info grid — 2-up label/value

```ts
const infoGrid = (pairs: [string,string][], brandLight) => {
  const body: any[] = [];
  for (let i = 0; i < pairs.length; i += 2) {
    const a = pairs[i], b = pairs[i+1] ?? ['',''];
    body.push([
      { text: a[0], bold: true, fontSize: 9, color: GREY, fillColor: brandLight },
      { text: a[1] || '—', fontSize: 9.5, bold: true },
      { text: b[0], bold: true, fontSize: 9, color: GREY, fillColor: brandLight },
      { text: b[1] || '—', fontSize: 9.5, bold: true },
    ]);
  }
  return { table: { widths: [70,'*',70,'*'], body },
    layout: { hLineWidth:()=>0.5, vLineWidth:()=>0.5, hLineColor:()=>LIGHT, vLineColor:()=>LIGHT,
              paddingLeft:()=>5, paddingRight:()=>5, paddingTop:()=>3, paddingBottom:()=>3 },
    margin: [0,0,0,8] };
};
```

### 4.3 Data table — section band, headers, Carlito rows, subtotals, total

Build the whole group as one table `body` so borders line up. Use `colSpan`
(followed by empty `{}` placeholders to fill the row) for band/subtotal rows.

```ts
const COLS = [20, 74, 62, '*', 42, 66, 66];                  // fixed pt + one '*' flexible
const th = (t, align = 'center') => ({ text: t, bold: true, fontSize: 9, color: WHITE, fillColor: brandMid, alignment: align });
const rc = (t, align = 'center') => ({ text: t, alignment: align, font: 'Carlito', fontSize: 10 });  // data cell

const body: any[] = [];
body.push([{ text: 'TOROIDAL CORES', colSpan: 7, bold: true, color: WHITE, fillColor: brandDark, fontSize: 10, characterSpacing: 1, margin: [2,3,2,3] }, {},{},{},{},{},{}]);
body.push([th('SR'), th('PO NO'), th('PO DATE'), th('ITEM DESCRIPTION','left'), th('QTY (PCS)'), th('WT (KG)'), th('REMARKS','left')]);
rows.forEach((r, i) => body.push([ rc(String(i+1)), rc(r.poNo), rc(r.poDate), rc(r.description,'left'), rc(r.qty), rc(r.weight,'right'), rc(r.remarks,'left') ]));
body.push([{ text: 'TOROIDAL CORES Total', colSpan: 4, alignment: 'right', bold: true, fontSize: 10, color: INK, fillColor: '#e2e8f0', margin:[2,3,2,3] }, {},{},{},
  { text: String(totalPcs), alignment:'center', bold:true, fontSize:11, fillColor:'#e2e8f0' },
  { text: totalWt.toFixed(3), alignment:'right', bold:true, fontSize:11, fillColor:'#e2e8f0' },
  { text:'', fillColor:'#e2e8f0' }]);

const table = { table: { headerRows: 0, widths: COLS, dontBreakRows: true, body },
  layout: { hLineWidth:()=>0.4, vLineWidth:()=>0.4, hLineColor:()=>LIGHT, vLineColor:()=>LIGHT,
            paddingLeft:()=>3, paddingRight:()=>3, paddingTop:()=>2.5, paddingBottom:()=>2.5 },
  margin: [0,0,0,6] };
```

### 4.4 Grand-total strip + signatures + footer

```ts
const grandTotal = (pcs, kg, brandDark) => ({
  table: { widths: ['*','auto','auto'], body: [[
    { text: 'GRAND TOTAL', color: WHITE, bold: true, fontSize: 12, characterSpacing: 1, fillColor: brandDark, margin: [6,7,6,7] },
    { text: `${pcs} pcs`, color: WHITE, bold: true, fontSize: 15, alignment: 'right', fillColor: brandDark, margin: [6,6,12,6] },
    { text: `${kg.toFixed(3)} kg`, color: WHITE, bold: true, fontSize: 15, alignment: 'right', fillColor: brandDark, margin: [6,6,6,6] },
  ]] }, layout: noBorders(0), margin: [0,2,0,0],
});

const sigCol = (label, name, date) => ({ stack: [
  { text: label, bold: true, fontSize: 8, color: GREY },
  { text: name || ' ', fontSize: 10, bold: true, margin: [0,14,0,2] },
  { canvas: [{ type:'line', x1:0,y1:0,x2:220,y2:0, lineWidth:0.5, lineColor:GREY }] },
  { text: 'Name & Signature', fontSize: 7.5, color: GREY, margin: [0,2,0,0] },
  { text: `Date: ${date || '____________'}`, fontSize: 7.5, color: GREY, margin: [0,3,0,0] },
]});

const footer = (company) => (page, total) => ({ margin: [24,6,24,0], columns: [
  { text: company.name, fontSize: 7, color: GREY },
  { text: `Page ${page} of ${total}`, alignment: 'right', fontSize: 7, color: GREY },
]});
```

### 4.5 Output

```ts
export async function downloadPdf(docDefinition, filename) {
  (await loadPdfMake()).createPdf(docDefinition).download(filename);
}
export async function pdfBlob(docDefinition): Promise<Blob> {           // for share / upload
  const pm = await loadPdfMake();
  return new Promise(res => pm.createPdf(docDefinition).getBlob(res));
}
```

---

## 5. Complete self-contained sample

Drop this in, call `downloadPdf(buildSample(), 'sample.pdf')`. Uses the helpers above.

```ts
const WHITE='#ffffff', INK='#0f172a', GREY='#475569', LIGHT='#e2e8f0';

const SAMPLE = {
  company: {
    name: 'ACME ELECTRICAL INDUSTRIES',
    address: 'Plot 12, Industrial Estate, Pune - 411001',
    phone: '+91 90000 00000', email: 'sales@acme.example', gstNumber: '27ABCDE1234F1Z5',
    logoUrl: null,                                   // or a data: URL
  },
  brand: '#1560e6',                                  // ← your brand hex
  meta: { customer: 'BEST MOTORS PVT LTD', state: 'MAHARASHTRA',
          woNo: 'ACWO-014', woDate: '19/07/2026', invoiceNo: 'INV-231', invoiceDate: '20/07/2026' },
  rows: [
    { sr:1, poNo:'PO-4540', poDate:'07/07/2026', description:'TC-100 x 175 x 30 / M4', qty:'6',  weight:'21.300', remarks:'' },
    { sr:2, poNo:'PO-4528', poDate:'03/07/2026', description:'TC-90 x 165 x 30 / M4',  qty:'30', weight:'79.400', remarks:'' },
    { sr:3, poNo:'PO-4527', poDate:'03/07/2026', description:'TC-125 x 148 x 40 / M4', qty:'12', weight:'17.200', remarks:'QC ok' },
  ],
};

function buildSample() {
  const brandDark = brandShade(SAMPLE.brand, 700);
  const brandMid  = brandShade(SAMPLE.brand, 600);
  const brandLight= brandShade(SAMPLE.brand, 50);
  const th = (t, a='center') => ({ text:t, bold:true, fontSize:9, color:WHITE, fillColor:brandMid, alignment:a });
  const rc = (t, a='center') => ({ text:t, alignment:a, font:'Carlito', fontSize:10 });

  const totalPcs = SAMPLE.rows.reduce((s,r)=>s+ +r.qty, 0);
  const totalWt  = SAMPLE.rows.reduce((s,r)=>s+ +r.weight, 0);

  const body: any[] = [
    [{ text:'TOROIDAL CORES', colSpan:7, bold:true, color:WHITE, fillColor:brandDark, fontSize:10, characterSpacing:1, margin:[2,3,2,3] },{},{},{},{},{},{}],
    [th('SR'),th('PO NO'),th('PO DATE'),th('ITEM DESCRIPTION','left'),th('QTY (PCS)'),th('WT (KG)'),th('REMARKS','left')],
    ...SAMPLE.rows.map(r => [rc(String(r.sr)),rc(r.poNo),rc(r.poDate),rc(r.description,'left'),rc(r.qty),rc(r.weight,'right'),rc(r.remarks,'left')]),
    [{ text:'TOROIDAL CORES Total', colSpan:4, alignment:'right', bold:true, fontSize:10, color:INK, fillColor:'#e2e8f0', margin:[2,3,2,3] },{},{},{},
     { text:String(totalPcs), alignment:'center', bold:true, fontSize:11, fillColor:'#e2e8f0' },
     { text:totalWt.toFixed(3), alignment:'right', bold:true, fontSize:11, fillColor:'#e2e8f0' },
     { text:'', fillColor:'#e2e8f0' }],
  ];

  return {
    pageSize: 'A4', pageMargins: [24,22,24,28],
    defaultStyle: { font: 'Montserrat', fontSize: 9, color: INK, lineHeight: 1.05 },
    footer: footer(SAMPLE.company),
    content: [
      header(SAMPLE.company, 'PACKING LIST', brandDark),
      rule(brandDark),
      infoGrid([['CUSTOMER',SAMPLE.meta.customer],['STATE',SAMPLE.meta.state],
                ['WO NO.',SAMPLE.meta.woNo],['WO DATE',SAMPLE.meta.woDate],
                ['INVOICE NO.',SAMPLE.meta.invoiceNo],['INVOICE DATE',SAMPLE.meta.invoiceDate]], brandLight),
      { table: { headerRows:0, widths:[20,74,62,'*',42,66,66], dontBreakRows:true, body },
        layout: { hLineWidth:()=>0.4, vLineWidth:()=>0.4, hLineColor:()=>LIGHT, vLineColor:()=>LIGHT,
                  paddingLeft:()=>3, paddingRight:()=>3, paddingTop:()=>2.5, paddingBottom:()=>2.5 }, margin:[0,0,0,6] },
      grandTotal(totalPcs, totalWt, brandDark),
      { columns: [ sigCol('TESTED BY','SANTOSH SINGH','19/07/2026'),
                   sigCol('APPROVED BY','MAULIK PATEL','19/07/2026') ],
        columnGap: 20, margin: [0,10,0,0] },
    ],
  };
}
```

Resulting page, top-to-bottom: **logo + dark company name / grey contact lines** on the
left, a **slim brand-coloured "PACKING LIST" banner** on the right, a brand rule, a
**2-up info grid**, a **bordered items table** with a brand section band + column
header row + Carlito data rows + a light-grey total row, a **brand grand-total
strip**, then two **signature columns**, with a **company · page x/y footer** on
every page.

---

## 6. Multi-page & grouping notes

- **`dontBreakRows: true`** on a table keeps a single row from splitting across a page; the table itself still flows onto the next page automatically.
- For "one section per page" (e.g. Testing Report per PO), push `{ text: '', pageBreak: 'before' }` before each group after the first.
- The `footer` is a function `(currentPage, pageCount) => ({...})` — it repeats on every page.
- Logos are passed as **data URLs** (`data:image/png;base64,…`); pdfmake embeds them directly.

---

## 7. Per-brand / multi-tenant theming

Keep the whole palette as one hex and derive everything with `brandShade()`:

- Pick the hex from the **active company / domain** (e.g. map company name → hex,
  or read a saved setting). Pass it as `brand` into the builder.
- The document only ever references `brandShade(brand, 50|600|700)`, so a new brand
  is a one-line change and the ramp stays harmonious.
- Same hex can drive the app UI via CSS variables (`--brand-500: r g b`) so screen
  and PDF match.

---

## 8. Gotchas checklist

- [ ] **₹ / non-Latin glyphs** need a font that has them → Montserrat/Carlito do; Helvetica/Times don't.
- [ ] **Calibri can't be embedded** (proprietary) → use **Carlito**.
- [ ] **Banner rendering tall?** You used a table row (cells stretch to row height). Use a `columns` layout so the banner is only as tall as its text.
- [ ] **colSpan rows** must be padded with empty `{}` cells to the full column count.
- [ ] **Rounded corners** aren't supported on table cells — either accept square, or draw a `canvas` `rect` with `r` and overlay text (harder; needs known width).
- [ ] **Lazy-load** pdfmake + fonts (`import()`) so the ~2.5 MB of TTFs stay out of the main bundle.
- [ ] **Verify in Node** without a browser: `new (require('pdfmake/src/printer'))(fontsWithBuffers).createPdfKitDocument(dd)` → pipe to a buffer; catches layout throws in CI.
- [ ] **VFS export shape** differs across pdfmake versions — normalise with a `??` chain.
- [ ] Column widths: mix fixed `pt` numbers with a single `'*'` for the flexible column; total fixed must leave room on the 547 pt usable width.

---

*Reference implementation in this repo: `client/src/lib/reportPdf.ts` (builders),
`client/src/assets/montserratVfs.ts` + `carlitoVfs.ts` (fonts),
`client/src/lib/brandColor.ts` (`brandShadeHex` / `brandRamp` — this guide calls it `brandShade`).*
