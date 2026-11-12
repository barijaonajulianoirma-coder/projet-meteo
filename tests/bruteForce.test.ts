/**
 * Tests -- protection contre la force brute.
 */
import { describe, expect, it } from 'vitest';
import { LoginThrottle } from '../server/lib/bruteForce.js';

function clock(start = 0): { now: () => number; advance: (ms: number) => void } {
  let current = start;
  return {
    now: () => current,
    advance: (ms: number) => {
      current += ms;
    },
  };
}

describe('LoginThrottle', () => {
  it("ne verrouille pas avant le seuil", () => {
    const throttle = new LoginThrottle({ now: clock().now });
    for (let i = 0; i < 4; i += 1) {
      expect(throttle.recordFailure('1.2.3.4')).toBe(false);
    }
    expect(throttle.isLocked('1.2.3.4')).toBe(false);
  });

  it('verrouille au 5e échec et signale le délai', () => {
    const c = clock();
    const throttle = new LoginThrottle({ now: c.now, lockoutMs: 60_000 });
    for (let i = 0; i < 4; i += 1) throttle.recordFailure('1.2.3.4');
    expect(throttle.recordFailure('1.2.3.4')).toBe(true);
    expect(throttle.isLocked('1.2.3.4')).toBe(true);
    expect(throttle.retryAfterSeconds('1.2.3.4')).toBe(60);
  });

  it('libère après la durée de verrouillage', () => {
    const c = clock();
    const throttle = new LoginThrottle({ now: c.now, lockoutMs: 10_000 });
    for (let i = 0; i < 5; i += 1) throttle.recordFailure('ip');
    expect(throttle.isLocked('ip')).toBe(true);
    c.advance(10_001);
    expect(throttle.isLocked('ip')).toBe(false);
  });

  it('oublie les échecs anciens hors fenêtre', () => {
    const c = clock();
    const throttle = new LoginThrottle({ now: c.now, windowMs: 1_000 });
    throttle.recordFailure('ip');
    c.advance(1_001);
    throttle.recordFailure('ip');
    expect(throttle.isLocked('ip')).toBe(false);
    expect(throttle.size).toBe(1);
  });

  it('réinitialise après une connexion réussie', () => {
    const throttle = new LoginThrottle();
    for (let i = 0; i < 4; i += 1) throttle.recordFailure('ip');
    throttle.reset('ip');
    expect(throttle.size).toBe(0);
    expect(throttle.isLocked('ip')).toBe(false);
  });

  it('isole les adresses IP', () => {
    const throttle = new LoginThrottle();
    for (let i = 0; i < 5; i += 1) throttle.recordFailure('10.0.0.1');
    expect(throttle.isLocked('10.0.0.1')).toBe(true);
    expect(throttle.isLocked('10.0.0.2')).toBe(false);
  });

  it('purge les entrées expirées', () => {
    const c = clock();
    const throttle = new LoginThrottle({ now: c.now, windowMs: 1_000, lockoutMs: 500 });
    for (let i = 0; i < 5; i += 1) throttle.recordFailure('ip');
    c.advance(501);
    throttle.prune();
    expect(throttle.size).toBe(0);
  });
});
