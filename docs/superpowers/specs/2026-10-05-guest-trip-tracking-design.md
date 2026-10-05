# Thiết kế: Khách theo dõi đúng một chuyến xe, kèm ETA tới trạm lên

- **Ngày:** 2026-10-05
- **Nhánh:** `feat/guest-trip-tracking`
- **Phạm vi:** Bản đồ công khai cho khách, socket viewer `/`, socket thiết bị `/device`, seed tài xế, simulator, trang tài xế. Giải quyết #4 trong [SOCKET_IO_TRACKING.md](../../SOCKET_IO_TRACKING.md). Với khách, #5 cũng không còn: mỗi chuyến chỉ có một chiều.

## 1. Mục tiêu

### Hiện trạng
- Socket `/` phát vị trí **mọi xe** tới **mọi người** (`viewers.emit`). Bản đồ chỉ ẩn xe ở client, nên ai mở DevTools cũng thấy toàn đội xe.
- Khách chưa chọn tuyến vẫn thấy mọi xe (`currentSelectedRoute = "ALL"`).
- Bảng `schedules (route_id, vehicle_id, departure_time, direction)` đã cho phép một tuyến có nhiều chuyến và nhiều tài xế. Seed hiện tại lại chỉ tạo 1 lịch cho mỗi xe, và mỗi tài xế chạy một cặp tuyến/chiều khác nhau.
- Khách không biết bao giờ xe tới trạm của mình.

### Kết quả mong muốn
1. Khách **chưa chọn tuyến**: bản đồ không có xe nào.
2. Khách **chọn tuyến** (bấm thẻ kết quả tìm tuyến): bản đồ chỉ vẽ lộ trình, **chưa hiện xe nào**. Dưới thẻ hiện danh sách chuyến **đang chạy** và **sắp tới** của tuyến và chiều đó, kèm ETA tới trạm lên của khách.
3. Khách **chọn một chuyến**: bản đồ hiện **đúng một xe** của chuyến đó.
4. "Khung giờ" của tài xế là **giờ xuất bến** (`schedules.departure_time`). Một tuyến có nhiều chuyến, do nhiều tài xế chạy.
5. Server **thực sự chặn** dữ liệu: socket của khách chỉ nhận tọa độ của chuyến mình đang theo dõi.
6. ETA dựa trên **vận tốc thực tế** của xe, không dùng hằng số cố định.
7. ETA và trạng thái chuyến được **đẩy qua socket**, client không phải polling.
8. Nhân viên (ADMIN/MANAGER) vẫn thấy toàn đội xe như cũ.

### Tiêu chí thành công
- Mọi kịch bản test ở Mục 7 đều pass.
- Chạy `npm run db:seed-drivers` rồi `cd simulator && npm start -- --count 20`. Mở bản đồ với tư cách khách:
  - lúc mở trang không có xe nào;
  - chọn điểm đến rồi bấm một thẻ tuyến thì chỉ thấy lộ trình, cùng danh sách chuyến có nhãn trạng thái và ETA;
  - bấm một chuyến đang chạy thì thấy đúng một xe di chuyển, và ETA tự cập nhật mà client không gửi request nào.
- Trong DevTools → Network → WS, socket của khách chỉ nhận `fleet_location_update` của chuyến đã chọn.

### Giả định
- Đây là đồ án demo. Dữ liệu chạy trong khoảng 05:00–22:00, giờ `Asia/Ho_Chi_Minh`.
- Registry chuyến đang chạy nằm trong bộ nhớ của một process Node duy nhất (không có cluster hay Redis adapter).

### Ngoài phạm vi
- Rate-limit khi một người cố tình mở nhiều socket, mỗi socket theo dõi một chuyến khác nhau.
- Chuyến qua nửa đêm.
- ETA dựa trên dữ liệu lịch sử (`vehicle_tracking_logs`).
- Đổi giao diện bản đồ của nhân viên, ngoài việc gửi kèm token.
- #6 (trạm tiếp theo), #7 (snapshot vị trí cuối), #9, #10 trên bản đồ của nhân viên.

## 2. Server: registry chuyến đang chạy

### 2.1 File `backend/src/sockets/trip-registry.js` (mới)

Server chỉ tạo **một instance**, dùng chung cho device socket và viewer socket.

```js
createTripRegistry({ now = Date.now }) → {
  start(trip),                  // trip = { schedule_id, vehicle_id, route_id, direction, departure_time }
  end(scheduleId),
  recordPing(scheduleId, { longitude, latitude, speed_kmh }),
  get(scheduleId),              // → trip + { started_at, samples, speeds } | undefined
  listByRoute(routeId, direction),
  on("change", ({ route_id, direction }) => …)   // phát khi start / end
}
```

