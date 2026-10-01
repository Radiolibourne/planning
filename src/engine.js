// ---------------------------------------------------------------- Moteur de planning
const HALVES = ["M", "AM"];
const HALF_LABEL = { M: "Matin", AM: "Après-midi" };
const JOURS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];
const JABR = ["Lun", "Mar", "Mer", "Jeu", "Ven"];
const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

const W = { pref: 30, sciWeek: 800, sciRef: 800, remoteShort: 250, remoteExtra: 20, balSlope: 4.0, ttShort: 150, ttHalf: 60 };
// Télétravail : chaque poste « faisable à distance » a un jumeau « <CODE>-TT » rattaché au site virtuel TT_SITE.
// Le jumeau compte pour la couverture du poste d'origine ; un jour de télétravail ne se mélange pas avec une présence sur site.
const TT_SITE = "Télétravail";
const TT_SUFFIX = "-TT";
const wPrio = (p) => 1100 - 100 * p;

// Dates = nombre de jours depuis le 01/01/1970 (UTC). Excel : série = jours + 25569.
const EXCEL_EPOCH = 25569;
const dayFromExcel = (n) => Math.floor(n) - EXCEL_EPOCH;
const weekday = (d) => (d + 3) % 7; // 0 = lundi
const mondayOf = (d) => d - weekday(d);
function dayToDate(d) { return new Date(d * 86400000); }
function fmtDay(d, withYear = true) {
  const x = dayToDate(d);
  const dd = String(x.getUTCDate()).padStart(2, "0"), mm = String(x.getUTCMonth() + 1).padStart(2, "0");
  return withYear ? `${dd}/${mm}/${x.getUTCFullYear()}` : `${dd}/${mm}`;
}
function ymd(d) { const x = dayToDate(d); return { y: x.getUTCFullYear(), m: x.getUTCMonth() + 1, d: x.getUTCDate() }; }
function dayFromYMD(y, m, d) { return Math.round(Date.UTC(y, m - 1, d) / 86400000); }

const norm = (v) => (v === null || v === undefined ? "" : String(v).trim());
const low = (v) => norm(v).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
function asDay(v) {
  if (typeof v === "number") return dayFromExcel(v);
  const s = norm(v);
  let m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (m) return dayFromYMD(+m[3], +m[2], +m[1]);
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return dayFromYMD(+m[1], +m[2], +m[3]);
  return null;
}
function asMinutes(v, def) {
  if (typeof v === "number") return Math.round((v % 1) * 1440);
  const m = /^(\d{1,2})[:hH](\d{2})/.exec(norm(v));
  return m ? +m[1] * 60 + +m[2] : def;
}
const JOURS_LOW = JOURS.map(low);

