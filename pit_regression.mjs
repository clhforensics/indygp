import assert from 'node:assert/strict';
import {createServer} from 'vite';
const server=await createServer({root:process.cwd()+'/packages/render',server:{middlewareMode:true},appType:'custom',logLevel:'error'});
try {
 const core=await server.ssrLoadModule('../core/src/index.ts');
 const THREE=await server.ssrLoadModule('/node_modules/three/build/three.module.js');
 const {buildPitLane}=await server.ssrLoadModule('/src/world/pitlane.ts');
 const scene=new THREE.Scene(); const kit=buildPitLane(scene);
 scene.updateMatrixWorld(true);
 let violations=[];
 kit.group.traverse(o=>{if(!o.isMesh)return; const p=o.geometry.attributes.position;for(let i=0;i<p.count;i++){const v=new THREE.Vector3().fromBufferAttribute(p,i).applyMatrix4(o.matrixWorld); if(v.y>0.15 && v.x>400.6 && v.x<419.4 && v.z>-370 && v.z<-290)violations.push([o.name,v.x,v.y,v.z]); if(v.y>0.15&&v.x>30&&v.x<385&&Math.abs(v.z+270)<9.4)violations.push([o.name,v.x,v.y,v.z]);}});
 assert.equal(violations.length,0,'Solid pit objects in racing territory: '+JSON.stringify(violations.slice(0,3)));
 console.log('PASS: no solid pit objects in Capitol/Ohio racing territory');
} finally {await server.close();}