- `recordPing`:
  - luôn cập nhật `last_position`;
  - cứ **15 giây** thêm một mẫu `{ t, longitude, latitude }` vào `samples`, và chỉ giữ các mẫu trong **5 phút** gần nhất;
  - cộng dồn `speed_kmh` để tính tốc độ trung bình, dùng khi chuyến chưa đủ 2 phút dữ liệu.
- Registry **không** chiếu tọa độ lên lộ trình. Việc chiếu dời sang lúc tính ETA (Mục 3), để vòng xử lý GPS luôn nhẹ.

### 2.2 Device socket `/device` (`device.socket.js`)

- **`trip:start`:**
  - Câu SELECT lấy thêm `s.departure_time`.
  - Nếu socket đang chạy một chuyến khác: gọi `registry.end(chuyến cũ)`, phát `vehicle_offline` vào room của chuyến cũ, rồi gọi `registry.start(chuyến mới)`.
- **`gps_ping` hợp lệ:**
  - Gói tin thêm `schedule_id`.
  - Gửi `fleet_location_update` tới room `trip:<schedule_id>` và room `staff` (Mục 4.1).
  - Gọi `registry.recordPing`.
- **`trip:end`, `disconnect`, phiên bị thay:** gọi `registry.end` và phát `vehicle_offline` vào room `trip:<schedule_id>` và room `staff`. Giữ nguyên logic `onMap` hiện có cho phiên thay thế.
- **Bỏ** hẳn việc phát tới mọi viewer. `createViewerBroadcaster` đổi thành:
  - `publishLocation(packet)`
  - `publishOffline({ vehicle_id, schedule_id })`
  - cả hai đều gửi tới `io.of("/").to(["trip:" + id, "staff"])`.

## 3. ETA (`backend/src/sockets/eta.js`, hàm thuần, kèm cache)

### 3.1 Hình học lộ trình
- `loadRouteGeometry(db, routeId, direction)` nạp:
  - đường đi từ `route_paths`;
  - các trạm theo `route_stops.stop_order`, kèm tọa độ.
- Kết quả cache theo `(route_id, direction)`. Không cần xóa cache trong lúc chạy; lộ trình đổi thì khởi động lại server.
- **Chiếu trạm:** duyệt các trạm theo thứ tự; mỗi trạm chiếu lên polyline và **chỉ tìm từ vị trí của trạm trước trở về sau**. Nhờ vậy tuyến vòng ghé một trạm hai lần vẫn đúng. Kết quả là `stop_progress_m[stop_id]` (lần ghé đầu tiên).
- **Chiếu vị trí xe:** lấy điểm gần nhất trên toàn polyline. *Hạn chế:* với tuyến vòng, vị trí xe có thể khớp nhầm đoạn đường. Spec chấp nhận hạn chế này.
- Quãng đường tính bằng haversine trên từng đoạn của polyline.

### 3.2 Vận tốc
Hằng số đặt trong `eta.js`:

| Hằng số | Giá trị |
|---|---|
| `SPEED_WINDOW_MS` | 5 phút |
| `MIN_WINDOW_MS` | 2 phút |
| `MIN_SPEED_KMH` | 5 |
| `MAX_SPEED_KMH` | 60 |
| `DEFAULT_SPEED_KMH` | 20 |

- **Chuyến đang chạy:**
  - Nếu các mẫu trải được ≥ `MIN_WINDOW_MS`:
    `v = (progress(mẫu mới nhất) − progress(mẫu cũ nhất)) / (t_mới − t_cũ)`.
    Con số này đã gồm thời gian dừng trạm và kẹt xe.
  - Nếu chưa đủ: `v` = trung bình `speed_kmh` của các gói đã nhận.
  - Nếu cả hai đều không có: `v = DEFAULT_SPEED_KMH`.
  - Cuối cùng kẹp `v` vào khoảng `[MIN_SPEED_KMH, MAX_SPEED_KMH]`.
- **Chuyến sắp tới:** `v` = trung bình `v` của các chuyến **đang chạy cùng tuyến** (cả hai chiều). Tuyến chưa có chuyến nào đang chạy thì dùng `DEFAULT_SPEED_KMH`.

### 3.3 Trạng thái và ETA cho một trạm lên `B`

