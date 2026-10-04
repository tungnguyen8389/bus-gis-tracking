import { request } from "../../core/http.js";

// Danh sách tuyến kèm total_stops, total_paths
export function listRoutes({ auth = false } = {}) {
  return request("/routes", { auth });
}

export function createRoute(payload) {
  return request("/routes", { method: "POST", body: payload, auth: true });
}

export function updateRoute(routeId, payload) {
  return request(`/routes/${routeId}`, { method: "PUT", body: payload, auth: true });
}

export function deleteRoute(routeId) {
  return request(`/routes/${routeId}`, { method: "DELETE", auth: true });
}
