// ================================================================ Générateur d'astreintes
// Unités : chaque nuit du lundi au jeudi (« S », ou « F » si le jour est férié) ; le week-end du vendredi au dimanche
// pour un seul médecin (« W »). Férié un samedi ou un dimanche : rien de plus (il est déjà dans le week-end).
// Vendredi férié (usage du service) : un médecin fait le jeudi soir et le vendredi (une nuit + un férié), un autre
// le samedi et le dimanche : ce week-end court (sans le vendredi soir) vaut les points d'un week-end moins une nuit.
// Règles strictes : indisponibilités d'astreinte, écart minimum entre deux astreintes d'une même personne,
// jamais d'astreinte le lundi qui suit son week-end.
// Objectif 1 : l'équilibre de chaque catégorie (semaine, week-end, férié) au prorata de la quotité, 12 derniers mois compris.
// Objectif 2 : quand cet équilibre n'est pas possible (indisponibilités, nombres qui ne tombent pas juste), les points
// (nuit 1, week-end 3, férié 2 par défaut) compensent, par les nuits de semaine : un week-end de moins = 3 nuits de plus.
// Utilise dayToDate / weekday / dayFromYMD d'engine.js (jours = nombre de jours depuis le 1er janvier 1970).

const ASTR_TYPES = ["S", "W", "F"];
const ASTR_LIB = { S: "Semaine", W: "Week-end", F: "Férié" };
const ASTR_POINTS_DEFAUT = { S: 1, W: 3, F: 2 };
// points réglés par l'administrateur (config/astreintes.points) ; valeur absente ou invalide : défaut
function astrPoints(p) {
  const out = { ...ASTR_POINTS_DEFAUT };
  for (const t of ASTR_TYPES) { const v = p && p[t] !== "" && p[t] !== null ? Number(p[t]) : NaN; if (Number.isFinite(v) && v >= 0 && v <= 20) out[t] = v; }
  return out;
}
// compteurs touchés par une unité : jeudi soir + vendredi férié = une nuit + un férié
const typesUnite = (u) => u.types || [u.type];
// points : un week-end court (sans le vendredi soir) vaut un week-end moins une nuit de semaine
const pointsUnite = (u, pts) => Math.max(0, typesUnite(u).reduce((s, t) => s + pts[t], 0) - (u.court ? pts.S : 0));
// compteurs et points de chacun pour une liste d'unités (aussi après des retouches à la main)
function bilanAstreintes(unites, ids, pts) {
  const out = {};
  for (const id of ids) out[id] = { S: 0, W: 0, F: 0, points: 0 };
  for (const u of unites) {
    const b = u.qui && out[u.qui];
    if (!b) continue;
    for (const t of typesUnite(u)) b[t]++;
    b.points += pointsUnite(u, pts);
  }
  return out;
}

// Jours fériés en France (métropole) pour une année : Map jour → nom
function feriesFrance(an) {
  const a = an % 19, b = Math.floor(an / 100), c = an % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mois = Math.floor((h + l - 7 * m + 114) / 31), jour = ((h + l - 7 * m + 114) % 31) + 1;
  const paques = dayFromYMD(an, mois, jour);
  return new Map([
    [dayFromYMD(an, 1, 1), "Jour de l'an"], [paques + 1, "Lundi de Pâques"], [dayFromYMD(an, 5, 1), "Fête du travail"],
    [dayFromYMD(an, 5, 8), "Victoire 1945"], [paques + 39, "Ascension"], [paques + 50, "Lundi de Pentecôte"],
    [dayFromYMD(an, 7, 14), "Fête nationale"], [dayFromYMD(an, 8, 15), "Assomption"], [dayFromYMD(an, 11, 1), "Toussaint"],
    [dayFromYMD(an, 11, 11), "Armistice"], [dayFromYMD(an, 12, 25), "Noël"],
  ]);
}
function feriesPeriode(du, au, autres) {
  const out = new Map();
  for (let an = ymd(du).y; an <= ymd(au).y; an++) for (const [d, n] of feriesFrance(an)) if (d >= du && d <= au) out.set(d, n);
  if (autres) for (const [d, n] of autres) if (d >= du && d <= au) out.set(d, n || "Férié");
  return out;
}

