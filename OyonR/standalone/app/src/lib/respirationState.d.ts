import type { RespirationSampleSnapshot } from './runtime';

export type RespirationPhase = 'measured' | 'confirming' | 'acquiring' | 'unconfirmed';

export function respirationPhase(sample: RespirationSampleSnapshot | null | undefined): RespirationPhase;
export function respirationStatusText(sample: RespirationSampleSnapshot | null | undefined): string;
