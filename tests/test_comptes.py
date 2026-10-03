# -*- coding: utf-8 -*-
"""
Comptes individuels (accès provisoire par code DÉSACTIVÉ) contre un Firebase simulé appliquant la même logique
que les règles générées : inscription → validation par l'admin → droits limités à ses propres absences →
code seul refusé → relance des dates limites et « aucune absence » → retrait d'accès.
Utilise la page configurée produite par test_demo.py.
"""
import copy, datetime as dt, itertools, json, os, re, time, urllib.parse
from playwright.sync_api import sync_playwright
from commun import Bilan, EXEMPLE, SORTIE, chromium, mois_suivant, numero_jour

B = Bilan("Comptes individuels")
html = open(os.path.join(SORTIE, "index_configure.html"), encoding="utf-8").read()
regles0 = open(os.path.join(SORTIE, "regles.txt"), encoding="utf-8").read()
TEAM = re.search(r"return code == '([^']+)'", regles0).group(1)
ADMIN_UID = re.findall(r"'([A-Za-z0-9]{20,})'", regles0.split("request.auth.uid in [")[1].split("]")[0])[0]
src_fb = open(os.path.join(os.path.dirname(__file__), "test_firebase.py"), encoding="utf-8").read()
FS = re.search(r'FS = r"""(.*?)"""', src_fb, re.S).group(1)
AUTH = r"""
const L = new Set(); let user = null;
const call = async (op, a) => JSON.parse(await window.__fb(op, JSON.stringify(a)));
const fail = (c) => { const e = new Error(c); e.code = c; throw e; };
// persistance « session » (ordinateur partagé) : la connexion survit au rechargement, pas à la fermeture du navigateur
try { user = JSON.parse(sessionStorage.getItem('__fakeUser') || 'null'); if (user) globalThis.__uid = user.uid; } catch (e) {}
const login = (o) => { user = { uid: o.uid, email: o.email }; globalThis.__uid = o.uid;
  if (globalThis.__persistance === 'session') sessionStorage.setItem('__fakeUser', JSON.stringify(user)); L.forEach((f) => f(user)); return { user }; };
export const browserSessionPersistence = 'session', browserLocalPersistence = 'local';
export async function setPersistence(a, m){ globalThis.__persistance = m; }
export function getAuth(){ return {}; }
export async function signInWithEmailAndPassword(a, email, pw){ const o = await call('signin', { email, pw }); if (o.error) fail(o.error); return login(o); }
export async function createUserWithEmailAndPassword(a, email, pw){ const o = await call('signup', { email, pw }); if (o.error) fail(o.error); return login(o); }
export async function sendPasswordResetEmail(a, email){ await call('reset', { email }); }
export async function signOut(){ user = null; globalThis.__uid = null; sessionStorage.removeItem('__fakeUser'); L.forEach((f) => f(null)); }
export function onAuthStateChanged(a, cb){ L.add(cb); setTimeout(() => cb(user), 0); return () => L.delete(cb); }
"""
APP = "export function initializeApp(cfg){ return {cfg}; }"
MODS = {"firebase-app.js": APP, "firebase-firestore.js": (FS.replace("export function getFirestore(app){ return { app }; }",
        "export function getFirestore(app){ return { app }; }\nexport function persistentMultipleTabManager(){ return {}; }\n"
        "export function persistentLocalCache(o){ return {}; }\nexport function initializeFirestore(app, s){ return { app }; }") if "initializeFirestore" not in FS else FS) + (
        "\nexport function memoryLocalCache(){ globalThis.__cacheMemoire = true; return { kind: 'memory' }; }"
        "\nexport async function clearIndexedDbPersistence(){ globalThis.__cacheEfface = true; }"),
        "firebase-auth.js": AUTH}

