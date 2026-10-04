import { request } from "../../core/http.js";

// Toàn bộ trạm dạng GeoJSON FeatureCollection
export function listStops() {
  return request("/stops");
}

// Feature GeoJSON → bản ghi trạm phẳng { stop_id, stop_name, address, longitude, latitude }
export function featureToStop(feature) {
  return {
    stop_id: feature.properties.stop_id,
    stop_name: feature.properties.stop_name,
    address: feature.properties.address,
    longitude: feature.geometry.coordinates[0],
    latitude: feature.geometry.coordinates[1]
  };
}

export function createStop(payload) {
  return request("/stops", { method: "POST", body: payload, auth: true });
}

export function updateStop(stopId, payload) {
  return request(`/stops/${stopId}`, { method: "PUT", body: payload, auth: true });
}

export function deleteStop(stopId) {
  return request(`/stops/${stopId}`, { method: "DELETE", auth: true });
}

// Trạm thuộc tuyến theo chiều, sắp theo stop_order (đã có longitude/latitude)
export function listRouteStops(routeId, direction) {
  return request(`/routes/${routeId}/stops?direction=${direction}`);
}

export function assignStopToRoute(routeId, { stop_id, direction, stop_order }) {
  return request(`/routes/${routeId}/stops`, { method: "POST", body: { stop_id, direction, stop_order }, auth: true });
}

// stop_order chỉ xóa đúng lần ghé đó (tuyến vòng có thể ghé 1 trạm nhiều lần)
export function removeStopFromRoute(routeId, stopId, direction, stopOrder) {
  return request(`/routes/${routeId}/stops/${stopId}?direction=${direction}&stop_order=${stopOrder}`, { method: "DELETE", auth: true });
}
