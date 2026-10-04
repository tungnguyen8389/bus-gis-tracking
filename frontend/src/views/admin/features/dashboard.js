import { getStats } from "../../../modules/admin-stats/admin-stats.service.js";

export async function loadDashboardStats() {
  try {
    const stats = await getStats();
    document.getElementById("stat-routes").innerText = stats.routes;
    document.getElementById("stat-stops").innerText = stats.stops;
    document.getElementById("stat-vehicles").innerText = stats.vehicles;
    if (document.getElementById("stat-schedules")) {
      document.getElementById("stat-schedules").innerText = stats.schedules || 0;
    }
    document.getElementById("stat-logs").innerText = stats.tracking_logs;
  } catch (e) {}
}
