import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { TooltipProps } from 'recharts';
import { formatFRHour, formatFRWeekday } from '../../shared/dates.js';
import { describeWeatherCode } from '../../shared/weatherCodes.js';
import { useCoordinates } from '../coordinates.js';
import { useWeather, AUTO_REFRESH_MS } from '../hooks/useWeather.js';
import { DashboardAnalysis } from '../components/DashboardAnalysis.js';
import {
  AreaGradient,
  BarGradient,
  CHART,
  ChartTooltip,
  buildHistogram,
  chartAxis,
  chartGrid,
  chartLegend,
} from '../components/charts.js';
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

/** Infobulle de l'amplitude quotidienne : lit la ligne source, pas les séries empilées. */
function DailyRangeTooltip({ active, payload }: TooltipProps<number, string>): JSX.Element | null {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload as
    | { date: string; min: number | null; max: number | null; mean: number | null }
    | undefined;
  if (!row) return null;
  return (
    <div className="custom-tooltip chart-tooltip">
      <p className="tooltip-label">{row.date}</p>
      <ul className="tooltip-rows">
        <li>
          <span className="tooltip-dot" style={{ background: CHART.tempMax }} aria-hidden="true" />
          <span className="tooltip-name">Maximum</span>
          <span className="tooltip-value">{withUnit(row.max, '°C')}</span>
        </li>
        <li>
          <span className="tooltip-dot" style={{ background: CHART.tempMean }} aria-hidden="true" />
          <span className="tooltip-name">Moyenne</span>
          <span className="tooltip-value">{withUnit(row.mean, '°C')}</span>
        </li>
        <li>
          <span className="tooltip-dot" style={{ background: CHART.tempMin }} aria-hidden="true" />
          <span className="tooltip-name">Minimum</span>
          <span className="tooltip-value">{withUnit(row.min, '°C')}</span>
        </li>
      </ul>
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

  // Les graphiques horaires partent de l'heure courante renvoyée par l'API.
  const nowRef = data?.current?.time ?? new Date().toISOString().slice(0, 16);
  const upcoming = data ? data.hourly.filter((hour) => hour.time >= nowRef).slice(0, 48) : [];
  const hourlyTempUnit = data?.units.hourly['temperature_2m'] ?? '°C';
  const hourlyPrecipUnit = data?.units.hourly['precipitation'] ?? 'mm';
  const dailyTempUnit = data?.units.daily['temperature_2m_max'] ?? '°C';
  const tempBins = buildHistogram(
    upcoming.map((hour) => hour.temperature),
    8,
    0,
  );
  const dailyRows = (data?.daily ?? []).map((day) => ({
    date: day.date,
    label: `${formatFRWeekday(day.date).slice(0, 3)} ${day.date.slice(8, 10)}`,
    min: day.temperatureMin,
    max: day.temperatureMax,
    mean: day.temperatureMean,
    range:
      day.temperatureMin !== null && day.temperatureMax !== null
        ? Math.max(day.temperatureMax - day.temperatureMin, 0)
        : null,
  }));

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
          {/* Courbe 48 h */}
          {upcoming.length > 0 && (
            <ChartPanel
              title="Température — 48 prochaines heures"
              description={`Heures locales (${data.timezone}). Unité : ${hourlyTempUnit}.`}
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
                    {upcoming.map((hour) => (
                      <tr key={hour.time}>
                        <td>{formatFRHour(hour.time)}</td>
                        <td className="num">{formatNumber(hour.temperature)}</td>
                        <td className="num">{formatNumber(hour.humidity, 0)}</td>
                        <td className="num">{formatNumber(hour.windSpeed)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              }
            >
              <ResponsiveContainer width="100%" height={260}>
                <AreaChart data={upcoming} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                  <AreaGradient id="grad-hourly-temp" color={CHART.temperature} />
                  <CartesianGrid {...chartGrid} />
                  <XAxis
                    dataKey="time"
                    tickFormatter={formatFRHour}
                    interval="preserveStartEnd"
                    {...chartAxis}
                  />
                  <YAxis unit={` ${hourlyTempUnit}`} width={56} domain={['auto', 'auto']} {...chartAxis} />
                  <Tooltip
                    content={<ChartTooltip labelFormatter={formatFRHour} />}
                    cursor={{ stroke: CHART.grid, strokeWidth: 1 }}
                  />
                  <Area
                    type="monotone"
                    dataKey="temperature"
                    name="Température"
                    unit={` ${hourlyTempUnit}`}
                    stroke={CHART.temperature}
                    strokeWidth={2}
                    fill="url(#grad-hourly-temp)"
                    activeDot={{ r: 4, strokeWidth: 0 }}
                    connectNulls={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </ChartPanel>
          )}

          {/* Histogramme précipitations 48 h */}
          {upcoming.some((hour) => hour.precipitation !== null) && (
            <ChartPanel
              title="Précipitations horaires — 48 prochaines heures"
              description={`Cumul horaire (${hourlyPrecipUnit}) et probabilité de précipitation.`}
              ariaLabel="Histogramme des précipitations sur les 48 prochaines heures"
            >
              <ResponsiveContainer width="100%" height={260}>
                <ComposedChart data={upcoming} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <BarGradient id="grad-hourly-precip" color={CHART.precip} />
                  <CartesianGrid {...chartGrid} />
                  <XAxis
                    dataKey="time"
                    tickFormatter={formatFRHour}
                    interval="preserveStartEnd"
                    {...chartAxis}
                  />
                  <YAxis
                    yAxisId="rain"
                    unit={` ${hourlyPrecipUnit}`}
                    width={52}
                    allowDecimals={false}
                    {...chartAxis}
                  />
                  <YAxis
                    yAxisId="prob"
                    orientation="right"
                    unit=" %"
                    width={44}
                    domain={[0, 100]}
                    {...chartAxis}
                  />
                  <Tooltip
                    content={<ChartTooltip labelFormatter={formatFRHour} />}
                    cursor={{ fill: 'rgba(148, 163, 184, 0.08)' }}
                  />
                  <Legend {...chartLegend} />
                  <Bar
                    yAxisId="rain"
                    dataKey="precipitation"
                    name={`Cumul (${hourlyPrecipUnit})`}
                    unit={` ${hourlyPrecipUnit}`}
                    fill="url(#grad-hourly-precip)"
                    radius={[4, 4, 0, 0]}
                    maxBarSize={20}
                  />
                  <Line
                    yAxisId="prob"
                    type="monotone"
                    dataKey="precipitationProbability"
                    name="Probabilité"
                    unit=" %"
                    stroke={CHART.probability}
                    strokeWidth={1.5}
                    dot={false}
                    connectNulls={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </ChartPanel>
          )}

          {/* Distribution des températures horaires */}
          {tempBins.length > 0 && (
            <ChartPanel
              title="Distribution des températures — 48 prochaines heures"
              description="Nombre d’heures par classe de température (classes de largeur égale)."
              ariaLabel="Histogramme de distribution des températures horaires"
              altTable={
                <table>
                  <thead>
                    <tr>
                      <th>Classe ({hourlyTempUnit})</th>
                      <th className="num">Heures</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tempBins.map((bin) => (
                      <tr key={bin.key}>
                        <td>{bin.label}</td>
                        <td className="num">{formatNumber(bin.count, 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              }
            >
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={tempBins} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                  <BarGradient id="grad-temp-hist" color={CHART.tempMean} />
                  <CartesianGrid {...chartGrid} />
                  <XAxis
                    dataKey="label"
                    interval={0}
                    tick={{ fontSize: 10, fill: CHART.axis }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis width={40} allowDecimals={false} unit=" h" {...chartAxis} />
                  <Tooltip
                    content={<ChartTooltip labelFormatter={(label) => `${label} ${hourlyTempUnit}`} />}
                    cursor={{ fill: 'rgba(148, 163, 184, 0.08)' }}
                  />
                  <Bar
                    dataKey="count"
                    name="Heures"
                    unit=" h"
                    fill="url(#grad-temp-hist)"
                    radius={[3, 3, 0, 0]}
                    maxBarSize={44}
                  />
                </BarChart>
              </ResponsiveContainer>
            </ChartPanel>
          )}

          </div>

          {/* Amplitude thermique 7 jours */}
          {dailyRows.length > 0 && (
            <ChartPanel
              title="Amplitude thermique — 7 jours"
              description={`Bande des minimales et maximales quotidiennes, avec la moyenne (${dailyTempUnit}).`}
              ariaLabel="Amplitude des températures minimales et maximales sur sept jours"
              altTable={
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th className="num">Min</th>
                      <th className="num">Moy.</th>
                      <th className="num">Max</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dailyRows.map((row) => (
                      <tr key={row.date}>
                        <td>{row.date}</td>
                        <td className="num">{formatNumber(row.min)}</td>
                        <td className="num">{formatNumber(row.mean)}</td>
                        <td className="num">{formatNumber(row.max)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              }
            >
              <ResponsiveContainer width="100%" height={240}>
                <ComposedChart data={dailyRows} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                  <AreaGradient id="grad-daily-range" color={CHART.tempMin} from={0.3} to={0.06} />
                  <CartesianGrid {...chartGrid} />
                  <XAxis dataKey="label" {...chartAxis} />
                  <YAxis
                    unit={` ${dailyTempUnit}`}
                    width={56}
                    domain={['dataMin - 2', 'dataMax + 2']}
                    {...chartAxis}
                  />
                  <Tooltip content={<DailyRangeTooltip />} cursor={{ stroke: CHART.grid }} />
                  <Area
                    type="monotone"
                    dataKey="min"
                    stackId="range"
                    stroke="none"
                    fill="transparent"
                    isAnimationActive={false}
                  />
                  <Area
                    type="monotone"
                    dataKey="range"
                    stackId="range"
                    stroke="none"
                    fill="url(#grad-daily-range)"
                    isAnimationActive={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="mean"
                    name="Moyenne"
                    unit={` ${dailyTempUnit}`}
                    stroke={CHART.tempMean}
                    strokeWidth={2}
                    dot={{ r: 3, strokeWidth: 0, fill: CHART.tempMean }}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </ChartPanel>
          )}

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
