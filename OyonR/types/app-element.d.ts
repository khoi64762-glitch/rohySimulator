import type { EmotionWindow } from './index.js';
import type { GazeAoi } from './gaze.js';

/** Public host API installed by the side-effect-only `oyon/app-element` entry. */
export interface OyonAppElement extends HTMLElement {
  readonly version: string;
  readonly hostContractVersion: string;
  getToken: (() => string | null | Promise<string | null>) | null;
  start(): Promise<void>;
  stop(): Promise<void>;
  setWindows(windows: EmotionWindow[] | null): void;
  setGazeAois(aois: GazeAoi[] | null): void;
}

export interface OyonAppElementConstructor extends CustomElementConstructor {
  readonly version: string;
  readonly hostContractVersion: string;
  new (): OyonAppElement;
}

export interface OyonWindowEventDetail {
  windows: EmotionWindow[];
  sessionId: string;
  userId: string;
  oyonVersion: string;
  contractVersion: string;
}

export interface OyonStatusEventDetail {
  state: string;
  oyonVersion: string;
  contractVersion: string;
}

export interface OyonSampleEventDetail {
  dominant: string | null;
  confidence: number;
  valence: number | null;
  arousal: number | null;
  probabilities: Record<string, number>;
  face: { x: number; y: number; width: number; height: number } | null;
  ts: number;
  oyonVersion: string;
  contractVersion: string;
}

export interface OyonOpenAnalyticsEventDetail {
  sessionId: string;
  userId: string | null;
  oyonVersion: string;
  contractVersion: string;
}

declare global {
  interface HTMLElementTagNameMap {
    'oyon-app': OyonAppElement;
  }

  interface HTMLElementEventMap {
    'oyon:window': CustomEvent<OyonWindowEventDetail>;
    'oyon:status': CustomEvent<OyonStatusEventDetail>;
    'oyon:sample': CustomEvent<OyonSampleEventDetail>;
    'oyon:open-analytics': CustomEvent<OyonOpenAnalyticsEventDetail>;
  }

  interface CustomElementRegistry {
    get(name: 'oyon-app'): OyonAppElementConstructor | undefined;
  }
}
