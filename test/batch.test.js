import assert from "node:assert/strict";
import test from "node:test";
import { start } from "../server/index.js";
import { reduce, viewFor } from "../server/table.mjs";
import { ROLES, applyForcedDeal, blankState, startRound } from "../sim/dist/engine.js";

async function call(port, path, { token, body } = {}) {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = text;
  if (text.startsWith("{") || text.startsWith("[")) data = JSON.parse(text);
  return { status: res.status, data };
}

async function seated(port, names) {
  const created = await call(port, "/api/games", { body: { gmName: "Caden" } });
  assert.equal(created.status, 200);
  assert.equal(created.data.agentKey, undefined);
  const players = [];
  for (const name of names) {
    const joined = await call(port, `/api/games/${created.data.code}/join`, { body: { name } });
    assert.equal(joined.status, 200, joined.data.error || "");
    players.push({ name, ...joined.data });
  }
  const gm = (body) => call(port, "/api/action", { token: created.data.gmToken, body });
  assert.equal((await gm({ type: "deal" })).status, 200);
  if (names.length >= 10) {
    assert.equal((await gm({ type: "suggest-soulbound" })).status, 200);
  }
  const started = await gm({ type: "resolve" });
  assert.equal(started.status, 200, started.data.error || "");
  assert.equal(started.data.state.phase, "ashFall");
  assert.equal(started.data.state.settings.automate, false);
  return { code: created.data.code, gmToken: created.data.gmToken, gm, players };
}

test("the 26 role descriptions come from the existing ability text", () => {
  assert.equal(ROLES.length, 26);
  const thin = ROLES.filter((role) => (role.ability || "").trim().length < 180).map((role) => role.name).sort();
  assert.deepEqual(thin, ["The Ashen Child", "The Foresight Elder", "The Integrity Warden", "Voice of the Accord"]);
  assert.match(ROLES.find((role) => role.id === "the-integrity-warden").ability, /Ash Touched, Mire Touched/);
  assert.match(ROLES.find((role) => role.id === "the-shadow-blade").ability, /succession/);
});

