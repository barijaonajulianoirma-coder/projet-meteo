import { Link } from 'react-router-dom';
import { EmptyState, PageHeader } from '../components/ui.js';

export function NotFound(): JSX.Element {
  return (
    <>
      <PageHeader
        title="Page introuvable"
        intro="Cette adresse ne correspond à aucune page de l’application."
      />
      <EmptyState title="404">
        <p>Vérifiez l’adresse saisie ou revenez au tableau de bord.</p>
        <Link className="button button-primary" to="/">
          Retour au tableau de bord
        </Link>
      </EmptyState>
    </>
  );
}
