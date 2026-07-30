/**
 * oyon/server — backend receivers for Oyon window batches.
 *
 * `createOyonBatchHandler` is the framework-neutral core (returns
 * `{ status, body }`); `createOyonExpressBatch` wraps it for Express/Connect.
 * Both keep persistence host-supplied — Oyon never imports a DB client.
 */
export { createOyonBatchHandler } from './batchHandler.js';
export { createOyonExpressBatch } from './express.js';
