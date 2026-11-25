#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runGame, toMarkdown } from "./lib/run-game.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function usage() {
  console.log(`Usage:
  node run.mjs build                  Rebuild the engine from canvas-source.tsx
  node run.mjs script <file.json>     Replay a scripted game
  node run.mjs fuzz --n 8 --seed 1    One random game
  node run.mjs fuzz-batch --count 50 --min 5 --max 20 --seed 100
  node run.mjs realistic --n 8 --seed 1
  node run.mjs realistic-batch --n 8 --count 20 --seed 200
`);
}

function outDir() {
  const d = path.join(__dirname, "out");
  fs.mkdirSync(d, { recursive: true });
  return d;
}

function writeResult(result, tag) {
  const dir = outDir();
  const base = path.join(dir, tag);
  fs.writeFileSync(base + ".json", JSON.stringify(result, (k, v) => (k === "state" ? undefined : v), 2));
  fs.writeFileSync(base + ".md", toMarkdown(result));
  // compact state dump separately
  if (result.state) {
    const compact = {
      phase: result.state.phase,
      round: result.state.round,
      winner: result.state.winner,
      players: result.state.players,
      log: result.state.log,
      results: result.state.results,
    };
    fs.writeFileSync(base + ".state.json", JSON.stringify(compact, null, 2));
  }
  return base;
}

function summarize(result) {
  const high = (result.issues || []).filter((i) => i.severity === "critical" || i.severity === "high");
  const uniqHigh = new Set(high.map((i) => i.code));
  return {
    name: result.name,
    seed: result.seed,
    winner: result.winner || "",
    rounds: result.rounds,
    crashed: Boolean(result.crashed),
    issueCount: (result.issues || []).length,
    highCodes: [...uniqHigh],
    mismatchCount: (result.mismatches || []).length,
    supersededCount: (result.superseded || []).length,
  };
}

const args = process.argv.slice(2);
const cmd = args[0];
if (!cmd || cmd === "-h" || cmd === "--help") {
  usage();
  process.exit(cmd ? 0 : 1);
}

if (cmd === "build") {
  const { spawnSync } = await import("node:child_process");
  const r = spawnSync(process.execPath, [path.join(__dirname, "build-engine.mjs")], { stdio: "inherit" });
  process.exit(r.status || 0);
}

function flag(name, fallback) {
  const i = args.indexOf("--" + name);
  if (i < 0 || args[i + 1] === undefined) return fallback;
  return args[i + 1];
}

if (cmd === "script") {
  const file = args[1];
  if (!file) {
    usage();
    process.exit(1);
  }
  const script = JSON.parse(fs.readFileSync(file, "utf8"));
  const result = runGame(script);
  const tag = script.name || path.basename(file, ".json");
  const base = writeResult(result, tag);
  console.log(JSON.stringify(summarize(result), null, 2));
  if (result.superseded && result.superseded.length) {
    console.log("SUPERSEDED (CADEN ruling, not counted)", JSON.stringify(result.superseded, null, 2));
  }
  if (result.mismatches && result.mismatches.length) {
    console.log("MISMATCHES", JSON.stringify(result.mismatches, null, 2));
  }
  if (result.chargeNotes && result.chargeNotes.length) {
    console.log("CHARGE NOTES (use submitted with no use held; the app UI would not offer it)", JSON.stringify(result.chargeNotes, null, 2));
  }
  console.log("chargeNoteCount:", (result.chargeNotes || []).length);
  console.log("wrote", base + ".json", "and", base + ".md");
  process.exit(result.crashed ? 2 : 0);
}

if (cmd === "fuzz") {
  const n = Number(flag("n", 8));
  const seed = Number(flag("seed", Date.now() % 1e9));
  const result = runGame({ name: "fuzz-" + n + "-s" + seed, mode: "fuzz", playerCount: n, seed });
  const base = writeResult(result, result.name);
  console.log(JSON.stringify(summarize(result), null, 2));
  console.log("wrote", base + ".json", "and", base + ".md");
  process.exit(result.crashed ? 2 : 0);
}

