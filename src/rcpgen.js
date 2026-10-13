// ================================================================ Générateur du planning des RCP
// Les RCP sont fixes : chacune a un jour de la semaine, un horaire et des semaines du mois (1er, 2e… lundi ; vide = toutes).
// Mode « nb » : n radiologues choisis parmi les inscrits ; mode « tous » : tous les inscrits présents (séno).
// Équilibre par RCP puis au total, en tenant compte des RCP des 12 mois précédents.
// Indisponibilités fournies par dispo(ini, d, minutesDebut) -> "" (disponible) ou la raison.
// Config : [{id, service, horaire, jour (0 = lundi), semaines: [1..5], mode: "nb" | "tous", nb, medecins: [ini]}]

const JOURS_RCP = ["lundi", "mardi", "mercredi", "jeudi", "vendredi"];
const cleRcpGen = (r) => `${String(r.service).toUpperCase()}|${r.horaire}`;

// heure de début (minutes) de l'horaire du jour (« 17h-20h 1er lundi 16h-17h 3ème lundi » géré par horaireRcp)
function debutRcp(horaire, d) {
  const h = typeof horaireRcp === "function" ? horaireRcp(horaire, d) : String(horaire || "");
  const m = /(\d{1,2})\s*h\s*(\d{0,2})/i.exec(h);
  return m ? +m[1] * 60 + (+m[2] || 0) : 12 * 60;
}
const rangDansMois = (d) => Math.ceil(ymd(d).d / 7);

function occurrencesRcp(rcps, du, au, feries) {
  const out = [];
  for (let d = du; d <= au; d++) {
    if (weekday(d) > 4 || (feries && feries.has(d))) continue;
    for (const r of rcps) {
      if (r.jour !== weekday(d)) continue;
      if (r.semaines && r.semaines.length && !r.semaines.includes(rangDansMois(d))) continue;
      out.push({ d, id: r.id });
    }
  }
  return out;
}

// Liste des RCP déduite des fiches importées (items {d, service, horaire, ini})
function rcpDepuisImport(items) {
  const g = new Map();
  for (const x of items || []) {
    if (!Number.isFinite(x.d) || weekday(x.d) > 4) continue;
    const k = `${cleRcpGen(x)}|${weekday(x.d)}`;
    const e = g.get(k) || { service: x.service, horaire: x.horaire, jour: weekday(x.d), rangs: new Set(), mois: new Set(), medecins: new Set(), max: 0 };
    e.rangs.add(rangDansMois(x.d)); e.mois.add(ymd(x.d).y * 100 + ymd(x.d).m);
    for (const i of x.ini || []) e.medecins.add(String(i).toUpperCase());
    e.max = Math.max(e.max, (x.ini || []).length);
    g.set(k, e);
  }
  let n = 0;
  return [...g.values()].sort((a, b) => a.jour - b.jour || String(a.service).localeCompare(b.service)).map((e) => {
    const rangs = [...e.rangs].sort();
    // vue sur 4 semaines ou plus : toutes les semaines ; sinon, les semaines vues (à corriger à la main au besoin)
    const toutes = rangs.length >= 4 || (e.mois.size === 1 && rangs.length >= 3 && rangs.every((r, i) => i === 0 || r === rangs[i - 1] + 1));
    return { id: "r" + (++n) + "_" + Date.now().toString(36), service: e.service, horaire: e.horaire, jour: e.jour,
      semaines: toutes ? [] : rangs, mode: e.max >= 2 ? "tous" : "nb", nb: 1, medecins: [...e.medecins].sort() };
  });
}

// Compteurs des RCP passées (12 mois avant du), par RCP de la configuration (même service et horaire)
function historiqueRcp(items, rcps, du) {
  const parCle = new Map(rcps.map((r) => [cleRcpGen(r) + "|" + r.jour, r.id]));
  const h = {};
  for (const x of items || []) {
    if (!(x.d < du && x.d >= du - 365)) continue;
    const id = parCle.get(cleRcpGen(x) + "|" + weekday(x.d));
    if (!id) continue;
    for (const i of x.ini || []) { const I = String(i).toUpperCase(); (h[I] = h[I] || {})[id] = (h[I][id] || 0) + 1; }
  }
  return h;
}

