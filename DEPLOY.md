# Deploy

This is one Node process. It serves the built site, the HTTP API, and WebSockets. Games live in memory and are snapshotted to `data/games.json`. A game lasts a few hours; the file survives a restart on a host with a real disk, and it disappears on hosts that wipe the filesystem when the process sleeps.

No accounts were available from this environment, so there is no public URL yet. The first time you host it, this is the whole setup.

## Render (simplest free start)

Create a **Web Service** (Node runtime) from this GitHub repo. Use the repository root. Do not set a custom root directory.

| Setting | Value |
| --- | --- |
| Node version | **22** (pinned by `.node-version` and `package.json` `engines.node` `22.x`. If the dashboard has a Node version field, choose 22, or set `NODE_VERSION` to `22`.) |
| Build command | `npm install && npm run build` |
| Start command | `node server/index.js` |

`npm run build` runs `node sim/build-engine.mjs && vite build`. That bundles the rules engine with esbuild from the root `node_modules`, then writes the client to `dist/`. Vite, esbuild, Tailwind, and the React plugin are production dependencies, so they install on Render when `NODE_ENV` is `production` and devDependencies are skipped.

The process listens on `0.0.0.0` and `process.env.PORT`. Render sets `PORT`. Leave it unset in the dashboard.

Deploy. The service URL is the link you send. Friends open it in a phone browser. No install.

The free instance sleeps when idle, and its disk is ephemeral, so a sleeping service can forget an in-progress game. For a game night, open the URL once before people arrive, or use the VPS option.

## A small VPS (stays up for the night)

On an Ubuntu box, about $4–6 a month (Hetzner, DigitalOcean, or similar):

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
git clone <this-repo> ashes && cd ashes
npm install
npm run build
PORT=8080 nohup node server/index.js > server.log 2>&1 &
```

Point a domain at the box, or share `http://THE_SERVER_IP:8080`. For HTTPS, put Caddy or nginx in front and proxy to port 8080, including WebSocket upgrade.

To keep it across logout, use systemd instead of `nohup`:

```ini
[Service]
WorkingDirectory=/root/ashes
ExecStart=/usr/bin/node server/index.js
Environment=PORT=8080
Restart=on-failure
```

`data/games.json` is the save file. Copy it if you move machines.

## What you do not need

No database, no separate client host, and no API keys.
