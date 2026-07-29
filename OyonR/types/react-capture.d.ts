// Type declarations for `oyon/react/capture` — the drop-in <OyonCapture>.
import type { ReactNode, ReactElement } from 'react';

export interface OyonCaptureUseResult {
  status: string;
  error: unknown;
  lastWindow: Record<string, unknown> | null;
  start: () => Promise<void> | void;
  stop: () => Promise<void> | void;
  pause: () => void;
  resume: () => void;
  runtime: unknown;
}

export interface OyonCaptureProps {
  /** Base URL of your batch endpoint (omit for local-only, no backend). */
  apiBaseUrl?: string;
  /** Identity/context; session_id required, other keys ride along per window. */
  getContext?: () => Record<string, unknown>;
  /** Alias for getContext. */
  getSession?: () => Record<string, unknown>;
  /** Shorthand: build getContext from these when getContext is not given. */
  sessionId?: string;
  userId?: string;
  courseId?: string;
  context?: Record<string, unknown>;
  /** Bearer token provider for your API. */
  getToken?: () => string | null | Promise<string | null>;
  /** Per-batch callback (windows already POST to apiBaseUrl). */
  onWindow?: (windows: Array<Record<string, unknown>>) => void;
  /** When false the control is inert (no runtime). Default true. */
  enabled?: boolean;
  /** Override the per-session path appended to apiBaseUrl. */
  endpointForSession?: (sessionId: string) => string;
  /** Passed through to EmotionRuntime (settings, …). */
  runtimeOptions?: Record<string, unknown>;
  /** Render-prop for full control; receives the useOyon result. */
  render?: (fer: OyonCaptureUseResult) => ReactNode;
  /** Class for the default UI container. */
  className?: string;
  /** Override default button captions. */
  labels?: { start?: string; stop?: string; pause?: string; resume?: string };
}

export function OyonCapture(props: OyonCaptureProps): ReactElement | null;
export default OyonCapture;