test("a night action locks, the summary stays unapplied, and a void stops the kill", async () => {
  const { port, close } = await start(0);
  try {
    const { code, gmToken, gm, players } = await seated(port, ["Ava", "Ben", "Cara", "Dee", "Eli"]);
    let actor = null;
    for (const player of players) {
      const view = await call(port, "/api/state", { token: player.token });
      const item = (view.data.menu || []).find((entry) => entry.ability === "kill" && entry.kind !== "note");
      if (!item) continue;
      const target = item.targets.find((person) => person.id !== view.data.you.id) || item.targets[0];
      const sent = await call(port, "/api/action", { token: player.token, body: { type: "submit", ability: "kill", targetId: target.id } });
      assert.equal(sent.status, 200, sent.data.error || "");
      const locked = await call(port, "/api/state", { token: player.token });
      assert.ok(locked.data.menu.some((entry) => entry.text === "Action submitted"));
      const second = await call(port, "/api/action", { token: player.token, body: { type: "submit", ability: "kill", targetId: target.id } });
      assert.equal(second.status, 400);
      assert.match(second.data.error, /Action submitted/);
      actor = { name: player.name, target: target.name };
      break;
    }
    assert.ok(actor);
    const preview = await call(port, "/api/state", { token: gmToken });
    assert.match(preview.data.ashfallSummary.headline, /Nothing here has been applied/);
    assert.ok(preview.data.ashfallSummary.lines.some((line) => line.text.includes(actor.name) && line.text.includes("night kill")));
    assert.ok(preview.data.intentLog.some((line) => line.includes(actor.name)));
    assert.equal(preview.data.logArchive.length, 0);
    assert.ok(preview.data.players.every((p) => p.alive));
    assert.equal(preview.data.nightProgress.received >= 1, true);
    const secret = preview.data.ashfallSummary.lines.find((line) => line.text.includes("night kill")).text;
    for (const player of players) {
      const view = (await call(port, "/api/state", { token: player.token })).data;
      assert.equal(view.kind, "player");
      assert.equal(view.ashfallSummary, undefined);
      assert.equal(view.nightActions, undefined);
      assert.equal(view.intentLog, undefined);
      assert.equal(view.logArchive, undefined);
      assert.equal(view.log, undefined);
      assert.equal(view.votes, undefined);
      assert.equal(view.nightProgress, undefined);
      assert.equal(view.reminders, undefined);
      const raw = JSON.stringify(view);
      assert.equal(raw.includes(secret), false);
      assert.equal(raw.includes("Ashfall summary"), false);
    }
    const night = preview.data.nightActions.find((action) => action.plain.includes(actor.name));
    const wiped = await gm({ type: "edit-night", actionId: night.id, void: true });
    assert.equal(wiped.status, 200, wiped.data.error || "");
    assert.ok(wiped.data.state.ashfallSummary.lines.some((line) => line.projection === "No effect from a skip."));
    const undone = await gm({ type: "edit-night", actionId: night.id, undo: true });
    assert.equal(undone.status, 200, undone.data.error || "");
    assert.equal(undone.data.state.nightActions.find((item) => item.id === night.id).voided, false);
    assert.equal((await gm({ type: "edit-night", actionId: night.id, void: true })).status, 200);
    const resolved = await gm({ type: "resolve" });
    assert.equal(resolved.status, 200, resolved.data.error || "");
    assert.equal(resolved.data.state.phase, "lumination");
    assert.ok(resolved.data.state.players.every((p) => p.alive));
    assert.ok(resolved.data.state.logArchive.some((segment) => segment.title.startsWith("Ash Fall") && segment.lines.some((line) => line.startsWith("Nobody died."))));
    for (const player of players) {
      const view = (await call(port, "/api/state", { token: player.token })).data;
      assert.ok(view.publicLog.some((line) => line.text === "Nobody died tonight."));
      assert.ok(view.publicLog.every((line) => /^(Died tonight:|Nobody died tonight\.|Nominations:|Votes:|A Sunmark|The shot|.* has died\.)$/.test(line.text)));
      const raw = JSON.stringify(view);
      assert.equal(raw.includes(secret), false);
      assert.equal(raw.includes("Ash Fall kill"), false);
      assert.equal(view.you.inbox.every((item) => item.text.includes(view.you.name) || !/targeted|marked .* for a night kill/i.test(item.text)), true);
    }
    const note = preview.data.ashfallSummary.lines.find((line) => line.playerId);
    const sent = await gm({ type: "chat", channel: "gm", from: "gm", playerId: note.playerId, text: "Your night action is recorded." });
    assert.equal(sent.status, 200);
    const told = players.find((p) => p.name === note.actorName);
    const heard = (await call(port, "/api/state", { token: told.token })).data;
    assert.ok(heard.chats.some((c) => c.text === "Your night action is recorded."));
    const stranger = players.find((p) => p.name !== note.actorName);
    const quiet = (await call(port, "/api/state", { token: stranger.token })).data;
    assert.equal(quiet.chats.some((c) => c.text === "Your night action is recorded."), false);
    assert.equal(resolved.data.state.intentLog.some((line) => line.includes("night kill")), false);
    const gone = await call(port, `/api/agent/${code}/state`);
    assert.equal(gone.status, 404);
    const team = await call(port, "/api/action", { token: players[0].token, body: { type: "chat", channel: "ashen", text: "team" } });
    assert.equal(team.status, 400);
  } finally {
    await close();
  }
});

