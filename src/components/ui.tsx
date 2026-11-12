import type { ReactNode, RefObject } from 'react';

export function PageHeader({
  title,
  intro,
  actions,
}: {
  title: string;
  intro?: ReactNode;
  actions?: ReactNode;
}): JSX.Element {
  return (
    <div className="page-header">
      <div>
        <h1>{title}</h1>
        {intro && <p className="page-intro">{intro}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

export function IndicatorCard({
  label,
  value,
  detail,
  unavailableHint,
}: {
  label: string;
  value: string;
  detail?: string;
  unavailableHint?: string;
}): JSX.Element {
  const unavailable = value === '—';
  return (
    <div className="card indicator">
      <p className="indicator-label">{label}</p>
      <p className={unavailable ? 'indicator-value indicator-unavailable' : 'indicator-value'}>{value}</p>
      {detail && <p className="indicator-detail">{detail}</p>}
      {unavailable && unavailableHint && <p className="indicator-detail">{unavailableHint}</p>}
    </div>
  );
}

export function ErrorMessage({
  message,
  reason,
  onRetry,
  variant = 'error',
}: {
  message: string;
  reason?: string | null;
  onRetry?: () => void;
  variant?: 'error' | 'warning';
}): JSX.Element {
  return (
    <div className={variant === 'warning' ? 'alert alert-warning' : 'alert alert-error'} role="alert">
      <p>
        <strong>{message}</strong>
      </p>
      {reason && <p className="alert-reason">{reason}</p>}
      {onRetry && (
        <button type="button" className="button button-secondary" onClick={onRetry}>
          Réessayer
        </button>
      )}
    </div>
  );
}

export function Loading({ label = 'Chargement des données…' }: { label?: string }): JSX.Element {
  return (
    <div className="loading" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }): JSX.Element {
  return (
    <div className="empty-state">
      <h2>{title}</h2>
      {children}
    </div>
  );
}

export function ChartPanel({
  title,
  description,
  ariaLabel,
  actions,
  altTable,
  chartRef,
  children,
}: {
  title: string;
  description?: string;
  ariaLabel: string;
  actions?: ReactNode;
  altTable?: ReactNode;
  chartRef?: RefObject<HTMLDivElement>;
  children: ReactNode;
}): JSX.Element {
  return (
    <figure className="chart-panel">
      <figcaption className="chart-header">
        <div>
          <h2>{title}</h2>
          {description && <p className="chart-description">{description}</p>}
        </div>
        {actions && <div className="chart-actions">{actions}</div>}
      </figcaption>

      <div className="chart-canvas" role="img" aria-label={ariaLabel} ref={chartRef}>
        {children}
      </div>

      {altTable && (
        <details className="chart-alt">
          <summary>Données du graphique (tableau alternatif)</summary>
          {altTable}
        </details>
      )}
    </figure>
  );
}
