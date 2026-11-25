import assert from "node:assert/strict";
import test from "node:test";
import { start } from "../server/index.js";

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

test("a GM and five players finish a night, a day, a vote, and an Ahsoka chat", async () => {
  const { port, close } = await start(0);
  try {
    const created = await call(port, "/api/games", { body: { gmName: "Caden" } });
    assert.equal(created.status, 200);
    const { code, gmToken, agentKey } = created.data;
    const players = [];
    for (const name of ["Ava", "Ben", "Cara", "Dee", "Eli"]) {
      const joined = await call(port, `/api/games/${code}/join`, { body: { name } });
      assert.equal(joined.status, 200, joined.data.error || "");
      players.push(joined.data);
    }

    const gm = (body) => call(port, "/api/action", { token: gmToken, body });
    assert.equal((await gm({ type: "settings", cutoff: false })).status, 200);
    assert.equal((await gm({ type: "autofill" })).status, 200);
    const dealt = await gm({ type: "deal" });
    assert.equal(dealt.status, 200, dealt.data.error || "");
    assert.equal(dealt.data.state.phase, "setup");
    assert.equal(dealt.data.state.settings.testCutoff75, false);
    assert.equal(dealt.data.state.defaults.length, 17);
    assert.ok(dealt.data.state.players.some((p) => p.roleId === "the-ashen-tyrant"));
    const started = await gm({ type: "start" });
    assert.equal(started.status, 200, started.data.error || "");
    assert.equal(started.data.state.phase, "ashFall");

    for (const player of players) {
      const view = await call(port, "/api/state", { token: player.token });
      assert.equal(view.data.kind, "player");
      assert.equal(view.data.agentKey, undefined);
      assert.equal(view.data.catalogue.length, 26);
      assert.equal(view.data.reveal, null);
      assert.equal(JSON.stringify(view.data.seats).includes("roleId"), false);
      for (const item of view.data.menu) {
        if (item.kind !== "target" || !item.ability) continue;
        const skip = !!item.allowSkip;
        await call(port, "/api/action", {
          token: player.token,
          body: {
            type: "submit",
            kind: "night",
            ability: item.ability,
            targetId: skip ? null : item.targets[0].id,
            skip,
          },
        });
      }
    }

    let state = (await gm({ type: "resolve" })).data.state;
    assert.equal(state.phase, "lumination");
    for (const player of players) {
      const mine = (await call(port, "/api/state", { token: player.token })).data.you;
      const other = state.players.find((p) => p.alive && p.id !== mine.id);
      await call(port, "/api/action", { token: player.token, body: { type: "submit", kind: "statement", text: `${mine.name} speaks.` } });
      await call(port, "/api/action", { token: player.token, body: { type: "submit", kind: "nomination", targetId: other.id } });
    }
    state = (await gm({ type: "resolve" })).data.state;
    assert.equal(state.phase, "dawnAccord");
    assert.ok(state.ballot.length > 0);
    for (const player of players) {
      await call(port, "/api/action", { token: player.token, body: { type: "vote", choice: state.ballot[0].id } });
    }
    state = (await gm({ type: "resolve" })).data.state;
    assert.ok(state.phase === "ashFall" || state.phase === "ended");

    await call(port, "/api/action", { token: players[0].token, body: { type: "chat", channel: "gm", text: "GM, it is Ava." } });
    const gmView = await call(port, "/api/state", { token: gmToken });
    assert.ok(gmView.data.chats.some((c) => c.text.includes("Ava")));

    const agent = await call(port, `/api/agent/${code}/state`, { key: agentKey });
    assert.equal(agent.status, 200);
    assert.match(agent.data.summary, /Phase/);
    assert.ok(agent.data.log.length > 0);
    assert.ok(agent.data.state.players.some((p) => p.roleId === "the-ashen-tyrant"));
    const denied = await call(port, `/api/agent/${code}/state`, { key: "not-this-game" });
    assert.equal(denied.status, 401);

    const avaId = state.players.find((p) => p.name === "Ava").id;
    const posted = await call(port, `/api/agent/${code}/chat`, {
      key: agentKey,
      body: { playerId: avaId, text: "Ahsoka checking in." },
    });
    assert.equal(posted.status, 200);
    const ava = await call(port, "/api/state", { token: players[0].token });
    assert.ok(ava.data.chats.some((c) => c.name === "Ahsoka (GM)" && c.text.includes("checking")));
    const ben = await call(port, "/api/state", { token: players[1].token });
    assert.equal(ben.data.chats.some((c) => c.text.includes("checking")), false);

    const summary = await call(port, `/api/agent/${code}/summary`, { key: agentKey });
    assert.equal(summary.status, 200);
    assert.match(summary.data, /Ashes of Lumination/);
  } finally {
    await close();
  }
});
