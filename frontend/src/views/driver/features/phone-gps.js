import { state } from "../driver.state.js";
import { DRIVER_TOKEN_KEY } from "../../../core/config.js";
import { getToken } from "../../../core/session.js";
import { showToast } from "../../../core/toast.js";
import { geolocationErrorMessage } from "../../../core/geo-error.js";
import { connectDevice, emitWithAck } from "../../../modules/realtime/device.service.js";
import { refreshSourceBadge } from "./drive-map.js";

const MIN_SEND_INTERVAL_MS = 1000;
const gps = { socket: null, watchId: null, wakeLock: null, lastSentAt: 0 };

const START_ERRORS = {
  UNAUTHORIZED: "Phiên đăng nhập hết hạn, hãy đăng nhập lại",
  NO_VEHICLE: "Tài khoản chưa được gán xe",
  SCHEDULE_NOT_ALLOWED: "Lịch trình không thuộc xe của bạn"
};

function renderButton() {
  const btn = document.getElementById("btnTripToggle");
  btn.classList.toggle("btn-danger", state.broadcasting);
  btn.classList.toggle("btn-primary", !state.broadcasting);
  btn.innerHTML = state.broadcasting
    ? '<i class="fa-solid fa-stop"></i> Kết thúc chuyến'
    : '<i class="fa-solid fa-play"></i> Bắt đầu chuyến';
}

const startTrip = socket => emitWithAck(socket, "trip:start", { schedule_id: state.schedule.schedule_id });

function onPosition(pos) {
  const now = Date.now();
  if (!gps.socket?.connected || now - gps.lastSentAt < MIN_SEND_INTERVAL_MS) return;
  gps.lastSentAt = now;
  const { latitude, longitude, speed, heading } = pos.coords;
  // speed (m/s) và heading có thể null/NaN khi xe đứng yên → gửi 0
  gps.socket.emit("gps_ping", {
    latitude,
    longitude,
    speed_kmh: Number.isFinite(speed) ? Math.min(200, Math.max(0, speed * 3.6)) : 0,
    heading: Number.isFinite(heading) ? heading % 360 : 0
  });
}

async function requestWakeLock() {
  try {
    gps.wakeLock = navigator.wakeLock ? await navigator.wakeLock.request("screen") : null;
  } catch {
    gps.wakeLock = null; // Trình duyệt từ chối (pin yếu, không hỗ trợ) → bỏ qua
  }
}

async function releaseWakeLock() {
  try { await gps.wakeLock?.release(); } catch { /* đã nhả */ }
  gps.wakeLock = null;
}

// Màn hình tắt/ẩn tab làm mất wake lock → xin lại khi quay về
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && state.broadcasting && (!gps.wakeLock || gps.wakeLock.released)) {
    requestWakeLock();
  }
});

async function startBroadcast() {
  if (!window.isSecureContext || !navigator.geolocation) {
    showToast("Cần HTTPS hoặc localhost để dùng GPS điện thoại", "error");
    return;
  }
  try {
    gps.socket = await connectDevice(getToken(DRIVER_TOKEN_KEY), {
      onReconnect: socket => startTrip(socket).catch(() => {}),
      onReplaced: () => {
        document.getElementById("replacedBanner").hidden = false;
        stopBroadcast({ endTrip: false });
      }
    });
    const ack = await startTrip(gps.socket);
    if (!ack.ok) throw new Error(ack.error);

    state.broadcasting = true;
    document.getElementById("replacedBanner").hidden = true;
    gps.watchId = navigator.geolocation.watchPosition(
      onPosition,
      err => showToast(geolocationErrorMessage(err), "warning"),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 }
    );
    await requestWakeLock();
    renderButton();
    refreshSourceBadge();
    showToast("Đã bắt đầu chuyến, đang phát vị trí", "success");
  } catch (err) {
    await stopBroadcast({ endTrip: false });
    showToast(START_ERRORS[err?.message] || "Không bắt đầu được chuyến, kiểm tra kết nối", "error");
  }
}

// endTrip: gửi trip:end để bản đồ gỡ xe; false khi phiên đã bị thay hoặc chưa bắt đầu được
export async function stopBroadcast({ endTrip = true } = {}) {
  if (gps.watchId != null) {
    navigator.geolocation.clearWatch(gps.watchId);
    gps.watchId = null;
  }
  const socket = gps.socket;
  gps.socket = null;
  if (socket) {
    if (endTrip && state.broadcasting && socket.connected) await emitWithAck(socket, "trip:end", {}).catch(() => {});
    socket.disconnect();
  }
  state.broadcasting = false;
  await releaseWakeLock();
  renderButton();
  refreshSourceBadge();
}

export async function toggleTrip() {
  const btn = document.getElementById("btnTripToggle");
  btn.disabled = true;
  try {
    if (state.broadcasting) await stopBroadcast();
    else await startBroadcast();
  } finally {
    btn.disabled = false;
  }
}
