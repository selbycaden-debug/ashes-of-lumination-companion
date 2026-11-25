import {
  livingPlayers,
  playerById,
  roleOf,
  ashKindFor,
  echoAshKind,
  hasInheritedKill,
  actionFor,
  submitPlayerAction,
  inviteToSyndicate,
  answerSyndicateInvite,
  armSyndicateShield,
  castNomination,
  nameOfFrom,
  NO_EXEC,
  ROLES,
} from "../dist/engine.js";
import { pick } from "./rng.mjs";

export function findPlayer(state, nameOrId) {
  if (!nameOrId) return undefined;
  return state.players.find((p) => p.id === nameOrId || p.name === nameOrId || p.roleId === nameOrId);
}

function others(state, p, { includeDead = false, includeSelf = false } = {}) {
  return (includeDead ? state.players : livingPlayers(state.players)).filter(
    (x) => (includeSelf || x.id !== p.id) && (includeDead || x.alive),
  );
}

function kindFor(state, p) {
  const k = ashKindFor(state, p);
  const e = echoAshKind(state, p);
  if (k && k !== "none" && k !== "auto") return k;
  if (e && e !== "none" && e !== "auto") return e;
  return "none";
}

function killLabel(state, p, inherited) {
  if (inherited) return "Inherited Tyrant kill";
  const k = kindFor(state, p);
  if (k === "shadowKill") return "Shadow Blade kill";
  if (k === "paradoxKill") return "Luminary Paradox kill";
  return "Ashen Tyrant kill";
}

const CHECK_LABEL = {
  checkAny: "Foresight Elder check",
  checkOther: "Integrity Warden check",
  watchingEye: "Watching Eye check",
  shadowCheck: "Shadow Blade check",
  cancelOther: "Failsafe cancel",
  silenceOther: "Silent Hand",
};

/** Charged uses submitted while the player holds no use (the app UI would not offer them). Reset per game. */
export const chargeNotes = [];
const SPENDING = { question: 1, shot: 1, dayKill: 1, summon: 1, lastShot: 1 };

