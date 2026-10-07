// --------------------------------------------------------------------
// THEO DÕI CHUYẾN CỦA KHÁCH (qua socket):
//   trips:subscribe → danh sách chuyến đang chạy/sắp tới + ETA của tuyến đã chọn (không tọa độ)
//   trip:watch      → tọa độ của đúng 1 chuyến; khách không bao giờ thấy xe khác
// Kết nối lại → tự đăng ký lại cả hai.
// --------------------------------------------------------------------
import { state } from "../../map.state.js";
import { getFleetSocket, onFleetEvent, clearFleet } from "../fleet-tracking.js";

const ACK_TIMEOUT_MS = 5000;
const watch = { subscription: null, trips: [], ended: false, seq: 0, listeners: [] };

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
  const seq = ++watch.seq;   // chỉ ack của lần gọi mới nhất được áp dụng
  if (state.watchedScheduleId !== scheduleId) {
    clearFleet();   // clearFleet cũng xóa số liệu xe trước trên bảng
  }
  state.watchedScheduleId = scheduleId;
  watch.ended = false;
  notify();
  const ack = await emitAck("trip:watch", { schedule_id: scheduleId });
  if (seq !== watch.seq) return ack;
  // Chỉ TRIP_NOT_AVAILABLE là chuyến đã kết thúc; lỗi khác (timeout, offline...) giữ nguyên để kết nối lại thì đăng ký lại
  if (!ack.ok && ack.error === "TRIP_NOT_AVAILABLE") {
    watch.ended = true;
    clearFleet();
  }
  notify();
  return ack;
}

// Khách đổi tuyến / tìm điểm đến mới: rời cả 2 room, gỡ xe
export function clearTripWatch() {
  const socket = getFleetSocket();
  if (socket) {   // socket.io giữ hàng đợi khi mất kết nối nên thứ tự với watch/subscribe trước đó được giữ
    if (state.watchedScheduleId) socket.emit("trip:unwatch");
    if (watch.subscription) socket.emit("trips:unsubscribe");
  }
  resetTripWatch();
  clearFleet();
}

// Socket mới (đổi vai trò) không còn room nào → chỉ xóa trạng thái
export function resetTripWatch() {
  watch.seq++;
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
  // Chuyến đã báo kết thúc nhưng nay chạy lại (thiết bị nối lại) → bỏ trạng thái kết thúc
  if (watch.ended && data.trips.some(t => t.schedule_id === state.watchedScheduleId && t.status === "RUNNING")) {
    watch.ended = false;
  }
  notify();
});

// Gói vị trí đầu tiên của chuyến đang xem sau khi báo kết thúc → chuyến đã chạy lại
onFleetEvent("location", ({ schedule_id }) => {
  if (!watch.ended || schedule_id !== state.watchedScheduleId) return;
  watch.ended = false;
  notify();
});

onFleetEvent("offline", ({ schedule_id }) => {
  if (schedule_id === undefined || schedule_id !== state.watchedScheduleId) return;
  watch.ended = true;
  notify();
});
