import { buildCentreline } from './geometry';
import { NODES } from './circuit';

export interface PitPathPoint { x: number; z: number }
// One surveyed footprint; z grows south. Exit stays WEST of T12/West St.
export const PIT_LAYOUT = { laneZ:-290, garageWest:65, garageEast:335,
 garageFront:-303, garageBack:-324, paddockBack:-382, garageCount:20 };
const WAYPOINTS: PitPathPoint[] = [
 {x:410,z:-360},{x:409,z:-350},{x:403,z:-338},{x:393,z:-325},
 {x:380,z:-310},{x:365,z:-296},{x:350,z:-290},
 {x:310,z:-290},{x:250,z:-290},{x:190,z:-290},{x:130,z:-290},{x:70,z:-290},
 {x:25,z:-290},{x:4,z:-291},{x:-12,z:-288},{x:-20,z:-278},
 {x:-21,z:-262},{x:-20,z:-246},{x:-17,z:-228},{x:-12,z:-210},
 {x:-6,z:-194},{x:0,z:-176},{x:0,z:-163}
];
export interface PitPath { pts:PitPathPoint[]; cum:number[]; length:number;
 limitFromS:number; limitToS:number; boxS:number[]; entryCapture:{x:number;z:number;r:number} }
let cached:PitPath|null=null;
export function getPitPath():PitPath {
 if(cached)return cached;
 const cum=[0]; for(let i=1;i<WAYPOINTS.length;i++)cum.push(cum[i-1]+Math.hypot(WAYPOINTS[i].x-WAYPOINTS[i-1].x,WAYPOINTS[i].z-WAYPOINTS[i-1].z));
 cached={pts:WAYPOINTS,cum,length:cum[cum.length-1],limitFromS:cum[6],limitToS:cum[18],
 boxS:[310,250,190,130,70].map(x=>cum[6]+350-x),entryCapture:{x:410,z:-360,r:18}};
 return cached;
}
export function samplePitPath(s:number):{x:number;z:number;tx:number;tz:number}{
 const p=getPitPath(),sc=Math.max(0,Math.min(p.length,s));let i=1;
 while(i<p.cum.length-1&&p.cum[i]<sc)i++;
 const a=p.pts[i-1],b=p.pts[i],len=p.cum[i]-p.cum[i-1],t=(sc-p.cum[i-1])/len;
 return {x:a.x+(b.x-a.x)*t,z:a.z+(b.z-a.z)*t,tx:(b.x-a.x)/len,tz:(b.z-a.z)/len};
}
export function projectOnPitPath(x:number,z:number):{s:number;lateral:number}{
 const p=getPitPath();let best={s:0,lateral:Infinity};
 for(let i=1;i<p.pts.length;i++){const a=p.pts[i-1],b=p.pts[i],dx=b.x-a.x,dz=b.z-a.z,l=dx*dx+dz*dz,t=Math.max(0,Math.min(1,((x-a.x)*dx+(z-a.z)*dz)/l)),d=Math.hypot(x-a.x-t*dx,z-a.z-t*dz);if(d<best.lateral)best={s:p.cum[i-1]+t*Math.sqrt(l),lateral:d};}return best;
}
// Shared physical lane envelope: no exemption on the other track side.
export function isPitDrivable(x:number,z:number):boolean {
 const p=projectOnPitPath(x,z);
 return p.lateral<=4 && p.s>0 && p.s<getPitPath().length;
}
export function canRequestPit(x:number,z:number):boolean {
 const p=projectOnPitPath(x,z);
 return p.s<=getPitPath().cum[6] && p.lateral<=7 && x<=414 && z>=-376;
}
export function shouldEnterPit(x:number,z:number,yaw:number):boolean {
 const p=projectOnPitPath(x,z),path=getPitPath();
 if(p.s>path.cum[6]+6||p.lateral>4.6||x>404.5)return false;   // must be THROUGH the barrier gap, not passing on Capitol
 const t=samplePitPath(p.s);
 return Math.cos(yaw)*t.tx+Math.sin(yaw)*t.tz>0.2;
}
const track=buildCentreline(NODES,2);
export const PIT_EDGE_OFFSET=8;
export const PIT_EAST_EXIT_X=5;   // T12 rig: base x on West St, east (pit) side   // street furniture: just outside the outer white line (3.5 m)
// Reseat a trackside object that blocks the pit corridor: keep it on the
// pit (right) side of the road, push it just outside the outer white line.
export function pitClearPosition(x:number,z:number):{x:number;z:number;moved:boolean}{
 const p=projectOnPitPath(x,z);
 if(p.lateral>=9)return {x,z,moved:false};
 const c=samplePitPath(p.s);
 // Perpendicular of the path; pick the side FARTHER from the race track.
 const px1=c.x-c.tz*PIT_EDGE_OFFSET,pz1=c.z+c.tx*PIT_EDGE_OFFSET;
 const px2=c.x+c.tz*PIT_EDGE_OFFSET,pz2=c.z-c.tx*PIT_EDGE_OFFSET;
 const pick=pitTrackDistance(px1,pz1)>=pitTrackDistance(px2,pz2)?[px1,pz1]:[px2,pz2];
 return {x:pick[0],z:pick[1],moved:true};
}
export function pitTrackDistance(x:number,z:number):number {
 let d=Infinity;for(let i=0;i<track.count;i++){const j=(i+1)%track.count,ax=track.pts[i*2],az=track.pts[i*2+1],dx=track.pts[j*2]-ax,dz=track.pts[j*2+1]-az,l=dx*dx+dz*dz,t=Math.max(0,Math.min(1,((x-ax)*dx+(z-az)*dz)/l));d=Math.min(d,Math.hypot(x-ax-t*dx,z-az-t*dz));}return d;
}
// Real holes in barriers, caps, kerbs, verge, catch fence AND posts.
export function isPitOpening(x:number,z:number):boolean {
 return (x>394&&x<405&&z>-355&&z<-318)||(x>-14&&x<-8&&z>-227&&z<-180);
}
export function inPitSite(x:number,z:number,pad=0):boolean {
 return x>-32-pad&&x<399+pad&&z>-389-pad&&z<-281+pad;
}
export const PIT_SPEED_LIMIT=22;
export const PIT_STOP_SECONDS=3.2;
export const PIT_LANES={aiPitLaneOffset:-20};
export interface PitRun {phase:'none'|'driving'|'stopping'|'stopped';s:number;stopTimer:number;boxIndex:number;serviced:boolean}
export function advancePitRun(p:PitRun,dt:number):{speed:number;fresh:boolean}{
 if(p.phase==='none')return {speed:0,fresh:false};
 if(p.phase==='stopping'){p.stopTimer-=dt;if(p.stopTimer<=0){p.serviced=true;p.phase='driving';return {speed:0,fresh:true};}return {speed:0,fresh:false};}
 const path=getPitPath(),box=path.boxS[p.boxIndex],remaining=box-p.s;
 const speed=p.serviced?PIT_SPEED_LIMIT:Math.min(PIT_SPEED_LIMIT,Math.sqrt(Math.max(0,remaining)*12)+1);
 const next=p.s+speed*dt;
 if(!p.serviced&&next>=box){p.s=box;p.phase='stopping';p.stopTimer=PIT_STOP_SECONDS;return {speed:0,fresh:false};}
 p.s=Math.min(next,path.length);
 // Control returns the moment the car clears the exit opening; the rest of
 // the merge is driven by the player along the exempt corridor.
 if(p.s>=path.cum[19]){p.phase='none';}   // x≈-12, z≈-210: just cleared the opening
 return {speed,fresh:false};
}
