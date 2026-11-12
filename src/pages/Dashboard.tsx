import {
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  LineChart,
  Line,
  BarChart,
  Bar,
} from 'recharts';
import type { TooltipProps } from 'recharts';
import type { HourlyPoint } from '../../shared/types.js';
import { formatFRHour, formatFRWeekday } from '../../shared/dates.js';
import { describeWeatherCode } from '../../shared/weatherCodes.js';
import { useCoordinates } from '../coordinates.js';
import { useWeather, AUTO_REFRESH_MS } from '../hooks/useWeather.js';
import { DashboardAnalysis } from '../components/DashboardAnalysis.js';
import {
  ChartPanel,
  EmptyState,
  ErrorMessage,
  Loading,
  PageHeader,
} from '../components/ui.js';
import {
  MISSING_VALUE,
  formatDuration,
  formatNumber,
  formatOffset,
  formatUtcInOffset,
  withUnit,
} from '../lib/format.js';
/** Pictogramme synthétique associé à un code WMO. */
function weatherGlyph(code: number | null | undefined): string {
  if (code === null || code === undefined || Number.isNaN(code)) return '◦';
  if (code === 0) return '☀';
  if (code <= 2) return '🌤';
  if (code === 3) return '☁';
  if (code === 45 || code === 48) return '🌫';
  if (code >= 51 && code <= 57) return '🌦';
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return '🌧';
  if (code >= 71 && code <= 77) return '❄';
  if (code >= 85 && code <= 86) return '🌨';
  if (code >= 95) return '⛈';
  return '☁';
}

/** Position relative d'une plage min-max sur l'amplitude de la semaine. */
function rangeStyle(
  min: number | null,
  max: number | null,
  weekMin: number | null,
  weekMax: number | null,
): { left: string; width: string } | null {
  if (min === null || max === null || weekMin === null || weekMax === null) return null;
  const span = weekMax - weekMin;
  if (span <= 0) return { left: '0%', width: '100%' };
  const left = ((min - weekMin) / span) * 100;
  const width = Math.max(((max - min) / span) * 100, 4);
  return { left: `${left}%`, width: `${Math.min(width, 100 - left)}%` };
}

function HourlyTooltip({ active, payload }: TooltipProps<number, string>): JSX.Element | null {
  if (!active || !payload?.length) return null;
  const data = payload[0]?.payload as HourlyPoint | undefined;
  if (!data) return null;
  return (
    <div className="custom-tooltip">
      <div className="tooltip-label">{formatFRHour(data.time)}</div>
      {payload.map((entry) => (
        <div key={entry.dataKey as string}>
          {entry.name} : {typeof entry.value === 'number' ? formatNumber(entry.value) : MISSING_VALUE}
        </div>
      ))}
    </div>
  );
}

function PrecipTooltip({ active, payload }: TooltipProps<number, string>): JSX.Element | null {
  if (!active || !payload?.length) return null;
  const data = payload[0]?.payload as HourlyPoint | undefined;
  if (!data) return null;
  return (
    <div className="custom-tooltip">
      <div className="tooltip-label">{formatFRHour(data.time)}</div>
      <div>Précipitations : {formatNumber(data.precipitation)} mm</div>
      {data.precipitationProbability !== null && (
        <div>Probabilité : {formatNumber(data.precipitationProbability, 0)} %</div>
      )}
    </div>
  );
}

