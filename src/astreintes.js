// ================================================================ Générateur d'astreintes
// Unités : chaque nuit du lundi au jeudi (« S », ou « F » si le jour est férié) ; le week-end du vendredi au dimanche
// pour un seul médecin (« W » ; un férié tombant un vendredi, un samedi ou un dimanche ne compte pas comme férié).
// Règles strictes : indisponibilités d'astreinte, écart minimum entre deux astreintes d'une même personne,
// jamais d'astreinte le lundi qui suit son week-end. Équité : trois compteurs (semaine, week-end, férié) au prorata de la quotité.
// Utilise dayToDate / weekday / dayFromYMD d'engine.js (jours = nombre de jours depuis le 1er janvier 1970).

const ASTR_TYPES = ["S", "W", "F"];
const ASTR_LIB = { S: "Semaine", W: "Week-end", F: "Férié" };

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
    if (j >= 4) {           // vendredi, samedi, dimanche : un seul bloc jusqu'au dimanche
      const fin = Math.min(au, d + (6 - j));
      const jours = []; for (let x = d; x <= fin; x++) jours.push(x);
      out.push({ id: out.length, jours, type: "W", debut: d, fin });
      d = fin + 1;
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

// opts : {du, au, participants: [{id, quotite}], indispo: {id: [jours]}, fixes: Map(jour → id), ecart, feries: Map, graine, iterations}
function genererAstreintes(opts) {
  const { du, au, participants } = opts;
  const ecart = Math.max(0, opts.ecart ?? 3);
  const feries = feriesPeriode(du, au, opts.feries);
  const U = unitesAstreinte(du, au, feries);
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
  U.forEach((u) => nb[u.type]++);
  const cible = {};
  // historique (12 derniers mois) : la cible porte sur l'ensemble « historique + période », moins ce qui a déjà été fait
  const H = opts.historique || { nb: { S: 0, W: 0, F: 0 }, compteurs: {} };
  for (const p of P) cible[p.id] = Object.fromEntries(ASTR_TYPES.map((t) => [t,
    Math.max(0, ((nb[t] + (H.nb[t] || 0)) * (p.quotite ?? 1)) / sq - ((H.compteurs[p.id] || {})[t] || 0))]));
  const POIDS = { S: 1, W: 3, F: 3 };
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
    const ks = listes[id].slice().sort((a, b) => U[a].debut - U[b].debut);
    ks.forEach((k) => c[U[k].type]++);
    let s = 0;
    for (const t of ASTR_TYPES) s += POIDS[t] * (c[t] - cible[id][t]) ** 2;
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
  const compteurs = {};
  for (const id of ids) compteurs[id] = { S: 0, W: 0, F: 0 };
  U.forEach((u, k) => { if (qui[k] && compteurs[qui[k]]) compteurs[qui[k]][u.type]++; });
  return {
    unites: U.map((u, k) => ({ ...u, qui: qui[k], fixe: verrou[k] })),
    compteurs, cibles: cible, nb,
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

// Historique à partir des astreintes déjà connues [{d, ini}] avant `du` (12 mois) : compteurs par type
function historiqueAstreintes(liste, du, feries) {
  const debut = du - 365, nb = { S: 0, W: 0, F: 0 }, compteurs = {}, weVus = new Set();
  for (const a of liste || []) {
    if (a.d < debut || a.d >= du || !a.ini) continue;
    const j = weekday(a.d);
    let t = j >= 4 ? "W" : feries.has(a.d) ? "F" : "S";
    if (t === "W") { const cle = `${a.ini}|${a.d - j + 4}`; if (weVus.has(cle)) continue; weVus.add(cle); }
    nb[t]++;
    const c = (compteurs[a.ini] = compteurs[a.ini] || { S: 0, W: 0, F: 0 }); c[t]++;
  }
  return { nb, compteurs };
}
