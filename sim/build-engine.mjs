import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const require = createRequire(path.join(ROOT, "package.json"));
const SRC = path.resolve(ROOT, "local-render/canvas-source.tsx");
const GEN = path.join(__dirname, ".generated/canvas-source.tsx");
const OUT = path.join(__dirname, "dist/engine.js");
const STUB = path.resolve(ROOT, "local-render/grok-canvas-stub.ts");
const ESBUILD = path.join(path.dirname(require.resolve("esbuild/package.json")), "bin", "esbuild");
const REACT = path.dirname(require.resolve("react/package.json"));

const EXPORTS = [
  "ROLES",
  "SAMPLE_NAMES",
  "blankState",
  "applyDeal",
  "applyForcedDeal",
  "dealRoles",
  "setupStartInfo",
  "startRound",
  "resolveAshFall",
  "resolveLumination",
  "executePlayer",
  "executeNominee",
  "closeDawnAccord",
  "submitPlayerAction",
  "inviteToSyndicate",
  "answerSyndicateInvite",
  "castPlayerVote",
  "setDawnNominees",
  "castNomination",
  "computeDawnBallot",
  "nominationWeight",
  "NO_EXEC",
  "enterParadoxFlip",
  "answerSelfKnownQuestion",
  "checkWins",
  "livingPlayers",
  "playerById",
  "roleOf",
  "ashKindFor",
  "echoAshKind",
  "hasInheritedKill",
  "actionFor",
  "playerNeedsAshAction",
  "voteWeight",
  "tallies",
  "nameOfFrom",
  "phaseLabel",
  "winnerLabel",
  "effectiveRoleId",
  "ashenCount",
  "unalignedCount",
  "startingCharges",
  "distributionLabel",
  "buildAhsokaUpdate",
  "buildReminders",
  "armSyndicateShield",
  "setAshTouched",
  "setSoulboundPair",
  "suggestSoulboundPair",
  "nextTyrantSuccessor",
  "soulboundRequired",
  "hasSoulboundPair",
  "cutoffApplies",
  "cutoffInfo",
  "cutoffKillHolder",
  "deadVoteInfo",
  "canEchoCopy",
  "setAtOverride",
  "infoLies",
  "atOverrideKey",
  "addLog",
  "addResult",
  "uid",
  "lumenRolePool",
  "DESIGN_DEFAULTS",
];

const src = fs.readFileSync(SRC, "utf8");
const missing = EXPORTS.filter((n) => !new RegExp("(?:function|const) " + n + "\\b").test(src));
if (missing.length) {
  console.error("Missing in canvas-source.tsx:", missing.join(", "));
  process.exit(1);
}
fs.mkdirSync(path.dirname(GEN), { recursive: true });
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(GEN, src + "\n\nexport {\n  " + EXPORTS.join(",\n  ") + ",\n};\n");

execFileSync(
  ESBUILD,
  [
    GEN,
    "--bundle",
    "--format=esm",
    "--platform=node",
    "--jsx=automatic",
    "--alias:grok/canvas=" + STUB,
    "--alias:react=" + REACT,
    "--alias:react/jsx-runtime=" + require.resolve("react/jsx-runtime"),
    "--alias:react/jsx-dev-runtime=" + require.resolve("react/jsx-dev-runtime"),
    "--outfile=" + OUT,
    "--log-level=warning",
  ],
  { stdio: "inherit" },
);
console.log("wrote", OUT, fs.statSync(OUT).size, "bytes");
