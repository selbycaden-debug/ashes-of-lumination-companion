import { useEffect, useMemo, useRef, useState } from "react";
import { Avatar, factionClass, formatClock, Fuse, RoleHero, Stage, TabBar } from "./theme/ui.jsx";

const TOKEN_KEY = "aol-seat-token";
const ASSET_VERSION = "3";

function symbolFile(team) {
 if (team === "Ashen" || team === "ashen") return "symbol-ashen-128";
 if (team === "Unaligned" || team === "unaligned") return "symbol-unaligned-128";
 return "symbol-lumen-128";
}

function symbolSrc(team) {
 return `/symbols/${symbolFile(team)}.webp?v=${ASSET_VERSION}`;
}

function Portrait({ roleId, name, size = 112, dead = false }) {
 if (!roleId) return null;
 const src = dead
 ? `/portraits-remnant/${roleId}-remnant.webp?v=${ASSET_VERSION}`
 : `/portraits/${roleId}.webp?v=${ASSET_VERSION}`;
 const height = size === 112 ? Math.round(size * 1.25) : Math.round(size * 4 / 3);
 return (
 <img
 src={src}
 alt=""
 width={size}
 height={height}
 data-testid={dead ? "remnant-portrait" : "portrait"}
 data-role={roleId}
 style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
 />
 );
}

function Symbol({ team, size = 22 }) {
 return <img src={symbolSrc(team)} alt="" data-testid={`symbol-${symbolFile(team)}`} width={size} height={size} style={{ width: size, height: size }} />;
}

function FrameCorners({ team }) {
 const spots = [
 { top: 4, left: 4 },
 { top: 4, right: 4 },
 { bottom: 4, left: 4 },
 { bottom: 4, right: 4 },
 ];
 return spots.map((spot) => (
 <img key={`${spot.top ?? "b"}-${spot.left ?? "r"}`} src={symbolSrc(team)} alt="" data-testid="frame-symbol" className="pointer-events-none absolute h-5 w-5" width={20} height={20} style={spot} />
 ));
}

function Crest({ roleId, alignment, size = 76 }) {
 const hue = alignment === "ashen" ? 14 : alignment === "unaligned" ? 262 : 36;
 const n = [...(roleId || "ash")].reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
 const rings = 2 + (n % 3);
 return (
 <svg width={size} height={size} viewBox="0 0 80 80" aria-hidden="true">
 <circle cx="40" cy="40" r="37" fill={`hsl(${hue} 42% 16%)`} stroke={`hsl(${hue} 72% 64%)`} strokeWidth="2" />
 {Array.from({ length: rings }, (_, i) => (
 <circle key={i} cx="40" cy="40" r={12 + i * 7} fill="none" stroke={`hsl(${hue} 60% 72%)`} strokeOpacity={0.75 - i * 0.18} />
 ))}
 {n % 4 === 0 && <path d="M40 18 L46 34 H62 L49 44 L54 62 L40 51 L26 62 L31 44 L18 34 H34 Z" fill={`hsl(${hue} 80% 76%)`} />}
 {n % 4 === 1 && <path d="M40 16 C52 30 64 30 64 42 C64 58 40 68 40 68 C40 68 16 58 16 42 C16 30 28 30 40 16 Z" fill={`hsl(${hue} 80% 76%)`} />}
 {n % 4 === 2 && <path d="M24 50 L40 16 L56 50 L40 42 Z M28 56 H52 L40 68 Z" fill={`hsl(${hue} 80% 76%)`} />}
 {n % 4 === 3 && <path d="M40 18 V62 M22 40 H58 M28 26 L52 54 M52 26 L28 54" stroke={`hsl(${hue} 80% 76%)`} strokeWidth="3" fill="none" />}
 </svg>
 );
}

async function api(path, { token, body, method } = {}) {
 const res = await fetch(path, {
 method: method || (body ? "POST" : "GET"),
 headers: {
 ...(body ? { "content-type": "application/json" } : {}),
 ...(token ? { authorization: `Bearer ${token}` } : {}),
 },
 body: body ? JSON.stringify(body) : undefined,
 });
 const text = await res.text();
 const data = text ? JSON.parse(text) : {};
 if (!res.ok || data.ok === false) throw new Error(data.error || "The table did not answer.");
 return data;
}

function useSeat(token) {
 const [state, setState] = useState(null);
 const [connected, setConnected] = useState(false);
 const [error, setError] = useState("");

 useEffect(() => {
 if (!token) return undefined;
 let ws;
 let stop = false;
 let timer;
 const pull = () => api("/api/state", { token }).then(setState).catch((err) => setError(err.message));
 const connect = () => {
 const proto = location.protocol === "https:" ? "wss" : "ws";
 ws = new WebSocket(`${proto}://${location.host}/ws?token=${encodeURIComponent(token)}`);
 ws.onopen = () => setConnected(true);
 ws.onmessage = (event) => {
 const msg = JSON.parse(event.data);
 if (msg.state) setState(msg.state);
 };
 ws.onclose = () => {
 setConnected(false);
 if (!stop) timer = setTimeout(connect, 1200);
 };
 };
 pull();
 connect();
 return () => {
 stop = true;
 clearTimeout(timer);
 ws?.close();
 };
 }, [token]);

 async function act(action) {
 setError("");
 try {
 const data = await api("/api/action", { token, body: action });
 if (data.state) setState(data.state);
 return data;
 } catch (err) {
 setError(err.message);
 throw err;
 }
 }

 return { state, connected, error, setError, act };
}

export default function App() {
 const params = new URLSearchParams(location.search);
 const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY) || "");
 const seat = useSeat(token);

 function remember(next) {
 localStorage.setItem(TOKEN_KEY, next);
 setToken(next);
 }

 function leave() {
 localStorage.removeItem(TOKEN_KEY);
 setToken("");
 }

 if (!token) return <Gate presetCode={params.get("room") || ""} onToken={remember} />;
 if (!seat.state) {
 return (
 <Stage>
 <p className="muted" style={{ padding: 16 }}>{seat.error || "Pulling your seat back to the table…"}</p>
 {seat.error && <button className="ghost" onClick={leave}>Use a different seat</button>}
 </Stage>
 );
 }
 const viewing = seat.state.kind === "player" ? seat.state : null;
 const shared = !viewing || viewing.phase === "dawnAccord" || !viewing.dealt;
 const faction = shared ? "" : factionClass(viewing.you?.alignment, viewing.you?.alive === false);
 return (
 <Stage faction={faction} phase={seat.state.phase} gm={seat.state.kind === "gm"}>
 {seat.state.kind === "gm" ? (
 <GmScreen state={seat.state} act={seat.act} error={seat.error} connected={seat.connected} onLeave={leave} />
 ) : (
 <PlayerScreen state={seat.state} act={seat.act} error={seat.error} connected={seat.connected} onLeave={leave} />
 )}
 </Stage>
 );
}

