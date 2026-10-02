# Reprendre ce planning pour un autre service

Ce dépôt est le planning d'un service de radiologie hospitalier sur trois sites. Il est public et ne contient aucune donnée réelle : un autre service peut en faire sa propre copie et l'adapter, gratuitement.

Ce fichier s'adresse à deux lecteurs :
- **le médecin qui veut le planning pour son service** (partie 1, sans aucune connaissance technique) ;
- **son assistant Claude** (partie 2, ce qu'il faut modifier et ce qu'il ne faut pas toucher).

---

## 1. Pour le médecin : faire sa copie en 10 minutes

1. **Créer un compte GitHub** (gratuit) sur github.com, de préférence avec une adresse dédiée au service plutôt que personnelle.
2. **Copier le dépôt** : ouvrez `https://github.com/new/import`.
   - « Your old repository's clone URL » : `https://github.com/Radiolibourne/planning`
   - Nom : `planning` · visibilité : **Public** · « Begin import ».
   - N'utilisez pas le bouton « Fork » : une copie importée est indépendante de l'original.
3. **Ouvrir Claude Code** (claude.ai/code), choisir ce nouveau dépôt, et coller le message ci-dessous en remplaçant ce qui est entre crochets.

```
Je suis [radiologue / spécialité] dans [hôpital], responsable du planning. Je ne suis pas développeur :
réponds en français simple et guide-moi pas à pas pour tout ce qui se fait dans GitHub ou Firebase.

Ce dépôt est une copie du planning d'un autre service. Lis d'abord ADAPTER.md (partie 2) puis CLAUDE.md,
et adapte-le à mon service :
- sites : [site principal], [autres sites]
- nombre de médecins : [N], vacations matin / après-midi du lundi au vendredi [ou autre]
- postes et spécialités : [ex. scanner, IRM, écho, mammo, interventionnel…]
- règles particulières : [télétravail, gardes, temps partiels, référents…]

Commence par retirer tout ce qui relie ce dépôt au service d'origine, puis aide-moi à mettre en place
mon propre Firebase en suivant le README.
```

4. Suivez ensuite les étapes que Claude vous donne (elles reprennent le README : GitHub Pages, Firebase, secrets). Comptez une heure en tout.

**À ne jamais faire** : déposer dans le dépôt le vrai classeur du service, des noms réels de médecins, le code d'équipe ou la clé Firebase. Le dépôt est public. Ces éléments vivent dans le site (Admin) et dans les secrets GitHub.

---

## 2. Pour Claude : adapter le dépôt à un nouveau service

Lire `CLAUDE.md` en entier : architecture, règles absolues (dépôt public, tests obligatoires, règles Firestore générées par `firestoreRules()`), commandes. Tout y reste valable. Ce qui suit liste uniquement ce qui est propre au service d'origine.

### À faire en premier : couper le lien avec le service d'origine
- `config/firebase.json` pointe vers le Firebase du service d'origine. **Le supprimer** dans le premier commit (le site repasse en mode démonstration), puis le remplacer par la configuration du nouveau projet Firebase quand elle existe.
- Ne rien reprendre des secrets : `CODE_EQUIPE`, `FIREBASE_CLE` et `ADMIN_UID` sont à créer dans le nouveau dépôt (README, étapes 3 et 4). Un import GitHub ne copie pas les secrets.
- Le site sera publié à `https://<compte>.github.io/planning/` : ajouter ce domaine dans Firebase → Authentication → Domaines autorisés.

### Textes à adapter
| Où | Quoi |
|---|---|
| `CLAUDE.md`, section « Pour qui, pour quoi » | Propriétaire, sites, taille de l'équipe. Remplacer par le nouveau service |
| `CLAUDE.md`, section « État et limites connues » | Décisions du service d'origine (voir ci-dessous) : à revoir avec le nouveau responsable |
| `README.md`, première ligne | Noms des sites |
| `src/app.html` (sous-titre du générateur hors ligne) | Noms des sites |
| `ADAPTER.md` | Peut être supprimé une fois l'adaptation faite |

### Ce qui est déjà générique (ne pas recoder)
- **Sites, postes, médecins, compétences, quotités, jours off, télétravail, fermetures, fériés** : tout vient du classeur de paramètres, modifiable dans le site (Admin → Médecins, Admin → Règles et postes). Le **site principal est le premier de l'onglet Sites**.
- Le classeur d'exemple (`exemple/parametres_exemple.xlsx`, médecins fictifs) sert de point de départ. Le vrai classeur se construit ensuite dans le site, jamais dans le dépôt.
- Couleurs : trois sites réels + télétravail (`--site0/1/2`, `--site-tt` dans `src/online.html`). Au-delà de trois sites, les sites secondaires alternent entre les deux mêmes couleurs (`siteClass`) : à étendre si besoin.

### Particularités du service d'origine à connaître
- Deux clés du classeur s'appellent « Déplacements hors Libourne : … » (`engine.js`, `online.html`, `outils/creer_parametres_exemple.py`, tests). Ce sont de simples libellés : la règle porte sur le site principal, quel qu'il soit. Pour les renommer, changer le libellé partout **et** garder l'ancien nom comme alias dans `readParams`, ou ne rien changer.
- Règle « scanner interventionnel » (référents, minimum hebdomadaire) : propre au service d'origine. Elle ne s'applique que s'il existe un poste de code `SCI` : sans ce poste, elle est sans effet.
- Choix du service d'origine, à reconfirmer avec le nouveau : pas d'échange de vacations entre médecins ; statistiques réservées aux administrateurs ; toute absence soumise à validation ; télétravail limité à un médecin par jour.

### Vérification
`python tests/lancer_tests.py` doit passer avant chaque envoi. Les tests n'utilisent que des médecins fictifs (DA, DB, IA…) et un Firebase simulé : ils fonctionnent sans le Firebase du nouveau service.
