/**
 * Génère les valeurs d'authentification à placer dans `.env`.
 *
 * Le mot de passe est lu sur l'entrée standard pour éviter qu'il apparaisse
 * dans l'historique du shell ou dans la liste des processus.
 *
 *   printf '%s' 'mon-mot-de-passe' | npm run auth:hash
 */
import { generateSessionSecret, hashPassword } from '../lib/auth.js';

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function main(): Promise<void> {
  if (process.stdin.isTTY) {
    console.error(
      'Aucun mot de passe fourni. Utilisation :\n' +
        "  printf '%s' 'mon-mot-de-passe' | npm run auth:hash",
    );
    process.exit(1);
  }

  const password = (await readStdin()).replace(/\r?\n$/, '');
  if (password.length === 0) {
    console.error('Mot de passe vide : valeur refusée.');
    process.exit(1);
  }
  if (password.length < 12) {
    console.error('Mot de passe trop court : 12 caractères minimum recommandés (~72 bits).');
    process.exit(1);
  }

  const hash = hashPassword(password);
  console.log('# Ajouter au fichier .env, puis redémarrer le serveur.');
  console.log('AUTH_USERNAME=meteo');
  console.log(`AUTH_PASSWORD_HASH=${hash}`);
  console.log(`SESSION_SECRET=${generateSessionSecret()}`);
  console.log('# SESSION_TTL_HOURS=12');
}

void main();
