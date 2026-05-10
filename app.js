(function () {
  'use strict';

  const STORAGE_KEY = 'tt-poule-tournament-v1';

  let state = load() || emptyState();

  function emptyState() {
    return {
      players: [],
      numPoules: 2,
      qualifiers: 2,
      bestOf: 3,
      poules: null,
      knockout: null,
      activeTab: 'setup',
    };
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
    return matches;
  }

  function generateTournament() {
    const playersText = document.getElementById('players').value;
    const players = playersText.split('\n').map(s => s.trim()).filter(Boolean);
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

    // Detect duplicate names — they would corrupt match identity.
    const seen = new Set();
    for (const p of players) {
      if (seen.has(p)) {
        alert(`Duplicate player name: "${p}". Names must be unique.`);
        return;
      }
      seen.add(p);
    }

    const distributed = distributePlayers(players, numPoules);
    const poules = distributed.map((pls, idx) => ({
      name: `Poule ${String.fromCharCode(65 + idx)}`,
      players: pls,
      matches: generateRoundRobin(pls),
    }));

    state = {
      players,
      numPoules,
      qualifiers,
      bestOf,
      poules,
      knockout: null,
      activeTab: 'poules',
    };
    save();
    renderAll();
    setActiveTab('poules');
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
    document.getElementById('players').value = state.players.join('\n');
    document.getElementById('num-poules').value = state.numPoules;
    document.getElementById('qualifiers').value = state.qualifiers;
    document.getElementById('best-of').value = state.bestOf;
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
      const table = document.createElement('table');
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
            <tr>
              <td class="num ${idx < state.qualifiers ? 'qualifier' : ''}">${idx + 1}</td>
              <td class="${idx < state.qualifiers ? 'qualifier' : ''}">${escapeHtml(s.player)}</td>
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
      const ul = document.createElement('ul');
      ul.className = 'match-list';
      poule.matches.forEach((m, mi) => {
        const r = matchResult(m, state.bestOf);
        const li = document.createElement('li');
        li.className = 'match';
        if (r.winner === 0) li.classList.add('winner-a');
        if (r.winner === 1) li.classList.add('winner-b');
        li.innerHTML = `
          <div class="player-a">${escapeHtml(m.players[0])}</div>
          <div class="sets-input" data-poule="${pi}" data-match="${mi}"></div>
          <div class="player-b">${escapeHtml(m.players[1])}</div>
        `;
        const inputs = li.querySelector('.sets-input');
        for (let s = 0; s < state.bestOf; s++) {
          const cur = m.sets[s] || ['', ''];
          const wrap = document.createElement('div');
          wrap.style.display = 'flex';
          wrap.style.flexDirection = 'column';
          wrap.style.alignItems = 'center';
          wrap.innerHTML = `
            <input type="number" min="0" data-side="0" data-set="${s}" value="${cur[0] ?? ''}" />
            <input type="number" min="0" data-side="1" data-set="${s}" value="${cur[1] ?? ''}" />
          `;
          inputs.appendChild(wrap);
        }
        ul.appendChild(li);
      });
      div.appendChild(ul);
      container.appendChild(div);
    });

    // Wire score inputs
    container.querySelectorAll('.sets-input input').forEach(inp => {
      inp.addEventListener('input', onScoreInput);
    });
  }

  function onScoreInput(e) {
    const inp = e.target;
    const wrap = inp.closest('.sets-input');
    const pi = +wrap.dataset.poule;
    const mi = +wrap.dataset.match;
    const setIdx = +inp.dataset.set;
    const side = +inp.dataset.side;
    const match = state.poules[pi].matches[mi];
    while (match.sets.length <= setIdx) match.sets.push(['', '']);
    const val = inp.value === '' ? '' : Number(inp.value);
    match.sets[setIdx] = match.sets[setIdx] || ['', ''];
    match.sets[setIdx][side] = val;
    save();
    // Re-render only this poule (lighter than full) — but for simplicity just re-render all poules.
    renderPoules();
    // If knockout exists, also re-render to update auto-advance results.
    if (state.knockout) renderKnockout();
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
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

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
