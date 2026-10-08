// ================================================================ RCP : fiches mensuelles (PDF scannés avec texte reconnu)
// pdfMots(bytes)  → mots du PDF avec leur position : [{x, y, s, t}] (y vers le haut, comme dans le PDF)
// lireRcp(mots, medecins, alias) → {mois, an, colonnes, items, inconnus, avert}
// Les fiches sont des tableaux : une ligne par date (colonne de gauche), une colonne par RCP (service + horaire),
// dans chaque case le ou les radiologues, en initiales (« SG/MDP ») ou en nom (« Mr GUERRAB Ayoub, Poste 7349 »).

const RCP_MOIS = ["JANVIER", "FEVRIER", "MARS", "AVRIL", "MAI", "JUIN", "JUILLET", "AOUT", "SEPTEMBRE", "OCTOBRE", "NOVEMBRE", "DECEMBRE"];
const sansAccents = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "");
const W1252 = { 0x80: "€", 0x91: "‘", 0x92: "’", 0x93: "“", 0x94: "”", 0x96: "–", 0x97: "—", 0x9C: "œ" };

function octetsEnTexte(u8, a = 0, b = u8.length) {
  let s = "";
  for (let i = a; i < b; i += 8192) s += String.fromCharCode.apply(null, u8.subarray(i, Math.min(b, i + 8192)));
  return s;
}

async function inflerZlib(u8) {
  const ds = new DecompressionStream("deflate");
  const flux = new Blob([u8]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(flux).arrayBuffer());
}

// Contenus des flux de texte du PDF (non compressés ou FlateDecode ; images ignorées)
async function pdfFlux(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const txt = octetsEnTexte(u8);
  if (!txt.startsWith("%PDF")) throw new Error("Ce fichier n'est pas un PDF.");
  const out = [];
  const re = /\bstream\r?\n/g;
  let m;
  while ((m = re.exec(txt)) && out.length < 500) {
    const debut = m.index + m[0].length;
    const fin = txt.indexOf("endstream", debut);
    if (fin < 0) break;
    const objet = txt.lastIndexOf(" obj", m.index);
    const dict = txt.slice(objet < 0 ? Math.max(0, m.index - 400) : objet, m.index);
    re.lastIndex = fin + 9;
    if (/\/Subtype\s*\/Image|\/DCTDecode|\/JPXDecode|\/CCITTFax|\/JBIG2/.test(dict)) continue;
    let f2 = fin;
    while (f2 > debut && (u8[f2 - 1] === 10 || u8[f2 - 1] === 13)) f2--;   // fin de ligne avant « endstream »
    let brut = u8.subarray(debut, f2);
    if (/\/FlateDecode/.test(dict)) {
      try { brut = await inflerZlib(brut); } catch (e) { continue; }
    } else if (/\/Filter/.test(dict)) continue;
    if (brut.length > 5e6) continue;
    out.push(octetsEnTexte(brut));
  }
  return out;
}

