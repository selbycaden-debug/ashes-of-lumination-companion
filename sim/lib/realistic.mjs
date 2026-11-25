import { livingPlayers, playerById, roleOf, ashKindFor, nameOfFrom, NO_EXEC } from "../dist/engine.js";
import { pick } from "./rng.mjs";
import { legalAshMoves, legalDayMoves } from "./actions.mjs";

const INFO_ROLES = new Set([
  "the-foresight-elder",
  "the-last-witness",
  "the-watching-eye",
  "the-parallax",
  "the-integrity-warden",
  "the-lumen-bearer",
  "the-quadrant-judge",
  "the-self-known",
  "voice-of-the-accord",
]);

const CONFIRMED_VALUE = {
  "sunmark-shooter": 4,
  "voice-of-the-accord": 4,
  "the-vitality-overseer": 3,
  "the-foresight-elder": 3,
  "the-last-witness": 3,
  "the-integrity-warden": 3,
  "the-parallax": 3,
  "the-lumen-bearer": 2,
  "the-watching-eye": 3,
  "the-self-known": 2,
  "the-quadrant-judge": 2,
  "the-silent-hand": 2,
};

function ashenTeam(p) {
  return p && p.team === "Ashen";
}

function isTeammate(a, b) {
  return a && b && a.id !== b.id && a.team === "Ashen" && b.team === "Ashen";
}

function addUnique(arr, name) {
  if (name && arr.indexOf(name) < 0) arr.push(name);
}

function resultKey(r) {
  return String(r.playerId || r.player || "") + ":" + String(r.round) + ":" + String(r.text || "");
}

/** The single name Lumen should currently pile onto, if any. */
export function primeSuspect(state, intel) {
  const livingNames = livingPlayers(state.players).map((p) => p.name);
  const suspected = (intel.ashenSuspected || []).filter((n) => livingNames.indexOf(n) >= 0);
  if (!suspected.length) return null;
  return suspected[0];
}

function lumenValue(p, intel) {
  if (!p || !p.alive) return 0;
  if ((intel.ashenSuspected || []).indexOf(p.name) >= 0) return -2;
  if ((intel.revealedLumen || []).indexOf(p.name) >= 0) return 10 + (CONFIRMED_VALUE[p.roleId] || 1);
  if ((intel.claimed || []).indexOf(p.name) >= 0 && (intel.fakeClaimed || []).indexOf(p.name) < 0) return 5;
  if ((intel.claimed || []).indexOf(p.name) >= 0) return 2;
  if (INFO_ROLES.has(p.roleId)) return 3;
  return 0;
}

/** Prefer kills that are not Ashen teammates. Blade after takeover hunts anyone else. */
export function pickRealisticAshAction(state, p, intel) {
  const moves = legalAshMoves(state, p);
  if (!moves.length) return null;
  const kills = moves.filter((m) => m.action === "kill" || m.action === "inheritedKill");
  if (kills.length) {
    const marks = kills.filter((m) => !m.skip && m.target);
    const hunt = state.shadowTakeover || p.roleId === "the-shadow-blade" && state.shadowTakeover;
    const safe = marks.filter((m) => {
      const t = state.players.find((x) => x.name === m.target);
      if (!t) return false;
      if (hunt) return t.id !== p.id;
      return !isTeammate(p, t);
    });
    // Prefer revealed Lumen, then claimed info, then anyone non-team
    const ranked = safe.slice().sort((a, b) => {
      const ta = state.players.find((x) => x.name === a.target);
      const tb = state.players.find((x) => x.name === b.target);
      return lumenValue(tb, intel) - lumenValue(ta, intel);
    });
    const skip = kills.find((m) => m.skip);
    if (ranked.length) {
      const topVal = lumenValue(state.players.find((x) => x.name === ranked[0].target), intel);
      const top = ranked.filter((m) => lumenValue(state.players.find((x) => x.name === m.target), intel) === topVal);
      return pick(top);
    }
    if (safe.length) return pick(safe);
    return skip || pick(kills);
  }
  if (moves.some((m) => m.action === "shield")) {
    const shieldMoves = moves.filter((m) => m.action === "shield" && m.target);
    const scored = shieldMoves
      .map((m) => ({ m, t: state.players.find((x) => x.name === m.target), v: lumenValue(state.players.find((x) => x.name === m.target), intel) }))
      .filter((x) => x.t);
    scored.sort((a, b) => b.v - a.v);
    if (scored.length && scored[0].v > 0) {
      const best = scored[0].v;
      return pick(scored.filter((x) => x.v === best).map((x) => x.m));
    }
    const self = moves.find((m) => m.action === "shield" && m.target === p.name);
    if (self) return self;
  }
  if (p.team === "Lumen") {
    const trusted = (n) => n === p.name || (intel.cleared || []).indexOf(n) >= 0 || (intel.revealedLumen || []).indexOf(n) >= 0;
    const better = moves.filter((m) => !m.skip && m.target && !trusted(m.target) && (!m.target2 || !trusted(m.target2) || true));
    if (better.length && Math.random() < 0.85) return pick(better);
  }
  return pick(moves);
}

