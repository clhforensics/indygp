import * as THREE from 'three';
import { createVehicle, type VehicleView } from './createVehicle';
import type { VehicleLiveryId } from './liveries';

export interface OpponentView extends VehicleView {
  id: string;
  livery: VehicleLiveryId;
}

const OPPONENT_LIVERIES: VehicleLiveryId[] = [
  'azure',
  'heritage',
  'midnight',
];

export function createOpponentGrid(
  scene: THREE.Scene,
  requestedCount: number
): OpponentView[] {
  const count = Math.max(0, Math.min(OPPONENT_LIVERIES.length, Math.floor(requestedCount)));

  return OPPONENT_LIVERIES.slice(0, count).map((livery, index) => ({
    id: `opponent-${index + 1}`,
    livery,
    ...createVehicle(scene, livery),
  }));
}
