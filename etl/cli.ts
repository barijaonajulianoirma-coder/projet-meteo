/**
 * Point d'entrée du pipeline ETL.
 *
 *   npm run etl                      # une collecte
 *   npm run etl -- --dry-run         # extraction + transformation sans écriture
 *   npm run etl -- --watch 60        # collecte toutes les 60 minutes
 *   npm run etl -- --status          # état de la base
 */
import fs from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { EtlConfigError, loadConfig, parseLocations, type EtlConfig } from './config.js';
import { getStatus, openDatabaseReadOnly } from './db.js';
import { runEtl, type EtlRunSummary } from './run.js';

const HELP = `Pipeline ETL Météo Analyse — collecte Open-Meteo vers SQLite

Usage :
  npm run etl -- [options]

Options :
  --db <fichier>            Chemin SQLite            (env ETL_DB_PATH, défaut data/meteo.sqlite)
  --locations "<spec>"      lat,lon[:libellé] séparés par ;   (env ETL_LOCATIONS)
  --forecast-days <1-16>    Horizon de prévision      (env ETL_FORECAST_DAYS, défaut 7)
  --archive-days <0-14600>  Jours d'archive ERA5 ; 0 désactive   (env ETL_ARCHIVE_DAYS, défaut 7)
  --retention-days <0-3650> Purge des anciens snapshots ; 0 désactive  (env ETL_RETENTION_DAYS, défaut 90)
  --dry-run                 Aucune écriture en base
  --watch <minutes>         Collecte répétée (tâche planifiée interne)
  --status                  Affiche l'état de la base et quitte
  --help                    Affiche cette aide

Codes de sortie : 0 succès (ou aucune nouvelle donnée), 2 succès partiel, 1 échec.
`;

interface CliOptions {
  help: boolean;
  status: boolean;
  dryRun: boolean;
  watchMinutes: number | null;
  overrides: Partial<EtlConfig>;
}

function readValue(argv: string[], index: number, flag: string): { value: string; next: number } {
  const argument = argv[index]!;
  const inline = argument.includes('=') ? argument.slice(argument.indexOf('=') + 1) : null;
  if (inline !== null) {
    if (inline === '') throw new EtlConfigError(`Valeur manquante pour ${flag}`);
    return { value: inline, next: index + 1 };
  }
  const value = argv[index + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new EtlConfigError(`Valeur manquante pour ${flag}`);
  }
  return { value, next: index + 2 };
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    help: false,
    status: false,
    dryRun: false,
    watchMinutes: null,
    overrides: {},
  };

  let index = 0;
  while (index < argv.length) {
    const argument = argv[index]!;
    const flag = argument.split('=')[0]!;

    switch (flag) {
      case '--help':
      case '-h':
        options.help = true;
        index += 1;
        break;
      case '--status':
        options.status = true;
        index += 1;
        break;
      case '--dry-run':
        options.dryRun = true;
        index += 1;
        break;
      case '--db': {
        const { value, next } = readValue(argv, index, flag);
        options.overrides.dbPath = value;
        index = next;
        break;
      }
      case '--locations': {
        const { value, next } = readValue(argv, index, flag);
        options.overrides.locations = parseLocations(value);
        index = next;
        break;
      }
      case '--forecast-days':
      case '--archive-days':
      case '--retention-days': {
        const { value, next } = readValue(argv, index, flag);
        const parsed = Number(value);
        if (!Number.isInteger(parsed) || parsed < 0) {
          throw new EtlConfigError(`${flag} doit être un entier positif (reçu : ${value})`);
        }
        if (flag === '--forecast-days') options.overrides.forecastDays = parsed;
        if (flag === '--archive-days') options.overrides.archiveDays = parsed;
        if (flag === '--retention-days') options.overrides.retentionDays = parsed;
        index = next;
        break;
      }
      case '--watch': {
        const { value, next } = readValue(argv, index, flag);
        const parsed = Number(value);
        if (!Number.isInteger(parsed) || parsed < 1 || parsed > 1_440) {
          throw new EtlConfigError(`--watch doit être un entier entre 1 et 1440 minutes (reçu : ${value})`);
        }
        options.watchMinutes = parsed;
        index = next;
        break;
      }
      default:
        throw new EtlConfigError(`Option inconnue : ${argument}`);
    }
  }

  return options;
}

