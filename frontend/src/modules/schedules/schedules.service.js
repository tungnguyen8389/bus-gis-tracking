import { request } from "../../core/http.js";

/**
 * Danh sách phân công chuyến, lọc tùy chọn.
 * @param {{route_id?, direction?, vehicle_id?}} filters  Giá trị "ALL" hoặc rỗng = không lọc
 */
export function listSchedules(filters = {}) {
  const params = new URLSearchParams();
  ["route_id", "direction", "vehicle_id"].forEach(key => {
    const value = filters[key];
    if (value && value !== "ALL") params.set(key, value);
  });
  const query = params.toString();
  return request(`/schedules${query ? `?${query}` : ""}`);
}

export function createSchedule(payload) {
  return request("/schedules", { method: "POST", body: payload, auth: true });
}

export function updateSchedule(scheduleId, payload) {
  return request(`/schedules/${scheduleId}`, { method: "PUT", body: payload, auth: true });
}

export function deleteSchedule(scheduleId) {
  return request(`/schedules/${scheduleId}`, { method: "DELETE", auth: true });
}