# ------------------------------------------------------------------ serveur simulé (même logique que les règles)
USERS = {"admin@chl.fr": ("secret", ADMIN_UID)}
DB, ver, ids = {}, [0], itertools.count(1)
def bump(): ver[0] += 1
def email_of(uid): return next((e for e, (p, u) in USERS.items() if u == uid), None)
def is_admin(uid): return uid is not None and (uid == ADMIN_UID or f"admins/{uid}" in DB)
def membre(uid): return uid is not None and f"membres/{uid}" in DB
def moi(uid): return DB.get(f"membres/{uid}") or {}
def code_seul():
    d = DB.get(f"espaces/{TEAM}/config/acces")
    return d is None or d.get("codeSeul") is not False
def lecteur(code, uid): return code == TEAM and (is_admin(uid) or membre(uid) or code_seul())
def auteur(ini, uid): return (ini == moi(uid).get("ini")) if membre(uid) else code_seul()
def ouvert(d1, d2):
    pub = DB.get(f"espaces/{TEAM}/planning/publie")
    if pub and d1 <= pub["end"]: return False
    sa = DB.get(f"espaces/{TEAM}/config/saisie") or {}
    now = time.time() * 1000
    return all(now <= c["finMs"] or d2 < c["du"] or d1 > c["au"] for c in sa.get("clotures", [])[:5])
def valid_indispo(d):
    base = {"ini", "d1", "d2", "periode", "motif", "creeLe"}
    return (base <= set(d) <= base | {"statut", "decidePar", "decideLe", "refus"} and d.get("statut", "acceptee") in ("attente", "acceptee", "refusee") and isinstance(d["ini"], str) and len(d["ini"]) <= 10
            and d["d2"] >= d["d1"] and d["d2"] - d["d1"] <= 366 and d["periode"] in ("Journée", "Matin", "Après-midi"))
def peut_lire(path, uid):
    s = path.split("/")
    if s[0] == "espaces":
        return lecteur(s[1], uid)
    if s[0] in ("membres", "demandes", "declarations", "admins"):
        return is_admin(uid) or (len(s) == 2 and uid == s[1])
    if s[0] == "abonnements":
        return is_admin(uid) or (uid is not None and re.fullmatch(re.escape(uid) + r"_[a-z0-9]+", s[1]) is not None)
    return False
def peut_ecrire(op, path, uid, data):
    s = path.split("/"); old = DB.get(path)
    if s[0] == "espaces":
        if s[1] != TEAM: return False
        if len(s) >= 3 and s[2] == "indispos":
            if op == "del": return is_admin(uid) or (old is not None and auteur(old["ini"], uid) and ouvert(old["d1"], old["d2"]))
            if op == "set" and old is not None: return is_admin(uid) and valid_indispo(data)       # décision de l'administrateur
            return valid_indispo(data) and (is_admin(uid) or (data.get("statut") == "attente" and auteur(data["ini"], uid) and ouvert(data["d1"], data["d2"])))
        return is_admin(uid)
    if s[0] == "membres": return is_admin(uid)
    if s[0] == "admins": return is_admin(uid) and uid != s[1]
    if s[0] == "abonnements":
        propre = uid is not None and re.fullmatch(re.escape(uid) + r"_[a-z0-9]+", s[1]) is not None
        if op == "del": return is_admin(uid) or propre
        return (propre and membre(uid) and set(data) <= {"uid", "ini", "endpoint", "p256dh", "auth", "majLe"}
                and data.get("uid") == uid and str(data.get("endpoint", "")).startswith("https://"))
    if s[0] == "demandes":
        if op == "del": return is_admin(uid) or uid == s[1]
        return (uid == s[1] and set(data) == {"email", "ini", "nom", "creeLe"} and data["email"] == email_of(uid)
                and len(data["ini"]) <= 10 and len(data["nom"]) <= 60)
    if s[0] == "declarations":
        return is_admin(uid) or (uid == s[1] and membre(uid) and set(data) <= {"ini", "aucune", "majLe"} and data.get("ini") == moi(uid).get("ini"))
    return False
