# How to run the Ashes of Lumination test harness

The harness at `/workspace/game/sim/` drives the **real** companion-app game logic from `/workspace/game/local-render/canvas-source.tsx`. It does not reimplement deal, submit, resolve, vote, execute, or win checks.

The Page cannot import a local module, so the shared code lives as top-level functions inside `canvas-source.tsx`. The App UI calls those same functions. `build-engine.mjs` copies that file, appends a named `export { ... }` list (the Page itself stays a default-export app), and bundles it with esbuild for Node.

After any change to `canvas-source.tsx`, rebuild before running games. After a clear source fix, republish to the same Page (`canvas_id` `afb4ae96-0f4c-48ad-9c48-dda54c4cf686`) so the live app and the harness stay on the same code.

## Commands

Run these from `/workspace/game/sim/`. Node and the `local-render` esbuild/React install are required (`npm install --no-fund --no-audit` in `/workspace/game/local-render` if `node_modules` is missing).

```bash
# Rebuild dist/engine.js from canvas-source.tsx
node run.mjs build

# Replay a scripted game
node run.mjs script scripts/smoke-8.json

# One random (fuzz) game
node run.mjs fuzz --n 8 --seed 42
node run.mjs fuzz --n 18 --seed 18

# Many random games (default: 50 games, 5–20 players, seeds 100, 101, …)
node run.mjs fuzz-batch --count 50 --min 5 --max 20 --seed 100

# One realistic game (faction-aware legal picks, not uniform random)
node run.mjs realistic --n 12 --seed 300

# Many realistic games (default: 20 games). Also writes out/realistic-<n>-summary.json
node run.mjs realistic-batch --n 8 --count 20 --seed 200
node run.mjs realistic-batch --n 12 --count 20 --seed 300
node run.mjs realistic-batch --n 18 --count 20 --seed 400
```

Each run writes:

