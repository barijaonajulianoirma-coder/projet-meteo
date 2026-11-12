import type { SourceInfo } from './types.js';

export const OPEN_METEO_ATTRIBUTION =
  'Données : Open-Meteo.com — réutilisation sous licence CC BY 4.0, attribution obligatoire.';

export const FORECAST_SOURCE: SourceInfo = {
  name: 'Open-Meteo — prévisions météorologiques',
  url: 'https://open-meteo.com/',
  licence: 'CC BY 4.0',
  attribution: OPEN_METEO_ATTRIBUTION,
};

export const HISTORY_SOURCE: SourceInfo = {
  name: 'Open-Meteo — réanalyse ERA5 (archive)',
  url: 'https://open-meteo.com/en/docs/historical-weather-api',
  licence: 'CC BY 4.0',
  attribution: `${OPEN_METEO_ATTRIBUTION} Réanalyse ERA5 du CEPMMT via l'API d'archive Open-Meteo.`,
};

export const OPEN_METEO_TERMS_URL = 'https://open-meteo.com/en/terms';

/** Délai opérationnel constaté pour ERA5 ; ce n'est pas une garantie de disponibilité. */
export const ARCHIVE_SAFETY_DAYS = 6;
