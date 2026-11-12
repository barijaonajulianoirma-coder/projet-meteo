/**
 * Accès à `node:sqlite` via `createRequire`.
 *
 * Vite 6 (utilisé par Vitest) ne reconnaît pas encore `node:sqlite` comme
 * module natif et tente de le résoudre comme un fichier. Ce shim isole
 * l'import pour que les tests puissent charger la couche base.
 */
import { createRequire } from 'node:module';
import type * as NodeSqlite from 'node:sqlite';

const require = createRequire(import.meta.url);
const sqlite = require('node:sqlite') as typeof NodeSqlite;

export const DatabaseSync = sqlite.DatabaseSync;
export type DatabaseSync = NodeSqlite.DatabaseSync;
