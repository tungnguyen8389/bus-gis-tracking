import { request, apiUrl } from "../../core/http.js";

/**
 * Nạp dữ liệu JSON vào CSDL.
 * @param {{type, route_id, direction, data}} payload  data: chuỗi JSON thô (server tự parse)
 * @returns {Promise<{message, type, imported_count, details}>}
 */
export function importJson(payload) {
  return request("/import/json", { method: "POST", body: payload, auth: true });
}

// URL tải file sao lưu JSON (type: all | routes | stops | paths | vehicles)
export function exportJsonUrl(type) {
  return apiUrl(`/export/json?type=${type}`);
}

/**
 * Nhận diện định dạng dữ liệu JSON (khớp logic auto-detect phía server cho các loại có tọa độ).
 * @returns {"full_package"|"route_path"|"stops"|null}
 */
export function detectImportType(data) {
  if (data.routeGeometry && data.stops) return "full_package";
  if (Array.isArray(data) && data.length > 0 && Array.isArray(data[0]) && typeof data[0][0] === "number") return "route_path";
  if (Array.isArray(data) && data.length > 0 && (data[0].coords_arcgis_wgs84 || data[0].coords || data[0].name || data[0].stop_name)) return "stops";
  if (data.type === "FeatureCollection") return "stops";
  return null;
}
