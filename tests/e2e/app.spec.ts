import fs from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { mockAnalysis, mockForecast, mockHistory } from './fixtures.js';

interface CapturedRequests {
  weather: string[];
  history: string[];
  analysis: string[];
}

/**
 * Intercepte /api/* : aucune requête réelle vers Open-Meteo pendant les tests.
 * Les données simulées sont définies dans fixtures.ts et réservées aux tests.
 */
async function installApiMocks(page: Page): Promise<CapturedRequests> {
  const captured: CapturedRequests = { weather: [], history: [], analysis: [] };

  await page.route('**/api/weather**', async (route) => {
    captured.weather.push(route.request().url());
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(mockForecast),
    });
  });

  await page.route('**/api/history**', async (route) => {
    captured.history.push(route.request().url());
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(mockHistory),
    });
  });

  await page.route('**/api/analysis**', async (route) => {
    captured.analysis.push(route.request().url());
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(mockAnalysis),
    });
  });

  return captured;
}

function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

async function openDashboard(page: Page): Promise<CapturedRequests> {
  const captured = await installApiMocks(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Tableau de bord' })).toBeVisible();
  return captured;
}

test('tableau de bord : conditions, graphiques et tableau 7 jours', async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await openDashboard(page);

  await expect(page.getByRole('heading', { name: /Conditions actuelles/ })).toBeVisible();
  await expect(page.getByText(/24,5/).first()).toBeVisible();
  await expect(page.getByText('Conditions issues de modèles météorologiques').first()).toBeVisible();
  await expect(page.getByRole('heading', { name: /Température — 48 prochaines heures/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Prévisions — 7 jours/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Analyses avancées/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Étude statistique descriptive/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Séries temporelles/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Machine learning/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Autres modèles/ })).toBeVisible();
  await expect(page.locator('section[aria-labelledby="daily-heading"] tbody tr')).toHaveCount(7);

  expect(errors).toEqual([]);
});

test('changement de coordonnées : la requête utilise les nouvelles valeurs', async ({ page }) => {
  const errors = collectConsoleErrors(page);
  const captured = await openDashboard(page);

  await page.getByLabel('Latitude').fill('-21.4527');
  await page.getByLabel('Longitude').fill('47.0857');
  await page.getByRole('button', { name: 'Appliquer' }).click();

  await expect(page.getByText(/-21.4527, 47.0857/)).toBeVisible();
  await expect
    .poll(() => captured.weather.some((url) => url.includes('latitude=-21.4527')))
    .toBe(true);

  expect(errors).toEqual([]);
});

test('actualisation manuelle : nouvelle requête API', async ({ page }) => {
  const errors = collectConsoleErrors(page);
  const captured = await openDashboard(page);

  const before = captured.weather.length;
  await page.getByRole('button', { name: /Actualiser/ }).click();
  await expect.poll(() => captured.weather.length).toBeGreaterThan(before);

  expect(errors).toEqual([]);
});

test('historique : chargement, couverture, filtres et exports', async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await installApiMocks(page);

  await page.goto('/historique');
  await expect(page.getByRole('heading', { level: 1, name: 'Analyse historique' })).toBeVisible();

  await page.getByRole('button', { name: '2000–2020' }).click();
  await page.getByRole('button', { name: 'Charger' }).click();

  await expect(page.getByText('Jours attendus : 10')).toBeVisible();
  await expect(page.getByText('Manquants : 1')).toBeVisible();
  await expect(page.getByText('Statistiques sur la période filtrée')).toBeVisible();

  // Agrégation annuelle
  await page.getByLabel('Agrégation').selectOption('annual');
  await expect(page.getByRole('heading', { name: 'Températures — annuel' })).toBeVisible();
  await expect(page.locator('table').last().locator('tbody tr')).toHaveCount(1);

  // Filtre par variable : les précipitations restent, les températures disparaissent
  await page.getByLabel('Variable').selectOption('precipitation');
  await expect(page.getByRole('heading', { name: 'Températures — annuel' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Précipitations — annuel' })).toBeVisible();
  await expect(page.locator('.stat-label', { hasText: 'Temp. moy.' })).toHaveCount(0);
  await expect(page.locator('.stat-label', { hasText: 'Cumul préc.' })).toBeVisible();

  // Export CSV de toutes les données filtrées, avec unités dans l'en-tête
  const [csvDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTitle('Exporter en CSV').click(),
  ]);
  const csvPath = await csvDownload.path();
  expect(csvPath).not.toBeNull();
  const csv = await fs.readFile(csvPath!, 'utf8');
  const header = csv.split('\r\n')[0];
  expect(header).toContain('Date');
  expect(header).toContain('Préc. (');
  expect(header).not.toContain('Temp. moy.');
  expect(csv).toContain('2000-01-01');
  expect(csv).toContain('2000-01-10');

  // Export JSON avec métadonnées
  const [jsonDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTitle('Exporter en JSON').click(),
  ]);
  const jsonPath = await jsonDownload.path();
  expect(jsonPath).not.toBeNull();
  expect(jsonDownload.suggestedFilename()).toContain('2000-01-01_2000-01-10');
  const payload = JSON.parse(await fs.readFile(jsonPath!, 'utf8')) as {
    meta: {
      provenance: string;
      modele: string;
      fuseau: string;
      periode: string;
      variable: string;
      agregation: string;
    };
    donnees: unknown[];
  };
  expect(payload.meta.provenance).toContain('ERA5');
  expect(payload.meta.modele).toBe('era5');
  expect(payload.meta.fuseau).toBe('Indian/Antananarivo');
  // La période exportée est celle des données chargées, pas celle du formulaire.
  expect(payload.meta.periode).toBe('2000-01-01/2000-01-10');
  expect(payload.meta.variable).toBe('precipitation');
  expect(payload.meta.agregation).toBe('annual');
  expect(payload.donnees).toHaveLength(10);

  // Export PNG du graphique de précipitations
  const [pngDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: '↓ PNG' }).click(),
  ]);
  expect(pngDownload.suggestedFilename()).toMatch(/\.png$/);

  // Changer de lieu invalide les données de l'ancienne localisation.
  await page.getByLabel('Lieu').selectOption('Toamasina');
  await expect(page.getByText('Aucune donnée chargée')).toBeVisible();
  await expect(page.getByText(/Jours attendus/)).toHaveCount(0);

  expect(errors).toEqual([]);
});

test.describe('affichage mobile', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('navigation et tableau de bord lisibles sur petit écran', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await openDashboard(page);

    const nav = page.getByRole('navigation', { name: 'Navigation principale' });
    await expect(nav).toBeVisible();
    await nav.getByRole('link', { name: 'Historique' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Analyse historique' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Charger' })).toBeVisible();

    expect(errors).toEqual([]);
  });
});