// Lecture des opérateurs de texte d'un flux : Tf, Tm, Td, TD, T*, TL, Tj, TJ, ', "
function motsDuFlux(c, mots) {
  let i = 0, pile = [], fs = 10, tm = [1, 0, 0, 1, 0, 0], lm = [1, 0, 0, 1, 0, 0], tl = 0;
  const n = c.length;
  const emet = (t) => {
    const s = Math.abs(fs * (tm[0] || 1));
    const x = tm[4], y = tm[5];
    if (t.trim()) mots.push({ x, y, s, t });
  };
  const decode = (str) => [...str].map((ch) => W1252[ch.charCodeAt(0)] || ch).join("");
  const ligne = (tx, ty) => { lm = [lm[0], lm[1], lm[2], lm[3], lm[4] + tx * lm[0] + ty * lm[2], lm[5] + tx * lm[1] + ty * lm[3]]; tm = lm.slice(); };
  while (i < n) {
    const ch = c[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === "%") { while (i < n && c[i] !== "\n" && c[i] !== "\r") i++; continue; }
    if (ch === "(") {          // chaîne littérale
      let prof = 1, s = ""; i++;
      while (i < n && prof > 0) {
        const k = c[i];
        if (k === "\\") {
          const e = c[i + 1];
          const esc = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", "(": "(", ")": ")", "\\": "\\" };
          if (e in esc) { s += esc[e]; i += 2; }
          else if (/[0-7]/.test(e)) { const o = /^[0-7]{1,3}/.exec(c.slice(i + 1, i + 4))[0]; s += String.fromCharCode(parseInt(o, 8)); i += 1 + o.length; }
          else { i += 2; }
          continue;
        }
        if (k === "(") prof++;
        if (k === ")" && --prof === 0) { i++; break; }
        s += k; i++;
      }
      pile.push({ str: decode(s) }); continue;
    }
    if (ch === "<" && c[i + 1] !== "<") {   // chaîne hexadécimale
      const fin = c.indexOf(">", i);
      const hex = c.slice(i + 1, fin < 0 ? n : fin).replace(/\s/g, "");
      let s = "";
      for (let k = 0; k < hex.length; k += 2) s += String.fromCharCode(parseInt(hex.substr(k, 2).padEnd(2, "0"), 16));
      pile.push({ str: decode(s) }); i = fin < 0 ? n : fin + 1; continue;
    }
    if (ch === "<" || ch === ">") { i += 2; continue; }   // dictionnaires en ligne : ignorés
    if (ch === "[") { pile.push("["); i++; continue; }
    if (ch === "]") {
      const k = pile.lastIndexOf("[");
      const arr = k < 0 ? [] : pile.splice(k);
      pile.push({ arr: arr.slice(1) }); i++; continue;
    }
    if (ch === "/") { let j = i + 1; while (j < n && !/[\s\/\[\]()<>%{}]/.test(c[j])) j++; pile.push({ name: c.slice(i + 1, j) }); i = j; continue; }
    if (/[0-9+\-.]/.test(ch)) { let j = i + 1; while (j < n && /[0-9.]/.test(c[j])) j++; pile.push(parseFloat(c.slice(i, j)) || 0); i = j; continue; }
    let j = i; while (j < n && !/[\s\/\[\]()<>%{}]/.test(c[j])) j++;
    const op = c.slice(i, j) || c[i]; i = Math.max(j, i + 1);
    const nb = (k) => { const v = pile[pile.length - k]; return typeof v === "number" ? v : 0; };
    switch (op) {
      case "BT": tm = [1, 0, 0, 1, 0, 0]; lm = tm.slice(); break;
      case "Tf": fs = nb(1) || fs; break;
      case "TL": tl = nb(1); break;
      case "Tm": lm = [nb(6), nb(5), nb(4), nb(3), nb(2), nb(1)]; tm = lm.slice(); break;
      case "Td": ligne(nb(2), nb(1)); break;
      case "TD": tl = -nb(1); ligne(nb(2), nb(1)); break;
      case "T*": ligne(0, -tl); break;
      case "Tj": { const v = pile[pile.length - 1]; if (v && v.str !== undefined) emet(v.str); break; }
      case "'": case '"': { ligne(0, -tl); const v = pile[pile.length - 1]; if (v && v.str !== undefined) emet(v.str); break; }
      case "TJ": { const v = pile[pile.length - 1]; if (v && v.arr) emet(v.arr.map((x) => (x && x.str !== undefined ? x.str : (typeof x === "number" && x < -200 ? " " : ""))).join("")); break; }
      default: break;
    }
    if (!/^(\[|\])$/.test(op)) pile = [];
  }
  return mots;
}

async function pdfMots(bytes) {
  const mots = [];
  for (const f of await pdfFlux(bytes)) if (/\b(Tj|TJ)\b/.test(f)) motsDuFlux(f, mots);
  return mots;
}

