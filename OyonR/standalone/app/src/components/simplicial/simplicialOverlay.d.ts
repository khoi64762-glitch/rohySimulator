declare module '@/components/simplicial/simplicialOverlay.js' {
  export interface SimPathway {
    parts: string[];
    ids: string[];
    count: number;
    order: number;
    hypa?: unknown;
  }
  export function drawSimplicialOverlay(
    host: HTMLElement,
    pathways: SimPathway[],
    opts?: { baseStates?: string[]; colorBy?: string; height?: number; showLabels?: boolean; label?: string },
  ): void;
}
