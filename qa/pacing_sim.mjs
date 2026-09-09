// RACE-V4 pacing verification: reference = fastest lap's sectors.
// Scenarios: first lap neutral, second lap slower (yellow), third lap faster
// (green + purple on new-best gates), reference updates on the new best.
const L = 5218.0;
const b1 = L / 3, b2 = (2 * L) / 3;

function runLaps(lapTimes, label) {
  // Each lap: constant speed -> equal sectors = lapTime/3 (+speed varies per lap)
  let ref = null;            // fastest lap's sector splits
  let best = null;
  const lines = [];
  lapTimes.forEach((lapS, li) => {
    const speed = L / lapS / 60;
    let cur = 0, live = 0, prev = 0;
    const splits = [null, null, null];
    for (let f = 0; f < Math.ceil(lapS * 60); f++) {
      const p = Math.min((f + 1) * speed, L);
      live += 1 / 60;
      const fp = (b) => prev < b && p >= b;
      if (cur === 0 && fp(b1)) { splits[0] = live; cur = 1; live = 0; }
      else if (cur === 1 && fp(b2)) { splits[1] = live; cur = 2; live = 0; }
      else if (cur === 2 && p >= L - speed * 0.5) {
        splits[2] = live;
        const lapTotal = splits[0] + splits[1] + splits[2];
        const newBest = best == null || lapTotal < best;
        if (newBest) { best = lapTotal; ref = [...splits]; }
        // report each gate color vs the reference that was live AT THE TIME
        lines.push(`lap ${li + 1} (${lapS.toFixed(1)}s): ` +
          splits.map((s, i) => {
            const r = (ref && ref[i] != null && !(newBest && lapTotal === best)) ? ref[i] : null;
            if (r == null) return `S${i + 1} ${s.toFixed(2)}`;
            const d = s - r;
            return `S${i + 1} ${d <= 0 ? '-' : '+'}${Math.abs(d).toFixed(2)} ${d <= 0 ? 'GREEN' : 'YELLOW'}`;
          }).join(' | '));
        cur = 0; live = 0;
        break;
      }
      prev = p;
    }
  });
  console.log(label);
  lines.forEach((l) => console.log('  ' + l));
}

runLaps([86.0, 88.0, 84.0], 'F1 pacing: [86, 88, 84] — lap2 must be YELLOW, lap3 GREEN');
