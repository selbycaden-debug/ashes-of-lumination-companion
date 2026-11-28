import {
  DESIGN_DEFAULTS,
  NO_EXEC,
  ROLES,
  answerSelfKnownQuestion,
  applyDeal,
  blankState,
  castNomination,
  castPlayerVote,
  closeDawnAccord,
  computeDawnBallot,
  cutoffInfo,
  enterParadoxFlip,
  executeNominee,
  phaseLabel,
  resolveAshFall,
  resolveLumination,
  roleOf,
  setAshTouched,
  setSoulboundPair,
  startRound,
  applyDeath,
  checkWins,
  tallies,
  nominationWeight,
  winnerLabel,
  addLog,
  rulebookFor,
  countTeams,
  suggestSoulboundPair,
  soulboundRequired,
  hasSoulboundPair,
  MAX_PLAYERS,
  buildReminders,
} from "../sim/dist/engine.js";
import { applyScriptAction, legalAshMoves, legalDayMoves } from "../sim/lib/actions.mjs";

export function freshTable() {
  return {
    ...blankState(),
    setupNames: [],
    holdWin: true,
    log: [{ id: "boot", text: "Room open. Players join with the code, then the GM deals." }],
  };
}

function cleanName(name) {
  return String(name || "").trim().slice(0, 24);
}