def server(op, a):
    uid = a.get("uid"); p = a.get("path")
    if op == "poll": return {"v": ver[0]}
    if op == "signin":
        u = USERS.get(a["email"])
        return {"uid": u[1], "email": a["email"]} if u and u[0] == a["pw"] else {"error": "auth/invalid-credential"}
    if op == "signup":
        if a["email"] in USERS: return {"error": "auth/email-already-in-use"}
        if len(a["pw"]) < 6: return {"error": "auth/weak-password"}
        u = f"uid{next(ids):04d}xxxxxxxxxxxxxxxx"; USERS[a["email"]] = (a["pw"], u); return {"uid": u, "email": a["email"]}
    if op == "reset": return {}
    if op == "get":
        return {"data": copy.deepcopy(DB.get(p))} if peut_lire(p, uid) else {"error": "permission-denied"}
    if op == "list":
        if not peut_lire(p, uid) or (p.split("/")[0] in ("membres", "demandes", "declarations", "admins") and not is_admin(uid)):
            return {"error": "permission-denied"}
        n = len(p.split("/")) + 1
        return {"docs": [dict(id=k.split("/")[-1], **v) for k, v in DB.items() if k.startswith(p + "/") and len(k.split("/")) == n]}
    if op == "add":
        p = p + "/" + f"id{next(ids)}"
    if not peut_ecrire(op, p, uid, a.get("data")): return {"error": "permission-denied"}
    if op == "del": DB.pop(p, None)
    else: DB[p] = copy.deepcopy(a["data"])
    bump()
    return {"id": p.split("/")[-1]}

from cryptography.hazmat.primitives.asymmetric import ec as _ec
from cryptography.hazmat.primitives import serialization as _ser
import base64 as _b64
_pub = _ec.generate_private_key(_ec.SECP256R1()).public_key().public_bytes(_ser.Encoding.X962, _ser.PublicFormat.UncompressedPoint)
CLE_NOTIF = _b64.urlsafe_b64encode(_pub).rstrip(b"=").decode()
STUB_PUSH = """() => {
  let courant = null;
  const sub = { endpoint: "https://push.exemple.test/abc", options: {},
    toJSON() { return { endpoint: this.endpoint, keys: { p256dh: "BPk0", auth: "QQ0" } }; },
    unsubscribe: async () => { courant = null; return true; } };
  const reg = { pushManager: { getSubscription: async () => courant,
      subscribe: async (o) => { window.__cleRecue = Array.from(o.applicationServerKey); courant = sub; return sub; } },
    showNotification: () => { window.__montree = true; } };
  Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: { ready: Promise.resolve(reg),
    getRegistration: async () => reg, register: async () => reg, addEventListener() {}, controller: null } });
  if (!window.PushManager) window.PushManager = function () {};
  const N = function () {}; N.permission = "default"; N.requestPermission = async () => { N.permission = "granted"; return "granted"; };
  Object.defineProperty(window, "Notification", { configurable: true, value: N });
}"""

def route(r):
    u = r.request.url
    if u.startswith("https://planning.test/"):
        if "/cal/" in u or u.endswith(".png") or u.endswith(".js") and "sw.js" in u: return r.fulfill(status=404, body="")
        if u.endswith("/notifications.json"): return r.fulfill(status=200, body=json.dumps({"cle": CLE_NOTIF}), headers={"content-type": "application/json"})
        return r.fulfill(status=200, body=html, headers={"content-type": "text/html; charset=utf-8"})
    m = re.match(r"https://www\.gstatic\.com/firebasejs/10\.14\.1/(firebase-[a-z]+\.js)$", u)
    if m: return r.fulfill(status=200, body=MODS[m.group(1)], headers={"content-type": "application/javascript", "access-control-allow-origin": "*"})
    r.abort()

