import {
  blankState,
  applyDeal,
  applyForcedDeal,
  startRound,
  resolveAshFall,
  resolveLumination,
  closeDawnAccord,
  setDawnNominees,
  castPlayerVote,
  enterParadoxFlip,
  answerSelfKnownQuestion,
  executeNominee,
  livingPlayers,
  nameOfFrom,
  tallies,
  voteWeight,
  playerById,
  ROLES,
  actionFor,
  ashKindFor,
  echoAshKind,
  hasInheritedKill,
  castNomination,
  computeDawnBallot,
  NO_EXEC,
} from "../dist/engine.js";
import { seedRandom, pick } from "./rng.mjs";
import { namesFor } from "./names.mjs";
import { snapshotAfterPhase } from "./visible.mjs";
import {
  applyScriptAction,
  chargeNotes,
  findPlayer,
  pickFuzzAshAction,
  pickFuzzDayAction,
  legalAshMoves,
  legalDayMoves,
  pendingInvites,
} from "./actions.mjs";
import { checkInvariants } from "./invariants.mjs";
import {
  pickRealisticAshAction,
  pickRealisticDayAction,
  pickRealisticNomination,
  pickRealisticVote,
  updateIntel,
  emptyIntel,
} from "./realistic.mjs";
import { answerSyndicateInvite, playerNeedsAshAction, buildReminders, buildAhsokaUpdate, setAshTouched, setAtOverride, suggestSoulboundPair } from "../dist/engine.js";

const MAX_ROUNDS = 25;

function record(snapshots, state, label, issues) {
  const snap = snapshotAfterPhase(state, ROLES);
  snap.label = label;
  snap.issues = issues || [];
  // GM-side extras for expects (Eye ruling regression): who has a night action, GM reminders, Ahsoka snapshot table-state line.
  try {
    snap.needsAsh = (state.players || []).filter((p) => playerNeedsAshAction(state, p)).map((p) => p.name);
    snap.reminders = state.dealt ? buildReminders(state) : [];
    snap.atRolls = (state.atRolls || []).map((r) => ({ round: r.round, name: ((state.players || []).find((p) => p.id === r.playerId) || {}).name, label: r.label, lie: r.lie, how: r.how }));
    snap.eyeLine = (buildAhsokaUpdate(state).split("\n").find((l) => l.indexOf("Watching Eye:") >= 0) || "").trim();
  } catch (e) {
    snap.needsAsh = [];
    snap.reminders = [];
    snap.eyeLine = "";
  }
  snapshots.push(snap);
  return snap;
}

function autoFlipIfNeeded(state, scriptFlip, issues, events) {
  if (!state.pendingParadoxFlip) return state;
  let heads;
  if (scriptFlip === "heads") heads = true;
  else if (scriptFlip === "tails") heads = false;
  else heads = Math.random() < 0.5;
  events.push("Harness/GM entered Paradox coin flip: " + (heads ? "Heads" : "Tails") + " (app requires a GM entry; conversion/succession details remain OPEN).");
  return enterParadoxFlip(state, heads);
}

function autoSelfKnown(state, events) {
  const before = state.results.length;
  const next = answerSelfKnownQuestion(state);
  if (next.results.length !== before) events.push("Harness/GM answered The Self Known question.");
  return next;
}

function autoInvites(state, events) {
  let next = state;
  const seen = new Set();
  for (const id of pendingInvites(next)) {
    if (seen.has(id)) continue;
    seen.add(id);
    const p = playerById(next.players, id);
    if (!p) continue;
    const accept = Math.random() < 0.5;
    next = answerSyndicateInvite(next, p, accept);
    events.push(p.name + " " + (accept ? "accepted" : "declined") + " a syndicate invite (harness).");
  }
  return next;
}

function applyNominations(state, intel, realistic) {
  let next = state;
  const living = livingPlayers(next.players);
  for (const p of living) {
    if ((next.nominations || {})[p.id]) continue;
    let tid;
    if (realistic) tid = pickRealisticNomination(next, p, intel || emptyIntel());
    else {
      const pool = living.filter((x) => x.id !== p.id);
      tid = (pool.length ? pick(pool) : p).id;
    }
    if (tid) next = castNomination(next, p.id, tid);
  }
  return next;
}

