import { config, PLANT } from "./config.ts";
import { startServer } from "./server.ts";
import { startSimulator } from "./simulator.ts";

const s = await startServer(config);
console.log(`${PLANT}`);
console.log(`MQTT broker : mqtt://localhost:${s.mqttPort}   (topics plant/line1/<WC>/<state|cycle|temperature>)`);
console.log(`Andon board : http://localhost:${s.httpPort}`);
console.log(`Alert after : ${config.alertAfterMs / 1000}s down | login supervisor1 / 2222 to acknowledge`);
if (config.simulator) startSimulator(`mqtt://127.0.0.1:${s.mqttPort}`);
process.on("SIGINT", async () => (await s.stop(), process.exit(0)));