export function reduce(state, action) {
  switch (action.type) {
    case "add-player": {
      if (state.dealt) throw new Error("The game has already been dealt.");
      const name = cleanName(action.name);
      if (!name) throw new Error("Enter a name.");
      if (state.setupNames.some((n) => n.toLowerCase() === name.toLowerCase())) throw new Error("That name is already at the table.");
      if (state.setupNames.length >= MAX_PLAYERS) throw new Error("This table is full.");
      return { ...state, setupNames: state.setupNames.concat(name) };
    }
    case "reorder": {
      if (state.dealt) throw new Error("The seating is locked.");
      const names = state.setupNames.slice();
      let i = action.name ? names.indexOf(action.name) : -1;
      if (i < 0 && typeof action.playerId === "string" && action.playerId.startsWith("seat")) {
        const n = Number(action.playerId.slice(4));
        if (Number.isInteger(n)) i = n;
      }
      if (i < 0 && action.playerId) i = names.indexOf(action.playerId);
      const j = i + (action.dir === "up" ? -1 : 1);
      if (i < 0 || j < 0 || j >= names.length) return state;
      const swap = names[i];
      names[i] = names[j];
      names[j] = swap;
      return { ...state, setupNames: names };
    }
    case "settings": {
      if (typeof action.automate === "boolean") {
        if (Object.keys(action).every((key) => key === "type" || key === "automate")) return { ...state, automate: action.automate };
        if (!state.dealt) state = { ...state, automate: action.automate };
      }
      if (state.dealt) {
        if (typeof action.automate === "boolean") return { ...state, automate: action.automate };
        throw new Error("Setup is locked once roles are dealt.");
      }
      const next = { ...state };
      if (typeof action.cutoff === "boolean") next.testCutoff75 = action.cutoff;
      if (typeof action.testCutoff75 === "boolean") next.testCutoff75 = action.testCutoff75;
      if (typeof action.atFalsePct === "number") next.atFalsePct = Math.max(0, Math.min(100, Math.round(action.atFalsePct)));
      if (action.unalignedPick === -1 || action.unalignedPick === 0 || action.unalignedPick === 1) next.unalignedPick = action.unalignedPick;
      if (action.ashenPick === -1 || action.ashenPick === 3 || action.ashenPick === 4) next.ashenPick = action.ashenPick;
      if (action.unalignedWide === -1 || action.unalignedWide === 1 || action.unalignedWide === 2) next.unalignedWide = action.unalignedWide;
      if (action.designDefaults && typeof action.designDefaults === "object") {
        next.designDefaults = { ...(state.designDefaults || {}) };
        for (const [id, value] of Object.entries(action.designDefaults)) {
          if (typeof value === "boolean") next.designDefaults[id] = value;
        }
      }
      if (action.allDefaults === "on") next.designDefaults = {};
      if (action.allDefaults === "off") next.designDefaults = Object.fromEntries(DESIGN_DEFAULTS.map((d) => [d.id, false]));
      return next;
    }
    case "autofill":
      return state;
    case "deal": {
      if (state.dealt) throw new Error("Roles are already dealt.");
      const next = applyDeal(state, state.setupNames);
      if (!next.dealt) throw new Error("Deal needs 5 to 20 names.");
      return { ...next, automate: state.automate === true, holdWin: true };
    }
    case "edit-night": {
      if (state.phase !== "ashFall") throw new Error("The night is closed.");
      if (!state.actions.some((item) => item.id === action.actionId && item.phase === "ashFall" && item.round === state.round)) {
        throw new Error("That action is not in this night.");
      }
      const actions = state.actions.map((item) => {
        if (item.id !== action.actionId || item.phase !== "ashFall" || item.round !== state.round) return item;
        if (action.undo) return { ...item, skip: false, targets: item.voidedTargets || [], voidedTargets: [] };
        if (action.void) return { ...item, skip: true, targets: [], voidedTargets: (item.targets || []).slice(), extra: "" };
        const targets = [action.targetId, action.targetId2].filter(Boolean);
        if (targets.length < 1) throw new Error("Choose a target.");
        return { ...item, skip: false, targets, voidedTargets: [] };
      });
      return addLog({ ...state, actions }, "GM edited a night action. Nothing is applied until the night is resolved.");
    }
    case "ash-touched": {
      if (!state.dealt) throw new Error("Deal first.");
      const person = state.players.find((p) => p.id === action.playerId);
      if (person?.team === "Ashen") return pushPlain(state, person.name + " was not marked Ash Touched. Ashen are immune.");
      return pushPlain(setAshTouched(state, action.playerId || ""), person ? "GM marked " + person.name + " Ash Touched." : "GM cleared Ash Touched.");
    }
    case "undo-ash": {
      if (!state.dealt) throw new Error("Deal first.");
      const person = state.players.find((p) => p.id === action.playerId);
      if (!person) throw new Error("Unknown player.");
      return pushPlain({
        ...state,
        players: state.players.map((p) => (p.id === person.id ? { ...p, ashTouched: false } : p)),
      }, "GM cleared Ash Touched on " + person.name + ".");
    }
    case "gm-mire": {
      if (!state.dealt) throw new Error("Deal first.");
      const person = state.players.find((p) => p.id === action.playerId);
      if (!person) throw new Error("Unknown player.");
      if (person.team === "Ashen") return pushPlain(state, person.name + " was not marked Mire Touched. Ashen are immune.");
      return pushPlain({
        ...state,
        players: state.players.map((p) => (p.id === person.id ? { ...p, gmMire: true } : p)),
      }, "GM marked " + person.name + " Mire Touched. Players are not told.");
    }
    case "undo-mire": {
      if (!state.dealt) throw new Error("Deal first.");
      const person = state.players.find((p) => p.id === action.playerId);
      if (!person) throw new Error("Unknown player.");
      return pushPlain({
        ...state,
        players: state.players.map((p) => (p.id === person.id ? { ...p, gmMire: false } : p)),
      }, "GM cleared the Mire Touched note on " + person.name + ".");
    }
    case "gm-kill": {
      if (!state.dealt) throw new Error("Deal first.");
      if (state.gmEnded) throw new Error("The game is over.");
      const person = state.players.find((p) => p.id === action.playerId);
      if (!person?.alive) throw new Error("That player is already dead.");
      const snapshot = {
        players: state.players.map((p) => ({ ...p })),
        deathCount: state.deathCount || 0,
        tyrantHasDied: state.tyrantHasDied,
        successorId: state.successorId,
        shadowTakeover: state.shadowTakeover,
        successionOver: state.successionOver,
        successionPasses: state.successionPasses,
        peaceRound: state.peaceRound,
        nightOfPeace: state.nightOfPeace,
        publicNotices: [...(state.publicNotices || [])],
        nightDeaths: { ...(state.nightDeaths || {}) },
        obituary: (state.obituary || []).slice(),
        suggestedWinner: state.suggestedWinner || "",
        suggestedReason: state.suggestedReason || "",
      };
      let next = applyDeath({ ...state, holdWin: true }, person.id, "the GM");
      next = checkWins(next, next.phase === "dawnAccord");
      next = recordDeaths(state.players, next, state.phase, state.round);
      const diedNow = snapshot.players.filter((before) => before.alive && !next.players.find((p) => p.id === before.id)?.alive).map((before) => before.name);
      const prior = (next.nightDeaths || {})[String(state.round)] || [];
      const list = [...prior];
      for (const name of diedNow) if (!list.includes(name)) list.push(name);
      next = {
        ...next,
        holdWin: true,
        nightDeaths: { ...(next.nightDeaths || {}), [String(state.round)]: list },
        publicNotices: tonightNotice(next.publicNotices, list),
        gmKillUndo: { ...(state.gmKillUndo || {}), [person.id]: snapshot },
      };
      return pushPlain(next, "GM killed " + person.name + ".");
    }
    case "undo-kill": {
      if (!state.dealt) throw new Error("Deal first.");
      const snap = (state.gmKillUndo || {})[action.playerId];
      if (!snap) throw new Error("There is no kill to undo.");
      const person = state.players.find((p) => p.id === action.playerId);
      const rest = { ...(state.gmKillUndo || {}) };
      delete rest[action.playerId];
      return pushPlain({
        ...state,
        ...snap,
        holdWin: true,
        gmEnded: state.gmEnded,
        automate: state.automate,
        gmKillUndo: rest,
        gmPlainLog: state.gmPlainLog,
      }, "GM undid the kill on " + (person?.name || "that player") + ". " + (person?.name || "They") + " " + (person ? "is" : "are") + " alive again.");
    }
    case "timer-start":
      return startPhaseTimer(state, action.minutes);
    case "timer-pause":
      return pausePhaseTimer(state);
    case "timer-resume":
      return resumePhaseTimer(state);
    case "timer-add":
      return addPhaseTimer(state, action.seconds);
    case "timer-stop":
      return { ...state, phaseTimer: null };
    case "end-game": {
      if (!state.dealt) throw new Error("Deal first.");
      if (!action.confirm) throw new Error("Confirm the ending.");
      const winner = action.winner;
      if (!["lumen", "ashen", "syndic", "shadow"].includes(winner)) throw new Error("Pick who won.");
      const closed = addLog({ ...state, winner, gmEnded: true, suggestedWinner: "", suggestedReason: "", phaseTimer: null }, "GM ended the game. Result: " + winnerLabel(winner) + ".");
      return stampLeaving(state, closed);
    }
    case "soulbound": {
      if (!state.dealt) throw new Error("Deal first.");
      return setSoulboundPair(state, action.a, action.b);
    }
    case "start":
      return beginGame(state);
    case "suggest-soulbound": {
      if (!state.dealt) throw new Error("Deal first.");
      return suggestSoulboundPair(state);
    }
    case "mind-override": {
      if (!state.dealt) throw new Error("Deal first.");
      const shown = action.shown && typeof action.shown === "object" ? action.shown : {};
      const forced = { ...(state.forcedMindMasks || {}) };
      const masks = { ...(state.mindMasks || {}) };
      for (const [playerId, roleId] of Object.entries(shown)) {
        if (!state.players.some((p) => p.id === playerId)) continue;
        if (!ROLES.some((r) => r.id === roleId && r.team === "Lumen")) continue;
        forced[playerId] = roleId;
        masks[playerId] = roleId;
      }
      return addLog(
        { ...state, forcedMindMasks: forced, mindMasks: masks },
        "GM updated the Ashen Mind list. The next snapshot uses it.",
      );
    }
    case "submit":
      return submit(state, action);
    case "vote": {
      if (state.phase !== "dawnAccord") throw new Error("Voting is closed.");
      const existing = (state.votes || {})[action.playerId];
      if (existing && existing !== action.choice) throw new Error("Vote submitted.");
      if (existing) return state;
      return castPlayerVote(state, action.playerId, action.choice);
    }
    case "invite-response":
      return applyScriptAction(state, { player: action.playerId, action: "answerInvite", accept: Boolean(action.accept) });
    case "notes": {
      const text = String(action.text || "").slice(0, 4000);
      return {
        ...state,
        players: state.players.map((p) => (p.id === action.playerId ? { ...p, notes: text } : p)),
      };
    }
    case "gm-note": {
      const text = String(action.text || "").slice(0, 4000);
      return {
        ...state,
        players: state.players.map((p) => (p.id === action.playerId ? { ...p, gmNotes: text } : p)),
      };
    }
    case "resolve":
      return advance(state, action);
    case "coin": {
      if (!state.pendingParadoxFlip) throw new Error("No coin is waiting.");
      if (action.result !== "heads" && action.result !== "tails") throw new Error("Call heads or tails.");
      return enterParadoxFlip(state, action.result === "heads");
    }
    default:
      throw new Error("Unknown action.");
  }
}

