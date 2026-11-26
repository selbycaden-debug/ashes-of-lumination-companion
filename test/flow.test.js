import assert from "node:assert/strict";
import test from "node:test";
import { WebSocket } from "ws";
import { start } from "../server/index.js";
import { reduce } from "../server/table.mjs";
import { runGame } from "../sim/lib/run-game.mjs";
import {
  COMPOSITION,
  MIN_PLAYERS,
  MAX_PLAYERS,
  ashenCount,
  unalignedCount,
  rulebookFor,
  applyForcedDeal,
  applyDeal,
  blankState,
  startRound,
  resolveAshFall,
} from "../sim/dist/engine.js";

const CHART = [
  { n: [5, 6], ashen: [1, 1], unaligned: [0, 0], ashenAt: { 5: 1, 6: 1 }, unalignedAt: { 5: 0, 6: 0 } },
  { n: [7, 9], ashen: [2, 2], unaligned: [0, 1], ashenAt: { 7: 2, 8: 2, 9: 2 }, unalignedAt: { 7: 0, 8: 1, 9: 1 } },
  { n: [10, 12], ashen: [3, 3], unaligned: [1, 1], ashenAt: { 10: 3, 11: 3, 12: 3 }, unalignedAt: { 10: 1, 11: 1, 12: 1 } },
  { n: [13, 15], ashen: [3, 4], unaligned: [1, 1], ashenAt: { 13: 3, 14: 4, 15: 4 }, unalignedAt: { 13: 1, 14: 1, 15: 1 } },
  { n: [16, 20], ashen: [4, 4], unaligned: [1, 2], ashenAt: { 16: 4, 17: 4, 18: 4, 19: 4, 20: 4 }, unalignedAt: { 16: 1, 17: 1, 18: 2, 19: 2, 20: 2 } },
];

test("composition config is the Caden chart and the deal defaults stay inside it", () => {
  assert.equal(MIN_PLAYERS, 5);
  assert.equal(MAX_PLAYERS, 20);
  assert.equal(COMPOSITION.length, 5);
  for (const row of CHART) {
    const band = COMPOSITION.find((item) => item.min === row.n[0] && item.max === row.n[1]);
    assert.ok(band, row.n.join("-"));
    assert.deepEqual([band.ashenMin, band.ashenMax], row.ashen);
    assert.deepEqual([band.unalignedMin, band.unalignedMax], row.unaligned);
    for (let n = row.n[0]; n <= row.n[1]; n += 1) {
      assert.equal(ashenCount(n), row.ashenAt[n], "ashen " + n);
      assert.equal(unalignedCount(n), row.unalignedAt[n], "unaligned " + n);
      assert.ok(ashenCount(n) >= row.ashen[0] && ashenCount(n) <= row.ashen[1]);
      assert.ok(unalignedCount(n) >= row.unaligned[0] && unalignedCount(n) <= row.unaligned[1]);
    }
  }
  assert.equal(unalignedCount(8, 0), 0);
  assert.equal(unalignedCount(8, 1), 1);
  assert.equal(unalignedCount(18, 1), 2);
  assert.equal(ashenCount(14), 4);
  assert.equal(ashenCount(14, 3), 3);
  assert.equal(ashenCount(13, 4), 4);
  assert.equal(ashenCount(16), 4);
  assert.equal(ashenCount(16, 3), 4);
  assert.equal(ashenCount(20, 3), 4);
  assert.equal(unalignedCount(18, -1, 1), 1);
  assert.equal(unalignedCount(16, -1, 2), 2);
  const thirteen = Array.from({ length: 13 }, (_, i) => "N" + i);
  const eighteen = Array.from({ length: 18 }, (_, i) => "N" + i);
  assert.equal(applyDeal({ ...blankState(), ashenPick: 4 }, thirteen).dealtCounts.ashen, 4);
  assert.equal(applyDeal(blankState(), thirteen).dealtCounts.ashen, 3);
  assert.equal(applyDeal({ ...blankState(), unalignedWide: 1 }, eighteen).dealtCounts.unaligned, 1);
  assert.equal(applyDeal(blankState(), eighteen).dealtCounts.unaligned, 2);
  assert.equal(applyDeal({ ...blankState(), ashenPick: 3 }, eighteen).dealtCounts.ashen, 4);
  assert.equal(applyDeal(blankState(), eighteen).dealtCounts.ashen, 4);

  const book = rulebookFor(16, null);
  assert.equal(book.headline, "The main goal is always to kill the Ashen Tyrant.");
  assert.equal(book.band.ashen, "4");
  assert.equal(book.band.unaligned, "1\u20132");
  assert.equal(book.band.lumen, "10\u201311");
  assert.equal(book.dealt, null);
  assert.match(book.goals.find((goal) => goal.side === "Lumen").text, /^Lumen victory: all Ashen and The Shadow Blade are eliminated\.$/);
  assert.match(book.goals.find((goal) => goal.side === "Ashen").text, /reached parity/);
  assert.match(book.goals.find((goal) => goal.side === "The Syndic").text, /wins when every living player is the Syndic/);
  assert.match(book.goals.find((goal) => goal.side === "The Shadow Blade").text, /wins alone if last standing/);

  const dealt = rulebookFor(5, { ashen: 1, unaligned: 0, lumen: 4 });
  assert.deepEqual(dealt.dealt, { ashen: 1, unaligned: 0, lumen: 4 });
  assert.equal(dealt.band.lumen, "4");
});

