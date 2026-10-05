# -*- coding: utf-8 -*-
"""Construit le site puis lance tous les tests. Code de sortie 0 si tout est OK."""
import os
import subprocess
import sys

ICI = os.path.dirname(os.path.abspath(__file__))
RACINE = os.path.dirname(ICI)
etapes = [
    ("Construction", [sys.executable, os.path.join(RACINE, "outils", "construire.py")]),
    ("Démonstration", [sys.executable, os.path.join(ICI, "test_demo.py")]),
    ("Firebase simulé", [sys.executable, os.path.join(ICI, "test_firebase.py")]),
    ("Comptes", [sys.executable, os.path.join(ICI, "test_comptes.py")]),
    ("Hors connexion", [sys.executable, os.path.join(ICI, "test_hors_connexion.py")]),
    ("Hors ligne", [sys.executable, os.path.join(ICI, "test_hors_ligne.py")]),
    ("Télétravail et import", [sys.executable, os.path.join(ICI, "test_teletravail.py")]),
    ("Rappel écran d'accueil", [sys.executable, os.path.join(ICI, "test_installation.py")]),
    ("Notifications", [sys.executable, os.path.join(ICI, "test_notifications.py")]),
    ("Fiche médecin", [sys.executable, os.path.join(ICI, "test_medecins.py")]),
    ("Règles et postes", [sys.executable, os.path.join(ICI, "test_reglages.py")]),
    ("Cartes repliables", [sys.executable, os.path.join(ICI, "test_plis.py")]),
    ("Règles du service", [sys.executable, os.path.join(ICI, "test_regles_service.py")]),
    ("Import du planning fait à la main", [sys.executable, os.path.join(ICI, "test_import_manuel.py")]),
]
resultats = []
for nom, cmd in etapes:
    r = subprocess.run(cmd, cwd=ICI, stderr=subprocess.PIPE, text=True)
    if r.stderr:
        sys.stderr.write(r.stderr)
    resultats.append((nom, r.returncode == 0))
    if r.returncode and os.environ.get("GITHUB_ACTIONS"):
        derniere = [l for l in r.stderr.strip().splitlines() if l.strip()][-3:] if r.stderr else []
        print(f"::error::Échec de l'étape « {nom} » (code {r.returncode}) " + " | ".join(x.strip() for x in derniere)[:900])
    if nom == "Construction" and r.returncode:
        break
print("\n==================== BILAN ====================")
for nom, ok in resultats:
    print(f"  {'OK   ' if ok else 'ÉCHEC'}  {nom}")
sys.exit(0 if all(ok for _, ok in resultats) and len(resultats) == len(etapes) else 1)