function readParams(S) {
  const need = (n) => { if (!S[n]) throw new Error(`Onglet « ${n} » introuvable dans le classeur de paramètres.`); return S[n]; };
  const P = {};
  let ws = need("Paramètres");
  const kv = {};
  for (let r = 5; r <= ws.maxRow; r++) if (ws.get(r, 1) !== null) kv[norm(ws.get(r, 1))] = ws.get(r, 2);
  P.start = asDay(kv["Début de période"]);
  P.end = asDay(kv["Fin de période"]);
  P.refA = asDay(kv["Lundi de référence semaine A"]);
  if (P.start === null || P.end === null) throw new Error("Période (début / fin) non renseignée dans l'onglet Paramètres.");
  if (P.refA === null) P.refA = mondayOf(P.start);
  P.oneSite = !low(kv["Un seul site par jour"] ?? "Oui").startsWith("n");
  const int = (v, d) => (v === null || v === undefined || v === "" ? d : parseInt(v, 10));
  P.remoteTarget = int(kv["Déplacements hors Libourne : cible par semaine (jours)"], 1);
  P.remoteMax = int(kv["Déplacements hors Libourne : maximum par semaine (jours)"], 2);
  P.sciMin = int(kv["Scanner interventionnel : minimum de vacations par semaine"], 2);
  P.sciRefs = norm(kv["Scanner interventionnel : référents (1 vacation chacun par semaine)"]).replace(/;/g, ",")
    .split(",").map((x) => x.trim().toUpperCase()).filter(Boolean);
  P.ttTarget = int(kv["Télétravail : jours par semaine (cible)"], 1);
  P.ttMax = int(kv["Télétravail : maximum de jours par semaine"], 1);
  P.ttMaxDay = int(kv["Télétravail : maximum de médecins par jour"], 0); // 0 = sans limite
  P.timeLimit = Math.min(Math.max(+(kv["Temps de calcul maximum (secondes)"] || 20), 3), 120);

  ws = need("Sites");
  P.sites = {};
  for (let r = 5; r <= ws.maxRow; r++) {
    const s = norm(ws.get(r, 1));
    if (!s) continue;
    P.sites[s] = {
      adresse: norm(ws.get(r, 2)),
      M: [asMinutes(ws.get(r, 3), 510), asMinutes(ws.get(r, 4), 780)],
      AM: [asMinutes(ws.get(r, 5), 810), asMinutes(ws.get(r, 6), 1080)],
    };
  }
  P.siteList = Object.keys(P.sites);
  P.mainSite = P.siteList[0];

  ws = need("Postes");
  const dcols = [];
  let ttCol = 0;
  for (let c = 1; c <= ws.maxCol; c++) {
    const h = norm(ws.get(4, c)).split(/\s+/);
    if (h.length === 2 && JABR.includes(h[0])) dcols.push([c, JABR.indexOf(h[0]), h[1].toUpperCase() === "AM" ? "AM" : "M"]);
    if (low(ws.get(4, c)).startsWith("teletravail")) ttCol = c;
  }
  P.postes = {};
  for (let r = 5; r <= ws.maxRow; r++) {
    const code = norm(ws.get(r, 1)).toUpperCase();
    if (!code) continue;
    const opens = new Set();
    for (const [c, j, h] of dcols) if (norm(ws.get(r, c)).toUpperCase() === "X") opens.add(j + h);
    const needN = int(ws.get(r, 5), 1);
    const mn = Math.min(int(ws.get(r, 6), needN), needN);
    const pm = int(ws.get(r, 7), 5);
    P.postes[code] = {
      code, label: norm(ws.get(r, 2)) || code, site: norm(ws.get(r, 3)), group: norm(ws.get(r, 4)) || code,
      need: needN, min: mn, prioMin: pm, prioSup: int(ws.get(r, 8), pm), opens,
      remote: ttCol > 0 && /^(o|x)/.test(low(ws.get(r, ttCol))),
    };
  }
  const posteCodes = Object.keys(P.postes);

  ws = need("Médecins");
  const hdr = [];
  for (let c = 1; c <= ws.maxCol; c++) hdr[c] = norm(ws.get(4, c)).toUpperCase();
  P.docs = {};
  const ttHdr = hdr.findIndex((h) => h && low(h).startsWith("teletravail"));
  // demi-journées au format « Jeu M; Lun AM » (un jour seul = journée entière)
  const halfSet = (v) => {
    const out = new Set();
    for (const tok of norm(v).replace(/,/g, ";").split(";")) {
      const p = tok.trim().split(/\s+/);
      const j = JABR.findIndex((x) => low(x) === low(p[0]).slice(0, 3));
      if (j < 0) continue;
      if (p.length >= 2) out.add(j + (p[1].toUpperCase() === "AM" ? "AM" : "M"));
      else { out.add(j + "M"); out.add(j + "AM"); }
    }
    return out;
  };
  const days = (v) => new Set(norm(v).replace(/;/g, ",").split(",").map(low).map((x) => JOURS_LOW.indexOf(x)).filter((i) => i >= 0));
  for (let r = 5; r <= ws.maxRow; r++) {
    const ini = norm(ws.get(r, 1)).toUpperCase();
    if (!ini || low(ws.get(r, 9)).startsWith("n")) continue;
    const indispo = new Set();
    for (const tok of norm(ws.get(r, 7)).replace(/,/g, ";").split(";")) {
      const p = tok.trim().split(/\s+/);
      if (p.length === 2) {
        const j = JABR.findIndex((x) => low(x) === low(p[0]).slice(0, 3));
        if (j >= 0) indispo.add(j + (p[1].toUpperCase() === "AM" ? "AM" : "M"));
      }
    }
    // Télétravail : vide / Non = jamais ; Oui = n'importe quel jour ; « Jeu AM » = seulement ces demi-journées
    let tt = null;
    if (ttHdr > 0) {
      const v = low(ws.get(r, ttHdr));
      if (v.startsWith("o")) tt = "all";
      else if (v && !v.startsWith("n")) { const hs = halfSet(ws.get(r, ttHdr)); if (hs.size) tt = hs; }
    }
    const comp = {};
    for (let c = 1; c < hdr.length; c++) {
      if (!P.postes[hdr[c]]) continue;
      const v = low(ws.get(r, c));
      if (v.startsWith("pr")) comp[hdr[c]] = 2;
      else if (v.startsWith("o") || v === "x") comp[hdr[c]] = 1;
    }
    const q = ws.get(r, 4);
    P.docs[ini] = {
      ini, nom: norm(ws.get(r, 2)), statut: norm(ws.get(r, 3)),
      quotite: typeof q === "number" ? q : (parseFloat(norm(q).replace("%", "").replace(",", ".")) / (norm(q).includes("%") ? 100 : 1) || 1),
      offA: days(ws.get(r, 5)), offB: days(ws.get(r, 6)), indispo, spec: norm(ws.get(r, 8)), comp, tt,
    };
  }
  if (!Object.keys(P.docs).length) throw new Error("Aucun médecin actif dans l'onglet Médecins.");

  P.abs = [];
  if (S["Absences"]) {
    ws = S["Absences"];
    for (let r = 5; r <= ws.maxRow; r++) {
      const ini = norm(ws.get(r, 1)).toUpperCase(), d1 = asDay(ws.get(r, 2));
      if (!ini || d1 === null) continue;
      const d2 = asDay(ws.get(r, 3)) ?? d1;
      const per = low(ws.get(r, 4));
      const halves = per.startsWith("m") ? ["M"] : per.startsWith("a") ? ["AM"] : HALVES;
      P.abs.push({ ini, d1, d2, halves, motif: norm(ws.get(r, 5)) });
    }
  }
  P.forced = [];
  if (S["Imposées"]) {
    ws = S["Imposées"];
    for (let r = 5; r <= ws.maxRow; r++) {
      const d = asDay(ws.get(r, 1));
      if (d === null || !ws.get(r, 3)) continue;
      P.forced.push({ d, h: low(ws.get(r, 2)).startsWith("a") ? "AM" : "M", ini: norm(ws.get(r, 3)).toUpperCase(), p: norm(ws.get(r, 4)).toUpperCase() });
    }
  }
  P.feries = new Map();
  if (S["Fériés"]) {
    ws = S["Fériés"];
    for (let r = 5; r <= ws.maxRow; r++) { const d = asDay(ws.get(r, 1)); if (d !== null) P.feries.set(d, norm(ws.get(r, 2))); }
  }
  // fermetures ponctuelles d'un poste (travaux, remplacement de machine…)
  P.closures = [];
  if (S["Fermetures"]) {
    ws = S["Fermetures"];
    for (let r = 5; r <= ws.maxRow; r++) {
      const code = norm(ws.get(r, 1)).toUpperCase(), d1 = asDay(ws.get(r, 2));
      if (!code || d1 === null) continue;
      if (!P.postes[code]) throw new Error(`Onglet Fermetures, ligne ${r} : le poste « ${code} » n'existe pas dans l'onglet Postes.`);
      const per = low(ws.get(r, 4));
      P.closures.push({ code, d1, d2: asDay(ws.get(r, 3)) ?? d1, halves: per.startsWith("m") ? ["M"] : per.startsWith("a") ? ["AM"] : HALVES, motif: norm(ws.get(r, 5)) });
    }
  }
  // télétravail : postes jumeaux sur le site virtuel « Télétravail »
  const ttBase = posteCodes.filter((c) => P.postes[c].remote);
  P.tt = ttBase.length > 0 && Object.values(P.docs).some((d) => d.tt);
  if (P.tt) {
    P.sites[TT_SITE] = { adresse: "", M: P.sites[P.mainSite].M, AM: P.sites[P.mainSite].AM };
    P.siteList.push(TT_SITE);
    for (const c of ttBase) {
      const x = P.postes[c], code = c + TT_SUFFIX;
      P.postes[code] = { ...x, code, site: TT_SITE, remote: false, base: c, tt: true };
      for (const doc of Object.values(P.docs)) if (doc.tt && doc.comp[c]) doc.comp[code] = doc.comp[c];
    }
  }
  const allCodes = Object.keys(P.postes);
  // postes rangés par site (ordre des sites, puis ordre de l'onglet)
  P.posteOrder = allCodes.slice().sort((a, b) => {
    const ia = P.siteList.indexOf(P.postes[a].site), ib = P.siteList.indexOf(P.postes[b].site);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || allCodes.indexOf(a) - allCodes.indexOf(b);
  });
  return P;
}