function voteChoice(choice, state) {
  if (!choice) return null;
  if (choice === "SAVE") return "SAVE";
  if (choice === "NO_EXEC" || choice === "NoExec" || choice === "No execution" || choice === "NoExec") return NO_EXEC;
  const p = state.players.find((x) => x.id === choice || x.name === choice);
  return p ? p.id : choice === NO_EXEC ? NO_EXEC : null;
}

function autoVotes(state, intel, realistic) {
  let next = state;
  const noms = (next.nominees || []).filter((id) => id);
  if (noms.length === 0) return next;
  for (const p of next.players) {
    if (p.alive) {
      const choice = realistic ? pickRealisticVote(next, p, intel || emptyIntel()) : pick(noms);
      if (choice) next = castPlayerVote(next, p.id, choice);
    } else if (p.finalVoteAvailable) {
      const choice = realistic ? pickRealisticVote(next, p, intel || emptyIntel()) : (Math.random() < 0.3 ? "SAVE" : pick(noms));
      if (choice) next = castPlayerVote(next, p.id, choice);
    }
  }
  return next;
}

function autoExecute(state, events) {
  const t = tallies(state);
  if (!t.length) {
    events.push("Dawn Accord: no tally (no nominees or no votes). No execution.");
    return { state, executed: false };
  }
  const max = Math.max(...t.map((x) => x.votes));
  const top = t.filter((x) => x.votes === max);
  if (max <= 0) {
    events.push("Dawn Accord: no positive votes. No execution.");
    return { state, executed: false };
  }
  if (top.length !== 1) {
    events.push("Dawn Accord: tie at " + max + " between " + top.map((x) => x.name).join(", ") + ". Table practice: a tie means no execution.");
    return { state, executed: false };
  }
  if (top[0].id === NO_EXEC) {
    events.push("Dawn Accord: No execution leads with " + top[0].votes + " votes (table practice).");
    return { state, executed: false };
  }
  events.push("Dawn Accord: executing " + top[0].name + " (unique lead, " + top[0].votes + " votes).");
  return { state: executeNominee(state, top[0].id), executed: true };
}

function collectLegalIssuesOnSubmit(state, act, p) {
  // already validated by legal moves in fuzz
  return [];
}

function fuzzPhaseActions(state, phase, events, issues, intel, realistic) {
  let next = state;
  const living = livingPlayers(next.players);
  if (phase === "ashFall") {
    for (const p of living) {
      const move = realistic ? pickRealisticAshAction(next, p, intel) : pickFuzzAshAction(next, p);
      if (!move) continue;
      try {
        next = applyScriptAction(next, move);
        events.push(p.name + " ash: " + JSON.stringify(move));
      } catch (err) {
        issues.push({ severity: "high", code: "action-throw", message: String(err && err.stack || err), round: next.round, phase: next.phase });
      }
    }
  }
  if (phase === "lumination") {
    for (const p of living) {
      const move = realistic ? pickRealisticDayAction(next, p, intel) : pickFuzzDayAction(next, p);
      if (!move) continue;
      try {
        next = applyScriptAction(next, move);
        events.push(p.name + " day: " + JSON.stringify({ action: move.action, target: move.target, skip: move.skip, role: move.role }));
      } catch (err) {
        issues.push({ severity: "high", code: "action-throw", message: String(err && err.stack || err), round: next.round, phase: next.phase });
      }
    }
    next = applyNominations(next, intel, realistic);
    next = autoSelfKnown(next, events);
    next = autoInvites(next, events);
  }
  return next;
}

/**
 * Run a JSON game script, or a fuzz game when script.mode === "fuzz".
 */