- **RUNNING:**
  - Nếu `progress(xe) ≤ progress(B)`:
    - `eta = now + (progress(B) − progress(xe)) / v`.
  - Ngược lại, chuyến chuyển sang **PASSED**: không có ETA.
- **UPCOMING:**
  - `eta = departure_time (hôm nay) + progress(B) / v`.

Không có `B` (khách không bật định vị nên phiếu kết quả không có `board_stop`), hoặc `B` không nằm trên tuyến/chiều đó: chỉ trả trạng thái RUNNING/UPCOMING, không có ETA.

### 3.4 Cửa sổ công khai
Hàm `isPublicTrip(schedule, now, registry)`:

- `true` nếu chuyến đang có trong registry (RUNNING);
- hoặc `departure_time` nằm trong khoảng `[now − 15 phút, now + 2 giờ]`, tính theo giờ Asia/Ho_Chi_Minh.

Hàm này dùng chung cho `trips:subscribe` và `trip:watch`.

### 3.5 Danh sách chuyến
Hàm `buildTripList(db, registry, { route_id, direction, board_stop_id }, now)` trả về:

```js
[{ schedule_id, departure_time, plate_number, driver_name,
   status: "RUNNING" | "UPCOMING" | "PASSED",
   eta_board: ISO | null, minutes_to_board: number | null }]
```

- Chỉ gồm các chuyến mà `isPublicTrip` trả về `true`.
- Thứ tự sắp xếp:
  - các chuyến khách còn lên được, sắp theo `eta_board` (nếu không có ETA thì theo `departure_time`);
  - các chuyến `PASSED` xếp cuối.
- **Không có tọa độ** trong danh sách.

## 4. Server: viewer socket `/` (`viewer.socket.js`)

### 4.1 Handshake
`socket.handshake.auth.token` được kiểm tra như sau:

| Token | Kết quả |
|---|---|
| JWT hợp lệ, role ADMIN/MANAGER | `socket.join("staff")` |
| JWT hợp lệ, role DRIVER | lưu `socket.data.driverVehicleId` (tra `vehicles.driver_user_id`) |
| Không có, sai, hết hạn | coi như khách, **không báo lỗi** (trang công khai hay còn token cũ) |

### 4.2 Sự kiện client → server

**`trips:subscribe { route_id, direction, board_stop_id? }` → ack**
- Thành công: `{ ok: true, trips }`.
- Thất bại:
  - `{ ok: false, error: "BAD_REQUEST" }`
  - `{ ok: false, error: "SERVER_ERROR" }`
- Server làm:
  - rời room tuyến cũ (nếu có), rồi join room `route:<route_id>:<direction>`;
  - lưu `socket.data.boardStopId`.
- Mỗi socket chỉ ở một room tuyến.

**`trips:unsubscribe`**
- Rời room tuyến.

**`trip:watch { schedule_id }` → ack**
- Thành công: `{ ok: true, status }`.
- Thất bại: `{ ok: false, error: "TRIP_NOT_AVAILABLE" | "SERVER_ERROR" }`.
- Điều kiện được xem:
  - `isPublicTrip` trả về `true`;
  - **hoặc** `schedule.vehicle_id === socket.data.driverVehicleId`. Tài xế xem được mọi chuyến thuộc xe của mình, kể cả ngoài cửa sổ công khai, vì trang tài xế mở bản đồ trước khi gửi `trip:start`.
- Server rời room chuyến cũ rồi join room `trip:<schedule_id>`.
- Mỗi socket chỉ ở một room chuyến.

**`trip:unwatch`**
- Rời room chuyến.

### 4.3 Sự kiện server → client

| Sự kiện | Room nhận | Payload |
|---|---|---|
| `fleet_location_update` | `trip:<id>`, `staff` | gói GPS hiện tại + `schedule_id` |
| `vehicle_offline` | `trip:<id>`, `staff` | `{ vehicle_id, schedule_id }` |
| `trips:update` | gửi riêng từng socket trong `route:<id>:<dir>` | `{ route_id, direction, trips }` |

**Cách đẩy `trips:update`:**
- Định kỳ **15 giây** một lần: duyệt các room `route:*` đang có người.
- **Ngay lập tức** khi registry phát `change` cho một (tuyến, chiều): đẩy cho cả hai room chiều của tuyến đó, vì vận tốc ước tính cho chuyến sắp tới tính trên cả tuyến.
- Trong một room, danh sách được tính **một lần cho mỗi `board_stop_id` khác nhau**, rồi gửi cho các socket có cùng trạm.
- Timer không chạy khi không có room `route:*` nào.

