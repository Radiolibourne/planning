// ================================================================ Compteurs de congés (CA, RTT, formation)
// Année civile. Droits d'un temps plein : 25 CA, 20 RTT, 4 jours de formation, au prorata de la quotité
// (modifiables par médecin), plus un report éventuel et un ajustement (jours pris hors du site).
// Règle du service (CA et RTT) : dès qu'un médecin pose au moins un jour dans une semaine, un jour off de la semaine
// est décompté aussi (une semaine entière = 5 jours ; 1 jour posé en gardant son off = 2 jours). Un seul off par semaine,
// temps partiel compris, mais pas si seule une demi-journée est posée dans la semaine. Jours fériés jamais décomptés.
// Demi-journée = 0,5. Les CA et RTT forment un seul ensemble : les RTT sont consommés en priorité (dans l'ordre des dates),
// puis les CA une fois les RTT épuisés (rttDispo = droit + report − déjà pris hors site).

const CONGE_TYPES = ["CA", "RTT", "FORM"];
const CONGE_LIB = { CA: "Congés annuels", RTT: "RTT", FORM: "Formation" };
const DROITS_DEFAUT = { CA: 25, RTT: 20, FORM: 4 };

function typeConge(motif) {
  const m = String(motif || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
  if (/^rtt\b/.test(m)) return "RTT";
  if (/^(conges? annuels?|conges?\b|ca\b)/.test(m)) return "CA";
  if (/^(conge )?formation/.test(m)) return "FORM";
  return null;
}

// Semaine A ou B (même calcul que le moteur : semaine de référence P.refA = A)
function typeSemaineAB(lundi, refA) {
  if (!Number.isFinite(refA)) return "A";
  return ((Math.floor((lundi - refA) / 7) % 2) + 2) % 2 === 0 ? "A" : "B";
}

// abs : [{d1, d2, periode, type}] (absences acceptées d'un médecin) ; doc : {offA, offB} (ensembles de jours 0 = lundi)
// -> {CA, RTT, FORM, jours: [{d, type, val, off}]}
function decompteConges(abs, doc, an, feries, refA, rttDispo) {
  const debut = dayFromYMD(an, 1, 1), fin = dayFromYMD(an, 12, 31);
  const fer = feries || new Map();
  const parJour = new Map();
  for (const a of abs || []) {
    if (!CONGE_TYPES.includes(a.type)) continue;
    const v = a.periode === "Matin" || a.periode === "Après-midi" ? 0.5 : 1;
    for (let d = Math.max(a.d1, debut); d <= Math.min(a.d2, fin); d++) {
      if (weekday(d) > 4 || fer.has(d)) continue;
      const cur = parJour.get(d);
      parJour.set(d, { type: cur && cur.type !== a.type && cur.val >= 1 ? cur.type : a.type, val: Math.min(1, (cur ? cur.val : 0) + v) });
    }
  }
  const out = { CA: 0, RTT: 0, FORM: 0, jours: [] };
  for (const [d, x] of parJour) { out[x.type] += x.val; out.jours.push({ d, type: x.type, val: x.val, off: false }); }
  // règle du off : une fois par semaine où des CA ou RTT sont posés
  const semaines = new Map();
  for (const [d, x] of parJour) if (x.type === "CA" || x.type === "RTT") {
    const w = mondayOf(d), s = semaines.get(w) || { CA: 0, RTT: 0 };
    s[x.type] += x.val; semaines.set(w, s);
  }
  for (const [w, s] of semaines) {
    if (s.CA + s.RTT <= 0.5) continue; // une demi-journée seule : pas de jour off
    const offs = [...((typeSemaineAB(w, refA) === "A" ? doc && doc.offA : doc && doc.offB) || [])].filter((i) => i >= 0 && i <= 4).sort();
    const cand = offs.map((i) => w + i).find((d) => d >= debut && d <= fin && !fer.has(d) && (!parJour.has(d) || parJour.get(d).val < 1));
    if (cand === undefined) continue;
    const type = s.CA >= s.RTT ? "CA" : "RTT";
    const extra = 1 - (parJour.has(cand) ? parJour.get(cand).val : 0);
    out[type] += extra; out.jours.push({ d: cand, type, val: extra, off: true });
  }
  out.jours.sort((a, b) => a.d - b.d);
  // RTT en priorité : on réattribue les jours CA/RTT dans l'ordre chronologique
  if (Number.isFinite(rttDispo)) {
    let reste = Math.max(0, rttDispo);
    out.CA = 0; out.RTT = 0;
    const jours = [];
    for (const j of out.jours) {
      if (j.type !== "CA" && j.type !== "RTT") { jours.push(j); continue; }
      const r = Math.min(reste, j.val); reste -= r;
      if (r > 0) { jours.push({ ...j, type: "RTT", val: r }); out.RTT += r; }
      if (j.val - r > 0) { jours.push({ ...j, type: "CA", val: j.val - r }); out.CA += j.val - r; }
    }
    out.jours = jours;
  }
  for (const t of CONGE_TYPES) out[t] = Math.round(out[t] * 2) / 2;
  return out;
}

// Droits de l'année : réglages {CA, RTT, FORM, reportCA…, ajCA…} du médecin, sinon défauts au prorata de la quotité
function droitsConges(reglage, quotite, defauts) {
  const r = reglage || {}, q = quotite || 1, def = { ...DROITS_DEFAUT, ...(defauts || {}) };
  const out = {};
  for (const t of CONGE_TYPES) {
    const base = Number.isFinite(r[t]) ? r[t] : Math.round(def[t] * q * 2) / 2;
    out[t] = { droit: base, report: Number(r["report" + t]) || 0, ajust: Number(r["aj" + t]) || 0 };
  }
  return out;
}
