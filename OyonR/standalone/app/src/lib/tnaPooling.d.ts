export interface BuildSessionSequencesOptions {
  stateOf?: (record: unknown) => string;
  orderOf?: (record: unknown) => number;
  groupOf?: (record: unknown) => string;
}

export declare function buildSessionSequences(
  records: unknown[],
  options?: BuildSessionSequencesOptions,
): string[][];

export declare function buildEventSequences(
  events: unknown[],
  modality?: string | null,
): string[][];

export declare function pooledTransitionCounts(sequences: string[][]): Map<string, number>;