test("a refused Red Scar still reaches the day-kill action, and the Mind list can be sent", () => {
  let state = applyForcedDeal(blankState(), [
    { name: "Red", roleId: "the-red-scar" },
    { name: "Tor", roleId: "the-ashen-tyrant" },
    { name: "Ann", roleId: "the-parallax" },
    { name: "Ben", roleId: "the-lumen-guard" },
    { name: "Cam", roleId: "the-ashen-mind" },
  ]);
  state = resolveAshFall(startRound(state, true));
  const red = state.players.find((p) => p.name === "Red");
  const ben = state.players.find((p) => p.name === "Ben");
  const refused = reduce(state, { type: "submit", playerId: red.id, kind: "scar", targetId: ben.id });
  assert.match(refused.log[0].text, /can't use the Red Scar day kill in Lumination 1/);
  assert.ok(refused.results.some((r) => r.playerId === red.id && r.text.includes("Not submitted")));

  const ann = state.players.find((p) => p.name === "Ann");
  assert.throws(
    () => reduce(state, { type: "submit", playerId: ann.id, ability: "parallax", targetId: ben.id, targetId2: ben.id }),
    /two different players/i,
  );
  const mind = state.players.find((p) => p.name === "Cam");
  const shown = Object.fromEntries(state.players.map((p) => [p.id, "voice-of-the-accord"]));
  const masked = reduce(state, { type: "mind-override", shown });
  assert.equal(masked.forcedMindMasks[mind.id], "voice-of-the-accord");
  assert.match(masked.log[0].text, /Ashen Mind list/);
});

async function call(port, path, { token, key, body } = {}) {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(key ? { "x-agent-key": key } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = text;
  if (text.startsWith("{") || text.startsWith("[")) data = JSON.parse(text);
  return { status: res.status, data };
}

function wsState(port, token) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${encodeURIComponent(token)}`);
  const message = new Promise((resolve, reject) => {
    ws.once("message", (buf) => resolve(JSON.parse(buf.toString())));
    ws.once("error", reject);
  });
  return { ws, message };
}

async function submitMenus(port, token, view) {
  for (const item of view.menu || []) {
    if (item.kind === "invite") {
      const res = await call(port, "/api/action", { token, body: { type: "invite-response", accept: false } });
      assert.equal(res.status, 200, res.data.error || "");
      continue;
    }
    if (item.kind === "vote") {
      const choice = (item.targets || []).find((t) => t.id !== "skip" && t.id !== "SAVE")?.id || item.targets?.[0]?.id;
      if (!choice) continue;
      const res = await call(port, "/api/action", { token, body: { type: "vote", choice } });
      assert.equal(res.status, 200, res.data.error || "");
      continue;
    }
    if (item.id === "nomination") {
      const target = (item.targets || []).find((t) => t.id !== view.you.id) || item.targets?.[0];
      if (!target) continue;
      const res = await call(port, "/api/action", { token, body: { type: "submit", kind: "nomination", targetId: target.id } });
      assert.equal(res.status, 200, res.data.error || "");
      continue;
    }
    if (item.kind === "button") {
      const res = await call(port, "/api/action", { token, body: { type: "submit", ability: item.ability || item.id } });
      assert.equal(res.status, 200, res.data.error || "");
      continue;
    }
    const targets = item.targets || [];
    const others = targets.filter((t) => t.id !== view.you.id);
    const pool = others.length ? others : targets;
    const attacking = ["kill", "inheritedKill", "poison", "shot", "dayKill"].includes(item.ability);
    let targetId = null;
    let skip = false;
    if (item.kind === "targets2") {
      if (pool.length < 2 && targets.length < 2) continue;
      targetId = pool[0]?.id || targets[0].id;
      const second = targets.find((t) => t.id !== targetId);
      if (!second) continue;
      const res = await call(port, "/api/action", {
        token,
        body: { type: "submit", ability: item.ability, targetId, targetId2: second.id },
      });
      assert.equal(res.status, 200, res.data.error || item.ability);
      continue;
    }
    if (item.kind === "multi") {
      const res = await call(port, "/api/action", {
        token,
        body: { type: "submit", ability: "invites", ids: pool.slice(0, 1).map((t) => t.id) },
      });
      assert.equal(res.status, 200, res.data.error || "");
      continue;
    }
    if (item.kind === "question") {
      const res = await call(port, "/api/action", {
        token,
        body: { type: "submit", ability: "question", targetId: pool[0]?.id, roleId: "the-ashen-tyrant", skip: !pool[0] },
      });
      assert.equal(res.status, 200, res.data.error || "");
      continue;
    }
    if (attacking && pool[0]) targetId = pool[0].id;
    else if (item.allowSkip) skip = true;
    else if (pool[0]) targetId = pool[0].id;
    else continue;
    const res = await call(port, "/api/action", {
      token,
      body: { type: "submit", ability: item.ability || item.id, targetId: skip ? null : targetId, skip },
    });
    if (res.status !== 200) assert.match(res.data.error || "", /can't use|Not submitted|two different/i);
  }
}

async function playTable(port, count) {
  const created = await call(port, "/api/games", { body: { gmName: "Caden" } });
  assert.equal(created.status, 200);
  const { code, gmToken, agentKey } = created.data;
  const players = [];
  for (let i = 1; i <= count; i += 1) {
    const joined = await call(port, `/api/games/${code}/join`, { body: { name: "P" + String(i).padStart(2, "0") } });
    assert.equal(joined.status, 200, joined.data.error || "");
    players.push(joined.data);
  }
  const overflow = await call(port, `/api/games/${code}/join`, { body: { name: "P" + String(count).padStart(2, "0") } });
  assert.equal(overflow.status, 400);

  const gm = (body) => call(port, "/api/action", { token: gmToken, body });
  if (count >= 3) {
    const moved = await gm({ type: "reorder", name: "P" + String(count).padStart(2, "0"), dir: "up" });
    assert.equal(moved.status, 200, moved.data.error || "");
    const names = moved.data.state.seats.map((seat) => seat.name);
    assert.equal(names[count - 2], "P" + String(count).padStart(2, "0"));
  }

  const lobby = await call(port, "/api/state", { token: players[0].token });
  assert.equal(lobby.data.rulebook.headline, "The main goal is always to kill the Ashen Tyrant.");
  assert.equal(lobby.data.rulebook.playerCount, count);
  assert.equal(lobby.data.rulebook.dealt, null);
  assert.equal(JSON.stringify(lobby.data.seats).includes("roleId"), false);
  const firstSocket = wsState(port, players[0].token);
  const firstMsg = await firstSocket.message;
  assert.equal(firstMsg.state.you.name, "P01");
  firstSocket.ws.close();

  assert.equal((await gm({ type: "settings", cutoff: false })).status, 200);
  const dealt = await gm({ type: "deal" });
  assert.equal(dealt.status, 200, dealt.data.error || "");
  const roles = dealt.data.state.players.map((p) => p.roleId);
  assert.equal(new Set(roles).size, roles.length);
  assert.ok(roles.includes("the-ashen-tyrant"));
  const book = dealt.data.state.rulebook;
  assert.equal(book.dealt.ashen + book.dealt.unaligned + book.dealt.lumen, count);
  const row = CHART.find((item) => count >= item.n[0] && count <= item.n[1]);
  assert.ok(book.dealt.ashen >= row.ashen[0] && book.dealt.ashen <= row.ashen[1]);
  assert.ok(book.dealt.unaligned >= row.unaligned[0] && book.dealt.unaligned <= row.unaligned[1]);
  const playerDealt = await call(port, "/api/state", { token: players[0].token });
  assert.equal(playerDealt.data.you.roleId, dealt.data.state.players.find((p) => p.name === "P01").roleId);
  assert.deepEqual(playerDealt.data.rulebook.dealt, book.dealt);
  assert.equal(JSON.stringify(playerDealt.data.seats).includes("roleId"), false);

  const again = wsState(port, players[0].token);
  const againMsg = await again.message;
  assert.equal(againMsg.state.you.roleId, playerDealt.data.you.roleId);
  again.ws.close();

  if (count >= 10) {
    const blocked = await gm({ type: "resolve" });
    assert.equal(blocked.status, 400);
    assert.match(blocked.data.error, /Soulbound/);
    const suggested = await gm({ type: "suggest-soulbound" });
    assert.equal(suggested.status, 200, suggested.data.error || "");
    assert.equal(suggested.data.state.soulboundPlaced, true);
  }

  let state = (await gm({ type: "resolve" })).data.state;
  assert.equal(state.phase, "ashFall");
  let rounds = 0;
  let sawDeath = state.players.some((p) => !p.alive);
  const phases = [];
  for (let guard = 0; guard < 80 && state.phase !== "ended" && !state.winner; guard += 1) {
    phases.push(state.phase);
    if (state.block?.type === "coin") {
      const flipped = await call(port, `/api/agent/${code}/action`, { key: agentKey, body: { type: "coin", result: guard % 2 ? "heads" : "tails" } });
      assert.equal(flipped.status, 200, flipped.data.error || "");
      state = flipped.data.state;
      continue;
    }
    for (const player of players) {
      const view = await call(port, "/api/state", { token: player.token });
      assert.equal(view.status, 200);
      assert.equal(view.data.kind, "player");
      assert.equal(view.data.agentKey, undefined);
      await submitMenus(port, player.token, view.data);
    }
    const before = state.phase;
    const advanced = guard % 4 === 3
      ? await call(port, `/api/agent/${code}/action`, { key: agentKey, body: { type: "resolve" } })
      : await gm({ type: "resolve" });
    assert.equal(advanced.status, 200, advanced.data.error || before);
    state = advanced.data.state;
    if (state.players.some((p) => !p.alive)) sawDeath = true;
    if (state.phase === "ashFall") rounds += 1;
    if (state.phase === before && !state.winner && !state.block) {
      assert.fail("Stuck in " + before + " at " + count + " players");
    }
  }
  assert.ok(phases.includes("ashFall"), "Ash Fall did not open at " + count);
  if (state.winner) {
    assert.match((state.log || []).map((line) => line.text).join("\n"), /victory|have won/i);
  } else {
    assert.ok(phases.includes("lumination") && phases.includes("dawnAccord"), phases.join(",") || "no phases");
  }
  const summary = await call(port, `/api/agent/${code}/summary`, { key: agentKey });
  assert.equal(summary.status, 200);
  assert.match(summary.data, /Ashes of Lumination/);
  const denied = await call(port, `/api/agent/${code}/state`, { key: "nope" });
  assert.equal(denied.status, 401);
  const ava = state.players[0];
  if (ava) {
    const posted = await call(port, `/api/agent/${code}/chat`, { key: agentKey, body: { playerId: ava.id, text: "Ahsoka is here." } });
    assert.equal(posted.status, 200);
    const seat = await call(port, "/api/state", { token: players[0].token });
    assert.ok(seat.data.chats.some((c) => c.text.includes("Ahsoka is here.")));
    const other = await call(port, "/api/state", { token: players[1].token });
    assert.equal(other.data.chats.some((c) => c.text.includes("Ahsoka is here.")), false);
  }
  if (state.winner) {
    assert.ok(["lumen", "ashen", "syndic", "shadow"].includes(state.winner));
    for (const player of players) {
      const view = (await call(port, "/api/state", { token: player.token })).data;
      const self = state.players.find((p) => p.name === view.you.name);
      if (state.winner === "shadow") assert.equal(view.you.won, self.roleId === "the-shadow-blade");
      if (state.winner === "syndic") assert.equal(view.you.won, self.alive && self.syndicate && self.alignment !== "Ashen");
      if (state.winner === "lumen") assert.equal(view.you.won, self.alignment === "Lumen");
      if (state.winner === "ashen") assert.equal(view.you.won, self.alignment === "Ashen");
      assert.ok(view.reveal.some((row) => row.roleId === "the-ashen-tyrant"));
    }
  }
  return { code, winner: state.winner, rounds, sawDeath, phase: state.phase, phases };
}

test("live tables from 5 through 20 play every phase without getting stuck", { timeout: 300000 }, async () => {
  const { port, close } = await start(0);
  try {
    const short = await call(port, "/api/games", { body: { gmName: "Caden" } });
    for (const name of ["A", "B", "C", "D"]) {
      assert.equal((await call(port, `/api/games/${short.data.code}/join`, { body: { name } })).status, 200);
    }
    const tooSmall = await call(port, "/api/action", { token: short.data.gmToken, body: { type: "deal" } });
    assert.equal(tooSmall.status, 400);
    assert.match(tooSmall.data.error, /5 to 20/);

    const results = [];
    for (let count = MIN_PLAYERS; count <= MAX_PLAYERS; count += 1) {
      results.push({ count, ...(await playTable(port, count)) });
    }
    assert.ok(results.some((game) => game.sawDeath), "expected a death in at least one live game");
    assert.ok(results.some((game) => game.winner), "expected a winner in at least one live game");
    const seen = new Set(results.flatMap((game) => game.phases));
    assert.ok(seen.has("ashFall") && seen.has("lumination") && seen.has("dawnAccord"), [...seen].join(","));
    const full = await call(port, "/api/games", { body: { gmName: "Caden" } });
    for (let i = 1; i <= MAX_PLAYERS; i += 1) {
      assert.equal((await call(port, `/api/games/${full.data.code}/join`, { body: { name: "S" + i } })).status, 200);
    }
    const extra = await call(port, `/api/games/${full.data.code}/join`, { body: { name: "S21" } });
    assert.equal(extra.status, 400);
    assert.match(extra.data.error, /full/);
  } finally {
    await close();
  }
});

test("sim plays a full realistic game and a full fuzz game at every player count", { timeout: 300000 }, () => {
  const bad = [];
  for (let n = 5; n <= 20; n += 1) {
    for (const mode of ["realistic", "fuzz"]) {
      const result = runGame({ name: "audit-" + mode + "-" + n, mode, playerCount: n, seed: 4200 + n + (mode === "fuzz" ? 100 : 0) });
      const high = (result.issues || []).filter((issue) => issue.severity === "high" || issue.severity === "critical");
      if (result.crashed || high.length) {
        bad.push({ n, mode, crashed: result.crashed ? String(result.crashed).split("\n")[0] : "", high: high.slice(0, 4) });
      }
      if (!result.crashed) {
        const teams = result.state.dealtCounts;
        assert.ok(teams, mode + " " + n + " missing dealt counts");
        const row = CHART.find((item) => n >= item.n[0] && n <= item.n[1]);
        assert.ok(teams.ashen >= row.ashen[0] && teams.ashen <= row.ashen[1], mode + " " + n + " ashen " + teams.ashen);
        assert.ok(teams.unaligned >= row.unaligned[0] && teams.unaligned <= row.unaligned[1], mode + " " + n);
        assert.equal(teams.ashen + teams.lumen + teams.unaligned, n);
        assert.equal(new Set(result.state.players.map((p) => p.roleId)).size, n);
      }
    }
  }
  assert.deepEqual(bad, []);
});