function Gate({ presetCode, onToken }) {
 const [gmName, setGmName] = useState("");
 const [code, setCode] = useState(presetCode);
 const [name, setName] = useState("");
 const [error, setError] = useState("");
 const [busy, setBusy] = useState(false);

 async function createGame(event) {
 event.preventDefault();
 setBusy(true);
 setError("");
 try {
 const data = await api("/api/games", { body: { gmName: gmName || "Caden" } });
 onToken(data.gmToken);
 } catch (err) {
 setError(err.message);
 } finally {
 setBusy(false);
 }
 }

 async function join(event) {
 event.preventDefault();
 setBusy(true);
 setError("");
 try {
 const data = await api(`/api/games/${code.trim().toUpperCase()}/join`, { body: { name } });
 onToken(data.token);
 } catch (err) {
 setError(err.message);
 } finally {
 setBusy(false);
 }
 }

 return (
 <Stage phase="ashFall">
 <img src="/logo/logo-640.webp" alt="Ashes of Lumination" className="logo-mark" />
 <p className="sc muted" style={{ textAlign: "center" }}>The light is going out. Take your seat.</p>
 <div className="mt-6 grid gap-4">
 <form className="panel grid gap-3 p-4" onSubmit={createGame}>
 <h2 className="serif text-2xl">Host the table</h2>
 <label className="grid gap-1 text-sm">
 Your name
 <input data-testid="gm-name" className="tap rounded-xl border px-3" value={gmName} onChange={(e) => setGmName(e.target.value)} placeholder="Caden" />
 </label>
 <button data-testid="create-game" className="btn" disabled={busy}>Create a game</button>
 </form>
 <form className="panel grid gap-3 p-4" onSubmit={join}>
 <h2 className="serif text-2xl">Sit down</h2>
 <label className="grid gap-1 text-sm">
 Room code
 <input data-testid="join-code" className="tap rounded-xl border px-3 uppercase" value={code} onChange={(e) => setCode(e.target.value)} required />
 </label>
 <label className="grid gap-1 text-sm">
 Name at the table
 <input data-testid="join-name" className="tap rounded-xl border px-3" value={name} onChange={(e) => setName(e.target.value)} required />
 </label>
 <button data-testid="join-submit" className="btn" disabled={busy}>Join</button>
 </form>
 {error && <p className="danger" data-testid="error-banner">{error}</p>}
 </div>
 </Stage>
 );
}

function Banner({ error, connected }) {
 return (
 <div className="mb-3 flex items-center justify-between text-xs uppercase tracking-wider">
 <span>{connected ? "Live" : "Reconnecting"}</span>
      {error && <span className="danger" data-testid="error-banner">{error}</span>}
 </div>
 );
}

function GmScreen({ state, act, error, connected, onLeave }) {
 const [tab, setTab] = useState("table");
 const link = `${location.origin}/?room=${state.code || ""}`;
 return (
 <div>
 <Banner error={error} connected={connected} />
 <header className="mb-4 flex items-end justify-between gap-3">
 <div>
 <p className="text-xs uppercase tracking-[0.22em]">GM</p>
 <h1 className="serif text-4xl">Round {state.round || "—"} · {labelPhase(state)}</h1>
 </div>
 <div className="flex gap-3">
 <RulebookButton state={state} />
 <button className="bare" onClick={onLeave}>Leave</button>
 </div>
 </header>
 {!state.dealt ? (
 <Lobby state={state} act={act} link={link} />
 ) : state.phase === "ended" && state.recap ? (
 <Recap recap={state.recap} gm />
 ) : (
 <>
 <PhaseClock state={state} act={act} />
 <PhaseBar state={state} act={act} />
 {state.phase === "ashFall" && <AshfallPanel state={state} act={act} />}
 {state.phase === "setup" && <SoulboundCard state={state} act={act} />}
 {state.reminders?.length > 0 && (
 <section className="panel mb-4 p-4 text-sm">
 <h2 className="serif text-xl">Don't forget</h2>
 <ul className="mt-2 grid gap-2">
 {state.reminders.map((line) => <li key={line}>{line}</li>)}
 </ul>
 </section>
 )}
 <PublicNotices state={state} />
 <div className="gm-layout">
 <div>
 <TabBar tab={tab} onChange={setTab} tabs={[{ id: "table", label: "Table" }, { id: "chat", label: "Chat" }, { id: "log", label: "Log" }, { id: "voting", label: "Vote" }]} />
 {tab === "table" && <GmTable state={state} act={act} />}
 {tab === "chat" && <GmChat state={state} act={act} />}
 {tab === "log" && <GmLog state={state} />}
 {tab === "voting" && <Voting state={state} act={act} />}
 </div>
 <aside className="gm-side">
 <section className="panel">
 <div className="label">At the table</div>
 <p className="stat"><small>Living</small><b>{state.players.filter((p) => p.alive).length} / {state.players.length}</b></p>
 {(state.tallies || []).map((row) => (
 <div key={row.id} className="tally">
 <div className="top"><span>{row.name}</span><b>{row.votes}</b></div>
 <div className="coal"><i style={{ width: Math.min(100, row.votes * 20) + "%" }} /></div>
 </div>
 ))}
 {(state.intentLog || []).slice(0, 8).map((line, index) => <p key={index} className="muted">{line}</p>)}
 </section>
 </aside>
 </div>
 </>
 )}
 </div>
 );
}

function Lobby({ state, act, link }) {
 return (
 <div className="grid gap-4">
 <section className="panel p-4">
 <p className="text-xs uppercase tracking-[0.2em]">Room</p>
 <p className="serif text-5xl tracking-[0.18em]" data-testid="room-code">{state.code}</p>
 <p className="mt-2 break-all text-sm">{link}</p>
 </section>
 <section className="panel p-4">
 <h2 className="serif text-2xl">Seats</h2>
 {state.seats.length === 0 && <p className="mt-2">No one has sat down yet. Share the code.</p>}
 <ul className="mt-2 grid gap-2" data-testid="seat-list">
 {state.seats.map((seat, index) => (
 <li key={seat.id} className="flex items-center justify-between gap-2">
 <span>{index + 1}. {seat.name}</span>
 <span className="flex gap-2">
 <button className="tap rounded-lg border px-3" onClick={() => act({ type: "reorder", name: seat.name, playerId: seat.id, dir: "up" })}>Up</button>
 <button className="tap rounded-lg border px-3" onClick={() => act({ type: "reorder", name: seat.name, playerId: seat.id, dir: "down" })}>Down</button>
 </span>
 </li>
 ))}
 </ul>
 </section>
 <Setup state={state} act={act} />
 </div>
 );
}