test("nominations and votes lock during the Dawn Accord, and manual mode does not pick an execution", async () => {
  const { port, close } = await start(0);
  try {
    const { gm, gmToken, players } = await seated(port, ["Ava", "Ben", "Cara", "Dee", "Eli"]);
    assert.equal((await gm({ type: "resolve" })).data.state.phase, "lumination");
    const early = await call(port, "/api/action", {
      token: players[0].token,
      body: { type: "submit", kind: "nomination", targetId: "nobody" },
    });
    assert.equal(early.status, 400);
    assert.match(early.data.error, /cannot nominate now/);
    let state = (await gm({ type: "resolve" })).data.state;
    assert.equal(state.phase, "dawnAccord");
    assert.equal(state.ballot.length, 0);
    const blocked = await gm({ type: "resolve" });
    assert.equal(blocked.status, 400);
    assert.match(blocked.data.error, /Choose an execution/);
    for (const player of players) {
      const view = await call(port, "/api/state", { token: player.token });
      const other = state.players.find((p) => p.alive && p.id !== view.data.you.id);
      const nominated = await call(port, "/api/action", { token: player.token, body: { type: "submit", kind: "nomination", targetId: other.id } });
      assert.equal(nominated.status, 200, nominated.data.error || "");
      const note = await call(port, "/api/state", { token: player.token });
      assert.ok(note.data.menu.some((entry) => entry.text === "Nomination submitted"));
    }
    state = (await call(port, "/api/state", { token: gmToken })).data;
    assert.ok(state.nominations.length === 5);
    assert.ok(state.ballot.length > 0);
    assert.equal(state.intentLog.some((line) => /nominat/i.test(line)), false);
    for (const player of players) {
      const voted = await call(port, "/api/action", { token: player.token, body: { type: "vote", choice: state.ballot[0].id } });
      assert.equal(voted.status, 200, voted.data.error || "");
      const again = await call(port, "/api/action", { token: player.token, body: { type: "vote", choice: "NO_EXEC" } });
      if (state.ballot[0].id !== "NO_EXEC") assert.equal(again.status, 400);
    }
    const closed = await gm({ type: "resolve", execute: "NO_EXEC" });
    assert.equal(closed.status, 200, closed.data.error || "");
    assert.ok(closed.data.state.players.every((p) => p.alive));
    assert.ok(closed.data.state.phase === "ashFall" || closed.data.state.phase === "ended");
  } finally {
    await close();
  }
});

function linked(node, name, roleId, roleName) {
  if (!node || typeof node !== "object") return false;
  if (node.name === name && (node.roleId === roleId || node.roleName === roleName)) return true;
  return Object.values(node).some((value) => linked(value, name, roleId, roleName));
}

