import mqtt from "mqtt";
import { MACHINES, LINE, REASON_CODES } from "./config.ts";

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T>(xs: readonly T[]) => xs[Math.floor(Math.random() * xs.length)];

/** Simulates the 5 machines of line1. Publishes to plant/line1/<WC>/<state|cycle|temperature>. */
export function startSimulator(url: string) {
  const client = mqtt.connect(url, { clientId: "machine-simulator" });
  const timers: NodeJS.Timeout[] = [];
  const pub = (wc: string, kind: string, body: object) =>
    client.publish(`plant/${LINE}/${wc}/${kind}`, JSON.stringify({ ...body, ts: new Date().toISOString() }), { qos: 1 });

  client.on("connect", () => {
    console.log(`[sim] connected, simulating ${MACHINES.length} machines`);
    MACHINES.forEach((m, i) => {
      let count = 0;
      let state = "running";
      let temp = 55 + i * 4;
      const cycleSec = 6 + i * 2;
      const setState = (s: string, reasonCode?: string) => {
        state = s;
        pub(m.id, "state", { state: s, reasonCode });
      };
      const scheduleChange = (afterSec: number, fn: () => void) => timers.push(setTimeout(fn, afterSec * 1000));

      // state machine: running -> (idle | down) -> running
      const nextEvent = () => {
        const r = Math.random();
        scheduleChange(rnd(25, 70), () => {
          if (r < 0.25) {
            setState("idle");
            scheduleChange(rnd(10, 25), () => (setState("running"), nextEvent()));
          } else {
            // 20% of breakdowns are long (> 2 min) so the demo raises alerts
            const long = Math.random() < 0.2;
            setState("down", pick(REASON_CODES.filter((c) => c.code !== "DT-99")).code);
            scheduleChange(long ? rnd(130, 190) : rnd(15, 60), () => (setState("running"), nextEvent()));
          }
        });
      };

      setState("running");
      nextEvent();
      // WC-30 breaks down early for 2.5 min so a demo alert shows up within ~2 min of start
      if (m.id === "WC-30") {
        timers.push(setTimeout(() => setState("down", "DT-02"), 5000));
        timers.push(setTimeout(() => setState("running"), 155_000));
      }

      timers.push(setInterval(() => state === "running" && pub(m.id, "cycle", { count: ++count }), cycleSec * 1000));
      timers.push(
        setInterval(() => {
          const target = state === "running" ? 70 + i * 3 : 35;
          temp += (target - temp) * 0.15 + rnd(-0.8, 0.8);
          pub(m.id, "temperature", { celsius: Math.round(temp * 10) / 10 });
        }, 4000),
      );
    });
  });

  return {
    stop() {
      timers.forEach((t) => (clearTimeout(t), clearInterval(t)));
      client.end(true);
    },
  };
}

if (process.argv[1]?.endsWith("simulator.ts")) {
  startSimulator(process.env.MQTT_URL ?? "mqtt://127.0.0.1:1883");
}
