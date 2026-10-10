import type { DB } from "./db.ts";
import { MACHINES, STATES, type MachineState } from "./config.ts";

export type IngestResult = "ok" | "rejected";
type Row = Record<string, any>;

/** Core Andon logic. Pure of MQTT/HTTP so it can be tested with a fake clock. */
export class Andon {
  rejected = 0;
  onChange: () => void = () => {};

  constructor(
    private db: DB,
    private opts: { alertAfterMs: number; availabilityWindowMs: number; now?: () => number },
  ) {}

  now() {
    return (this.opts.now ?? Date.now)();
  }

  /** Handle one MQTT message: topic like plant/line1/WC-10/state */
  ingest(topic: string, raw: string): IngestResult {
    const reject = (): IngestResult => (this.rejected++, "rejected");
    const parts = topic.split("/");
    if (parts.length !== 4 || parts[0] !== "plant") return reject();
    const [, , machineId, kind] = parts;
    if (!MACHINES.some((m) => m.id === machineId)) return reject();

    let p: Row;
    try {
      p = JSON.parse(raw);
    } catch {
      return reject();
    }
    if (typeof p !== "object" || p === null) return reject();
    const ts = typeof p.ts === "string" && !isNaN(Date.parse(p.ts)) ? Date.parse(p.ts) : this.now();

    if (kind === "state") {
      if (!STATES.includes(p.state)) return reject();
      this.setState(machineId, p.state, p.reasonCode, ts);
    } else if (kind === "cycle") {
      if (!Number.isFinite(p.count) || p.count < 0) return reject();
      this.touch(machineId, ts);
      this.db.prepare("UPDATE machines SET cycles = ? WHERE id = ?").run(p.count, machineId);
    } else if (kind === "temperature") {
      if (!Number.isFinite(p.celsius)) return reject();
      this.touch(machineId, ts);
      this.db.prepare("UPDATE machines SET temperature = ? WHERE id = ?").run(p.celsius, machineId);
    } else return reject();

    this.db
      .prepare("INSERT INTO events (ts, machine_id, kind, payload) VALUES (?, ?, ?, ?)")
      .run(ts, machineId, kind, raw);
    this.onChange();
    return "ok";
  }

  private touch(id: string, ts: number) {
    this.db
      .prepare("UPDATE machines SET last_seen = ?, first_seen = COALESCE(first_seen, ?) WHERE id = ?")
      .run(ts, ts, id);
  }

  private setState(id: string, state: MachineState, reasonIn: unknown, ts: number) {
    this.touch(id, ts);
    const cur = this.db.prepare("SELECT state, reason_code FROM machines WHERE id = ?").get(id) as Row;
    let reason: string | null = null;
    if (state === "down") {
      const known = this.db.prepare("SELECT 1 FROM reason_codes WHERE code = ?").get(String(reasonIn));
      reason = known ? String(reasonIn) : "DT-99";
    }
    if (cur.state === state && cur.reason_code === reason) return; // heartbeat

    // close the open downtime (if any), open a new one if going down
    this.db.prepare("UPDATE downtimes SET end_ts = ? WHERE machine_id = ? AND end_ts IS NULL").run(ts, id);
    if (state === "down") {
      this.db
        .prepare("INSERT INTO downtimes (machine_id, start_ts, reason_code) VALUES (?, ?, ?)")
        .run(id, ts, reason);
    }
    this.db
      .prepare("UPDATE machines SET state = ?, state_since = ?, reason_code = ? WHERE id = ?")
      .run(state, ts, reason, id);
  }

  /** Raise one alert per downtime that has been open longer than the threshold. */
  checkAlerts(): Row[] {
    const now = this.now();
    const due = this.db
      .prepare(
        `SELECT d.id, d.machine_id FROM downtimes d
         WHERE d.end_ts IS NULL AND ? - d.start_ts >= ?
           AND NOT EXISTS (SELECT 1 FROM alerts a WHERE a.downtime_id = d.id)`,
      )
      .all(now, this.opts.alertAfterMs) as Row[];
    for (const d of due) {
      this.db
        .prepare("INSERT INTO alerts (downtime_id, machine_id, raised_ts) VALUES (?, ?, ?)")
        .run(d.id, d.machine_id, now);
      this.audit("system", "ALERT_RAISED", `${d.machine_id} downtime #${d.id}`);
    }
    if (due.length) this.onChange();
    return due;
  }