function Setup({ state, act }) {
 const count = state.seats.length;
 return (
 <section className="panel grid gap-3 p-4">
 <h2 className="serif text-2xl">Setup</h2>
 <p className="text-sm">Deal uses the prototype's chart. The Ashen Tyrant is always in the game. Ash Touched is placed by the deal. Soulbound is required from 10 players.</p>
 <button data-testid="setup-autofill" className="tap rounded-sm border" onClick={() => act({ type: "autofill" })}>Use the chart</button>
 <label className="grid gap-1 text-sm">
 Ash Touched: chance of a false result (%)
 <input className="tap rounded-sm border px-3" type="number" min={0} max={100} value={state.settings.atFalsePct ?? 50} onChange={(e) => act({ type: "settings", atFalsePct: Number(e.target.value) })} />
 </label>
 <label className="grid gap-1 text-sm">
 Unaligned at 7–9 players
 <select className="tap rounded-sm border px-3" value={String(state.settings.unalignedPick ?? -1)} onChange={(e) => act({ type: "settings", unalignedPick: Number(e.target.value) })}>
 <option value="-1">Random (0 or 1)</option>
 <option value="0">0 Unaligned</option>
 <option value="1">1 Unaligned</option>
 </select>
 </label>
 {count >= 13 && count <= 15 && (
 <label className="grid gap-1 text-sm">
 Ashen at 13–15 players
 <select data-testid="ashen-pick" className="tap rounded-sm border px-3" value={String(state.settings.ashenPick ?? -1)} onChange={(e) => act({ type: "settings", ashenPick: Number(e.target.value) })}>
 <option value="-1">Chart default (3 at 13, 4 at 14–15)</option>
 <option value="3">3 Ashen</option>
 <option value="4">4 Ashen</option>
 </select>
 </label>
 )}
 {count >= 16 && (
 <label className="grid gap-1 text-sm">
 Unaligned at 16–20 players
 <select data-testid="unaligned-wide" className="tap rounded-sm border px-3" value={String(state.settings.unalignedWide ?? -1)} onChange={(e) => act({ type: "settings", unalignedWide: Number(e.target.value) })}>
 <option value="-1">Chart default (1 at 16–17, 2 at 18–20)</option>
 <option value="1">1 Unaligned</option>
 <option value="2">2 Unaligned</option>
 </select>
 </label>
 )}
 <label className="flex items-start gap-3 text-sm">
 <input data-testid="toggle-automate" type="checkbox" className="mt-1 h-5 w-5" checked={!!state.settings?.automate} onChange={(e) => act({ type: "settings", automate: e.target.checked })} />
 <span>Automation. Off, you confirm the Dawn Accord execution yourself. On, resolving applies the vote leader.</span>
 </label>
 {count >= 7 ? (
 <Toggle label="Test rule: 75% succession cutoff (off by default; for playtesting, not a core rule)." checked={state.settings.testCutoff75} testid="toggle-cutoff" onChange={(testCutoff75) => act({ type: "settings", testCutoff75 })} />
 ) : (
 <p className="text-sm">Test rule: 75% succession cutoff — not used at 5–6 players.</p>
 )}
 <details className="border-t pt-3" data-testid="advanced-setup">
 <summary className="cursor-pointer text-sm">Advanced</summary>
 <p className="mt-2 text-sm"><strong>Design defaults (Nov 21 rulebook audit) — Default pending Caden.</strong> On matches the audited rulebook. Off restores the earlier behaviour.</p>
 <div className="my-2 flex gap-2">
 <button type="button" className="tap rounded-sm border px-3" onClick={() => act({ type: "settings", allDefaults: "on" })}>All on</button>
 <button type="button" className="tap rounded-sm border px-3" onClick={() => act({ type: "settings", allDefaults: "off" })}>All off</button>
 </div>
 {(state.defaults || []).map((d) => (
 <Toggle
 key={d.id}
 testid={`toggle-${d.id}`}
 checked={state.settings.designDefaults?.[d.id] !== false}
 onChange={(value) => act({ type: "settings", designDefaults: { [d.id]: value } })}
 label={`${d.id} ${d.title} — Default pending Caden. On: ${d.on} Off: ${d.off}`}
 />
 ))}
 </details>
 <button data-testid="deal" className="btn" onClick={() => act({ type: "deal" })}>Deal roles</button>
 </section>
 );
}

function Toggle({ label, checked, onChange, testid }) {
 return (
 <label className="flex items-start gap-3 text-sm">
 <input data-testid={testid} type="checkbox" className="mt-1 h-5 w-5" checked={!!checked} onChange={(e) => onChange(e.target.checked)} />
 <span>{label}</span>
 </label>
 );
}

function formatMs(ms) {
 const total = Math.max(0, Math.ceil(ms / 1000));
 const minutes = Math.floor(total / 60);
 const seconds = total % 60;
 return minutes + ":" + String(seconds).padStart(2, "0");
}

function useRemaining(timer) {
 const [now, setNow] = useState(Date.now());
 useEffect(() => {
 if (!timer || timer.status !== "running") return undefined;
 const id = setInterval(() => setNow(Date.now()), 250);
 return () => clearInterval(id);
 }, [timer]);
 if (!timer) return 0;
 if (timer.status === "expired") return 0;
 if (timer.status === "paused") return timer.remainingMs;
 return Math.max(0, timer.remainingMs - (now - timer.serverNow));
}

function useTimeUp(timer, remaining) {
 const sawRunning = useRef(false);
 const played = useRef(false);
 useEffect(() => {
 if (timer?.status === "running" && remaining > 0) {
 sawRunning.current = true;
 played.current = false;
 }
 if (!sawRunning.current || played.current || remaining > 0) return;
 played.current = true;
 try { navigator.vibrate?.([160, 60, 160]); } catch { /* this phone has no vibrate */ }
 try {
 const ctx = new AudioContext();
 const osc = ctx.createOscillator();
 const gain = ctx.createGain();
 osc.frequency.value = 440;
 gain.gain.value = 0.04;
 osc.connect(gain);
 gain.connect(ctx.destination);
 osc.start();
 osc.stop(ctx.currentTime + 0.18);
 osc.onended = () => ctx.close();
 } catch { /* sound needs a gesture on some phones */ }
 }, [timer, remaining]);
}

function PhaseClock({ state, act }) {
 const timer = state.timer;
 const remaining = useRemaining(timer);
 const showUp = Boolean(timer) && (timer.status === "expired" || remaining === 0);
 useTimeUp(timer, remaining);
 const gm = state.kind === "gm";
 if (!timer && !gm) return null;
 return (
 <Fuse
 label={labelPhase(state)}
 sub={timer ? (showUp ? "The phase stays until you move it" : "Burning") : "Off until you start it"}
 remainingMs={remaining}
 durationMs={timer?.durationMs || 0}
 expired={showUp}
 controls={gm && act ? <TimerControls act={act} timer={timer} /> : null}
 />
 );
}

function TimerControls({ act, timer }) {
 const [minutes, setMinutes] = useState("4");
 const running = timer?.status === "running";
 const paused = timer?.status === "paused";
 return (
 <div className="mt-3 grid gap-2">
 <div className="flex flex-wrap gap-2">
 {[1, 2, 3, 5].map((value) => (
 <button key={value} type="button" data-testid={`timer-${value}`} className="tap rounded-xl border px-3" onClick={() => act({ type: "timer-start", minutes: value })}>{value} min</button>
 ))}
 </div>
 <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); act({ type: "timer-start", minutes: Number(minutes) }); }}>
 <input data-testid="timer-custom" className="tap w-24 rounded-xl border px-3" inputMode="numeric" min="1" max="180" value={minutes} onChange={(event) => setMinutes(event.target.value)} />
 <button data-testid="timer-start-custom" className="btn">Start</button>
 </form>
 <div className="flex flex-wrap gap-2">
 <button type="button" data-testid="timer-pause" className="tap rounded-xl border px-3" disabled={!running} onClick={() => act({ type: "timer-pause" })}>Pause</button>
 <button type="button" data-testid="timer-resume" className="tap rounded-xl border px-3" disabled={!paused} onClick={() => act({ type: "timer-resume" })}>Resume</button>
 <button type="button" data-testid="timer-plus-30" className="tap rounded-xl border px-3" disabled={!running && !paused} onClick={() => act({ type: "timer-add", seconds: 30 })}>+30s</button>
 <button type="button" data-testid="timer-plus-60" className="tap rounded-xl border px-3" disabled={!running && !paused} onClick={() => act({ type: "timer-add", seconds: 60 })}>+1 min</button>
 <button type="button" data-testid="timer-stop" className="tap rounded-xl border px-3" disabled={!timer} onClick={() => act({ type: "timer-stop" })}>Stop</button>
 </div>
 </div>
 );
}