// Découpage de la période en unités d'astreinte
function unitesAstreinte(du, au, feries) {
  const out = [];
  let d = du;
  while (d <= au) {
    const j = weekday(d);   // 0 = lundi … 6 = dimanche
    if (j === 4 && feries.has(d)) {   // vendredi férié en début de période : seul, comme un férié
      out.push({ id: out.length, jours: [d], type: "F", debut: d, fin: d, ferie: feries.get(d) });
      d++;
    } else if (j >= 4) {    // vendredi, samedi, dimanche : un seul bloc jusqu'au dimanche (samedi → dimanche si le vendredi est férié)
      const fin = Math.min(au, d + (6 - j));
      const jours = []; for (let x = d; x <= fin; x++) jours.push(x);
      const court = j === 5 && feries.has(d - 1);   // week-end sans le vendredi soir
      out.push({ id: out.length, jours, type: "W", debut: d, fin, ...(court ? { court: true, ferie: `sans le vendredi (${feries.get(d - 1)})` } : {}) });
      d = fin + 1;
    } else if (j === 3 && d + 1 <= au && feries.has(d + 1)) {   // jeudi soir + vendredi férié : un seul médecin
      const tj = feries.has(d) ? "F" : "S";
      out.push({ id: out.length, jours: [d, d + 1], type: "F", types: [tj, "F"], debut: d, fin: d + 1, ferie: feries.get(d + 1) });
      d += 2;
    } else {
      out.push({ id: out.length, jours: [d], type: feries.has(d) ? "F" : "S", debut: d, fin: d, ferie: feries.get(d) || "" });
      d++;
    }
  }
  return out;
}