## 5. Giao diện

### 5.1 Khách
Module mới `frontend/src/views/map/features/trip-finder/trip-watch.js` giữ trạng thái `{ subscribedRoute, watchedScheduleId, trips }` và lo phần socket. `trip-finder.js` lo phần hiển thị.

1. **Mở trang:** không có xe nào. Ẩn bảng "Theo dõi xe" (`#fleetDashboard`).
2. **Bấm thẻ tuyến:**
   - vẫn vẽ đoạn đường và các trạm lên/xuống như hiện nay;
   - gửi `trips:subscribe` (kèm `board_stop_id` nếu có);
   - **mở danh sách chuyến ngay dưới thẻ**. Mỗi dòng gồm:
     - giờ xuất bến · biển số · tên tài xế;
     - nhãn **Đang chạy** / **Sắp xuất bến** / **Đã qua trạm của bạn**. Dòng "Đã qua trạm" hiện mờ và không bấm được;
     - **~HH:MM (X phút)** tới trạm lên (nếu có ETA).
   - Danh sách rỗng: hiện "Hiện không có chuyến nào trong 2 giờ tới".
3. **Bấm một chuyến:**
   - gửi `trip:watch`, bản đồ hiện đúng một xe;
   - hiện `#fleetDashboard` với tuyến, biển số, tài xế, tốc độ và ETA tới trạm lên;
   - nếu chuyến là UPCOMING: bảng ghi "Chưa xuất bến — dự kiến HH:MM", xe tự hiện khi tài xế bắt đầu chuyến.
4. **Nhận `trips:update`:** vẽ lại danh sách, giữ dòng đang chọn. Cập nhật ETA và trạng thái trên bảng theo dõi.
   - Nếu chuyến đang theo dõi chuyển sang PASSED: vẫn giữ xe trên bản đồ, bảng ghi "Xe đã qua trạm của bạn".
5. **Đổi thẻ tuyến, tìm điểm đến mới, hoặc đăng nhập:** gửi `trip:unwatch` + `trips:unsubscribe`, gỡ xe khỏi bản đồ, ẩn bảng theo dõi.
6. **Kết nối lại:** gửi lại `trips:subscribe` rồi `trip:watch`. Nếu nhận `TRIP_NOT_AVAILABLE` hoặc `vehicle_offline` của chuyến đang theo dõi: gỡ xe, bảng ghi "Chuyến đã kết thúc".
7. **Phòng thủ ở client:** bỏ qua mọi `fleet_location_update` có `schedule_id` khác chuyến đang theo dõi.

Bảng "Theo dõi xe" của khách **không** hiện "Trạm tiếp theo" (khách đã có ETA tới trạm của mình). Nhân viên vẫn thấy mục này như cũ.

### 5.2 Nhân viên
- `connectRealtime({ token, … })` gửi `auth: { token }`.
- `staff-auth.js`: mỗi lần trạng thái đăng nhập đổi, ngắt socket, xóa xe trên bản đồ, rồi kết nối lại với token mới. Như vậy trình duyệt không giữ room `staff` sau khi đăng xuất.
- Lọc theo tuyến (`applyFleetFilter`) giữ nguyên.

### 5.3 Trang tài xế (`drive-map.js`)
- `connectRealtime` gửi kèm JWT tài xế.
- Trong `onConnect` (lần đầu và mỗi lần kết nối lại), gửi `trip:watch { schedule_id }` của chuyến đang chọn.

## 6. Seed và simulator

### 6.1 `seed_drivers.js`
- Giữ `--count` (mặc định 20). Hằng số `DRIVERS_PER_ROUTE = 4`, số tuyến là `ceil(count / 4)`.
- Chỉ lấy tuyến có đủ hai chiều, thứ tự chọn tuyến như hiện nay.
- Tài xế thứ `i` (0..3) của một tuyến có các chuyến xuất bến lúc `05:00 + i×15 phút + k×60 phút`, với `k = 0..16`. Chiều chạy là `k chẵn → 1`, `k lẻ → 2`.
- Kết quả: mỗi tuyến có một chuyến cứ 15 phút, mỗi tài xế khoảng 17 chuyến/ngày.
- Vẫn upsert idempotent: giữ `vehicle_tracking_logs`, thay mới `schedules` của xe seed, xóa bản ghi thừa.

### 6.2 Simulator (`virtual-driver.js`)
- Chọn chuyến có `departure_time` muộn nhất nhưng không vượt quá giờ hiện tại. Trước chuyến đầu ngày thì lấy chuyến đầu. Thay cho `schedules[0]` hiện nay.
- Viết thành hàm thuần `pickSchedule(schedules, now)` để test được.

