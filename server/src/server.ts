import net from "node:net";
import http from "node:http";
import mqtt from "mqtt";
import { Aedes } from "aedes";
import { openDb } from "./db.ts";
import { Andon } from "./andon.ts";
import { createApp } from "./api.ts";

export interface ServerOptions {
  httpPort: number;
  mqttPort: number;
  dbFile: string;
  alertAfterMs: number;
  availabilityWindowMs: number;
  now?: () => number;
  alertCheckMs?: number;
}

/** Starts embedded MQTT broker + MQTT subscriber + HTTP API. Port 0 = pick a free port. */
export async function startServer(o: ServerOptions) {
  const db = openDb(o.dbFile);
  const andon = new Andon(db, o);

  const broker = await Aedes.createBroker();
  const mqttServer = net.createServer(broker.handle);
  await new Promise<void>((r) => mqttServer.listen(o.mqttPort, r));
  const mqttPort = (mqttServer.address() as net.AddressInfo).port;

  // The backend is an ordinary MQTT client of its own broker.
  const client = mqtt.connect(`mqtt://127.0.0.1:${mqttPort}`, { clientId: "andon-backend" });
  await new Promise<void>((r) => client.on("connect", () => r()));
  await client.subscribeAsync("plant/+/+/+", { qos: 1 });
  client.on("message", (topic, payload) => {
    try {
      andon.ingest(topic, payload.toString());
    } catch (e) {
      console.error("ingest error", e);
    }
  });

  const { app, sseClients } = createApp(andon);
  const httpServer = http.createServer(app);
  await new Promise<void>((r) => httpServer.listen(o.httpPort, r));
  const httpPort = (httpServer.address() as net.AddressInfo).port;

  const timer = setInterval(() => andon.checkAlerts(), o.alertCheckMs ?? 5000);

  return {
    andon,
    mqttPort,
    httpPort,
    async stop() {
      clearInterval(timer);
      for (const c of sseClients) c.end();
      await client.endAsync(true);
      await new Promise<void>((r) => broker.close(() => r()));
      mqttServer.close();
      httpServer.closeAllConnections();
      await new Promise<void>((r) => httpServer.close(() => r()));
      db.close();
    },
  };
}
