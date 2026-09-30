// ================================================================ Planning publié (format stocké en ligne)
// {
//   version, titre, start, end, genereLe, publieLe, publiePar,
//   ordre: [codes], postes: {code: {label, site, adresse, M:[a,b], AM:[a,b], need}},
//   sites: [..], mainSite, jours: [day], semaines: [{lundi, type}], medecins: [ini],
//   cases: {"<day>_<h>_<code>": "AB / CD"}   (seulement les postes ouverts ; "" = fermé)
//   statuts: {ini: {"<day>_<h>": "OFF" | "ABS" | "INDISPO"}}
// }
const caseKey = (d, h, code) => `${d}_${h}_${code}`;
const splitInis = (v) => String(v || "").split("/").map((x) => x.trim().toUpperCase()).filter(Boolean);
const joinInis = (a) => a.join(" / ");

function draftFromResult(pr, R) {
  const P = pr.P;
  const postes = {};
  pr.postes.forEach((code) => {
    const x = P.postes[code], site = P.sites[x.site] || P.sites[P.mainSite];
    postes[code] = { label: x.label, site: x.site, adresse: site.adresse || "", M: site.M, AM: site.AM, need: x.need };
  });
  const cases = {};
  pr.slots.forEach((sl, s) => pr.postes.forEach((code, p) => {
    if (pr.open[s][p]) cases[caseKey(sl.d, sl.h, code)] = joinInis(R.assign.get(s + "|" + p) || []);
  }));
  const statuts = {};
  pr.docs.forEach((ini, d) => {
    const m = {};
    pr.slots.forEach((sl, s) => { if (pr.status[d][s]) m[`${sl.d}_${sl.h}`] = pr.status[d][s]; });
    statuts[ini] = m;
  });
  return {
    version: 1, titre: `Planning du service de radiologie — ${monthLabel(P)}`, start: P.start, end: P.end,
    genereLe: Date.now(), ordre: pr.postes.slice(), postes, sites: P.siteList.slice(), mainSite: P.mainSite,
    jours: pr.days.slice(), semaines: pr.weeks.map((w) => ({ lundi: w, type: pr.weekType.get(w) })),
    medecins: pr.docs.slice(), cases, statuts,
  };
}

// Affectations du brouillon -> R.assign du problème (pour contrôles et export Excel)
function assignFromDraft(pr, draft) {
  const assign = new Map();
  pr.slots.forEach((sl, s) => pr.postes.forEach((code, p) => {
    const inis = splitInis(draft.cases[caseKey(sl.d, sl.h, code)]);
    if (inis.length) assign.set(s + "|" + p, inis);
  }));
  return assign;
}

function eventsFromDraft(draft, onlyIni) {
  const ev = new Map();
  for (const [k, v] of Object.entries(draft.cases)) {
    const [d, h, code] = k.split("_");
    for (const ini of splitInis(v)) {
      if (onlyIni && ini !== onlyIni) continue;
      if (!ev.has(ini)) ev.set(ini, new Map());
      const m = ev.get(ini);
      if (!m.has(+d)) m.set(+d, {});
      m.get(+d)[h] = code;
    }
  }
  return ev;
}

// Vue par médecin : {ini: {"<day>_<h>": {code} | {statut}}}
function perDoctor(draft) {
  const out = {};
  for (const ini of draft.medecins) out[ini] = {};
  for (const [k, v] of Object.entries(draft.cases)) {
    const [d, h, code] = k.split("_");
    for (const ini of splitInis(v)) {
      if (!out[ini]) out[ini] = {};
      const key = `${d}_${h}`;
      out[ini][key] = out[ini][key] ? { code: out[ini][key].code, doublon: true } : { code };
    }
  }
  for (const [ini, m] of Object.entries(draft.statuts || {})) {
    if (!out[ini]) out[ini] = {};
    for (const [k, st] of Object.entries(m)) if (!out[ini][k]) out[ini][k] = { statut: st };
  }
  return out;
}

