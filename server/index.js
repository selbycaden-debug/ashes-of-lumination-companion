import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { freshTable, reduce, viewFor } from "./table.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "dist");
const DATA = path.join(ROOT, "data", "games.json");
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function load() {
  try {
    return JSON.parse(fs.readFileSync(DATA, "utf8"));
  } catch {
    return { games: {} };
  }
}

function save(db) {
  fs.mkdirSync(path.dirname(DATA), { recursive: true });
  const copy = { games: {} };
  for (const [code, game] of Object.entries(db.games)) {
    copy.games[code] = {
      code: game.code,
      gmToken: game.gmToken,
      gmName: game.gmName,
      seats: game.seats || {},
      chats: game.chats || [],
      statements: game.statements || [],
      seq: game.seq || 1,
      engine: game.engine,
    };
  }
  fs.writeFileSync(DATA, JSON.stringify(copy));
}

function makeCode(db) {
  let next = "";
  do {
    next = "";
    const bytes = randomBytes(4);
    for (const b of bytes) next += ALPHABET[b % ALPHABET.length];
  } while (db.games[next]);
  return next;
}

function makeToken() {
  return randomBytes(24).toString("hex");
}

function send(res, status, body, type = "application/json") {
  const payload = type === "application/json" ? JSON.stringify(body) : body;
  res.writeHead(status, {
    "content-type": type === "application/json" ? "application/json; charset=utf-8" : type,
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type, authorization, x-agent-key",
    "cache-control": "no-store",
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => {
      chunks.push(chunk);
      if (chunks.reduce((n, c) => n + c.length, 0) > 1_000_000) reject(new Error("That request is too large."));
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("The request body was not JSON."));
      }
    });
    req.on("error", reject);
  });
}