export function Dashboard(): JSX.Element {
  const { coordinates } = useCoordinates();
  const { state, refresh } = useWeather(coordinates);
  const { data, loading, error, stale } = state;

  const refreshMinutes = Math.round(AUTO_REFRESH_MS / 60_000);
  const today = data?.daily[0];
  const precipUnit = data?.units.daily['precipitation_sum'] ?? 'mm';
  const weekTemps = data
    ? data.daily.flatMap((day) => [day.temperatureMin, day.temperatureMax])
        .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
    : [];
  const weekMin = weekTemps.length ? Math.min(...weekTemps) : null;
  const weekMax = weekTemps.length ? Math.max(...weekTemps) : null;

  if (loading && !data) {
    return <Loading label="Chargement des conditions actuelles…" />;
  }

  return (
    <>
      <PageHeader
        title="Tableau de bord"
        intro={
          data
            ? `${coordinates.latitude.toFixed(4)}, ${coordinates.longitude.toFixed(4)} · Fuseau : ${data.timezone} (${formatOffset(data.utcOffsetSeconds)})`
            : undefined
        }
        actions={
          <button type="button" className="button button-secondary" onClick={refresh} disabled={loading}>
            {loading ? 'Chargement…' : '↻ Actualiser'}
          </button>
        }
      />

      {stale && (
        <div className="stale-banner" role="status">
          ⚠ Les données affichées sont celles de la dernière récupération réussie.
        </div>
      )}

      {error && (
        <ErrorMessage
          message={stale ? "Echec de l'actualisation" : "Donnees non chargees"}
          reason={error}
          onRetry={refresh}
          variant={stale ? 'warning' : 'error'}
        />
      )}

      {!data && !error && (
        <EmptyState title="Données non chargées">
          <p>Vérifiez que l'API est démarrée puis cliquez sur Actualiser.</p>
        </EmptyState>
      )}

      {data && (
        <>
          {/* Conditions actuelles */}
          <section aria-labelledby="current-heading">
            <div className="section-heading-row">
              <h2 id="current-heading" className="section-title">
                Conditions actuelles
              </h2>
              {data.current && (
                <p className="section-meta">
                  validité : {data.current.time} · durée : {formatDuration(data.current.intervalSeconds)} · récupéré le{' '}
                  {formatUtcInOffset(data.fetchedAt, data.utcOffsetSeconds)}
                </p>
              )}
            </div>

            <div className="hero">
              <div className="hero-main">
                <span className="hero-icon" aria-hidden="true">
                  {weatherGlyph(data.current?.weatherCode)}
                </span>
                <div>
                  <p className="hero-temp">
                    {withUnit(data.current?.temperature, data.units.current['temperature_2m'] ?? '°C')}
                  </p>
                  <p className="hero-desc">{describeWeatherCode(data.current?.weatherCode)}</p>
                  <p className="hero-sub">
                    Code WMO {data.current?.weatherCode ?? MISSING_VALUE}
                    {today &&
                      ` · aujourd’hui max ${formatNumber(today.temperatureMax)}° / min ${formatNumber(
                        today.temperatureMin,
                      )}° · cumul ${formatNumber(today.precipitationSum)} ${precipUnit}`}
                  </p>
                </div>
              </div>

              <div className="hero-metrics">
                <div className="metric">
                  <span className="metric-label">Ressenti</span>
                  <span className="metric-value">
                    {withUnit(data.current?.apparentTemperature, data.units.current['apparent_temperature'] ?? '°C')}
                  </span>
                  <span className="metric-detail">température perçue</span>
                </div>
                <div className="metric">
                  <span className="metric-label">Humidité</span>
                  <span className="metric-value">
                    {withUnit(data.current?.humidity, data.units.current['relative_humidity_2m'] ?? '%', 0)}
                  </span>
                  <span className="metric-detail">humidité relative</span>
                </div>
                <div className="metric">
                  <span className="metric-label">Vent</span>
                  <span className="metric-value">
                    {withUnit(data.current?.windSpeed, data.units.current['wind_speed_10m'] ?? 'km/h')}
                  </span>
                  <span className="metric-detail">vitesse à 10 m</span>
                </div>
                <div className="metric">
                  <span className="metric-label">Précipitations</span>
                  <span className="metric-value">
                    {withUnit(data.current?.precipitation, data.units.current['precipitation'] ?? 'mm')}
                  </span>
                  <span className="metric-detail">sur l’intervalle courant</span>
                </div>
              </div>
            </div>
          </section>

          <div className="chart-grid">
          {/* Graphique 48 h */}
          {(() => {
            const now = data.current?.time ?? new Date().toISOString().slice(0, 16);
            const upcoming = data.hourly.filter((h) => h.time >= now).slice(0, 48);
            if (upcoming.length === 0) return null;

            const altRows = upcoming.map((h) => ({
              heure: h.time,
              temp: formatNumber(h.temperature),
              humidite: formatNumber(h.humidity, 0),
              vent: formatNumber(h.windSpeed),
            }));

            return (
              <ChartPanel
                title="Température — 48 prochaines heures"
                description={`Heures locales (${data.timezone}). Unité : ${data.units.hourly['temperature_2m'] ?? '°C'}.`}
                ariaLabel="Courbe de température sur les 48 prochaines heures"
                altTable={
                  <table>
                    <thead>
                      <tr>
                        <th>Heure</th>
                        <th className="num">Temp.</th>
                        <th className="num">Humidité</th>
                        <th className="num">Vent</th>
                      </tr>
                    </thead>
                    <tbody>
                      {altRows.map((row) => (
                        <tr key={row.heure}>
                          <td>{formatFRHour(row.heure)}</td>
                          <td className="num">{row.temp}</td>
                          <td className="num">{row.humidite}</td>
                          <td className="num">{row.vent}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                }
              >
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={upcoming} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis
                      dataKey="time"
                      tickFormatter={formatFRHour}
                      tick={{ fontSize: 11 }}
                      interval="preserveStartEnd"
                    />
                    <YAxis
                      tick={{ fontSize: 11 }}
                      unit={` ${data.units.hourly['temperature_2m'] ?? '°C'}`}
                      width={52}
                    />
                    <Tooltip content={<HourlyTooltip />} />
                    <Line
                      type="monotone"
                      dataKey="temperature"
                      name="Température"
                      stroke="#ef4444"
                      strokeWidth={2}
                      dot={false}
                      connectNulls={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </ChartPanel>
            );
          })()}

          {/* Histogramme précipitations 48 h */}
          {(() => {
            const now = data.current?.time ?? new Date().toISOString().slice(0, 16);
            const upcoming = data.hourly.filter((h) => h.time >= now).slice(0, 48);
            const hasData = upcoming.some((h) => h.precipitation !== null);
            if (!hasData) return null;
            return (
              <ChartPanel
                title="Précipitations horaires — 48 prochaines heures"
                description={`Unité : ${data.units.hourly['precipitation'] ?? 'mm'}.`}
                ariaLabel="Histogramme des précipitations sur les 48 prochaines heures"
              >
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={upcoming} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis
                      dataKey="time"
                      tickFormatter={formatFRHour}
                      tick={{ fontSize: 11 }}
                      interval="preserveStartEnd"
                    />
                    <YAxis tick={{ fontSize: 11 }} unit=" mm" width={44} />
                    <Tooltip content={<PrecipTooltip />} />
                    <Bar dataKey="precipitation" name="Précipitations" fill="#0ea5e9" radius={[2, 2, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartPanel>
            );
          })()}

          </div>

          {/* Tableau 7 jours */}
          <section aria-labelledby="daily-heading">
            <h2 id="daily-heading" className="section-title">
              Prévisions — 7 jours
            </h2>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Jour</th>
                    <th className="num">Moy. ({data.units.daily['temperature_2m_mean'] ?? '°C'})</th>
                    <th className="num">Max ({data.units.daily['temperature_2m_max'] ?? '°C'})</th>
                    <th className="num">Min ({data.units.daily['temperature_2m_min'] ?? '°C'})</th>
                    <th className="range-cell">Amplitude</th>
                    <th className="num">Préc. ({data.units.daily['precipitation_sum'] ?? 'mm'})</th>
                  </tr>
                </thead>
                <tbody>
                  {data.daily.map((day, index) => {
                    const bar = rangeStyle(day.temperatureMin, day.temperatureMax, weekMin, weekMax);
                    return (
                      <tr key={day.date} className={index === 0 ? 'today' : undefined}>
                        <td>{day.date}</td>
                        <td style={{ textTransform: 'capitalize' }}>{formatFRWeekday(day.date)}</td>
                        <td className="num">{formatNumber(day.temperatureMean)}</td>
                        <td className="num temp-max">{formatNumber(day.temperatureMax)}</td>
                        <td className="num temp-min">{formatNumber(day.temperatureMin)}</td>
                        <td className="range-cell">
                          {bar ? (
                            <span
                              className="range"
                              role="img"
                              aria-label={`${formatNumber(day.temperatureMin)}° à ${formatNumber(
                                day.temperatureMax,
                              )}°`}
                            >
                              <span className="range-fill" style={bar} />
                            </span>
                          ) : (
                            <span className="missing">{MISSING_VALUE}</span>
                          )}
                        </td>
                        <td className={`num ${day.precipitationSum === null ? 'missing' : ''}`}>
                          {formatNumber(day.precipitationSum)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <p style={{ fontSize: '0.78rem', color: 'var(--color-text-subtle)', marginTop: '0.5rem' }}>
            Conditions issues de modèles météorologiques. Actualisation automatique toutes les {refreshMinutes} minutes lorsque la page est visible.
          </p>
        </>
      )}

      <DashboardAnalysis coordinates={coordinates} />
    </>
  );
}