function submit(state, action) {
  const player = state.players.find((p) => p.id === action.playerId);
  if (!player) throw new Error("Unknown player.");
  if (action.kind === "nomination") {
    if (state.phase !== "dawnAccord") throw new Error("You cannot nominate now.");
    if (!player.alive) throw new Error("You cannot nominate.");
    if ((state.nominations || {})[player.id]) throw new Error("Nomination submitted.");
    return refreshBallot(castNomination(state, player.id, action.targetId));
  }
  if (action.kind === "statement") return state;
  const script = {
    player: player.id,
    action: action.ability || action.kind,
    target: action.targetId && action.targetId !== "skip" ? action.targetId : undefined,
    target2: action.targetId2 || undefined,
    skip: Boolean(action.skip || action.targetId === "skip"),
    role: action.roleId,
    accept: action.accept,
    ids: action.ids,
  };
  if (script.action === "invites" && Array.isArray(action.ids)) {
    let next = state;
    for (const id of action.ids) next = applyScriptAction(next, { player: player.id, action: "invite", target: id });
    return next;
  }
  if (script.action === "scar") script.action = "dayKill";
  if (script.target && script.target2 && String(script.target) === String(script.target2)) {
    throw new Error("Pick two different players.");
  }
  if (script.action === "reveal" || script.action === "recruit-shield") {
    if (script.action === "recruit-shield") return applyScriptAction(state, { player: player.id, action: "syndShield", on: true });
    throw new Error("That action is not on this role's screen.");
  }
  if (script.action === "night") script.action = action.ability;
  if (script.action === "syndShield" && player.syndShieldArmed) throw new Error("Action submitted.");
  if (actionLocked(state, player, script.action)) throw new Error("Action submitted.");
  return applyScriptAction(state, script);
}

function beginGame(state) {
  if (!state.dealt || state.phase !== "setup") throw new Error("Deal roles before the first Ash Fall.");
  if (soulboundRequired(state) && !hasSoulboundPair(state)) {
    throw new Error("Soulbound is required in every game with 10 or more players. Place a pair before Ash Fall.");
  }
  return startRound(state, true);
}

function advance(state, action = {}) {
  if (state.pendingParadoxFlip) throw new Error("Enter the Paradox coin first.");
  if (state.gmEnded || state.winner) throw new Error("The game is over.");
  if (state.phase === "setup") return finishPhase(state, beginGame(state));
  if (state.phase === "ashFall") {
    const aliveBefore = new Set(state.players.filter((p) => p.alive).map((p) => p.id));
    let next = resolveAshFall({ ...state, holdWin: true });
    const died = state.players.filter((p) => aliveBefore.has(p.id) && !next.players.find((q) => q.id === p.id)?.alive).map((p) => p.name);
    const list = [...((state.nightDeaths || {})[String(state.round)] || [])];
    for (const name of died) if (!list.includes(name)) list.push(name);
    next = {
      ...next,
      holdWin: true,
      nightDeaths: { ...(next.nightDeaths || {}), [String(state.round)]: list },
      publicNotices: tonightNotice(next.publicNotices, list),
    };
    return finishPhase(state, next);
  }
  if (state.phase === "lumination") {
    let next = resolveLumination(answerSelfKnownQuestion(state));
    if (!Object.keys(next.nominations || {}).length) next = { ...next, nominees: [] };
    return finishPhase(state, next);
  }
  if (state.phase === "dawnAccord") {
    let next = computeDawnBallot(state);
    if (state.automate === true) {
      const board = tallies(next);
      const max = board.length ? Math.max(...board.map((row) => row.votes)) : 0;
      const top = board.filter((row) => row.votes === max);
      if (max > 0 && top.length === 1 && top[0].id !== NO_EXEC) next = executeNominee(next, top[0].id);
      else if (board.length) next = executeNominee(next, NO_EXEC);
    } else {
      const choice = action.execute;
      if (!choice) throw new Error("Choose an execution, or no execution.");
      const id = choice === "NO_EXEC" || choice === "No execution" ? NO_EXEC : choice;
      next = executeNominee(next, id);
    }
    return finishPhase(state, closeDawnAccord(next));
  }
  throw new Error("There is nothing to resolve.");
}

