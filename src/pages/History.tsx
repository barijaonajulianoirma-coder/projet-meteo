import { useEffect, useRef, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { TooltipProps } from 'recharts';
import {
  formatFRDate,
  formatFRMonth,
} from '../../shared/dates.js';
import {
  aggregateAnnual,
  aggregateMonthly,
  computePeriodStatistics,
  movingAverage7,
  type Aggregation,
  type AggregateRow,
} from '../../shared/stats.js';
import type { DailyPoint } from '../../shared/types.js';
import { toCsv, type CsvColumn } from '../../shared/csv.js';
import { downloadSvgAsPng, downloadTextFile } from '../lib/download.js';
import { useCoordinates } from '../coordinates.js';
import { useHistory } from '../hooks/useHistory.js';
import {
  ChartPanel,
  EmptyState,
  ErrorMessage,
  Loading,
  PageHeader,
} from '../components/ui.js';
import { formatNumber, MISSING_VALUE } from '../lib/format.js';
import { HISTORY_SOURCE } from '../../shared/sources.js';

const PAGE_SIZE = 50;

type VariableFilter = 'all' | 'temperature' | 'precipitation';

function todayMinus6(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 6);
  return d.toISOString().slice(0, 10);
}

function AggTooltip({ active, payload, label }: TooltipProps<number, string>): JSX.Element | null {
  if (!active || !payload?.length) return null;
  return (
    <div className="custom-tooltip">
      <div className="tooltip-label">{label as string}</div>
      {payload.map((e) => (
        <div key={e.dataKey as string} style={{ color: e.color }}>
          {e.name} : {typeof e.value === 'number' ? formatNumber(e.value) : MISSING_VALUE}
        </div>
      ))}
    </div>
  );
}

