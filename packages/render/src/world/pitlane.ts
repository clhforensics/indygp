import * as THREE from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {getPitPath,samplePitPath,pitTrackDistance,PIT_LAYOUT as L} from '@indygp/core';
export interface PitLaneKit {group:THREE.Group}
export function buildPitLane(scene:THREE.Scene):PitLaneKit {
 const group=new THREE.Group();group.name='pit-complex';
 const batches=new Map<number,THREE.BufferGeometry[]>();
 function box(name:string,x:number,y:number,z:number,w:number,h:number,d:number,color:number){
  const g=new THREE.BoxGeometry(w,h,d);g.translate(x,y,z);
  const parts=batches.get(color)||[];parts.push(g);batches.set(color,parts);
  // Authored component bounds survive batching for exact clearance audits.
  const components=group.userData.components||(group.userData.components=[]);
  components.push({name,x,y,z,w,h,d});
 }
 function label(text:string,x:number,y:number,z:number,w:number,yaw=0){
  const mat=new THREE.MeshBasicMaterial({color:0xffffff,side:THREE.DoubleSide});
  if(typeof document!=='undefined'){const c=document.createElement('canvas');c.width=1024;c.height=128;const ctx=c.getContext('2d')!;ctx.fillStyle='#10202a';ctx.fillRect(0,0,1024,128);ctx.fillStyle='#ffffff';ctx.font='bold 76px sans-serif';ctx.textAlign='center';ctx.fillText(text,512,94);mat.map=new THREE.CanvasTexture(c);}
  const m=new THREE.Mesh(new THREE.PlaneGeometry(w,w/8),mat);m.name=text;m.position.set(x,y,z);m.rotation.y=yaw;group.add(m);
 }
 // Dense surface cells are omitted at the EXISTING race boundary. No pit
 // asphalt/markings overlay the racing surface, including either junction.
 const verts:number[]=[];const path=getPitPath();
 for(let s=0;s<path.length;s+=1){const a=samplePitPath(s),b=samplePitPath(Math.min(s+1,path.length));
  for(let u=-4;u<4;u++){const ps=[[a.x-a.tz*u,a.z+a.tx*u],[a.x-a.tz*(u+1),a.z+a.tx*(u+1)],[b.x-b.tz*u,b.z+b.tx*u],[b.x-b.tz*(u+1),b.z+b.tx*(u+1)]];
   if(ps.some(p=>pitTrackDistance(p[0],p[1])<10.1))continue;
   for(const i of [0,1,2,1,3,2])verts.push(ps[i][0],0.025,ps[i][1]);}}
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(verts,3));g.computeVertexNormals();
 const asphalt=new THREE.Mesh(g,new THREE.MeshStandardMaterial({color:0x34383b,roughness:0.95,side:THREE.DoubleSide}));asphalt.name='pit-asphalt';asphalt.receiveShadow=true;group.add(asphalt);
 // Paint is aligned to the same path as collision and guidance. Clip every
 // triangle to the pit side of the race boundary, including entry/exit.
 const white:number[]=[],yellow:number[]=[];
 function paintTriangle(out:number[],ps:number[][]){
  // Dense enough for curved boundaries; geometry audit checks interiors too.
  if(ps.some(p=>pitTrackDistance(p[0],p[1])<10.1))return;
  for(const p of ps)out.push(p[0],0.055,p[1]);
 }
 function at(s:number,u:number){const p=samplePitPath(s);return [p.x-p.tz*u,p.z+p.tx*u];}
 for(let s=0;s<path.length-1;s++)for(const edge of [-3.5,3.5]){
  const ps=[at(s,edge-0.16),at(s,edge+0.16),at(s+1,edge-0.16),at(s+1,edge+0.16)];
  paintTriangle(white,[ps[0],ps[1],ps[2]]);paintTriangle(white,[ps[1],ps[3],ps[2]]);
 }
 let arrowCount=0;
 for(let s=32;s<path.length-15;s+=18){
  const c=samplePitPath(s);
  const local=[[-2.6,-0.3],[0.5,-0.3],[0.5,-1.35],[3,0],[0.5,1.35],[0.5,0.3],[-2.6,0.3]];
  const ps=local.map(([along,side])=>[c.x+c.tx*along-c.tz*side,c.z+c.tz*along+c.tx*side]);
  if(ps.some(p=>pitTrackDistance(p[0],p[1])<10.1))continue;
  for(const inds of [[0,1,5],[0,5,6],[2,3,4]])paintTriangle(yellow,inds.map(i=>ps[i]));arrowCount++;
 }
 for(const [name,vertices,color] of [['pit-entry-boundaries',white,0xffffff],['pit-direction-arrows',yellow,0xffd52a]] as const){
  const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geo.computeVertexNormals();
  const mesh=new THREE.Mesh(geo,new THREE.MeshBasicMaterial({color,side:THREE.DoubleSide}));mesh.name=name;group.add(mesh);
 }
 group.userData.arrowCount=arrowCount;
 box('service-apron',200,0.012,-298.5,280,0.02,9,0x454a4e);
 box('paddock-ground',200,0.01,-353,280,0.02,58,0x636969);
 box('pit-wall',194,0.55,-281.8,312,1.1,0.6,0xc6cbd0);
 const colors=[0x2675bb,0xb43136,0xb9a263,0x278763,0xc77524];
 const pitch=(L.garageEast-L.garageWest)/L.garageCount;
 for(let i=0;i<L.garageCount;i++){
  const x=L.garageWest+(i+0.5)*pitch,c=colors[Math.floor(i/4)];
  box('garage-floor-'+i,x,0.1,-313.5,pitch,0.2,21,0x777b7e);
  box('garage-rear-'+i,x,3.3,-323.5,pitch,6.6,1,0x9ca2a7);
  box('garage-divider-'+i,x-pitch/2+0.2,3.3,-313.5,0.4,6.6,21,0x9ca2a7);
  box('garage-roof-'+i,x,6.7,-313.5,pitch,0.4,22,0xe0e4e5);
  box('garage-fascia-'+i,x,5.7,-302.9,pitch,1.5,0.3,c);
  box('garage-back-panel-'+i,x,2.5,-322.8,pitch-1,4.5,0.1,0x222a30);
  label(String(i+1).padStart(2,'0'),x,5.7,-302.69,3);
 }
 box('garage-end-wall',335,3.3,-313.5,0.4,6.6,21,0x9ca2a7);
 label('INDY GRAND PRIX  /  PIT GARAGES',200,7.5,-302.8,62);
 for(let t=0;t<5;t++){
  const x=310-t*60,c=colors[t];
  // U-shaped service boxes opposite each team's four garage bays.
  box('box-mark',x-4,0.035,-298,0.2,0.02,6,0xffffff);
  box('box-mark',x+4,0.035,-298,0.2,0.02,6,0xffffff);
  box('box-mark',x,0.035,-301,8,0.02,0.2,0xffffff);
  label('TEAM '+(t+1),x,5.6,-302.65,10);
  // Grounded hospitality building, trailer chassis/wheels, and supported tent.
  box('hospitality-base-'+t,x,0.2,-371,38,0.4,17,0x737a80);
  box('hospitality-body-'+t,x,3.2,-371,38,5.6,17,0xe0e4e5);
  box('hospitality-glass-'+t,x,3.5,-362.4,34,3,0.12,0x263f4e);
  box('hospitality-band-'+t,x,5.8,-362.3,38,0.5,0.15,c);
  box('hauler-chassis-'+t,x,0.6,-345,28,0.5,6,0x222a30);
  box('hauler-body-'+t,x,2.7,-345,28,3.8,6,0xbfc7cc);
  for(const dx of [-10,9])for(const dz of [-2.8,2.8])box('hauler-wheel',x+dx,0.45,-345+dz,1.1,0.9,0.7,0x16191c);
  for(const dx of [-17,17])box('canopy-post',x+dx,2.5,-333,0.18,5,0.18,0x90999e);
  box('canopy',x,5,-333,36,0.25,8,c);
 }
 label('PADDOCK  /  TEAM HOSPITALITY',200,7,-362.2,58);
 // Readable freestanding boards strictly outside track territory.
 box('entry-sign-post',391,2,-351,0.2,4,0.2,0x90999e);
 label('PIT ENTRY  >',391,4.3,-351,12,Math.PI);
 box('exit-sign-post',-29,2,-241,0.2,4,0.2,0x90999e);
 label('PIT EXIT  >',-29,4.2,-241,9,Math.PI/2);
 box('limit-post',354,1.3,-302,0.15,2.6,0.15,0x90999e);
 label('80 km/h',354,2.6,-302,6,Math.PI/2);
 for(const [color,parts] of batches){const m=new THREE.Mesh(mergeGeometries(parts)!,new THREE.MeshStandardMaterial({color,roughness:0.8}));m.name='pit-batch-'+color;m.castShadow=true;m.receiveShadow=true;group.add(m);}
 scene.add(group);return {group};
}
