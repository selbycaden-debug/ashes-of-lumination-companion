import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runGame } from "../sim/lib/run-game.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(root, "../sim/scripts");
const files = fs.readdirSync(dir).filter((name) => name.endsWith(".json")).sort();
let failed = 0;
for (const file of files) {
  const script = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
  const result = runGame(script);
  const mismatches = result.mismatches || [];
  if (result.crashed || mismatches.length) {
    failed += 1;
    console.error("FAIL", file, result.crashed ? "crash" : mismatches.length + " mismatches");
    if (result.crashed) console.error(String(result.crashed).split("\n")[0]);
    if (mismatches.length) console.error(JSON.stringify(mismatches.slice(0, 4), null, 2));
  }
}
console.log(`${files.length - failed}/${files.length} scripts passed`);
if (files.length !== 100) {
  console.error("Expected 100 scripts, found " + files.length);
  process.exit(1);
}
process.exit(failed ? 1 : 0);
