/**
 * Orchestration ETL : extraction → transformation → chargement.
 *
 * Garanties :
 * - verrou applicatif : deux collectes ne peuvent pas écrire simultanément ;
 * - idempotence : un contenu déjà stocké (même empreinte) est ignoré ;
 * - snapshots immuables : les anciennes prévisions ne sont jamais écrasées ;
 * - une erreur sur une localisation ou une nature de données n'empêche pas
 *   les autres collectes ; le journal conserve le détail.
 */
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import type { EtlConfig, EtlLocation } from './config.js';
import {
  acquireLock,
  applyRetention,
  failStaleRuns,
  finishRun,
  getOrCreateLocation,
  insertSnapshot,
  openDatabase,
  releaseLock,
  startRun,
  type RunStatus,
} from './db.js';
import {
  archiveWindow,
  fetchArchiveWindow,
  fetchForecast,
  type ArchiveFetcher,
  type ForecastFetcher,
} from './extract.js';
import { transformArchive, transformForecast } from './transform.js';

export type StepState = 'inserted' | 'unchanged' | 'failed' | 'disabled';

export interface LocationResult {
  latitude: number;
  longitude: number;
  label: string | null;
  forecast: StepState;
  archive: StepState;
  forecastRows: number;
  archiveRows: number;
  errors: string[];
}

export type EtlRunStatus = 'success' | 'partial' | 'failed' | 'locked' | 'dry-run';

export interface EtlRunSummary {
  status: EtlRunStatus;
  runId: number | null;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  locations: LocationResult[];
  snapshotsInserted: number;
  snapshotsSkipped: number;
  observationsInserted: number;
  retentionDeleted: number;
  newData: boolean;
  errors: string[];
}