test("Ashen Mind list, GM kill and mire notes, and no automatic ending", () => {
  const seats = [
    { name: "Tess", roleId: "the-ashen-tyrant" },
    { name: "Mina", roleId: "the-ashen-mind" },
    { name: "Vera", roleId: "voice-of-the-accord" },
    { name: "Fern", roleId: "the-foresight-elder" },
    { name: "Cora", roleId: "the-civic-luminary" },
  ];
  let state = applyForcedDeal(blankState(), seats);
  assert.equal(state.dealt, true);
  state = startRound({ ...state, holdWin: true }, true);
  const byName = (name) => state.players.find((p) => p.name === name);
  const extras = { chats: [], statements: [], code: "MIND" };
  const mindView = viewFor(state, { kind: "player", playerId: byName("Mina").id, name: "Mina" }, extras);
  const otherView = viewFor(state, { kind: "player", playerId: byName("Vera").id, name: "Vera" }, extras);
  const again = viewFor(state, { kind: "player", playerId: byName("Mina").id, name: "Mina" }, extras);
  assert.deepEqual(again.mindList, mindView.mindList);
  assert.equal(otherView.mindList, undefined);
  assert.equal(Object.hasOwn(JSON.parse(JSON.stringify(otherView)), "mindList"), false);
  const dealt = new Set(state.players.map((p) => p.roleId));
  const unclaimed = ROLES.map((role) => role.id).filter((id) => !dealt.has(id)).sort();
  const fern = mindView.mindList.find((row) => row.name === "Fern");
  const cora = mindView.mindList.find((row) => row.name === "Cora");
  const vera = mindView.mindList.find((row) => row.name === "Vera");
  assert.equal(vera.roleId, "voice-of-the-accord");
  assert.equal(mindView.mindList.find((row) => row.name === "Tess").roleId, "the-ashen-tyrant");
  assert.equal(mindView.mindList.find((row) => row.name === "Mina").roleId, "the-ashen-mind");
  assert.equal(cora.roleId, unclaimed[0]);
  assert.equal(fern.roleId, unclaimed[1]);
  assert.equal(dealt.has(fern.roleId), false);
  assert.equal(dealt.has(cora.roleId), false);
  assert.equal(linked(mindView, "Fern", "the-foresight-elder", "The Foresight Elder"), false);
  assert.equal(linked(mindView, "Cora", "the-civic-luminary", "The Civic Luminary"), false);
  assert.equal(mindView.you.inbox.some((item) => item.text.startsWith("Start-of-round snapshot")), false);
  for (const item of mindView.you.inbox) {
    assert.equal(item.text.includes("Fern") && item.text.includes("The Foresight Elder"), false);
    assert.equal(item.text.includes("Cora") && item.text.includes("The Civic Luminary"), false);
  }

  state = reduce(state, { type: "gm-mire", playerId: byName("Vera").id });
  const gm = viewFor(state, { kind: "gm", name: "Caden" }, extras);
  assert.equal(gm.players.find((p) => p.name === "Vera").gmMire, true);
  assert.ok(gm.intentLog.some((line) => line.includes("GM marked Vera Mire Touched")));
  const veraView = viewFor(state, { kind: "player", playerId: byName("Vera").id, name: "Vera" }, extras);
  assert.equal(JSON.stringify(veraView).includes("gmMire"), false);
  assert.equal(veraView.you.inbox.some((item) => /mire/i.test(item.text)), false);
  state = reduce(state, { type: "undo-mire", playerId: byName("Vera").id });
  assert.equal(viewFor(state, { kind: "gm", name: "Caden" }, extras).players.find((p) => p.name === "Vera").gmMire, false);

  state = reduce(state, { type: "ash-touched", playerId: byName("Vera").id });
  assert.equal(viewFor(state, { kind: "gm", name: "Caden" }, extras).players.find((p) => p.name === "Vera").ashTouched, true);
  state = reduce(state, { type: "undo-ash", playerId: byName("Vera").id });
  assert.equal(viewFor(state, { kind: "gm", name: "Caden" }, extras).players.find((p) => p.name === "Vera").ashTouched, false);

  state = reduce(state, { type: "gm-kill", playerId: byName("Vera").id });
  const afterKill = viewFor(state, { kind: "player", playerId: byName("Mina").id, name: "Mina" }, extras);
  assert.equal(afterKill.seats.find((seat) => seat.name === "Vera").alive, false);
  assert.ok(afterKill.publicLog.some((line) => line.text === "Died tonight: Vera."));
  assert.ok(viewFor(state, { kind: "gm", name: "Caden" }, extras).intentLog.some((line) => line.includes("GM killed Vera")));
  assert.equal(state.winner || "", "");
  assert.notEqual(viewFor(state, { kind: "gm", name: "Caden" }, extras).phase, "ended");
  state = reduce(state, { type: "undo-kill", playerId: byName("Vera").id });
  const revived = viewFor(state, { kind: "player", playerId: byName("Mina").id, name: "Mina" }, extras);
  assert.equal(revived.seats.find((seat) => seat.name === "Vera").alive, true);
  assert.equal(revived.publicLog.some((line) => line.text.includes("Vera")), false);

  const killedMind = reduce(state, { type: "gm-kill", playerId: byName("Mina").id });
  const deadMind = viewFor(killedMind, { kind: "player", playerId: byName("Mina").id, name: "Mina" }, extras);
  assert.equal(deadMind.you.alive, false);
  assert.ok(deadMind.mindList.length === 5);
  assert.equal(deadMind.mindList.find((row) => row.name === "Fern").roleId, fern.roleId);
  state = reduce(killedMind, { type: "undo-kill", playerId: byName("Mina").id });

  state = reduce(state, { type: "gm-kill", playerId: byName("Tess").id });
  const suggested = viewFor(state, { kind: "gm", name: "Caden" }, extras);
  assert.equal(suggested.winner, null);
  assert.notEqual(suggested.phase, "ended");
  assert.equal(suggested.suggestedWinner, "lumen");
  assert.match(suggested.intentLog.join("\n") + (suggested.log || []).map((line) => line.text).join("\n"), /win condition met/i);
  assert.throws(() => reduce(state, { type: "end-game", winner: "lumen", confirm: false }), /Confirm/);
  state = reduce(state, { type: "end-game", winner: "lumen", confirm: true });
  const ended = viewFor(state, { kind: "gm", name: "Caden" }, extras);
  assert.equal(ended.phase, "ended");
  assert.equal(ended.winner, "lumen");
  const mindEnded = viewFor(state, { kind: "player", playerId: byName("Mina").id, name: "Mina" }, extras);
  assert.equal(linked(mindEnded, "Fern", "the-foresight-elder", "The Foresight Elder"), false);
  assert.equal(linked(mindEnded, "Cora", "the-civic-luminary", "The Civic Luminary"), false);
});
