import type {
  ForwardRefExoticComponent,
  HTMLAttributes,
  RefAttributes,
} from 'react';
import type {
  CalibrationResult,
  GazeCalibrationPhaseEvent,
  GazeCalibrationPoint,
  GazeCalibrationProgressEvent,
} from './gaze.js';

export interface GazeCalibrationRuntime {
  calibrateGaze(points: GazeCalibrationPoint[]): Promise<CalibrationResult>;
}

export interface GazeCalibrationPanelHandle {
  start(
    runtime?: GazeCalibrationRuntime,
    options?: { viewport?: { width: number; height: number } },
  ): Promise<CalibrationResult>;
  abort(reason?: string): void;
  element(): HTMLElement | null;
}

export interface GazeCalibrationPanelProps extends Omit<
  HTMLAttributes<HTMLElement>,
  'onStart' | 'onProgress' | 'onAbort'
> {
  runtime?: GazeCalibrationRuntime;
  autoStart?: boolean;
  points?: GazeCalibrationPoint[];
  fixationMs?: number;
  captureMs?: number;
  onStart?: (detail: { totalPoints: number }) => void;
  onShow?: (detail: GazeCalibrationPhaseEvent) => void;
  onCapture?: (detail: GazeCalibrationPhaseEvent) => void;
  onProgress?: (detail: GazeCalibrationProgressEvent) => void;
  onComplete?: (detail: { result: CalibrationResult }) => void;
  onAbort?: (detail: { reason: string }) => void;
}

export const GazeCalibrationPanel: ForwardRefExoticComponent<
  GazeCalibrationPanelProps & RefAttributes<GazeCalibrationPanelHandle>
>;

export default GazeCalibrationPanel;

export type {
  CalibrationResult,
  GazeCalibrationPhaseEvent,
  GazeCalibrationPoint,
  GazeCalibrationProgressEvent,
} from './gaze.js';
