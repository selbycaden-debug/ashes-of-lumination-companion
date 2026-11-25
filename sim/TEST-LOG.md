# Ashes of Lumination — simulation test log

All times are America/Denver (MST, UTC-7). Every harness change, app change, bug, and fix for the overnight sim job is recorded here. Open rules are not silently closed in code; they go in [Rules questions for Ahsoka/Caden](#rules-questions-for-ahsokacaden).

---

## 2026-11-15, 11:07 PM MST — Change: test harness on the real app code

Built `/workspace/game/sim/` to run the companion app’s actual game logic from `/workspace/game/local-render/canvas-source.tsx`, not a reimplementation.

The Page cannot import a local file, so deal / submit action / advance phase / resolve / vote / execute / win-check helpers that the UI was inlining were lifted into top-level pure functions in `canvas-source.tsx`. The App wrappers now call those functions. `build-engine.mjs` copies that same file, appends a named export list, and bundles it with esbuild (React + a `grok/canvas` stub) into `dist/engine.js`.

Harness abilities:

- 5–20 players, forced role assignment or a random deal (same `dealRoles` / count tables as the app).
- JSON scripts for every Ash Fall and Lumination action, nominations, and votes.
- Phase stepping with a JSON dump plus a markdown transcript after every phase (each player’s screen-visible info, the GM view, the log, and results).
- `fuzz` / `fuzz-batch` modes that pick random legal actions.

See `/workspace/game/sim/HOW-TO-RUN.md` for the script format and commands.

A missing `node_modules` in `/workspace/game/local-render` blocked the first esbuild; `npm install --no-fund --no-audit` restored it. An attempted `export { default }` on a file that already has `export default function App` failed and was dropped. The generated copy lives under `sim/.generated`, so esbuild aliases `react` / `react/jsx-runtime` / `react/jsx-dev-runtime` into `local-render/node_modules`.

---

## 2026-11-15, 11:11 PM MST — Bug (harness, medium): false-positive “dead-acting”

**Repro:** `node run.mjs fuzz --n 8 --seed 42` and `fuzz --n 18 --seed 18` flagged high-severity `dead-acting` after Lumination / Dawn Accord.

**Cause:** A player submitted a legal Ash Fall action while alive, then died when the night resolved. Invariants ran later and treated the still-present night action as a dead player acting.

**Fix (harness only):** `/workspace/game/sim/lib/invariants.mjs` now flags a Lumination action only when the log shows that same player died this Ash Fall (Ash Fall kill / three-poison / syndic). Those two seeds were rerun and reported 0 issues.

No app-source change.

---

## 2026-11-15, 11:12 PM MST — Bug (harness, medium): `inheritedKill` skip threw “kill needs a target”

**Repro:** First 50-game fuzz batch (`fuzz-batch --count 50 --min 5 --max 20 --seed 100`). Two games threw in `applyScriptAction` and were recorded as `action-throw`:

- `fuzz-20p-s121`, round 10 Ash Fall, “Kira kill needs a target”
- `fuzz-15p-s134`, round 9 Ash Fall, “Jun kill needs a target”

Both processes still finished (the throw was caught; the skip was not submitted). 0 process crashes.

**Cause:** Legal-move generation emits `{ action: "inheritedKill", skip: true, ... }` when the inherited kill is passed. `applyScriptAction` only treated `kind === "kill"` plus `skip` as a pass, so an inherited skip fell through to the “needs a target” branch. The error string said “kill” even for `inheritedKill`.

**Fix (harness only):** `/workspace/game/sim/lib/actions.mjs` now treats `inheritedKill` + `skip` (or `target: "skip"`) as a skipped kill. Rerun:

- `fuzz --n 20 --seed 121` → lumen, 11 rounds, 0 issues, no crash
- `fuzz --n 15 --seed 134` → lumen, 13 rounds, 0 issues, no crash

No app-source change. This was not a rules bug.

---

## 2026-11-15, 11:13 PM MST — Bug (app, medium): Civic Luminary win not checked when the Dawn Accord ends without an execution

**Repro:** `/workspace/game/sim/scripts/civic-4-no-exec.json`. Five players (Tyrant, Civic Luminary, Overseer, Bearer, Foresight). Ash Fall kills the Overseer (4 living, Civic alive). Dawn Accord is a 2–2 tie, so no execution. Before the fix, `closeDawnAccord` called `checkWins(..., false)` via `startRound`, so the Civic ability never fired and the game continued.

**Cause:** `checkWins` only awards the Civic Luminary win when `civicNow` is true, and that flag was only passed from `executePlayer`. The ability text is “If only 4 players remain after the Dawn Accord vote and The Civic Luminary is alive, the Lumen win.” A resolved vote with no execution is still after the vote. The GM “Close the Dawn Accord” button also inlined `startRound` instead of going through `closeDawnAccord`, so the Page and harness would have drifted.

**Fix (app):**

- `closeDawnAccord` now calls `checkWins(s, true)` before starting the next Ash Fall, so a no-execution Dawn Accord at 4 living with the Civic Luminary alive is a Lumen win.
- The GM Close button now calls `closeDawnAccord` (same function as the harness).

Scripted confirmation: `civic-4-no-exec` ends `winner: lumen` after `nextRound`, 0 issues. Log line: “Lumen victory: The Civic Luminary is alive and 4 players remain after the Dawn Accord vote.”

Logged for confirmation: win-check priority vs Ashen parity in the same moment is still tagged OPEN in the app, and Ahsoka/Caden should confirm that a no-execution (including a tie) counts as “after the Dawn Accord vote.” See questions below.

---

## 2026-11-15, 11:14 PM MST — Smoke and fuzz results

All runs use the real engine after the Civic fix and the inherited-kill skip fix. 0 crashes, 0 stuck phases, 0 invariant issues.

| Run | Result |
| --- | --- |
| Scripted 8-player `scripts/smoke-8.json` | Completes. Wren (Ashen Child) is executed at Dawn 1. Winner: **ashen**. 0 issues. |
| Random 8-player `fuzz --n 8 --seed 42` | Completes in 5 rounds. Winner: **ashen**. 0 issues. |
| Random 18-player `scripts/smoke-18.json` (seed 18) | Completes in 11 rounds. Winner: **ashen**. 0 issues. |
| Civic check `scripts/civic-4-no-exec.json` | Completes. Winner: **lumen** (Civic at 4 after a tied Dawn Accord). 0 issues. |
| Fuzz batch 50 games, 5–20 players, seeds 100–149 | 0 crashes. All 50 finished with a winner: **lumen 20, ashen 29, syndic 1**. No high-severity codes. Player counts cycle 5–20 via `n = 5 + (seed * 7) % 16`. |

Transcripts live under `/workspace/game/sim/out/`. The first batch had the two inherited-kill skip throws above; those seeds are clean after the harness fix, and the official 50-game rerun is the table above.

Invariant coverage on each snapshot: negative charges/poison, duplicate roles, missing Tyrant, illegal self-targets (Failsafe, Blade check, Warden, Silent Hand, Catalyst, kills, Mirebane, Red Scar, Sunmark), Mirebane-on-Ashen, identical two-targets, role leaks, “You are Ash Touched / Mire Touched” on the affected player’s screen, win-check sanity, bad phase, dead players acting, stuck phases.

No further clear source bugs were found in this pass. Caden’s confirmed rulings are followed by the legal-move generator: Shadow Blade pre-takeover Tyrant check; Watching Eye and Parallax may pick themselves; Failsafe may repeat a target but not self; Mirebane may skip.

---

## 2026-11-15, 11:21 PM MST — Change: published the function lift and Civic fix to the same Page

The live Page (`canvas_id` `afb4ae96-0f4c-48ad-9c48-dda54c4cf686`, title “Ashes of Lumination — Companion”) was updated from the same `canvas-source.tsx` so the harness and the Page stay on one implementation. Six EditCanvas hunks landed the lifted functions, the thin App wrappers, the Civic Luminary no-execution check in `closeDawnAccord`, and the GM Close button wiring. The page recompiled successfully.

Verification after publish:

- Live source is an exact byte match of `/workspace/game/local-render/canvas-source.tsx` (4605 lines).
- Logo sha256 `272f83f2e67466a63418ca0ab749657c90227ff0006127f3f365a99bac0db082` (24,196 bytes) matches `/workspace/game/web-logo/logo-640.webp`.
- All 26 portraits match `/workspace/game/web-portraits/*.webp` byte-for-byte.
- Faction symbols match `/workspace/game/web-symbols/`: Lumen sha256 `2747dec844f6d350519b9c973ad8bba9b4206e4eac9bcfdb014e14630e1ecf15` (5,620 bytes), Ashen `cff9d802fc21d73cecb1dac62ef31e5a02396760684d49bb9f2200bfad9e743f` (5,134 bytes), Unaligned `f6bc0644d691aa6fbed8a629c140a0f6573c59d85df367b5fa7922524d159e43` (3,886 bytes).
- Ahsoka snapshot line is still “Ashes of Lumination — game update for Ahsoka” (no trailing period).

`/workspace/game/intended/canvas-src-intended.tsx` and `canvas-src-live-published.tsx` were refreshed to this published source.

---

## Rules questions for Ahsoka/Caden

These are mismatches or gaps that cannot be closed from `/workspace/game/rulebook.txt`, `/workspace/aol-playtest/role_screens_spec.md`, and `/workspace/aol-playtest/rulings_v2.md` without a call. The app still leaves them tagged OPEN or pending where it already did. The harness does not invent a table ruling except where a game cannot proceed (Dawn Accord ties, Paradox coin), and those conveniences are logged in the transcript.

1. **Civic Luminary after a no-execution Dawn Accord.** The app now awards the Lumen win when 4 players remain and the Civic Luminary is alive at the close of the Dawn Accord, including a tie or a night with no execution. Please confirm that “after the Dawn Accord vote” includes those no-execution closes. (Fixed in source pending your confirmation.)

2. **Civic Luminary vs Ashen parity in the same moment.** If the table is at 4, the Civic Luminary is alive, and Ashen also have parity, which win is checked first? The app still labels this OPEN.

3. **Dawn Accord nominees and ties.** The live app still requires the GM to set nominees and click Execute. Playtest ruling used in the harness: a unique vote lead is executed; a tie (or no positive votes) is no execution. Nominee count, who may be nominated, and the official tie procedure remain pending Caden.

4. **Unaligned count at 7–9 players.** The in-app distribution note is already OPEN: the prototype uses 0 Unaligned at 7 players and 1 at 8–9.

5. **Parity counting.** Confirm that Unaligned players count in “the rest,” and that a converted Luminary Paradox counts as Ashen, for Ashen parity. The app does it that way and still tags related cases OPEN.

6. **Ashen Child after Shadow Blade takeover.** If the Child is executed after the Blade has inherited the kill, does Ashen still win immediately? The app currently does not award that Ashen win (OPEN).

7. **Paradox trigger source.** Does a Red Scar day kill or a Shadow Blade kill (pre- or post-takeover) trigger the Luminary Paradox, or only an Ashen (Tyrant / Child-inherited) night kill? The app currently triggers only on Ashen night kills and tags this OPEN.

8. **Paradox conversion and succession.** Heads/Tails conversion, unmasking, and what happens if the Paradox is already dead or converted remain OPEN. The harness will auto-enter a random (or scripted) flip so a game can continue, and it logs that the GM still has to enter the flip in the app.

9. **Syndic vs other simultaneous wins**, and **Syndic death vs protection** (the prototype delays some syndic deaths). Both remain OPEN. *(Nov 16: the Syndic's win condition itself is now a CADEN ruling — every living player is the Syndic, a recruit, or Ashen; alone vs with recruits is pending.)*

10. **Shield vs poison** (does a shield stop the poison token from landing, or only the third-token death?) remains OPEN.

11. **Soulbound + shield**, **Echo Thief copying Child / Civic passives** *(Nov 16 CADEN: Soulbound itself — if one dies, both die — and the Echo can't copy Unaligned roles or The Ashen Mind; a copied Tyrant is a one-time kill. Soulbound + shield and Child / Civic passives stay OPEN)*, **Necromancer silenced vote bundle**, and **Voter poison vs Lumen Guard on a Paradox execution** remain OPEN as already tagged in the app.

12. **Eventide / Failsafe / Silent Hand skip.** Caden confirmed the Mirebane may skip. Eventide shield-skip, Failsafe skip, and Silent Hand skip are still pending. The prototype requires a target for those (Failsafe / Hand cannot self).

13. **Sunmark:** self-target allowed or not; whether a miss (Lumen / Unaligned / Red Scar) spends the last-shot charge; shield vs the shot; converted Paradox as Ashen for the bullet. Pending / OPEN as already tagged.

14. **Foresight last-vision public wording**, **Self Known question shape**, **Judge four-player composition**, **Bearer “Yes” random-Lumen presentation**, **Watching Eye world-effect / after-hit details** (self-target is confirmed; the rest of the world effect is not), **dead-Ashen chat**, **summoned vote vs final vote**, and **dead nomination rules** remain pending Caden as already noted in the UI.

15. **GM-picked roles.** Forced deals are now first-class in the harness and in `applyForcedDeal`. The in-app Deal button still uses the fixed count tables. Caden has discussed GM-picked roles; whether the live Deal UI should offer a forced assignment is still a product/rules call, not silently changed tonight.

Do not treat a harness auto-flip, auto-invite accept/decline, or auto Dawn Accord resolution as an official ruling.

---

## 2026-11-15, 11:35 PM MST — Ahsoka's answers applied (CADEN / TABLE / OPEN)

Ahsoka answered the open rules questions. Labels used below:

- **CADEN** — Caden's own ruling. Treated as confirmed. Pending tags removed in the app where the text described that ruling.
- **TABLE** — Ahsoka's playtest procedure. Used as the app and harness default, marked with a small “table practice” tag, and logged here.
- **OPEN** — still pending. Not silently closed.

### 1. Civic win after a tie or no-execution close — OPEN

Kept the existing `closeDawnAccord` check (`checkWins(s, true)` so a no-execution close at 4 with the Civic Luminary alive is a Lumen win). Still tagged pending in the UI. Script `civic-4-no-exec` still ends `winner: lumen`.

### 2. Civic vs parity at the same moment — OPEN

No change. The app still tags the priority OPEN.

### 3. Dawn Accord nomination flow — TABLE

Implemented as the default flow, with a GM manual override kept:

- Each living player makes one nomination on their screen. The GM sees the tally.
- The top 3 nominees go on the ballot. If several players tie for the last seat, they all go on (needed for Game 6 Lumination 2, which produced the four-name ballot P12, P9, P7, P1). That tie-for-last extension is also tagged table practice.
- “No execution” is added only if fewer than 3 unique living players were nominated.
- Most votes wins. A tie means no execution.
- The Voice of the Accord's nomination and vote each count as 2.
- Silent Hand targets have their nomination and vote silently voided.
- A Red Scar day-kill victim's nomination still counts.
- Nominations on a player who dies before the ballot lapse.
- Dead players do not nominate.

New engine helpers: `castNomination`, `computeDawnBallot`, `nominationWeight`, `NO_EXEC`. `setDawnNominees` no longer pads or slices to 3.

### 4. Unaligned count at 7–9 players — CADEN

Caden's range is 0–1 Unaligned with 2 Ashen. There is no exact number, so the GM Setup screen now offers 0, 1, or random in that range (`unalignedPick`, default random). `resolveUnalignedCount` / `dealRoles` honor it.

### 5. Parity — TABLE, with one OPEN leftover

The Shadow Blade and other Unaligned count among “the rest.” The app already counted that way; the wording is now tagged table practice. A converted Luminary Paradox as Ashen for parity stays **OPEN**.

### 6. Ashen Child win after Blade takeover — OPEN

Kept current behavior: no immediate Ashen win if the Child is executed after takeover. That fits the rulebook. Whether former Ashen share the win when the active Blade dies stays **OPEN**.

### 13. Sunmark, last shot, and recharge — CADEN + TABLE, with a rulebook conflict

CADEN, now implemented in `applySunmarkShot`:

- The shot misses Lumen, Unaligned, and the Red Scar.
- It kills any other Ashen and an **active** Shadow Blade (post-takeover). The pre-takeover Blade is a miss (the Blade is still Unaligned). This was a real app bug: the old check was `team === Ashen && role !== Red Scar`, so an active Blade was always a miss. Fixed.
- An executed Shooter may fire one last public shot only if it still has an unused shot. The leftover “pending” tag on that last-shot line was removed.
- A role that has spent its once-used ability regains one use when the living count drops to a GM-set threshold.

TABLE, for the Shooter and Red Scar: that threshold is 6 alive, and they hold at most 1. This **conflicts** with the rulebook's 15 / 10 / 5 charge chart. The recharge threshold is now a GM setting (`rechargeAt`), defaulting to the table value of 6 for those two roles. See the new question for Caden at the bottom of this file.

Still **OPEN**: Sunmark self-target, shield vs the shot, and converted Paradox as Ashen for the bullet.

### 14. Dead players — CADEN + TABLE, with one OPEN leftover

CADEN: roles are not revealed on death. The dead lose all abilities, can talk and help their team but cannot reveal their role, and keep one final Dawn Accord vote. The GM view and the game log must never auto-reveal a dead player's role to the players. The succession log no longer says “The Ashen Tyrant has died” right after a death line; it now uses a GM-only succession note.

TABLE: that final vote is single-use for the rest of the game and can be **saved** for a later Accord. Dead players do not nominate. Single-use vs next-Accord-only stays **OPEN**.

### Items 7–12 and 15 — still OPEN

No change: Paradox trigger source; Paradox conversion and succession; Syndic vs other simultaneous wins / Syndic death vs protection; shield vs poison; Soulbound + shield, Echo Thief copies, Necromancer silenced vote bundle, Voter poison vs Lumen Guard; Eventide / Failsafe / Silent Hand skip; Foresight last-vision wording, Self Known question shape, Judge four-player composition, Bearer “Yes” random-Lumen presentation, Watching Eye world-effect details, dead-Ashen chat, summoned vote vs final vote; GM-picked roles in the Deal UI.

### Game 8 note

Game 8 is still running, so it was not replayed. Ahsoka privately told the Red Scar about the Blade takeover; that was her GM error, not an app mismatch, and should not be counted as one when Game 8 is replayed later.

---

## 2026-11-15, 11:35 PM MST — Change: last vision also written to the GM log

`pendingLastVision` was already published as a Dawn Accord public notice (`Last vision — …`). It was not copied into the GM log, so a GM could miss announcing it. `resolveLumination` now also writes `Public: Last vision — …` to the log when the notice is published. Exact last-vision wording remains OPEN (item 14 / leftover from 14's companion list).

---

## 2026-11-15, 11:35 PM MST — Playtest replays: Game 6 and Game 7

Scripts: `/workspace/game/sim/scripts/playtest-game6.json` and `playtest-game7.json`. Transcripts: `/workspace/game/sim/out/playtest-game6.{json,md,state.json}` and `playtest-game7.{json,md,state.json}`. Seating follows the primers. `(M)` in the playtest role lists means Masked, not Mire Touched. `rechargeAt` is 6. Forced Mind snapshots and Ash Touched lists match the primers (Game 6: P8 Parallax Ash Touched only; Game 7: P12 Elder Ash Touched).

Both replays completed with **0 crashes, 0 invariant issues**, and the **table winners**. After a comparator fix (below), both also have **0 script-expect mismatches** on the mechanical checks (deaths, ballots, living counts, info results, last vision appearing at dawn, winners).

### Game 6 — MATCH on the table outcome

12 players. Winner: **lumen**, round 5, after P6 (the active Shadow Blade) was executed on Day 5. Living at the end: P3, P4, P5. Night-of-peace and takeover log lines are present. After Day 4 the Tyrant and other Ashen were gone but the Blade was still alive, so the game correctly continued (`execute-r4` winner still empty), matching the table.

Notable phase matches:

- Lumination 1 ballot: P11, P12, P1. P11 executed.
- Lumination 2 ballot: P12, P9, P7, P1 (tie for the last seat, all on). Sunmark miss logged. P12 executed.
- Ash Fall 3: P9 died; last vision at the following dawn: “Last vision — P7 appears Ashen. (Unaligned appear as Ashen.)”
- Lumination 3 ballot: P7, P4, No execution. P7 executed.
- Ash Fall 4: P10 (Overseer) died. Lumination 4: Red Scar day-kill on P1 **failed** (the shield from P10 still held; shields expire at the end of `resolveLumination` after day kills). Ballot P2 + No execution. P2 executed. Game continued.
- Ash Fall 5: P1 died. Lumination 5 ballot: P6 + No execution. P6 executed. Lumen win: “the active Shadow Blade has been eliminated.”

Game 6 Lumination 2 individual nominations were reconstructed from the recorded counts (P12 ×5, P9 ×2, P7 ×1, P1 ×1; P12→P2 voided by Silent Hand) because the primer did not list every nominator. Lumination 1 omitted P12's unrecorded nomination so the counts stay P11 ×4, P12 ×2, P1 ×1.

### Game 7 — MATCH on the table outcome

12 players. Winner: **ashen**, round 3, at the end of Ash Fall 3, under the TABLE parity rule (3 Ashen vs 3 rest, the rest including the Shadow Blade). Living at the end: P9, P11, P16, P17, P19, P20.

Notable phase matches:

- Voice of the Accord nomination weight ×2 produced the Lumination 1 ballot P11, P14, P19.
- Ash Fall 1: P12 died; last vision at the following dawn: “Last vision — P16 appears Lumen. (Unaligned appear as Ashen.)” P13 was day-killed.
- P14 executed Dawn 1. Witness (P15) later learned the exact role “The Vitality Overseer” (see table-tuning note below).
- Ashen parity ended the game after Ash Fall 3, not on a later vote.

### Comparator (not app) issues fixed before the final rerun

The first script run reported 3 Game 6 and 2 Game 7 mismatches that were checker bugs:

- Winner compare used the labeled GM string (`Lumen` / `Ashen`) or fell through an empty snapshot `winner` to the **final** state, so Day 4 of Game 6 was wrongly scored as an already-finished Lumen win. `compareExpect` now uses the snapshot's raw `winner` only.
- “Last vision” was searched only in the Ash Fall log. It is published at Dawn Accord start (`resolveLumination`) as a public notice. Expects now attach to that snapshot, and the comparator also searches `publicNotices`.

### Table tunings logged as rules questions, not app bugs

These differences are real, but they are 12-player playtest tunings or GM table calls, not mechanical failures of the current ruleset. They were not silently adopted.

- **Bearer timing (Game 7).** The app shows the Bearer result at deal / setup: “Your neighbors (P10 and P14) share alignment.” The Game 7 table delayed that result until the start of Ash Fall 2. The yes/no itself matches.
- **Witness information (Game 7).** The app revealed the exact role (The Vitality Overseer). The Game 7 table used team-only. Game 6 used exact role (P11 Tyrant, P12 Voice, P7 Mind, P2 Red Scar), which the app matches. The 12-player team-only variant is still OPEN.
- **Shield after the Overseer dies (Game 6 vs Game 7).** The app keeps other players' shields until Lumination ends, even if the Overseer has already died. That matched Game 6 Lumination 4 (Red Scar on P1 still blocked after P10 died Ash Fall 4). Game 7's primer said the shield ends if the Overseer dies. No Game 7 outcome turned on it. Still OPEN which table call is official.
- **Overseer self-shield repeat (Game 6).** At Ash Fall 4 the GM told the Overseer they could not shield themselves after an Ash Fall 3 self-shield. Role text and the app allow a repeat target (including self). They shielded P1 anyway, so the table outcome did not change.
- **Voice public reveal (Game 7).** Caden's trial: a once-per-game public reveal with no vote-math effect (Voice already counts as 2). Not implemented in the app.

---

## 2026-11-15, 11:35 PM MST — Realistic sim mode and 20-game batches

New `realistic` / `realistic-batch` mode in `/workspace/game/sim/lib/realistic.mjs` and `run.mjs`. It still uses only legal engine actions, but picks them with a light faction policy instead of a uniform random legal move:

- Ashen do not night-kill or day-kill teammates.
- The Vitality Overseer prefers a claimed player, then an information role, then self.
- Nominations and votes lean toward names already flagged in public notices or shared information results (`ashenSuspected`).

20 games at each of 8, 12, and 18 players. 0 crashes, 0 invariant issues, every game finished with a winner. Seeds: 8p 200–219, 12p 300–319, 18p 400–419. Summaries: `/workspace/game/sim/out/realistic-8-summary.json`, `realistic-12-summary.json`, `realistic-18-summary.json`.

| Players | Lumen | Ashen | Syndic | Shadow | Avg rounds |
| --- | --- | --- | --- | --- | --- |
| 8 | 1 | 19 | 0 | 0 | 2.8 |
| 12 | 4 | 16 | 0 | 0 | 4.0 |
| 18 | 4 | 16 | 0 | 0 | 6.9 |
| **All 60** | **9** | **51** | **0** | **0** | — |

Ashen won 51 of 60 under this simple policy (especially at 8 players, 19–1). That is a balance signal for this AI, not a claim about true table balance. No Syndic or Shadow-win endings appeared in this batch.

---

## Rules questions still open, plus new ones from this pass

The original numbered list (1–15) still stands, with status updated by Ahsoka's answers above. New or sharpened questions for Caden / Ahsoka:

- **RESOLVED — CADEN (Nov 16, 2026): the 5-player rule replaces both.** A used ability regains a use only after 5 more players have died since it was used. ~~**Recharge chart vs table threshold.**~~ Original: The rulebook's 15 / 10 / 5 charge chart conflicts with the table-practice rule that the Shooter and Red Scar regain one use at 6 alive (holding at most 1). The app now uses a single GM setting, default 6. Which chart is official, and does it apply only to those two roles or to every once-used ability?
- **Dawn Accord tie for the last ballot seat.** Ahsoka's short answer said “top 3.” Game 6 Lumination 2 put all who tied for third on the ballot. The app follows that table practice. Confirm it.
- **Bearer result timing.** Setup (current app / rulebook-style) vs delayed until Ash Fall 2 (Game 7 12-player tuning).
- **RESOLVED — CADEN (Nov 16, 2026): team only at 10+ players** (exact role below 10). ~~**Witness: exact role vs team only.**~~ Original: Game 6 and the app use exact role; Game 7 used team-only at 12 players.
- **Does a shield end if the Overseer dies?** Game 6 / the app: no, until Lumination ends. Game 7 primer: yes.
- **RESOLVED (CADEN, Nov 17 card, 8:25 PM MT: "Yes, back-to-back is fine").** ~~**May the Overseer shield the same player (including self) on a later night?**~~ Role text and the app allow a repeat; the Game 6 GM said no after a self-shield.
- **Voice of the Accord public reveal.** Game 7 was a Caden trial with no vote-math effect. Adopt or drop?
- Still OPEN from Ahsoka: Civic no-execution win; Civic vs parity in the same moment; converted Paradox for parity; former-Ashen share when the Blade dies; Sunmark self-target, shield vs shot, and Paradox-as-Ashen; dead final vote single-use vs next-Accord-only; items 7–12 and 15.

---

## 2026-11-15, 11:44 PM MST — Change: published Ahsoka's rulings and nomination UI to the same Page

The live Page (`canvas_id` `afb4ae96-0f4c-48ad-9c48-dda54c4cf686`, title “Ashes of Lumination — Companion”) was updated from the same `canvas-source.tsx` so the harness and the Page stay on one implementation. The publish landed the Dawn Accord nomination flow (table practice, with GM override), Sunmark active-Blade hit (Caden), GM recharge threshold (default 6), Unaligned 7–9 picker, parity wording, dead-role log wording, last-vision public log line, PracticeTag, NominationForm, and the related Setup / Dawn Accord GM controls.

Verification after publish:

- Live source matches `/workspace/game/local-render/canvas-source.tsx` (4,843 lines). The ReadCanvas export differs only by a missing final newline.
- Logo sha256 `272f83f2e67466a63418ca0ab749657c90227ff0006127f3f365a99bac0db082` (24,196 bytes) matches `/workspace/game/web-logo/logo-640.webp`.
- All 26 portraits match `/workspace/game/web-portraits/*.webp` byte-for-byte.
- Faction symbols match `/workspace/game/web-symbols/`: Lumen sha256 `2747dec844f6d350519b9c973ad8bba9b4206e4eac9bcfdb014e14630e1ecf15` (5,620 bytes), Ashen `cff9d802fc21d73cecb1dac62ef31e5a02396760684d49bb9f2200bfad9e743f` (5,134 bytes), Unaligned `f6bc0644d691aa6fbed8a629c140a0f6573c59d85df367b5fa7922524d159e43` (3,886 bytes).
- Ahsoka snapshot line is still “Ashes of Lumination — game update for Ahsoka” (no trailing period).

`/workspace/game/intended/canvas-src-intended.tsx` and `canvas-src-live-published.tsx` were refreshed to this published source.

---

## 2026-11-15, 11:54 PM MST — Game 8 replay, Silent Hand public lists, takeover leak, final-vote fix, realistic v2

### Game 8 script and replay

Script: `/workspace/game/sim/scripts/playtest-game8.json` (Setup H, 12 players, seating P2, P4, P8, P7, P10, P6, P12, P5, P1, P3, P11, P9). Roles from the Game 8 log / draw: P1 Silent Hand, P2 Tyrant, P3 Warden, P4 Shadow Blade (Masked Self Known), P5 Voice, P6 Mind, P7 Shooter (Masked Quadrant Judge), P8 Parallax (Ash Touched), P9 Red Scar, P10 Elder (Masked Watching Eye), P11 Bearer, P12 Overseer (Masked Civic Luminary). `rechargeAt` 6. Transcripts: `/workspace/aol-playtest/game8.md` plus `g8_setup.json` / `g8_draw.json`.

First run crashed with `execute: unknown NO_EXEC`. The harness `execute` step only resolved living names. Fixed in `lib/run-game.mjs` to accept `NO_EXEC` / “No execution” / `NoExec` and call `executeNominee(state, NO_EXEC)`. Not an app bug.

The Blade’s Ash Fall 5 and 6 kills use action `kill` (engine label “Shadow Blade kill”), not `inheritedKill`. Ash Fall 4 is the night of peace (`ashKind` “none”); `nightOfPeace` clears at the end of that resolve, so the Ash Fall 5 kill is legal.

After the later final-vote fix (below) and engine rebuild, the replay is a clean table match: **winner shadow**, 6 rounds, 0 crashes, 0 invariant issues, 0 expect mismatches. Outputs: `/workspace/game/sim/out/playtest-game8.{json,md,state.json}`. Games 6 and 7 were re-run on the same engine: Game 6 Lumen, 5 rounds, 0 mismatches; Game 7 Ashen, 3 rounds, 0 mismatches.

Notable phase matches:

- Lumination 1: P6 nominated P7, then died to the Sunmark shot. That nomination still counted. Matches `computeDawnBallot` (no living-nominator check) and Ahsoka’s Game 8 ruling.
- Recharge at 6 living after Dawn Accord 3: Shooter shot and Red Scar day-kill came back, matching the GM threshold of 6.
- Night of peace Ash Fall 4 after the Tyrant was executed Dawn Accord 3; Blade active from Ash Fall 5; Blade (P4) killed P1 on Ash Fall 6 and won as last one standing.
- Dawn Accord 5 public Votes line (table practice): `Votes: P4 → P1; P8 → P3; P7 → No execution; P12 → P3; P5 → P3; P1 → P3; P3 → No execution; P9 → No execution. Counted tally: P1 1, P3 4, No execution 2.` P3’s Silent Hand–voided vote is listed as cast and is not in the counted tally. P7 and P9 (dead, one final vote) both count for No execution.
- After takeover, player-facing output for remnant P9 (former Red Scar) has no takeover language in `publicNotices`, results, or own-role text (`visibleForbids` passed). Ahsoka privately telling the Red Scar about the Blade takeover was a GM error, not an app mismatch.

### App bugs found and fixed

1. **Former Ashen were told about takeover.** `RoleCardBlock` appended “ — conflict state has changed; work this out in play” whenever `shadowTakeover` and `team === "Ashen"`, including dead remnant Ashen (Game 8 P9 after Dawn Accord 4). Removed. GM reminders, the Ahsoka snapshot, and the GM-only log still say takeover is secret and former Ashen are not told. The Blade’s own night-of-peace / kill UI is unchanged.

2. **Silent Hand targets could see they were silenced.** NominationForm showed “Your nomination will not count tonight” when weight was 0. Dawn Accord used a separate card, “Your vote will not count tonight.” Player-facing forms are now identical for everyone. The Voice ×2 badge is keyed off `roleId` (shown as ×2), so a silenced Voice still sees the same badge. GM still sees voids.

3. **Public nomination and vote lists.** The app previously did not auto-publish player-facing lists; the GM panel marked “(void)”, which would leak the Silent Hand if read out. Player-facing `publicNotices` now follow Ahsoka’s table practice: nominations voided by the Silent Hand are omitted; voided votes are listed as cast but not counted, with no void label. The GM Dawn Accord panel shows a public-list helper plus a GM-only list that includes voids. This procedure is TABLE and still OPEN.

4. **Dead final vote was spent by a leftover living vote.** On Game 8 Dawn Accord 5, the public Votes line listed P9 → No execution, but the counted tally was No execution 1 (table: 2, P7+P9). `startRound` called `consumeFinalVotes` while the prior dawn’s votes were still in the map. P9, executed on Dawn Accord 4, was then dead with `finalVoteAvailable` still true, so their leftover living vote was treated as spending the one final vote. Fix: `GameState.dawnLivingIds` is set in `computeDawnBallot` to the living player ids at dawn start; `consumeFinalVotes` skips anyone who was living at that dawn. A living vote from a player later executed (or soulbound) the same Dawn Accord does not spend the final vote. Outcome of Dawn Accord 5 is unchanged (P3 still executed 4–1 or 4–2), but the tally now matches the table. `voteWeight` for a dead player still ignores `voteSilenced` (P8’s Dawn Accord 2 Silent Hand vs dead final vote remains OPEN).

### Realistic sim policy v2 (AI-policy results, not table balance)

The 51–9 Ashen skew under version 1 mostly reflected a weak Lumen policy. `/workspace/game/sim/lib/realistic.mjs` was rewritten and the same 20+20+20 seeds were rerun (8p 200–219, 12p 300–319, 18p 400–419). 0 crashes, 0 invariant issues, every game finished with a winner. Current summaries: `/workspace/game/sim/out/realistic-v2-{8,12,18}-summary.json` (also written over `realistic-{8,12,18}-summary.json`).

Version 2 policy: Lumen information roles share the result they actually received ~90% of the time (poison / Ash Touched can already make that text false); Lumen nominations and votes coordinate on a sticky living Ashen read; living Ashen sometimes fake-claim once (~35%, sticky, not treated as revealed Lumen); the Overseer shields the most valuable revealed Lumen first, then a non-fake claim, then an information role, then self.

**AI-policy results — version 1 (weaker Lumen coordination), 11:35 PM MST**

| Players | Lumen | Ashen | Syndic | Shadow | Avg rounds |
| --- | --- | --- | --- | --- | --- |
| 8 | 1 | 19 | 0 | 0 | 2.8 |
| 12 | 4 | 16 | 0 | 0 | 4.0 |
| 18 | 4 | 16 | 0 | 0 | 6.9 |
| **All 60** | **9** | **51** | **0** | **0** | — |

**AI-policy results — version 2 (improved Lumen coordination), same seeds**

| Players | Lumen | Ashen | Syndic | Shadow | Avg rounds |
| --- | --- | --- | --- | --- | --- |
| 8 | 3 | 17 | 0 | 0 | 2.9 |
| 12 | 4 | 16 | 0 | 0 | 4.8 |
| 18 | 2 | 18 | 0 | 0 | 7.3 |
| **All 60** | **9** | **51** | **0** | **0** | — |

Version 2 improved 8-player Lumen wins (1 → 3) and lengthened 12- and 18-player games. The 18-player Lumen count went 4 → 2. The all-60 total is still 9–51. These are AI-policy results, not a claim about true table balance. No Syndic or Shadow endings appeared in either 60-game batch.

### Game 8 table tunings not adopted (rules questions, not app bugs)

These were not silently written into the app:

- Red Scar day kill unavailable in Lumination 1 (Game 8 table).
- Elder can never be Ash Touched (this game forced Ash Touched onto P8).
- Voice public reveal at the start of Lumination 3 (Caden trial).
- Bearer result delayed until Ash Fall 2 (same 12-player tuning as Game 7; app still shows it at deal).
- Shield ends if the Overseer dies (Game 8 primer / Game 7; Game 6 and the app keep the shield until Lumination ends). No Game 8 outcome turned on the Lumination 3 shield of P3.
- Last-vision table text named P10 as the Elder; the app’s last-vision public line does not name the Elder (wording still OPEN).
- P8’s Dawn Accord 2 final vote if the Silent Hand still applies — flagged, still OPEN. The app’s dead path in `voteWeight` ignores `voteSilenced`.
- Silent Hand public-list procedure is TABLE and still OPEN (the app now matches Ahsoka’s stated practice).

---

## 2026-11-15, 11:54 PM MST — Change: published Game 8 app fixes to the same Page

The live Page (`canvas_id` `afb4ae96-0f4c-48ad-9c48-dda54c4cf686`, title “Ashes of Lumination — Companion”) was updated from the same `canvas-source.tsx` so the harness and the Page stay on one implementation. This publish landed: removal of the RoleCardBlock takeover leak to former Ashen; identical player nomination/vote forms (no “will not count tonight”); player-facing public nomination and vote notices that follow the Silent Hand table practice (still OPEN); GM public-list vs GM-only void lists; `dawnLivingIds` and the `consumeFinalVotes` fix so a leftover living vote does not spend the one final vote.

Verification after publish:

- Live source matches `/workspace/game/local-render/canvas-source.tsx` after trailing-newline normalize (4,892 lines in the local file; the ReadCanvas export may carry an extra blank line at the end).
- Logo sha256 `272f83f2e67466a63418ca0ab749657c90227ff0006127f3f365a99bac0db082` (24,196 bytes) matches `/workspace/game/web-logo/logo-640.webp`. Concatenated `"" +` string literals were joined before hashing (a single quoted fragment is not the full asset).
- All 26 portraits match `/workspace/game/web-portraits/*.webp` byte-for-byte.
- Faction symbols match `/workspace/game/web-symbols/`: Lumen sha256 `2747dec844f6d350519b9c973ad8bba9b4206e4eac9bcfdb014e14630e1ecf15` (5,620 bytes), Ashen `cff9d802fc21d73cecb1dac62ef31e5a02396760684d49bb9f2200bfad9e743f` (5,134 bytes), Unaligned `f6bc0644d691aa6fbed8a629c140a0f6573c59d85df367b5fa7922524d159e43` (3,886 bytes).
- Ahsoka snapshot line is still “Ashes of Lumination — game update for Ahsoka” (no trailing period).

`/workspace/game/intended/canvas-src-intended.tsx` and `canvas-src-live-published.tsx` were refreshed to this published source.

A concise overnight wrap-up is at `/workspace/game/sim/OVERNIGHT-SUMMARY.md`.

---

## 2026-11-16, 8:15 AM MST — Game 9 replay (18 players), four app fixes, one UI fix

Source: Ahsoka's `/workspace/aol-playtest/game9.md`, `game9_summary.md`, `/workspace/aol-public/game9_END.txt`. Table result: **Lumen win, Day 7** (P11 The Ashen Mind executed at Dawn Accord 7). First 18-player replay, and the first live tests of The Echo Thief, The Syndic, and The Failsafe.

### Script and replay

- Script: `/workspace/game/sim/scripts/playtest-game9.json`, generated by `/workspace/game/sim/tools/make-game9.py`. Outputs: `/workspace/game/sim/out/playtest-game9.{json,md,state.json}`.
- 18 players in seating order (P11, P2, P8, P9, P6, P13, P4, P18, P12, P15, P5, P7, P16, P14, P3, P17, P1, P10), so P10's Bearer neighbors are P1 and P11. Roles from the setup table. P9 (Integrity Warden) is Ash Touched. Mind masks are the Round 1 table disguises (P1 Ashen Child, P2 Lucid Catalyst, P7 Self Known, P12 Luminary Paradox, P13 Lumen Guard, P17 Necroreclaimer, P18 Quadrant Judge).
- `rechargeAt` 8 (the first 16–20 threshold in rb.md §5). The second threshold at 4 living was never reached.
- Every Ash Fall action, both Syndic invites with their declines, every nomination, every vote (dead final votes and saves included), and every Silent Hand and Failsafe target is scripted. The Watching Eye is submitted last on Ash Fall 1 so its random Mire Touched cannot change another result that night. Seed 25 makes that random poison land on P9, as it did at the table.
- Final run on the fixed engine: **winner lumen, 7 rounds, 0 crashes, 0 invariant issues, 0 expect mismatches** (23 phase checks). Survivors: P3, P4, P7, P9, P15, P17, the same six as the table.

### Phase-by-phase comparison (app vs log)

| Phase | Table | App | Result |
| --- | --- | --- | --- |
| Deal | P10: P1 and P11 do not share alignment | same | match |
| AF1 | P2 shields self; P17 cancels P1 (no result); P4 voids P13; P5 = P7 SAME; P9 told "Ash Touched" on P6; P13: P12 not Tyrant; P18 miss, P9 Mire Touched; P10 killed; 17 alive | same after fix 1 (before the fix, P9 was told "neither") | match after fix |
| DA1 | Ballot P1/P12/P7; P1 16, P7 2, P12 0; P13 nomination left off the public list; P10 final vote used | same | match |
| AF2 | P8 learns P1 = Lumen; P14 copies the Elder, P9 appears Lumen; P9 cancelled (no result); P5 = P9 SAME; P18 hit, killer = P16; P18 killed; 15 alive | P8 learns "The Foresight Elder" (exact role); everything else the same | GM table call (Witness team-only at 10+) |
| L2/DA2 | P7 shot P8, miss; ballot P9/P2/P12; P12 7, P2 6, P9 3; P12 executed | same | match |
| AF3 | P5: P6 NOT same; P9 told "Ash Touched" on P5; P13: P6 not Tyrant; P8 killed; 13 alive | same after fix 1 | match after fix |
| L3/DA3 | P6 day kill on P9 cancelled by Failsafe; invite to P7 declined; ballot P16/P2/P6; P2 6, P16 5, P6 5; P2 executed | same, but the app spends P6's use (see M3) | match on outcome |
| AF4 | P14 (copied Overseer) shields P16; P5: P16 NOT same; P9 told "Ash Touched" on P6; P13 killed (Blade); 11 alive | before fix 2, the Echo's shield was ignored; after it, "P16 is Shielded" | match after fix |
| L4/DA4 | P6 day kill on P5 cancelled; invite to P15 declined; ballot P6/No execution; P6 11; P6 executed | same | match |
| AF5 | P17 cancels P16, so the kill on P5 is blocked; P5: P14 NOT same; P9 told "Ash Touched" on P16; no death | same after fix 1 | match after fix |
| L5/DA5 | P14 (copied Red Scar) day-kills P5; ballot P16/No execution; P16 executed; 8 alive, P7 recharges; P14 inherits the kill after a night of peace | same. The harness skips the UI; in the live UI the Echo's copied day kill was blocked by "No use remaining" (fix 3) | match after fix |
| AF6 | Night of peace; P14 submits nothing; P9 told "Ash Touched" on P14; no death | same. Before fix 4, a copied-Tyrant kill from P14 would have landed (shown with `scripts/echo-night-of-peace.json`) | match after fix |
| L6/DA6 | P7's recharged shot hits P14; all counted nominations were on P14, so there is no ballot and no execution | same outcome. The app's ballot is just "No execution" | GM table call, equivalent |
| AF7 | No living inheritor; P9 cancelled (no result); no death | same ("No living successor" in the log) | match |
| L7/DA7 | Ballot P9/P11/No execution; P11 8, P9 4; P9's vote is cast but not counted; P13 saves; **Lumen win** | same; "Lumen victory: all Ashen and The Shadow Blade are eliminated." | match |

### Mismatches and classification

1. **Ash Touched Warden result (app bug, fixed).** App: a falsified Warden was always told "neither". When the target is clean, that is the true answer, so an Ash Touched Warden got correct information. Table (Game 9 setup procedure): if the target has any condition, say "neither"; if it has none, say "Ash Touched". Fix in the `checkOther` branch of `resolveAshFall`: `label = at || mt ? "neither" : "Ash Touched"` when the Warden has false info. The specific false value is TABLE; see Q-G9-1.
2. **Echo Thief's copied shield, Failsafe, or Catalyst swap was ignored (app bug, fixed).** The UI offered the copied Overseer shield, but the shield, Failsafe, and Catalyst resolve passes looked only at `ashKindFor`, which returns "none" for the Echo. Game 9 AF4: P14's shield on P16 did not land. It did not change the outcome, because nobody attacked P16 that round. Fix: those three passes also accept `echoAshKind` (the info and poison passes already did). Rulebook: the Echo copies passive and active abilities.
3. **Echo Thief couldn't use a copied charged day ability in the UI (app bug, fixed).** The Echo is not a charged role, so it held 0 uses. The Lumination form showed "No use remaining" for a copied Red Scar day kill, even though the rulebook says the Echo gets the copied ability's normal fresh uses. The harness skips the UI, so the L5 day kill still resolved. Fix: `executePlayer` gives the living Echo `startingCharges` (1) when the executed role is charged. A carried-over copy after a no-execution Dawn Accord keeps spent uses spent, as written.
4. **Echo Thief's copied Tyrant kill worked during the night of peace (app bug, fixed).** `echoAshKind` returned `killOrSkip` for a copied Tyrant even on the night of peace, so the kill was not labelled "Inherited" and the pause did not apply. Both rulebook copies say "The Echo Thief can't use a copied Tyrant kill during the night of peace." P14 didn't submit one at the table, so there was no outcome mismatch. The regression script `scripts/echo-night-of-peace.json` (Game 9 up to AF6, with P14 killing P15 and the Failsafe removed) showed P15 dying before the fix and surviving after it. Fix: `echoAshKind` returns "none" for a copied Tyrant while `nightOfPeace` is set.
5. **Voice of the Accord leaked by the public lists (app bug, fixed).** The player-facing `Nominations:` and `Votes:` notices marked the Voice "×2" before any reveal (P15 at DA1 to DA3). At the table the Voice stayed hidden until the L4 confirmation. The GM view still shows weights. The public "Counted tally" is unchanged, and it still makes the arithmetic mismatch Ahsoka flagged after DA2 (more names on P2 than on P12, yet P12 was executed). See Q-G9-2.
6. **Last Witness exact role vs team (GM table call).** At 10+ players Ahsoka gives the team only (rb.md §11 GM tuning). The app gives the exact role. Not changed.
7. **Red Scar day kill cancelled by the Failsafe (GM table call).** Table: the use was not spent (P6 tried again in L4). App: the use is spent when submitted, which matches the rulebook ("Protection, immunity, or cancellation stops the kill, and the charge is still spent"). No outcome difference, because the L4 attempt was cancelled too. See Q-G9-3.
8. **DA6 with no living nominee (GM table call, equivalent).** Table: no ballot, no execution. App: nominations on the shot P14 lapse, and the ballot is "No execution" alone. Same outcome. Nominations do not reopen in either. See Q-G9-4.
9. **Count slips in the log (log ambiguity, no effect).** DA5 says "P16 10 counted", but the listed voters (P3, P4, P7, P9, P11, P14, P15 ×2, P17) add up to 9, and the app counts 9. L5 says "P16 x9" nominations; the app counts 10 by weight (P5's nomination still counts after its day death; P15 counts as 2). Neither changes the ballot or the execution.
10. **Harness/script slip (fixed in the script).** My first expect said 16 alive after AF2; the log's 15 is correct.

Also fixed while reading the 18-player charge screens (UI only): the "No use remaining. You regain 1 use when N players remain" hint passed the starting player count as the threshold, so it never appeared (at 18 players, or at 12). It now uses the GM `rechargeAt`.

### 18-player notes

- **Role counts:** the app deals 4 Ashen, 2 Unaligned, and 12 Lumen at 18, which matches Game 9. The 2 Unaligned at 18–20 is still the app's placeholder (Caden's chart says 1–2). The in-app Deal button picks Lumen roles at random; a GM-picked set like Game 9's is only possible as a forced deal in the harness (still open as a product call).
- **Recharge:** the app has one GM-set threshold (default 6, the 12-player table value). At 18, rb.md §5 says 8, plus a second recharge at 4. A GM running 18 in the app has to set 8 by hand, and the app cannot do the second recharge at 4. It didn't matter in Game 9, which ended at 6 alive. The in-app distribution text still cites the old 15/10/5 chart. Not changed, because the recharge chart is OPEN with Caden.
- **Succession depth:** at 18 the full chain (Blade, then Red Scar, then Echo Thief) was used for the first time. The app's succession and "No living successor" handling matched the table.
- **Syndic:** never recruited anyone (both invites declined). The app's Lumen win with a living, unfinished Syndic matches the planned call (open Q #5).

### Regression check

After all fixes and `node run.mjs build`: Game 6 Lumen (5 rounds), Game 7 Ashen (3 rounds), Game 8 Shadow (6 rounds), Game 9 Lumen (7 rounds), smoke-8 Ashen, civic-4-no-exec Lumen, echo-night-of-peace no death on AF6. **All have 0 crashes, 0 issues, 0 mismatches.** Fuzz batch, 50 games at 5–20 players (seeds 100–149): 0 crashes, no high codes, lumen 16 / ashen 33 / shadow 1. That differs from the 11:14 PM batch because the Echo and Warden rules changed. Realistic 18p (seeds 400–419): 0 crashes, ashen 18 / lumen 2. Those are AI-policy results, not table balance.

`canvas-source.tsx` **changed** (4,901 lines; pre-change copy at `/workspace/game/sim/out/canvas-source.pre-game9.tsx`). The live Page has **not** been republished. Art data URIs, the title, and the Ahsoka snapshot line were not touched.

### New rules questions from Game 9 (for Ahsoka/Caden)

- **Q-G9-1 Warden false info.** Confirm the false value for an Ash Touched or Mire Touched Warden: "neither" if the target has any condition, "Ash Touched" if it has none. The app now does this. Should a falsified Warden ever say "Mire Touched" or "both"?
- **Q-G9-2 — PARTLY RESOLVED (CADEN, Nov 16): voided nominations and votes are shown as normal everywhere and only quietly dropped from the count.** The Voice ×2 display and the visible tally arithmetic are still open. Original: **Public vote list vs hidden Voice and voids.** With who-voted-whom published, a hidden ×2 plus hidden voids gives a visible arithmetic mismatch that can expose the Voice and the Silent Hand (Game 9 DA2). Options: publish only the winner, publish counts without names, or reveal the Voice's ×2. The app currently publishes names (no ×2) plus a counted tally.
- **Q-G9-3 Failsafe vs a charged day ability.** Game 9 treated a Failsafe-cancelled Red Scar kill as not spent. The rulebook (and the app) spend it. Pick one.
- **Q-G9-4 No living nominee at the Dawn Accord** (after a day shot or day kill): no ballot (table), or reopen nominations?
- **Q-G9-5 — RESOLVED (CADEN, Nov 16): the 5-player rule replaces thresholds** (no second threshold needed). Original: **Recharge at 16–20:** confirm 8 plus a second recharge at 4. If so, the app needs a second threshold and per-count defaults.
- **Q-G9-6 Echo copying a win-condition passive** (Civic Luminary) gives no usable ability. The planned call matches the app, which offers no action. Still unconfirmed.
- **Q-G9-7 Lumen win with a living, unfinished Syndic** (planned call; the app does this). Still unconfirmed.
- **Q-G9-8 Copied Tyrant kill vs inherited kill:** the app now pauses the copied kill on the night of peace (rulebook). When the Echo is also the successor, the UI shows one kill form (no stacking). Confirm that is all that's needed.
- Carried from Ahsoka's summary, design only, no app change: a Failsafe-cancelled player isn't told why; dead statements can't pass on role results; Eye or Witness info dies with a same-night kill; the Blade's mask choice; and the Ash Touched Warden as a Lumen liability (Game 10 variant).

---

## 2026-11-16, 8:17 AM MST — Change: published the Game 9 fixes to the same Page

Before editing, the live Page (`canvas_id` `afb4ae96-0f4c-48ad-9c48-dda54c4cf686`) matched the pre-Game 9 source exactly. One EditCanvas call with 9 replacements applied all the Game 9 changes, and the Page recompiled cleanly. The changes: Warden false info (TABLE, pending Caden); the Echo Thief's copied shield, Failsafe, and Catalyst swap now resolve; the Echo's copied Tyrant kill is paused on the night of peace; the Echo gets fresh uses for a copied charged ability; the Voice ×2 marker is removed from player-facing lists (pending Caden); and the recharge hint now uses `rechargeAt`.

Verification after publish:

- Live source (re-read with ReadCanvas) matches `/workspace/game/local-render/canvas-source.tsx` exactly after trailing-whitespace normalization (4,901 lines).
- The logo's sha256 is `272f83f2e67466a63418ca0ab749657c90227ff0006127f3f365a99bac0db082` (24,196 bytes) and is byte-identical to `web-logo/logo-640.webp`.
- All 26 portraits match `web-portraits/*.webp` byte-for-byte. The three faction symbols match `web-symbols/` byte-for-byte: Lumen `2747dec8…` (5,620 bytes), Ashen `cff9d802…` (5,134 bytes), Unaligned `f6bc0644…` (3,886 bytes).
- The Page title is still "Ashes of Lumination — Companion". The Ahsoka snapshot line is still "Ashes of Lumination — game update for Ahsoka".
- Local render smoke test (`/workspace/game/sim/tools/smoke-render.mjs`: esbuild bundle plus headless Chrome) passed. The page loads, the logo decodes, 17 images load, and "Load sample table" plus "Deal roles" work with no page exceptions. The screenshot is `/workspace/game/sim/out/smoke-render-gm.png`. Two console messages showed up: a 404, most likely the favicon, and one `ERR_INVALID_URL`. Neither is identified, and both appear identically with the pre-change source, so they predate this change.

`/workspace/game/intended/canvas-src-intended.tsx` and `canvas-src-live-published.tsx` were refreshed to this published source.

---

## Game 10 replay (18 players) — Nov 16, 2026, 8:45 AM MST (America/Denver)

Sources: `/workspace/aol-playtest/game10.md`, `game10_summary.md`, `/workspace/aol-public/game10_*.txt`. Script: `scripts/playtest-game10.json`, generated by `tools/make-game10.py 261`. Settings: `rechargeAt` 8, P13 (The Last Witness) forced Ash Touched, the seven Mind masks from the log. Seed 261 puts the Watching Eye's AF1 and AF2 miss poisons on P3 and P1, as at the table. 18 expects plus 1 new negative check. **Result: Lumen win at L6, survivors P6, P7, P8, P11, P12, P14, P18. 0 crashes, 0 issues, 0 mismatches.** Pre-edit copy: `out/canvas-source.pre-game10.tsx`. The Page was **not** republished.

### Phase table

| Phase | Table | App | Verdict |
| :--- | :--- | :--- | :--- |
| Deal | P7 Bearer: P12/P6 share alignment | same | match |
| AF1 | P18 self-shield; P9 cancels P12; P14 mutes P5; Elder P13 Lumen; Eye miss poisons P3; Parallax P10+P16 not same; Blade P8 not Tyrant; Warden P3 "Mire Touched"; P10 killed; 17 alive | same (seed 261) | match |
| DA1 | P17 executed, P17 14 / P16 4 by weight; log published 13 | P17 14, P16 4 | log ambiguity (table slip) |
| AF2 | P13 Witness result: P17 was "Unaligned" (false team); P9 cancels P16 (no result); Elder P16 Ashen; Eye miss poisons P1; Echo-Warden P3 on P7 "neither"; P13 killed; 15 alive | Witness: "The Civic Luminary" (falsified exact role); everything else the same | GM table call / app gap (see 1) |
| L2 | P11 shot misses P16; P1 Scar kills P9; 14 alive | same | match |
| DA2 | P3 executed 7–6–2 (Voice ×2 decides) | P3 7, P16 6, No execution 2 | match |
| AF3 | P18 shields P11, kill blocked; Eye poisons P14 | kill blocked; Eye poisons P18 | match (random pick differs, no effect) |
| DA3 | P16 executed 11–4 | P16 11, P5 4 | match |
| AF4 | P5 killed; public last vision "P18 is Lumen"; Eye poisons P18 | P5 killed; "Last vision — P18 appears Lumen"; Eye poisons P12 | match (random pick differs, no effect) |
| DA4 | P4 executed 11–1; P16's dead vote not prompted | P4 11, P14 1 (no P16 vote scripted) | match (GM slip reproduced) |
| AF5 | kill on P11 blocked again; Eye poisons P8 | blocked; Eye poisons P6 | match (random pick differs, no effect) |
| DA5 | P1 executed (10 living by weight + P4 dead); P1's own vote void | P1 11 | match |
| AF6 | P2 killed; 8 living, P11 recharges; Eye poisons P12 | same (P12) | match |
| L6 | P11 shot hits P15 Tyrant; Lumen win | same | match |

### Mismatches and classification

1. **Last Witness result while Ash Touched (GM table call; 18-player app gap).** Table: at 10+ the Witness learns only the team (TABLE practice, also in Game 9), and an Ash Touched Witness got a random false team ("Unaligned" for P17, truth Lumen). App: it reports the exact role, and the false version (`pickFalseLumen`) is another Lumen role, so the team stays true. P13 died the same night, so no effect this game. Not fixed: team-only at 10+ and the false-team draw are TABLE/OPEN. See Q-G10-1.
2. **Executed Echo Thief "copied itself" (app bug, fixed).** At DA2 the executed Echo (P3) got a private result "You copy The Echo Thief …", because `executePlayer` looked for a living Echo before applying the death. The table gave P3 nothing (dead, nothing to copy into). Fix in `executePlayer`: the Echo lookup now excludes the executed player (`p.id !== t.id`). New harness expect kind `resultForbids` (in `lib/run-game.mjs`) fails on the pre-Game 10 source and passes now.
3. **Watching Eye random-poison pool (GM table call).** Table: living players excluding that night's kill victim. App: all living players at resolve time (the victim can be picked). Different picks on AF3 to AF5 only because the RNG differs; no one reached 3 poisons, and no poisoned seat had info that night. Not fixed. See Q-G10-2.
4. **DA1 count (log ambiguity).** The table published P17 13; the Voice is ×2 always, so the true count is 14. The app shows 14. Already corrected in the table log.
5. **P16 dead vote not prompted at DA4 (GM slip).** Equivalent to the app with no P16 vote; no result change.
6. **Harness/script:** the first run (seed 10) put the AF1 Eye poison on the wrong seat. Not an app bug; fixed by seed search (261).

### 18-player notes / app gaps

- One `rechargeAt` threshold only. The rb.md 16–20 rule (8 and again at 4) still has no second threshold (Q-G9-5). It didn't matter here: the game ended at 7 living.
- Witness false info keeps the true team (above).
- The Game 10 TEST VARIANTS are not in the app: Warden excluded from the Ash Touched pool (the app's AT is a free GM pick, so this is a GM choice); the Eye's same-night dead-statement share; the Echo can't copy the Red Scar. The last two never triggered.
- The app already shows a same-night Eye poison in the Warden's result when the Eye is resolved first (submission order), matching the AF1 GM ruling.

### Regression (after the fix)

Games 6 (lumen, 5 rounds), 7 (ashen, 3), 8 (shadow, 6), 9 (lumen, 7), 10 (lumen, 6), echo-night-of-peace, smoke-8, civic-4-no-exec: 0 crashes, 0 issues, 0 mismatches. fuzz-batch 50 games (5–20p, seed 100): 0 crashes, no high codes. realistic-batch 20 × 18p (seed 1810): 0 crashes. Local render smoke test passed (logo OK, 17 images, deal works). It showed the same two old console messages (404, ERR_INVALID_URL).

### New rules questions (Game 10)

- **Q-G10-1 — RESOLVED (CADEN, Nov 16): team only at 10+; an Ash Touched Witness gets a false team** (which wrong team is shown is still pending; the app picks at random). Original: **False Witness result at 10+.** Confirm team-only at 10+, and that an Ash Touched Witness gets a random false team (from the two wrong teams). If confirmed, the app needs a team-only mode and a false-team draw.
- **Q-G10-2 Eye random-poison pool.** Should the night's kill victim be excluded from the pool (table), or is every living player eligible (app)?
- **Q-G10-3 Eye after the Ash Touched player is dead.** Every check is a guaranteed miss and self-poisons the table. Game 11 tests "is this the current killer?" with no miss poison.
- **Q-G10-4 Last vision vs roles hidden on death.** A public last vision confirms the dead Elder.
- **Q-G10-5 — RESOLVED (CADEN, Nov 17 card: "Yes, back-to-back is fine").** Original: **Consecutive Overseer shields** (allowed as written) can lock one seat safe for the whole game. Leave it, or cap repeats?
- **Q-G10-6 Quiet night vs night of peace.** Blocked kills get misread as the Tyrant's death.
- **Q-G10-7 Silent Hand muting the accused on trial day** (voids their own nomination and vote).
- **Q-G10-8 Warden vs a same-night Eye poison.** Report the condition for the following day (poison included)? The app does this when the Eye resolves first.
- **Q-G10-9 Dead statements restating earlier public claims** (P9 at DA3).
- **Q-G10-10 A cost for voting out The Ashen Mind** (Game 11 variant c).
- Still open: Voice display (Q-G9-2), Failsafe vs charged uses (Q-G9-3), no living nominee (Q-G9-4), second recharge at 4 (Q-G9-5), Echo + win-condition passive (Q-G9-6), Lumen win with a living Syndic (Q-G9-7, applied again), copied Tyrant kill on the night of peace (Q-G9-8).

---

## Game 11 replay (18 players) — Nov 16, 2026, 9:12 AM MST (America/Denver)

Sources: `/workspace/aol-playtest/game11.md`, `/workspace/aol-public/game11_*.txt` (the end is in `game11_END.txt`). Script: `scripts/playtest-game11.json`, generated by `tools/make-game11.py 11`. Settings: `rechargeAt` 8, P18 (The Parallax) forced Ash Touched, the Round 1 Mind masks from the log. Seed 11 puts the Watching Eye's AF1 miss poison on P2, as at the table. There is also a focus variant, `scripts/game11-failsafe-only.json` (`make-game11.py 11 --failsafe-only`). It removes P4's AF5 shield on P9, so only the Failsafe stops the Blade's kill. **Result: Lumen win at DA5 (the active Shadow Blade P1 executed), 11 survivors as at the table. 0 crashes, 0 issues, 0 mismatches after the fix (1 before).** Pre-edit copy: `out/canvas-source.pre-game11.tsx`. The Page was **not** republished.

### Phase table

| Phase | Table | App | Verdict |
| :--- | :--- | :--- | :--- |
| Deal | P2 Bearer: P18/P3 do NOT share | same | match |
| AF1 | P4 self-shield; P13 cancels P17, so the kill on P18 fails; P6 mutes P16; Blade P15 not Tyrant; Eye P12 miss, poisons P2; Warden P14 neither; Elder P16 Lumen; Parallax (AT) told P18+P2 NOT same; 18 alive | same (seed 11) | match |
| L1/DA1 | P16's nomination void; ballot P7/P2/P3 (14/3/1); P7 executed 12–6 (P16's vote void, P10 ×2) | same, P16 omitted from public nominations, listed in Votes but not counted | match |
| AF2 | Echo P12 copies the Warden: P18 "Ash Touched"; Eye P18 correct, killer = P17 (GM slip: the reveal was given late, during L2); Failsafe on P17 again, so the kill on P11 fails; Witness P16: P7 was "Lumen" | same, with the killer given immediately; Witness gets "The Integrity Warden" | match / Witness = known gap Q-G10-1 |
| L2 | P2's nomination void; P15 shot misses P18; Scar day kill P16; ballot P18/P2/P17 (13/2/2) | same | match |
| DA2 | P17 (Tyrant) executed 14–4; secret Blade takeover by P1; night of peace next | same; takeover logged GM-only | match |
| AF3 | Night of peace, no kill; Echo's copied Tyrant kill paused (P12 also cancelled by the Failsafe); Eye P18 correct, **no killer reveal** (conservative call) | no kill; Echo has no kill form; Eye result names **P1** as the current killer | GM table call / rules question (see 2) |
| L3/DA3 | P3's nomination void; ballot P3 / No execution; P3 executed 14–1; 4 invites declined | same | match |
| AF4 | Echo copies the Syndic (unused); Blade P1 kills P15; Eye: killer = P1; Elder P5 Ashen | same | match |
| L4/DA4 | P14's nomination void; ballot P5/P14/P6; P5 (Mind) executed 13–1; P17's late vote not applied | same | match |
| AF5 start | Echo copies the Mind and gets the R5 snapshot | **before the fix: no snapshot** | app bug, fixed (see 1) |
| AF5 | Failsafe cancels P1, P9 also shielded, no death; Eye: killer = P1; Elder P1 Ashen | same; log "P1's kill was cancelled" | match |
| L5/DA5 | P1's nomination void; ballot P1/P9/No execution (10/2); P1 executed 11; Lumen win | same | match |

### Ahsoka's focus points

- **Eye "current killer" after the takeover.** AF4 and AF5: the app tells P9 "P18 is the Ash Touched player. The current killer is P1." This matches the table. AF3 (night of peace): the app already names P1, because `currentKillerName` returns the active Blade as soon as the takeover is applied. The table gave no reveal (note-19 conservative call). Not changed: the rulebook says "current killer if the Tyrant is dead", and whether that is the paused successor is OPEN. See Q-G11-1. Variant (b) never triggered, because the Ash Touched P18 survived. Every Eye check here was a correct standard check.
- **Echo copies.** Tyrant (DA2): the app's `echoAshKind` gives no kill on the night of peace, so there is no form and no stacking with the Blade. The copy ends when P3 is executed. Syndic (DA3): the app would offer the Echo an invite form in L4 (P12 didn't use it; semantics OPEN, Q-G11-2). Mind (DA4): **app bug fixed.** The Echo got no start-of-round snapshot. rb.md says the Echo "copies both passive and active abilities" for the following round, and the table gave P12 the R5 snapshot. Fix in `startRound`: a living Echo holding a copied Ashen Mind receives `mindSnapshot(...)` for that round. A new expect (P12 result "Start-of-round snapshot" at the start of round 5) fails on the old source and passes now.
- **Silent Hand voiding nominations.** All five voids (P16 L1, P2 L2, P3 L3, P14 L4, P1 L5) are left out of the public nominations and the ballot counts, and the same players' votes are listed but not counted. All five ballots and all five tallies match the table, with the Voice ×2 included.
- **Failsafe vs the Blade's kill at AF5.** It works in the full replay ("P1's kill was cancelled") and in the failsafe-only variant with no shield. P9 survives either way, so the Failsafe alone is enough.

### Other differences

1. **Echo-copied Mind snapshot (app bug, fixed).** See above.
2. **Eye killer reveal on the night of peace (GM table call).** See above, Q-G11-1.
3. **Witness at 10+ shows the exact role (known gap, Q-G10-1).** This time it was a true result, so only the format differs.
4. **AF2 Eye reveal given late (GM slip).** The app gives the killer at once, which is what the GM corrected to.
5. **P17's DA4 final vote arrived after the result, and P14's DA5 vote never came (table timing).** Scripted as SAVE / no vote; no outcome change.
6. **The Mind snapshot includes the Mind itself in the app.** The table's list leaves the Mind out. Cosmetic log ambiguity (rb.md: "every living player"); not changed.
7. **After the game ends, the Echo still gets a "You copy The Shadow Blade" result for P1's execution.** Harmless noise after the win; noted, not changed.

### 18-player notes / app gaps

- One `rechargeAt` threshold (no second recharge at 4). Not reached: the game ended at 11 living.
- Variants not in the app: (a1) AT pool (GM choice), (a2) Eye dead-share (not triggered), (a3) Echo can't copy the Red Scar (not triggered: the Scar survived), (b) Eye "current killer" check after the AT dies (not triggered), (c) team notes end when the Mind dies (the app has no team notes).
- The Echo copying the Tyrant's kill after a Blade takeover isn't limited to one nightly kill outside the night of peace (rb.md: copying and inheriting "don't stack"). It never came up because the copy ended after round 3. See Q-G11-3.

### Regression (after the fix)

Games 6–11, game11-failsafe-only, echo-night-of-peace, smoke-8, civic-4-no-exec: 0 crashes, 0 issues, 0 mismatches. fuzz-batch 50 (seed 100): 0 crashes, no high codes. realistic-batch 20 × 18p (seed 1810): 0 crashes. Local render smoke test passed (logo OK, 17 images, deal works). It showed the same two old console messages.

### New rules questions (Game 11)

- **Q-G11-1 — RESOLVED, CADEN ruling (Nov 16, 2026; see "Watching Eye ruling" below): a correct Eye check reveals only The Ashen Tyrant, so it never names the paused or active Blade.** Original question: Eye on the night of peace. After a takeover, the paused Blade is the successor. Should a correct Eye check that night name it (app), or reveal nothing (table)? Related: variant (b) wording confused P1 about when the Eye learns the killer.
- **Q-G11-2 — RESOLVED (CADEN, Nov 16): the Echo can't copy Unaligned roles**, so there is no Echo-Syndic. Original: **Echo-copied Syndic.** Whose syndicate does an Echo invite into, and can it count toward a Syndic win? The app currently offers a plain invite form.
- **Q-G11-3 — PARTLY RESOLVED (CADEN, Nov 16): a copied executed Tyrant is a one-time kill**, so it can't keep stacking. Whether Caden's "inherit a one time kill opportunity if the tyrant dies" also limits the Echo's succession kill is pending. Original: **Echo-copied Tyrant kill after a Blade takeover.** Does it end, pause, or stack with the Blade's kill once the night of peace is over?
- **Q-G11-4 — RESOLVED (CADEN, Nov 16): the Echo can't copy The Ashen Mind.** Original: **Echo-copied Mind after the Mind's death vs variant (c).** The Echo sees the snapshot, but team notes have ended. Confirm.
- **Q-G11-5 — RESOLVED, CADEN ruling (Nov 16, 2026; see "Watching Eye ruling" below): the Eye never reveals the current killer, so it cannot expose a secret Blade.** Original question: Eye exposing a secret Blade. A correct check names the active Blade, which undercuts the secret-takeover ruling. Intended?
- **Q-G11-6 Failsafe vs the Blade's nightly kill**: "attempt used up" for that night only. Confirm it doesn't affect later nights (the app and table agree).
- Still open: Q-G10-1 (Witness team-only / false team), Q-G9-3 (Failsafe vs charged uses), Q-G9-5 (second recharge at 4), Q-G9-7 (Lumen win with a living Syndic; not needed here, since the Syndic was executed).

---

## 2026-11-16, 9:13 AM MST — Change: published the Game 10 and Game 11 fixes to the same Page

Before editing, the live Page (`canvas_id` `afb4ae96-0f4c-48ad-9c48-dda54c4cf686`) matched `out/canvas-source.pre-game10.tsx` exactly (that is, the 8:17 AM publish). One EditCanvas call with 2 replacements applied both changes, and the Page recompiled cleanly:
- `executePlayer`: an executed Echo Thief no longer "copies itself" (Game 10).
- `startRound`: a living Echo Thief holding a copied Ashen Mind gets that round's start-of-round snapshot (Game 11; rb.md "copies both passive and active abilities").

Verification after publish:

- Live source (re-read with ReadCanvas) matches `/workspace/game/local-render/canvas-source.tsx` exactly after trailing-whitespace normalization (4,908 lines).
- The logo's sha256 is `272f83f2e67466a63418ca0ab749657c90227ff0006127f3f365a99bac0db082` (24,196 bytes) and is byte-identical to `web-logo/logo-640.webp`.
- All 26 portraits match `web-portraits/*.webp` byte-for-byte. The three faction symbols match `web-symbols/` byte-for-byte: Lumen `2747dec8…` (5,620 bytes), Ashen `cff9d802…` (5,134 bytes), Unaligned `f6bc0644…` (3,886 bytes).
- The Page title is still "Ashes of Lumination — Companion". The Ahsoka snapshot line is still "Ashes of Lumination — game update for Ahsoka".
- Local render smoke test (`tools/smoke-render.mjs`) passed: the logo decodes, 17 images load, and deal works with no page exceptions. The same two old console messages (404, `ERR_INVALID_URL`) showed up.
- Harness: Games 6–11, game11-failsafe-only, echo-night-of-peace, smoke-8, civic-4-no-exec were all clean on this source before the publish (see the Game 11 section).

`/workspace/game/intended/canvas-src-intended.tsx` and `canvas-src-live-published.tsx` were refreshed to this published source.

---

## 2026-11-16, 1:40 PM MST — CADEN ruling: Watching Eye (resolves Q-G11-1 and Q-G11-5), implemented and published

**Source check.** Confirmed in Ahsoka Tano's chat (agent `3c11a484-…`) from Caden's own messages (owner account `cu:523718337`):
- "the eye tries to guess who is ash touched. if they ask correctly then the tyrant is revield to them. however if the player is mire touch which is also a modifier then that player is cured and no inforamtion is given to the eye."
- In reply to Ahsoka's follow-up (wrong guess still poisons and counts toward three; suggest no further checks after a correct guess or after the Tyrant dies): "ageed go ahead with this".

**The rule (CADEN):**
- A correct check reveals only The Ashen Tyrant, never the current killer, so it never reveals The Shadow Blade.
- A Mire Touched target is cured, and the Eye gets no information.
- A wrong guess still poisons a random player, and that counts toward the three-poison death.
- After a correct find, or once the Tyrant is dead, the Eye has no further checks.

**App changes** (`canvas-source.tsx`, 13 replacements; pre-change copy `out/canvas-source.pre-eye-rule.tsx`; edits kept in `out/eye-rule/edits.json`):
- New state flag `eyeFound`. `eyeDoneReason()` replaces `currentKillerName()`, which is removed.
- `ashKindFor` gives the Eye no action once it has found the Ash Touched player or the Tyrant is dead. A copied Eye (Echo) stops once the Tyrant is dead.
- `resolveAshFall`:
  - A Mire Touched target is cured, and the Eye is told "Your check on X gives you no information tonight." No hit and no miss poison.
  - A hit says "X is the Ash Touched player. The Ashen Tyrant is T. You have no further checks." and sets `eyeFound`.
  - A miss poisons a random player, as before.
  - A falsified hit (a Mire Touched Eye) names a random non-Tyrant.
- The Eye's player screen shows "No Ash Fall action. You have found the Ash Touched player / The Ashen Tyrant is dead, so you have no further checks." The form note and role text are rewritten.
- GM view: a new reminder line says whether the Eye is still hunting or done, and why. The Ahsoka snapshot's table state gains a "Watching Eye:" line. The snapshot title line is unchanged.

**Interpretation calls (logged, not CADEN):**
- **Q-EYE-1 — RESOLVED (CADEN, Nov 17).** For a Mire Touched target, "no information" is read as no miss poison either.
- **Q-EYE-2 — RESOLVED (CADEN, Nov 17; asked as a Mire Touched Eye, applied to Ash Touched too).** "Has found" is set by what the Eye was told (a hit). A Mire Touched Eye shown a false hit also stops.
- **Q-EYE-3 — RESOLVED (CADEN, Nov 17).** An Ash Touched player who is also Mire Touched that night gets cured, and the Eye learns nothing and keeps hunting.
- **Q-EYE-4 — RESOLVED (CADEN, Nov 17).** An Echo-copied Eye stops only when the Tyrant is dead, because `eyeFound` belongs to the real Eye.

**Replays on the new source:**

| Script | Winner / rounds | Mismatches | Superseded |
| :--- | :--- | :--- | :--- |
| Games 6, 7, 8 | lumen 5 / ashen 3 / shadow 6 | 0 | 0 |
| Game 9 | lumen 7 | 0 | 1 |
| Game 10 | lumen 6 | 0 | 0 |
| Game 11, game11-failsafe-only | lumen 5 | 0 | 4 each |
| echo-night-of-peace, smoke-8, civic-4-no-exec | unchanged | 0 | 0 |
| eye-rule-found, eye-rule-tyrant-dead (new) | — | 0 | 0 |

- **Game 9.** P18's AF2 hit now names "The Ashen Tyrant is P16. You have no further checks." The table said "current killer is P16", which is superseded. P18 died that night either way.
- **Game 10.** The Eye never hit, and the Tyrant was alive until the end, so the Eye kept checking (and poisoning on misses) exactly as at the table. No change.
- **Game 11.** At AF2 the Eye now names only the Tyrant and stops. The table's AF3 check (no reveal) and the AF4 and AF5 "current killer is P1" results are superseded: the app gives P9 no action and ignores the scripted submissions. Mechanically every death, ballot and the Lumen win still hold, because the script's nominations and votes are unchanged. At a real table, P9 would not have had the P1 read. The case against P1 would have rested on the Elder's AF5 "P1 appears Ashen", P18's (false) mirror and the Failsafe pattern. That is a play difference, not an app outcome change.
- **Harness.** Expect entries can now carry `superseded` (reported in a separate section, never counted), plus `needsAshAction`, `remindersInclude` and `eyeLine` checks. `buildReminders` is exported to the engine build.
- **New regression scripts.** `scripts/eye-rule-found.json` covers a miss with poison, a cured Mire target with no info and no poison, a hit with the Tyrant only, then no action and the GM reminder. `scripts/eye-rule-tyrant-dead.json` executes the Tyrant, then checks that the Eye has no action and never names the Blade through its first kill. Both fail on the pre-change source (11 and 9 mismatches) and pass now.
- **Batches.** fuzz-batch 50 (seed 100) and realistic-batch 20 × 18p: 0 crashes, no high codes.

**Publish.** The live Page matched `out/canvas-source.pre-eye-rule.tsx` (the 9:13 AM publish) before editing. One EditCanvas call applied the same 13 replacements, and the Page recompiled cleanly. Verification:
- The re-read live source equals the local file (4,927 lines, ignoring trailing whitespace).
- Logo sha256 `272f83f2e67466a63418ca0ab749657c90227ff0006127f3f365a99bac0db082` (24,196 bytes).
- All 26 portraits and the 3 symbols (`2747dec8…`, `cff9d802…`, `f6bc0644…`) are byte-exact.
- The title "Ashes of Lumination — Companion" and the snapshot line "Ashes of Lumination — game update for Ahsoka" are unchanged.
- The local smoke render passed: logo OK, 17 images, deal works, with the same two old console messages.

`/workspace/game/intended/canvas-src-intended.tsx` and `canvas-src-live-published.tsx` were refreshed.

---

## 2026-11-16, 2:15 PM MST — CADEN rulings 1–10 (Ahsoka's chat), implemented

Source: Ahsoka's transcript (agent 3c11a484…), Caden's message of Nov 16, 1:54 PM MST, answering Ahsoka's numbered recommendations (1–8) and adding two of his own (9–10). Backup of the pre-change source: `out/canvas-source.pre-rulings-1116.tsx` (identical to the 1:40 PM published source).

| # | Caden's words (verbatim) | Implemented | Left pending (current default, tagged "pending Caden") |
| :- | :- | :- | :- |
| 1 | "ok go for it" (to: dead votes can't outnumber living votes in a single Dawn Accord) | `deadVoteInfo` caps counted dead final votes at the living votes cast; GM tally panel, GM reminder and the log show the cap; uncounted dead voters keep their final vote | Which dead votes drop when over the cap (app: the latest-cast first) |
| 2 | "the point is for him to win alone … they don't know who is killing … they can help or they can sabatage." | Blade win log "wins alone"; former Ashen are not told who is killing (GM takeover reminder, Blade text) | Whether former Ashen share the win (OPEN) |
| 3 | "great" (to: show every voided nomination and vote as normal, only quietly drop it from the count) | Voided nominations now listed in the public nomination text; no player-facing text mentions a void | — |
| 4 | "if they join they get a one time shield that must be used at night a before they know if they die or not. the syndic only needs the rest of the living players. … he just needs the remaing alive players to be apart." | Recruit gets a one-time night shield (armed on their screen during Ash Fall, resolved after Overseer shields); Syndic wins when every living player is the Syndic, a recruit, or Ashen | Alone vs with recruits (log says pending); whether a Failsafe cancel uses up an armed shield (app: used up); self-only |
| 5 | "can;t copy unaligned or the ashen mind but he can inherit a one time kill oppourtunity if the tyrant dies." | Echo can't copy Unaligned roles or the Mind (removes the Game 11 Echo-Mind snapshot); copying an executed Tyrant gives a one-time kill | Whether an executed uncopyable role keeps the Echo's previous copy (app: clears it); whether "inherit" also limits the Echo's succession kill (app: succession unchanged) |
| 6 | "make it a balance thing … decided who is ash touched. only 1 per game." | Exactly 1 Ash Touched, placed by the GM (placing a second clears the first; a forced deal with more logs a warning); GM reminder has "[placeholder — Ahsoka is writing it]" | Ahsoka's balance guidance text |
| 7 | "the shields should only last for one night. they are shielded that ashfall and lumination but that is it. then the shield is gone." | Already the app's behaviour; text and log now say so | Same target on consecutive nights (app: allowed, Q-G10-5) |
| 8 | "ok great." (to: team only at 10+) | At 10+ starting players the Witness learns only the team; an Ash Touched Witness gets a false team | Which false team (app: random of the two wrong teams; inferred, not stated by Caden) |
| 9 | "two players are soulbound to one another. if one dies then they both die. anyone can be soulbound. again make it balanced or fun" | Both die (also fixed: succession now runs for the partner); anyone; GM places it | Whether they know (app: not told); Soulbound + shield delay |
| 10 | "lets create a 5 player rule … get to use their ability again only after 5 more players have died after using their ability" | Replaces `rechargeAt` and the 15/10/5 chart: regain 1 use after 5 more deaths since the use; setup text, role texts, ChargePip hints and day-action text updated | Small games where 5 more deaths can't happen |

Eye: Q-EYE-1…4 still pending; current defaults kept.

### Replays (all 0 mismatches; winners unchanged)

| Script | Winner | Superseded (by ruling) | Charge notes |
| :- | :- | :- | :- |
| Game 6 | lumen | 5 (#8 ×4, #10 ×1) | 1: P2's L4 Red Scar attempt has no use under #10, but it was blocked at the table anyway |
| Game 7 | ashen | 0 | 0 |
| Game 8 | shadow | 7 (#3 ×5, #10 ×1, #1 ×1) | 1: P9's L4 Red Scar kill on P5 has no use under #10 |
| Game 9 | lumen | 9 (#3 ×6, #8, Eye, #10) | 1: P6's L4 kill (already chargeless before; Failsafe-cancelled; Q-G9-3) |
| Game 10 | lumen | 6 (#3 ×5, #10) | 0 |
| Game 11 / failsafe-only | lumen | 12 each (#3 ×5, Eye ×4, #5 ×3) | 0 |

**Winner risk — Game 8.** Under the 5-player rule P9 (Red Scar) holds no use at L4, so the table's kill on P5 could not happen. A counterfactual without it (`/tmp/cf-game8.json`) ends the scripted game with no winner (P4 Blade and P5 Voice alive): the Shadow win then depends on how Dawn 6 would have gone. Game 8 DA5 is the only replay that hits the dead-vote cap (3 living, 5 dead): P9 and P12 aren't counted, P3 is still executed (3–1–1 vs the table's 4–1–2). Dropping different dead votes could have tied, so the drop-order rule matters.

### Regression and batches

- 26/26 scripts: 0 mismatches, 0 crashes, 0 high findings. The 13 new `rule1116-*` scripts all pass; on the pre-ruling source 12 fail (08c, the 9-player boundary, passes on both by design).
- Fuzz batch 50 (seed 100): lumen 15, ashen 34, shadow 1; 0 crashes, 0 issues.
- Realistic 8p/200: ashen 17, lumen 2, shadow 1. 12p/300: ashen 17, lumen 2, syndic 1. 18p/400: ashen 13, lumen 6, shadow 1. 0 crashes, 0 issues.
- Local render (rebuilt bundle): logo OK, 17 images, deal OK, the usual 2 harmless console errors. UI check: Syndicate shield card renders for a recruit; the GM tally shows "Dead-vote cap (Caden)" with "not counted (final vote kept)".
- Strict typecheck: 0 errors.

### Harness changes
`syndShield` action, `placeAshTouched` op, `soulbound` seat field, new expects (`publicIncludesNoms`, `publicForbids`, `charges`, `remindersForbid`), charge notes, random deals place 1 Ash Touched, `hold` day-kill no longer spends. See HOW-TO-RUN.md.

### Rules questions closed or narrowed
Closed: recharge chart vs table threshold, Q-G9-5, Witness exact vs team (Q-G10-1), Q-G11-2, Q-G11-4. Partly: Q-G9-2 (voids), Q-G11-3 (one-time copy), list items 9 and 11. Still open: the pending column above, Q-EYE-1…4, Q-G10-5 and the rest.

## 2026-11-16, 2:30 PM MST — Change: published the Nov 16 rulings to the same Page

- Before: live source byte-identical to `out/canvas-source.pre-rulings-1116.tsx`.
- Published with one EditCanvas call (69 minimal replacements from `tools/min-edits.py`, kept in `out/rulings-1116/ec-min.json`); recompiled cleanly.
- After: live source byte-identical to `local-render/canvas-source.tsx` (copied to `intended/canvas-src-live-published.tsx` and `canvas-src-intended.tsx`).
- Title "Ashes of Lumination — Companion"; snapshot line "Ashes of Lumination — game update for Ahsoka" present.
- Logo sha256 `272f83f2e67466a63418ca0ab749657c90227ff0006127f3f365a99bac0db082`, byte-identical to `web-logo/logo-640.webp`. All 26 portraits and the 3 symbols (`2747dec8…`, `cff9d802…`, `f6bc0644…`) are byte-exact.
- Local smoke render of the published source: logo OK, 17 images, deal OK, hasCompanion; the same 2 harmless console errors as before.

---

## 2026-11-17, 8:40 PM MST — Nov 17 rulings (Ahsoka's chat): Ash Touched true/false, Failsafe vs shield, Eye, cap, recharge, Echo, and card-relayed items

Backup of the pre-change source: `out/canvas-source.pre-rulings-1117.tsx` (identical to the Nov 16 published source). Edit scripts: `out/rulings-1117/apply*.py`.

### Confirmation status

**CADEN — Caden's own words are in Ahsoka's transcript:**
- Message "1. No / 2. Any information may be true or false to an ash touched player / 3. Yes", answering Ahsoka's three questions:
  1. "No" to: is a recruit's shield used up when the Failsafe cancels them? → they keep it.
  2. "Any information may be true or false to an ash touched player" (asked about the Witness's false team; worded for all info).
  3. "Yes" to: does an Echo that tries an illegal copy lose its previous copy? → yes (already the app default).
- Message "Yes I agree with you make these changes", answering Ahsoka's list with her picks:
  - Q-EYE-1: a Mire Touched target means no poison that night (app default).
  - Q-EYE-2: asked as "if the Eye is **Mire Touched** itself and gets a false 'found them,' does it stop?" (Anakin's question said "poisoned Eye" = Mire Touched, so they match). **Interpretation:** the app applies it to an Ash Touched Eye shown a false hit too (any shown hit stops the Eye).
  - Q-EYE-3: approved as written (app default). Q-EYE-4: an Echo copying the Eye stops only once the Tyrant is dead (app default).
  - 5-player rule: kills and executions both count. The app also counts poison deaths, Sunmark shots and a Soulbound partner's death — every death — which Caden did not rule on separately (flagged, not changed).
  - Dead-vote cap: count dead votes in the order cast until they match the number of living voters, then drop the rest. **This is what the app already did** ("drop the latest" = keep the first N in cast order); only the wording and tag changed. "Living voters" is read as living players who actually cast a vote (one each), not all living players present. Flagged for Ahsoka. Cast order = when each dead player first cast; a changed vote keeps its place.
  - The Echo's one-time kill comes only from copying an executed Tyrant; succession unchanged (app default).

**RELAYED — Ahsoka says Caden answered, but his answers are not visible in her transcript** (she sent them as a question card; the transcript shows only her "Locked." / "I'm locking these in now" replies, with no Caden message):
- The Shadow Blade wins completely alone; former Ashen don't share the win. (Also follows from Caden's Nov 16 words "the point is for him to win alone".) **Implemented** as text only; behaviour unchanged (no co-winners were ever named).
- Living Syndic recruits win with the Syndic; dead recruits don't. **Not implemented** (a behaviour change on a ruling I can't confirm). The patch is described in the report; the app still says "pending Caden" there.
- The Overseer may shield the same player on back-to-back nights (app default; tag updated to "Nov 17 ruling, relayed by Ahsoka").
- Soulbound players are never told (app default; tag updated). Leak audit: no player screen or public notice mentions Soulbound or a partner, including when the partner dies (only the GM log and GM reminders do). New script `rule1117-05`.
- The 5-player rule stays at 5 deaths at every player count (app default; tag updated).
- A recruit's shield protects only that recruit (app default; tag updated).

### Ash Touched true/false (CADEN "Any information may be true or false")
- New state: `atFalsePct` (default **50**), `atOverrides` (key `round|playerId` → "true"/"false"), `atRolls` (one GM-only record per Ash Touched result).
- `infoLies(state, player, label)` decides each result. Mire Touched: always false, unchanged (also when the player is Ash Touched too). Ash Touched: the GM override for that player and round if set, otherwise false with `atFalsePct`% chance (0 and 100 use no random draw). Every Ash Touched result writes a GM-only log line: "GM only — Ash Touched result for X (label, round N): TRUE/FALSE (50% chance of false | GM override)".
- Applied to every info result: Lumen Bearer neighbours (rolled at the deal), Ashen Mind snapshot (a false snapshot has at least one false line), Last Witness (team at 10+, role below 10), Foresight Elder, Integrity Warden, Parallax, Watching Eye, Shadow Blade Tyrant check, Self Known answer.
- GM view: Setup has "Ash Touched: chance of a false result (%)". After the deal, a new "Ash Touched info" card shows the chance (editable), and for each living Ash Touched player, "Use the chance / Force true / Force false" for the current round and the next round, plus the list of results so far. The Self Known answer panel says whether the answer will be rolled or is forced.
- Measured odds (`tools/at-odds-check.mjs`, 20,000 draws): 0% → 0.0% false; 25% → 25.3%; 50% → 50.0%; 100% → 100.0%. Mire Touched stays false at 0%; non-Ash-Touched players stay true at 100%.
- Known gap (unchanged behaviour): in the live app the GM places Ash Touched after the deal, so the Bearer's deal-time result is never Ash Touched unless the deal was forced with Ash Touched seats.

### Other changes
- Failsafe cancel keeps the recruit's shield (disarmed for that night).
- Echo illegal-copy log now says "Caden (Nov 17): it loses its previous copy."
- Eye Mire-target log adds "no one is poisoned tonight (Caden, Q-EYE-1)"; a false hit logs "was shown a false hit and believes it found…".
- Shadow Blade win: log, GM "Game over" card ("…has won completely alone. Former Ashen do not share the win."), header ("Shadow Blade victory (alone)") and a per-player result for everyone ("You did not win: former Ashen do not share its win." for Ashen).
- **App bug fixed (found by the new tests):** The Self Known answer parsed the question with a regex that split "Is Tor The Ashen Tyrant?" into "Tor The Ashen" + "Tyrant", so the true answer was always "No" for every role. Fixed in the engine and in the GM answer panel.
- Deals now carry the GM's chance setting (`atFalsePct`) instead of resetting it.

### Replays (all 0 mismatches; winners unchanged)
Every replay forces each Ash Touched result to what the table gave — false in every game (Games 6–11 under the old rule) — via `atForce` (`tools/rulings1117.py`, rounds 0–12). Replays then run exactly as before.

| Script | Ash Touched seat | Winner | Superseded |
| :- | :- | :- | :- |
| Game 6 | P8 Parallax | lumen | 5 |
| Game 7 | P12 Elder | ashen | 0 |
| Game 8 | P8 Parallax | shadow | 7 |
| Game 9 | P9 Warden | lumen | 9 |
| Game 10 | P13 Witness | lumen | 6 |
| Game 11 / failsafe-only | P18 Parallax | lumen | 12 each |

The Game 8 caveat from Nov 16 (P9's L4 Red Scar kill had no use under the 5-player rule) still stands.

### Regression and batches
- 34/34 scripts: 0 mismatches, 0 crashes, 0 high findings. New: `rule1117-01` Failsafe keeps shield, `02a` chance 0%, `02b` chance 100%, `02c` GM overrides, `03` Echo loses copy, `04` dead-vote order, `05` Soulbound untold, `06` Ash Touched Eye false hit stops. On the pre-1117 source: 01, 02a–c, 06 fail on behaviour; 03, 04 fail on wording only (same behaviour); 05 passes on both (it guards the default).
- Fuzz 50 (seed 100): ashen 33, lumen 16, shadow 1. Realistic 8p: ashen 17, lumen 2, shadow 1. 12p: ashen 16, lumen 4. 18p: ashen 13, lumen 5, shadow 2. 0 crashes, 0 issues.
- Local render: logo OK, 17 images, deal OK, same 2 harmless console errors. UI check: the Ash Touched info card renders with the override buttons and the results list; the Syndicate shield card and the dead-vote cap still render.

### Rules questions now
Closed: Q-EYE-1…4; Failsafe vs shield; Ash Touched info (true or false); Echo illegal copy; Echo succession; dead-vote cap order; 5-player rule (kills and executions); and, as relayed by Ahsoka, Blade co-winners, Overseer repeats, Soulbound awareness, small games, recruit shield scope.
Still open or unconfirmed:
- ~~**Syndic recruits win with the Syndic**~~ — RESOLVED (CADEN, Nov 17 card, 8:25 PM MT) and implemented at 8:39 PM; see the section below.
- The exact Ash Touched odds (50% is my default; Ahsoka is to confirm with Caden).
- Whether "living voters" in the cap means voters who cast (app) or all living players.
- Whether poison, shot and Soulbound deaths count toward the 5-player rule (app: yes).
- Which false team a false Witness sees (random of the two wrong teams).
- Whether a Voice ×2 vote counts double toward the living side of the cap (app: one per living voter).
- Older OPEN items not on Ahsoka's core list are unchanged (Civic timing/priority, Paradox details, shield vs poison, Soulbound + shield delay, Sunmark self-target, and the rest in the numbered list).

### 2026-11-17, 8:36 PM MST — Nov 17 rulings published
- Checked before publishing: the live canvas matched out/canvas-source.pre-rulings-1117.tsx byte for byte.
- EditCanvas: 48 minimal edits from out/rulings-1117/ec-min.json, all applied in one call. Title: "Ashes of Lumination — Companion".
- After publishing: the source extracted from the live page is byte-identical to local-render/canvas-source.tsx. The snapshot line "Ashes of Lumination — game update for Ahsoka" is present.
- Asset sha256 checks: logo 1/1 (272f83f2…), portraits 26/26, symbols 3/3 (2747dec8 Lumen, cff9d802 Ashen, f6bc0644 Unaligned). There are 30 webp data URIs and all are unique.
- Updated intended/canvas-src-live-published.tsx and canvas-src-intended.tsx.
- Held back: the ruling that living Syndic recruits win with The Syndic. Caden's card answer does not appear in Ahsoka's transcript, so the win check still says "Pending Caden" (OPEN).

## 2026-11-17, 8:39 PM MST — Caden's card answers found; Syndic recruits win (CADEN), republished
**Evidence.** Ahsoka's full transcript (tool calls included; the message-only view leaves them out) shows her SendToUser widget "How should these four work?" (message id t1531s3687), followed by Caden's answer at 8:25 PM MST:
> [Answering your question t1531s3687: "How should these four work?"]
> When the Shadow Blade wins, do former Ashen win with it? — **Blade wins completely alone**
> When the Syndic wins, do its living recruits win with it? — **Recruits win with the Syndic**
> Can the Overseer shield the same player two nights in a row? — **Yes, back-to-back is fine**
> Do Soulbound players know they're bound? — **They don't know at all**

He also answered two later cards at 8:27 PM MST: t1531s3691 "In small games, how should abilities recharge?" — **"Keep 5 deaths, so recharges are rare"**; and t1531s3696 "Does a Syndic recruit's shield protect only that recruit?" — **"Yes, only themselves"**.
So every item that was marked RELAYED in the 8:40 PM section is now **CADEN**: Blade alone / former Ashen don't share; Syndic recruits win; Overseer back-to-back; Soulbound untold; 5 deaths at every player count; recruit shield is self-only. In the app, all 11 "Nov 17 ruling, relayed by Ahsoka" tags now read "Caden, Nov 17 card".

**Change (Syndic win).** checkWins: when the Syndic wins, each player gets a result. The Syndic gets "You win, together with your living recruits". A living recruit gets "As a living recruit, you win with The Syndic". A dead recruit gets "You were recruited but died, so you did not win". Everyone else gets "The Syndic and its living recruits have won. You did not win." The log, the role text, the GM Game over card ("The Syndic and its living recruits have won. Dead recruits do not share the win.") and the header ("Syndic victory (with living recruits)") are updated. The win condition itself is unchanged (Caden, Nov 16).
- Edge case, not ruled: an Ashen player who joined and is still alive when the Syndic wins counts as a living recruit, so the app gives them the win. Normally the Syndic dies the Ash Fall after an Ashen joins, so this is rare.

**Tests.** New script rule1117-07-syndic-recruits-win (Syn and Ben win; Ann, a dead recruit, does not; Tor and Cal do not). It gives 0 mismatches now and 6 on the pre-patch source (backup: out/canvas-source.pre-syndic-1117.tsx). rule1116-04-syndic log needle updated. run-all: 35/35 at 0 mismatches, 0 crashes, 0 high findings. Replays are unchanged: G6 lumen, G7 ashen, G8 shadow, G9/G10/G11/failsafe-only lumen. Batches are identical to 8:40 PM: fuzz 50 (ashen 33 / lumen 16 / shadow 1), realistic 8p (17/2/1), 12p (16/4), 18p (13/5/2), with 0 issues and 0 crashes. Typecheck: 0 errors. Bundle OK; smoke render: 17 images, dealt, same 2 old errors.

**Publish.** Live matched the 8:36 PM source. 13 minimal edits were applied in one EditCanvas call. The source extracted from the live page is byte-identical to local. Logo 1/1, portraits 26/26, symbols 3/3, title "Ashes of Lumination — Companion", Ahsoka snapshot line present. intended/ copies updated.

**Still open (not core rules):** exact Ash Touched odds (50% placeholder); "living voters" = voters who cast; poison/shot/Soulbound deaths in the 5-player count; which false team the Witness sees; Voice ×2 in the dead-vote cap; the Bearer's deal-time Ash Touched result cannot be overridden from the card; the Ashen-recruit edge case above; Syndic vs other simultaneous wins and Syndic death vs protection; older Q-G9/Q-G10 items.

## 2026-11-18, 8:29 AM MST — Nov 18 rulings (Caden's card answers in Ahsoka's chat), published
**Evidence (Ahsoka's transcript, card answers):**
- 8:17 AM MST, card t1532s3707 "Four app details to confirm":
  - Ash Touched 50%? — "It can go either way. Balance the game with it. If the ashen are losing bad help them with some false information"
  - "Living voters"? — "I dont understand this question" (later replaced; see 8:21)
  - Poison, shot and Soulbound deaths in the recharge? — "Yes, every death counts"
  - Dead Voice ×2 in the cap? — "No, it counts as 1"
- 8:21 AM MST, card t1532s3711 "Two last calls":
  - Dead-vote limit — "Let's just make it to where only three dead votes count per accord. So the first dead people to vote count and then if others try they just get a max vote reached. All living players can vote or skip vote if they would like"
  - Ashen in the Syndic — "If an ashen player joins the syndic then the syndic automatically dies the following night. His goal is to only recruit Lumen. If he tries to recruit an ashen the ashen would want to join so the syndic dies the following night"

**Changes:**
1. **Ash Touched odds (CADEN):** the 50% default and the GM controls are unchanged. The "Ash Touched info" card quotes Caden and adds a balance-lever hint: raise the chance or force false when the Ashen are losing badly, lower it when they are running away with the game. The app never changes the odds automatically. It also shows "Living now: X Ashen vs Y others", flagged "Ashen are behind (rough guide)" when the Ashen share of living players is below their share at the deal. The setup label now reads "… — a balance lever (Caden)". The "pending Caden" tag on the odds is removed.
2. **Every death counts (CADEN):** no behaviour change. Every death goes through applyDeath, which adds 1 to deathCount; the only two `alive: false` writes are there, one for the death itself and one for the Soulbound partner. Comments and rules text updated. New script rule1118-01 (shot, Soulbound partner, three-poison death, kill, execution → Sun's use returns at the 5th death).
3. **Dead votes: max 3 per Accord (CADEN, REPLACES the Nov 16/17 "can't outnumber living votes" cap and the "living voters" question):** DEAD_VOTE_MAX = 3. The first 3 dead final votes count, in the order cast.
   - A later dead voter is **blocked**: castPlayerVote refuses the vote and logs "Max votes reached: X …". On their player screen, the Dawn Accord card shows "Max votes reached. Three dead votes have already been cast this Accord, so you can't vote now. You keep your final vote for a later Accord" with no Cast button.
   - A dead Save takes no slot, and changing a dead vote that was already cast keeps its slot.
   - A dead Voice counts as 1 slot with weight 1 (CADEN 8:17).
   - Living players vote or skip as before.
   - GM tally, reminders, log and rules text updated.
   - deadVoteInfo still reports living votes, but they no longer set any limit.
4. **Syndic recruiting an Ashen (CADEN):**
   - An Ashen invited by the Syndic **joins automatically** (my reading of "the ashen would want to join").
   - The Syndic **dies automatically** at the start of the following Ash Fall, as before. The old "protection delays it" branch is removed: no shield or immunity check (question for Caden). In practice no normal shield is still active then, because shields end after the Lumination.
   - The death goes through applyDeath (counts toward the recharge) and adds a GM log line.
   - The Ashen recruit stays on the Ashen team. They still receive the recruit's one-time shield, which is unchanged (question for Caden).
   - **No Ashen ever shares a Syndic win:** an Ashen recruit alive at a Syndic win gets "You joined as an Ashen, so you do not share the win". This replaces the 8:39 PM default.
   - Guard added: a second answer to the invite from someone already in the syndicate does nothing.

**Scripts:**
- **New:**
  - rule1118-01-every-death-recharges
  - rule1118-02-dead-voice-counts-one (Voice is one of the 3; the 4th dead voter is blocked)
  - rule1118-03-three-dead-votes-max (3 count, the 4th is blocked, a dead Save is allowed, a living player skips; Tor executed → Lumen win)
  - rule1118-04-syndic-ashen-dies
  - rule1118-05-syndic-ashen-no-share
- **Updated, with the old table values kept as `superseded`:**
  - rule1116-01 (now Gus 3–2, executed)
  - rule1117-04 (4th dead voter Cal blocked)
  - Syndic log needles in rule1116-04 and rule1117-07
- **Negative control:** on the pre-1118 source, 02/03/04/05 fail (6/2/6/3 mismatches). 01 passes on both (no behaviour change). A mutant (dead Voice weight 2, Soulbound death not counted) fails 01 (3) and 02 (2).

**Replays:** every winner unchanged (G6 lumen, G7 ashen, G8 shadow, G9/G10/G11/failsafe-only lumen), with 0 mismatches.
- The new 3-dead-vote limit blocks a dead voter in G6 (P12), G7 (P15), G8 (P9, P12) and G9 (P5, P16). No execution changes in any game.
- G8 R5: same 3 counted (P5, P8, P7), so P3 is still executed. Superseded count 7→8.
- G9 R7: P6, P2, P14 count, P11 7 vs P9 3, so P11 is still executed. Superseded count 9→10.
- No replay has the Syndic recruiting an Ashen.

**Totals:** run-all 40/40, 0 mismatches, 0 crashes, 0 high findings. Typecheck 0 errors.

**Batches** (0 issues, 0 crashes). Some winner counts shifted because of the dead-vote rule:

| Batch | Ashen | Lumen | Shadow | Before (8:40 PM) |
| :- | :- | :- | :- | :- |
| Fuzz 50 | 30 | 19 | 1 | 33/16/1 |
| Realistic 8p | 17 | 2 | 1 | unchanged |
| Realistic 12p | 18 | 2 | 0 | 16/4 |
| Realistic 18p | 12 | 6 | 2 | 13/5/2 |

**UI check** (tools/ui-check-rulings1118.mjs): the 4th dead voter (Mab) sees "Max votes reached" with no Cast button. A counted dead voter (Ann) still has a Cast button. A dead voter who saved (Cal) is also blocked from casting a real vote now. The GM view shows the 3-vote rule text and the balance hint ("Living now: 1 Ashen vs 3 others"). No page errors. Smoke render: logo OK, 17 images, dealt, the same 2 old errors.

**Publish:** live matched out/canvas-source.pre-rulings-1118.tsx. 25 minimal edits were applied in one EditCanvas call at about 8:28 AM MST. The live source is byte-identical to local. Logo 1/1, portraits 26/26, symbols 3/3, title "Ashes of Lumination — Companion", Ahsoka snapshot line present. intended/ copies updated.

**Closed:** Ash Touched odds; other death types in the recharge; dead Voice in the cap; "living voters" (made moot by the 3-vote limit); Ashen-in-Syndic win (no Ashen shares).

**Open questions for Caden** (from these rulings):
- (a) Can anything stop the Syndic's automatic death (shield, Guard immunity, a recruit shield)? The app says no.
- (b) Must an invited Ashen join, or may they decline? The app joins them automatically.
- (c) Does the Ashen recruit stay Ashen (the app says yes) and keep the recruit's one-time shield (the app says yes)?
- (d) If the Syndic wins before its automatic death (the same day an Ashen joins), does the win stand? The app says yes.
- (e) Does a dead player's Save take one of the 3 slots? The app says no.
- (f) Can a counted dead voter change their vote? The app says yes, and they keep their slot.
- (g) Do summoned votes (Necroreclaimer) count toward the 3? The app counts only dead final votes cast by the dead players themselves.
- Also still open: whether a living Voice ×2 matters for anything now that no living count sets a limit (it doesn't, in the app).

## 2026-11-18, 8:39 AM MST — Caden's 8:31 message + 8:33 edge-case card, published
**Evidence (Ahsoka's transcript):**
- **Caden's own chat message, 8:31 AM MST** (pos 3724, cu:523718337) sets the five rulings: Soulbound in every 10+ game; Tyrant kill passes to the Blade, then the next Ashen until none are left, and the game ends if the Blade inherits and dies; nothing special for a mid-Ash-Fall Tyrant death; 5–6 players have 1 Ashen; only the Syndic and its recruits win. The code quotes him where exact text was used.
- **Card t1533s3722 "Seven edge cases", 8:33 AM MST:**
  1. "No, nothing saves him (app now)"
  2. "Yes, they can refuse"
  3. "No shield for Ashen recruits"
  4. "Yes, the win stands (app now)"
  5. "No, only real votes count (app now)"
  6. "No, dead votes are final"
  7. "No, they're extra (app now)"

All of the above are CADEN. Backup: out/canvas-source.pre-rulings-1118b.tsx.

**Changes:**
1. **Soulbound required at 10+:**
   - New soulboundRequired, hasSoulboundPair, setSoulboundPair and suggestSoulboundPair.
   - In Setup, a 10+ game with no pair shows a warning and a "Suggest a Soulbound pair" button. **Begin Round 1 is disabled** until a pair is placed: the GM picks one on the modifier tracker or takes the suggestion.
   - The GM reminder repeats the requirement. Rules text and the selector label are updated. Under 10 it stays optional.
   - The harness, playing the GM, now places a random pair in random 10+ deals. Forced replays are unchanged (reminder only).
2. **Tyrant succession:**
   - New nextTyrantSuccessor: the Shadow Blade first, otherwise the next living Ashen, repeated until none are left.
   - The old list (Blade, Red Scar, Echo Thief only) is gone. The Mirebane, the Ashen Mind and any other Ashen, such as a converted Paradox, can now inherit.
   - Order among Ashen is not ruled. The app uses Red Scar, Echo Thief, Mirebane, Ashen Mind, then seat order.
   - With no successor, the log says the game is over. The win check gives the Lumen win (ashen = 0 and no Blade), with a log noting no one is left to take the kill. The Blade dying after takeover is still an immediate Lumen win, even with Ashen alive.
   - The "cutoff player count" placeholders are removed.
3. **Tyrant dies mid-Ash Fall:** the engine already had no special case. Kills resolve in submission order even if the actor died earlier that night; info resolves before kills; applyDeath applies succession. A comment now cites Caden.
   - Note: nightOfPeace is cleared at the end of the Ash Fall in which it was set. So after a night death, the successor kills on the very next Ash Fall, while after a day death the next Ash Fall is peaceful. This is unchanged and flagged.
4. **5–6 players → 1 Ashen:** already ashenCount(n ≤ 6) = 1. Comment and chart text now cite Caden.
5. **Syndic win:** only the Syndic and its living recruits win; everyone else, including any Ashen recruit and dead recruits, loses. This already matched; the log now quotes Caden.
6. **Edge 2:** an invited Ashen gets the normal accept/refuse invite. The 8:21 auto-join is removed. Refusing means no join and no Syndic death.
7. **Edge 3:** Ashen recruits get no syndShield. The log and the player's result say so.
8. **Edge 6:** dead votes are final. castPlayerVote refuses to change a cast dead vote and logs "…dead vote is final and was not changed". The dead player's Dawn Accord card shows "You voted for X. Dead votes are final, so it can't be changed." with no form. A dead Save can still become a vote while a slot is open.
9. **Edges 1, 4, 5, 7 kept:** no save from the automatic death; a win before that death stands; Saves take no slot; summoned votes are extra.

**Harness:** new expectation `teamCounts`; build-engine exports the new helpers; run-on-pre.sh stubs them; random 10+ deals get a Soulbound pair.

**Scripts:**
- **New (11):** rule1118b-01a/01b/01c (Soulbound required at 10, placed at 10, optional at 9), 02 (succession Tyrant→Mirebane→Ashen Mind→Lumen win), 03 (Blade dies after takeover with Ashen alive → Lumen), 04 (Tyrant dies with no Ashen/Blade → Lumen), 05 (Tyrant dies mid-AF via Soulbound; checks still return; Red Scar inherits), 06 5p/6p (1 Ashen), 07 (Ashen refuses invite), 08 (dead vote final).
- **Updated with `superseded`:** rule1118-04 (Mab now accepts; no shield) and rule1118-05 (Tor accepts).
- **Negative control** on the pre-1118b source:

| Script | Mismatches |
| :- | :- |
| 01a | 1 |
| 02 | 4 |
| 04 | 1 |
| 07 | 2 |
| 08 | 3 |
| 1118-04 | 3 |
| 1118-05 | 1 |

  01b, 01c, 03, 05 and 06 pass on both (behaviour already matched). teamCounts is confirmed evaluated: a wrong expectation fails.

**Totals:** run-all 51/51, 0 mismatches, 0 crashes, 0 high findings. Typecheck 0 errors.

**Replays:** winners unchanged (G6 lumen, G7 ashen, G8 shadow, G9/G10/G11/failsafe-only lumen), superseded counts unchanged.
- **G9:** after the Echo Thief P14 died, the kill used to stop. It now passes to P11 (Ashen Mind). P11 never used a kill at the table, so nothing else changes.
- **G10:** the log now says the game is over when the Tyrant dies with no successor; same Lumen win.

**Batches** (0 issues, 0 crashes). They shifted toward the Ashen because all Ashen can now inherit and random 10+ games carry a Soulbound pair:

| Batch | Ashen | Lumen | Shadow |
| :- | :- | :- | :- |
| Fuzz 50 | 33 | 15 | 2 |
| Realistic 8p | 18 | 1 | 1 |
| Realistic 12p | 18 | 1 | 1 |
| Realistic 18p | 17 | 3 | 0 |

**UI check** (ui-check-rulings1118.mjs): Ann's cast dead vote shows "Dead votes are final" with no Cast button; Mab (4th) sees Max votes reached; a 10-player setup with no pair shows the warning and the Suggest button, with Begin Round 1 disabled; the GM hint is unchanged. No page errors. Smoke render: logo OK, 17 images, dealt, the same 2 old errors.

**Publish:** live matched the pre-1118b source. 22 minimal edits in one EditCanvas call, about 8:38 AM MST. Live source byte-identical to local. Logo 1/1, portraits 26/26, symbols 3/3, title and Ahsoka snapshot line OK. intended/ copies updated.

**New questions for Caden:**
- (a) What order among Ashen for succession? The app uses Red Scar, Echo Thief, Mirebane, Ashen Mind, then seat order.
- (b) Night of peace when the Tyrant dies at night? The app uses up the peace that same night, so the successor kills the next Ash Fall.
- (c) Does the Shadow Blade always outrank the Ashen? The app says yes.
- (d) Does "game over" with no successor mean a Lumen win? The app says yes.
- (e) Soulbound pair: GM's choice or random? The app offers both, picking or Suggest.
- (f) Does the 10+ threshold count the starting players? The app says yes.
- (g) Is a converted Paradox eligible to inherit? The app says yes, as Ashen.

## 2026-11-18, 12:01 PM MST — SIM-ONLY succession cutoff study
- **What ran:** the patched engine in `sim/study/` with the `ashenSuccessionCutoff` option (the Blade is always allowed; cutoffs as % of starting Lumen, plus a labelled REVERSE reading).
  - Main run: 6, 8, 12, 16 and 18 players. Extra: 5, 10 and 14. 200 games per setting, same seeds in every setting.
  - 0 crashes. The baseline matches the live engine on every game checked.
- **Report:** `out/succession-cutoff-study.md`. Raw data in `out/succession-cutoff-study*.csv`.
- **Result:** for 7+ players, stopping at 75% is the strongest cutoff that still passes sometimes; no cutoff reaches an even split. For 5–6 players the cutoff never applies.
- **Live page and canvas-source.tsx unchanged:** sha256 3331fe64… before and after.

## 2026-11-18, 1:51 PM MST — 75% cutoff test flag + Caden's succession rulings, published
**Evidence (Ahsoka's transcript, Caden's own answers):**
- **Card t1538s3748 "Cutoff details", 1:38 PM MST:** "Yes, test 75%"; "The Lumen win right away"; "Only after the tyrant is dead. If he is alive then you play it out until everyone is dead".
- **Card t1538s3754 "Succession details", 1:42 PM MST:**
  - "It can only be passed down twice. First to the red scar, then the mire bane, then the echo thief. The mind and others can't inherit the kill. If these ashen are not alive then the game ends. This all if the shadow blade doesn't take over first"
  - "Yes, the next Ash Fall"
  - "They inherit their own kill each night. So potentially 2 deaths happen per night if the ashen tyrant is alive"
- **Caden on the voice call, 1:45 PM MST:** "Twice, two times per game, but then following that order that we've laid out already."

**Backups:**
- `out/canvas-source.pre-cutoff-flag-1118.tsx` (the live source before the flag)
- `out/canvas-source.pre-succession-1118.tsx` (flag in, before the succession changes; this was live from 1:44 to 1:51 PM MST)

**1. Test rule: 75% succession cutoff** (state `testCutoff75`, OFF by default):
- **Setup:** a checkbox labelled "Test rule: 75% succession cutoff" appears at 7+ names. At 5–6 players it shows "not used at 5–6 players".
- **GM screen:** when the flag is on, a "Test rule ON" card shows starting Lumen, the cutoff, living Lumen, the kill holder and the deaths left before the cutoff, plus a GM reminder line.
- **Logic:**
  - The cutoff is checked only after the Tyrant is dead, and never while the Shadow Blade holds the kill. Threshold: living Lumen ≤ floor(0.75 × starting Lumen), e.g. 6 of 8 at 12p.
  - When a non-Blade Ashen holds or would receive the kill and the threshold is reached, the Lumen win with "Succession cutoff (test rule)".
- **INTERPRETATION (mine, flag for Caden):** the cutoff is "checked continuously after Tyrant death". It runs at every win check (after every Ash Fall, Lumination and Dawn Accord resolution, so after each death), not only at the moment the kill passes. This is why live-flag games end a bit more often as Lumen than in the study, which checked only at the pass.
- **Counting:** living Lumen = current Lumen team; starting Lumen = players dealt a Lumen role (Paradox included).

**2. Succession (Caden, Nov 18 card + call):**
- **Order:** the Shadow Blade first. Otherwise the next LIVING heir among The Red Scar, then The Ashen Mirebane, then The Echo Thief.
- **Limit:** at most 2 passes per game (state `successionPasses`).
- **Removed:** The Ashen Mind, a converted Paradox and the seat-order fallback can no longer inherit.
- **No heir:** if no heir is alive, or both passes are used when the holder dies, the game ends (`successionOver`). Winner: **Lumen win — APP DEFAULT, not ruled**, logged as such.
- **DEFAULT (not ruled):** a Shadow Blade takeover does NOT count as one of the 2 passes.
- Role texts for the Tyrant, Red Scar, Mirebane and Echo Thief are updated. GM tracking shows passes used.

**3. Heir kills on the next Ash Fall:**
- Confirmed for a Tyrant death at night: the app already did this. New test succ1118-03.
- After a Tyrant death by day (execution), the rulebook's night of peace is still applied (test succ1118-03b). **Open question for Caden:** does "Yes, the next Ash Fall" also remove that night of peace?

**4. Converted Paradox:**
- It already had its own nightly kill, resolved alongside the Tyrant's, so 2 deaths a night are possible.
- The text now cites Caden. The "pending" tag is removed from its kill screen, and the conversion result says "your own kill every Ash Fall … You never inherit the Tyrant kill".
- GM reminder: "Converted Paradox: X has its own kill every Ash Fall…".
- **DEFAULT (not ruled):** its kill continues after the Tyrant dies (test succ1118-05).

**5.** The cutoff flag applies on top of the new order (test succ1118-07).

**Scripts:**
- **New:** cutoff75-01…06b (7) and succ1118-01…07 incl. 03b (8).
- **Superseded with reasons:**
  - rule1118b-02: the Ashen Mind can no longer inherit, so the game ends at DA2 as an app-default Lumen win.
  - rule1118b-04: no-heir log text.
  - playtest-game9: P11 (Ashen Mind) can't inherit after P14 dies, so the game ends at L6 as an app-default Lumen win. Winner unchanged; round 7 not played.
- **Negative controls on the pre-change sources:**
  - Cutoff scripts on pre-cutoff-flag: 02 (2 mismatches), 03 (4), 05 (3) fail; 01, 04, 06 and 06b pass on both.
  - Succession scripts on pre-succession: 01 (6), 02 (1), 04 (5), 06 (2), 1118b-02 (4), 1118b-04 (2) and game9 (3) fail; 03, 03b, 05 and 07 pass on both (the behaviour already existed).

**Totals:** run-all **66/66** clean (0 mismatches, 0 crashes, 0 high). Typecheck 0 errors.

**Replays** (flag off): G6 lumen, G7 ashen, G8 shadow, G9 lumen (ends L6 instead of DA7), G10 lumen, G11 lumen, failsafe-only lumen. **No winner changed.**

**Batches:**
- **Flag off (0 crashes):** fuzz 50 gave 32 Ashen / 16 Lumen / 2 Shadow. Realistic 20-game runs: 8p 17/2/1, 12p 18/1/1, 18p 17/3/0.
- **200-game flag-off runs, study seeds** (Ashen/Lumen/Shadow/Syndic):

| Size | Before the succession change | After |
| :- | :- | :- |
| 8p | 147/45/3/5 | 144/48/3/5 |
| 12p | 160/30/6/4 | 160/32/6/2 |
| 16p | 173/22/5/0 | 168/26/5/1 |
| 18p | 132/56/11/1 | 131/57/11/1 |

- **200-game flag-ON runs, study seeds:** 8p 135/57/3/5, 12p 141/51/6/2, 16p 146/49/5/0, 18p 121/67/11/1.
  - That is close to the study's stop-pct-75 run (141/51, 144/47, 152/43, 122/66) and, because of the continuous check, almost the same as its stop-pct-100. The numbers are identical before and after the succession change.
  - High findings: `win-lumen-blade-alive` 2/1/0/1. These were already in the baseline, not caused by the flag.

**UI check** (`tools/ui-check-cutoff1118.mjs`, screenshots in `out/cutoff-flag/`):
- The setup toggle shows at 8 names, is off by default, and clicking it stores `testCutoff75`. At 6 it shows "not used at 5–6".
- The GM card shows "Starting Lumen: 7. Cutoff: 5…". There is no card with the flag off.
- Pax's kill screen shows the Caden note, and the GM reminder shows the converted Paradox line. No page errors.

**Publish:**
- **Flag:** 11 edits, about 1:44 PM MST.
- **Succession + Paradox:** 24 edits, about 1:51 PM MST.
- **Checks:** live == local (sha256 2554cb34…). Logo 1/1 (272f83f2…), portraits 26/26, symbols 3/3, title and Ahsoka snapshot line OK. Smoke render: logo OK, 17 images, dealt, the same 2 old errors.

**Job 2:** `out/sim-vs-live-lumen.md`. The sim's Lumen are much weaker than the live bots: 16–21% of executions hit an Ashen in the sim, against 47% live. Parser bugs and random voting are the main causes; a sim-only fix raises Lumen wins to 32–37% of games.

## 2026-11-18, 2:07 PM MST — Night of peace after EVERY pass (Caden 2:00 PM) + 1:57 PM card answers, published

**Caden's words (verified in Ahsoka's transcript):**
- 2:00 PM MST chat (t1543u): "I'd say there should be a night of peace and the heir kills the following ashfall." This replaces his 1:45 PM "Yes, the next Ash Fall".
- 1:57 PM MST card (t1541s3767, "Succession edge cases"):
  - "No, only Red Scar, Mirebane and Echo passes count" (a Blade takeover is not a pass).
  - "Yes, it keeps its kill" (the converted Paradox keeps its kill after the Tyrant dies).
  - "The Lumen win" (no heir left, or both passes used).
  - "After every death" (75% cutoff check timing).
  These four already matched the app's behaviour. Only the labels changed, from "app default" to "Caden (Nov 18 card)", in role text, logs, reminders and the Paradox form note.

**Backup:** `out/canvas-source.pre-peace-1118.tsx` (identical to the 1:51 PM live source).

**Engine change:**
- New state field `peaceRound`. Every pass of the Tyrant kill sets `peaceRound = round + 1`:
  - the Tyrant dies by day or by night;
  - each later heir pass;
  - a Shadow Blade takeover.
- The next Ash Fall after the death (peaceRound) has no inherited kill, and the new holder first kills on Ash Fall peaceRound + 1.
- `startRound` sets `nightOfPeace` when the new round equals peaceRound. `inheritedKillPaused()` is now used for the inherited kill, the Blade's shadowKill, and the inherited-kill check during resolution.
- Old behaviour: a night death used up the peace in the same Ash Fall (the heir killed the very next night), and later heir passes had no peace.

**Defaults (not ruled by Caden at 2:07; the Blade-peace and Paradox-peace items were confirmed by his 2:01–2:02 PM card, see the 2:12 PM entry):**
- **A Shadow Blade takeover also waits out the night of peace.** This is the default the user asked for, and the app and logs label it "app default".
- **The converted Paradox's own kill is NOT paused** by the night of peace.
- **Other Ashen night actions run as usual** (Mirebane poison, Echo Thief non-Tyrant copies, and so on). A copied Tyrant kill by the Echo Thief stays blocked on the peace night (unchanged).
- A pass caused by a death at the start of an Ash Fall (for example a delayed Syndic or poison death) also counts as that Ash Fall, so peace falls on the following one.

**Display:**
- **GM reminder:** "A night of peace is pending. / Night of peace is active. Night of peace: no inherited kill on Ash Fall N; [heir] ([role]) kills from Ash Fall N+1 (Caden, Nov 18)."
- **Succession reminder:** "… holds the inherited kill after the night of peace (first kill on Ash Fall N+1)".
- **Ahsoka snapshot:** "Night of peace: yes/no (peace Ash Fall N, inherited kill from Ash Fall N+1)".
- **Heir's screen:** a new "Inherited Tyrant kill" card reading "A night of peace comes first: no inherited kill on Ash Fall N. You first kill on Ash Fall N+1." (or "Tonight is a night of peace…", then "You hold the inherited Tyrant kill…").
- **Blade's "The blade is drawn" card:** "… Your kill begins on Ash Fall N+1."

**Scripts:**
- **New:** `tools/make-peace1118.py` writes these five scripts:
  - peace1118-01-night-death
  - 02-day-execution
  - 03-second-pass
  - 04-blade-takeover
  - 05-paradox-kill-during-peace
- **Superseded with reasons** (the old expectation is kept as a `superseded` entry; each script now runs to AF3 under the new rule):
  - `succ1118-03-heir-kills-next-ashfall`: AF2 kill → now peace, Rex kills Ben at AF3.
  - `rule1118b-05-tyrant-dies-mid-ashfall`: same.
- **Text updated only:**
  - succ1118-01, 02, 04, 06; rule1118b-02 and 04; game9 post-processing. These carry the new log wording and the "Caden (Nov 18 card)" labels.
  - succ1118-03b and 05 notes.
- **Negative controls** on the pre-peace source fail every new or changed script, as they should:
  - peace 01–05: 6/3/3/1/3 mismatches;
  - succ1118-03: 2; rule1118b-05: 2; succ1118-01: 3; succ1118-06: 1; rule1118b-04: 1.
  - A mutation check confirmed the `after: ashFall` reminder expectations are evaluated.

**Totals:** run-all **71/71** clean (0 mismatches, 0 crashes, 0 high). Typecheck 0 errors. Replays G6 lumen, G7 ashen, G8 shadow, G9 lumen, G10 lumen, G11 lumen, failsafe-only lumen: unchanged.

**UI check** (`tools/ui-check-peace1118.mjs`, screenshots in `out/peace/`):
- GM pending/active lines are present.
- Rex sees the pending line (round 1, day), "Tonight is a night of peace" at AF2, and the kill form plus "You hold the inherited Tyrant kill" at AF3.
- The Blade card shows "Your kill begins on Ash Fall 3".
- No page errors. The cutoff UI check is unchanged.

**Publish:**
- 26 edits in one EditCanvas call, 2:07 PM MST. Live == local (sha256 cac559b4…).
- Logo 1/1 (272f83f2…), portraits 26/26, symbols 3/3, Ahsoka update line present.
- Smoke render: logo OK, 17 images, dealt, the same 2 old errors.

**Batches with the current bots** (Ashen/Lumen/Shadow/Syndic, 200 games, study seeds, 0 crashes, 0 mismatches):

| Size | Flag off, 1:51 | Flag off, peace | Flag on, 1:51 | Flag on, peace |
| :- | :- | :- | :- | :- |
| 8p | 144/48/3/5 | 144/48/3/5 | 135/57/3/5 | 135/57/3/5 |
| 12p | 160/32/6/2 | 157/36/4/3 | 141/51/6/2 | 141/53/4/2 |
| 16p | 168/26/5/1 | 170/23/6/1 | 146/49/5/0 | 146/48/6/0 |
| 18p | 131/57/11/1 | 132/56/11/1 | 121/67/11/1 | 121/67/11/1 |

- Fuzz 50: 32/16/2. Realistic 20-game: 8p 17/2/1, 12p 18/1/1, 18p 17/3/0.
- High findings: `win-lumen-blade-alive` 2/1/0/1, the same as the baseline.
- The effect is small because the bots rarely kill the Tyrant at night or pass the kill twice.

## 2026-11-18, 2:09 PM MST — Lumen bot fixes folded into the main sim (sim only, app untouched)

- `lib/realistic.mjs` was replaced with `study-lumen/lib/realistic.mjs`. Backup: `out/realistic.pre-lumenfix-1118.mjs`. The fixes:
  - **F1:** an Eye "The Ashen Tyrant is X" result is parsed as the prime suspect.
  - **F3:** a Warden Ash Touched read is no longer an Ashen suspect.
  - **F6:** Quadrant Judge "3 cleared → the 4th".
  - **F4:** Lumen avoid trusted players when nominating or voting, and vote No execution if only trusted players are named.
  - **F7:** info roles target untrusted players 85% of the time.
  - **F5:** hits are shared 95% of the time, other results 45%.
- run-all is still **71/71** clean.
- **Batches with the fixed bots** (200 games, same seeds, 0 crashes, 0 mismatches):

| Size | Flag off | Flag on |
| :- | :- | :- |
| 8p | 124/64/6/6 | 115/74/6/5 |
| 12p | 117/72/7/4 | 103/86/7/4 |
| 16p | 129/67/1/3 | 98/100/1/1 |
| 18p | 115/73/7/4 + 1 no winner | 105/83/7/4 + 1 no winner |

- Fuzz 50: 29/19/2. Realistic 20-game: 8p 14/5/1, 12p 14/6/0, 18p 7/10/3 (Ashen/Lumen/Shadow).
- High findings: `win-lumen-blade-alive` 2/2/1/2 off, 2/2/1/2 on.
- **No winner:** seed 25032 at 18p hit the 25-round cap (medium `no-winner-max-rounds`).
  - Cause: a bot quirk, not an engine bug. Remy's Night-1 check on Mira (the Tyrant) came back "Lumen" because Remy was Mire Touched.
  - With F4, Mira is "trusted", so 8 Lumen nominate her but vote No execution, while Tova shields every kill target.
  - A possible sim tweak (not done): weight nominations or a majority over F4's trusted list.

## 2026-11-18, 2:12 PM MST — Peace defaults relabelled as Caden's card answers (labels only) + sim stall fix, published

**Caden's card answers (2:01–2:02 PM MST).** These were relayed with quotes by Ahsoka. Her transcript view hides card tool results, so I confirmed them from her relay and her replies right after the card:
- "Yes, a pause at every handoff."
- "Yes, the Blade waits one Ash Fall too."
- "Yes, the Paradox still kills."

**App change: labels only, no logic change.** Backup: `out/canvas-source.pre-peacelabels-1118.tsx`.
- The three former defaults now read "Caden (Nov 18 card)", with quotes, in these places:
  - Paradox role text and kill-form note.
  - Blade takeover log and heir-pass Blade log.
  - GM peace reminder and converted-Paradox reminder.
  - Code comment.
- "Other Ashen night actions are not paused" is still an app default (not ruled).
- **TEST-LOG relabel** for the 2:07 PM entry above: the Blade takeover peace and the Paradox kill during peace are now Caden's rulings, no longer defaults.
- 7 edits, published 2:12 PM MST. Live == local (sha256 592ed0a0…). Logo 1/1, portraits 26/26, symbols 3/3, Ahsoka line OK. Smoke render: logo OK, 17 images, dealt, the same 2 old errors.

**Tests:**
- `peace1118-04` now expects the new Blade log wording.
- Notes updated in `make-peace1118.py` and `make-succession1118.py`.
- run-all **71/71** clean.

**Sim stall fix** (`lib/realistic.mjs`, sim only; backup `out/realistic.pre-stallfix-1118.mjs`):
- A Lumen bot with no untrusted name on the ballot now votes, 70% of the time, for a named player who drew nominations from at least half the living table, unless that player is a revealed Lumen. A "clear" can be false info.
- Seed 25032 at 18p used to stall to the round cap. It now ends with a Lumen win in round 10.

**18p fixed bots, 200 games, seed 25000** (Ashen/Lumen/Shadow/Syndic):
- Flag off: 115/74/7/4. Before the fix: 115/73/7/4 + 1 game with no winner.
- Flag on: 105/84/7/4. Before the fix: 105/83/7/4 + 1 game with no winner.
- 0 crashes, 0 mismatches; `win-lumen-blade-alive` 2 (baseline).

## 2026-11-21, 5:03 PM MST — Shield saves a Soulbound player (Caden, Nov 21, Game 12), published

**Ruling:** Caden (Nov 21, 4:58 PM MST, card in Ahsoka's chat during Game 12). His card text is hidden in the transcript view; Ahsoka replied "Got it, the shield saves him" and relayed the ruling.
- A shield saves a Soulbound player whose partner dies while they are shielded (that Ash Fall or the following Lumination).
- A shield never stops execution: if the shielded player is executed, their partner still dies.

**DEFAULT (inference from the shield's window, not Caden's words):** if the partner is executed at the Dawn Accord while the other player's shield is still active, the shield saves them.
- The code saves any pair member whose shield is active at the moment of the death.
- **Note:** in this app shields end when Lumination ends, before the Dawn Accord begins. So at a normal execution the partner is no longer shielded and dies. The default only matters if the GM marks the player Shielded by hand. Flagged for Caden.

**Backup:** `out/canvas-source.pre-shieldsoul-1121.tsx`.

**Change:**
- In `applyDeath`, the old "Placeholder (OPEN): … delays the linked death while the shield holds" log is replaced. It now reads "Shield saved X from Soulbound death (their partner Y died: reason). Caden (Nov 21): a shield saves a Soulbound player."
- The behaviour was already "partner survives"; the change is the ruling label plus the GM log line.
- The GM Soulbound reminder now ends with "A shield saves the partner of a Soulbound player who dies, but a shield never stops execution (Caden, Nov 21)."

**Tests:** `tools/make-shieldsoul1121.py` writes 4 scripts:
- 01: night kill, shielded partner lives.
- 02: no shield, both die.
- 03: shielded player executed, partner dies.
- 04: partner executed at DA after the shield window, so the other player dies.

On the pre-change source only 01 fails (2 mismatches, the log line), since the survival behaviour already existed. 02–04 lock in existing behaviour. run-all **75/75** clean. Typecheck 0 errors.

**Publish:** 2 edits, 5:03 PM MST. Live == local (sha256 e734dd0f…). Logo 1/1, portraits 26/26, symbols 3/3, Ahsoka line OK. Smoke render: logo OK, 17 images, dealt, the same 2 old errors.

**Batch** (lean, fixed bots): 12p, 200 games, seed 19000, flag off. Result 116/73/7/4 (Ashen/Lumen/Shadow/Syndic); before, 117/72/7/4. 0 crashes, 0 mismatches, 0 no-winner games; `win-lumen-blade-alive` 2 (baseline).

## 2026-11-21, 5:14 PM MST — Game 12 replay (cutoff flag ON), no app change

**Script:** `tools/make-game12.py` → `scripts/playtest-game12.json`.
- 18p with the seating from `/workspace/aol-playtest/game12.md`.
- P10 Warden is Ash Touched and Soulbound with P9.
- `testCutoff75: true`, rechargeAt 8.
- AF1 Warden result forced false (the table's draw was 0.023).

**Result:** 0 mismatches, 1 superseded. The app reaches the same end as the table: P15 (The Ashen Tyrant) executed at DA3, cutoff trips at 9/12 Lumen, Lumen win.

**Checked step by step against the table (all match):**
- **Setup:** Bearer P11 "do not share".
- **AF1:**
  - The Failsafe cancels P14's Silent Hand.
  - Blade: P11 not the Tyrant. Eye on P11: miss. Elder: P7 Lumen.
  - Warden false result: "P13 … Ash Touched". Parallax: P18 + P17 same team.
  - P10 killed. "Shield saved P9 from Soulbound death" (Caden, Nov 21).
- **L1/DA1:** ballot P12/P11/P6. P12 executed 16–2 (Voice ×2), P10's dead vote saved.
- **AF2:**
  - Witness: Unaligned. The Echo Thief can't copy the Syndic.
  - The Failsafe cancels the Blade check (no result). The kill on P11 is blocked by the shield. Silent Hand on P6.
  - Elder: P6 Lumen. Parallax: P18/P5 not the same team.
- **L2/DA2:** the Red Scar kills P7. Ballot P5/P6/No execution. P5 (Blade) executed 14–1.
- **AF3:**
  - Echo can't copy the Blade.
  - P18 killed, but his Parallax result (P3 not the same team) is still delivered.
  - Elder: P18 Lumen. Eye on P17: miss.
- **L3/DA3:**
  - Sunmark shot at P1 misses. Ballot P15/P17/P11.
  - Dead votes P7, P12, P10 counted; P18 gets "max votes reached". P15 executed 11–4. Cutoff log, Lumen win.

**Differences:**
1. **Table practice (superseded, Caden ruling 3):** at DA2 the table left P6's Silent Hand-voided nomination off the public list. The app lists it and doesn't count it. At L3 the table did list P16's voided nomination, so it was inconsistent within the game.
2. **Random draws (not a difference):**
   - Eye-miss Mire picks: the table drew P1 (AF1), P7 (AF2), P1 (AF3); the app with seed 12 drew P15, P9, P16.
   - No table result depends on these (P7 died before any poisoned info, the Failsafe gets no info).
   - Seed search was skipped to keep usage lean.
3. **Rule gap:** the Eye kept checking at AF3 after the Ash Touched player (P10) was dead. Every such check is a guaranteed miss that poisons a random player. rb.md and the app agree (it only stops after a find or the Tyrant's death). G9–G11 used a table rule for this that isn't in rb.md. Question for Caden.
4. **Harness note:** `win-lumen-enemies-alive` (medium) fires because the harness check doesn't know the cutoff win. This is expected.
5. **GM-log ambiguity (cutoff while the Blade is alive):** moot here, because the Blade was dead. The app's answer is that the Blade is exempt and still takes over (Caden, Nov 18 card).

**Totals:** run-all **76/76** clean. App unchanged (no clear bug found), so no republish.

## Nov 21, 2026 — Rulebook audit (Ahsoka's brief, 23 items), published 6:28 PM MST

Authority: Caden asked Ahsoka to fix every flaw and make the game ready, with permission for all needed changes (her transcript, pos 4157–4158). Design defaults D1–D57 (rb.md section 12) are still **pending Caden**, so each one the app had to change is a **GM setup toggle, on by default, labelled "Default pending Caden"**. Off restores the earlier app behaviour. Backup: `out/canvas-source.pre-audit-1121.tsx`.

**Toggles (Setup panel, "Design defaults (Nov 21 rulebook audit)", with All on / All off):** D2 Civic at ≤4 after any Accord vote · D5 Ashen Child still wins after a takeover · D6 win priority (Syndic before the Lumen wins) · D11 Accord poison lasts to the end of the next Accord · D16 Overseer shield ends when the Overseer dies · D18 an executed partner kills a Shielded partner · D19 Lumen Guard survives its partner · D28 Echo copying Ashen Child/Civic gets nothing · D34 Eye resolves before other info · D36 Paradox flip sources (Red Scar day kill and copied kills count; blocked attempts and the Blade don't) · D38 Judge: 1 Ashen + 3 non-Ashen, never the Judge · D43 Eye after the Ash Touched player dies asks "is this The Ashen Tyrant?", and a miss poisons nobody · D45 Eye poison pool excludes the Eye · D47 no Red Scar day kill in L1 (refused at submission, use not spent) · D48 Red Scar told "Your kill failed." · D53 a summoned player can't cast a personal final vote that Accord · D56 Catalyst swap carries use counts and swaps them back · R7 no All Roles roster for players until the game ends (rb.md rule 7, attributed to Caden, not matched to his own words). The GM state summary lists any toggle that's off. Harness: `script.designDefaults` (e.g. `{"D43": false}`); for batches, the `AOL_DD` env var.

**Relabelled (behaviour already matched):** D4 parity text, D13 shield vs poison, D14 Guard poison immunity (3 places), D15/D20 Sunmark shot, D22 night-of-peace note, D32 converted Paradox bullet, D33 Bearer (placeholder removed), D37 voided voters, D41 Necro void, D52 player-count ranges, D53 dead-vote note, D2 Civic role text and close-of-Accord comment. No "Placeholder (OPEN)" text remains. One "pending Caden" badge component remains (generic UI badge).

**Bug fix:** the Necroreclaimer's summon form submitted "Necroreclaimer summon", but the engine matched "Summon" (case-sensitive), so summons were never recorded: no 3-vote bundle, no locked ballots, no summon chat. It's now case-insensitive (regression: audit1121-12/13).

**Flagged, not changed:** D1 (a Lumen win needs a converted Paradox dead) conflicts with Caden's rulings that the Lumen win when the active Blade dies or no heir is left, and with the cutoff win; the all-Ashen-dead path already requires it. The brief's "cutoff default ON" conflicts with the earlier instruction to keep it off by default. D27 (Voice reveal) has no app step. D46/D56 "both swapped players are asked for the night action they now hold" isn't modelled (actions resolve by effective role). A three-poison death is still delayed by a shield (D13 doesn't cover it). Primer and announcement templates live outside the app ("5-death recharge rule"; "When The Syndic wins, everyone else loses"). No rechargeAt 8/4 logic remains (dead field).

**Regression:** 98/98 clean (76 earlier plus 22 new `audit1121-*` from `tools/make-audit1121.py`). Negative controls on the pre-audit source: every default-ON case fails except 09 (D5 takeover, already matching) and 14 (D55, already matching); every OFF case passes, so the old behaviour is preserved. New harness checks: `logForbids`, `poisonCounts`, op `gmToggle` (the GM panel flags), and the Paradox flip after `resolveLumination`.

**Replays (Games 6–12):**
- Game 12: as expected, under D43 the AF3 Eye check on P17 asks about The Ashen Tyrant and poisons nobody, so P1's second poison disappears (superseded entry). Same Lumen cutoff win at DA3. Seed 12→1, because D34/D45 shift the random draws.
- Game 10: under D43 the AF3–AF6 Eye misses (table: P14, P18, P8, P12) poison nobody. Same Lumen win. Seed 261→152 (AF1 P3 and AF2 P1 still match the table).
- Game 6: with D16 on, the Overseer P10 dies at AF4, P1's shield ends, and the Red Scar's L4 day kill kills P1 (the table blocked it). D16 is pinned OFF in the replay.
- Game 7: with D47 on, the L1 Red Scar day kill on P13 is refused and the game diverges (no Ashen win at AF3). D47 is pinned OFF in the replay.
- Games 8, 9, 11: unchanged.

**UI:** `tools/ui-check-audit1121.mjs`: setup shows the toggle block (19 checkboxes), the player roster is hidden mid-game and shown at game end, R7 off shows it. No page errors. Peace and cutoff UI checks unchanged. Smoke render: logo OK, 17 images, dealt, the same 2 old errors.

**Publish:** 69 edits in one EditCanvas call, 6:28 PM MST. Live == local (sha256 7b562cd3…). Logo 1/1, portraits 26/26, symbols 3/3 (2747dec8/cff9d802/f6bc0644), Ahsoka update line present.

**12p batch** (200 games, seed 19000, fixed bots, defaults on): Ashen 123, Lumen 72, Shadow 5, Syndic 0. 0 crashes, 0 mismatches, 0 no-winner games. High findings: win-lumen-blade-alive 2 (baseline). Before (5:03 PM): 116/73/7/4. With all toggles off: 115/73/7/5. Syndic wins are rare (0–5 per 200) and move with any random-draw change; no single toggle accounts for the drop.

## Nov 21, 2026 — Audit follow-ups (Ahsoka), published 6:34 PM MST
Backup: `out/canvas-source.pre-followup-1121.tsx`.
- D1 and the cutoff (off by default): no change, as confirmed.
- Three-poison death (rb.md lines 164 and 172; normal rule, not a toggle). Bug fix: a death queued during an Ash Fall (third poison from the Mirebane or the Eye) used to happen that same night. It now waits for the kill step of the next Ash Fall. Any protection (a shield or immunity) delays it to the first unprotected night. The sim uses the engine, so it gets the same fix. Tests: audit1121-23 (third poison on AF3, death on AF4) and audit1121-24 (shielded on AF4 and AF5, death on AF6). Both fail on the pre-follow-up source, as expected.
- R7 is removed as a toggle. Fixed rule, Caden (Nov 16): players don't learn which roles are in play. The All Roles card is the fixed 26-role catalogue (ROLES; nothing filtered, counted or marked by the deal), so it stays visible to players all game; its note now says so. No other player-facing count, in-play badge or deal-based list exists (the distribution label and the deal log are GM-only; Ashen see teammates' names only, per the role rules). New: players get a "Roles in this game" card only once the game is over.
- Regression 100/100 clean. UI check: the player sees All Roles mid-game and no in-play list; at game end, both. Smoke render: logo OK, 17 images, dealt, the same 2 old errors. Publish: 9 edits, live == local, logo 1/1, portraits 26/26, symbols 3/3, Ahsoka update line present.
