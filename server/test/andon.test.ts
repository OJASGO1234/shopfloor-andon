import { test } from "node:test";
import assert from "node:assert/strict";
import mqtt from "mqtt";
import { openDb } from "../src/db.ts";
import { Andon } from "../src/andon.ts";
import { startServer } from "../src/server.ts";

const T0 = Date.parse("2026-10-10T08:00:00Z");
const iso = (offsetSec: number) => new Date(T0 + offsetSec * 1000).toISOString();
const state = (s: string, ts: number, reasonCode?: string) => JSON.stringify({ state: s, reasonCode, ts: iso(ts) });

/** Andon with in-memory DB and a controllable clock (seconds after T0). */
function setup(alertAfterSec = 120) {
  let t = 0;
  const db = openDb(":memory:");
  const andon = new Andon(db, { alertAfterMs: alertAfterSec * 1000, availabilityWindowMs: 3600_000, now: () => T0 + t * 1000 });
  return { db, andon, at: (s: number) => (t = s) };
}
const machine = (a: Andon, id: string) => a.board().find((m) => m.id === id)!;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor(cond: () => boolean, ms = 3000) {
  const end = Date.now() + ms;
  while (!cond() && Date.now() < end) await sleep(20);
  assert.ok(cond(), "condition not met in time");
}

// ---------- integration: real broker + MQTT client + HTTP ----------
async function withServer(fn: (s: Awaited<ReturnType<typeof startServer>>, pub: (t: string, p: object | string) => void) => Promise<void>) {
  const s = await startServer({ httpPort: 0, mqttPort: 0, dbFile: ":memory:", alertAfterMs: 120_000, availabilityWindowMs: 3600_000 });
  const client = mqtt.connect(`mqtt://127.0.0.1:${s.mqttPort}`);
  await new Promise<void>((r) => client.on("connect", () => r()));
  const pub = (t: string, p: object | string) => client.publish(t, typeof p === "string" ? p : JSON.stringify(p), { qos: 1 });
  try {
    await fn(s, pub);
  } finally {
    await client.endAsync(true);
    await s.stop();
  }
}

test("TC-001 MQTT message on ISA-95 topic updates the machine on the board", () =>
  withServer(async (s, pub) => {
    pub("plant/line1/WC-10/state", { state: "running" });
    await waitFor(() => machine(s.andon, "WC-10").state === "running");
    const board = (await (await fetch(`http://127.0.0.1:${s.httpPort}/api/board`)).json()) as any;
    assert.equal(board.machines.length, 5);
    assert.equal(board.machines.find((m: any) => m.id === "WC-10").state, "running");
  }));

test("TC-002 state, cycle and temperature events are stored in SQLite", () =>
  withServer(async (s, pub) => {
    pub("plant/line1/WC-20/state", { state: "running" });
    pub("plant/line1/WC-20/cycle", { count: 42 });
    pub("plant/line1/WC-20/temperature", { celsius: 71.5 });
    await waitFor(() => (s.andon as any).db.prepare("SELECT COUNT(*) c FROM events").get().c === 3);
    const m = machine(s.andon, "WC-20");
    assert.equal(m.cycles, 42);
    assert.equal(m.temperature, 71.5);
  }));

test("TC-003 down event with reason code opens a downtime log entry; unknown code maps to DT-99", () => {
  const { andon } = setup();
  andon.ingest("plant/line1/WC-10/state", state("running", 0));
  andon.ingest("plant/line1/WC-10/state", state("down", 10, "DT-01"));
  andon.ingest("plant/line1/WC-20/state", state("down", 10, "BOGUS"));
  const d = andon.downtimes("WC-10");
  assert.equal(d.length, 1);
  assert.equal(d[0].reasonCode, "DT-01");
  assert.equal(d[0].reasonLabel, "Tool change");
  assert.equal(d[0].end, null);
  assert.equal(andon.downtimes("WC-20")[0].reasonCode, "DT-99");
});

test("TC-004 returning to running closes the downtime and records its duration", () => {
  const { andon, at } = setup();
  andon.ingest("plant/line1/WC-10/state", state("down", 0, "DT-03"));
  andon.ingest("plant/line1/WC-10/state", state("running", 90));
  at(100);
  const d = andon.downtimes("WC-10")[0];
  assert.equal(d.durationSec, 90);
  assert.notEqual(d.end, null);
  assert.equal(machine(andon, "WC-10").state, "running");
});

test("TC-005 no alert is raised while downtime is under 2 minutes", () => {
  const { andon, at } = setup();
  andon.ingest("plant/line1/WC-30/state", state("down", 0, "DT-02"));
  at(119);
  assert.equal(andon.checkAlerts().length, 0);
  assert.equal(andon.alerts().length, 0);
});