function recapText(recap) {
 const lines = ["Result: " + recap.result + ".", "", "Players"];
 for (const player of recap.players) lines.push(player.name + " — " + player.roleName + " — " + player.alignment + (player.alive ? "" : " — dead") + ".");
 lines.push("", "Deaths");
 if (!recap.deaths.length) lines.push("Nobody died.");
 for (const death of recap.deaths) lines.push(death.name + " died on " + death.when + " by " + death.how + ".");
 lines.push("", "What happened");
 for (const segment of recap.segments) {
 lines.push("", segment.title);
 for (const line of segment.lines) lines.push(line);
 }
 return lines.join("\n");
}

function Recap({ recap, gm = false }) {
 const text = recapText(recap);
 function download() {
 const blob = new Blob([text], { type: "text/plain" });
 const url = URL.createObjectURL(blob);
 const link = document.createElement("a");
 link.href = url;
 link.download = "ashes-recap.txt";
 link.click();
 URL.revokeObjectURL(url);
 }
 return (
 <section className="panel grid gap-4 p-4" data-testid="recap">
 <div>
 <p className="text-xs uppercase tracking-[0.18em]">Recap</p>
 <h2 className="serif text-4xl">{recap.result}</h2>
 </div>
 {gm && (
 <div className="flex gap-2">
 <button type="button" data-testid="recap-copy" className="tap rounded-xl border px-3" onClick={() => navigator.clipboard?.writeText(text)}>Copy</button>
 <button type="button" data-testid="recap-download" className="tap rounded-xl border px-3" onClick={download}>Download</button>
 </div>
 )}
 <div>
 <h3 className="serif text-2xl">Players</h3>
 <ul className="mt-2 grid gap-1 text-sm">
 {recap.players.map((player) => <li key={player.id}>{player.name} — {player.roleName} — {player.alignment}{player.alive ? "" : " — dead"}</li>)}
 </ul>
 </div>
 <div>
 <h3 className="serif text-2xl">Deaths</h3>
 {recap.deaths.length === 0 && <p className="mt-2 text-sm">Nobody died.</p>}
 <ul className="mt-2 grid gap-1 text-sm">
 {recap.deaths.map((death) => <li key={death.name + death.when}>{death.name} died on {death.when} by {death.how}.</li>)}
 </ul>
 </div>
 <div>
 <h3 className="serif text-2xl">What happened</h3>
 {recap.segments.length === 0 && <p className="mt-2 text-sm">No phases were recorded.</p>}
 {recap.segments.map((segment) => (
 <section key={segment.title} className="mt-3">
 <h4 className="">{segment.title}</h4>
 {segment.lines.map((line, index) => <p key={index} className="mt-1 text-sm">{line}</p>)}
 </section>
 ))}
 </div>
 </section>
 );
}

function PhaseBar({ state, act }) {
 const manualDawn = state.phase === "dawnAccord" && !state.settings?.automate;
 const label = state.phase === "setup" ? "Begin Ash Fall" : state.phase === "ashFall" ? (state.nightOfPeace ? "Resolve the night of peace" : "Resolve night") : state.phase === "lumination" ? "Resolve Lumination" : state.phase === "dawnAccord" ? "Resolve the Dawn Accord" : "Game over";
 const needSoul = state.phase === "setup" && state.soulboundRequired && !state.soulboundPlaced;
 return (
 <div className="panel mb-4 flex flex-wrap items-center justify-between gap-3 p-4">
 <div>
 <p className="text-xs uppercase tracking-[0.18em]">{state.nightOfPeace ? "Night of peace" : labelPhase(state)}</p>
 <p className="text-sm">{state.winReason || (needSoul ? "Place a Soulbound pair, then begin Ash Fall." : manualDawn ? "Choose the execution on the Voting tab. Nothing is applied until you resolve." : "Every action is waiting on you.")}</p>
 {state.tallies?.length > 0 && (
 <ul className="mt-2 text-sm" data-testid="tallies">
 {state.tallies.map((row) => <li key={row.id}>{row.name}: {row.votes}</li>)}
 </ul>
 )}
 </div>
 {state.phase === "ashFall" && state.nightProgress && (
 <p className="text-sm" data-testid="night-progress">{state.nightProgress.received} of {state.nightProgress.expected} actions in</p>
 )}
 {state.suggestedWinner && state.phase !== "ended" && (
 <p className="text-sm" data-testid="win-suggestion">{labelSide(state.suggestedWinner)} win condition met. The game stays open until you end it.</p>
 )}
 {state.phase !== "ended" && <EndGame state={state} act={act} />}
 {state.phase !== "ended" && state.winner == null && !state.block && !needSoul && !manualDawn && (
 <button data-testid="advance" className="btn" onClick={() => act({ type: "resolve" })}>
 {state.phase === "ashFall" && state.nightProgress ? `Resolve night (${state.nightProgress.received} of ${state.nightProgress.expected} in)` : label}
 </button>
 )}
 {state.block?.type === "coin" && (
 <div className="flex gap-2">
 <span className="self-center text-sm">{state.block.name}: flip the Paradox coin</span>
 <button className="tap rounded-xl border px-3" onClick={() => act({ type: "coin", result: "heads" })}>Heads</button>
 <button className="tap rounded-xl border px-3" onClick={() => act({ type: "coin", result: "tails" })}>Tails</button>
 </div>
 )}
 </div>
 );
}

function GmTable({ state, act }) {
 return (
 <div className="tiles" data-testid="gm-table">
 {state.players.map((player) => (
 <article key={player.id} className={`tile ${factionClass(player.alignment, !player.alive)} ${player.alive ? "" : "dead"}`} data-testid="player-row">
 <div className="th">
 <Portrait roleId={player.roleId} name={player.roleName} size={62} dead={!player.alive} />
 </div>
 <div>
 <h3 className="nm">{player.name} <Symbol team={player.alignment} size={18} /> {!player.alive && <span className="chip dead">dead</span>}</h3>
 <p className="rl">{player.roleName || "Undealt"} · {player.alignment}</p>
 <div className="gbtn">
 {chips(player).map((chip) => <span key={chip.text} className={`chip ${chip.kind}`}>{chip.text}</span>)}
 <button type="button" data-testid="set-ash" disabled={player.alignment === "Ashen"} title={player.alignment === "Ashen" ? "Ashen are immune" : "Set Ash Touched"} onClick={() => act({ type: "ash-touched", playerId: player.id })}>Set Ash Touched</button>
 <button type="button" data-testid="undo-ash" onClick={() => act({ type: "undo-ash", playerId: player.id })}>Undo Ash Touched</button>
 <button type="button" className="k" data-testid="gm-kill" onClick={() => act({ type: "gm-kill", playerId: player.id })}>Kill player</button>
 <button type="button" className="u" data-testid="undo-kill" onClick={() => act({ type: "undo-kill", playerId: player.id })}>Undo kill</button>
 <button type="button" data-testid="gm-mire" disabled={player.alignment === "Ashen"} title={player.alignment === "Ashen" ? "Ashen are immune" : "Set Mire Touched"} onClick={() => act({ type: "gm-mire", playerId: player.id })}>Set Mire Touched</button>
 <button type="button" data-testid="undo-mire" onClick={() => act({ type: "undo-mire", playerId: player.id })}>Undo Mire Touched</button>
 </div>
 <label className="mt-3 grid gap-1 text-xs">
 GM note
 <textarea className="min-h-16" defaultValue={player.gmNotes} onBlur={(e) => act({ type: "gm-note", playerId: player.id, text: e.target.value })} />
 </label>
 </div>
 </article>
 ))}
 {state.phase === "ended" && <Reveal reveal={state.reveal} />}
 </div>
 );
}

