#!/usr/bin/env node
/* eslint-disable */
'use strict';
/* ============================================================================
   scaffold.js — Indianapolis Grand Prix · Phase 0

   Converts IndyGP_Phase1.html into a pnpm + TypeScript workspace packaged by
   Tauri. Reads the prototype, splits it on its own layer banner comments, and
   writes each layer verbatim into a typed module.

     packages/core      Layers 1-4  config / circuit / geometry / vehicle
     packages/render    Layers 5-6  procedural textures / world meshes
     packages/platform  Layers 7-8  input / audio / HUD + maps / DOM shell
     packages/app       Layer  9    main loop, camera, offline shell
     src-tauri                      native offline 1600x900 window

   Deliberately CommonJS: this file must run before any package.json exists.
   Run with:  node scaffold.js
   ========================================================================= */

const fs = require('fs');
const path = require('path');

const SRC_FILE = process.argv[2] || 'IndyGP_Phase1.html';
const FORCE = process.argv.includes('--force');
const ROOT = process.cwd();

let filesWritten = 0;
let bytesWritten = 0;

/* ------------------------------------------------------------------ utils -- */
const C = {
  reset: '\u001b[0m', dim: '\u001b[2m', cyan: '\u001b[36m',
  green: '\u001b[32m', yellow: '\u001b[33m', red: '\u001b[31m', bold: '\u001b[1m'
};
const step = (m) => console.log('\n' + C.cyan + '[*] ' + m + C.reset);
const ok = (m) => console.log('    ' + C.green + m + C.reset);
const info = (m) => console.log('    ' + m);
const warn = (m) => console.log('    ' + C.yellow + m + C.reset);

function die(msg) {
  console.error('\n' + C.red + C.bold + 'SCAFFOLD FAILED' + C.reset);
  console.error(C.red + msg + C.reset + '\n');
  process.exit(1);
}

function write(rel, content) {
  const abs = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const body = String(content).replace(/\r\n/g, '\n').replace(/\s+$/, '') + '\n';
  fs.writeFileSync(abs, body, 'utf8');
  filesWritten++;
  bytesWritten += Buffer.byteLength(body, 'utf8');
  console.log('    ' + C.dim + '+ ' + rel.padEnd(48) +
    String(Buffer.byteLength(body, 'utf8')).padStart(9) + ' B' + C.reset);
}

function writeJson(rel, obj) {
  write(rel, JSON.stringify(obj, null, 2));
}

/* Assert-once regex edit table. Every entry MUST match exactly one time. */
function applyEdits(label, src, edits) {
  let out = src;
  for (let i = 0; i < edits.length; i++) {
    const re = edits[i][0];
    const repl = edits[i][1];
    const why = edits[i][2] || '';
    const probe = new RegExp(re.source, re.flags.replace('g', '') + 'g');
    const hits = out.match(probe);
    if (!hits) {
      die('[' + label + '] annotation pattern never matched:\n    ' + re +
        '\n    intent: ' + why +
        '\n    The prototype text differs from what this script expects.');
    }
    if (hits.length !== 1) {
      die('[' + label + '] annotation pattern matched ' + hits.length +
        ' times, expected exactly 1:\n    ' + re + '\n    intent: ' + why);
    }
    out = out.replace(re, function () { return repl; });
  }
  info(label + ': ' + edits.length + ' type annotation(s) applied, body otherwise verbatim');
  return out;
}

/* Replace the two webfont families with offline system stacks. */
function stripWebfonts(text) {
  let n = 0;
  const swap = (needle, replacement) => {
    let idx = text.indexOf(needle);
    while (idx !== -1) {
      text = text.slice(0, idx) + replacement + text.slice(idx + needle.length);
      n++;
      idx = text.indexOf(needle, idx + replacement.length);
    }
  };
  swap('"Barlow Condensed", Arial Narrow, sans-serif', '"Arial Narrow", Arial, sans-serif');
  swap('"Barlow Condensed", sans-serif', '"Arial Narrow", Arial, sans-serif');
  swap('"IBM Plex Mono", monospace', 'Consolas, "Courier New", monospace');
  return { text: text, count: n };
}

/* Indent a block so nested slices stay readable inside a wrapper function. */
function indent(text, pad) {
  return text.split('\n').map(function (l) {
    return l.length ? pad + l : l;
  }).join('\n');
}

/* ======================================================= 0. READ + VERIFY == */
console.log('');
console.log(C.bold + '  INDIANAPOLIS GRAND PRIX -- Phase 0 workspace scaffold' + C.reset);
console.log(C.dim + '  -----------------------------------------------------' + C.reset);

step('Reading and verifying the prototype');

const srcPath = path.join(ROOT, SRC_FILE);
if (!fs.existsSync(srcPath)) {
  die('Source file "' + SRC_FILE + '" was not found in:\n    ' + ROOT +
    '\n\nRun this script from the folder that contains the prototype, or pass a path:\n' +
    '    node scaffold.js path\\to\\IndyGP_Phase1.html');
}
const html = fs.readFileSync(srcPath, 'utf8');
ok('Loaded ' + SRC_FILE + ' (' + html.length.toLocaleString('en-US') + ' chars)');

/* --- pull out the two script blocks ---------------------------------------- */
const scriptBlocks = [];
const scriptRe = /<script>([\s\S]*?)<\/script>/gi;
let sm;
while ((sm = scriptRe.exec(html)) !== null) scriptBlocks.push(sm[1]);
if (scriptBlocks.length < 2) {
  die('Expected two <script> blocks (Three.js bundle + game code), found ' + scriptBlocks.length + '.');
}
const threeSrc = scriptBlocks.find(function (s) { return /Three\.js Authors/.test(s); });
const gameSrc = scriptBlocks.find(function (s) {
  return /'use strict'/.test(s) && !/Three\.js Authors/.test(s);
});
if (!threeSrc) die('Could not locate the embedded Three.js r128 bundle.');
if (!gameSrc) die('Could not locate the game script block (the one that opens with \'use strict\').');
ok('Three.js r128 bundle: ' + threeSrc.trim().length.toLocaleString('en-US') + ' chars');
ok('Game script:          ' + gameSrc.trim().length.toLocaleString('en-US') + ' chars');

/* --- collision guard -------------------------------------------------------- */
const targets = ['packages', 'src-tauri', 'package.json', 'pnpm-workspace.yaml', 'tsconfig.base.json'];
const clashes = targets.filter(function (t) { return fs.existsSync(path.join(ROOT, t)); });
if (clashes.length && !FORCE) {
  die('Refusing to overwrite existing item(s):\n    ' + clashes.join(', ') +
    '\n\nRe-run with --force to replace them:\n    node scaffold.js --force');
}
if (clashes.length) warn('--force set: overwriting ' + clashes.join(', '));

/* =========================================== 1. SPLIT THE GAME BY LAYER ==== */
step('Splitting the game script on its layer banner comments');

