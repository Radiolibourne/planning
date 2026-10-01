// ---------------------------------------------------------------- Écriture XLSX minimale (styles, formules, mises en forme conditionnelles)
const xesc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

class XStyles {
  constructor() {
    this.fonts = ['<font><sz val="10"/><name val="Arial"/></font>'];
    this.fills = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>'];
    this.borders = ["<border><left/><right/><top/><bottom/><diagonal/></border>"];
    this.numFmts = [];
    this.xfs = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'];
    this.dxfs = [];
    this.cache = new Map();
    this.idx = { font: new Map(), fill: new Map(), border: new Map(), num: new Map() };
  }
  _get(kind, key, list, xml) {
    const m = this.idx[kind];
    if (!m.has(key)) { list.push(xml); m.set(key, list.length - 1); }
    return m.get(key);
  }
  fontXml(f) {
    return `<font>${f.b ? "<b/>" : ""}${f.i ? "<i/>" : ""}<sz val="${f.sz || 10}"/>${f.color ? `<color rgb="FF${f.color}"/>` : ""}<name val="Arial"/></font>`;
  }
  font(f) { const k = JSON.stringify(f); return this._get("font", k, this.fonts, this.fontXml(f)); }
  fill(c) { return this._get("fill", c, this.fills, `<fill><patternFill patternType="solid"><fgColor rgb="FF${c}"/><bgColor indexed="64"/></patternFill></fill>`); }
  border(b) {
    const t = '<left style="thin"><color rgb="FFBFBFBF"/></left><right style="thin"><color rgb="FFBFBFBF"/></right>';
    const top = b === "dayTop" ? '<top style="medium"><color rgb="FF595959"/></top>' : '<top style="thin"><color rgb="FFBFBFBF"/></top>';
    return this._get("border", b, this.borders, `<border>${t}${top}<bottom style="thin"><color rgb="FFBFBFBF"/></bottom><diagonal/></border>`);
  }
  num(fmt) {
    if (fmt === "0%") return 9;
    return this._get("num", fmt, this.numFmts, fmt) + 164;
  }
  // st : {font:{b,i,sz,color}, fill, border, align:'center'|'left', wrap, num}
  xf(st) {
    if (!st) return 0;
    const k = JSON.stringify(st);
    if (this.cache.has(k)) return this.cache.get(k);
    const fontId = st.font ? this.font(st.font) : 0;
    const fillId = st.fill ? this.fill(st.fill) : 0;
    const borderId = st.border ? this.border(st.border) : 0;
    const numId = st.num ? this.num(st.num) : 0;
    const al = st.align || st.wrap ? `<alignment${st.align ? ` horizontal="${st.align}"` : ""} vertical="${st.valign || "center"}"${st.wrap ? ' wrapText="1"' : ""}/>` : "";
    this.xfs.push(`<xf numFmtId="${numId}" fontId="${fontId}" fillId="${fillId}" borderId="${borderId}" xfId="0"${numId ? ' applyNumberFormat="1"' : ""}${fontId ? ' applyFont="1"' : ""}${fillId ? ' applyFill="1"' : ""}${borderId ? ' applyBorder="1"' : ""}${al ? ' applyAlignment="1">' + al + "</xf>" : "/>"}`);
    this.cache.set(k, this.xfs.length - 1);
    return this.xfs.length - 1;
  }
  dxf(fill, font) {
    this.dxfs.push(`<dxf>${font ? this.fontXml(font).replace("<name val=\"Arial\"/>", "") : ""}${fill ? `<fill><patternFill patternType="solid"><fgColor rgb="FF${fill}"/><bgColor rgb="FF${fill}"/></patternFill></fill>` : ""}</dxf>`);
    return this.dxfs.length - 1;
  }
  xml() {
    const nf = this.numFmts.map((f, i) => `<numFmt numFmtId="${164 + i}" formatCode="${xesc(f)}"/>`).join("");
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${nf ? `<numFmts count="${this.numFmts.length}">${nf}</numFmts>` : ""}<fonts count="${this.fonts.length}">${this.fonts.join("")}</fonts><fills count="${this.fills.length}">${this.fills.join("")}</fills><borders count="${this.borders.length}">${this.borders.join("")}</borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${this.xfs.length}">${this.xfs.join("")}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles><dxfs count="${this.dxfs.length}">${this.dxfs.join("")}</dxfs></styleSheet>`;
  }
}