// Indisponibilités saisies en ligne -> format P.abs
function onlineAbs(indispos) {
  return indispos.map((x) => ({
    ini: String(x.ini || "").toUpperCase(), d1: x.d1, d2: x.d2,
    halves: x.periode === "Matin" ? ["M"] : x.periode === "Après-midi" ? ["AM"] : HALVES,
    motif: x.motif || "Absence",
  })).filter((a) => a.ini && Number.isFinite(a.d1) && Number.isFinite(a.d2));
}

// Indisponibilités en conflit avec un planning (médecin affecté pendant son absence)
function conflicts(draft, indispos) {
  if (!draft) return [];
  const pd = perDoctor(draft);
  const out = [];
  for (const x of indispos) {
    const m = pd[String(x.ini).toUpperCase()];
    if (!m) continue;
    const hs = x.periode === "Matin" ? ["M"] : x.periode === "Après-midi" ? ["AM"] : HALVES;
    const hits = [];
    for (let d = Math.max(x.d1, draft.start); d <= Math.min(x.d2, draft.end); d++)
      for (const h of hs) { const c = m[`${d}_${h}`]; if (c && c.code) hits.push({ d, h, code: c.code }); }
    if (hits.length) out.push({ indispo: x, hits });
  }
  return out;
}

// ================================================================ Verrouillage de la saisie des absences
// - période du planning publié : aucune absence ne peut commencer avant ou pendant (d1 <= publie.end)
// - dates limites de dépôt (config/saisie.clotures, 5 au plus) : {du, au, limite, finMs}
//   après finMs (fin de la journée « limite », heure de Paris), plus de demande touchant [du, au]
const MAX_CLOTURES = 5;

// Fin de la journée `day` à Paris, en millisecondes (minuit suivant, heure de Paris)
function parisEndOfDayMs(day) {
  const utcMidnight = (day + 1) * 86400000;
  let offsetH = 1;
  try {
    const part = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", timeZoneName: "shortOffset" })
      .formatToParts(new Date(utcMidnight)).find((x) => x.type === "timeZoneName");
    const m = part && /GMT([+-]\d+)/.exec(part.value);
    if (m) offsetH = +m[1];
  } catch (e) { /* heure d'hiver par défaut */ }
  return utcMidnight - offsetH * 3600000;
}

// Raison du refus d'une absence [d1, d2], ou null si la saisie est ouverte
function lockReason(d1, d2, published, saisie, nowMs = Date.now()) {
  if (published && Number.isFinite(published.end) && d1 <= published.end)
    return `Le planning est publié jusqu'au ${fmtDay(published.end)} : les absences ne peuvent plus être déclarées sur cette période. Contactez l'administrateur.`;
  for (const c of ((saisie && saisie.clotures) || []).slice(0, MAX_CLOTURES)) {
    if (nowMs > c.finMs && d2 >= c.du && d1 <= c.au)
      return `Le dépôt des demandes pour la période du ${fmtDay(c.du, false)} au ${fmtDay(c.au)} est clos depuis le ${fmtDay(c.limite)}. Contactez l'administrateur.`;
  }
  return null;
}

// ================================================================ Stockage
// Interface commune : get(path), set(path, data), add(coll, data), del(path),
// watchDoc(path, cb, err) -> unsubscribe, watchColl(coll, cb, err) -> unsubscribe,
// signIn(email, pw), signOut(), onAuth(cb), mode
class StoreError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

function frenchError(e) {
  const c = (e && (e.code || "")) + "";
  if (c.includes("permission-denied")) return new StoreError("permission-denied", "Accès refusé : code d'équipe incorrect, ou action réservée à l'administrateur.");
  if (c.includes("invalid-credential") || c.includes("wrong-password") || c.includes("user-not-found") || c.includes("invalid-email"))
    return new StoreError("auth", "Adresse e-mail ou mot de passe incorrect.");
  if (c.includes("too-many-requests")) return new StoreError("auth", "Trop de tentatives. Réessayez dans quelques minutes.");
  if (c.includes("unavailable") || c.includes("network")) return new StoreError("network", "Connexion impossible. Vérifiez votre accès à internet.");
  if (c.includes("resource-exhausted")) return new StoreError("quota", "Quota de la base de données dépassé pour aujourd'hui.");
  return new StoreError(c || "unknown", (e && e.message) || "Erreur inconnue.");
}