const MARKERS = [
  ['fatal', /^\s*0\.\s+FATAL ERROR SURFACE/m, 'Layer 0 · fatal error surface'],
  ['config', /^\s*1\.\s+CONFIG\b/m, 'Layer 1 · CONFIG'],
  ['circuit', /^\s*2\.\s+CIRCUIT\b/m, 'Layer 2 · CIRCUIT'],
  ['geometry', /^\s*3\.\s+GEOMETRY\b/m, 'Layer 3 · GEOMETRY'],
  ['vehicle', /^\s*4\.\s+VEHICLE\b/m, 'Layer 4 · VEHICLE'],
  ['bootstrap', /^\s*Everything from here down is presentation/m, 'renderer guard (discarded)'],
  ['progress', /^\s*Progress reporting during construction/m, 'boot progress reporter'],
  ['circuitbuild', /^\s*Circuit construction\s*$/m, 'circuit construction'],
  ['textures', /^\s*5\.\s+TEXTURES\b/m, 'Layer 5 · TEXTURES'],
  ['world', /^\s*6\.\s+WORLD\b/m, 'Layer 6 · WORLD'],
  ['input', /^\s*7\.\s+INPUT\b/m, 'Layer 7 · INPUT'],
  ['audio', /^\s*8a\.\s+AUDIO\b/m, 'Layer 8a · AUDIO'],
  ['maps', /^\s*8b\.\s+MINIMAP\b/m, 'Layer 8b · MINIMAP + COURSE MAP'],
  ['loopA', /^\s*9\.\s+SESSION STATE \+ LOOP/m, 'Layer 9 · session state'],
  ['lapTiming', /\/\*\s*--\s*lap timing/, 'Layer 9 · lap timing'],
  ['hudWriter', /\/\*\s*--\s*HUD writer/, 'Layer 9 · HUD writer'],
  ['loopB', /\/\*\s*--\s*camera\s*-/, 'Layer 9 · camera + main loop']
];

const bounds = MARKERS.map(function (m) {
  const key = m[0], re = m[1], label = m[2];
  const hit = re.exec(gameSrc);
  if (!hit) {
    die('Layer marker not found: ' + label + '\n    pattern: ' + re +
      '\n\nThe prototype has been edited or truncated. Aborting rather than emitting a partial port.');
  }
  const bannerStart = gameSrc.lastIndexOf('/*', hit.index);
  const bannerEnd = gameSrc.indexOf('*/', hit.index);
  if (bannerStart < 0 || bannerEnd < 0) {
    die('Malformed banner comment around marker: ' + label);
  }
  return { key: key, label: label, bannerStart: bannerStart, contentStart: bannerEnd + 2 };
});

for (let i = 1; i < bounds.length; i++) {
  if (bounds[i].bannerStart <= bounds[i - 1].bannerStart) {
    die('Layer markers are out of order: "' + bounds[i - 1].label +
      '" appears after "' + bounds[i].label + '".');
  }
}

const S = {};
for (let i = 0; i < bounds.length; i++) {
  const end = (i + 1 < bounds.length) ? bounds[i + 1].bannerStart : gameSrc.length;
  S[bounds[i].key] = gameSrc.slice(bounds[i].contentStart, end).trim();
  info(bounds[i].label.padEnd(34) + String(S[bounds[i].key].length).padStart(7) + ' chars');
}

/* The final slice still carries the closing brace of the prototype's boot(). */
S.loopB = S.loopB.replace(/\}\s*$/, '').trim();
if (!/requestAnimationFrame\(frame\);$/.test(S.loopB)) {
  die('Unexpected tail on the Layer 9 slice. Expected it to end with requestAnimationFrame(frame);');
}
ok('Trimmed the trailing boot() brace from the Layer 9 slice');

/* Layer 9 state and session actions share one slice; split at resize(). */
const resizeAt = S.loopA.indexOf('function resize(){');
if (resizeAt < 0) die('Could not find "function resize(){" inside the Layer 9 slice.');
S.state9 = S.loopA.slice(0, resizeAt).trim();
S.actions9 = S.loopA.slice(resizeAt).trim();
ok('Layer 9 split into session state (' + S.state9.length + ' chars) and actions (' + S.actions9.length + ' chars)');

/* ============================================ 2. OFFLINE FONT STRIPPING ==== */
step('Stripping external Google Fonts dependencies');

const headMatch = html.match(/<head>([\s\S]*?)<\/head>/i);
const bodyMatch = html.match(/<body>([\s\S]*)<\/body>/i);
const styleMatch = html.match(/<style>([\s\S]*?)<\/style>/i);
if (!headMatch) die('Could not find <head> in the prototype.');
if (!bodyMatch) die('Could not find <body> in the prototype.');
if (!styleMatch) die('Could not find the <style> block in the prototype.');

let head = headMatch[1];
const fontLinkRe = /[ \t]*<link\b[^>]*(?:fonts\.googleapis\.com|fonts\.gstatic\.com)[^>]*>\r?\n?/gi;
const removedLinks = head.match(fontLinkRe) || [];
if (removedLinks.length === 0) {
  warn('No Google Fonts <link> items found; offline stylesheet emitted anyway');
} else {
  ok('Removed ' + removedLinks.length + ' external font <link> item(s) from the head');
  removedLinks.forEach(function (l) { info(C.dim + l.trim().slice(0, 92) + C.reset); });
}
head = head.replace(fontLinkRe, '');
head = head.replace(/[ \t]*<!--\s*Optional webfonts[\s\S]*?-->\r?\n?/i, '');
head = head.replace(/[ \t]*<style>[\s\S]*?<\/style>\r?\n?/i, '');

if (/fonts\.(googleapis|gstatic)\.com/i.test(head)) {
  die('A Google Fonts reference survived the strip pass. Aborting.');
}
ok('Head is now free of every remote reference');

let css = styleMatch[1];
if (!/--display:[^;]+;/.test(css)) die('Could not find the --display font token in the stylesheet.');
if (!/--data:[^;]+;/.test(css)) die('Could not find the --data font token in the stylesheet.');
css = css.replace(/--display:[^;]+;/,
  "--display:'Arial Narrow','Liberation Sans Narrow','Helvetica Neue',Arial,system-ui,sans-serif;");
css = css.replace(/--data:[^;]+;/,
  "--data:ui-monospace,Consolas,'SFMono-Regular',Menlo,'Courier New',monospace;");
ok('Rewrote --display and --data as pure offline system font stacks');

let bodyHtml = bodyMatch[1];
bodyHtml = bodyHtml.replace(/[ \t]*<!--\s*Three\.js r128[\s\S]*?-->\r?\n?/i, '');
bodyHtml = bodyHtml.replace(/<script>[\s\S]*?<\/script>\s*/gi, '');
bodyHtml = bodyHtml.trim();

/* Webfont families also appear inside canvas font strings. */
const texFonts = stripWebfonts(S.textures);
S.textures = texFonts.text;
const mapFonts = stripWebfonts(S.maps);
S.maps = mapFonts.text;
ok('Rewrote ' + (texFonts.count + mapFonts.count) + ' canvas font stack(s) in Layers 5 and 8b');

/* ================================================= 3. WORKSPACE ROOT ======= */
step('Writing workspace root');