- `/workspace/game/sim/out/<name>.json` — events, issues, and a snapshot after every phase (each player's screen-visible info, the GM view, the log, and results)
- `/workspace/game/sim/out/<name>.md` — a readable markdown transcript
- `/workspace/game/sim/out/<name>.state.json` — compact final engine state

`fuzz-batch` also writes `/workspace/game/sim/out/fuzz-batch-summary.json`.

A `seed` makes `Math.random` deterministic (Mulberry32-style) so the real app's shuffle and fuzz picks replay the same way.

## JSON game-script format

A script is a JSON object. Two deal styles are supported.

### Forced roles

```json
{
  "name": "smoke-8-child-execution",
  "seed": 8,
  "players": [
    { "name": "Mira", "role": "the-ashen-tyrant" },
    { "name": "Rowan", "role": "the-ashen-mind" }
  ],
  "steps": []
}
```

Every listed player needs a unique, known `role` id (the kebab-case ids used in the app, e.g. `the-ashen-tyrant`, `the-shadow-blade`, `voice-of-the-accord`). The deal is rejected if The Ashen Tyrant is missing, a role is duplicated, or an id is unknown.

### Random deal

```json
{
  "name": "smoke-18-random",
  "mode": "fuzz",
  "playerCount": 18,
  "seed": 18
}
```

You can also set `"deal": "random"` and omit `mode`. Names come from the app's sample list plus extras in `lib/names.mjs`. Role counts follow the app's `ashenCount` / `unalignedCount` / Lumen pool.

`mode: "fuzz"` (or a single `playToEnd` step) then plays the game to a winner or 25 rounds, picking a random legal action for every living player who has one.

### Steps

Scripted games list `steps` in order. Each step has an `op`:

| `op` | What it does |
| --- | --- |
| `startRound` / `beginRound` | Begin Ash Fall (first night if still in setup). |
| `ashFall` | Apply `actions` for this Ash Fall. Players who have no action may be omitted. |
| `resolveAshFall` | Resolve the night. Optional `flip`: `"heads"` or `"tails"` if a Paradox flip is pending; otherwise the harness flips at random and logs that conversion/succession is still OPEN. |
| `paradoxFlip` / `flip` | Enter Heads (`result: "heads"` or `heads: true`) or Tails. |
| `lumination` | Apply daytime `actions`. The harness also auto-answers a pending Self Known question. |
| `answerSelfKnown` | Answer The Self Known question only. |
| `resolveLumination` | Resolve the day and move to the Dawn Accord. |
| `nominate` | Either player nominations (`"nominations": { "Mira": "Wren", ... }`, one living nominator each) or a GM override (`"nominees": ["Wren", "Mira", "Theo"]`). The default table-practice ballot is the top 3 nominees (all who tie for last place go on); `"No execution"` / `NO_EXEC` is added only if fewer than 3 unique living nominees. Voice of the Accord nomination and vote each count as 2; Silent Hand targets are silently voided; a Red Scar day-kill victim's nomination still counts; nominations on a player who dies before the ballot lapse. Dead players do not nominate. |
| `vote` | Map voter name → nominee name, `"No execution"` / `NO_EXEC`, or `"SAVE"`. Dead players keep one final Dawn Accord vote that can be saved for a later Accord (table practice; whether it is single-use for the rest of the game or next-Accord-only is still OPEN). |
| `execute` | Execute a named player, `"target": "NO_EXEC"` / `"No execution"` for a no-execution close, or `"target": "auto"` / `"auto": true` to follow the unique-lead / tie rule below. |
| `nextRound` / `closeDawnAccord` | Close the Dawn Accord (and check the Civic Luminary win, including nights with no execution). |
| `playToEnd` | Finish the game with random legal actions from this point. |

If `steps` is omitted and `mode` is `"fuzz"`, the harness deals and plays to the end.

### Action objects

Every action needs `"player": "<name>"` and `"action": "<kind>"`.

Ash Fall kinds:

- `kill` — night kill (Tyrant, or the Shadow Blade after takeover and the required night of peace; engine label “Shadow Blade kill”). Use `"skip": true` (or `"target": "skip"`) to pass, or `"target": "<name>"` to mark. Alias: `skipKill`.
- `inheritedKill` — inherited Tyrant kill only (Red Scar or Echo after the Tyrant is gone). Same skip/target fields. Do not use this for the Blade’s own post-takeover kill.
- `poison` — Mirebane. May `"skip": true` or target a living non-Ashen player. Repeat targets are allowed; self is not.
- `shield` — Vitality Overseer, one living target (self allowed).
- `check` — information / cancel / silence night actions (Foresight, Watching Eye, Shadow Blade Tyrant check, Failsafe, Silent Hand, Warden). Set `"target"`. The engine uses the acting player's real label.
- `parallax` — The Parallax, two living targets (`target` and `target2`). Self may be one of them; the two targets must differ.
- `swap` — Ashen Mind snapshot, two *other* living players.

Day kinds:

- `question` — Seeker. `"skip": true`, or `"target"` plus `"role"` (a role id).
- `shot` — Sunmark. `"skip": true` or `"target"` (not self in the current legal-move list).
- `dayKill` — Red Scar. `"skip": true` or `"target"`.
- `invite` — Syndic, living non-member `"target"`. The harness randomly accepts or declines pending invites unless a later `answerInvite` is used.
- `answerInvite` — `"accept": true` or `false`.
- `summon` — Necromancer, two different dead players as `target` and `target2`.
- `lastShot` — a last-shot style mark (`target` required in the current applicator).
- `hold` / `skipDay` — submit a skipped day action with no targets (useful for a one-shot that is being passed).

Confirmed legal-move rules the fuzz generator already follows:

- The Watching Eye, The Parallax, and The Foresight Elder may pick themselves.
- The Failsafe may repeat a target but not pick self.
- The Shadow Blade's pre-takeover Tyrant check cannot target self.
- The Mirebane may skip.

Example Ash Fall step:

```json
{
  "op": "ashFall",
  "actions": [
    { "player": "Mira", "action": "kill", "skip": true },
    { "player": "Ellis", "action": "shield", "target": "Wren" },
    { "player": "Jun", "action": "check", "target": "Mira" },
    { "player": "Kira", "action": "check", "target": "Kira" }
  ]
}
```

## Dawn Accord in scripts vs the app

The default nomination flow (table practice, also used in the live app) is:

- Each living player makes one nomination on their screen. The GM sees the tally and can still override the ballot by hand.
- The top 3 nominees go on the ballot. If several players tie for the last seat, they all go on (this is how Game 6 Lumination 2 produced a four-name ballot).
- “No execution” is added only if fewer than 3 unique living players were nominated.
- Most votes wins. A tie means no execution. Voice of the Accord nomination and vote each count as 2.

A unique nominee with the most votes is executed. A tie, or a unique lead for “No execution,” means no execution. The transcript logs this whenever the harness applies an auto-execute.

Forced deals also accept playtest extras: `ashTouched` (list of names; the ruling is exactly 1 — more than one logs a warning), `soulbound` on a seat (partner name), `mindMasks` / `mindMasksByName` (name → role id the Mind's snapshot should show), `rechargeAt` (ignored since the Nov 16 5-player rule), and `unalignedPick` (`-1` random, or `0` / `1` at 7–9 players). List `players` in seating order so Bearer neighbors are correct.

A script may include an `expect` array of phase checks (`after`, `round`, `winner`, `dead`, `livingCount`, `livingNames`, `ballot`, `results`, `logIncludes`, `publicOmits`, `publicIncludesVotes`, `visibleForbids`). `node run.mjs script …` prints `mismatchCount` and any mismatches. Comparator looks at the snapshot for that label, including Dawn Accord public notices. `publicOmits` checks that a voided nominator does not appear as “Name →” on the public `Nominations:` notice. `publicIncludesVotes` checks that a named voter appears as a cast on the public `Votes:` notice. `visibleForbids` searches only player-facing fields (`publicNotices`, `results`, `ownRole`, `winner`, `phase`) — not `allRoles`, whose Shadow Blade text contains the word “takeover.”

Do not treat a harness auto-execution or auto coin flip as a closed rules decision.

## What the transcript records

After every step or phase the JSON/markdown snapshot includes:

- Each living or dead player's screen-visible results and role-screen info (what that seat would see — not other players' hidden roles, unless an ability revealed them).
- The GM view: seating, roles, modifiers, tallies, and the public log.
- Invariant findings (crashes, stuck phases, negative charges, dead players acting, illegal self-targets, role leaks, bad win checks).

Invariant checks treat Ashen Mind snapshots, Witness / Echo reveals, and the Shadow Blade Tyrant check as allowed reveals. They flag any player-visible text that says “You are Ash Touched” or “You are Mire Touched.”

## Handing a playtest to the harness

Ahsoka can turn a transcript under `/workspace/aol-playtest/` into a script:

1. Copy `scripts/smoke-8.json` as a template.
2. List every player with the role they actually held (`players` + `role`).
3. For each night, add an `ashFall` step with the actions that were submitted, then `resolveAshFall`.
4. For each day, add a `lumination` step, then `resolveLumination`.
5. Add `nominate` (player `nominations` or a GM `nominees` override), `vote`, and either `execute` (named player or `"No execution"`) or `execute` with `"target": "auto"`, then `nextRound`.
6. Optionally add `expect` checks. Run `node run.mjs script path/to/script.json` and read `out/<name>.md`.

If a mid-game moment is all you want to replay, write steps up to that point and stop; the run ends when the script ends or a winner is declared. Use `playToEnd` only when you want the harness to finish the rest at random.

Saved starters:

- `scripts/smoke-8.json` — 8-player forced deal, Ashen Child executed on dawn 1 (Ashen win).
- `scripts/smoke-18.json` — 18-player random deal, seed 18, play to the end.
- `scripts/civic-4-no-exec.json` — 5-player Civic Luminary check after a no-execution Dawn Accord at 4 living.
- `scripts/playtest-game6.json` — Ahsoka's finished 12-player Game 6 (Lumen win, Day 5).
- `scripts/playtest-game7.json` — Ahsoka's finished 12-player Game 7 (Ashen win, Ash Fall 3).
- `scripts/playtest-game8.json` — Ahsoka's finished 12-player Game 8 (Shadow Blade win, last one standing, Ash Fall 6). Use `"action": "kill"` for the Blade’s post-takeover nights, and `"target": "NO_EXEC"` / `"No execution"` when a Dawn Accord closes with no execution.
- `scripts/playtest-game9.json` — Ahsoka's finished 18-player Game 9 (Lumen win, Day 7), generated by `tools/make-game9.py`. seed 25 puts the AF1 Watching Eye miss poison on P9 as at the table.
- `scripts/playtest-game10.json` — Ahsoka's finished 18-player Game 10 (Lumen win, L6 shot), generated by `tools/make-game10.py 261`. seed 261 puts the AF1/AF2 Watching Eye miss poisons on P3/P1 as at the table. Includes a `resultForbids` expect (an executed Echo gets no copy result).
- `scripts/playtest-game11.json` — Ahsoka's finished 18-player Game 11 (Lumen win, DA5 execution of the active Shadow Blade), generated by `tools/make-game11.py 11`. seed 11 puts the AF1 Eye miss poison on P2 as at the table. Checks the Eye results, the Echo copies (Tyrant paused; the Syndic and Mind copies are now superseded by the Nov 16 ruling), Silent Hand voids shown as normal, and the AF5 Failsafe cancel.
- `scripts/game11-failsafe-only.json` — the same game with the AF5 shield removed (`make-game11.py 11 --failsafe-only`): the Failsafe alone must stop the Blade kill.
- `scripts/eye-rule-found.json` and `scripts/eye-rule-tyrant-dead.json` — regression for the Nov 16 CADEN Watching Eye ruling (Tyrant-only reveal, Mire target cured with no info, no further checks after a find or the Tyrant's death). Note: after editing `canvas-source.tsx`, rebuild with `node build-engine.mjs` (or `node run.mjs build`). Expects may carry `superseded` entries for table values replaced by a later CADEN ruling; they are listed under SUPERSEDED and never counted as mismatches.
- `scripts/echo-night-of-peace.json` — regression: the Echo Thief's copied Tyrant kill must not land on the night of peace.
- `scripts/rule1116-*.json` — one regression per Caden ruling of Nov 16 (generated by `tools/make-rulings1116.py`): 01 dead-vote cap, 02 Blade wins alone, 03 Silent Hand voids shown as normal, 04 Syndic shield and win, 05 Echo copy limits and one-time Tyrant kill, 06/06b exactly one Ash Touched, 07 Overseer shield duration, 08a/08b/08c Witness team-only at 10+ (and exact role at 9), 09 Soulbound, 10 the 5-player recharge rule. 12 of the 13 fail on the pre-ruling source; 08c (the 9-player boundary) passes on both by design.

### Nov 17 harness additions (Ash Touched true/false)

- `scripts/rule1117-*.json` (generated by `tools/make-rulings1117.py`): 01 Failsafe keeps the recruit shield, 02a/02b/02c Ash Touched results at 0% / 100% / GM overrides across every info role, 03 Echo loses its copy, 04 dead-vote order, 05 Soulbound never told, 06 Ash Touched Eye false hit stops.
- Script field `atFalsePct` (0–100): the GM chance of a false Ash Touched result (app default 50). Rolled results use `Math.random`, so pin them for replays.
- Script field `atForce`: `[{"player": "P8", "rounds": [1, 2], "value": "false"}]` (or `"round": 3`) forces that player's Ash Touched results per round, exactly like the GM's "Force true / Force false" buttons. Applied right after the deal, so it can't reach the Bearer's deal-time result; use `atFalsePct` 0 or 100 for that.
- Step op `atForce` (`player`, `value` "true" | "false" | "auto", optional `round`, default the current round) and step op `atFalsePct` (`value`).
- Expect `atRolls`: `[{"name", "label"?, "lie"?, "how"?, "round"?}]` must each match a recorded Ash Touched result; `atRollCount` checks the total.
- `tools/rulings1117.py` adds `atForce` "false" (rounds 0–12) for every Ash Touched seat that has none; the Game 9/10/11 generators and `make-rulings1116.py` call it. Games 6–8, the eye-rule scripts and echo-night-of-peace were patched with it once.
- `tools/at-odds-check.mjs` measures the false rate of `infoLies` at 0/25/50/100%.
- `tools/min-edits.py <old.tsx> <new.tsx> <out.json>` builds the minimal unique EditCanvas replacements used to publish.

### Nov 16 harness additions

- Script op `placeAshTouched` (`"target"`): GM places the single Ash Touched (clears any other). Random deals now place 1 Ash Touched at random, like a GM would.
- Action `syndShield` (`"on": true|false`): a recruit arms (or disarms) the one-time Syndicate night shield during Ash Fall.
- Forced-deal seat field `"soulbound": "<partner name>"`.
- Expect types: `publicIncludesNoms` (nominations, voids included, appear in the public list), `publicForbids` (text that must never appear in player-facing notices), `charges` (`{name: held}` from the GM player list), `remindersForbid`.
- Charge notes: a spending action submitted with no use held is listed under CHARGE NOTES (`chargeNoteCount:`). `rechargeAt` in old scripts is ignored — the 5-player rule replaced it.
- `tools/run-all.sh` — rebuild and print one summary line per script.
- `tools/run-on-pre.sh <pre.tsx> scripts...` — temporarily run scripts against an older source (stubs the new exports), then restore and rebuild.
- `tools/rulings1116.py` — applied by `make-game9/10/11.py`: marks table results replaced by the Nov 16 rulings as `superseded`.
- `tools/ui-check-rulings1116.mjs` — renders the Syndic shield card and the GM dead-vote cap in the local bundle (rebuild `local-render/dist/app.js` with esbuild first).

## Realistic mode (AI policy, not table balance)

`realistic` / `realistic-batch` still only submit legal engine actions. Policy version 2 (current) is in `/workspace/game/sim/lib/realistic.mjs`:

- Lumen information roles publicly share the result they actually received most of the time (~90%). Poison and Ash Touched already produce false text in that result, so a share can be honestly wrong.
- Lumen nominations and votes coordinate on a sticky living Ashen read (`primeSuspect`).
- Living Ashen sometimes fake-claim once (~35%); those claims are sticky and are not treated as revealed Lumen.
- The Vitality Overseer shields the most valuable revealed Lumen first, then a non-fake claim, then an information role, then self.

Use the same seeds to compare policy versions: 8p 200–219, 12p 300–319, 18p 400–419. Report win rates as AI-policy results, not table balance. Version 1 (weaker Lumen coordination) totals are in `TEST-LOG.md` (11:35 PM MST). Version 2 summaries are `out/realistic-v2-{8,12,18}-summary.json` and also overwrite `out/realistic-{8,12,18}-summary.json`.

## Player-facing Silent Hand lists

Table practice, still OPEN: public nomination lists omit nominations voided by the Silent Hand, and public vote lists show voided votes as cast but not counted, with no void label. The app publishes those lists as `publicNotices` (`Nominations: …` / `Votes: … Counted tally: …`). The GM log and the GM Dawn Accord panel still show voids. Nomination and vote forms no longer tell a silenced player that their input will not count.

## Changing the app

Fix clear bugs in `/workspace/game/local-render/canvas-source.tsx` only. Log every bug, fix, and change in `/workspace/game/sim/TEST-LOG.md` (America/Denver timestamps). Put unsettled mismatches in the “Rules questions for Ahsoka/Caden” section of that log — do not silently close an OPEN rule in code. Then `node run.mjs build`, rerun the affected scripts, and republish the Page with the logo, portraits, and faction symbols left byte-exact.

## Nov 18 additions
- Scripts: `python3 tools/make-rulings1118.py` (rule1118-01…05). Regenerate in the order 1116 → 1117 → 1118 (1117-07 copies 1116-04).
- UI check: `node tools/ui-check-rulings1118.mjs` (rebuild dist/app.js first). Screenshots go to out/rulings-1118/.
- Nov 18b: `python3 tools/make-rulings1118b.py` (rule1118b-*). New expectation `teamCounts: {"Ashen": 1}`. Random 10+ deals get a random Soulbound pair (set `"placeSoulbound": false` to skip).
- Nov 18 (afternoon):
  - `python3 tools/make-cutoff1118.py` (cutoff75-*) and `python3 tools/make-succession1118.py` (succ1118-*).
  - Scripts can set `"testCutoff75": true`.
  - Batch with the flag: `node run.mjs realistic-batch --n 12 --count 200 --seed 19000 --cutoff75 on`.
  - UI check: `node tools/ui-check-cutoff1118.mjs`.
  - Lumen metrics: `node tools/lumen-metrics.mjs sim|live`; the fixed-bot copy is `node study-lumen/lumen-metrics-fixed.mjs sim`.
- Nov 18, 2:07 PM (night of peace after every pass):
  - `python3 tools/make-peace1118.py` (peace1118-01…05). Rerun `make-succession1118.py`, `make-rulings1118b.py` and `make-game9.py` after any change to them.
  - UI check: `node tools/ui-check-peace1118.mjs` (rebuild dist/app.js first). Screenshots go to out/peace/.
  - The main sim now uses the fixed Lumen bots. The old bots are in `out/realistic.pre-lumenfix-1118.mjs`; copy that file back to `lib/realistic.mjs` to compare with the earlier batch numbers.
  - Batch outputs: `out/peace/batches/` (old bots) and `out/peace/batches-fixed/` (fixed bots).
  - Note: `run-on-pre.sh` leaves `dist/engine.js` built from the pre source; run `node build-engine.mjs` afterwards.
- Nov 18, 2:12 PM: the stall fix is in `lib/realistic.mjs` (backup `out/realistic.pre-stallfix-1118.mjs`).
- Nov 21: `python3 tools/make-shieldsoul1121.py` (shieldsoul1121-01…04).
- Nov 21: Game 12 replay `python3 tools/make-game12.py [seed]` (cutoff flag ON).

## Nov 21 audit additions
- Design-default toggles: `state.designDefaults` (missing key = ON). In scripts use `"designDefaults": {"D43": false}`. For batches use `AOL_DD='{"D6":false}' node run.mjs realistic-batch ...`.
- Regenerate the audit cases with `python3 tools/make-audit1121.py`. Game 12: `python3 tools/make-game12.py 1`. Game 10: `python3 tools/make-game10.py` (default seed is now 152).
- UI check: `node tools/ui-check-audit1121.mjs` (screenshots in `out/audit1121/`).
- Patch script used for the engine changes: `tools/patch-audit1121.py` (already applied; don't rerun).
- New script fields: `logForbids`, `poisonCounts`. New ops: `gmToggle {player,key,value}`, and `resolveLumination {flip}`.
