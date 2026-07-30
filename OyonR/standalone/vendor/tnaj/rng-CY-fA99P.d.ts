/**
 * Seeded pseudo-random number generator.
 * Uses xoshiro128** (32-bit) for reproducible randomness without BigInt overhead.
 */
declare class SeededRNG {
    private s0;
    private s1;
    private s2;
    private s3;
    constructor(seed: number);
    /** Generate next random 32-bit unsigned integer (xoshiro128**). */
    private next;
    /** Generate a random float in [0, 1). */
    random(): number;
    /** Generate a random integer in [0, max). */
    randInt(max: number): number;
    /** Fisher-Yates shuffle (in-place). */
    shuffle<T>(arr: T[]): T[];
    /** Generate a random permutation of indices [0, n). */
    permutation(n: number): number[];
    /** Random choice with replacement: pick `size` items from [0, n). */
    choice(n: number, size: number): number[];
    /** Random choice WITHOUT replacement: pick `size` items from [0, n). */
    choiceWithoutReplacement(n: number, size: number): number[];
}

export { SeededRNG as S };
