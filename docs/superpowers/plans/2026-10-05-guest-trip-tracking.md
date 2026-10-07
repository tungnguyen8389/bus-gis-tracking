# Guest Trip Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Khách chỉ thấy đúng một xe của chuyến mình chọn (sau khi chọn tuyến rồi chọn chuyến), kèm ETA tới trạm lên tính theo vận tốc thực tế, đẩy qua socket; nhân viên vẫn thấy toàn đội xe.

**Architecture:** Thiết bị tài xế (`/device`) không còn phát cho mọi viewer mà phát vào room `trip:<schedule_id>`, `vehicle:<vehicle_id>`, `staff`. Một `trip-registry` trong bộ nhớ giữ các chuyến đang chạy cùng mẫu vị trí. Viewer `/` có handshake theo token (nhân viên → `staff`, tài xế → `vehicle:<id>`, còn lại là khách); khách dùng `trips:subscribe` (danh sách chuyến + ETA, không tọa độ) và `trip:watch` (tọa độ của 1 chuyến). ETA tính bằng các hàm thuần (`route-geometry.js`, `eta.js`) trong `trip-list.js`.

**Tech Stack:** Node.js 18+ (CommonJS, `node:test`), Express, Socket.io 4.7.5 (server + client CDN), mysql2, MySQL spatial; frontend ES modules + ArcGIS JS 4.

**Spec:** `docs/superpowers/specs/2026-10-05-guest-trip-tracking-design.md`

## Global Constraints

- Giờ: `Asia/Ho_Chi_Minh` = UTC+7 cố định (không có giờ mùa hè). Không dùng múi giờ của máy chạy.
- Cửa sổ công khai: chuyến đang chạy, hoặc `departure_time` ∈ `[now − 15 phút, now + 2 giờ]`.
- Vận tốc: cửa sổ mẫu 5 phút, lấy mẫu 15 giây, tối thiểu 2 phút dữ liệu, kẹp `[5, 60]` km/h, mặc định 20 km/h.
- `trips:update` đẩy định kỳ 15 giây và ngay khi registry phát `change`.
- Room tuyến (`route:*`) **không bao giờ** chứa `longitude`/`latitude`.
- Mỗi socket viewer: tối đa 1 room `trip:*` và 1 room `route:*`.
- Comment trong code viết tiếng Việt, ngắn, theo phong cách file xung quanh. Commit message theo Conventional Commits, tiếng Việt, kết thúc bằng dòng `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Unit test backend: `cd backend && npm run test:unit`. Unit test simulator: `cd simulator && npm run test:unit`.
- Khởi động lại backend (khi task cần server thật):
  ```bash
  kill $(lsof -tiTCP:3000 -sTCP:LISTEN) 2>/dev/null; sleep 1
  cd /Users/viktornguyen/Desktop/viktor/bus-gis-tracking/backend && (nohup node server.js > server.log 2>&1 &) && sleep 2 && tail -3 server.log
  ```

**Điều chỉnh so với spec (đã cập nhật vào spec ở Task 6):**
- Trang tài xế không dùng `trip:watch`. Handshake token DRIVER cho socket vào room `vehicle:<vehicle_id>`, device phát thêm vào room này. Tài xế luôn thấy xe mình bất kể đang chạy chuyến nào (simulator có thể đang chạy chuyến khác chuyến đang chọn trên trang), và bỏ được ngoại lệ "tài xế watch ngoài cửa sổ".
- `trip:start` không cần `departure_time` (registry không dùng).
- Timer đẩy 15 giây luôn chạy nhưng không làm gì khi không có room tuyến nào.
- Hình học tách thành `route-geometry.js`; truy vấn DB + ghép ETA ở `trip-list.js`.

## Review Focus

1. **Trạm lên của khách không nằm trên tuyến/chiều đó** (dữ liệu `route_stops` lệch kết quả tìm tuyến) → danh sách vẫn trả về, ETA `null`, không crash. Test ở Task 4.
2. **Tuyến không có `route_paths`** → danh sách vẫn trả về, không ETA. Test ở Task 4.
3. **Payload rác từ client** (`trip:watch "abc"`, `{schedule_id: -1}`, `trips:subscribe {direction: 3}`, không có hàm ack) → trả lỗi có mã, socket không crash. Test ở Task 6.
4. **Lỗi DB khi đẩy `trips:update` theo timer/sự kiện** → log lỗi, không unhandled rejection, server chạy tiếp. Test ở Task 6.
5. **`trip:start` đang chờ DB thì phiên bị thay** → phiên cũ không được ghi đè `liveTrips`/registry. Test ở Task 5.

---

## File Structure

| File | Trách nhiệm |
|---|---|
| `backend/src/sockets/route-geometry.js` (mới) | Thuần: haversine, polyline tích lũy, chiếu điểm, vị trí trạm dọc tuyến |
| `backend/src/sockets/eta.js` (mới) | Thuần: giờ VN, cửa sổ công khai, vận tốc xe/tuyến, trạng thái + ETA |
| `backend/src/sockets/trip-registry.js` (mới) | Chuyến đang chạy trong bộ nhớ, mẫu vị trí, sự kiện `change` |
| `backend/src/sockets/trip-list.js` (mới) | Truy vấn lịch trình + hình học (cache), ghép danh sách chuyến kèm ETA |
| `backend/src/sockets/device.socket.js` | `liveTrips` theo xe, gọi registry, phát theo room |
| `backend/src/sockets/viewer.socket.js` | Broadcaster theo room + handshake + sự kiện watch/subscribe + đẩy `trips:update` |
| `backend/src/sockets/index.js` | Tạo registry/lister, nối 2 namespace |
| `backend/scripts/seed_drivers.js` | 4 tài xế/tuyến, 17 chuyến/tài xế |
| `simulator/src/schedule.js` (mới) | Thuần: chọn chuyến hiện tại / kế tiếp theo giờ VN |
| `simulator/src/virtual-driver.js` | Chọn chuyến theo giờ, tự đổi chuyến |
| `backend/test_suite.js` | Module 4 theo giao thức room |
| `frontend/src/modules/realtime/realtime.service.js` | Gửi token, nghe `trips:update` |
| `frontend/src/views/map/map.state.js` | `isStaff`, `watchedScheduleId` |
| `frontend/src/views/map/features/fleet-tracking.js` | Kết nối lại theo token, hook sự kiện, lọc gói theo chuyến của khách |
| `frontend/src/views/map/features/staff-auth.js` | Kết nối socket theo vai trò |
| `frontend/src/views/map/map.view.js` | Bỏ `initSocketRealtime` |
| `frontend/src/views/map/features/trip-finder/trip-watch.js` (mới) | Trạng thái + socket của khách (subscribe/watch/khôi phục) |
| `frontend/src/views/map/features/trip-finder/trip-finder.js` | Danh sách chuyến dưới thẻ tuyến, bảng theo dõi của khách |
| `frontend/src/views/map/sections/fleet-dashboard.html` | Khối thông tin chuyến của khách |
| `frontend/assets/css/map.css` | Style dòng chuyến, nhãn trạng thái |
| `frontend/src/views/driver/features/drive-map.js` | Gửi token tài xế |
| Tài liệu | `docs/SOCKET_IO_TRACKING.md`, `README.md`, `ARCHITECTURE_SPEC.md`, `docs/USE_CASES.md`, spec |

---

### Task 1: Hình học lộ trình (`route-geometry.js`)

**Files:**
- Create: `backend/src/sockets/route-geometry.js`
- Test: `backend/src/sockets/route-geometry.test.js`

**Interfaces:**
- Produces:
  - `haversineM([lon, lat], [lon, lat]) → number` (mét)
  - `buildLine(coords: [lon, lat][]) → { coords, cum: number[], total: number } | null` (null khi < 2 điểm hợp lệ)
  - `project(line, [lon, lat], fromM = 0) → number` (mét từ đầu tuyến tới hình chiếu, chỉ xét phần ≥ `fromM`)
  - `stopProgress(line, stops: {stop_id, longitude, latitude}[]) → Map<stop_id, number>` (theo thứ tự, lần ghé đầu)

- [ ] **Step 1: Viết test (fail)**

`backend/src/sockets/route-geometry.test.js`:
```js
const test = require("node:test");
const assert = require("node:assert/strict");
const { haversineM, buildLine, project, stopProgress } = require("./route-geometry");

const LAT = 10.8;
const A = [106.70, LAT], B = [106.72, LAT], C = [106.74, LAT];
const near = (actual, expected, tol = 5) =>
  assert.ok(Math.abs(actual - expected) <= tol, `${actual} không gần ${expected} (±${tol})`);

test("buildLine: < 2 điểm hợp lệ → null", () => {
  assert.equal(buildLine([]), null);
  assert.equal(buildLine([A]), null);
  assert.equal(buildLine([A, [NaN, 1]]), null);
});

test("buildLine: quãng đường tích lũy theo haversine", () => {
  const line = buildLine([A, B, C]);
  near(line.cum[1], haversineM(A, B), 0.001);
  near(line.total, haversineM(A, B) + haversineM(B, C), 0.001);
});

test("project: điểm lệch khỏi đường chiếu về giữa đoạn", () => {
  const line = buildLine([A, C]);
  near(project(line, [106.71, LAT + 0.001]), haversineM(A, [106.71, LAT]));
});

test("project: điểm trước đầu tuyến → 0, sau cuối tuyến → total", () => {
  const line = buildLine([A, C]);
  near(project(line, [106.69, LAT]), 0);
  near(project(line, [106.75, LAT]), line.total);
});

test("project với fromM: chỉ tìm từ fromM trở đi (tuyến vòng đi rồi về)", () => {
  const line = buildLine([A, C, A]);
  near(project(line, A), 0);
  near(project(line, A, line.total / 2), line.total);
  // fromM nằm giữa đoạn: hình chiếu không lùi về trước fromM
  near(project(line, A, 1000), line.total);
});

test("stopProgress: tuyến vòng ghé A hai lần → giữ lần đầu, trạm sau tìm tiếp về phía trước", () => {
  const line = buildLine([A, C, A]);
  const stops = [
    { stop_id: "A", longitude: A[0], latitude: A[1] },
    { stop_id: "B", longitude: B[0], latitude: B[1] },
    { stop_id: "C", longitude: C[0], latitude: C[1] },
    { stop_id: "B2", longitude: B[0], latitude: B[1] },
    { stop_id: "A", longitude: A[0], latitude: A[1] }
  ];
  const m = stopProgress(line, stops);
  near(m.get("A"), 0);
  near(m.get("B"), haversineM(A, B));
  near(m.get("C"), line.total / 2);
  near(m.get("B2"), line.total / 2 + haversineM(C, B));
});
```

- [ ] **Step 2: Chạy test, xác nhận fail**

Run: `cd backend && node --test src/sockets/route-geometry.test.js`
Expected: FAIL — `Cannot find module './route-geometry'`

- [ ] **Step 3: Viết code**

`backend/src/sockets/route-geometry.js`:
```js
// --------------------------------------------------------------------
// HÌNH HỌC LỘ TRÌNH: quãng đường (mét) dọc polyline, dùng để tính ETA.
// Hàm thuần, không đụng DB. Tọa độ dạng [longitude, latitude].
// --------------------------------------------------------------------
const EARTH_R = 6371000;
const M_PER_DEG_LAT = 110540;
const M_PER_DEG_LON_EQUATOR = 111320;
const toRad = d => (d * Math.PI) / 180;

function haversineM([lon1, lat1], [lon2, lat2]) {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.sqrt(a));
}

// cum[i] = quãng đường từ đầu tuyến tới điểm i; < 2 điểm hợp lệ → null
function buildLine(coords) {
  const pts = (coords || []).filter(c => Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1]));
  if (pts.length < 2) return null;
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + haversineM(pts[i - 1], pts[i]));
  return { coords: pts, cum, total: cum[cum.length - 1] };
}

// Chiếu điểm lên polyline (xấp xỉ phẳng cục bộ), chỉ xét phần từ fromM trở đi.
// Trả về quãng đường từ đầu tuyến tới hình chiếu gần nhất.
function project(line, [lon, lat], fromM = 0) {
  const kx = Math.cos(toRad(lat)) * M_PER_DEG_LON_EQUATOR;
  const ky = M_PER_DEG_LAT;
  let bestD2 = Infinity;
  let bestM = Math.min(fromM, line.total);

  for (let i = 0; i < line.coords.length - 1; i++) {
    const segStart = line.cum[i];
    const segLen = line.cum[i + 1] - segStart;
    if (line.cum[i + 1] < fromM) continue;

    const [ax, ay] = line.coords[i];
    const [bx, by] = line.coords[i + 1];
    const abx = (bx - ax) * kx, aby = (by - ay) * ky;
    const apx = (lon - ax) * kx, apy = (lat - ay) * ky;
    const len2 = abx * abx + aby * aby;
    const tMin = segLen > 0 ? Math.max(0, (fromM - segStart) / segLen) : 0;
    const tRaw = len2 > 0 ? (apx * abx + apy * aby) / len2 : 0;
    const t = Math.min(1, Math.max(tMin, tRaw));

    const dx = apx - t * abx, dy = apy - t * aby;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD2) {
      bestD2 = d2;
      bestM = segStart + t * segLen;
    }
  }
  return bestM;
}

// Vị trí các trạm dọc tuyến: duyệt theo stop_order, mỗi trạm chỉ tìm từ trạm trước trở đi
// (tuyến vòng ghé một trạm hai lần vẫn đúng); một trạm ghé nhiều lần giữ lần đầu.
function stopProgress(line, stops) {
  const result = new Map();
  let from = 0;
  for (const st of stops) {
    const m = project(line, [Number(st.longitude), Number(st.latitude)], from);
    if (!result.has(st.stop_id)) result.set(st.stop_id, m);
    from = m;
  }
  return result;
}

module.exports = { haversineM, buildLine, project, stopProgress };
```

- [ ] **Step 4: Chạy test, xác nhận pass**

Run: `cd backend && node --test src/sockets/route-geometry.test.js`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/sockets/route-geometry.js backend/src/sockets/route-geometry.test.js
git commit -m "feat(eta): hình học lộ trình — chiếu điểm và vị trí trạm dọc tuyến

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Hàm ETA thuần (`eta.js`)

**Files:**
- Create: `backend/src/sockets/eta.js`
- Test: `backend/src/sockets/eta.test.js`

**Interfaces:**
- Consumes: `project(line, [lon, lat], fromM)` từ Task 1.
- Produces:
  - Hằng số: `MIN_WINDOW_MS`, `MIN_SPEED_KMH`, `MAX_SPEED_KMH`, `DEFAULT_SPEED_KMH`
  - `vnSecondsOfDay(nowMs) → number` (0..86399)
  - `vnMidnightMs(nowMs) → number` (epoch ms của 00:00 hôm nay giờ VN)
  - `isPublicTrip(depSec, nowMs, running) → boolean`
  - `vehicleSpeedKmh(trip, line | null) → number` — `trip` có `samples: {t, longitude, latitude}[]`, `last_position: {t, longitude, latitude} | null`, `speed_sum`, `speed_count`
  - `averageSpeedKmh(speeds: number[]) → number`
  - `tripEta({ running, depSec, nowMs, boardM, vehicleM, speedKmh }) → { status: "RUNNING"|"UPCOMING"|"PASSED", etaMs: number|null }`

- [ ] **Step 1: Viết test (fail)**

`backend/src/sockets/eta.test.js`:
```js
const test = require("node:test");
const assert = require("node:assert/strict");
const { buildLine, haversineM } = require("./route-geometry");
const {
  vnSecondsOfDay, vnMidnightMs, isPublicTrip, vehicleSpeedKmh, averageSpeedKmh, tripEta,
  MIN_SPEED_KMH, MAX_SPEED_KMH, DEFAULT_SPEED_KMH
} = require("./eta");

const VN_10H = Date.UTC(2026, 9, 5, 3, 0, 0);   // 10:00 giờ VN
const H = 3600;
const LAT = 10.8;
const line = buildLine([[106.70, LAT], [106.74, LAT]]);
const at = (lon, t) => ({ t, longitude: lon, latitude: LAT });
const trip = (samples, extra = {}) => ({ samples, last_position: null, speed_sum: 0, speed_count: 0, ...extra });

test("giờ VN: 03:00 UTC = 10:00, nửa đêm VN đúng", () => {
  assert.equal(vnSecondsOfDay(VN_10H), 10 * H);
  assert.equal(vnMidnightMs(VN_10H), VN_10H - 10 * H * 1000);
  assert.equal(vnSecondsOfDay(Date.UTC(2026, 9, 5, 17, 30, 0)), 30 * 60);   // 00:30 VN hôm sau
});

test("isPublicTrip: biên −15 phút / +2 giờ; đang chạy luôn công khai", () => {
  assert.equal(isPublicTrip(10 * H - 15 * 60, VN_10H, false), true);
  assert.equal(isPublicTrip(10 * H - 15 * 60 - 1, VN_10H, false), false);
  assert.equal(isPublicTrip(12 * H, VN_10H, false), true);
  assert.equal(isPublicTrip(12 * H + 1, VN_10H, false), false);
  assert.equal(isPublicTrip(5 * H, VN_10H, true), true);
});

