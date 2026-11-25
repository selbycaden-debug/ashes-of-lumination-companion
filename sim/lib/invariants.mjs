import {
  livingPlayers,
  playerById,
  roleOf,
  nameOfFrom,
  ashKindFor,
  ROLES,
} from "../dist/engine.js";

export function checkInvariants(state, ctx = {}) {
  const issues = [];
  const note = (severity, code, message) => issues.push({ severity, code, message, round: state.round, phase: state.phase, ...ctx });

  // Dead players should not have living-only night/day actions this round
  for (const a of state.actions) {
    if (a.round !== state.round) continue;
    const p = playerById(state.players, a.playerId);
    if (!p) {
      note("high", "action-orphan", "Action " + a.label + " references missing player " + a.playerId);
      continue;
    }
    if (!p.alive && a.phase !== "dawnAccord" && a.label.indexOf("last shot") < 0) {
      const nightDeath = state.log.some((l) =>
        l.text.indexOf(p.name + " has died (") === 0 &&
        (l.text.indexOf("Ash Fall kill") >= 0 || l.text.indexOf("three-poison") >= 0 || l.text.indexOf("joined the syndicate") >= 0),
      );
      const diedBeforeThisPhase =
        (a.phase === "lumination" && nightDeath) ||
        (a.phase === "ashFall" && nightDeath && a.label && false);
      // Acting during Ash Fall and then dying that night is legal. A Lumination
      // action after an Ash Fall death is not.
      if (a.phase === "lumination" && nightDeath) {
        note("high", "dead-acting", p.name + " died during Ash Fall but submitted " + a.label + " in Lumination");
      }
    }
    if (p.charges < 0) note("high", "negative-charges", p.name + " has charges " + p.charges);
  }
  for (const p of state.players) {
    if (p.charges < 0) note("high", "negative-charges", p.name + " has charges " + p.charges);
    if (p.poisonCount < 0) note("high", "negative-poison", p.name + " has poisonCount " + p.poisonCount);
  }

  const ids = state.players.map((p) => p.roleId).filter((id) => id);
  const uniq = new Set(ids);
  if (uniq.size !== ids.length) note("high", "duplicate-roles", "Duplicate role ids in play: " + ids.join(", "));

  if (state.dealt && state.players.length && !state.players.some((p) => p.roleId === "the-ashen-tyrant")) {
    note("high", "no-tyrant", "No Ashen Tyrant in the dealt game.");
  }

  // Failsafe / Blade check / Warden / Hand / Catalyst cannot target self
  for (const a of state.actions) {
    if (a.round !== state.round) continue;
    const p = playerById(state.players, a.playerId);
    if (!p) continue;
    const selfTarget = a.targets.length && a.targets.indexOf(p.id) >= 0;
    const noSelf = ["Failsafe cancel", "Shadow Blade check", "Integrity Warden check", "Silent Hand", "Lucid Catalyst swap", "Ashen Tyrant kill", "Shadow Blade kill", "Luminary Paradox kill", "Inherited Tyrant kill", "Mirebane poison", "Red Scar day kill", "Sunmark shot"];
    if (selfTarget && noSelf.some((l) => a.label.indexOf(l) >= 0)) {
      note("high", "illegal-self-target", p.name + " targeted themself with " + a.label);
    }
    if (a.label.indexOf("Mirebane") >= 0 && !a.skip) {
      const t = a.targets[0] ? playerById(state.players, a.targets[0]) : undefined;
      if (t && t.team === "Ashen") note("high", "mirebane-ashen-target", p.name + " poisoned Ashen teammate " + t.name);
    }
    if (a.label.indexOf("Parallax") >= 0 && a.targets[0] && a.targets[0] === a.targets[1]) {
      note("high", "same-two-targets", p.name + " picked the same player twice");
    }
  }

  // Leak: a non-Mind, non-Witness, non-Echo player result should not list other players' true secret roles as "X is The Role" except Blade tyrant check and known public-ish patterns
  const allowedRoleReveal = new Set();
  for (const p of state.players) {
    if (p.roleId === "the-ashen-mind" || p.roleId === "the-last-witness" || p.roleId === "the-echo-thief") allowedRoleReveal.add(p.id);
  }
  const roleNames = ROLES.map((r) => r.name);
  for (const r of state.results) {
    const viewer = playerById(state.players, r.playerId);
    if (!viewer) continue;
    // Affected player must never be told they are Ash Touched / Mire Touched
    if (/\bAsh Touched\b/.test(r.text) && viewer.ashTouched && r.text.indexOf(viewer.name) >= 0 && r.text.indexOf("is the Ash Touched player") >= 0) {
      // Eye check about themselves is a confirmed-allowed self pick; the result names the condition. Spec: never show Ash Touched to the *affected* player as a status. Self-check is a special case — log as question if it's the Eye checking themselves.
      if (viewer.roleId !== "the-watching-eye") {
        note("high", "leak-ash-touched", viewer.name + " received a result naming Ash Touched: " + r.text);
      }
    }
    if (r.text.indexOf("You are Ash Touched") >= 0 || r.text.indexOf("You are Mire Touched") >= 0) {
      note("high", "leak-touch-status", viewer.name + " was told their touch status: " + r.text);
    }
    if (allowedRoleReveal.has(viewer.id)) continue;
    if (r.text.indexOf("Start-of-round snapshot") === 0) continue;
    if (r.text.indexOf("You copy ") === 0) continue;
    if (r.text.indexOf("The player executed") === 0) continue;
    if (r.text.indexOf(" is The Ashen Tyrant") >= 0 || r.text.indexOf(" is not The Ashen Tyrant") >= 0) continue;
    // Other players' results shouldn't include "NAME — The Role" lists or "X is The Y"
    for (const other of state.players) {
      if (other.id === viewer.id) continue;
      const rn = roleOf(other.roleId).name;
      const leakPat = other.name + " — " + rn;
      if (r.text.indexOf(leakPat) >= 0) {
        note("high", "leak-role", viewer.name + " saw " + other.name + "'s true role in a result: " + r.text);
      }
    }
  }

  // Win-check sanity: if a winner is set, it should still hold; if not set, we don't invent one
  if (state.winner === "ashen") {
    const alive = livingPlayers(state.players);
    const ashen = alive.filter((p) => p.team === "Ashen");
    const rest = alive.length - ashen.length;
    const childExecuted = state.hadExecution && state.lastExecutedRoleId === "the-ashen-child";
    if (!childExecuted && ashen.length === 0 && alive.some((p) => p.roleId === "the-shadow-blade" && !state.shadowTakeover)) {
      // maybe all-lumen-dead? 
    }
    if (!childExecuted && ashen.length === 0 && alive.filter((p) => p.team === "Lumen").length > 0) {
      // Could still be "all Lumen are dead" inverted - if ashen empty and lumen live, ashen win is suspicious unless Child
      const lumenAlive = alive.filter((p) => p.team === "Lumen").length;
      if (lumenAlive > 0 && ashen.length < rest) {
        note("medium", "win-ashen-questionable", "Ashen win flagged while Ashen " + ashen.length + " vs rest " + rest + " (hadExecution child=" + childExecuted + ")");
      }
    }
  }
  if (state.winner === "lumen") {
    const alive = livingPlayers(state.players);
    const ashen = alive.filter((p) => p.team === "Ashen");
    const blade = alive.find((p) => p.roleId === "the-shadow-blade");
    const civic = alive.find((p) => p.roleId === "the-civic-luminary");
    if (state.shadowTakeover) {
      if (blade) note("high", "win-lumen-blade-alive", "Lumen win after takeover while the Shadow Blade is still alive");
    } else if (!(civic && alive.length === 4) && (ashen.length > 0 || blade)) {
      note("medium", "win-lumen-enemies-alive", "Lumen win while Ashen or Shadow Blade still live (civic4=" + Boolean(civic && alive.length === 4) + ")");
    }
  }

  if (["setup", "ashFall", "lumination", "dawnAccord"].indexOf(state.phase) < 0) {
    note("high", "bad-phase", "Unknown phase " + state.phase);
  }

  return issues;
}

export function formatIssues(issues) {
  return issues.map((i) => "[" + i.severity + "] " + i.code + " @ r" + i.round + "/" + i.phase + ": " + i.message);
}
