export type VehicleLiveryId = 'midnight' | 'azure' | 'heritage';

export interface VehicleLivery {
  id: VehicleLiveryId;
  label: string;
  body: number;
  bodyHighlight: number;
  carbon: number;
  carbonEdge: number;
  accentPrimary: number;
  accentSecondary: number;
  helmet: number;
  cockpit: number;
  tyre: number;
  rim: number;
  brake: number;
}

export const DEFAULT_VEHICLE_LIVERY_ID: VehicleLiveryId = 'midnight';

export const VEHICLE_LIVERIES: Record<VehicleLiveryId, VehicleLivery> = {
  midnight: {
    id: 'midnight',
    label: 'Midnight',
    body: 0x061426,
    bodyHighlight: 0x102a4a,
    carbon: 0x020305,
    carbonEdge: 0x101317,
    accentPrimary: 0xb7192d,
    accentSecondary: 0xf3c515,
    helmet: 0xf3c515,
    cockpit: 0x020304,
    tyre: 0x050505,
    rim: 0x16191e,
    brake: 0x555b62,
  },
  azure: {
    id: 'azure',
    label: 'Azure',
    body: 0x0b3f7c,
    bodyHighlight: 0x2266a6,
    carbon: 0x030509,
    carbonEdge: 0x151a21,
    accentPrimary: 0xe05b9e,
    accentSecondary: 0x8edcff,
    helmet: 0x8edcff,
    cockpit: 0x020407,
    tyre: 0x050505,
    rim: 0x202732,
    brake: 0x656d77,
  },
  heritage: {
    id: 'heritage',
    label: 'Heritage',
    body: 0xf1efe8,
    bodyHighlight: 0xd7d3ca,
    carbon: 0x030304,
    carbonEdge: 0x151619,
    accentPrimary: 0xc8102e,
    accentSecondary: 0x111318,
    helmet: 0xc8102e,
    cockpit: 0x050506,
    tyre: 0x050505,
    rim: 0x111318,
    brake: 0x666a70,
  },
};

const VEHICLE_LIVERY_ALIASES: Record<string, VehicleLiveryId> = {
  reference: 'midnight',
  navy: 'midnight',
  blue: 'azure',
  pink: 'azure',
  white: 'heritage',
  red: 'heritage',
  'white-red': 'heritage',
};

export function resolveVehicleLivery(value?: string | null): VehicleLivery {
  const normalized = value?.trim().toLowerCase();

  if (!normalized) {
    return VEHICLE_LIVERIES[DEFAULT_VEHICLE_LIVERY_ID];
  }

  if (normalized in VEHICLE_LIVERIES) {
    return VEHICLE_LIVERIES[normalized as VehicleLiveryId];
  }

  const alias = VEHICLE_LIVERY_ALIASES[normalized];
  return VEHICLE_LIVERIES[alias ?? DEFAULT_VEHICLE_LIVERY_ID];
}
