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
  tallies,
  winnerLabel,
} from "../sim/dist/engine.js";
import { applyScriptAction, legalAshMoves, legalDayMoves } from "../sim/lib/actions.mjs";

export function freshTable() {
  return {
    ...blankState(),
    setupNames: [],
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
      if (state.setupNames.length >= 20) throw new Error("This table is full.");
      return { ...state, setupNames: state.setupNames.concat(name) };
    }
    case "reorder": {
      if (state.dealt) throw new Error("The seating is locked.");
      const names = state.setupNames.slice();
      const i = names.indexOf(action.name);
      const j = i + (action.dir === "up" ? -1 : 1);
      if (i < 0 || j < 0 || j >= names.length) return state;
      const swap = names[i];
      names[i] = names[j];
      names[j] = swap;
      return { ...state, setupNames: names };
    }
    case "settings": {
      if (state.dealt) throw new Error("Setup is locked once roles are dealt.");
      const next = { ...state };
      if (typeof action.cutoff === "boolean") next.testCutoff75 = action.cutoff;
      if (typeof action.testCutoff75 === "boolean") next.testCutoff75 = action.testCutoff75;
      if (typeof action.atFalsePct === "number") next.atFalsePct = Math.max(0, Math.min(100, Math.round(action.atFalsePct)));
      if (action.unalignedPick === -1 || action.unalignedPick === 0 || action.unalignedPick === 1) next.unalignedPick = action.unalignedPick;
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
      return next;
    }
    case "ash-touched": {
      if (!state.dealt) throw new Error("Deal first.");
      return setAshTouched(state, action.playerId || "");
    }
    case "soulbound": {
      if (!state.dealt) throw new Error("Deal first.");
      return setSoulboundPair(state, action.a, action.b);
    }
    case "start": {
      if (!state.dealt || state.phase !== "setup") throw new Error("Deal roles before the first Ash Fall.");
      return startRound(state, true);
    }
    case "submit":
      return submit(state, action);
    case "vote": {
      if (state.phase !== "dawnAccord") throw new Error("Voting is closed.");
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
      return advance(state);
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
    if (state.phase !== "lumination") throw new Error("You cannot nominate now.");
    return castNomination(state, player.id, action.targetId);
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
  if (script.action === "reveal" || script.action === "recruit-shield") {
    if (script.action === "recruit-shield") return applyScriptAction(state, { player: player.id, action: "syndShield", on: true });
    throw new Error("That action is not on this role's screen.");
  }
  if (script.action === "night") script.action = action.ability;
  return applyScriptAction(state, script);
}

function advance(state) {
  if (state.pendingParadoxFlip) throw new Error("Enter the Paradox coin first.");
  if (state.winner) throw new Error("The game is over.");
  if (state.phase === "setup") return startRound(state, true);
  if (state.phase === "ashFall") return resolveAshFall(state);
  if (state.phase === "lumination") return resolveLumination(answerSelfKnownQuestion(state));
  if (state.phase === "dawnAccord") {
    let next = computeDawnBallot(state);
    const board = tallies(next);
    const max = board.length ? Math.max(...board.map((row) => row.votes)) : 0;
    const top = board.filter((row) => row.votes === max);
    if (max > 0 && top.length === 1 && top[0].id !== NO_EXEC) next = executeNominee(next, top[0].id);
    else if (board.length) next = executeNominee(next, NO_EXEC);
    return closeDawnAccord(next);
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
      items.push({
        id: key,
        ability: key,
        kind: two ? "targets2" : "target",
        label: labelFor(key),
        allowSkip,
        targets: two ? targets : targets,
        pairs: two ? group.filter((m) => m.target && m.target2).slice(0, 40).map((m) => ({ target: m.target, target2: m.target2 })) : undefined,
      });
    }
    if (player.syndShield) items.push({ id: "syndShield", ability: "syndShield", kind: "button", label: "Raise your one-time syndicate shield" });
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
        items.push({
          id: "question",
          ability: "question",
          kind: "question",
          label: "Ask if a player holds a role",
          allowSkip: true,
          targets: uniqueTargets(state, group),
          roles: ROLES.map((r) => ({ id: r.id, name: r.name })),
        });
        continue;
      }
      items.push({
        id: key === "dayKill" ? "scar" : key,
        ability: key,
        kind: key === "summon" ? "targets2" : "target",
        label: labelFor(key),
        allowSkip: group.some((m) => m.skip),
        targets: uniqueTargets(state, group, key === "summon"),
      });
    }
    items.push({
      id: "nomination",
      kind: "target",
      label: "Nominate",
      targets: state.players.filter((p) => p.alive).map((p) => ({ id: p.id, name: p.name })),
    });
  }
  if (state.phase === "dawnAccord") {
    const options = (state.nominees || []).filter(Boolean).map((id) => ({
      id,
      name: id === NO_EXEC ? "No execution" : state.players.find((p) => p.id === id)?.name || id,
    }));
    if (player.alive) options.push({ id: "skip", name: "Skip" });
    else if (player.finalVoteAvailable) options.push({ id: "SAVE", name: "Save my final vote" });
    if (player.alive || player.finalVoteAvailable) {
      items.push({ id: "vote", kind: "vote", label: player.alive ? "Vote" : "Cast your final vote", targets: options });
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
    catalogue,
    reveal: state.winner
      ? state.players.map((p) => ({ id: p.id, name: p.name, roleId: p.roleId, roleName: roleOf(p.roleId).name, alignment: p.team.toLowerCase(), alive: p.alive }))
      : null,
    code: extras.code,
  };
  if (viewer.kind === "gm") {
    const cut = state.dealt ? cutoffInfo(state) : null;
    return {
      ...base,
      kind: "gm",
      agentKey: extras.agentKey,
      settings: {
        cutoff: state.testCutoff75 === true,
        testCutoff75: state.testCutoff75 === true,
        atFalsePct: state.atFalsePct,
        unalignedPick: state.unalignedPick,
        designDefaults: state.designDefaults || {},
      },
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
        inbox: state.results.filter((r) => r.playerId === p.id).map((r) => ({ text: r.text })),
      })),
      log: state.log.map((l) => ({ id: l.id, text: l.text, secret: true })),
      chats: extras.chats,
      tallies: state.phase === "dawnAccord" ? tallies(state) : [],
    };
  }
  const self = state.players.find((p) => p.id === viewer.playerId);
  if (!self) {
    return {
      ...base,
      kind: "player",
      you: { id: viewer.playerId, name: viewer.name || "Player", alive: true, roleId: null, inbox: [], notes: "" },
      menu: [],
      chats: extras.chats.filter((c) => c.channel === "gm" && c.playerId === viewer.playerId),
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
      inbox: state.results.filter((r) => r.playerId === self.id).map((r) => ({ text: r.text })),
      notes: self.notes || "",
      teammates,
      won: Boolean(state.winner) && (self.team === "Lumen" ? state.winner === "lumen" : self.team === "Ashen" ? state.winner === "ashen" : false),
      echo: self.roleId === "the-echo-thief" ? (state.echoCopyRoleId ? roleOf(state.echoCopyRoleId).name : "") : null,
      effective: self.tempRoleId ? roleOf(self.tempRoleId).name : "",
    },
    menu: menuFor(state, self),
    chats: extras.chats.filter((c) => (c.channel === "gm" && c.playerId === self.id) || (c.channel === "ashen" && self.team === "Ashen")),
  };
}

export { DESIGN_DEFAULTS, ROLES };
