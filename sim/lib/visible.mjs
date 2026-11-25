import {
  livingPlayers,
  roleOf,
  nameOfFrom,
  phaseLabel,
  winnerLabel,
  actionFor,
  ashKindFor,
  echoAshKind,
  hasInheritedKill,
  tallies,
  voteWeight,
  effectiveRoleId,
} from "../dist/engine.js";

const ROLE_NAME = (id) => roleOf(id).name;

function allRolesPublic() {
  const teams = ["Lumen", "Ashen", "Unaligned"];
  // imported ROLES via roleOf isn't a list; caller can pass or we import ROLES
}

export function visibleForPlayer(state, playerId, ROLES) {
  const p = state.players.find((x) => x.id === playerId);
  if (!p) return { error: "unknown player" };
  const living = livingPlayers(state.players).map((x) => x.name);
  const dead = state.players.filter((x) => !x.alive).map((x) => x.name);
  const results = state.results.filter((r) => r.playerId === p.id).map((r) => ({
    round: r.round,
    text: r.text,
  }));
  const teammates =
    p.team === "Ashen"
      ? state.players.filter((x) => x.team === "Ashen" && x.id !== p.id).map((x) => x.name)
      : undefined;
  const groups = ["Lumen", "Ashen", "Unaligned"].map((team) => ({
    team,
    roles: ROLES.filter((r) => r.team === team).map((r) => ({ name: r.name, short: r.short })),
  }));
  const nominees = (state.nominees || []).filter((id) => id).map((id) => nameOfFrom(state, id));
  return {
    viewer: p.name,
    viewerId: p.id,
    alive: p.alive,
    phase: phaseLabel(state.phase),
    phaseId: state.phase,
    round: state.round,
    winner: state.winner ? winnerLabel(state.winner) : "",
    publicNotices: state.publicNotices.slice(),
    living,
    remnants: dead,
    ownRole: {
      name: ROLE_NAME(p.roleId),
      team: p.team,
      charges: p.charges,
      effectiveRole: ROLE_NAME(effectiveRoleId(p)),
    },
    ashenTeammates: teammates,
    syndicateMemberSelf: p.syndicateMember || undefined,
    results,
    allRoles: groups,
    submittedAshFall: actionFor(state, p.id, "ashFall") || null,
    submittedLumination: actionFor(state, p.id, "lumination") || null,
    nominees: state.phase === "dawnAccord" ? nominees : [],
    myVote: state.votes[p.id] ? nameOfFrom(state, state.votes[p.id]) : "",
  };
}

export function visibleForGm(state) {
  const living = livingPlayers(state.players);
  return {
    viewer: "GM",
    phase: phaseLabel(state.phase),
    phaseId: state.phase,
    round: state.round,
    winner: state.winner ? winnerLabel(state.winner) : "",
    publicNotices: state.publicNotices.slice(),
    players: state.players.map((p) => ({
      name: p.name,
      role: ROLE_NAME(p.roleId),
      team: p.team,
      alive: p.alive,
      charges: p.charges,
      ashTouched: p.ashTouched,
      mireTouched: p.mireTouched,
      poisonCount: p.poisonCount,
      shielded: p.shielded,
      syndicateMember: p.syndicateMember,
      voteSilenced: p.voteSilenced,
      tempRole: p.tempRoleId ? ROLE_NAME(p.tempRoleId) : "",
    })),
    actions: state.actions.filter((a) => a.round === state.round),
    log: state.log.map((l) => l.text),
    results: state.results.map((r) => ({
      player: nameOfFrom(state, r.playerId),
      round: r.round,
      text: r.text,
    })),
    nominees: (state.nominees || []).filter((id) => id).map((id) => nameOfFrom(state, id)),
    tallies: state.phase === "dawnAccord" ? tallies(state) : [],
    votes: Object.entries(state.votes).map(([id, choice]) => ({
      from: nameOfFrom(state, id),
      for: nameOfFrom(state, choice),
      weight: voteWeight(state, state.players.find((p) => p.id === id) || { alive: false, finalVoteAvailable: false, voteSilenced: false, roleId: "", id }),
    })),
    flags: {
      nightOfPeace: state.nightOfPeace,
      tyrantHasDied: state.tyrantHasDied,
      successor: state.successorId ? nameOfFrom(state, state.successorId) : "",
      shadowTakeover: state.shadowTakeover,
      pendingParadoxFlip: state.pendingParadoxFlip,
      paradoxConverted: state.paradoxConverted,
      summoned: state.summonedIds.map((id) => nameOfFrom(state, id)),
    },
    waitingOnAsh: living.filter((p) => {
      const k = ashKindFor(state, p);
      const e = echoAshKind(state, p);
      const need = hasInheritedKill(state, p) || (k !== "none" && k !== "auto") || (e !== "none" && e !== "auto");
      return state.phase === "ashFall" && need && !actionFor(state, p.id, "ashFall") && !actionFor(state, p.id, "ashFall");
    }).map((p) => p.name),
  };
}

export function snapshotAfterPhase(state, ROLES) {
  return {
    phase: state.phase,
    round: state.round,
    winner: state.winner,
    log: state.log.map((l) => l.text),
    results: state.results.map((r) => ({
      player: nameOfFrom(state, r.playerId),
      round: r.round,
      text: r.text,
    })),
    gm: visibleForGm(state),
    players: state.players.map((p) => visibleForPlayer(state, p.id, ROLES)),
  };
}
