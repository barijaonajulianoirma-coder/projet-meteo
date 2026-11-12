import { PageHeader } from '../components/ui.js';
import { OPEN_METEO_ATTRIBUTION, OPEN_METEO_TERMS_URL, FORECAST_SOURCE, HISTORY_SOURCE } from '../../shared/sources.js';
import { WET_DAY_THRESHOLD_MM } from '../../shared/stats.js';

export function Methodology(): JSX.Element {
  return (
    <>
      <PageHeader
        title="Méthodologie et sources"
        intro="Explication des données, des calculs et des limites de la plateforme."
      />

      <article className="methodology">
        <h2>Types de données</h2>

        <h3>Conditions actuelles (tableau de bord)</h3>
        <p>
          Les valeurs affichées sur le tableau de bord proviennent de l'API de prévisions Open-Meteo
          (<code>api.open-meteo.com/v1/forecast</code>). Le champ <em>conditions actuelles</em> (<code>current</code>)
          est l'estimation du modèle pour l'instant présent, non une mesure directe d'une station météorologique.
          Chaque valeur est associée à une <strong>heure de validité</strong> (<code>current.time</code>) et une
          durée d'intervalle ; ce n'est pas l'heure à laquelle le modèle a tourné.
        </p>

        <h3>Prévisions (tableau de bord et page Prévisions)</h3>
        <p>
          Les prévisions couvrent 7 jours en pas horaire et journalier. Elles sont issues de modèles numériques
          de prévision météorologique et non de mesures d'observations. Les valeurs futures sont indicatives ;
          leur précision diminue avec l'horizon.
        </p>

        <h3>Réanalyse historique ERA5 (page Historique)</h3>
        <p>
          Les données historiques proviennent de l'API d'archive Open-Meteo
          (<code>archive-api.open-meteo.com/v1/archive</code>), qui s'appuie sur ERA5, la réanalyse atmosphérique
          du Centre européen pour les prévisions météorologiques à moyen terme (CEPMMT / ECMWF).
        </p>
        <p>
          ERA5 est une <strong>réanalyse</strong> : les observations historiques mondiales ont été assimilées dans
          un modèle pour produire un champ continu. Ce n'est pas la mesure d'une station locale et ne remplace pas
          un relevé d'une station météorologique officielle.
        </p>
        <p>
          La plateforme propose une fin maximale à aujourd'hui moins 6 jours comme marge opérationnelle constatée
          de publication d'ERA5. Ce délai n'est pas une garantie de disponibilité — consultez la documentation
          Open-Meteo pour l'état actuel.
        </p>

        <h2>Heure de validité vs heure de récupération</h2>
        <p>
          La plateforme distingue rigoureusement deux horodatages :
        </p>
        <ul>
          <li>
            <strong>Heure de validité</strong> (<code>current.time</code>) : moment auquel la condition météo est
            censée être valide, dans le fuseau horaire local du lieu observé.
          </li>
          <li>
            <strong>Heure de récupération</strong> (<code>fetchedAt</code>) : moment auquel le serveur de la
            plateforme a interrogé l'API Open-Meteo, en UTC. Cette valeur ne représente pas la date d'émission
            du modèle météorologique.
          </li>
        </ul>
        <p>
          Toutes les heures locales sont calculées à partir du décalage UTC fourni par l'API (<code>utc_offset_seconds</code>),
          sans passer par le fuseau horaire du navigateur de l'utilisateur, afin d'éviter toute conversion involontaire.
        </p>

        <h2>Formules et indicateurs</h2>

        <h3>Statistiques de période</h3>
        <ul>
          <li>
            <strong>Température moyenne</strong> : moyenne arithmétique des températures moyennes journalières
            disponibles (valeurs <code>null</code> exclues). L'effectif de jours disponibles est toujours affiché.
          </li>
          <li>
            <strong>Maximum des maxima</strong> : maximum sur les <code>temperature_2m_max</code> disponibles.
          </li>
          <li>
            <strong>Minimum des minima</strong> : minimum sur les <code>temperature_2m_min</code> disponibles.
          </li>
          <li>
            <strong>Cumul de précipitations</strong> : somme des <code>precipitation_sum</code> disponibles.
            Si des jours sont manquants, le cumul est marqué <em>incomplet</em> ; il n'est jamais complété
            par des zéros fictifs.
          </li>
          <li>
            <strong>Jours pluvieux</strong> : nombre de jours avec <code>precipitation_sum ≥ {WET_DAY_THRESHOLD_MM} mm</code>.
          </li>
        </ul>

        <h3>Moyenne mobile 7 jours</h3>
        <p>
          Calculée sur 7 jours calendaires consécutifs. Si l'une des 7 dates de la fenêtre est absente
          du jeu de données ou présente une valeur <code>null</code>, la moyenne mobile est <code>null</code>
          pour ce point. Elle n'est jamais extrapolée.
        </p>

        <h3>Agrégations mensuelles et annuelles</h3>
        <p>
          Les moyennes mensuelles et annuelles de température sont calculées sur les jours disponibles
          (pondérées par le nombre de jours réels). Elles ne sont pas obtenues en moyennant des moyennes
          mensuelles non pondérées. Les cumuls incomplets sont signalés.
        </p>
        <p>
          Le nombre de jours attendus par période tient compte des années bissextiles et des limites
          de la sélection.
        </p>

        <h3>Valeurs manquantes</h3>
        <p>
          Toute valeur absente dans la réponse API est conservée telle quelle (<code>null</code>),
          jamais remplacée par zéro. Les graphiques laissent les points <code>null</code> vides
          (<code>connectNulls={'{false}'}</code>). Les exports CSV contiennent un champ vide pour les
          valeurs nulles.
        </p>

        <h2>Analyses avancées (tableau de bord)</h2>
        <p>
          Le tableau de bord charge une étude sur l'archive ERA5 via <code>GET /api/analysis</code>
          (périodes prédéfinies 5 ans, 10 ans ou 2000–2020). Les calculs sont purs côté serveur
          (<code>shared/analysis.ts</code>) : aucune donnée n'est inventée et les observations incomplètes
          sont exclues des estimateurs concernés.
        </p>
        <ul>
          <li>
            <strong>Statistiques descriptives</strong> : moyenne, médiane, quartiles, écart-type,
            asymétrie, kurtosis, IC 95 % de la moyenne, corrélations Pearson et Spearman.
          </li>
          <li>
            <strong>OLS</strong> : régression de la température journalière sur une tendance annuelle
            et des indicatrices mensuelles, avec R², F, Durbin-Watson et IC des coefficients.
          </li>
          <li>
            <strong>Séries temporelles</strong> : ACF, test ADF, décomposition saisonnière additive,
            lissage Holt-Winters (prévision à court terme avec bandes).
          </li>
          <li>
            <strong>Machine learning</strong> : régression ridge sur retards journaliers et calendrier,
            avec jeu train/test, métriques et comparaison à une baseline naïve.
          </li>
          <li>
            <strong>Autres diagnostics</strong> : Mann-Kendall / pente de Sen, climatologie mensuelle,
            détection d'extrêmes (seuils empiriques).
          </li>
        </ul>
        <p>
          Ces résultats restent des diagnostics statistiques sur une réanalyse : ils ne constituent
          ni une alerte officielle ni une preuve d'attribution climatique.
        </p>

        <h2>Cache et actualisation</h2>
        <ul>
          <li>Le serveur met en cache les prévisions pendant <strong>15 minutes</strong> par jeu de coordonnées.</li>
          <li>Les archives ERA5 sont mises en cache <strong>1 heure</strong> par segment annuel.</li>
          <li>Le résultat d'analyse (<code>/api/analysis</code>) est mis en cache <strong>1 heure</strong> par coordonnées et période.</li>
          <li>Le tableau de bord s'actualise automatiquement toutes les <strong>15 minutes</strong> lorsque l'onglet
            est visible. Un seul polling est actif à la fois et est nettoyé au démontage du composant.</li>
          <li>En cas d'échec d'actualisation, les dernières données valides sont conservées et signalées comme non à jour.</li>
        </ul>

        <h2>Gestion des erreurs et limites de débit</h2>
        <ul>
          <li>Timeout de 15 secondes pour les prévisions, 20 secondes pour l'archive.</li>
          <li>Au maximum 2 nouvelles tentatives sur erreurs transitoires (5xx), avec temporisation entre tentatives.</li>
          <li>Le code HTTP <code>429</code> (trop de requêtes) respecte l'en-tête <code>Retry-After</code> si présent.</li>
          <li>L'API backend est limitée à 120 requêtes par minute.</li>
          <li>Aucune URL externe arbitraire fournie par le client n'est acceptée par le backend.</li>
        </ul>

        <h2>Sources et licences</h2>

        <div className="source-card">
          <h4>
            {FORECAST_SOURCE.name}
            <span className="licence-badge">{FORECAST_SOURCE.licence}</span>
          </h4>
          <p>
            <a href={FORECAST_SOURCE.url} target="_blank" rel="noreferrer">
              {FORECAST_SOURCE.url}
            </a>
          </p>
          <p>{OPEN_METEO_ATTRIBUTION}</p>
        </div>

        <div className="source-card">
          <h4>
            {HISTORY_SOURCE.name}
            <span className="licence-badge">{HISTORY_SOURCE.licence}</span>
          </h4>
          <p>
            <a href={HISTORY_SOURCE.url} target="_blank" rel="noreferrer">
              {HISTORY_SOURCE.url}
            </a>
          </p>
          <p>{HISTORY_SOURCE.attribution}</p>
        </div>

        <div className="source-card">
          <h4>
            ERA5 — Centre européen pour les prévisions météorologiques à moyen terme (CEPMMT / ECMWF)
          </h4>
          <p>
            Réanalyse atmosphérique mondiale. Licence d'utilisation ECMWF / Copernicus Climate Change Service
            (C3S). Redistribuée via Open-Meteo sous CC BY 4.0.
            <a href="https://cds.climate.copernicus.eu/datasets/reanalysis-era5-single-levels" target="_blank" rel="noreferrer" style={{ marginLeft: '0.4em' }}>
              Documentation ERA5
            </a>
          </p>
        </div>

        <p>
          <a href={OPEN_METEO_TERMS_URL} target="_blank" rel="noreferrer">
            Conditions d'utilisation Open-Meteo
          </a>{' '}
          ·{' '}
          <a href="https://open-meteo.com/en/docs" target="_blank" rel="noreferrer">
            Documentation Open-Meteo
          </a>{' '}
          ·{' '}
          <a href="https://open-meteo.com/en/docs/historical-weather-api" target="_blank" rel="noreferrer">
            API archive ERA5
          </a>
        </p>

        <h2>Avertissements</h2>
        <ul>
          <li>
            Les données proviennent de modèles météorologiques ; elles ne constituent pas des mesures
            directes d'une station et ne peuvent pas être utilisées à des fins officielles ou réglementaires
            sans vérification auprès des services météorologiques nationaux.
          </li>
          <li>
            Aucun seuil affiché dans cette application ne constitue une alerte météorologique officielle.
          </li>
          <li>
            L'analyse d'une courte période ne permet pas de tirer de conclusions sur le changement climatique.
          </li>
          <li>
            Aucune donnée fictive n'est utilisée dans cette application. Les valeurs absentes restent absentes.
          </li>
        </ul>
      </article>
    </>
  );
}
