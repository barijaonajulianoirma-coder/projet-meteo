import fs from 'node:fs';
import path from 'node:path';
import { createApp } from './app.js';
import { loadAuthConfig } from './lib/auth.js';
import { LoginThrottle } from './lib/bruteForce.js';
import { isLoopbackHost, resolveHost, resolvePort } from './lib/network.js';
import { startThrottlePruning } from './routes/auth.js';

// Configuration d'écoute validée avant tout démarrage : une valeur douteuse
// arrête le processus plutôt que d'exposer le serveur sur une interface inattendue.
// Par défaut, écoute sur la boucle locale uniquement : définir HOST=0.0.0.0
// pour exposer explicitement le serveur au réseau.
let port: number;
let host: string;
try {
  port = resolvePort(process.env.PORT);
  host = resolveHost(process.env.HOST);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

// Aucune exposition réseau sans authentification : le démarrage est refusé.
const auth = (() => {
  try {
    return loadAuthConfig(process.env);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
})();

if (!isLoopbackHost(host) && !auth) {
  console.error(
    `Refus de démarrer : HOST=${host} expose le serveur au réseau sans authentification.\n` +
      'Définissez AUTH_USERNAME, AUTH_PASSWORD_HASH et SESSION_SECRET, ou laissez HOST=127.0.0.1.',
  );
  process.exit(1);
}

if (!isLoopbackHost(host)) {
  console.log(`[securite] HOST=${host} : authentification active sur toutes les requêtes /api.`);
}

let trustProxy: boolean | number | string | undefined;
if (process.env.TRUST_PROXY?.trim()) {
  const raw = process.env.TRUST_PROXY.trim();
  trustProxy = /^\d+$/.test(raw) ? Number(raw) : raw === 'true' ? true : raw === 'false' ? false : raw;
}

const staticDir = path.resolve(process.cwd(), 'dist');
const throttle = new LoginThrottle();
const app = createApp({
  staticDir: fs.existsSync(path.join(staticDir, 'index.html')) ? staticDir : null,
  auth,
  throttle,
  trustProxy,
});

const server = app.listen(port, host, () => {
  console.log(`Météo Analyse — serveur prêt sur http://${host}:${port}`);
});

const stopPruning = startThrottlePruning(throttle);

function shutdown(signal: string): void {
  console.log(`${signal} reçu : arrêt du serveur.`);
  stopPruning();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