test("vehicleSpeedKmh: quãng đường dọc tuyến trong cửa sổ mẫu", () => {
  // 0.01° kinh độ ≈ 1093 m trong 180 s ≈ 21.9 km/h
  const v = vehicleSpeedKmh(trip([at(106.70, 0), at(106.705, 90_000), at(106.71, 180_000)]), line);
  const expected = haversineM([106.70, LAT], [106.71, LAT]) / 180 * 3.6;
  assert.ok(Math.abs(v - expected) < 0.5, `${v} ≠ ${expected}`);
});

test("vehicleSpeedKmh: last_position mới hơn mẫu cuối được tính là điểm mới nhất", () => {
  const v = vehicleSpeedKmh(trip([at(106.70, 0)], { last_position: at(106.71, 180_000) }), line);
  assert.ok(v > 20 && v < 23);
});

test("vehicleSpeedKmh: chưa đủ 2 phút → trung bình speed_kmh; không có gì → mặc định", () => {
  assert.equal(vehicleSpeedKmh(trip([at(106.70, 0), at(106.71, 60_000)], { speed_sum: 70, speed_count: 2 }), line), 35);
  assert.equal(vehicleSpeedKmh(trip([at(106.70, 0)]), line), DEFAULT_SPEED_KMH);
  assert.equal(vehicleSpeedKmh(trip([], { speed_sum: 50, speed_count: 2 }), null), 25);
});

test("vehicleSpeedKmh: kẹp trong [5, 60]", () => {
  assert.equal(vehicleSpeedKmh(trip([at(106.70, 0), at(106.70, 300_000)]), line), MIN_SPEED_KMH);
  assert.equal(vehicleSpeedKmh(trip([at(106.70, 0), at(106.74, 120_000)]), line), MAX_SPEED_KMH);
});

test("vehicleSpeedKmh: xe quay về đầu tuyến → chỉ dùng mẫu sau điểm tụt", () => {
  // Xe tới cuối tuyến (106.74) rồi xuất hiện lại ở đầu tuyến (106.70)
  const samples = [at(106.73, 0), at(106.74, 60_000), at(106.70, 120_000), at(106.705, 180_000), at(106.71, 300_000)];
  const v = vehicleSpeedKmh(trip(samples), line);
  // sau điểm tụt: 106.70 → 106.71 trong 180 s
  const expected = haversineM([106.70, LAT], [106.71, LAT]) / 180 * 3.6;
  assert.ok(Math.abs(v - expected) < 0.5, `${v} ≠ ${expected}`);
});

test("vehicleSpeedKmh: sau điểm tụt chưa đủ 2 phút → dự phòng speed_kmh", () => {
  const samples = [at(106.73, 0), at(106.74, 120_000), at(106.70, 180_000), at(106.705, 240_000)];
  assert.equal(vehicleSpeedKmh(trip(samples, { speed_sum: 30, speed_count: 1 }), line), 30);
});

test("averageSpeedKmh: trung bình, rỗng → mặc định", () => {
  assert.equal(averageSpeedKmh([20, 30]), 25);
  assert.equal(averageSpeedKmh([]), DEFAULT_SPEED_KMH);
});

test("tripEta: đang chạy chưa tới trạm → now + còn lại / v", () => {
  const r = tripEta({ running: true, depSec: 9 * H, nowMs: VN_10H, boardM: 2000, vehicleM: 1000, speedKmh: 36 });
  assert.deepEqual(r, { status: "RUNNING", etaMs: VN_10H + 100_000 });
});

test("tripEta: đang chạy đã qua trạm quá 30 m → PASSED", () => {
  assert.deepEqual(
    tripEta({ running: true, depSec: 9 * H, nowMs: VN_10H, boardM: 1000, vehicleM: 1031, speedKmh: 20 }),
    { status: "PASSED", etaMs: null }
  );
  assert.equal(tripEta({ running: true, depSec: 9 * H, nowMs: VN_10H, boardM: 1000, vehicleM: 1020, speedKmh: 36 }).etaMs, VN_10H);
});

test("tripEta: sắp tới → giờ xuất bến + quãng tới trạm / v", () => {
  const r = tripEta({ running: false, depSec: 10 * H + 15 * 60, nowMs: VN_10H, boardM: 3600, vehicleM: 0, speedKmh: 36 });
  assert.deepEqual(r, { status: "UPCOMING", etaMs: VN_10H + 15 * 60 * 1000 + 360_000 });
});

test("tripEta: chuyến trễ chưa xuất bến → tính như xuất bến ngay bây giờ", () => {
  const r = tripEta({ running: false, depSec: 9 * H + 50 * 60, nowMs: VN_10H, boardM: 3600, vehicleM: 0, speedKmh: 36 });
  assert.deepEqual(r, { status: "UPCOMING", etaMs: VN_10H + 360_000 });
});

test("tripEta: không có trạm lên → không ETA, giữ trạng thái", () => {
  assert.deepEqual(tripEta({ running: true, depSec: 0, nowMs: VN_10H, boardM: undefined, vehicleM: 5000, speedKmh: 20 }), { status: "RUNNING", etaMs: null });
  assert.deepEqual(tripEta({ running: false, depSec: 0, nowMs: VN_10H, boardM: undefined, vehicleM: 0, speedKmh: 20 }), { status: "UPCOMING", etaMs: null });
});
```

- [ ] **Step 2: Chạy test, xác nhận fail**

Run: `cd backend && node --test src/sockets/eta.test.js`
Expected: FAIL — `Cannot find module './eta'`

- [ ] **Step 3: Viết code**

`backend/src/sockets/eta.js`:
```js
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
```

- [ ] **Step 4: Chạy test, xác nhận pass**

Run: `cd backend && node --test src/sockets/eta.test.js`
Expected: PASS (14 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/sockets/eta.js backend/src/sockets/eta.test.js
git commit -m "feat(eta): cửa sổ công khai, vận tốc thực tế và ETA tới trạm lên

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Registry chuyến đang chạy (`trip-registry.js`)

**Files:**
- Create: `backend/src/sockets/trip-registry.js`
- Test: `backend/src/sockets/trip-registry.test.js`

**Interfaces:**
- Produces: `createTripRegistry({ now = Date.now }) → registry` với:
  - `start({ schedule_id, vehicle_id, route_id, direction })` — idempotent; phát `change` khi thêm mới
  - `end(scheduleId)` — phát `change` nếu có
  - `recordPing(scheduleId, { longitude, latitude, speed_kmh })`
  - `get(scheduleId) → trip | undefined`; `has(scheduleId) → boolean`
  - `listByRoute(routeId, direction?) → trip[]`
  - `on("change", fn({ route_id, direction }))`
  - `trip` = `{ schedule_id, vehicle_id, route_id, direction, started_at, last_position: {t, longitude, latitude} | null, samples: {t, longitude, latitude}[], speed_sum, speed_count }`
- Hằng số: `SAMPLE_INTERVAL_MS = 15000`, `SAMPLE_WINDOW_MS = 300000`.

- [ ] **Step 1: Viết test (fail)**

`backend/src/sockets/trip-registry.test.js`:
```js
const test = require("node:test");
const assert = require("node:assert/strict");
const { createTripRegistry } = require("./trip-registry");

const TRIP = { schedule_id: 11, vehicle_id: "DRV_01", route_id: "R1", direction: 1 };
const setup = () => {
  const clock = { t: 1_000_000 };
  const registry = createTripRegistry({ now: () => clock.t });
  const changes = [];
  registry.on("change", c => changes.push(c));
  return { clock, registry, changes };
};
const ping = (lon, speed = 30) => ({ longitude: lon, latitude: 10.8, speed_kmh: speed });

test("start/end phát change; start lại cùng chuyến không phát, không reset", () => {
  const { registry, changes } = setup();
  registry.start(TRIP);
  registry.recordPing(11, ping(106.7));
  const before = registry.get(11);
  registry.start(TRIP);
  assert.equal(registry.get(11), before);
  assert.deepEqual(changes, [{ route_id: "R1", direction: 1 }]);
  registry.end(11);
  registry.end(11);
  assert.equal(registry.has(11), false);
  assert.equal(changes.length, 2);
});

test("recordPing: last_position luôn cập nhật, mẫu mỗi 15 s, giữ cửa sổ 5 phút", () => {
  const { clock, registry } = setup();
  registry.start(TRIP);
  registry.recordPing(11, ping(106.70));
  clock.t += 10_000;
  registry.recordPing(11, ping(106.71));
  assert.equal(registry.get(11).samples.length, 1);
  assert.equal(registry.get(11).last_position.longitude, 106.71);
  clock.t += 5_000;
  registry.recordPing(11, ping(106.72));
  assert.equal(registry.get(11).samples.length, 2);

  for (let i = 0; i < 30; i++) { clock.t += 15_000; registry.recordPing(11, ping(106.72)); }
  const { samples } = registry.get(11);
  assert.ok(clock.t - samples[0].t <= 300_000);
  assert.equal(samples[samples.length - 1].t, clock.t);
});

test("recordPing: chỉ cộng speed_kmh > 0; chuyến không tồn tại bị bỏ qua", () => {
  const { registry } = setup();
  registry.recordPing(99, ping(106.7));
  registry.start(TRIP);
  registry.recordPing(11, ping(106.7, 0));
  registry.recordPing(11, ping(106.7, 40));
  assert.equal(registry.get(11).speed_sum, 40);
  assert.equal(registry.get(11).speed_count, 1);
});

test("listByRoute: lọc theo tuyến, chiều tùy chọn", () => {
  const { registry } = setup();
  registry.start(TRIP);
  registry.start({ ...TRIP, schedule_id: 12, vehicle_id: "DRV_02", direction: 2 });
  registry.start({ ...TRIP, schedule_id: 13, vehicle_id: "DRV_03", route_id: "R2" });
  assert.deepEqual(registry.listByRoute("R1").map(t => t.schedule_id), [11, 12]);
  assert.deepEqual(registry.listByRoute("R1", 2).map(t => t.schedule_id), [12]);
});
```

- [ ] **Step 2: Chạy test, xác nhận fail**

Run: `cd backend && node --test src/sockets/trip-registry.test.js`
Expected: FAIL — `Cannot find module './trip-registry'`

- [ ] **Step 3: Viết code**

`backend/src/sockets/trip-registry.js`:
```js
// --------------------------------------------------------------------
// REGISTRY CHUYẾN ĐANG CHẠY (bộ nhớ, 1 process): schedule_id → xe, vị trí cuối, mẫu vận tốc.
// Không chiếu tọa độ lên lộ trình ở đây — việc đó để lúc tính ETA cho vòng GPS luôn nhẹ.
// --------------------------------------------------------------------
const { EventEmitter } = require("node:events");

const SAMPLE_INTERVAL_MS = 15000;
const SAMPLE_WINDOW_MS = 5 * 60 * 1000;

function createTripRegistry({ now = Date.now } = {}) {
  const trips = new Map();
  const events = new EventEmitter();
  const changed = trip => events.emit("change", { route_id: trip.route_id, direction: trip.direction });

  return {
    start({ schedule_id, vehicle_id, route_id, direction }) {
      if (trips.has(schedule_id)) return;
      const trip = {
        schedule_id, vehicle_id, route_id, direction,
        started_at: now(), last_position: null, samples: [], speed_sum: 0, speed_count: 0
      };
      trips.set(schedule_id, trip);
      changed(trip);
    },

    end(scheduleId) {
      const trip = trips.get(scheduleId);
      if (!trip) return;
      trips.delete(scheduleId);
      changed(trip);
    },

    recordPing(scheduleId, { longitude, latitude, speed_kmh }) {
      const trip = trips.get(scheduleId);
      if (!trip) return;
      const t = now();
      trip.last_position = { t, longitude, latitude };
      if (speed_kmh > 0) {
        trip.speed_sum += speed_kmh;
        trip.speed_count += 1;
      }
      const lastSample = trip.samples[trip.samples.length - 1];
      if (!lastSample || t - lastSample.t >= SAMPLE_INTERVAL_MS) trip.samples.push({ t, longitude, latitude });
      while (trip.samples.length > 0 && t - trip.samples[0].t > SAMPLE_WINDOW_MS) trip.samples.shift();
    },

    get: scheduleId => trips.get(scheduleId),
    has: scheduleId => trips.has(scheduleId),
    listByRoute: (routeId, direction) =>
      [...trips.values()].filter(t => t.route_id === routeId && (direction === undefined || t.direction === direction)),
    on: (event, fn) => events.on(event, fn)
  };
}

module.exports = { createTripRegistry, SAMPLE_INTERVAL_MS, SAMPLE_WINDOW_MS };
```

- [ ] **Step 4: Chạy test, xác nhận pass**

Run: `cd backend && node --test src/sockets/trip-registry.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/sockets/trip-registry.js backend/src/sockets/trip-registry.test.js
git commit -m "feat(realtime): registry chuyến đang chạy kèm mẫu vận tốc

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Danh sách chuyến kèm ETA (`trip-list.js`)

**Files:**
- Create: `backend/src/sockets/trip-list.js`
- Test: `backend/src/sockets/trip-list.test.js`

**Interfaces:**
- Consumes: Task 1 (`buildLine`, `stopProgress`, `project`), Task 2 (`isPublicTrip`, `vnMidnightMs`, `vehicleSpeedKmh`, `averageSpeedKmh`, `tripEta`), Task 3 (registry `has/get/listByRoute`).
- Produces: `createTripLister({ db, registry, now = Date.now }) → { list({ route_id: string, direction: 1|2, board_stop_id: string|null }) → Promise<Trip[]> }`
  - `Trip = { schedule_id, departure_time: "HH:MM", plate_number, driver_name, status: "RUNNING"|"UPCOMING"|"PASSED", eta_board: ISO string|null, minutes_to_board: number|null }`
  - Thứ tự: chuyến chưa PASSED theo ETA (không ETA → theo giờ xuất bến), PASSED cuối.
  - Hình học cache theo `route_id|direction`; lỗi nạp thì xóa cache để lần sau thử lại.

- [ ] **Step 1: Viết test (fail)**