function printStatus(dbPath: string): number {
  if (dbPath !== ':memory:' && !fs.existsSync(dbPath)) {
    console.log(JSON.stringify({ dbPath, exists: false }, null, 2));
    return 1;
  }
  const db = openDatabaseReadOnly(dbPath);
  try {
    console.log(JSON.stringify(getStatus(db, dbPath), null, 2));
  } finally {
    db.close();
  }
  return 0;
}

function summarize(summary: EtlRunSummary): string {
  if (summary.status === 'locked') {
    return 'Collecte ignorée : une autre exécution est en cours.';
  }
  if (summary.status === 'dry-run') {
    const rows = summary.locations.reduce(
      (total, location) => total + location.forecastRows + location.archiveRows,
      0,
    );
    return `Simulation terminée : ${rows} observations préparées, ${summary.errors.length} erreur(s).`;
  }
  return [
    `Collecte ${summary.status} en ${summary.durationMs} ms :`,
    `${summary.snapshotsInserted} snapshot(s) inséré(s),`,
    `${summary.snapshotsSkipped} ignoré(s) (contenu inchangé),`,
    `${summary.observationsInserted} observation(s),`,
    `${summary.retentionDeleted} snapshot(s) purgé(s),`,
    `${summary.errors.length} erreur(s).`,
  ].join(' ');
}

function exitCodeFor(status: EtlRunSummary['status']): number {
  if (status === 'success' || status === 'dry-run') return 0;
  if (status === 'partial') return 2;
  return 1;
}

async function watch(config: EtlConfig, minutes: number): Promise<number> {
  const controller = new AbortController();
  const stop = (): void => controller.abort();
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  console.log(`Mode planifié : collecte toutes les ${minutes} min. Ctrl+C pour arrêter.`);
  try {
    while (!controller.signal.aborted) {
      const summary = await runEtl({ config: { ...config, trigger: 'schedule' } });
      console.log(summarize(summary));
      if (controller.signal.aborted) break;
      await sleep(minutes * 60_000, undefined, { signal: controller.signal });
    }
  } catch (error) {
    if (!(error instanceof Error && error.name === 'AbortError')) throw error;
  } finally {
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
  }
  return 0;
}

async function main(argv: string[]): Promise<number> {
  const options = parseArgs(argv);
  if (options.help) {
    console.log(HELP);
    return 0;
  }

  const base = loadConfig();
  const config: EtlConfig = { ...base, ...options.overrides };

  if (config.forecastDays < 1 || config.forecastDays > 16) {
    throw new EtlConfigError('--forecast-days doit être compris entre 1 et 16');
  }
  if (config.archiveDays < 0 || config.archiveDays > 14_600) {
    throw new EtlConfigError('--archive-days doit être compris entre 0 et 14600');
  }
  if (config.retentionDays < 0 || config.retentionDays > 3_650) {
    throw new EtlConfigError('--retention-days doit être compris entre 0 et 3650');
  }
  if (options.status && (options.watchMinutes !== null || options.dryRun)) {
    throw new EtlConfigError('--status ne peut pas être combiné avec --watch ou --dry-run');
  }
  if (options.dryRun && options.watchMinutes !== null) {
    throw new EtlConfigError('--dry-run ne peut pas être combiné avec --watch');
  }

  if (options.status) return printStatus(config.dbPath);
  if (options.watchMinutes !== null) return watch(config, options.watchMinutes);

  const summary = await runEtl({ config, dryRun: options.dryRun });
  console.log(summarize(summary));
  return exitCodeFor(summary.status);
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    if (error instanceof EtlConfigError) {
      console.error(`Configuration invalide : ${error.message}`);
      console.error('Utilisez --help pour afficher les options.');
    } else {
      console.error(`Échec du pipeline : ${error instanceof Error ? error.message : String(error)}`);
    }
    process.exitCode = 1;
  });
