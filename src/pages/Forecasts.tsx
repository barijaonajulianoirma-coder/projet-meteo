import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Legend,
} from 'recharts';
import type { TooltipProps } from 'recharts';
import type { HourlyPoint } from '../../shared/types.js';
import { formatFRHour, formatFRWeekday } from '../../shared/dates.js';
import { useCoordinates } from '../coordinates.js';
import { useWeather } from '../hooks/useWeather.js';
import {
  ChartPanel,
  EmptyState,
  ErrorMessage,
  Loading,
  PageHeader,
} from '../components/ui.js';
import { formatNumber, formatOffset } from '../lib/format.js';

function MultilineTooltip({ active, payload, label }: TooltipProps<number, string>): JSX.Element | null {
  if (!active || !payload?.length) return null;
  return (
    <div className="custom-tooltip">
      <div className="tooltip-label">{formatFRHour(label as string)}</div>
      {payload.map((entry) => (
        <div key={entry.dataKey as string} style={{ color: entry.color }}>
          {entry.name} : {typeof entry.value === 'number' ? formatNumber(entry.value) : '—'}
        </div>
      ))}
    </div>
  );
}

export function Forecasts(): JSX.Element {
  const { coordinates } = useCoordinates();
  const { state, refresh } = useWeather(coordinates);
  const { data, loading, error, stale } = state;

  if (loading && !data) {
    return <Loading label="Chargement des prévisions…" />;
  }

  return (
    <>
      <PageHeader
        title="Prévisions — 7 jours"
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
          {/* Cartes journalières */}
          <section aria-labelledby="daily-cards-heading">
            <h2 id="daily-cards-heading" className="section-title">
              Résumé journalier
            </h2>
            <div className="daily-cards">
              {data.daily.map((day) => (
                <div key={day.date} className="daily-card">
                  <div className="daily-card-day">{formatFRWeekday(day.date)}</div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>{day.date}</div>
                  <div className="daily-card-temps">
                    <span className="temp-max">{formatNumber(day.temperatureMax)}°</span>
                    <span className="temp-min">{formatNumber(day.temperatureMin)}°</span>
                  </div>
                  <div className="daily-card-precip">
                    {day.precipitationSum !== null ? `${formatNumber(day.precipitationSum)} mm` : '— mm'}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Courbe températures 7 jours */}
          {(() => {
            const now = data.current?.time ?? new Date().toISOString().slice(0, 16);
            const upcoming = data.hourly.filter((h) => h.time >= now);
            if (upcoming.length === 0) return null;

            return (
              <ChartPanel
                title="Températures horaires — 7 jours"
                description={`Heures locales (${data.timezone}). Unité : ${data.units.hourly['temperature_2m'] ?? '°C'}.`}
                ariaLabel="Courbe des températures horaires sur 7 jours"
              >
                <ResponsiveContainer width="100%" height={280}>
                  <LineChart data={upcoming} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis
                      dataKey="time"
                      tickFormatter={formatFRHour}
                      tick={{ fontSize: 11 }}
                      interval={23}
                    />
                    <YAxis
                      tick={{ fontSize: 11 }}
                      unit={` ${data.units.hourly['temperature_2m'] ?? '°C'}`}
                      width={52}
                    />
                    <Tooltip content={<MultilineTooltip />} />
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

          {/* Courbe humidité + vent */}
          {(() => {
            const now = data.current?.time ?? new Date().toISOString().slice(0, 16);
            const upcoming = data.hourly.filter((h) => h.time >= now);
            if (upcoming.length === 0) return null;
            return (
              <ChartPanel
                title="Humidité et vent — 7 jours"
                description={`Heures locales. Humidité en ${data.units.hourly['relative_humidity_2m'] ?? '%'}, vent en ${data.units.hourly['wind_speed_10m'] ?? 'km/h'}.`}
                ariaLabel="Courbe humidité et vitesse du vent"
              >
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={upcoming} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis
                      dataKey="time"
                      tickFormatter={formatFRHour}
                      tick={{ fontSize: 11 }}
                      interval={23}
                    />
                    <YAxis tick={{ fontSize: 11 }} width={40} />
                    <Legend iconType="line" wrapperStyle={{ fontSize: '0.78rem' }} />
                    <Tooltip content={<MultilineTooltip />} />
                    <Line
                      type="monotone"
                      dataKey="humidity"
                      name={`Humidité (${data.units.hourly['relative_humidity_2m'] ?? '%'})`}
                      stroke="#06b6d4"
                      strokeWidth={1.5}
                      dot={false}
                      connectNulls={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="windSpeed"
                      name={`Vent (${data.units.hourly['wind_speed_10m'] ?? 'km/h'})`}
                      stroke="#64748b"
                      strokeWidth={1.5}
                      dot={false}
                      strokeDasharray="4 2"
                      connectNulls={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="precipitationProbability"
                      name="Prob. préc. (%)"
                      stroke="#10b981"
                      strokeWidth={1.5}
                      dot={false}
                      strokeDasharray="2 3"
                      connectNulls={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </ChartPanel>
            );
          })()}

          {/* Tableau détaillé */}
          <section aria-labelledby="hourly-table-heading">
            <h2 id="hourly-table-heading" className="section-title">
              Données horaires — 7 jours
            </h2>
            <div className="table-wrap" style={{ maxHeight: '400px', overflowY: 'auto' }}>
              <table>
                <thead>
                  <tr>
                    <th>Heure</th>
                    <th className="num">Temp. ({data.units.hourly['temperature_2m'] ?? '°C'})</th>
                    <th className="num">Hum. ({data.units.hourly['relative_humidity_2m'] ?? '%'})</th>
                    <th className="num">Prob. préc. (%)</th>
                    <th className="num">Préc. ({data.units.hourly['precipitation'] ?? 'mm'})</th>
                    <th className="num">Vent ({data.units.hourly['wind_speed_10m'] ?? 'km/h'})</th>
                  </tr>
                </thead>
                <tbody>
                  {data.hourly
                    .filter((h) => h.time >= (data.current?.time ?? ''))
                    .map((h: HourlyPoint) => (
                      <tr key={h.time}>
                        <td>{formatFRHour(h.time)}</td>
                        <td className="num">{formatNumber(h.temperature)}</td>
                        <td className="num">{formatNumber(h.humidity, 0)}</td>
                        <td className={`num ${h.precipitationProbability === null ? 'missing' : ''}`}>
                          {formatNumber(h.precipitationProbability, 0)}
                        </td>
                        <td className={`num ${h.precipitation === null ? 'missing' : ''}`}>
                          {formatNumber(h.precipitation)}
                        </td>
                        <td className="num">{formatNumber(h.windSpeed)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </section>

          <p style={{ fontSize: '0.78rem', color: 'var(--color-text-subtle)', marginTop: '0.5rem' }}>
            Conditions issues de modèles météorologiques.
          </p>
        </>
      )}
    </>
  );
}
