/* =============================================================================
   LAYER 2 - CIRCUIT
   The course as pure data, extracted verbatim from IndyGP_Phase1.html.
   ========================================================================== */

export type TurnHand = 'L' | 'R';

export interface CircuitNode {
  x: number;
  z: number;
  r: number;
  turn?: number;
  dir?: TurnHand;
  name?: string;
  note?: string;
}

/** A numbered corner, resolved against the built centreline. */
export interface TurnInfo {
  n: number;
  dir: TurnHand;
  name: string;
  note: string;
  x: number;
  z: number;
  s: number;
  index: number;
  radius: number;
  lap: number;
}

/* ---------- begin verbatim Layer 2 ---------- */

export const AVE: Readonly<Record<string, number>> = { WHITE_RIVER:-600, WEST:0, MISSOURI:150, SENATE:280, CAPITOL:410,
              ILLINOIS:540, MERIDIAN:680, PENN:820, DELAWARE:960, ALABAMA:1090 };
export const ST: Readonly<Record<string, number>> = { NORTH:-540, NEW_YORK:-410, OHIO:-270, MARKET:-130, WASHINGTON:0,
              MARYLAND:130, GEORGIA:250, SOUTH:400, MCCARTY:530 };
export const CIRCLE = { x:AVE.MERIDIAN, z:ST.MARKET, r:55 };

/* Two intermediate points carry the car around the Monument at a constant
   radius; without them a fillet would cut straight across the plaza. */
export const CIRC_45 = { x: CIRCLE.x + CIRCLE.r*Math.SQRT1_2, z: CIRCLE.z + CIRCLE.r*Math.SQRT1_2 };

export const NODES: CircuitNode[] = [
  { x:AVE.WEST,        z:ST.WASHINGTON, r:24, turn:13, dir:'L', name:'W Washington St',  note:'Onto the front straight' },
  { x:AVE.MERIDIAN,    z:ST.WASHINGTON, r:22, turn:1,  dir:'L', name:'Meridian St',      note:'Left off the straight' },
  { x:AVE.MERIDIAN,    z:CIRCLE.z+CIRCLE.r, r:26, turn:2, dir:'R', name:'Monument Circle', note:'Onto the Circle' },
  { x:CIRC_45.x,       z:CIRC_45.z,     r:CIRCLE.r },
  { x:CIRCLE.x+CIRCLE.r, z:CIRCLE.z,    r:26, turn:3,  dir:'R', name:'Market St',        note:'Off the Circle' },
  { x:AVE.PENN,        z:ST.MARKET,     r:22, turn:4,  dir:'R', name:'Pennsylvania St',  note:'Long run south' },
  { x:AVE.PENN,        z:ST.SOUTH,      r:22, turn:5,  dir:'R', name:'South St',         note:'Onto South St' },
  { x:AVE.MISSOURI,    z:ST.SOUTH,      r:22, turn:6,  dir:'R', name:'Missouri St',      note:'By the stadium' },
  { x:AVE.MISSOURI,    z:320,           r:60 },
  { x:AVE.WEST,        z:220,           r:60 },
  { x:AVE.WEST,        z:ST.MARYLAND,   r:22, turn:7,  dir:'L', name:'Maryland St',      note:'Left onto Maryland' },
  { x:-160,            z:90,            r:70 },
  { x:-260,            z:20,            r:70 },
  { x:AVE.WHITE_RIVER, z:ST.WASHINGTON, r:26, turn:8,  dir:'R', name:'White River Pkwy', note:'North along the river' },
  { x:AVE.WHITE_RIVER, z:ST.NEW_YORK,   r:26, turn:9,  dir:'R', name:'New York St',      note:'Longest straight' },
  { x:AVE.CAPITOL,     z:ST.NEW_YORK,   r:22, turn:10, dir:'R', name:'Capitol Ave',      note:'Heavy braking' },
  { x:AVE.CAPITOL,     z:ST.OHIO,       r:20, turn:11, dir:'R', name:'Ohio St',          note:'Short chicane-like link' },
  { x:AVE.WEST,        z:ST.OHIO,       r:22, turn:12, dir:'L', name:'West St',          note:'Left, then hard left' }
];

/* ---------- end verbatim Layer 2 ---------- */
