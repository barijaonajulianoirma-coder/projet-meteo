# Guide complet — Météo Analyse dans Antigravity

# Kit Antigravity — Météo Analyse

Ce kit rassemble les étapes de la réponse précédente sous forme de prompts prêts à copier. Il contient des consignes de développement, pas une application déjà construite.

## Utilisation
1. Ouvrir un dossier de projet dans Antigravity.
2. Envoyer le prompt 01, puis examiner et valider le plan.
3. Envoyer les prompts 02 à 10 dans l'ordre, un à la fois.
4. Après chaque étape, vérifier les fichiers, les résultats et les tests avant de continuer.
5. Le prompt 11 est optionnel : collecte permanente et base de données.

Ne pas demander de tout exécuter sans contrôle. Aucun compte, paiement, déploiement ou changement externe ne doit être lancé sans accord.

## Contenu
- prompts/ : un fichier texte par étape.
- GUIDE_COMPLET.md : tous les prompts dans un document unique.
- LIENS_API.txt : URLs de données et documentation.
- CHECKLIST.md : critères de validation.

## Périmètre
Coordonnées initiales : -18.8792, 47.5079. Interface française. La V1 consulte les données à la demande ; elle ne constitue pas une collecte permanente. Les conditions de service et champs API doivent être vérifiés au moment de l'implémentation. Les recommandations et liens viennent de l'échange précédent ; ce kit ne constitue pas une nouvelle vérification en direct des services.


## 01 — Cadrage et architecture

```text
Tu es un développeur full-stack. Construis une application « Météo Analyse » en français, pour latitude -18.8792 et longitude 47.5079.
Stack proposée : React, TypeScript, Vite, Recharts ; backend Node.js, Express, TypeScript ; validation Zod ; tests Vitest et Playwright.
Pages : tableau de bord, prévisions, analyse historique, méthodologie et sources.
Inspecte le dossier avant toute modification. Présente architecture, arborescence et plan. Ne code pas encore.
Sépare conditions actuelles, prévisions et réanalyses historiques. Ne fabrique aucune donnée météo. Ne remplace jamais une donnée absente par zéro. Centralise les appels externes dans le backend.
Pour la V1 : pas de compte utilisateur ni de base de données. Aucun service payant, suppression de fichier existant ou déploiement sans accord. Attends la validation du plan.
```

## 02 — Structure du projet

```text
Implémente la structure selon le plan validé. Crée frontend, backend, configuration TypeScript, commandes de développement, test et build. Configure un proxy /api vers le backend en développement.
Crée la navigation des quatre pages et les composants partagés : layout, carte d'indicateur, message d'erreur, chargement, état vide, sélecteur de coordonnées.
Ajoute .env.example sans secret et un README avec les commandes exactes. Tant que les données ne sont pas connectées, affiche « Données non chargées », sans chiffres fictifs.
Exécute les vérifications disponibles, corrige les erreurs et résume les fichiers et commandes.
```

## 03 — Connexion aux données à jour

```text
Crée GET /api/weather?latitude=...&longitude=... et appelle https://api.open-meteo.com/v1/forecast.
Paramètres : latitude=-18.8792 ; longitude=47.5079 ; current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m ; hourly=temperature_2m,relative_humidity_2m,precipitation_probability,precipitation,wind_speed_10m ; daily=temperature_2m_mean,temperature_2m_max,temperature_2m_min,precipitation_sum ; timezone=auto ; forecast_days=7.
Construis l'URL avec URLSearchParams. Valide latitude [-90,90] et longitude [-180,180]. Valide les réponses avec Zod en autorisant les champs supplémentaires. Gère null et vérifie l'alignement des tableaux avec les dates.
Conserve unités, timezone, utc_offset_seconds, current.time et current.interval. Ajoute fetchedAt en UTC sans le confondre avec l'heure de validité.
Timeout 15 secondes ; gestion des erreurs HTTP et error/reason ; au maximum deux nouvelles tentatives sur erreurs transitoires, avec temporisation et respect de Retry-After. Cache serveur 15 minutes par jeu de paramètres. N'accepte aucune URL externe arbitraire fournie par le client.
Teste une requête réelle. Si le réseau échoue, indique la limite sans prétendre que la connexion fonctionne.
```

## 04 — Tableau de bord

```text
Construis le tableau de bord à partir de /api/weather. Affiche température, ressenti, humidité, vent, précipitations sur l'intervalle courant avec sa durée, description française du code météo, coordonnées, fuseau, heure de validité et heure de récupération.
Ajoute courbe des prochaines 48 heures, histogramme des précipitations horaires, tableau des sept jours et bouton Actualiser. Sélectionne les heures futures à partir de l'instant courant, et non les 48 premières heures de la réponse.
Actualise toutes les 15 minutes lorsque la page est visible. Un seul polling, nettoyé au démontage ; annule ou ignore les anciennes requêtes lors du changement de coordonnées.
Gère chargement, erreurs et indisponibilité. En cas d'échec, conserve les dernières données en les signalant comme non actualisées. Jamais zéro pour une donnée absente.
Utilise les unités API et les heures locales du lieu, sans conversion involontaire via le fuseau du navigateur. Ajoute « Conditions issues de modèles météorologiques ».
```

## 05 — Historique

