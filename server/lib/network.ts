/**
 * Résolution de l'interface d'écoute HTTP.
 *
 * Sécurité par défaut : le serveur n'écoute que sur la boucle locale. Toute
 * exposition réseau doit être explicite via `HOST`.
 */
import { isIP } from 'node:net';

export const DEFAULT_HOST = '127.0.0.1';
export const DEFAULT_PORT = 3000;

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);

const HOSTNAME_PATTERN =
  /^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/;

/** Vrai si l'interface n'est joignable que depuis la machine elle-même. */
export function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  if (LOOPBACK_HOSTS.has(normalized)) return true;
  // 127.0.0.0/8 : toute la plage de boucle locale IPv4.
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(normalized);
}

/**
 * Retourne l'interface d'écoute. Vide ou absente : boucle locale.
 * Lève une erreur si la valeur fournie n'est ni une IP ni un nom d'hôte.
 */
export function resolveHost(raw: string | undefined): string {
  const host = (raw ?? '').trim();
  if (host === '') return DEFAULT_HOST;
  if (isIP(host) !== 0) return host;
  if (HOSTNAME_PATTERN.test(host)) return host;
  throw new Error(`HOST invalide : « ${raw} »`);
}

/**
 * Retourne le port d'écoute. Vide ou absent : 3000.
 * Lève une erreur si la valeur n'est pas un entier entre 1 et 65535.
 */
export function resolvePort(raw: string | undefined): number {
  const value = (raw ?? '').trim();
  if (value === '') return DEFAULT_PORT;
  if (!/^\d{1,5}$/.test(value)) {
    throw new Error(`PORT invalide : « ${raw} » (entier entre 1 et 65535 attendu)`);
  }
  const port = Number(value);
  if (port < 1 || port > 65_535) {
    throw new Error(`PORT invalide : « ${raw} » (entier entre 1 et 65535 attendu)`);
  }
  return port;
}
