/** Visual components. They read the Emberfall tokens and do not decide game rules. */

export function factionClass(alignment, dead = false) {
  if (dead) return "f-remnant";
  const team = String(alignment || "").toLowerCase();
  if (team === "ashen") return "f-ashen";
  if (team === "unaligned") return "f-unaligned";
  if (team === "lumen") return "f-lumen";
  return "";
}

export function phaseBackground(phase) {
  if (phase === "lumination" || phase === "setup") return "var(--bg-lumination)";
  if (phase === "dawnAccord" || phase === "ended") return "var(--bg-dawn)";
  return "var(--bg-ash-fall)";
}

export function Stage({ children, faction = "", phase = "ashFall", gm = false }) {
  return (
    <main className={`stage ${faction} ${gm ? "gm-root" : ""}`} style={{ "--bgimg": phaseBackground(gm ? "dawnAccord" : phase) }}>
      <div className="smoke" aria-hidden="true" />
      <div className="embers" aria-hidden="true" />
      <div className="z">{children}</div>
    </main>
  );
}

export function formatClock(ms) {
  const total = Math.max(0, Math.ceil((ms || 0) / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return minutes + ":" + String(seconds).padStart(2, "0");
}

export function Fuse({ label, sub, remainingMs = 0, durationMs = 0, expired = false, controls = null }) {
  const pct = !durationMs || expired ? 0 : Math.max(0, Math.min(100, (remainingMs / durationMs) * 100));
  return (
    <div className="fuse" data-testid="phase-timer">
      <div className="row">
        <span className="ph">{label}</span>
        <span className="t" data-testid={expired ? "time-up" : "countdown"}>{expired ? "Time's up" : formatClock(remainingMs)}</span>
      </div>
      {sub ? <div className="sub">{sub}</div> : null}
      <div className={`track ${expired ? "out" : ""}`}><i style={{ "--p": pct + "%" }} /></div>
      {controls}
    </div>
  );
}

export function TabBar({ tabs, tab, onChange }) {
  return (
    <nav className="tabbar">
      {tabs.map((item) => (
        <button key={item.id} type="button" className={tab === item.id ? "on" : ""} onClick={() => onChange(item.id)}>
          <i />
          {item.label}
        </button>
      ))}
    </nav>
  );
}

export function Avatar({ name, you = false, dead = false }) {
  const letter = (name || "?").trim().charAt(0).toUpperCase() || "?";
  return <span className={`av ${you ? "you" : ""} ${dead ? "dead" : ""}`}>{letter}</span>;
}

export function RoleHero({ roleId, roleName, alignment, dead, symbolSrc }) {
  const src = dead ? `/portraits-remnant/${roleId}-remnant.webp?v=3` : `/portraits/${roleId}.webp?v=3`;
  return (
    <div data-testid="role-frame">
      <div className="hero">
        <img className="pt" src={src} alt="" data-testid={dead ? "remnant-portrait" : "portrait"} data-role={roleId} />
        <div className="glow" />
      </div>
      <div className="ident">
        <img className="sym" src={symbolSrc} alt="" data-testid="frame-symbol" />
        <h2 data-testid="role-name">{roleName}</h2>
        <span className="fac" data-testid="role-chip">{alignment}</span>
      </div>
    </div>
  );
}