  ack(alertId: number, user: string): "ok" | "not_found" | "already_acked" {
    const a = this.db.prepare("SELECT * FROM alerts WHERE id = ?").get(alertId) as Row | undefined;
    if (!a) return "not_found";
    if (a.acked_ts) return "already_acked";
    this.db.prepare("UPDATE alerts SET acked_by = ?, acked_ts = ? WHERE id = ?").run(user, this.now(), alertId);
    this.audit(user, "ALERT_ACK", `${a.machine_id} alert #${alertId}`);
    this.onChange();
    return "ok";
  }

  audit(who: string, action: string, detail: string) {
    this.db.prepare("INSERT INTO audit (ts, who, action, detail) VALUES (?, ?, ?, ?)").run(this.now(), who, action, detail);
  }

  /** Availability = (observed time - downtime) / observed time within the window. */
  availability(machineId: string, windowMs = this.opts.availabilityWindowMs): number | null {
    const now = this.now();
    const m = this.db.prepare("SELECT first_seen FROM machines WHERE id = ?").get(machineId) as Row | undefined;
    if (!m || m.first_seen == null) return null;
    const from = Math.max(now - windowMs, m.first_seen);
    const observed = now - from;
    if (observed <= 0) return null;
    const rows = this.db
      .prepare("SELECT start_ts, end_ts FROM downtimes WHERE machine_id = ? AND COALESCE(end_ts, ?) > ?")
      .all(machineId, now, from) as Row[];
    let down = 0;
    for (const r of rows) down += Math.min(r.end_ts ?? now, now) - Math.max(r.start_ts, from);
    return Math.max(0, Math.min(1, 1 - down / observed));
  }

  board() {
    const now = this.now();
    const machines = this.db.prepare("SELECT * FROM machines ORDER BY id").all() as Row[];
    return machines.map((m) => {
      const alert = this.db
        .prepare("SELECT * FROM alerts WHERE machine_id = ? AND acked_ts IS NULL ORDER BY id DESC LIMIT 1")
        .get(m.id) as Row | undefined;
      return {
        id: m.id,
        name: m.name,
        state: m.state as string,
        since: m.state_since as number | null,
        durationSec: m.state_since ? Math.max(0, Math.round((now - m.state_since) / 1000)) : 0,
        reasonCode: m.reason_code as string | null,
        cycles: m.cycles as number,
        temperature: m.temperature as number | null,
        availability: this.availability(m.id),
        openAlertId: alert ? (alert.id as number) : null,
      };
    });
  }

  downtimes(machineId?: string, limit = 100) {
    const now = this.now();
    const rows = this.db
      .prepare(
        `SELECT d.*, r.label AS reason_label FROM downtimes d
         JOIN reason_codes r ON r.code = d.reason_code
         WHERE (? IS NULL OR d.machine_id = ?) ORDER BY d.start_ts DESC LIMIT ?`,
      )
      .all(machineId ?? null, machineId ?? null, limit) as Row[];
    return rows.map((d) => ({
      id: d.id as number,
      machineId: d.machine_id as string,
      start: d.start_ts as number,
      end: d.end_ts as number | null,
      durationSec: Math.round(((d.end_ts ?? now) - d.start_ts) / 1000),
      reasonCode: d.reason_code as string,
      reasonLabel: d.reason_label as string,
    }));
  }

  alerts(status?: string) {
    const rows = this.db
      .prepare(
        `SELECT a.*, d.start_ts, d.end_ts, d.reason_code FROM alerts a
         JOIN downtimes d ON d.id = a.downtime_id ORDER BY a.id DESC LIMIT 100`,
      )
      .all() as Row[];
    return rows
      .map((a) => ({
        id: a.id as number,
        machineId: a.machine_id as string,
        raisedAt: a.raised_ts as number,
        downtimeStart: a.start_ts as number,
        stillDown: a.end_ts == null,
        reasonCode: a.reason_code as string,
        ackedBy: a.acked_by as string | null,
        ackedAt: a.acked_ts as number | null,
        status: a.acked_ts ? "acknowledged" : "open",
      }))
      .filter((a) => !status || a.status === status);
  }
}