class XSheet {
  constructor(wb, name) {
    this.wb = wb; this.name = name; this.rows = new Map(); this.merges = []; this.cols = new Map(); this.heights = new Map();
    this.freeze = null; this.cfs = []; this.hidden = false; this.printRows = null; this.landscape = false; this.grid = false;
  }
  cell(r, c, v, st) {
    if (!this.rows.has(r)) this.rows.set(r, new Map());
    const old = this.rows.get(r).get(c) || {};
    this.rows.get(r).set(c, { v: v === undefined ? old.v : v, s: st === undefined ? old.s : this.wb.styles.xf(st) });
  }
  style(r, c, st) { this.cell(r, c, undefined, st); }
  merge(r1, c1, r2, c2) { this.merges.push(`${numToCol(c1)}${r1}:${numToCol(c2)}${r2}`); }
  width(c, w) { this.cols.set(c, w); }
  height(r, h) { this.heights.set(r, h); }
  cf(sqref, formula, fill, font) { this.cfs.push({ sqref, formula, dxf: this.wb.styles.dxf(fill, font) }); }
  xml() {
    const rows = [...this.rows.keys()].sort((a, b) => a - b);
    let data = "";
    for (const r of rows) {
      const cells = [...this.rows.get(r).entries()].sort((a, b) => a[0] - b[0]);
      const ht = this.heights.has(r) ? ` ht="${this.heights.get(r)}" customHeight="1"` : "";
      data += `<row r="${r}"${ht}>`;
      for (const [c, { v, s }] of cells) {
        const ref = numToCol(c) + r, sa = s ? ` s="${s}"` : "";
        if (v === null || v === undefined || v === "") data += `<c r="${ref}"${sa}/>`;
        else if (typeof v === "number") data += `<c r="${ref}"${sa}><v>${v}</v></c>`;
        else if (typeof v === "object" && v.f) data += `<c r="${ref}"${sa}><f>${xesc(v.f)}</f></c>`;
        else data += `<c r="${ref}"${sa} t="inlineStr"><is><t xml:space="preserve">${xesc(v)}</t></is></c>`;
      }
      data += "</row>";
    }
    for (const r of this.heights.keys()) if (!this.rows.has(r)) { /* hauteur seule ignorée */ }
    let pane = "";
    if (this.freeze) {
      const m = /^([A-Z]+)(\d+)$/.exec(this.freeze);
      const xs = colToNum(m[1]) - 1, ys = +m[2] - 1;
      pane = `<pane${xs ? ` xSplit="${xs}"` : ""}${ys ? ` ySplit="${ys}"` : ""} topLeftCell="${this.freeze}" activePane="${xs && ys ? "bottomRight" : ys ? "bottomLeft" : "topRight"}" state="frozen"/>`;
    }
    const cols = [...this.cols.entries()].sort((a, b) => a[0] - b[0]).map(([c, w]) => `<col min="${c}" max="${c}" width="${w}" customWidth="1"/>`).join("");
    let prio = 1;
    const cf = this.cfs.map((x) => `<conditionalFormatting sqref="${x.sqref}"><cfRule type="expression" dxfId="${x.dxf}" priority="${prio++}"><formula>${xesc(x.formula)}</formula></cfRule></conditionalFormatting>`).join("");
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${this.landscape ? '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>' : ""}<sheetViews><sheetView${this.grid ? "" : ' showGridLines="0"'} workbookViewId="0">${pane}</sheetView></sheetViews><sheetFormatPr defaultRowHeight="13"/>${cols ? `<cols>${cols}</cols>` : ""}<sheetData>${data}</sheetData>${this.merges.length ? `<mergeCells count="${this.merges.length}">${this.merges.map((m) => `<mergeCell ref="${m}"/>`).join("")}</mergeCells>` : ""}${cf}<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>${this.landscape ? '<pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/>' : ""}</worksheet>`;
  }
}

class XWorkbook {
  constructor() { this.styles = new XStyles(); this.sheets = []; this.active = 0; }
  add(name) { const s = new XSheet(this, name); this.sheets.push(s); return s; }
  async build() {
    const n = this.sheets.length;
    const files = [];
    files.push({ name: "[Content_Types].xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${this.sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>` });
    files.push({ name: "_rels/.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>` });
    const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
    files.push({ name: "docProps/core.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>Planning radiologie</dc:title><dc:creator>Générateur de planning</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>` });
    files.push({ name: "docProps/app.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Microsoft Excel</Application></Properties>` });
    const defs = this.sheets.map((s, i) => s.printRows ? `<definedName name="_xlnm.Print_Titles" localSheetId="${i}">'${s.name.replace(/'/g, "''")}'!$${s.printRows[0]}:$${s.printRows[1]}</definedName>` : "").join("");
    files.push({ name: "xl/workbook.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView activeTab="${this.active}" firstSheet="0"/></bookViews><sheets>${this.sheets.map((s, i) => `<sheet name="${xesc(s.name)}" sheetId="${i + 1}"${s.hidden ? ' state="hidden"' : ""} r:id="rId${i + 1}"/>`).join("")}</sheets>${defs ? `<definedNames>${defs}</definedNames>` : ""}<calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>` });
    files.push({ name: "xl/_rels/workbook.xml.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${this.sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${n + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` });
    this.sheets.forEach((s, i) => files.push({ name: `xl/worksheets/sheet${i + 1}.xml`, data: s.xml() }));
    files.push({ name: "xl/styles.xml", data: this.styles.xml() });
    return writeZip(files);
  }
}

// ---------------------------------------------------------------- Export du planning
const C = {
  navy: "1F3864", sites: ["2F5597", "548235", "BF8F00", "7030A0", "C55A11"], week: "D9E1F2", alt: "F2F2F2",
  orange: "FCE4D6", yellow: "FFF2CC", grey: "808080",
};
const FIRST_ROW = 7, N_SPARE = 4;

function monthLabel(P) {
  const a = ymd(P.start), b = ymd(P.end);
  return a.y === b.y && a.m === b.m ? `${MOIS[a.m - 1]} ${a.y}` : `du ${fmtDay(P.start)} au ${fmtDay(P.end)}`;
}

async function exportPlanning(pr, R, items, opts = {}) {
  const { P, slots, docs, postes, po, weeks, days } = pr;
  const wb = new XWorkbook();
  const mois = monthLabel(P);
  const H = { font: { b: true, color: "FFFFFF", sz: 9 }, fill: C.navy, align: "center", wrap: true };
  const T = { font: { b: true, sz: 14, color: C.navy } };
  const I = { font: { i: true, sz: 9, color: "7F7F7F" } };
  const firstPc = 4, lastPc = 3 + postes.length;
  const get = (s, p) => R.assign.get(s + "|" + p) || [];
  const today = fmtDay(Math.floor(Date.now() / 86400000));

  // lignes communes : [row, kind, payload]
  const layout = [];
  let r = FIRST_ROW;
  weeks.forEach((w, wi) => {
    layout.push([r++, "week", w]);
    pr.daysOfWeek[wi].forEach((di, k) => pr.slotsOfDay[di].forEach((s) => layout.push([r++, "slot", { s, k }])));
  });
  const lastRow = r - 1;
  const dayRows = (ws, ncols) => {
    for (const [row, kind, pay] of layout) {
      if (kind === "week") {
        ws.cell(row, 1, `Semaine du lundi ${fmtDay(pay)} — semaine ${pr.weekType.get(pay)}`,
          { font: { b: true, sz: 10, color: C.navy }, fill: C.week, align: "left" });
        for (let c = 2; c <= ncols; c++) ws.cell(row, c, null, { fill: C.week });
        ws.merge(row, 1, row, ncols);
        ws.height(row, 18);
      } else {
        const sl = slots[pay.s], fill = pay.k % 2 ? C.alt : "FFFFFF";
        const border = sl.h === "M" ? "dayTop" : "thin";
        for (let c = 1; c <= ncols; c++) ws.cell(row, c, null, { font: { sz: 9, b: c <= 2 }, fill, border, align: "center", wrap: true });
        ws.cell(row, 1, sl.d + EXCEL_EPOCH, { font: { sz: 9, b: true, color: sl.h === "AM" ? fill : undefined }, fill, border, align: "center", num: "DD/MM/YYYY" });
        ws.cell(row, 2, sl.h === "M" ? JOURS[weekday(sl.d)] : "");
        ws.cell(row, 3, HALF_LABEL[sl.h]);
      }
    }
  };
  const headLeft = (ws) => ["Date", "Jour", "Période"].forEach((lab, i) => {
    for (let rr = 4; rr <= 6; rr++) ws.cell(rr, i + 1, rr === 4 ? lab : null, H);
    ws.merge(4, i + 1, 6, i + 1);
  });

  // ---------------------------------------------------- Planning par poste
  const ws = wb.add("Planning par poste");
  ws.cell(1, 1, `Planning du service de radiologie — ${mois}`, T);
  ws.cell(2, 1, `Généré le ${today}. Modifiez les initiales directement dans cette grille (plusieurs médecins : « AB / CD »). Les autres onglets se mettent à jour.`, I);
  headLeft(ws);
  let col = firstPc;
  P.siteList.forEach((site, si) => {
    const ps = postes.filter((p) => P.postes[p].site === site);
    if (!ps.length) return;
    const fill = C.sites[si % C.sites.length];
    for (let k = 0; k < ps.length; k++) ws.cell(4, col + k, k === 0 ? site.toUpperCase() : null, { ...H, fill });
    ws.merge(4, col, 4, col + ps.length - 1);
    for (const p of ps) {
      const x = P.postes[p];
      ws.cell(5, col, x.label + (x.need > 1 ? `\n${x.need} médecins` : ""), { ...H, fill });
      ws.cell(6, col, p, { font: { sz: 8, color: C.grey }, align: "center" });
      ws.width(col, x.need > 1 ? 17 : 13);
      col++;
    }
  });
  ws.height(5, 42);
  [11, 10, 10].forEach((w, i) => ws.width(i + 1, w));
  dayRows(ws, lastPc);
  for (const [row, kind, pay] of layout) {
    if (kind !== "slot") continue;
    const s = pay.s, fill = pay.k % 2 ? C.alt : "FFFFFF", border = slots[s].h === "M" ? "dayTop" : "thin";
    postes.forEach((code, p) => {
      const c = firstPc + p;
      if (!pr.open[s][p]) { ws.cell(row, c, "—", { font: { sz: 8, color: C.grey }, fill, border, align: "center" }); return; }
      const inis = get(s, p);
      ws.cell(row, c, inis.length ? inis.join(" / ") : "FERMÉ",
        inis.length && inis.length < po[p].need ? { font: { sz: 9 }, fill: C.orange, border, align: "center", wrap: true } : undefined);
    });
  }
  ws.freeze = numToCol(firstPc) + FIRST_ROW;
  ws.cf(`${numToCol(firstPc)}${FIRST_ROW}:${numToCol(lastPc)}${lastRow}`, `${numToCol(firstPc)}${FIRST_ROW}="FERMÉ"`, "F8CBAD", { b: true, color: "C00000" });
  ws.printRows = [4, 6]; ws.landscape = true;

  // ---------------------------------------------------- Statuts (masqué)
  const st = wb.add("Statuts");
  docs.forEach((ini, i) => st.cell(5, 4 + i, ini));
  for (const [row, kind, pay] of layout) if (kind === "slot") docs.forEach((_, d) => st.cell(row, 4 + d, pr.status[d][pay.s] || "DISPO"));
  st.hidden = true;

  // ---------------------------------------------------- Planning par médecin
  const wm = wb.add("Planning par médecin");
  const ndoc = docs.length + N_SPARE, ncolM = 3 + ndoc;
  wm.cell(1, 1, `Planning par médecin — ${mois}`, T);
  wm.cell(2, 1, "Calculé automatiquement à partir de « Planning par poste » (ne pas saisir ici). Colonnes jaunes : tapez les initiales d'un nouveau médecin en ligne 5.", I);
  headLeft(wm);
  for (let c = 4; c <= ncolM; c++) wm.cell(4, c, c === 4 ? "MÉDECINS" : null, H);
  wm.merge(4, 4, 4, ncolM);
  for (let i = 0; i < ndoc; i++) {
    const c = 4 + i;
    if (i < docs.length) {
      wm.cell(5, c, docs[i], { font: { b: true, color: "FFFFFF", sz: 10 }, fill: "2F5597", align: "center", border: "thin" });
      wm.cell(6, c, `${Math.round(P.docs[docs[i]].quotite * 100)}%`, { font: { sz: 8, color: C.grey }, align: "center" });
    } else {
      wm.cell(5, c, null, { fill: C.yellow, align: "center", border: "thin", font: { b: true, sz: 10 } });
      wm.cell(6, c, "nouveau", { font: { sz: 8, color: C.grey }, align: "center" });
    }
    wm.width(c, 9);
  }
  [11, 10, 10].forEach((w, i) => wm.width(i + 1, w));
  dayRows(wm, ncolM);
  const PP = "'Planning par poste'!";
  const codesRng = `${PP}$${numToCol(firstPc)}$6:$${numToCol(lastPc)}$6`;
  for (const [row, kind] of layout) {
    if (kind !== "slot") continue;
    const rr = `${PP}$${numToCol(firstPc)}$${row}:$${numToCol(lastPc)}$${row}`;
    for (let i = 0; i < ndoc; i++) {
      const c = 4 + i, Hh = `${numToCol(c)}$5`;
      const hit = `ISNUMBER(SEARCH(" "&${Hh}&" "," "&SUBSTITUTE(${rr},"/"," ")&" "))`;
      const n = `SUMPRODUCT(--${hit})`;
      const pos = `SUMPRODUCT(${hit}*(COLUMN(${rr})-COLUMN(${PP}$${numToCol(firstPc)}$${row})+1))`;
      const fb = i < docs.length ? `Statuts!${numToCol(c)}${row}` : '"DISPO"';
      wm.cell(row, c, { f: `IF(${Hh}="","",IF(${n}>1,"DOUBLON",IF(${n}=1,INDEX(${codesRng},1,${pos}),${fb})))` });
    }
  }
  const areaM = `D${FIRST_ROW}:${numToCol(ncolM)}${lastRow}`, D0 = `D${FIRST_ROW}`;
  wm.cf(areaM, `OR(${D0}="OFF",${D0}="ABS",${D0}="INDISPO")`, "BFBFBF", { sz: 8, color: "595959" });
  wm.cf(areaM, `${D0}="DOUBLON"`, "FF0000", { b: true, color: "FFFFFF" });
  wm.cf(areaM, `${D0}="DISPO"`, "FFF2CC", { i: true, sz: 8, color: "7F6000" });
  const remFills = ["E2EFDA", "FFF2CC", "EDE1F5", "FBE5D6"];
  P.siteList.forEach((site, si) => {
    if (si === 0) return;
    const ps = postes.filter((p) => P.postes[p].site === site);
    if (!ps.length) return;
    wm.cf(areaM, `OR(${ps.map((p) => `${D0}="${p}"`).join(",")})`, remFills[(si - 1) % 4], { b: true, sz: 9, color: C.sites[si % C.sites.length] });
  });
  wm.freeze = "D" + FIRST_ROW;
  wm.printRows = [4, 6]; wm.landscape = true;

  // ---------------------------------------------------- Synthèse
  const sy = wb.add("Synthèse");
  sy.cell(1, 1, `Synthèse par médecin — ${mois}`, T);
  sy.cell(2, 1, "Nombre de demi-journées par poste (formules : se met à jour si le planning est modifié).", I);
  const hdr = ["Médecin", "Quotité", ...postes.map((p) => P.postes[p].label), "Total affecté", "Dispo non affecté", "Off / absent",
    `Demi-j. hors ${P.mainSite}`, ...weeks.map((w) => `Hors ${P.mainSite} sem. ${fmtDay(w, false)}`)];
  hdr.forEach((h, i) => { sy.cell(4, i + 1, h, { ...H, border: "thin" }); sy.width(i + 1, i === 0 ? 11 : i === 1 ? 8 : 10); });
  sy.height(4, 54);
  const pm = "'Planning par médecin'!";
  const remoteCodes = postes.filter((p) => P.postes[p].site !== P.mainSite && !P.postes[p].tt);
  for (let i = 0; i < ndoc; i++) {
    const row = 5 + i, mc = numToCol(4 + i);
    const colr = `${pm}$${mc}$${FIRST_ROW}:$${mc}$${lastRow}`;
    const base = { font: { sz: 9 }, align: "center", border: "thin", fill: row % 2 === 0 ? C.alt : undefined };
    sy.cell(row, 1, { f: `IF(${pm}${mc}$5="","",${pm}${mc}$5)` }, { ...base, font: { sz: 9, b: true } });
    sy.cell(row, 2, i < docs.length ? P.docs[docs[i]].quotite : null, { ...base, num: "0%" });
    postes.forEach((p, j) => sy.cell(row, 3 + j, { f: `IF($A${row}="","",COUNTIF(${colr},"${p}"))` }, base));
    const ct = 3 + postes.length;
    sy.cell(row, ct, { f: `IF($A${row}="","",SUM(${numToCol(3)}${row}:${numToCol(ct - 1)}${row}))` }, base);
    sy.cell(row, ct + 1, { f: `IF($A${row}="","",COUNTIF(${colr},"DISPO"))` }, base);
    sy.cell(row, ct + 2, { f: `IF($A${row}="","",COUNTIF(${colr},"OFF")+COUNTIF(${colr},"ABS")+COUNTIF(${colr},"INDISPO"))` }, base);
    sy.cell(row, ct + 3, { f: `IF($A${row}="","",${remoteCodes.map((p) => `COUNTIF(${colr},"${p}")`).join("+") || "0"})` }, base);
    const cd = `${pm}$A$${FIRST_ROW}:$A$${lastRow}`;
    weeks.forEach((w, k) => {
      const a = ymd(w), b = ymd(w + 4);
      const parts = remoteCodes.map((p) => `COUNTIFS(${cd},">="&DATE(${a.y},${a.m},${a.d}),${cd},"<="&DATE(${b.y},${b.m},${b.d}),${colr},"${p}")`).join("+") || "0";
      sy.cell(row, ct + 4 + k, { f: `IF($A${row}="","",${parts})` }, base);
    });
  }
  const tr = 5 + ndoc;
  sy.cell(tr, 1, "Total", { font: { b: true, sz: 9 } });
  for (let c = 3; c <= hdr.length; c++) sy.cell(tr, c, { f: `SUM(${numToCol(c)}5:${numToCol(c)}${tr - 1})` }, { font: { b: true, sz: 9 }, align: "center", border: "thin" });
  sy.cell(tr + 2, 1, "Les colonnes « Hors … sem. » comptent des demi-journées : 2 = une journée complète sur un autre site.", I);
  sy.freeze = "C5";

  // ---------------------------------------------------- Fermetures
  const fe = wb.add("Fermetures");
  fe.cell(1, 1, "Postes fermés ou incomplets", T);
  fe.cell(2, 1, "État au moment de la génération, par manque de médecins disponibles et compétents.", I);
  ["Date", "Jour", "Période", "Poste", "Site", "Médecins manquants"].forEach((h, i) => fe.cell(4, i + 1, h, H));
  [12, 11, 11, 30, 20, 12].forEach((w, i) => fe.width(i + 1, w));
  let fr = 5;
  const cellSt = { font: { sz: 9 }, align: "center", border: "thin" };
  slots.forEach((sl, s) => postes.forEach((code, p) => {
    if (!pr.open[s][p]) return;
    const n = get(s, p).length;
    if (n >= po[p].need) return;
    [sl.d + EXCEL_EPOCH, JOURS[weekday(sl.d)], HALF_LABEL[sl.h], po[p].label, po[p].site, po[p].need - n]
      .forEach((v, i) => fe.cell(fr, i + 1, v, i === 0 ? { ...cellSt, num: "DD/MM/YYYY" } : cellSt));
    fr++;
  }));
  ["Poste", "Demi-j. ouvertes", "Places non pourvues", "Taux de couverture"].forEach((h, i) => fe.cell(4, 8 + i, h, H));
  fe.width(8, 30); [9, 10, 11].forEach((c) => fe.width(c, 14));
  coverage(pr, R).forEach((cv, k) => {
    const row = 5 + k;
    fe.cell(row, 8, cv.label, { ...cellSt, align: "left" });
    fe.cell(row, 9, cv.opened, cellSt);
    fe.cell(row, 10, cv.opened - cv.filled, cellSt);
    fe.cell(row, 11, { f: `IF(I${row}=0,"",1-J${row}/I${row})` }, { ...cellSt, num: "0%" });
  });
  fe.cell(5 + postes.length + 1, 8, "« Demi-j. ouvertes » compte les places (un poste à 3 médecins compte 3 places par demi-journée).", I);
  fe.freeze = "A5";

  // ---------------------------------------------------- Contrôles
  const co = wb.add("Contrôles");
  co.cell(1, 1, "Contrôle des règles", T);
  co.cell(2, 1, R.iterations ? `État au moment de la génération (${R.iterations.toLocaleString("fr-FR")} combinaisons évaluées).` : "État au moment de l'export.", I);
  co.cell(4, 1, "Niveau", H); co.cell(4, 2, "Détail", { ...H, align: "left" });
  co.width(1, 10); co.width(2, 120);
  const lc = { OK: "548235", Info: "2F5597", Alerte: "C55A11", Erreur: "C00000" };
  items.forEach(([lvl, txt], i) => {
    co.cell(5 + i, 1, lvl, { font: { b: true, sz: 9, color: lc[lvl] || "000000" } });
    co.cell(5 + i, 2, txt, { font: { sz: 9 } });
  });

  // ---------------------------------------------------- Config (masqué, pour les .ics)
  const cf = wb.add("Config");
  cf.cell(1, 1, "Configuration utilisée par le générateur de calendriers (.ics)", { font: { b: true, sz: 9 } });
  ["Code", "Libellé", "Site", "Adresse", "Matin début", "Matin fin", "AM début", "AM fin"].forEach((h, i) => cf.cell(3, i + 1, h, { font: { b: true, sz: 9 } }));
  postes.forEach((p, k) => {
    const x = P.postes[p], site = P.sites[x.site] || P.sites[P.mainSite];
    [p, x.label, x.site, site.adresse].forEach((v, i) => cf.cell(4 + k, i + 1, v));
    [site.M[0], site.M[1], site.AM[0], site.AM[1]].forEach((m, i) => cf.cell(4 + k, 5 + i, m / 1440, { num: "HH:MM" }));
  });
  const base = 5 + postes.length;
  cf.cell(base, 1, "Médecin", { font: { b: true, sz: 9 } }); cf.cell(base, 2, "Nom", { font: { b: true, sz: 9 } });
  docs.forEach((ini, k) => { cf.cell(base + 1 + k, 1, ini); cf.cell(base + 1 + k, 2, P.docs[ini].nom); });
  cf.hidden = true;

  // ---------------------------------------------------- Lisez-moi (en premier)
  const lm = new XSheet(wb, "Lisez-moi");
  wb.sheets.unshift(lm);
  lm.width(1, 115);
  const B = { font: { b: true, sz: 11, color: C.navy } }, N = { font: { sz: 10 }, wrap: true, valign: "top" };
  const txt = [
    [`Planning du service de radiologie — ${mois}`, T], ["", N], ["Onglets", B],
    ["• Planning par poste : la grille de référence. C'est ici qu'on modifie le planning (initiales dans les cases).", N],
    ["• Planning par médecin : calculé depuis la grille. Gris = off/absent, jaune = disponible non affecté, couleurs vives = autre site.", N],
    ["• Synthèse : demi-journées par poste et par médecin, déplacements hors site principal par semaine.", N],
    ["• Fermetures : postes non pourvus à la génération et taux de couverture par poste.", N],
    ["• Contrôles : vérification automatique des règles au moment de la génération.", N], ["", N],
    ["Modifier le planning à la main", B],
    ["Tapez ou effacez les initiales dans « Planning par poste ». Plusieurs médecins sur un poste : « AB / CD ». Un médecin placé deux fois sur la même demi-journée apparaît en rouge (DOUBLON) dans « Planning par médecin ».", N],
    ["", N], ["Ajouter un médecin directement dans ce planning", B],
    ["1. Dans « Planning par médecin », tapez ses initiales dans une case jaune de la ligne 5 (colonnes « nouveau »).", N],
    ["2. Placez ses initiales dans les cases voulues de « Planning par poste ». Sa colonne et la synthèse se remplissent seules.", N],
    ["3. Pour les générations suivantes, ajoutez-le aussi dans l'onglet Médecins du classeur de paramètres.", N],
    ["", N], ["Calendriers iPhone après modification", B],
    [opts.icsHint || "Ouvrez le générateur (fichier HTML), rubrique « Calendriers depuis un planning modifié », et déposez ce fichier.", N],
    ["", N], ["Codes", B],
    ...postes.map((p) => [`• ${p} : ${P.postes[p].label} (${P.postes[p].site})`, N]),
    ["• OFF : jour off · ABS : absence · INDISPO : indisponibilité fixe (ex. CHU) · DISPO : présent, sans poste attribué", N],
    ["• FERMÉ : poste ouvert mais non pourvu · — : poste non ouvert ce créneau · case orange : poste incomplet (ex. scanner à 2)", N],
  ];
  txt.forEach(([t, s], i) => lm.cell(i + 1, 1, t, s));
  wb.active = 1;
  return wb.build();
}

// ---------------------------------------------------------------- Calendriers .ics
const VTZ = ["BEGIN:VTIMEZONE", "TZID:Europe/Paris", "BEGIN:DAYLIGHT", "TZOFFSETFROM:+0100", "TZOFFSETTO:+0200", "TZNAME:CEST",
  "DTSTART:19700329T020000", "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU", "END:DAYLIGHT", "BEGIN:STANDARD", "TZOFFSETFROM:+0200",
  "TZOFFSETTO:+0100", "TZNAME:CET", "DTSTART:19701025T030000", "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU", "END:STANDARD", "END:VTIMEZONE"];
const iesc = (s) => String(s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
function ifold(line) {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out = []; let cur = "", len = 0;
  for (const ch of line) {
    const l = enc.encode(ch).length;
    if (len + l > (out.length ? 74 : 75)) { out.push(cur); cur = ""; len = 0; }
    cur += ch; len += l;
  }
  out.push(cur);
  return out.join("\r\n ");
}
const pad2 = (n) => String(n).padStart(2, "0");
function icsDT(day, minutes) { const x = ymd(day); return `${x.y}${pad2(x.m)}${pad2(x.d)}T${pad2(Math.floor(minutes / 60))}${pad2(minutes % 60)}00`; }

// events : Map ini -> Map day -> {M: code, AM: code} ; postes : code -> {label, site, adresse, M:[a,b], AM:[a,b]}
function buildIcs(events, postes, title) {
  const now = new Date();
  const stamp = `${now.getUTCFullYear()}${pad2(now.getUTCMonth() + 1)}${pad2(now.getUTCDate())}T${pad2(now.getUTCHours())}${pad2(now.getUTCMinutes())}${pad2(now.getUTCSeconds())}Z`;
  const out = [];
  for (const ini of [...events.keys()].sort()) {
    const L = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Service de radiologie//Planning//FR", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
      `X-WR-CALNAME:${iesc("Planning radio " + ini)}`, "X-WR-TIMEZONE:Europe/Paris", ...VTZ];
    let n = 0;
    const byDay = events.get(ini);
    const daysSorted = [...byDay.keys()].sort((a, b) => a - b);
    for (const d of daysSorted) {
      const h = byDay.get(d);
      const blocks = h.M && h.M === h.AM ? [[h.M, "M", "AM", "journée"]] :
        ["M", "AM"].filter((x) => h[x]).map((x) => [h[x], x, x, x === "M" ? "matin" : "après-midi"]);
      for (const [code, h1, h2, lab] of blocks) {
        const p = postes[code] || { label: code, site: "", adresse: "", M: [510, 780], AM: [810, 1080] };
        const loc = p.site + (p.adresse ? `, ${p.adresse}` : "");
        L.push("BEGIN:VEVENT", `UID:${ini}-${icsDT(d, 0).slice(0, 8)}-${h1}${h2}-${code}@planning-radiologie`, `DTSTAMP:${stamp}`,
          `DTSTART;TZID=Europe/Paris:${icsDT(d, p[h1][0])}`, `DTEND;TZID=Europe/Paris:${icsDT(d, p[h2][1])}`,
          `SUMMARY:${iesc(p.label + " — " + p.site)}`, `LOCATION:${iesc(loc)}`,
          `DESCRIPTION:${iesc(`${title}. Vacation du ${lab} (${code}).`)}`, "TRANSP:OPAQUE", "END:VEVENT");
        n++;
      }
    }
    L.push("END:VCALENDAR");
    const first = ymd(daysSorted[0]);
    out.push({ ini, name: `planning_${ini}_${first.y}-${pad2(first.m)}.ics`, text: L.map(ifold).join("\r\n") + "\r\n", count: n });
  }
  return out;
}

function eventsFromResult(pr, R) {
  const ev = new Map();
  for (const [k, inis] of R.assign) {
    const [s, p] = k.split("|").map(Number);
    const sl = pr.slots[s];
    for (const ini of inis) {
      if (!ev.has(ini)) ev.set(ini, new Map());
      const m = ev.get(ini);
      if (!m.has(sl.d)) m.set(sl.d, {});
      m.get(sl.d)[sl.h] = pr.postes[p];
    }
  }
  const postes = {};
  pr.postes.forEach((code) => {
    const x = pr.P.postes[code], site = pr.P.sites[x.site] || pr.P.sites[pr.P.mainSite];
    postes[code] = { label: x.label, site: x.site, adresse: site.adresse, M: site.M, AM: site.AM };
  });
  return { ev, postes };
}

// Lecture d'un planning (éventuellement modifié à la main) pour régénérer les .ics
function eventsFromPlanning(S) {
  const ws = S["Planning par poste"], cf = S["Config"];
  if (!ws || !cf) throw new Error("Ce fichier n'est pas un planning produit par le générateur (onglets « Planning par poste » / « Config » absents).");
  const postes = {};
  for (let r = 4; cf.get(r, 1) !== null; r++) {
    const code = String(cf.get(r, 1));
    postes[code] = {
      label: norm(cf.get(r, 2)) || code, site: norm(cf.get(r, 3)), adresse: norm(cf.get(r, 4)),
      M: [asMinutes(cf.get(r, 5), 510), asMinutes(cf.get(r, 6), 780)], AM: [asMinutes(cf.get(r, 7), 810), asMinutes(cf.get(r, 8), 1080)],
    };
  }
  const codes = {};
  for (let c = 4; c <= ws.maxCol; c++) if (ws.get(6, c) !== null) codes[c] = String(ws.get(6, c));
  const ev = new Map();
  for (let r = 7; r <= ws.maxRow; r++) {
    const dv = ws.get(r, 1);
    if (typeof dv !== "number") continue;
    const d = dayFromExcel(dv);
    const h = low(ws.get(r, 3)).startsWith("a") ? "AM" : "M";
    for (const [c, code] of Object.entries(codes)) {
      const v = norm(ws.get(r, +c));
      if (!v || v === "—" || v.toUpperCase() === "FERMÉ" || v.toUpperCase() === "FERME") continue;
      for (const part of v.split("/")) {
        const ini = part.trim().toUpperCase();
        if (!ini) continue;
        if (!ev.has(ini)) ev.set(ini, new Map());
        const m = ev.get(ini);
        if (!m.has(d)) m.set(d, {});
        m.get(d)[h] = code;
      }
    }
  }
  if (!ev.size) throw new Error("Aucune affectation trouvée dans l'onglet « Planning par poste ».");
  return { ev, postes, title: norm(ws.get(1, 1)) || "Planning radiologie" };
}

// Planning Excel produit par le site (éventuellement retouché, ou converti d'un ancien planning)
// -> brouillon au format en ligne. Les postes et horaires viennent de l'onglet Config du fichier ;
// les paramètres actuels (P, facultatif) donnent l'ordre des sites et l'alternance des semaines.
function draftFromPlanningXlsx(S, P) {
  const ws = S["Planning par poste"], cf = S["Config"];
  if (!ws || !cf) throw new Error("Ce fichier n'est pas un planning produit par le site (onglets « Planning par poste » / « Config » absents).");
  const postes = {}, ordre = [], medecins = [];
  let r = 4;
  for (; cf.get(r, 1) !== null; r++) {
    const code = String(cf.get(r, 1)).trim().toUpperCase();
    postes[code] = {
      label: norm(cf.get(r, 2)) || code, site: norm(cf.get(r, 3)), adresse: norm(cf.get(r, 4)),
      M: [asMinutes(cf.get(r, 5), 510), asMinutes(cf.get(r, 6), 780)], AM: [asMinutes(cf.get(r, 7), 810), asMinutes(cf.get(r, 8), 1080)],
    };
    ordre.push(code);
  }
  for (; r <= cf.maxRow; r++) if (norm(cf.get(r, 1)) === "Médecin") break;
  for (r++; r <= cf.maxRow; r++) { const ini = norm(cf.get(r, 1)).toUpperCase(); if (ini) medecins.push(ini); }
  const sites = [];
  for (const s of (P ? P.siteList : [])) if (ordre.some((c) => postes[c].site === s)) sites.push(s);
  for (const c of ordre) if (!sites.includes(postes[c].site)) sites.push(postes[c].site);
  const codes = {};
  for (let c = 4; c <= ws.maxCol; c++) if (ws.get(6, c) !== null && postes[String(ws.get(6, c)).toUpperCase()]) codes[c] = String(ws.get(6, c)).toUpperCase();
  const st = S["Statuts"], stDocs = {};
  if (st) for (let c = 4; c <= st.maxCol; c++) if (st.get(5, c) !== null) stDocs[c] = norm(st.get(5, c)).toUpperCase();
  const cases = {}, statuts = {}, jours = new Set();
  for (let rr = 7; rr <= ws.maxRow; rr++) {
    const dv = ws.get(rr, 1);
    if (typeof dv !== "number") continue;
    const d = dayFromExcel(dv), h = low(ws.get(rr, 3)).startsWith("a") ? "AM" : "M";
    jours.add(d);
    for (const [c, code] of Object.entries(codes)) {
      const v = norm(ws.get(rr, +c));
      if (!v || v === "—") continue;                     // poste non ouvert
      const inis = /^FERM/i.test(v) ? [] : v.split("/").map((x) => x.trim().toUpperCase()).filter(Boolean);
      cases[`${d}_${h}_${code}`] = inis.join(" / ");
      for (const ini of inis) if (!medecins.includes(ini)) medecins.push(ini);
    }
    if (st) for (const [c, ini] of Object.entries(stDocs)) {
      const v = norm(st.get(rr, +c)).toUpperCase();
      if (v === "OFF" || v === "ABS" || v === "INDISPO") (statuts[ini] = statuts[ini] || {})[`${d}_${h}`] = v;
    }
  }
  if (!jours.size) throw new Error("Aucune date trouvée dans l'onglet « Planning par poste ».");
  const js = [...jours].sort((a, b) => a - b);
  const lundis = [...new Set(js.map(mondayOf))];
  const refA = P ? P.refA : lundis[0];
  const titre = norm(ws.get(1, 1)) || "Planning du service de radiologie";
  return {
    version: 1, titre, start: js[0], end: js[js.length - 1], genereLe: Date.now(), ordre, postes, sites, mainSite: sites[0],
    jours: js, semaines: lundis.map((w) => ({ lundi: w, type: Math.floor((w - refA) / 7) % 2 === 0 ? "A" : "B" })),
    medecins, cases, statuts, importe: true,  // repos / absences : ceux du fichier
  };
}
