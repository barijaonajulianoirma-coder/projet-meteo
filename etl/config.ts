/**
 * Configuration du pipeline ETL.
 * Toutes les valeurs viennent de l'environnement ou des options CLI.
 * Aucun secret n'est nécessaire : l'API Open-Meteo est publique.
 */

export interface EtlLocation {
  latitude: number;
  longitude: number;
  label: string | null;
}

export interface EtlConfig {
  /** Chemin du fichier SQLite (`:memory:` accepté pour les tests). */
  dbPath: string;
  locations: EtlLocation[];
  /** Horizon de prévision demandé à Open-Meteo (1 à 16 jours). */
  forecastDays: number;
  /** Nombre de jours d'archive à ingérer ; 0 désactive l'archive. */
  archiveDays: number;
  /** Supprime les snapshots plus anciens ; 0 désactive la purge. */
  retentionDays: number;
  /** Durée maximale du verrou d'exécution (une seule collecte à la fois). */
  lockTtlMinutes: number;
  trigger: string;
}

export class EtlConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EtlConfigError';
  }
}

export const DEFAULT_LOCATION_SPEC = '-18.8792,47.5079:Antananarivo';
export const DEFAULT_DB_PATH = 'data/meteo.sqlite';

const LOCATION_PATTERN = /^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)(?:\s*:\s*(.+))?$/;

/** Format : `lat,lon[:libellé]` séparés par des points-virgules. */
export function parseLocations(spec: string): EtlLocation[] {
  const locations: EtlLocation[] = [];
  const seen = new Set<string>();

  for (const rawEntry of spec.split(';')) {
    const entry = rawEntry.trim();
    if (!entry) continue;

    const match = LOCATION_PATTERN.exec(entry);
    if (!match) {
      throw new EtlConfigError(
        `Localisation invalide « ${entry} » : format attendu latitude,longitude[:libellé]`,
      );
    }

    const latitude = Number(match[1]);
    const longitude = Number(match[2]);
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
      throw new EtlConfigError(`Latitude hors limites [-90, 90] : ${match[1]}`);
    }
    if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      throw new EtlConfigError(`Longitude hors limites [-180, 180] : ${match[2]}`);
    }

    const key = `${latitude}:${longitude}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const label = match[3]?.trim();
    locations.push({ latitude, longitude, label: label ? label : null });
  }

  if (locations.length === 0) {
    throw new EtlConfigError('Aucune localisation valide fournie');
  }
  return locations;
}

function parseInteger(name: string, raw: string | undefined, fallback: number, min: number, max: number): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new EtlConfigError(`${name} doit être un entier entre ${min} et ${max} (reçu : ${raw})`);
  }
  return value;
}

/** Charge la configuration depuis un environnement (process.env par défaut). */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): EtlConfig {
  return {
    dbPath: env.ETL_DB_PATH?.trim() || DEFAULT_DB_PATH,
    locations: parseLocations(env.ETL_LOCATIONS?.trim() || DEFAULT_LOCATION_SPEC),
    forecastDays: parseInteger('ETL_FORECAST_DAYS', env.ETL_FORECAST_DAYS, 7, 1, 16),
    archiveDays: parseInteger('ETL_ARCHIVE_DAYS', env.ETL_ARCHIVE_DAYS, 7, 0, 14_600),
    retentionDays: parseInteger('ETL_RETENTION_DAYS', env.ETL_RETENTION_DAYS, 90, 0, 3_650),
    lockTtlMinutes: parseInteger('ETL_LOCK_TTL_MINUTES', env.ETL_LOCK_TTL_MINUTES, 30, 5, 720),
    trigger: env.ETL_TRIGGER?.trim() || 'cli',
  };
}
