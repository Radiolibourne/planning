# Planning du service de radiologie

Outil de planning des vacations (matin / après-midi) pour les sites de Libourne, Sainte-Foy-la-Grande et Blaye.

- **Site de l'équipe** : chaque médecin consulte son planning, l'ajoute à son calendrier iPhone et déclare ses absences. L'administrateur génère, retouche et publie le planning.
- **Générateur hors ligne** : la même génération, dans un fichier qui fonctionne sans connexion, sans compte.
- **Règles du service** : dans un classeur Excel de paramètres (médecins, compétences, jours off, postes, priorités, absences).

Ce dépôt est **public**. Il ne contient que du code et des données d'exemple fictives (médecins DA, DB, IA…). Le vrai classeur du service ne doit **jamais** y être déposé : il reste sur votre ordinateur et dans la base Firebase.

---

## Mise en place (une seule fois)

### 1. Dépôt GitHub
1. Sur github.com, créez un dépôt **public** nommé `planning`, sans rien cocher.
2. Lien **uploading an existing file**. Faites glisser **tout le contenu** du dossier, sous-dossiers compris, puis **Commit changes**.
   - Sur Mac, le dossier `.github` est caché : dans le Finder, appuyez sur `Cmd + Maj + .` pour l'afficher avant de faire glisser.
   - S'il manque malgré tout après l'envoi, demandez à Claude Code : *« Mets en place la publication automatique décrite dans CLAUDE.md »*.
3. **Settings → Pages → Source : GitHub Actions**.
4. Onglet **Actions** : le premier passage (tests puis publication) prend environ 3 minutes. Le site apparaît à `https://votre-compte.github.io/planning/`.

Tant que Firebase n'est pas configuré, le site s'ouvre en **mode démonstration**, où rien n'est partagé.

### 2. Base de données Firebase (gratuite, formule Spark)
1. Ouvrez `https://votre-compte.github.io/planning/demo.html` → **Admin** (n'importe quel e-mail et mot de passe) → **Mettre en ligne pour l'équipe**.
2. Suivez les étapes **1 à 6** de ce guide : projet, base à Paris, compte administrateur, règles de sécurité. Les étapes 7 à 11 (téléchargement d'`index.html`) ne servent pas avec ce dépôt.
3. Dans GitHub, **Add file → Create new file**, nommez-le `config/firebase.json`, et collez-y la configuration Firebase au format de `config/firebase.exemple.json`. Puis **Commit changes**. Ou demandez-le à Claude Code en lui donnant le bloc `firebaseConfig`.
4. Firebase : **Authentication → Paramètres → Domaines autorisés** → ajoutez `votre-compte.github.io`.

La configuration Firebase est publique par nature. En revanche, le **code d'équipe** et les **UID administrateurs** ne vont que dans les règles de sécurité de la console Firebase, jamais dans le dépôt.

### 3. Calendriers d'abonnement (mise à jour automatique sur les téléphones)
1. Dans GitHub : **Settings → Secrets and variables → Actions → New repository secret**.
2. Name : `CODE_EQUIPE` ; Secret : votre code d'équipe (celui des règles de sécurité, `RADIO-…`) → **Add secret**.
3. Après la prochaine publication (au plus une heure), chaque médecin voit dans « Mon planning » un bouton **S'abonner (mise à jour automatique)**.

### 4. Publication automatique des règles de sécurité (une seule fois)
1. Firebase → **Paramètres du projet → Comptes de service → Générer une nouvelle clé privée** : un fichier `.json` se télécharge.
2. GitHub → **Settings → Secrets and variables → Actions → New repository secret** :
   - `FIREBASE_CLE` : tout le contenu du fichier `.json` (ouvrez-le avec le Bloc-notes, copiez tout) ;
   - `ADMIN_UID` : votre UID administrateur (Firebase → Authentication → Utilisateurs).
3. Supprimez ensuite le fichier `.json` de votre ordinateur : il donne un accès complet au projet Firebase.
4. Onglet **Actions → Tests et publication → Run workflow** : l'étape « regles » publie les règles. Elles seront ensuite republiées automatiquement à chaque mise à jour du site.

### 5. Comptes individuels
1. Demandez aux médecins d'ouvrir le site et de cliquer **Créer un compte** (e-mail, mot de passe de leur choix, initiales, nom).
2. **Admin → Comptes** : validez chaque demande (vérifiez les initiales).
3. Quand tout le monde a un compte : décochez **Accès provisoire par code d'équipe** (même carte). Effet immédiat : le code seul ne donne plus accès (il reste nécessaire au secret GitHub `CODE_EQUIPE`).

### 6. Démarrage
1. Ouvrez le site, saisissez le code d'équipe, puis **Admin** → connectez-vous → **Remplacer par un classeur mis à jour** : déposez votre vrai classeur de paramètres.
2. Générez et publiez un planning d'essai. Vérifiez sur votre iPhone et depuis un poste de l'hôpital.
3. Envoyez l'adresse du site et le code d'équipe aux médecins. Pour installer l'application « Planning radio » :
   - **iPhone** : ouvrir le lien dans **Safari** → bouton Partager → **Sur l'écran d'accueil** ;
   - **Android** : ouvrir le lien dans **Chrome** → menu ⋮ → **Ajouter à l'écran d'accueil** (ou **Installer l'application**).
   Une fois ouvert au moins une fois avec le réseau, le dernier planning consulté reste lisible **hors connexion**.

---

## Chaque mois

1. Les médecins déclarent leurs absences sur le site.
2. **Admin** → période → **Générer** → vérifiez « Contrôle des règles » et « Couverture » → retouchez si besoin → **Publier**.
3. Si les règles ou l'équipe changent : **Télécharger le classeur**, modifiez-le dans Excel, puis **Remplacer par un classeur mis à jour**.

## Faire évoluer l'outil avec Claude Code

1. Ouvrez **claude.ai/code** et choisissez le dépôt `planning`.
2. Décrivez la demande en français, avec les détails du service. Par exemple :
   - *« Ajoute une règle : DA pas plus de 3 vacations de scanner par semaine. »*
   - *« Ajoute un poste Scanner 2 à Libourne, ouvert le mardi et le jeudi. »*
   - *« Sur la page Mon planning, affiche aussi les collègues du même poste. »*
3. Claude Code modifie le code, lance les tests et propose une **pull request**. Relisez le résumé, puis **Merge**. Les tests repassent sur GitHub, et le site est mis à jour en 2 à 3 minutes seulement s'ils réussissent.
4. En cas de problème, chaque version précédente reste récupérable : demandez à Claude Code d'annuler la dernière modification.

Si une modification ajoute une colonne ou un onglet au classeur de paramètres, Claude Code l'indique dans la pull request. Il faudra alors compléter votre vrai classeur, puis le redéposer sur le site.

Le code vous appartient. Il est lisible et documenté (`CLAUDE.md`), et n'importe quel développeur peut le reprendre.

## Contenu du dépôt

| Dossier | Contenu |
|---|---|
| `src/` | Code de l'application : moteur de planning, export Excel et calendriers, pages |
| `outils/` | Construction du site (`construire.py`), classeur d'exemple, icônes |
| `exemple/` | Classeur de paramètres fictif (démonstration et tests) |
| `tests/` | Tests automatiques (navigateur simulé) |
| `config/` | Configuration Firebase du site |
| `.github/workflows/` | Tests et publication automatiques |
