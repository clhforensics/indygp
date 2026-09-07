// pit_check.mjs - headless geometry audit for the pit lane kit.
// Run from repo root: node pit_check.mjs
import { createServer } from 'vite';
const server = await createServer({ root: '/Users/opr03/indygp/packages/render', server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
const mod = await server.ssrLoadModule('/src/world/pitlane.ts');
const mod3 = await server.ssrLoadModule('/node_modules/three/build/three.module.js');
const THREE = mod3.default ?? mod3;
const scene = new THREE.Scene();
const kit = mod.buildPitLane(scene);
let meshes = 0; const info = [];
kit.group.traverse((o) => {
  if (o.isMesh) {
    meshes++;
    const p = o.geometry.attributes.position;
    let minZ = 1e9, maxZ = -1e9, minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i), y = p.getY(i);
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    info.push('mesh ' + meshes + ': x ' + minX.toFixed(0) + '..' + maxX.toFixed(0) + ' y ' + minY.toFixed(2) + '..' + maxY.toFixed(2) + ' z ' + minZ.toFixed(0) + '..' + maxZ.toFixed(0));
  }
});
console.log('meshes: ' + meshes);
for (const line of info) console.log(line);
await server.close();