function chips(player) {
 return [
 player.ashTouched && { kind: "ash", text: "Ash Touched" },
 player.poisoned && { kind: "mire", text: `Mire Touched ${player.poisonCount}` },
 player.gmMire && { kind: "mire", text: "Mire note" },
 player.poisonCount > 0 && !player.poisoned && { kind: "", text: `Poison count ${player.poisonCount}` },
 player.shield && { kind: "shield", text: "Shielded" },
 player.voided && { kind: "", text: "Voided" },
 player.cancelled && { kind: "", text: "Cancelled" },
 player.syndicate && { kind: "", text: "Syndicate" },
 player.soulboundWith && { kind: "soul", text: `Soulbound ${player.soulboundWith}` },
 player.converted && { kind: "", text: "Converted" },
 player.holdsKill && { kind: "", text: "Holds the kill" },
 player.echoCopy && { kind: "", text: `Copying ${player.echoCopy}` },
 player.recruitShield && { kind: "shield", text: "Recruit shield ready" },
 ].filter(Boolean);
}

function GmChat({ state, act }) {
 const [playerId, setPlayerId] = useState(state.players[0]?.id || "");
 const [text, setText] = useState("");
 const thread = state.chats.filter((c) => c.channel === "gm" && c.playerId === playerId);
 const current = state.players.find((p) => p.id === playerId);
 return (
 <section className="panel p-4">
 <h2 className="serif text-2xl">Private threads</h2>
 <ul className="mt-2 grid gap-2" data-testid="gm-chat-list">
 {state.players.map((p) => (
 <li key={p.id}>
            <button type="button" data-testid={`chat-with-${p.name}`} className={p.id === playerId ? "on" : ""} onClick={() => setPlayerId(p.id)}>{p.name}</button>
 </li>
 ))}
 </ul>
 <p className="mt-3 text-sm">Thread with {current?.name || "a player"}. Only the two of you see it.</p>
 <div className="mt-3 grid max-h-80 gap-2 overflow-auto" data-testid="chat-log">
 {thread.length === 0 && <p className="">No messages with this player yet.</p>}
 {thread.map((msg) => <p key={msg.id}><span className="">{msg.name}: </span>{msg.text}</p>)}
 </div>
 <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); act({ type: "chat", channel: "gm", from: "gm", playerId, text }).then(() => setText("")); }}>
 <input data-testid="chat-input" className="tap min-w-0 flex-1 rounded-xl border px-3" value={text} onChange={(e) => setText(e.target.value)} placeholder="Private reply" />
 <button data-testid="chat-send" className="tap rounded-xl px-4">Send</button>
 </form>
 </section>
 );
}

function LogList({ lines }) {
 return (
 <ol className="panel grid gap-2 p-4 text-sm" data-testid="game-log">
 {lines.length === 0 && <li>The log is empty.</li>}
 {lines.map((line) => <li key={line.id} className={line.secret ? "" : ""}>{line.secret ? "Private · " : ""}{line.text}</li>)}
 </ol>
 );
}

function labelSide(side) {
 if (side === "lumen") return "Lumen";
 if (side === "ashen") return "Ashen";
 if (side === "syndic") return "Syndic";
 if (side === "shadow") return "Shadow Blade";
 return side;
}

function EndGame({ state, act }) {
 const [open, setOpen] = useState(false);
 const [side, setSide] = useState(state.suggestedWinner || "lumen");
 const [confirm, setConfirm] = useState(false);
 if (!open) return <button type="button" data-testid="end-game" className="tap rounded-xl border px-3" onClick={() => setOpen(true)}>End game</button>;
 return (
 <div className="grid gap-2">
 <label className="grid gap-1 text-sm">
 Result
 <select data-testid="end-side" className="tap rounded-xl border px-3" value={side} onChange={(e) => setSide(e.target.value)}>
 <option value="lumen">Lumen</option>
 <option value="ashen">Ashen</option>
 <option value="syndic">Syndic</option>
 <option value="shadow">Shadow Blade</option>
 </select>
 </label>
 <label className="flex items-center gap-2 text-sm">
 <input data-testid="end-confirm" type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />
 Confirm ending the game
 </label>
 <button type="button" data-testid="end-submit" className="btn danger" disabled={!confirm} onClick={() => act({ type: "end-game", winner: side, confirm: true })}>End the game</button>
 </div>
 );
}

function AshfallPanel({ state, act }) {
 const summary = state.ashfallSummary;
 return (
 <section className="panel mb-4 grid gap-3 p-4" data-testid="ashfall-summary">
 <h2 className="serif text-2xl">Ashfall summary</h2>
 <p className="text-sm">{summary?.headline || "Ashfall summary. Nothing here has been applied."}</p>
 {(summary?.lines || []).length === 0 && <p className="text-sm">No night actions submitted yet.</p>}
 {(summary?.lines || []).map((line) => <SummaryLine key={line.id} line={line} act={act} />)}
 <div className="grid gap-3" data-testid="night-actions">
 {(state.nightActions || []).map((action) => <NightRow key={action.id} action={action} players={state.players} act={act} />)}
 </div>
 </section>
 );
}

function SummaryLine({ line, act }) {
 const [open, setOpen] = useState(false);
 const [text, setText] = useState(line.playerNote || "");
 return (
 <div className="grid gap-2 border-t pt-3">
 <p>{line.text}</p>
 <p className="text-sm">{line.projection}</p>
 <button type="button" className="tap w-fit rounded-xl border px-3 text-sm" onClick={() => setOpen(true)}>Copy to {line.actorName}'s thread</button>
 {open && (
 <form className="grid gap-2" onSubmit={(e) => { e.preventDefault(); act({ type: "chat", channel: "gm", from: "gm", playerId: line.playerId, text }).then(() => setOpen(false)); }}>
 <textarea data-testid="copy-draft" className="min-h-20 rounded-xl border p-2 text-sm" value={text} onChange={(e) => setText(e.target.value)} />
 <button data-testid="copy-send" className="tap rounded-xl">Send</button>
 </form>
 )}
 </div>
 );
}

