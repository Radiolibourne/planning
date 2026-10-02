// ---------------------------------------------------------------- ZIP (lecture / écriture), sans dépendance
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(u8) {
  let c = 0xffffffff;
  for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function streamBytes(u8, stream) {
  const s = new Blob([u8]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(s).arrayBuffer());
}
const inflateRaw = (u8) => streamBytes(u8, new DecompressionStream("deflate-raw"));
const deflateRaw = (u8) => streamBytes(u8, new CompressionStream("deflate-raw"));

async function readZip(buffer) {
  const u8 = new Uint8Array(buffer);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("Ce fichier n'est pas un classeur Excel (.xlsx) valide.");
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const files = {};
  const dec = new TextDecoder();
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error("Archive corrompue.");
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
    const loff = dv.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nlen));
    const lnlen = dv.getUint16(loff + 26, true), lxlen = dv.getUint16(loff + 28, true);
    const start = loff + 30 + lnlen + lxlen;
    const raw = u8.subarray(start, start + csize);
    files[name] = method === 0 ? raw.slice() : await inflateRaw(raw);
    p += 46 + nlen + xlen + clen;
  }
  return files;
}

// entries : [{name, data: Uint8Array | string}]
async function writeZip(entries, compress = true) {
  const enc = new TextEncoder();
  const chunks = [], central = [];
  let offset = 0;
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  for (const e of entries) {
    const data = typeof e.data === "string" ? enc.encode(e.data) : e.data;
    const name = enc.encode(e.name);
    const crc = crc32(data);
    let body = data, method = 0;
    if (compress && data.length > 64 && typeof CompressionStream !== "undefined") {
      const d = await deflateRaw(data);
      if (d.length < data.length) { body = d; method = 8; }
    }
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true);
    lh.setUint16(8, method, true); lh.setUint16(10, dosTime, true); lh.setUint16(12, dosDate, true);
    lh.setUint32(14, crc, true); lh.setUint32(18, body.length, true); lh.setUint32(22, data.length, true);
    lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
    chunks.push(new Uint8Array(lh.buffer), name, body);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true);
    ch.setUint16(8, 0x0800, true); ch.setUint16(10, method, true); ch.setUint16(12, dosTime, true);
    ch.setUint16(14, dosDate, true); ch.setUint32(16, crc, true); ch.setUint32(20, body.length, true);
    ch.setUint32(24, data.length, true); ch.setUint16(28, name.length, true);
    ch.setUint32(42, offset, true);
    central.push(new Uint8Array(ch.buffer), name);
    offset += 30 + name.length + body.length;
  }
  const csize = central.reduce((a, c) => a + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true);
  end.setUint32(12, csize, true); end.setUint32(16, offset, true);
  const all = [...chunks, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((a, c) => a + c.length, 0));
  let o = 0;
  for (const c of all) { out.set(c, o); o += c.length; }
  return out;
}

// ---------------------------------------------------------------- Lecture XLSX
function colToNum(s) { let n = 0; for (const ch of s) n = n * 26 + ch.charCodeAt(0) - 64; return n; }
function numToCol(n) { let s = ""; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }

