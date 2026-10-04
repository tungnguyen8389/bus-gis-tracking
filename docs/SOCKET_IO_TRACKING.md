# Socket.io — Theo dõi vấn đề & tiến độ sửa

> Kết quả rà soát ngày 2026-10-04. Cập nhật cột **Trạng thái** và mục **Nhật ký thay đổi** mỗi khi sửa.
>
> Trạng thái: `TODO` · `DOING` · `DONE` · `SKIP`

## Kiến trúc lúc rà soát (trước nhóm A)

```
simulator.js ──gps_ping──► tracking.socket.js ──io.emit("fleet_location_update")──► MỌI client
                                   │                                                    │
                                   └── INSERT vehicle_tracking_logs (lỗi bị nuốt)        └── fleet-tracking.js tự lọc tuyến + animate
```

## Kiến trúc sau nhóm A

```
driver.html (GPS điện thoại) ┐                              ┌─► "/" fleet_location_update, vehicle_offline ─► index.html, driver.html
                             ├─ "/device" (JWT DRIVER) ─► device.socket.js ┤
simulator/ (tài xế ảo)       ┘  trip:start · gps_ping · trip:end            └─► tracking-log.js (≤ 1 bản ghi / xe / 5 s)
```

| Thành phần | File |
|---|---|
| Khởi tạo Socket server | [backend/server.js](../backend/server.js) |
| Đăng ký namespace | [backend/src/sockets/index.js](../backend/src/sockets/index.js) |
| Viewer "/" (chỉ phát xuống) | [backend/src/sockets/viewer.socket.js](../backend/src/sockets/viewer.socket.js) |
| Thiết bị "/device" | [device.auth.js](../backend/src/sockets/device.auth.js), [device.socket.js](../backend/src/sockets/device.socket.js), [gps.validate.js](../backend/src/sockets/gps.validate.js), [tracking-log.js](../backend/src/sockets/tracking-log.js) |
| Simulator GPS (công cụ demo, độc lập) | [simulator/](../simulator/) |
| Client viewer | [frontend/src/modules/realtime/realtime.service.js](../frontend/src/modules/realtime/realtime.service.js) |
| Client thiết bị (trang tài xế) | [frontend/src/modules/realtime/device.service.js](../frontend/src/modules/realtime/device.service.js), [phone-gps.js](../frontend/src/views/driver/features/phone-gps.js) |
| Render đội xe trên bản đồ | [frontend/src/views/map/features/fleet-tracking.js](../frontend/src/views/map/features/fleet-tracking.js) |
| Test socket | [device.socket.test.js](../backend/src/sockets/device.socket.test.js), [backend/test_suite.js](../backend/test_suite.js) (module 4) |

Số liệu DB thật lúc rà soát: `vehicles` = 0, `schedules` = 0, `route_paths` = 332 (đều LINESTRING), `vehicle_tracking_logs` = 0.

---

## Tổng quan

| # | Mức | Vấn đề | Nhóm | Trạng thái |
|---|---|---|---|---|
| 1 | 🔴 | Socket không xác thực, ai cũng giả mạo được GPS | A. Bảo mật | DONE |
| 2 | 🔴 | Log hành trình không bao giờ ghi được (lỗi FK, nuốt lỗi) | D. Lưu log | DOING |
| 3 | 🔴 | Không validate payload `gps_ping` | A. Bảo mật | DONE |
| 4 | 🟠 | Broadcast toàn bộ xe tới mọi client (~1.3k–2k emit/s) | B. Server realtime | TODO |
| 5 | 🟡 | Lọc xe chỉ theo `route_id`, bỏ qua `direction` | C. Client | TODO |
| 6 | 🟡 | "Trạm tiếp theo" thực ra là trạm gần nhất | C. Client | TODO |
| 7 | 🟡 | Server không lưu vị trí cuối, client mới vào thấy bản đồ trống | B. Server realtime | TODO |
| 8 | 🟡 | Xe ma: xe ngừng phát vẫn đứng trên bản đồ, cache phình to | B. Server realtime | DOING |
| 9 | 🟡 | Bỏ qua `timestamp`: animate cứng 500ms, gói sai thứ tự làm xe chạy lùi | C. Client | TODO |
| 10 | 🟡 | Không xử lý `connect_error`/reconnect, không resync | C. Client | TODO |
| 11 | ⚪ | `SOCKET_URL` hardcode localhost | E. Dọn dẹp | DONE |
| 12 | ⚪ | `admin.html` nạp CDN socket.io nhưng không dùng | E. Dọn dẹp | DONE |
| 13 | ⚪ | Simulator dùng ID xe tổng hợp, không gắn `vehicles`/`schedules` | D. Lưu log | DONE |

