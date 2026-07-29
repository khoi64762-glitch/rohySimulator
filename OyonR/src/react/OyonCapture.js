import React from 'react';
import { useOyon } from './useOyon.js';

/**
 * OyonCapture — the drop-in capture control for React hosts (Vite, Next, CRA).
 *
 * The "knife into cake" front door: give it your API base + identity and it
 * captures, aggregates, and POSTs windows to your backend. Pairs with the
 * `oyon/server/express` receiver — the default endpoint
 * (`/sessions/:sessionId/emotions/batch`) matches that route as-is.
 *
 *   import { OyonCapture } from 'oyon/react/capture';
 *
 *   <OyonCapture
 *     apiBaseUrl="/api/oyon"
 *     getContext={() => ({ session_id: attempt.id, user_id: user.id, course_id: course.id })}
 *     getToken={() => auth.token}
 *   />
 *
 * Shorthand: instead of `getContext`, pass `sessionId` (+ optional `userId`,
 * `courseId`, `context`) and one is built for you. Next.js: render only in a
 * client component (`'use client'`) — the runtime touches `window`/camera.
 *
 * Local-only (no backend, data stays in the browser): omit `apiBaseUrl` and
 * `getToken`, and read windows via `onWindow`.
 *
 * @param {object} props
 * @param {string} [props.apiBaseUrl] base URL of your batch endpoint.
 * @param {() => Record<string, unknown>} [props.getContext] identity/context;
 *   `session_id` required, every other key rides along on each window.
 * @param {() => Record<string, unknown>} [props.getSession] alias for getContext.
 * @param {string} [props.sessionId] shorthand — builds getContext when it and
 *   friends are given instead of getContext.
 * @param {string} [props.userId] shorthand context key (user_id).
 * @param {string} [props.courseId] shorthand context key (course_id).
 * @param {Record<string, unknown>} [props.context] extra shorthand context keys.
 * @param {() => (string|null|Promise<string|null>)} [props.getToken] bearer token.
 * @param {(windows: object[]) => void} [props.onWindow] per-batch callback.
 * @param {boolean} [props.enabled=true] when false the control is inert.
 * @param {(sessionId: string) => string} [props.endpointForSession] override the
 *   per-session path appended to apiBaseUrl.
 * @param {object} [props.runtimeOptions] passed through to EmotionRuntime (settings…).
 * @param {(fer: object) => React.ReactNode} [props.render] render-prop for full
 *   control — receives the useOyon result ({ status, start, stop, … }); when
 *   given, the default button UI is not rendered.
 * @param {string} [props.className] class for the default UI container.
 * @param {{ start?: string, stop?: string, pause?: string, resume?: string }} [props.labels]
 *   override the default button captions.
 */
export function OyonCapture(props = {}) {
  const {
    apiBaseUrl,
    getContext,
    getSession,
    sessionId,
    userId,
    courseId,
    context,
    getToken,
    onWindow,
    enabled = true,
    endpointForSession = defaultEndpointForSession,
    runtimeOptions,
    render,
    className = 'oyon-capture',
    labels,
  } = props;

  // Shorthand: synthesize getContext from the flat props when none was passed.
  const resolveContext = getContext
    || getSession
    || (() => ({
      session_id: sessionId,
      user_id: userId,
      course_id: courseId,
      ...(context || {}),
    }));

  const fer = useOyon({
    enabled,
    apiBaseUrl,
    getToken,
    getContext: resolveContext,
    onWindow,
    runtimeOptions,
    transportOptions: { endpointForSession },
  });

  if (typeof render === 'function') return render(fer);

  const running = fer.status === 'running' || fer.status === 'starting';
  const paused = fer.status === 'paused';
  const caption = { start: 'Start capture', stop: 'Stop', pause: 'Pause', resume: 'Resume', ...(labels || {}) };

  const children = [
    !running && !paused
      ? React.createElement('button', { type: 'button', onClick: fer.start, key: 'start' }, caption.start)
      : null,
    running
      ? React.createElement('button', { type: 'button', onClick: fer.pause, key: 'pause' }, caption.pause)
      : null,
    paused
      ? React.createElement('button', { type: 'button', onClick: fer.resume, key: 'resume' }, caption.resume)
      : null,
    running || paused
      ? React.createElement('button', { type: 'button', onClick: fer.stop, key: 'stop' }, caption.stop)
      : null,
    React.createElement('span', { className: 'oyon-capture-status', key: 'status' }, `status: ${fer.status}`),
    fer.error
      ? React.createElement(
          'span',
          { className: 'oyon-capture-error', key: 'error' },
          fer.error instanceof Error ? fer.error.message : String(fer.error),
        )
      : null,
  ];

  return React.createElement('div', { className }, children);
}

function defaultEndpointForSession(sessionId) {
  return `/sessions/${sessionId}/emotions/batch`;
}

export default OyonCapture;
