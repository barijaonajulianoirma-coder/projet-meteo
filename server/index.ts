import fs from 'node:fs';
import path from 'node:path';
import { createApp } from './app.js';
import { loadAuthConfig } from './lib/auth.js';
import { LoginThrottle } from './lib/bruteForce.js';
import { isLoopbackHost, resolveHost, resolvePort } from './lib/network.js';
import { closeRedis, getRedisClient } from './lib/redis.js';
import { startThrottlePruning } from './routes/auth.js';

/**
 * Émet un avertissement si le répertoire de données semble être sur un volume
 * réseau (NFS, SMB). SQLite utilise des verrous fichiers POSIX incompatibles
 * avec ces systèmes. Ignoré silencieusement sur Windows et si Node < 19.
 */
function warnIfNetworkVolume(dir: string): void {
  try {
    // statfsSync disponible uniquement sur Linux/macOS (Node ≥ 19.6).
    const { statfsSync } = fs as typeof fs & { statfsSync?: (p: string) => { type: number } };
    if (typeof statfsSync !== 'function') return;
    const { type } = statfsSync(dir);
    // NFS = 0x6969, SMB/CIFS = 0xFF534D42, AFS = 0x5346414F
    const networkTypes = new Set([0x6969, 0xff534d42, 0x5346414f]);
    if (networkTypes.has(type)) {
      console.warn(
        '[securite] ATTENTION : le répertoire de données semble être sur un volume réseau (NFS/SMB).\n' +
          '  Les verrous SQLite ne fonctionnent pas de façon fiable sur les volumes réseau.\n' +
          '  Utilisez un chemin local ou migrez vers PostgreSQL.',
      );
    }
  } catch {
    // Répertoire inexistant ou fs.statfsSync non supporté → pas d'avertissement.
  }
}

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

// STATIC_DIR est facultatif : chemin relatif au répertoire courant ou absolu.
const staticDir = path.resolve(process.cwd(), process.env.STATIC_DIR?.trim() || 'dist');
warnIfNetworkVolume(path.resolve(process.cwd(), 'data'));
// Connexion Redis optionnelle (cache et rate limiting partagés) ouverte dès le
// démarrage, pour ne pas faire attendre la première requête. Sans REDIS_URL,
// l'appel se résout immédiatement avec null.
void getRedisClient();
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
  server.close(() => {
    void closeRedis().finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
