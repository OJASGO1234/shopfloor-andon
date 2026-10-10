// Static plant configuration. Everything here is FICTIONAL.
export const PLANT = "Sahyadri Auto Components, Chakan, Pune (fictional)";
export const LINE = "line1";

export const MACHINES = [
  { id: "WC-10", name: "CNC Turning" },
  { id: "WC-20", name: "Drilling" },
  { id: "WC-30", name: "Balancing" },
  { id: "WC-40", name: "Final Inspection" },
  { id: "WC-50", name: "Packing" },
] as const;

export const REASON_CODES = [
  { code: "DT-01", label: "Tool change" },
  { code: "DT-02", label: "Mechanical breakdown" },
  { code: "DT-03", label: "Electrical fault" },
  { code: "DT-04", label: "No material / starved" },
  { code: "DT-05", label: "Quality check / first-off" },
  { code: "DT-06", label: "Changeover (BD-150 / BD-220)" },
  { code: "DT-99", label: "Unspecified" },
] as const;

export type MachineState = "running" | "idle" | "down";
export const STATES: MachineState[] = ["running", "idle", "down"];

export const config = {
  httpPort: Number(process.env.HTTP_PORT ?? 3000),
  mqttPort: Number(process.env.MQTT_PORT ?? 1883),
  dbFile: process.env.DB_FILE ?? "andon.db",
  alertAfterMs: Number(process.env.ALERT_AFTER_SEC ?? 120) * 1000,
  availabilityWindowMs: Number(process.env.AVAILABILITY_WINDOW_MIN ?? 480) * 60_000,
  simulator: process.env.SIMULATOR !== "0",
};

// Demo-only users (no real security; see README).
export const USERS = [
  { username: "operator1", pin: "1111", role: "operator" },
  { username: "supervisor1", pin: "2222", role: "supervisor" },
] as const;