export function pickRealisticDayAction(state, p, intel) {
  const moves = legalDayMoves(state, p);
  if (!moves.length) return null;
  const prime = primeSuspect(state, intel);
  if (p.roleId === "the-red-scar") {
    const marks = moves.filter((m) => m.action === "dayKill" && m.target);
    const safe = marks.filter((m) => {
      const t = state.players.find((x) => x.name === m.target);
      return t && !isTeammate(p, t);
    });
    const valuable = safe.filter((m) => lumenValue(state.players.find((x) => x.name === m.target), intel) >= 5);
    const pool = valuable.length ? valuable : safe;
    if (pool.length && Math.random() < 0.6) return pick(pool);
    const skip = moves.find((m) => m.action === "dayKill" && m.skip);
    return skip || pick(moves);
  }
  if (p.roleId === "sunmark-shooter") {
    const marks = moves.filter((m) => m.action === "shot" && m.target);
    const suspects = marks.filter((m) => (intel.ashenSuspected || []).includes(m.target));
    const primeShot = prime ? marks.find((m) => m.target === prime) : null;
    if (primeShot && Math.random() < 0.8) return primeShot;
    if (suspects.length && Math.random() < 0.7) return pick(suspects);
    const skip = moves.find((m) => m.action === "shot" && m.skip);
    if (skip && Math.random() < 0.45) return skip;
    return skip || pick(moves);
  }
  const trimmed = moves.filter((m) => m.action !== "question" || m.skip || Math.random() < 0.12);
  return pick(trimmed.length ? trimmed : moves);
}

export function pickRealisticNomination(state, p, intel) {
  const living = livingPlayers(state.players).filter((x) => x.id !== p.id);
  if (!living.length) return null;
  const prime = primeSuspect(state, intel);
  const suspected = living.filter((x) => (intel.ashenSuspected || []).includes(x.name));
  if (ashenTeam(p)) {
    // Sometimes bus a teammate already under suspicion, otherwise aim at valuable Lumen
    const teamSus = living.filter((x) => isTeammate(p, x) && (intel.ashenSuspected || []).includes(x.name));
    if (teamSus.length && Math.random() < 0.25) return pick(teamSus).id;
    const lumenish = living.filter((x) => !isTeammate(p, x) && x.team !== "Ashen");
    const valuable = lumenish.filter((x) => lumenValue(x, intel) >= 5);
    const pool = valuable.length && Math.random() < 0.55 ? valuable : (lumenish.length ? lumenish : living);
    return pick(pool).id;
  }
  // Lumen (and Unaligned, including a pre-takeover Blade blending in): coordinate on the prime Ashen read
  if (prime && Math.random() < 0.88) {
    const t = living.find((x) => x.name === prime);
    if (t) return t.id;
  }
  if (suspected.length && Math.random() < 0.8) return pick(suspected).id;
  const trusted = (n) => (intel.cleared || []).indexOf(n) >= 0 || (intel.revealedLumen || []).indexOf(n) >= 0;
  const open = living.filter((x) => !trusted(x.name) || (intel.fakeClaimed || []).indexOf(x.name) >= 0);
  return pick(open.length ? open : living).id;
}

