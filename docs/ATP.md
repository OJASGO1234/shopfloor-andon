# Acceptance Test Plan — Shop Floor Connectivity & Andon System

Fictional plant: Sahyadri Auto Components, Chakan, Pune.
All test cases are automated in [server/test/andon.test.ts](../server/test/andon.test.ts) and run with `npm test`.
TC-001, 002, 008, 010 use a real embedded broker, an MQTT client and the HTTP API. The others drive the core logic with a fake clock so the 2-minute rule is tested instantly.

## 1. Test cases

| TC | URS | Description | Steps | Expected | Actual | Result |
|----|-----|-------------|-------|----------|--------|--------|
| TC-001 | 001, 002, 005 | MQTT message updates the board | Publish `{state:"running"}` to `plant/line1/WC-10/state`; call `GET /api/board` | 5 machines returned; WC-10 is `running` | As expected | PASS |
| TC-002 | 002, 004, 006 | Events stored in SQLite | Publish state, cycle (42) and temperature (71.5) for WC-20 | 3 rows in `events`; board shows cycles 42, temp 71.5 | As expected | PASS |
| TC-003 | 007, 008 | Downtime with reason code logged | WC-10 down with `DT-01`; WC-20 down with code `BOGUS` | WC-10: DT-01 "Tool change", open (no end). WC-20: DT-99 | As expected | PASS |
| TC-004 | 007 | Downtime closed on recovery | WC-10 down at t=0, running at t=90 | Downtime has end time, duration 90 s, state running | As expected | PASS |
| TC-005 | 009 | No early alert | WC-30 down; check alerts at t=119 s | 0 alerts | As expected | PASS |
| TC-006 | 009 | Alert at 2 min, once | Check at t=120 s, again at t=300 s | 1 alert raised at 120 s, none added at 300 s; board shows open alert | As expected | PASS |
| TC-007 | 006, 011 | Availability | WC-10 down 150 s in a 600 s window; WC-20 never down; WC-40 never reported; WC-20 then down 100 s (open) | WC-10 = 75 %, WC-20 = 100 %, WC-40 = n/a, WC-20 = 500/600 after open downtime | As expected | PASS |
| TC-008 | 010 | Supervisor-only acknowledgment | Ack with no login, as operator, as supervisor, then again | 401, 403, 200, 409; alert shows `acknowledged` by `supervisor1`; bad PIN gives 401 | As expected | PASS |
| TC-009 | 012 | Invalid messages rejected | Send bad JSON, unknown machine WC-99, state `exploding`, negative cycle count, unknown topic kind | All rejected, counter = 5, no events stored, WC-10 stays `unknown` | As expected | PASS |
| TC-010 | 005 | Live push to browser | Open `/api/stream`; publish a WC-50 state event | `update` event received without polling | As expected | PASS |

## 2. Automated run

Run on 2026-10-10 with `npm test` (Node 24): **10 tests, 10 passed, 0 failed.**

## 3. Smoke run (URS-003, UI serving)

Run with `ALERT_AFTER_SEC=10 npm start` on 2026-10-10:
- Simulator connected and all 5 machines reported within seconds (state, cycle counts, temperature).
- WC-30 went down (DT-02) at about 5 s; the alert was raised at the next 5 s check after the 10 s test threshold, and acknowledged via the API as `supervisor1`.
- `GET /` served the built React app (HTTP 200).

Visual check of the board, downtime log and alert screens is manual: open http://localhost:3000.
