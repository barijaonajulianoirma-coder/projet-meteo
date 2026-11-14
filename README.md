# Météo Analyse

Plateforme d'analyse météorologique en français pour Antananarivo et des coordonnées personnalisées, basée sur les API publiques [Open-Meteo](https://open-meteo.com/).

Elle distingue trois natures de données :

- **conditions actuelles** : estimation du modèle pour l'instant présent (`/v1/forecast`, champ `current`) ;
- **prévisions** : horizons horaires et journaliers sur 7 jours ;
- **réanalyse historique ERA5** : archive journalière (`archive-api.open-meteo.com/v1/archive`), qui n'est pas une mesure directe de station.

Stack : React 18, TypeScript, Vite, Recharts, Express, Zod, SQLite (`node:sqlite`). Tests Vitest (unitaire + intégration) et Playwright (navigateur).

## Prérequis

- Node.js **≥ 22.13** (nécessaire pour `node:sqlite` sans option expérimentale)
- npm

## Installation et développement

```bash
npm install
cp .env.example .env   # facultatif : PORT=3000 par défaut
npm run dev
```

- Frontend Vite : <http://localhost:5173>
- API Express : <http://localhost:3000>
- Le proxy Vite redirige `/api` vers `http://localhost:3000`.

Commandes utiles :

```bash
npm run dev:client     # frontend seul
npm run dev:server     # API seule (tsx watch)
npm run typecheck      # TypeScript client + serveur
npm run lint           # ESLint (TypeScript + React)
npm run format         # Prettier sur les sources
npm test               # tests Vitest
npm run test:watch     # Vitest en surveillance
npm run test:e2e       # tests Playwright (installez Chromium si besoin)
npx playwright install chromium
npm run build          # build client + serveur
npm start              # serveur de production (dist-server)
```

## Architecture

```text
src/                 interface React (pages, composants, hooks)
server/              API Express (routes, services, client Open-Meteo, cache)
shared/              types, schémas Zod, calculs statistiques, dates, CSV
etl/                 pipeline de collecte planifiée vers SQLite
dagster_project/     orchestration Dagster autonome (assets, jobs, planifications)
tests/               tests Vitest
tests/e2e/           tests Playwright (API simulée)
Dockerfile           image de production multi-stage
```

Le backend est le **seul** à appeler Open-Meteo : aucune URL externe fournie par le client n'est acceptée. Les réponses amont sont validées par Zod, les valeurs absentes restent `null` et ne sont jamais remplacées par zéro.

### Routes API

| Route | Description |
| --- | --- |
| `GET /api/health` | état du serveur (`status`, `timestamp`, `uptimeSeconds`) |
| `GET /api/weather?latitude=…&longitude=…` | conditions actuelles, prévisions horaires et journalières |
| `GET /api/history?latitude=…&longitude=…&start_date=YYYY-MM-DD&end_date=YYYY-MM-DD` | archive ERA5 journalière |
| `GET /api/analysis?latitude=…&longitude=…&start_date=YYYY-MM-DD&end_date=YYYY-MM-DD` | études statistiques, séries temporelles, ML et diagnostics sur ERA5 |

Validation : latitude `[-90, 90]`, longitude `[-180, 180]`, dates réelles, `start_date ≤ end_date`, archive depuis `1940-01-01`, fin au plus tard à aujourd'hui − 6 jours (marge opérationnelle ERA5), période ≤ 40 ans.

Comportement réseau : timeout 15 s (prévisions) / 20 s (archive), 2 nouvelles tentatives maximum sur erreurs transitoires, respect de `Retry-After`, temporisation exponentielle. Cache mémoire : prévisions 15 min par coordonnées, archives 1 h par segment annuel. Les requêtes simultanées portant sur la même ressource partagent un seul appel amont ; l'annulation d'un client n'interrompt pas le travail commun, qui continue et alimente le cache.

## Données, calculs et limites

- Les cumuls de précipitations comportant des jours manquants sont marqués **incomplets**.
- La moyenne mobile 7 jours exige 7 dates consécutives valides, sinon la valeur est `null`.
- Les moyennes mensuelles/annuelles sont pondérées par les jours réellement disponibles ; on ne moyenne pas des moyennes non pondérées.
- Les heures affichées utilisent le fuseau du lieu (`utc_offset_seconds`) et non celui du navigateur.
- `fetchedAt` est l'heure de récupération serveur en UTC ; ce n'est pas l'heure d'émission du modèle.
- Les réanalyses ERA5 ne sont pas des mesures de station et ne permettent pas de conclure à un changement climatique sur une courte période.
- Aucun seuil affiché ne constitue une alerte officielle.

