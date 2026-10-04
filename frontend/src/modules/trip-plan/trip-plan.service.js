import { request } from "../../core/http.js";

/**
 * Tìm tuyến đi thẳng tới trạm đích.
 * @param {string} toStopId
 * @param {{latitude:number, longitude:number}|null} origin  Vị trí hiện tại (không có → mọi tuyến qua điểm đến)
 * @returns {Promise<{destination, has_origin, results}>}
 */
export function planTrip(toStopId, origin) {
  const params = new URLSearchParams({ to_stop_id: toStopId });
  if (origin) {
    params.set("from_lat", origin.latitude);
    params.set("from_lng", origin.longitude);
  }
  return request(`/trip-plan?${params}`);
}