function compareExpect(script, snapshots, state, events) {
  const expected = script.expect;
  if (!expected || !expected.length) return [];
  const mismatches = [];
  const byLabel = {};
  for (const snap of snapshots) byLabel[snap.label] = snap;
  for (const exp of expected) {
    const label = exp.after + (exp.round ? "-r" + exp.round : "");
    const snap = snapshots.find((s) => s.label === label) || snapshots.find((s) => s.label && s.label.indexOf(exp.after) >= 0 && (!exp.round || String(s.label).indexOf("r" + exp.round) >= 0)) || (exp.after === "final" ? snapshots[snapshots.length - 1] : null);
    const st = snap && snap.gm ? null : null;
    const players = (snap && snap.gm && snap.gm.players) || state.players;
    const winner = snap ? (snap.winner || "") : (state.winner || "");
    const living = players.filter((p) => p.alive).map((p) => p.name);
    const dead = players.filter((p) => !p.alive).map((p) => p.name);
    const loc = (exp.round ? "G r" + exp.round + " " : "") + (exp.after || "check");
    if (exp.winner !== undefined && exp.winner !== (winner || "")) {
      mismatches.push({ loc, field: "winner", expected: exp.winner || "(none)", actual: winner || "(none)" });
    }
    if (exp.dead) {
      for (const name of exp.dead) {
        if (dead.indexOf(name) < 0) mismatches.push({ loc, field: "dead", expected: name + " dead", actual: "living or missing" });
      }
    }
    if (exp.livingNames) {
      const missing = exp.livingNames.filter((n) => living.indexOf(n) < 0);
      const extra = living.filter((n) => exp.livingNames.indexOf(n) < 0);
      if (missing.length || extra.length) mismatches.push({ loc, field: "living", expected: exp.livingNames.join(", "), actual: living.join(", ") });
    }
    if (exp.teamCounts) {
      for (const [team, want] of Object.entries(exp.teamCounts)) {
        const got = players.filter((p) => p.team === team).length;
        if (got !== want) mismatches.push({ loc, field: "teamCount:" + team, expected: want, actual: got });
      }
    }
    if (exp.livingCount !== undefined && living.length !== exp.livingCount) {
      mismatches.push({ loc, field: "livingCount", expected: exp.livingCount, actual: living.length });
    }
    if (exp.ballot) {
      const noms = ((snap && snap.gm && snap.gm.nominees) || state.nominees || []).map((id) => (id === "NO_EXEC" ? "No execution" : (players.find((p) => p.id === id) || {}).name || id)).filter(Boolean);
      const want = exp.ballot.slice().sort();
      const got = noms.slice().sort();
      if (JSON.stringify(want) !== JSON.stringify(got)) mismatches.push({ loc, field: "ballot", expected: want.join(", "), actual: got.join(", ") });
    }
    if (exp.executed) {
      const log = (snap && snap.gm && snap.gm.log) || (state.log || []).map((l) => l.text);
      const texts = Array.isArray(log) ? log.map((l) => (typeof l === "string" ? l : l.text)) : [];
      const hit = texts.some((t) => t && t.indexOf(exp.executed) >= 0 && t.toLowerCase().indexOf("died") >= 0 && t.toLowerCase().indexOf("execution") >= 0);
      if (!hit && state.lastExecutedName !== exp.executed) {
        // allow if dead list includes them after this step
        if (dead.indexOf(exp.executed) < 0) mismatches.push({ loc, field: "executed", expected: exp.executed, actual: state.lastExecutedName || "(none)" });
      }
    }
    if (exp.results) {
      const results = (snap && snap.players) || [];
      for (const [name, needle] of Object.entries(exp.results)) {
        const rec = results.find((r) => r.name === name);
        const texts = rec && rec.results ? rec.results.join(" | ") : "";
        // also search state.results
        const rs = (state.results || []).filter((r) => {
          const pl = state.players.find((x) => x.id === r.playerId);
          return pl && pl.name === name;
        }).map((r) => r.text).join(" | ");
        const hay = (texts + " " + rs).toLowerCase();
        if (hay.indexOf(String(needle).toLowerCase()) < 0) {
          mismatches.push({ loc, field: "result:" + name, expected: needle, actual: (texts || rs || "(no result)").slice(0, 200) });
        }
      }
    }
    if (exp.needsAshAction) {
      const needs = (snap && snap.needsAsh) || [];
      for (const [name, want] of Object.entries(exp.needsAshAction)) {
        const has = needs.indexOf(name) >= 0;
        if (has !== Boolean(want)) mismatches.push({ loc, field: "needsAshAction:" + name, expected: String(Boolean(want)), actual: String(has) });
      }
    }
    if (exp.remindersInclude) {
      const blob = ((snap && snap.reminders) || []).join(" | ");
      for (const n of exp.remindersInclude) if (blob.indexOf(n) < 0) mismatches.push({ loc, field: "reminders", expected: n, actual: blob.slice(0, 200) || "(none)" });
    }
    if (exp.charges) {
      const gmp = (snap && snap.gm && snap.gm.players) || [];
      for (const [name, want] of Object.entries(exp.charges)) {
        const rec = gmp.find((r) => r.name === name);
        const got = rec ? rec.charges : undefined;
        if (got !== want) mismatches.push({ loc, field: "charges:" + name, expected: want, actual: got });
      }
    }
    if (exp.atRolls) {
      // Caden 2026-11-17: each Ash Touched result is recorded as TRUE or FALSE. Expect [{name, label, lie, how?, round?}]; count: exact total if given.
      const got = (snap && snap.atRolls) || [];
      for (const w of exp.atRolls) {
        const hit = got.find((r) => r.name === w.name && (w.label === undefined || r.label === w.label) && (w.lie === undefined || r.lie === w.lie) && (w.round === undefined || r.round === w.round) && (w.how === undefined || String(r.how).indexOf(w.how) >= 0));
        if (!hit) mismatches.push({ loc, field: "atRolls", expected: w, actual: got.slice(0, 6) });
      }
    }
    if (typeof exp.atRollCount === "number") {
      const n = ((snap && snap.atRolls) || []).length;
      if (n !== exp.atRollCount) mismatches.push({ loc, field: "atRollCount", expected: exp.atRollCount, actual: n });
    }
    if (exp.remindersForbid) {
      const blob = ((snap && snap.reminders) || []).join(" | ");
      for (const n of exp.remindersForbid) if (blob.indexOf(n) >= 0) mismatches.push({ loc, field: "remindersForbid", expected: "no reminder containing: " + n, actual: "found" });
    }
    if (exp.eyeLine) {
      const got = (snap && snap.eyeLine) || "";
      if (got.indexOf(exp.eyeLine) < 0) mismatches.push({ loc, field: "eyeLine", expected: exp.eyeLine, actual: got || "(none)" });
    }
    if (exp.resultForbids) {
      // Game 10: a private result text must NOT exist for this player in state.results (GM-side, dead players included).
      for (const [name, needles] of Object.entries(exp.resultForbids)) {
        const rs = (state.results || []).filter((r) => {
          const pl = state.players.find((x) => x.id === r.playerId);
          return pl && pl.name === name;
        }).map((r) => r.text).join(" | ").toLowerCase();
        for (const n of needles) {
          if (rs.indexOf(String(n).toLowerCase()) >= 0) mismatches.push({ loc, field: "resultForbids:" + name, expected: "no result containing: " + n, actual: "found" });
        }
      }
    }
    if (exp.visibleForbids) {
      const recs = (snap && snap.players) || [];
      for (const [name, needles] of Object.entries(exp.visibleForbids)) {
        const rec = recs.find((r) => r.name === name);
        const blob = JSON.stringify({
          publicNotices: rec && rec.publicNotices,
          results: rec && rec.results,
          ownRole: rec && rec.ownRole,
          winner: rec && rec.winner,
          phase: rec && rec.phase,
        });
        for (const n of needles) {
          if (blob.toLowerCase().indexOf(String(n).toLowerCase()) >= 0) {
            mismatches.push({ loc, field: "visibleForbids:" + name, expected: "not visible: " + n, actual: "found in player-facing snapshot" });
          }
        }
      }
    }
    if (exp.publicOmits) {
      const notices = ((snap && snap.gm && snap.gm.publicNotices) || []).join("\n");
      const nomLine = (notices.split("\n").find((l) => l.indexOf("Nominations:") === 0) || "");
      for (const name of exp.publicOmits) {
        if (nomLine.indexOf(name + " →") >= 0) {
          mismatches.push({ loc, field: "publicOmits", expected: name + " omitted from public nominations", actual: nomLine });
        }
      }
    }
    if (exp.publicIncludesNoms) {
      // Caden ruling 2026-11-16: Silent Hand-voided nominations are listed as normal in the public nomination list.
      const notices = ((snap && snap.gm && snap.gm.publicNotices) || []).join("\n");
      const nomLine = (notices.split("\n").find((l) => l.indexOf("Nominations:") === 0) || "");
      for (const name of exp.publicIncludesNoms) {
        if (nomLine.indexOf(name + " →") < 0) mismatches.push({ loc, field: "publicIncludesNoms", expected: name + " listed in public nominations", actual: nomLine || "(no Nominations: notice)" });
      }
    }
    if (exp.publicForbids) {
      const recs = (snap && snap.players) || [];
      const blob = JSON.stringify(recs.map((r) => r.publicNotices)).toLowerCase();
      for (const n of exp.publicForbids) if (blob.indexOf(String(n).toLowerCase()) >= 0) mismatches.push({ loc, field: "publicForbids", expected: "no player-facing public text containing: " + n, actual: "found" });
    }
    if (exp.publicIncludesVotes) {
      const notices = ((snap && snap.gm && snap.gm.publicNotices) || []).join("\n");
      const voteLine = (notices.split("\n").find((l) => l.indexOf("Votes:") === 0) || notices);
      for (const name of exp.publicIncludesVotes) {
        if (voteLine.indexOf(name + " →") < 0 && voteLine.indexOf(name + " ->") < 0) {
          mismatches.push({ loc, field: "publicIncludesVotes", expected: name + " listed as a cast vote", actual: voteLine || "(no Votes: notice)" });
        }
      }
    }
    if (exp.logForbids) {
      // Nov 21 audit: a log text that must NOT exist at this snapshot.
      const texts = ((snap && snap.gm && snap.gm.log) || (state.log || [])).map((l) => (typeof l === "string" ? l : l.text)).join("\n").toLowerCase();
      for (const needle of exp.logForbids) if (texts.indexOf(String(needle).toLowerCase()) >= 0) mismatches.push({ loc, field: "logForbids", expected: "no log containing: " + needle, actual: "found" });
    }
    if (exp.poisonCounts) {
      // Nov 21 audit: exact poison counts at this snapshot.
      for (const [name, want] of Object.entries(exp.poisonCounts)) {
        const rec = players.find((p) => p.name === name);
        const got = rec ? rec.poisonCount : undefined;
        if (got !== want) mismatches.push({ loc, field: "poisonCount:" + name, expected: want, actual: got });
      }
    }
    if (exp.logIncludes) {
      const texts = ((snap && snap.gm && snap.gm.log) || (state.log || [])).map((l) => (typeof l === "string" ? l : l.text)).join("\n");
      for (const needle of exp.logIncludes) {
        if (texts.toLowerCase().indexOf(String(needle).toLowerCase()) < 0) {
          mismatches.push({ loc, field: "log", expected: needle, actual: "(not found)" });
        }
      }
    }
  }
  // Expect entries may carry `superseded`: table values replaced by a later CADEN ruling. They are reported, never counted as mismatches.
  mismatches.superseded = [];
  for (const exp of expected) {
    for (const sup of exp.superseded || []) {
      mismatches.superseded.push({ loc: "G r" + (exp.round || 0) + " " + exp.after, ...sup });
    }
  }
  return mismatches;
}