writeJson('package.json', {
  name: 'indygp',
  private: true,
  version: '0.1.0',
  description: 'Indianapolis Grand Prix - downtown street circuit, TypeScript workspace',
  packageManager: 'pnpm@9.15.0',
  engines: { node: '>=20.11.0', pnpm: '>=9.0.0' },
  scripts: {
    dev: 'pnpm --filter @indygp/app dev',
    build: 'pnpm --filter @indygp/app build',
    preview: 'pnpm --filter @indygp/app preview',
    typecheck: 'tsc -b --pretty',
    clean: 'tsc -b --clean',
    tauri: 'tauri',
    'tauri:dev': 'tauri dev',
    'tauri:build': 'tauri build'
  },
  devDependencies: {
    '@tauri-apps/cli': '^2.1.0',
    typescript: '^5.6.3',
    vite: '^5.4.11'
  }
});

write('pnpm-workspace.yaml', "packages:\n  - 'packages/*'\n");

writeJson('tsconfig.base.json', {
  compilerOptions: {
    target: 'ES2022',
    lib: ['ES2022', 'DOM', 'DOM.Iterable'],
    module: 'ESNext',
    moduleResolution: 'Bundler',
    moduleDetection: 'force',
    forceConsistentCasingInFileNames: true,
    isolatedModules: true,
    esModuleInterop: true,
    resolveJsonModule: true,
    skipLibCheck: true,
    useDefineForClassFields: true,
    composite: true,
    declaration: true,
    declarationMap: true,
    sourceMap: true,
    baseUrl: '.',
    paths: {
      '@indygp/core': ['packages/core/src/index.ts'],
      '@indygp/render': ['packages/render/src/index.ts'],
      '@indygp/platform': ['packages/platform/src/index.ts']
    }
  },
  exclude: ['node_modules', 'dist', 'src-tauri/target']
});

writeJson('tsconfig.json', {
  files: [],
  references: [
    { path: './packages/core' },
    { path: './packages/render' },
    { path: './packages/platform' },
    { path: './packages/app' }
  ]
});

write('.npmrc', [
  'auto-install-peers=true',
  'strict-peer-dependencies=false',
  'link-workspace-packages=true',
  'prefer-workspace-packages=true'
].join('\n'));

write('.gitignore', [
  'node_modules/',
  'dist/',
  'dist-types/',
  '*.tsbuildinfo',
  'src-tauri/target/',
  'src-tauri/gen/',
  '.DS_Store',
  'Thumbs.db'
].join('\n'));

/* ==================================== 4. packages/core  (LAYERS 1 - 4) ===== */
step('packages/core - Layers 1-4 (verbatim physics handoff)');

writeJson('packages/core/package.json', {
  name: '@indygp/core',
  version: '0.1.0',
  private: true,
  type: 'module',
  description: 'Layers 1-4: config, circuit data, centreline geometry, vehicle physics. Zero DOM, zero renderer.',
  main: './src/index.ts',
  types: './src/index.ts',
  exports: { '.': './src/index.ts' },
  scripts: { typecheck: 'tsc -b' }
});

writeJson('packages/core/tsconfig.json', {
  extends: '../../tsconfig.base.json',
  compilerOptions: {
    strict: true,
    noImplicitOverride: true,
    noFallthroughCasesInSwitch: true,
    rootDir: './src',
    outDir: './dist',
    tsBuildInfoFile: './dist/.tsbuildinfo',
    lib: ['ES2022'],
    types: []
  },
  include: ['src/**/*.ts']
});