export function pickRealisticVote(state, p, intel) {
  const noms = (state.nominees || []).filter((id) => id);
  if (!noms.length) return null;
  const named = noms.filter((id) => id !== NO_EXEC && id !== "NO_EXEC");
  const prime = primeSuspect(state, intel);
  const primeId = prime ? (named.map((id) => playerById(state.players, id)).find((t) => t && t.name === prime) || {}).id : null;
  const suspected = named.filter((id) => {
    const t = playerById(state.players, id);
    return t && (intel.ashenSuspected || []).includes(t.name);
  });
  if (!p.alive) {
    if (Math.random() < 0.22) return "SAVE";
    if (primeId && Math.random() < 0.7) return primeId;
    if (suspected.length) return pick(suspected);
    return pick(noms);
  }
  if (ashenTeam(p)) {
    const selfOn = named.filter((id) => id === p.id);
    const teamOn = named.filter((id) => {
      const t = playerById(state.players, id);
      return t && isTeammate(p, t);
    });
    if ((selfOn.length || teamOn.length) && noms.indexOf(NO_EXEC) >= 0 && Math.random() < 0.55) return NO_EXEC;
    const notTeam = named.filter((id) => {
      const t = playerById(state.players, id);
      return t && !isTeammate(p, t) && t.id !== p.id;
    });
    if (notTeam.length) return pick(notTeam);
    if (noms.indexOf(NO_EXEC) >= 0 && Math.random() < 0.5) return NO_EXEC;
    return pick(noms);
  }
  // Lumen coordinate: vote the prime Ashen read if that person is on the ballot
  if (primeId && Math.random() < 0.92) return primeId;
  if (suspected.length && Math.random() < 0.85) return pick(suspected);
  const trustedId = (id) => { const t = playerById(state.players, id); return t && ((intel.cleared || []).indexOf(t.name) >= 0 || (intel.revealedLumen || []).indexOf(t.name) >= 0); };
  const untrusted = named.filter((id) => !trustedId(id));
  if (untrusted.length) return pick(untrusted);
  // Stall fix (Nov 18): a "cleared" read can be false (Mire Touched / Ash Touched info). If a named player drew nominations
  // from at least half the living table and is not a revealed Lumen, the table distrusts that clear and votes them anyway.
  const nomCount = {};
  for (const v of Object.values(state.nominations || {})) nomCount[v] = (nomCount[v] || 0) + 1;
  const livingN = livingPlayers(state.players).length;
  const contested = named.filter((id) => { const t = playerById(state.players, id); return t && t.id !== p.id && (nomCount[id] || 0) * 2 >= livingN && (intel.revealedLumen || []).indexOf(t.name) < 0; });
  if (contested.length && Math.random() < 0.7) return pick(contested);
  if (noms.indexOf(NO_EXEC) >= 0) return NO_EXEC;
  if (named.length) return pick(named);
  return pick(noms);
}

