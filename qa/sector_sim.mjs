// Sector engine verification: bounce immunity + line-anchored timing
const L = 5218.0;
const b1 = L / 3, b2 = (2 * L) / 3;
const speed = L / 84 / 60; // one 84 s lap at 60 fps

function runSim(positions, label) {
  let cur = 0, live = 0, prev = 0;
  const splits = [null, null, null];
  const bests = [null, null, null];
  const log = [];
  for (const p of positions) {
    live += 1 / 60;
    const fp = (b) => prev < b && p >= b;      // forward-only crossing
    if (cur === 0 && fp(b1)) {
      splits[0] = live; bests[0] = bests[0] == null ? live : Math.min(bests[0], live);
      log.push(`S1 ${live.toFixed(2)}`); cur = 1; live = 0;
    } else if (cur === 1 && fp(b2)) {
      splits[1] = live; bests[1] = bests[1] == null ? live : Math.min(bests[1], live);
      log.push(`S2 ${live.toFixed(2)}`); cur = 2; live = 0;
    } else if (cur === 2 && p < prev * 0.5) {  // line wrap, forward only
      splits[2] = live; bests[2] = bests[2] == null ? live : Math.min(bests[2], live);
      log.push(`S3 ${live.toFixed(2)} (lap sum ${(splits[0]+splits[1]+splits[2]).toFixed(2)})`);
      cur = 0; live = 0; splits[0] = splits[1] = splits[2] = null;
    }
    prev = p;
  }
  console.log(label, '->', log);
  return { splits, bests };
}

// Case 1: clean lap
let pos = [];
for (let i = 1; i <= 84 * 60; i++) pos.push(i * speed);
runSim(pos, 'clean lap        ');

// Case 2: wall bounce at 1.93 s (car reverses 5 m over 3 frames, then recovers)
pos = [];
for (let i = 1; i <= 84 * 60; i++) pos.push(i * speed);
const bounceAt = Math.floor(1.93 * 60);
const bp = pos[bounceAt];
pos.splice(bounceAt, 0, bp - 3, bp - 5, bp);   // backward frames
runSim(pos, 'wall bounce @1.93 ');

// Case 3: full reverse across the S2 gate, then forward again — S2 must NOT fire
pos = [];
for (let i = 1; i <= 40 * 60; i++) pos.push(i * speed);
const revStart = 40 * 60 * speed;
for (let d = 1; d <= 60; d++) pos.push(revStart - d);          // reversing across b2
for (let i = 1; i <= 300; i++) pos.push(revStart + i * speed); // forward again
runSim(pos, 'reverse over gate ');