// Jour du mois lu dans une date abîmée par la reconnaissance : « 0t/70/2026 » → 1, « 73/LO/2026 » → 13, « 7s/70 » → 15
function jourRcp(t) {
  const m = /^\s*([0-3OoQDtlLIi|\]!7Zz])\s*([0-9OoQDtlLIi|\]!SsZzgB?])\s*(?:[\/.]|[17lLI|](?=[0-9OoLlt]{2}\s*[\/.]))/.exec(t);
  if (!m) return null;
  const d1 = { O: 0, o: 0, Q: 0, D: 0, t: 1, l: 1, L: 1, I: 1, i: 1, "|": 1, "]": 1, "!": 1, 7: 1, Z: 2, z: 2 }[m[1]] ?? +m[1];
  const d2 = { O: 0, o: 0, Q: 0, D: 0, t: 1, l: 1, L: 1, I: 1, i: 1, "|": 1, "]": 1, "!": 1, S: 5, s: 5, Z: 2, z: 2, g: 9, B: 8, "?": null }[m[2]] ?? +m[2];
  if (d2 === null || Number.isNaN(d1) || Number.isNaN(d2)) return null;
  const j = d1 * 10 + d2;
  return j >= 1 && j <= 31 ? j : null;
}

// Initiales collées ou mal lues (« EBISG », « JBlMDP », « sG/]B/EB ») découpées selon les initiales connues
function decouperInitiales(brut, connues) {
  const s = sansAccents(brut).toUpperCase().replace(/\]/g, "J").replace(/[^A-Z\/|1!]/g, "");
  const set = new Set(connues.map((x) => x.toUpperCase()));
  const sep = new Set(["/", "|", "1", "!", "I", "L"]);
  const best = new Array(s.length + 1).fill(null);   // best[i] = {res, saut} pour s[0..i)
  best[0] = { res: [], saut: 0 };
  for (let i = 0; i < s.length; i++) {
    if (!best[i]) continue;
    const cand = (j, res, saut) => { if (!best[j] || saut < best[j].saut || (saut === best[j].saut && res.length < best[j].res.length)) best[j] = { res, saut }; };
    if (sep.has(s[i])) cand(i + 1, best[i].res, best[i].saut + (s[i] === "/" ? 0 : 1));
    for (let L = 2; L <= 5 && i + L <= s.length; L++) {
      const w = s.slice(i, i + L);
      if (set.has(w)) cand(i + L, [...best[i].res, w], best[i].saut);
      else if (L === 2 && /^[A-Z]{2}$/.test(w)) cand(i + L, [...best[i].res, w], best[i].saut + 1);   // initiales inconnues du site (ex. médecin parti)
    }
    cand(i + 1, best[i].res, best[i].saut + 3);   // caractère illisible
  }
  const r = best[s.length];
  return r && r.saut < 3 ? r.res : null;
}