export function start(port = 0) {
  const db = load();
  const sockets = new Map();

  function persist() {
    save(db);
  }

  function findToken(token) {
    if (!token) return null;
    for (const game of Object.values(db.games)) {
      if (game.gmToken === token) return { game, viewer: { kind: "gm" } };
      const name = game.seats?.[token];
      if (!name) continue;
      const player = game.engine.players.find((p) => p.name === name);
      return { game, viewer: { kind: "player", playerId: player?.id || "", name } };
    }
    return null;
  }

  function present(game, viewer) {
    return viewFor(game.engine, viewer, { code: game.code, chats: game.chats || [], statements: game.statements || [] });
  }

  function broadcast(game) {
    const set = sockets.get(game.code);
    if (!set) return;
    for (const client of set) {
      if (client.ws.readyState !== 1) continue;
      const session = findToken(client.token);
      if (!session) continue;
      client.ws.send(JSON.stringify({ type: "state", state: present(game, session.viewer) }));
    }
  }

  function mutate(game, action) {
    if (action.type === "chat") {
      const text = String(action.text || "").trim().slice(0, 800);
      if (!text) throw new Error("Write a message.");
      if (action.channel === "ashen" || action.channel === "lumen") throw new Error("Team chat is closed. Talk at the table.");
      const named = game.engine.players.find((p) => p.id === action.playerId) || game.engine.players.find((p) => p.name === action.playerId);
      const playerId = named?.id || action.playerId;
      const who = game.engine.players.find((p) => p.id === playerId) || game.engine.players.find((p) => p.name === action.seatName);
      const from = action.from === "gm" ? "gm" : "player";
      const seatName = who?.name || action.seatName || "";
      const name = from === "gm" ? "GM" : seatName || "Player";
      game.chats.push({ id: game.seq++, channel: "gm", from, playerId: who?.id || playerId, name, seatName, text });
      persist();
      broadcast(game);
      return;
    }
    if (action.type === "submit" && action.kind === "statement") {
      const who = game.engine.players.find((p) => p.id === action.playerId);
      if (!who?.alive || game.engine.phase !== "lumination") throw new Error("The day is closed.");
      const text = String(action.text || "").trim().slice(0, 600);
      game.statements = (game.statements || []).filter((s) => s.playerId !== who.id);
      if (text) game.statements.push({ playerId: who.id, name: who.name, text });
      persist();
      broadcast(game);
      return;
    }
    const phaseBefore = game.engine.phase;
    game.engine = reduce(game.engine, action);
    if (action.type === "deal") {
      for (const chat of game.chats || []) {
        if (game.engine.players.some((p) => p.id === chat.playerId)) continue;
        const match = game.engine.players.find((p) => p.name === chat.seatName || p.name === chat.name);
        if (match) chat.playerId = match.id;
      }
    }
    if (game.engine.phase === "ashFall" && phaseBefore !== "ashFall") game.statements = [];
    persist();
    broadcast(game);
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (req.method === "OPTIONS") {
      send(res, 204, "");
      return;
    }
    try {
      if (url.pathname.startsWith("/api/")) {
        await route(req, res, url);
        return;
      }
      serveStatic(res, url.pathname);
    } catch (error) {
      send(res, error.status || 400, { ok: false, error: error.message || "Something went wrong." });
    }
  });

  async function route(req, res, url) {
    if (req.method === "GET" && url.pathname === "/api/health") {
      send(res, 200, { ok: true });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/games") {
      const body = await readBody(req);
      const gmName = String(body.gmName || "GM").trim().slice(0, 24) || "GM";
      const code = makeCode(db);
      const game = {
        code,
        gmToken: makeToken(),
        gmName,
        seats: {},
        chats: [],
        statements: [],
        seq: 1,
        engine: freshTable(),
      };
      db.games[code] = game;
      persist();
      send(res, 200, { ok: true, code, gmToken: game.gmToken, gmName });
      return;
    }

    const join = url.pathname.match(/^\/api\/games\/([A-Z0-9]{4})\/join$/);
    if (req.method === "POST" && join) {
      const game = db.games[join[1]];
      if (!game) throw new Error("No game uses that code.");
      const body = await readBody(req);
      const name = String(body.name || "").trim();
      game.engine = reduce(game.engine, { type: "add-player", name });
      const playerToken = makeToken();
      game.seats[playerToken] = name.slice(0, 24);
      persist();
      broadcast(game);
      const player = game.engine.players.find((p) => p.name === game.seats[playerToken]);
      send(res, 200, { ok: true, token: playerToken, playerId: player?.id || game.seats[playerToken], code: game.code });
      return;
    }

    if (url.pathname.startsWith("/api/agent")) {
      send(res, 404, { ok: false, error: "There is no agent API." });
      return;
    }

    const session = findToken((req.headers.authorization || "").replace(/^Bearer\s+/i, ""));
    if (!session) {
      const error = new Error("That seat token is not valid.");
      error.status = 401;
      throw error;
    }
    if (req.method === "GET" && url.pathname === "/api/state") {
      send(res, 200, present(session.game, session.viewer));
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/action") {
      const body = await readBody(req);
      if (session.viewer.kind === "player") {
        const allowed = new Set(["submit", "vote", "notes", "chat", "invite-response"]);
        if (!allowed.has(body.type)) throw new Error("Players cannot do that.");
        body.playerId = session.viewer.playerId;
        body.seatName = session.viewer.name;
        if (body.type === "chat") body.from = "player";
      }
      mutate(session.game, body);
      send(res, 200, { ok: true, state: present(session.game, session.viewer) });
      return;
    }
    throw new Error("Unknown route.");
  }

  const wss = new WebSocketServer({ server, path: "/ws" });
  wss.on("connection", (ws, req) => {
    const url = new URL(req.url, "http://localhost");
    const session = findToken(url.searchParams.get("token"));
    if (!session) {
      ws.close(4001, "bad token");
      return;
    }
    const client = { ws, token: url.searchParams.get("token") };
    if (!sockets.has(session.game.code)) sockets.set(session.game.code, new Set());
    sockets.get(session.game.code).add(client);
    ws.send(JSON.stringify({ type: "state", state: present(session.game, session.viewer) }));
    ws.on("close", () => sockets.get(session.game.code)?.delete(client));
  });

  return new Promise((resolve) => {
    server.listen(port, "0.0.0.0", () => {
      const address = server.address();
      resolve({
        server,
        port: address.port,
        close() {
          wss.close();
          return new Promise((done) => server.close(() => done()));
        },
      });
    });
  });
}

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".json": "application/json",
  ".ico": "image/x-icon",
};

function serveStatic(res, pathname) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const file = path.normalize(path.join(DIST, requested));
  if (!file.startsWith(DIST)) {
    send(res, 403, { ok: false, error: "Forbidden." });
    return;
  }
  const target = fs.existsSync(file) && fs.statSync(file).isFile() ? file : path.join(DIST, "index.html");
  if (!fs.existsSync(target)) {
    send(res, 503, { ok: false, error: "The client has not been built. Run npm start." });
    return;
  }
  res.writeHead(200, { "content-type": TYPES[path.extname(target)] || "application/octet-stream" });
  fs.createReadStream(target).pipe(res);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const port = Number(process.env.PORT || 47831);
  start(port).then(({ port: bound }) => {
    console.log(`Ashes of Lumination listening on http://127.0.0.1:${bound}`);
  });
}
