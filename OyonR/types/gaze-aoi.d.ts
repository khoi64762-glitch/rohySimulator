import type { GazeAoi } from './gaze';

export interface DomRectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface ScreenGeometry {
  innerWidth: number;
  innerHeight: number;
  screenX?: number;
  screenY?: number;
  outerWidth?: number;
  outerHeight?: number;
  screenWidth?: number;
  screenHeight?: number;
}

export interface DomAoiOptions {
  /** Stable semantic id persisted in gaze.aoi_dwell_ms. Default "target". */
  id?: string;
  /** Fractional sub-region inside the DOM rect. Default: the full rect. */
  region?: { left: number; top: number; width: number; height: number };
  /** Minimum width/height in normalized gaze units. Default 0. */
  minSize?: number;
}

export function domRectToGazeAoi(
  rect: DomRectLike | null,
  environment: ScreenGeometry | null,
  options?: DomAoiOptions,
): GazeAoi | null;

export function elementToGazeAoi(
  element: Element | null,
  options?: DomAoiOptions,
): GazeAoi | null;
