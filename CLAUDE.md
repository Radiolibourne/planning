# CLAUDE.md — Planning du service de radiologie

## Pour qui, pour quoi
- Propriétaire : Ayoub, radiologue, administrateur du planning. **Ce n'est pas un développeur** : répondre en français, en langage simple, et expliquer ce qui change concrètement pour les médecins. Ne jamais lui demander d'écrire du code.
- Service de radiologie hospitalier sur 3 sites : **Libourne** (site principal), **Sainte-Foy-la-Grande**, **Blaye**. Une douzaine de médecins, vacations **matin / après-midi** du lundi au vendredi.
- Trois livrables, construits dans `dist/` :
  - `index.html` : site de l'équipe (Firebase), avec « Mon planning », planning général, absences et administration.
  - `demo.html` : même page en démonstration (données fictives, stockage local au navigateur).
  - `generateur-hors-ligne.html` : générateur autonome sans connexion (classeur → planning Excel + calendriers .ics).

## Règles absolues
1. **Dépôt public : aucune donnée réelle du service.** Jamais le vrai classeur de paramètres, jamais de vraies initiales ou de vrais noms, dans le code, les tests, les exemples ou les messages de commit. Données fictives seulement : DA, DB, IA, IB, SA, SB, SC, OA, OB, OC, SD.
2. **Le code d'équipe et les UID administrateurs ne vont jamais dans le dépôt.** Ils vivent uniquement dans les règles Firestore collées dans la console Firebase. `config/firebase.json` (clé API web, projectId…) est public par nature et peut être commité.
3. **Tous les tests doivent passer** (`python tests/lancer_tests.py`) avant de proposer une modification. Toute nouvelle règle ou fonction s'accompagne d'un test.
4. **Rester compatible avec les données déjà en ligne** : les plannings publiés (`planning/publie`) et les absences déjà saisies doivent rester lisibles après une mise à jour. Pour changer un format, ajouter des champs optionnels ; ne pas renommer ni supprimer.
5. **Toute modification des chemins ou champs Firestore** impose de mettre à jour `firestoreRules()` (`src/online_core.js`), et de dire clairement à Ayoub de republier les règles. La carte **Admin → « Règles de sécurité à jour »** du site les génère toute prêtes (avec son code d'équipe et son UID) : Firestore → Règles → coller → Publier. Console Firebase du projet : `radiolib-5f387`.
6. Interface en **français**, pensée d'abord pour l'**iPhone** (Safari). Pas de défilement horizontal de page.

## Commandes
```bash
pip install -r outils/requirements.txt && python -m playwright install chromium   # une fois
python outils/creer_parametres_exemple.py   # régénère exemple/parametres_exemple.xlsx (si sa structure change)
python outils/construire.py                 # construit dist/ (lit config/firebase.json s'il existe)
python tests/lancer_tests.py                # construit puis lance tous les tests (~1 min)
```
Si Chromium est déjà installé ailleurs, définir `CHROMIUM_PATH`. Les tests n'accèdent jamais au réseau : Firebase y est **simulé** (`tests/test_firebase.py`), avec une doublure des modules SDK et un faux serveur qui applique la logique des règles de sécurité.

## Publication
`.github/workflows/publication.yml` : à chaque push, tests ; sur `main`, si les tests passent, construction puis déploiement sur GitHub Pages (Settings → Pages → Source : GitHub Actions). Une copie de secours du workflow se trouve dans `outils/publication.yml` : si `.github/workflows/publication.yml` manque (dossier caché non envoyé depuis un Mac), la recopier à cet emplacement.

## Architecture (`src/`)
Toutes les pages sont des **fichiers HTML uniques**, sans dépendance externe, à l'exception du SDK Firebase 10.14.1 chargé depuis `www.gstatic.com`, et seulement en mode en ligne. `outils/construire.py` concatène les modules JS dans les modèles HTML (marqueurs `/*__LIBS__*/`, `/*__PARAMS__*/`). Le code JS ne doit jamais contenir la chaîne `</script`.

| Fichier | Rôle |
|---|---|
| `zip.js` | Lecture/écriture ZIP et lecture XLSX (sans bibliothèque) |
| `engine.js` | Lecture du classeur (`readParams`), modèle (`buildProblem`), **optimisation par recuit simulé** (`solve`), contrôles (`checks`), couverture |
| `export.js` | Écriture XLSX avec formules et mises en forme (`exportPlanning`), calendriers .ics (`buildIcs`), lecture d'un planning retouché |
| `online_core.js` | Format du planning publié, stockage Firebase / démonstration, règles Firestore, conflits absences ↔ planning |
| `online.html` | Interface du site (onglets Mon planning, Général, Absences, Admin, assistant de mise en ligne) |
| `app.html` | Interface du générateur hors ligne |

### Le moteur (`engine.js`)
- Variables : `a[médecin][créneau] = poste | -1`. Créneau = jour ouvré × {M, AM}.
- **Contraintes dures** (`hardOK` + filtrage des choix) :
  - compétence requise (onglet Médecins) ;
  - pas d'affectation si OFF, ABS ou INDISPO ;
  - un seul poste par demi-journée ;
  - un seul site par jour (paramètre) ;
  - maximum de jours hors site principal par semaine ;
  - scanner interventionnel : un référent au plus 1 vacation par semaine, 2 si l'autre référent est absent ;
  - affectations imposées fixées.
- **Objectif** (à minimiser, poids `W` en tête de fichier) :
  - couverture des postes pondérée par la priorité (`wPrio`), avec un niveau « jusqu'au minimum » et un niveau « au-delà » ;
  - bonus pour un poste « Préféré » ;
  - pénalités : scanner interventionnel sous le minimum hebdomadaire, référent sans sa vacation, médecin sans déplacement hors site principal dans la semaine, déplacements au-delà de la cible ;
  - équilibrage convexe par groupe de modalité, normalisé par la disponibilité.
- La classe `State` maintient l'objectif **de façon incrémentale**. Tout nouveau terme doit avoir sa fonction de coût, sa mise à jour dans `applyMove` et son initialisation dans `recompute`.
- **Ajouter une règle** :
  1. de préférence, la rendre paramétrable dans le classeur : colonne ou onglet lu dans `readParams`, ajouté aussi dans `outils/creer_parametres_exemple.py` ;
  2. dure → `hardOK` ; souple → terme de coût ;
  3. la vérifier dans `checks()`, qui produit les niveaux Erreur, Alerte ou Info affichés à l'administrateur et dans l'onglet Contrôles de l'Excel ;
  4. écrire un test.
  
  Un classeur ancien, sans la nouvelle colonne, doit continuer à fonctionner, avec une valeur par défaut.

### Classeur de paramètres (format lu par `readParams`)
Onglets :
- **Paramètres** : clé / valeur à partir de la ligne 5 ;
- **Sites** : horaires M / AM ;
- **Postes** : code, libellé, site, groupe, nombre souhaité et minimum, priorités, X par demi-journée « Lun M » … « Ven AM » ;
- **Médecins** : initiales, quotité, off semaine A / B, indisponibilités fixes « Jeu M », actif, puis une colonne par code poste (Oui / Préféré) ;
- **Absences** ;
- **Imposées** ;
- **Fériés**.

En-têtes en ligne 4, données à partir de la ligne 5. Semaines A / B : alternance calculée depuis le « Lundi de référence semaine A ».

### Données en ligne (Firestore, sous `espaces/{codeEquipe}/`)
- `config/parametres` : `{nom, majLe, par, xlsx (base64)}`. Écriture réservée à l'admin.
- `planning/publie` : planning publié (format décrit en tête de `online_core.js`). Écriture admin. Taille < 1 Mo, pas de tableaux imbriqués, pas de `undefined`.
- `indispos/{id}` : `{ini, d1, d2, periode, motif, creeLe}`. Création et suppression par l'équipe, champs validés par les règles, **uniquement sur une période ouverte** (voir ci-dessous) ; les administrateurs ne sont pas limités.
- `config/saisie` : `{clotures: [{du, au, limite, finMs}], majLe}`. Dates limites de dépôt définies par l'admin (5 au plus, `MAX_CLOTURES`). `finMs` = fin de la journée `limite`, heure de Paris (`parisEndOfDayMs`).

### Verrouillage de la saisie des absences
Une absence [d1, d2] est refusée aux médecins si `d1 <= planning publié.end`, ou si elle touche une période dont la date limite de dépôt est passée (`lockReason` dans `online_core.js`). Ce contrôle est fait **deux fois** : dans la page (message clair) et dans les règles Firestore (fonction `ouvert`), qui font foi. Toute évolution de cette logique doit modifier les deux, ainsi que la doublure de `tests/test_firebase.py` (fonction `ouvert`).
- Dates stockées en **numéro de jour** (jours depuis le 01/01/1970, UTC). Excel : numéro + 25569.

## État et limites connues
- Le moteur est heuristique (recuit simulé) : il se situe à environ 0,05 % de l'optimum exact sur octobre 2026 (données réelles, vérifié avec un solveur exact).
- Capacité insuffisante à ce jour. Avec les priorités actuelles, ferment d'abord l'échographie 2, puis l'IRM 2 (ostéo-articulaire), puis la mammographie de Blaye. C'est un choix du service, réglable via les priorités du classeur.
- Calendriers iPhone : import d'un fichier .ics (pas d'abonnement, le site est statique). Après une republication, chaque médecin réimporte son fichier.
- Code d'équipe = mot de passe partagé ; un médecin peut supprimer l'absence d'un collègue. Le reste (paramètres, publication) est réservé aux administrateurs authentifiés.
- Fonctions ajoutées depuis la première version : verrouillage des absences (période publiée + dates limites de dépôt), bouton « Télécharger en Excel » du planning publié dans l'onglet Général (tous les médecins).
- Pistes demandées ou envisagées : onglet « Quotas » générique (min / max par médecin, poste et période) ; échanges de vacations entre médecins.