// ---------------------------------------------------------------- Construction du problème
function buildProblem(P) {
  const days = [];
  for (let d = P.start; d <= P.end; d++) if (weekday(d) < 5 && !P.feries.has(d)) days.push(d);
  if (!days.length) throw new Error("Aucun jour ouvré dans la période choisie.");
  const weeks = [...new Set(days.map(mondayOf))].sort((a, b) => a - b);
  const weekType = new Map(weeks.map((w) => [w, Math.floor((w - P.refA) / 7) % 2 === 0 ? "A" : "B"]));
  const slots = [];
  days.forEach((d, di) => HALVES.forEach((h) => slots.push({ d, h, di, w: weeks.indexOf(mondayOf(d)), key: d + h })));
  const docs = Object.keys(P.docs);
  const postes = P.posteOrder;
  const D = docs.length, S = slots.length, NP = postes.length;
  const pIdx = Object.fromEntries(postes.map((p, i) => [p, i]));
  const po = postes.map((p) => P.postes[p]);
  const groups = [...new Set(po.map((x) => x.group))];
  const pGroup = po.map((x) => groups.indexOf(x.group));
  const pSite = po.map((x) => P.siteList.indexOf(x.site));
  const mainSiteIdx = 0;
  const pTT = po.map((x) => !!x.tt);
  const pBase = po.map((x, i) => (x.tt ? pIdx[x.base] : i));
  const pRemote = pSite.map((s, i) => s !== mainSiteIdx && !pTT[i]);   // déplacement = autre site réel

  const absIdx = new Map();
  for (const a of P.abs) for (let d = a.d1; d <= a.d2; d++) for (const h of a.halves) absIdx.set(a.ini + "|" + d + h, a.motif || "Absence");

  const status = docs.map((ini) => slots.map((s) => {
    const doc = P.docs[ini];
    const off = weekType.get(mondayOf(s.d)) === "A" ? doc.offA : doc.offB;
    if (absIdx.has(ini + "|" + s.d + s.h)) return "ABS";
    if (off.has(weekday(s.d))) return "OFF";
    if (doc.indispo.has(weekday(s.d) + s.h)) return "INDISPO";
    return "";
  }));
  const closed = new Set();
  for (const c of P.closures || []) for (let d = c.d1; d <= c.d2; d++) for (const h of c.halves) closed.add(c.code + "|" + d + h);
  const open = slots.map((s) => po.map((x) => x.opens.has(weekday(s.d) + s.h) && !closed.has((x.base || x.code) + "|" + s.d + s.h)));
  const elig = docs.map((ini) => postes.map((p) => P.docs[ini].comp[p] || 0));
  // choix possibles pour (médecin, créneau)
  const choices = docs.map((_, d) => slots.map((_, s) => {
    if (status[d][s] !== "") return [];
    const c = [];
    const tt = P.docs[docs[d]].tt, wh = weekday(slots[s].d) + slots[s].h;
    for (let p = 0; p < NP; p++) {
      if (!open[s][p] || !elig[d][p]) continue;
      if (pTT[p] && !(tt === "all" || (tt && tt.has(wh)))) continue;
      c.push(p);
    }
    return c;
  }));
  const availHalf = docs.map((_, d) => status[d].filter((x) => x === "").length);
  const refAvail = Math.max(1, ...availHalf);
  const balScale = availHalf.map((a) => refAvail / Math.max(a, 1));

  const slotsOfDay = days.map((_, di) => [2 * di, 2 * di + 1]);
  const daysOfWeek = weeks.map((w) => days.map((d, di) => (mondayOf(d) === w ? di : -1)).filter((x) => x >= 0));
  // déplacements : possible ? jours disponibles ?
  const remotePossible = docs.map((_, d) => weeks.map((_, w) => daysOfWeek[w].some((di) =>
    slotsOfDay[di].some((s) => choices[d][s].some((p) => pRemote[p])))));
  const availDays = docs.map((_, d) => weeks.map((_, w) => daysOfWeek[w].filter((di) =>
    slotsOfDay[di].some((s) => status[d][s] === "")).length));
  // télétravail possible cette semaine ?
  const ttPossible = docs.map((_, d) => weeks.map((_, w) => daysOfWeek[w].some((di) =>
    slotsOfDay[di].some((s) => choices[d][s].some((p) => pTT[p])))));

  // scanner interventionnel
  const sci = pIdx["SCI"];
  const sciSlots = weeks.map((_, w) => sci === undefined ? [] :
    slots.map((s, i) => i).filter((i) => slots[i].w === w && open[i][sci]));
  const refIdx = P.sciRefs.map((r) => docs.indexOf(r)).filter((i) => i >= 0);
  const refPossible = weeks.map((_, w) => refIdx.map((d) => sciSlots[w].some((s) => choices[d][s].includes(sci))));
  const sciAnyPossible = weeks.map((_, w) => sciSlots[w].some((s) => docs.some((_, d) => choices[d][s].includes(sci))));

  // affectations imposées
  const fixed = docs.map(() => new Int16Array(S).fill(-2)); // -2 = libre
  const warnings = [];
  for (const f of P.forced) {
    const d = docs.indexOf(f.ini), s = slots.findIndex((x) => x.d === f.d && x.h === f.h), p = pIdx[f.p];
    if (d < 0 || s < 0 || p === undefined || !choices[d][s].includes(p)) {
      warnings.push(`Affectation imposée impossible (poste fermé, médecin indisponible ou non compétent) : ${f.ini} ${f.p} le ${fmtDay(f.d, false)} ${HALF_LABEL[f.h]}`);
    } else fixed[d][s] = p;
  }
  return {
    P, days, weeks, weekType, slots, docs, postes, po, D, S, NP, pIdx, groups, pGroup, pSite, pRemote, pTT, pBase, ttPossible, status, open,
    elig, choices, balScale, slotsOfDay, daysOfWeek, remotePossible, availDays, sci, sciSlots, refIdx, refPossible,
    sciAnyPossible, fixed, warnings,
  };
}

