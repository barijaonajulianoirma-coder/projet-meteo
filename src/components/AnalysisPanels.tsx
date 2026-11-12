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
import type {
  AnalysisPayload,
  DescriptiveStats,
  OlsCoefficient,
} from '../../shared/types.js';
import { ChartPanel, IndicatorCard } from './ui.js';
import { formatNumber, formatPValue, MISSING_VALUE, withUnit } from '../lib/format.js';

function SimpleTooltip({ active, payload, label }: TooltipProps<number, string>): JSX.Element | null {
  if (!active || !payload?.length) return null;
  return (
    <div className="custom-tooltip">
      <div className="tooltip-label">{label as string}</div>
      {payload.map((entry) => (
        <div key={String(entry.dataKey)} style={{ color: entry.color }}>
          {entry.name} : {typeof entry.value === 'number' ? formatNumber(entry.value) : MISSING_VALUE}
        </div>
      ))}
    </div>
  );
}

function DescriptiveBlock({ stats }: { stats: DescriptiveStats }): JSX.Element {
  return (
    <div className="analysis-block">
      <h3 className="analysis-subtitle">{stats.label}</h3>
      <div className="indicators-grid">
        <IndicatorCard label="Effectif" value={formatNumber(stats.count, 0)} detail={`${formatNumber(stats.missing, 0)} manquant(s)`} />
        <IndicatorCard label="Moyenne" value={withUnit(stats.mean, stats.unit)} />
        <IndicatorCard label="Médiane" value={withUnit(stats.median, stats.unit)} />
        <IndicatorCard label="Écart-type" value={withUnit(stats.standardDeviation, stats.unit)} />
        <IndicatorCard label="Minimum" value={withUnit(stats.minimum, stats.unit)} />
        <IndicatorCard label="Maximum" value={withUnit(stats.maximum, stats.unit)} />
        <IndicatorCard label="Q1 / Q3" value={`${withUnit(stats.quartile1, stats.unit)} / ${withUnit(stats.quartile3, stats.unit)}`} />
        <IndicatorCard
          label="IC 95 % de la moyenne"
          value={
            stats.meanCi95
              ? `${formatNumber(stats.meanCi95.lower)} – ${formatNumber(stats.meanCi95.upper)} ${stats.unit}`
              : MISSING_VALUE
          }
        />
      </div>
    </div>
  );
}