### Exports

- **CSV** : UTF-8, en-têtes avec unités, champ vide pour `null`, protection contre les formules de tableur sans altérer les nombres négatifs. Toutes les lignes filtrées sont exportées, pas seulement la page visible.
- **JSON** : métadonnées (`provenance`, `modele`, `fuseau`, `periode`, `variable`, `agregation`, `recupere_le`, coordonnées) et données.
- **PNG** : capture du graphique Recharts via canvas, sans service externe.

## Pipeline ETL (collecte planifiée vers SQLite)

Le pipeline `etl/` est indépendant du serveur web : il interroge Open-Meteo, transforme les réponses en observations normalisées et les stocke dans SQLite. Il ne remplace pas la consultation à la demande de l'application ; il conserve des **instantanés successifs** pour l'analyse ultérieure.

```bash
npm run etl -- --dry-run     # extraction + transformation, aucune écriture
npm run etl                  # collecte ponctuelle
npm run etl -- --watch 60    # collecte toutes les 60 min (premier plan)
npm run etl:status           # état de la base, derniers runs, volumes
```

Le mode `--dry-run` valide le réseau, les schémas et les volumes sans créer la base. En production, préférez une tâche planifiée externe :

```bash
# cron : toutes les heures
0 * * * * cd /srv/meteo-analyse && ETL_TRIGGER=cron npm run etl >> /var/log/meteo-etl.log 2>&1
```

```bat
:: Windows : Planificateur de tâches, toutes les heures
schtasks /Create /SC HOURLY /TN "Meteo ETL" /TR "cmd /d /c cd /d C:\chemin\meteo-analyse && ETL_TRIGGER=scheduler npm run etl"
```

### Options et variables

| CLI | Variable | Défaut | Rôle |
| --- | --- | --- | --- |
| `--db <fichier>` | `ETL_DB_PATH` | `data/meteo.sqlite` | fichier SQLite |
| `--locations "…"` | `ETL_LOCATIONS` | `-18.8792,47.5079:Antananarivo` | `lat,lon[:libellé]` séparés par `;` |
| `--forecast-days` | `ETL_FORECAST_DAYS` | `7` | horizon de prévision (1–16) |
| `--archive-days` | `ETL_ARCHIVE_DAYS` | `7` | jours d'archive ERA5 ; `0` désactive |
| `--retention-days` | `ETL_RETENTION_DAYS` | `90` | purge des snapshots plus anciens ; `0` désactive |
| — | `ETL_LOCK_TTL_MINUTES` | `30` | durée du verrou d'exécution |
| — | `ETL_TRIGGER` | `cli` | déclencheur journalisé |

Codes de sortie : `0` succès (même sans nouvelle donnée), `2` succès partiel, `1` échec ou verrou actif.

### Modèle de données

```text
locations        coordonnées et libellé (une ligne par couple unique)
ingestion_runs   journal : statut, horodatages, compteurs, erreurs, nouvelle donnée ou non
snapshots        un instantané immuable par couple (localisation, nature, empreinte du contenu)
observations     format long : granularité, valid_time, variable, valeur, unité
etl_lock         verrou applicatif à une seule ligne (reprise après expiration)
```

- `fetched_at` est l'heure de **récupération serveur** ; ce n'est **pas** l'heure d'émission du modèle. Open-Meteo ne fournit pas d'heure de run dans ces réponses, donc `model` reste `NULL` pour les prévisions et vaut `era5` pour l'archive.
- Les prévisions horaires et journalières sont stockées avec leur `valid_time` locale au lieu (`timezone=auto`).
- Une valeur absente reste `NULL` ; aucun zéro n'est inventé.
- Les anciens snapshots ne sont jamais modifiés : une nouvelle prévision crée un nouvel instantané. Une relance qui renvoie exactement le même contenu est ignorée (empreinte SHA-256), et le journal distingue alors **collecte réussie sans nouvelle donnée**.
- Deux collectes simultanées sont empêchées par un verrou SQLite atomique ; un verrou expiré (processus tué) est repris automatiquement et l'exécution restée `running` est marquée `failed` au démarrage suivant.
- La purge de rétention s'exécute à chaque collecte et supprime les observations en cascade.