**Thứ tự đề xuất:** A (#1, #3) → B (#4, #7, #8) → C (#5, #6, #9, #10) → D (#2, #13) → E (#11, #12)

---

## A. Bảo mật

### #1 🔴 Socket không xác thực — `DONE`

- **Vị trí (cũ, file đã xóa):** [tracking.socket.js:7-11](../backend/src/sockets/tracking.socket.js#L7-L11), [server.js:10](../backend/server.js#L10)
- **Vấn đề:** Client nào kết nối cũng emit được `gps_ping`, nên có thể giả mạo vị trí bất kỳ xe nào. Gói giả được phát cho mọi người xem và ghi vào DB. Viewer và thiết bị GPS dùng chung một kênh. CORS đang là `origin: "*"`.
- **Hướng sửa:**
  - [x] Tách namespace `/device` cho thiết bị/simulator, có `io.use()` kiểm token trong `socket.handshake.auth`.
  - [x] Namespace viewer (`/` hoặc `/viewer`) chỉ nhận, không xử lý `gps_ping`.
  - [x] ~~Thêm biến môi trường cho token thiết bị (ví dụ `DEVICE_TOKEN`)~~ Thay bằng JWT của tài khoản tài xế (role `DRIVER`); simulator đăng nhập như tài xế.
  - [x] Bỏ `cors: "*"`, vì Express đã phục vụ frontend cùng origin trên cổng 3000.
  - [x] ⚠️ Cập nhật [test_suite.js:329-370](../backend/test_suite.js#L329-L370), vì test đang dựa vào việc emit `gps_ping` không cần auth.
- **Kiểm chứng:** Client không có token emit `gps_ping` → bị từ chối và viewer không nhận gì. Simulator có token → viewer nhận bình thường.

### #3 🔴 Không validate payload — `DONE`

- **Vị trí (cũ, file đã xóa):** [tracking.socket.js:11](../backend/src/sockets/tracking.socket.js#L11), hậu quả ở [fleet-tracking.js:119](../frontend/src/views/map/features/fleet-tracking.js#L119)
- **Vấn đề:** Server phát lại nguyên object nhận được. Nếu `longitude` là string hoặc null thì client crash tại `data.longitude.toFixed`.
- **Hướng sửa:**
  - [x] Kiểm kiểu số và khoảng hợp lệ của `longitude`/`latitude`, `speed_kmh` ≥ 0, `heading` trong 0–360.
  - [x] Chỉ whitelist các field cần thiết khi phát lại.
  - [x] Giảm `maxHttpBufferSize` (mặc định 1MB).
  - [x] Giới hạn tần suất `gps_ping` cho mỗi socket.
- **Kiểm chứng:** Gửi gói thiếu field hoặc sai kiểu → server bỏ qua, client không lỗi.

---

## B. Server realtime

> Ba vấn đề #4, #7, #8 cùng đụng vào `viewer.socket.js` / `device.socket.js`, nên sửa chung một lượt.

### #4 🟠 Broadcast toàn bộ xe tới mọi client — `TODO`

- **Vị trí:** [viewer.socket.js](../backend/src/sockets/viewer.socket.js) (`publishLocation` phát tới mọi viewer), [simulator/src/virtual-driver.js](../simulator/src/virtual-driver.js) (1 gói / xe / tick)
- **Vấn đề:** 332 lộ trình × 2–3 xe tự sinh × 2 Hz ≈ 1.3k–2k emit/giây tới mỗi client, kèm số INSERT tương đương. Client nhận hết rồi mới lọc. Đây là lý do simulator cũ bị tắt; simulator mới (`simulator/`) chỉ chạy số tài xế seed (mặc định 5).
- **Hướng sửa:**
  - [ ] Room theo `route:<route_id>:<direction>`. Client gửi `subscribe_route`/`unsubscribe_route` khi đổi tuyến hoặc chiều.
  - [ ] Chế độ "ALL": server gom snapshot và phát `fleet_snapshot` 1–2 giây/lần thay vì từng xe.
  - [ ] Simulator gửi `gps_batch` (một mảng mỗi tick) thay vì một gói mỗi xe.
  - [ ] Dùng `io.volatile` cho cập nhật vị trí, để bỏ gói cũ khi client chậm.
  - [ ] Tăng `--count` của simulator (`cd simulator && npm start -- --count N`) sau khi xong.
- **Kiểm chứng:** Chọn một tuyến thì DevTools → WS chỉ thấy gói của tuyến và chiều đó.

### #7 🟡 Không lưu vị trí cuối trên server — `TODO`

- **Vấn đề:** Client mới vào hoặc vừa reconnect thấy bản đồ trống cho tới ping kế tiếp.
- **Hướng sửa:**
  - [ ] Lưu `Map<vehicle_id, { ...lastPacket, receivedAt }>` trong bộ nhớ server.
  - [ ] Gửi snapshot khi client connect hoặc join room.
- **Kiểm chứng:** Reload trang thì xe hiện ngay, không chờ ping.

### #8 🟡 Xe ma và cache phình to — `DOING`

- **Vị trí:** [fleet-tracking.js:165-258](../frontend/src/views/map/features/fleet-tracking.js#L165-L258)
- **Vấn đề:** Xe ngừng phát vẫn đứng im mãi trên bản đồ. `busGraphics`, `busAnimStates`, `busCurrentPositions` phình không giới hạn, vì simulator reload mỗi 30 giây và đổi ID.
- **Hướng sửa:**
  - [ ] Server quét định kỳ: xe im quá 30 giây thì emit `vehicle_offline { vehicle_id }` và xóa khỏi bộ nhớ.
  - [ ] Client nhận `vehicle_offline` thì gỡ graphic và xóa cả 3 cache.
  - [x] Phát vehicle_offline khi trip:end / thiết bị ngắt kết nối; client gỡ graphic và cache (quét timeout vẫn để nhóm B)
- **Kiểm chứng:** Tắt simulator, sau khoảng 30 giây xe biến khỏi bản đồ.

---

## C. Client (logic theo dõi hành trình)

### #5 🟡 Lọc bỏ qua chiều — `TODO`

- **Vị trí:** [fleet-tracking.js:143](../frontend/src/views/map/features/fleet-tracking.js#L143)
- **Vấn đề:** Xe lượt về vẫn hiện khi đang xem lượt đi.
- **Hướng sửa:**
  - [ ] Thêm điều kiện `data.direction === state.currentDirection` khi đang chọn một tuyến cụ thể.
  - [ ] Sửa `applyFleetFilter()` theo cùng điều kiện.
- **Kiểm chứng:** Chuyển Lượt đi/Lượt về thì chỉ thấy xe đúng chiều. Phần này trở nên thừa nếu #4 dùng room theo chiều.

### #6 🟡 "Trạm tiếp theo" sai — `TODO`

- **Vị trí:** [fleet-tracking.js:122-133](../frontend/src/views/map/features/fleet-tracking.js#L122-L133)
- **Vấn đề:** Code chọn trạm gần nhất theo khoảng cách Euclid tính bằng độ, nên thường trả về trạm vừa đi qua. Danh sách trạm lấy theo tuyến/chiều đang xem chứ không theo xe.
- **Hướng sửa:**
  - [ ] Chiếu vị trí xe lên polyline của tuyến (có thể tái dùng `path-clip.js`) để tính quãng đường đã đi.
  - [ ] Chọn trạm đầu tiên có vị trí trên tuyến lớn hơn vị trí xe, theo `stop_order`.
  - [ ] Hiển thị khoảng cách hoặc ETA tới trạm đó (tùy chọn).
- **Kiểm chứng:** Xe vừa qua trạm A thì panel hiện trạm B.

### #9 🟡 Bỏ qua `timestamp` — `TODO`

- **Vị trí:** [fleet-tracking.js:186](../frontend/src/views/map/features/fleet-tracking.js#L186)
- **Vấn đề:** Thời gian animate cứng 500ms theo nhịp simulator, nên GPS thật (5–10 giây/lần) sẽ giật. Gói đến trễ hoặc sai thứ tự làm xe chạy lùi.
- **Hướng sửa:**
  - [ ] Bỏ gói có `timestamp` nhỏ hơn hoặc bằng gói cuối đã nhận của xe đó.
  - [ ] Tính `duration` từ chênh lệch timestamp, kẹp trong khoảng hợp lý (ví dụ 300ms–10s).
- **Kiểm chứng:** Gửi lại một gói cũ thì xe không nhảy lùi.

### #10 🟡 Thiếu xử lý reconnect — `TODO`

- **Vị trí:** [realtime.service.js:8-12](../frontend/src/modules/realtime/realtime.service.js#L8-L12)
- **Vấn đề:** Không có handler `connect_error`, không có trạng thái "đang kết nối lại", không resync sau khi reconnect.
- **Hướng sửa:**
  - [ ] Xử lý `connect_error` và các sự kiện `io.on("reconnect_attempt")` để hiện badge RECONNECTING.
  - [ ] Khi `connect` thì join lại room (#4) và nhận snapshot (#7).
- **Kiểm chứng:** Tắt rồi bật backend thì badge đổi OFFLINE → RECONNECTING → ONLINE và xe hiện lại ngay.

---

## D. Lưu log hành trình

### #2 🔴 Log không bao giờ ghi được — `DOING`

- **Vị trí (cũ, file đã xóa):** [tracking.socket.js:14-23](../backend/src/sockets/tracking.socket.js#L14-L23)
- **Bằng chứng** (chạy trong transaction rồi ROLLBACK):
  - INSERT với `vehicle_id = 'BUS_100_D1_V1'` trả về `ER_NO_REFERENCED_ROW_2 Cannot add or update a child row: a foreign key constraint fails (... FOREIGN KEY (vehicle_id) REFERENCES vehicles (vehicle_id) ...)`.
  - INSERT với một xe có thật trong `vehicles` thì chạy bình thường. Vậy nguyên nhân là FK, không phải geometry hay độ dài ID.
- **Vấn đề:** Bảng `vehicles` rỗng, simulator tự sinh ID không tồn tại, và `catch {}` nuốt lỗi im lặng.
- **Hướng sửa:**
  - [x] Ghi log ra console thay vì nuốt lỗi (ít nhất ở môi trường dev).
  - [x] Chỉ ghi log cho `vehicle_id` có trong `vehicles` (đạt nhờ xác thực tài xế + FK, không cần cache).
  - [x] Ghi theo lô (bulk INSERT mỗi vài giây) hoặc throttle 5–10 giây/xe thay vì mỗi ping. (Đã throttle 5 giây/xe.)
- Còn lại: bulk INSERT theo lô — làm cùng nhóm B.
- **Kiểm chứng:** Chạy simulator với xe có thật, `SELECT COUNT(*) FROM vehicle_tracking_logs` tăng dần.

### #13 ⚪ Simulator dùng ID tổng hợp — `DONE`

- **Vị trí (cũ):** `backend/simulator.js` (đã xóa; thay bằng [simulator/](../simulator/) dùng tài khoản seed `driverNN` / xe `DRV_NN`)
- **Hướng sửa:**
  - [x] Seed `vehicles` và `schedules` (hoặc để simulator tự tạo xe ảo vào DB), rồi dùng `vehicle_id` thật trong gói GPS.
  - [x] Nếu cần phân biệt nhiều phiên của cùng một xe, gửi `schedule_id` thành field riêng thay vì ghép vào ID.

---

## E. Dọn dẹp

### #11 ⚪ `SOCKET_URL` hardcode — `DONE`

- **Vị trí:** [frontend/src/core/config.js:2](../frontend/src/core/config.js#L2)
- [x] Dùng `io()` không truyền URL, vì frontend và socket cùng origin.

### #12 ⚪ CDN socket.io thừa ở admin — `DONE`

- **Vị trí:** [frontend/admin.html:9](../frontend/admin.html#L9)
- [x] Xóa thẻ script, hoặc giữ lại nếu sẽ thêm realtime cho admin (giám sát đội xe, thông báo khi CRUD).

---

## Nhật ký thay đổi

| Ngày | # | Thay đổi | Commit |
|---|---|---|---|
| 2026-10-04 | — | Tạo tài liệu sau khi rà soát | — |
| 2026-10-04 | #1 #3 #11 #12 #13, một phần #2 #8 | Namespace /device có JWT tài xế, validate + rate limit, một xe một phiên, vehicle_offline, log có throttle; tài khoản tài xế + seed; simulator độc lập; trang driver.html | nhánh `feat/socket-security-driver` |
