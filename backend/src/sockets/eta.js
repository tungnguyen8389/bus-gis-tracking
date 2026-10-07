// --------------------------------------------------------------------
// ETA TỚI TRẠM LÊN: cửa sổ công khai, vận tốc thực tế của xe, trạng thái chuyến.
// Hàm thuần — registry/DB do trip-list.js đưa vào.
// --------------------------------------------------------------------
const { project } = require("./route-geometry");

const VN_OFFSET_S = 7 * 3600;           // Asia/Ho_Chi_Minh, không có giờ mùa hè
const DAY_S = 86400;
const PAST_GRACE_S = 15 * 60;           // chuyến trễ vẫn hiện thêm 15 phút
const UPCOMING_WINDOW_S = 2 * 3600;
const MIN_WINDOW_MS = 2 * 60 * 1000;
const MIN_SPEED_KMH = 5;
const MAX_SPEED_KMH = 60;
const DEFAULT_SPEED_KMH = 20;
const LOOP_RESET_M = 200;               // progress tụt quá ngưỡng = xe quay về đầu tuyến (không phải nhiễu GPS)
const PASSED_TOLERANCE_M = 30;

const vnSecondsOfDay = nowMs => (((Math.floor(nowMs / 1000) + VN_OFFSET_S) % DAY_S) + DAY_S) % DAY_S;
const vnMidnightMs = nowMs => (Math.floor(nowMs / 1000) - vnSecondsOfDay(nowMs)) * 1000;

function isPublicTrip(depSec, nowMs, running) {
  if (running) return true;
  const nowSec = vnSecondsOfDay(nowMs);
  return depSec >= nowSec - PAST_GRACE_S && depSec <= nowSec + UPCOMING_WINDOW_S;
}

const clampSpeed = v => Math.min(MAX_SPEED_KMH, Math.max(MIN_SPEED_KMH, v));

// Vận tốc của chuyến đang chạy: quãng đường dọc tuyến trong cửa sổ mẫu (đã gồm dừng trạm, kẹt xe).
// Chưa đủ dữ liệu → trung bình speed_kmh của các gói; không có gì → mặc định.
function vehicleSpeedKmh(trip, line) {
  const pts = [...trip.samples];
  const last = trip.last_position;
  if (last && (pts.length === 0 || last.t > pts[pts.length - 1].t)) pts.push(last);

  let prog = line ? pts.map(p => ({ t: p.t, m: project(line, [p.longitude, p.latitude]) })) : [];
  for (let i = prog.length - 1; i > 0; i--) {
    if (prog[i].m < prog[i - 1].m - LOOP_RESET_M) {
      prog = prog.slice(i);
      break;
    }
  }

  if (prog.length >= 2) {
    const first = prog[0];
    const newest = prog[prog.length - 1];
    if (newest.t - first.t >= MIN_WINDOW_MS) {
      return clampSpeed((Math.max(0, newest.m - first.m) / ((newest.t - first.t) / 1000)) * 3.6);
    }
  }
  if (trip.speed_count > 0) return clampSpeed(trip.speed_sum / trip.speed_count);
  return DEFAULT_SPEED_KMH;
}

const averageSpeedKmh = speeds =>
  speeds.length === 0 ? DEFAULT_SPEED_KMH : speeds.reduce((a, b) => a + b, 0) / speeds.length;

// boardM: vị trí trạm lên dọc tuyến (undefined → không tính ETA); vehicleM: vị trí xe đang chạy
function tripEta({ running, depSec, nowMs, boardM, vehicleM, speedKmh }) {
  const status = running ? "RUNNING" : "UPCOMING";
  if (!Number.isFinite(boardM)) return { status, etaMs: null };
  const mps = speedKmh / 3.6;
  if (running) {
    if (vehicleM > boardM + PASSED_TOLERANCE_M) return { status: "PASSED", etaMs: null };
    return { status, etaMs: nowMs + Math.round((Math.max(0, boardM - vehicleM) / mps) * 1000) };
  }
  // Chuyến trễ chưa xuất bến: sớm nhất là xuất bến ngay bây giờ
  const departMs = Math.max(vnMidnightMs(nowMs) + depSec * 1000, nowMs);
  return { status, etaMs: departMs + Math.round((boardM / mps) * 1000) };
}

module.exports = {
  MIN_WINDOW_MS, MIN_SPEED_KMH, MAX_SPEED_KMH, DEFAULT_SPEED_KMH,
  vnSecondsOfDay, vnMidnightMs, isPublicTrip, vehicleSpeedKmh, averageSpeedKmh, tripEta
};
