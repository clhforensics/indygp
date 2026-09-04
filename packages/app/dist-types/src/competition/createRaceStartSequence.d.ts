export interface RaceStartSequence {
    readonly holding: boolean;
    start(): void;
    update(dt: number): void;
}
export declare function createRaceStartSequence(): RaceStartSequence;
//# sourceMappingURL=createRaceStartSequence.d.ts.map