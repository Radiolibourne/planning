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
5. **Toute modification des chemins ou champs Firestore** impose de mettre à jour `firestoreRules()` (`src/online_core.js`, source unique). Les règles sont **publiées automatiquement** par le job `regles` du workflow (`outils/publier_regles.py` → `outils/regles_firestore.js`, API Firebase Rules, secrets `FIREBASE_CLE`, `CODE_EQUIPE`, `ADMIN_UID`) à chaque push sur `main`. Si ces secrets manquent, repli manuel : carte **Admin → « Règles de sécurité à jour »** → Firestore → Règles → coller → Publier. Projet Firebase : `radiolib-5f387`. Une erreur de syntaxe dans les règles fait échouer le job `regles` (Firebase les refuse) : la vérifier dans l'onglet Actions.
6. Interface en **français**, pensée d'abord pour l'**iPhone** (Safari). Pas de défilement horizontal de page.

## Commandes
```bash
pip install -r outils/requirements.txt && python -m playwright install chromium   # une fois
python outils/creer_parametres_exemple.py   # régénère exemple/parametres_exemple.xlsx (si sa structure change)
python outils/construire.py                 # construit dist/ (lit config/firebase.json s'il existe)
python tests/lancer_tests.py                # construit puis lance tous les tests (~1 min)
```
Si Chromium est déjà installé ailleurs, définir `CHROMIUM_PATH`. Les tests n'accèdent jamais au réseau : Firebase y est **simulé** (`tests/test_firebase.py` en mode code d'équipe, `tests/test_comptes.py` en mode comptes avec accès par code désactivé), avec une doublure des modules SDK et un faux serveur qui applique la logique des règles de sécurité. **Toute modification de `firestoreRules()` doit être reportée dans ces faux serveurs.**

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
| `online.html` | Interface du site (connexion/inscription, onglets Mon planning, Général, Qui est posté, Absences, Admin, assistant de mise en ligne) |
| `pdf.js` | Écriture PDF sans dépendance (Helvetica, accents WinAnsi) et `weekPdf` : PDF de la semaine (page par poste, page par médecin) |
| `app.html` | Interface du générateur hors ligne |
| `pwa/` | Application installable : `sw.js` (service worker), icônes PNG (dessinées par `outils/creer_icones.py`, commitées). Le manifeste est écrit par `construire.py` |