function NightRow({ action, players, act }) {
 const [targetId, setTargetId] = useState(action.targets?.[0] || "");
 return (
 <div className="grid gap-2 border-t pt-3">
 <p className="text-sm">{action.plain}</p>
 {action.voided && (
 <button type="button" data-testid="undo-void" className="tap w-fit rounded-xl border px-3" onClick={() => act({ type: "edit-night", actionId: action.id, undo: true })}>Undo void</button>
 )}
 {!action.skip && (
 <div className="flex flex-wrap gap-2">
 <select className="tap rounded-xl border px-3" value={targetId} onChange={(e) => setTargetId(e.target.value)}>
 {players.filter((p) => p.alive && p.id !== action.playerId).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
 </select>
 <button type="button" className="tap rounded-xl border px-3" onClick={() => act({ type: "edit-night", actionId: action.id, targetId })}>Override</button>
 <button type="button" data-testid="void-action" className="tap rounded-xl border px-3" onClick={() => act({ type: "edit-night", actionId: action.id, void: true })}>Void</button>
 </div>
 )}
 </div>
 );
}

function Voting({ state, act }) {
 const [choice, setChoice] = useState("NO_EXEC");
 return (
 <section className="panel grid gap-3 p-4" data-testid="voting-tab">
 <h2 className="serif text-2xl">Nominations</h2>
 {(state.nominations || []).length === 0 && <p className="text-sm">No nominations yet.</p>}
 {(state.nominations || []).map((row, index) => {
 const person = state.players.find((p) => p.name === row.targetName);
 return (
 <p key={index} className="flex items-center gap-2 text-sm">
 {person?.roleId && <span className={`th ${factionClass(person.alignment, !person.alive)}`} style={{ width: 40, height: 54 }}><Portrait roleId={person.roleId} name={person.roleName} dead={!person.alive} /></span>}
 {row.byName} nominated {row.targetName}.
 </p>
 );
 })}
 <h2 className="serif text-2xl">Votes</h2>
 {(state.votes || []).length === 0 && <p className="text-sm">No votes yet.</p>}
 {(state.votes || []).map((row) => <p key={row.name} className="text-sm">{row.name} voted {row.choice}.</p>)}
 {(state.tallies || []).length > 0 && (
 <ul className="text-sm">
 {state.tallies.map((row) => <li key={row.id}>{row.name}: {row.votes}</li>)}
 </ul>
 )}
 {state.phase === "dawnAccord" && !state.settings?.automate && (
 <div className="grid gap-2">
 <label className="grid gap-1 text-sm">
 Execution
 <select data-testid="execution-choice" className="tap rounded-xl border px-3" value={choice} onChange={(e) => setChoice(e.target.value)}>
 <option value="NO_EXEC">No execution</option>
 {(state.ballot || []).filter((row) => row.id !== "NO_EXEC").map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
 </select>
 </label>
 <button data-testid="advance" className="btn" onClick={() => act({ type: "resolve", execute: choice })}>Resolve the Dawn Accord</button>
 </div>
 )}
 </section>
 );
}

function GmLog({ state }) {
 return (
 <div className="grid gap-3" data-testid="game-log">
 <section className="panel p-4">
 <h2 className="serif text-2xl">This phase</h2>
 {(state.intentLog || []).length === 0 && <p className="mt-2 text-sm">Nothing in this phase yet.</p>}
 {(state.intentLog || []).map((line, index) => <p key={index} className="mt-2 text-sm">{line}</p>)}
 </section>
 <section className="panel p-4">
 <h2 className="serif text-2xl">Earlier</h2>
 {(state.logArchive || []).length === 0 && <p className="mt-2 text-sm">No earlier phase is archived yet.</p>}
 {(state.logArchive || []).map((segment) => (
 <details key={segment.id} className="mt-3">
 <summary>{segment.title}</summary>
 {segment.lines.map((line, index) => <p key={index} className="mt-2 text-sm">{line}</p>)}
 </details>
 ))}
 </section>
 </div>
 );
}

function PlayerScreen({ state, act, error, connected, onLeave }) {
 const [tab, setTab] = useState("role");
 const [rolesOpen, setRolesOpen] = useState(false);
 const you = state.you;
 return (
 <div>
 <Banner error={error} connected={connected} />
 <header className="mb-4 flex items-end justify-between">
 <div>
 <p className="text-xs uppercase tracking-[0.22em]">{you.name}</p>
 <h1 className="serif text-4xl">{labelPhase(state)}</h1>
 </div>
 <div className="flex gap-3">
 {state.phase !== "ended" && <button type="button" data-testid="open-catalogue" className="bare" onClick={() => setRolesOpen(true)}>All roles</button>}
 <RulebookButton state={state} />
 <button className="bare" onClick={onLeave}>Leave</button>
 </div>
 </header>
 {rolesOpen && state.phase !== "ended" && <Catalogue roles={state.catalogue} onClose={() => setRolesOpen(false)} />}
 {state.phase === "ended" && state.recap ? <Recap recap={state.recap} /> : (
 <>
 {state.dealt && <PhaseClock state={state} />}
 {state.nightOfPeace && state.phase === "ashFall" && <p className="acc" data-testid="night-of-peace">A night of peace. The inherited kill does not fall.</p>}
 <TabBar
 tab={tab}
 onChange={setTab}
 tabs={(state.mindList ? ["role", "mind", "act", "chat", "notes"] : ["role", "act", "chat", "notes"]).map((id) => ({ id, label: id === "act" ? "Act" : id === "mind" ? "Mind" : id[0].toUpperCase() + id.slice(1) }))}
 />
 {tab === "role" && <RoleHome state={state} />}
 {tab === "mind" && <MindHome list={state.mindList} />}
 {tab === "act" && <ActPanel state={state} act={act} />}
 {tab === "chat" && <PlayerChat state={state} act={act} />}
 {tab === "notes" && <Notes you={you} act={act} />}
 </>
 )}
 </div>
 );
}

function MindHome({ list }) {
 return (
 <section className="panel p-4" data-testid="mind-list">
 <h2 className="serif text-2xl">The table, as you read it</h2>
 <ul className="mt-3 grid gap-2 text-sm">
 {(list || []).map((row) => <li key={row.id}>{row.name} · {row.roleName}{row.alive ? "" : " · dead"}</li>)}
 </ul>
 </section>
 );
}

function RoleHome({ state }) {
 const you = state.you;
 return (
 <div className="grid gap-3">
 <PublicNotices state={state} />
 {state.ballot?.length > 0 && (
 <section className="panel p-4" data-testid="ballot">
 <h3 className="serif text-xl">Ballot</h3>
 <ul className="mt-2">
 {state.ballot.map((row) => <li key={row.id}>{row.name}</li>)}
 </ul>
 </section>
 )}
 <article>
 {you.roleId ? (
 <div>
 <RoleHero roleId={you.roleId} roleName={you.roleName} alignment={you.alignment} dead={!you.alive} symbolSrc={symbolSrc(you.alignment)} />
 {you.roleId === "the-ashen-child" && <p className="mt-2 px-2 py-1 text-xs uppercase tracking-widest">Do not let them execute you.</p>}
 {you.roleId === "the-shadow-blade" && <p className="mt-2 italic">Earn trust first, strike later.</p>}
 {you.roleId === "voice-of-the-accord" && <p className="label mt-2 text-xs">Your vote counts as 2.</p>}
 {you.roleId === "the-lumen-guard" && <p className="label mt-2 text-xs">Immune to everything except execution.</p>}
 {you.echo != null && <p className="mt-2 border border-dashed p-2 text-sm">{you.echo ? `You hold ${you.echo} for this round.` : "No ability copied yet."}</p>}
 {you.effective && <p className="mt-2 border p-2">For this Ash Fall and Lumination you are acting as {you.effective}.</p>}
 {you.charges != null && <p className="label mt-2 text-xs">Uses held: {you.charges}</p>}
 {!you.alive && <p className="mt-2">You are a Remnant of the Vanished.</p>}
 </div>
 ) : <h2 className="serif text-3xl">Waiting for the deal</h2>}
 {you.ability && <p className="mt-3">{you.ability}</p>}
 {you.teammates && (
 <p className="mt-3 flex items-center text-sm" data-testid="teammates"><Symbol team="Ashen" /> Ashen teammates: {you.teammates.length ? you.teammates.join(", ") : "you are the only one"}.</p>
 )}
 </article>
 <section className="panel" data-testid="seat-list">
 <div className="label">The table</div>
 <div className="roster">
 {state.seats.map((seat) => (
 <div key={seat.id} className={seat.alive ? "" : "dead"}>
 <Avatar name={seat.name} you={seat.name === you.name} dead={!seat.alive} />
 {seat.name}{seat.alive ? "" : " · dead"}
 </div>
 ))}
 </div>
 </section>
 <section className="panel p-4">
 <h3 className="serif text-xl">Your results</h3>
 {you.inbox.length === 0 && <p className="mt-2">Nothing private yet.</p>}
 <ul className="mt-2 grid gap-2 text-sm">
 {you.inbox.map((item, index) => <li key={index} className="whitespace-pre-wrap">{item.text}</li>)}
 </ul>
 </section>
 {state.statements?.length > 0 && (
 <section className="panel p-4">
 <h3 className="serif text-xl">Statements</h3>
 {state.statements.map((s) => <p key={s.playerId} className="mt-2 text-sm"><span className="">{s.name}. </span>{s.text}</p>)}
 </section>
 )}
 {state.nominations?.length > 0 && (
 <section className="panel p-4 text-sm">
 {state.nominations.map((n, i) => <p key={i}>{n.byName} nominated {n.targetName}.</p>)}
 </section>
 )}
 {state.phase === "ended" && <Reveal reveal={state.reveal} won={you.won} />}
 </div>
 );
}

function Catalogue({ roles, onClose }) {
 const groups = useMemo(() => ["Lumen", "Ashen", "Unaligned"].map((team) => ({
 team,
 roles: roles.filter((role) => role.team === team),
 })), [roles]);
 return (
 <div className="fixed inset-0 z-10 overflow-auto p-4" data-testid="catalogue">
 <div className="mx-auto max-w-3xl">
 <div className="flex items-center justify-between">
 <h2 className="serif text-3xl">Every role</h2>
 <button className="tap underline" onClick={onClose}>Close</button>
 </div>
 <p className="mt-2 text-sm">The full catalogue of all 26 roles, the same in every game. It does not say which roles were dealt.</p>
 {groups.map((group) => (
 <section key={group.team} className={`panel ${factionClass(group.team)}`}>
 <div className="sect" data-testid={`catalogue-${group.team}`}><Symbol team={group.team} size={44} /><h3>{group.team}</h3></div>
 {group.roles.map((role) => <RoleCard key={role.id} role={role} />)}
 </section>
 ))}
 </div>
 </div>
 );
}

function RoleCard({ role }) {
 const [open, setOpen] = useState(false);
 const thin = (role.ability || "").trim().length < 180;
 return (
 <article className="comp">
 <div className="th"><Portrait roleId={role.id} name={role.name} size={54} /></div>
 <div>
 <h4 className="serif text-xl uppercase">{role.name}</h4>
 <p className="text-sm">{role.short}</p>
 <p className="flex items-center text-xs uppercase tracking-wider"><Symbol team={role.team} size={16} /> {role.team}</p>
 <button type="button" data-testid={`more-info-${role.id}`} className="mt-2 text-sm underline" onClick={() => setOpen((value) => !value)}>More info</button>
 {open && <p className="mt-2 text-sm" data-testid={`role-detail-${role.id}`}>{role.ability}</p>}
 {open && thin && <p className="mt-2 text-xs" data-testid="thin-role">The rule text for this role is short.</p>}
 </div>
 </article>
 );
}

function ActPanel({ state, act }) {
 const [statement, setStatement] = useState("");
 return (
 <div className="grid gap-3" data-testid="act-panel">
 {!state.dealt && <p className="panel p-4">The GM is still seating the table.</p>}
 {state.phase === "lumination" && state.you.alive && (
 <form data-testid="form-statement" className="panel grid gap-2 p-4" onSubmit={(e) => { e.preventDefault(); act({ type: "submit", kind: "statement", text: statement }); }}>
 <label className="text-sm">Public statement</label>
 <textarea data-testid="statement" className="min-h-20 rounded-xl border p-2" value={statement} onChange={(e) => setStatement(e.target.value)} />
 <button data-testid="submit-statement" className="btn">Post statement</button>
 </form>
 )}
 {state.menu.length === 0 && state.phase !== "lobby" && <p className="panel p-4">Nothing for you to submit in this phase. Watch the table, or write to the GM.</p>}
 {state.menu.map((item) => <ActionCard key={item.id} item={item} act={act} />)}
 </div>
 );
}

function ActionCard({ item, act }) {
 const [targetId, setTargetId] = useState("");
 const [targetId2, setTargetId2] = useState("");
 const [roleId, setRoleId] = useState("");
 const [ids, setIds] = useState([]);
 if (item.kind === "note") return <p className="panel p-4 text-sm" data-testid="submitted-note">{item.text}</p>;
 if (item.kind === "invite") {
 return (
 <div className="panel flex gap-2 p-4">
 <p className="flex-1 text-sm">{item.from} invites you into the syndicate.</p>
 <button className="tap rounded-xl px-3" onClick={() => act({ type: "invite-response", accept: true })}>Accept</button>
 <button className="tap rounded-xl border px-3" onClick={() => act({ type: "invite-response", accept: false })}>Decline</button>
 </div>
 );
 }
 async function submit(event) {
 event?.preventDefault?.();
 try {
 await run();
 } catch { /* the seat hook surfaces the error */ }
 async function run() {
 const skip = targetId === "skip";
 if (item.kind === "vote") return act({ type: "vote", choice: targetId });
 if (item.id === "nomination") return act({ type: "submit", kind: "nomination", targetId });
 if (item.kind === "button") return act({ type: "submit", ability: item.ability || item.id });
 return act({
 type: "submit",
 ability: item.ability || item.id,
 targetId: skip ? null : targetId,
 targetId2: skip ? null : targetId2,
 roleId,
 ids,
 skip,
 });
 }
 }
 if (item.kind === "button") {
 return <button data-testid="submit-action" className="btn" onClick={submit}>{item.label}</button>;
 }
 return (
 <form data-testid={`form-${item.id}`} className="panel grid gap-2 p-4" onSubmit={submit}>
 <p className="text-sm">{item.label}</p>
 {item.targets && (
 <select data-testid="action-target" className="tap rounded-xl border px-3" value={targetId} onChange={(e) => { setTargetId(e.target.value); if (e.target.value === targetId2) setTargetId2(""); }} required>
 <option value="">Choose</option>
 {item.allowSkip && <option value="skip">Skip</option>}
 {item.targets.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
 </select>
 )}
 {item.kind === "targets2" && (
 <select data-testid="action-target-2" className="tap rounded-xl border px-3" value={targetId2} onChange={(e) => setTargetId2(e.target.value)} required>
 <option value="">Second player</option>
 {item.targets.filter((t) => t.id !== targetId).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
 </select>
 )}
 {item.kind === "question" && (
 <select className="tap rounded-xl border px-3" value={roleId} onChange={(e) => setRoleId(e.target.value)} required>
 <option value="">Role</option>
 {item.roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
 </select>
 )}
 {item.kind === "multi" && item.targets.map((t) => (
 <label key={t.id} className="flex gap-2 text-sm">
 <input type="checkbox" checked={ids.includes(t.id)} onChange={(e) => setIds(e.target.checked ? [...ids, t.id] : ids.filter((id) => id !== t.id))} />
 {t.name}
 </label>
 ))}
 <button data-testid="submit-action" className="btn">Submit</button>
 </form>
 );
}

function PlayerChat({ state, act }) {
 const [text, setText] = useState("");
 const thread = state.chats.filter((c) => c.channel === "gm");
 return (
 <section className="panel p-4">
 <p className="text-sm">Private notes to the GM. Talk with the table in person.</p>
 <div className="mt-3 grid max-h-80 gap-2 overflow-auto text-sm" data-testid="chat-log">
 {thread.length === 0 && <p className="">No messages yet.</p>}
 {thread.map((msg) => <p key={msg.id}><span className="">{msg.name}: </span>{msg.text}</p>)}
 </div>
 <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); act({ type: "chat", channel: "gm", text }).then(() => setText("")); }}>
 <input data-testid="chat-input" className="tap min-w-0 flex-1 rounded-xl border px-3" value={text} onChange={(e) => setText(e.target.value)} placeholder="Private note to the GM" />
 <button data-testid="chat-send" className="tap rounded-xl px-4">Send</button>
 </form>
 </section>
 );
}

function Notes({ you, act }) {
 const [text, setText] = useState(you.notes || "");
 return (
 <form className="panel grid gap-2 p-4" onSubmit={(e) => { e.preventDefault(); act({ type: "notes", text }); }}>
 <h2 className="serif text-2xl">Notes</h2>
 <p className="text-sm">Only you can read this. It stays with your seat if the phone refreshes.</p>
 <textarea data-testid="notes" className="min-h-40 rounded-xl border p-3" value={text} onChange={(e) => setText(e.target.value)} />
 <button className="btn">Save notes</button>
 </form>
 );
}

function Reveal({ reveal, won }) {
 if (!reveal) return null;
 return (
 <section className="panel p-4" data-testid="reveal">
 <h2 className="serif text-3xl">Roles in this game</h2>
 {won && <p className="mt-1">You are among the winners.</p>}
 <ul className="mt-3 grid gap-1">
 {reveal.map((row) => <li key={row.id}>{row.name} · {row.roleName} · {row.alignment}{row.alive ? "" : " · dead"}</li>)}
 </ul>
 </section>
 );
}

function PublicNotices({ state }) {
 if (!state.publicLog?.length) return null;
 return (
 <section className="panel p-4" data-testid="public-log">
 <h3 className="serif text-xl">At the table</h3>
 {state.publicLog.map((line) => <p key={line.id} className="mt-2 text-sm">{line.text}</p>)}
 </section>
 );
}

function SoulboundCard({ state, act }) {
 const [a, setA] = useState(state.players[0]?.id || "");
 const [b, setB] = useState(state.players[1]?.id || "");
 return (
 <section className="panel mb-4 grid gap-2 p-4" data-testid="soulbound-card">
 <h2 className="serif text-2xl">Soulbound</h2>
 <p className="text-sm">{state.soulboundRequired ? "Required before Round 1 at 10 or more players. The pair is not told." : "Optional below 10 players. The pair is not told."}</p>
 {state.soulboundPlaced && <p className="text-sm">A pair is placed.</p>}
 <select data-testid="soulbound-a" className="tap rounded-xl border px-3" value={a} onChange={(e) => setA(e.target.value)}>
 {state.players.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
 </select>
 <select data-testid="soulbound-b" className="tap rounded-xl border px-3" value={b} onChange={(e) => setB(e.target.value)}>
 {state.players.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
 </select>
 <div className="flex gap-2">
 <button type="button" data-testid="soulbound-place" className="tap rounded-xl border px-3" onClick={() => act({ type: "soulbound", a, b })}>Place this pair</button>
 <button type="button" data-testid="soulbound-suggest" className="tap rounded-xl border px-3" onClick={() => act({ type: "suggest-soulbound" })}>Suggest a pair</button>
 </div>
 </section>
 );
}

function RulebookButton({ state }) {
 const [open, setOpen] = useState(false);
 return (
 <>
 <button type="button" data-testid="open-rulebook" className="bare" onClick={() => setOpen(true)}>Rulebook</button>
 {open && <Rulebook state={state} onClose={() => setOpen(false)} />}
 </>
 );
}

function Rulebook({ state, onClose }) {
 const book = state.rulebook || {};
 const goals = [];
 for (const goal of book.goals || []) {
 const last = goals[goals.length - 1];
 if (last && last.side === goal.side) last.texts.push(goal.text);
 else goals.push({ side: goal.side, texts: [goal.text] });
 }
 return (
 <div className="fixed inset-0 z-20 overflow-auto p-4" data-testid="rulebook">
 <div className="mx-auto grid max-w-3xl gap-4">
 <div className="flex items-center justify-between gap-3">
 <h2 className="serif text-3xl">Player rulebook</h2>
 <button className="tap underline" onClick={onClose}>Close</button>
 </div>
 <p className="text-lg" data-testid="rulebook-headline">{book.headline}</p>
 <p className="text-sm">{book.note}</p>
 <section className="panel p-4">
 <h3 className="serif text-2xl">{book.playerCount >= book.minPlayers ? `${book.playerCount} players at this table` : `${book.playerCount || 0} seated. The deal starts at ${book.minPlayers}.`}</h3>
 {book.band ? (
 <ul className="mt-3 grid gap-1 text-sm" data-testid="rulebook-band">
 <li>Ashen: {book.band.ashen}</li>
 <li>Unaligned: {book.band.unaligned}</li>
 <li>Lumen: {book.band.lumen}</li>
 </ul>
 ) : <p className="mt-2 text-sm">The chart below covers {book.minPlayers} to {book.maxPlayers} players.</p>}
 {book.dealt && (
 <p className="mt-3 text-sm" data-testid="rulebook-dealt">This deal: {book.dealt.ashen} Ashen, {book.dealt.unaligned} Unaligned, {book.dealt.lumen} Lumen.</p>
 )}
 </section>
 <section className="panel p-4">
 <h3 className="serif text-2xl">Goals</h3>
 {goals.map((goal) => (
 <div key={goal.side} className="mt-3">
 <h4 className="">{goal.side}</h4>
 {goal.texts.map((text) => <p key={text} className="mt-1 text-sm">{text}</p>)}
 </div>
 ))}
 </section>
 <section className="panel p-4">
 <h3 className="serif text-2xl">Chart</h3>
 <table className="mt-2 w-full text-left text-sm" data-testid="rulebook-chart">
 <thead>
 <tr className=""><th>Players</th><th>Ashen</th><th>Unaligned</th><th>Lumen</th></tr>
 </thead>
 <tbody>
 {(book.chart || []).map((row) => (
 <tr key={row.players} className={row.current ? "" : ""}>
 <td>{row.players}</td>
 <td>{row.ashen}</td>
 <td>{row.unaligned}</td>
 <td>{row.lumen}</td>
 </tr>
 ))}
 </tbody>
 </table>
 </section>
 </div>
 </div>
 );
}

function labelPhase(state) {
 if (!state.dealt) return "Lobby";
 if (state.phase === "setup") return "Roles dealt";
 if (state.phase === "ashFall") return `Ash Fall ${state.round}`;
 if (state.phase === "lumination") return `Lumination ${state.round}`;
 if (state.phase === "dawnAccord") return `Dawn Accord ${state.round}`;
 if (state.phase === "ended") return "Ended";
 return state.phaseLabel || state.phase;
}

function rememberRoom(code) {
 if (code) sessionStorage.setItem("aol-room", code);
}

const originalFetch = window.fetch;
window.fetch = async (input, init) => {
 const res = await originalFetch(input, init);
 try {
 const clone = res.clone();
 const data = await clone.json();
 if (data?.code && data?.gmToken) rememberRoom(data.code);
 if (data?.code && data?.token && !data?.gmToken) sessionStorage.setItem("aol-room", data.code);
 } catch { /* not json */ }
 return res;
};