`backend/src/sockets/trip-list.test.js`:
```js
const test = require("node:test");
const assert = require("node:assert/strict");
const { createTripRegistry } = require("./trip-registry");
const { createTripLister } = require("./trip-list");

const VN_10H = Date.UTC(2026, 9, 5, 3, 0, 0);   // 10:00 giờ VN
const LAT = 10.8;
const hms = s => `${String(Math.floor(s / 3600)).padStart(2, "0")}:${String(Math.floor(s / 60) % 60).padStart(2, "0")}`;

// R1 chiều 1: đường thẳng 106.70 → 106.74, trạm S1/S2/S3; R2 không có lộ trình
const SCHEDULES = [
  { schedule_id: 101, route_id: "R1", direction: 1, dep_sec: 9.5 * 3600, plate_number: "51B-1", driver_name: "TX 1" },
  { schedule_id: 102, route_id: "R1", direction: 1, dep_sec: 10.25 * 3600, plate_number: "51B-2", driver_name: "TX 2" },
  { schedule_id: 103, route_id: "R1", direction: 1, dep_sec: 13 * 3600, plate_number: "51B-3", driver_name: "TX 3" },
  { schedule_id: 104, route_id: "R1", direction: 1, dep_sec: 9 * 3600 + 40 * 60, plate_number: "51B-4", driver_name: "TX 4" },
  { schedule_id: 105, route_id: "R1", direction: 1, dep_sec: 9 * 3600 + 50 * 60, plate_number: "51B-5", driver_name: "TX 5" },
  { schedule_id: 201, route_id: "R2", direction: 1, dep_sec: 10.5 * 3600, plate_number: "51B-6", driver_name: "TX 6" }
];
const PATHS = { "R1|1": { type: "LineString", coordinates: [[106.70, LAT], [106.74, LAT]] } };
const STOPS = {
  "R1|1": [
    { stop_id: "S1", longitude: 106.70, latitude: LAT },
    { stop_id: "S2", longitude: 106.72, latitude: LAT },
    { stop_id: "S3", longitude: 106.74, latitude: LAT }
  ]
};

function makeDb() {
  const calls = { paths: 0 };
  const db = {
    async query(sql, [routeId, direction]) {
      const key = `${routeId}|${direction}`;
      if (sql.includes("FROM route_paths")) {
        calls.paths++;
        return [PATHS[key] ? [{ geom_json: JSON.stringify(PATHS[key]) }] : []];
      }
      if (sql.includes("FROM route_stops")) return [STOPS[key] || []];
      if (sql.includes("FROM schedules")) {
        return [SCHEDULES
          .filter(s => s.route_id === routeId && s.direction === direction)
          .map(s => ({ ...s, departure_time: hms(s.dep_sec) }))];
      }
      throw new Error(`SQL không mong đợi: ${sql}`);
    }
  };
  return { db, calls };
}

function setup() {
  const clock = { t: VN_10H };
  const registry = createTripRegistry({ now: () => clock.t });
  const { db, calls } = makeDb();
  const lister = createTripLister({ db, registry, now: () => clock.t });
  // Chuyến 101 đang chạy, xe ở 106.71 (≈ giữa S1 và S2), trung bình speed_kmh = 30
  registry.start({ schedule_id: 101, vehicle_id: "V1", route_id: "R1", direction: 1 });
  registry.recordPing(101, { longitude: 106.71, latitude: LAT, speed_kmh: 30 });
  return { clock, registry, lister, calls };
}

test("chỉ gồm chuyến công khai; sắp xếp theo ETA; ETA theo vận tốc xe và vận tốc tuyến", async () => {
  const { lister } = setup();
  const trips = await lister.list({ route_id: "R1", direction: 1, board_stop_id: "S2" });
  assert.deepEqual(trips.map(t => [t.schedule_id, t.status]), [[101, "RUNNING"], [105, "UPCOMING"], [102, "UPCOMING"]]);
  // 101: còn ≈ 1093 m ở 30 km/h ≈ 131 s → 2 phút
  assert.equal(trips[0].minutes_to_board, 2);
  // 102: xuất bến 10:15 + ≈ 2187 m ở 30 km/h (trung bình xe đang chạy của tuyến) ≈ 262 s → 19 phút
  assert.equal(trips[2].minutes_to_board, 19);
  assert.equal(trips[2].departure_time, "10:15");
  assert.equal(trips[2].plate_number, "51B-2");
  assert.equal(trips[2].driver_name, "TX 2");
  assert.match(trips[2].eta_board, /^\d{4}-\d{2}-\d{2}T/);
  assert.ok(trips.every(t => !("longitude" in t) && !("latitude" in t)));
});

test("chuyến đã qua trạm lên → PASSED, không ETA, xếp cuối", async () => {
  const { lister } = setup();
  const trips = await lister.list({ route_id: "R1", direction: 1, board_stop_id: "S1" });
  const last = trips[trips.length - 1];
  assert.equal(last.schedule_id, 101);
  assert.equal(last.status, "PASSED");
  assert.equal(last.eta_board, null);
  assert.equal(last.minutes_to_board, null);
});

test("không có trạm lên → không ETA, theo giờ xuất bến", async () => {
  const { lister } = setup();
  const trips = await lister.list({ route_id: "R1", direction: 1, board_stop_id: null });
  assert.deepEqual(trips.map(t => t.schedule_id), [101, 105, 102]);
  assert.ok(trips.every(t => t.eta_board === null && t.minutes_to_board === null));
});

test("Review focus: trạm lên không thuộc tuyến/chiều → vẫn trả danh sách, không ETA", async () => {
  const { lister } = setup();
  const trips = await lister.list({ route_id: "R1", direction: 1, board_stop_id: "KHONG_CO" });
  assert.equal(trips.length, 3);
  assert.ok(trips.every(t => t.eta_board === null && t.status !== "PASSED"));
});

test("Review focus: tuyến không có lộ trình → vẫn trả danh sách, không ETA", async () => {
  const { lister } = setup();
  const trips = await lister.list({ route_id: "R2", direction: 1, board_stop_id: "S2" });
  assert.deepEqual(trips.map(t => [t.schedule_id, t.status, t.eta_board]), [[201, "UPCOMING", null]]);
});

test("hình học được cache theo tuyến/chiều", async () => {
  const { lister, calls } = setup();
  await lister.list({ route_id: "R1", direction: 1, board_stop_id: "S2" });
  await lister.list({ route_id: "R1", direction: 1, board_stop_id: "S3" });
  assert.equal(calls.paths, 1);
});

test("không chuyến nào trong cửa sổ → [] và không nạp hình học", async () => {
  const { lister, clock, registry, calls } = setup();
  registry.end(101);
  clock.t = Date.UTC(2026, 9, 5, 15, 0, 0);   // 22:00 VN
  assert.deepEqual(await lister.list({ route_id: "R1", direction: 1, board_stop_id: "S2" }), []);
  assert.equal(calls.paths, 0);
});
```

- [ ] **Step 2: Chạy test, xác nhận fail**

Run: `cd backend && node --test src/sockets/trip-list.test.js`
Expected: FAIL — `Cannot find module './trip-list'`

- [ ] **Step 3: Viết code**

`backend/src/sockets/trip-list.js`:
```js
// --------------------------------------------------------------------
// DANH SÁCH CHUYẾN CHO KHÁCH: chuyến đang chạy + sắp tới của 1 tuyến/chiều, kèm ETA tới trạm lên.
// Không chứa tọa độ — tọa độ chỉ đi qua room trip:<schedule_id>.
// --------------------------------------------------------------------
const { buildLine, stopProgress, project } = require("./route-geometry");
const { isPublicTrip, vnMidnightMs, vehicleSpeedKmh, averageSpeedKmh, tripEta } = require("./eta");

const parseGeo = v => (typeof v === "string" ? JSON.parse(v) : v);

async function loadGeometry(db, routeId, direction) {
  const [paths] = await db.query(
    "SELECT ST_AsGeoJSON(geom) AS geom_json FROM route_paths WHERE route_id = ? AND direction = ? LIMIT 1",
    [routeId, direction]
  );
  if (paths.length === 0) return null;
  const geom = parseGeo(paths[0].geom_json);
  const coords = geom.type === "MultiLineString" ? geom.coordinates.flat() : geom.coordinates;
  const line = buildLine(coords);
  if (!line) return null;

  const [stops] = await db.query(
    `SELECT rs.stop_id, ST_X(s.geom) AS longitude, ST_Y(s.geom) AS latitude
     FROM route_stops rs
     JOIN bus_stops s ON s.stop_id = rs.stop_id
     WHERE rs.route_id = ? AND rs.direction = ?
     ORDER BY rs.stop_order ASC`,
    [routeId, direction]
  );
  return { line, stops: stopProgress(line, stops) };
}

function createTripLister({ db, registry, now = Date.now }) {
  const cache = new Map(); // "route|dir" → Promise<{ line, stops } | null>

  function geometry(routeId, direction) {
    const key = `${routeId}|${direction}`;
    if (!cache.has(key)) {
      cache.set(key, loadGeometry(db, routeId, direction).catch(err => {
        cache.delete(key);
        throw err;
      }));
    }
    return cache.get(key);
  }

  async function list({ route_id, direction, board_stop_id }) {
    const nowMs = now();
    const [rows] = await db.query(
      `SELECT s.schedule_id, TIME_TO_SEC(s.departure_time) AS dep_sec,
              TIME_FORMAT(s.departure_time, '%H:%i') AS departure_time,
              v.plate_number, v.driver_name
       FROM schedules s
       JOIN vehicles v ON v.vehicle_id = s.vehicle_id
       WHERE s.route_id = ? AND s.direction = ?
       ORDER BY s.departure_time ASC`,
      [route_id, direction]
    );
    const visible = rows.filter(r => isPublicTrip(Number(r.dep_sec), nowMs, registry.has(r.schedule_id)));
    if (visible.length === 0) return [];

    const geo = await geometry(route_id, direction);
    const boardM = geo && board_stop_id ? geo.stops.get(board_stop_id) : undefined;

    // Vận tốc từng xe đang chạy của tuyến (cả 2 chiều) → trung bình làm vận tốc cho chuyến sắp tới
    const speeds = new Map();
    for (const trip of registry.listByRoute(route_id)) {
      const tripGeo = await geometry(trip.route_id, trip.direction);
      speeds.set(trip.schedule_id, vehicleSpeedKmh(trip, tripGeo ? tripGeo.line : null));
    }
    const routeSpeed = averageSpeedKmh([...speeds.values()]);
    const midnight = vnMidnightMs(nowMs);

    const trips = visible.map(r => {
      const depSec = Number(r.dep_sec);
      const running = registry.get(r.schedule_id);
      const pos = running && running.last_position;
      const vehicleM = pos && geo ? project(geo.line, [pos.longitude, pos.latitude]) : 0;
      const { status, etaMs } = tripEta({
        running: !!running, depSec, nowMs, boardM, vehicleM,
        speedKmh: running ? speeds.get(r.schedule_id) : routeSpeed
      });
      return {
        sortKey: etaMs ?? midnight + depSec * 1000,
        trip: {
          schedule_id: r.schedule_id,
          departure_time: r.departure_time,
          plate_number: r.plate_number,
          driver_name: r.driver_name,
          status,
          eta_board: etaMs === null ? null : new Date(etaMs).toISOString(),
          minutes_to_board: etaMs === null ? null : Math.max(0, Math.round((etaMs - nowMs) / 60000))
        }
      };
    });

    return trips
      .sort((a, b) => (a.trip.status === "PASSED") - (b.trip.status === "PASSED") || a.sortKey - b.sortKey)
      .map(x => x.trip);
  }

  return { list };
}

module.exports = { createTripLister };
```

- [ ] **Step 4: Chạy test, xác nhận pass**

Run: `cd backend && node --test src/sockets/trip-list.test.js`
Expected: PASS (7 tests). Nếu số phút lệch ±1 do làm tròn, kiểm tra lại phép tính trong comment test trước khi sửa code — không nới assert.

- [ ] **Step 5: Commit**

```bash
git add backend/src/sockets/trip-list.js backend/src/sockets/trip-list.test.js
git commit -m "feat(eta): danh sách chuyến đang chạy/sắp tới kèm ETA tới trạm lên

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Device socket theo xe + registry (`device.socket.js`)

**Files:**
- Modify: `backend/src/sockets/device.socket.js` (toàn file)
- Test: `backend/src/sockets/device.socket.test.js`

**Interfaces:**
- Consumes: registry (Task 3): `start`, `end`, `recordPing`, `has`, `get`.
- Produces:
  - `registerDeviceSocket(io, { db, jwtSecret, broadcaster, trackingLog, registry, now })`
  - Gọi `broadcaster.publishLocation(packet)` với `packet.schedule_id` mới.
  - Gọi `broadcaster.publishOffline({ vehicle_id, schedule_id })` (đổi từ `publishOffline(vehicleId)`).
  - `trip:start` trả thêm lỗi `SESSION_REPLACED` nếu phiên đã bị thay trong lúc chờ DB.

- [ ] **Step 1: Sửa test (fail)**

Trong `backend/src/sockets/device.socket.test.js`:

1. Thêm import ở đầu file, sau dòng `const { registerDeviceSocket } = require("./device.socket");`:
```js
const { createTripRegistry } = require("./trip-registry");
```

2. Thêm lịch trình thứ hai của DRV_01 vào `SCHEDULES`:
```js
const SCHEDULES = [
  { schedule_id: 11, route_id: "R1", vehicle_id: "DRV_01", direction: 1, route_number: "08" },
  { schedule_id: 12, route_id: "R1", vehicle_id: "DRV_01", direction: 2, route_number: "08" },
  { schedule_id: 22, route_id: "R2", vehicle_id: "DRV_02", direction: 2, route_number: "19" }
];
```

3. Thay `fakeDb` để có thể làm chậm truy vấn lịch trình:
```js
// DB giả: chỉ trả lời 2 truy vấn mà handshake và trip:start dùng; scheduleGate để làm chậm trip:start
const gate = { schedule: null };
const fakeDb = {
  async query(sql, params) {
    if (sql.includes("FROM vehicles")) return [VEHICLES.filter(v => v.driver_user_id === params[0])];
    if (sql.includes("FROM schedules")) {
      if (gate.schedule) await gate.schedule;
      return [SCHEDULES.filter(s => s.schedule_id === params[0])];
    }
    throw new Error(`SQL không mong đợi: ${sql}`);
  }
};
```

4. Trong `startServer`, tạo registry và truyền vào; `published.offline` nhận object:
```js
async function startServer() {
  const httpServer = http.createServer();
  const io = new Server(httpServer);
  const clock = { t: 1_000_000 };
  const published = { locations: [], offline: [] };
  const broadcaster = {
    publishLocation: p => published.locations.push(p),
    publishOffline: o => published.offline.push(o)
  };
  const registry = createTripRegistry({ now: () => clock.t });
  registerDeviceSocket(io, {
    db: fakeDb, jwtSecret: SECRET, broadcaster, registry,
    trackingLog: { record: async () => true },
    now: () => clock.t
  });
  await new Promise(r => httpServer.listen(0, r));
  const url = `http://localhost:${httpServer.address().port}/device`;
  const clients = [];
  const connect = token => {
    const s = ioClient(url, { auth: token ? { token } : {}, reconnection: false, forceNew: true, transports: ["websocket"] });
    clients.push(s);
    return s;
  };
  const close = () => { clients.forEach(c => c.disconnect()); return new Promise(r => io.close(r)); };
  return { connect, published, clock, registry, close };
}
```

5. Đổi mọi `assert.deepEqual(srv.published.offline, ["DRV_01"])` thành:
```js
assert.deepEqual(srv.published.offline, [{ vehicle_id: "DRV_01", schedule_id: 11 }]);
```
(có 4 chỗ: test "trip:end → phát vehicle_offline", "ngắt kết nối khi đang có trip", "phiên mới thay phiên cũ rồi ngắt khi chưa trip:start", "phiên thay thế gọi trip:end khi chưa trip:start").

6. Trong test "ping hợp lệ → server dựng gói…", thêm sau `assert.equal(p.heading, 45);`:
```js
  assert.equal(p.schedule_id, 11);
  assert.equal(srv.registry.get(11).last_position.latitude, 10.8);
```

7. Thêm các test mới ở cuối file:
```js
test("trip:start đăng ký chuyến vào registry; trip:end gỡ khỏi registry", async t => {
  const srv = await startServer(); t.after(srv.close);
  const s = srv.connect(driverToken(1)); await waitConnect(s);
  await startTrip(s, 11);
  assert.equal(srv.registry.has(11), true);
  await s.timeout(2000).emitWithAck("trip:end", {});
  assert.equal(srv.registry.has(11), false);
});

test("trip:start chuyến khác khi xe đang chạy → kết thúc chuyến cũ, offline vào room chuyến cũ", async t => {
  const srv = await startServer(); t.after(srv.close);
  const s = srv.connect(driverToken(1)); await waitConnect(s);
  await startTrip(s, 11);
  const ack = await startTrip(s, 12);
  assert.equal(ack.ok, true);
  assert.deepEqual(srv.published.offline, [{ vehicle_id: "DRV_01", schedule_id: 11 }]);
  assert.equal(srv.registry.has(11), false);
  assert.equal(srv.registry.has(12), true);
  srv.clock.t += 1000;
  s.emit("gps_ping", { latitude: 10.8, longitude: 106.7 });
  await tick();
  assert.equal(srv.published.locations[0].schedule_id, 12);
});

test("phiên thay thế gửi lại cùng chuyến → giữ nguyên bản ghi registry (không mất mẫu vận tốc)", async t => {
  const srv = await startServer(); t.after(srv.close);
  const a = srv.connect(driverToken(1)); await waitConnect(a);
  await startTrip(a, 11);
  a.emit("gps_ping", { latitude: 10.8, longitude: 106.7 });
  await tick();
  const before = srv.registry.get(11);
  const b = srv.connect(driverToken(1)); await waitConnect(b);
  await startTrip(b, 11);
  assert.equal(srv.registry.get(11), before);
  assert.deepEqual(srv.published.offline, []);
});

test("phiên bị thay rồi ngắt trước trip:start → chuyến kết thúc đúng 1 lần, registry sạch", async t => {
  const srv = await startServer(); t.after(srv.close);
  const a = srv.connect(driverToken(1)); await waitConnect(a);
  await startTrip(a, 11);
  const b = srv.connect(driverToken(1)); await waitConnect(b);
  await tick();
  b.disconnect();
  await tick();
  assert.deepEqual(srv.published.offline, [{ vehicle_id: "DRV_01", schedule_id: 11 }]);
  assert.equal(srv.registry.has(11), false);
});

test("Review focus: phiên bị thay khi trip:start đang chờ DB → SESSION_REPLACED, không ghi registry", async t => {
  const srv = await startServer(); t.after(() => { gate.schedule = null; return srv.close(); });
  const a = srv.connect(driverToken(1)); await waitConnect(a);
  let release;
  gate.schedule = new Promise(r => { release = r; });
  const pending = a.timeout(2000).emitWithAck("trip:start", { schedule_id: 11 }).catch(e => ({ error: e.message }));
  await tick();
  const b = srv.connect(driverToken(1)); await waitConnect(b);
  await tick();
  release();
  gate.schedule = null;
  const ack = await pending;
  // Phiên cũ đã bị ngắt nên có thể không nhận được ack; điều quan trọng là registry không bị ghi
  assert.ok(ack.error !== undefined || ack.ok === false);
  assert.equal(srv.registry.has(11), false);
});
```

- [ ] **Step 2: Chạy test, xác nhận fail**

Run: `cd backend && node --test src/sockets/device.socket.test.js`
Expected: FAIL — các assert `published.offline` dạng object và `schedule_id`, registry chưa được gọi.

- [ ] **Step 3: Viết code**

Thay toàn bộ `backend/src/sockets/device.socket.js`:
```js
const { validateGpsPing } = require("./gps.validate");
const { createDeviceAuth } = require("./device.auth");

