# CR3@TIX MOVIES — 1.3.0

Application web installable pour regarder des films et documentaires complets en français dans des lecteurs intégrés. Cette version reprend le projet 1.2 et fournit un catalogue initial de **1 117 fiches**, constitué le 9 septembre 2026. Les films restent hébergés par leurs éditeurs ; le ZIP contient l'application et les métadonnées, pas les fichiers vidéo.

## Démarrer

- **Pour un hébergement statique :** publier le contenu du dossier `dist/`. Il contient la version compilée prête à servir, avec son catalogue.
- **Pour tester sur ordinateur :** installer Node.js 24, ouvrir un terminal dans ce dossier, puis exécuter `npm ci` et `npm run dev`. Ouvrir l'adresse affichée.
- **Sans compilation :** la racine du projet peut aussi être ouverte dans l'aperçu HTTP d'un éditeur, ou servie par `python3 -m http.server 8080`. Ouvrir `http://localhost:8080/`. Le double-clic sur `index.html` en `file://` ne suffit pas : les modules et certains lecteurs exigent une origine HTTP(S).
- **Sur téléphone :** ouvrir l'URL HTTPS de l'application publiée, puis utiliser le bouton Installer ou « Ajouter à l'écran d'accueil » du navigateur. Ce projet est une application web, pas un APK.

La lecture vidéo demande Internet. Le mode hors connexion conserve l'interface, les fiches déjà chargées et les favoris ; il ne télécharge pas les films.

## Ce qui fonctionne

- Recherche par titre, éditeur, description et genre ; filtre français activé par défaut.
- Filtres par source, date de publication, genre et favoris. Les premières et programmes à venir restent disponibles dans l'interface pour compatibilité ; le catalogue actuel est constitué de vidéos disponibles à la demande.
- Affichage progressif par groupes de 48 fiches, adapté au téléphone.
- Lecteurs officiels YouTube, Dailymotion et ONF. Le moteur prend également en charge Internet Archive, Vimeo, MP4, WebM et HLS pour des sources renseignées et compatibles.
- Sélecteur de source pour les films possédant plusieurs lecteurs. Les erreurs vidéo natives, HLS et les erreurs YouTube reçues déclenchent un essai de la source suivante. Certains lecteurs tiers affichent leur erreur uniquement dans leur cadre : utiliser alors le sélecteur, si une autre source existe.
- Favoris locaux conservés même quand un catalogue ne répond pas ; sélection du dernier film ; plein écran ; crédits et lien volontaire vers la fiche d'origine.
- Catalogue réseau prioritaire pour éviter une ancienne version bloquée dans le cache PWA.

## Catalogues et conditions

