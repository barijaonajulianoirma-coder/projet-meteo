/**
 * Déduplication des opérations identiques en cours (request coalescing).
 *
 * Deux requêtes simultanées sur la même clé partagent le même travail amont,
 * qu'elles soient identiques ou non (par exemple une analyse et un historique
 * qui demandent le même segment annuel). L'entrée est supprimée dès que la
 * promesse se règle, succès ou échec, afin qu'une nouvelle tentative reparte.
 */
export class InflightRequests<T> {
  private readonly pending = new Map<string, Promise<T>>();

  get size(): number {
    return this.pending.size;
  }

  run(key: string, task: () => Promise<T>): Promise<T> {
    const existing = this.pending.get(key);
    if (existing) return existing;

    // `Promise.resolve().then(task)` évite de démarrer la tâche avant que la
    // promesse ne soit enregistrée, même si `task` lève immédiatement.
    const promise = Promise.resolve()
      .then(task)
      .finally(() => {
        this.pending.delete(key);
      });
    this.pending.set(key, promise);
    return promise;
  }
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('Aborted', 'AbortError');
}

/**
 * Rend une promesse partagée annulable du point de vue d'un seul appelant.
 *
 * Le travail partagé continue en arrière-plan (et remplit le cache) même si le
 * client qui l'a déclenché se déconnecte : sans cela, annuler une requête
 * ferait échouer tous les autres appelants qui attendent le même résultat.
 */
export function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abortReason(signal));

  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(abortReason(signal));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}
