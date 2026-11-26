import assert from "node:assert/strict";
import test from "node:test";
import { start } from "../server/index.js";
import { ROLES } from "../sim/dist/engine.js";

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
    const night = preview.data.nightActions.find((action) => action.plain.includes(actor.name));
    const wiped = await gm({ type: "edit-night", actionId: night.id, void: true });
    assert.equal(wiped.status, 200, wiped.data.error || "");
    assert.ok(wiped.data.state.ashfallSummary.lines.some((line) => line.projection === "No effect from a skip."));
    const resolved = await gm({ type: "resolve" });
    assert.equal(resolved.status, 200, resolved.data.error || "");
    assert.equal(resolved.data.state.phase, "lumination");
    assert.ok(resolved.data.state.players.every((p) => p.alive));
    assert.ok(resolved.data.state.logArchive.some((segment) => segment.title.startsWith("Ash Fall")));
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