export function History(): JSX.Element {
  const { coordinates } = useCoordinates();
  const { state, load, cancel, reset } = useHistory();

  const [startDate, setStartDate] = useState('2000-01-01');
  const [endDate, setEndDate] = useState('2020-12-31');
  const [aggregation, setAggregation] = useState<Aggregation>('monthly');
  const [variable, setVariable] = useState<VariableFilter>('all');
  const [page, setPage] = useState(1);

  const tempChartRef = useRef<HTMLDivElement>(null);
  const precipChartRef = useRef<HTMLDivElement>(null);

  // Les données chargées concernent une localisation précise : changer de lieu
  // les invalide plutôt que d'afficher l'ancienne ville sous le nouveau choix.
  useEffect(() => {
    reset();
  }, [coordinates.latitude, coordinates.longitude, reset]);

  const { data, loading, error } = state;

  function handleLoad(): void {
    setPage(1);
    load(coordinates, startDate, endDate);
  }

  function handleCancel(): void {
    cancel();
  }

  function setPreset2000_2020(): void {
    setStartDate('2000-01-01');
    setEndDate('2020-12-31');
  }

  // Données filtrées selon l'agrégation
  const range = data ? { start: data.daily[0]?.date ?? startDate, end: data.daily[data.daily.length - 1]?.date ?? endDate } : undefined;
  // Période réellement chargée : les exports ne doivent pas annoncer des dates
  // saisies dans le formulaire mais jamais chargées.
  const loadedRange = range ?? { start: startDate, end: endDate };
  const loadedPeriodLabel = `${loadedRange.start} → ${loadedRange.end}`;

  const displayRows: (DailyPoint & { ma7?: number | null })[] | AggregateRow[] = (() => {
    if (!data) return [];
    if (aggregation === 'daily') {
      const ma7 = movingAverage7(data.daily);
      return data.daily.map((d, i) => ({ ...d, ma7: ma7[i] ?? null }));
    }
    if (aggregation === 'monthly') return aggregateMonthly(data.daily, range);
    return aggregateAnnual(data.daily, range);
  })();

  const stats = data ? computePeriodStatistics(data.daily) : null;

  // Pagination du tableau
  const totalPages = Math.max(1, Math.ceil(displayRows.length / PAGE_SIZE));
  const pageRows = displayRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // Export CSV
  function exportCsv(): void {
    if (!data) return;
    const cols: CsvColumn<DailyPoint>[] = [{ header: 'Date', value: (r) => r.date }];
    if (variable !== 'precipitation') {
      cols.push(
        { header: `Temp. moy. (${data.units['temperature_2m_mean'] ?? '°C'})`, value: (r) => r.temperatureMean },
        { header: `Temp. max. (${data.units['temperature_2m_max'] ?? '°C'})`, value: (r) => r.temperatureMax },
        { header: `Temp. min. (${data.units['temperature_2m_min'] ?? '°C'})`, value: (r) => r.temperatureMin },
      );
    }
    if (variable !== 'temperature') {
      cols.push({ header: `Préc. (${data.units['precipitation_sum'] ?? 'mm'})`, value: (r) => r.precipitationSum });
    }
    const csv = toCsv(data.daily, cols);
    downloadTextFile(
      csv,
      `historique_${data.latitude}_${data.longitude}_${loadedRange.start}_${loadedRange.end}.csv`,
      'text/csv',
    );
  }

  // Export JSON
  function exportJson(): void {
    if (!data) return;
    const meta = {
      provenance: HISTORY_SOURCE.name,
      modele: data.model,
      fuseau: data.timezone,
      periode: `${loadedRange.start}/${loadedRange.end}`,
      variable,
      agregation: aggregation,
      recupere_le: data.fetchedAt,
      coordonnees: { latitude: data.latitude, longitude: data.longitude },
      attribution: data.source.attribution,
    };
    const content = JSON.stringify({ meta, donnees: data.daily }, null, 2);
    downloadTextFile(
      content,
      `historique_${data.latitude}_${data.longitude}_${loadedRange.start}_${loadedRange.end}.json`,
      'application/json',
    );
  }

  // Export PNG du graphique températures
  async function exportPngTemp(): Promise<void> {
    const container = tempChartRef.current;
    if (!container) return;
    const svg = container.querySelector('svg');
    if (!svg) return;
    await downloadSvgAsPng(svg, `temperatures_${startDate}_${endDate}.png`);
  }

  async function exportPngPrecip(): Promise<void> {
    const container = precipChartRef.current;
    if (!container) return;
    const svg = container.querySelector('svg');
    if (!svg) return;
    await downloadSvgAsPng(svg, `precipitations_${startDate}_${endDate}.png`);
  }

  return (
    <>
      <PageHeader
        title="Analyse historique"
        intro="Réanalyse ERA5 — données journalières Open-Meteo. Pas des mesures directes d'une station."
      />

      {/* Panneau de filtres */}
      <div className="filters-panel">
        <div className="filters-row">
          <div className="field">
            <label htmlFor="hist-start">Début</label>
            <input
              id="hist-start"
              type="date"
              min="1940-01-01"
              max={todayMinus6()}
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="hist-end">Fin</label>
            <input
              id="hist-end"
              type="date"
              min="1940-01-01"
              max={todayMinus6()}
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="hist-agg">Agrégation</label>
            <select
              id="hist-agg"
              value={aggregation}
              onChange={(e) => {
                setAggregation(e.target.value as Aggregation);
                setPage(1);
              }}
            >
              <option value="daily">Journalier</option>
              <option value="monthly">Mensuel</option>
              <option value="annual">Annuel</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="hist-variable">Variable</label>
            <select
              id="hist-variable"
              value={variable}
              onChange={(e) => {
                setVariable(e.target.value as VariableFilter);
                setPage(1);
              }}
            >
              <option value="all">Toutes</option>
              <option value="temperature">Température</option>
              <option value="precipitation">Précipitations</option>
            </select>
          </div>
        </div>
        <div className="filters-actions">
          <button type="button" className="button button-primary" onClick={handleLoad} disabled={loading}>
            {loading ? 'Chargement…' : 'Charger'}
          </button>
          {loading && (
            <button type="button" className="button button-secondary" onClick={handleCancel}>
              Annuler
            </button>
          )}
          <button type="button" className="button button-ghost" onClick={setPreset2000_2020} disabled={loading}>
            2000–2020
          </button>
          {data && (
            <>
              <button type="button" className="button button-ghost" onClick={exportCsv} title="Exporter en CSV">
                ↓ CSV
              </button>
              <button type="button" className="button button-ghost" onClick={exportJson} title="Exporter en JSON">
                ↓ JSON
              </button>
            </>
          )}
        </div>
      </div>

      {error && <ErrorMessage message="Erreur lors du chargement" reason={error} onRetry={handleLoad} />}
      {loading && <Loading label="Chargement de l'archive ERA5…" />}

      {!data && !loading && !error && (
        <EmptyState title="Aucune donnée chargée">
          <p>Choisissez une période et cliquez sur Charger.</p>
        </EmptyState>
      )}

      {data && !loading && (
        <>
          {/* Couverture */}
          <div className="coverage-block" role="status">
            <span>Jours attendus : {data.expectedDays}</span>
            <span>Disponibles : {data.availableDays}</span>
            <span>
              Manquants : {data.missingDays.length}
              {data.missingDays.length > 0 && ' ⚠'}
            </span>
            {data.duplicateDays.length > 0 && (
              <span>Doublons fusionnés : {data.duplicateDays.length}</span>
            )}
          </div>

          {/* Statistiques sur la période */}
          {stats && (
            <>
              <h2 className="section-title">Statistiques sur la période filtrée</h2>
              <div className="stats-grid">
                {variable !== 'precipitation' && (
                  <>
                <div className="stat-card">
                  <div className="stat-label">Temp. moy.</div>
                  <div className="stat-value" style={{ color: 'var(--color-temp-mean)' }}>
                    {formatNumber(stats.meanTemperature)} {data.units['temperature_2m_mean'] ?? '°C'}
                  </div>
                  <div className="coverage-badge">
                    {stats.availableTemperatureDays}/{stats.days} jours
                  </div>
                </div>
                <div className="stat-card">
                  <div className="stat-label">Temp. max.</div>
                  <div className="stat-value" style={{ color: 'var(--color-temp-max)' }}>
                    {formatNumber(stats.maxTemperature)} {data.units['temperature_2m_max'] ?? '°C'}
                  </div>
                </div>
                <div className="stat-card">
                  <div className="stat-label">Temp. min.</div>
                  <div className="stat-value" style={{ color: 'var(--color-temp-min)' }}>
                    {formatNumber(stats.minTemperature)} {data.units['temperature_2m_min'] ?? '°C'}
                  </div>
                </div>
                  </>
                )}
                {variable !== 'temperature' && (
                  <>
                <div className="stat-card">
                  <div className="stat-label">Cumul préc.</div>
                  <div className="stat-value" style={{ color: 'var(--color-precip)' }}>
                    {formatNumber(stats.precipitationTotal)} {data.units['precipitation_sum'] ?? 'mm'}
                  </div>
                  {stats.precipitationIncomplete && (
                    <div className="stat-note">⚠ Cumul incomplet</div>
                  )}
                  <div className="coverage-badge">
                    {stats.availablePrecipitationDays}/{stats.days} jours
                  </div>
                </div>
                <div className="stat-card">
                  <div className="stat-label">Jours pluvieux (≥ 1 mm)</div>
                  <div className="stat-value">{stats.wetDays ?? MISSING_VALUE}</div>
                  {stats.wetDaysIncomplete && (
                    <div className="stat-note">⚠ Incomplet</div>
                  )}
                </div>
                  </>
                )}
              </div>
            </>
          )}

          {/* Graphique températures */}
          {variable !== 'precipitation' && (() => {
            const chartData =
              aggregation === 'daily'
                ? (displayRows as (DailyPoint & { ma7?: number | null })[])
                : (displayRows as AggregateRow[]).map((r) => ({
                    ...r,
                    date: r.key,
                    temperatureMean: r.temperatureMean,
                    temperatureMax: r.temperatureMax,
                    temperatureMin: r.temperatureMin,
                  }));

            if (chartData.length === 0) return null;

            const xKey = aggregation === 'daily' ? 'date' : 'key';
            const xFormatter =
              aggregation === 'daily'
                ? formatFRDate
                : aggregation === 'monthly'
                  ? formatFRMonth
                  : (k: string) => k;

            return (
              <ChartPanel
                title={`Températures — ${aggregation === 'daily' ? 'journalier' : aggregation === 'monthly' ? 'mensuel' : 'annuel'}`}
                description={`${loadedPeriodLabel} · ERA5 · ${data.timezone}`}
                ariaLabel="Courbe des températures historiques"
                actions={
                  <button type="button" className="button button-ghost" onClick={() => void exportPngTemp()}>
                    ↓ PNG
                  </button>
                }
                chartRef={tempChartRef}
              >
                <ResponsiveContainer width="100%" height={280}>
                  <LineChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis
                      dataKey={xKey}
                      tickFormatter={xFormatter}
                      tick={{ fontSize: 11 }}
                      interval="preserveStartEnd"
                    />
                    <YAxis
                      tick={{ fontSize: 11 }}
                      unit={` ${data.units['temperature_2m_mean'] ?? '°C'}`}
                      width={52}
                    />
                    <Legend iconType="line" wrapperStyle={{ fontSize: '0.78rem' }} />
                    <Tooltip content={<AggTooltip />} />
                    <Line
                      type="monotone"
                      dataKey="temperatureMax"
                      name={`Max (${data.units['temperature_2m_max'] ?? '°C'})`}
                      stroke="#f97316"
                      strokeWidth={1.5}
                      dot={false}
                      connectNulls={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="temperatureMean"
                      name={`Moy. (${data.units['temperature_2m_mean'] ?? '°C'})`}
                      stroke="#8b5cf6"
                      strokeWidth={2}
                      dot={false}
                      connectNulls={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="temperatureMin"
                      name={`Min (${data.units['temperature_2m_min'] ?? '°C'})`}
                      stroke="#3b82f6"
                      strokeWidth={1.5}
                      dot={false}
                      connectNulls={false}
                    />
                    {aggregation === 'daily' && (
                      <Line
                        type="monotone"
                        dataKey="ma7"
                        name="Moy. mobile 7 j"
                        stroke="#16a34a"
                        strokeWidth={2}
                        dot={false}
                        strokeDasharray="5 2"
                        connectNulls={false}
                      />
                    )}
                  </LineChart>
                </ResponsiveContainer>
              </ChartPanel>
            );
          })()}

          {/* Histogramme précipitations */}
          {variable !== 'temperature' && (() => {
            const chartData =
              aggregation === 'daily'
                ? (displayRows as DailyPoint[])
                : (displayRows as AggregateRow[]).map((r) => ({
                    ...r,
                    date: r.key,
                    precipitationSum: r.precipitationTotal,
                  }));

            if (chartData.length === 0) return null;

            const xKey = aggregation === 'daily' ? 'date' : 'key';
            const xFormatter =
              aggregation === 'daily'
                ? formatFRDate
                : aggregation === 'monthly'
                  ? formatFRMonth
                  : (k: string) => k;

            return (
              <ChartPanel
                title={`Précipitations — ${aggregation === 'daily' ? 'journalier' : aggregation === 'monthly' ? 'mensuel' : 'annuel'}`}
                description={`${loadedPeriodLabel} · ERA5. Unité : ${data.units['precipitation_sum'] ?? 'mm'}.`}
                ariaLabel="Histogramme des précipitations historiques"
                actions={
                  <button type="button" className="button button-ghost" onClick={() => void exportPngPrecip()}>
                    ↓ PNG
                  </button>
                }
                chartRef={precipChartRef}
              >
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis
                      dataKey={xKey}
                      tickFormatter={xFormatter}
                      tick={{ fontSize: 11 }}
                      interval="preserveStartEnd"
                    />
                    <YAxis
                      tick={{ fontSize: 11 }}
                      unit={` ${data.units['precipitation_sum'] ?? 'mm'}`}
                      width={52}
                    />
                    <Tooltip content={<AggTooltip />} />
                    <Bar
                      dataKey={aggregation === 'daily' ? 'precipitationSum' : 'precipitationTotal'}
                      name={`Préc. (${data.units['precipitation_sum'] ?? 'mm'})`}
                      fill="#0ea5e9"
                      radius={[2, 2, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </ChartPanel>
            );
          })()}

          {/* Tableau paginé */}
          <section aria-labelledby="hist-table-heading">
            <h2 id="hist-table-heading" className="section-title">
              Données tabulaires —{' '}
              {aggregation === 'daily' ? 'journalier' : aggregation === 'monthly' ? 'mensuel' : 'annuel'}
            </h2>
            <div className="table-wrap">
              {aggregation === 'daily' ? (
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      {variable !== 'precipitation' && (
                        <>
                          <th className="num">Moy. ({data.units['temperature_2m_mean'] ?? '°C'})</th>
                          <th className="num">Max ({data.units['temperature_2m_max'] ?? '°C'})</th>
                          <th className="num">Min ({data.units['temperature_2m_min'] ?? '°C'})</th>
                        </>
                      )}
                      {variable !== 'temperature' && (
                        <th className="num">Préc. ({data.units['precipitation_sum'] ?? 'mm'})</th>
                      )}
                      {variable !== 'precipitation' && <th className="num">Moy. mob. 7j</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {(pageRows as (DailyPoint & { ma7?: number | null })[]).map((row) => (
                      <tr key={row.date}>
                        <td>{row.date}</td>
                        {variable !== 'precipitation' && (
                          <>
                            <td className={`num ${row.temperatureMean === null ? 'missing' : ''}`}>
                              {formatNumber(row.temperatureMean)}
                            </td>
                            <td className={`num temp-max ${row.temperatureMax === null ? 'missing' : ''}`}>
                              {formatNumber(row.temperatureMax)}
                            </td>
                            <td className={`num temp-min ${row.temperatureMin === null ? 'missing' : ''}`}>
                              {formatNumber(row.temperatureMin)}
                            </td>
                          </>
                        )}
                        {variable !== 'temperature' && (
                          <td className={`num ${row.precipitationSum === null ? 'missing' : ''}`}>
                            {formatNumber(row.precipitationSum)}
                          </td>
                        )}
                        {variable !== 'precipitation' && (
                          <td className={`num ${row.ma7 === null || row.ma7 === undefined ? 'missing' : ''}`}>
                            {row.ma7 !== null && row.ma7 !== undefined ? formatNumber(row.ma7) : MISSING_VALUE}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>Période</th>
                      {variable !== 'precipitation' && (
                        <>
                          <th className="num">Moy. ({data.units['temperature_2m_mean'] ?? '°C'})</th>
                          <th className="num">Max ({data.units['temperature_2m_max'] ?? '°C'})</th>
                          <th className="num">Min ({data.units['temperature_2m_min'] ?? '°C'})</th>
                        </>
                      )}
                      {variable !== 'temperature' && (
                        <>
                          <th className="num">Préc. ({data.units['precipitation_sum'] ?? 'mm'})</th>
                          <th className="num">J pluvieux</th>
                        </>
                      )}
                      <th className="num">J disponibles</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(pageRows as AggregateRow[]).map((row) => (
                      <tr key={row.key}>
                        <td>
                          {aggregation === 'monthly' ? formatFRMonth(row.key) : row.key}
                        </td>
                        {variable !== 'precipitation' && (
                          <>
                            <td className={`num ${row.temperatureMean === null ? 'missing' : ''}`}>
                              {formatNumber(row.temperatureMean)}
                            </td>
                            <td className={`num temp-max ${row.temperatureMax === null ? 'missing' : ''}`}>
                              {formatNumber(row.temperatureMax)}
                            </td>
                            <td className={`num temp-min ${row.temperatureMin === null ? 'missing' : ''}`}>
                              {formatNumber(row.temperatureMin)}
                            </td>
                          </>
                        )}
                        {variable !== 'temperature' && (
                          <>
                            <td
                              className={`num ${row.precipitationTotal === null ? 'missing' : row.precipitationIncomplete ? 'incomplete' : ''}`}
                              title={row.precipitationIncomplete ? 'Cumul incomplet (jours manquants)' : undefined}
                            >
                              {formatNumber(row.precipitationTotal)}
                              {row.precipitationIncomplete && ' *'}
                            </td>
                            <td className={`num ${row.wetDays === null ? 'missing' : ''}`}>
                              {row.wetDays ?? MISSING_VALUE}
                            </td>
                          </>
                        )}
                        <td className="num">
                          {row.days}/{row.expectedDays}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {totalPages > 1 && (
                <div className="pagination">
                  <button
                    type="button"
                    className="button button-ghost"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >
                    ← Préc.
                  </button>
                  <span>
                    Page {page} / {totalPages}
                  </span>
                  <button
                    type="button"
                    className="button button-ghost"
                    disabled={page >= totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  >
                    Suiv. →
                  </button>
                </div>
              )}
            </div>
            {aggregation !== 'daily' && variable !== 'temperature' && (
              <p style={{ fontSize: '0.75rem', color: 'var(--color-warning)', marginTop: '0.3rem' }}>
                * Cumul de précipitations incomplet : jours manquants dans la période.
              </p>
            )}
          </section>

          {/* Statuts des périodes en erreur */}
          {data.periods.some((p) => p.status === 'error') && (
            <div style={{ marginTop: '1rem' }}>
              <ErrorMessage
                message="Certaines périodes n'ont pas pu être chargées"
                reason={data.periods
                  .filter((p) => p.status === 'error')
                  .map((p) => `${p.start} → ${p.end} : ${p.message ?? 'Indisponible'}`)
                  .join(' | ')}
                variant="warning"
              />
            </div>
          )}

          <p style={{ fontSize: '0.78rem', color: 'var(--color-text-subtle)', marginTop: '0.5rem' }}>
            Réanalyse historique ERA5 — via Open-Meteo. Données récupérées le{' '}
            {new Date(data.fetchedAt).toLocaleString('fr-FR')} UTC.
            {data.source.attribution}
          </p>
        </>
      )}
    </>
  );
}