const MIN_PING_INTERVAL_MS = 250;   // Simulator 500ms, điện thoại 1s; chừa độ trễ dao động qua tunnel
const WARN_INTERVAL_MS = 10000;

// --------------------------------------------------------------------
// NAMESPACE /device: thiết bị của tài xế (điện thoại hoặc simulator) phát GPS.
// Danh tính xe lấy từ phiên đã xác thực; client chỉ gửi vị trí.
// --------------------------------------------------------------------
function registerDeviceSocket(io, { db, jwtSecret, broadcaster, trackingLog, registry, now = Date.now }) {
  const devices = io.of("/device");
  const activeDevices = new Map(); // vehicle_id → socket đang giữ xe (mỗi xe 1 phiên)
  // vehicle_id → schedule_id đang chạy. Theo XE, không theo phiên: phiên bị thay thì handler
  // disconnect của phiên cũ thoát sớm, nên chuyến phải được kết thúc từ đây.
  const liveTrips = new Map();

  const endLiveTrip = vehicleId => {
    const scheduleId = liveTrips.get(vehicleId);
    if (scheduleId === undefined) return;
    liveTrips.delete(vehicleId);
    registry.end(scheduleId);
    broadcaster.publishOffline({ vehicle_id: vehicleId, schedule_id: scheduleId });
  };

  devices.use(createDeviceAuth({ db, jwtSecret }));

  devices.on("connection", socket => {
    const { vehicle } = socket.data;

    // Phiên mới thay phiên cũ của cùng xe (vd. điện thoại tài xế thay simulator)
    const previous = activeDevices.get(vehicle.vehicle_id);
    activeDevices.set(vehicle.vehicle_id, socket);
    if (previous) {
      previous.emit("session:replaced");
      previous.disconnect(true);
    }

    socket.on("trip:start", async (payload, ack) => {
      const reply = typeof ack === "function" ? ack : () => {};
      try {
        const [rows] = await db.query(
          `SELECT s.schedule_id, s.route_id, s.vehicle_id, s.direction, r.route_number
           FROM schedules s
           JOIN bus_routes r ON r.route_id = s.route_id
           WHERE s.schedule_id = ?`,
          [payload?.schedule_id]
        );
        const schedule = rows[0];
        if (!schedule || schedule.vehicle_id !== vehicle.vehicle_id) {
          return reply({ ok: false, error: "SCHEDULE_NOT_ALLOWED" });
        }
        // Phiên bị thay trong lúc chờ DB → không được ghi đè chuyến của phiên mới
        if (activeDevices.get(vehicle.vehicle_id) !== socket) {
          return reply({ ok: false, error: "SESSION_REPLACED" });
        }

        if (liveTrips.has(vehicle.vehicle_id) && liveTrips.get(vehicle.vehicle_id) !== schedule.schedule_id) {
          endLiveTrip(vehicle.vehicle_id);
        }
        socket.data.trip = {
          schedule_id: schedule.schedule_id,
          route_id: schedule.route_id,
          route_number: schedule.route_number,
          direction: schedule.direction
        };
        registry.start({
          schedule_id: schedule.schedule_id,
          vehicle_id: vehicle.vehicle_id,
          route_id: schedule.route_id,
          direction: schedule.direction
        });
        liveTrips.set(vehicle.vehicle_id, schedule.schedule_id);
        reply({ ok: true, trip: socket.data.trip });
      } catch (err) {
        console.error("[device] trip:start lỗi:", err.message);
        reply({ ok: false, error: "SERVER_ERROR" });
      }
    });

    socket.on("gps_ping", raw => {
      const { trip } = socket.data;
      if (!trip) return;

      const t = now();
      if (t - socket.data.lastPingAt < MIN_PING_INTERVAL_MS) return;

      const result = validateGpsPing(raw);
      if (!result.ok) {
        if (t - socket.data.lastWarnAt >= WARN_INTERVAL_MS) {
          socket.data.lastWarnAt = t;
          console.warn(`[device] Bỏ gói GPS của xe ${vehicle.vehicle_id}: ${result.reason}`);
        }
        return;
      }
      socket.data.lastPingAt = t;

      const packet = {
        vehicle_id: vehicle.vehicle_id,
        plate_number: vehicle.plate_number,
        schedule_id: trip.schedule_id,
        route_id: trip.route_id,
        route_number: trip.route_number,
        direction: trip.direction,
        ...result.value,
        timestamp: new Date(t).toISOString()
      };
      broadcaster.publishLocation(packet);
      registry.recordPing(trip.schedule_id, result.value);
      trackingLog.record(packet);
    });

    socket.on("trip:end", (...args) => {
      const ack = args.find(a => typeof a === "function") || (() => {});
      // Phiên thay thế có thể chưa có trip nhưng xe vẫn đang chạy chuyến của phiên cũ
      socket.data.trip = null;
      endLiveTrip(vehicle.vehicle_id);
      ack({ ok: true });
    });

    socket.on("disconnect", () => {
      // Phiên đã bị thay thì xe vẫn đang chạy ở phiên mới → không kết thúc chuyến
      if (activeDevices.get(vehicle.vehicle_id) !== socket) return;
      activeDevices.delete(vehicle.vehicle_id);
      endLiveTrip(vehicle.vehicle_id);
    });
  });
}

module.exports = { registerDeviceSocket };
```

- [ ] **Step 4: Chạy test, xác nhận pass**

Run: `cd backend && node --test src/sockets/device.socket.test.js`
Expected: PASS (tất cả test cũ + 5 test mới). Chưa chạy `npm run test:unit` toàn bộ vì `index.js` chưa truyền registry — sửa ở Task 6.

- [ ] **Step 5: Commit**

```bash
git add backend/src/sockets/device.socket.js backend/src/sockets/device.socket.test.js
git commit -m "feat(device): quản lý chuyến theo xe, ghi registry, gói GPS kèm schedule_id

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Viewer socket theo room + nối dây (`viewer.socket.js`, `index.js`)

**Files:**
- Modify: `backend/src/sockets/viewer.socket.js` (toàn file)
- Modify: `backend/src/sockets/index.js` (toàn file)
- Modify: `docs/superpowers/specs/2026-10-05-guest-trip-tracking-design.md` (Mục 4.1, 4.2, 4.3, 5.3, 7)
- Test: `backend/src/sockets/viewer.socket.test.js` (mới)

**Interfaces:**
- Consumes: Task 2 `isPublicTrip`; Task 3 registry (`has`, `on("change")`); Task 4 `createTripLister`; Task 5 `registerDeviceSocket` (cho test tích hợp).
- Produces:
  - `createViewerBroadcaster(io) → { publishLocation(packet), publishOffline({ vehicle_id, schedule_id }) }` — phát tới `trip:<schedule_id>`, `vehicle:<vehicle_id>`, `staff`.
  - `registerViewerSocket(io, { db, jwtSecret, registry, tripLister, now, pushIntervalMs = 15000 }) → { stop() }`
  - Sự kiện client → server: `trips:subscribe {route_id, direction, board_stop_id?}` → ack `{ok:true, trips}` | `{ok:false, error:"BAD_REQUEST"|"SERVER_ERROR"}`; `trips:unsubscribe`; `trip:watch {schedule_id}` → ack `{ok:true, status:"RUNNING"|"UPCOMING"}` | `{ok:false, error:"TRIP_NOT_AVAILABLE"|"SERVER_ERROR"}`; `trip:unwatch`.
  - Server → client: `fleet_location_update`, `vehicle_offline {vehicle_id, schedule_id}`, `trips:update {route_id, direction, trips}`.

- [ ] **Step 1: Viết test (fail)**

`backend/src/sockets/viewer.socket.test.js`:
```js
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const jwt = require("jsonwebtoken");
const { Server } = require("socket.io");
const { io: ioClient } = require("socket.io-client");
const { registerDeviceSocket } = require("./device.socket");
const { createViewerBroadcaster, registerViewerSocket } = require("./viewer.socket");
const { createTripRegistry } = require("./trip-registry");
const { createTripLister } = require("./trip-list");

const SECRET = "test-secret";
const VN_10H = Date.UTC(2026, 9, 5, 3, 0, 0);   // 10:00 giờ VN
const LAT = 10.8;
const VEHICLES = [
  { vehicle_id: "DRV_01", plate_number: "51B-900.01", driver_name: "Tài xế 01", driver_user_id: 1 },
  { vehicle_id: "DRV_02", plate_number: "51B-900.02", driver_name: "Tài xế 02", driver_user_id: 2 }
];
// 11: 05:00 (ngoài cửa sổ nếu chưa chạy); 12: 10:30 (sắp tới); 22: tuyến khác
const SCHEDULES = [
  { schedule_id: 11, route_id: "R1", vehicle_id: "DRV_01", direction: 1, route_number: "08", dep_sec: 5 * 3600 },
  { schedule_id: 12, route_id: "R1", vehicle_id: "DRV_01", direction: 1, route_number: "08", dep_sec: 10.5 * 3600 },
  { schedule_id: 22, route_id: "R2", vehicle_id: "DRV_02", direction: 2, route_number: "19", dep_sec: 9.75 * 3600 }
];
const hhmm = s => `${String(Math.floor(s / 3600)).padStart(2, "0")}:${String(Math.floor(s / 60) % 60).padStart(2, "0")}`;

const fakeDb = {
  async query(sql, params) {
    if (sql.includes("FROM route_paths")) {
      return [[{ geom_json: JSON.stringify({ type: "LineString", coordinates: [[106.70, LAT], [106.74, LAT]] }) }]];
    }
    if (sql.includes("FROM route_stops")) {
      return [[{ stop_id: "S1", longitude: 106.70, latitude: LAT }, { stop_id: "S2", longitude: 106.72, latitude: LAT }]];
    }
    if (sql.includes("JOIN bus_routes")) return [SCHEDULES.filter(s => s.schedule_id === params[0])];
    if (sql.includes("JOIN vehicles")) {
      return [SCHEDULES
        .filter(s => s.route_id === params[0] && s.direction === params[1])
        .map(s => {
          const v = VEHICLES.find(x => x.vehicle_id === s.vehicle_id);
          return { schedule_id: s.schedule_id, dep_sec: s.dep_sec, departure_time: hhmm(s.dep_sec), plate_number: v.plate_number, driver_name: v.driver_name };
        })];
    }
    if (sql.includes("FROM schedules")) {
      return [SCHEDULES.filter(s => s.schedule_id === params[0]).map(s => ({ schedule_id: s.schedule_id, dep_sec: s.dep_sec }))];
    }
    if (sql.includes("FROM vehicles")) return [VEHICLES.filter(v => v.driver_user_id === params[0])];
    throw new Error(`SQL không mong đợi: ${sql}`);
  }
};

const token = (role, userId = 1) => jwt.sign({ user_id: userId, username: `u${userId}`, role }, SECRET);
const tick = (ms = 80) => new Promise(r => setTimeout(r, ms));

async function startServer({ tripLister } = {}) {
  const httpServer = http.createServer();
  const io = new Server(httpServer);
  const clock = { t: VN_10H };
  const now = () => clock.t;
  const registry = createTripRegistry({ now });
  const lister = tripLister || createTripLister({ db: fakeDb, registry, now });
  registerDeviceSocket(io, {
    db: fakeDb, jwtSecret: SECRET, registry, now,
    broadcaster: createViewerBroadcaster(io),
    trackingLog: { record: async () => true }
  });
  const hub = registerViewerSocket(io, { db: fakeDb, jwtSecret: SECRET, registry, tripLister: lister, now, pushIntervalMs: 60_000 });
  await new Promise(r => httpServer.listen(0, r));
  const base = `http://localhost:${httpServer.address().port}`;
  const clients = [];
  const connect = async (nsp, auth = {}) => {
    const s = ioClient(`${base}${nsp}`, { auth, reconnection: false, forceNew: true, transports: ["websocket"] });
    clients.push(s);
    await new Promise((resolve, reject) => { s.once("connect", resolve); s.once("connect_error", reject); });
    return s;
  };
  const close = () => { hub.stop(); clients.forEach(c => c.disconnect()); return new Promise(r => io.close(r)); };
  return { connect, clock, registry, close };
}

const collect = (socket, event) => {
  const got = [];
  socket.on(event, d => got.push(d));
  return got;
};
const ack = (s, event, payload) => s.timeout(2000).emitWithAck(event, payload);
async function startDriver(srv, userId, scheduleId) {
  const dev = await srv.connect("/device", { token: token("DRIVER", userId) });
  const res = await ack(dev, "trip:start", { schedule_id: scheduleId });
  assert.equal(res.ok, true);
  return dev;
}
async function ping(srv, dev, lon = 106.71) {
  srv.clock.t += 1000;
  dev.emit("gps_ping", { latitude: LAT, longitude: lon, speed_kmh: 30, heading: 90 });
  await tick();
}

test("khách chưa watch → không nhận vị trí xe nào", async t => {
  const srv = await startServer(); t.after(srv.close);
  const guest = await srv.connect("");
  const got = collect(guest, "fleet_location_update");
  const dev = await startDriver(srv, 1, 11);
  await ping(srv, dev);
  assert.equal(got.length, 0);
});

test("trip:watch chuyến ngoài cửa sổ → TRIP_NOT_AVAILABLE; đang chạy → nhận đúng xe đó", async t => {
  const srv = await startServer(); t.after(srv.close);
  const guest = await srv.connect("");
  assert.deepEqual(await ack(guest, "trip:watch", { schedule_id: 11 }), { ok: false, error: "TRIP_NOT_AVAILABLE" });

  const dev1 = await startDriver(srv, 1, 11);
  const dev2 = await startDriver(srv, 2, 22);
  assert.deepEqual(await ack(guest, "trip:watch", { schedule_id: 11 }), { ok: true, status: "RUNNING" });
  const got = collect(guest, "fleet_location_update");
  await ping(srv, dev1);
  await ping(srv, dev2);
  assert.deepEqual(got.map(p => [p.vehicle_id, p.schedule_id]), [["DRV_01", 11]]);
});

test("watch chuyến khác → rời room cũ", async t => {
  const srv = await startServer(); t.after(srv.close);
  const dev1 = await startDriver(srv, 1, 11);
  const guest = await srv.connect("");
  await ack(guest, "trip:watch", { schedule_id: 11 });
  assert.deepEqual(await ack(guest, "trip:watch", { schedule_id: 12 }), { ok: true, status: "UPCOMING" });
  const got = collect(guest, "fleet_location_update");
  await ping(srv, dev1);
  assert.equal(got.length, 0);
});

test("trip:unwatch → không nhận nữa", async t => {
  const srv = await startServer(); t.after(srv.close);
  const dev1 = await startDriver(srv, 1, 11);
  const guest = await srv.connect("");
  await ack(guest, "trip:watch", { schedule_id: 11 });
  guest.emit("trip:unwatch");
  await tick();
  const got = collect(guest, "fleet_location_update");
  await ping(srv, dev1);
  assert.equal(got.length, 0);
});

test("nhân viên nhận mọi xe; token sai/hết hạn bị coi là khách", async t => {
  const srv = await startServer(); t.after(srv.close);
  const staff = await srv.connect("", { token: token("MANAGER") });
  const expired = jwt.sign({ user_id: 1, role: "ADMIN" }, SECRET, { expiresIn: -10 });
  const fake = await srv.connect("", { token: expired });
  const gotStaff = collect(staff, "fleet_location_update");
  const gotFake = collect(fake, "fleet_location_update");
  const dev1 = await startDriver(srv, 1, 11);
  const dev2 = await startDriver(srv, 2, 22);
  await ping(srv, dev1);
  await ping(srv, dev2);
  assert.deepEqual(gotStaff.map(p => p.vehicle_id).sort(), ["DRV_01", "DRV_02"]);
  assert.equal(gotFake.length, 0);
});

test("tài xế trên '/' nhận xe của mình bất kể chuyến, không nhận xe khác", async t => {
  const srv = await startServer(); t.after(srv.close);
  const driverViewer = await srv.connect("", { token: token("DRIVER", 1) });
  const got = collect(driverViewer, "fleet_location_update");
  const dev1 = await startDriver(srv, 1, 11);
  const dev2 = await startDriver(srv, 2, 22);
  await ping(srv, dev1);
  await ping(srv, dev2);
  assert.deepEqual(got.map(p => p.vehicle_id), ["DRV_01"]);
});

test("vehicle_offline chỉ tới room chuyến đó và staff", async t => {
  const srv = await startServer(); t.after(srv.close);
  const dev1 = await startDriver(srv, 1, 11);
  const watcher = await srv.connect("");
  const other = await srv.connect("");
  await ack(watcher, "trip:watch", { schedule_id: 11 });
  await ack(other, "trip:watch", { schedule_id: 12 });
  const gotWatcher = collect(watcher, "vehicle_offline");
  const gotOther = collect(other, "vehicle_offline");
  await ack(dev1, "trip:end", {});
  await tick();
  assert.deepEqual(gotWatcher, [{ vehicle_id: "DRV_01", schedule_id: 11 }]);
  assert.equal(gotOther.length, 0);
});

