# Thiết kế: Bảo mật Socket.io, tài khoản tài xế và trang tài xế

- **Ngày:** 2026-10-04
- **Nhánh:** `feat/socket-security-driver`
- **Phạm vi:** Nhóm A trong [SOCKET_IO_TRACKING.md](../../SOCKET_IO_TRACKING.md) (#1, #3), kèm phần lớn #2, toàn bộ #13, và tính năng mới: tài khoản tài xế + trang `driver.html`.

## 1. Mục tiêu

### Hiện trạng
- Ai kết nối socket cũng emit được `gps_ping` và giả mạo được vị trí của bất kỳ xe nào.
- Payload không được kiểm tra. Server phát lại nguyên object nhận được.
- Simulator kết nối ẩn danh với ID xe tự sinh, nên log hành trình không bao giờ ghi được (lỗi FK).
- Bảng `vehicles` trên DB thật đang rỗng. Hệ thống chưa có khái niệm tài xế.
- Mọi route CRUD chỉ kiểm `authenticateToken`, không kiểm role.

### Kết quả mong muốn
1. Chỉ tài xế đã đăng nhập và đã được gán xe mới phát được GPS, và chỉ cho đúng xe của mình. Server tự xác định danh tính xe; không tin `vehicle_id` do client gửi.
2. Viewer (bản đồ công khai) chỉ nhận dữ liệu, không phát được gì.
3. GPS đến từ hai nguồn, dùng chung một giao thức:
   - điện thoại của tài xế (trang `driver.html`)
   - simulator (các tài xế ảo đăng nhập thật)
4. Tài xế có trang riêng: đăng nhập, chọn chuyến, xem bản đồ tuyến cùng xe của mình và trạm kế tiếp, bắt đầu/kết thúc chuyến.
5. Simulator tách hẳn khỏi hệ thống. Không có thành phần nào phụ thuộc vào nó, và có thể xóa thư mục `simulator/` khi triển khai thật.
6. Token tài xế không gọi được API quản trị.

### Tiêu chí thành công
- Mọi kịch bản test ở Mục 8 đều pass.
- `npm run db:seed-drivers` rồi `cd simulator && npm start -- --count 10` → bản đồ công khai thấy 10 xe chạy, và `vehicle_tracking_logs` tăng dần.
- Đăng nhập `driver01` trên `driver.html` → thấy xe của mình trên đúng tuyến. Bấm "Bắt đầu chuyến" (vị trí giả lập bằng DevTools) → xe nhảy theo vị trí điện thoại, còn xe ảo `driver01` của simulator tự dừng.

### Giả định
- Đây là đồ án demo. Ưu tiên chạy đúng và đủ an toàn; không dựng hạ tầng thiết bị thật (MQTT, IoT gateway).
- Frontend và API cùng origin (Express phục vụ `frontend/` trên cổng 3000).

### Ngoài phạm vi
- Nhóm B: room theo tuyến, snapshot vị trí cuối, quét timeout xe im lặng.
- Các mục #5, #6, #9, #10 trên bản đồ chính. Riêng hàm `next-stop.js` viết ở đây để #6 tái dùng sau.
- UI admin để gán tài xế cho xe (seed lo việc gán).
- Cài tunnel HTTPS.

## 2. Dữ liệu và seed

### 2.1 Thay đổi schema

Cập nhật `database/schema.sql`, và đưa cùng thay đổi vào migration idempotent trong script seed:

```sql
ALTER TABLE users MODIFY role ENUM('ADMIN','MANAGER','VIEWER','DRIVER') DEFAULT 'MANAGER';

ALTER TABLE vehicles
  ADD COLUMN driver_user_id INT NULL UNIQUE,
  ADD CONSTRAINT fk_vehicles_driver FOREIGN KEY (driver_user_id)
      REFERENCES users(user_id) ON DELETE SET NULL;
```

- Mỗi tài xế gắn với một xe. Ràng buộc `UNIQUE` bảo đảm một tài xế không giữ hai xe.
- Giữ nguyên cột `vehicles.driver_name` vì admin UI đang dùng. Seed điền cả hai cột.
- Migration kiểm `INFORMATION_SCHEMA` trước khi ALTER, nên chạy lại nhiều lần vẫn an toàn.
- **Thứ tự DROP trong `schema.sql`:** hiện `DROP TABLE IF EXISTS users` nằm ở dòng 12, trước khi drop `vehicles` (dòng 28), và file không tắt FK check. Có FK mới `vehicles → users` thì chạy lại schema sẽ lỗi. Gom mọi lệnh DROP lên đầu file theo thứ tự con → cha: `vehicle_tracking_logs`, `schedules`, `route_stops`, `route_paths`, `vehicles`, `bus_stops`, `bus_routes`, `users`. `db.js` (bootstrap) và `import_busdata_sql.js` đều nạp `schema.sql`, nên sửa một chỗ là đủ.

### 2.2 Script seed

- **Lệnh:** `npm run db:seed-drivers -- --count 20`, file `backend/scripts/seed_drivers.js`.
- **Quy trình:**
  1. Chạy migration ở 2.1.
  2. Seed dùng **upsert** (`INSERT … ON DUPLICATE KEY UPDATE`) theo khóa cố định `driverNN` / `DRV_NN`. Lý do: `vehicle_tracking_logs` có `ON DELETE CASCADE`, nên xóa-tạo-lại xe sẽ xóa sạch log hành trình. Lịch trình của xe seed được thay (xóa rồi tạo lại `schedules` của `DRV_NN`; bảng này không có bảng con).
  3. Bản ghi seed có số thứ tự lớn hơn `count` (do lần chạy trước với `count` lớn hơn) bị xóa theo thứ tự `schedules` → `vehicles` → `users`. Log của các xe này mất theo CASCADE; script in ra số xe bị xóa. Bản ghi seed nhận diện qua `vehicle_id LIKE 'DRV\_%'` và `username LIKE 'driver%' AND role = 'DRIVER'`.
  4. Chọn `ceil(count / 2)` tuyến có đủ hai chiều trong `route_paths`, sắp theo `route_number`. Ghép mỗi tuyến với mỗi chiều cho tới khi đủ `count` cặp.
  5. Với cặp thứ `i` (tính từ 1, định dạng 2 chữ số), tạo:
     - user `driverNN`, role `DRIVER`, `full_name` = `Tài xế NN`, mật khẩu `SEED_DRIVER_PASSWORD` (mặc định `driver123`, hash bằng bcrypt)
     - xe `DRV_NN`, biển `51B-900.NN`, `driver_user_id` trỏ tới user vừa tạo, `driver_name` = `full_name`, `status = 'ACTIVE'`
     - một lịch trình cho tuyến + chiều của cặp, `departure_time` = 05:00 + `i` × 10 phút
  6. Toàn bộ chạy trong một transaction.
- **Giới hạn:** `count` tối đa 99 (định dạng `NN`).
- **README:** `db:import` không đụng `users`/`vehicles` (busdata.sql chỉ nạp tuyến, trạm, lộ trình), nhưng xóa lịch trình trỏ tới tuyến không còn tồn tại. Nếu import thay đổi danh sách tuyến, chạy lại seed để tài xế có lịch trình.

## 3. Auth REST

### 3.1 Middleware

Thêm vào `backend/src/middleware/auth.js`:

```js
requireRole(...roles)                         // 403 nếu req.user.role không nằm trong roles
requireStaff = requireRole("ADMIN", "MANAGER")
```

Gắn `requireStaff` (sau `authenticateToken`) cho các route sau:
- Mọi route ghi: `POST`/`PUT`/`DELETE` trong `bus-routes`, `paths`, `stops`, `vehicles`, `schedules`; `POST /import/json`
- `GET /users`, `GET /admin/stats`, `GET /export/json`

Các route `users` đang dùng `requireAdmin` thì giữ nguyên.

### 3.1b Quản lý user bên admin
Hiện modal user ([user.html](../../../frontend/src/views/admin/sections/modals/user.html)) chỉ có option `MANAGER`/`ADMIN`, và `users.controller` ghi thẳng `role` từ request. Admin sửa `driver01` rồi lưu sẽ hạ tài xế thành MANAGER mà không báo gì. Sửa:
- `users.controller` `createUser`/`updateUser`: whitelist `role ∈ {ADMIN, MANAGER, DRIVER}`, giá trị khác trả 400.
- Thêm `<option value="DRIVER">DRIVER (Tài xế)</option>` vào select, để khi mở sửa thì giữ đúng role.
- Việc gán xe cho tài xế vẫn ngoài phạm vi (seed lo).

### 3.2 Endpoint

| Method | Path | Auth | Mô tả |
|---|---|---|---|
| POST | `/auth/login` | — | Giữ nguyên, chỉ ADMIN/MANAGER |
| POST | `/auth/driver/login` | — | **Mới.** Chỉ role DRIVER và tài xế phải đang được gán xe; nếu không trả 403. JWT payload `{user_id, username, full_name, role:"DRIVER", vehicle_id}`, hạn 12h. Response `{token, user}` |
| GET | `/driver/me` | `requireRole("DRIVER")` | **Mới.** Response `{user, vehicle:{vehicle_id, plate_number}, schedules:[{schedule_id, route_id, route_number, route_name, direction, departure_time}]}` |

- Module mới: `backend/src/modules/driver/` gồm `driver.routes.js` và `driver.controller.js`, đăng ký trong `app.js`.
- `/driver/me` đọc xe từ DB theo `driver_user_id`, không dựa vào `vehicle_id` trong token. Nhờ vậy gán lại xe có hiệu lực ngay.

### 3.3 Cấu hình

- Khi khởi động, nếu `process.env.JWT_SECRET` trống thì in cảnh báo qua `console.warn`.
- Bỏ `app.use(cors())` mở toàn bộ. Chỉ bật CORS khi có env `CORS_ORIGIN` (danh sách phân tách bằng dấu phẩy). Socket.io dùng cùng giá trị này.

## 4. Tầng Socket

### 4.1 File

```
backend/src/sockets/
  index.js           registerSockets(io): đăng ký viewer + device
  viewer.socket.js   namespace "/": chỉ phát, không lắng nghe sự kiện nghiệp vụ
  device.auth.js     middleware handshake cho "/device"
  device.socket.js   namespace "/device": trip:start, trip:end, gps_ping
  gps.validate.js    validateGpsPing(raw) → {ok, value} | {ok:false, reason}  (hàm thuần)
  tracking-log.js    ghi log có throttle
```

`tracking.socket.js` bị xóa. `server.js` gọi `registerSockets(io)` và cấu hình `new Server(server, { maxHttpBufferSize: 16 * 1024, cors: <theo CORS_ORIGIN hoặc không bật> })`.

### 4.2 Namespace

| Namespace | Client | Auth | Server nhận | Server phát |
|---|---|---|---|---|
| `/` | bản đồ công khai, trang tài xế | không | không có | `fleet_location_update`, `vehicle_offline` |
| `/device` | điện thoại tài xế, simulator | JWT DRIVER | `trip:start`, `trip:end`, `gps_ping` | `session:replaced` |

### 4.3 Handshake `/device`

`device.auth.js` xử lý theo các bước:
1. Đọc `socket.handshake.auth.token` và `jwt.verify`. Thiếu hoặc sai token → `next(new Error("UNAUTHORIZED"))`.
2. Kiểm `role === "DRIVER"`. Sai → `UNAUTHORIZED`.
3. Truy vấn `SELECT vehicle_id, plate_number FROM vehicles WHERE driver_user_id = ?`. Không có xe → `next(new Error("NO_VEHICLE"))`.
4. Lưu `socket.data = { user, vehicle, trip: null, lastPingAt: 0 }`.

### 4.4 Một xe chỉ có một phiên

- Server giữ `activeDevices: Map<vehicle_id, socket>`.
- Khi một socket mới của cùng xe kết nối thành công, socket cũ nhận `session:replaced` rồi bị `disconnect(true)`. Map trỏ sang socket mới.
- Khi socket cũ disconnect, nó **không** phát `vehicle_offline`. Chỉ socket đang nằm trong map mới phát (xem 4.5).

### 4.5 Sự kiện

**`trip:start {schedule_id}` (có ack)**
- Truy vấn schedule kèm `route_number` (JOIN `bus_routes`).
- Không tồn tại, hoặc `schedule.vehicle_id` khác xe của socket → ack `{ok:false, error:"SCHEDULE_NOT_ALLOWED"}`.
- Hợp lệ → `socket.data.trip = {schedule_id, route_id, route_number, direction}` và ack `{ok:true, trip}`.
- Gọi lại khi đang có trip thì thay trip cũ.

**`gps_ping {latitude, longitude, speed_kmh?, heading?}` (không ack)**
1. Chưa có trip → bỏ qua.
2. Cách lần ping được nhận trước < 250ms → bỏ qua. Simulator phát mỗi 500ms và điện thoại mỗi 1 giây; ngưỡng 250ms chừa chỗ cho độ trễ dao động khi đi qua tunnel.
3. `validateGpsPing`:
   - `latitude`, `longitude` là số hữu hạn; lat ∈ [-90, 90], lon ∈ [-180, 180]
   - `speed_kmh` thiếu thì = 0; nếu có phải ∈ [0, 200]
   - `heading` thiếu thì = 0; nếu có phải ∈ [0, 360)
   - field thừa bị bỏ
   
   Không hợp lệ → bỏ gói. In `console.warn` tối đa một lần mỗi 10 giây cho mỗi socket.
4. Dựng gói phát. Mọi field danh tính lấy từ `socket.data`, `timestamp` do server gán:
   ```js
   { vehicle_id, plate_number, route_id, route_number, direction,
     longitude, latitude, speed_kmh, heading, timestamp }
   ```
   `io.of("/").emit("fleet_location_update", packet)`. Định dạng giữ nguyên như hiện tại, nên phần xử lý gói vị trí trong `fleet-tracking.js` không đổi (chỉ thêm xử lý `vehicle_offline`, xem 4.7).
5. Gọi `trackingLog.record(packet)`.

**`trip:end` (có ack)** → nếu socket đang có trip **hoặc** xe đang hiện trên bản đồ (server giữ tập `onMap`: thêm khi phát vị trí, bỏ khi phát offline): `socket.data.trip = null` và phát `vehicle_offline {vehicle_id}` tới `/`. Luôn ack `{ok:true}`.

**`disconnect`** → nếu socket này vẫn là phiên hiện hành của xe trong `activeDevices`: xóa khỏi map, và nếu đang có trip hoặc xe đang hiện trên bản đồ (`onMap`) thì phát `vehicle_offline`. Nhờ vậy phiên thay thế ngắt trước khi `trip:start` thành công vẫn gỡ được xe mà phiên cũ (im lặng khi bị thay) đã đưa lên bản đồ. Xe chưa từng hiện trên bản đồ thì không phát offline.

### 4.6 Ghi log (`tracking-log.js`)

- Mỗi xe ghi tối đa một lần mỗi 5 giây (giữ `lastLoggedAt` theo `vehicle_id`).
- INSERT như hiện tại. Khi lỗi thì `console.error` (tối đa một lần mỗi 30 giây cho mỗi xe), không nuốt lỗi.

### 4.7 Thay đổi phía viewer (`fleet-tracking.js`)

- Bắt sự kiện `vehicle_offline {vehicle_id}`: gỡ graphic khỏi `fleetLayer`, xóa khỏi `state.busGraphics`, `busAnimStates`, `busCurrentPositions`. Nếu đó là xe đang theo dõi thì đặt lại `selectedTrackedVehicleId = null`.
- `realtime.service.js` nhận thêm handler `onVehicleOffline`. Kết nối dùng `window.io()` không truyền URL (cùng origin).

## 5. Simulator độc lập

### 5.1 Nguyên tắc
Simulator là một client bên ngoài, giống thiết bị GPS thật. Nó chỉ dùng REST public và socket `/device`. Backend và frontend không import, gọi hay biết tới simulator. Khi triển khai thật, xóa thư mục `simulator/` và mục simulator trong README là xong.

### 5.2 Cấu trúc

```
simulator/
  package.json          dependencies: socket.io-client, dotenv; "start": "node src/index.js"
  .env.example          API_URL=http://localhost:3000, SIM_DRIVER_PASSWORD=driver123
  README.md
  src/index.js          parse CLI, tạo các VirtualDriver, bắt SIGINT để trip:end rồi thoát
  src/route-geometry.js processRouteGeometry, getInterpolatedPosition (chuyển nguyên từ backend/simulator.js)
  src/virtual-driver.js vòng đời một tài xế ảo
```

**CLI:** `npm start -- --count 10` (tạo `driver01`…`driver10`) hoặc `npm start -- --drivers driver01,driver05`. Mặc định `--count 5`.

### 5.3 Vòng đời `VirtualDriver`

1. `POST {API_URL}/api/v1/auth/driver/login`. Lỗi mạng → thử lại sau 5 giây. 401/403 → log rồi bỏ tài xế đó.
2. `GET /driver/me` → lấy `schedules[0]`. Không có lịch trình → bỏ tài xế đó.
3. `GET /routes/:route_id/path?direction=` → `processRouteGeometry`. Điểm xuất phát lệch ngẫu nhiên trên tuyến để các xe không chồng lên nhau.
4. `io(API_URL + "/device", { auth: { token } })`.
5. Mỗi `connect` (kể cả reconnect) → `trip:start {schedule_id}` và chờ ack. Ack lỗi → log rồi dừng xe.
6. Mỗi 500ms, khi đã có trip: tính vị trí mới (vận tốc 30–40 km/h, dao động nhẹ) rồi emit `gps_ping {latitude, longitude, speed_kmh, heading}`.
7. Xử lý sự cố:
   - `session:replaced` → dừng tick, tắt reconnect, log "driverNN bị thay bởi thiết bị khác".
   - `connect_error` với message `UNAUTHORIZED` → đăng nhập lại một lần rồi kết nối lại. Vẫn lỗi → dừng xe.

### 5.4 Dọn backend
- Xóa `backend/simulator.js`, xóa script `simulate` trong `backend/package.json`.
- Chuyển `socket.io-client` của backend sang `devDependencies` (chỉ `test_suite.js` dùng).
- Cập nhật README, `ARCHITECTURE_SPEC.md`, `docs/USE_CASES.md` ở những chỗ đang nhắc simulator: mô tả simulator là công cụ demo tùy chọn, nằm ở `simulator/`.

## 6. Trang tài xế `driver.html`

### 6.1 Cấu trúc

```
frontend/driver.html
frontend/assets/css/driver.css
frontend/src/views/driver/
  driver.view.js            entry: registerActions, mountSections, điều hướng 3 màn
  driver.state.js           { user, vehicle, schedules, trip, deviceSocket, watchId, followCamera }
  sections/login.html
  sections/trip-select.html
  sections/drive-panel.html
  features/driver-auth.js   đăng nhập/đăng xuất, kiểm token khi vào trang
  features/trip-select.js   hiện xe + danh sách lịch trình
  features/drive-map.js     bản đồ, polyline, trạm, marker xe mình, camera bám
  features/phone-gps.js     watchPosition, kết nối /device, wake lock
  features/next-stop.js     hàm thuần tính trạm kế tiếp
frontend/src/modules/driver/driver.service.js     driverLogin(), getDriverMe()
frontend/src/modules/realtime/device.service.js   connectDevice(token, handlers)
```

**Sửa core** (không đổi hành vi của admin và bản đồ):
- `session.js`: các hàm `getToken`/`setToken`/`clearToken` nhận tham số `key`, mặc định là `TOKEN_KEY`.
- `http.js`: `request(path, { auth, tokenKey })`, `tokenKey` mặc định `TOKEN_KEY`.
- `config.js`:
  - `API_BASE` đổi từ `"http://localhost:3000/api/v1"` thành đường dẫn tương đối `"/api/v1"`. Bắt buộc, vì khi điện thoại mở trang qua tunnel HTTPS hoặc IP LAN, `localhost` là chính điện thoại; trang HTTPS gọi HTTP còn bị chặn mixed content. Express phục vụ frontend cùng origin nên đường dẫn tương đối luôn đúng.
  - Thêm `DRIVER_TOKEN_KEY = "bus_driver_token"`.
  - Xóa `SOCKET_URL`; socket gọi `window.io()` / `window.io("/device")` cùng origin.
  - Đã rà `frontend/` và `tools/`: chỉ còn `tools/get_coords_1.html` (dòng 629-631) có fallback `localhost:3000` khi mở ngoài cổng 3000. Giữ nguyên vì đó là chủ ý của công cụ.

### 6.2 Màn hình

**Màn 1 – Đăng nhập**
- Form username/password → `driverLogin` → lưu token vào `bus_driver_token`.
- Khi vào trang mà đã có token: gọi `getDriverMe`. Thành công → sang màn 2. Gặp 401/403 → xóa token và ở lại màn 1.

**Màn 2 – Chọn chuyến**
- Hiện họ tên tài xế và biển số xe.
- Danh sách lịch trình hiển thị dạng `Tuyến 08 – <tên> · Lượt đi · 05:30`. Bấm một dòng → sang màn 3.
- Không có lịch trình → hiện "Xe chưa được phân lịch trình".

**Màn 3 – Chạy xe**
- **Bản đồ** ArcGIS toàn màn hình (dùng `loadArcgisModules`). Vẽ polyline tuyến (`paths.service`) và các trạm của tuyến + chiều (`stops.service`).
- **Marker xe mình:** kết nối namespace `/`, lọc `fleet_location_update` theo `vehicle_id` của tài xế. Marker đúng dù GPS đến từ điện thoại hay simulator. Nhận `vehicle_offline` của xe mình thì ẩn marker.
- **Camera** bám xe (`goTo` không animation khi có vị trí mới). Nút bật/tắt bám; người dùng kéo bản đồ thì tự tắt bám.
- **Panel dưới:**
  - tuyến, chiều, tốc độ
  - trạm kế tiếp
  - badge kết nối (ONLINE / OFFLINE)
  - badge nguồn GPS: `Điện thoại` khi phiên `/device` của trang này đang phát; `Thiết bị khác` khi nhận được vị trí xe mình mà trang không phát; `Chưa có tín hiệu` khi không nhận gì trong 10 giây
- **Nút "Bắt đầu chuyến":**
  1. Kiểm `window.isSecureContext` và `navigator.geolocation`. Không đạt → toast "Cần HTTPS hoặc localhost để dùng GPS điện thoại" và dừng.
  2. `connectDevice(token)` → `trip:start` → `navigator.geolocation.watchPosition({enableHighAccuracy:true})`.
  3. Mỗi vị trí mới (bỏ qua nếu < 1 giây từ lần gửi trước): `speed_kmh = coords.speed != null ? coords.speed * 3.6 : 0`, `heading = coords.heading ?? 0`, rồi emit `gps_ping`.
  4. Xin `navigator.wakeLock.request("screen")` nếu trình duyệt hỗ trợ; xin lại khi tab hiện trở lại.
- **Nút "Kết thúc chuyến":** `trip:end` → `clearWatch` → ngắt `/device` → nhả wake lock.
- **Nhận `session:replaced`:** dừng GPS, hiện banner "Xe đang được điều khiển từ thiết bị khác".
- **Nút "Đổi chuyến"** (quay lại màn 2; nếu đang chạy thì kết thúc chuyến trước) và **nút "Đăng xuất"**.

### 6.3 `next-stop.js`

```js
nextStop(position, pathCoords, stops) → { stop, distanceMeters } | null
```
1. Chiếu `position` lên polyline: tìm đoạn gần nhất, tính quãng đường từ đầu tuyến tới điểm chiếu. Dùng công thức hiệu chỉnh cos(vĩ độ) giống `path-clip.js`.
2. Chiếu từng trạm lên polyline theo cùng cách.
3. Lấy trạm có vị trí chiếu lớn hơn vị trí xe, nhỏ nhất theo `stop_order`.
4. Xe đã qua trạm cuối → trả `null`; UI hiện "Đã đến cuối tuyến".

### 6.4 Liên kết
Top bar của `index.html` thêm link nhỏ "Tài xế" trỏ tới `driver.html`.

### 6.5 Giới hạn GPS trên điện thoại
Trình duyệt chỉ cho đọc GPS trên HTTPS hoặc `localhost`. Điện thoại truy cập qua `http://192.168.x.x` sẽ không đọc được vị trí. Hai cách test, ghi vào README:
- **(a)** Laptop mở `http://localhost:3000/frontend/driver.html`, giả lập vị trí bằng DevTools → Sensors.
- **(b)** Mở tunnel HTTPS (`cloudflared tunnel --url http://localhost:3000` hoặc `ngrok http 3000`) rồi dùng điện thoại thật.

## 7. Xử lý lỗi (tổng hợp)

| Tình huống | Phía server | Phía client |
|---|---|---|
| Không có hoặc sai token `/device` | `connect_error` "UNAUTHORIZED" | driver: quay về màn đăng nhập; simulator: đăng nhập lại 1 lần |
| Tài xế chưa được gán xe | Login 403; handshake "NO_VEHICLE" | driver: toast lỗi; simulator: bỏ tài xế |
| Schedule không thuộc xe | ack `SCHEDULE_NOT_ALLOWED` | toast lỗi / log |
| Ping sai định dạng hoặc quá nhanh | bỏ gói, warn có giới hạn | — |
| Phiên mới cùng xe | phiên cũ nhận `session:replaced` rồi bị ngắt | banner / simulator dừng xe |
| Lỗi ghi log DB | `console.error` có giới hạn, vẫn phát realtime | — |
| Token DRIVER gọi API quản trị | 403 | — |

## 8. Kiểm thử

### 8.1 Unit test (`node:test`, chạy bằng `node --test`)
- `backend/src/sockets/gps.validate.test.js`: hợp lệ; thiếu lat; lat = 999; lon dạng string; speed âm; heading = 360; field thừa bị bỏ; giá trị mặc định cho speed/heading.
- `frontend/src/views/driver/features/next-stop.test.js`: xe ở đầu tuyến; giữa hai trạm; vừa qua trạm; sau trạm cuối.
- `simulator/src/route-geometry.test.js`: nội suy tại 0, giữa đoạn, quấn vòng về đầu.

Thêm script `"test:unit": "node --test"` ở backend và simulator. File test của frontend chạy bằng lệnh `node --test frontend/src/views/driver/features/`.

### 8.2 Integration (`backend/test_suite.js`, viết lại phần socket ở dòng 329-370)

Điều kiện: backend đang chạy và đã chạy `db:seed-drivers`.

1. ✅ `driver01` login → `/device` → `trip:start` → ping → client viewer nhận `fleet_location_update` với `vehicle_id = "DRV_01"` và đúng `route_id`.
2. ❌ `/device` không có token → `connect_error` "UNAUTHORIZED".
3. ❌ Token ADMIN vào `/device` → "UNAUTHORIZED".
4. ❌ Viewer emit `gps_ping` → không client nào nhận `fleet_location_update` trong 1 giây.
5. ❌ `driver01` gửi `trip:start` với schedule của `DRV_02` → ack `SCHEDULE_NOT_ALLOWED`.
6. ❌ Ping `latitude: 999` → không phát.
7. ✅ Phiên thứ hai của `driver01` → phiên đầu nhận `session:replaced`.
8. ✅ `trip:end` → viewer nhận `vehicle_offline {vehicle_id:"DRV_01"}`.
8b. ❌ Admin `PUT /users/:id` với `role: "SUPERUSER"` → 400.
9. ❌ Token DRIVER gọi `POST /routes` → 403; `GET /export/json` → 403.
10. ✅ `POST /auth/driver/login` với tài khoản admin → 403; `POST /auth/login` với `driver01` → 403.

### 8.3 Kiểm tra thủ công
- Chạy simulator `--count 10` → bản đồ công khai thấy 10 xe; `SELECT COUNT(*) FROM vehicle_tracking_logs` tăng sau 10 giây.
- Mở `driver.html` với `driver01`, chọn chuyến, bấm Bắt đầu với DevTools Sensors → marker theo vị trí giả lập, badge nguồn hiện "Điện thoại"; log simulator báo `driver01` bị thay.
- Kết thúc chuyến → xe `DRV_01` biến khỏi bản đồ công khai.

## 9. Cập nhật tài liệu theo dõi
Sau khi xong, cập nhật [SOCKET_IO_TRACKING.md](../../SOCKET_IO_TRACKING.md):
- **DONE:** #1, #3, #11, #12, #13
- **DOING:** #2 (đã ghi log được và có throttle; ghi theo lô để nhóm B)
- **DOING:** #8 (đã có `vehicle_offline` khi kết thúc chuyến; quét timeout để nhóm B)
- Thêm dòng vào Nhật ký thay đổi.

Về #11: `API_BASE` và `SOCKET_URL` đều thành cùng origin (xem 6.1).

Về #12: trang admin không dùng realtime, nên xóa thẻ script CDN socket.io trong `admin.html`.