export interface EtlLogger {
  info(event: string, fields?: Record<string, unknown>): void;
  warn(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
}

export const consoleLogger: EtlLogger = {
  info(event, fields) {
    console.log(formatLog('info', event, fields));
  },
  warn(event, fields) {
    console.warn(formatLog('warn', event, fields));
  },
  error(event, fields) {
    console.error(formatLog('error', event, fields));
  },
};

function formatLog(level: string, event: string, fields?: Record<string, unknown>): string {
  const suffix = fields && Object.keys(fields).length > 0 ? ` ${JSON.stringify(fields)}` : '';
  return `${new Date().toISOString()} ${level.toUpperCase()} ${event}${suffix}`;
}

export interface EtlDependencies {
  fetchForecast: ForecastFetcher;
  fetchArchive: ArchiveFetcher;
  now: () => Date;
}

export interface RunEtlOptions {
  config: EtlConfig;
  dryRun?: boolean;
  deps?: Partial<EtlDependencies>;
  logger?: EtlLogger;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Erreur inconnue';
}

function emptyLocationResult(location: EtlLocation): LocationResult {
  return {
    latitude: location.latitude,
    longitude: location.longitude,
    label: location.label,
    forecast: 'disabled',
    archive: 'disabled',
    forecastRows: 0,
    archiveRows: 0,
    errors: [],
  };
}

/** Collecte complète, sans écriture : utile pour valider réseau, schémas et volumes. */
async function dryRun(
  options: RunEtlOptions,
  deps: EtlDependencies,
  logger: EtlLogger,
  startedAt: Date,
): Promise<EtlRunSummary> {
  const { config } = options;
  const window =
    config.archiveDays > 0
      ? archiveWindow(config.archiveDays, deps.now().toISOString().slice(0, 10))
      : null;
  const results: LocationResult[] = [];
  const errors: string[] = [];

  for (const location of config.locations) {
    const result = emptyLocationResult(location);
    try {
      const payload = await deps.fetchForecast(location.latitude, location.longitude, config.forecastDays);
      const snapshot = transformForecast(payload, config.forecastDays);
      result.forecast = 'inserted';
      result.forecastRows = snapshot.observations.length;
      logger.info('etl.dry_run.forecast', {
        latitude: location.latitude,
        longitude: location.longitude,
        rows: snapshot.observations.length,
        hash: snapshot.contentHash.slice(0, 12),
      });
    } catch (error) {
      result.forecast = 'failed';
      result.errors.push(`prévisions : ${errorMessage(error)}`);
    }

    if (window) {
      try {
        const chunks = await deps.fetchArchive(location.latitude, location.longitude, window.start, window.end);
        const snapshot = transformArchive(chunks);
        result.archive = 'inserted';
        result.archiveRows = snapshot.observations.length;
        logger.info('etl.dry_run.archive', {
          latitude: location.latitude,
          longitude: location.longitude,
          period: `${window.start}/${window.end}`,
          rows: snapshot.observations.length,
          hash: snapshot.contentHash.slice(0, 12),
        });
      } catch (error) {
        result.archive = 'failed';
        result.errors.push(`archive : ${errorMessage(error)}`);
      }
    }

    errors.push(...result.errors.map((message) => `${location.latitude},${location.longitude} ${message}`));
    results.push(result);
  }

  const finishedAt = deps.now();
  return {
    status: 'dry-run',
    runId: null,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    locations: results,
    snapshotsInserted: 0,
    snapshotsSkipped: 0,
    observationsInserted: 0,
    retentionDeleted: 0,
    newData: false,
    errors,
  };
}

export async function runEtl(options: RunEtlOptions): Promise<EtlRunSummary> {
  const { config } = options;
  const deps: EtlDependencies = {
    fetchForecast: options.deps?.fetchForecast ?? fetchForecast,
    fetchArchive: options.deps?.fetchArchive ?? fetchArchiveWindow,
    now: options.deps?.now ?? (() => new Date()),
  };
  const logger = options.logger ?? consoleLogger;
  const startedAt = deps.now();

  logger.info('etl.run.start', {
    db: config.dbPath,
    trigger: config.trigger,
    locations: config.locations.length,
    forecastDays: config.forecastDays,
    archiveDays: config.archiveDays,
    retentionDays: config.retentionDays,
    dryRun: options.dryRun === true,
  });

  if (options.dryRun) {
    const summary = await dryRun(options, deps, logger, startedAt);
    logSummary(logger, summary);
    return summary;
  }

  const db = openDatabase(config.dbPath);
  const owner = `${os.hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;

  if (!acquireLock(db, owner, startedAt, config.lockTtlMinutes)) {
    db.close();
    const finishedAt = deps.now();
    const summary: EtlRunSummary = {
      status: 'locked',
      runId: null,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      locations: [],
      snapshotsInserted: 0,
      snapshotsSkipped: 0,
      observationsInserted: 0,
      retentionDeleted: 0,
      newData: false,
      errors: ['Une autre collecte est déjà en cours (verrou actif).'],
    };
    logger.warn('etl.run.locked', { db: config.dbPath });
    logSummary(logger, summary);
    return summary;
  }

  let runId: number | null = null;
  const results: LocationResult[] = [];
  const errors: string[] = [];
  let snapshotsInserted = 0;
  let snapshotsSkipped = 0;
  let observationsInserted = 0;
  let retentionDeleted = 0;
  let fatalError: string | null = null;

  const archiveRange =
    config.archiveDays > 0
      ? archiveWindow(config.archiveDays, deps.now().toISOString().slice(0, 10))
      : null;

  try {
    const staleRuns = failStaleRuns(db, startedAt);
    if (staleRuns > 0) {
      logger.warn('etl.stale_runs.recovered', { count: staleRuns });
    }
    runId = startRun(db, config.trigger, startedAt, config.locations.length);

    for (const location of config.locations) {
      const result = emptyLocationResult(location);
      const locationId = getOrCreateLocation(
        db,
        location.latitude,
        location.longitude,
        location.label,
        startedAt,
      );

      try {
        const payload = await deps.fetchForecast(location.latitude, location.longitude, config.forecastDays);
        const snapshot = transformForecast(payload, config.forecastDays);
        const inserted = insertSnapshot(db, {
          runId,
          locationId,
          kind: snapshot.kind,
          fetchedAt: payload.fetchedAt,
          source: snapshot.source,
          model: snapshot.model,
          timezone: snapshot.timezone,
          timezoneAbbreviation: snapshot.timezoneAbbreviation,
          utcOffsetSeconds: snapshot.utcOffsetSeconds,
          forecastDays: snapshot.forecastDays,
          contentHash: snapshot.contentHash,
          observations: snapshot.observations,
        });
        result.forecast = inserted ? 'inserted' : 'unchanged';
        result.forecastRows = snapshot.observations.length;
        if (inserted) {
          snapshotsInserted += 1;
          observationsInserted += snapshot.observations.length;
        } else {
          snapshotsSkipped += 1;
        }
        logger.info('etl.forecast', {
          latitude: location.latitude,
          longitude: location.longitude,
          inserted,
          rows: snapshot.observations.length,
          hash: snapshot.contentHash.slice(0, 12),
        });
      } catch (error) {
        result.forecast = 'failed';
        const message = errorMessage(error);
        result.errors.push(`prévisions : ${message}`);
        logger.error('etl.forecast.failed', {
          latitude: location.latitude,
          longitude: location.longitude,
          error: message,
        });
      }

      if (archiveRange) {
        try {
          const chunks = await deps.fetchArchive(
            location.latitude,
            location.longitude,
            archiveRange.start,
            archiveRange.end,
          );
          const snapshot = transformArchive(chunks);
          const inserted = insertSnapshot(db, {
            runId,
            locationId,
            kind: snapshot.kind,
            fetchedAt: deps.now().toISOString(),
            source: snapshot.source,
            model: snapshot.model,
            timezone: snapshot.timezone,
            timezoneAbbreviation: snapshot.timezoneAbbreviation,
            utcOffsetSeconds: snapshot.utcOffsetSeconds,
            forecastDays: snapshot.forecastDays,
            contentHash: snapshot.contentHash,
            observations: snapshot.observations,
          });
          result.archive = inserted ? 'inserted' : 'unchanged';
          result.archiveRows = snapshot.observations.length;
          if (inserted) {
            snapshotsInserted += 1;
            observationsInserted += snapshot.observations.length;
          } else {
            snapshotsSkipped += 1;
          }
          logger.info('etl.archive', {
            latitude: location.latitude,
            longitude: location.longitude,
            period: `${archiveRange.start}/${archiveRange.end}`,
            inserted,
            rows: snapshot.observations.length,
            hash: snapshot.contentHash.slice(0, 12),
          });
        } catch (error) {
          result.archive = 'failed';
          const message = errorMessage(error);
          result.errors.push(`archive : ${message}`);
          logger.error('etl.archive.failed', {
            latitude: location.latitude,
            longitude: location.longitude,
            error: message,
          });
        }
      }

      errors.push(...result.errors.map((message) => `${location.latitude},${location.longitude} ${message}`));
      results.push(result);
    }

    if (config.retentionDays > 0) {
      const cutoff = new Date(
        deps.now().getTime() - config.retentionDays * 86_400_000,
      ).toISOString();
      try {
        retentionDeleted = applyRetention(db, cutoff);
        logger.info('etl.retention', { cutoff, deletedSnapshots: retentionDeleted });
      } catch (error) {
        logger.warn('etl.retention.failed', { cutoff, error: errorMessage(error) });
      }
    }

    const failedLocations = results.filter((result) => result.errors.length > 0).length;
    const succeededLocations = results.length - failedLocations;
    const stepFailures = results.reduce((total, result) => total + result.errors.length, 0);
    const status: RunStatus =
      stepFailures === 0 ? 'success' : succeededLocations > 0 ? 'partial' : 'failed';

    finishRun(db, runId, deps.now(), {
      status,
      locationsRequested: config.locations.length,
      locationsSucceeded: succeededLocations,
      locationsFailed: failedLocations,
      snapshotsInserted,
      snapshotsSkipped,
      observationsInserted,
      dataChanged: snapshotsInserted > 0,
      retentionDeleted,
      error: errors.length > 0 ? errors.join(' | ').slice(0, 2000) : null,
    });

    const finishedAt = deps.now();
    const summary: EtlRunSummary = {
      status,
      runId,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      locations: results,
      snapshotsInserted,
      snapshotsSkipped,
      observationsInserted,
      retentionDeleted,
      newData: snapshotsInserted > 0,
      errors,
    };
    logSummary(logger, summary);
    return summary;
  } catch (error) {
    fatalError = errorMessage(error);
    logger.error('etl.run.failed', { error: fatalError });
    const finishedAt = deps.now();
    if (runId !== null) {
      try {
        finishRun(db, runId, finishedAt, {
          status: 'failed',
          locationsRequested: config.locations.length,
          locationsSucceeded: 0,
          locationsFailed: results.length,
          snapshotsInserted,
          snapshotsSkipped,
          observationsInserted,
          dataChanged: snapshotsInserted > 0,
          retentionDeleted,
          error: fatalError,
        });
      } catch {
        // Le journal ne doit pas masquer l'erreur d'origine.
      }
    }
    const summary: EtlRunSummary = {
      status: 'failed',
      runId,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      locations: results,
      snapshotsInserted,
      snapshotsSkipped,
      observationsInserted,
      retentionDeleted,
      newData: snapshotsInserted > 0,
      errors: [fatalError],
    };
    logSummary(logger, summary);
    return summary;
  } finally {
    try {
      releaseLock(db, owner);
    } finally {
      db.close();
    }
  }
}

function logSummary(logger: EtlLogger, summary: EtlRunSummary): void {
  logger.info('etl.run.end', {
    status: summary.status,
    runId: summary.runId,
    durationMs: summary.durationMs,
    snapshotsInserted: summary.snapshotsInserted,
    snapshotsSkipped: summary.snapshotsSkipped,
    observationsInserted: summary.observationsInserted,
    retentionDeleted: summary.retentionDeleted,
    newData: summary.newData,
    errors: summary.errors.length,
  });
}