test("trips:subscribe ack danh sách; trips:update đẩy ngay khi chuyến bắt đầu; không có tọa độ", async t => {
  const srv = await startServer(); t.after(srv.close);
  const guest = await srv.connect("");
  const res = await ack(guest, "trips:subscribe", { route_id: "R1", direction: 1, board_stop_id: "S2" });
  assert.equal(res.ok, true);
  assert.deepEqual(res.trips.map(x => [x.schedule_id, x.status]), [[12, "UPCOMING"]]);

  const updates = collect(guest, "trips:update");
  await startDriver(srv, 1, 11);
  await tick();
  assert.ok(updates.length >= 1);
  const last = updates[updates.length - 1];
  assert.equal(last.route_id, "R1");
  assert.equal(last.direction, 1);
  assert.deepEqual(last.trips.map(x => [x.schedule_id, x.status]), [[11, "RUNNING"], [12, "UPCOMING"]]);
  assert.doesNotMatch(JSON.stringify(updates), /longitude|latitude/);
});

test("trips:unsubscribe → không nhận trips:update nữa", async t => {
  const srv = await startServer(); t.after(srv.close);
  const guest = await srv.connect("");
  await ack(guest, "trips:subscribe", { route_id: "R1", direction: 1 });
  guest.emit("trips:unsubscribe");
  await tick();
  const updates = collect(guest, "trips:update");
  await startDriver(srv, 1, 11);
  await tick();
  assert.equal(updates.length, 0);
});

test("Review focus: payload rác → lỗi có mã, socket vẫn sống", async t => {
  const srv = await startServer(); t.after(srv.close);
  const guest = await srv.connect("");
  assert.deepEqual(await ack(guest, "trip:watch", "abc"), { ok: false, error: "TRIP_NOT_AVAILABLE" });
  assert.deepEqual(await ack(guest, "trip:watch", { schedule_id: -1 }), { ok: false, error: "TRIP_NOT_AVAILABLE" });
  assert.deepEqual(await ack(guest, "trip:watch", {}), { ok: false, error: "TRIP_NOT_AVAILABLE" });
  assert.deepEqual(await ack(guest, "trips:subscribe", { route_id: "R1", direction: 3 }), { ok: false, error: "BAD_REQUEST" });
  assert.deepEqual(await ack(guest, "trips:subscribe", null), { ok: false, error: "BAD_REQUEST" });
  guest.emit("trip:watch", { schedule_id: 12 });            // không có ack
  guest.emit("trips:subscribe", { route_id: "R1", direction: 1 });
  await tick();
  assert.equal(guest.connected, true);
  assert.deepEqual(await ack(guest, "trip:watch", { schedule_id: 12 }), { ok: true, status: "UPCOMING" });
});

test("Review focus: lister lỗi → subscribe trả SERVER_ERROR, đẩy theo sự kiện không làm sập server", async t => {
  const failing = { list: async () => { throw new Error("DB down"); } };
  const srv = await startServer({ tripLister: failing }); t.after(srv.close);
  const originalError = console.error;
  console.error = () => {};
  t.after(() => { console.error = originalError; });
  const guest = await srv.connect("");
  assert.deepEqual(await ack(guest, "trips:subscribe", { route_id: "R1", direction: 1 }), { ok: false, error: "SERVER_ERROR" });
  await startDriver(srv, 1, 11);   // registry change → đẩy → lister ném lỗi
  await tick();
  assert.equal(guest.connected, true);
});
```

- [ ] **Step 2: Chạy test, xác nhận fail**

Run: `cd backend && node --test src/sockets/viewer.socket.test.js`
Expected: FAIL — `registerViewerSocket is not a function`

- [ ] **Step 3: Viết code `viewer.socket.js`**

Thay toàn bộ `backend/src/sockets/viewer.socket.js`:
```js
const jwt = require("jsonwebtoken");
const { isPublicTrip } = require("./eta");

const PUSH_INTERVAL_MS = 15000;
const STAFF_ROLES = new Set(["ADMIN", "MANAGER"]);

const tripRoom = scheduleId => `trip:${scheduleId}`;
const vehicleRoom = vehicleId => `vehicle:${vehicleId}`;
const routeRoom = (routeId, direction) => `route:${routeId}:${direction}`;

// Vị trí xe chỉ tới: khách đang theo dõi chuyến, tài xế của xe, nhân viên
function createViewerBroadcaster(io) {
  const viewers = io.of("/");
  const rooms = ({ vehicle_id, schedule_id }) => [tripRoom(schedule_id), vehicleRoom(vehicle_id), "staff"];
  return {
    publishLocation: packet => viewers.to(rooms(packet)).emit("fleet_location_update", packet),
    publishOffline: ({ vehicle_id, schedule_id }) =>
      viewers.to(rooms({ vehicle_id, schedule_id })).emit("vehicle_offline", { vehicle_id, schedule_id })
  };
}

// Handshake "/": token nhân viên → room staff; token tài xế → room xe của mình.
// Không token / token sai / hết hạn → khách, KHÔNG báo lỗi (trang công khai hay còn token cũ).
function createViewerAuth({ db, jwtSecret }) {
  return async (socket, next) => {
    socket.data = { tripRoom: null, routeRoom: null, subscription: null };
    const token = socket.handshake.auth?.token;
    if (!token) return next();
    let user;
    try {
      user = jwt.verify(token, jwtSecret);
    } catch {
      return next();
    }
    if (STAFF_ROLES.has(user.role)) {
      socket.data.staff = true;
    } else if (user.role === "DRIVER") {
      try {
        const [rows] = await db.query("SELECT vehicle_id FROM vehicles WHERE driver_user_id = ?", [user.user_id]);
        if (rows[0]) socket.data.driverVehicleId = rows[0].vehicle_id;
      } catch (err) {
        console.error("[viewer] Lỗi tra xe của tài xế:", err.message);
      }
    }
    next();
  };
}

function parseSubscription(payload) {
  const rawRoute = payload?.route_id;
  const route_id = typeof rawRoute === "string" || typeof rawRoute === "number" ? String(rawRoute) : "";
  const direction = Number(payload?.direction);
  if (!route_id || route_id.length > 20 || (direction !== 1 && direction !== 2)) return null;
  const board = payload.board_stop_id;
  const board_stop_id = typeof board === "string" && board.length > 0 && board.length <= 20 ? board : null;
  return { route_id, direction, board_stop_id };
}

// --------------------------------------------------------------------
// NAMESPACE "/": bản đồ công khai, nhân viên, trang tài xế.
// Khách: trips:subscribe (danh sách chuyến + ETA, không tọa độ) và trip:watch (tọa độ của đúng 1 chuyến).
// --------------------------------------------------------------------
function registerViewerSocket(io, { db, jwtSecret, registry, tripLister, now = Date.now, pushIntervalMs = PUSH_INTERVAL_MS }) {
  const viewers = io.of("/");
  const routeTargets = new Map(); // tên room tuyến → { route_id, direction }

  viewers.use(createViewerAuth({ db, jwtSecret }));

  const leave = (socket, key) => {
    if (socket.data[key]) socket.leave(socket.data[key]);
    socket.data[key] = null;
  };

  // Tính danh sách 1 lần cho mỗi trạm lên khác nhau trong room, gửi riêng từng socket
  async function pushRoom(room) {
    const target = routeTargets.get(room);
    const ids = viewers.adapter.rooms.get(room);
    if (!target || !ids || ids.size === 0) {
      routeTargets.delete(room);
      return;
    }
    const byStop = new Map();
    for (const id of ids) {
      const socket = viewers.sockets.get(id);
      if (!socket) continue;
      const stopId = socket.data.subscription?.board_stop_id || "";
      if (!byStop.has(stopId)) byStop.set(stopId, []);
      byStop.get(stopId).push(socket);
    }
    for (const [stopId, sockets] of byStop) {
      const trips = await tripLister.list({ ...target, board_stop_id: stopId || null });
      sockets.forEach(s => {
        if (s.data.routeRoom === room) s.emit("trips:update", { ...target, trips });
      });
    }
  }
  const safePush = room =>
    pushRoom(room).catch(err => console.error("[viewer] Lỗi đẩy danh sách chuyến:", err.message));

  // Chuyến bắt đầu/kết thúc → đẩy cả 2 chiều (vận tốc cho chuyến sắp tới tính trên cả tuyến)
  registry.on("change", ({ route_id }) => {
    [1, 2].forEach(direction => {
      const room = routeRoom(route_id, direction);
      if (routeTargets.has(room)) safePush(room);
    });
  });
  const timer = setInterval(() => routeTargets.forEach((_, room) => safePush(room)), pushIntervalMs);
  timer.unref();

  viewers.on("connection", socket => {
    if (socket.data.staff) socket.join("staff");
    if (socket.data.driverVehicleId) socket.join(vehicleRoom(socket.data.driverVehicleId));

    socket.on("trips:subscribe", async (payload, ack) => {
      const reply = typeof ack === "function" ? ack : () => {};
      const sub = parseSubscription(payload);
      if (!sub) return reply({ ok: false, error: "BAD_REQUEST" });

      leave(socket, "routeRoom");
      const room = routeRoom(sub.route_id, sub.direction);
      socket.join(room);
      routeTargets.set(room, { route_id: sub.route_id, direction: sub.direction });
      socket.data.routeRoom = room;
      socket.data.subscription = sub;
      try {
        reply({ ok: true, trips: await tripLister.list(sub) });
      } catch (err) {
        console.error("[viewer] trips:subscribe lỗi:", err.message);
        reply({ ok: false, error: "SERVER_ERROR" });
      }
    });

    socket.on("trips:unsubscribe", () => {
      leave(socket, "routeRoom");
      socket.data.subscription = null;
    });

    socket.on("trip:watch", async (payload, ack) => {
      const reply = typeof ack === "function" ? ack : () => {};
      const scheduleId = Number(payload?.schedule_id);
      if (!Number.isInteger(scheduleId) || scheduleId <= 0) return reply({ ok: false, error: "TRIP_NOT_AVAILABLE" });
      try {
        const [rows] = await db.query(
          "SELECT schedule_id, TIME_TO_SEC(departure_time) AS dep_sec FROM schedules WHERE schedule_id = ?",
          [scheduleId]
        );
        const running = registry.has(scheduleId);
        if (!rows[0] || !isPublicTrip(Number(rows[0].dep_sec), now(), running)) {
          return reply({ ok: false, error: "TRIP_NOT_AVAILABLE" });
        }
        leave(socket, "tripRoom");
        socket.data.tripRoom = tripRoom(scheduleId);
        socket.join(socket.data.tripRoom);
        reply({ ok: true, status: running ? "RUNNING" : "UPCOMING" });
      } catch (err) {
        console.error("[viewer] trip:watch lỗi:", err.message);
        reply({ ok: false, error: "SERVER_ERROR" });
      }
    });

    socket.on("trip:unwatch", () => leave(socket, "tripRoom"));
  });

  return { stop: () => clearInterval(timer) };
}

module.exports = { createViewerBroadcaster, registerViewerSocket };
```

- [ ] **Step 4: Viết `index.js`**

Thay toàn bộ `backend/src/sockets/index.js`:
```js
const { dbPool } = require("../config/db");
const { JWT_SECRET } = require("../config/env");
const { createViewerBroadcaster, registerViewerSocket } = require("./viewer.socket");
const { registerDeviceSocket } = require("./device.socket");
const { createTrackingLog } = require("./tracking-log");
const { createTripRegistry } = require("./trip-registry");
const { createTripLister } = require("./trip-list");

// Hub realtime: "/" (bản đồ, nhân viên, trang tài xế — nhận theo room) + "/device" (tài xế đã xác thực, phát GPS)
function registerSockets(io) {
  const registry = createTripRegistry();
  registerDeviceSocket(io, {
    db: dbPool,
    jwtSecret: JWT_SECRET,
    broadcaster: createViewerBroadcaster(io),
    trackingLog: createTrackingLog(dbPool),
    registry
  });
  registerViewerSocket(io, {
    db: dbPool,
    jwtSecret: JWT_SECRET,
    registry,
    tripLister: createTripLister({ db: dbPool, registry })
  });
}

module.exports = { registerSockets };
```

- [ ] **Step 5: Chạy toàn bộ unit test backend**

Run: `cd backend && npm run test:unit`
Expected: PASS toàn bộ (route-geometry, eta, trip-registry, trip-list, device.socket, viewer.socket, các test có sẵn). Nếu test "trips:subscribe … đẩy ngay" chỉ thấy 1 update có `[[12,"UPCOMING"]]`, nghĩa là push chạy trước `liveTrips/registry` — kiểm tra `registry.start` được gọi trước `reply` trong `trip:start` (Task 5) chứ không sửa test.

- [ ] **Step 6: Cập nhật spec theo điều chỉnh**

Trong `docs/superpowers/specs/2026-10-05-guest-trip-tracking-design.md`:
- Mục 2.2, câu "Câu SELECT lấy thêm `s.departure_time`." → xóa dòng này.
- Mục 2.2, đoạn cuối về `createViewerBroadcaster`: đổi "cả hai đều gửi tới `io.of("/").to(["trip:" + id, "staff"])`" thành "cả hai đều gửi tới room `trip:<schedule_id>`, `vehicle:<vehicle_id>` và `staff`".
- Mục 4.1, dòng bảng DRIVER → `| JWT hợp lệ, role DRIVER | join room \`vehicle:<vehicle_id>\` (tra \`vehicles.driver_user_id\`) — luôn thấy xe mình, bất kể chuyến |`.
- Mục 4.2 `trip:watch`, bỏ gạch đầu dòng "**hoặc** `schedule.vehicle_id === socket.data.driverVehicleId` …" và giữ điều kiện `isPublicTrip`.
- Mục 4.3, cột "Room nhận" của `fleet_location_update` và `vehicle_offline` → `trip:<id>`, `vehicle:<vehicle_id>`, `staff`.
- Mục 4.3, câu "Timer không chạy khi không có room `route:*` nào." → "Timer không làm gì khi không có room `route:*` nào."
- Mục 5.3 → "`connectRealtime` gửi kèm JWT tài xế; server tự cho socket vào room `vehicle:<vehicle_id>`, không cần `trip:watch`."
- Mục 7, gạch "Chuyến ngoài cửa sổ → `TRIP_NOT_AVAILABLE`. Riêng tài xế watch được chuyến của xe mình ngoài cửa sổ." → "Chuyến ngoài cửa sổ → `TRIP_NOT_AVAILABLE`. Socket tài xế trên `/` nhận xe của mình mà không cần watch, không nhận xe khác."
- Mục 9: thêm 2 dòng `backend/src/sockets/route-geometry.js | mới` và `backend/src/sockets/trip-list.js | mới`.

- [ ] **Step 7: Commit**

```bash
git add backend/src/sockets/viewer.socket.js backend/src/sockets/viewer.socket.test.js backend/src/sockets/index.js docs/superpowers/specs/2026-10-05-guest-trip-tracking-design.md
git commit -m "feat(viewer): phát theo room, khách theo dõi 1 chuyến, đẩy danh sách chuyến qua socket

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Seed 4 tài xế/tuyến, nhiều chuyến mỗi ngày (`seed_drivers.js`)

**Files:**
- Modify: `backend/scripts/seed_drivers.js` (các hàm `pickRoutePairs`, `upsertDriver`, `main`)

**Interfaces:**
- Produces: dữ liệu — tài xế `driverNN` thứ `i` (1-based) thuộc tuyến thứ `floor((i-1)/4)`, `slot = (i-1) % 4`; mỗi xe 17 lịch `05:00 + slot×15' + k×60'`, chiều `(slot + k) % 2 === 0 ? 1 : 2`.

- [ ] **Step 1: Sửa header comment và thêm hằng số**

Thay khối comment đầu file và dòng `const MAX_COUNT = 99;`:
```js
// --------------------------------------------------------------------
// SEED TÀI XẾ DEMO: driverNN (role DRIVER) + xe DRV_NN, 4 tài xế mỗi tuyến, mỗi tài xế
// chạy 17 chuyến/ngày (05:00 + slot×15' + k×60'), đổi chiều sau mỗi chuyến.
// Chạy: npm run db:seed-drivers -- --count 20   (→ 5 tuyến)
// Chạy lại an toàn: upsert theo khóa cố định để KHÔNG mất log hành trình
// (vehicle_tracking_logs xóa theo xe — ON DELETE CASCADE).
// --------------------------------------------------------------------
```
```js
const MAX_COUNT = 99;
const DRIVERS_PER_ROUTE = 4;
const FIRST_DEPARTURE_S = 5 * 3600;
const SLOT_GAP_S = 15 * 60;
const TRIP_GAP_S = 60 * 60;
const TRIPS_PER_DRIVER = 17;
```

- [ ] **Step 2: Thay `pickRoutePairs` bằng `pickRoutes`**

```js
// Các tuyến có đủ 2 chiều; tuyến số đứng trước tuyến chữ (D4, DL01...)
async function pickRoutes(conn, count) {
  const [rows] = await conn.query(
    `SELECT r.route_id, r.route_number
     FROM bus_routes r
     WHERE r.route_id IN (
       SELECT route_id FROM route_paths GROUP BY route_id HAVING COUNT(DISTINCT direction) = 2
     )
     ORDER BY r.route_number REGEXP '^[0-9]+$' DESC, CAST(r.route_number AS UNSIGNED), r.route_number`
  );
  if (rows.length < count) {
    throw new Error(`Chỉ có ${rows.length} tuyến đủ 2 chiều, không đủ cho ${count} tuyến`);
  }
  return rows.slice(0, count);
}