function menuFor(state, player) {
  if (!player?.alive || state.winner) return [];
  const items = [];
  if (state.phase === "ashFall") {
    const moves = legalAshMoves(state, player);
    const groups = new Map();
    for (const move of moves) {
      const key = move.inherited ? "inheritedKill" : move.action;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(move);
    }
    for (const [key, group] of groups) {
      const allowSkip = group.some((m) => m.skip);
      const targets = [];
      const seen = new Set();
      for (const move of group) {
        if (move.skip || !move.target) continue;
        const person = state.players.find((p) => p.name === move.target);
        if (!person || seen.has(person.id)) continue;
        seen.add(person.id);
        targets.push({ id: person.id, name: person.name });
      }
      const two = key === "parallax" || key === "swap";
      items.push(lockedItem({
        id: key,
        ability: key,
        kind: two ? "targets2" : "target",
        label: labelFor(key),
        allowSkip,
        targets,
        pairs: two ? group.filter((m) => m.target && m.target2).slice(0, 40).map((m) => ({ target: m.target, target2: m.target2 })) : undefined,
      }, actionLocked(state, player, key), "Action submitted"));
    }
    if (player.syndShield) {
      items.push(player.syndShieldArmed
        ? { id: "syndShield", kind: "note", text: "Action submitted" }
        : { id: "syndShield", ability: "syndShield", kind: "button", label: "Raise your one-time syndicate shield" });
    }
  }
  if (state.phase === "lumination" && player.alive) {
    const moves = legalDayMoves(state, player);
    const byAction = new Map();
    for (const move of moves) {
      if (!byAction.has(move.action)) byAction.set(move.action, []);
      byAction.get(move.action).push(move);
    }
    for (const [key, group] of byAction) {
      if (key === "invite") {
        items.push({
          id: "invites",
          ability: "invites",
          kind: "multi",
          label: "Invite to the syndicate",
          targets: uniqueTargets(state, group),
        });
        continue;
      }
      if (key === "question") {
        items.push(lockedItem({
          id: "question",
          ability: "question",
          kind: "question",
          label: "Ask if a player holds a role",
          allowSkip: true,
          targets: uniqueTargets(state, group),
          roles: ROLES.map((r) => ({ id: r.id, name: r.name })),
        }, actionLocked(state, player, "question"), "Action submitted"));
        continue;
      }
      items.push(lockedItem({
        id: key === "dayKill" ? "scar" : key,
        ability: key,
        kind: key === "summon" ? "targets2" : "target",
        label: labelFor(key),
        allowSkip: group.some((m) => m.skip),
        targets: uniqueTargets(state, group, key === "summon"),
      }, actionLocked(state, player, key), "Action submitted"));
    }
  }
  if (state.phase === "dawnAccord") {
    if (player.alive) {
      items.push((state.nominations || {})[player.id]
        ? { id: "nomination", kind: "note", text: "Nomination submitted" }
        : {
          id: "nomination",
          kind: "target",
          label: "Nominate",
          targets: state.players.filter((p) => p.alive).map((p) => ({ id: p.id, name: p.name })),
        });
    }
    const options = (state.nominees || []).filter(Boolean).map((id) => ({
      id,
      name: id === NO_EXEC ? "No execution" : state.players.find((p) => p.id === id)?.name || id,
    }));
    if (player.alive) options.push({ id: "skip", name: "Skip" });
    else if (player.finalVoteAvailable) options.push({ id: "SAVE", name: "Save my final vote" });
    if (player.alive || player.finalVoteAvailable) {
      const cast = (state.votes || {})[player.id];
      items.push(cast
        ? { id: "vote", kind: "note", text: "Vote submitted" }
        : { id: "vote", kind: "vote", label: player.alive ? "Vote" : "Cast your final vote", targets: options });
    }
  }
  const invited = state.results.some((r) => r.playerId === player.id && r.text.startsWith("The Syndic has invited you") && !player.syndicateMember);
  if (invited && player.alive) items.push({ id: "invite", kind: "invite", label: "Syndicate invite", from: "The Syndic" });
  return items;
}

function uniqueTargets(state, group, dead = false) {
  const pool = dead ? state.players.filter((p) => !p.alive) : null;
  const names = new Set();
  for (const move of group) {
    if (move.target) names.add(move.target);
    if (move.target2) names.add(move.target2);
  }
  return [...names].map((name) => {
    const person = state.players.find((p) => p.name === name);
    return person ? { id: person.id, name: person.name } : null;
  }).filter(Boolean).concat(pool ? [] : []);
}

function labelFor(key) {
  const labels = {
    kill: "Night kill, or skip",
    inheritedKill: "Inherited kill, or skip",
    poison: "Poison a non-Ashen, or skip",
    shield: "Shield a player",
    check: "Night check",
    parallax: "Compare two players",
    swap: "Swap two other players",
    shot: "Declare a Sunmark shot",
    dayKill: "Secret day kill",
    summon: "Summon two Remnants",
    question: "Ask a question",
  };
  return labels[key] || key;
}

function publicPlayer(p) {
  return { id: p.id, name: p.name, alive: p.alive };
}

function rolePublic(role) {
  return { id: role.id, name: role.name, team: role.team, short: role.short, ability: role.ability };
}