```text
Crée GET /api/history?latitude=...&longitude=...&start_date=...&end_date=... utilisant https://archive-api.open-meteo.com/v1/archive.
Paramètres : coordonnées choisies, dates YYYY-MM-DD, daily=temperature_2m_mean,temperature_2m_max,temperature_2m_min,precipitation_sum ; models=era5 ; timezone=auto.
Interface : sélection des dates, bouton Charger, raccourci 2000–2020, progression, annulation. Propose une fin maximale à aujourd'hui moins 6 jours dans le fuseau du lieu, comme marge opérationnelle pour ERA5, pas comme garantie de disponibilité. Vérifie la documentation actuelle et affiche les valeurs manquantes.
Valide début <= fin. Découpe les longues périodes par année avec concurrence limitée. Cache les archives ; fusionne, trie et détecte doublons et jours manquants. Gère les succès partiels et périodes en erreur. Ne charge pas vingt ans au démarrage.
Affiche courbes des températures, histogramme des précipitations et tableau paginé, avec jours attendus, disponibles et manquants.
Étiquette « Réanalyse historique ERA5 », jamais « mesures directes d'une station ».
```

## 06 — Indicateurs et calculs

```text
Ajoute des fonctions pures testées sur les données historiques filtrées : moyenne des températures moyennes journalières, maximum des maxima, minimum des minima, cumul des précipitations disponibles, jours avec précipitations >= 1 mm, moyennes mensuelles de température, cumuls mensuels et annuels de précipitations, moyenne mobile 7 jours.
Ignore les valeurs nulles dans les calculs mais documente les effectifs et la couverture par variable. Marque tout cumul avec jours manquants « incomplet ». Exige sept jours consécutifs valides pour la moyenne mobile, sinon null.
Ne moyenne pas des moyennes mensuelles non pondérées pour la moyenne de période. Ne mélange pas historique et prévisions. Affiche les définitions dans les info-bulles.
Ajoute des tests manuels de référence, des périodes incomplètes et des années bissextiles. Ne conclus pas au changement climatique à partir d'une courte période ou d'une simple courbe.
```

## 07 — Filtres et exports

```text
Ajoute filtres de coordonnées, période, variable et agrégation journalière/mensuelle/annuelle. Tableaux, graphiques et statistiques doivent partager les mêmes données filtrées.
Ajoute export CSV UTF-8, JSON avec métadonnées, et PNG des graphiques. CSV avec unités dans les noms de colonnes et champs vides pour null. Protège les champs textuels contre les formules de tableur sans transformer les valeurs numériques négatives en texte.
Inclue provenance, modèle si connu, fuseau, période et date de récupération dans les métadonnées exportées. Préserve les dates sans décalage de jour. Exporte toutes les données filtrées, pas seulement la page visible. Documente le format des exports.
```

## 08 — Design et méthodologie

```text
Finalise une interface intégralement française, responsive mobile/tablette/ordinateur, sobre et accessible. Graphiques avec légendes, unités et info-bulles ; contraste lisible, navigation clavier, champs étiquetés et tableaux alternatifs.
Crée « Méthodologie et sources » : différence conditions actuelles/prévisions/réanalyses ; validité versus récupération ; formules ; valeurs manquantes et périodes incomplètes.
Vérifie les conditions officielles actuelles Open-Meteo et les attributions exigées avant de rédiger la section licence. Ajoute les liens des sources. Ne présente pas de seuil personnalisé comme une alerte officielle. N'invente pas de données pour embellir l'interface.
```

## 09 — Tests et corrections

```text
Exécute une validation complète.
Unitaires : coordonnées, dates, transformation JSON, null, alignement des tableaux, moyennes/extrema/cumuls, périodes incomplètes, années bissextiles, fuseaux, cache et expiration.
Intégration : succès API, HTTP 400/429/500, timeout, JSON invalide ou incomplet, chargement historique partiel, cache et nombre de tentatives.
Playwright : tableau de bord, changement de coordonnées, historique, actualisation, filtres, exports, affichage mobile et console sans erreurs.
Les données simulées sont autorisées uniquement dans les tests.
Lance vérification TypeScript, tests et build de production. Corrige les erreurs. Rapporte séparément ce qui a été réellement testé, échoué et non vérifiable. N'affirme pas que tout fonctionne sans résultats.
```

## 10 — Préparer la production

```text
Prépare la production sans déployer ni créer de ressource externe. Utilise une même origine : Express sert le frontend compilé et /api.
Ajoute build, port configurable, GET /api/health, erreurs sans stack publique, limitation des requêtes, validation, logs sans secrets et cache. Fournis un Dockerfile multi-stage si compatible.
Documente hébergement Node.js, commandes exactes, variables, contrôle après déploiement, limites du cache mémoire sur plusieurs instances et diagnostic en cas de panne API.
Vérifie les conditions d'usage Open-Meteo selon le projet. Explique que le polling navigateur n'est pas une collecte permanente.
Aucune publication, création de compte ou dépense sans confirmation. Présente les actions proposées avant exécution.
```

## 11 — Option : collecte permanente

```text
Propose d'abord un plan pour stocker les versions successives avec PostgreSQL et une tâche planifiée externe horaire par localisation. Attends validation avant implémentation ou provisionnement.
Sépare conditions actuelles, prévisions et réanalyses. Stocke fetched_at, valid_time, coordonnées, variable, valeur, unité, source et modèle si fourni. Préserve les instantanés successifs, sans écraser les anciennes prévisions.
Ne présente pas fetched_at comme la date d'émission du modèle. Préviens les doublons de relance et les exécutions concurrentes. Prévois migrations, index, journal des collectes et rétention configurable.
Protège l'éventuel endpoint de collecte avec un secret serveur, jamais exposé au frontend. Documente quotas, coûts et volume de stockage. Distingue collecte réussie et données réellement nouvelles. Demande accord avant toute ressource externe.
```