/** Script/fuzz action -> submit on the real engine. */
export function applyScriptAction(state, act) {
  const p = findPlayer(state, act.player);
  if (!p) throw new Error("Unknown player in action: " + JSON.stringify(act));
  const k0 = act.action || act.type || "";
  if (SPENDING[k0] && !act.skip && p.charges <= 0) {
    chargeNotes.push({ round: state.round, phase: state.phase, player: p.name, action: k0, target: act.target || "", deaths: state.deathCount, usedAtDeaths: p.usedAtDeaths });
  }
  const target = act.target ? findPlayer(state, act.target) : undefined;
  const target2 = act.target2 ? findPlayer(state, act.target2) : undefined;
  const kind = act.action || act.type || "";
  if (kind === "nominate") {
    const t = target || (act.target ? undefined : undefined);
    if (!act.target) throw new Error(p.name + " nominate needs a target");
    const dest = findPlayer(state, act.target);
    if (!dest) throw new Error(p.name + " nominate: unknown " + act.target);
    return castNomination(state, p.id, dest.id);
  }

  if (kind === "skipKill" || ((kind === "kill" || kind === "inheritedKill") && (act.skip || act.target === "skip"))) {
    return submitPlayerAction(state, p, killLabel(state, p, act.inherited || kind === "inheritedKill"), [], true, "", "ashFall", false);
  }
  if (kind === "kill" || kind === "inheritedKill") {
    if (!target) throw new Error(p.name + " " + kind + " needs a target");
    return submitPlayerAction(state, p, killLabel(state, p, kind === "inheritedKill" || act.inherited), [target.id], false, "", "ashFall", false);
  }
  if (kind === "poison") {
    if (act.skip) return submitPlayerAction(state, p, "Mirebane poison", [], true, "", "ashFall", false);
    if (!target) throw new Error(p.name + " poison needs a target");
    return submitPlayerAction(state, p, "Mirebane poison", [target.id], false, "", "ashFall", false);
  }
  if (kind === "shield") {
    if (!target) throw new Error(p.name + " shield needs a target");
    return submitPlayerAction(state, p, "Vitality Overseer shield", [target.id], false, "", "ashFall", false);
  }
  if (kind === "check" || CHECK_LABEL[kind]) {
    const label =
      kind === "check"
        ? CHECK_LABEL[kindFor(state, p)] || "Foresight Elder check"
        : CHECK_LABEL[kind];
    if (!target) throw new Error(p.name + " check needs a target");
    return submitPlayerAction(state, p, label, [target.id], false, "", "ashFall", false);
  }
  if (kind === "parallax" || kind === "swap") {
    if (!target || !target2) throw new Error(p.name + " two-player action needs target and target2");
    const label = kind === "swap" || kindFor(state, p) === "twoOther" ? "Lucid Catalyst swap" : "Parallax check";
    return submitPlayerAction(state, p, label, [target.id, target2.id], false, "", "ashFall", false);
  }
  if (kind === "question") {
    if (act.skip) return submitPlayerAction(state, p, "Self Known question", [], true, "", "lumination", false);
    if (!target || !act.role) throw new Error(p.name + " question needs target and role");
    const role = ROLES.find((r) => r.id === act.role || r.name === act.role);
    if (!role) throw new Error("Unknown role in question: " + act.role);
    const extra = "Is " + target.name + " " + role.name + "?";
    return submitPlayerAction(state, p, "Self Known question", [target.id], false, extra, "lumination", true);
  }
  if (kind === "shot") {
    if (act.skip) return submitPlayerAction(state, p, "Sunmark shot", [], true, "", "lumination", false);
    if (!target) throw new Error(p.name + " shot needs a target");
    return submitPlayerAction(state, p, "Sunmark shot", [target.id], false, "", "lumination", true);
  }
  if (kind === "dayKill") {
    if (act.skip) return submitPlayerAction(state, p, "Red Scar day kill", [], true, "", "lumination", false);
    if (!target) throw new Error(p.name + " day kill needs a target");
    return submitPlayerAction(state, p, "Red Scar day kill", [target.id], false, "", "lumination", !act.skip);
  }
  if (kind === "invite") {
    if (!target) throw new Error(p.name + " invite needs a target");
    return inviteToSyndicate(state, p, target.id);
  }
  if (kind === "syndShield") {
    return armSyndicateShield(state, p.id, act.on !== false);
  }
  if (kind === "answerInvite") {
    return answerSyndicateInvite(state, p, Boolean(act.accept));
  }
  if (kind === "summon") {
    if (!target || !target2) throw new Error(p.name + " summon needs two Remnants");
    return submitPlayerAction(state, p, "Necroreclaimer summon", [target.id, target2.id], false, "", "lumination", true);
  }
  if (kind === "lastShot") {
    if (!target) throw new Error(p.name + " last shot needs a target");
    return submitPlayerAction(state, p, "Sunmark last shot", [target.id], false, "", "dawnAccord", true);
  }
  if (kind === "hold" || kind === "skipDay") {
    const day = roleOf(effectiveDay(state, p)).day;
    if (day === "question") return submitPlayerAction(state, p, "Self Known question", [], true, "", "lumination", false);
    if (day === "shot") return submitPlayerAction(state, p, "Sunmark shot", [], true, "", "lumination", false);
    if (day === "dayKill") return submitPlayerAction(state, p, "Red Scar day kill", [], true, "", "lumination", false);
    return state;
  }
  throw new Error("Unknown action kind: " + kind + " for " + p.name);
}

function effectiveDay(state, p) {
  const rid = p.tempRoleId || p.roleId;
  return roleOf(rid);
}