function absorbShare(next, state, text, owner) {
  if (!text) return;
  const ash = text.match(/^(.+?) appears Ashen/);
  if (ash) addUnique(next.ashenSuspected, ash[1].trim());
  const lum = text.match(/^(.+?) appears Lumen/);
  if (lum) addUnique(next.cleared, lum[1].trim());
  const tyrYes = text.match(/^(.+?) is The Ashen Tyrant/) || text.match(/The Ashen Tyrant is ([^.]+)\./);
  if (tyrYes) { const nm = tyrYes[1].trim(); const i = next.ashenSuspected.indexOf(nm); if (i >= 0) next.ashenSuspected.splice(i, 1); next.ashenSuspected.unshift(nm); }
  const wasAshen = text.indexOf("was The Ashen") >= 0 || text.indexOf("was The Red Scar") >= 0 || text.indexOf("was The Shadow") >= 0;
  if (wasAshen && state.lastExecutedName) addUnique(next.ashenSuspected, state.lastExecutedName);
  // FIX: an Ash Touched condition marks a (usually Lumen) player whose info may be false; it is not an Ashen read.
  // Parallax / Bearer: if one name is a known Lumen and they are "not the same", the other is a suspect
  const paraNot = text.match(/^(.+?) and (.+?) are not on the same team/);
  if (paraNot) {
    const a = paraNot[1].trim();
    const b = paraNot[2].trim();
    const aCleared = next.cleared.indexOf(a) >= 0 || next.revealedLumen.indexOf(a) >= 0;
    const bCleared = next.cleared.indexOf(b) >= 0 || next.revealedLumen.indexOf(b) >= 0;
    if (aCleared && !bCleared) addUnique(next.ashenSuspected, b);
    if (bCleared && !aCleared) addUnique(next.ashenSuspected, a);
  }
  const quad = text.match(/These four players include exactly one Ashen: ([^.]+)\./);
  if (quad) {
    const four = quad[1].split(",").map((x) => x.trim());
    const unclear = four.filter((n) => next.cleared.indexOf(n) < 0 && next.revealedLumen.indexOf(n) < 0);
    if (unclear.length === 1) addUnique(next.ashenSuspected, unclear[0]);
  }
  const bearerNo = text.match(/Your neighbors \((.+) and (.+)\) do not share alignment/);
  if (bearerNo && owner) {
    // weaker: don't auto-suspect both neighbors
  }
}

/** Pull public / would-be-claimed Ashen reads into intel. Shares use the result the role actually received (already inverted if Ash Touched or poisoned). */
export function updateIntel(state, intel) {
  const next = {
    claimed: (intel.claimed || []).slice(),
    revealedLumen: (intel.revealedLumen || []).slice(),
    ashenSuspected: (intel.ashenSuspected || []).slice(),
    cleared: (intel.cleared || []).slice(),
    fakeClaimed: (intel.fakeClaimed || []).slice(),
    sharedKeys: (intel.sharedKeys || []).slice(),
  };

  for (const notice of state.publicNotices || []) {
    const lv = notice.match(/Last vision[—\-: ].*?([A-Za-z0-9]+) appears Ashen/i) || notice.match(/Last vision — ([^.]+?) appears Ashen/);
    if (lv) addUnique(next.ashenSuspected, lv[1].trim());
    const miss = notice.match(/The shot missed|The shot did not kill/);
    // shot declarations don't name a confirmed team
  }

  for (const r of state.results || []) {
    const owner = playerById(state.players, r.playerId);
    if (!owner) continue;
    const key = resultKey(r);
    const isInfo = INFO_ROLES.has(owner.roleId);
    // Lumen info roles publicly share the result they received almost always (the fool chance is already in a false result)
    const hitText = /appears Ashen|Ashen Tyrant is|is The Ashen Tyrant|not on the same team|on the Ashen team|— Yes/.test(String(r.text || ""));
    const shouldShare = isInfo && owner.team === "Lumen" && next.sharedKeys.indexOf(key) < 0 && Math.random() < (hitText || !owner.alive ? 0.95 : 0.45);
    if (shouldShare) {
      next.sharedKeys.push(key);
      addUnique(next.claimed, owner.name);
      addUnique(next.revealedLumen, owner.name);
      absorbShare(next, state, r.text, owner);
    }
  }

  // Ashen sometimes fake-claim a Lumen information role (sticky, once)
  for (const p of livingPlayers(state.players)) {
    if (!ashenTeam(p)) continue;
    if (next.fakeClaimed.indexOf(p.name) >= 0 || next.claimed.indexOf(p.name) >= 0) continue;
    if (Math.random() < 0.35) {
      addUnique(next.fakeClaimed, p.name);
      addUnique(next.claimed, p.name);
    }
  }

  // Un-suspect the dead only if they already died? Keep history of living suspects; dead names stay but primeSuspect filters living.
  return next;
}

export function emptyIntel() {
  return { claimed: [], revealedLumen: [], ashenSuspected: [], cleared: [], fakeClaimed: [], sharedKeys: [] };
}

void nameOfFrom;
void roleOf;
void ashKindFor;
void NO_EXEC;