// ---------------------------------------------------------------- État + objectif incrémental
class State {
  constructor(pr) {
    this.pr = pr;
    const { D, S, NP, weeks, groups } = pr;
    this.a = Array.from({ length: D }, () => new Int16Array(S).fill(-1));
    this.cnt = Array.from({ length: S }, () => new Int16Array(NP));
    this.occ = Array.from({ length: S }, () => Array.from({ length: NP }, () => []));
    this.gc = Array.from({ length: D }, () => new Int32Array(groups.length));
    this.covV = Array.from({ length: S }, () => new Float64Array(NP));
    this.balV = Array.from({ length: D }, () => new Float64Array(groups.length));
    this.remV = Array.from({ length: D }, () => new Float64Array(weeks.length));
    this.sciV = new Float64Array(weeks.length);
    this.ttV = new Float64Array(D);
    this.ttDayN = new Int16Array(pr.days.length);   // médecins en télétravail ce jour
    this.pref = 0;
    for (let s = 0; s < S; s++) for (let p = 0; p < NP; p++) this.covV[s][p] = this.covCost(s, p);
    for (let d = 0; d < D; d++) for (let w = 0; w < weeks.length; w++) this.remV[d][w] = this.remCost(d, w);
    for (let w = 0; w < weeks.length; w++) this.sciV[w] = this.sciCost(w);
    for (let d = 0; d < D; d++) this.ttV[d] = this.ttCost(d);
  }
  covCost(s, p) {
    const pr = this.pr;
    if (!pr.open[s][p] || pr.pTT[p]) return 0;   // un jumeau télétravail compte pour son poste d'origine
    const x = pr.po[p], n = this.cnt[s][p];
    return -(wPrio(x.prioMin) * Math.min(n, x.min) + wPrio(x.prioSup) * Math.max(0, Math.min(n, x.need) - x.min));
  }
  balCost(d, g) { const n = this.gc[d][g]; return W.balSlope * this.pr.balScale[d] * n * (n + 1) / 2; }
  remDays(d, w) {
    const pr = this.pr;
    let R = 0;
    for (const di of pr.daysOfWeek[w]) {
      const [s1, s2] = pr.slotsOfDay[di];
      const p1 = this.a[d][s1], p2 = this.a[d][s2];
      if ((p1 >= 0 && pr.pRemote[p1]) || (p2 >= 0 && pr.pRemote[p2])) R++;
    }
    return R;
  }
  remCost(d, w) {
    const pr = this.pr, P = pr.P;
    if (!pr.remotePossible[d][w]) return 0;
    const R = this.remDays(d, w);
    let c = W.remoteExtra * Math.max(0, R - P.remoteTarget);
    if (P.remoteTarget > 0 && pr.availDays[d][w] >= 3) c += W.remoteShort * Math.max(0, P.remoteTarget - R);
    return c;
  }
  // jours de télétravail de la semaine ; demi-journées libres un jour de télétravail
  ttDays(d, w) {
    const pr = this.pr;
    let n = 0, half = 0;
    for (const di of pr.daysOfWeek[w]) {
      const [s1, s2] = pr.slotsOfDay[di];
      const p1 = this.a[d][s1], p2 = this.a[d][s2];
      const t1 = p1 >= 0 && pr.pTT[p1], t2 = p2 >= 0 && pr.pTT[p2];
      if (t1 || t2) {
        n++;
        if ((t1 && p2 < 0 && pr.choices[d][s2].length) || (t2 && p1 < 0 && pr.choices[d][s1].length)) half++;
      }
    }
    return [n, half];
  }
  // coût sur toute la période : semaines sans télétravail, pénalité croissante (répartition équitable entre médecins)
  ttCost(d) {
    const pr = this.pr, P = pr.P;
    if (!P.tt) return 0;
    let manque = 0, half = 0;
    for (let w = 0; w < pr.weeks.length; w++) {
      if (!pr.ttPossible[d][w]) continue;
      const [n, h] = this.ttDays(d, w);
      manque += Math.max(0, P.ttTarget - n); half += h;
    }
    return W.ttShort * manque * (manque + 1) / 2 + W.ttHalf * half;
  }
  isTTDay(d, di) {
    const pr = this.pr, [s1, s2] = pr.slotsOfDay[di];
    const p1 = this.a[d][s1], p2 = this.a[d][s2];
    return (p1 >= 0 && pr.pTT[p1]) || (p2 >= 0 && pr.pTT[p2]);
  }
  sciCount(w, d = -1) {
    const pr = this.pr;
    let n = 0;
    for (const s of pr.sciSlots[w]) {
      if (d < 0) n += this.cnt[s][pr.sci];
      else if (this.a[d][s] === pr.sci) n++;
    }
    return n;
  }
  sciCost(w) {
    const pr = this.pr;
    if (pr.sci === undefined || !pr.sciSlots[w].length) return 0;
    let c = 0;
    const mn = Math.min(pr.P.sciMin, pr.sciSlots[w].length);
    if (mn > 0 && pr.sciAnyPossible[w]) c += W.sciWeek * Math.max(0, mn - this.sciCount(w));
    pr.refIdx.forEach((d, k) => { if (pr.refPossible[w][k] && this.sciCount(w, d) === 0) c += W.sciRef; });
    return c;
  }
  total() {
    let t = this.pref;
    for (const r of this.covV) for (const v of r) t += v;
    for (const r of this.balV) for (const v of r) t += v;
    for (const r of this.remV) for (const v of r) t += v;
    for (const v of this.sciV) t += v;
    for (const v of this.ttV) t += v;
    return t;
  }
  // modification brute (sans objectif)
  set(d, s, p) {
    const pr = this.pr, old = this.a[d][s];
    if (old === p) return;
    const di = pr.slots[s].di, avant = pr.P.tt && this.isTTDay(d, di);
    // comptes et occupants rangés sous le poste d'origine (le jumeau télétravail occupe la même place)
    if (old >= 0) {
      const b = pr.pBase[old];
      this.cnt[s][b]--; const o = this.occ[s][b]; o.splice(o.indexOf(d), 1);
      this.gc[d][pr.pGroup[old]]--; if (pr.elig[d][old] === 2) this.pref += W.pref;
    }
    if (p >= 0) {
      const b = pr.pBase[p];
      this.cnt[s][b]++; this.occ[s][b].push(d);
      this.gc[d][pr.pGroup[p]]++; if (pr.elig[d][p] === 2) this.pref -= W.pref;
    }
    this.a[d][s] = p;
    if (pr.P.tt) { const apres = this.isTTDay(d, di); if (apres !== avant) this.ttDayN[di] += apres ? 1 : -1; }
  }
  snapshot() { return this.a.map((r) => Int16Array.from(r)); }
}