| Source | Intégration dans cette livraison | Référence |
| --- | --- | --- |
| YouTube | 7 chaînes configurées ; 5 contribuent au catalogue livré. Vidéos intégrables de chaînes Boxoffice et imineo avec indication explicite de français. | [Lecteur officiel](https://developers.google.com/youtube/iframe_api_reference) |
| Dailymotion | Catalogue imineo, langue française déclarée, films et documentaires longs. | [Dailymotion développeurs](https://developers.dailymotion.com/) |
| ONF | Films et documentaires gratuits avec lecteur officiel et version française déclarée. Attribution et lien vers la fiche ONF sont affichés. | [Conditions ONF](https://aide.onf.ca/conditions/) |
| Internet Archive | Connecteur présent, aucun film importé par défaut. Les étiquettes de langue et de domaine public rencontrées ne suffisaient pas à valider les copies ; une liste manuelle est requise. | [Internet Archive](https://archive.org/details/feature_films) |
| Wikimedia Commons | Connecteur présent ; aucun fichier correspondant à tous les critères n'a été retenu dans la catégorie interrogée. | [Films en français](https://commons.wikimedia.org/wiki/Category:French-language_films) |

Les conditions ONF consultées autorisent l'incorporation personnelle et non commerciale avec un lien vers la page d'origine. Pour une exploitation commerciale de l'application, obtenir les autorisations adaptées des fournisseurs concernés. Les lecteurs tiers gardent leurs contrôles, restrictions et publicités. Aucune extraction de flux YouTube/Dailymotion, aucun contournement de paiement ni de restriction géographique n'est implémenté.

## Sélection des films

Au moins 40 minutes, au plus 6 heures ; bandes-annonces, extraits, compilations et épisodes identifiables dans le titre exclus. Français annoncé dans le titre, dans la langue déclarée de la vidéo ou dans les pistes audio ; un simple titre traduit ou des sous-titres français ne suffit pas pour YouTube. Si plusieurs pistes existent, choisir le français dans les paramètres du lecteur.

Ces contrôles portent sur les métadonnées publiées. Ils ne constituent pas un visionnage intégral de chaque vidéo : une indication de langue peut être erronée et les disponibilités, territoires et autorisations d'intégration peuvent changer. Le contrôle géographique utilise les indications du fournisseur ; le lecteur applique ensuite les règles au pays réel du spectateur.

Les fiches similaires sont regroupées de façon prudente selon titre, durée et année connue. Les sources et crédits des doublons sont conservés. Le nombre de vidéos retenues affiché par catalogue est calculé avant regroupement.

## Actualisation automatique

Le fichier `.github/workflows/pages.yml` contient une publication GitHub Pages après chaque modification de `main`, une exécution manuelle et une collecte programmée toutes les six heures. Dans les paramètres Pages du dépôt, choisir **GitHub Actions** comme source de déploiement. Le workflow fourni n'est actif qu'une fois le projet ajouté à un dépôt configuré pour Pages. Les exécutions programmées peuvent être décalées ou désactivées par l'hébergeur.

`npm run catalog:refresh` collecte les sources définies dans `config/sources.json`, réécrit `public/data/catalog.json` et `data/catalog.json`, puis conserve les métadonnées des éditions individuelles dans `data/source-catalog.json`. Le workflow réutilise ce dernier fichier via le cache GitHub Actions pour suivre les vidéos plus anciennes. Un échec temporaire conserve les fiches précédentes avec un indicateur de disponibilité à revérifier ; les indisponibilités explicites retirent les sources concernées. Le catalogue de secours inclus dans `seed-catalog.json` correspond à cette livraison.

Sans clé, YouTube exploite les métadonnées des pages publiques de chaînes et de leurs listes de mises en ligne, dans les limites exposées par ces pages. Une clé **YouTube Data API v3** dans le secret GitHub Actions `YOUTUBE_API_KEY` permet de parcourir davantage d'anciennes mises en ligne via l'API officielle. Par défaut, jusqu'à 20 pages de 50 entrées sont parcourues par chaîne. Ce plafond ne garantit pas une collecte exhaustive.

Ne jamais placer cette clé dans un fichier public ni utiliser le préfixe `VITE_`. Les autres sources ne demandent pas de clé. Les plafonds de collecte figurent dans `.env.example`. Les scripts ne chargent pas automatiquement ce fichier : fournir les variables dans l'environnement du terminal ou du workflow.

Le bouton **Actualiser** de l'application recharge le dernier catalogue publié. Il ne lance pas une collecte serveur depuis le navigateur. Publier seulement `dist/` sur un hébergeur statique n'active pas, à lui seul, la tâche de collecte.

Pour Internet Archive, compléter `archiveApprovedIdentifiers` uniquement après vérification de la copie française complète et des conditions applicables. Le connecteur exige en plus une collection configurée, une licence Public Domain/CC0 déclarée et une vidéo compatible. Une étiquette déposée par un internaute ne constitue pas à elle seule une autorisation de redistribution.

## Développement et validation

```bash
npm ci
npm run check
npm run dev
```

`npm run check` exécute les tests, la vérification TypeScript et la compilation Vite. Les tests couvrent les critères de français et de durée, les lecteurs intégrables, les restrictions publiées, la conservation des crédits, les doublons, le catalogue livré, les chemins PWA et l'absence de clé dans le frontend.

La version 1.3 utilise toujours le catalogue statique dans le navigateur. Les anciennes fonctions Netlify sont conservées pour compatibilité avec le projet précédent ; elles ne pilotent pas cette collecte française. Le dossier `vendor/` contient HLS.js et sa licence, également copiés dans `public/vendor/` pour la compilation. Aucun CDN JavaScript n'est nécessaire au lecteur HLS.