export function viewFor(state, viewer, extras) {
  const catalogue = ROLES.map(rolePublic);
  const base = {
    phase: state.winner ? "ended" : state.phase,
    phaseLabel: state.winner ? "Ended" : state.dealt && state.phase === "setup" ? "Roles dealt" : phaseLabel(state.phase),
    round: state.round,
    dealt: state.dealt,
    nightOfPeace: state.nightOfPeace,
    winner: state.winner || null,
    winReason: state.winner ? winnerLabel(state.winner) : "",
    seats: state.dealt ? state.players.map(publicPlayer) : state.setupNames.map((name, i) => ({ id: "seat" + i, name, alive: true })),
    statements: extras.statements || [],
    nominations: Object.entries(state.nominations || {}).map(([by, target]) => ({
      byName: state.players.find((p) => p.id === by)?.name,
      targetName: state.players.find((p) => p.id === target)?.name,
    })),
    ballot: state.phase === "dawnAccord"
      ? (state.nominees || []).filter(Boolean).map((id) => ({ id, name: id === NO_EXEC ? "No execution" : state.players.find((p) => p.id === id)?.name || id }))
      : null,
    publicLog: (state.publicNotices || []).map((text, i) => ({ id: "pub" + i, text })),
    timer: presentTimer(state),
    recap: state.winner ? buildRecap(state) : undefined,
    catalogue,
    reveal: state.winner
      ? state.players.map((p) => ({ id: p.id, name: p.name, roleId: p.roleId, roleName: roleOf(p.roleId).name, alignment: p.team.toLowerCase(), alive: p.alive }))
      : null,
    code: extras.code,
    rulebook: rulebookFor(
      state.dealt ? state.players.length : state.setupNames.length,
      state.dealt ? state.dealtCounts || countTeams(state.players) : null,
    ),
    soulboundRequired: Boolean(state.dealt && soulboundRequired(state)),
    soulboundPlaced: Boolean(state.dealt && hasSoulboundPair(state)),
  };
  if (viewer.kind === "gm") {
    const cut = state.dealt ? cutoffInfo(state) : null;
    return {
      ...base,
      kind: "gm",
      settings: {
        cutoff: state.testCutoff75 === true,
        testCutoff75: state.testCutoff75 === true,
        atFalsePct: state.atFalsePct,
        unalignedPick: state.unalignedPick,
        ashenPick: state.ashenPick === 3 || state.ashenPick === 4 ? state.ashenPick : -1,
        unalignedWide: state.unalignedWide === 1 || state.unalignedWide === 2 ? state.unalignedWide : -1,
        designDefaults: state.designDefaults || {},
        automate: state.automate === true,
      },
      ashfallSummary: ashfallSummary(state),
      nightActions: nightSheet(state),
      nightProgress: nightProgress(state),
      intentLog: logBook(state).current,
      logArchive: logBook(state).archive,
      votes: voteRows(state),
      defaults: DESIGN_DEFAULTS,
      cutoff: cut,
      block: state.pendingParadoxFlip ? { type: "coin", name: state.players.find((p) => p.roleId === "the-luminary-paradox")?.name || "The Luminary Paradox" } : null,
      players: state.players.map((p) => ({
        ...publicPlayer(p),
        roleId: p.roleId,
        roleName: roleOf(p.roleId).name,
        alignment: p.team,
        ashTouched: p.ashTouched,
        poisoned: p.mireTouched,
        mireTouched: p.mireTouched,
        poisonCount: p.poisonCount,
        shield: p.shielded,
        voided: p.voteSilenced,
        syndicate: p.syndicateMember,
        soulboundWith: state.players.find((o) => o.id === p.soulboundWith)?.name || "",
        converted: p.roleId === "the-luminary-paradox" && state.paradoxConverted,
        holdsKill: state.successorId === p.id || (p.roleId === "the-ashen-tyrant" && !state.tyrantHasDied),
        echoCopy: state.echoCopyRoleId && p.roleId === "the-echo-thief" ? roleOf(state.echoCopyRoleId).name : "",
        charges: p.charges,
        gmNotes: p.gmNotes || "",
        gmMire: Boolean(p.gmMire),
        inbox: state.results.filter((r) => r.playerId === p.id).map((r) => ({ text: r.text })),
      })),
      log: state.log.map((l) => ({ id: l.id, text: l.text, secret: true })),
      chats: extras.chats,
      tallies: state.phase === "dawnAccord" ? tallies(state) : [],
      reminders: buildReminders(state),
      suggestedWinner: state.suggestedWinner || null,
      suggestedReason: state.suggestedReason || "",
    };
  }
  const self = state.players.find((p) => p.id === viewer.playerId);
  if (!self) {
    return {
      ...base,
      kind: "player",
      you: { id: viewer.playerId, name: viewer.name || "Player", alive: true, roleId: null, inbox: [], notes: "" },
      menu: [],
      chats: chatsFor(extras.chats, null, viewer),
      publicLog: playerPublicLog(state.publicNotices),
    };
  }
  const role = roleOf(self.roleId);
  const teammates = self.team === "Ashen" ? state.players.filter((p) => p.team === "Ashen" && p.id !== self.id).map((p) => p.name) : null;
  return {
    ...base,
    kind: "player",
    you: {
      id: self.id,
      name: self.name,
      alive: self.alive,
      roleId: self.roleId,
      roleName: role.name,
      alignment: self.team,
      ability: role.ability,
      short: role.short,
      charges: role.charged ? self.charges : null,
      summary: role.ability,
      inbox: scrubMindInbox(state, self),
      notes: self.notes || "",
      teammates,
      won: seatWon(state, self),
      echo: self.roleId === "the-echo-thief" ? (state.echoCopyRoleId ? roleOf(state.echoCopyRoleId).name : "") : null,
      effective: self.tempRoleId ? roleOf(self.tempRoleId).name : "",
    },
    menu: menuFor(state, self),
    mindList: self.roleId === "the-ashen-mind" ? mindRoster(state) : undefined,
    reveal: mindReveal(base.reveal, self, state),
    chats: chatsFor(extras.chats, self, viewer),
    publicLog: playerPublicLog(state.publicNotices),
  };
}

function mindReveal(reveal, self, state) {
  if (!reveal || self.roleId !== "the-ashen-mind") return reveal;
  const byId = new Map(mindRoster(state).map((row) => [row.id, row]));
  return reveal.map((row) => {
    const cover = byId.get(row.id);
    if (!cover) return row;
    return { ...row, roleId: cover.roleId, roleName: cover.roleName, alignment: roleOf(cover.roleId).team.toLowerCase() };
  });
}

function chatsFor(chats, self, viewer) {
  return (chats || []).filter((c) => {
    if (c.channel === "ashen") return false;
    if (c.channel !== "gm") return false;
    if (self && c.playerId === self.id) return true;
    if (!self && viewer.playerId && c.playerId === viewer.playerId) return true;
    if (viewer.name && c.seatName === viewer.name) return true;
    return false;
  });
}

function lockedItem(item, locked, text) {
  if (!locked) return item;
  return { id: item.id, kind: "note", text };
}

function phaseActions(state, player) {
  return (state.actions || []).filter((a) => a.playerId === player.id && a.round === state.round && a.phase === state.phase);
}

function actionLocked(state, player, kind) {
  const acts = phaseActions(state, player);
  if (kind === "inheritedKill") return acts.some((a) => a.label.includes("Inherited"));
  if (kind === "kill") return acts.some((a) => /kill/i.test(a.label) && !a.label.includes("Inherited") && !a.label.includes("Red Scar"));
  if (kind === "poison") return acts.some((a) => a.label.includes("Mirebane") || a.label.includes("poison"));
  if (kind === "shield") return acts.some((a) => a.label.includes("shield"));
  if (kind === "check") return acts.some((a) => /check|Warden|Eye|Failsafe|Silent Hand|Foresight/i.test(a.label));
  if (kind === "parallax") return acts.some((a) => a.label.includes("Parallax"));
  if (kind === "swap") return acts.some((a) => a.label.includes("swap") || a.label.includes("Catalyst"));
  if (kind === "question") return acts.some((a) => a.label.includes("Self Known"));
  if (kind === "shot") return acts.some((a) => a.label.includes("Sunmark shot"));
  if (kind === "dayKill" || kind === "scar") return acts.some((a) => a.label.includes("Red Scar"));
  if (kind === "summon") return acts.some((a) => a.label.toLowerCase().includes("summon"));
  if (kind === "syndShield") return Boolean(player.syndShieldArmed);
  return false;
}