// Contraintes dures locales à un médecin sur un jour / une semaine
function hardOK(st, d, s) {
  const pr = st.pr, P = pr.P, slot = pr.slots[s];
  const [s1, s2] = pr.slotsOfDay[slot.di];
  const p1 = st.a[d][s1], p2 = st.a[d][s2];
  if (P.oneSite && p1 >= 0 && p2 >= 0 && pr.pSite[p1] !== pr.pSite[p2]) return false;
  const w = slot.w;
  if (P.tt) {
    // un jour de télétravail ne se mélange pas avec une présence sur site
    if (p1 >= 0 && p2 >= 0 && pr.pTT[p1] !== pr.pTT[p2]) return false;
    if (P.ttMaxDay > 0 && st.ttDayN[slot.di] > P.ttMaxDay) return false;
    if (st.ttDays(d, w)[0] > P.ttMax) return false;
  }
  if (st.remDays(d, w) > P.remoteMax) return false;
  if (pr.sci !== undefined) {
    const k = pr.refIdx.indexOf(d);
    if (k >= 0) {
      const otherPresent = pr.refIdx.some((o, kk) => kk !== k && pr.refPossible[w][kk]);
      if (st.sciCount(w, d) > (otherPresent ? 1 : 2)) return false;
    }
  }
  return true;
}