Vues fournies : `v_observations` (observations dénormalisées avec coordonnées et provenance) et `v_latest_snapshots` (dernier instantané par localisation et nature).

Exemple de requête :

```sql
SELECT valid_time, variable, value, unit
FROM v_latest_snapshots s
JOIN observations o ON o.snapshot_id = s.id
WHERE s.latitude = -18.8792 AND s.kind = 'forecast' AND o.granularity = 'daily'
ORDER BY valid_time, variable;
```

### Volume, quotas et limites

- Un run prévisions (7 jours) produit environ 900 lignes ; l'archive ajoute environ 4 lignes par jour collecté. À raison d'un run horaire, la rétention de 90 jours reste de l'ordre de quelques millions de lignes, soit un fichier SQLite de quelques centaines de Mo au plus.
- Open-Meteo est gratuit pour un usage raisonnable ; consultez les [conditions](https://open-meteo.com/en/terms) et évitez une fréquence supérieure à l'heure pour un usage courant.
- SQLite ne doit être partagé qu'entre processus sur le **même volume local**. Pour plusieurs collecteurs ou un volume partagé, passer à PostgreSQL.
- L'archive ERA5 est publiée avec un délai d'environ 6 jours ; la fenêtre s'arrête donc à `aujourd'hui − 6 jours`.

### Docker

L'image contient le pipeline compilé (`dist-server/etl/cli.js`) et un répertoire `/app/data` accessible à l'utilisateur `node` :

```bash
docker run --rm -v meteo-data:/app/data meteo-analyse node dist-server/etl/cli.js --dry-run
docker run --rm -v meteo-data:/app/data meteo-analyse node dist-server/etl/cli.js
```

Sur un hôte Linux avec un volume nommé, vérifier les droits du volume (`docker volume inspect`), ou utiliser un montage de répertoire possédé par l'utilisateur qui exécute le conteneur.

## Pipeline Dagster (alternative à l'ETL Node)

Le répertoire `dagster_project/` contient une orchestration Dagster autonome du
même flux Open-Meteo → SQLite : assets bronze (JSON brut) et silver (snapshots),
archive ERA5 partitionnée par jour, contrôles qualité et planifications
horaires/quotidiennes.

```bash
cd dagster_project
pip install -e ".[dev]"
export DAGSTER_HOME="$PWD/dagster_home"
dagster dev -m meteo_dagster.definitions --port 3001
pytest
```

L’UI écoute sur <http://localhost:3001> (le port 3000 est utilisé par
l’application Node) et le `DAGSTER_HOME` versionné conserve l’historique des
runs et l’état des planifications entre deux démarrages.

Voir [`dagster_project/README.md`](dagster_project/README.md) pour les assets,
jobs, planifications et la configuration des ressources. Ce pipeline utilise sa
propre base (`data/dagster_meteo.sqlite`) et n'interfère pas avec l'ETL Node
(`data/meteo.sqlite`).

## Production

```bash
npm ci
npm run build
PORT=3000 npm start
```

Express sert alors le frontend compilé (`dist/`) et l'API `/api` sur la même origine. Le port est configurable via `PORT` (défaut `3000`).

Par défaut le serveur n'écoute que sur la boucle locale (`127.0.0.1`) : il n'est pas joignable depuis le réseau. Il n'y a **aucune authentification**, donc ne définir `HOST=0.0.0.0` qu'en connaissance de cause (réseau de confiance, ou reverse proxy avec HTTPS et authentification).

Variables disponibles :

| Variable | Défaut | Rôle |
| --- | --- | --- |
| `PORT` | `3000` | port HTTP du serveur |
| `HOST` | `127.0.0.1` | interface d'écoute (`0.0.0.0` pour exposer au réseau) |
| `STATIC_DIR` | `dist` | répertoire du frontend compilé servi par Express (relatif au `cwd` ou absolu) |
| `AUTH_USERNAME` | — | identifiant de connexion (obligatoire si `HOST` non local) |
| `AUTH_PASSWORD_HASH` | — | hash scrypt généré par `npm run auth:hash` |
| `SESSION_SECRET` | — | clé HMAC des sessions, 32 caractères minimum |
| `SESSION_TTL_HOURS` | `12` | durée de vie d'une session (1–168) |
| `TRUST_PROXY` | — | `trust proxy` Express, requis derrière un reverse proxy |

La configuration d'écoute est validée avant le démarrage : un `HOST` qui n'est ni une IP ni un nom d'hôte, ou un `PORT` hors de `1-65535`, fait échouer le processus avec le code `1`. Une interface non locale déclenche un avertissement `[securite]` au démarrage.

Aucun secret n'est requis en usage local : l'API Open-Meteo est publique. Ne placez jamais de secret dans le frontend.

### Sécurité et exposition réseau

Par défaut, l'application n'écoute que sur `127.0.0.1` et n'a pas d'authentification. Dès que `HOST` désigne une interface réseau, le serveur **refuse de démarrer** sans `AUTH_USERNAME`, `AUTH_PASSWORD_HASH` et `SESSION_SECRET`.

```bash
printf '%s' 'mot-de-passe-long-et-unique' | npm run auth:hash
```

La procédure complète (reverse proxy nginx/Caddy, TLS, pare-feu, checklist de durcissement, limites connues) est dans [`docs/SECURITE.md`](docs/SECURITE.md).

### Docker

```bash
docker build -t meteo-analyse .
docker run --rm -p 127.0.0.1:3000:3000 -e PORT=3000 meteo-analyse
```

L'image définit `HOST=0.0.0.0` (l'isolation vient du mappage de port) ; le préfixe `127.0.0.1` ci-dessus limite l'accès à la machine hôte. Utiliser `-p 3000:3000` pour rendre le conteneur joignable depuis le réseau.

L'image finale ne contient que les dépendances de production et les artefacts compilés, et tourne avec l'utilisateur non privilégié `node`.

### Contrôle après déploiement

```bash
curl http://localhost:3000/api/health
curl "http://localhost:3000/api/weather?latitude=-18.8792&longitude=47.5079"
```

Vérifier : réponse `200` sur `/api/health`, en-têtes de sécurité, frontend servi, et qu'une erreur amont renvoie `502`/`503` sans pile d'exécution publique.

### Limites d'exploitation

- Par défaut, le cache et la limitation de débit (120 requêtes/min par IP) sont **en mémoire**, donc propres à chaque instance. Définir `REDIS_URL` (après `npm install ioredis`) les rend partagés : le cache est à deux niveaux (mémoire locale devant Redis) et les compteurs de débit deviennent globaux. Sans Redis joignable, l'application retombe silencieusement sur le comportement local.
- En cas de panne de l'API Open-Meteo, le serveur renvoie `503` avec un message public ; le tableau de bord conserve les dernières données valides et les signale comme non actualisées.
- Les logs serveur ne contiennent ni secret ni donnée personnelle. Le diagnostic se fait via `/api/health` et les messages d'erreur publics.

### Conditions d'utilisation Open-Meteo

Les données sont fournies par Open-Meteo sous licence **CC BY 4.0** ; l'attribution est affichée dans l'interface et dans les exports. Consultez les [conditions d'utilisation](https://open-meteo.com/en/terms) et la [documentation](https://open-meteo.com/en/docs) avant un usage à fort trafic. Le rafraîchissement navigateur toutes les 15 minutes n'est **pas** une collecte permanente : l'application consulte les données à la demande et ne stocke pas d'historique de prévisions.

## Tests

```bash
npm run typecheck
npm test
npm run test:e2e
npm run ci            # lint + typecheck + Vitest + Playwright (local)
```

Les tests du pipeline Dagster (Python) sont séparés : `cd dagster_project && pytest`.

Les tests unitaires couvrent coordonnées, dates (dont années bissextiles), schémas, alignement/null, statistiques, cache, CSV, transformation ETL, idempotence, snapshots successifs, verrou, rétention et mode simulation. Les tests d'intégration simulent `fetch` (succès, `400`, `429`/`5xx`, timeout, JSON invalide, archive partielle). Les tests Playwright interceptent `/api/*` avec des données simulées **réservées aux tests** : aucune requête réelle vers Open-Meteo n'est nécessaire.

### Intégration continue

Le workflow GitHub Actions (`.github/workflows/ci.yml`) s'exécute sur chaque push et pull request vers `main`/`master` :

1. `npm run lint` + `npm run typecheck` + `npm test`
2. `npm run test:e2e` (Chromium + deps système)
3. `docker build` de l'image de production

Sur la machine locale, `npm run ci` rejoue les étapes 1–2 (sans Docker).
