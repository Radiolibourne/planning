# -*- coding: utf-8 -*-
"""
Construit les pages du site dans dist/ à partir de src/.

  dist/index.html               le site de l'équipe (Firebase si config/firebase.json existe, sinon démonstration)
  dist/demo.html                démonstration (données fictives, rien n'est partagé)
  dist/generateur-hors-ligne.html  générateur autonome, sans connexion

Usage : python outils/construire.py
"""
import base64, hashlib, json, os, shutil, sys

RACINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(RACINE, "src")
DIST = os.path.join(RACINE, "dist")
EXEMPLE = os.path.join(RACINE, "exemple", "parametres_exemple.xlsx")
PWA = os.path.join(SRC, "pwa")
MANIFESTE = {
    "name": "Planning radiologie", "short_name": "Planning radio", "lang": "fr",
    "start_url": "./", "scope": "./", "display": "standalone",
    "background_color": "#f4f6f5", "theme_color": "#0e5a63",
    "icons": [
        {"src": "icone-192.png", "sizes": "192x192", "type": "image/png"},
        {"src": "icone-512.png", "sizes": "512x512", "type": "image/png"},
        {"src": "icone-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"},
    ],
}
CONFIG = os.path.join(RACINE, "config", "firebase.json")
CLES = ["apiKey", "authDomain", "projectId", "storageBucket", "messagingSenderId", "appId"]


def lire(nom):
    with open(os.path.join(SRC, nom), encoding="utf-8") as f:
        return f.read()


def bibliotheques(fichiers):
    code = "\n".join(lire(f) for f in fichiers)
    if "</script" in code.lower():
        sys.exit("Erreur : '</script' interdit dans le code JavaScript (casserait la page).")
    return code


def page_en_ligne(config, params_b64):
    tpl = lire("online.html")
    out = tpl.replace("/*__LIBS__*/", bibliotheques(["zip.js", "engine.js", "export.js", "online_core.js", "pdf.js", "rcp.js"]), 1)
    out = out.replace('"/*__PARAMS__*/"', json.dumps(params_b64), 1)
    if config:
        out = out.replace("window.FIREBASE_CONFIG = null;", "window.FIREBASE_CONFIG = " + json.dumps(config, ensure_ascii=False) + ";", 1)
    return out


def main():
    if not os.path.exists(EXEMPLE):
        sys.exit("Classeur d'exemple absent : lancez d'abord python outils/creer_parametres_exemple.py")
    with open(EXEMPLE, "rb") as f:
        params_b64 = base64.b64encode(f.read()).decode()
    config = None
    if os.path.exists(CONFIG):
        with open(CONFIG, encoding="utf-8") as f:
            config = json.load(f)
        manque = [k for k in ("apiKey", "projectId", "appId") if not config.get(k)]
        if manque:
            sys.exit(f"config/firebase.json incomplet : {', '.join(manque)} manquant(s).")
        config = {k: config[k] for k in CLES if config.get(k)}
        config.setdefault("authDomain", f"{config['projectId']}.firebaseapp.com")
    os.makedirs(DIST, exist_ok=True)
    pages = {
        # Site de l'équipe : aucune donnée embarquée quand Firebase est configuré.
        "index.html": page_en_ligne(config, "" if config else params_b64),
        "demo.html": page_en_ligne(None, params_b64),
        "generateur-hors-ligne.html": lire("app.html")
            .replace("/*__LIBS__*/", bibliotheques(["zip.js", "engine.js", "export.js"]), 1)
            .replace("/*__PARAMS__*/", params_b64, 1),
    }
    for nom, html in pages.items():
        if "/*__" in html:
            sys.exit(f"Erreur : marqueur non remplacé dans {nom}")
        with open(os.path.join(DIST, nom), "w", encoding="utf-8") as f:
            f.write(html)
        print(f"{nom:30s} {len(html.encode()) // 1024} Ko")
    # application installable et hors connexion
    for f in os.listdir(PWA):
        if f.endswith(".png"):
            shutil.copy(os.path.join(PWA, f), os.path.join(DIST, f))
    with open(os.path.join(DIST, "manifest.webmanifest"), "w", encoding="utf-8") as f:
        json.dump(MANIFESTE, f, ensure_ascii=False, indent=2)
    version = hashlib.sha256("".join(pages[k] for k in sorted(pages)).encode()).hexdigest()[:12]
    with open(os.path.join(PWA, "sw.js"), encoding="utf-8") as f:
        sw = f.read().replace("__VERSION__", version)
    with open(os.path.join(DIST, "sw.js"), "w", encoding="utf-8") as f:
        f.write(sw)
    print(f"{'sw.js + manifeste + icônes':30s} version {version}")
    print("Site :", "Firebase (" + config["projectId"] + ")" if config else "démonstration (config/firebase.json absent)")


if __name__ == "__main__":
    main()
