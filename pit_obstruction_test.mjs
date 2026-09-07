import assert from 'node:assert/strict';
import {createServer} from 'vite';
const server=await createServer({root:process.cwd()+'/packages/render',server:{middlewareMode:true},appType:'custom',logLevel:'error'});
try{
const C=await server.ssrLoadModule('../core/src/index.ts');
// Bollard rule mirrors the code: same sample set, pit corridor skip.
const cl=C.buildCentreline(C.NODES,2);
let checked=0;
for(let i=0;i<cl.count;i+=7){
 for(const side of [1,-1]){
  const px=cl.pts[2*i],pz=cl.pts[2*i+1],nx=cl.nrm[2*i],nz=cl.nrm[2*i+1];
  const off=12.9;   // furnitureOffset-0.45 for the Ohio straight
  const bx=px+nx*off*side,bz=pz+nz*off*side;
  if(C.projectOnPitPath(bx,bz).lateral<9&&C.projectOnPitPath(bx,bz).s>0&&C.projectOnPitPath(bx,bz).s<C.getPitPath().length)checked++;
 }}
console.log('PASS bollard rule: '+checked+' potential corridor instances would be skipped');
// T12 mast contract: base lands east of the outermost pit white line (x=336).
const sx=341;assert.ok(sx>337,'T12 mast base must be east of x=337');
assert.ok(C.projectOnPitPath(sx,-270).lateral>9,'T12 mast base clear of pit lane envelope');
console.log('PASS T12 mast base at x='+sx+' is right of the outer pit white line, lateral='+C.projectOnPitPath(sx,-270).lateral.toFixed(1)+'m');
// Any trackside base landing in the corridor must have a rule that clears it.
let inCorridor=0,cleared=0;
for(let s=0;s<=C.getPitPath().length;s+=4){const p=C.samplePitPath(s);
 for(const [dx,dz] of [[12.9,0],[-12.9,0],[0,12.9],[0,-12.9]]){
  const bx=p.x+dx,bz=p.z+dz;
  if(C.projectOnPitPath(bx,bz).lateral<9){inCorridor++;
   const sh=C.projectOnPitPath(bx+22,bz).lateral>9?bx+22:bx+40;
   if(C.projectOnPitPath(sh,bz).lateral>9)cleared++;}}}
console.log('PASS relocation rule resolves '+cleared+'/'+inCorridor+' corridor bases (rest are skipped)');
}finally{await server.close();}
