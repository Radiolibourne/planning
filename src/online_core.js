// ================================================================ Planning publié (format stocké en ligne)
// {
//   version, titre, start, end, genereLe, publieLe, publiePar,
//   ordre: [codes], postes: {code: {label, site, adresse, M:[a,b], AM:[a,b], need}},
//   sites: [..], mainSite, jours: [day], semaines: [{lundi, type}], medecins: [ini],
//   cases: {"<day>_<h>_<code>": "AB / CD"}   (seulement les postes ouverts ; "" = fermé)
//   statuts: {ini: {"<day>_<h>": "OFF" | "ABS" | "INDISPO"}}
//   notes?: {"<day>": ["Réunion de service 13h30", "Astreinte : AB"]}   (facultatif)
// }
const caseKey = (d, h, code) => `${d}_${h}_${code}`;
const splitInis = (v) => String(v || "").split("/").map((x) => x.trim().toUpperCase()).filter(Boolean);
const joinInis = (a) => a.join(" / ");
// Télétravail : le médecin apparaît sur son poste, marqué d'une étoile (« CD* »), pas dans une colonne à part
const jumeauTT = (draft, code) => (draft.postes[code + TT_SUFFIX] ? code + TT_SUFFIX : null);
const postesAffiches = (draft) => draft.ordre.filter((c) => !(c.endsWith(TT_SUFFIX) && draft.postes[c.slice(0, -TT_SUFFIX.length)]));
function occupants(draft, d, h, code) {   // [{ini, tt}] sur site puis en télétravail
  const j = jumeauTT(draft, code);
  return splitInis(draft.cases[caseKey(d, h, code)]).map((ini) => ({ ini, tt: false }))
    .concat(j ? splitInis(draft.cases[caseKey(d, h, j)]).map((ini) => ({ ini, tt: true })) : []);
}
const caseOuverte = (draft, d, h, code) => caseKey(d, h, code) in draft.cases || (jumeauTT(draft, code) && caseKey(d, h, jumeauTT(draft, code)) in draft.cases);
const texteOccupants = (occ) => occ.map((o) => o.ini + (o.tt ? TT_MARK : "")).join(" / ");

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
    ...(pr.notes && pr.notes.size ? { notes: Object.fromEntries([...pr.notes].map(([d, t]) => [String(d), t.slice()])) } : {}),
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
// Demandes d'absence : "attente" (à valider par un administrateur), "acceptee", "refusee".
// Les absences enregistrées avant la validation (sans statut) sont considérées comme acceptées.
const statutInd = (x) => (x.statut === "attente" || x.statut === "refusee" ? x.statut : "acceptee");

