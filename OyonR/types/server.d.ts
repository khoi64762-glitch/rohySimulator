// Type declarations for `oyon/server` and `oyon/server/express`.
// Backend receivers for Oyon window batches. Persistence is always
// host-supplied — Oyon never imports a DB client.

export interface OyonBatchPersistArgs {
  /** The validated, session-pinned window events to write. */
  events: Array<Record<string, unknown>>;
  /** The route's session id (null when routing without one). */
  sessionId: string | null;
  /** Whatever `verifyToken` returned (null when no auth was configured). */
  auth: unknown;
}

export interface OyonBatchHandlerOptions {
  /**
   * REQUIRED. Idempotently write the events to your store (dedupe on
   * session_id + record_id). Return the inserted count, or nothing.
   */
  persist: (args: OyonBatchPersistArgs) => number | void | Promise<number | void>;
  /**
   * Validate the Authorization header. Return a truthy auth object to allow,
   * falsy to 401. Omit for local/no-auth backends.
   */
  verifyToken?: (authorization: string | null) => unknown | Promise<unknown>;
  /** Max events per batch (shape guard). Default 64. */
  maxBatchEvents?: number;
  /** Reject events whose session_id differs from the route's. Default true. */
  pinSessionId?: boolean;
}

export interface OyonBatchRequest {
  body: unknown;
  sessionId?: string | null;
  authorization?: string | null;
}

export interface OyonBatchResponse {
  status: number;
  body: Record<string, unknown>;
}

/** Framework-neutral batch handler: takes a plain request, returns { status, body }. */
export function createOyonBatchHandler(
  options: OyonBatchHandlerOptions,
): (req: OyonBatchRequest) => Promise<OyonBatchResponse>;

export interface OyonExpressBatchOptions extends OyonBatchHandlerOptions {
  /** Route param holding the session id. Default 'sessionId'. */
  sessionParam?: string;
}

/** Express/Connect request handler wrapping createOyonBatchHandler. */
export function createOyonExpressBatch(
  options: OyonExpressBatchOptions,
): (req: any, res: any) => Promise<void>;