const FB_VERSION = "10.14.1";
async function firebaseStore(cfg) {
  const base = `https://www.gstatic.com/firebasejs/${FB_VERSION}/`;
  let A, F, U;
  try {
    [A, F, U] = await Promise.all([import(base + "firebase-app.js"), import(base + "firebase-firestore.js"), import(base + "firebase-auth.js")]);
  } catch (e) {
    throw new StoreError("network", "Impossible de charger Firebase. Vérifiez votre connexion à internet.");
  }
  const app = A.initializeApp(cfg);
  const fs = F.getFirestore(app);
  const auth = U.getAuth(app);
  const wrap = async (fn) => { try { return await fn(); } catch (e) { throw frenchError(e); } };
  return {
    mode: "firebase",
    get: (path) => wrap(async () => { const s = await F.getDoc(F.doc(fs, path)); return s.exists() ? s.data() : null; }),
    set: (path, data) => wrap(() => F.setDoc(F.doc(fs, path), data)),
    add: (coll, data) => wrap(async () => (await F.addDoc(F.collection(fs, coll), data)).id),
    del: (path) => wrap(() => F.deleteDoc(F.doc(fs, path))),
    watchDoc: (path, cb, err) => F.onSnapshot(F.doc(fs, path), (s) => cb(s.exists() ? s.data() : null), (e) => err && err(frenchError(e))),
    watchColl: (coll, cb, err) => F.onSnapshot(F.collection(fs, coll),
      (qs) => cb(qs.docs.map((d) => ({ id: d.id, ...d.data() }))), (e) => err && err(frenchError(e))),
    signIn: (email, pw) => wrap(() => U.signInWithEmailAndPassword(auth, email, pw)),
    signOut: () => wrap(() => U.signOut(auth)),
    onAuth: (cb) => U.onAuthStateChanged(auth, (u) => cb(u ? { email: u.email, uid: u.uid } : null)),
  };
}

// Mode démonstration : données dans ce navigateur uniquement
function demoStore() {
  const KEY = "planning-radio-demo";
  let mem = {};
  try { mem = JSON.parse(localStorage.getItem(KEY) || "{}"); } catch (e) { mem = {}; }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(mem)); } catch (e) { /* mémoire seule */ } };
  const listeners = new Set();
  let user = null;
  const authL = new Set();
  const clone = (x) => (x == null ? null : JSON.parse(JSON.stringify(x)));
  const notify = () => setTimeout(() => listeners.forEach((l) => l()), 0);
  const collOf = (coll) => Object.keys(mem).filter((k) => k.startsWith(coll + "/") && !k.slice(coll.length + 1).includes("/"))
    .map((k) => ({ id: k.slice(coll.length + 1), ...clone(mem[k]) }));
  const needAdmin = (path) => { if (!user && !path.includes("/indispos/")) throw new StoreError("permission-denied", "Action réservée à l'administrateur."); };
  window.addEventListener("storage", (e) => {
    if (e.key !== KEY) return;
    try { mem = JSON.parse(e.newValue || "{}"); } catch (x) { mem = {}; }
    notify();
  });
  return {
    mode: "demo",
    get: async (path) => clone(mem[path]),
    set: async (path, data) => { needAdmin(path); mem[path] = clone(data); save(); notify(); },
    add: async (coll, data) => {
      const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      mem[coll + "/" + id] = clone(data); save(); notify(); return id;
    },
    del: async (path) => { needAdmin(path); delete mem[path]; save(); notify(); },
    watchDoc: (path, cb) => { const l = () => cb(clone(mem[path])); listeners.add(l); setTimeout(l, 0); return () => listeners.delete(l); },
    watchColl: (coll, cb) => { const l = () => cb(collOf(coll)); listeners.add(l); setTimeout(l, 0); return () => listeners.delete(l); },
    signIn: async (email, pw) => {
      if (!email || !pw) throw new StoreError("auth", "Saisissez une adresse e-mail et un mot de passe (n'importe lesquels en démonstration).");
      user = { email, uid: "demo" }; authL.forEach((f) => f(user));
    },
    signOut: async () => { user = null; authL.forEach((f) => f(null)); },
    onAuth: (cb) => { authL.add(cb); setTimeout(() => cb(user), 0); return () => authL.delete(cb); },
    reset: () => { mem = {}; save(); notify(); },
  };
}

