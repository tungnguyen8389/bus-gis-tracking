import { request } from "../../core/http.js";

// → { routes, stops, vehicles, schedules, users, tracking_logs, server_time }
export function getStats() {
  return request("/admin/stats", { auth: true });
}
