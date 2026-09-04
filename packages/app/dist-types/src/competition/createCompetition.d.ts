import type * as THREE from 'three';
import type { Centreline } from '@indygp/core';
interface OpponentVisual {
    carRoot: THREE.Group;
    carBody: THREE.Group;
    frontAxle: THREE.Group[];
    allWheels: THREE.Mesh[];
}
interface CompetitionTurn {
    s: number;
    radius: number;
}
interface CompetitionDeps {
    CL: Centreline;
    TURNS: CompetitionTurn[];
    opponents: OpponentVisual[];
    startLineS: number;
    gridOffset: number;
}
export declare function createCompetition({ CL, TURNS, opponents, startLineS, gridOffset, }: CompetitionDeps): {
    count: number;
    step: (dt: number) => void;
    present: () => void;
    getClassification: (playerLap: number, playerProgress: number) => {
        playerPosition: number;
        fieldSize: number;
        entries: {
            totalDistance: number;
            id: string;
            label: string;
            lap: number;
            progress: number;
        }[];
    };
};
export {};
//# sourceMappingURL=createCompetition.d.ts.map