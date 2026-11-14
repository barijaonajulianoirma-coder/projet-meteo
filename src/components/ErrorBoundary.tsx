import { Component, type ErrorInfo, type ReactNode } from 'react';
import { ErrorMessage } from './ui.js';

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Capture les erreurs de rendu des pages afin d'éviter un écran blanc.
 * Le bandeau de navigation reste affiché puisque la frontière est placée
 * à l'intérieur de `Layout`.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ui] Erreur de rendu :', error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="error-boundary">
          <ErrorMessage
            message="Une erreur inattendue a interrompu l’affichage de cette page."
            reason={this.state.error.message}
          />
          <button type="button" className="button button-primary" onClick={() => window.location.reload()}>
            Recharger la page
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