export function legalAshMoves(state, p) {
  if (!p.alive) return [];
  const moves = [];
  const k = kindFor(state, p);
  const living = livingPlayers(state.players);
  const oth = others(state, p);
  const selfOk = living;

  const addKill = (inherited) => {
    moves.push({ action: inherited ? "inheritedKill" : "kill", skip: true, inherited, player: p.name });
    for (const t of oth) moves.push({ action: inherited ? "inheritedKill" : "kill", target: t.name, inherited, player: p.name });
  };

  if (k === "killOrSkip" || k === "paradoxKill" || k === "shadowKill") addKill(false);
  if (hasInheritedKill(state, p) && k !== "killOrSkip") addKill(true);

  if (k === "poisonNonAshen") {
    moves.push({ action: "poison", skip: true, player: p.name });
    for (const t of oth.filter((x) => x.team !== "Ashen")) moves.push({ action: "poison", target: t.name, player: p.name });
  }
  if (k === "shieldAny") {
    for (const t of selfOk) moves.push({ action: "shield", target: t.name, player: p.name });
  }
  if (k === "checkAny" || k === "watchingEye") {
    // Confirmed: Eye and (Foresight) may include self; Parallax self is twoAny.
    for (const t of selfOk) moves.push({ action: "check", target: t.name, player: p.name });
  }
  if (k === "checkOther" || k === "shadowCheck" || k === "cancelOther" || k === "silenceOther") {
    for (const t of oth) moves.push({ action: "check", target: t.name, player: p.name });
  }
  if (k === "twoAny") {
    for (const a of selfOk) {
      for (const b of selfOk) {
        if (a.id === b.id) continue;
        moves.push({ action: "parallax", target: a.name, target2: b.name, player: p.name });
      }
    }
  }
  if (k === "twoOther") {
    for (const a of oth) {
      for (const b of oth) {
        if (a.id === b.id) continue;
        moves.push({ action: "swap", target: a.name, target2: b.name, player: p.name });
      }
    }
  }
  return moves;
}

export function legalDayMoves(state, p) {
  if (!p.alive || state.winner !== "") return [];
  const rid = p.tempRoleId || p.roleId;
  let day = roleOf(rid).day;
  if (p.roleId === "the-echo-thief" && state.echoCopyRoleId) day = roleOf(state.echoCopyRoleId).day;
  if (p.roleId === "the-luminary-paradox") day = "none";
  const moves = [];
  const oth = others(state, p);
  const selfOk = livingPlayers(state.players);
  const dead = state.players.filter((x) => !x.alive);
  if (day === "none") return moves;
  const charged = day === "question" || day === "shot" || day === "summon" || day === "dayKill";
  if (charged && p.charges <= 0) return moves;
  if (day === "question") {
    moves.push({ action: "question", skip: true, player: p.name });
    for (const t of selfOk) {
      for (const r of ROLES) moves.push({ action: "question", target: t.name, role: r.id, player: p.name });
    }
  }
  if (day === "shot") {
    moves.push({ action: "shot", skip: true, player: p.name });
    for (const t of oth) moves.push({ action: "shot", target: t.name, player: p.name });
  }
  if (day === "dayKill") {
    moves.push({ action: "dayKill", skip: true, player: p.name });
    for (const t of oth) moves.push({ action: "dayKill", target: t.name, player: p.name });
  }
  if (day === "invite") {
    for (const t of oth.filter((x) => !x.syndicateMember)) moves.push({ action: "invite", target: t.name, player: p.name });
  }
  if (day === "summon") {
    if (dead.length >= 2) {
      for (let i = 0; i < dead.length; i++) {
        for (let j = 0; j < dead.length; j++) {
          if (i === j) continue;
          moves.push({ action: "summon", target: dead[i].name, target2: dead[j].name, player: p.name });
        }
      }
    }
  }
  return moves;
}

export function pickFuzzAshAction(state, p) {
  const moves = legalAshMoves(state, p);
  return pick(moves);
}

export function pickFuzzDayAction(state, p) {
  const moves = legalDayMoves(state, p);
  // Questions explode combinatorially; shrink role list for fuzz.
  const trimmed = moves.filter((m) => m.action !== "question" || m.skip || Math.random() < 0.08);
  const pool = trimmed.length ? trimmed : moves.filter((m) => m.action !== "question" || m.skip);
  return pick(pool.length ? pool : moves);
}

export function pendingInvites(state) {
  return state.results.filter((r) => r.text.indexOf("The Syndic has invited you") === 0).map((r) => r.playerId);
}
