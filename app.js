(function () {
  'use strict';

  const STORAGE_KEY = 'tt-poule-tournament-v1';

  let state = migrate(load()) || emptyState();

  function defaultHandicap() {
    return [
      { min: 0, max: 135, points: 0 },
      { min: 136, max: 270, points: 2 },
      { min: 271, max: 305, points: 3 },
      { min: 306, max: 440, points: 4 },
      { min: 441, max: 575, points: 5 },
      { min: 576, max: 810, points: 6 },
      { min: 811, max: null, points: 7 },
    ];
  }

  function emptyState() {
    return {
      players: [{ name: '', rating: 0 }, { name: '', rating: 0 }],
      handicap: defaultHandicap(),
      numPoules: 2,
      qualifiers: 2,
      bestOf: 3,
      poules: null,
      knockout: null,
      activeTab: 'setup',
    };
  }

  function migrate(s) {
    if (!s) return null;
    if (Array.isArray(s.players) && s.players.length && typeof s.players[0] === 'string') {
      s.players = s.players.map(name => ({ name, rating: 0 }));
    }
    if (!s.players) s.players = [{ name: '', rating: 0 }, { name: '', rating: 0 }];
    if (!s.handicap) s.handicap = defaultHandicap();
    if (s.poules && s._scheduled !== 2) {
      s.poules.forEach(p => { p.matches = scheduleMatches(p.matches); });
      s._scheduled = 2;
    }
    return s;
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  // ---------- Tournament generation ----------

  function distributePlayers(players, numPoules) {
    // Snake distribution for balance.
    const poules = Array.from({ length: numPoules }, () => []);
    let dir = 1;
    let i = 0;
    for (const p of players) {
      poules[i].push(p);
      if (dir === 1) {
        if (i === numPoules - 1) { dir = -1; } else { i++; }
      } else {
        if (i === 0) { dir = 1; } else { i--; }
      }
    }
    return poules;
  }

  function generateRoundRobin(players) {
    const matches = [];
    for (let a = 0; a < players.length; a++) {
      for (let b = a + 1; b < players.length; b++) {
        matches.push({
          id: `${players[a]}__${players[b]}`,
          players: [players[a], players[b]],
          sets: [],
        });
      }
    }
    return scheduleMatches(matches);
  }

  // Deterministic match scheduler. Tries multiple starting matches and
  // scoring weight combinations, keeping the schedule with the fewest
  // back-to-back appearances and, as a tiebreak, the most evenly spaced
  // matches per player. Output is fully determined by the input.
  function scheduleMatches(matches) {
    if (matches.length <= 1) return matches.slice();
    const canonical = matches.slice().sort((a, b) =>
      a.players[0].localeCompare(b.players[0]) ||
      a.players[1].localeCompare(b.players[1]));
    const totalPlays = {};
    for (const m of canonical) {
      totalPlays[m.players[0]] = (totalPlays[m.players[0]] || 0) + 1;
      totalPlays[m.players[1]] = (totalPlays[m.players[1]] || 0) + 1;
    }
    const weights = [[1, 0], [0, 1], [1, 0.1], [1, 1]];
    let best = null, bestKey = null;
    for (const [wu, wr] of weights) {
      for (let startIdx = 0; startIdx < canonical.length; startIdx++) {
        const candidate = scheduleGreedy(canonical, startIdx, totalPlays, wu, wr);
        const key = scheduleScore(candidate);
        if (!bestKey || key[0] < bestKey[0] || (key[0] === bestKey[0] && key[1] < bestKey[1])) {
          bestKey = key;
          best = candidate;
        }
      }
    }
    return best;
  }

  function scheduleGreedy(canonical, startIdx, totalPlays, wUrgency, wRest) {
    const M = canonical.length;
    const remaining = canonical.slice();
    const start = remaining.splice(startIdx, 1)[0];
    const ordered = [start];
    const played = {}, lastPlayed = {};
    for (const p in totalPlays) { played[p] = 0; lastPlayed[p] = -1; }
    played[start.players[0]]++; played[start.players[1]]++;
    lastPlayed[start.players[0]] = 0; lastPlayed[start.players[1]] = 0;
    while (remaining.length) {
      const lastPlayers = new Set(ordered[ordered.length - 1].players);
      const nextPos = ordered.length + 1;
      let bestIdx = 0, bestScore = -Infinity;
      for (let i = 0; i < remaining.length; i++) {
        const m = remaining[i];
        const shares = m.players.some(p => lastPlayers.has(p));
        let urgency = 0, minRest = Infinity;
        for (const p of m.players) {
          urgency += totalPlays[p] * nextPos / M - played[p];
          const rest = ordered.length - lastPlayed[p];
          if (rest < minRest) minRest = rest;
        }
        const sc = (shares ? -1e9 : 0) + wUrgency * urgency + wRest * minRest;
        if (sc > bestScore) { bestScore = sc; bestIdx = i; }
      }
      const chosen = remaining.splice(bestIdx, 1)[0];
      ordered.push(chosen);
      played[chosen.players[0]]++; played[chosen.players[1]]++;
      lastPlayed[chosen.players[0]] = ordered.length - 1;
      lastPlayed[chosen.players[1]] = ordered.length - 1;
    }
    return ordered;
  }

  function scheduleScore(order) {
    let b2b = 0;
    for (let i = 1; i < order.length; i++) {
      const prev = new Set(order[i - 1].players);
      if (order[i].players.some(p => prev.has(p))) b2b++;
    }
    const positions = {};
    for (let i = 0; i < order.length; i++) {
      for (const p of order[i].players) (positions[p] = positions[p] || []).push(i);
    }
    let variance = 0;
    for (const p in positions) {
      const ps = positions[p];
      if (ps.length < 2) continue;
      const ideal = order.length / ps.length;
      for (let i = 1; i < ps.length; i++) {
        const d = (ps[i] - ps[i - 1]) - ideal;
        variance += d * d;
      }
    }
    return [b2b, variance];
  }

  function generateTournament() {
    const players = state.players
      .map(p => ({ name: (p.name || '').trim(), rating: Number(p.rating) || 0 }))
      .filter(p => p.name);
    const numPoules = Math.max(1, parseInt(document.getElementById('num-poules').value, 10) || 1);
    const qualifiers = Math.max(1, parseInt(document.getElementById('qualifiers').value, 10) || 1);
    const bestOf = parseInt(document.getElementById('best-of').value, 10) || 3;

    if (players.length < 2) {
      alert('Please enter at least 2 players.');
      return;
    }
    if (numPoules > players.length) {
      alert('Number of poules cannot exceed number of players.');
      return;
    }

    const seen = new Set();
    for (const p of players) {
      if (seen.has(p.name)) {
        alert(`Duplicate player name: "${p.name}". Names must be unique.`);
        return;
      }
      seen.add(p.name);
    }

    const names = players.map(p => p.name);
    const distributed = distributePlayers(names, numPoules);
    const poules = distributed.map((pls, idx) => ({
      name: `Poule ${String.fromCharCode(65 + idx)}`,
      players: pls,
      matches: generateRoundRobin(pls),
    }));

    state.players = players;
    state.numPoules = numPoules;
    state.qualifiers = qualifiers;
    state.bestOf = bestOf;
    state.poules = poules;
    state.knockout = null;
    state.activeTab = 'poules';
    save();
    renderAll();
    setActiveTab('poules');
  }

  function getRating(name) {
    const p = state.players.find(x => x.name === name);
    return p ? Number(p.rating) || 0 : 0;
  }

  function lookupHandicapPoints(diff) {
    for (const r of state.handicap) {
      const min = Number(r.min) || 0;
      const max = (r.max == null || r.max === '') ? Infinity : Number(r.max);
      if (diff >= min && diff <= max) return Number(r.points) || 0;
    }
    return 0;
  }

  function getMatchHandicap(playerA, playerB) {
    if (!playerA || !playerB) return null;
    const ra = getRating(playerA), rb = getRating(playerB);
    const diff = Math.abs(ra - rb);
    const points = lookupHandicapPoints(diff);
    if (!points) return null;
    return { side: ra < rb ? 0 : 1, points, diff, lowerName: ra < rb ? playerA : playerB };
  }

  // ---------- Match logic ----------

  function setsRequiredToWin(bestOf) {
    return bestOf === 1 ? 1 : Math.ceil(bestOf / 2);
  }

  function matchResult(match, bestOf) {
    let setsA = 0, setsB = 0, pointsA = 0, pointsB = 0, played = 0;
    for (const s of match.sets) {
      if (s == null) continue;
      const [a, b] = s;
      if (a == null || b == null || a === '' || b === '') continue;
      const na = Number(a), nb = Number(b);
      if (Number.isNaN(na) || Number.isNaN(nb)) continue;
      played++;
      pointsA += na; pointsB += nb;
      if (na > nb) setsA++;
      else if (nb > na) setsB++;
    }
    const need = setsRequiredToWin(bestOf);
    let winner = null;
    if (bestOf === 1) {
      if (played >= 1 && setsA !== setsB) winner = setsA > setsB ? 0 : 1;
    } else {
      if (setsA >= need) winner = 0;
      else if (setsB >= need) winner = 1;
    }
    return { setsA, setsB, pointsA, pointsB, played, winner };
  }

  function computeStandings(poule, bestOf) {
    const stats = {};
    for (const p of poule.players) {
      stats[p] = { player: p, played: 0, wins: 0, losses: 0, setsFor: 0, setsAgainst: 0, pointsFor: 0, pointsAgainst: 0 };
    }
    for (const m of poule.matches) {
      const r = matchResult(m, bestOf);
      if (r.winner == null) continue;
      const [pa, pb] = m.players;
      stats[pa].played++; stats[pb].played++;
      stats[pa].setsFor += r.setsA; stats[pa].setsAgainst += r.setsB;
      stats[pb].setsFor += r.setsB; stats[pb].setsAgainst += r.setsA;
      stats[pa].pointsFor += r.pointsA; stats[pa].pointsAgainst += r.pointsB;
      stats[pb].pointsFor += r.pointsB; stats[pb].pointsAgainst += r.pointsA;
      if (r.winner === 0) { stats[pa].wins++; stats[pb].losses++; }
      else { stats[pb].wins++; stats[pa].losses++; }
    }
    const arr = Object.values(stats);
    arr.sort((a, b) => {
      if (b.wins !== a.wins) return b.wins - a.wins;
      const setDiffA = a.setsFor - a.setsAgainst;
      const setDiffB = b.setsFor - b.setsAgainst;
      if (setDiffB !== setDiffA) return setDiffB - setDiffA;
      const pointDiffA = a.pointsFor - a.pointsAgainst;
      const pointDiffB = b.pointsFor - b.pointsAgainst;
      if (pointDiffB !== pointDiffA) return pointDiffB - pointDiffA;
      return a.player.localeCompare(b.player);
    });
    return arr;
  }

  // ---------- Knockout generation ----------

  function nextPowerOfTwo(n) {
    let p = 1;
    while (p < n) p *= 2;
    return p;
  }

  function seedOrder(size) {
    // Returns array of seeds (1-indexed) in bracket order so #1 and #2 only meet in final.
    let arr = [1, 2];
    while (arr.length < size) {
      const total = arr.length * 2 + 1;
      const next = [];
      for (const seed of arr) {
        next.push(seed);
        next.push(total - seed);
      }
      arr = next;
    }
    return arr;
  }

  function roundName(roundIdx, totalRounds) {
    const fromEnd = totalRounds - 1 - roundIdx;
    if (fromEnd === 0) return 'Final';
    if (fromEnd === 1) return 'Semifinals';
    if (fromEnd === 2) return 'Quarterfinals';
    if (fromEnd === 3) return 'Round of 16';
    if (fromEnd === 4) return 'Round of 32';
    return `Round ${roundIdx + 1}`;
  }

  function buildKnockout(qualifierCount) {
    if (qualifierCount < 2) return null;
    const size = nextPowerOfTwo(qualifierCount);
    const totalRounds = Math.log2(size);
    const rounds = [];
    for (let r = 0; r < totalRounds; r++) {
      const matchCount = size / Math.pow(2, r + 1);
      const matches = [];
      for (let i = 0; i < matchCount; i++) {
        matches.push({ id: `r${r}-m${i}`, slotA: null, slotB: null, sets: [] });
      }
      rounds.push({ name: roundName(r, totalRounds), matches });
    }
    const order = seedOrder(size); // 1-indexed seeds
    for (let i = 0; i < size / 2; i++) {
      rounds[0].matches[i].slotA = { type: 'seed', seed: order[i * 2] - 1 };
      rounds[0].matches[i].slotB = { type: 'seed', seed: order[i * 2 + 1] - 1 };
    }
    for (let r = 1; r < totalRounds; r++) {
      for (let i = 0; i < rounds[r].matches.length; i++) {
        rounds[r].matches[i].slotA = { type: 'winner', round: r - 1, match: i * 2 };
        rounds[r].matches[i].slotB = { type: 'winner', round: r - 1, match: i * 2 + 1 };
      }
    }
    return { size, rounds };
  }

  function buildSeedList() {
    // Take qualifiers from each poule, ranked. Interleave by rank then poule.
    const ranks = state.poules.map(p => computeStandings(p, state.bestOf));
    const seeds = [];
    for (let rank = 0; rank < state.qualifiers; rank++) {
      for (let pi = 0; pi < ranks.length; pi++) {
        if (ranks[pi][rank]) {
          seeds.push({
            player: ranks[pi][rank].player,
            pouleIndex: pi,
            rank: rank + 1,
          });
        }
      }
    }
    return seeds;
  }

  function generateKnockout() {
    const seeds = buildSeedList();
    if (seeds.length < 2) {
      alert('Need at least 2 qualifiers to start the knockout stage.');
      return;
    }
    state.knockout = buildKnockout(seeds.length);
    save();
    renderKnockout();
    setActiveTab('knockout');
  }

  function resolveSlot(slot, seeds, knockout) {
    if (!slot) return null;
    if (slot.type === 'seed') {
      const s = seeds[slot.seed];
      return s ? { name: s.player, label: `${s.rank}${String.fromCharCode(65 + s.pouleIndex)}` } : null; // beyond list = bye
    }
    if (slot.type === 'winner') {
      const refMatch = knockout.rounds[slot.round].matches[slot.match];
      const a = resolveSlot(refMatch.slotA, seeds, knockout);
      const b = resolveSlot(refMatch.slotB, seeds, knockout);
      // If one side is a bye and the other isn't, the non-bye auto-advances.
      if (a && !b) return a;
      if (b && !a) return b;
      if (!a && !b) return null;
      const r = matchResult(refMatch, state.bestOf);
      if (r.winner === 0) return a;
      if (r.winner === 1) return b;
      return null;
    }
    return null;
  }

  // ---------- Rendering ----------

  function renderAll() {
    renderSetup();
    renderPoules();
    renderKnockout();
  }

  function renderSetup() {
    renderPlayerList();
    renderHandicapList();
    document.getElementById('num-poules').value = state.numPoules;
    document.getElementById('qualifiers').value = state.qualifiers;
    document.getElementById('best-of').value = state.bestOf;
  }

  function renderPlayerList() {
    const list = document.getElementById('players-list');
    list.innerHTML = '';
    state.players.forEach((p, idx) => {
      const row = document.createElement('div');
      row.className = 'player-row';
      row.innerHTML = `
        <input type="text" placeholder="Player ${idx + 1}" data-field="name" value="${escapeAttr(p.name || '')}" />
        <input type="number" placeholder="Rating" data-field="rating" value="${p.rating ?? ''}" />
        <button type="button" class="row-remove" title="Remove">×</button>
      `;
      const [nameInp, ratingInp] = row.querySelectorAll('input');
      nameInp.addEventListener('input', e => { state.players[idx].name = e.target.value; save(); });
      ratingInp.addEventListener('input', e => {
        state.players[idx].rating = e.target.value === '' ? 0 : Number(e.target.value);
        save();
      });
      row.querySelector('.row-remove').addEventListener('click', () => {
        state.players.splice(idx, 1);
        if (state.players.length === 0) state.players.push({ name: '', rating: 0 });
        save();
        renderPlayerList();
      });
      list.appendChild(row);
    });
  }

  function renderHandicapList() {
    const list = document.getElementById('handicap-list');
    list.innerHTML = '';
    state.handicap.forEach((rule, idx) => {
      const row = document.createElement('div');
      row.className = 'handicap-row';
      row.innerHTML = `
        <input type="number" placeholder="min" data-field="min" value="${rule.min ?? ''}" />
        <span class="sep">–</span>
        <input type="number" placeholder="max" data-field="max" value="${rule.max ?? ''}" />
        <span class="sep">→</span>
        <input type="number" placeholder="pts" data-field="points" value="${rule.points ?? ''}" />
        <button type="button" class="row-remove" title="Remove">×</button>
      `;
      const [minInp, maxInp, ptsInp] = row.querySelectorAll('input');
      minInp.addEventListener('input', e => { rule.min = e.target.value === '' ? 0 : Number(e.target.value); save(); refreshMatchViews(); });
      maxInp.addEventListener('input', e => { rule.max = e.target.value === '' ? null : Number(e.target.value); save(); refreshMatchViews(); });
      ptsInp.addEventListener('input', e => { rule.points = e.target.value === '' ? 0 : Number(e.target.value); save(); refreshMatchViews(); });
      row.querySelector('.row-remove').addEventListener('click', () => {
        state.handicap.splice(idx, 1);
        save();
        renderHandicapList();
        refreshMatchViews();
      });
      list.appendChild(row);
    });
  }

  function refreshMatchViews() {
    if (state.poules) renderPoules();
    if (state.knockout) renderKnockout();
  }

  function renderPoules() {
    const container = document.getElementById('poules-container');
    container.innerHTML = '';
    if (!state.poules) {
      container.innerHTML = '<div class="empty-state">No tournament generated yet. Go to <strong>Setup</strong> to begin.</div>';
      return;
    }

    state.poules.forEach((poule, pi) => {
      const div = document.createElement('div');
      div.className = 'poule';
      div.innerHTML = `<h3>${escapeHtml(poule.name)}</h3>`;

      // Standings table
      const standings = computeStandings(poule, state.bestOf);
      const medalClass = idx => idx === 0 ? 'gold' : idx === 1 ? 'silver' : idx === 2 ? 'bronze' : '';
      const table = document.createElement('table');
      table.className = 'standings-table';
      table.innerHTML = `
        <thead>
          <tr>
            <th class="num">#</th>
            <th>Player</th>
            <th class="num">P</th>
            <th class="num">W</th>
            <th class="num">L</th>
            <th class="num">Sets</th>
            <th class="num">Pts</th>
          </tr>
        </thead>
        <tbody>
          ${standings.map((s, idx) => `
            <tr class="${idx < state.qualifiers ? 'is-qualifier' : ''}">
              <td class="num"><span class="rank-badge ${medalClass(idx)}">${idx + 1}</span></td>
              <td class="player-name">${escapeHtml(s.player)}</td>
              <td class="num">${s.played}</td>
              <td class="num">${s.wins}</td>
              <td class="num">${s.losses}</td>
              <td class="num">${s.setsFor}–${s.setsAgainst}</td>
              <td class="num">${s.pointsFor}–${s.pointsAgainst}</td>
            </tr>
          `).join('')}
        </tbody>
      `;
      div.appendChild(table);

      // Matches
      const matchesWrap = document.createElement('div');
      matchesWrap.className = 'match-cards';
      poule.matches.forEach((m, mi) => {
        matchesWrap.appendChild(renderPouleMatchCard(poule, pi, m, mi));
      });
      div.appendChild(matchesWrap);
      container.appendChild(div);
    });

    container.querySelectorAll('.score-table input').forEach(inp => {
      inp.addEventListener('input', onScoreInput);
    });
  }

  function renderPouleMatchCard(poule, pi, m, mi) {
    const r = matchResult(m, state.bestOf);
    const hcap = getMatchHandicap(m.players[0], m.players[1]);
    const ra = getRating(m.players[0]);
    const rb = getRating(m.players[1]);
    const card = document.createElement('div');
    card.className = 'match-card';
    if (r.winner != null) card.classList.add('finished');

    const setHeaders = Array.from({ length: state.bestOf }, (_, i) => `<th>Set ${i + 1}</th>`).join('');
    const rowFor = (side) => {
      const isWinner = r.winner === side;
      const cells = Array.from({ length: state.bestOf }, (_, s) => {
        const cur = (m.sets[s] || ['', ''])[side] ?? '';
        return `<td><input type="number" min="0" inputmode="numeric"
          data-poule="${pi}" data-match="${mi}" data-set="${s}" data-side="${side}"
          value="${cur}" /></td>`;
      }).join('');
      const rating = side === 0 ? ra : rb;
      const ratingHtml = rating ? `<span class="rating">${rating}</span>` : '';
      return `<tr class="${isWinner ? 'winner' : ''}">
        <th class="player-cell">${escapeHtml(m.players[side])} ${ratingHtml}</th>
        ${cells}
      </tr>`;
    };

    const resultText = r.winner != null
      ? `${escapeHtml(m.players[r.winner])} wins ${r.winner === 0 ? r.setsA : r.setsB}–${r.winner === 0 ? r.setsB : r.setsA}`
      : 'Match in progress';

    card.innerHTML = `
      <div class="match-card-header">
        <span class="match-num">Match ${mi + 1}</span>
        ${hcap ? `<span class="match-hcap">${escapeHtml(hcap.lowerName)} starts each set at ${hcap.points} <span class="hint">(Δ ${hcap.diff})</span></span>` : ''}
      </div>
      <table class="score-table">
        <thead>
          <tr><th></th>${setHeaders}</tr>
        </thead>
        <tbody>
          ${rowFor(0)}
          ${rowFor(1)}
        </tbody>
      </table>
      <div class="match-result ${r.winner != null ? 'done' : ''}">${resultText}</div>
    `;
    return card;
  }

  function onScoreInput(e) {
    const inp = e.target;
    const pi = +inp.dataset.poule;
    const mi = +inp.dataset.match;
    const setIdx = +inp.dataset.set;
    const side = +inp.dataset.side;
    const match = state.poules[pi].matches[mi];
    while (match.sets.length <= setIdx) match.sets.push(['', '']);
    const val = inp.value === '' ? '' : Number(inp.value);
    match.sets[setIdx] = match.sets[setIdx] || ['', ''];
    match.sets[setIdx][side] = val;
    save();
    renderPoules();
    if (state.knockout) renderKnockout();
    const restored = document.querySelector(
      `.score-table input[data-poule="${pi}"][data-match="${mi}"][data-set="${setIdx}"][data-side="${side}"]`
    );
    if (restored) restored.focus();
  }

  function renderKnockout() {
    const container = document.getElementById('knockout-container');
    container.innerHTML = '';
    if (!state.poules) {
      container.innerHTML = '<div class="empty-state">No tournament yet. Generate one from <strong>Setup</strong>.</div>';
      return;
    }
    if (!state.knockout) {
      container.innerHTML = `
        <div class="empty-state">
          Knockout bracket not generated yet.
          <div class="actions" style="justify-content:center;">
            <button id="build-knockout" class="primary">Build bracket from current standings</button>
          </div>
        </div>
      `;
      document.getElementById('build-knockout').addEventListener('click', generateKnockout);
      return;
    }

    const seeds = buildSeedList();

    // Banner with regen option
    const banner = document.createElement('div');
    banner.style.marginBottom = '16px';
    banner.innerHTML = `<button id="rebuild-knockout">Rebuild bracket from current standings</button>
      <span class="hint" style="margin-left:12px;">Rebuilding clears entered knockout scores.</span>`;
    container.appendChild(banner);
    banner.querySelector('#rebuild-knockout').addEventListener('click', () => {
      if (confirm('Rebuild the knockout bracket from current poule standings? Knockout scores will be cleared.')) {
        generateKnockout();
      }
    });

    const bracket = document.createElement('div');
    bracket.className = 'bracket';

    state.knockout.rounds.forEach((round, ri) => {
      const col = document.createElement('div');
      col.className = 'round';
      col.innerHTML = `<h3>${escapeHtml(round.name)}</h3>`;
      round.matches.forEach((m, mi) => {
        const a = resolveSlot(m.slotA, seeds, state.knockout);
        const b = resolveSlot(m.slotB, seeds, state.knockout);
        const isBye = (a && !b) || (b && !a);
        const r = matchResult(m, state.bestOf);
        const matchEl = document.createElement('div');
        matchEl.className = 'bracket-match';
        matchEl.appendChild(renderBracketRow(a, 0, ri, mi, r, isBye));
        matchEl.appendChild(renderBracketRow(b, 1, ri, mi, r, isBye));
        if (a && b && !isBye) {
          const hcap = getMatchHandicap(a.name, b.name);
          if (hcap) {
            const hl = document.createElement('div');
            hl.className = 'bracket-handicap';
            hl.textContent = `${hcap.lowerName} starts at ${hcap.points} (Δ ${hcap.diff})`;
            matchEl.appendChild(hl);
          }
        }
        col.appendChild(matchEl);
      });
      bracket.appendChild(col);
    });

    container.appendChild(bracket);

    // Wire knockout inputs
    container.querySelectorAll('.bracket-row input').forEach(inp => {
      inp.addEventListener('input', onKnockoutScoreInput);
    });
  }

  function renderBracketRow(player, side, ri, mi, result, isBye) {
    const row = document.createElement('div');
    row.className = 'bracket-row';
    if (result.winner === side) row.classList.add('winner');
    const name = player ? `${escapeHtml(player.name)}${player.label ? ` <span class="hint">(${player.label})</span>` : ''}` : '<span class="hint">—</span>';
    const inputs = document.createElement('div');
    inputs.style.display = 'flex';
    inputs.style.gap = '4px';
    if (player && !isBye) {
      const m = state.knockout.rounds[ri].matches[mi];
      for (let s = 0; s < state.bestOf; s++) {
        const cur = m.sets[s] || ['', ''];
        const inp = document.createElement('input');
        inp.type = 'number';
        inp.min = '0';
        inp.dataset.round = ri;
        inp.dataset.match = mi;
        inp.dataset.set = s;
        inp.dataset.side = side;
        inp.value = cur[side] ?? '';
        inputs.appendChild(inp);
      }
    } else if (isBye && player) {
      const span = document.createElement('span');
      span.className = 'hint';
      span.textContent = 'bye';
      inputs.appendChild(span);
    }
    row.innerHTML = `<div class="name">${name}</div>`;
    row.appendChild(inputs);
    return row;
  }

  function onKnockoutScoreInput(e) {
    const inp = e.target;
    const ri = +inp.dataset.round;
    const mi = +inp.dataset.match;
    const setIdx = +inp.dataset.set;
    const side = +inp.dataset.side;
    const match = state.knockout.rounds[ri].matches[mi];
    while (match.sets.length <= setIdx) match.sets.push(['', '']);
    const val = inp.value === '' ? '' : Number(inp.value);
    match.sets[setIdx] = match.sets[setIdx] || ['', ''];
    match.sets[setIdx][side] = val;
    save();
    renderKnockout();
    const restored = document.querySelector(
      `.bracket-row input[data-round="${ri}"][data-match="${mi}"][data-set="${setIdx}"][data-side="${side}"]`
    );
    if (restored) restored.focus();
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function escapeAttr(s) { return escapeHtml(s); }

  // ---------- Tabs ----------

  function setActiveTab(name) {
    state.activeTab = name;
    save();
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.id === `tab-${name}`));
  }

  // ---------- Wire up ----------

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => setActiveTab(btn.dataset.tab));
  });

  document.getElementById('generate-btn').addEventListener('click', () => {
    if (state.poules && !confirm('A tournament already exists. Generating will replace it. Continue?')) return;
    generateTournament();
  });

  document.getElementById('add-player-btn').addEventListener('click', () => {
    state.players.push({ name: '', rating: 0 });
    save();
    renderPlayerList();
  });

  document.getElementById('add-handicap-btn').addEventListener('click', () => {
    state.handicap.push({ min: 0, max: null, points: 0 });
    save();
    renderHandicapList();
    refreshMatchViews();
  });

  document.getElementById('reset-handicap-btn').addEventListener('click', () => {
    if (!confirm('Reset handicap table to defaults?')) return;
    state.handicap = defaultHandicap();
    save();
    renderHandicapList();
    refreshMatchViews();
  });

  ['num-poules', 'qualifiers', 'best-of'].forEach(id => {
    document.getElementById(id).addEventListener('input', e => {
      const val = id === 'best-of' ? parseInt(e.target.value, 10) : Math.max(1, parseInt(e.target.value, 10) || 1);
      if (id === 'num-poules') state.numPoules = val;
      else if (id === 'qualifiers') state.qualifiers = val;
      else state.bestOf = val;
      save();
    });
  });

  document.getElementById('goto-knockout-btn').addEventListener('click', () => {
    if (!state.knockout) generateKnockout();
    else setActiveTab('knockout');
  });

  document.getElementById('reset-btn').addEventListener('click', () => {
    if (!confirm('Reset everything? All players and scores will be cleared.')) return;
    localStorage.removeItem(STORAGE_KEY);
    state = emptyState();
    renderAll();
    setActiveTab('setup');
  });

  // Initial render
  renderAll();
  setActiveTab(state.activeTab || 'setup');
})();
