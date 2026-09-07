import * as THREE from 'three';
import { createVehicle, type VehicleView } from './createVehicle';
import { TEAMS, GRID_TEAM_ORDER, type TeamSpec } from '@indygp/core';

export interface OpponentView extends VehicleView {
  id: string;
  team: TeamSpec;
}

/**
 * TEAMS-V1: grid slots are filled from GRID_TEAM_ORDER (5 teams x 2 cars).
 * requestedCount may be 1..10; each opponent carries its own TeamSpec so the
 * competition layer can seed driver profiles from team pace bias.
 */
export function createOpponentGrid(
  scene: THREE.Scene,
  requestedCount: number
): OpponentView[] {
  const count = Math.max(0, Math.min(GRID_TEAM_ORDER.length, Math.floor(requestedCount)));

  return Array.from({ length: count }, (_, index) => {
    const team = TEAMS.find((t) => t.id === GRID_TEAM_ORDER[index]) ?? TEAMS[0];
    return {
      id: `opponent-${index + 1}`,
      team,
      ...createVehicle(scene, undefined, team),
    };
  });
}