function refreshBallot(state) {
  const counts = {};
  for (const player of state.players) {
    const target = (state.nominations || {})[player.id];
    if (!target) continue;
    const weight = nominationWeight(state, player);
    if (weight <= 0) continue;
    const person = state.players.find((p) => p.id === target);
    if (!person?.alive) continue;
    counts[target] = (counts[target] || 0) + weight;
  }
  const ranked = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
  let nominees = ranked.length <= 3 ? ranked.slice() : ranked.filter((id) => counts[id] >= counts[ranked[2]]);
  if (nominees.length < 3 && !nominees.includes(NO_EXEC)) nominees = nominees.concat([NO_EXEC]);
  return { ...state, nominees };
}

function personName(state, id) {
  return state.players.find((p) => p.id === id)?.name || "someone";
}

function plainAction(state, action) {
  const actor = state.players.find((p) => p.id === action.playerId);
  if (!actor) return action.label || "An action was submitted.";
  const who = `${actor.name} (${roleOf(actor.roleId).name})`;
  const names = (action.targets || []).map((id) => personName(state, id));
  if (action.skip) return `${who} is skipping.`;
  const label = action.label || "";
  if (label.includes("Integrity Warden")) return `${who} is checking whether ${names[0]} is Ash Touched or Mire Touched.`;
  if (label.includes("Foresight")) return `${who} is checking whether ${names[0]} is Lumen or Ashen. Unaligned players appear as Ashen.`;
  if (label.includes("Watching Eye")) return `${who} is checking whether ${names[0]} is the Ash Touched player.`;
  if (label.includes("Shadow Blade check")) return `${who} is checking whether ${names[0]} is The Ashen Tyrant.`;
  if (label.includes("Failsafe")) return `${who} is cancelling ${names[0]}'s ability.`;
  if (label.includes("Silent Hand")) return `${who} is silencing ${names[0]}'s vote.`;
  if (label.includes("Parallax")) return `${who} is comparing ${names[0]} and ${names[1]}.`;
  if (label.includes("Catalyst") || label.includes("swap")) return `${who} is swapping the abilities of ${names[0]} and ${names[1]}.`;
  if (label.includes("Mirebane") || label.includes("poison")) return `${who} is poisoning ${names[0]}.`;
  if (label.includes("shield")) return `${who} is shielding ${names[0]}.`;
  if (label.includes("Sunmark")) return `${who} is declaring a shot at ${names[0]}.`;
  if (label.includes("Red Scar")) return `${who} is using a secret day kill on ${names[0]}.`;
  if (label.includes("Self Known")) return `${who} is asking a private question${action.extra ? `: ${action.extra}` : ""}.`;
  if (label.toLowerCase().includes("summon")) return `${who} is summoning ${names[0]} and ${names[1]}.`;
  if (/kill/i.test(label)) return `${who} is marking ${names[0]} for a night kill.`;
  return `${who} submitted ${label}.`;
}

function projectAction(state, action) {
  if (action.skip) return "No effect from a skip.";
  const label = action.label || "";
  const target = state.players.find((p) => p.id === action.targets?.[0]);
  const kill = /kill/i.test(label) && target;
  if (kill && (target.roleId === "the-lumen-guard" || target.tempRoleId === "the-lumen-guard")) {
    return `${target.name} would not die. The Lumen Guard is immune to everything except execution.`;
  }
  if (kill && target.shielded) return `${target.name} is shielded, so this kill would not land.`;
  if (kill) return `${target.name} would die if nothing stops this kill.`;
  if ((label.includes("Mirebane") || label.includes("poison")) && target) {
    return `${target.name} would take a poison mark. Three successful poisons cause death on a later night.`;
  }
  if (label.includes("shield") && target) return `${target.name} would be shielded for this night and the following day.`;
  return "The private result is not applied until you resolve.";
}

function ashfallSummary(state) {
  if (!state.dealt || state.phase !== "ashFall") return null;
  const acts = (state.actions || []).filter((a) => a.round === state.round && a.phase === "ashFall");
  return {
    headline: "Ashfall summary. Nothing here has been applied.",
    lines: acts.map((a) => {
      const actor = state.players.find((p) => p.id === a.playerId);
      return {
        id: a.id,
        playerId: a.playerId,
        actorName: actor?.name || "Player",
        text: plainAction(state, a),
        projection: projectAction(state, a),
        playerNote: ownActionNote(state, actor, a),
      };
    }),
  };
}

function nightSheet(state) {
  if (state.phase !== "ashFall") return [];
  return (state.actions || []).filter((a) => a.round === state.round && a.phase === "ashFall").map((a) => {
    const actor = state.players.find((p) => p.id === a.playerId);
    return {
      id: a.id,
      playerId: a.playerId,
      playerName: actor?.name || "",
      roleName: actor ? roleOf(actor.roleId).name : "",
      plain: plainAction(state, a),
      skip: Boolean(a.skip),
      voided: Array.isArray(a.voidedTargets) && a.voidedTargets.length > 0,
      targets: a.targets || [],
    };
  });
}