function hasard(graine) {   // mulberry32
  let a = graine >>> 0;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// opts : {du, au, participants: [{id, quotite}], indispo: {id: [jours]}, fixes: Map(jour → id), ecart, feries: Map,
//        points: {S, W, F}, historique, graine, iterations}
function genererAstreintes(opts) {
  const { du, au, participants } = opts;
  const ecart = Math.max(0, opts.ecart ?? 3);
  const PTS = astrPoints(opts.points);
  const feries = feriesPeriode(du, au, opts.feries);
  const U = unitesAstreinte(du, au, feries);
  const TU = U.map(typesUnite), PU = U.map((u) => pointsUnite(u, PTS));
  const P = participants.filter((p) => p && p.id && (p.quotite ?? 1) > 0);
  const ids = P.map((p) => p.id);
  const indispo = {};
  for (const id of ids) indispo[id] = new Set((opts.indispo && opts.indispo[id]) || []);
  const fixes = opts.fixes || new Map();
  // unités déjà attribuées (astreintes saisies à la main) : verrouillées
  const qui = U.map((u) => { const f = u.jours.map((d) => fixes.get(d)).find(Boolean); return f || null; });
  const verrou = qui.map((x) => !!x);
  // cibles au prorata de la quotité
  const sq = P.reduce((s, p) => s + (p.quotite ?? 1), 0) || 1;
  const nb = { S: 0, W: 0, F: 0 };
  TU.forEach((ts) => ts.forEach((t) => nb[t]++));
  // historique (12 derniers mois) : la cible porte sur l'ensemble « historique + période », moins ce qui a déjà été fait.
  // Cible en points : sans plancher par catégorie (un excès passé de week-ends se compense par moins de nuits).
  const H = opts.historique || { nb: { S: 0, W: 0, F: 0 }, compteurs: {} };
  const cible = {}, ciblePts = {};
  for (const p of P) {
    const q = (p.quotite ?? 1) / sq, hc = H.compteurs[p.id] || {};
    const brut = Object.fromEntries(ASTR_TYPES.map((t) => [t, (nb[t] + (H.nb[t] || 0)) * q - (hc[t] || 0)]));
    cible[p.id] = Object.fromEntries(ASTR_TYPES.map((t) => [t, Math.max(0, brut[t])]));
    ciblePts[p.id] = Math.max(0, ASTR_TYPES.reduce((s, t) => s + PTS[t] * brut[t], 0));
  }
  // 1. équilibre de chaque catégorie : week-ends et fériés d'abord (poids forts) ; nuits de semaine : poids faible,
  // 2. points : ils fixent le nombre de nuits de semaine quand week-ends ou fériés ne peuvent pas être équilibrés.
  const KCAT = { S: 0.1, W: 4 * (1 + PTS.W ** 2), F: 4 * (1 + PTS.F ** 2) };
  const dispo = (id, u) => u.jours.every((d) => !indispo[id] || !indispo[id].has(d));
  // compatibilité de deux unités pour une même personne
  const compatible = (a, b) => {
    const [x, y] = a.debut < b.debut ? [a, b] : [b, a];
    if (x.type === "W" && y.debut === x.fin + 1) return false;    // pas le lundi qui suit son week-end
    return y.debut - x.fin - 1 >= ecart;
  };
  const listes = {};   // id → indices d'unités attribuées
  for (const id of ids) listes[id] = [];
  qui.forEach((id, k) => { if (id && listes[id]) listes[id].push(k); });
  const faisable = (id, k, sauf = -1) => listes[id].every((j) => j === k || j === sauf || compatible(U[j], U[k]));
  const coutPersonne = (id) => {
    if (!cible[id]) return 0;
    const c = { S: 0, W: 0, F: 0 };
    let pts = 0;
    const ks = listes[id].slice().sort((a, b) => U[a].debut - U[b].debut);
    for (const k of ks) { for (const t of TU[k]) c[t]++; pts += PU[k]; }
    let s = (pts - ciblePts[id]) ** 2;
    for (const t of ASTR_TYPES) s += KCAT[t] * (c[t] - cible[id][t]) ** 2;
    for (let i = 1; i < ks.length; i++) { const g = U[ks[i]].debut - U[ks[i - 1]].fin - 1; if (g < 7) s += 0.15 * (7 - g); }
    return s;
  };
  // 1. attribution gloutonne : unités les plus contraintes d'abord
  const ordre = U.map((u, k) => k).filter((k) => !verrou[k])
    .sort((a, b) => ids.filter((id) => dispo(id, U[a])).length - ids.filter((id) => dispo(id, U[b])).length || U[a].debut - U[b].debut);
  for (const k of ordre) {
    let best = null, bestS = Infinity;
    for (const id of ids) {
      if (!dispo(id, U[k]) || !faisable(id, k)) continue;
      const avant = coutPersonne(id); listes[id].push(k); const apres = coutPersonne(id); listes[id].pop();
      const s = apres - avant;
      if (s < bestS) { bestS = s; best = id; }
    }
    if (best) { qui[k] = best; listes[best].push(k); }
  }
  // 2. amélioration par recuit simulé : réattribuer une unité, ou échanger deux unités de même type
  const rnd = hasard(opts.graine ?? 12345);
  const libres = U.map((u, k) => k).filter((k) => !verrou[k]);
  const iters = opts.iterations ?? 60000;
  const retirer = (id, k) => { const i = listes[id].indexOf(k); if (i >= 0) listes[id].splice(i, 1); };
  for (let it = 0; it < iters && libres.length && ids.length > 1; it++) {
    const T = 2 * Math.pow(0.002, it / iters);
    const k = libres[Math.floor(rnd() * libres.length)];
    if (rnd() < 0.5) {
      const nv = ids[Math.floor(rnd() * ids.length)], anc = qui[k];
      if (nv === anc || !dispo(nv, U[k]) || !faisable(nv, k)) continue;
      const avant = coutPersonne(nv) + (anc ? coutPersonne(anc) : 1000);
      if (anc) retirer(anc, k);
      listes[nv].push(k);
      const apres = coutPersonne(nv) + (anc ? coutPersonne(anc) : 0);
      if (apres <= avant || rnd() < Math.exp((avant - apres) / T)) qui[k] = nv;
      else { retirer(nv, k); if (anc) listes[anc].push(k); }
    } else {
      const k2 = libres[Math.floor(rnd() * libres.length)];
      const a = qui[k], b = qui[k2];
      if (k2 === k || !a || !b || a === b || U[k].type !== U[k2].type) continue;
      if (!dispo(b, U[k]) || !dispo(a, U[k2]) || !faisable(b, k, k2) || !faisable(a, k2, k)) continue;
      const avant = coutPersonne(a) + coutPersonne(b);
      retirer(a, k); retirer(b, k2); listes[a].push(k2); listes[b].push(k);
      const apres = coutPersonne(a) + coutPersonne(b);
      if (apres <= avant || rnd() < Math.exp((avant - apres) / T)) { qui[k] = b; qui[k2] = a; }
      else { retirer(a, k2); retirer(b, k); listes[a].push(k); listes[b].push(k2); }
    }
  }
  // résultat
  const unites = U.map((u, k) => ({ ...u, qui: qui[k], fixe: verrou[k] }));
  const bil = bilanAstreintes(unites, ids, PTS);
  const compteurs = {}, points = {};
  for (const id of ids) { const { points: p, ...c } = bil[id]; compteurs[id] = c; points[id] = p; }
  return {
    unites, compteurs, cibles: cible, nb, points, ciblePts, pts: PTS,
    aPourvoir: U.filter((u, k) => !qui[k]).map((u) => u.debut),
  };
}

// Vérification indépendante d'un résultat (tests, et alerte si l'administrateur modifie à la main)
function controlerAstreintes(res, indispo, ecart) {
  const pb = [];
  const parQui = {};
  for (const u of res.unites) {
    if (!u.qui) continue;
    if (u.jours.some((d) => indispo[u.qui] && new Set(indispo[u.qui]).has(d))) pb.push(`${u.qui} indisponible le ${fmtDay(u.debut, false)}`);
    (parQui[u.qui] = parQui[u.qui] || []).push(u);
  }
  for (const [q, us] of Object.entries(parQui)) {
    us.sort((a, b) => a.debut - b.debut);
    for (let i = 1; i < us.length; i++) {
      const x = us[i - 1], y = us[i];
      if (x.type === "W" && y.debut === x.fin + 1) pb.push(`${q} : astreinte le lundi ${fmtDay(y.debut, false)} après son week-end`);
      else if (y.debut - x.fin - 1 < ecart) pb.push(`${q} : astreintes trop rapprochées (${fmtDay(x.fin, false)} et ${fmtDay(y.debut, false)})`);
    }
  }
  return pb;
}

// Historique à partir des astreintes déjà connues [{d, ini}] avant `du` (12 mois) : compteurs par type.
// Un week-end compte une fois par personne ; un vendredi férié compte comme un férié pour celui qui l'a tenu.
function historiqueAstreintes(liste, du, feries) {
  const debut = du - 365, nb = { S: 0, W: 0, F: 0 }, compteurs = {}, weVus = new Set(), vfVus = new Set();
  for (const a of liste || []) {
    if (a.d < debut || a.d >= du || !a.ini) continue;
    const j = weekday(a.d);
    const c = (compteurs[a.ini] = compteurs[a.ini] || { S: 0, W: 0, F: 0 });
    if (j === 4 && feries.has(a.d)) {   // vendredi férié : un férié (le samedi et le dimanche font le week-end)
      const cle = `${a.ini}|${a.d}`;
      if (!vfVus.has(cle)) { vfVus.add(cle); nb.F++; c.F++; }
    } else if (j >= 4) {
      const cle = `${a.ini}|${a.d - j + 4}`;
      if (!weVus.has(cle)) { weVus.add(cle); nb.W++; c.W++; }
    } else { const t = feries.has(a.d) ? "F" : "S"; nb[t]++; c[t]++; }
  }
  return { nb, compteurs };
}

// Calendrier à toucher (mois par mois, lundi en premier) : jours de `set` en rouge ; utilisé en ligne et hors ligne
function calendrierHtml(du, au, set, editable, feries) {
  let html = "";
  const p = ymd(du), q = ymd(au);
  for (let y = p.y, m = p.m; y * 100 + m <= q.y * 100 + q.m; m === 12 ? (y++, m = 1) : m++) {
    const d1 = dayFromYMD(y, m, 1), nbj = new Date(Date.UTC(y, m, 0)).getUTCDate();
    let cases = "";
    for (let k = 0; k < weekday(d1); k++) cases += "<span></span>";
    for (let j = 1; j <= nbj; j++) {
      const d = d1 + j - 1, hors = d < du || d > au, ind = set.has(d);
      cases += `<button type="button" class="cj${ind ? " ind" : ""}${weekday(d) >= 4 ? " we" : ""}${feries.has(d) ? " fer" : ""}" data-j="${d}"${hors || !editable ? " disabled" : ""} aria-pressed="${ind}" title="${fmtDay(d)}${feries.has(d) ? " · " + esc(feries.get(d)) : ""}">${j}</button>`;
    }
    html += `<div class="calm"><div class="calt">${MOIS[m - 1]} ${y}</div><div class="calg"><b>L</b><b>M</b><b>M</b><b>J</b><b>V</b><b>S</b><b>D</b>${cases}</div></div>`;
  }
  return `<div class="cals">${html}</div>`;
}

// Indisponibilités écrites dans le classeur : « 08/01/2027-10/01/2027 ; 20/01/2027 » ↔ liste de jours
function lireJoursTexte(t) {
  const out = new Set();
  for (const morceau of String(t ?? "").split(/[;,\n]+/)) {
    const m = morceau.trim(); if (!m) continue;
    const p = m.split(/\s*(?:-|→|\bau\b|\ba\b)\s*(?=\d)/i).map((x) => asDay(x.trim()));
    if (p.length === 2 && p[0] !== null && p[1] !== null) { for (let d = Math.min(p[0], p[1]); d <= Math.max(p[0], p[1]) && out.size < 1000; d++) out.add(d); }
    else if (p[0] !== null) out.add(p[0]);
  }
  return [...out].sort((a, b) => a - b);
}
function ecrireJoursTexte(jours) {
  const js = [...new Set(jours)].sort((a, b) => a - b), plages = [];
  for (const d of js) { const p = plages[plages.length - 1]; if (p && d === p[1] + 1) p[1] = d; else plages.push([d, d]); }
  return plages.map(([a, b]) => (a === b ? fmtDay(a) : `${fmtDay(a)}-${fmtDay(b)}`)).join(" ; ");
}
