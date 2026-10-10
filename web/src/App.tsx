import { useCallback, useEffect, useState } from "react";

interface Machine {
  id: string; name: string; state: "running" | "idle" | "down" | "unknown";
  durationSec: number; reasonCode: string | null; cycles: number;
  temperature: number | null; availability: number | null; openAlertId: number | null;
}
interface Downtime { id: number; machineId: string; start: number; end: number | null; durationSec: number; reasonCode: string; reasonLabel: string }
interface Alert { id: number; machineId: string; raisedAt: number; stillDown: boolean; reasonCode: string; ackedBy: string | null; ackedAt: number | null; status: string }
interface Session { token: string; username: string; role: string }

const fmtDur = (s: number) => (s >= 3600 ? `${Math.floor(s / 3600)}h ` : "") + (s >= 60 ? `${Math.floor((s % 3600) / 60)}m ` : "") + `${s % 60}s`;
const fmtTime = (ms: number) => new Date(ms).toLocaleTimeString();
const pct = (a: number | null) => (a == null ? "–" : `${(a * 100).toFixed(1)}%`);
const getJson = <T,>(url: string): Promise<T> => fetch(url).then((r) => r.json());

export default function App() {
  const [tab, setTab] = useState<"board" | "downtime" | "alerts">("board");
  const [machines, setMachines] = useState<Machine[]>([]);
  const [downtimes, setDowntimes] = useState<Downtime[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [live, setLive] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    const [b, d, a] = await Promise.all([
      getJson<{ machines: Machine[] }>("/api/board"),
      getJson<Downtime[]>("/api/downtimes?limit=100"),
      getJson<Alert[]>("/api/alerts"),
    ]);
    setMachines(b.machines); setDowntimes(d); setAlerts(a);
  }, []);

  useEffect(() => {
    refresh();
    const es = new EventSource("/api/stream");
    es.onopen = () => setLive(true);
    es.onerror = () => setLive(false);
    es.addEventListener("update", () => refresh());
    const tick = setInterval(refresh, 5000); // keeps durations counting up
    return () => { es.close(); clearInterval(tick); };
  }, [refresh]);

  const login = async () => {
    const username = prompt("Username (operator1 / supervisor1)");
    const pin = username && prompt("PIN (demo: operator1=1111, supervisor1=2222)");
    if (!username || !pin) return;
    const r = await fetch("/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, pin }) });
    r.ok ? (setSession(await r.json()), setError("")) : setError("Login failed");
  };

  const ack = async (id: number) => {
    const r = await fetch(`/api/alerts/${id}/ack`, { method: "POST", headers: { authorization: `Bearer ${session?.token}` } });
    setError(r.ok ? "" : ((await r.json()).error as string));
    refresh();
  };

  const openAlerts = alerts.filter((a) => a.status === "open");

  return (
    <div className="app">
      <header>
        <div>
          <h1>Andon Board</h1>
          <small>Sahyadri Auto Components, Chakan, Pune — fictional · Line 1 Brake Discs</small>
        </div>
        <div className="right">
          <span className={live ? "dot on" : "dot"} title="live connection" /> {live ? "live" : "offline"}
          {session ? (
            <><b>{session.username}</b> ({session.role}) <button onClick={() => setSession(null)}>Logout</button></>
          ) : (
            <button onClick={login}>Login</button>
          )}
        </div>
      </header>

      {openAlerts.length > 0 && (
        <div className="banner">
          ⚠ {openAlerts.length} downtime alert{openAlerts.length > 1 ? "s" : ""} need acknowledgment:{" "}
          {openAlerts.map((a) => a.machineId).join(", ")}
        </div>
      )}
      {error && <div className="error">{error}</div>}

      <nav>
        {(["board", "downtime", "alerts"] as const).map((t) => (
          <button key={t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>
            {t === "board" ? "Andon board" : t === "downtime" ? "Downtime log" : `Alerts (${openAlerts.length})`}
          </button>
        ))}
      </nav>

      {tab === "board" && (
        <div className="tiles">
          {machines.map((m) => (
            <div key={m.id} className={`tile ${m.state}`}>
              <div className="wc">{m.id}</div>
              <div className="name">{m.name}</div>
              <div className="st">{m.state.toUpperCase()}</div>
              <div className="sub">
                {m.state === "down" && `${m.reasonCode} · `}
                {m.state !== "unknown" && `for ${fmtDur(m.durationSec)}`}
              </div>
              <dl>
                <dt>Availability</dt><dd>{pct(m.availability)}</dd>
                <dt>Cycles</dt><dd>{m.cycles}</dd>
                <dt>Temp</dt><dd>{m.temperature == null ? "–" : `${m.temperature} °C`}</dd>
              </dl>
              {m.openAlertId && <div className="tilealert">ALERT #{m.openAlertId}</div>}
            </div>
          ))}
        </div>
      )}

      {tab === "downtime" && (
        <table>
          <thead><tr><th>Machine</th><th>Start</th><th>End</th><th>Duration</th><th>Reason</th></tr></thead>
          <tbody>
            {downtimes.map((d) => (
              <tr key={d.id}>
                <td>{d.machineId}</td><td>{fmtTime(d.start)}</td>
                <td>{d.end ? fmtTime(d.end) : <b className="red">ongoing</b>}</td>
                <td>{fmtDur(d.durationSec)}</td><td>{d.reasonCode} — {d.reasonLabel}</td>
              </tr>
            ))}
            {!downtimes.length && <tr><td colSpan={5}>No downtime recorded yet.</td></tr>}
          </tbody>
        </table>
      )}

      {tab === "alerts" && (
        <table>
          <thead><tr><th>#</th><th>Machine</th><th>Raised</th><th>Reason</th><th>Machine now</th><th>Status</th><th /></tr></thead>
          <tbody>
            {alerts.map((a) => (
              <tr key={a.id}>
                <td>{a.id}</td><td>{a.machineId}</td><td>{fmtTime(a.raisedAt)}</td><td>{a.reasonCode}</td>
                <td>{a.stillDown ? <b className="red">still down</b> : "recovered"}</td>
                <td>{a.status === "open" ? <b className="red">open</b> : `acked by ${a.ackedBy} at ${fmtTime(a.ackedAt!)}`}</td>
                <td>
                  {a.status === "open" && (
                    <button disabled={session?.role !== "supervisor"} title={session?.role === "supervisor" ? "" : "Supervisor login required"} onClick={() => ack(a.id)}>
                      Acknowledge
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {!alerts.length && <tr><td colSpan={7}>No alerts. Alerts appear when a machine is down for more than 2 minutes.</td></tr>}
          </tbody>
        </table>
      )}
    </div>
  );
}
