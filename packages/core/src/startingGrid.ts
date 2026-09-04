export interface StartingGridSlot {
  slot: number;
  longitudinal: number;
  lateral: number;
}

export const STARTING_GRID_SLOT_COUNT = 10;
export const PLAYER_STARTING_GRID_SLOT = 4;
export const DEFAULT_OPPONENT_GRID_SLOTS = [3, 5, 6] as const;

const STARTING_GRID_SPACING = 8.5;
const STARTING_GRID_LATERAL = 2.15;

export function getStartingGridSlot(
  requestedSlot: number,
  playerGridOffset: number
): StartingGridSlot {
  const slot = Math.max(
    1,
    Math.min(STARTING_GRID_SLOT_COUNT, Math.round(requestedSlot))
  );

  return {
    slot,
    longitudinal:
      -playerGridOffset +
      (PLAYER_STARTING_GRID_SLOT - slot) * STARTING_GRID_SPACING,
    lateral: slot % 2 === 0
      ? STARTING_GRID_LATERAL
      : -STARTING_GRID_LATERAL,
  };
}
