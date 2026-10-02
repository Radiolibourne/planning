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
]
resultats = []
for nom, cmd in etapes:
    r = subprocess.run(cmd, cwd=ICI)
    resultats.append((nom, r.returncode == 0))
    if nom == "Construction" and r.returncode:
        break
print("\n==================== BILAN ====================")
for nom, ok in resultats:
    print(f"  {'OK   ' if ok else 'ÉCHEC'}  {nom}")
sys.exit(0 if all(ok for _, ok in resultats) and len(resultats) == len(etapes) else 1)
