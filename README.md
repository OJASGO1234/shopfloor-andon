# Shop Floor Connectivity & Andon System

> **Fictional demo.** Sahyadri Auto Components (Chakan, Pune) does not exist. All machines, data and users are made up.

Machines publish events over MQTT, the backend stores them in SQLite, raises an alert when a machine is down for more than 2 minutes, and a React andon board shows it live.

```
simulator --MQTT--> [embedded aedes broker] --> backend (Node/TS) --> SQLite
                                                     |  REST + SSE
                                                     v
                                               React andon board
```

## Run it
Needs Node 22.5+ (built-in `node:sqlite`). No Docker, no external services.

```
npm run go
```
Then open **http://localhost:3000**. (`go` = install + build + start. Ports: web 3000, MQTT 1883.)

## Try it
- Five tiles: green = running, yellow = idle, red = down. WC-30 is forced down about 5 s after start for 2.5 min, so an alert appears after about 2 min.
- **Login** as `supervisor1` / PIN `2222` (operator: `operator1` / `1111`), open **Alerts**, press **Acknowledge**. Operators cannot.
- **Downtime log** lists every stop with its reason code (DT-01 … DT-06, DT-99 unspecified).
- Publish your own event with any MQTT client: topic `plant/line1/WC-10/state`, payload `{"state":"down","reasonCode":"DT-02"}`.

## Configuration (env vars)
`ALERT_AFTER_SEC` (120), `AVAILABILITY_WINDOW_MIN` (480), `HTTP_PORT` (3000), `MQTT_PORT` (1883), `DB_FILE` (andon.db), `SIMULATOR=0` to run without the simulator (`npm run sim` runs it on its own).

## Tests and docs
`npm test` builds the UI and runs the 10 automated acceptance tests.
- [docs/URS.md](docs/URS.md) — 12 requirements
- [docs/ATP.md](docs/ATP.md) — 10 test cases with results

## Layout
`server/` broker, ingest logic ([andon.ts](server/src/andon.ts)), REST API, simulator, tests · `web/` React + Vite UI · `docs/`

Availability = (observed time − downtime) ÷ observed time. Auth is hard-coded demo only.