function onlineAbs(indispos) {
  return indispos.filter((x) => statutInd(x) === "acceptee").map((x) => ({
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
    if (statutInd(x) === "refusee") continue;
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
async function firebaseStore(cfg, opts = {}) {
  const base = `https://www.gstatic.com/firebasejs/${FB_VERSION}/`;
  let A, F, U;
  try {
    [A, F, U] = await Promise.all([import(base + "firebase-app.js"), import(base + "firebase-firestore.js"), import(base + "firebase-auth.js")]);
  } catch (e) {
    throw new StoreError("network", "Impossible de charger Firebase. Vérifiez votre connexion à internet.");
  }
  const app = A.initializeApp(cfg);
  // Cache local des données : le dernier planning consulté reste lisible sans réseau.
  // Ordinateur partagé (opts.partage) : rien n'est gardé sur le disque — données en mémoire seulement,
  // copie locale d'une utilisation précédente effacée, connexion oubliée à la fermeture du navigateur.
  let fs;
  try {
    fs = F.initializeFirestore(app, { localCache: opts.partage && F.memoryLocalCache ? F.memoryLocalCache()
      : F.persistentLocalCache({ tabManager: F.persistentMultipleTabManager() }) });
    if (opts.partage && F.clearIndexedDbPersistence) await F.clearIndexedDbPersistence(fs).catch(() => {});
  } catch (e) { fs = F.getFirestore(app); }
  const auth = U.getAuth(app);
  const persistance = async (partage) => {
    const mode = partage ? U.browserSessionPersistence : U.browserLocalPersistence;
    if (U.setPersistence && mode) await U.setPersistence(auth, mode);
  };
  if (opts.partage) await persistance(true).catch(() => {});
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
    persistance: (partage) => wrap(() => persistance(partage)),
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

    // Administrateurs : principaux (identifiants fixés ici, secret ADMIN_UID de GitHub)
    // et ajoutés depuis le site (Admin → Comptes → « Rendre administrateur »), document admins/{uid}.
    function admin() { return request.auth != null && (request.auth.uid in [${uids}]
      || exists(/databases/$(database)/documents/admins/$(request.auth.uid))); }

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

    // Indisponibilités : chacun les siennes, format contrôlé, période ouverte.
    // Une demande d'un médecin est créée « en attente » ; seul un administrateur l'accepte ou la refuse.
    function demandeValide(d) {
      return d.keys().hasAll(['ini', 'd1', 'd2', 'periode', 'motif', 'creeLe'])
        && d.keys().hasOnly(['ini', 'd1', 'd2', 'periode', 'motif', 'creeLe', 'statut', 'decidePar', 'decideLe', 'refus'])
        && d.ini is string && d.ini.size() <= 10
        && d.d1 is number && d.d2 is number && d.d2 >= d.d1 && d.d2 - d.d1 <= 366
        && d.periode in ['Journée', 'Matin', 'Après-midi']
        && d.motif is string && d.motif.size() <= 100
        && d.get('statut', 'acceptee') in ['attente', 'acceptee', 'refusee']
        && d.get('refus', '') is string && d.get('refus', '').size() <= 200;
    }
    match /espaces/{code}/indispos/{id} {
      allow create: if equipe(code) && demandeValide(request.resource.data)
        && (admin() || (request.resource.data.get('statut', '') == 'attente'
          && auteur(code, request.resource.data.ini) && ouvert(code, request.resource.data.d1, request.resource.data.d2)));
      allow update: if equipe(code) && admin() && demandeValide(request.resource.data);
      allow delete: if equipe(code)
        && (admin() || (auteur(code, resource.data.ini) && ouvert(code, resource.data.d1, resource.data.d2)));
    }

    // Comptes validés : chacun lit le sien ; seuls les administrateurs les créent, modifient ou retirent.
    match /membres/{uid} {
      allow read: if admin() || (request.auth != null && request.auth.uid == uid);
      allow write: if admin();
    }

    // Administrateurs ajoutés depuis le site : un administrateur en ajoute ou en retire d'autres, jamais lui-même.
    match /admins/{uid} {
      allow read: if admin() || (request.auth != null && request.auth.uid == uid);
      allow write: if admin() && request.auth.uid != uid;
    }

    // Notifications : chaque personne enregistre l'abonnement de ses téléphones (identifiant « uid_n »).
    // L'envoi est fait par GitHub avec la clé de service (hors règles).
    match /abonnements/{id} {
      allow read, delete: if admin() || (request.auth != null && id.matches(request.auth.uid + '_[a-z0-9]+'));
      allow create, update: if request.auth != null && membre()
        && id.matches(request.auth.uid + '_[a-z0-9]+')
        && request.resource.data.keys().hasOnly(['uid', 'ini', 'endpoint', 'p256dh', 'auth', 'majLe'])
        && request.resource.data.uid == request.auth.uid
        && request.resource.data.endpoint is string && request.resource.data.endpoint.size() < 1000
        && request.resource.data.endpoint.matches('https://.*')
        && request.resource.data.p256dh is string && request.resource.data.p256dh.size() < 200
        && request.resource.data.auth is string && request.resource.data.auth.size() < 100;
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

// ================================================================ Import du planning Excel « fait main » du service
// Un onglet par semaine (« DU 2 NOVEMBRE AU 6 NOVEMBRE ») : colonne A = libellé de ligne (poste), colonnes B à K = lundi matin … vendredi après-midi.
// Lignes reconnues : déplacements Blaye / Sainte-Foy, scanner, scanner interventionnel, IRM 1 / 2 / Blaye / 3 T, salle, échos, mammographie,
// absences (« (mat) » = le matin seulement), astreinte, notes. « * » = télétravail. Blaye avec deux noms : le 1er en mammo, le 2e en radio-écho.
// Les postes et médecins sont ceux des paramètres actuels ; les noms longs non reconnus (internes…) sont ignorés et signalés.
const MANUEL_LIGNES = [
  [/^interventionnel scanner|^scanner interventionnel/, "SCI"], [/^scanner/, "SCAN"], [/^deplacement blaye/, "@BLAYE"],
  [/^deplacement (ste|sainte)[ -]?foy/, "SF-RE"], [/^irm 1/, "IRM1"], [/^irm 2/, "IRM2"], [/^irm blaye/, "IRMBL"], [/^irm ?:? ?3 ?t/, "IRM3T"],
  [/^salle/, "SI"], [/^echographie 1/, "ECH1"], [/^echographie 2/, "ECH2"], [/^mammographie/, "MAM"],
];
function estPlanningManuel(S) {
  return Object.entries(S).some(([nom, ws]) => /^du \d+/i.test(nom.trim()) || /^semaine du/i.test(norm(ws.get(1, 1))));
}
function draftFromManuel(S, P) {
  const sansAcc = (v) => low(v).replace(/[^a-z0-9 :]/g, " ").replace(/\s+/g, " ").trim();
  const MOISL = MOIS.map((m) => m.normalize("NFD").replace(/[̀-ͯ]/g, ""));
  const lundiDe = (nom, ws) => {
    for (const t of [norm(ws.get(1, 1)), nom]) {
      const m = /du (\d{1,2}) ([a-z]+)(?: (\d{4}))?/.exec(sansAcc(t));
      if (!m) continue;
      const mo = MOISL.findIndex((x) => x.startsWith(m[2].slice(0, 4)));
      if (mo < 0) continue;
      let y = m[3] ? +m[3] : new Date().getFullYear();
      if (!m[3] && mo < new Date().getMonth() - 6) y++;
      const d = dayFromYMD(y, mo + 1, +m[1]);
      return mondayOf(d);
    }
    return null;
  };
  const docs = Object.values(P.docs);
  const ignores = new Set();
  const medecinDe = (tok) => {
    const t = sansAcc(tok).replace(/^dr /, "");
    const d = docs.find((x) => x.ini.toLowerCase() === t) || docs.find((x) => x.nom && sansAcc(x.nom).replace(/^dr /, "") === t);
    if (d) return d.ini;
    if (/^[a-z]{2,4}$/.test(t) && t !== "fer") return t.toUpperCase();   // initiales inconnues des paramètres : conservées
    return null;
  };
  // parenthèses retirées avant découpage (« BM(off à récup : le 19/11) ») ; « (mat) » conservé comme marque
  const jetons = (v) => String(v).replace(/\(([^)]*)\)?/g, (_, x) => (/^\s*mat/i.test(x) ? "§MAT" : "")).replace(/\n/g, "/")
    .split(/\/|,| et /i).map((x) => x.trim()).filter(Boolean).map((raw) => {
    const star = raw.includes("*"), mat = raw.includes("§MAT");
    const n = raw.replace(/§MAT|\*/g, "").trim();
    return { n, star, mat, ini: medecinDe(n) };
  });
  const semaines = [];
  for (const [nom, ws] of Object.entries(S)) {
    const lundi = lundiDe(nom, ws);
    if (lundi !== null && !semaines.some((x) => x.lundi === lundi)) semaines.push({ lundi, ws });
  }
  if (!semaines.length) throw new Error("Aucun onglet de semaine reconnu (« DU 2 NOVEMBRE AU 6 NOVEMBRE »).");
  semaines.sort((a, b) => a.lundi - b.lundi);
  const start = semaines[0].lundi, end = semaines[semaines.length - 1].lundi + 4;
  const pr = buildProblem({ ...P, start, end, abs: [] });
  const draft = draftFromResult(pr, { assign: new Map() });
  for (const ini of Object.keys(draft.statuts)) draft.statuts[ini] = {};   // repos et absences : ceux du fichier
  const notes = {};
  const ajoutNote = (d, t) => { const k = String(d); if (!(notes[k] || []).includes(t)) (notes[k] = notes[k] || []).push(t); };
  const blaye = P.posteOrder.filter((c) => !P.postes[c].tt && low(P.postes[c].site).startsWith("blaye"));
  const twin = (c) => (P.postes[c + TT_SUFFIX] ? c + TT_SUFFIX : null);
  const place = (d, h, code, ini) => { const k = caseKey(d, h, code); const l = splitInis(draft.cases[k]); if (!l.includes(ini)) l.push(ini); draft.cases[k] = joinInis(l); if (!draft.medecins.includes(ini)) draft.medecins.push(ini); };
  for (const { lundi, ws } of semaines) {
    const G = (r, c) => (ws.getFusion ? ws.getFusion(r, c) : ws.get(r, c));
    let courant = null, zone = null;   // poste de la ligne (les lignes sans libellé prolongent la précédente)
    for (let r = 5; r <= ws.maxRow; r++) {
      const lab = sansAcc(ws.get(r, 1));
      if (lab) {
        const m = MANUEL_LIGNES.find(([re]) => re.test(lab));
        courant = m ? m[1] : null;
        zone = lab.startsWith("absence") ? "abs" : lab.startsWith("astreinte") ? "astreinte" : lab.startsWith("note") ? "note" : m ? "poste" : null;
        if (/^(\+|interpretation|radios)/.test(lab)) zone = null;
      }
      if (!zone) continue;
      for (let c = 2; c <= 11; c++) {
        const d = lundi + Math.floor((c - 2) / 2), h = c % 2 === 0 ? "M" : "AM";
        if (P.feries.has(d) || d < start || d > end) continue;
        // une valeur fusionnée sur plusieurs lignes n'est lue qu'une fois
        if (ws.fusionne && ws.fusionne(r, c) && r > 1 && G(r - 1, c) === G(r, c) && sansAcc(ws.get(r, 1)) === "") continue;
        const v = G(r, c);
        if (v === null || v === "") continue;
        const txt = norm(v);
        if (zone === "note") { if (txt && !/^ne pas modifier/i.test(txt)) ajoutNote(d, txt); continue; }
        // astreinte : notée même pour un interne ou un médecin absent des paramètres (nom tel qu'écrit)
        if (zone === "astreinte") { for (const j of jetons(txt)) if (j.ini || j.n) ajoutNote(d, `Astreinte : ${j.ini || j.n}`); continue; }
        if (/maintenance|attente|ferie|ferme/i.test(sansAcc(txt)) && !txt.includes("/")) { if (zone === "poste" && /maintenance/i.test(txt)) ajoutNote(d, txt); continue; }
        if (zone === "abs") {
          for (const j of jetons(txt)) {
            if (!j.ini) { if (j.n) ignores.add(j.n); continue; }
            if (h === "AM" && j.mat) continue;
            (draft.statuts[j.ini] = draft.statuts[j.ini] || {})[`${d}_${h}`] = "ABS";
            if (!j.mat && c % 2 === 0) (draft.statuts[j.ini])[`${d}_AM`] = draft.statuts[j.ini][`${d}_AM`] || "ABS";
          }
          continue;
        }
        let pos = 0;
        for (const j of jetons(txt)) {
          if (!j.ini) { if (j.n && !/maintenance|ferie/i.test(j.n)) ignores.add(j.n); continue; }
          let code = courant;
          if (code === "@BLAYE") {
            const mam = blaye.find((x) => /mam/i.test(x)), re = blaye.find((x) => x !== mam) || mam;
            code = pos === 0 && mam && (!P.docs[j.ini] || P.docs[j.ini].comp[mam]) ? mam : re;
          }
          if (code === "SI" && P.postes.ARTH && !pr.open[pr.slots.findIndex((x) => x.d === d && x.h === h)]?.[pr.pIdx.SI]) code = "ARTH";
          if (!code || !P.postes[code]) continue;
          if ((j.star || P.postes[code].remoteOnly) && twin(code)) code = twin(code);
          place(d, h, code, j.ini);
          pos++;
        }
      }
    }
  }
  // absences : ceux du fichier ; repos fixes repris des paramètres
  pr.docs.forEach((ini, di) => pr.slots.forEach((sl, s) => {
    const k = `${sl.d}_${sl.h}`, st = pr.status[di][s];
    if (st && st !== "ABS" && !(draft.statuts[ini] || {})[k]) (draft.statuts[ini] = draft.statuts[ini] || {})[k] = st;
  }));
  if (Object.keys(notes).length) draft.notes = notes; else delete draft.notes;
  draft.importe = true;
  draft.ignores = [...ignores].slice(0, 30);
  return draft;
}

// ================================================================ Plusieurs mois en ligne
// Publier un planning ne remplace que sa période : les autres jours déjà publiés (le mois précédent, le suivant) sont conservés.
// Les jours trop anciens sont retirés pour rester sous la taille maximale d'un document Firestore (1 Mo).
const HISTORIQUE_JOURS = 70;
function titreMois(start, end) {
  const a = ymd(start), b = ymd(end);
  let m1 = a.y * 12 + a.m - 1 + (a.d > 20 ? 1 : 0), m2 = b.y * 12 + b.m - 1 - (b.d < 7 ? 1 : 0);
  if (m2 < m1) m2 = m1;
  const lab = (m) => MOIS[m % 12], an = (m) => Math.floor(m / 12);
  return m1 === m2 ? `${lab(m1)} ${an(m1)}` : an(m1) === an(m2) ? `${lab(m1)} – ${lab(m2)} ${an(m2)}` : `${lab(m1)} ${an(m1)} – ${lab(m2)} ${an(m2)}`;
}
function fusionnerPublies(ancien, nouveau, aujourdhui) {
  if (!ancien || !ancien.jours || !ancien.jours.length) return nouveau;
  const garde = (d) => (d < nouveau.start || d > nouveau.end) && d >= mondayOf(aujourdhui) - HISTORIQUE_JOURS;
  const joursA = ancien.jours.filter(garde);
  if (!joursA.length) return nouveau;
  const jourDe = (k) => +String(k).split("_")[0];
  const out = JSON.parse(JSON.stringify(nouveau));
  for (const [k, v] of Object.entries(ancien.cases || {})) if (garde(jourDe(k))) out.cases[k] = v;
  for (const [ini, m] of Object.entries(ancien.statuts || {})) for (const [k, v] of Object.entries(m)) if (garde(jourDe(k))) (out.statuts[ini] = out.statuts[ini] || {})[k] = v;
  const notes = {};
  for (const [k, v] of Object.entries(ancien.notes || {})) if (garde(+k)) notes[k] = v;
  if (Object.keys(notes).length || out.notes) out.notes = { ...notes, ...(out.notes || {}) };
  for (const c of ancien.ordre || []) if (!out.ordre.includes(c)) out.ordre.push(c);
  out.postes = { ...(ancien.postes || {}), ...out.postes };
  for (const s of ancien.sites || []) if (!out.sites.includes(s)) out.sites.push(s);
  out.medecins = [...new Set(out.medecins.concat(ancien.medecins || []))];
  out.jours = [...new Set(joursA.concat(out.jours))].sort((a, b) => a - b);
  const types = new Map((ancien.semaines || []).concat(out.semaines).map((w) => [w.lundi, w.type]));
  out.semaines = [...new Set(out.jours.map(mondayOf))].map((lundi) => ({ lundi, type: types.get(lundi) || "A" }));
  out.start = out.jours[0]; out.end = out.jours[out.jours.length - 1];
  out.titre = `Planning du service de radiologie — ${titreMois(out.start, out.end)}`;
  // taille : on retire les semaines les plus anciennes si besoin
  while (JSON.stringify(out).length > 900000 && out.semaines.length > 1 && out.semaines[0].lundi < nouveau.start) {
    const w = out.semaines.shift().lundi, sort = (d) => mondayOf(d) === w;
    out.jours = out.jours.filter((d) => !sort(d));
    for (const k of Object.keys(out.cases)) if (sort(jourDe(k))) delete out.cases[k];
    for (const m of Object.values(out.statuts)) for (const k of Object.keys(m)) if (sort(jourDe(k))) delete m[k];
    if (out.notes) for (const k of Object.keys(out.notes)) if (sort(+k)) delete out.notes[k];
    out.start = out.jours[0];
  }
  return out;
}