export function runGame(script = {}) {
  chargeNotes.length = 0;
  const seed = script.seed ?? (Date.now() % 1e9);
  seedRandom(seed);
  const events = [];
  const snapshots = [];
  const issues = [];
  let state = blankState();
  const maxRounds = script.maxRounds || MAX_ROUNDS;
  let crashed = null;

  try {
    if (script.rechargeAt) state = { ...state, rechargeAt: script.rechargeAt };
    // Caden ruling 2026-11-17: Ash Touched info may be true or false. Scripts can set the GM chance (0-100)
    // and force individual results (script.atForce list, or the atForce step op) so replays are deterministic.
    if (typeof script.atFalsePct === "number") state = { ...state, atFalsePct: script.atFalsePct };
    if (script.unalignedPick === 0 || script.unalignedPick === 1 || script.unalignedPick === -1) {
      state = { ...state, unalignedPick: script.unalignedPick };
    }
    if (script.players && script.players.length) {
      const seats = script.players.map((p) => ({
        name: p.name,
        roleId: p.role || p.roleId,
        ashTouched: Boolean(p.ashTouched),
        soulbound: p.soulbound || "",
      }));
      state = applyForcedDeal(state, seats, {
        mindMasksByName: script.mindMasks || {},
        rechargeAt: script.rechargeAt || state.rechargeAt || 6,
        unalignedPick: script.unalignedPick,
        testCutoff75: script.testCutoff75 === true,
        designDefaults: script.designDefaults || {},
      });
      events.push("Forced deal of " + seats.length + " players.");
    } else {
      const n = script.playerCount || (script.deal === "random" ? 8 : 8);
      // Test rule (Caden, Nov 18 card): 75% succession cutoff, off unless the script sets testCutoff75.
      if (script.testCutoff75 === true) state = { ...state, testCutoff75: true };
      // Nov 21 audit: design defaults D1–D57 are on unless the script switches one off (e.g. {"D43": false}).
      if (script.designDefaults) state = { ...state, designDefaults: script.designDefaults };
      // Study switch: AOL_DD='{"D6":false,...}' applies design-default overrides to random-deal batches.
      if (!script.designDefaults && process.env.AOL_DD) state = { ...state, designDefaults: JSON.parse(process.env.AOL_DD) };
      state = applyDeal(state, script.names || namesFor(n));
      events.push("Random deal of " + state.players.length + " players.");
      // Caden ruling 2026-11-16: exactly 1 Ash Touched per game, placed by the GM. The harness plays the GM and places one at random.
      if (script.placeAshTouched !== false) {
        let at = pick(state.players);
        if (at && at.team === "Ashen") at = state.players.find((p) => p.team !== "Ashen");
        if (at) state = setAshTouched(state, at.id);
      }
      // Caden ruling 2026-11-18: Soulbound is in every game with 10+ players. The harness plays the GM and places a random pair.
      if (state.players.length >= 10 && script.placeSoulbound !== false) state = suggestSoulboundPair(state);
    }
    for (const f of script.atForce || []) {
      const t = findPlayer(state, f.player);
      if (!t) throw new Error("atForce: unknown " + f.player);
      const rounds = Array.isArray(f.rounds) ? f.rounds : [f.round];
      for (const rd of rounds) state = setAtOverride(state, t.id, rd, f.value);
    }
    issues.push(...checkInvariants(state, { at: "deal" }));
    record(snapshots, state, "after-deal", checkInvariants(state));

    const isFuzz = script.mode === "fuzz" || script.mode === "realistic" || script.fuzz === true || script.realistic === true;
    const steps = isFuzz ? null : script.steps || [{ op: "playToEnd" }];

    const realistic = script.mode === "realistic" || script.realistic === true;
    let intel = emptyIntel();
    const playToEnd = () => {
      if (!state.dealt) return;
      if (state.phase === "setup") {
        state = startRound(state, true);
        events.push("Begin Round 1");
        intel = updateIntel(state, intel);
        issues.push(...checkInvariants(state, { at: "start-r1" }));
        record(snapshots, state, "ashFall-r" + state.round + "-start", checkInvariants(state));
      }
      let guard = 0;
      while (state.winner === "" && state.round <= maxRounds && guard++ < maxRounds * 6) {
        if (state.phase === "ashFall") {
          state = fuzzPhaseActions(state, "ashFall", events, issues, intel, realistic);
          const before = state.phase;
          state = resolveAshFall(state);
          if (state.phase === before && state.winner === "") {
            issues.push({ severity: "high", code: "stuck-phase", message: "resolveAshFall did not advance the phase", round: state.round, phase: state.phase });
            break;
          }
          state = autoFlipIfNeeded(state, script.paradoxFlip, issues, events);
          intel = updateIntel(state, intel);
          issues.push(...checkInvariants(state, { at: "after-ashFall" }));
          record(snapshots, state, "after-ashFall-r" + state.round, checkInvariants(state));
        }
        if (state.winner !== "") break;
        if (state.phase === "lumination") {
          state = fuzzPhaseActions(state, "lumination", events, issues, intel, realistic);
          const before = state.phase;
          state = resolveLumination(state);
          if (state.phase === before && state.winner === "") {
            issues.push({ severity: "high", code: "stuck-phase", message: "resolveLumination did not advance the phase", round: state.round, phase: state.phase });
            break;
          }
          intel = updateIntel(state, intel);
          issues.push(...checkInvariants(state, { at: "after-lumination" }));
          record(snapshots, state, "after-lumination-r" + state.round, checkInvariants(state));
        }
        if (state.winner !== "") break;
        if (state.phase === "dawnAccord") {
          if (!(state.nominees || []).filter(Boolean).length) {
            state = applyNominations(state, intel, realistic);
            state = computeDawnBallot(state);
          }
          events.push("Nominees: " + (state.nominees || []).filter(Boolean).map((id) => nameOfFrom(state, id)).join(", "));
          state = autoVotes(state, intel, realistic);
          const ex = autoExecute(state, events);
          state = ex.state;
          issues.push(...checkInvariants(state, { at: "after-execute" }));
          record(snapshots, state, "after-dawn-r" + state.round, checkInvariants(state));
          if (state.winner !== "") break;
          const r = state.round;
          state = closeDawnAccord(state);
          if (state.winner === "" && state.phase !== "ashFall") {
            issues.push({ severity: "high", code: "stuck-phase", message: "closeDawnAccord did not return to Ash Fall", round: state.round, phase: state.phase });
            break;
          }
          if (state.round === r && state.winner === "") {
            issues.push({ severity: "high", code: "stuck-round", message: "Round number did not increment", round: state.round, phase: state.phase });
            break;
          }
          record(snapshots, state, "ashFall-r" + state.round + "-start", checkInvariants(state));
        }
      }
      if (state.winner === "" && state.round > maxRounds) {
        issues.push({ severity: "medium", code: "no-winner-max-rounds", message: "No winner after " + maxRounds + " rounds", round: state.round, phase: state.phase });
      }
    };

    if (isFuzz || (steps && steps.some((s) => s.op === "playToEnd") && steps.length === 1)) {
      playToEnd();
    } else if (steps) {
      for (const step of steps) {
        const op = step.op || step.type;
        if (op === "startRound" || op === "beginRound") {
          state = startRound(state, state.round === 0 || state.phase === "setup");
        } else if (op === "ashFall") {
          for (const act of step.actions || []) state = applyScriptAction(state, act);
        } else if (op === "resolveAshFall") {
          state = resolveAshFall(state);
          state = autoFlipIfNeeded(state, step.flip || script.paradoxFlip, issues, events);
        } else if (op === "paradoxFlip") {
          state = enterParadoxFlip(state, step.result === "heads" || step.heads === true);
        } else if (op === "lumination") {
          for (const act of step.actions || []) state = applyScriptAction(state, act);
          if (step.nominations) {
            for (const [who, target] of Object.entries(step.nominations)) {
              const pl = findPlayer(state, who);
              const t = findPlayer(state, target);
              if (pl && t) state = castNomination(state, pl.id, t.id);
            }
          }
          state = autoSelfKnown(state, events);
        } else if (op === "answerSelfKnown") {
          state = autoSelfKnown(state, events);
        } else if (op === "resolveLumination") {
          state = resolveLumination(state);
          // Nov 21 audit (D36): a Red Scar day kill can trigger the Paradox coin flip.
          state = autoFlipIfNeeded(state, step.flip || script.paradoxFlip, issues, events);
        } else if (op === "gmToggle") {
          // Mirrors the GM panel's player toggles (Shielded, Mire Touched, ...): set one flag by hand.
          const gp = findPlayer(state, step.player);
          if (!gp) throw new Error("gmToggle: unknown " + step.player);
          state = { ...state, players: state.players.map((x) => (x.id === gp.id ? { ...x, [step.key]: step.value !== false } : x)) };
        } else if (op === "nominate") {
          if (step.nominations) {
            for (const [who, target] of Object.entries(step.nominations)) {
              const p = findPlayer(state, who);
              const t = findPlayer(state, target);
              if (p && t) state = castNomination(state, p.id, t.id);
            }
            if (state.phase === "dawnAccord" || step.recompute) {
              // If lumination already resolved, rebuild the ballot from these nominations.
              state = computeDawnBallot(state);
            }
          }
          if (step.nominees) {
            const ids = step.nominees.map((n) => (n === "No execution" || n === "NoExec" || n === "NO_EXEC" ? NO_EXEC : findPlayer(state, n)?.id)).filter(Boolean);
            state = setDawnNominees(state, ids);
          }
        } else if (op === "vote") {
          for (const [who, choice] of Object.entries(step.votes || {})) {
            const p = findPlayer(state, who);
            const c = voteChoice(choice, state);
            if (p && c) state = castPlayerVote(state, p.id, c);
          }
        } else if (op === "execute") {
          if (step.target === "auto" || step.auto) {
            const ex = autoExecute(state, events);
            state = ex.state;
          } else {
            const raw = step.target || "";
            if (raw === "NO_EXEC" || raw === "NoExec" || raw === "No execution" || raw === NO_EXEC) {
              state = executeNominee(state, NO_EXEC);
            } else {
              const t = findPlayer(state, raw);
              if (!t) throw new Error("execute: unknown " + raw);
              state = executeNominee(state, t.id);
            }
          }
        } else if (op === "nextRound" || op === "closeDawnAccord") {
          state = closeDawnAccord(state);
        } else if (op === "playToEnd") {
          playToEnd();
        } else if (op === "placeAshTouched") {
          // GM places the 1 Ash Touched player (Caden ruling 2026-11-16).
          const t = findPlayer(state, step.player);
          if (!t) throw new Error("placeAshTouched: unknown " + step.player);
          state = setAshTouched(state, t.id);
        } else if (op === "atForce") {
          // GM forces one Ash Touched result true or false (per player per round; "auto" clears it).
          const t = findPlayer(state, step.player);
          if (!t) throw new Error("atForce: unknown " + step.player);
          state = setAtOverride(state, t.id, typeof step.round === "number" ? step.round : state.round, step.value);
        } else if (op === "atFalsePct") {
          state = { ...state, atFalsePct: step.value };
        } else if (op === "flip") {
          state = enterParadoxFlip(state, step.result === "heads");
        } else {
          throw new Error("Unknown step op: " + op);
        }
        issues.push(...checkInvariants(state, { at: op }));
        record(snapshots, state, op + (state.round ? "-r" + state.round : ""), checkInvariants(state));
        if (state.winner !== "" && op !== "playToEnd") break;
      }
    }
  } catch (err) {
    crashed = String(err && err.stack || err);
    issues.push({ severity: "critical", code: "crash", message: crashed, round: state.round, phase: state.phase });
  }

  const mismatches = compareExpect(script, snapshots, state, events);
  return {
    name: script.name || "game",
    seed,
    crashed,
    winner: state.winner,
    rounds: state.round,
    mismatches,
    superseded: mismatches.superseded || [],
    chargeNotes: chargeNotes.slice(),
    phase: state.phase,
    roster: state.players.map((p) => ({ name: p.name, role: p.roleId, team: p.team, alive: p.alive })),
    issues,
    events,
    snapshots,
    state,
  };
}

