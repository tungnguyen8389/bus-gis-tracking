import { SOCKET_URL } from "../../core/config.js";

/**
 * Kết nối Socket.io tới hub realtime (window.io nạp từ CDN socket.io trong <head>).
 * @param {{onConnect?, onDisconnect?, onFleetUpdate?}} handlers
 */
export function connectRealtime({ onConnect, onDisconnect, onFleetUpdate }) {
  const socket = window.io(SOCKET_URL, { reconnection: true, timeout: 5000 });
  if (onConnect) socket.on("connect", onConnect);
  if (onDisconnect) socket.on("disconnect", onDisconnect);
  // Gói GPS: { vehicle_id, plate_number, route_id, longitude, latitude, speed_kmh, heading }
  if (onFleetUpdate) socket.on("fleet_location_update", onFleetUpdate);
  return socket;
}