function genererRcp({ rcps, du, au, feries, dispo, historique, graine = 1, essais = 40 }) {
  const parId = Object.fromEntries(rcps.map((r) => [r.id, r]));
  const occs = occurrencesRcp(rcps, du, au, feries);
  const indispo = {};   // `${d}|${id}` -> {ini: raison}
  for (const o of occs) {
    const r = parId[o.id], m = {};
    for (const i of r.medecins) { const why = dispo(i, o.d, debutRcp(r.horaire, o.d)); if (why) m[i] = why; }
    indispo[o.d + "|" + o.id] = m;
  }
  const hist = historique || {};
  const nbRcp = rcps.filter((r) => r.mode !== "tous");
  const essai = (seed) => {
    const rng = hasard(seed);
    const cnt = {}, tot = {}, jour = {}, dernier = {};
    const c = (i, id) => (cnt[i] && cnt[i][id]) || 0;
    for (const r of nbRcp) for (const i of r.medecins) {
      (cnt[i] = cnt[i] || {})[r.id] = (hist[i] && hist[i][r.id]) || 0;
    }
    for (const i of Object.keys(cnt)) tot[i] = Object.values(cnt[i]).reduce((a, b) => a + b, 0);
    const res = [];
    let manque = 0;
    for (const o of occs) {
      const r = parId[o.id], ind = indispo[o.d + "|" + o.id];
      const libres = r.medecins.filter((i) => !ind[i]);
      if (r.mode === "tous") {
        res.push({ d: o.d, id: r.id, ini: libres.slice(), manque: libres.length ? 0 : 1 });
        if (!libres.length) manque++;
        continue;
      }
      const n = Math.max(1, r.nb || 1), pris = [];
      for (let k = 0; k < n; k++) {
        let best = null, bs = Infinity;
        for (const i of libres) {
          if (pris.includes(i)) continue;
          const s = c(i, r.id) * 4 + (tot[i] || 0) + ((jour[i] || []).includes(o.d) ? 3 : 0) + (dernier[i + "|" + r.id] === o.d - 7 ? 1 : 0) + rng() * 0.9;
          if (s < bs) { bs = s; best = i; }
        }
        if (!best) { manque++; break; }
        pris.push(best);
        cnt[best][r.id] = c(best, r.id) + 1; tot[best] = (tot[best] || 0) + 1;
        (jour[best] = jour[best] || []).push(o.d); dernier[best + "|" + r.id] = o.d;
      }
      res.push({ d: o.d, id: r.id, ini: pris, manque: n - pris.length });
    }
    // score : écarts par RCP et au total (entre inscrits), trous
    const ecart = (vals) => vals.length ? Math.max(...vals) - Math.min(...vals) : 0;
    let score = manque * 1000;
    for (const r of nbRcp) score += ecart(r.medecins.map((i) => c(i, r.id))) * 10;
    const inscrits = [...new Set(nbRcp.flatMap((r) => r.medecins))];
    score += ecart(inscrits.map((i) => tot[i] || 0)) * 3;
    return { res, score };
  };
  let meilleur = null;
  for (let s = 0; s < essais; s++) { const e = essai(graine * 7919 + s); if (!meilleur || e.score < meilleur.score) meilleur = e; }
  return { occ: meilleur.res, indispo, occurrences: occs.length };
}

// Compteurs d'une liste d'occurrences (+ historique) : {ini: {total, ids: {id: n}}}
function compteursRcp(occ, rcps, historique) {
  const tous = new Set(rcps.filter((r) => r.mode === "tous").map((r) => r.id));
  const out = {};
  const add = (i, id, n) => { const e = out[i] || (out[i] = { mois: 0, total: 0, ids: {} }); e.ids[id] = (e.ids[id] || 0) + n; if (!tous.has(id)) e.total += n; };
  for (const [i, m] of Object.entries(historique || {})) for (const [id, n] of Object.entries(m)) add(i, id, n);
  for (const o of occ) for (const i of o.ini) { add(i, o.id, 1); out[i].mois++; }
  return out;
}

// Problèmes : radiologue indisponible, poste vide, deux RCP qui se chevauchent le même jour
function controlerRcpGen(occ, rcps, indispo) {
  const parId = Object.fromEntries(rcps.map((r) => [r.id, r]));
  const pb = [];
  for (const o of occ) {
    const r = parId[o.id]; if (!r) continue;
    const ind = indispo[o.d + "|" + o.id] || {};
    for (const i of o.ini) if (ind[i]) pb.push({ d: o.d, id: o.id, ini: i, texte: `${i} ${ind[i]}` });
    if (!o.ini.length) pb.push({ d: o.d, id: o.id, texte: "personne" });
    else if (r.mode !== "tous" && o.ini.length < (r.nb || 1)) pb.push({ d: o.d, id: o.id, texte: "incomplet" });
  }
  return pb;
}
