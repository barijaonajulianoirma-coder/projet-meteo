/**
 * Configuration Vitest séparée de Vite.
 * Les fichiers server/etl utilisent des imports .js (convention ESM Node) mais les sources sont .ts.
 * On mappe tous les modules partagés avec des alias explicites.
 */
import { defineConfig } from 'vitest/config';
import path from 'node:path';

const root = path.resolve(import.meta.dirname);

// Alias : mappe les imports ../../shared/xxx.js -> shared/xxx.ts
// Nécessaire car le code server utilise la convention ESM Node (.js) et Vitest cherche les vrais fichiers.
const sharedModules = ['analysis', 'csv', 'dates', 'schemas', 'sources', 'stats', 'types', 'weatherCodes'];
const sharedAliases = sharedModules.flatMap((name) => [
  { find: `../../shared/${name}.js`, replacement: path.join(root, 'shared', `${name}.ts`) },
  { find: `../shared/${name}.js`, replacement: path.join(root, 'shared', `${name}.ts`) },
  { find: `./shared/${name}.js`, replacement: path.join(root, 'shared', `${name}.ts`) },
]);

const serverModules = ['cache', 'concurrency', 'errors', 'http', 'openMeteo'];
const serverAliases = serverModules.flatMap((name) => [
  { find: `./${name}.js`, replacement: path.join(root, 'server', 'lib', `${name}.ts`) },
  { find: `../server/lib/${name}.js`, replacement: path.join(root, 'server', 'lib', `${name}.ts`) },
]);

// Le pipeline ETL importe ses propres modules avec l'extension .js.
const etlModules = ['cli', 'config', 'db', 'extract', 'migrations', 'run', 'sqlite', 'transform'];
const etlAliases = etlModules.flatMap((name) => [
  { find: `./${name}.js`, replacement: path.join(root, 'etl', `${name}.ts`) },
  { find: `../etl/${name}.js`, replacement: path.join(root, 'etl', `${name}.ts`) },
]);

const alias = [...sharedAliases, ...serverAliases, ...etlAliases];

export default defineConfig({
  resolve: { alias },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    restoreMocks: true,
    alias,
  },
});
