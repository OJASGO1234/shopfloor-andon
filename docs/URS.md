# User Requirements Specification — Shop Floor Connectivity & Andon System

Plant: **Sahyadri Auto Components, Chakan, Pune (fictional)** · Line 1 (brake discs BD-150 / BD-220)
Work centers: WC-10 Turning, WC-20 Drilling, WC-30 Balancing, WC-40 Inspection, WC-50 Packing

| ID | Requirement | Priority | Test |
|----|-------------|----------|------|
| URS-001 | The system shall include an embedded MQTT broker that machines (or the simulator) publish to, with no external services or Docker required. | Must | TC-001 |
| URS-002 | Machine messages shall use ISA-95-style topics: `plant/<line>/<work-center>/<state\|cycle\|temperature>`, e.g. `plant/line1/WC-10/state`. | Must | TC-001, TC-002 |
| URS-003 | A simulator shall publish events for 5 machines: state (running / idle / down + reason code), cycle count and temperature. | Must | Smoke run (ATP §3) |
| URS-004 | The backend shall subscribe to all machine topics and store every valid event in a SQLite database. | Must | TC-002 |
| URS-005 | The frontend shall show a live andon board with one tile per machine: green = running, yellow = idle, red = down (grey = no data yet), updating without a page refresh. | Must | TC-001, TC-010 |
| URS-006 | Each tile shall show the machine's current state duration, cycle count, temperature and availability. | Should | TC-002, TC-007 |
| URS-007 | The system shall keep a downtime log (machine, start, end, duration, reason) and show it in the UI. | Must | TC-003, TC-004 |
| URS-008 | Downtime shall carry a reason code from a master list (DT-01 … DT-06); an unknown or missing code shall be recorded as DT-99 "Unspecified". | Must | TC-003 |
| URS-009 | The system shall raise an alert when a machine has been down for more than 2 minutes (configurable), once per downtime event. | Must | TC-005, TC-006 |
| URS-010 | Only a logged-in user with the Supervisor role shall be able to acknowledge an alert; the acknowledger and time shall be recorded. | Must | TC-008 |
| URS-011 | The system shall compute availability per machine = (observed time − downtime) ÷ observed time over a rolling window (default 8 h). | Must | TC-007 |
| URS-012 | Malformed messages, unknown machines and invalid states shall be rejected, counted and not stored; they must not crash the backend or change machine state. | Must | TC-009 |

## Assumptions and constraints
- Demo scope: users and PINs are hard-coded (`operator1/1111`, `supervisor1/2222`); not production security.
- "Idle" counts as available time; only "down" reduces availability.
- Machine timestamps are trusted when valid ISO-8601, otherwise the receive time is used.
- One command installs, builds and runs the whole system (`npm run go`).