// Tableau RCP lu depuis les mots du PDF
// medecins : {INI: nom complet ou ""} ; alias : {NOM_EN_MAJUSCULES: INI} retenus lors des imports précédents
function lireRcp(mots, medecins = {}, alias = {}) {
  const avert = [];
  const M = mots.map((w) => ({ ...w, u: sansAccents(w.t).toUpperCase().trim(), w: Math.max(4, 0.52 * w.s * w.t.length) }));
  // titre : « RCP OCTOBRE 2026 »
  const groupes = [];
  for (const w of M.slice().sort((a, b) => b.y - a.y)) {
    const g = groupes.find((x) => Math.abs(x.y - w.y) < 3);
    if (g) g.mots.push(w); else groupes.push({ y: w.y, mots: [w] });
  }
  const lignesTitre = groupes.map((g) => g.mots.sort((a, b) => a.x - b.x).map((w) => w.u).join(" "));
  let mois = null, an = null;
  for (const l of lignesTitre) {
    const m = /RCP\s+([A-Z]+)\s+(\d{4})/.exec(l.replace(/\s+/g, " "));
    if (m && RCP_MOIS.includes(m[1])) { mois = RCP_MOIS.indexOf(m[1]) + 1; an = +m[2]; break; }
  }
  if (!mois) throw new Error("Mois introuvable : le titre « RCP <MOIS> <ANNÉE> » n'a pas été reconnu dans ce PDF.");
  const svc = M.find((w) => w.u === "SERVICE");
  if (!svc) throw new Error("Tableau introuvable : la case « SERVICE » n'a pas été reconnue.");
  const date = M.find((w) => w.u === "DATE" && w.x < svc.x + 60);
  // colonne des dates : mots à gauche dont le texte commence comme une date
  const xMaxDates = svc.x + svc.w + 25;
  const lignesDates = [];
  const gauche = M.filter((w) => w.x < xMaxDates && w.y < (date ? date.y : svc.y) - 2).sort((a, b) => b.y - a.y);
  for (const w of gauche) {
    const voisins = gauche.filter((v) => Math.abs(v.y - w.y) < 3 && v !== w && v.x > w.x).sort((a, b) => a.x - b.x);
    const j = jourRcp(w.t + voisins.map((v) => v.t).join(""));
    if (j && !lignesDates.some((l) => Math.abs(l.y - w.y) < 6)) lignesDates.push({ y: w.y + w.s * 0.3, jour: j });
  }
  if (!lignesDates.length) throw new Error("Aucune date reconnue dans la colonne de gauche.");
  lignesDates.sort((a, b) => b.y - a.y);
  // en-têtes : mots de la ligne SERVICE (et leur seconde ligne, ex. NEURO- / VASCULAIRE), à droite de « SERVICE »
  const heure = M.find((w) => w.u === "HEURE" || w.u === "EURE");
  const yBasEntete = heure ? heure.y + 2 : svc.y - 12;
  const entetes = M.filter((w) => w.x > svc.x + svc.w + 5 && w.y <= svc.y + 11 && w.y > yBasEntete).sort((a, b) => a.x - b.x);
  const cols = [];
  for (const w of entetes) {
    const c = cols.find((k) => w.x < k.x2 + 4 && w.x + w.w > k.x1 - 4);
    if (c) { c.mots.push(w); c.x1 = Math.min(c.x1, w.x); c.x2 = Math.max(c.x2, w.x + w.w); }
    else cols.push({ x1: w.x, x2: w.x + w.w, mots: [w] });
  }
  cols.sort((a, b) => a.x1 - b.x1);
  for (const c of cols) {
    c.xc = (c.x1 + c.x2) / 2;
    c.service = c.mots.sort((a, b) => b.y - a.y || a.x - b.x).map((w) => w.t.trim()).join(" ").replace(/-\s+/g, "-").replace(/\s+/g, " ");
  }
  if (!cols.length) throw new Error("Aucune colonne (service) reconnue.");
  const bornes = cols.map((c, i) => [i ? (cols[i - 1].xc + c.xc) / 2 : c.x1 - 60, i < cols.length - 1 ? (c.xc + cols[i + 1].xc) / 2 : c.x2 + 80]);
  const colDe = (w) => { const xc = w.x + w.w / 2; return bornes.findIndex(([a, b]) => xc >= a && xc < b); };
  // horaires : entre l'en-tête et la première date
  const yHaut = Math.min(...cols.flatMap((c) => c.mots.map((w) => w.y))) - 2;
  const yPremiere = lignesDates[0].y + (lignesDates.length > 1 ? (lignesDates[0].y - lignesDates[1].y) / 2 : 30);
  const ordre = (a, b) => (Math.abs(a.y - b.y) < 4 ? a.x - b.x : b.y - a.y);
  for (const w of M.filter((w) => w.y < yHaut && w.y > yPremiere && w.x > xMaxDates - 10).sort(ordre)) {
    const k = colDe(w); if (k < 0) continue;
    cols[k].horaire = ((cols[k].horaire || "") + " " + w.t).trim();
  }
  const propre = (h) => String(h || "").replace(/(^|[\s-])t(?=\d)/g, "$11").replace(/(\d)\s*H\s*-\s*(\d)/gi, "$1h-$2").replace(/(\d)H\b/gi, "$1h").replace(/(\d)H(\d)/gi, "$1h$2")
    .replace(/\s*-\s*/g, "-").replace(/(\d+h)\.?\s+(\d+h)/g, "$1-$2").replace(/\s+/g, " ").replace(/TUNDI/i, "LUNDI").trim();
  const colonnes = cols.map((c) => ({ service: c.service, horaire: propre(c.horaire) }));
  // cases
  const connues = Object.keys(medecins);
  const parNom = {};   // NOM → INI d'après le nom saisi dans les paramètres
  for (const [ini, nom] of Object.entries(medecins)) for (const p of sansAccents(nom).toUpperCase().split(/[^A-Z]+/)) if (p.length >= 3) (parNom[p] = parNom[p] || []).push(ini);
  const items = [], inconnus = new Set();
  lignesDates.forEach((l, r) => {
    const haut = r ? (lignesDates[r - 1].y + l.y) / 2 : yPremiere;
    const bas = r < lignesDates.length - 1 ? (l.y + lignesDates[r + 1].y) / 2 : l.y - (r ? (lignesDates[r - 1].y - l.y) / 2 : 30);
    const dansLigne = M.filter((w) => w.y < haut && w.y >= bas && w.x > xMaxDates - 10);
    cols.forEach((c, k) => {
      const ws = dansLigne.filter((w) => colDe(w) === k).sort(ordre);
      if (!ws.length) return;
      const brut = ws.map((w) => w.t.trim()).join(" ").replace(/\s+/g, " ");
      const sans = brut.replace(/\b(po[s5]i?te|poste)\s*[\d.,O]+/gi, " ").replace(/\b[\d.,]{3,}\b/g, " ");
      const ini = [], inc = [];
      // 1. noms (« Mr COUSSY Alexis ») : mot en majuscules d'au moins 3 lettres
      const noms = [], toks = sansAccents(sans).split(/\s+/).filter(Boolean);
      for (let t = 0; t < toks.length; t++) {
        let suite = -1;
        const colle = /^M[RT]([A-Z]{3,})$/.exec(toks[t]);   // « MTGUERRAB »
        if (colle) { toks[t] = colle[1]; suite = t; }
        else if (toks[t] === "M" && /^[rRtT]$/.test(toks[t + 1] || "")) suite = t + 2;
        else if (/^(MR|MT|MME|MLLE|DR|M\.)$/i.test(toks[t])) suite = t + 1;
        if (suite < 0) continue;
        let nom = "", u = suite;
        while (u < toks.length && /^[A-Z'-]+$/.test(toks[u]) && !(toks[u].length === 1 && /^[a-z]/.test(toks[u + 1] || ""))) nom += toks[u++];
        if (nom.length >= 3) { noms.push(nom); t = u - 1; }
      }
      for (const nom of noms) {
        const a = alias[nom] || ((parNom[nom] || []).length === 1 ? parNom[nom][0] : null);
        if (a) ini.push(a); else { inc.push(nom); inconnus.add(nom); }
      }
      // 2. initiales (« SG/AG/MDP »)
      if (!noms.length) {
        const d = decouperInitiales(sans, connues);
        if (d && d.length) ini.push(...d);
        else if (sans.trim()) { inc.push(sans.trim()); avert.push(`${l.jour}/${mois} ${c.service} : « ${brut} » non reconnu`); }
      }
      items.push({ jour: l.jour, col: k, brut, ini: [...new Set(ini)], inconnus: inc });
    });
  });
  return { mois, an, colonnes, items, inconnus: [...inconnus], avert };
}
