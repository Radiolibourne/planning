# -*- coding: utf-8 -*-
"""
Publie les règles de sécurité Firestore (générées par outils/regles_firestore.js) avec l'API Firebase Rules.

Secrets GitHub nécessaires :
  FIREBASE_CLE  contenu du fichier JSON de clé de compte de service (Firebase → Paramètres du projet → Comptes de service)
  CODE_EQUIPE   code d'équipe (déjà utilisé pour les calendriers)
  ADMIN_UID     UID du (des) compte(s) administrateur(s), séparés par des virgules

Sans FIREBASE_CLE : rien n'est fait (message). Options : --essai (affiche les règles sans publier).
"""
import json
import os
import subprocess
import sys

RACINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
API = "https://firebaserules.googleapis.com/v1"


def regles():
    r = subprocess.run(["node", os.path.join(RACINE, "outils", "regles_firestore.js")], capture_output=True, text=True, env=os.environ)
    if r.returncode != 0:
        sys.exit(f"Génération des règles impossible : {r.stderr.strip()}")
    return r.stdout


def main():
    essai = "--essai" in sys.argv
    if not essai and not os.environ.get("FIREBASE_CLE", "").strip():
        print("::notice::Secret FIREBASE_CLE absent : règles non publiées automatiquement (copier-coller manuel toujours possible).")
        return
    texte = regles()
    if essai:
        sys.stdout.write(texte)
        return
    with open(os.path.join(RACINE, "config", "firebase.json"), encoding="utf-8") as f:
        projet = json.load(f)["projectId"]
    cle = json.loads(os.environ["FIREBASE_CLE"])
    if cle.get("project_id") != projet:
        sys.exit(f"La clé FIREBASE_CLE appartient au projet « {cle.get('project_id')} », pas à « {projet} ».")

    from google.oauth2 import service_account
    from google.auth.transport.requests import AuthorizedSession
    cred = service_account.Credentials.from_service_account_info(
        cle, scopes=["https://www.googleapis.com/auth/firebase", "https://www.googleapis.com/auth/cloud-platform"])
    s = AuthorizedSession(cred)

    # 1. Création du jeu de règles (Firebase vérifie la syntaxe ici)
    r = s.post(f"{API}/projects/{projet}/rulesets", json={"source": {"files": [{"name": "firestore.rules", "content": texte}]}})
    if r.status_code != 200:
        sys.exit(f"Règles refusées par Firebase ({r.status_code}) : {r.text[:1500]}")
    nom = r.json()["name"]
    # 2. Mise en service pour Firestore
    release = f"projects/{projet}/releases/cloud.firestore"
    r = s.patch(f"{API}/{release}", json={"release": {"name": release, "rulesetName": nom}})
    if r.status_code == 404:
        r = s.post(f"{API}/projects/{projet}/releases", json={"name": release, "rulesetName": nom})
    if r.status_code != 200:
        sys.exit(f"Mise en service des règles impossible ({r.status_code}) : {r.text[:1500]}")
    print(f"::notice::Règles de sécurité publiées ({nom.split('/')[-1]}).")


if __name__ == "__main__":
    main()
