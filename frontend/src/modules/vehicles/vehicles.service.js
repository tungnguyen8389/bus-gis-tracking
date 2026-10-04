import { request } from "../../core/http.js";

// Danh sách xe kèm assigned_routes, total_trips
export function listVehicles() {
  return request("/vehicles");
}

export function createVehicle(payload) {
  return request("/vehicles", { method: "POST", body: payload, auth: true });
}

export function updateVehicle(vehicleId, payload) {
  return request(`/vehicles/${vehicleId}`, { method: "PUT", body: payload, auth: true });
}

export function deleteVehicle(vehicleId) {
  return request(`/vehicles/${vehicleId}`, { method: "DELETE", auth: true });
}
