/**
 * Protection contre les attaques par force brute sur la connexion.
 *
 * Compteur en mémoire par adresse IP : au-delà de `maxAttempts` échecs dans la
 * fenêtre, l'IP est verrouillée pendant `lockoutMs`. Une connexion réussie
 * remet le compteur à zéro. Suffisant pour une instance unique ; à remplacer
 * par un stockage partagé en cas de déploiement multi-instances.
 */
export interface BruteForceOptions {
  maxAttempts?: number;
  windowMs?: number;
  lockoutMs?: number;
  now?: () => number;
}

export class LoginThrottle {
  readonly maxAttempts: number;
  readonly windowMs: number;
  readonly lockoutMs: number;

  private readonly attempts = new Map<string, { count: number; firstAt: number; lockedUntil: number }>();
  private readonly now: () => number;

  constructor(options: BruteForceOptions = {}) {
    this.maxAttempts = options.maxAttempts ?? 5;
    this.windowMs = options.windowMs ?? 15 * 60 * 1000;
    this.lockoutMs = options.lockoutMs ?? 15 * 60 * 1000;
    this.now = options.now ?? Date.now;
  }

  /** Secondes restantes de verrouillage (0 si l'accès n'est pas verrouillé). */
  retryAfterSeconds(key: string): number {
    const entry = this.attempts.get(key);
    if (!entry) return 0;
    const remaining = entry.lockedUntil - this.now();
    if (remaining <= 0) {
      if (entry.lockedUntil > 0) this.attempts.delete(key);
      return 0;
    }
    return Math.ceil(remaining / 1000);
  }

  isLocked(key: string): boolean {
    return this.retryAfterSeconds(key) > 0;
  }

  /** Enregistre un échec et retourne true si le verrou vient d'être posé. */
  recordFailure(key: string): boolean {
    const now = this.now();
    const entry = this.attempts.get(key);

    if (!entry || (entry.lockedUntil === 0 && now - entry.firstAt > this.windowMs)) {
      this.attempts.set(key, { count: 1, firstAt: now, lockedUntil: 0 });
      return false;
    }

    entry.count += 1;
    if (entry.count >= this.maxAttempts) {
      entry.lockedUntil = now + this.lockoutMs;
      return true;
    }
    return false;
  }

  reset(key: string): void {
    this.attempts.delete(key);
  }

  /** Purge les entrées expirées (appelé périodiquement pour borner la mémoire). */
  prune(): void {
    const now = this.now();
    for (const [key, entry] of this.attempts) {
      const expired =
        entry.lockedUntil > 0 ? entry.lockedUntil <= now : now - entry.firstAt > this.windowMs;
      if (expired) this.attempts.delete(key);
    }
  }

  get size(): number {
    return this.attempts.size;
  }
}
