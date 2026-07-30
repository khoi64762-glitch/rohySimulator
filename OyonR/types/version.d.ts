export const OYON_VERSION: string;
export const OYON_HOST_CONTRACT_VERSION: string;

/** The batch schema Oyon emits. v4 added the `modality` discriminator. */
export const OYON_WINDOW_BATCH_SCHEMA_VERSION: 'oyon-window-batch-v4';

/** Schemas the validator accepts. v3 stays supported for hosts on the older contract. */
export const OYON_SUPPORTED_WINDOW_BATCH_SCHEMA_VERSIONS: readonly string[];

/** Modality a window may declare. `emotion` is the camera pipeline's own window. */
export type OyonModality =
  | 'emotion'
  | 'engagement'
  | 'facial'
  | 'gaze'
  | 'heart_rate'
  | 'posture'
  | 'respiration'
  | 'illumination'
  | 'typing'
  | 'voice';

export const OYON_MODALITIES: readonly OyonModality[];

/** Fixed-interval camera window, or a host-bounded episode (typing, voice). */
export type OyonWindowKind = 'interval' | 'episode';

export const OYON_WINDOW_KINDS: readonly OyonWindowKind[];