## 7. Kiểm thử

**Unit (`node --test`)**
- `eta.js`:
  - chiếu trạm lên lộ trình, kể cả tuyến vòng ghé một trạm hai lần;
  - vận tốc tính từ cửa sổ mẫu;
  - dự phòng bằng trung bình `speed_kmh` khi chưa đủ 2 phút;
  - kẹp 5–60 km/h;
  - chuyến sắp tới dùng vận tốc trung bình của tuyến, hoặc mặc định khi tuyến không có xe chạy;
  - PASSED khi xe đã vượt trạm;
  - không có trạm lên thì không có ETA.
- `isPublicTrip`: biên −15 phút / +2 giờ; chuyến RUNNING ngoài cửa sổ vẫn là `true`.
- `trip-registry`:
  - lấy mẫu 15 giây và cắt cửa sổ 5 phút;
  - phát `change` khi start/end;
  - `listByRoute`.
- `pickSchedule` của simulator.

**Viewer socket** (harness giống `device.socket.test.js`)
- Khách chưa gửi `trip:watch` thì không nhận `fleet_location_update`.
- Gửi `trip:watch` thì chỉ nhận xe của chuyến đó.
- `trip:watch` một chuyến khác thì không còn nhận gói của chuyến cũ.
- Socket nhân viên nhận gói của mọi xe. Token sai hoặc hết hạn bị coi là khách.
- Chuyến ngoài cửa sổ → `TRIP_NOT_AVAILABLE`. Riêng tài xế watch được chuyến của xe mình ngoài cửa sổ.
- `trips:subscribe` ack trả đúng danh sách. `trips:update` được đẩy ngay khi một chuyến bắt đầu hoặc kết thúc. Payload của room tuyến không có `longitude`/`latitude`.
- `vehicle_offline` chỉ tới room của chuyến đó và room `staff`.

**Cập nhật test có sẵn**
- `device.socket.test.js`: phát theo room, `trip:start` khi socket đang chạy chuyến khác.
- Module 4 của `test_suite.js`: viewer phải gửi `trip:watch` trước khi chờ gói GPS; thêm ca khách không watch thì không nhận gì.

**Thủ công (Playwright)**
- Đi hết luồng khách ở Mục 5.1.
- Màn hình nhân viên vẫn thấy toàn đội xe; đăng xuất thì bản đồ trống.
- Trang tài xế vẫn thấy xe của mình.

## 8. Tài liệu
- `SOCKET_IO_TRACKING.md`: #4 → DONE; ghi chú về #5 cho khách; thêm sơ đồ và giao thức room mới; thêm dòng nhật ký thay đổi.
- `ARCHITECTURE_SPEC.md`, `README.md`: giao thức viewer mới, seed mới.
- `USE_CASES.md`: use case khách chọn tuyến → chọn chuyến → theo dõi một xe kèm ETA.

## 9. Tóm tắt file

| File | Thay đổi |
|---|---|
| `backend/src/sockets/trip-registry.js` | mới |
| `backend/src/sockets/eta.js` | mới |
| `backend/src/sockets/viewer.socket.js` | handshake, các sự kiện watch/subscribe, timer đẩy `trips:update` |
| `backend/src/sockets/device.socket.js` | phát theo room, gọi registry, đổi chuyến |
| `backend/src/sockets/index.js` | tạo registry, nối vào cả hai namespace |
| `backend/scripts/seed_drivers.js` | 4 tài xế/tuyến, nhiều chuyến mỗi ngày |
| `simulator/src/virtual-driver.js` | `pickSchedule` |
| `frontend/src/modules/realtime/realtime.service.js` | nhận `token`, trả socket để emit |
| `frontend/src/views/map/features/trip-finder/trip-watch.js` | mới |
| `frontend/src/views/map/features/trip-finder/trip-finder.js` | danh sách chuyến dưới thẻ tuyến |
| `frontend/src/views/map/features/fleet-tracking.js` | chế độ khách: một xe, bảng theo dõi có ETA |
| `frontend/src/views/map/features/staff-auth.js` | kết nối lại socket khi đăng nhập/đăng xuất |
| `frontend/src/views/driver/features/drive-map.js` | token + `trip:watch` |
| CSS bản đồ | style dòng chuyến, nhãn trạng thái, dòng mờ |
| Test và tài liệu | như Mục 7–8 |