ok = B.ok
erreurs = []
d1, d2 = mois_suivant()
m2 = d2 + dt.timedelta(days=1)                     # mois d'après : période de la date limite
m2_fin = (m2.replace(day=28) + dt.timedelta(days=4)).replace(day=1) - dt.timedelta(days=1)
with sync_playwright() as pw:
    b = chromium(pw)
    def page():
        ctx = b.new_context(viewport={"width": 390, "height": 844}, is_mobile=True)
        ctx.route("**/*", route)
        pg = ctx.new_page()
        pg.expose_function("__fb", lambda op, a: json.dumps(server(op, json.loads(a))))
        pg.on("pageerror", lambda e: erreurs.append(str(e))); pg.on("dialog", lambda d: d.accept())
        return pg
    # ---------------- administrateur : connexion par compte, code saisi une fois, paramètres
    adm = page()
    adm.goto("https://planning.test/")
    adm.wait_for_selector("#vAuth:not([hidden])")
    adm.fill("#aEmail", "admin@chl.fr"); adm.fill("#aPw", "secret"); adm.click("#aSubmit")
    adm.wait_for_selector("#vCode:not([hidden])")
    ok("Administrateur" in adm.inner_text("#codeSub"), "admin : code d'équipe demandé une seule fois")
    adm.fill("#codeInput", TEAM); adm.click("#codeForm button")
    adm.wait_for_selector("#vMon:not([hidden])")
    adm.wait_for_function("1", timeout=2000)
    ok(f"membres/{ADMIN_UID}" in DB and DB[f"membres/{ADMIN_UID}"]["espace"] == TEAM, "admin : fiche de compte créée (code mémorisé côté serveur)")
    adm.goto("https://planning.test/#admin"); adm.wait_for_selector("#adminBody:not([hidden])")
    adm.set_input_files("#upParams", EXEMPLE)
    adm.wait_for_function("document.querySelector('#paramInfo').innerText.includes('11 médecins')", timeout=10000)
    ok(not adm.is_hidden("#accCard"), "admin : carte « Comptes » visible")
    # règles : celles de la page = celles que publie GitHub (même code source)
    adm.click("#rulesCard summary")
    texte = adm.input_value("#rText")
    import subprocess, sys as _sys
    racine = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    r = subprocess.run([_sys.executable, os.path.join(racine, "outils", "publier_regles.py"), "--essai"], capture_output=True, text=True,
                       env={**os.environ, "CODE_EQUIPE": TEAM, "ADMIN_UID": ADMIN_UID})
    ok(r.returncode == 0 and r.stdout == texte, "règles : texte identique entre la page et la publication par GitHub")
    ok("config/acces" in texte and "match /membres/{uid}" in texte, "règles : comptes et interrupteur d'accès provisoire")
    # interrupteur : accès provisoire désactivé depuis Admin → Comptes
    ok(adm.is_checked("#accCode"), "accès provisoire autorisé par défaut")
    adm.uncheck("#accCode")
    adm.wait_for_function("document.querySelector('#accMsg').innerText.includes('désactivé')", timeout=8000)
    ok(DB.get(f"espaces/{TEAM}/config/acces", {}).get("codeSeul") is False, "admin : accès par code désactivé d'un clic (sans republier les règles)")
    # ---------------- médecin : inscription
    doc = page()
    doc.goto("https://planning.test/")
    doc.wait_for_selector("#vAuth:not([hidden])")
    doc.click("#authToggle")
    doc.fill("#aEmail", "da@chl.fr"); doc.fill("#aPw", "motdepasse1"); doc.fill("#aPw2", "motdepasse1")
    doc.fill("#aIni", "da"); doc.fill("#aNom", "Dr A")
    doc.click("#aSubmit")
    doc.wait_for_selector("#authPending:not([hidden])", timeout=8000)
    ok("DA" in doc.inner_text("#authPendingTxt"), "médecin : demande envoyée, en attente de validation")
    uid_da = USERS["da@chl.fr"][1]
    ok(DB.get(f"demandes/{uid_da}", {}).get("ini") == "DA", "demande enregistrée avec les initiales")
    # tentative de lecture du planning sans validation
    r = doc.evaluate("async (t) => JSON.parse(await window.__fb('get', JSON.stringify({path: 'espaces/' + t + '/config/parametres', uid: globalThis.__uid}))).error || 'lu'", TEAM)
    ok(r == "permission-denied", "compte non validé : aucun accès aux données")
    # ---------------- administrateur : validation
    adm.wait_for_selector(f'#accPend li[data-uid="{uid_da}"]', timeout=8000)
    adm.select_option(f'#accPend li[data-uid="{uid_da}"] [data-ini]', "DA")
    adm.click(f'#accPend li[data-uid="{uid_da}"] [data-valider]')
    adm.wait_for_function("document.querySelector('#accMsg').innerText.includes('validé')", timeout=8000)
    ok(DB.get(f"membres/{uid_da}", {}).get("ini") == "DA" and f"demandes/{uid_da}" not in DB, "admin : compte validé, demande retirée")
    # ---------------- médecin : la page s'ouvre toute seule
    doc.wait_for_selector("#vMon:not([hidden])", timeout=10000)
    ok(doc.inner_text("#meBtn") == "Vous : DA", "médecin : connecté avec ses initiales (sans les choisir)")
    doc.click("#meBtn")
    ok(doc.is_visible("#whoAccount") and doc.is_hidden("#whoPick"), "médecin : fenêtre compte, pas de choix d'initiales")
    doc.click("#whoClose")
    ok(doc.is_hidden("#adminBtn"), "médecin : pas de bouton Admin")
    # absences : les siennes uniquement
    x = m2_fin + dt.timedelta(days=20)
    doc.click("a[data-tab=indispos]")
    doc.fill("#indD1", x.isoformat()); doc.fill("#indD2", x.isoformat()); doc.click("#indSubmit")
    doc.wait_for_function("document.querySelector('#indMsg').innerText.includes('en attente')", timeout=8000)
    ok(any(v.get("ini") == "DA" for k, v in DB.items() if "/indispos/" in k), "médecin : demande enregistrée à son nom")
    r = doc.evaluate("""async ([t, j]) => JSON.parse(await window.__fb('add', JSON.stringify({path: 'espaces/' + t + '/indispos', uid: globalThis.__uid,
        data: {ini: 'DB', d1: j, d2: j, periode: 'Journée', motif: 'test', creeLe: 1}}))).error || 'accepté'""", [TEAM, numero_jour(x)])
    ok(r == "permission-denied", "serveur : impossible de déclarer une absence au nom d'un collègue")
    # ---------------- accès par simple code : refusé
    anon = page()
    anon.goto("https://planning.test/"); anon.wait_for_selector("#vAuth:not([hidden])"); anon.click("#authCode")
    anon.fill("#codeInput", TEAM); anon.click("#codeForm button")
    anon.wait_for_function("document.querySelector('#codeMsg').innerText.includes('refusé')", timeout=8000)
    ok(True, "code d'équipe seul : refusé (accès provisoire désactivé)")
    # ---------------- ordinateur partagé (poste de l'hôpital)
    poste = page()
    poste.goto("https://planning.test/"); poste.wait_for_selector("#vAuth:not([hidden])")
    poste.check("#aPartage")
    poste.fill("#aEmail", "admin@chl.fr"); poste.fill("#aPw", "secret"); poste.click("#aSubmit")
    poste.wait_for_selector("#tabs:not([hidden])", timeout=10000)
    etat = poste.evaluate("""() => ({ partage: localStorage.getItem('planning-radio-partage'),
        disque: Object.keys(localStorage).filter((k) => k.startsWith('planning-radio-') && k !== 'planning-radio-partage' && k !== 'planning-radio-plis'),
        session: Object.keys(sessionStorage).filter((k) => k.startsWith('planning-radio-')),
        persistance: globalThis.__persistance, memoire: !!globalThis.__cacheMemoire, efface: !!globalThis.__cacheEfface })""")
    ok(etat["partage"] == "1" and etat["persistance"] == "session", "ordinateur partagé : connexion oubliée à la fermeture du navigateur")
    ok(etat["memoire"] and etat["efface"], "ordinateur partagé : données en mémoire seulement, copie locale effacée")
    ok(not etat["disque"] and "planning-radio-membre" in etat["session"], f"ordinateur partagé : rien de personnel gardé sur le disque {etat['disque']}")
    poste.evaluate("derniereActivite = Date.now() - 31 * 60 * 1000; verifInactivite()")
    poste.wait_for_selector("#vAuth:not([hidden])", timeout=8000)
    ok("30 minutes" in poste.inner_text("#authMsg"), "ordinateur partagé : déconnexion automatique après 30 minutes sans activité")
    poste.close()
    sans = doc.evaluate("indLine({ini: 'DB', d1: 20000, d2: 20000, periode: 'Journée', motif: 'Autre — rendez-vous'}, false, true, true)")
    ok("absent" in sans and "rendez-vous" not in sans, "liste de l'équipe : motif des absences des collègues masqué")
    # ---------------- relance : date limite sur le mois d'après, ouverte jusqu'à demain
    demain = dt.date.today() + dt.timedelta(days=1)
    adm.fill("#cDu", m2.isoformat()); adm.fill("#cAu", m2_fin.isoformat()); adm.fill("#cLim", demain.isoformat()); adm.click("#cAdd")
    adm.wait_for_function("document.querySelector('#cloList').innerText.includes('Rien déclaré')", timeout=8000)
    lien = adm.get_attribute("#cloList a.b", "href") or ""
    ok("DA" in adm.inner_text("#cloList") and "da%40chl.fr" in lien, "relance : DA listé, e-mail de relance prérempli à son adresse")
    ok("Sans compte" in adm.inner_text("#cloList"), "relance : médecins sans compte signalés")
    doc.click("a[data-tab=mon]")
    doc.wait_for_function("document.querySelector('#vMon').innerText.includes('à déclarer avant')", timeout=10000)
    ok(True, "médecin : rappel de la date limite dans l'appli")
    doc.click("#vMon [data-aucune]")
    adm.wait_for_function("!document.querySelector('#cloList').innerText.match(/Rien déclaré : [^·\\n]*\\bDA\\b/)", timeout=8000)
    ok("aucune absence » : DA" in adm.inner_text("#cloList"), "« aucune absence » : DA retiré de la relance")
    doc.wait_for_function("!document.querySelector('#vMon [data-aucune]')", timeout=8000)
    ok(True, "médecin : rappel disparu après sa déclaration")
    # ---------------- onglet Absences : périodes demandées, « aucune absence » annulable
    doc.click("a[data-tab=indispos]")
    doc.wait_for_selector("#indRelance [data-annuler-aucune]", timeout=8000)
    ok("Aucune absence" in doc.inner_text("#indRelance"), "Absences : période demandée listée avec « Aucune absence »")
    doc.click("#indRelance [data-annuler-aucune]")
    doc.wait_for_selector("#indRelance [data-aucune]", timeout=8000)
    ok(not any((v.get("aucune") or {}) for k, v in DB.items() if k == f"declarations/{uid_da}"), "« aucune absence » annulée")
    doc.click("#indRelance [data-aucune]")
    doc.wait_for_selector("#indRelance [data-annuler-aucune]", timeout=8000)
    ok(any((v.get("aucune") or {}) for k, v in DB.items() if k == f"declarations/{uid_da}"), "« aucune absence » redéclarée depuis l'onglet Absences")
    # ---------------- notifications
    doc.evaluate(STUB_PUSH)
    doc.click("a[data-tab=cal]"); doc.wait_for_selector("#notifOn", timeout=8000)
    doc.click("#notifOn")
    doc.wait_for_function("document.querySelector('#notifMsg').innerText.includes('activées')", timeout=8000)
    abos = {k: v for k, v in DB.items() if k.startswith("abonnements/")}
    ok(len(abos) == 1 and list(abos)[0].split("/")[1].startswith(uid_da + "_") and list(abos.values())[0]["ini"] == "DA",
       "notifications : abonnement du téléphone enregistré pour DA")
    cle = doc.evaluate("window.__cleRecue")
    ok(bytes(cle) == _b64.urlsafe_b64decode(CLE_NOTIF + "=="), "notifications : clé publique du site utilisée")
    ok(doc.is_visible("#notifOff"), "notifications : état « activées » affiché")
    r = doc.evaluate("""async () => JSON.parse(await window.__fb('set', JSON.stringify({path: 'abonnements/autre_abc', uid: globalThis.__uid,
        data: {uid: 'autre', ini: 'DB', endpoint: 'https://x.test/', p256dh: 'a', auth: 'b', majLe: 1}}))).error || 'accepté'""")
    ok(r == "permission-denied", "serveur : impossible d'abonner le téléphone d'un collègue")
    doc.click("#notifOff")
    doc.wait_for_function("document.querySelector('#notifMsg').innerText.includes('désactivées')", timeout=8000)
    ok(not any(k.startswith("abonnements/") for k in DB), "notifications : désactivation supprime l'abonnement")
    # ---------------- second administrateur, depuis Admin → Comptes
    adm.click(f'#accList li[data-uid="{uid_da}"] [data-admin-oui]')
    adm.wait_for_function("document.querySelector('#accMsg').innerText.includes('est administrateur')", timeout=8000)
    ok(f"admins/{uid_da}" in DB, "admin : DA rendu administrateur")
    doc.reload(); doc.wait_for_selector("#vAuth:not([hidden])", timeout=10000)   # (connexion simulée non conservée au rechargement)
    doc.fill("#aEmail", "da@chl.fr"); doc.fill("#aPw", "motdepasse1"); doc.click("#aSubmit")
    doc.wait_for_selector("#adminBtn:not([hidden])", timeout=10000)
    ok(True, "DA : bouton Admin après rechargement")
    r = doc.evaluate("""async (u) => JSON.parse(await window.__fb('del', JSON.stringify({path: 'admins/' + u, uid: globalThis.__uid}))).error || 'accepté'""", uid_da)
    ok(r == "permission-denied", "serveur : un administrateur ne peut pas modifier ses propres droits")
    adm.wait_for_selector(f'#accList li[data-uid="{uid_da}"] [data-admin-non]', timeout=8000)
    adm.click(f'#accList li[data-uid="{uid_da}"] [data-admin-non]')
    adm.wait_for_function("document.querySelector('#accMsg').innerText.includes(\"n'est plus administrateur\")", timeout=8000)
    ok(f"admins/{uid_da}" not in DB, "admin : droits de DA retirés")
    doc.reload(); doc.wait_for_selector("#vAuth:not([hidden])", timeout=10000)   # (connexion simulée non conservée au rechargement)
    doc.fill("#aEmail", "da@chl.fr"); doc.fill("#aPw", "motdepasse1"); doc.click("#aSubmit")
    doc.wait_for_selector("#tabs:not([hidden])", timeout=10000); doc.wait_for_timeout(500)
    ok(doc.is_hidden("#adminBtn"), "DA : plus de bouton Admin")
    doc.click("a[data-tab=mon]")
    # ---------------- retrait d'accès
    adm.click(f'#accList li[data-uid="{uid_da}"] [data-retirer]')
    adm.wait_for_function("document.querySelector('#accMsg').innerText.includes('retiré')", timeout=8000)
    doc.wait_for_selector("#vAuth:not([hidden])", timeout=10000)
    ok("retiré" in doc.inner_text("#authMsg") or doc.is_visible("#authComplete") or doc.is_visible("#authMain"), "médecin : accès coupé immédiatement")
    b.close()
ok(not erreurs, "aucune erreur JavaScript" + (f" : {erreurs[:3]}" if erreurs else ""))
raise SystemExit(0 if B.fin() else 1)