function logBook(state) {
  const groups = new Map();
  for (const action of state.actions || []) {
    if (action.phase === "dawnAccord") continue;
    const key = `${action.round}:${action.phase}`;
    if (!groups.has(key)) groups.set(key, { round: action.round, phase: action.phase, lines: [] });
    groups.get(key).lines.push(plainAction(state, action));
  }
  for (const [round, died] of Object.entries(state.nightDeaths || {})) {
    const key = `${round}:ashFall`;
    if (!groups.has(key)) groups.set(key, { round: Number(round), phase: "ashFall", lines: [] });
    groups.get(key).lines.push(died.length ? "Died: " + died.join(", ") + "." : "Nobody died.");
  }
  for (const entry of state.gmPlainLog || []) {
    const key = `${entry.round}:${entry.phase}`;
    if (!groups.has(key)) groups.set(key, { round: Number(entry.round), phase: entry.phase, lines: [] });
    groups.get(key).lines.push(entry.text);
  }
  const order = { ashFall: 1, lumination: 2, dawnAccord: 3 };
  const title = { ashFall: "Ash Fall", lumination: "Lumination", dawnAccord: "Dawn Accord" };
  const currentKey = `${state.round}:${state.phase}`;
  const segments = [...groups.values()].sort((a, b) => b.round - a.round || (order[b.phase] || 0) - (order[a.phase] || 0));
  return {
    current: groups.get(currentKey)?.lines || [],
    archive: segments.filter((segment) => `${segment.round}:${segment.phase}` !== currentKey).map((segment) => ({
      id: `${segment.round}:${segment.phase}`,
      title: `${title[segment.phase] || segment.phase} ${segment.round}`,
      lines: segment.lines,
    })),
  };
}

function finishPhase(before, after) {
  const withDeaths = recordDeaths(before.players, after, before.phase, before.round);
  return { ...stampLeaving(before, withDeaths), phaseTimer: null };
}

function startPhaseTimer(state, minutes) {
  if (!state.dealt) throw new Error("Deal first.");
  if (state.gmEnded || state.winner) throw new Error("The game is over.");
  const length = Number(minutes);
  if (!Number.isFinite(length) || length <= 0 || length > 180) throw new Error("Choose a length in minutes.");
  const remainingMs = Math.round(length * 60 * 1000);
  return {
    ...state,
    phaseTimer: {
      phase: state.phase,
      round: state.round,
      status: "running",
      endsAt: Date.now() + remainingMs,
      remainingMs,
      durationMs: remainingMs,
    },
  };
}

function pausePhaseTimer(state) {
  const timer = activeTimer(state);
  if (!timer || timer.status !== "running") throw new Error("The timer is not running.");
  const remainingMs = Math.max(0, timer.endsAt - Date.now());
  return {
    ...state,
    phaseTimer: { ...timer, status: remainingMs === 0 ? "expired" : "paused", endsAt: null, remainingMs },
  };
}

function resumePhaseTimer(state) {
  const timer = activeTimer(state);
  if (!timer || timer.status !== "paused") throw new Error("The timer is not paused.");
  return {
    ...state,
    phaseTimer: { ...timer, status: "running", endsAt: Date.now() + timer.remainingMs },
  };
}

function addPhaseTimer(state, seconds) {
  const timer = activeTimer(state);
  if (!timer || (timer.status !== "running" && timer.status !== "paused")) throw new Error("Start a timer first.");
  const extra = Number(seconds) * 1000;
  if (!Number.isFinite(extra) || extra <= 0) throw new Error("Choose how much time to add.");
  const durationMs = (timer.durationMs || timer.remainingMs || 0) + extra;
  if (timer.status === "paused") {
    return { ...state, phaseTimer: { ...timer, remainingMs: timer.remainingMs + extra, durationMs } };
  }
  const endsAt = timer.endsAt + extra;
  return { ...state, phaseTimer: { ...timer, endsAt, durationMs, remainingMs: Math.max(0, endsAt - Date.now()) } };
}

function activeTimer(state) {
  const timer = state.phaseTimer;
  if (!timer || timer.phase !== state.phase || Number(timer.round) !== Number(state.round)) return null;
  return timer;
}

function presentTimer(state) {
  const timer = activeTimer(state);
  if (!timer) return null;
  const serverNow = Date.now();
  const durationMs = timer.durationMs || timer.remainingMs || 0;
  if (timer.status === "running") {
    const remainingMs = Math.max(0, (timer.endsAt || 0) - serverNow);
    return { status: remainingMs === 0 ? "expired" : "running", remainingMs, durationMs, serverNow };
  }
  if (timer.status === "expired") return { status: "expired", remainingMs: 0, durationMs, serverNow };
  return { status: "paused", remainingMs: Math.max(0, timer.remainingMs || 0), durationMs, serverNow };
}

function whenLabel(phase, round) {
  if (phase === "ashFall") return "Night " + round;
  if (phase === "lumination") return "Day " + round;
  if (phase === "dawnAccord") return "Dawn Accord " + round;
  if (phase === "setup") return "before the first night";
  return "Round " + round;
}

function classifyHow(reason) {
  const text = String(reason || "");
  if (/gm/i.test(text)) return "GM kill";
  if (/execution/i.test(text)) return "execution";
  if (/sunmark|secret day|day kill/i.test(text)) return "day kill";
  return "night kill";
}

function recordDeaths(beforePlayers, after, phase, round) {
  const prev = new Map((beforePlayers || []).map((player) => [player.id, player]));
  const obituary = (after.obituary || []).slice();
  const known = new Set(obituary.map((row) => row.id));
  const logs = (after.log || []).map((line) => line.text);
  for (const player of after.players || []) {
    const was = prev.get(player.id);
    if (!was?.alive || player.alive || known.has(player.id)) continue;
    const died = logs.find((text) => text.startsWith(player.name + " has died ("));
    const bound = logs.find((text) => text.startsWith(player.name + " dies with their Soulbound"));
    let how = phase === "dawnAccord" ? "execution" : phase === "lumination" ? "day kill" : "night kill";
    if (died) {
      const reason = died.slice((player.name + " has died (").length, died.lastIndexOf(")"));
      how = classifyHow(reason);
    } else if (bound) how = "Soulbound";
    obituary.push({ id: player.id, name: player.name, round, phase, when: whenLabel(phase, round), how });
  }
  return { ...after, obituary };
}

function phaseTitle(phase, round) {
  if (phase === "ashFall") return "Ash Fall " + round;
  if (phase === "lumination") return "Lumination " + round;
  if (phase === "dawnAccord") return "Dawn Accord " + round;
  if (phase === "setup") return "Before the first night";
  return (phase || "Phase") + " " + round;
}