async function readXlsx(buffer) {
  const files = await readZip(buffer);
  const dec = new TextDecoder();
  const xml = (name) => files[name] ? new DOMParser().parseFromString(dec.decode(files[name]), "application/xml") : null;
  const byTag = (node, tag) => Array.from(node.getElementsByTagNameNS("*", tag));
  const shared = [];
  const ss = xml("xl/sharedStrings.xml");
  if (ss) for (const si of byTag(ss, "si")) shared.push(byTag(si, "t").map((t) => t.textContent).join(""));
  const wbx = xml("xl/workbook.xml");
  const rels = xml("xl/_rels/workbook.xml.rels");
  if (!wbx || !rels) throw new Error("Ce fichier n'est pas un classeur Excel (.xlsx) valide.");
  const target = {};
  for (const r of byTag(rels, "Relationship")) target[r.getAttribute("Id")] = r.getAttribute("Target");
  const sheets = {};
  for (const s of byTag(wbx, "sheet")) {
    const rid = s.getAttribute("r:id") || s.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
    let t = target[rid] || "";
    t = t.startsWith("/") ? t.slice(1) : "xl/" + t.replace(/^\.\//, "");
    const doc = xml(t);
    const cells = new Map();
    let maxRow = 0, maxCol = 0;
    if (doc) for (const c of byTag(doc, "c")) {
      const ref = c.getAttribute("r");
      const m = /^([A-Z]+)(\d+)$/.exec(ref);
      if (!m) continue;
      const col = colToNum(m[1]), row = +m[2];
      const type = c.getAttribute("t");
      const v = byTag(c, "v")[0];
      let val = null;
      if (type === "s") val = v ? shared[+v.textContent] : null;
      else if (type === "inlineStr") val = byTag(c, "t").map((x) => x.textContent).join("");
      else if (type === "str") val = v ? v.textContent : null;
      else if (type === "b") val = v ? v.textContent === "1" : null;
      else if (type === "e") val = null;
      else val = v && v.textContent !== "" ? +v.textContent : null;
      if (val === null || val === "") continue;
      cells.set(row + "," + col, val);
      maxRow = Math.max(maxRow, row); maxCol = Math.max(maxCol, col);
    }
    sheets[s.getAttribute("name")] = { cells, maxRow, maxCol, get: (r, c) => cells.has(r + "," + c) ? cells.get(r + "," + c) : null };
  }
  return sheets;
}

// ---------------------------------------------------------------- Réécriture d'un onglet d'un classeur existant
// Remplace les lignes [depuis, fin] de l'onglet par `lignes` (tableaux de valeurs, colonne A = index 0),
// en conservant tout le reste du classeur (autres onglets, styles, listes déroulantes, commentaires).
// styleDe(i) : numéro de ligne existante dont on reprend le style des cellules pour la ligne i.
async function rewriteSheet(bytes, nomOnglet, depuis, lignes, styleDe) {
  const files = await readZip(bytes.buffer ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) : bytes);
  const dec = new TextDecoder();
  const xml = (n) => new DOMParser().parseFromString(dec.decode(files[n]), "application/xml");
  const byTag = (node, tag) => Array.from(node.getElementsByTagNameNS("*", tag));
  const target = {};
  for (const r of byTag(xml("xl/_rels/workbook.xml.rels"), "Relationship")) target[r.getAttribute("Id")] = r.getAttribute("Target");
  const sh = byTag(xml("xl/workbook.xml"), "sheet").find((s) => s.getAttribute("name") === nomOnglet);
  if (!sh) throw new Error(`Onglet « ${nomOnglet} » introuvable.`);
  const rid = sh.getAttribute("r:id") || sh.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
  let chemin = target[rid] || "";
  chemin = chemin.startsWith("/") ? chemin.slice(1) : "xl/" + chemin.replace(/^\.\//, "");
  let s = dec.decode(files[chemin]);
  const debut = s.search(/<sheetData\s*\/>|<sheetData\b[^>]*>/);
  if (debut < 0) throw new Error("Onglet illisible.");
  const vide = /^<sheetData\s*\/>/.test(s.slice(debut));
  const finOuv = s.indexOf(">", debut) + 1;
  const fin = vide ? finOuv : s.indexOf("</sheetData>", debut);
  const corps = vide ? "" : s.slice(finOuv, fin);
  const rows = corps.match(/<row\b[^>]*?(?:\/>|>[\s\S]*?<\/row>)/g) || [];
  const numero = (r) => +(/\br="(\d+)"/.exec(r) || [0, 0])[1];
  const styles = {};
  for (const r of rows) {
    const m = {};
    for (const c of r.match(/<c\b[^>]*>/g) || []) {
      const ref = /\br="([A-Z]+)\d+"/.exec(c), st = /\bs="(\d+)"/.exec(c);
      if (ref && st) m[colToNum(ref[1])] = st[1];
    }
    styles[numero(r)] = m;
  }
  const gardees = rows.filter((r) => numero(r) < depuis);
  const xe = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  let maxCol = 1;
  const nouvelles = lignes.map((vals, i) => {
    const r = depuis + i, st = styles[styleDe(i)] || {};
    const n = Math.max(vals.length, ...Object.keys(st).map(Number), 0);
    maxCol = Math.max(maxCol, n);
    let cells = "";
    for (let c = 1; c <= n; c++) {
      const v = vals[c - 1], sa = st[c] ? ` s="${st[c]}"` : "", ref = numToCol(c) + r;
      if (v === null || v === undefined || v === "") { if (sa) cells += `<c r="${ref}"${sa}/>`; }
      else if (typeof v === "number" && isFinite(v)) cells += `<c r="${ref}"${sa}><v>${v}</v></c>`;
      else cells += `<c r="${ref}"${sa} t="inlineStr"><is><t xml:space="preserve">${xe(v)}</t></is></c>`;
    }
    return `<row r="${r}">${cells}</row>`;
  });
  const sd = `<sheetData>${gardees.join("")}${nouvelles.join("")}</sheetData>`;
  s = s.slice(0, debut) + sd + s.slice(vide ? finOuv : fin + "</sheetData>".length);
  const derniere = depuis + lignes.length - 1;
  s = s.replace(/<dimension\s+ref="[^"]*"\s*\/>/, `<dimension ref="A1:${numToCol(maxCol)}${Math.max(derniere, depuis)}"/>`);
  files[chemin] = new TextEncoder().encode(s);
  return writeZip(Object.entries(files).map(([name, data]) => ({ name, data })));
}

// Ajoute un onglet (vide, avec ses lignes d'en-tête) à un classeur existant. Sans effet si l'onglet existe déjà.
async function addSheet(bytes, nomOnglet, lignes) {
  const files = await readZip(bytes);
  const dec = new TextDecoder(), enc = new TextEncoder();
  let wbx = dec.decode(files["xl/workbook.xml"]);
  const xe = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  if (wbx.includes(`name="${xe(nomOnglet)}"`)) return bytes;
  let rels = dec.decode(files["xl/_rels/workbook.xml.rels"]);
  let ct = dec.decode(files["[Content_Types].xml"]);
  let n = 1; while (files[`xl/worksheets/sheet${n}.xml`]) n++;
  let id = 1; while (rels.includes(`Id="rIdP${id}"`)) id++;
  const sheetId = Math.max(0, ...[...wbx.matchAll(/sheetId="(\d+)"/g)].map((m) => +m[1])) + 1;
  const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  wbx = wbx.replace("</sheets>", `<sheet xmlns:r="${R}" name="${xe(nomOnglet)}" sheetId="${sheetId}" state="visible" r:id="rIdP${id}"/></sheets>`);
  rels = rels.replace("</Relationships>", `<Relationship Id="rIdP${id}" Type="${R}/worksheet" Target="worksheets/sheet${n}.xml"/></Relationships>`);
  ct = ct.replace("</Types>", `<Override PartName="/xl/worksheets/sheet${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`);
  const rows = lignes.map((vals, i) => `<row r="${i + 1}">${vals.map((v, c) => (v === null || v === undefined || v === "") ? ""
    : `<c r="${numToCol(c + 1)}${i + 1}" t="inlineStr"><is><t xml:space="preserve">${xe(v)}</t></is></c>`).join("")}</row>`).join("");
  const largeur = Math.max(1, ...lignes.map((l) => l.length));
  const cols = Array.from({ length: largeur }, (_, c) => `<col min="${c + 1}" max="${c + 1}" width="${c === largeur - 1 ? 40 : 16}" customWidth="1"/>`).join("");
  files[`xl/worksheets/sheet${n}.xml`] = enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:${numToCol(largeur)}${lignes.length}"/><cols>${cols}</cols><sheetData>${rows}</sheetData></worksheet>`);
  files["xl/workbook.xml"] = enc.encode(wbx);
  files["xl/_rels/workbook.xml.rels"] = enc.encode(rels);
  files["[Content_Types].xml"] = enc.encode(ct);
  return writeZip(Object.entries(files).map(([name, data]) => ({ name, data })));
}
