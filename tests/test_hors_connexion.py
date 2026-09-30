# -*- coding: utf-8 -*-
"""
Ouverture hors connexion : le site (servi comme sur GitHub Pages) s'installe dans le navigateur,
puis se rouvre réseau coupé, sans perdre le code d'équipe, avec le bandeau « Hors connexion ».
Utilise la page configurée produite par test_demo.py et le Firebase simulé de test_firebase.py.
"""
import json, os, re
from playwright.sync_api import sync_playwright
from commun import Bilan, DIST, SORTIE, chromium

B = Bilan("Hors connexion (application installée)")
html = open(os.path.join(SORTIE, "index_configure.html"), encoding="utf-8").read()
TEAM = re.search(r"return code == '([^']+)'", open(os.path.join(SORTIE, "regles.txt"), encoding="utf-8").read()).group(1)
src_fb = open(os.path.join(os.path.dirname(__file__), "test_firebase.py"), encoding="utf-8").read()

APP = "export function initializeApp(cfg){ return {cfg}; }"
FS = re.search(r'FS = r"""(.*?)"""', src_fb, re.S).group(1)
AUTH = re.search(r'AUTH = r"""(.*?)"""', src_fb, re.S).group(1)
FB = {"firebase-app.js": APP, "firebase-firestore.js": FS, "firebase-auth.js": AUTH}
DB = {f"espaces/{TEAM}/config/parametres": None}


def serveur(op, a):
    p = a.get("path", "")
    if op == "poll":
        return {"v": 1}
    if p.split("/")[1:2] != [TEAM]:
        return {"error": "permission-denied"}
    if op == "get":
        return {"data": DB.get(p)}
    if op == "list":
        return {"docs": []}
    return {"error": "permission-denied"}


# Site servi par un vrai petit serveur local (http://localhost est un « contexte sécurisé » :
# les service workers y fonctionnent). La bibliothèque Firebase simulée est servie par le même serveur.
import http.server, shutil, socketserver, tempfile, threading
RACINE_WEB = tempfile.mkdtemp(prefix="planning-web-")
for f in os.listdir(DIST):
    shutil.copy(os.path.join(DIST, f), RACINE_WEB)
os.makedirs(os.path.join(RACINE_WEB, "firebasejs", "10.14.1"))
for nom, code in FB.items():
    open(os.path.join(RACINE_WEB, "firebasejs", "10.14.1", nom), "w", encoding="utf-8").write(code)


class Silencieux(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=RACINE_WEB, **k)

    def log_message(self, *a):
        pass


class Serveur(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True          # ne pas attendre les connexions ouvertes du navigateur à l'arrêt
    block_on_close = False


srv = Serveur(("127.0.0.1", 0), Silencieux)
PORT = srv.server_address[1]
BASE = f"http://localhost:{PORT}/"
open(os.path.join(RACINE_WEB, "index.html"), "w", encoding="utf-8").write(
    html.replace("https://www.gstatic.com/firebasejs/", BASE + "firebasejs/"))
threading.Thread(target=srv.serve_forever, daemon=True).start()

with sync_playwright() as pw:
    b = chromium(pw)
    ctx = b.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, service_workers="allow")
    erreurs = []
    pg = ctx.new_page()
    pg.expose_function("__fb", lambda op, a: json.dumps(serveur(op, json.loads(a))))
    pg.on("pageerror", lambda e: erreurs.append(str(e)))
    pg.goto(BASE)
    B.ok(pg.evaluate("document.querySelector('link[rel=manifest]') !== null"), "manifeste d'application déclaré")
    man = json.load(open(os.path.join(DIST, "manifest.webmanifest"), encoding="utf-8"))
    B.ok(man["short_name"] == "Planning radio" and len(man["icons"]) == 3, "manifeste : nom « Planning radio » et icônes")
    pg.wait_for_selector("#vCode:not([hidden])")
    pg.fill("#codeInput", TEAM); pg.click("#codeForm button")
    pg.wait_for_selector("#vMon:not([hidden])")
    pg.wait_for_function("navigator.serviceWorker.getRegistrations().then((r) => r.some((x) => x.active))", timeout=20000, polling=500)
    pg.reload(); pg.wait_for_function("navigator.serviceWorker.controller !== null", timeout=15000)
    B.ok(True, "service worker installé et actif")
    pg.wait_for_timeout(1000)
    # coupure du réseau
    pg.evaluate("localStorage.setItem('planning-radio-me', 'DA')")   # initiales déjà choisies sur l'appareil
    srv.shutdown(); srv.server_close()          # le serveur n'existe plus : vraie coupure
    ctx.set_offline(True)
    pg.reload()
    pg.wait_for_selector("#vMon:not([hidden])", timeout=15000)
    B.ok(True, "site rouvert sans réseau (copie locale)")
    B.ok(pg.is_visible("#offlineBanner"), "bandeau « Hors connexion » affiché")
    B.ok(pg.is_hidden("#vCode"), "code d'équipe conservé (pas de nouvelle saisie)")
    pg.click("a[data-tab=indispos]")
    pg.evaluate("document.querySelector('#indD1').value='2030-01-07'; document.querySelector('#indD2').value='2030-01-07';")
    pg.click("#indSubmit")
    msg = pg.inner_text("#indMsg")
    B.ok("Hors connexion" in msg or "Choisissez" in msg, "saisie bloquée hors connexion avec un message clair")
    # retour du réseau
    ctx.set_offline(False)
    pg.wait_for_function("document.querySelector('#offlineBanner').hidden === true", timeout=5000)
    B.ok(True, "bandeau masqué au retour du réseau")
    B.ok(not erreurs, "aucune erreur JavaScript" + (f" : {erreurs[:3]}" if erreurs else ""))
    b.close()
raise SystemExit(0 if B.fin() else 1)