function stampLeaving(before, after) {
  const id = `${before.round}:${before.phase}`;
  const chronicle = [...(before.chronicle || [])];
  if (!chronicle.some((segment) => segment.id === id)) {
    const lines = [];
    for (const action of (after.actions || []).filter((item) => item.round === before.round && item.phase === before.phase)) {
      lines.push(plainAction(after, action));
    }
    if (before.phase === "dawnAccord") {
      for (const [by, target] of Object.entries(before.nominations || {})) {
        lines.push(personName(before, by) + " nominated " + personName(before, target) + ".");
      }
      for (const [voter, choice] of Object.entries(before.votes || {})) {
        if (!choice || choice === "SAVE") continue;
        const choiceName = choice === NO_EXEC ? "no execution" : personName(before, choice);
        lines.push(personName(before, voter) + " voted for " + choiceName + ".");
      }
    }
    for (const entry of after.gmPlainLog || []) {
      if (Number(entry.round) === Number(before.round) && entry.phase === before.phase) lines.push(entry.text);
    }
    const deaths = (after.obituary || []).filter((row) => row.round === before.round && row.phase === before.phase);
    for (const death of deaths) lines.push(death.name + " died on " + death.when + " by " + death.how + ".");
    if (before.phase === "ashFall" && deaths.length === 0) lines.push("Nobody died.");
    if (lines.length) chronicle.push({ id, round: before.round, phase: before.phase, title: phaseTitle(before.phase, before.round), lines });
  }
  return { ...after, chronicle, phaseTimer: null };
}

function buildRecap(state) {
  const order = { setup: 0, ashFall: 1, lumination: 2, dawnAccord: 3 };
  const segments = [...(state.chronicle || [])].sort((a, b) => a.round - b.round || (order[a.phase] || 0) - (order[b.phase] || 0));
  return {
    result: winnerLabel(state.winner),
    winner: state.winner,
    players: state.players.map((player) => ({
      id: player.id,
      name: player.name,
      roleId: player.roleId,
      roleName: roleOf(player.roleId).name,
      alignment: player.team,
      alive: player.alive,
    })),
    deaths: (state.obituary || []).map((row) => ({ name: row.name, when: row.when, how: row.how })),
    segments: segments.map((segment) => ({ title: segment.title, lines: segment.lines })),
  };
}

function tonightNotice(notices, names) {
  const rest = (notices || []).filter((text) => !text.startsWith("Died tonight:") && !text.startsWith("Nobody died tonight."));
  const line = names.length ? "Died tonight: " + names.join(", ") + "." : "Nobody died tonight.";
  return rest.concat([line]);
}

function pushPlain(state, text) {
  const gmPlainLog = [...(state.gmPlainLog || []), { round: state.round || 0, phase: state.phase || "setup", text }];
  return addLog({ ...state, gmPlainLog }, text);
}

function mindRoster(state) {
  const inPlay = new Set(state.players.map((p) => p.roleId));
  const unclaimed = ROLES.map((role) => role.id).filter((id) => !inPlay.has(id)).sort();
  const masked = state.players.filter((p) => roleOf(p.roleId).masked).slice().sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const cover = {};
  masked.forEach((player, index) => {
    cover[player.id] = unclaimed[index % Math.max(unclaimed.length, 1)] || ROLES.find((role) => role.id !== player.roleId).id;
  });
  return state.players.map((player) => {
    const shown = cover[player.id] || player.roleId;
    return { id: player.id, name: player.name, alive: player.alive, roleId: shown, roleName: roleOf(shown).name };
  });
}

function scrubMindInbox(state, self) {
  const rows = state.results.filter((r) => r.playerId === self.id);
  if (self.roleId !== "the-ashen-mind") return rows.map((r) => ({ text: r.text }));
  const masked = state.players.filter((p) => roleOf(p.roleId).masked && p.id !== self.id);
  return rows.filter((row) => {
    if (row.text.startsWith("Start-of-round snapshot")) return false;
    return !masked.some((player) => row.text.includes(player.name) && row.text.includes(roleOf(player.roleId).name));
  }).map((row) => ({ text: row.text }));
}

function ownActionNote(state, actor, action) {
  if (!actor) return "Your night action is recorded.";
  const names = (action.targets || []).map((id) => personName(state, id));
  if (action.skip && (action.voidedTargets || []).length) return "The GM set aside your night action. It has no effect.";
  if (action.skip) return "You skipped your night action.";
  return "Your night action is recorded: " + (action.label || "your ability") + (names.length ? " on " + names.join(" and ") : "") + ".";
}

function playerPublicLog(notices) {
  return (notices || []).filter((text) =>
    text.startsWith("Died tonight:") ||
    text.startsWith("Nobody died tonight.") ||
    text.startsWith("Nominations:") ||
    text.startsWith("Votes:") ||
    text.startsWith("A Sunmark") ||
    text.startsWith("The shot") ||
    / has died\.$/.test(text)
  ).map((text, i) => ({ id: "pub" + i, text }));
}

function nightProgress(state) {
  if (state.phase !== "ashFall") return null;
  let expected = 0;
  let received = 0;
  for (const player of state.players) {
    if (!player.alive) continue;
    const kinds = new Set(legalAshMoves(state, player).map((move) => (move.inherited ? "inheritedKill" : move.action)));
    if (player.syndShield) kinds.add("syndShield");
    for (const kind of kinds) {
      expected += 1;
      if (actionLocked(state, player, kind)) received += 1;
    }
  }
  return { received, expected };
}

function voteRows(state) {
  return Object.entries(state.votes || {}).filter(([, choice]) => choice && choice !== "SAVE").map(([id, choice]) => ({
    name: personName(state, id),
    choice: choice === NO_EXEC ? "No execution" : choice === "skip" ? "Skip" : personName(state, choice),
  }));
}

function seatWon(state, self) {
  if (!state.winner) return false;
  if (state.winner === "lumen") return self.team === "Lumen";
  if (state.winner === "ashen") return self.team === "Ashen";
  if (state.winner === "shadow") return self.roleId === "the-shadow-blade";
  if (state.winner === "syndic") return self.alive && self.syndicateMember && self.team !== "Ashen";
  return false;
}

export { DESIGN_DEFAULTS, ROLES };