/* ---- config.ts ------------------------------------------------------------ */
const configBody = applyEdits('config.ts', S.config, [
  [/const\s+CFG\s*=\s*\{/, 'export const CFG: GameConfig = {', 'type and export the tunables object'],
  [/const\s+TAU\s*=\s*Math\.PI\s*\*\s*2;/, 'export const TAU = Math.PI * 2;', 'export TAU'],
  [/const\s+clamp\s*=\s*\(v,a,b\)\s*=>/, 'export const clamp = (v: number, a: number, b: number): number =>', 'type clamp'],
  [/const\s+clamp01\s*=\s*v\s*=>/, 'export const clamp01 = (v: number): number =>', 'type clamp01'],
  [/const\s+lerp\s*=\s*\(a,b,t\)\s*=>/, 'export const lerp = (a: number, b: number, t: number): number =>', 'type lerp'],
  [/const\s+sgn\s*=\s*v\s*=>/, 'export const sgn = (v: number): number =>', 'type sgn'],
  [/function\s+hash01\(n\)\{/, 'export function hash01(n: number): number {', 'type hash01']
]);

write('packages/core/src/config.ts',
  '/* =============================================================================\n' +
  '   LAYER 1 - CONFIG\n' +
  '   Every tunable value, extracted verbatim from IndyGP_Phase1.html by\n' +
  '   scaffold.js. Only export keywords and type annotations were added; not one\n' +
  '   numeric literal was touched. Nothing downstream of this module invents a\n' +
  '   number.\n' +
  '   ========================================================================== */\n\n' +
  'export interface SurfaceProfile { grip: number; extraDrag: number }\n\n' +
  'export interface TrackConfig {\n' +
  '  halfWidth: number;\n  kerbWidth: number;\n  kerbRadius: number;\n  wallOffset: number;\n' +
  '  wallHeight: number;\n  sampleStep: number;\n  startFinish: { x: number; z: number };\n' +
  '  gridOffset: number;\n}\n\n' +
  'export interface CarConfig {\n' +
  '  wheelBase: number;\n  topSpeed: number;\n  power: number;\n  brake: number;\n' +
  '  reversePower: number;\n  reverseTop: number;\n  dragK: number;\n  rollK: number;\n' +
  '  latGrip: number;\n  maxSlip: number;\n  maxSteer: number;\n  maxSteerHigh: number;\n' +
  '  steerFalloff: number;\n  steerRate: number;\n  steerReturn: number;\n' +
  '  handbrakeGrip: number;\n  gears: number[];\n}\n\n' +
  'export interface SurfaceConfig {\n' +
  '  onTrack: SurfaceProfile;\n  offTrack: SurfaceProfile;\n  wallScrub: number;\n}\n\n' +
  'export interface CameraRig {\n' +
  '  back: number; up: number; lookAhead: number; lag: number; fov: number;\n}\n\n' +
  'export interface CameraConfig {\n' +
  '  chase: CameraRig;\n  bonnet: CameraRig;\n  high: CameraRig;\n' +
  '  names: string[];\n  shakeDecay: number;\n}\n\n' +
  'export interface WorldConfig {\n' +
  '  fogNear: number; fogFar: number; blockInset: number;\n' +
  '  treeSpacing: number; maxPixelRatio: number; signalReach: number;\n}\n\n' +
  'export interface SimConfig { step: number; maxFrame: number }\n\n' +
  'export interface GameConfig {\n' +
  '  track: TrackConfig;\n  car: CarConfig;\n  surface: SurfaceConfig;\n' +
  '  cam: CameraConfig;\n  world: WorldConfig;\n  sim: SimConfig;\n}\n\n' +
  '/* ---------- begin verbatim Layer 1 ---------- */\n\n' +
  configBody + '\n\n' +
  '/* ---------- end verbatim Layer 1 ---------- */\n');

/* ---- circuit.ts ----------------------------------------------------------- */
const circuitBody = applyEdits('circuit.ts', S.circuit, [
  [/const\s+AVE\s*=\s*\{/, 'export const AVE: Readonly<Record<string, number>> = {', 'export the avenue grid'],
  [/const\s+ST\s*=\s*\{/, 'export const ST: Readonly<Record<string, number>> = {', 'export the street grid'],
  [/const\s+CIRCLE\s*=\s*\{/, 'export const CIRCLE = {', 'export Monument Circle'],
  [/const\s+CIRC_45\s*=\s*\{/, 'export const CIRC_45 = {', 'export the Circle mid-point'],
  [/const\s+NODES\s*=\s*\[/, 'export const NODES: CircuitNode[] = [', 'type and export the node list']
]);

write('packages/core/src/circuit.ts',
  '/* =============================================================================\n' +
  '   LAYER 2 - CIRCUIT\n' +
  '   The course as pure data, extracted verbatim from IndyGP_Phase1.html.\n' +
  '   ========================================================================== */\n\n' +
  "export type TurnHand = 'L' | 'R';\n\n" +
  'export interface CircuitNode {\n' +
  '  x: number;\n  z: number;\n  r: number;\n' +
  '  turn?: number;\n  dir?: TurnHand;\n  name?: string;\n  note?: string;\n}\n\n' +
  '/** A numbered corner, resolved against the built centreline. */\n' +
  'export interface TurnInfo {\n' +
  '  n: number;\n  dir: TurnHand;\n  name: string;\n  note: string;\n' +
  '  x: number;\n  z: number;\n  s: number;\n  index: number;\n' +
  '  radius: number;\n  lap: number;\n}\n\n' +
  '/* ---------- begin verbatim Layer 2 ---------- */\n\n' +
  circuitBody + '\n\n' +
  '/* ---------- end verbatim Layer 2 ---------- */\n');

/* ---- geometry.ts ---------------------------------------------------------- */
const geometryBody = applyEdits('geometry.ts', S.geometry, [
  [/function\s+buildCentreline\(nodes,\s*step\)\{/,
    'export function buildCentreline(nodes: CircuitNode[], step: number): Centreline {',
    'type the centreline builder'],
  [/const\s+dir\s*=\s*\[\],\s*len\s*=\s*\[\];/,
    'const dir: Vec2[] = [], len: number[] = [];', 'type the direction and length arrays'],
  [/const\s+ang\s*=\s*new Array\(n\),\s*hand\s*=\s*new Array\(n\),\s*off\s*=\s*new Array\(n\);/,
    'const ang = new Array<number>(n), hand = new Array<number>(n), off = new Array<number>(n);',
    'type the fillet working arrays'],
  [/const\s+raw\s*=\s*\[\];/, 'const raw: Vec2[] = [];', 'type the raw polyline'],
  [/const\s+push\s*=\s*\(x,z\)\s*=>\s*\{/,
    'const push = (x: number, z: number): void => {', 'type the emit helper'],
  [/const\s+segLen\s*=\s*\[\];/, 'const segLen: number[] = [];', 'type the segment length table'],
  [/function\s+makeLocator\(cl\)\{/,
    'export function makeLocator(cl: Centreline): Locator {', 'type the locator factory'],
  [/function\s+scan\(x,\s*z,\s*from,\s*to\)\{/,
    'function scan(x: number, z: number, from: number, to: number) {', 'type the window scan'],
  [/return\s+function\s+locate\(x,\s*z,\s*hint\)\{/,
    'return function locate(x: number, z: number, hint: number): LocateResult {',
    'type the nearest-point query']
]);

write('packages/core/src/geometry.ts',
  '/* =============================================================================\n' +
  '   LAYER 3 - GEOMETRY\n' +
  '   Corner filleting, uniform resampling and the nearest-point locator,\n' +
  '   extracted verbatim from IndyGP_Phase1.html.\n' +
  '   ========================================================================== */\n\n' +
  "import { clamp, clamp01, lerp } from './config';\n" +
  "import type { CircuitNode } from './circuit';\n\n" +
  'export interface Vec2 { x: number; z: number }\n\n' +
  'export interface Centreline {\n' +
  '  pts: Float32Array;\n  tan: Float32Array;\n  nrm: Float32Array;\n' +
  '  cum: Float32Array;\n  curv: Float32Array;\n' +
  '  count: number;\n  length: number;\n  step: number;\n}\n\n' +
  'export interface LocateResult {\n' +
  '  index: number;\n  s: number;\n  lateral: number;\n' +
  '  tx: number;\n  tz: number;\n  px: number;\n  pz: number;\n  curv: number;\n}\n\n' +
  'export type Locator = (x: number, z: number, hint: number) => LocateResult;\n\n' +
  '/* ---------- begin verbatim Layer 3 ---------- */\n\n' +
  geometryBody + '\n\n' +
  '/* ---------- end verbatim Layer 3 ---------- */\n');

/* ---- vehicle.ts ----------------------------------------------------------- */
const vehicleBody = applyEdits('vehicle.ts', S.vehicle, [
  [/function\s+createVehicle\(x,\s*z,\s*yaw\)\{/,
    'export function createVehicle(x: number, z: number, yaw: number): Vehicle {',
    'type the vehicle constructor'],
  [/function\s+stepVehicle\(v,\s*input,\s*dt,\s*surf,\s*cfg\)\{/,
    'export function stepVehicle(v: Vehicle, input: VehicleInput, dt: number, surf: SurfaceProfile, cfg: PhysicsConfig): Vehicle {',
    'type the physics step'],
  [/function\s+applyBarriers\(v,\s*loc,\s*cl,\s*cfg\)\{/,
    'export function applyBarriers(v: Vehicle, loc: LocateResult, cl: Centreline, cfg: PhysicsConfig): number {',
    'type the barrier containment'],
  [/function\s+gearFor\(kph,\s*bands\)\{/,
    'export function gearFor(kph: number, bands: number[]): GearBand {', 'type the gear lookup'],
  [/function\s+fmtTime\(ms\)\{/,
    'export function fmtTime(ms: number | null): string {', 'type the lap time formatter']
]);

write('packages/core/src/vehicle.ts',
  '/* =============================================================================\n' +
  '   LAYER 4 - VEHICLE\n' +
  '   Pure physics, extracted verbatim from IndyGP_Phase1.html. No DOM, no\n' +
  '   renderer, no globals. Port this module to React Native or Flutter and it\n' +
  '   behaves identically.\n' +
  '   ========================================================================== */\n\n' +
  "import { TAU, clamp, clamp01, lerp, sgn } from './config';\n" +
  "import type { CarConfig, SurfaceProfile } from './config';\n" +
  "import type { Centreline, LocateResult } from './geometry';\n\n" +
  'export interface Vehicle {\n' +
  '  x: number;\n  z: number;\n  yaw: number;\n  vLong: number;\n  vLat: number;\n' +
  '  steer: number;\n  wheelSpin: number;\n  latAccel: number;\n' +
  '  slipping: boolean;\n  hitWall: number;\n}\n\n' +
  'export interface VehicleInput {\n' +
  '  throttle: number;\n  brake: number;\n  steer: number;\n  handbrake: boolean;\n}\n\n' +
  '/** The flat tuning object the physics step consumes. */\n' +
  'export interface PhysicsConfig extends CarConfig {\n' +
  '  scrub: number;\n  wallOffset: number;\n}\n\n' +
  'export interface GearBand { g: number; lo: number; hi: number }\n\n' +
  '/* ---------- begin verbatim Layer 4 ---------- */\n\n' +
  vehicleBody + '\n\n' +
  '/* ---------- end verbatim Layer 4 ---------- */\n');

write('packages/core/src/index.ts',
  '/* Public surface of the portable game core (Layers 1-4). */\n' +
  "export * from './config';\n" +
  "export * from './circuit';\n" +
  "export * from './geometry';\n" +
  "export * from './vehicle';\n");

/* ==================================== 5. packages/render (LAYERS 5 - 6) ==== */
step('packages/render - Layers 5-6 (textures + world meshes)');

writeJson('packages/render/package.json', {
  name: '@indygp/render',
  version: '0.1.0',
  private: true,
  type: 'module',
  description: 'Layers 5-6: procedural CanvasTextures and the Three.js world (track, city, monument, Artsgarden, car).',
  main: './src/index.ts',
  types: './src/index.ts',
  exports: { '.': './src/index.ts' },
  scripts: { typecheck: 'tsc -b' },
  dependencies: { '@indygp/core': 'workspace:*', three: '0.128.0' },
  devDependencies: { '@types/three': '0.128.0' }
});

/* Layers 5-9 are verbatim JavaScript ports. They keep strict:false until the
   Phase 1 typing sweep; core stays fully strict because it is the contract. */
const loosePresentation = {
  strict: false,
  noImplicitAny: false,
  strictNullChecks: false,
  noImplicitThis: false
};

writeJson('packages/render/tsconfig.json', {
  extends: '../../tsconfig.base.json',
  compilerOptions: Object.assign({}, loosePresentation, {
    rootDir: './src',
    outDir: './dist',
    tsBuildInfoFile: './dist/.tsbuildinfo'
  }),
  include: ['src/**/*.ts'],
  references: [{ path: '../core' }]
});

write('packages/render/src/textures.ts',
  '/* =============================================================================\n' +
  '   LAYER 5 - TEXTURES\n' +
  '   Every surface is drawn with canvas at load time, so the build has zero\n' +
  '   image files and zero network dependencies. Body extracted verbatim; the\n' +
  '   two webfont families were rewritten to offline system stacks.\n' +
  '   ========================================================================== */\n\n' +
  "import * as THREE from 'three';\n" +
  "import { hash01 } from '@indygp/core';\n\n" +
  'export interface TextureDeps {\n' +
  '  /** Boot progress reporter supplied by the app shell. */\n' +
  '  tick: (msg?: string) => void;\n}\n\n' +
  'export function createTextures(deps: TextureDeps) {\n' +
  '  const tick = deps.tick;\n\n' +
  '  /* ---------- begin verbatim Layer 5 ---------- */\n\n' +
  indent(S.textures, '  ') + '\n\n' +
  '  /* ---------- end verbatim Layer 5 ---------- */\n\n' +
  '  return { TEX, signTex, SF_BANNER, canvasTex };\n' +
  '}\n\n' +
  'export type TextureSet = ReturnType<typeof createTextures>;\n');

write('packages/render/src/world.ts',
  '/* =============================================================================\n' +
  '   LAYER 6 - WORLD\n' +
  '   The Three.js scene: track ribbons, kerbs, concrete, downtown, the\n' +
  "   Soldiers' & Sailors' Monument, the Artsgarden gantry, signage, trees and\n" +
  '   the car. Body extracted verbatim from IndyGP_Phase1.html.\n' +
  '   ========================================================================== */\n\n' +
  "import * as THREE from 'three';\n" +
  "import { CFG, TAU, clamp01, hash01, lerp, AVE, ST, CIRCLE } from '@indygp/core';\n" +
  "import type { Centreline, Locator, TurnInfo } from '@indygp/core';\n\n" +
  'export interface WorldDeps {\n' +
  '  DOM: Record<string, any>;\n' +
  '  CL: Centreline;\n' +
  '  locate: Locator;\n' +
  '  TURNS: TurnInfo[];\n' +
  '  TEX: any;\n' +
  '  signTex: (turn: number, street: string, dir: string) => any;\n' +
  '  SF_BANNER: any;\n' +
  '  tick: (msg?: string) => void;\n}\n\n' +
  'export function createWorld(deps: WorldDeps) {\n' +
  '  const DOM = deps.DOM;\n' +
  '  const CL = deps.CL;\n' +
  '  const locate = deps.locate;\n' +
  '  const TURNS = deps.TURNS;\n' +
  '  const TEX = deps.TEX;\n' +
  '  const signTex = deps.signTex;\n' +
  '  const SF_BANNER = deps.SF_BANNER;\n' +
  '  const tick = deps.tick;\n\n' +
  '  /* ---------- begin verbatim Layer 6 ---------- */\n\n' +
  indent(S.world, '  ') + '\n\n' +
  '  /* ---------- end verbatim Layer 6 ---------- */\n\n' +
  '  return { renderer, scene, camera, carRoot, carBody, frontAxle, allWheels, HW };\n' +
  '}\n\n' +
  'export type World = ReturnType<typeof createWorld>;\n');

write('packages/render/src/index.ts',
  "export * from './textures';\nexport * from './world';\n");

write('packages/render/vendor/README.md',
  '# Vendored Three.js r128\n\n' +
  '`three.r128.min.js` was extracted byte-for-byte from `IndyGP_Phase1.html` by\n' +
  '`scaffold.js`. It is the exact UMD bundle the prototype shipped, kept here as\n' +
  'an offline provenance artefact.\n\n' +
  'The workspace consumes `three@0.128.0` from the registry so the bundler can\n' +
  'tree-shake it and `@types/three@0.128.0` can supply declarations. Both resolve\n' +
  'to the same revision, so runtime behaviour is unchanged.\n\n' +
  'Nothing in this folder is imported by the build.\n');

write('packages/render/vendor/three.r128.min.js', threeSrc.trim());
ok('Vendored the extracted Three.js bundle for provenance');

/* ================================== 6. packages/platform (LAYERS 7 - 8) ==== */
step('packages/platform - Layers 7-8 (input, audio, HUD, DOM shell)');

writeJson('packages/platform/package.json', {
  name: '@indygp/platform',
  version: '0.1.0',
  private: true,
  type: 'module',
  description: 'Layers 7-8: normalised keyboard/gamepad/touch input, WebAudio engine nodes, HUD readouts, minimap and course map.',
  main: './src/index.ts',
  types: './src/index.ts',
  exports: { '.': './src/index.ts' },
  scripts: { typecheck: 'tsc -b' },
  dependencies: { '@indygp/core': 'workspace:*' }
});

writeJson('packages/platform/tsconfig.json', {
  extends: '../../tsconfig.base.json',
  compilerOptions: Object.assign({}, loosePresentation, {
    rootDir: './src',
    outDir: './dist',
    tsBuildInfoFile: './dist/.tsbuildinfo'
  }),
  include: ['src/**/*.ts'],
  references: [{ path: '../core' }]
});

const domBody = applyEdits('dom.ts', S.fatal, [
  [/const\s+DOM\s*=\s*\{\};/, 'export const DOM: Record<string, any> = {};', 'export the element registry'],
  [/function\s+grab\(\)\{/, 'export function grab() {', 'export the element collector'],
  [/function\s+fatal\(title,\s*body\)\{/, 'export function fatal(title: string, body: string) {', 'type the fatal surface']
]);

write('packages/platform/src/dom.ts',
  '/* =============================================================================\n' +
  '   LAYER 0 - DOM SHELL AND FATAL ERROR SURFACE\n' +
  '   Extracted verbatim. Every failure path routes here; no silent catch blocks\n' +
  '   anywhere in the codebase.\n' +
  '   ========================================================================== */\n\n' +
  '/* ---------- begin verbatim Layer 0 ---------- */\n\n' +
  domBody + '\n\n' +
  '/* ---------- end verbatim Layer 0 ---------- */\n');

write('packages/platform/src/input.ts',
  '/* =============================================================================\n' +
  '   LAYER 7 - INPUT\n' +
  '   Keyboard, gamepad and touch collapse into one normalised struct.\n' +
  '   Body extracted verbatim from IndyGP_Phase1.html.\n' +
  '   ========================================================================== */\n\n' +
  "import { clamp, clamp01 } from '@indygp/core';\n\n" +
  'export interface SessionActions {\n' +
  '  cycleCamera(): void;\n' +
  '  toggleMap(): void;\n' +
  '  rejoin(): void;\n' +
  '  togglePause(): void;\n' +
  '  toggleAudio(): void;\n}\n\n' +
  'export interface InputDeps {\n' +
  '  DOM: Record<string, any>;\n' +
  '  /** Late-bound: the session actions are defined after the input system. */\n' +
  '  actions: Partial<SessionActions>;\n}\n\n' +
  'export function createInput(deps: InputDeps) {\n' +
  '  const DOM = deps.DOM;\n\n' +
  '  // Late-bound trampolines so Layer 7 can reference the session actions by\n' +
  '  // name exactly as it did when everything shared one closure.\n' +
  '  const cycleCamera = () => { if (deps.actions.cycleCamera) deps.actions.cycleCamera(); };\n' +
  '  const toggleMap = () => { if (deps.actions.toggleMap) deps.actions.toggleMap(); };\n' +
  '  const rejoin = () => { if (deps.actions.rejoin) deps.actions.rejoin(); };\n' +
  '  const togglePause = () => { if (deps.actions.togglePause) deps.actions.togglePause(); };\n' +
  '  const Audio = { toggle: () => { if (deps.actions.toggleAudio) deps.actions.toggleAudio(); } };\n\n' +
  '  /* ---------- begin verbatim Layer 7 ---------- */\n\n' +
  indent(S.input, '  ') + '\n\n' +
  '  /* ---------- end verbatim Layer 7 ---------- */\n\n' +
  '  return { INPUT, readInput };\n' +
  '}\n\n' +
  'export type InputSystem = ReturnType<typeof createInput>;\n');

write('packages/platform/src/audio.ts',
  '/* =============================================================================\n' +
  '   LAYER 8a - AUDIO\n' +
  '   A two-oscillator engine note. Created only after the user clicks, which is\n' +
  '   what browser autoplay policy requires. Body extracted verbatim.\n' +
  '   ========================================================================== */\n\n' +
  'export function createAudio() {\n' +
  '  /* ---------- begin verbatim Layer 8a ---------- */\n\n' +
  indent(S.audio, '  ') + '\n\n' +
  '  /* ---------- end verbatim Layer 8a ---------- */\n\n' +
  '  return Audio;\n' +
  '}\n\n' +
  'export type EngineAudio = ReturnType<typeof createAudio>;\n');

write('packages/platform/src/hud.ts',
  '/* =============================================================================\n' +
  '   LAYER 8b - HUD, MINIMAP AND COURSE MAP\n' +
  '   DOM readouts plus the two canvas maps. Bodies extracted verbatim from\n' +
  '   IndyGP_Phase1.html; canvas font stacks rewritten for offline use.\n' +
  '   ========================================================================== */\n\n' +
  "import { CFG, TAU, clamp01, fmtTime, gearFor, AVE, ST, CIRCLE } from '@indygp/core';\n" +
  "import type { Centreline, Locator, TurnInfo, Vehicle, VehicleInput } from '@indygp/core';\n\n" +
  'export interface HudDeps {\n' +
  '  DOM: Record<string, any>;\n' +
  '  CL: Centreline;\n' +
  '  locate: Locator;\n' +
  '  TURNS: TurnInfo[];\n' +
  '  /** Live references: the HUD reads these every frame. */\n' +
  '  car: Vehicle;\n' +
  '  INPUT: VehicleInput;\n' +
  '  SESSION: Record<string, any>;\n}\n\n' +
  'export function createHud(deps: HudDeps) {\n' +
  '  const DOM = deps.DOM;\n' +
  '  const CL = deps.CL;\n' +
  '  const locate = deps.locate;\n' +
  '  const TURNS = deps.TURNS;\n' +
  '  const car = deps.car;\n' +
  '  const INPUT = deps.INPUT;\n' +
  '  const SESSION = deps.SESSION;\n\n' +
  '  /* ---------- begin verbatim Layer 8b ---------- */\n\n' +
  indent(S.maps, '  ') + '\n\n' +
  '  /* ---------- end verbatim Layer 8b ---------- */\n\n' +
  '  /* ---------- begin verbatim Layer 9 HUD writer ---------- */\n\n' +
  indent(S.hudWriter, '  ') + '\n\n' +
  '  /* ---------- end verbatim Layer 9 HUD writer ---------- */\n\n' +
  '  /** Draw the course map once, on first open. */\n' +
  '  function ensureCourseMap() { if (!courseDrawn) drawCourseMap(); }\n\n' +
  '  return { drawMinimap, drawCourseMap, ensureCourseMap, paintHud };\n' +
  '}\n\n' +
  'export type Hud = ReturnType<typeof createHud>;\n');

write('packages/platform/src/index.ts',
  "export * from './dom';\n" +
  "export * from './input';\n" +
  "export * from './audio';\n" +
  "export * from './hud';\n");

/* ======================================= 7. packages/app (LAYER 9) ========= */
step('packages/app - Layer 9 (main loop) + offline shell');

writeJson('packages/app/package.json', {
  name: '@indygp/app',
  version: '0.1.0',
  private: true,
  type: 'module',
  description: 'Layer 9: fixed-timestep loop, camera rigs, lap timing, session state and the offline HTML shell.',
  scripts: {
    dev: 'vite',
    build: 'vite build',
    preview: 'vite preview --port 4173 --strictPort',
    typecheck: 'tsc -b'
  },
  dependencies: {
    '@indygp/core': 'workspace:*',
    '@indygp/platform': 'workspace:*',
    '@indygp/render': 'workspace:*',
    three: '0.128.0'
  },
  devDependencies: { '@types/three': '0.128.0', vite: '^5.4.11' }
});

writeJson('packages/app/tsconfig.json', {
  extends: '../../tsconfig.base.json',
  compilerOptions: Object.assign({}, loosePresentation, {
    rootDir: '.',
    outDir: './dist-types',
    tsBuildInfoFile: './dist-types/.tsbuildinfo',
    types: ['vite/client']
  }),
  include: ['src/**/*.ts', 'vite.config.ts'],
  references: [
    { path: '../core' },
    { path: '../render' },
    { path: '../platform' }
  ]
});

write('packages/app/vite.config.ts',
  "import { defineConfig } from 'vite';\n" +
  "import { fileURLToPath, URL } from 'node:url';\n\n" +
  'const alias = (p: string): string => fileURLToPath(new URL(p, import.meta.url));\n\n' +
  'export default defineConfig({\n' +
  "  // Relative base so the bundle loads from Tauri's asset protocol offline.\n" +
  "  base: './',\n" +
  '  clearScreen: false,\n' +
  '  resolve: {\n' +
  '    alias: {\n' +
  "      '@indygp/core': alias('../core/src/index.ts'),\n" +
  "      '@indygp/render': alias('../render/src/index.ts'),\n" +
  "      '@indygp/platform': alias('../platform/src/index.ts')\n" +
  '    }\n' +
  '  },\n' +
  "  server: { host: '127.0.0.1', port: 5173, strictPort: true },\n" +
  '  build: {\n' +
  "    target: 'chrome110',\n" +
  "    outDir: 'dist',\n" +
  '    emptyOutDir: true,\n' +
  '    sourcemap: true,\n' +
  '    // keep every asset local; nothing may resolve to a remote URL\n' +
  '    assetsInlineLimit: 0,\n' +
  "    rollupOptions: { output: { manualChunks: { three: ['three'] } } }\n" +
  '  }\n' +
  '});\n');

write('packages/app/index.html',
  '<!DOCTYPE html>\n<html lang="en">\n<head>\n' +
  head.trim() + '\n' +
  '<!--\n' +
  '  OFFLINE SHELL\n' +
  '  The prototype\'s two <link rel="preconnect"> tags and its Google Fonts\n' +
  '  stylesheet <link> were removed by scaffold.js. Typography now resolves\n' +
  '  entirely from the system stacks declared in src/styles.css.\n' +
  '-->\n' +
  '</head>\n<body>\n' +
  bodyHtml + '\n\n' +
  '<script type="module" src="./src/main.ts"></script>\n' +
  '</body>\n</html>\n');

write('packages/app/src/styles.css',
  '/* Extracted from IndyGP_Phase1.html by scaffold.js.\n' +
  '   --display and --data were rewritten to offline system font stacks;\n' +
  '   every other rule is unchanged. */\n' +
  css.trim() + '\n');

/* ---- main.ts: the orchestration --------------------------------------------- */
const actions9 = applyEdits('main.ts (Layer 9 actions)', S.actions9, [
  [/if\s*\(!courseDrawn\)\s*drawCourseMap\(\);/,
    'ensureCourseMap();',
    'courseDrawn now lives inside the HUD module; the guard moved with it']
]);

write('packages/app/src/main.ts',
  '/* =============================================================================\n' +
  '   LAYER 9 - SESSION STATE AND MAIN LOOP\n' +
  '   Fixed-timestep accumulator, camera rigs, lap timing, pause and resize.\n' +
  '   Wires the portable core (Layers 1-4) to the presentation packages.\n' +
  '   All bodies extracted verbatim from IndyGP_Phase1.html.\n' +
  '   ========================================================================== */\n\n' +
  "import './styles.css';\n\n" +
  "import * as THREE from 'three';\n" +
  'import {\n' +
  '  CFG, TAU, clamp, clamp01, lerp, sgn, hash01,\n' +
  '  NODES, AVE, ST, CIRCLE,\n' +
  '  buildCentreline, makeLocator,\n' +
  '  createVehicle, stepVehicle, applyBarriers, gearFor, fmtTime\n' +
  "} from '@indygp/core';\n" +
  "import { DOM, grab, fatal, createInput, createAudio, createHud } from '@indygp/platform';\n" +
  "import type { SessionActions } from '@indygp/platform';\n" +
  "import { createTextures, createWorld } from '@indygp/render';\n\n" +
  'grab();\n\n' +
  'try {\n' +
  '  boot();\n' +
  '} catch (err: any) {\n' +
  "  fatal('The circuit could not be built',\n" +
  "    'Construction failed before the session started.<br><br><code>' +\n" +
  "    String((err && err.message) || err).replace(/</g, '&lt;') + '</code>');\n" +
  '  throw err;\n' +
  '}\n\n' +
  'function boot() {\n\n' +
  '  /* ---------- begin verbatim: boot progress reporter ---------- */\n\n' +
  indent(S.progress, '  ') + '\n\n' +
  '  /* ---------- end verbatim ---------- */\n\n' +
  '  /* ---------- begin verbatim: circuit construction ---------- */\n\n' +
  indent(S.circuitbuild, '  ') + '\n\n' +
  '  /* ---------- end verbatim ---------- */\n\n' +
  '  // --- presentation layers ------------------------------------------------\n' +
  '  const textures = createTextures({ tick });\n' +
  '  const TEX = textures.TEX;\n' +
  '  const signTex = textures.signTex;\n' +
  '  const SF_BANNER = textures.SF_BANNER;\n\n' +
  '  const world = createWorld({\n' +
  '    DOM, CL, locate, TURNS, TEX, signTex, SF_BANNER, tick\n' +
  '  });\n' +
  '  const renderer = world.renderer;\n' +
  '  const scene = world.scene;\n' +
  '  const camera = world.camera;\n' +
  '  const carRoot = world.carRoot;\n' +
  '  const carBody = world.carBody;\n' +
  '  const frontAxle = world.frontAxle;\n' +
  '  const allWheels = world.allWheels;\n' +
  '  const HW = CFG.track.halfWidth;\n\n' +
  '  /* ---------- begin verbatim Layer 9: session state ---------- */\n\n' +
  indent(S.state9, '  ') + '\n\n' +
  '  /* ---------- end verbatim ---------- */\n\n' +
  '  // --- audio, input and HUD ------------------------------------------------\n' +
  '  const Audio = createAudio();\n\n' +
  '  const actions: Partial<SessionActions> = {};\n' +
  '  const input = createInput({ DOM, actions });\n' +
  '  const INPUT = input.INPUT;\n' +
  '  const readInput = input.readInput;\n\n' +
  '  const hud = createHud({ DOM, CL, locate, TURNS, car, INPUT, SESSION });\n' +
  '  const drawMinimap = hud.drawMinimap;\n' +
  '  const drawCourseMap = hud.drawCourseMap;\n' +
  '  const ensureCourseMap = hud.ensureCourseMap;\n' +
  '  const paintHud = hud.paintHud;\n\n' +
  '  /* ---------- begin verbatim Layer 9: session actions ---------- */\n\n' +
  indent(actions9, '  ') + '\n\n' +
  '  /* ---------- end verbatim ---------- */\n\n' +
  '  // hand the freshly defined actions to the input layer\n' +
  '  actions.cycleCamera = cycleCamera;\n' +
  '  actions.toggleMap = toggleMap;\n' +
  '  actions.rejoin = rejoin;\n' +
  '  actions.togglePause = togglePause;\n' +
  '  actions.toggleAudio = () => { Audio.toggle(); };\n\n' +
  '  /* ---------- begin verbatim Layer 9: lap timing ---------- */\n\n' +
  indent(S.lapTiming, '  ') + '\n\n' +
  '  /* ---------- end verbatim ---------- */\n\n' +
  '  /* ---------- begin verbatim Layer 9: camera and main loop ---------- */\n\n' +
  indent(S.loopB, '  ') + '\n\n' +
  '  /* ---------- end verbatim ---------- */\n' +
  '}\n');

/* ================================================= 8. TAURI SHELL ========== */
step('src-tauri - native offline 1600x900 window');

writeJson('src-tauri/tauri.conf.json', {
  $schema: 'https://schema.tauri.app/config/2',
  productName: 'Indianapolis Grand Prix',
  version: '0.1.0',
  identifier: 'com.indygp.phase1',
  build: {
    frontendDist: '../packages/app/dist',
    devUrl: 'http://127.0.0.1:5173',
    beforeDevCommand: 'pnpm --filter @indygp/app dev',
    beforeBuildCommand: 'pnpm --filter @indygp/app build'
  },
  app: {
    withGlobalTauri: false,
    windows: [
      {
        label: 'main',
        title: 'Indianapolis Grand Prix - Phase 1',
        width: 1600,
        height: 900,
        minWidth: 1024,
        minHeight: 576,
        resizable: true,
        fullscreen: false,
        maximized: false,
        center: true,
        decorations: true,
        focus: true,
        visible: true,
        theme: 'Dark'
      }
    ],
    security: {
      csp: "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' ipc: http://ipc.localhost; font-src 'self'",
      assetProtocol: { enable: false }
    }
  },
  bundle: {
    active: true,
    targets: ['msi', 'nsis'],
    shortDescription: 'Downtown Indianapolis street circuit - Phase 1 drivable skeleton',
    longDescription: 'A fully offline 13-corner street circuit through the Mile Square, rendered natively with no network dependencies.',
    category: 'Game',
    publisher: 'IndyGP',
    windows: { webviewInstallMode: { type: 'embedBootstrapper' } }
  }
});

writeJson('src-tauri/capabilities/default.json', {
  $schema: '../gen/schemas/desktop-schema.json',
  identifier: 'default',
  description: 'Offline single-window capability. No network, no filesystem, no shell.',
  windows: ['main'],
  permissions: ['core:default']
});

write('src-tauri/Cargo.toml',
  '[package]\n' +
  'name = "indygp"\n' +
  'version = "0.1.0"\n' +
  'description = "Indianapolis Grand Prix - Phase 1"\n' +
  'authors = ["IndyGP"]\n' +
  'edition = "2021"\n' +
  'rust-version = "1.77"\n\n' +
  '[build-dependencies]\n' +
  'tauri-build = { version = "2", features = [] }\n\n' +
  '[dependencies]\n' +
  'tauri = { version = "2", features = [] }\n' +
  'serde = { version = "1", features = ["derive"] }\n' +
  'serde_json = "1"\n\n' +
  '[profile.release]\n' +
  'panic = "abort"\n' +
  'codegen-units = 1\n' +
  'lto = true\n' +
  'opt-level = "s"\n' +
  'strip = true\n');

write('src-tauri/build.rs',
  'fn main() {\n' +
  '    tauri_build::build()\n' +
  '}\n');

write('src-tauri/src/main.rs',
  '// Prevents the console window from appearing alongside the release build.\n' +
  '#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]\n\n' +
  'use tauri::{LogicalSize, Manager, Size};\n\n' +
  '/// Native, offline entry point for the Indianapolis Grand Prix circuit.\n' +
  '/// The window is spawned at a fixed 1600x900 logical size and centred; the\n' +
  '/// webview loads the bundled front end only, with no network access.\n' +
  'fn main() {\n' +
  '    tauri::Builder::default()\n' +
  '        .setup(|app| {\n' +
  '            if let Some(window) = app.get_webview_window("main") {\n' +
  '                let _ = window.set_size(Size::Logical(LogicalSize {\n' +
  '                    width: 1600.0,\n' +
  '                    height: 900.0,\n' +
  '                }));\n' +
  '                let _ = window.center();\n' +
  '                let _ = window.set_focus();\n' +
  '            }\n' +
  '            Ok(())\n' +
  '        })\n' +
  '        .run(tauri::generate_context!())\n' +
  '        .expect("the Indianapolis Grand Prix window could not be created");\n' +
  '}\n');

write('src-tauri/.gitignore', 'target/\ngen/\n');

/* ==================================================== 9. README ============ */
write('README.md',
  '# Indianapolis Grand Prix - Phase 0\n\n' +
  'A pnpm + TypeScript workspace generated from `IndyGP_Phase1.html` by `scaffold.js`,\n' +
  'packaged for the desktop by Tauri.\n\n' +
  '## Layout\n\n' +
  '| Package | Layers | Contents |\n' +
  '| --- | --- | --- |\n' +
  '| `packages/core` | 1-4 | config, circuit data, centreline geometry, vehicle physics. No DOM, no renderer. Fully strict TypeScript. |\n' +
  '| `packages/render` | 5-6 | procedural CanvasTextures and the Three.js world. |\n' +
  '| `packages/platform` | 7-8 | normalised input, WebAudio engine, HUD, minimap, course map. |\n' +
  '| `packages/app` | 9 | fixed-timestep loop, camera rigs, session state, offline HTML shell. |\n' +
  '| `src-tauri` | - | native offline 1600x900 window. |\n\n' +
  '## Commands\n\n' +
  '```\n' +
  'pnpm install        # once\n' +
  'pnpm dev            # browser dev server on 127.0.0.1:5173\n' +
  'pnpm typecheck      # build all four project references\n' +
  'pnpm tauri:dev      # native window, hot reload\n' +
  'pnpm tauri:build    # MSI + NSIS installers\n' +
  '```\n\n' +
  'Before `tauri:build`, generate icons once: `pnpm tauri icon path\\to\\icon.png`.\n\n' +
  '## Offline guarantees\n\n' +
  '- Every Google Fonts `<link>` was stripped; `--display` and `--data` resolve to\n' +
  '  system faces only.\n' +
  '- Canvas font stacks in Layers 5 and 8b were rewritten to the same system faces.\n' +
  '- Vite runs with `assetsInlineLimit: 0` and a relative `base`.\n' +
  '- The Tauri CSP has no remote origins and the asset protocol is disabled.\n\n' +
  '## Known Phase 1 debt\n\n' +
  'Layers 5-9 are verbatim JavaScript ports, so `packages/render`, `packages/platform`\n' +
  'and `packages/app` run with `strict: false`. `packages/core` - the portable\n' +
  'contract that carries every math constant - is fully strict. Tightening the\n' +
  'presentation packages is the first Phase 1 task.\n');

/* ==================================================== DONE ================= */
console.log('');
console.log(C.green + C.bold + '  DONE' + C.reset);
console.log('  ' + filesWritten + ' files written, ' +
  (bytesWritten / 1024).toFixed(1) + ' KB total');
console.log('');
console.log('  Layers 1-4 extracted verbatim into packages/core/src/');
console.log('  Layers 5-9 extracted verbatim into render / platform / app');
console.log('  ' + removedLinks.length + ' Google Fonts <link> item(s) stripped, ' +
  (texFonts.count + mapFonts.count) + ' canvas font stack(s) rewritten');
console.log('');
console.log(C.bold + '  Next:' + C.reset);
console.log('    pnpm install');
console.log('    pnpm dev          ' + C.dim + '# browser check first' + C.reset);
console.log('    pnpm tauri:dev    ' + C.dim + '# native 1600x900 window' + C.reset);
console.log('');