export function toMarkdown(result) {
  const lines = [];
  lines.push("# " + result.name);
  lines.push("");
  lines.push("- Seed: " + result.seed);
  lines.push("- Winner: " + (result.winner || "(none)") + " after " + result.rounds + " round(s), phase " + result.phase);
  if (result.crashed) lines.push("- **CRASH:** " + result.crashed.split("\n")[0]);
  lines.push("");
  lines.push("## Roster");
  lines.push("");
  for (const p of result.roster || []) {
    lines.push("- " + p.name + " — " + p.role + " (" + p.team + ")" + (p.alive ? "" : " [dead]"));
  }
  lines.push("");
  lines.push("## Issues");
  lines.push("");
  const uniq = [];
  const seen = new Set();
  for (const i of result.issues || []) {
    const k = i.severity + i.code + i.message;
    if (seen.has(k)) continue;
    seen.add(k);
    uniq.push(i);
  }
  if (!uniq.length) lines.push("None.");
  else for (const i of uniq) lines.push("- **" + i.severity + "** `" + i.code + "` @ r" + i.round + "/" + i.phase + ": " + i.message);
  lines.push("");
  lines.push("## Event trace");
  lines.push("");
  for (const e of result.events || []) lines.push("- " + e);
  lines.push("");
  lines.push("## Phase snapshots (GM log + public notices + per-player results)");
  lines.push("");
  for (const snap of result.snapshots || []) {
    lines.push("### " + snap.label + " — Round " + snap.round + " / " + snap.phase + (snap.winner ? " / winner " + snap.winner : ""));
    lines.push("");
    if (snap.gm && snap.gm.publicNotices && snap.gm.publicNotices.length) {
      lines.push("Public notices:");
      for (const n of snap.gm.publicNotices) lines.push("- " + n);
      lines.push("");
    }
    const log = (snap.log || []).slice(0, 12);
    if (log.length) {
      lines.push("Recent log (oldest of the first entries in this snapshot list):");
      for (const t of (snap.gm && snap.gm.log ? snap.gm.log.slice(0, 20) : log)) lines.push("- " + t);
      lines.push("");
    }
    for (const pv of snap.players || []) {
      lines.push("#### " + pv.viewer + (pv.alive ? "" : " (Remnant)") + " — " + (pv.ownRole ? pv.ownRole.name + " / " + pv.ownRole.team : ""));
      if (pv.ashenTeammates) lines.push("Ashen teammates (names only): " + (pv.ashenTeammates.join(", ") || "(none)"));
      if (pv.results && pv.results.length) {
        for (const r of pv.results) lines.push("- result r" + r.round + ": " + r.text);
      }
      lines.push("");
    }
  }
  return lines.join("\n") + "\n";
}
