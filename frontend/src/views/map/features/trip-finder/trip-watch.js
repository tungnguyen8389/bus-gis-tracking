// --------------------------------------------------------------------
// THEO DÕI CHUYẾN CỦA KHÁCH (qua socket):
//   trips:subscribe → danh sách chuyến đang chạy/sắp tới + ETA của tuyến đã chọn (không tọa độ)
//   trip:watch      → tọa độ của đúng 1 chuyến; khách không bao giờ thấy xe khác
// Kết nối lại → tự đăng ký lại cả hai.
// --------------------------------------------------------------------
import { state } from "../../map.state.js";
import { getFleetSocket, onFleetEvent, clearFleet } from "../fleet-tracking.js";

const ACK_TIMEOUT_MS = 5000;
const watch = { subscription: null, trips: [], ended: false, listeners: [] };

function emitAck(event, payload) {
  const socket = getFleetSocket();
  if (!socket) return Promise.resolve({ ok: false, error: "OFFLINE" });
  return socket.timeout(ACK_TIMEOUT_MS).emitWithAck(event, payload).catch(() => ({ ok: false, error: "TIMEOUT" }));
}

export function onTripWatchChange(fn) {
  watch.listeners.push(fn);
}
function notify(extra = {}) {
  const payload = { trips: watch.trips, watchedScheduleId: state.watchedScheduleId, ended: watch.ended, ...extra };
  watch.listeners.forEach(fn => fn(payload));
}

export const getWatchedTrip = () => watch.trips.find(t => t.schedule_id === state.watchedScheduleId) || null;

export async function subscribeTrips({ route_id, direction, board_stop_id }) {
  const sub = { route_id: String(route_id), direction: Number(direction), board_stop_id: board_stop_id || null };
  watch.subscription = sub;
  const ack = await emitAck("trips:subscribe", sub);
  if (watch.subscription !== sub) return null;   // khách đã đổi tuyến trong lúc chờ
  watch.trips = ack.ok ? ack.trips : [];
  notify({ error: ack.ok ? null : ack.error });
  return ack;
}

export async function watchTrip(scheduleId) {
  if (state.watchedScheduleId !== scheduleId) clearFleet();
  state.watchedScheduleId = scheduleId;
  watch.ended = false;
  notify();
  const ack = await emitAck("trip:watch", { schedule_id: scheduleId });
  if (state.watchedScheduleId !== scheduleId) return ack;
  if (!ack.ok) watch.ended = true;
  notify();
  return ack;
}

// Khách đổi tuyến / tìm điểm đến mới: rời cả 2 room, gỡ xe
export function clearTripWatch() {
  const socket = getFleetSocket();
  if (socket && socket.connected) {
    if (state.watchedScheduleId) socket.emit("trip:unwatch");
    if (watch.subscription) socket.emit("trips:unsubscribe");
  }
  resetTripWatch();
  clearFleet();
}

// Socket mới (đổi vai trò) không còn room nào → chỉ xóa trạng thái
export function resetTripWatch() {
  state.watchedScheduleId = null;
  watch.subscription = null;
  watch.trips = [];
  watch.ended = false;
  notify();
}

onFleetEvent("connect", async () => {
  if (watch.subscription) await subscribeTrips(watch.subscription);
  if (state.watchedScheduleId) await watchTrip(state.watchedScheduleId);
});

onFleetEvent("tripsUpdate", data => {
  const sub = watch.subscription;
  if (!sub || data.route_id !== sub.route_id || data.direction !== sub.direction) return;
  watch.trips = data.trips;
  notify();
});

onFleetEvent("offline", ({ schedule_id }) => {
  if (schedule_id === undefined || schedule_id !== state.watchedScheduleId) return;
  watch.ended = true;
  notify();
});
