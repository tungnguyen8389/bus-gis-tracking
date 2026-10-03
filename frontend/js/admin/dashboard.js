// --------------------------------------------------------------------
// TỔNG QUAN HỆ THỐNG (Dashboard Stats)
// --------------------------------------------------------------------
async function loadDashboardStats() {
  try {
    const res = await fetch(`${API_BASE}/admin/stats`, { headers: getAuthHeaders() });
    if (res.ok) {
      const stats = await res.json();
      document.getElementById("stat-routes").innerText = stats.routes;
      document.getElementById("stat-stops").innerText = stats.stops;
      document.getElementById("stat-vehicles").innerText = stats.vehicles;
      const schedulesEl = document.getElementById("stat-schedules");
      if (schedulesEl) schedulesEl.innerText = stats.schedules || 0;
      document.getElementById("stat-logs").innerText = stats.tracking_logs;
    }
  } catch (e) {}
}
