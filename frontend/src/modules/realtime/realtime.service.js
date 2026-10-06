/**
 * Kết nối namespace viewer "/" cùng origin (window.io nạp từ CDN socket.io trong <head>).
 * token: JWT nhân viên (nhận mọi xe) hoặc tài xế (nhận xe của mình); không có → khách (chỉ nhận chuyến đã trip:watch).
 * @param {{token?, onConnect?, onDisconnect?, onFleetUpdate?, onVehicleOffline?, onTripsUpdate?}} handlers
 */
export function connectRealtime({ token, onConnect, onDisconnect, onFleetUpdate, onVehicleOffline, onTripsUpdate }) {
  const socket = window.io({ reconnection: true, timeout: 5000, auth: token ? { token } : {} });
  if (onConnect) socket.on("connect", onConnect);
  if (onDisconnect) socket.on("disconnect", onDisconnect);
  // Gói GPS: { vehicle_id, plate_number, schedule_id, route_id, route_number, direction, longitude, latitude, speed_kmh, heading, timestamp }
  if (onFleetUpdate) socket.on("fleet_location_update", onFleetUpdate);
  // Xe kết thúc chuyến / thiết bị mất kết nối: { vehicle_id, schedule_id }
  if (onVehicleOffline) socket.on("vehicle_offline", onVehicleOffline);
  // Danh sách chuyến của tuyến đã trips:subscribe: { route_id, direction, trips }
  if (onTripsUpdate) socket.on("trips:update", onTripsUpdate);
  return socket;
}
