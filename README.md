# Ashes of Lumination

A phone-first companion for Caden's social deduction game. One person hosts as GM. Everyone else joins with a room code, sees only their own role, and plays Ash Fall, Lumination, and the Dawn Accord live.

The rules are the prototype engine in `local-render/canvas-source.tsx`, bundled the same way as `sim/build-engine.mjs`. `npm test` replays all 100 scripts in `sim/scripts` against that engine, then the multiplayer test. The 75% succession cutoff stays off. The 17 design defaults are the prototype's toggles, on unless the GM switches one off, each labelled Default pending Caden.

## Play locally

```bash
npm install
npm start
```

Open the printed URL. Create a game on one phone (or a browser window), then join from the others with the room code.

`npm start` builds the client and serves it, with WebSockets, on port 47831 unless `PORT` is set.

## Tests

```bash
npm test          # rules engine + a scripted 5-player game over HTTP
npm run test:e2e  # the same loop in phone-sized browser sessions
```

The browser test needs Chromium: `npx playwright install chromium`.

There is no agent API. The GM talks to each player in a private thread on the table. Hosting steps are in [DEPLOY.md](DEPLOY.md).
