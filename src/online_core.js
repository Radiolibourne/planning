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
    let inis = splitInis(draft.cases[caseKey(sl.d, sl.h, code)]);
    // planning avec télétravail contrôlé avec des paramètres sans télétravail : compté sur le poste d'origine
    if (pr.pIdx[code + TT_SUFFIX] === undefined) inis = inis.concat(splitInis(draft.cases[caseKey(sl.d, sl.h, code + TT_SUFFIX)]));
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
  if (c.includes("email-already-in-use")) return new StoreError("auth", "Un compte existe déjà avec cette adresse : connectez-vous (ou « Mot de passe oublié ? »).");
  if (c.includes("weak-password")) return new StoreError("auth", "Mot de passe trop court : 6 caractères au minimum.");
  if (c.includes("missing-password")) return new StoreError("auth", "Saisissez un mot de passe.");
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
  // Cache local des données : le dernier planning consulté reste lisible sans réseau.
  let fs;
  try { fs = F.initializeFirestore(app, { localCache: F.persistentLocalCache({ tabManager: F.persistentMultipleTabManager() }) }); }
  catch (e) { fs = F.getFirestore(app); }
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
    createAccount: (email, pw) => wrap(() => U.createUserWithEmailAndPassword(auth, email, pw)),
    resetPassword: (email) => wrap(() => U.sendPasswordResetEmail(auth, email)),
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
  const needAdmin = (path) => { if (!user && !path.includes("/indispos/") && !path.startsWith("declarations/")) throw new StoreError("permission-denied", "Action réservée à l'administrateur."); };
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
// L'accès provisoire par simple code d'équipe se règle dans le site (document config/acces), sans republier les règles.
function firestoreRules(teamCode, adminUids) {
  const uids = adminUids.map((u) => `'${u}'`).join(", ");
  const cl = [...Array(MAX_CLOTURES).keys()].map((i) => `(c.size() < ${i + 1} || cloture(c[${i}], d1, d2))`).join("\n        && ");
  return `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // Code d'équipe : identifie l'espace du service.
    function equipe(code) { return code == '${teamCode}'; }

    // Administrateurs (identifiants des comptes créés dans Authentication).
    function admin() { return request.auth != null && request.auth.uid in [${uids}]; }

    // Comptes individuels validés par un administrateur.
    function membre() { return request.auth != null && exists(/databases/$(database)/documents/membres/$(request.auth.uid)); }
    function moi() { return get(/databases/$(database)/documents/membres/$(request.auth.uid)).data; }

    // Accès provisoire par simple code d'équipe (sans compte) : autorisé tant que l'administrateur
    // ne l'a pas désactivé dans le site (Admin → Comptes), document espaces/{code}/config/acces.
    function acces(code) { return /databases/$(database)/documents/espaces/$(code)/config/acces; }
    function codeSeul(code) { return !exists(acces(code)) || get(acces(code)).data.codeSeul != false; }
    function lecteur(code) { return equipe(code) && (admin() || membre() || codeSeul(code)); }

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
    // Auteur légitime d'une absence : le médecin lui-même (compte) ou, en transition, quiconque a le code.
    function auteur(code, ini) { return membre() ? ini == moi().ini : codeSeul(code); }

    match /espaces/{code}/{document=**} {
      allow read: if lecteur(code);
      allow write: if equipe(code) && admin();
    }

    // Planning publié : lisible avec le seul code (calendriers d'abonnement produits par GitHub).
    match /espaces/{code}/planning/publie {
      allow read: if equipe(code);
    }

    // Indisponibilités : chacun les siennes, format contrôlé, période ouverte.
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
        && (admin() || (auteur(code, request.resource.data.ini) && ouvert(code, request.resource.data.d1, request.resource.data.d2)));
      allow delete: if equipe(code)
        && (admin() || (auteur(code, resource.data.ini) && ouvert(code, resource.data.d1, resource.data.d2)));
    }

    // Comptes validés : chacun lit le sien ; seuls les administrateurs les créent, modifient ou retirent.
    match /membres/{uid} {
      allow read: if admin() || (request.auth != null && request.auth.uid == uid);
      allow write: if admin();
    }

    // Demandes de compte : créées par la personne elle-même, examinées par un administrateur.
    match /demandes/{uid} {
      allow read: if admin() || (request.auth != null && request.auth.uid == uid);
      allow create: if request.auth != null && request.auth.uid == uid
        && request.resource.data.keys().hasAll(['email', 'ini', 'nom', 'creeLe'])
        && request.resource.data.keys().hasOnly(['email', 'ini', 'nom', 'creeLe'])
        && request.resource.data.email == request.auth.token.email
        && request.resource.data.ini is string && request.resource.data.ini.size() <= 10
        && request.resource.data.nom is string && request.resource.data.nom.size() <= 60;
      allow delete: if admin() || (request.auth != null && request.auth.uid == uid);
    }

    // « Je n'ai aucune absence sur cette période » (relance des dates limites).
    match /declarations/{uid} {
      allow read: if admin() || (request.auth != null && request.auth.uid == uid);
      allow write: if admin() || (request.auth != null && request.auth.uid == uid && membre()
        && request.resource.data.keys().hasOnly(['ini', 'aucune', 'majLe'])
        && request.resource.data.ini == moi().ini);
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

// ================================================================ Abonnement calendrier (webcal)
// Même jeton que outils/calendriers_abonnement.py : HMAC-SHA256(code d'équipe, "cal:" + initiales), 24 caractères hexa.
async function calToken(code, ini) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(code), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode("cal:" + ini)));
  return [...sig].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 24);
}
