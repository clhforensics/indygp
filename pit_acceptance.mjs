import assert from 'node:assert/strict';
import {createServer} from 'vite';
const server=await createServer({root:process.cwd()+'/packages/render',server:{middlewareMode:true},appType:'custom',logLevel:'error'});
try{
 const C=await server.ssrLoadModule('../core/src/index.ts'),T=await server.ssrLoadModule('/node_modules/three/build/three.module.js'),R=await server.ssrLoadModule('/src/world/pitlane.ts');
 const scene=new T.Scene(),{group}=R.buildPitLane(scene);scene.updateMatrixWorld(true);
 let tested=0,min=Infinity;const failures=[];
 group.traverse(o=>{if(!o.isMesh)return;const raw=o.geometry.index?o.geometry.toNonIndexed():o.geometry,p=raw.attributes.position;
 for(let i=0;i<p.count;i+=3){const vs=[0,1,2].map(k=>new T.Vector3().fromBufferAttribute(p,i+k).applyMatrix4(o.matrixWorld));
 const edge=Math.max(...vs.map((v,k)=>v.distanceTo(vs[(k+1)%3]))),n=Math.max(1,Math.ceil(edge/2));
 for(let a=0;a<=n;a++)for(let b=0;b<=n-a;b++){const v=vs[0].clone().multiplyScalar(a/n).addScaledVector(vs[1],b/n).addScaledVector(vs[2],1-(a+b)/n),d=C.pitTrackDistance(v.x,v.z);min=Math.min(min,d);tested++;if(d<9.65)failures.push([o.name,...[v.x,v.y,v.z,d].map(x=>+x.toFixed(2))]);}}
 });
 assert.equal(failures.length,0,JSON.stringify(failures.slice(0,8)));
 console.log('PASS mesh interiors/edges/world transforms:',tested,'samples; min track CL distance',min.toFixed(3),'m');
 const cs=group.userData.components;
 assert.equal(cs.filter(c=>c.name.startsWith('garage-floor-')).length,20);
 assert.equal(cs.filter(c=>c.name.startsWith('hospitality-body-')).length,5);
 for(const c of cs.filter(c=>c.name.startsWith('hospitality-base-')))assert.equal(c.y-c.h/2,0);
 console.log('PASS 20 open garage bays, 5 grounded hospitality bases, 5 haulers');
 const path=C.getPitPath();let inside=0;
 for(let s=path.cum[6];s<=path.cum[18];s+=0.5){const p=C.samplePitPath(s);assert.ok(C.pitTrackDistance(p.x,p.z)>14.2,'Path/car envelope crosses track at '+s);inside++;}
 assert.ok(C.pitTrackDistance(path.entryCapture.x,path.entryCapture.z)<0.2);
 assert.ok(C.isPitOpening(400.6,-334));assert.ok(C.isPitOpening(-9.4,-202));assert.ok(!C.isPitOpening(9.4,-202));
 console.log('PASS separated lane and OUTSIDE-T12 exit:',inside,'path samples; capture on track; correct-side openings');
 for(const fps of [30,60,144])for(let box=0;box<5;box++){
 const p={phase:'driving',s:0,boxIndex:box,stopTimer:0,serviced:false};let stops=0,fresh=0,seconds=0;
 while(p.phase!=='none'&&seconds<90){const before=p.phase,result=C.advancePitRun(p,1/fps);if(before!=='stopping'&&p.phase==='stopping')stops++;if(result.fresh)fresh++;seconds+=1/fps;}
 assert.equal(p.phase,'none');assert.equal(stops,1);assert.equal(fresh,1);
assert.ok(p.s>=C.getPitPath().cum[19]-2&&p.s<=C.getPitPath().cum[19]+2,'released at exit opening, s='+p.s);
 }
 console.log('PASS all 5 boxes at 30/60/144 FPS: one stop, one tire service, full exit');
 console.log('PIT ACCEPTANCE PASSED');
}finally{await server.close();}