function CoefficientTable({ coefficients }: { coefficients: OlsCoefficient[] }): JSX.Element {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Coefficient</th>
            <th className="num">Estimation</th>
            <th className="num">Écart-type</th>
            <th className="num">t</th>
            <th className="num">p-value</th>
            <th className="num">IC 95 %</th>
          </tr>
        </thead>
        <tbody>
          {coefficients.map((coef) => (
            <tr key={coef.name}>
              <td>{coef.label}</td>
              <td className="num">{formatNumber(coef.estimate)}</td>
              <td className="num">{formatNumber(coef.stdError)}</td>
              <td className="num">{formatNumber(coef.tStatistic)}</td>
              <td className="num">{formatPValue(coef.pValue)}</td>
              <td className="num">
                {coef.ci95
                  ? `${formatNumber(coef.ci95.lower)} – ${formatNumber(coef.ci95.upper)}`
                  : MISSING_VALUE}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function AnalysisPanels({ data }: { data: AnalysisPayload }): JSX.Element {
  const tempUnit = data.units['temperature_2m_mean'] ?? '°C';
  const precipUnit = data.units['precipitation_sum'] ?? 'mm';

  const monthlyChart = data.monthlySeries.map((row) => ({
    key: row.key,
    temperature: row.temperature,
    precipitation: row.precipitation,
  }));

  const decompositionChart = data.decomposition?.points ?? [];
  const holtFitted = data.holtWinters?.fitted ?? [];
  const holtForecast = data.holtWinters?.forecast ?? [];
  const acfChart = data.acf.filter((point) => point.acf !== null);
  const mlPredictions = data.ml.predictions;
  const trendLabel =
    data.mannKendall.trend === 'hausse'
      ? 'Hausse'
      : data.mannKendall.trend === 'baisse'
        ? 'Baisse'
        : 'Stable';

  return (
    <div className="analysis-panels">
      <p className="analysis-meta">
        Réanalyse ERA5 · {data.period.start} → {data.period.end} · {formatNumber(data.dailyCount, 0)} jours ·{' '}
        {formatNumber(data.monthlyCount, 0)} mois · modèle {data.model.toUpperCase()}
      </p>

      {data.warnings.length > 0 && (
        <div className="alert alert-warning analysis-warnings" role="status">
          <p>
            <strong>Limites de l’analyse</strong>
          </p>
          <ul>
            {data.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      )}

      <section aria-labelledby="stats-heading">
        <h2 id="stats-heading" className="section-title">
          Étude statistique descriptive
        </h2>
        <DescriptiveBlock stats={data.descriptive.temperature} />
        <DescriptiveBlock stats={data.descriptive.precipitation} />
        <div className="indicators-grid">
          <IndicatorCard
            label="Corrélation Pearson (T° / précip.)"
            value={formatNumber(data.correlation.pearson)}
            detail={`n = ${formatNumber(data.correlation.n, 0)}`}
          />
          <IndicatorCard
            label="Corrélation Spearman"
            value={formatNumber(data.correlation.spearman)}
            detail={`n = ${formatNumber(data.correlation.n, 0)}`}
          />
        </div>
      </section>

      <ChartPanel
        title="Séries mensuelles — température et précipitations"
        description="Moyennes mensuelles sur la période analysée (jours manquants exclus des moyennes)."
        ariaLabel="Graphique des séries mensuelles de température et précipitations"
      >
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={monthlyChart} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="key" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
            <YAxis yAxisId="temp" tick={{ fontSize: 11 }} unit={` ${tempUnit}`} width={52} />
            <YAxis yAxisId="precip" orientation="right" tick={{ fontSize: 11 }} unit={` ${precipUnit}`} width={52} />
            <Tooltip content={<SimpleTooltip />} />
            <Legend />
            <Line
              yAxisId="temp"
              type="monotone"
              dataKey="temperature"
              name={`Température (${tempUnit})`}
              stroke="#ef4444"
              strokeWidth={2}
              dot={false}
              connectNulls={false}
            />
            <Line
              yAxisId="precip"
              type="monotone"
              dataKey="precipitation"
              name={`Précipitations (${precipUnit})`}
              stroke="#0ea5e9"
              strokeWidth={2}
              dot={false}
              connectNulls={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </ChartPanel>

      <section aria-labelledby="ols-heading">
        <h2 id="ols-heading" className="section-title">
          Modèle économétrique (OLS)
        </h2>
        {data.ols ? (
          <>
            <div className="indicators-grid">
              <IndicatorCard label="Observations" value={formatNumber(data.ols.n, 0)} />
              <IndicatorCard label="R²" value={formatNumber(data.ols.r2)} />
              <IndicatorCard label="R² ajusté" value={formatNumber(data.ols.adjustedR2)} />
              <IndicatorCard label="Statistique F" value={formatNumber(data.ols.fStatistic)} detail={`p = ${formatPValue(data.ols.fPValue)}`} />
              <IndicatorCard label="Durbin-Watson" value={formatNumber(data.ols.durbinWatson)} />
              <IndicatorCard label="Erreur résiduelle" value={formatNumber(data.ols.residualStandardError)} />
            </div>
            <CoefficientTable coefficients={data.ols.coefficients} />
          </>
        ) : (
          <p className="analysis-empty">Régression OLS non estimée sur cette période (données insuffisantes).</p>
        )}
      </section>

      <section aria-labelledby="ts-heading">
        <h2 id="ts-heading" className="section-title">
          Séries temporelles
        </h2>
        <div className="indicators-grid">
          <IndicatorCard
            label="Test ADF"
            value={formatNumber(data.adf.statistic)}
            detail={
              data.adf.stationary === null
                ? 'Non calculé'
                : data.adf.stationary
                  ? 'Stationnaire (rejet H0)'
                  : 'Non stationnaire (H0 non rejetée)'
            }
          />
          <IndicatorCard label="Lags ADF" value={formatNumber(data.adf.lags, 0)} detail={`n = ${formatNumber(data.adf.n, 0)}`} />
          <IndicatorCard
            label="Seuils critiques"
            value={`1 % ${formatNumber(data.adf.criticalValues.one)} · 5 % ${formatNumber(data.adf.criticalValues.five)} · 10 % ${formatNumber(data.adf.criticalValues.ten)}`}
          />
        </div>

        {acfChart.length > 0 && (
          <ChartPanel
            title="Autocorrélation (ACF) — température mensuelle"
            description="Coefficients d’autocorrélation jusqu’à 24 retards."
            ariaLabel="Diagramme d’autocorrélation de la température mensuelle"
          >
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={acfChart} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="lag" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} domain={[-1, 1]} width={40} />
                <Tooltip content={<SimpleTooltip />} />
                <Bar dataKey="acf" name="ACF" fill="#8b5cf6" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartPanel>
        )}

        {decompositionChart.length > 0 && (
          <ChartPanel
            title="Décomposition saisonnière additive"
            description={`Période = ${data.decomposition?.period ?? 12} mois. Observé = tendance + saisonnier + résidu.`}
            ariaLabel="Décomposition saisonnière de la température mensuelle"
          >
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={decompositionChart} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="key" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 11 }} unit={` ${tempUnit}`} width={52} />
                <Tooltip content={<SimpleTooltip />} />
                <Legend />
                <Line type="monotone" dataKey="observed" name="Observé" stroke="#64748b" strokeWidth={1.5} dot={false} connectNulls={false} />
                <Line type="monotone" dataKey="trend" name="Tendance" stroke="#ef4444" strokeWidth={2} dot={false} connectNulls={false} />
                <Line type="monotone" dataKey="seasonal" name="Saisonnier" stroke="#0ea5e9" strokeWidth={1.5} dot={false} connectNulls={false} />
              </LineChart>
            </ResponsiveContainer>
          </ChartPanel>
        )}

        {data.holtWinters && (
          <>
            <div className="indicators-grid">
              <IndicatorCard label="Holt-Winters α" value={formatNumber(data.holtWinters.alpha)} />
              <IndicatorCard label="β" value={formatNumber(data.holtWinters.beta)} />
              <IndicatorCard label="γ" value={formatNumber(data.holtWinters.gamma)} />
              <IndicatorCard label="RMSE ajustement" value={withUnit(data.holtWinters.rmse, tempUnit)} />
            </div>
            <ChartPanel
              title="Holt-Winters — ajustement et prévision"
              description="Lissage exponentiel additif saisonnier ; bandes = intervalle prévisionnel."
              ariaLabel="Ajustement et prévision Holt-Winters"
            >
              <ResponsiveContainer width="100%" height={280}>
                <LineChart
                  data={[
                    ...holtFitted.map((point) => ({
                      key: point.key,
                      observed: point.observed,
                      fitted: point.fitted,
                      forecast: null as number | null,
                      lower: null as number | null,
                      upper: null as number | null,
                    })),
                    ...holtForecast.map((point) => ({
                      key: point.key,
                      observed: null as number | null,
                      fitted: null as number | null,
                      forecast: point.value,
                      lower: point.lower,
                      upper: point.upper,
                    })),
                  ]}
                  margin={{ top: 8, right: 16, left: 0, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="key" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 11 }} unit={` ${tempUnit}`} width={52} />
                  <Tooltip content={<SimpleTooltip />} />
                  <Legend />
                  <Line type="monotone" dataKey="observed" name="Observé" stroke="#64748b" strokeWidth={1.5} dot={false} connectNulls={false} />
                  <Line type="monotone" dataKey="fitted" name="Ajusté" stroke="#2563eb" strokeWidth={2} dot={false} connectNulls={false} />
                  <Line type="monotone" dataKey="forecast" name="Prévision" stroke="#16a34a" strokeWidth={2} strokeDasharray="4 4" dot={false} connectNulls={false} />
                  <Line type="monotone" dataKey="lower" name="Borne basse" stroke="#86efac" strokeWidth={1} strokeDasharray="2 2" dot={false} connectNulls={false} />
                  <Line type="monotone" dataKey="upper" name="Borne haute" stroke="#86efac" strokeWidth={1} strokeDasharray="2 2" dot={false} connectNulls={false} />
                </LineChart>
              </ResponsiveContainer>
            </ChartPanel>
          </>
        )}
      </section>

      <section aria-labelledby="ml-heading">
        <h2 id="ml-heading" className="section-title">
          Machine learning — régression ridge
        </h2>
        <div className="indicators-grid">
          <IndicatorCard label="Modèle" value={data.ml.model} />
          <IndicatorCard label="Train / test" value={`${formatNumber(data.ml.nTrain, 0)} / ${formatNumber(data.ml.nTest, 0)}`} />
          <IndicatorCard label="λ (ridge)" value={formatNumber(data.ml.lambda)} />
          <IndicatorCard label="RMSE test" value={formatNumber(data.ml.metrics.rmse)} detail={`baseline ${formatNumber(data.ml.baseline.rmse)}`} />
          <IndicatorCard label="MAE test" value={formatNumber(data.ml.metrics.mae)} detail={`baseline ${formatNumber(data.ml.baseline.mae)}`} />
          <IndicatorCard label="R² test" value={formatNumber(data.ml.metrics.r2)} detail={`baseline ${formatNumber(data.ml.baseline.r2)}`} />
        </div>

        {mlPredictions.length > 0 && (
          <ChartPanel
            title="Prédictions ML (jeu de test)"
            description="Température moyenne journalière observée vs prédite (rétards + calendrier)."
            ariaLabel="Comparaison observé et prédit du modèle ridge"
          >
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={mlPredictions} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 11 }} unit={` ${tempUnit}`} width={52} />
                <Tooltip content={<SimpleTooltip />} />
                <Legend />
                <Line type="monotone" dataKey="observed" name="Observé" stroke="#64748b" strokeWidth={1.5} dot={false} />
                <Line type="monotone" dataKey="predicted" name="Prédit" stroke="#f97316" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </ChartPanel>
        )}

        {data.ml.features.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Variable</th>
                  <th className="num">Coefficient ridge</th>
                </tr>
              </thead>
              <tbody>
                {data.ml.features.map((feature) => (
                  <tr key={feature.name}>
                    <td>{feature.label}</td>
                    <td className="num">{formatNumber(feature.coefficient)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-labelledby="other-models-heading">
        <h2 id="other-models-heading" className="section-title">
          Autres modèles et diagnostics
        </h2>
        <div className="indicators-grid">
          <IndicatorCard
            label="Mann-Kendall"
            value={trendLabel}
            detail={`p = ${formatPValue(data.mannKendall.pValue)} · Z = ${formatNumber(data.mannKendall.z)}`}
          />
          <IndicatorCard
            label="Pente Sen / décennie"
            value={withUnit(data.mannKendall.slopePerDecade, tempUnit)}
            detail={`n = ${formatNumber(data.mannKendall.n, 0)}`}
          />
          <IndicatorCard
            label="Extrêmes température max"
            value={formatNumber(data.extremes.temperatureMax.count, 0)}
            detail={
              data.extremes.temperatureMax.threshold !== null
                ? `seuil ${formatNumber(data.extremes.temperatureMax.threshold)} ${tempUnit}`
                : undefined
            }
          />
          <IndicatorCard
            label="Extrêmes précipitations"
            value={formatNumber(data.extremes.precipitation.count, 0)}
            detail={
              data.extremes.precipitation.threshold !== null
                ? `seuil ${formatNumber(data.extremes.precipitation.threshold)} ${precipUnit}`
                : undefined
            }
          />
        </div>

        <ChartPanel
          title="Climatologie mensuelle"
          description="Moyennes par mois civil sur toute la période (probabilité de jour humide ≥ 1 mm)."
          ariaLabel="Climatologie mensuelle température et précipitations"
        >
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={data.climatology} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis yAxisId="temp" tick={{ fontSize: 11 }} unit={` ${tempUnit}`} width={52} />
              <YAxis yAxisId="precip" orientation="right" tick={{ fontSize: 11 }} unit={` ${precipUnit}`} width={52} />
              <Tooltip content={<SimpleTooltip />} />
              <Legend />
              <Bar yAxisId="temp" dataKey="temperatureMean" name={`Température (${tempUnit})`} fill="#ef4444" radius={[2, 2, 0, 0]} />
              <Bar yAxisId="precip" dataKey="precipitationMean" name={`Précipitations (${precipUnit})`} fill="#0ea5e9" radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartPanel>

        {(data.extremes.temperatureMax.events.length > 0 || data.extremes.precipitation.events.length > 0) && (
          <div className="analysis-extremes-grid">
            {data.extremes.temperatureMax.events.length > 0 && (
              <div className="table-wrap">
                <h3 className="analysis-subtitle">Événements de chaleur (top)</h3>
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th className="num">Max ({tempUnit})</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.extremes.temperatureMax.events.map((event) => (
                      <tr key={`tmax-${event.date}`}>
                        <td>{event.date}</td>
                        <td className="num">{formatNumber(event.value)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {data.extremes.precipitation.events.length > 0 && (
              <div className="table-wrap">
                <h3 className="analysis-subtitle">Événements de précipitations (top)</h3>
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th className="num">Cumul ({precipUnit})</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.extremes.precipitation.events.map((event) => (
                      <tr key={`pr-${event.date}`}>
                        <td>{event.date}</td>
                        <td className="num">{formatNumber(event.value)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </section>

      <p className="analysis-disclaimer">
        Analyses calculées sur réanalyse ERA5 (pas des mesures de station). Les tendances et prévisions statistiques
        ne constituent pas une alerte officielle ni une attribution climatique. Source : {data.source.name}.
      </p>
    </div>
  );
}
