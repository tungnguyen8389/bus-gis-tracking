import { state } from "../driver.state.js";

const DIRECTION_LABEL = { 1: "Lượt đi", 2: "Lượt về" };
export const directionLabel = d => DIRECTION_LABEL[d] || `Chiều ${d}`;

// Danh sách lịch trình của xe; nội dung gán qua textContent (tên tuyến từ CSDL)
export function renderTrips() {
  document.getElementById("driverName").textContent = state.user.full_name;
  document.getElementById("vehiclePlate").textContent = state.vehicle.plate_number;

  const items = state.schedules.map(s => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "schedule-item";
    btn.dataset.action = "selectTrip";
    btn.dataset.arg = s.schedule_id;
    btn.innerHTML = '<span class="schedule-route"></span><span class="schedule-meta"></span><i class="fa-solid fa-chevron-right"></i>';
    btn.querySelector(".schedule-route").textContent = `Tuyến ${s.route_number} – ${s.route_name}`;
    btn.querySelector(".schedule-meta").textContent = `${directionLabel(s.direction)} · ${s.departure_time}`;
    const li = document.createElement("li");
    li.appendChild(btn);
    return li;
  });
  document.getElementById("scheduleList").replaceChildren(...items);
  document.getElementById("scheduleEmpty").hidden = state.schedules.length > 0;
}

export function selectTrip(scheduleId) {
  state.schedule = state.schedules.find(s => s.schedule_id === scheduleId) || null;
  return state.schedule;
}
