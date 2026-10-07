import { request } from "../../core/http.js";
import { DRIVER_TOKEN_KEY } from "../../core/config.js";

// → { token, user: { user_id, username, full_name, role: "DRIVER", vehicle_id } }
export function driverLogin(username, password) {
  return request("/auth/driver/login", { method: "POST", body: { username, password } });
}

// → { user, vehicle: { vehicle_id, plate_number }, schedules: [{ schedule_id, route_id, route_number, route_name, direction, departure_time }] }
export function getDriverMe() {
  return request("/driver/me", { auth: true, tokenKey: DRIVER_TOKEN_KEY });
}