### Comptes individuels (mode en ligne)
Administrateurs : principaux = UID du secret `ADMIN_UID` (inscrits dans les règles, impossibles à retirer depuis le site) ; ajoutés = documents `admins/{uid}` créés par un administrateur depuis Admin → Comptes (« Rendre administrateur » / « Retirer admin »). Un administrateur ne peut pas modifier ses propres droits. « Retirer l'accès » supprime aussi le document `admins/{uid}`.
- Chaque médecin crée son compte (e-mail + mot de passe, Firebase Authentication) → document `demandes/{uid}` `{email, ini, nom, creeLe}`. Aucun e-mail n'est envoyé (sauf « Mot de passe oublié ? », géré par Firebase).
- L'admin valide dans Admin → Comptes : `membres/{uid}` `{email, ini, nom, espace (code d'équipe), role, valideLe, validePar}`. Retirer l'accès = supprimer ce document (effet immédiat).
- À la connexion (`resolveAccount`) : fiche `membres` → espace + initiales fixées ; administrateur détecté par une lecture-sonde `membres/_sonde_admin` (autorisée aux seuls admins) ; sinon écran « demande en attente » (la page s'ouvre seule à la validation).
- L'admin saisit le code d'équipe une fois ; sa propre fiche `membres` (role admin) est alors créée.
- **Règles d'avant les comptes** (lecture de sa propre fiche refusée) : `S.legacy` → ancien fonctionnement (connexion = admin), inscriptions bloquées avec un message.
- **Transition** : `codeSeul(code)` dans les règles lit `espaces/{code}/config/acces` (`{codeSeul: bool}`) ; absent = autorisé. L'admin coche/décoche « Accès provisoire par code d'équipe » dans Admin → Comptes (effet immédiat, sans republier les règles). Autorisé : accès sans compte (code d'équipe + « Qui êtes-vous ? »).
- `planning/publie` n'est plus lisible avec le seul code (depuis octobre 2026) : comptes validés (ou accès provisoire) uniquement. GitHub le lit avec la clé de service (`FIREBASE_CLE`) pour les calendriers d'abonnement.

### Sécurité des postes partagés
- Case « Ordinateur partagé (poste de l'hôpital) » à la connexion (`aPartage`, `loginPartage`) : clé locale `planning-radio-partage`. Alors : connexion Firebase en `browserSessionPersistence` (oubliée à la fermeture du navigateur), cache Firestore en mémoire + `clearIndexedDbPersistence`, toutes les autres clés `planning-radio-*` en `sessionStorage` (`ls`, `setPartage`), déconnexion après 30 min sans activité (`verifInactivite`). Passage en mode partagé : rechargement après connexion.
- Liste « Absences de l'équipe » : motif des collègues masqué (« absent ») pour les non-administrateurs ; champ Précision : pas de motif médical (placeholder). Les règles laissent les membres lire les absences (motif compris) : ne pas y mettre de données de santé.
- Mot de passe : 10 caractères minimum à la création d'un compte (Firebase en exige 6).
- `declarations/{uid}` `{ini, aucune: {"<du>_<au>": true}, majLe}` : « Je n'ai aucune absence sur cette période » (relance).
- Démo : pas de comptes (fonctionnement par « Qui êtes-vous ? »).

### Relance des dates limites
Onglet Absences : liste des périodes ouvertes avec l'état de ma déclaration (`periodesADeclarer`) ; « Je n'ai aucune absence » est annulable (`annulerAucune`).
`relanceInfo(c)` : médecins sans absence ni déclaration « aucune absence » sur la période. Admin : liste + lien `mailto:` (destinataires en copie cachée, adresses des comptes validés). Médecin : bandeau dans Mon planning et Absences tant que la date limite est ouverte.

### Excel des médecins / statistiques
L'Excel téléchargé par les médecins (onglet Général) ne contient que le planning (`exportPlanning(..., {equipe: true})` : Planning par poste, Planning par médecin, Statuts masqué). Synthèse, contrôles des règles et couverture : réservés aux administrateurs (Admin → Statistiques, `renderStats`, bouton « Excel complet »). Choix du service : ne pas exposer les statistiques à l'équipe.

### Qui est posté ? / PDF de la semaine
Onglet « Qui est posté » : un jour, par poste (groupé par site) ou par personne, filtre texte. Onglet Général → « PDF de la semaine » (semaine choisie, ou semaine en cours) : 2 pages A4 paysage.

### Abonnement calendrier (webcal)
Abonnement et import ponctuel se trouvent dans l'onglet **Calendrier** (`renderCal`), pas sur Mon planning.
- `outils/calendriers_abonnement.py`, lancé par le workflow **à chaque publication et toutes les heures** (cron `17 * * * *`) : lit `planning/publie` par l'API REST Firestore avec la clé de service (`FIREBASE_CLE` ; repli : clé API web, si les règles l'autorisent) et écrit `dist/cal/<jeton>.ics` par médecin.
- `jeton = HMAC-SHA256(code d'équipe, "cal:" + initiales)[:24]` ; la page calcule le même (`calToken`) pour afficher le bouton « S'abonner » (lien `webcal://…`), seulement si le fichier existe déjà.
- Le code d'équipe vient du **secret GitHub `CODE_EQUIPE`** (Settings → Secrets and variables → Actions). Sans secret, rien n'est produit ; aucune erreur de ce script ne bloque la publication du site (avertissement seulement).
- Mêmes UID d'événements que l'import ponctuel (`buildIcs`) : les deux doivent rester alignés (test `test_firebase.py`).
- GitHub désactive les tâches planifiées d'un dépôt public après 60 jours sans activité : dans ce cas, réactiver le workflow dans l'onglet Actions (bouton « Enable workflow »).
- Si le code d'équipe change, les adresses changent : chaque médecin doit se réabonner.

### Notifications (Web Push)
- Le téléphone s'abonne depuis l'onglet Calendrier (comptes uniquement ; iPhone : depuis l'icône de l'écran d'accueil, iOS 16.4+). Abonnement stocké dans `abonnements/{uid}_{n}` (règles : chacun les siens).
- Envoi par GitHub toutes les heures (`outils/notifications.py`, job `notifications`) : publication d'un planning ; rappels 3 jours avant et la veille d'une date limite, aux seuls médecins sans déclaration. Rien entre 20 h et 8 h (envoi le matin). État dans `espaces/{code}/config/notifications`.
- Clés VAPID dérivées de `FIREBASE_CLE` (aucun secret en plus) ; clé publique écrite dans `dist/notifications.json` à la publication. Chiffrement RFC 8291 / VAPID RFC 8292 codés avec `cryptography` seulement (pywebpush indisponible), vérifiés par `tests/test_notifications.py`.

### Application installable et hors connexion
Rappel « écran d'accueil » (`installOverlay`, `maybeInstallPrompt`) : sur iPhone / Android seulement, jamais si le site est ouvert depuis l'icône (`display-mode: standalone`). « C'est fait » le masque définitivement sur ce navigateur ; « Plus tard » pendant 3 jours (clé locale `planning-radio-installation`). Marche à suivre accessible aussi depuis l'onglet Calendrier.
- Nom sur l'écran d'accueil : « Planning radio ». Icône : calendrier blanc sur fond bleu #1f3864.
- `sw.js` : page et icônes en « réseau d'abord, copie locale sinon » ; bibliothèque Firebase (URL versionnée) en « copie locale d'abord ». Version du cache = empreinte des pages construites (chaque déploiement invalide l'ancien cache). Activé sur https et localhost uniquement.
- Données : cache local Firestore (`persistentLocalCache`, multi-onglets) → le dernier planning consulté reste lisible sans réseau.
- Au démarrage, un code d'équipe déjà mémorisé n'est pas revérifié (ouverture hors connexion) ; un refus d'accès ultérieur l'efface (`forgetCode`).
- Hors connexion, toutes les écritures sont bloquées avec un message (`needOnline`) ; bandeau « Hors connexion ».

### Le moteur (`engine.js`)
- Variables : `a[médecin][créneau] = poste | -1`. Créneau = jour ouvré × {M, AM}.
- **Contraintes dures** (`hardOK` + filtrage des choix) :
  - compétence requise (onglet Médecins) ;
  - pas d'affectation si OFF, ABS ou INDISPO ;
  - un seul poste par demi-journée ;
  - un seul site par jour (paramètre) ;
  - maximum de jours hors site principal par semaine ;
  - scanner interventionnel : un référent au plus 1 vacation par semaine, 2 si l'autre référent est absent ;
  - affectations imposées fixées ;
  - postes fermés sur une période (onglet Fermetures) ;
  - télétravail : un jour de télétravail ne se mélange pas avec une présence sur site, maximum de jours par semaine et de médecins par jour (paramètres, `ttDayN`). Le coût `ttShort` porte sur toute la période et croît avec le nombre de semaines sans télétravail, pour répartir équitablement.
- **Télétravail** : chaque poste « Télétravail possible » a un jumeau `<CODE>-TT` (site virtuel `TT_SITE` = « Télétravail »), créé par `readParams`. Le jumeau partage les compteurs et la couverture du poste d'origine (`pBase`, `cnt`/`occ` rangés sous l'origine) ; il ne compte pas comme déplacement (`pRemote`). Médecin : colonne Télétravail = Oui (n'importe quel jour), Non / vide (jamais) ou « Jeu AM » (seulement ces demi-journées). Sans colonne Télétravail : aucun jumeau, fonctionnement inchangé. Côté site, le jumeau est un poste ordinaire du planning publié (site « Télétravail », pastille bleue).
- **Objectif** (à minimiser, poids `W` en tête de fichier) :
  - couverture des postes pondérée par la priorité (`wPrio`), avec un niveau « jusqu'au minimum » et un niveau « au-delà » ;
  - bonus pour un poste « Préféré » ;
  - pénalités : scanner interventionnel sous le minimum hebdomadaire, référent sans sa vacation, médecin sans déplacement hors site principal dans la semaine, déplacements au-delà de la cible, médecin autorisé sans son jour de télétravail (`ttShort`), jour de télétravail à moitié vide (`ttHalf`) ;
  - équilibrage convexe par groupe de modalité, normalisé par la disponibilité.
- La classe `State` maintient l'objectif **de façon incrémentale**. Tout nouveau terme doit avoir sa fonction de coût, sa mise à jour dans `applyMove` et son initialisation dans `recompute`.
- **Ajouter une règle** :
  1. de préférence, la rendre paramétrable dans le classeur : colonne ou onglet lu dans `readParams`, ajouté aussi dans `outils/creer_parametres_exemple.py` ;
  2. dure → `hardOK` ; souple → terme de coût ;
  3. la vérifier dans `checks()`, qui produit les niveaux Erreur, Alerte ou Info affichés à l'administrateur et dans l'onglet Contrôles de l'Excel ;
  4. écrire un test.
  
  Un classeur ancien, sans la nouvelle colonne, doit continuer à fonctionner, avec une valeur par défaut.

### Règles du service (octobre 2026) — onglets et colonnes facultatifs
- **Postes, ouverture** : `X` = chaque semaine, `A` / `B` = semaines A ou B seulement (`opensWeek`, appliqué dans `buildProblem` via `weekType`). Éditeur : sélecteur « chaque semaine / semaine A / semaine B » au-dessus des puces (`chips cycle`, `data-mode-for`).
- **Postes, « Télétravail possible » = Toujours** : poste lu à distance uniquement (`remoteOnly` → `ttOnly` : seul le jumeau `-TT` est proposé, la couverture reste comptée sur le poste).
- **Postes, colonne « Matin + après-midi »** : `Interdit` (contrainte dure dans `hardOK`, même poste d'origine), `Éviter` (`W.eviter`), `Journée entière` (`W.journee`, coût `splitCost` par médecin et par jour).
- **Onglet « Vacations spécialisées »** : Nom | Postes | Créneaux | Médecins habilités | Minimum par semaine (vide = obligatoire à chaque créneau, 0 = souhaitée) | Si présents. Une instance par semaine (`pr.vacs`, `slotVac`) ; coût `vacCost` = `W.vacMiss` × manque − `W.vacBonus` × couvertes. Seuls les postes listés comptent (pas leur jumeau télétravail).
- **Onglet « Préférences »** : Médecin | Type (Poste / Libre) | Poste ou site | Jours. Poste : au moins un des créneaux sur ce poste/site dans la semaine (`W.habit`) ; Libre : au moins une des demi-journées libre (`W.libre`, assez fort pour fermer un poste de priorité ≥ 5).
- **Onglet « Astreintes »** (Date | Médecin, recopié de l'outil d'astreinte) : note « Astreinte : XX » + préférence IRM 1 l'après-midi (`W.astreinte`) ; pour les référents du scanner interventionnel, un poste du groupe Interventionnel convient aussi.
- **Onglet « Notes »** (Texte | Quand | Demi-journée) : « 1er mardi », « 3e jeudi », « dernier vendredi », « chaque lundi » ou une date → `pr.notes` → champ facultatif `notes` du planning publié, affiché dans Général, Mon planning et l'Excel (colonne Jour de la ligne après-midi).
- **Paramètres « Binôme : jamais absents le même jour »** (2 initiales) et **« Binôme : jour de repos de repli »** : dans `buildProblem`, si l'un est absent le jour de repos de l'autre, ce repos passe au jour de repli de la semaine (`pr.infos`) ; alerte si les deux sont absents un autre jour ; demande d'absence chevauchant celle de l'autre refusée côté page aux non-administrateurs.

### Classeur de paramètres (format lu par `readParams`)
Admin → Règles et postes : onglets Paramètres, Postes, Sites, Fermetures, Imposées, Fériés modifiables dans le site (`REGLES`, `ONGLETS`, `regRegles`, `regListe`, `regFiche`). Dates et heures écrites en texte « JJ/MM/AAAA » / « HH:MM » (lues par `asDay` / `asMinutes`). Onglet absent (ex. Fermetures) : créé par `addSheet` (`zip.js`).
Admin → Médecins : la fiche de chaque médecin se modifie dans le site (`renderMedecins`, `medOuvrir`, `medEcrire`). L'onglet Médecins du classeur est réécrit avec `rewriteSheet` (`zip.js`), qui conserve le reste du classeur (styles, listes déroulantes, autres onglets) ; colonnes manquantes (nouveaux postes, Télétravail) ajoutées à la fin.
Onglets :
- **Paramètres** : clé / valeur à partir de la ligne 5 ;
- **Sites** : horaires M / AM ;
- **Postes** : code, libellé, site, groupe, nombre souhaité et minimum, priorités, X par demi-journée « Lun M » … « Ven AM », puis (facultatif) « Télétravail possible » (Oui) ;
- **Médecins** : initiales, quotité, off semaine A / B, indisponibilités fixes « Jeu M », actif, puis une colonne par code poste (Oui / Préféré), puis (facultatif) « Télétravail » ;
- **Absences** ;
- **Imposées** ;
- **Fermetures** (facultatif) : code poste, du, au, période, motif ;
- **Fériés**.

Les colonnes sont repérées par leur en-tête (sauf les 9 premières des onglets Postes et Médecins, à position fixe).

En-têtes en ligne 4, données à partir de la ligne 5. Semaines A / B : alternance calculée depuis le « Lundi de référence semaine A ».

### Données en ligne (Firestore, sous `espaces/{codeEquipe}/`)
- `config/parametres` : `{nom, majLe, par, xlsx (base64)}`. Écriture réservée à l'admin.
- `planning/publie` : planning publié (format décrit en tête de `online_core.js`). Écriture admin. Taille < 1 Mo, pas de tableaux imbriqués, pas de `undefined`.
- `indispos/{id}` : `{ini, d1, d2, periode, motif, creeLe, statut?, decidePar?, decideLe?, refus?}`. **Demande à valider** : un médecin crée avec `statut: "attente"` ; seul un administrateur passe à `acceptee` / `refusee` (règle `update`). Sans statut (anciennes) = acceptée (`statutInd`). Seules les acceptées entrent dans la génération (`onlineAbs`) ; notifications : décision → médecin, nouvelle demande → administrateurs. Création et suppression par l'équipe, champs validés par les règles, **uniquement sur une période ouverte** (voir ci-dessous) ; les administrateurs ne sont pas limités.
- `config/saisie` : `{clotures: [{du, au, limite, finMs}], majLe}`. Dates limites de dépôt définies par l'admin (5 au plus, `MAX_CLOTURES`). `finMs` = fin de la journée `limite`, heure de Paris (`parisEndOfDayMs`).

### Verrouillage de la saisie des absences
Une absence [d1, d2] est refusée aux médecins si `d1 <= planning publié.end`, ou si elle touche une période dont la date limite de dépôt est passée (`lockReason` dans `online_core.js`). Ce contrôle est fait **deux fois** : dans la page (message clair) et dans les règles Firestore (fonction `ouvert`), qui font foi. Toute évolution de cette logique doit modifier les deux, ainsi que la doublure de `tests/test_firebase.py` (fonction `ouvert`).
- Dates stockées en **numéro de jour** (jours depuis le 01/01/1970, UTC). Excel : numéro + 25569.

## État et limites connues
- Le moteur est heuristique (recuit simulé) : il se situe à environ 0,05 % de l'optimum exact sur octobre 2026 (données réelles, vérifié avec un solveur exact).
- Capacité insuffisante à ce jour. Avec les priorités actuelles, ferment d'abord l'échographie 2, puis l'IRM 2 (ostéo-articulaire), puis la mammographie de Blaye. C'est un choix du service, réglable via les priorités du classeur.
- Calendriers iPhone : abonnement (mise à jour automatique, délai = passage horaire de GitHub + fréquence de rafraîchissement du téléphone) ou import ponctuel d'un .ics.
- Avec les comptes (transition désactivée), chacun ne peut créer ou supprimer que ses propres absences. En transition, l'accès par code d'équipe garde l'ancien fonctionnement (code partagé).
- Fonctions ajoutées depuis la première version : comptes individuels validés par l'admin, « Qui est posté ? », PDF de la semaine, relance des dates limites ; abonnement calendrier mis à jour automatiquement ; application installable « Planning radio » avec ouverture hors connexion ; verrouillage des absences (période publiée + dates limites de dépôt), bouton « Télécharger en Excel » du planning publié dans l'onglet Général (tous les médecins).
- Import d'un planning Excel (Admin → « Importer un planning Excel ») : fichier produit par le bouton Excel du site, éventuellement retouché (`draftFromPlanningXlsx` dans `export.js`). Les postes et horaires viennent de l'onglet Config du fichier : un planning peut contenir des postes absents des paramètres actuels.
- Internes : pas encore gérés (le service les ajoutera peut-être). Les départs et arrivées de médecins se font dans le classeur (onglet Médecins).
- Pistes envisagées : onglet « Quotas » générique (min / max par médecin, poste et période). **Échanges de vacations : refusés par le service, ne pas les ajouter.**