if (cmd === "fuzz-batch") {
  const count = Number(flag("count", 50));
  const min = Number(flag("min", 5));
  const max = Number(flag("max", 20));
  const seed0 = Number(flag("seed", 100));
  const summaries = [];
  for (let i = 0; i < count; i++) {
    const seed = seed0 + i;
    const n = min + ((seed * 7) % (max - min + 1));
    const result = runGame({ name: "fuzz-" + n + "p-s" + seed, mode: "fuzz", playerCount: n, seed });
    writeResult(result, result.name);
    const s = summarize(result);
    s.players = n;
    summaries.push(s);
    const mark = s.crashed ? "CRASH" : s.winner || "open";
    console.log((i + 1) + "/" + count, s.name, mark, "r" + s.rounds, "issues=" + s.issueCount, s.highCodes.join(",") || "");
  }
  const report = {
    count,
    crashes: summaries.filter((s) => s.crashed).length,
    winners: summaries.reduce((acc, s) => {
      acc[s.winner || "none"] = (acc[s.winner || "none"] || 0) + 1;
      return acc;
    }, {}),
    highCodes: summaries.reduce((acc, s) => {
      for (const c of s.highCodes) acc[c] = (acc[c] || 0) + 1;
      return acc;
    }, {}),
    games: summaries,
  };
  const dir = outDir();
  fs.writeFileSync(path.join(dir, "fuzz-batch-summary.json"), JSON.stringify(report, null, 2));
  console.log("\nBATCH", JSON.stringify({ crashes: report.crashes, winners: report.winners, highCodes: report.highCodes }, null, 2));
  process.exit(report.crashes ? 2 : 0);
}

if (cmd === "realistic") {
  const n = Number(flag("n", 8));
  const seed = Number(flag("seed", Date.now() % 1e9));
  const result = runGame({ name: "realistic-" + n + "-s" + seed, mode: "realistic", playerCount: n, seed, rechargeAt: 6 });
  const base = writeResult(result, result.name);
  console.log(JSON.stringify(summarize(result), null, 2));
  console.log("wrote", base + ".json", "and", base + ".md");
  process.exit(result.crashed ? 2 : 0);
}

if (cmd === "realistic-batch") {
  const count = Number(flag("count", 20));
  const n = Number(flag("n", 8));
  const seed0 = Number(flag("seed", 200));
  const summaries = [];
  for (let i = 0; i < count; i++) {
    const seed = seed0 + i;
    const result = runGame({ name: "realistic-" + n + "p-s" + seed, mode: "realistic", playerCount: n, seed, rechargeAt: 6, testCutoff75: flag("cutoff75", "") === "on" });
    writeResult(result, result.name);
    const sry = summarize(result);
    sry.players = n;
    summaries.push(sry);
    const mark = sry.crashed ? "CRASH" : sry.winner || "open";
    console.log((i + 1) + "/" + count, sry.name, mark, "r" + sry.rounds, "issues=" + sry.issueCount);
  }
  const winners = summaries.reduce((acc, sry) => {
    acc[sry.winner || "none"] = (acc[sry.winner || "none"] || 0) + 1;
    return acc;
  }, {});
  const finished = summaries.filter((sry) => sry.winner);
  const avgRounds = finished.length ? Math.round((finished.reduce((a, sry) => a + sry.rounds, 0) / finished.length) * 10) / 10 : 0;
  const report = {
    count,
    players: n,
    crashes: summaries.filter((sry) => sry.crashed).length,
    winners,
    avgRounds,
    games: summaries,
  };
  const dir = outDir();
  fs.writeFileSync(path.join(dir, "realistic-" + n + (flag("cutoff75", "") === "on" ? "-cutoff75" : "") + "-summary.json"), JSON.stringify(report, null, 2));
  console.log("\nREALISTIC", n + "p", JSON.stringify({ crashes: report.crashes, winners, avgRounds }, null, 2));
  process.exit(report.crashes ? 2 : 0);
}

usage();
process.exit(1);
