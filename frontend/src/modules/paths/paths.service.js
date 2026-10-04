import { request } from "../../core/http.js";

// Lộ trình tim đường của tuyến theo chiều → GeoJSON Feature (LineString / MultiLineString)
export function getRoutePath(routeId, direction) {
  return request(`/routes/${routeId}/path?direction=${direction}`);
}

// Danh sách tọa độ [lon, lat] liền mạch của lộ trình (gộp MultiLineString)
export function flattenPathCoords(geometry) {
  return geometry.type === "MultiLineString" ? geometry.coordinates.flat() : geometry.coordinates;
}
