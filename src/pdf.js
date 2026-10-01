// ================================================================ PDF minimal (sans dépendance)
// Polices standard Helvetica / Helvetica-Bold, encodage WinAnsi (accents français), A4 paysage.
const HELV_W = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584,761,556,0,222,556,333,1000,556,556,333,1000,667,333,1000,0,611,0,0,222,222,333,333,350,556,1000,333,1000,500,333,944,0,500,667,278,333,556,556,556,556,260,556,333,737,370,556,584,333,737,333,400,584,333,333,333,556,537,278,333,333,365,556,834,834,834,611,667,667,667,667,667,667,1000,722,667,667,667,667,278,278,278,278,722,722,778,778,778,778,778,584,778,722,722,722,722,667,667,611,556,556,556,556,556,556,889,500,556,556,556,556,278,278,278,278,556,556,556,556,556,556,556,584,611,556,556,556,556,500,556,500];
const HELV_B = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584,761,556,0,278,556,500,1000,556,556,333,1000,667,333,1000,0,611,0,0,278,278,500,500,350,556,1000,333,1000,556,333,944,0,500,667,278,333,556,556,556,556,280,556,333,737,370,556,584,333,737,333,400,584,333,333,333,611,556,278,333,333,365,556,834,834,834,611,722,722,722,722,722,722,1000,722,667,667,667,667,278,278,278,278,722,722,778,778,778,778,778,584,778,722,722,722,722,667,667,611,556,556,556,556,556,556,889,556,556,556,556,556,278,278,278,278,611,611,611,611,611,611,611,584,611,611,611,611,611,556,611,556];
const CP1252_EXTRA = { "€": 0x80, "‚": 0x82, "ƒ": 0x83, "„": 0x84, "…": 0x85, "†": 0x86, "‡": 0x87, "ˆ": 0x88, "‰": 0x89, "Š": 0x8a, "‹": 0x8b, "Œ": 0x8c, "Ž": 0x8e,
  "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94, "•": 0x95, "–": 0x96, "—": 0x97, "˜": 0x98, "™": 0x99, "š": 0x9a, "›": 0x9b, "œ": 0x9c, "ž": 0x9e, "Ÿ": 0x9f };
function cp1252(str) {
  const out = [];
  for (const ch of String(str)) {
    const c = ch.codePointAt(0);
    if (c >= 32 && c < 127) out.push(c);
    else if (c >= 160 && c <= 255) out.push(c);
    else if (CP1252_EXTRA[ch] !== undefined) out.push(CP1252_EXTRA[ch]);
    else if (ch === "→") out.push(0x2d, 0x3e);
    else if (c === 0x202f || c === 0x2009) out.push(0x20);
    else out.push(0x3f);
  }
  return out;
}
const pdfNum = (n) => (Math.round(n * 100) / 100).toString();
function pdfColor(hex) {
  const h = hex.replace("#", "");
  return [0, 2, 4].map((i) => pdfNum(parseInt(h.slice(i, i + 2), 16) / 255)).join(" ");
}

class PdfDoc {
  constructor(w = 841.89, h = 595.28) { this.W = w; this.H = h; this.pages = []; }
  addPage() { const p = { ops: [] }; this.pages.push(p); this.cur = p; return p; }
  textWidth(str, size, bold) {
    const t = bold ? HELV_B : HELV_W;
    return cp1252(str).reduce((a, c) => a + (c >= 32 ? t[c - 32] || 500 : 0), 0) * size / 1000;
  }
  // y depuis le haut de la page (plus naturel pour une mise en page de tableau)
  rect(x, y, w, h, fill, stroke, lw = 0.5) {
    const o = this.cur.ops;
    o.push("q");
    if (fill) o.push(pdfColor(fill) + " rg");
    if (stroke) o.push(pdfColor(stroke) + " RG", pdfNum(lw) + " w");
    o.push(`${pdfNum(x)} ${pdfNum(this.H - y - h)} ${pdfNum(w)} ${pdfNum(h)} re`, fill && stroke ? "B" : fill ? "f" : "S", "Q");
  }
  line(x1, y1, x2, y2, color = "#999999", lw = 0.5) {
    this.cur.ops.push("q", pdfColor(color) + " RG", pdfNum(lw) + " w",
      `${pdfNum(x1)} ${pdfNum(this.H - y1)} m ${pdfNum(x2)} ${pdfNum(this.H - y2)} l S`, "Q");
  }
  text(x, y, str, size = 9, opts = {}) {
    const { bold = false, color = "#000000", align = "left" } = opts;
    const w = this.textWidth(str, size, bold);
    const xx = align === "center" ? x - w / 2 : align === "right" ? x - w : x;
    const bytes = cp1252(str);
    let s = "";
    for (const b of bytes) {
      if (b === 0x28 || b === 0x29 || b === 0x5c) s += "\\" + String.fromCharCode(b);
      else if (b < 32 || b > 126) s += "\\" + b.toString(8).padStart(3, "0");
      else s += String.fromCharCode(b);
    }
    this.cur.ops.push("BT", `/${bold ? "F2" : "F1"} ${pdfNum(size)} Tf`, pdfColor(color) + " rg",
      `${pdfNum(xx)} ${pdfNum(this.H - y)} Td`, `(${s}) Tj`, "ET");
  }
  // coupe un texte en lignes de largeur maxW (au mot, puis au caractère si nécessaire)
  wrap(str, size, maxW, bold) {
    const words = String(str).split(/\s+/).filter(Boolean);
    const lines = [];
    let cur = "";
    for (const w of words) {
      const t = cur ? cur + " " + w : w;
      if (this.textWidth(t, size, bold) <= maxW) { cur = t; continue; }
      if (cur) lines.push(cur);
      cur = w;
      while (this.textWidth(cur, size, bold) > maxW && cur.length > 1) {
        let i = cur.length - 1;
        while (i > 1 && this.textWidth(cur.slice(0, i), size, bold) > maxW) i--;
        lines.push(cur.slice(0, i)); cur = cur.slice(i);
      }
    }
    if (cur) lines.push(cur);
    return lines;
  }
  build() {
    const enc = new TextEncoder();
    const objs = [];
    const add = (s) => { objs.push(s); return objs.length; };
    const fontR = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
    const fontB = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
    const pagesId = objs.length + 1 + this.pages.length * 2;
    const kids = [];
    for (const p of this.pages) {
      const content = p.ops.join("\n");
      const cid = add(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
      kids.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${pdfNum(this.W)} ${pdfNum(this.H)}] /Resources << /Font << /F1 ${fontR} 0 R /F2 ${fontB} 0 R >> >> /Contents ${cid} 0 R >>`));
    }
    add(`<< /Type /Pages /Kids [${kids.map((k) => k + " 0 R").join(" ")}] /Count ${kids.length} >>`);
    const catalog = add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
    let out = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
    const offsets = [];
    objs.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
    const xref = out.length;
    out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("");
    out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    // toutes les chaînes ci-dessus sont en ASCII ou en octets échappés : conversion octet à octet
    const bytes = new Uint8Array(out.length);
    for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff;
    return bytes;
  }
}

// ---------------------------------------------------------------- PDF du planning d'une semaine
const PDF_SITES = ["#2F5597", "#548235", "#9A7300", "#7030A0", "#C55A11"];
function weekPdf(pub, lundi) {
  const pdf = new PdfDoc();
  const M = 24, W = pdf.W, H = pdf.H;
  const jours = pub.jours.filter((d) => mondayOf(d) === lundi);
  const sem = pub.semaines.find((s) => s.lundi === lundi);
  const titre = `Planning radiologie — semaine du ${fmtDay(lundi)}${sem ? ` (semaine ${sem.type})` : ""}`;
  const pied = `Publié le ${pub.publieLe ? new Date(pub.publieLe).toLocaleDateString("fr-FR") : "—"} · édité le ${new Date().toLocaleDateString("fr-FR")}`;
  const siteIdx = (site) => Math.max(0, pub.sites.indexOf(site));
  const JL = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];

  const grille = (colonnes, cellule, sousTitre) => {
    pdf.addPage();
    pdf.text(M, M + 12, titre, 14, { bold: true, color: "#1F3864" });
    pdf.text(M, M + 26, sousTitre, 9, { color: "#5D6675" });
    const x0 = M, top = M + 38, wDay = 74, wHalf = 22;
    const wCol = (W - 2 * M - wDay - wHalf) / colonnes.length;
    // en-têtes
    const hBand = 20, hLab = 34;
    pdf.rect(x0, top, wDay + wHalf, hBand + hLab, "#1F3864");
    pdf.text(x0 + (wDay + wHalf) / 2, top + (hBand + hLab) / 2 + 3, "Jour", 9, { bold: true, color: "#FFFFFF", align: "center" });
    let i = 0;
    while (i < colonnes.length) {           // bandeaux de groupes (sites)
      let j = i;
      while (j + 1 < colonnes.length && colonnes[j + 1].groupe === colonnes[i].groupe) j++;
      const x = x0 + wDay + wHalf + i * wCol, w = (j - i + 1) * wCol;
      pdf.rect(x, top, w, hBand, colonnes[i].couleur, "#FFFFFF", 0.6);
      // nom du groupe : coupé aux espaces et aux tirets, sur deux lignes au plus, police réduite si besoin
      const nom = String(colonnes[i].groupe || "").toUpperCase().replace(/-/g, "- ");
      let taille = 7.5, lignes = pdf.wrap(nom, taille, w - 4, true);
      while ((lignes.length > 2 || lignes.some((l) => pdf.textWidth(l, taille, true) > w - 4)) && taille > 5) {
        taille -= 0.5; lignes = pdf.wrap(nom, taille, w - 4, true);
      }
      lignes = lignes.slice(0, 2).map((l) => l.replace(/- /g, "-"));
      lignes.forEach((l, n) => pdf.text(x + w / 2, top + hBand / 2 + 3 - (lignes.length - 1) * 3.6 + n * 7.2, l, taille, { bold: true, color: "#FFFFFF", align: "center" }));
      i = j + 1;
    }
    colonnes.forEach((c, k) => {
      const x = x0 + wDay + wHalf + k * wCol;
      pdf.rect(x, top + hBand, wCol, hLab, c.couleur, "#FFFFFF", 0.6);
      const lignes = pdf.wrap(c.titre, 6.5, wCol - 4, true).slice(0, 3);
      lignes.forEach((l, n) => pdf.text(x + wCol / 2, top + hBand + hLab / 2 - (lignes.length - 1) * 4 + n * 8 + 2.5, l, 6.5, { bold: true, color: "#FFFFFF", align: "center" }));
    });
    // lignes
    let y = top + hBand + hLab;
    const hRow = Math.min(40, (H - y - M - 16) / Math.max(1, jours.length * 2));
    jours.forEach((d, di) => {
      ["M", "AM"].forEach((h) => {
        const fond = di % 2 ? "#F2F4F7" : "#FFFFFF";
        pdf.rect(x0, y, W - 2 * M, hRow, fond);
        if (h === "M") pdf.text(x0 + 4, y + hRow / 2 + 4, `${JL[weekday(d)]} ${fmtDay(d, false)}`, 9, { bold: true });
        pdf.text(x0 + wDay + wHalf / 2, y + hRow / 2 + 3, h === "M" ? "M" : "AM", 7, { color: "#5D6675", align: "center" });
        colonnes.forEach((c, k) => {
          const x = x0 + wDay + wHalf + k * wCol;
          const r = cellule(c, d, h);
          if (r.fond) pdf.rect(x + 0.5, y + 0.5, wCol - 1, hRow - 1, r.fond);
          const t = (r.taille || 7.5) + (hRow > 30 ? 1.5 : 0);
          const lignes = pdf.wrap(r.texte, t, wCol - 4, !!r.gras).slice(0, 2);
          lignes.forEach((l, n) => pdf.text(x + wCol / 2, y + hRow / 2 + t / 2.6 - (lignes.length - 1) * t * 0.6 + n * t * 1.2, l, t,
            { bold: !!r.gras, color: r.couleur || "#1B2330", align: "center" }));
        });
        // grille
        pdf.line(x0, y + hRow, W - M, y + hRow, h === "AM" ? "#7F7F7F" : "#D0D5DD", h === "AM" ? 0.8 : 0.4);
        y += hRow;
      });
    });
    for (let k = 0; k <= colonnes.length; k++) {
      const x = x0 + wDay + wHalf + k * wCol;
      pdf.line(x, top + hBand + hLab, x, y, "#D0D5DD", 0.4);
    }
    pdf.line(x0 + wDay + wHalf, top + hBand + hLab, x0 + wDay + wHalf, y, "#7F7F7F", 0.6);
    pdf.text(M, H - M + 6, pied, 7, { color: "#7F7F7F" });
  };

  // page 1 : par poste
  const colsPostes = pub.ordre.map((code) => {
    const p = pub.postes[code] || { label: code, site: "" };
    return { code, titre: p.label, groupe: p.site, couleur: PDF_SITES[siteIdx(p.site) % PDF_SITES.length], need: p.need || 1 };
  });
  grille(colsPostes, (c, d, h) => {
    const k = caseKey(d, h, c.code);
    if (!(k in pub.cases)) return { texte: "—", couleur: "#9AA3B2" };
    const inis = splitInis(pub.cases[k]);
    if (!inis.length) return { texte: "FERMÉ", couleur: "#B42318", gras: true, fond: "#FBE3DC", taille: 6.5 };
    return { texte: inis.join(" / "), gras: true, fond: inis.length < c.need ? "#FCE9D9" : null };
  }, "Par poste — FERMÉ : poste non pourvu · — : poste non ouvert · fond orange : poste incomplet");

  // page 2 : par médecin
  const pd = perDoctor(pub);
  const docs = Object.keys(pd);
  const ST = { OFF: "repos", ABS: "absent", INDISPO: "indispo" };
  grille(docs.map((ini) => ({ code: ini, titre: ini, groupe: "Médecins", couleur: "#2F5597" })), (c, d, h) => {
    const v = pd[c.code][`${d}_${h}`];
    if (v && v.code) {
      const p = pub.postes[v.code];
      const autre = p && pub.sites.indexOf(p.site) > 0;
      return { texte: v.doublon ? "DOUBLON" : v.code, gras: true, fond: v.doublon ? "#FBE3DC" : autre ? "#E2EFDA" : null, taille: 7 };
    }
    if (v && v.statut) return { texte: ST[v.statut] || v.statut, couleur: "#7F7F7F", fond: "#ECEEF1", taille: 6.5 };
    return { texte: "dispo", couleur: "#B3541E", taille: 6.5 };
  }, "Par médecin — code du poste occupé · fond vert : autre site que " + (pub.mainSite || "le site principal"));
  return pdf.build();
}
