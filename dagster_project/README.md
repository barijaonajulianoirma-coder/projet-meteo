# Pipeline Dagster — Météo Analyse

Orchestration Dagster de la collecte Open-Meteo vers SQLite. Ce module est
**autonome** : il ne dépend pas de l'application Node et peut tourner à côté du
pipeline `etl/` TypeScript, avec sa propre base.

## Installation

Python **≥ 3.11** requis.

```bash
cd dagster_project
python -m venv .venv
.venv/Scripts/activate      # Windows ; source .venv/bin/activate sous Linux
pip install -e ".[dev]"
```

## Lancement

Depuis `dagster_project/`, définir un `DAGSTER_HOME` persistant puis démarrer
l’UI sur le port **3001** (le port 3000 est occupé par l’application Node) :

```bash
export DAGSTER_HOME="$PWD/dagster_home"
dagster dev -m meteo_dagster.definitions --port 3001
```

Web UI : <http://localhost:3001>.

Le fichier versionné `dagster_home/dagster.yaml` configure le stockage SQLite de
l’instance dans `dagster_home/history/` ; le reste de ce répertoire est ignoré
par Git. Sans `DAGSTER_HOME`, Dagster utilise un répertoire temporaire :
l’historique des runs et l’activation des planifications sont alors perdus à
chaque arrêt. Les données météo, elles, restent dans `data/`.

### Assets

| Asset | Couche | Partitionnement | Rôle |
| --- | --- | --- | --- |
| `forecast_raw` | bronze | — | prévisions Open-Meteo brutes (JSON gzip sur disque) |
| `forecast_snapshot` | silver | — | validation, transformation longue, snapshot SQLite |
| `archive_raw` | bronze | jour | réponse ERA5 brute d'une journée |
| `archive_snapshot` | silver | jour | archive ERA5 normalisée et chargée |
| `retention` | maintenance | — | purge des snapshots et documents bruts de prévision expirés |

Contrôles qualité (non bloquants) :

- `forecast_quality` : le dernier snapshot de prévision contient au moins une
  température réelle pour chaque localisation ;
- `archive_quality` : la partition ERA5 matérialisée contient des observations.

### Jobs et planifications

| Job | Planification (UTC) | Sélection |
| --- | --- | --- |
| `forecast_job` | `forecast_hourly`, toutes les heures à H:05 | `forecast_raw`, `forecast_snapshot`, `forecast_quality` |
| `archive_job` | `archive_daily`, 06:00 | `archive_raw`, `archive_snapshot`, `archive_quality` (partition J−6) |
| `maintenance_job` | `retention_daily`, 04:00 | `retention` |

L'archive est partitionnée depuis `2024-01-01` avec un décalage de 6 jours
(retard de publication ERA5). Le planificateur cible explicitement la partition
J−6 ; une matérialisation manuelle prend la partition choisie dans l'UI ou via
`--partition`.

Les planifications ne sont pas activées par défaut : démarrez le daemon
(`dagster dev` le fait) puis activez-les depuis l'UI (*Automation*).

Rejouer une plage de partitions : dans l'UI, *Assets* → `archive_snapshot` →
*Materialize* → sélection de la plage, ou via GraphQL. La CLI fournie par
Dagster 1.13 ne propose pas de commande `backfill`.

## Configuration des ressources

| Ressource | Paramètre | Défaut |
| --- | --- | --- |
| `warehouse` | `path` | `data/dagster_meteo.sqlite` |
| `meteo_config` | `raw_dir` | `data/raw` |
| `meteo_config` | `locations` | `-18.8792, 47.5079` (Antananarivo) |
| `meteo_config` | `forecast_days` | `7` |
| `meteo_config` | `retention_days` | `90` (`0` désactive la purge) |
| `open_meteo` | `timeout_seconds`, `max_retries` | `20`, `3` |

Les valeurs se surchargent dans l'UI (Launchpad → onglet *Configure*) ou via un
fichier de configuration de run :

```yaml
resources:
  meteo_config:
    config:
      locations:
        - latitude: -18.8792
          longitude: 47.5079
          label: Antananarivo
      forecast_days: 7
      retention_days: 90
  warehouse:
    config:
      path: data/dagster_meteo.sqlite
```

## Garanties et limites

- Une valeur absente reste `NULL`, jamais `0`.
- Snapshots immuables : une nouvelle collecte crée un nouvel instantané ; un
  contenu identique (empreinte SHA-256) est ignoré et journalisé comme
  `unchanged` dans `load_events`.
- La zone brute est écrite de façon atomique (fichier temporaire + `os.replace`).
- La rétention supprime les snapshots de prévision et les fichiers bruts
  `data/raw/forecast/*.json.gz` plus anciens que `retention_days` ; les archives
  ERA5 ne sont jamais purgées.
- La journée ERA5 doit être disponible : l'API peut renvoyer des valeurs nulles
  pour les dates les plus récentes, d'où le décalage de 6 jours.
- La base et la zone brute ne doivent être utilisées que par un seul déploiement
  Dagster à la fois (SQLite local, `WAL` activé).
- Aucun secret n'est requis : l'API Open-Meteo est publique.

## Tests

```bash
cd dagster_project
pytest
```

Les tests sont hors ligne : les payloads Open-Meteo sont simulés, les assets sont
matérialisés dans un répertoire temporaire. Ils couvrent validation, alignement
des séries, transformation, empreinte, zone brute, idempotence, qualité,
partitions, rétention (base et zone brute) et câblage des définitions.
