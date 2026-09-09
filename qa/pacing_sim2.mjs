// RACE-V4.1 verification: reference snapshot AFTER S3 closes -> all three
// sectors get deltas; purple latches on session-best splits.
const L = 5218.0;
const b1 = L / 3, b2 = (2 * L) / 3;

function runSession(lapTimes) {
  let ref = null, best = null;
  const bests = [null, null, null];
  const report = [];
  lapTimes.forEach((lapS, li) => {
    const speed = L / lapS / 60;
    let cur = 0, live = 0, prev = 0;
    const splits = [null, null, null];
    for (let f = 0; f < Math.ceil(lapS * 60) + 5; f++) {
      const p = Math.min((f + 1) * speed, L);
      live += 1 / 60;
      const fp = (b) => prev < b && p >= b;
      const close = (idx) => {
        splits[idx] = live;
        bests[idx] = bests[idx] == null ? live : Math.min(bests[idx], live);
        cur = idx + 1; live = 0;
      };
      if (cur === 0 && fp(b1)) close(0);
      else if (cur === 1 && fp(b2)) close(1);
      else if (cur === 2 && p >= L - speed * 0.5) {
        close(2);                                    // S3 CLOSED FIRST
        const total = splits[0] + splits[1] + splits[2];
        const newBest = best == null || total < best;
        if (newBest) { best = total; ref = [...splits]; }  // THEN snapshot
        // render each cell per the new HUD rules
        const cells = [0, 1, 2].map((i) => {
          const s = splits[i];
          const isSessionBest = bests[i] != null && Math.abs(s - bests[i]) < 1e-6;
          if (ref && ref[i] != null) {
            const d = s - ref[i];
            const cls = isSessionBest ? 'PURPLE' : d <= 0 ? 'GREEN' : 'YELLOW';
            return `S${i + 1} ${d <= 0 ? '-' : '+'}${Math.abs(d).toFixed(2)} ${cls}`;
          }
          return `S${i + 1} ${s.toFixed(2)} ${isSessionBest ? 'PURPLE' : 'plain'}`;
        });
        report.push(`lap ${li + 1}: ` + cells.join(' | '));
        cur = 0; live = 0;
        return;
      }
      prev = p;
    }
  });
  return report;
}

// lap1 = slow reference (87s), lap2 = slower (90s), lap3 = fastest (83.5s)
const out = runSession([87, 90, 83.5]);
out.forEach((l) => console.log(l));
console.log('\nExpect: lap1 plain/purple-mix (sets ref), lap2 all YELLOW +deltas,');
console.log('lap3 all GREEN with S-cells PURPLE where they set session bests.');
