import express from "express";
import { randomUUID } from "node:crypto";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { REASON_CODES, USERS, MACHINES, PLANT } from "./config.ts";
import type { Andon } from "./andon.ts";

const webDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../web/dist");

export function createApp(andon: Andon) {
  const app = express();
  app.use(express.json());
  const sessions = new Map<string, { username: string; role: string }>();
  const sseClients = new Set<express.Response>();

  // push a tiny "update" ping to browsers; they refetch the board
  let pending = false;
  andon.onChange = () => {
    if (pending) return;
    pending = true;
    setTimeout(() => {
      pending = false;
      for (const c of sseClients) c.write("event: update\ndata: {}\n\n");
    }, 200);
  };

  app.get("/api/health", (_req, res) => res.json({ ok: true, plant: PLANT, rejectedMessages: andon.rejected }));
  app.get("/api/reason-codes", (_req, res) => res.json(REASON_CODES));

  app.post("/api/login", (req, res) => {
    const u = USERS.find((x) => x.username === req.body?.username && x.pin === req.body?.pin);
    if (!u) return res.status(401).json({ error: "Invalid username or PIN" });
    const token = randomUUID();
    sessions.set(token, { username: u.username, role: u.role });
    andon.audit(u.username, "LOGIN", u.role);
    res.json({ token, username: u.username, role: u.role });
  });

  app.get("/api/board", (_req, res) => res.json({ plant: PLANT, machines: andon.board(), serverTime: andon.now() }));

  app.get("/api/availability", (req, res) => {
    const windowMin = Number(req.query.windowMin);
    const windowMs = windowMin > 0 ? windowMin * 60_000 : undefined;
    res.json(MACHINES.map((m) => ({ machineId: m.id, availability: andon.availability(m.id, windowMs) })));
  });

  app.get("/api/downtimes", (req, res) => {
    const machine = typeof req.query.machine === "string" ? req.query.machine : undefined;
    res.json(andon.downtimes(machine, Math.min(Number(req.query.limit) || 100, 500)));
  });

  app.get("/api/alerts", (req, res) => {
    res.json(andon.alerts(typeof req.query.status === "string" ? req.query.status : undefined));
  });

  app.post("/api/alerts/:id/ack", (req, res) => {
    const s = sessions.get((req.headers.authorization ?? "").replace("Bearer ", ""));
    if (!s) return res.status(401).json({ error: "Login required" });
    if (s.role !== "supervisor") return res.status(403).json({ error: "Only a supervisor can acknowledge alerts" });
    const r = andon.ack(Number(req.params.id), s.username);
    if (r === "not_found") return res.status(404).json({ error: "Alert not found" });
    if (r === "already_acked") return res.status(409).json({ error: "Alert already acknowledged" });
    res.json({ ok: true });
  });

  app.get("/api/stream", (req, res) => {
    res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    res.write("event: hello\ndata: {}\n\n");
    sseClients.add(res);
    req.on("close", () => sseClients.delete(res));
  });

  if (fs.existsSync(webDist)) {
    app.use(express.static(webDist));
    app.use((req, res, next) => (req.path.startsWith("/api") ? next() : res.sendFile(path.join(webDist, "index.html"))));
  }
  return { app, sseClients };
}
