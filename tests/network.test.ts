/**
 * Tests -- interface d'écoute du serveur.
 * La boucle locale doit être le comportement par défaut.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_HOST,
  DEFAULT_PORT,
  isLoopbackHost,
  resolveHost,
  resolvePort,
} from '../server/lib/network.js';

describe('resolveHost', () => {
  it('écoute la boucle locale par défaut', () => {
    expect(resolveHost(undefined)).toBe('127.0.0.1');
    expect(resolveHost('')).toBe('127.0.0.1');
    expect(resolveHost('   ')).toBe('127.0.0.1');
    expect(DEFAULT_HOST).toBe('127.0.0.1');
  });

  it('accepte une interface explicite', () => {
    expect(resolveHost('0.0.0.0')).toBe('0.0.0.0');
    expect(resolveHost('192.168.1.20')).toBe('192.168.1.20');
    expect(resolveHost('::1')).toBe('::1');
    expect(resolveHost('localhost')).toBe('localhost');
    expect(resolveHost(' meteo.local ')).toBe('meteo.local');
  });

  it('rejette une valeur invalide', () => {
    expect(() => resolveHost('0.0.0.0/0')).toThrow(/HOST invalide/);
    expect(() => resolveHost('127.0.0.1:3000')).toThrow(/HOST invalide/);
    expect(() => resolveHost('hôte local')).toThrow(/HOST invalide/);
  });
});

describe('resolvePort', () => {
  it('utilise le port 3000 par défaut', () => {
    expect(resolvePort(undefined)).toBe(3000);
    expect(resolvePort('')).toBe(3000);
    expect(resolvePort('  ')).toBe(3000);
    expect(DEFAULT_PORT).toBe(3000);
  });

  it('accepte un port explicite', () => {
    expect(resolvePort('8080')).toBe(8080);
    expect(resolvePort(' 1 ')).toBe(1);
    expect(resolvePort('3000 ')).toBe(3000);
    expect(resolvePort('65535')).toBe(65535);
  });

  it('rejette un port invalide', () => {
    expect(() => resolvePort('0')).toThrow(/PORT invalide/);
    expect(() => resolvePort('65536')).toThrow(/PORT invalide/);
    expect(() => resolvePort('-1')).toThrow(/PORT invalide/);
    expect(() => resolvePort('abc')).toThrow(/PORT invalide/);
    expect(() => resolvePort('3000.5')).toThrow(/PORT invalide/);
  });
});

describe('isLoopbackHost', () => {
  it('reconnaît les interfaces locales', () => {
    expect(isLoopbackHost('127.0.0.1')).toBe(true);
    expect(isLoopbackHost('127.0.1.1')).toBe(true);
    expect(isLoopbackHost('::1')).toBe(true);
    expect(isLoopbackHost('localhost')).toBe(true);
  });

  it('signale une exposition réseau', () => {
    expect(isLoopbackHost('0.0.0.0')).toBe(false);
    expect(isLoopbackHost('192.168.1.20')).toBe(false);
    expect(isLoopbackHost('meteo.local')).toBe(false);
  });
});
