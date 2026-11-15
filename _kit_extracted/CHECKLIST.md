# Checklist de validation

État au 2026-11-15, vérifié sur `master` (commits `131cfb3`, `be5cb7c`, `e574f92`,
`f0d92bd`) : lint, typecheck, 176 tests Vitest, 6 tests Playwright, 26 tests
pytest et build de production exécutés, API réelle interrogée.

- [ ] Architecture et périmètre validés.
  - Architecture documentée et stable (`README.md` → « Architecture »), mais la
    validation du périmètre reste une décision humaine : non auto-certifiable ici.
- [x] Installation et lancement documentés et vérifiés.
  - `README.md` couvre `npm install`, `npm run dev` (Vite 5173 + API 3000),
    build et `npm start` ; le serveur a démarré sur `127.0.0.1:3000` et
    `/api/health` a répondu `{"status":"ok",...}`.
- [x] Réponse réelle API testée, ou limitation réseau clairement signalée.
  - Appels réels depuis le serveur, le 2026-11-15 :
    `/api/weather` → `200` en 2,9 s (Indian/Antananarivo, GMT+3),
    `/api/history` (2026-10-01 → 2026-10-31) → `200` en 2,2 s.
- [x] Données actuelles, prévisions et archives distinguées.
  - `kind` distinct (`forecast` / `history`), `current` séparé de `hourly`/`daily`,
    et les pages (Dashboard, Forecasts, History, Methodology) nomment la nature
    de chaque donnée (« réanalyse ERA5 — pas des mesures de station »).
- [x] Unités et fuseaux corrects ; heures de validité et récupération distinctes.
  - `utcOffsetSeconds`/`timezone` du lieu utilisés à l'affichage (jamais le fuseau
    du navigateur) ; `fetchedAt` (UTC, récupération) exposé distinctement de
    l'heure de validité, et la page Méthodologie précise qu'il ne s'agit pas de
    l'heure d'émission du modèle.
- [x] Aucune donnée fictive dans l'application finale.
  - Les valeurs absentes restent `null` jusqu'à l'affichage (`MISSING_VALUE`) ; les
    jeux simulés ne vivent que dans `tests/` (Playwright intercepte `/api/*`).
- [x] Valeurs manquantes conservées ; couverture et cumuls incomplets signalés.
  - Jours absents comptés et avertis, cumuls de précipitations marqués
    « incomplets », moyenne mobile exigeant 7 jours consécutifs, pondération par
    jours disponibles.
- [x] Erreurs, cache, timeout et tentatives contrôlés.
  - Zod sur les réponses amont, timeout 15 s/20 s, 2 reprises sur erreurs
    transitoires avec `Retry-After`, cache 15 min/1 h, requêtes simultanées
    mutualisées (`inflight.ts`), `503` public sans pile d'exécution.
- [x] Historique, filtres, statistiques et exports vérifiés.
  - Couverts par les tests d'intégration et les e2e (chargement, couverture,
    filtres, export CSV/JSON des lignes filtrées), CSV protégé contre les
    formules de tableur.
- [x] Tests TypeScript, unitaires, intégration et navigateur exécutés.
  - 2026-11-15 : `lint` OK, `typecheck` OK, Vitest 176/176 sur 16 fichiers,
    Playwright 6/6 (Chromium), pytest 26/26 dans `dagster_project/`.
- [x] Build de production réussi.
  - `npm run build` (client Vite + serveur `tsc`) OK ; `Dockerfile` copie
    désormais `public/` (favicon) avec les sources.
- [x] Conditions d'utilisation et attributions vérifiées.
  - Licence CC BY 4.0 d'Open-Meteo attribuée dans la page Méthodologie et dans
    les exports ; l'usage actuel (consultation à la demande, rafraîchissement
    navigateur de 15 min) reste dans un cadre raisonnable.
- [x] Secrets absents du frontend et du dépôt.
  - Aucun `.env` suivi (seul `.env.example`), aucun secret dans `src/` (les
    occurrences de « password » sont les champs du formulaire de connexion) ;
    les secrets d'authentification sont lus côté serveur uniquement.
- [ ] Déploiement soumis à validation.
  - Aucun déploiement effectué : image Docker constructible et procédure décrite
    (`docs/SECURITE.md`), mais la mise en ligne attend une validation explicite.
- [x] Collecte permanente mise en place seulement si nécessaire et approuvée.
  - Rien ne tourne en tâche de fond : ETL Node et Dagster sont livrés mais
    déclenchés manuellement (cron/schtasks et planifications Dagster restent
    désactivés par défaut), et le README le précise.

## Reste à faire (hors code)

1. Valider explicitement le périmètre et l'architecture (point 1).
2. Décider du déploiement, puis rejouer `docs/SECURITE.md` sur la cible réelle
   (TLS, reverse proxy, `AUTH_*`, `SESSION_SECRET`, `TRUST_PROXY`).
3. Si la collecte permanente est retenue : fixer la fréquence (pas plus
   qu'horaire), la rétention et la surveillance des échecs de run.
