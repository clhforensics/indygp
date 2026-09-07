import assert from 'node:assert/strict';
import {createServer} from 'vite';
const server=await createServer({root:process.cwd()+'/packages/render',server:{middlewareMode:true},appType:'custom',logLevel:'error'});
try{
const C=await server.ssrLoadModule('../core/src/index.ts');const cl=C.buildCentreline(C.NODES,2);
function loc(x,z){let best=null,d=Infinity;for(let i=0;i<cl.count;i++){const j=(i+1)%cl.count,ax=cl.pts[2*i],az=cl.pts[2*i+1],dx=cl.pts[2*j]-ax,dz=cl.pts[2*j+1]-az,len=Math.hypot(dx,dz),t=Math.max(0,Math.min(1,((x-ax)*dx+(z-az)*dz)/(len*len))),px=ax+t*dx,pz=az+t*dz,dd=Math.hypot(x-px,z-pz);if(dd<d){d=dd;best={index:i,s:cl.cum[i]+t*len,px,pz,tx:dx/len,tz:dz/len,lateral:((x-px)*(-dz)+(z-pz)*dx)/len,curv:0};}}return best;}
let crossings=0;
for(const [x,z] of [[400,-338],[398,-332],[-12,-210],[-10,-204],[-7,-194]]){
const v=C.createVehicle(x,z,0);v.vLong=10;const before=[v.x,v.z];const hit=C.applyBarriers(v,loc(x,z),cl,{wallOffset:9.4,scrub:0.8});
assert.equal(hit,0,'invisible wall blocks opening at '+[x,z]);assert.deepEqual([v.x,v.z],before);crossings++;}
const outside=C.createVehicle(422,-338,0);outside.vLong=10;assert.ok(C.applyBarriers(outside,loc(422,-338),cl,{wallOffset:9.4,scrub:0.8})>0);
console.log('PASS real applyBarriers: '+crossings+' opening crossings pass; opposite barrier remains solid');
assert.ok(C.canRequestPit(400.6,-338));assert.ok(C.canRequestPit(410,-360));assert.ok(!C.canRequestPit(419,-338));
assert.ok(!C.shouldEnterPit(407,-352,2.15),'racing-line approach must NOT auto-capture');
assert.ok(C.shouldEnterPit(401,-332,2.4));assert.ok(!C.shouldEnterPit(410,-333,Math.PI/2));assert.ok(!C.shouldEnterPit(399,-333,-0.9));
console.log('PASS broadened request + full-approach natural turn-in; reverse heading rejected');
// Release happens just past the exit opening, NOT at the merge end.
const p={phase:'driving',s:C.getPitPath().cum[15],boxIndex:0,stopTimer:0,serviced:true};
for(let i=0;i<600;i++)C.advancePitRun(p,1/60);
assert.equal(p.phase,'none');const rel=C.samplePitPath(p.s);assert.ok(rel.z>=-216&&rel.z<=-204,'control returned at the opening, got z='+rel.z);
console.log('PASS manual control returned at the exit opening (z='+rel.z.toFixed(1)+')');
// Passing the pit area on the RACING LINE must NOT capture the car.
assert.ok(!C.shouldEnterPit(410,-350,2.0),'no capture from Capitol racing line');
assert.ok(!C.shouldEnterPit(409,-338,2.0),'no capture at T11 on the racing line');
assert.ok(C.shouldEnterPit(401,-336,2.3),'capture INSIDE the opening still works');
console.log('PASS passing-by on the track no longer teleports into the pit');
}finally{await server.close();}
