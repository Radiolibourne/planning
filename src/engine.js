// ---------------------------------------------------------------- Moteur de planning
const HALVES = ["M", "AM"];
const HALF_LABEL = { M: "Matin", AM: "Après-midi" };
const JOURS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];
const JABR = ["Lun", "Mar", "Mer", "Jeu", "Ven"];
const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

const W = { pref: 30, sciWeek: 800, sciRef: 800, remoteShort: 250, remoteExtra: 20, balSlope: 4.0, ttShort: 150, ttHalf: 60,
  journee: 400, eviter: 80, vacMiss: 2500, vacBonus: 60, habit: 120, libre: 650, astreinte: 150 };
// Télétravail : chaque poste « faisable à distance » a un jumeau « <CODE>-TT » rattaché au site virtuel TT_SITE.
// Le jumeau compte pour la couverture du poste d'origine ; un jour de télétravail ne se mélange pas avec une présence sur site.
const TT_SITE = "Télétravail";
const TT_SUFFIX = "-TT";
const TT_MARK = "*";   // affichage : « CD* » = CD en télétravail sur ce poste
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
  // binôme (ex. interventionnels) : jamais absents le même jour ; repos déplacé si l'autre est absent
  P.binome = norm(kv["Binôme : jamais absents le même jour"]).replace(/;/g, ",").split(",").map((x) => x.trim().toUpperCase()).filter(Boolean);
  P.binomeRepli = JOURS_LOW.indexOf(low(kv["Binôme : jour de repos de repli"]));
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
  let ttCol = 0, mjCol = 0;
  for (let c = 1; c <= ws.maxCol; c++) {
    const h = norm(ws.get(4, c)).split(/\s+/);
    if (h.length === 2 && JABR.includes(h[0])) dcols.push([c, JABR.indexOf(h[0]), h[1].toUpperCase() === "AM" ? "AM" : "M"]);
    if (!ttCol && low(ws.get(4, c)).startsWith("teletravail")) ttCol = c;
    if (!mjCol && low(ws.get(4, c)).startsWith("matin + apres")) mjCol = c;
  }
  P.postes = {};
  for (let r = 5; r <= ws.maxRow; r++) {
    const code = norm(ws.get(r, 1)).toUpperCase();
    if (!code) continue;
    // ouverture : X = chaque semaine ; A ou B = seulement les semaines A (ou B)
    const opens = new Set(), opensWeek = new Map();
    for (const [c, j, h] of dcols) {
      const v = norm(ws.get(r, c)).toUpperCase();
      if (v === "X" || v === "A" || v === "B") { opens.add(j + h); if (v !== "X") opensWeek.set(j + h, v); }
    }
    // même médecin le matin et l'après-midi : interdit / à éviter / journée entière
    const mj = mjCol ? low(ws.get(r, mjCol)) : "";
    const ttv = ttCol ? low(ws.get(r, ttCol)) : "";
    const needN = int(ws.get(r, 5), 1);
    const mn = Math.min(int(ws.get(r, 6), needN), needN);
    const pm = int(ws.get(r, 7), 5);
    P.postes[code] = {
      code, label: norm(ws.get(r, 2)) || code, site: norm(ws.get(r, 3)), group: norm(ws.get(r, 4)) || code,
      need: needN, min: mn, prioMin: pm, prioSup: int(ws.get(r, 8), pm), opens, opensWeek,
      remote: /^(o|x|t)/.test(ttv), remoteOnly: ttv.startsWith("t"),   // « Toujours » : seulement en télétravail
      journee: mj.startsWith("interdit") ? "demi" : mj.startsWith("evit") ? "eviter" : mj.startsWith("journee") ? "journee" : "",
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
  const inis = (v) => norm(v).replace(/;/g, ",").split(",").map((x) => x.trim().toUpperCase()).filter(Boolean);
  const codesOf = (v, onglet, r) => inis(v).map((c) => { if (!P.postes[c]) throw new Error(`Onglet ${onglet}, ligne ${r} : le poste « ${c} » n'existe pas dans l'onglet Postes.`); return c; });
  // vacations spécialisées (coro, pédiatrie…) : un médecin habilité sur le poste à ces créneaux
  P.vacs = [];
  if (S["Vacations spécialisées"]) {
    ws = S["Vacations spécialisées"];
    for (let r = 5; r <= ws.maxRow; r++) {
      const nom = norm(ws.get(r, 1));
      if (!nom) continue;
      const mn = ws.get(r, 5);
      P.vacs.push({ nom, postes: codesOf(ws.get(r, 2), "Vacations spécialisées", r), creneaux: halfSet(ws.get(r, 3)), hab: inis(ws.get(r, 4)),
        min: mn === null || mn === undefined || norm(mn) === "" ? null : int(mn, 0), si: inis(ws.get(r, 6)) });
    }
  }
  // préférences : un médecin plutôt sur un poste / un site certains jours, ou une demi-journée libre par semaine
  P.prefs = [];
  if (S["Préférences"]) {
    ws = S["Préférences"];
    for (let r = 5; r <= ws.maxRow; r++) {
      const ini = norm(ws.get(r, 1)).toUpperCase();
      if (!ini) continue;
      const type = low(ws.get(r, 2)).startsWith("l") ? "libre" : "poste";
      const cible = norm(ws.get(r, 3));
      let codes = [];
      if (type === "poste") {
        const site = Object.keys(P.sites).find((x) => low(x) === low(cible));
        codes = site ? Object.keys(P.postes).filter((c) => P.postes[c].site === site) : codesOf(cible, "Préférences", r);
      }
      P.prefs.push({ ini, type, cible, codes, creneaux: halfSet(ws.get(r, 4)) });
    }
  }
  // notes affichées sur le planning (réunions, staffs…) : « 1er mardi », « 3e jeudi », « dernier vendredi », « chaque lundi » ou une date
  P.notes = [];
  if (S["Notes"]) {
    ws = S["Notes"];
    for (let r = 5; r <= ws.maxRow; r++) {
      const texte = norm(ws.get(r, 1));
      if (texte) P.notes.push({ texte, quand: ws.get(r, 2), demi: low(ws.get(r, 3)) });
    }
  }
  // astreintes (copiées depuis l'outil d'astreinte) : date + médecin
  P.astreintes = [];
  if (S["Astreintes"]) {
    ws = S["Astreintes"];
    for (let r = 5; r <= ws.maxRow; r++) {
      const d = asDay(ws.get(r, 1)), ini = norm(ws.get(r, 2)).toUpperCase();
      if (d !== null && ini) P.astreintes.push({ d, ini });
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
      P.postes[code] = { ...x, code, site: TT_SITE, remote: false, remoteOnly: false, base: c, tt: true };
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
  const warnings = [], infos = [];
  const slotsOfDay = days.map((_, di) => [2 * di, 2 * di + 1]);
  const daysOfWeek = weeks.map((w) => days.map((d, di) => (mondayOf(d) === w ? di : -1)).filter((x) => x >= 0));
  // binôme : si l'un est absent le jour de repos de l'autre, ce repos passe au jour de repli de la semaine
  const bin = (P.binome || []).map((i) => docs.indexOf(i)).filter((i) => i >= 0);
  if (bin.length === 2 && P.binomeRepli >= 0) {
    const jour = (d, di, v) => slotsOfDay[di].every((s) => status[d][s] === v);
    const absentJour = (d, di) => slotsOfDay[di].every((s) => status[d][s] !== "");
    for (const [x, y] of [[bin[0], bin[1]], [bin[1], bin[0]]]) {
      daysOfWeek.forEach((dis) => dis.forEach((di) => {
        if (!jour(x, di, "OFF") || !absentJour(y, di) || weekday(days[di]) === P.binomeRepli) return;
        const ri = dis.find((k) => weekday(days[k]) === P.binomeRepli);
        if (ri === undefined || !jour(x, ri, "")) {
          warnings.push(`${docs[x]} et ${docs[y]} absents tous les deux le ${fmtDay(days[di], false)} (repos de ${docs[x]} impossible à déplacer au ${JOURS[P.binomeRepli].toLowerCase()})`);
          return;
        }
        for (const s of slotsOfDay[di]) status[x][s] = "";
        for (const s of slotsOfDay[ri]) status[x][s] = "OFF";
        infos.push(`${docs[x]} : repos déplacé du ${JOURS[weekday(days[di])].toLowerCase()} ${fmtDay(days[di], false)} au ${JOURS[P.binomeRepli].toLowerCase()} ${fmtDay(days[ri], false)} (${docs[y]} absent)`);
      }));
    }
  }
  const closed = new Set();
  for (const c of P.closures || []) for (let d = c.d1; d <= c.d2; d++) for (const h of c.halves) closed.add(c.code + "|" + d + h);
  const ouvreSemaine = (x, s) => !x.opensWeek || !x.opensWeek.has(weekday(s.d) + s.h) || x.opensWeek.get(weekday(s.d) + s.h) === weekType.get(mondayOf(s.d));
  const open = slots.map((s) => po.map((x) => x.opens.has(weekday(s.d) + s.h) && ouvreSemaine(x, s) && !closed.has((x.base || x.code) + "|" + s.d + s.h)));
  // poste « toujours en télétravail » : seul son jumeau est proposé (la couverture reste comptée sur le poste)
  const ttOnly = po.map((x) => !!(P.tt && x.remoteOnly && !x.tt));
  const elig = docs.map((ini) => postes.map((p) => P.docs[ini].comp[p] || 0));
  // choix possibles pour (médecin, créneau)
  const choices = docs.map((_, d) => slots.map((_, s) => {
    if (status[d][s] !== "") return [];
    const c = [];
    const tt = P.docs[docs[d]].tt, wh = weekday(slots[s].d) + slots[s].h;
    for (let p = 0; p < NP; p++) {
      if (!open[s][p] || !elig[d][p] || ttOnly[p]) continue;
      if (pTT[p] && !(tt === "all" || (tt && tt.has(wh)))) continue;
      c.push(p);
    }
    return c;
  }));
  const availHalf = docs.map((_, d) => status[d].filter((x) => x === "").length);
  const refAvail = Math.max(1, ...availHalf);
  const balScale = availHalf.map((a) => refAvail / Math.max(a, 1));

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
  for (const f of P.forced) {
    const d = docs.indexOf(f.ini), s = slots.findIndex((x) => x.d === f.d && x.h === f.h), p = pIdx[f.p];
    if (d < 0 || s < 0 || p === undefined || !choices[d][s].includes(p)) {
      warnings.push(`Affectation imposée impossible (poste fermé, médecin indisponible ou non compétent) : ${f.ini} ${f.p} le ${fmtDay(f.d, false)} ${HALF_LABEL[f.h]}`);
    } else fixed[d][s] = p;
  }
  // même médecin matin et après-midi : mode du poste d'origine
  const pMode = po.map((x, i) => po[pBase[i]].journee || "");
  const hasMode = pMode.some(Boolean);

  // vacations spécialisées : une instance par vacation et par semaine
  const vacs = [], slotVac = slots.map(() => []);
  for (const v of P.vacs || []) {
    const ps = v.postes.map((c) => pIdx[c]).filter((x) => x !== undefined);
    const H = v.hab.map((i) => docs.indexOf(i)).filter((i) => i >= 0);
    const cond = v.si.map((i) => docs.indexOf(i));
    weeks.forEach((w, wi) => {
      const ss = slots.map((_, i) => i).filter((i) => slots[i].w === wi && v.creneaux.has(weekday(slots[i].d) + slots[i].h)
        && ps.some((p) => open[i][p]) && cond.every((d) => d >= 0 && status[d][i] === ""));
      if (!ss.length) return;
      const possibles = ss.filter((i) => H.some((d) => ps.some((p) => choices[d][i].includes(p)))).length;
      const min = v.min === null ? possibles : Math.min(v.min, possibles);
      const k = vacs.length;
      vacs.push({ nom: v.nom, w: wi, slots: ss, ps, H, min, obligatoire: v.min === null });
      for (const i of ss) slotVac[i].push(k);
    });
  }
  // préférences (poste/site certains jours, demi-journée libre) et astreintes (IRM 1 l'après-midi) : une instance par médecin et par semaine
  const prefs = [], prefOfDoc = docs.map(() => []);
  for (const f of P.prefs || []) {
    const d = docs.indexOf(f.ini);
    if (d < 0) continue;
    const ps = new Set(postes.map((c, i) => i).filter((i) => f.codes.includes(pBase[i] === i ? postes[i] : po[pBase[i]].code)));
    weeks.forEach((w, wi) => {
      const ss = slots.map((_, i) => i).filter((i) => slots[i].w === wi && f.creneaux.has(weekday(slots[i].d) + slots[i].h) && status[d][i] === "");
      if (!ss.length) return;
      if (f.type === "poste" && !ss.some((i) => choices[d][i].some((p) => ps.has(p)))) return;
      prefOfDoc[d].push(prefs.length);
      prefs.push({ d, w: wi, type: f.type, ss, ps, poids: f.type === "libre" ? W.libre : W.habit, libelle: f.type === "libre" ? `${f.ini} : une demi-journée libre (${f.cible || "créneaux"})` : `${f.ini} : ${f.cible}` });
    });
  }
  const irm1 = pIdx["IRM1"];
  const interv = sci !== undefined ? po[sci].group : null;
  const notes = new Map();
  const ajoutNote = (d, t) => { if (!notes.has(d)) notes.set(d, []); notes.get(d).push(t); };
  for (const a of P.astreintes || []) {
    if (a.d < P.start || a.d > P.end) continue;
    ajoutNote(a.d, `Astreinte : ${a.ini}`);
    const d = docs.indexOf(a.ini), s = slots.findIndex((x) => x.d === a.d && x.h === "AM");
    if (d < 0 || s < 0 || irm1 === undefined || status[d][s] !== "") continue;
    const ps = new Set(postes.map((c, i) => i).filter((i) => pBase[i] === irm1 || (refIdx.includes(d) && interv !== null && po[i].group === interv)));
    if (![...ps].some((p) => choices[d][s].includes(p))) continue;
    prefOfDoc[d].push(prefs.length);
    prefs.push({ d, w: slots[s].w, type: "poste", ss: [s], ps, poids: W.astreinte, libelle: `${a.ini} d'astreinte le ${fmtDay(a.d, false)} : IRM 1 l'après-midi` });
  }
  // notes récurrentes
  const ORD = { "1er": 1, "1re": 1, "premier": 1, "1": 1, "2e": 2, "2eme": 2, "deuxieme": 2, "2": 2, "3e": 3, "3eme": 3, "troisieme": 3, "3": 3, "4e": 4, "4eme": 4, "quatrieme": 4, "4": 4 };
  for (const n of P.notes || []) {
    const suff = n.demi.startsWith("m") ? " (matin)" : n.demi.startsWith("a") ? " (après-midi)" : "";
    const dd = asDay(n.quand);
    if (dd !== null) { if (dd >= P.start && dd <= P.end) ajoutNote(dd, n.texte + suff); continue; }
    const mots = low(n.quand).split(/\s+/);
    const j = JOURS_LOW.indexOf(mots[mots.length - 1]);
    if (j < 0) continue;
    for (let d = P.start; d <= P.end; d++) {
      if (weekday(d) !== j || P.feries.has(d)) continue;
      const rang = Math.floor((ymd(d).d - 1) / 7) + 1, dernier = ymd(d + 7).m !== ymd(d).m;
      const q = mots[0];
      if (q === "chaque" || q === "tous" || (q === "dernier" && dernier) || ORD[q] === rang) ajoutNote(d, n.texte + suff);
    }
  }
  return {
    P, days, weeks, weekType, slots, docs, postes, po, D, S, NP, pIdx, groups, pGroup, pSite, pRemote, pTT, pBase, ttPossible, status, open,
    elig, choices, balScale, slotsOfDay, daysOfWeek, remotePossible, availDays, sci, sciSlots, refIdx, refPossible,
    sciAnyPossible, fixed, warnings, infos, pMode, hasMode, vacs, slotVac, prefs, prefOfDoc, notes,
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
    this.splitV = Array.from({ length: D }, () => new Float64Array(pr.days.length));   // matin / après-midi d'un même poste
    this.vacV = new Float64Array(pr.vacs.length);
    this.habV = new Float64Array(pr.prefs.length);
    this.pref = 0;
    for (let s = 0; s < S; s++) for (let p = 0; p < NP; p++) this.covV[s][p] = this.covCost(s, p);
    for (let d = 0; d < D; d++) for (let w = 0; w < weeks.length; w++) this.remV[d][w] = this.remCost(d, w);
    for (let w = 0; w < weeks.length; w++) this.sciV[w] = this.sciCost(w);
    for (let d = 0; d < D; d++) this.ttV[d] = this.ttCost(d);
    this.recomputeExtras();
  }
  recomputeExtras() {
    const pr = this.pr;
    if (pr.hasMode) for (let d = 0; d < pr.D; d++) for (let di = 0; di < pr.days.length; di++) this.splitV[d][di] = this.splitCost(d, di);
    for (let k = 0; k < pr.vacs.length; k++) this.vacV[k] = this.vacCost(k);
    for (let k = 0; k < pr.prefs.length; k++) this.habV[k] = this.habCost(k);
  }
  // même poste le matin et l'après-midi : « journée entière » souhaitée, ou « à éviter »
  splitCost(d, di) {
    const pr = this.pr, [s1, s2] = pr.slotsOfDay[di];
    const p1 = this.a[d][s1], p2 = this.a[d][s2];
    const b1 = p1 >= 0 ? pr.pBase[p1] : -1, b2 = p2 >= 0 ? pr.pBase[p2] : -1;
    let c = 0;
    if (b1 >= 0 && b1 === b2 && pr.pMode[b1] === "eviter") c += W.eviter;
    if (b1 >= 0 && b1 !== b2 && pr.pMode[b1] === "journee" && pr.open[s2][b1] && pr.status[d][s2] === "") c += W.journee;
    if (b2 >= 0 && b1 !== b2 && pr.pMode[b2] === "journee" && pr.open[s1][b2] && pr.status[d][s1] === "") c += W.journee;
    return c;
  }
  vacCovered(k) {
    const v = this.pr.vacs[k];
    let n = 0;
    for (const s of v.slots) if (v.H.some((d) => v.ps.includes(this.a[d][s]))) n++;
    return n;
  }
  vacCost(k) {
    const v = this.pr.vacs[k], n = this.vacCovered(k);
    return W.vacMiss * Math.max(0, v.min - n) - W.vacBonus * n;
  }
  habCost(k) {
    const f = this.pr.prefs[k];
    if (f.type === "libre") return f.ss.every((s) => this.a[f.d][s] >= 0) ? f.poids : 0;
    return f.ss.some((s) => f.ps.has(this.a[f.d][s])) ? 0 : f.poids;
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
    for (const r of this.splitV) for (const v of r) t += v;
    for (const v of this.vacV) t += v;
    for (const v of this.habV) t += v;
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
  if (p1 >= 0 && p2 >= 0 && pr.pBase[p1] === pr.pBase[p2] && pr.pMode[p1] === "demi") return false;
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
  const cov = new Map(), bal = new Map(), rem = new Map(), sciW = new Set(), tt = new Map(), spl = new Map(), vac = new Map(), hab = new Map();
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
    if (pr.hasMode) { const di = pr.slots[s].di, ks = d * 4096 + di; if (!spl.has(ks)) spl.set(ks, st.splitV[d][di]); }
    for (const k of pr.slotVac[s]) if (!vac.has(k)) vac.set(k, st.vacV[k]);
    for (const k of pr.prefOfDoc[d]) if (pr.prefs[k].w === w && !hab.has(k)) hab.set(k, st.habV[k]);
    journal.push([d, s, old]);
    st.set(d, s, p);
  }
  let delta = st.pref - pref0;
  for (const [k, v] of cov) { const s = Math.floor(k / 64), q = k % 64; const nv = st.covCost(s, q); st.covV[s][q] = nv; delta += nv - v; }
  for (const [k, v] of bal) { const d = Math.floor(k / 64), g = k % 64; const nv = st.balCost(d, g); st.balV[d][g] = nv; delta += nv - v; }
  for (const [k, v] of rem) { const d = Math.floor(k / 64), w = k % 64; const nv = st.remCost(d, w); st.remV[d][w] = nv; delta += nv - v; }
  for (const [d, v] of tt) { const nv = st.ttCost(d); st.ttV[d] = nv; delta += nv - v; }
  for (const [k, v] of spl) { const d = Math.floor(k / 4096), di = k % 4096; const nv = st.splitCost(d, di); st.splitV[d][di] = nv; delta += nv - v; }
  for (const [k, v] of vac) { const nv = st.vacCost(k); st.vacV[k] = nv; delta += nv - v; }
  for (const [k, v] of hab) { const nv = st.habCost(k); st.habV[k] = nv; delta += nv - v; }
  const sciOld = new Map();
  for (const w of sciW) { sciOld.set(w, st.sciV[w]); const nv = st.sciCost(w); delta += nv - st.sciV[w]; st.sciV[w] = nv; }
  const undo = () => {
    for (let i = journal.length - 1; i >= 0; i--) st.set(journal[i][0], journal[i][1], journal[i][2]);
    for (const [k, v] of cov) st.covV[Math.floor(k / 64)][k % 64] = v;
    for (const [k, v] of bal) st.balV[Math.floor(k / 64)][k % 64] = v;
    for (const [k, v] of rem) st.remV[Math.floor(k / 64)][k % 64] = v;
    for (const [d, v] of tt) st.ttV[d] = v;
    for (const [w, v] of sciOld) st.sciV[w] = v;
    for (const [k, v] of spl) st.splitV[Math.floor(k / 4096)][k % 4096] = v;
    for (const [k, v] of vac) st.vacV[k] = v;
    for (const [k, v] of hab) st.habV[k] = v;
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

// maxIter (facultatif) : nombre d'itérations fixé au lieu du temps (résultat identique sur toute machine, pour les tests)
async function solve(pr, timeLimitSec, onProgress, seed = 12345, maxIter = null) {
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
    st.recomputeExtras();
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
    const frac = maxIter ? it / maxIter : el / limit;
    if (frac >= 1) break;
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
        let p0 = -2;
        for (const s of pr.slotsOfDay[di]) {
          const opts = pr.choices[d][s].filter((p) => pr.pSite[p] === site);
          // même poste toute la journée (postes « journée entière », déplacements)
          const p = p0 >= 0 && opts.includes(p0) && rng() < 0.6 ? p0 : opts.length && rng() < 0.9 ? pick(opts) : -1;
          p0 = p;
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
  // même médecin matin et après-midi
  if (pr.hasMode) docs.forEach((ini, d) => days.forEach((dd, di) => {
    const [s1, s2] = pr.slotsOfDay[di];
    const b1 = new Set((seen.get(ini + "|" + s1) || []).map((p) => pr.pBase[p])), b2 = (seen.get(ini + "|" + s2) || []).map((p) => pr.pBase[p]);
    for (const b of b2) if (b1.has(b) && pr.pMode[b] === "demi") out.push(["Erreur", `${ini} sur ${postes[b]} le matin et l'après-midi le ${fmtDay(dd, false)} (une seule demi-journée par jour sur ce poste)`]);
  }));
  // vacations spécialisées
  const nb = (k) => pr.vacs[k].slots.filter((s) => pr.vacs[k].H.some((d) => pr.vacs[k].ps.some((p) => get(s, p).includes(docs[d])))).length;
  pr.vacs.forEach((v, k) => {
    const n = nb(k);
    if (n < v.min) out.push(["Alerte", `${v.nom} : ${n}/${v.min} vacation(s) assurée(s) par un médecin habilité la semaine du ${fmtDay(weeks[v.w], false)}`]);
  });
  // binôme jamais absent le même jour
  const bin = (P.binome || []).map((i) => docs.indexOf(i)).filter((i) => i >= 0);
  if (bin.length === 2) days.forEach((dd, di) => {
    if (weekday(dd) !== P.binomeRepli && bin.every((d) => pr.slotsOfDay[di].every((s) => pr.status[d][s] !== ""))) out.push(["Alerte", `${P.binome.join(" et ")} absents tous les deux le ${fmtDay(dd, false)}`]);
  });
  // préférences non satisfaites
  for (const f of pr.prefs) {
    const ok = f.type === "libre" ? f.ss.some((s) => !(seen.get(docs[f.d] + "|" + s) || []).length) : f.ss.some((s) => (seen.get(docs[f.d] + "|" + s) || []).some((p) => f.ps.has(p)));
    if (!ok) out.push(["Info", `Préférence non respectée la semaine du ${fmtDay(weeks[f.w], false)} — ${f.libelle}`]);
  }
  const items = pr.warnings.map((w) => ["Alerte", w]).concat((pr.infos || []).map((w) => ["Info", w]), out);
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
