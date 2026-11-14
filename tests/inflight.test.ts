import { describe, expect, it } from 'vitest';
import { abortable, InflightRequests } from '../server/lib/inflight.js';

describe('InflightRequests', () => {
  it('partage une seule exécution pour deux appels simultanés', async () => {
    const inflight = new InflightRequests<number>();
    let calls = 0;
    let release!: (value: number) => void;

    const task = (): Promise<number> => {
      calls += 1;
      return new Promise<number>((resolve) => {
        release = resolve;
      });
    };

    const first = inflight.run('meteo:1', task);
    const second = inflight.run('meteo:1', task);
    expect(inflight.size).toBe(1);

    // La tâche démarre en microtâche, une fois la promesse enregistrée.
    await Promise.resolve();
    expect(calls).toBe(1);

    release(42);
    await expect(Promise.all([first, second])).resolves.toEqual([42, 42]);
    expect(inflight.size).toBe(0);
  });

  it('relance la tâche après la fin de la précédente', async () => {
    const inflight = new InflightRequests<number>();
    let calls = 0;
    const task = async (): Promise<number> => {
      calls += 1;
      return calls;
    };

    await expect(inflight.run('k', task)).resolves.toBe(1);
    await expect(inflight.run('k', task)).resolves.toBe(2);
    expect(calls).toBe(2);
  });

  it("libère l'entrée après un échec pour permettre une nouvelle tentative", async () => {
    const inflight = new InflightRequests<string>();
    let attempt = 0;

    await expect(
      inflight.run('k', async () => {
        attempt += 1;
        throw new Error('amont indisponible');
      }),
    ).rejects.toThrow('amont indisponible');
    expect(inflight.size).toBe(0);

    await expect(
      inflight.run('k', async () => {
        attempt += 1;
        return 'ok';
      }),
    ).resolves.toBe('ok');
    expect(attempt).toBe(2);
  });

  it('ne partage pas le travail entre deux clés différentes', async () => {
    const inflight = new InflightRequests<string>();
    const values: string[] = [];

    await Promise.all([
      inflight.run('a', async () => 'valeur-a'),
      inflight.run('b', async () => 'valeur-b'),
    ]).then((results) => values.push(...results));

    expect(values).toEqual(['valeur-a', 'valeur-b']);
  });
});

describe('abortable', () => {
  it('rejette immédiatement un signal déjà annulé', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(abortable(Promise.resolve(1), controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
  });

  it("n'interrompt pas le travail partagé quand un appelant annule", async () => {
    let release!: (value: string) => void;
    const shared = new Promise<string>((resolve) => {
      release = resolve;
    });
    const controller = new AbortController();

    const caller = abortable(shared, controller.signal);
    controller.abort();
    await expect(caller).rejects.toMatchObject({ name: 'AbortError' });

    release('résultat partagé');
    await expect(shared).resolves.toBe('résultat partagé');
  });

  it('résout normalement sans signal', async () => {
    await expect(abortable(Promise.resolve('ok'))).resolves.toBe('ok');
  });
});
