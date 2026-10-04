/**
 * Kết nối namespace viewer "/" cùng origin (window.io nạp từ CDN socket.io trong <head>).
 * Viewer chỉ nhận dữ liệu; vị trí xe do thiết bị tài xế phát qua namespace /device.
 * @param {{onConnect?, onDisconnect?, onFleetUpdate?, onVehicleOffline?}} handlers
 */
export function connectRealtime({ onConnect, onDisconnect, onFleetUpdate, onVehicleOffline }) {
  const socket = window.io({ reconnection: true, timeout: 5000 });
  if (onConnect) socket.on("connect", onConnect);
  if (onDisconnect) socket.on("disconnect", onDisconnect);
  // Gói GPS: { vehicle_id, plate_number, route_id, route_number, direction, longitude, latitude, speed_kmh, heading, timestamp }
  if (onFleetUpdate) socket.on("fleet_location_update", onFleetUpdate);
  // Xe kết thúc chuyến / thiết bị mất kết nối: { vehicle_id }
  if (onVehicleOffline) socket.on("vehicle_offline", onVehicleOffline);
  return socket;
}