// ================================================================ Règles de sécurité Firestore
function firestoreRules(teamCode, adminUids) {
  const uids = adminUids.map((u) => `'${u}'`).join(", ");
  const cl = [...Array(MAX_CLOTURES).keys()].map((i) => `(c.size() < ${i + 1} || cloture(c[${i}], d1, d2))`).join("\n        && ");
  return `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // Code d'équipe : seul qui le connaît peut lire le planning.
    function equipe(code) { return code == '${teamCode}'; }

    // Administrateurs (identifiants des comptes créés dans Authentication).
    function admin() { return request.auth != null && request.auth.uid in [${uids}]; }

    // Saisie des absences ouverte pour [d1, d2] : après la période publiée
    // et hors des périodes dont la date limite de dépôt est passée.
    function publie(code) { return /databases/$(database)/documents/espaces/$(code)/planning/publie; }
    function saisie(code) { return /databases/$(database)/documents/espaces/$(code)/config/saisie; }
    function apresPublication(code, d1) { return !exists(publie(code)) || d1 > get(publie(code)).data.end; }
    function cloture(k, d1, d2) { return request.time.toMillis() <= k.finMs || d2 < k.du || d1 > k.au; }
    function horsClotures(code, d1, d2) {
      let c = exists(saisie(code)) ? get(saisie(code)).data.clotures : [];
      return ${cl};
    }
    function ouvert(code, d1, d2) { return apresPublication(code, d1) && horsClotures(code, d1, d2); }

    match /espaces/{code}/{document=**} {
      allow read: if equipe(code);
      allow write: if equipe(code) && admin();
    }

    // Indisponibilités : saisies par chaque médecin, format contrôlé, période ouverte.
    match /espaces/{code}/indispos/{id} {
      allow create, update: if equipe(code)
        && request.resource.data.keys().hasAll(['ini', 'd1', 'd2', 'periode', 'motif', 'creeLe'])
        && request.resource.data.keys().hasOnly(['ini', 'd1', 'd2', 'periode', 'motif', 'creeLe'])
        && request.resource.data.ini is string && request.resource.data.ini.size() <= 10
        && request.resource.data.d1 is number && request.resource.data.d2 is number
        && request.resource.data.d2 >= request.resource.data.d1
        && request.resource.data.d2 - request.resource.data.d1 <= 366
        && request.resource.data.periode in ['Journée', 'Matin', 'Après-midi']
        && request.resource.data.motif is string && request.resource.data.motif.size() <= 100
        && (admin() || ouvert(code, request.resource.data.d1, request.resource.data.d2));
      allow delete: if equipe(code) && (admin() || ouvert(code, resource.data.d1, resource.data.d2));
    }
  }
}
`;
}

// Lecture tolérante de la configuration copiée depuis la console Firebase
function parseFirebaseConfig(text) {
  const keys = ["apiKey", "authDomain", "projectId", "storageBucket", "messagingSenderId", "appId"];
  const cfg = {};
  for (const k of keys) {
    const m = new RegExp(`["']?${k}["']?\\s*:\\s*["']([^"']+)["']`).exec(text);
    if (m) cfg[k] = m[1].trim();
  }
  if (!cfg.apiKey || !cfg.projectId || !cfg.appId) return null;
  if (!cfg.authDomain) cfg.authDomain = `${cfg.projectId}.firebaseapp.com`;
  return cfg;
}