// Applique une liste de changements [d, s, p] ; renvoie le delta d'objectif et un journal d'annulation (ou null si contrainte violée)
function applyMove(st, changes) {
  const pr = st.pr;
  const cov = new Map(), bal = new Map(), rem = new Map(), sciW = new Set(), tt = new Map();
  const journal = [];
  const pref0 = st.pref;
  for (const [d, s, p] of changes) {
    const old = st.a[d][s];
    if (old === p) continue;
    const w = pr.slots[s].w;
    for (const q of [old, p]) if (q >= 0) {
      const b = pr.pBase[q];
      const k = s * 64 + b; if (!cov.has(k)) cov.set(k, st.covV[s][b]);
      const kb = d * 64 + pr.pGroup[q]; if (!bal.has(kb)) bal.set(kb, st.balV[d][pr.pGroup[q]]);
      if (q === pr.sci) sciW.add(w);
    }
    const kr = d * 64 + w; if (!rem.has(kr)) rem.set(kr, st.remV[d][w]);
    if (!tt.has(d)) tt.set(d, st.ttV[d]);
    journal.push([d, s, old]);
    st.set(d, s, p);
  }
  let delta = st.pref - pref0;
  for (const [k, v] of cov) { const s = Math.floor(k / 64), q = k % 64; const nv = st.covCost(s, q); st.covV[s][q] = nv; delta += nv - v; }
  for (const [k, v] of bal) { const d = Math.floor(k / 64), g = k % 64; const nv = st.balCost(d, g); st.balV[d][g] = nv; delta += nv - v; }
  for (const [k, v] of rem) { const d = Math.floor(k / 64), w = k % 64; const nv = st.remCost(d, w); st.remV[d][w] = nv; delta += nv - v; }
  for (const [d, v] of tt) { const nv = st.ttCost(d); st.ttV[d] = nv; delta += nv - v; }
  const sciOld = new Map();
  for (const w of sciW) { sciOld.set(w, st.sciV[w]); const nv = st.sciCost(w); delta += nv - st.sciV[w]; st.sciV[w] = nv; }
  const undo = () => {
    for (let i = journal.length - 1; i >= 0; i--) st.set(journal[i][0], journal[i][1], journal[i][2]);
    for (const [k, v] of cov) st.covV[Math.floor(k / 64)][k % 64] = v;
    for (const [k, v] of bal) st.balV[Math.floor(k / 64)][k % 64] = v;
    for (const [k, v] of rem) st.remV[Math.floor(k / 64)][k % 64] = v;
    for (const [d, v] of tt) st.ttV[d] = v;
    for (const [w, v] of sciOld) st.sciV[w] = v;
  };
  for (const [d, s] of changes) if (!hardOK(st, d, s)) { undo(); return null; }
  return { delta, undo };
}

// ---------------------------------------------------------------- Recuit simulé
function makeRng(seed) {
  let x = seed >>> 0 || 1;
  return () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; };
}

// Propose un mouvement : le médecin d passe sur le poste p au créneau s (ou libre si p = -1)
function proposeChange(st, d, s, p, rng) {
  const pr = st.pr;
  const changes = [[d, s, p]];
  const old = st.a[d][s];
  const sameBase = old >= 0 && p >= 0 && pr.pBase[old] === pr.pBase[p];   // ex. scanner sur site -> scanner en télétravail
  if (p >= 0 && !sameBase && st.cnt[s][pr.pBase[p]] >= pr.po[p].need) {
    const occ = st.occ[s][pr.pBase[p]].filter((o) => pr.fixed[o][s] === -2);
    if (!occ.length) return null;
    const o = occ[Math.floor(rng() * occ.length)];
    changes.push([o, s, old >= 0 && pr.choices[o][s].includes(old) ? old : -1]);
  }
  return changes;
}

