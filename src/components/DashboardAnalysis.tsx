import { useEffect, useMemo, useState } from 'react';
import { subtractDays, todayUTC } from '../../shared/dates.js';
import { ARCHIVE_SAFETY_DAYS } from '../../shared/sources.js';
import type { Coordinates } from '../coordinates.js';
import { useAnalysis } from '../hooks/useAnalysis.js';
import { AnalysisPanels } from './AnalysisPanels.js';
import { EmptyState, ErrorMessage, Loading } from './ui.js';

type PresetId = '5y' | '10y' | '2000-2020';

function maxArchiveEnd(): string {
  return subtractDays(todayUTC(), ARCHIVE_SAFETY_DAYS);
}

function presetRange(preset: PresetId): { start: string; end: string } {
  const end = maxArchiveEnd();
  if (preset === '2000-2020') {
    return { start: '2000-01-01', end: '2020-12-31' };
  }
  const years = preset === '5y' ? 5 : 10;
  const endYear = Number(end.slice(0, 4));
  const startYear = endYear - years + 1;
  return { start: `${startYear}-01-01`, end };
}

export function DashboardAnalysis({ coordinates }: { coordinates: Coordinates }): JSX.Element {
  const { state, load, cancel } = useAnalysis();
  const [preset, setPreset] = useState<PresetId>('5y');
  const range = useMemo(() => presetRange(preset), [preset]);
  const { latitude, longitude } = coordinates;

  useEffect(() => {
    load({ latitude, longitude }, range.start, range.end);
    return () => cancel();
  }, [latitude, longitude, range.start, range.end, load, cancel]);

  return (
    <section className="dashboard-analysis" aria-labelledby="analysis-heading">
      <div className="analysis-header">
        <div>
          <h2 id="analysis-heading" className="section-title" style={{ marginTop: 0 }}>
            Analyses avancées
          </h2>
          <p className="page-intro">
            Statistiques descriptives, séries temporelles, machine learning et modèles complémentaires sur
            l’archive ERA5.
          </p>
        </div>
        <div className="analysis-controls" role="group" aria-label="Période d’analyse">
          {(
            [
              { id: '5y' as const, label: '5 ans' },
              { id: '10y' as const, label: '10 ans' },
              { id: '2000-2020' as const, label: '2000–2020' },
            ] as const
          ).map((option) => (
            <button
              key={option.id}
              type="button"
              className={preset === option.id ? 'button button-primary' : 'button button-secondary'}
              onClick={() => setPreset(option.id)}
              disabled={state.loading && preset === option.id}
            >
              {option.label}
            </button>
          ))}
          {state.loading && (
            <button type="button" className="button button-secondary" onClick={cancel}>
              Annuler
            </button>
          )}
        </div>
      </div>

      <p className="analysis-period">
        Période : <strong>{range.start}</strong> → <strong>{range.end}</strong>
      </p>

      {state.loading && !state.data && (
        <Loading label="Calcul des analyses statistiques et modèles (archive ERA5)…" />
      )}

      {state.loading && state.data && (
        <div className="stale-banner" role="status">
          Recalcul en cours pour la période sélectionnée…
        </div>
      )}

      {state.error && (
        <ErrorMessage
          message={state.data ? 'Échec du recalcul' : 'Analyses non chargées'}
          reason={state.error}
          onRetry={() => load({ latitude, longitude }, range.start, range.end)}
          variant={state.data ? 'warning' : 'error'}
        />
      )}

      {!state.loading && !state.data && !state.error && (
        <EmptyState title="Analyses non disponibles">
          <p>Choisissez une période puis patientez pendant le chargement de l’archive ERA5.</p>
        </EmptyState>
      )}

      {state.data && <AnalysisPanels data={state.data} />}
    </section>
  );
}