const toTime = s =>
  [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map(n => String(n).padStart(2, "0")).join(":");

// Tài xế thứ slot của tuyến: xuất bến 05:00 + slot×15' + k×60', đổi chiều sau mỗi chuyến
// → mỗi tuyến có chuyến 15 phút một lần, mỗi chiều 30 phút một lần
function buildSchedules(routeId, vehicleId, slot) {
  return Array.from({ length: TRIPS_PER_DRIVER }, (_, k) => [
    routeId,
    vehicleId,
    toTime(FIRST_DEPARTURE_S + slot * SLOT_GAP_S + k * TRIP_GAP_S),
    (slot + k) % 2 === 0 ? 1 : 2
  ]);
}
```

- [ ] **Step 3: Sửa `upsertDriver`**

Đổi chữ ký thành `async function upsertDriver(conn, i, route, slot, passwordHash)` và thay phần lịch trình cuối hàm:
```js
  // schedules không có bảng con → thay mới an toàn
  await conn.query("DELETE FROM schedules WHERE vehicle_id = ?", [vehicleId]);
  await conn.query(
    "INSERT INTO schedules (route_id, vehicle_id, departure_time, direction) VALUES ?",
    [buildSchedules(route.route_id, vehicleId, slot)]
  );
```
(phần upsert `users`/`vehicles` phía trên giữ nguyên.)

- [ ] **Step 4: Sửa `main`**

Thay đoạn từ `const pairs = await pickRoutePairs(conn, count);` tới hết vòng `for`:
```js
    const routes = await pickRoutes(conn, Math.ceil(count / DRIVERS_PER_ROUTE));
    const passwordHash = await bcrypt.hash(password, 10);

    await conn.beginTransaction();
    try {
      for (let i = 1; i <= count; i++) {
        const route = routes[Math.floor((i - 1) / DRIVERS_PER_ROUTE)];
        await upsertDriver(conn, i, route, (i - 1) % DRIVERS_PER_ROUTE, passwordHash);
      }
```
và thêm dòng log tuyến ngay sau `console.log(\`>>> [Seed] Xong: …\`)`:
```js
      console.log(`>>> [Seed] Tuyến: ${routes.map(r => r.route_number).join(", ")} (${DRIVERS_PER_ROUTE} tài xế/tuyến, ${TRIPS_PER_DRIVER} chuyến/tài xế)`);
```

- [ ] **Step 5: Chạy seed 2 lần và kiểm tra dữ liệu**

Run:
```bash
cd backend && npm run db:seed-drivers -- --count 20 && npm run db:seed-drivers -- --count 20
node -e '
const { dbPool } = require("./src/config/db");
(async () => {
  const [rows] = await dbPool.query(`SELECT s.route_id, s.direction, COUNT(*) n, MIN(s.departure_time) first, MAX(s.departure_time) last
    FROM schedules s WHERE s.vehicle_id LIKE "DRV\\_%" GROUP BY s.route_id, s.direction ORDER BY s.route_id, s.direction`);
  console.table(rows);
  const [[{ gaps }]] = await dbPool.query(`SELECT COUNT(DISTINCT departure_time) gaps FROM schedules WHERE vehicle_id LIKE "DRV\\_%" AND route_id = ?`, [rows[0].route_id]);
  console.log("giờ xuất bến khác nhau trên tuyến đầu:", gaps);
  await dbPool.end();
})();'
```
Expected: cả 2 lần seed in "Xong"; bảng có 10 dòng (5 tuyến × 2 chiều), mỗi dòng `n = 34`; tuyến đầu có `68` giờ xuất bến khác nhau (cứ 15 phút từ 05:00 tới 21:45).

- [ ] **Step 6: Commit**

```bash
git add backend/scripts/seed_drivers.js
git commit -m "feat(seed): 4 tài xế mỗi tuyến, 17 chuyến/ngày đổi chiều xen kẽ

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Simulator chọn chuyến theo giờ và tự đổi chuyến

**Files:**
- Create: `simulator/src/schedule.js`
- Create: `simulator/src/schedule.test.js`
- Modify: `simulator/src/virtual-driver.js` (`constructor`, `start`, `tick`; thêm `fetchRoute`, `switchTrip`)
- Test: `simulator/src/virtual-driver.test.js`

**Interfaces:**
- Consumes: `GET /driver/me` → `schedules: [{ schedule_id, route_id, direction, departure_time: "HH:MM" }]` (đã sắp theo giờ); server tự kết thúc chuyến cũ khi `trip:start` chuyến mới (Task 5).
- Produces:
  - `toMinutes("HH:MM") → number`; `vnMinutesOfDay(nowMs) → number`
  - `pickSchedule(schedules, nowMin) → schedule | null`; `nextSchedule(schedules, current) → schedule | null`
  - `VirtualDriver({ ..., now = Date.now })`

- [ ] **Step 1: Viết test `schedule.test.js` (fail)**

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const { toMinutes, vnMinutesOfDay, pickSchedule, nextSchedule } = require("./schedule");

const S = [
  { schedule_id: 3, departure_time: "07:00" },
  { schedule_id: 1, departure_time: "05:00" },
  { schedule_id: 2, departure_time: "06:00" }
];

test("toMinutes / vnMinutesOfDay", () => {
  assert.equal(toMinutes("06:30"), 390);
  assert.equal(vnMinutesOfDay(Date.UTC(2026, 9, 5, 3, 0, 0)), 600);    // 10:00 VN
  assert.equal(vnMinutesOfDay(Date.UTC(2026, 9, 5, 17, 5, 0)), 5);     // 00:05 VN
});

test("pickSchedule: trước chuyến đầu → chuyến đầu; giữa ngày → chuyến gần nhất đã tới giờ; sau chuyến cuối → chuyến cuối", () => {
  assert.equal(pickSchedule(S, 4 * 60).schedule_id, 1);
  assert.equal(pickSchedule(S, 6 * 60).schedule_id, 2);
  assert.equal(pickSchedule(S, 6 * 60 + 59).schedule_id, 2);
  assert.equal(pickSchedule(S, 23 * 60).schedule_id, 3);
  assert.equal(pickSchedule([], 600), null);
});

test("nextSchedule: chuyến kế tiếp theo giờ, hết thì null", () => {
  assert.equal(nextSchedule(S, S[1]).schedule_id, 2);
  assert.equal(nextSchedule(S, S[0]), null);
});
```

- [ ] **Step 2: Chạy test, xác nhận fail**

Run: `cd simulator && node --test src/schedule.test.js`
Expected: FAIL — `Cannot find module './schedule'`

- [ ] **Step 3: Viết `schedule.js`**

```js
// Chọn chuyến theo giờ Việt Nam (UTC+7 cố định, không phụ thuộc múi giờ của máy chạy simulator)
const VN_OFFSET_MIN = 7 * 60;
const DAY_MIN = 1440;

const toMinutes = hhmm => {
  const [h, m] = String(hhmm).split(":").map(Number);
  return h * 60 + m;
};
const vnMinutesOfDay = nowMs => (((Math.floor(nowMs / 60000) + VN_OFFSET_MIN) % DAY_MIN) + DAY_MIN) % DAY_MIN;
const byTime = (a, b) => toMinutes(a.departure_time) - toMinutes(b.departure_time);

// Chuyến hiện tại: xuất bến muộn nhất nhưng không sau giờ hiện tại; trước chuyến đầu ngày → chuyến đầu
function pickSchedule(schedules, nowMin) {
  const sorted = [...schedules].sort(byTime);
  let current = sorted[0] || null;
  for (const s of sorted) if (toMinutes(s.departure_time) <= nowMin) current = s;
  return current;
}

function nextSchedule(schedules, current) {
  const t = toMinutes(current.departure_time);
  return [...schedules].sort(byTime).find(s => toMinutes(s.departure_time) > t) || null;
}

module.exports = { toMinutes, vnMinutesOfDay, pickSchedule, nextSchedule };
```

- [ ] **Step 4: Chạy test, xác nhận pass**

Run: `cd simulator && node --test src/schedule.test.js`
Expected: PASS (3 tests)

- [ ] **Step 5: Viết test đổi chuyến trong `virtual-driver.test.js` (fail)**

Sửa `makeDriver` để ghi lại tham số `emitWithAck` và nhận `now`:
```js
function makeDriver(script, { now } = {}) {
  const driver = new VirtualDriver({ apiUrl: "http://x", username: "driver01", password: "p", log: () => {}, now });
  driver.schedule = { schedule_id: 1 };
  driver.plate = "X";
  const calls = { emitWithAck: 0, connect: 0, acks: [], emits: [] };
  driver.socket = {
    connected: true,
    active: false,
    auth: {},
    timeout: () => ({
      emitWithAck: async (...args) => {
        calls.acks.push(args);
        const step = script[Math.min(calls.emitWithAck++, script.length - 1)];
        if (step instanceof Error) throw step;
        return step;
      }
    }),
    emit: (...args) => calls.emits.push(args),
    connect: () => { calls.connect++; },
    disconnect: () => {}
  };
  return { driver, calls };
}
```
Thêm test cuối file:
```js
test("tới giờ xuất bến chuyến kế tiếp → nạp lộ trình chiều mới, distance = 0, trip:start chuyến mới", async t => {
  mockTimers(t);
  const VN_10H = Date.UTC(2026, 9, 5, 3, 0, 0);
  const { driver, calls } = makeDriver([OK_ACK], { now: () => VN_10H });
  const first = { schedule_id: 1, route_id: "R", direction: 1, departure_time: "09:00" };
  const second = { schedule_id: 2, route_id: "R", direction: 2, departure_time: "10:00" };
  driver.schedules = [first, second];
  driver.schedule = first;
  driver.trip = { route_number: "01", direction: 1 };
  driver.route = { totalDist: 1000 };
  driver.distance = 500;
  const paths = [];
  driver.api = async path => {
    paths.push(path);
    return { geometry: { type: "LineString", coordinates: [[106.70, 10.8], [106.71, 10.8]] } };
  };

  driver.tick();
  await flush();
  await flush();

  assert.deepEqual(paths, ["/routes/R/path?direction=2"]);
  assert.equal(driver.schedule, second);
  assert.equal(driver.distance, 0);
  assert.deepEqual(calls.acks[0], ["trip:start", { schedule_id: 2 }]);
  assert.equal(calls.emits.length, 0);   // tick đổi chuyến không phát gps_ping
  await driver.stop(false);
});

test("chưa tới giờ chuyến kế tiếp → tick phát gps_ping như thường", async t => {
  mockTimers(t);
  const VN_0930 = Date.UTC(2026, 9, 5, 2, 30, 0);
  const { driver, calls } = makeDriver([OK_ACK], { now: () => VN_0930 });
  driver.schedules = [
    { schedule_id: 1, route_id: "R", direction: 1, departure_time: "09:00" },
    { schedule_id: 2, route_id: "R", direction: 2, departure_time: "10:00" }
  ];
  driver.schedule = driver.schedules[0];
  driver.trip = { route_number: "01", direction: 1 };
  const { processRouteGeometry } = require("./route-geometry");
  driver.route = processRouteGeometry([[106.70, 10.8], [106.71, 10.8]]);
  driver.distance = 0;
  driver.baseSpeed = 30;
  driver.tick();
  assert.equal(calls.emits.length, 1);
  assert.equal(calls.emits[0][0], "gps_ping");
  await driver.stop(false);
});
```

- [ ] **Step 6: Chạy test, xác nhận fail**

Run: `cd simulator && node --test src/virtual-driver.test.js`
Expected: FAIL ở test "tới giờ xuất bến chuyến kế tiếp…" (`paths` rỗng, `driver.schedule` không đổi).

- [ ] **Step 7: Sửa `virtual-driver.js`**

Thêm import sau dòng `require("./route-geometry")`:
```js
const { toMinutes, vnMinutesOfDay, pickSchedule, nextSchedule } = require("./schedule");
```

Constructor nhận `now`:
```js
  constructor({ apiUrl, username, password, log = msg => console.log(`>>> [Simulator] ${msg}`), now = Date.now }) {
    Object.assign(this, { apiUrl, username, password, log, now });
    this.stopped = false;
    this.socket = null;
    this.timer = null;
    this.trip = null;
    this.relogged = false;
    this.switching = false;
    this.nextSwitchAttemptAt = 0;
  }
```

Thay thân `try` trong `start()` (từ `await this.login();` tới `this.connect();`):
```js
      await this.login();
      const me = await this.api("/driver/me");
      this.plate = me.vehicle.plate_number;
      this.schedules = me.schedules;
      this.schedule = pickSchedule(this.schedules, vnMinutesOfDay(this.now()));
      if (!this.schedule) return this.fail("xe chưa có lịch trình");

      this.route = await this.fetchRoute(this.schedule);
      if (!this.route) return this.fail("lộ trình không hợp lệ");

      // Xuất phát ở vị trí ngẫu nhiên để các xe không chồng lên nhau
      this.distance = Math.random() * this.route.totalDist;
      this.baseSpeed = 30 + Math.random() * 10;
      this.connect();
```

Thêm 2 method ngay sau `api(path)`:
```js
  async fetchRoute({ route_id, direction }) {
    const path = await this.api(`/routes/${encodeURIComponent(route_id)}/path?direction=${direction}`);
    const coords = path.geometry.type === "MultiLineString" ? path.geometry.coordinates.flat() : path.geometry.coordinates;
    return processRouteGeometry(coords);
  }

  // Tới giờ xuất bến chuyến kế tiếp → chạy từ đầu lộ trình chiều mới; server tự kết thúc chuyến cũ
  async switchTrip(next) {
    this.switching = true;
    try {
      const route = await this.fetchRoute(next);
      if (this.stopped) return;
      if (!route) {
        this.nextSwitchAttemptAt = this.now() + RETRY_MS;
        return this.log(`${this.username}: lộ trình chuyến ${next.departure_time} không hợp lệ → thử lại sau`);
      }
      Object.assign(this, { schedule: next, route, distance: 0, trip: null });
      this.log(`${this.username}: tới giờ chuyến ${next.departure_time} → đổi chuyến`);
      await this.beginTrip();
    } catch (err) {
      this.nextSwitchAttemptAt = this.now() + RETRY_MS;
      this.log(`${this.username}: không nạp được lộ trình chuyến mới (${err.message}) → thử lại sau ${RETRY_MS / 1000}s`);
    } finally {
      this.switching = false;
    }
  }
```

Thay đầu `tick()` (trước dòng `const speed = …`):
```js
  tick() {
    if (!this.trip || !this.socket?.connected || this.switching) return;
    const next = this.schedules ? nextSchedule(this.schedules, this.schedule) : null;
    const nowMs = this.now();
    if (next && toMinutes(next.departure_time) <= vnMinutesOfDay(nowMs) && nowMs >= this.nextSwitchAttemptAt) {
      this.switchTrip(next);
      return;
    }
```
(phần còn lại của `tick()` giữ nguyên.)

- [ ] **Step 8: Chạy toàn bộ test simulator**

Run: `cd simulator && npm run test:unit`
Expected: PASS toàn bộ (route-geometry, schedule, virtual-driver gồm 2 test mới).

- [ ] **Step 9: Commit**

```bash
git add simulator/src/schedule.js simulator/src/schedule.test.js simulator/src/virtual-driver.js simulator/src/virtual-driver.test.js
git commit -m "feat(simulator): chọn chuyến theo giờ VN và tự đổi chuyến khi tới giờ xuất bến

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Test tích hợp Module 4 (`test_suite.js`)

**Files:**
- Modify: `backend/test_suite.js` (Module 4, khoảng dòng 400–488)

**Interfaces:**
- Consumes: server chạy code Task 5–7 (khởi động lại), seed Task 7, `adminToken` đã có ở Module trước trong cùng file.

- [ ] **Step 1: Sửa Module 4**

Trong `backend/test_suite.js`, Module 4:

1. Thay
```js
    const viewer = openSocket("");
    await waitConnect(viewer);
    logPass("Kết nối viewer '/'", `Đã kết nối Socket.io tại ${SOCKET_URL}`);
```
bằng
```js
    // Nhân viên nhận mọi xe (room staff); khách chỉ nhận chuyến mình trip:watch
    const viewer = openSocket("", { token: adminToken });
    const guest = openSocket("");
    await Promise.all([waitConnect(viewer), waitConnect(guest)]);
    logPass("Kết nối viewer '/'", `Nhân viên + khách đã kết nối Socket.io tại ${SOCKET_URL}`);
```

2. Thay khối 4.3 phần sau `const trip = await dev…emitWithAck("trip:start", { schedule_id: sch1.schedule_id });` cho tới hết `logFail("Luồng GPS tài xế → viewer", …)` bằng:
```js
    const trip = await dev.timeout(3000).emitWithAck("trip:start", { schedule_id: sch1.schedule_id });
    const gotLocation = waitFor(viewer, "fleet_location_update", d => d.vehicle_id === vehicleId);
    const guestSilent = expectNone(guest, "fleet_location_update", d => d.vehicle_id === vehicleId);
    dev.emit("gps_ping", { vehicle_id: "DRV_99", latitude: 10.87052, longitude: 106.80196, speed_kmh: 35, heading: 90 });
    const loc = await gotLocation;
    if (trip.ok && loc.vehicle_id === vehicleId && loc.route_id === sch1.route_id && loc.schedule_id === sch1.schedule_id && loc.timestamp) {
      logPass("Luồng GPS tài xế → nhân viên", `Xe ${loc.plate_number} | Tuyến ${loc.route_number} | chuyến ${loc.schedule_id} (vehicle_id giả bị bỏ)`);
    } else {
      logFail("Luồng GPS tài xế → nhân viên", JSON.stringify({ trip, loc }));
    }
    if (await guestSilent) logPass("Khách chưa chọn chuyến", "Không nhận vị trí xe nào");
    else logFail("Khách chưa chọn chuyến", "Khách nhận được vị trí khi chưa trip:watch!");

    // 4.3b Khách xem danh sách chuyến của tuyến (không tọa độ) rồi theo dõi đúng chuyến đang chạy
    const subscribed = await guest.timeout(3000).emitWithAck("trips:subscribe", { route_id: sch1.route_id, direction: sch1.direction });
    const listed = subscribed.ok && subscribed.trips.find(x => x.schedule_id === sch1.schedule_id);
    if (listed && listed.status === "RUNNING" && !/longitude|latitude/.test(JSON.stringify(subscribed.trips))) {
      logPass("trips:subscribe", `${subscribed.trips.length} chuyến, chuyến ${sch1.schedule_id} đang chạy, không lộ tọa độ`);
    } else {
      logFail("trips:subscribe", JSON.stringify(subscribed));
    }
    const watched = await guest.timeout(3000).emitWithAck("trip:watch", { schedule_id: sch1.schedule_id });
    await sleep(300);
    const guestLocation = waitFor(guest, "fleet_location_update", d => d.vehicle_id === vehicleId);
    dev.emit("gps_ping", { latitude: 10.8706, longitude: 106.8020, speed_kmh: 35, heading: 90 });
    const guestLoc = await guestLocation;
    if (watched.ok && guestLoc.schedule_id === sch1.schedule_id) {
      logPass("trip:watch", `Khách nhận đúng xe ${guestLoc.plate_number} của chuyến ${sch1.schedule_id}`);
    } else {
      logFail("trip:watch", JSON.stringify({ watched, guestLoc }));
    }
```

3. Trong 4.6, đổi tiêu đề `logPass("Kết thúc chuyến", …)` thành:
```js
    logPass("Kết thúc chuyến", `Nhân viên nhận vehicle_offline cho ${vehicleId}`);
```

- [ ] **Step 2: Khởi động lại backend và chạy test suite**

Run:
```bash
kill $(lsof -tiTCP:3000 -sTCP:LISTEN) 2>/dev/null; sleep 1
cd /Users/viktornguyen/Desktop/viktor/bus-gis-tracking/backend && (nohup node server.js > server.log 2>&1 &) && sleep 2 && tail -3 server.log
node test_suite.js 2>&1 | tail -40
```
Expected: Module 4 toàn PASS (gồm "Khách chưa chọn chuyến", "trips:subscribe", "trip:watch"); tổng số FAIL = 0. Nếu module khác FAIL, so với baseline 42 pass trước khi sửa — không được giảm.

- [ ] **Step 3: Commit**

```bash
git add backend/test_suite.js
git commit -m "test(socket): module 4 theo giao thức room — nhân viên, khách watch, trips:subscribe

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Frontend — socket theo vai trò (nhân viên thấy tất cả, khách không thấy gì)

**Files:**
- Modify: `frontend/src/modules/realtime/realtime.service.js`
- Modify: `frontend/src/views/map/map.state.js`
- Modify: `frontend/src/views/map/features/fleet-tracking.js` (`initSocketRealtime`, `onFleetLocationUpdate`, `onVehicleOffline`; thêm `connectFleetSocket`, `getFleetSocket`, `onFleetEvent`, `clearFleet`)
- Modify: `frontend/src/views/map/features/staff-auth.js` (`applyAuthState`)
- Modify: `frontend/src/views/map/map.view.js`
- Modify: `frontend/src/views/map/sections/fleet-dashboard.html`
- Modify: `frontend/src/views/driver/features/drive-map.js` (`openDrive`)

**Interfaces:**
- Consumes: giao thức socket Task 6.
- Produces (cho Task 11):
  - `state.isStaff: boolean`, `state.watchedScheduleId: number | null`
  - `connectFleetSocket(token | null) → socket` — ngắt socket cũ, xóa xe trên bản đồ, kết nối mới
  - `getFleetSocket() → socket | null`
  - `onFleetEvent(name: "connect" | "offline" | "tripsUpdate", fn)`
  - `clearFleet()` — gỡ mọi xe khỏi bản đồ + cache hoạt họa
  - DOM: `#guestTripInfo` (ẩn mặc định) chứa `#busDriver`, `#busDeparture`, `#busEta`; `#nextStopBlock` (khối trạm tiếp theo)

- [ ] **Step 1: `realtime.service.js`**

Thay toàn file:
```js
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
```

- [ ] **Step 2: `map.state.js`**

Thêm 2 thuộc tính vào `state`, sau `selectedTrackedVehicleId: null,`:
```js
  isStaff: false,
  watchedScheduleId: null,      // Chuyến khách đang theo dõi (khách chỉ thấy đúng 1 xe này)
```

- [ ] **Step 3: `fleet-tracking.js` — kết nối theo token + hook sự kiện**

Thay khối khai báo socket ở đầu file:
```js
let socketInstance = null;
```
bằng:
```js
let socketInstance = null;
// Hook cho các feature khác (trip-watch của khách) mà không import vòng
const fleetListeners = { connect: [], offline: [], tripsUpdate: [] };
export function onFleetEvent(name, fn) {
  fleetListeners[name].push(fn);
}
const emitFleetEvent = (name, data) => fleetListeners[name].forEach(fn => fn(data));
export const getFleetSocket = () => socketInstance;
```

Thêm hàm `clearFleet` ngay sau `applyFleetFilter`:
```js
// Gỡ mọi xe khỏi bản đồ (đổi vai trò, khách đổi chuyến theo dõi)
export function clearFleet() {
  if (map.fleetLayer) map.fleetLayer.removeAll();
  Object.keys(state.busGraphics).forEach(id => delete state.busGraphics[id]);
  Object.keys(busAnimStates).forEach(id => delete busAnimStates[id]);
  Object.keys(busCurrentPositions).forEach(id => delete busCurrentPositions[id]);
  state.selectedTrackedVehicleId = null;
}
```

Trong `onFleetLocationUpdate`, ngay sau dòng `if (!data || !data.vehicle_id || !map.fleetLayer) return;` thêm:
```js
  // Khách chỉ hiện đúng chuyến đang theo dõi (server đã lọc theo room; chặn thêm ở client)
  if (!state.isStaff && data.schedule_id !== state.watchedScheduleId) return;
```

Trong `onVehicleOffline`, đổi chữ ký và thêm phát sự kiện ở cuối:
```js
function onVehicleOffline({ vehicle_id, schedule_id } = {}) {
  const g = state.busGraphics[vehicle_id];
  if (g && map.fleetLayer) map.fleetLayer.remove(g);
  delete state.busGraphics[vehicle_id];
  delete busAnimStates[vehicle_id];
  delete busCurrentPositions[vehicle_id];
  if (state.selectedTrackedVehicleId === vehicle_id) state.selectedTrackedVehicleId = null;
  emitFleetEvent("offline", { vehicle_id, schedule_id });
}
```

Thay `initSocketRealtime` bằng:
```js
// Kết nối (lại) theo vai trò: nhân viên gửi token để vào room staff, khách kết nối không token.
// Mỗi lần đổi vai trò dùng socket mới → không còn giữ room của vai trò cũ.
export function connectFleetSocket(token) {
  if (socketInstance) socketInstance.disconnect();
  clearFleet();
  try {
    socketInstance = connectRealtime({
      token,
      onConnect: () => {
        setConnectionStatus("ONLINE", "badge-status");
        emitFleetEvent("connect");
      },
      onDisconnect: () => setConnectionStatus("OFFLINE", "badge-status badge-disconnected"),
      onFleetUpdate: onFleetLocationUpdate,
      onVehicleOffline,
      onTripsUpdate: data => emitFleetEvent("tripsUpdate", data)
    });
  } catch (err) {
    console.warn("Lỗi kết nối Socket:", err);
    socketInstance = null;
  }
  return socketInstance;
}
```

- [ ] **Step 4: `fleet-dashboard.html`**

Thêm `id="nextStopBlock"` cho khối trạm tiếp theo:
```html
  <div class="next-stop-highlight" id="nextStopBlock">
```
Và chèn khối thông tin chuyến của khách ngay **trước** `<!-- Trạm tiếp theo sắp tới -->`:
```html
  <!-- Chỉ khách đang theo dõi 1 chuyến -->
  <div id="guestTripInfo" style="display: none;">
    <div class="info-row">
      <b>Tài xế:</b>
      <span id="busDriver" style="font-weight: 600; color: #0f172a;">--</span>
    </div>
    <div class="info-row">
      <b>Giờ xuất bến:</b>
      <span id="busDeparture" style="font-weight: 600; color: #0f172a;">--</span>
    </div>
    <div class="next-stop-highlight">
      <div style="font-size: 11px; color: #1e40af; font-weight: bold; margin-bottom: 2px;">
        <i class="fa-solid fa-clock"></i> DỰ KIẾN TỚI TRẠM CỦA BẠN:
      </div>
      <div id="busEta" style="font-weight: 700; color: #0369a1; font-size: 12.5px;">--</div>
    </div>
  </div>
```

- [ ] **Step 5: `staff-auth.js` — kết nối socket theo vai trò**

Sửa import fleet-tracking:
```js
import { applyFleetFilter, connectFleetSocket } from "./fleet-tracking.js";
```
Thêm import trạng thái và token:
```js
import { getToken, setToken, clearToken } from "../../../core/session.js";
```
(dòng này đã có — giữ nguyên.)

Trong `applyAuthState(user)`, ngay sau `show("guestTripPanel", !isStaff);` thêm:
```js
  // Bảng "Theo dõi xe": nhân viên luôn thấy; khách chỉ thấy khi đang theo dõi 1 chuyến
  show("fleetDashboard", isStaff, "block");
  show("nextStopBlock", isStaff, "block");
  show("guestTripInfo", false, "block");
  state.isStaff = isStaff;
  state.watchedScheduleId = null;
  connectFleetSocket(isStaff ? getToken() : null);
```

- [ ] **Step 6: `map.view.js`**

Xóa dòng import `import { initSocketRealtime } from "./features/fleet-tracking.js";` và dòng gọi `initSocketRealtime();` ở cuối file; sửa comment cuối thành:
```js
// Chọn sidebar theo vai trò, nạp dữ liệu bản đồ & kết nối realtime theo vai trò (không yêu cầu đăng nhập)
await createBaseMap();
initSidebarForRole();
```

- [ ] **Step 7: `drive-map.js` — gửi token tài xế**

Thêm import:
```js
import { getToken } from "../../../core/session.js";
import { DRIVER_TOKEN_KEY } from "../../../core/config.js";
```
Trong `openDrive()`, thêm `token` vào `connectRealtime`:
```js
  ctx.socket = connectRealtime({
    token: getToken(DRIVER_TOKEN_KEY),
    onConnect: () => setBadge("connBadge", "ONLINE", "badge-on"),
```
và sửa comment trên `onFleetUpdate`:
```js
// Vị trí xe mình lấy từ room vehicle:<id> (server cho vào theo token) → đúng dù GPS đến từ điện thoại hay simulator
```

- [ ] **Step 8: Kiểm tra thủ công bằng Playwright**

Khởi động lại backend (Global Constraints), chạy simulator nền: `cd simulator && (nohup npm start -- --count 8 > /tmp/claude-sim.log 2>&1 &)`.
Dùng Playwright (Chromium) mở `http://localhost:3000/`:
1. Khách: chờ 3 giây; `page.evaluate(() => document.querySelector('#fleetDashboard').style.display)` → `"none"`; chụp ảnh màn hình — không có chấm đỏ.
2. Đăng nhập `admin` / `admin123` → sau 3 giây chụp ảnh — thấy nhiều chấm đỏ; `#fleetDashboard` hiện.
3. Đăng xuất → chụp ảnh — không còn chấm đỏ.
4. Mở `http://localhost:3000/driver.html`, đăng nhập `driver01` / `driver123`, chọn chuyến bất kỳ → thấy xe của mình (simulator đang chạy driver01), badge nguồn "Thiết bị khác".
Expected: đúng như mô tả ở từng bước. Ghi lại ảnh chụp vào scratchpad, không commit ảnh.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/modules/realtime/realtime.service.js frontend/src/views/map/map.state.js frontend/src/views/map/features/fleet-tracking.js frontend/src/views/map/features/staff-auth.js frontend/src/views/map/map.view.js frontend/src/views/map/sections/fleet-dashboard.html frontend/src/views/driver/features/drive-map.js
git commit -m "feat(map): kết nối socket theo vai trò — nhân viên thấy đội xe, khách chưa thấy xe nào

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Frontend — khách chọn chuyến, theo dõi 1 xe, ETA

**Files:**
- Create: `frontend/src/views/map/features/trip-finder/trip-watch.js`
- Modify: `frontend/src/views/map/features/trip-finder/trip-finder.js` (`renderTripResults`, thêm `openTripList`, `renderTripSchedules`, `renderGuestDashboard`)
- Modify: `frontend/src/views/map/features/staff-auth.js` (gọi `resetTripWatch`)
- Modify: `frontend/assets/css/map.css`

**Interfaces:**
- Consumes (Task 10): `getFleetSocket`, `onFleetEvent`, `clearFleet`, `state.isStaff`, `state.watchedScheduleId`, DOM `#guestTripInfo`, `#busDriver`, `#busDeparture`, `#busEta`, `#busRouteName`, `#busPlate`, `#fleetDashboard`.
- Produces:
  - `subscribeTrips({ route_id, direction, board_stop_id }) → Promise<ack | null>`
  - `watchTrip(scheduleId) → Promise<ack>`
  - `clearTripWatch()`; `resetTripWatch()`
  - `onTripWatchChange(fn({ trips, watchedScheduleId, ended, error }))`
  - `getWatchedTrip() → Trip | null`

- [ ] **Step 1: Tạo `trip-watch.js`**

```js
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
```

- [ ] **Step 2: `trip-finder.js` — import**

Thêm sau các import hiện có:
```js
import { subscribeTrips, watchTrip, clearTripWatch, onTripWatchChange, getWatchedTrip } from "./trip-watch.js";
```

- [ ] **Step 3: `trip-finder.js` — hàm hiển thị danh sách chuyến và bảng theo dõi**

Thêm trước `function renderTripResults(data, position)`:
```js
const STATUS_LABEL = { RUNNING: "Đang chạy", UPCOMING: "Sắp xuất bến", PASSED: "Đã qua trạm của bạn" };
let activeTripResult = null;

const formatClock = iso =>
  new Date(iso).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Ho_Chi_Minh" });
const etaText = t => (t.eta_board ? `~${formatClock(t.eta_board)} (${t.minutes_to_board} phút)` : "");

function renderTripSchedules({ trips, watchedScheduleId, error }) {
  const list = document.querySelector("#tripResults .trip-card.active .trip-schedules");
  if (!list) return;
  if (error) {
    list.innerHTML = `<li class="trip-empty">Không tải được danh sách chuyến</li>`;
    return;
  }
  if (trips.length === 0) {
    list.innerHTML = `<li class="trip-empty">Hiện không có chuyến nào trong 2 giờ tới</li>`;
    return;
  }
  list.innerHTML = "";
  trips.forEach(t => {
    const li = document.createElement("li");
    const passed = t.status === "PASSED";
    li.className = `trip-schedule${passed ? " passed" : ""}${t.schedule_id === watchedScheduleId ? " active" : ""}`;
    li.innerHTML = `
      <div class="trip-schedule-main"><b>${escapeHtml(t.departure_time)}</b> · ${escapeHtml(t.plate_number)} · ${escapeHtml(t.driver_name || "")}</div>
      <div class="trip-schedule-meta">
        <span class="trip-status ${t.status.toLowerCase()}">${STATUS_LABEL[t.status]}</span>
        <span class="trip-eta">${escapeHtml(etaText(t))}</span>
      </div>`;
    if (!passed) {
      li.onclick = e => {
        e.stopPropagation();
        watchTrip(t.schedule_id);
      };
    }
    list.appendChild(li);
  });
}

// Bảng "Theo dõi xe" của khách: chỉ hiện khi đang theo dõi 1 chuyến
function renderGuestDashboard({ watchedScheduleId, ended }) {
  if (state.isStaff) return;
  const visible = watchedScheduleId !== null;
  document.getElementById("fleetDashboard").style.display = visible ? "block" : "none";
  document.getElementById("guestTripInfo").style.display = visible ? "block" : "none";
  if (!visible) return;

  const trip = getWatchedTrip();
  if (activeTripResult) document.getElementById("busRouteName").innerText = `Tuyến ${activeTripResult.route_number}`;
  if (trip) {
    document.getElementById("busPlate").innerText = trip.plate_number;
    document.getElementById("busDriver").innerText = trip.driver_name || "--";
    document.getElementById("busDeparture").innerText = trip.departure_time;
  }
  let eta = "--";
  if (ended) eta = "Chuyến đã kết thúc";
  else if (trip && trip.status === "PASSED") eta = "Xe đã qua trạm của bạn";
  else if (trip && trip.status === "UPCOMING") eta = `Chưa xuất bến — dự kiến ${trip.departure_time}${trip.eta_board ? ` · tới trạm ${etaText(trip)}` : ""}`;
  else if (trip && trip.eta_board) eta = etaText(trip);
  document.getElementById("busEta").innerText = eta;
}

onTripWatchChange(change => {
  renderTripSchedules(change);
  renderGuestDashboard(change);
});

function openTripList(card, result) {
  document.querySelectorAll("#tripResults .trip-schedules").forEach(el => el.remove());
  const list = document.createElement("ul");
  list.className = "trip-schedules";
  list.innerHTML = `<li class="trip-empty"><i class="fa-solid fa-spinner fa-spin"></i> Đang tải chuyến...</li>`;
  card.appendChild(list);
  activeTripResult = result;
  ["busPlate", "busDriver", "busDeparture", "busSpeed"].forEach(id => { document.getElementById(id).innerText = "--"; });
  subscribeTrips({
    route_id: result.route_id,
    direction: result.direction,
    board_stop_id: result.board_stop ? result.board_stop.stop_id : null
  });
}
```

- [ ] **Step 4: `trip-finder.js` — nối vào luồng tìm tuyến**

Trong `renderTripResults`, ngay sau dòng `lastTripResults = data.results || [];` thêm:
```js
  clearTripWatch();
  activeTripResult = null;
```
Thay `li.onclick` của thẻ tuyến:
```js
    li.onclick = () => {
      if (li.classList.contains("active")) return;   // bấm lại thẻ đang mở (vd. vùng trống của danh sách chuyến)
      resultsEl.querySelectorAll(".trip-card").forEach(c => c.classList.remove("active"));
      li.classList.add("active");
      clearTripWatch();
      showTripOnMap(lastTripResults[idx], data.destination, position);
      openTripList(li, lastTripResults[idx]);
    };
```

- [ ] **Step 5: `staff-auth.js` — xóa trạng thái khách khi đổi vai trò**

Sửa import trip-finder và thêm import trip-watch:
```js
import { loadStopIndex, hasStopIndex, clearTripLayer } from "./trip-finder/trip-finder.js";
import { resetTripWatch } from "./trip-finder/trip-watch.js";
```
Trong `applyAuthState`, thay hai dòng `state.watchedScheduleId = null;` và `connectFleetSocket(...)` (thêm ở Task 10) bằng:
```js
  resetTripWatch();
  connectFleetSocket(isStaff ? getToken() : null);
```
và trong nhánh khách, sau `clearRouteGraphics();` thêm:
```js
    document.querySelectorAll("#tripResults .trip-card.active").forEach(c => c.classList.remove("active"));
    document.querySelectorAll("#tripResults .trip-schedules").forEach(el => el.remove());
```

- [ ] **Step 6: CSS**

Thêm vào `frontend/assets/css/map.css` ngay sau quy tắc `.trip-empty { … }`:
```css
.trip-schedules {
  list-style: none;
  margin: 8px 0 0;
  padding: 8px 0 0;
  border-top: 1px dashed #e2e8f0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  cursor: default;
}
.trip-schedule {
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 6px 8px;
  cursor: pointer;
  background: #f8fafc;
}
.trip-schedule:hover { border-color: #0079c1; }
.trip-schedule.active { border-color: #0079c1; background: #eff6ff; }
.trip-schedule.passed { opacity: 0.5; cursor: not-allowed; }
.trip-schedule.passed:hover { border-color: #e2e8f0; }
.trip-schedule-main { color: #1e293b; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.trip-schedule-meta { display: flex; justify-content: space-between; gap: 8px; margin-top: 3px; font-size: 11px; }
.trip-status { font-weight: 700; border-radius: 4px; padding: 0 6px; }
.trip-status.running { background: #dcfce7; color: #166534; }
.trip-status.upcoming { background: #e0f2fe; color: #075985; }
.trip-status.passed { background: #f1f5f9; color: #64748b; }
.trip-eta { color: #0369a1; font-weight: 600; }
```

- [ ] **Step 7: Kiểm tra thủ công bằng Playwright**

Backend chạy code mới (khởi động lại), simulator nền `--count 20`. Dùng Playwright (Chromium) với geolocation giả lập tại trạm đầu tuyến của `driver01` (lấy tọa độ: `curl -s "localhost:3000/api/v1/routes/<route_id>/stops?direction=1" | head -c 400`, route_id từ `curl -s -H "Authorization: Bearer <token driver01>" localhost:3000/api/v1/driver/me`) và quyền `geolocation`:
1. Mở `http://localhost:3000/` → không chấm đỏ, `#fleetDashboard` ẩn.
2. Nhập tên trạm cuối tuyến đó vào `#destInput`, chọn gợi ý → có thẻ tuyến. Bấm thẻ tuyến → danh sách `.trip-schedule` xuất hiện với nhãn "Đang chạy"/"Sắp xuất bến", có ETA dạng `~HH:MM (X phút)`; bản đồ chỉ có lộ trình, **không chấm đỏ**.
3. Bấm một dòng "Đang chạy" → trong ≤ 2 giây có **đúng 1** chấm đỏ; `#fleetDashboard` hiện tài xế, biển số, giờ xuất bến, ETA.
4. DevTools Protocol: bắt khung WS (`page.on("websocket")` → `framereceived`) trong 10 giây → mọi `fleet_location_update` đều có `schedule_id` của dòng đã chọn; không khung `trips:update` nào chứa `longitude`.
5. Chờ 16 giây không thao tác → có ít nhất 1 khung `trips:update` (đẩy định kỳ), không có request HTTP polling mới (`page.on("request")` không thấy `/schedules`).
6. Bấm một dòng "Sắp xuất bến" → chấm đỏ cũ biến mất; bảng ghi "Chưa xuất bến — dự kiến HH:MM".
7. Tìm điểm đến khác → danh sách chuyến và chấm đỏ biến mất, bảng ẩn.
Expected: đúng từng bước. Lỗi console trình duyệt = 0.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/views/map/features/trip-finder/trip-watch.js frontend/src/views/map/features/trip-finder/trip-finder.js frontend/src/views/map/features/staff-auth.js frontend/assets/css/map.css
git commit -m "feat(map): khách chọn chuyến trong tuyến, theo dõi đúng 1 xe kèm ETA tới trạm lên

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Tài liệu

**Files:**
- Modify: `docs/SOCKET_IO_TRACKING.md`
- Modify: `README.md`
- Modify: `ARCHITECTURE_SPEC.md`
- Modify: `docs/USE_CASES.md`

- [ ] **Step 1: `docs/SOCKET_IO_TRACKING.md`**

1. Sau khối "## Kiến trúc sau nhóm A" (trước bảng "| Thành phần | File |"), thêm:
````markdown
## Kiến trúc sau "khách theo dõi 1 chuyến"

```
                                             ┌─► room trip:<schedule_id>  ─► khách đã trip:watch (đúng 1 xe)
"/device" ─► device.socket.js ─► broadcaster ┼─► room vehicle:<vehicle_id> ─► trang tài xế (token DRIVER)
             │                               └─► room staff               ─► nhân viên (token ADMIN/MANAGER)
             └─► trip-registry.js (chuyến đang chạy + mẫu vận tốc) ─► trip-list.js (ETA) ─► room route:<id>:<dir> ─► trips:update
```

| Sự kiện client → "/" | Ack |
|---|---|
| `trips:subscribe {route_id, direction, board_stop_id?}` | `{ok, trips}` / `BAD_REQUEST` / `SERVER_ERROR` |
| `trips:unsubscribe` | — |
| `trip:watch {schedule_id}` | `{ok, status}` / `TRIP_NOT_AVAILABLE` / `SERVER_ERROR` |
| `trip:unwatch` | — |
````
2. Thêm vào bảng thành phần:
```markdown
| Registry chuyến + ETA | [trip-registry.js](../backend/src/sockets/trip-registry.js), [trip-list.js](../backend/src/sockets/trip-list.js), [eta.js](../backend/src/sockets/eta.js), [route-geometry.js](../backend/src/sockets/route-geometry.js) |
| Khách theo dõi chuyến | [trip-watch.js](../frontend/src/views/map/features/trip-finder/trip-watch.js) |
| Test viewer | [viewer.socket.test.js](../backend/src/sockets/viewer.socket.test.js) |
```
3. Bảng tổng quan: dòng #4 cột trạng thái `TODO` → `DONE`; dòng #5 thêm vào cột vấn đề ` (khách: không còn — mỗi chuyến 1 chiều)`.
4. Mục "### #4 … — `TODO`" → `— \`DONE\``, thay danh sách "Hướng sửa" bằng:
```markdown
- **Đã sửa:** device phát vào room `trip:<schedule_id>`, `vehicle:<vehicle_id>`, `staff` thay vì mọi viewer. Khách chỉ nhận chuyến đã `trip:watch` (1 chuyến/socket); danh sách chuyến của tuyến đi qua `trips:subscribe` và không chứa tọa độ.
- **Còn lại (chưa làm):** `gps_batch` cho simulator, `io.volatile`, snapshot cho nhân viên ở chế độ "ALL".
```
5. Bảng "Nhật ký thay đổi", thêm dòng:
```markdown
| 2026-10-05 | #4, #5 (khách) | Room theo chuyến/xe/staff; khách chọn tuyến → chọn chuyến → thấy đúng 1 xe; ETA tới trạm lên theo vận tốc thực tế, đẩy qua socket; seed 4 tài xế/tuyến; simulator tự đổi chuyến | nhánh `feat/guest-trip-tracking` |
```

- [ ] **Step 2: `README.md`**

1. Dòng cây thư mục `sockets/`: thay chú thích bằng
`# index.js, viewer.socket.js ("/" theo room: trip/vehicle/staff/route), device.socket.js + device.auth.js ("/device" tài xế), trip-registry.js, trip-list.js, eta.js, route-geometry.js, gps.validate.js, tracking-log.js`
2. Mục "### 3. Tài khoản tài xế & nguồn GPS": thay dòng lệnh seed bằng
```bash
cd backend && npm run db:seed-drivers -- --count 20   # driver01..driver20 / mật khẩu driver123, xe DRV_01..DRV_20, 4 tài xế/tuyến → 5 tuyến
```
và thêm ngay sau khối lệnh:
```markdown
Mỗi tài xế có 17 chuyến/ngày (05:00 + slot×15' + k×60'), đổi chiều sau mỗi chuyến: mỗi tuyến có chuyến 15 phút một lần, mỗi chiều 30 phút một lần. Simulator chọn chuyến theo giờ Việt Nam và tự đổi chuyến khi tới giờ xuất bến.

**Bản đồ công khai:** khách chưa chọn tuyến thì không thấy xe nào. Chọn điểm đến → bấm thẻ tuyến → danh sách chuyến đang chạy/sắp tới kèm ETA tới trạm lên → bấm 1 chuyến để thấy đúng xe đó. Nhân viên đăng nhập thấy toàn đội xe.
```

- [ ] **Step 3: `ARCHITECTURE_SPEC.md`**

Thay dòng ghi chú ở đầu file (dòng 5):
```markdown
> Hub realtime nay nằm ở `backend/src/sockets/`: `/device` cho tài xế đã xác thực phát GPS; `/` phát theo room (`trip:<schedule_id>` cho khách đã chọn chuyến, `vehicle:<id>` cho trang tài xế, `staff` cho nhân viên, `route:<id>:<dir>` cho danh sách chuyến + ETA). Mã `io.emit` bên dưới là phiên bản cũ, giữ để đối chiếu.
```

- [ ] **Step 4: `docs/USE_CASES.md`**

Thay toàn bộ mục `#### UC-05 — Theo dõi xe buýt realtime` (tới trước `#### UC-06`) bằng:
```markdown
#### UC-05 — Theo dõi xe buýt realtime

- **Tác nhân:** Khách, Nhân viên.
- **Mục tiêu:** Khách theo dõi đúng chuyến xe mình định đi và biết khi nào xe tới trạm; nhân viên giám sát toàn đội xe.
- **Tiền điều kiện:** Backend đang chạy và có **Nguồn GPS** (UC-19, UC-23). Có lịch trình (`schedules`) cho tuyến.
- **Luồng chính (Khách):**
  1. Mở bản đồ: không có xe nào, bảng "Theo dõi xe" ẩn.
  2. Tìm tuyến (UC-03) rồi bấm một thẻ tuyến: bản đồ chỉ vẽ lộ trình; dưới thẻ hiện danh sách chuyến **đang chạy** và **sắp tới** (giờ xuất bến trong 2 giờ tới, hoặc trễ ≤ 15 phút), mỗi dòng có giờ xuất bến, biển số, tài xế, nhãn trạng thái và **ETA tới trạm lên** (`~HH:MM (X phút)`).
  3. Bấm một chuyến: bản đồ hiện **đúng 1 xe** của chuyến đó; bảng "Theo dõi xe" hiện tuyến, biển số, tài xế, tốc độ, giờ xuất bến và ETA.
  4. ETA và trạng thái tự cập nhật (server đẩy `trips:update` mỗi 15 giây và ngay khi chuyến bắt đầu/kết thúc).
- **Luồng chính (Nhân viên):** đăng nhập (UC-06) → thấy mọi xe đang chạy; chọn tuyến (UC-07) để lọc.
- **Luồng thay thế:**
  - Chọn chuyến chưa xuất bến → bảng ghi "Chưa xuất bến — dự kiến HH:MM"; xe tự hiện khi tài xế bắt đầu chuyến.
  - Xe đã qua trạm lên → dòng mờ "Đã qua trạm của bạn", không chọn được; nếu đang theo dõi thì bảng ghi "Xe đã qua trạm của bạn".
  - Khách không bật định vị (không có trạm lên) → danh sách không có ETA.
- **Luồng ngoại lệ:**
  - Mất kết nối → nhãn **OFFLINE**; kết nối lại thì tự đăng ký lại danh sách và chuyến đang theo dõi.
  - Chuyến kết thúc / không còn công khai → gỡ xe, bảng ghi "Chuyến đã kết thúc".
- **Ghi chú:** ETA = quãng đường dọc lộ trình tới trạm lên ÷ vận tốc thực tế của xe (quãng đã đi trong 5 phút gần nhất, kẹp 5–60 km/h). Chuyến sắp tới dùng vận tốc trung bình của các xe đang chạy cùng tuyến (mặc định 20 km/h).
- **Code:** [trip-watch.js](../frontend/src/views/map/features/trip-finder/trip-watch.js), [trip-finder.js](../frontend/src/views/map/features/trip-finder/trip-finder.js), [fleet-tracking.js](../frontend/src/views/map/features/fleet-tracking.js), [viewer.socket.js](../backend/src/sockets/viewer.socket.js), [trip-list.js](../backend/src/sockets/trip-list.js).
```

- [ ] **Step 5: Kiểm tra liên kết tương đối**

Run:
```bash
cd /Users/viktornguyen/Desktop/viktor/bus-gis-tracking
for f in backend/src/sockets/trip-registry.js backend/src/sockets/trip-list.js backend/src/sockets/eta.js backend/src/sockets/route-geometry.js backend/src/sockets/viewer.socket.test.js frontend/src/views/map/features/trip-finder/trip-watch.js; do test -f "$f" && echo "OK $f" || echo "MISSING $f"; done
```
Expected: toàn `OK`.

- [ ] **Step 6: Commit**

```bash
git add docs/SOCKET_IO_TRACKING.md README.md ARCHITECTURE_SPEC.md docs/USE_CASES.md
git commit -m "docs: giao thức room, luồng khách theo dõi 1 chuyến kèm ETA, seed mới

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