async function solve(pr, timeLimitSec, onProgress, seed = 12345) {
  const rng = makeRng(seed);
  const st = new State(pr);
  const { D, S, docs } = pr;
  // affectations imposées
  for (let d = 0; d < D; d++) for (let s = 0; s < S; s++) if (pr.fixed[d][s] >= 0) st.set(d, s, pr.fixed[d][s]);
  // recalcul complet des coûts
  const recompute = () => {
    for (let s = 0; s < S; s++) for (let p = 0; p < pr.NP; p++) st.covV[s][p] = st.covCost(s, p);
    for (let d = 0; d < D; d++) for (let g = 0; g < pr.groups.length; g++) st.balV[d][g] = st.balCost(d, g);
    for (let d = 0; d < D; d++) for (let w = 0; w < pr.weeks.length; w++) st.remV[d][w] = st.remCost(d, w);
    for (let w = 0; w < pr.weeks.length; w++) st.sciV[w] = st.sciCost(w);
    for (let d = 0; d < D; d++) st.ttV[d] = st.ttCost(d);
  };
  recompute();
  const free = [];
  for (let d = 0; d < D; d++) for (let s = 0; s < S; s++) if (pr.choices[d][s].length && pr.fixed[d][s] === -2) free.push([d, s]);
  const freeDays = [];
  for (let d = 0; d < D; d++) pr.days.forEach((_, di) => {
    const [s1, s2] = pr.slotsOfDay[di];
    if (pr.fixed[d][s1] === -2 && pr.fixed[d][s2] === -2 && (pr.choices[d][s1].length || pr.choices[d][s2].length)) freeDays.push([d, di]);
  });
  // créneaux-postes à pourvoir
  const openSP = [];
  for (let s = 0; s < S; s++) for (let p = 0; p < pr.NP; p++) if (pr.open[s][p]) openSP.push([s, p]);  // jumeaux compris
  const docsFor = openSP.map(([s, p]) => { const r = []; for (let d = 0; d < D; d++) if (pr.choices[d][s].includes(p) && pr.fixed[d][s] === -2) r.push(d); return r; });

  let cur = st.total();
  let best = cur, bestSnap = st.snapshot();
  const t0 = performance.now(), limit = timeLimitSec * 1000;
  const T0 = 400, T1 = 0.5;
  let it = 0;
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];

  while (true) {
    const el = performance.now() - t0;
    if (el > limit) break;
    const frac = el / limit;
    // plusieurs cycles de refroidissement
    const cyc = (frac * 3) % 1;
    const T = T0 * Math.pow(T1 / T0, cyc);
    for (let k = 0; k < 4000; k++) {
      it++;
      const r = rng();
      let changes = null;
      if (r < 0.45) {
        const [d, s] = pick(free);
        const ch = pr.choices[d][s];
        const p = rng() < 0.12 ? -1 : ch[Math.floor(rng() * ch.length)];
        if (p === st.a[d][s]) continue;
        changes = proposeChange(st, d, s, p, rng);
      } else if (r < 0.75) {
        const i = Math.floor(rng() * openSP.length);
        const [s, p] = openSP[i];
        if (st.cnt[s][pr.pBase[p]] >= pr.po[p].need && rng() < 0.7) continue;
        const cand = docsFor[i];
        if (!cand.length) continue;
        const d = pick(cand);
        if (st.a[d][s] === p) continue;
        changes = proposeChange(st, d, s, p, rng);
      } else {
        // journée entière sur un même site (déplacements)
        const [d, di] = pick(freeDays);
        const site = Math.floor(rng() * pr.P.siteList.length);
        changes = [];
        for (const s of pr.slotsOfDay[di]) {
          const opts = pr.choices[d][s].filter((p) => pr.pSite[p] === site);
          const p = opts.length && rng() < 0.9 ? pick(opts) : -1;
          const c = proposeChange(st, d, s, p, rng);
          if (!c) { changes = null; break; }
          changes.push(...c);
        }
        if (changes && changes.length === 3 && changes[0][0] === changes[2][0]) {
          // éviter qu'un même médecin déplacé soit replacé deux fois de façon incohérente : ok, appliqué séquentiellement
        }
      }
      if (!changes) continue;
      const res = applyMove(st, changes);
      if (!res) continue;
      if (res.delta <= 0 || rng() < Math.exp(-res.delta / T)) {
        cur += res.delta;
        if (cur < best - 1e-9) { best = cur; bestSnap = st.snapshot(); }
      } else res.undo();
    }
    if (onProgress) onProgress(Math.min(1, el / limit), best, it);
    await new Promise((r) => setTimeout(r, 0));
  }
  // restauration de la meilleure solution
  for (let d = 0; d < D; d++) for (let s = 0; s < S; s++) st.set(d, s, bestSnap[d][s]);
  recompute();
  const assign = new Map(); // key slot|poste -> [ini]
  for (let d = 0; d < D; d++) for (let s = 0; s < S; s++) {
    const p = st.a[d][s];
    if (p >= 0) { const k = s + "|" + p; if (!assign.has(k)) assign.set(k, []); assign.get(k).push(docs[d]); }
  }
  for (const v of assign.values()) v.sort((x, y) => docs.indexOf(x) - docs.indexOf(y));
  return { assign, objective: st.total(), iterations: it, a: bestSnap };
}