test("TC-006 alert is raised at 2 minutes, exactly once per downtime", () => {
  const { andon, at } = setup();
  andon.ingest("plant/line1/WC-30/state", state("down", 0, "DT-02"));
  at(120);
  assert.equal(andon.checkAlerts().length, 1);
  at(300);
  assert.equal(andon.checkAlerts().length, 0);
  const alerts = andon.alerts();
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].status, "open");
  assert.equal(machine(andon, "WC-30").openAlertId, alerts[0].id);
});

test("TC-007 availability is computed per machine from downtime", () => {
  const { andon, at } = setup();
  andon.ingest("plant/line1/WC-10/state", state("running", 0));
  andon.ingest("plant/line1/WC-10/state", state("down", 300, "DT-02"));
  andon.ingest("plant/line1/WC-10/state", state("running", 450)); // 150s down
  andon.ingest("plant/line1/WC-20/state", state("running", 0));
  at(600); // observed 600s -> WC-10 = 450/600
  assert.equal(andon.availability("WC-10"), 0.75);
  assert.equal(andon.availability("WC-20"), 1);
  assert.equal(andon.availability("WC-40"), null); // never reported
  // an open downtime counts up to "now"
  andon.ingest("plant/line1/WC-20/state", state("down", 500, "DT-04"));
  assert.equal(andon.availability("WC-20"), 500 / 600);
});

test("TC-008 only a logged-in supervisor can acknowledge an alert", () =>
  withServer(async (s, pub) => {
    const url = `http://127.0.0.1:${s.httpPort}`;
    const login = async (username: string, pin: string) =>
      (await (await fetch(`${url}/api/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, pin }) })).json()) as any;
    const ack = (token?: string) =>
      fetch(`${url}/api/alerts/1/ack`, { method: "POST", headers: token ? { authorization: `Bearer ${token}` } : {} });

    // raise an alert using a down event that began 3 minutes ago
    pub("plant/line1/WC-30/state", { state: "down", reasonCode: "DT-02", ts: new Date(Date.now() - 180_000).toISOString() });
    await waitFor(() => machine(s.andon, "WC-30").state === "down");
    s.andon.checkAlerts();

    assert.equal((await ack()).status, 401);
    const op = await login("operator1", "1111");
    assert.equal((await ack(op.token)).status, 403);
    assert.equal((await fetch(`${url}/api/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "supervisor1", pin: "bad" }) })).status, 401);
    const sup = await login("supervisor1", "2222");
    assert.equal((await ack(sup.token)).status, 200);
    assert.equal((await ack(sup.token)).status, 409);
    const a = ((await (await fetch(`${url}/api/alerts`)).json()) as any[])[0];
    assert.equal(a.status, "acknowledged");
    assert.equal(a.ackedBy, "supervisor1");
    assert.equal(machine(s.andon, "WC-30").openAlertId, null);
  }));

test("TC-009 malformed, unknown-machine and invalid-state messages are rejected and not stored", () => {
  const { andon, db } = setup();
  assert.equal(andon.ingest("plant/line1/WC-10/state", "not json"), "rejected");
  assert.equal(andon.ingest("plant/line1/WC-99/state", state("running", 0)), "rejected");
  assert.equal(andon.ingest("plant/line1/WC-10/state", state("exploding", 0)), "rejected");
  assert.equal(andon.ingest("plant/line1/WC-10/cycle", JSON.stringify({ count: -5 })), "rejected");
  assert.equal(andon.ingest("plant/line1/WC-10/bogus", "{}"), "rejected");
  assert.equal(andon.rejected, 5);
  assert.equal((db.prepare("SELECT COUNT(*) c FROM events").get() as any).c, 0);
  assert.equal(machine(andon, "WC-10").state, "unknown");
});

test("TC-010 live stream pushes an update to the browser when a machine event arrives", () =>
  withServer(async (s, pub) => {
    const ctrl = new AbortController();
    const res = await fetch(`http://127.0.0.1:${s.httpPort}/api/stream`, { signal: ctrl.signal });
    const reader = res.body!.getReader();
    let seen = "";
    const reading = (async () => {
      const dec = new TextDecoder();
      while (!seen.includes("event: update")) {
        const { value, done } = await reader.read();
        if (done) break;
        seen += dec.decode(value);
      }
    })();
    await sleep(100);
    pub("plant/line1/WC-50/state", { state: "idle" });
    await Promise.race([reading, sleep(3000)]);
    ctrl.abort();
    assert.ok(seen.includes("event: update"), "no update event received");
  }));