// ---------------------------------------------------------------- Contrôles
function checks(pr, R) {
  const { P, slots, docs, postes, po, weeks, days } = pr;
  const out = [];
  const A = R.assign;
  const get = (s, p) => A.get(s + "|" + p) || [];
  const seen = new Map();
  const unknown = new Set();
  slots.forEach((sl, s) => postes.forEach((code, p) => {
    for (const ini of get(s, p)) {
      const d = docs.indexOf(ini);
      const k = ini + "|" + s;
      seen.set(k, [...(seen.get(k) || []), p]);
      if (d < 0) { unknown.add(ini); continue; }
      if (pr.status[d][s] !== "") out.push(["Erreur", `${ini} affecté alors qu'indisponible le ${fmtDay(sl.d, false)} ${HALF_LABEL[sl.h]}`]);
      if (pr.pTT[p] && !pr.choices[d][s].includes(p) && pr.status[d][s] === "") out.push(["Erreur", `${ini} en télétravail (${po[p].base}) le ${fmtDay(sl.d, false)} ${HALF_LABEL[sl.h]} alors que ce n'est pas prévu pour ce médecin ou ce poste`]);
      else if (!pr.elig[d][p]) out.push(["Erreur", `${ini} affecté hors compétence (${code}) le ${fmtDay(sl.d, false)}`]);
    }
  }));
  for (const [k, ps] of seen) if (ps.length > 1) {
    const [ini, s] = k.split("|");
    out.push(["Erreur", `${ini} sur deux postes le ${fmtDay(slots[+s].d, false)} ${HALF_LABEL[slots[+s].h]} (${ps.map((p) => postes[p]).join(", ")})`]);
  }
  for (const ini of unknown) out.push(["Info", `${ini} ne figure pas dans la liste des médecins des paramètres (compétences et absences non vérifiées).`]);
  if (P.oneSite) docs.forEach((ini) => days.forEach((d, di) => {
    const sites = new Set();
    for (const s of pr.slotsOfDay[di]) for (const p of seen.get(ini + "|" + s) || []) sites.add(pr.pSite[p]);
    if (sites.size > 1) out.push(["Erreur", `${ini} sur deux sites le ${fmtDay(d, false)}`]);
  }));
  // nombre de médecins sur un poste, télétravail compris
  const getAll = (s, p) => get(s, p).concat(pr.postes.flatMap((c, q) => (pr.pTT[q] && pr.pBase[q] === p ? get(s, q) : [])));
  const scan = pr.pIdx["SCAN"];
  if (scan !== undefined) slots.forEach((sl, s) => {
    if (pr.open[s][scan] && getAll(s, scan).length < po[scan].min)
      out.push(["Alerte", `Scanner à ${getAll(s, scan).length} médecin(s) le ${fmtDay(sl.d, false)} ${HALF_LABEL[sl.h]}`]);
  });
  if (P.tt) {
    const ttOf = (ini, s) => (seen.get(ini + "|" + s) || []).some((p) => pr.pTT[p]);
    days.forEach((dd, di) => {
      const qui = docs.concat([...unknown]).filter((ini) => pr.slotsOfDay[di].some((s) => ttOf(ini, s)));
      if (P.ttMaxDay > 0 && qui.length > P.ttMaxDay) out.push(["Alerte", `${qui.length} médecins en télétravail le ${fmtDay(dd, false)} (${qui.join(", ")} ; maximum ${P.ttMaxDay})`]);
    });
    docs.forEach((ini, d) => {
      days.forEach((dd, di) => {
        const [s1, s2] = pr.slotsOfDay[di];
        const ps = [...(seen.get(ini + "|" + s1) || []), ...(seen.get(ini + "|" + s2) || [])];
        if (ps.some((p) => pr.pTT[p]) && ps.some((p) => !pr.pTT[p])) out.push(["Erreur", `${ini} en télétravail et sur site le même jour (${fmtDay(dd, false)})`]);
      });
      weeks.forEach((w, wi) => {
        if (!pr.ttPossible[d][wi]) return;
        const n = pr.daysOfWeek[wi].filter((di) => pr.slotsOfDay[di].some((s) => ttOf(ini, s))).length;
        if (n > P.ttMax) out.push(["Alerte", `${ini} : ${n} jours de télétravail la semaine du ${fmtDay(w, false)} (maximum ${P.ttMax})`]);
        else if (n < P.ttTarget) out.push(["Info", `${ini} : pas de télétravail la semaine du ${fmtDay(w, false)}`]);
      });
    });
  }
  const JC = ["lun", "mar", "mer", "jeu", "ven"];
  if (pr.sci !== undefined) weeks.forEach((w, wi) => {
    const ss = pr.sciSlots[wi];
    if (!ss.length) return;
    const filled = ss.map((s) => [s, get(s, pr.sci)]);
    const n = filled.filter((f) => f[1].length).length;
    const detail = filled.map(([s, f]) => `${JC[weekday(slots[s].d)]} ${fmtDay(slots[s].d, false)} ${f.join("/") || "—"}`).join(", ");
    out.push([n >= Math.min(P.sciMin, ss.length) ? "OK" : "Alerte",
      `Scanner interventionnel, semaine du ${fmtDay(w, false)} (${pr.weekType.get(w)}) : ${n}/${ss.length} vacations — ${detail}`]);
    P.sciRefs.forEach((r) => {
      const d = docs.indexOf(r);
      if (d < 0) return;
      const nr = filled.filter((f) => f[1].includes(r)).length;
      if (nr === 0 && ss.some((s) => pr.status[d][s] === "")) out.push(["Alerte", `${r} sans vacation de scanner interventionnel la semaine du ${fmtDay(w, false)}`]);
    });
  });
  docs.forEach((ini, d) => weeks.forEach((w, wi) => {
    const nd = pr.daysOfWeek[wi].filter((di) => pr.slotsOfDay[di].some((s) => (seen.get(ini + "|" + s) || []).some((p) => pr.pRemote[p]))).length;
    if (nd > P.remoteMax) out.push(["Erreur", `${ini} : ${nd} jours hors ${P.mainSite} la semaine du ${fmtDay(w, false)}`]);
    else if (nd < P.remoteTarget && pr.availDays[d][wi] >= 3) out.push(["Info", `${ini} : pas de déplacement hors ${P.mainSite} la semaine du ${fmtDay(w, false)}`]);
  }));
  const items = pr.warnings.map((w) => ["Alerte", w]).concat(out);
  if (!items.some((i) => i[0] === "Erreur")) items.unshift(["OK", "Aucune erreur : compétences, indisponibilités, un poste par demi-journée, un site par jour, maximum de déplacements respectés" + (P.tt ? ", télétravail conforme" : "") + "."]);
  return items;
}

function coverage(pr, R) {
  // le télétravail compte pour le poste d'origine (pas de ligne séparée)
  return pr.postes.map((code, p) => {
    if (pr.pTT[p]) return null;
    let opened = 0, filled = 0, tt = 0;
    pr.slots.forEach((_, s) => {
      if (!pr.open[s][p]) return;
      let n = (R.assign.get(s + "|" + p) || []).length;
      pr.postes.forEach((c, q) => { if (pr.pTT[q] && pr.pBase[q] === p) { const k = (R.assign.get(s + "|" + q) || []).length; n += k; tt += k; } });
      opened += pr.po[p].need; filled += Math.min(n, pr.po[p].need);
    });
    return { code, label: pr.po[p].label, site: pr.po[p].site, opened, filled, tt };
  }).filter(Boolean);
}
