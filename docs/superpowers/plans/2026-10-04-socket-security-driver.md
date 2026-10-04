# Socket Security & Driver Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chỉ tài xế đã đăng nhập mới phát được GPS cho đúng xe của mình. Có trang `driver.html` cho tài xế, và một simulator độc lập đóng vai các tài xế ảo.

**Architecture:**
- Socket.io tách hai namespace: `/` (viewer, chỉ nhận) và `/device` (JWT role DRIVER).
- Server tự xác định danh tính xe và dựng gói phát, không tin `vehicle_id` từ client.
- Tài khoản tài xế gắn với xe qua `vehicles.driver_user_id`; seed sinh dữ liệu demo.
- Simulator là client bên ngoài (REST public + `/device`), nằm trong thư mục riêng `simulator/`.
- Trang tài xế tái dùng các module frontend có sẵn.

**Tech Stack:** Node.js 26 (`node:test`), Express 4, Socket.io 4.7, mysql2 / MariaDB 10.4, jsonwebtoken, bcryptjs, ArcGIS Maps SDK 4.29 (AMD qua CDN), ES modules thuần ở frontend.

**Spec:** [docs/superpowers/specs/2026-10-04-socket-security-driver-design.md](../specs/2026-10-04-socket-security-driver-design.md)

## Global Constraints

- **Nhánh:** `feat/socket-security-driver`. Mọi commit kết thúc bằng dòng `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **MariaDB 10.4:** WKT dạng `POINT(<lon> <lat>)` với `ST_GeomFromText(?, 4326)`, **không** truyền tham số `axis-order`.
- **Thứ tự script:** frontend nạp socket.io qua CDN `https://cdn.socket.io/4.7.5/socket.io.min.js` **trước** script ArcGIS `https://js.arcgis.com/4.29/` (tránh xung đột AMD).
- **Ngôn ngữ:** chữ hiển thị và comment viết tiếng Việt, ngắn gọn, theo phong cách code hiện có.
- **Token key:** bản đồ + admin dùng `bus_admin_token`; trang tài xế dùng `bus_driver_token`.
- **Seed:** user `driverNN` (role `DRIVER`, họ tên `Tài xế NN`), xe `DRV_NN`, biển `51B-900.NN`. Mật khẩu `driver123` hoặc env `SEED_DRIVER_PASSWORD`. `count` trong khoảng 1..99, mặc định 20.
- **Tên sự kiện:** `trip:start`, `trip:end`, `gps_ping`, `session:replaced`, `fleet_location_update`, `vehicle_offline`.
- **Lỗi handshake:** `UNAUTHORIZED`, `NO_VEHICLE`, `SERVER_ERROR`. **Lỗi ack:** `SCHEDULE_NOT_ALLOWED`, `SERVER_ERROR`.
- **Ngưỡng thời gian và kích thước:**

  | Tham số | Giá trị |
  |---|---|
  | Khoảng cách tối thiểu giữa 2 ping được nhận | 250ms |
  | Ghi log mỗi xe | 5s/lần |
  | Log lỗi DB mỗi xe | 30s/lần |
  | Warn gói sai mỗi socket | 10s/lần |
  | `maxHttpBufferSize` | 16KB |
  | Hạn token tài xế | 12h |
  | Điện thoại gửi tối đa | 1s/lần |
  | Tick simulator | 500ms |
  | Mất tín hiệu sau | 10s |

- **Validate:** lat ∈ [-90, 90], lon ∈ [-180, 180], speed ∈ [0, 200], heading ∈ [0, 360).
- **Simulator độc lập:** không file nào trong `backend/` hay `frontend/` được import hoặc nhắc tới `simulator/` trong code.
- **Khởi động lại backend** (dùng ở nhiều task):
  ```bash
  kill $(lsof -ti tcp:3000) 2>/dev/null; sleep 1
  (cd backend && nohup node server.js > server.log 2>&1 &); sleep 2; tail -5 backend/server.log
  ```

## Review Focus

1. **Heading làm tròn thành 360.** `toFixed(1)` của 359.96 cho ra 360.0, bị validator từ chối, khiến xe ảo đứng im không báo lỗi. Simulator phải chuẩn hóa về [0, 360). Có test ở Task 8 (route-geometry) và test biên ở Task 4.
2. **Phiên cũ bị thay không được phát `vehicle_offline`.** Nếu phát, xe sẽ biến khỏi bản đồ công khai dù điện thoại vẫn đang chạy. Test ở Task 6.
3. **Reconnect mất trip.** Socket.io reconnect tạo socket mới không có trip, nên mọi ping sau đó bị bỏ. Simulator và trang tài xế phải gửi lại `trip:start` sau mỗi lần reconnect. Server bỏ ping khi chưa có trip có test ở Task 6; client xử lý ở Task 8 và Task 10, kiểm tra thủ công bằng cách khởi động lại backend.
4. **Seed lại không được mất log hành trình.** Chạy lại với cùng `count` phải giữ log; chỉ xe bị bỏ (khi giảm `count`) mới mất log. Kiểm tra ở Task 1, bước xác minh.
5. **Token tài xế hết hạn hoặc hỏng trên `driver.html`.** Phải quay về màn đăng nhập, không để màn trắng. Kiểm tra thủ công ở Task 10 bằng cách gán token rác vào localStorage.

---

### Task 1: Schema, migration và seed tài xế

**Files:**
- Modify: `database/schema.sql` (khối DROP ở dòng 11-30; bảng `users` dòng 13-21; bảng `vehicles` dòng 80-86)
- Create: `backend/scripts/seed_drivers.js`
- Modify: `backend/package.json` (scripts)

**Interfaces:**
- Produces:
  - Bảng `users.role` có giá trị `'DRIVER'`
  - Cột `vehicles.driver_user_id INT NULL UNIQUE`, FK `fk_vehicles_driver`
  - Lệnh `npm run db:seed-drivers -- --count N`
  - Dữ liệu `driver01..driverNN` / `DRV_01..DRV_NN`, mỗi xe một `schedules`

- [ ] **Step 1: Viết lệnh kiểm tra schema (sẽ fail)**

Chạy lệnh dưới. Nó áp `schema.sql` hai lần vào một DB nháp rồi kiểm cột mới.

```bash
cd backend && node -e '
const mysql=require("mysql2/promise");const fs=require("fs");const {DB}=require("./src/config/env");
(async()=>{const c=await mysql.createConnection({host:DB.host,user:DB.user,password:DB.password,multipleStatements:true});
await c.query("DROP DATABASE IF EXISTS bus_schema_check");await c.query("CREATE DATABASE bus_schema_check");await c.query("USE bus_schema_check");
const sql=fs.readFileSync("../database/schema.sql","utf8").replace(/^CREATE DATABASE[^;]*;/m,"").replace(/^USE [^;]*;/m,"");
try{await c.query(sql);await c.query(sql);console.log("schema applied twice OK");
const [r]=await c.query("SHOW COLUMNS FROM vehicles LIKE \"driver_user_id\"");console.log(r.length===1?"driver_user_id OK":"driver_user_id MISSING");
const [e]=await c.query("SHOW COLUMNS FROM users LIKE \"role\"");console.log(e[0].Type.includes("DRIVER")?"role DRIVER OK":"role DRIVER MISSING");}
finally{await c.query("DROP DATABASE bus_schema_check");await c.end();}})().catch(e=>{console.error("FAIL",e.message);process.exit(1)})'
```

Expected: `schema applied twice OK`, `driver_user_id MISSING`, `role DRIVER MISSING`.

- [ ] **Step 2: Sửa `database/schema.sql`**

Thay đoạn ở dòng 11-12:

```sql
-- 0. Bảng Người dùng & Phân quyền Quản trị (Auth & Users)
DROP TABLE IF EXISTS users;
```

bằng (gom mọi lệnh DROP lên đầu theo thứ tự con → cha, vì `vehicles` giờ có khóa ngoại tới `users`):

```sql
-- Xóa bảng cũ theo thứ tự con → cha (vehicles tham chiếu users, logs/schedules tham chiếu vehicles)
DROP TABLE IF EXISTS vehicle_tracking_logs;
DROP TABLE IF EXISTS schedules;
DROP TABLE IF EXISTS route_stops;
DROP TABLE IF EXISTS route_paths;
DROP TABLE IF EXISTS vehicles;
DROP TABLE IF EXISTS bus_stops;
DROP TABLE IF EXISTS bus_routes;
DROP TABLE IF EXISTS users;

-- 0. Bảng Người dùng & Phân quyền (ADMIN/MANAGER quản trị, DRIVER tài xế)
```

Trong `CREATE TABLE users`, đổi dòng:

```sql
    role ENUM('ADMIN', 'MANAGER', 'VIEWER') DEFAULT 'MANAGER',
```

thành:

```sql
    role ENUM('ADMIN', 'MANAGER', 'VIEWER', 'DRIVER') DEFAULT 'MANAGER',
```

Xóa khối DROP cũ ngay sau comment `-- 1. Bảng Tuyến xe buýt (Thực thể thuộc tính)`. Đó là 7 dòng `DROP TABLE IF EXISTS route_stops;` … `DROP TABLE IF EXISTS bus_routes;`.

Thay `CREATE TABLE vehicles (...)` bằng:

```sql
CREATE TABLE vehicles (
    vehicle_id VARCHAR(20) PRIMARY KEY,
    plate_number VARCHAR(20) NOT NULL UNIQUE,
    capacity INT DEFAULT 40,
    driver_name VARCHAR(100),
    status VARCHAR(30) DEFAULT 'ACTIVE',
    driver_user_id INT NULL UNIQUE,                  -- Tài khoản tài xế phụ trách (1 tài xế ↔ 1 xe)
    CONSTRAINT fk_vehicles_driver FOREIGN KEY (driver_user_id) REFERENCES users(user_id) ON DELETE SET NULL
) ENGINE=InnoDB;
```

- [ ] **Step 3: Chạy lại lệnh ở Step 1**

Expected: `schema applied twice OK`, `driver_user_id OK`, `role DRIVER OK`.

- [ ] **Step 4: Tạo `backend/scripts/seed_drivers.js`**

```js
// --------------------------------------------------------------------
// SEED TÀI XẾ DEMO: driverNN (role DRIVER) + xe DRV_NN + 1 lịch trình / xe
// Chạy: npm run db:seed-drivers -- --count 20
// Chạy lại an toàn: upsert theo khóa cố định để KHÔNG mất log hành trình
// (vehicle_tracking_logs xóa theo xe — ON DELETE CASCADE).
// --------------------------------------------------------------------
const bcrypt = require("bcryptjs");
const { dbPool } = require("../src/config/db");

const MAX_COUNT = 99;
const pad2 = n => String(n).padStart(2, "0");

function parseCount(argv) {
  const i = argv.indexOf("--count");
  const n = i >= 0 ? Number(argv[i + 1]) : 20;
  if (!Number.isInteger(n) || n < 1 || n > MAX_COUNT) {
    throw new Error(`--count phải là số nguyên 1..${MAX_COUNT}`);
  }
  return n;
}

// DB đang chạy có thể tạo từ schema cũ → bổ sung DRIVER & driver_user_id (DDL, chạy ngoài transaction)
async function migrate(conn) {
  const [[roleCol]] = await conn.query(
    `SELECT COLUMN_TYPE AS type FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'role'`
  );
  if (!roleCol.type.includes("'DRIVER'")) {
    await conn.query("ALTER TABLE users MODIFY role ENUM('ADMIN','MANAGER','VIEWER','DRIVER') DEFAULT 'MANAGER'");
    console.log("    + users.role thêm DRIVER");
  }

  const [driverCol] = await conn.query(
    `SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'vehicles' AND COLUMN_NAME = 'driver_user_id'`
  );
  if (driverCol.length === 0) {
    await conn.query(
      `ALTER TABLE vehicles
         ADD COLUMN driver_user_id INT NULL UNIQUE,
         ADD CONSTRAINT fk_vehicles_driver FOREIGN KEY (driver_user_id) REFERENCES users(user_id) ON DELETE SET NULL`
    );
    console.log("    + vehicles.driver_user_id");
  }
}

// Cặp (tuyến, chiều) của các tuyến có đủ 2 chiều; tuyến số đứng trước tuyến chữ (D4, DL01...)
async function pickRoutePairs(conn, count) {
  const [rows] = await conn.query(
    `SELECT p.route_id, r.route_number, p.direction
     FROM route_paths p
     JOIN bus_routes r ON r.route_id = p.route_id
     WHERE p.route_id IN (
       SELECT route_id FROM route_paths GROUP BY route_id HAVING COUNT(DISTINCT direction) = 2
     )
     ORDER BY r.route_number REGEXP '^[0-9]+$' DESC, CAST(r.route_number AS UNSIGNED), r.route_number, p.direction`
  );
  if (rows.length < count) {
    throw new Error(`Chỉ có ${rows.length} cặp tuyến/chiều đủ 2 chiều, không đủ cho ${count} tài xế`);
  }
  return rows.slice(0, count);
}

async function upsertDriver(conn, i, pair, passwordHash) {
  const nn = pad2(i);
  const username = `driver${nn}`;
  const fullName = `Tài xế ${nn}`;
  const vehicleId = `DRV_${nn}`;

  await conn.query(
    `INSERT INTO users (username, password_hash, full_name, email, role)
     VALUES (?, ?, ?, ?, 'DRIVER')
     ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash), full_name = VALUES(full_name), role = 'DRIVER'`,
    [username, passwordHash, fullName, `${username}@busgis.vn`]
  );
  const [[{ user_id }]] = await conn.query("SELECT user_id FROM users WHERE username = ?", [username]);

  await conn.query(
    `INSERT INTO vehicles (vehicle_id, plate_number, capacity, driver_name, status, driver_user_id)
     VALUES (?, ?, 45, ?, 'ACTIVE', ?)
     ON DUPLICATE KEY UPDATE plate_number = VALUES(plate_number), driver_name = VALUES(driver_name),
                             status = 'ACTIVE', driver_user_id = VALUES(driver_user_id)`,
    [vehicleId, `51B-900.${nn}`, fullName, user_id]
  );

  // schedules không có bảng con → thay mới an toàn
  await conn.query("DELETE FROM schedules WHERE vehicle_id = ?", [vehicleId]);
  await conn.query(
    "INSERT INTO schedules (route_id, vehicle_id, departure_time, direction) VALUES (?, ?, SEC_TO_TIME(?), ?)",
    [pair.route_id, vehicleId, 5 * 3600 + i * 600, pair.direction]
  );
}

// Bản ghi seed có số thứ tự > count (lần chạy trước dùng count lớn hơn) → xóa; trả về số xe đã xóa
async function removeExtras(conn, count) {
  const [vehicles] = await conn.query("SELECT vehicle_id FROM vehicles WHERE vehicle_id LIKE 'DRV\\_%'");
  const extraVehicleIds = vehicles
    .map(v => v.vehicle_id)
    .filter(id => /^DRV_\d{2}$/.test(id) && Number(id.slice(4)) > count);

  const [users] = await conn.query("SELECT user_id, username FROM users WHERE role = 'DRIVER' AND username LIKE 'driver%'");
  const extraUserIds = users
    .filter(u => /^driver\d{2}$/.test(u.username) && Number(u.username.slice(6)) > count)
    .map(u => u.user_id);

  if (extraVehicleIds.length > 0) {
    await conn.query("DELETE FROM schedules WHERE vehicle_id IN (?)", [extraVehicleIds]);
    await conn.query("DELETE FROM vehicles WHERE vehicle_id IN (?)", [extraVehicleIds]);
  }
  if (extraUserIds.length > 0) {
    await conn.query("DELETE FROM users WHERE user_id IN (?)", [extraUserIds]);
  }
  return extraVehicleIds.length;
}

async function main() {
  const count = parseCount(process.argv.slice(2));
  const password = process.env.SEED_DRIVER_PASSWORD || "driver123";
  const conn = await dbPool.getConnection();
  try {
    console.log(">>> [Seed] Kiểm tra cấu trúc bảng cho tài xế");
    await migrate(conn);

    const pairs = await pickRoutePairs(conn, count);
    const passwordHash = await bcrypt.hash(password, 10);

    await conn.beginTransaction();
    try {
      for (let i = 1; i <= count; i++) await upsertDriver(conn, i, pairs[i - 1], passwordHash);
      const removed = await removeExtras(conn, count);
      await conn.commit();
      console.log(`>>> [Seed] Xong: driver01..driver${pad2(count)} (mật khẩu "${password}"), xe DRV_01..DRV_${pad2(count)}`);
      if (removed > 0) console.log(`>>> [Seed] Đã xóa ${removed} xe seed thừa (log hành trình của các xe này bị xóa theo)`);
    } catch (err) {
      await conn.rollback();
      throw err;
    }
  } finally {
    conn.release();
    await dbPool.end();
  }
}

main().catch(err => {
  console.error(">>> [Seed] Thất bại:", err.message);
  process.exit(1);
});
```

- [ ] **Step 5: Thêm script vào `backend/package.json`**

Trong `"scripts"`, thêm dòng sau `"db:export"` (nhớ thêm dấu phẩy cuối dòng `db:export`):

```json
    "db:seed-drivers": "node scripts/seed_drivers.js"
```

- [ ] **Step 6: Chạy seed và kiểm tra**

```bash
cd backend && npm run db:seed-drivers -- --count 4
```

Expected: có `+ users.role thêm DRIVER`, `+ vehicles.driver_user_id` (chỉ ở lần đầu), và `Xong: driver01..driver04`.

Kiểm tra dữ liệu và việc giữ log (Review Focus #4):

```bash
cd backend && node -e '
const {dbPool}=require("./src/config/db");
(async()=>{const q=async s=>(await dbPool.query(s))[0];
await dbPool.query("INSERT INTO vehicle_tracking_logs (vehicle_id, speed_kmh, heading, geom) VALUES (\"DRV_01\",30,90,ST_GeomFromText(\"POINT(106.7 10.8)\",4326))");
console.log("before reseed DRV_01 logs:",(await q("SELECT COUNT(*) n FROM vehicle_tracking_logs WHERE vehicle_id=\"DRV_01\""))[0].n);
await dbPool.end();})()'
npm run db:seed-drivers -- --count 4
node -e '
const {dbPool}=require("./src/config/db");
(async()=>{const q=async s=>(await dbPool.query(s))[0];
console.log("after reseed DRV_01 logs:",(await q("SELECT COUNT(*) n FROM vehicle_tracking_logs WHERE vehicle_id=\"DRV_01\""))[0].n);
console.log(await q("SELECT v.vehicle_id,v.plate_number,u.username,s.route_id,s.direction,s.departure_time FROM vehicles v JOIN users u ON u.user_id=v.driver_user_id JOIN schedules s ON s.vehicle_id=v.vehicle_id WHERE v.vehicle_id LIKE \"DRV%\" ORDER BY v.vehicle_id"));
await dbPool.end();})()'
```

Expected:
- `after reseed DRV_01 logs:` bằng `before reseed …` (≥ 1).
- 4 dòng `DRV_01..DRV_04`, mỗi dòng có username, tuyến, chiều; xe 1 và 2 cùng tuyến, khác chiều.

Thử giảm `count` rồi seed lại bộ chuẩn:

```bash
cd backend && npm run db:seed-drivers -- --count 2 && npm run db:seed-drivers -- --count 20
```

Expected: lần `--count 2` in `Đã xóa 2 xe seed thừa`. Lần `--count 20` in `Xong: driver01..driver20`.

- [ ] **Step 7: Commit**

```bash
git add database/schema.sql backend/scripts/seed_drivers.js backend/package.json
git commit -m "feat(db): add DRIVER role, vehicle-driver link and driver seed

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Phân quyền RBAC cho route quản trị + whitelist role

**Files:**
- Modify: `backend/src/middleware/auth.js`
- Create: `backend/src/middleware/auth.test.js`
- Modify: `backend/package.json` (script `test:unit`)
- Modify: `backend/src/modules/{bus-routes,paths,stops,vehicles,schedules,import-export,admin-stats,users}/*.routes.js`
- Modify: `backend/src/modules/users/users.controller.js`
- Modify: `frontend/src/views/admin/sections/modals/user.html:29-32`

**Interfaces:**
- Produces:
  - `requireRole(...roles) → express middleware`. Trả 403 `{error}` khi `req.user.role` không nằm trong `roles`.
  - `requireStaff = requireRole("ADMIN", "MANAGER")`.
  - Lệnh `npm run test:unit` trong `backend/`.

- [ ] **Step 1: Viết test fail `backend/src/middleware/auth.test.js`**

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const { requireRole, requireStaff } = require("./auth");

// Chạy middleware với req.user giả, ghi lại status và việc gọi next()
function run(middleware, user) {
  const result = { status: null, nextCalled: false };
  const res = {
    status(code) { result.status = code; return this; },
    json() { return this; }
  };
  middleware({ user }, res, () => { result.nextCalled = true; });
  return result;
}

test("requireRole cho qua khi role khớp", () => {
  assert.deepEqual(run(requireRole("DRIVER"), { role: "DRIVER" }), { status: null, nextCalled: true });
});

test("requireRole chặn 403 khi role không khớp", () => {
  assert.deepEqual(run(requireRole("DRIVER"), { role: "ADMIN" }), { status: 403, nextCalled: false });
});

test("requireRole chặn 403 khi thiếu req.user", () => {
  assert.deepEqual(run(requireRole("ADMIN"), undefined), { status: 403, nextCalled: false });
});

test("requireStaff cho ADMIN và MANAGER, chặn DRIVER và VIEWER", () => {
  assert.equal(run(requireStaff, { role: "ADMIN" }).nextCalled, true);
  assert.equal(run(requireStaff, { role: "MANAGER" }).nextCalled, true);
  assert.equal(run(requireStaff, { role: "DRIVER" }).status, 403);
  assert.equal(run(requireStaff, { role: "VIEWER" }).status, 403);
});
```

Thêm vào `"scripts"` của `backend/package.json`:

```json
    "test:unit": "node --test \"src/**/*.test.js\""
```

- [ ] **Step 2: Chạy test, xác nhận fail**

Run: `cd backend && npm run test:unit`
Expected: FAIL với `TypeError: requireRole is not a function`.

- [ ] **Step 3: Cài đặt `requireRole`/`requireStaff`**

Trong `backend/src/middleware/auth.js`, thêm trước `module.exports` và sửa dòng export:

```js
// Cho qua khi vai trò trong token thuộc danh sách roles
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: "Tài khoản không có quyền thực hiện thao tác này" });
    }
    next();
  };
}

// Nhân viên quản trị (ADMIN/MANAGER) — token tài xế (DRIVER) không được gọi API quản trị
const requireStaff = requireRole("ADMIN", "MANAGER");

module.exports = { authenticateToken, requireAdmin, requireRole, requireStaff };
```

- [ ] **Step 4: Chạy test, xác nhận pass**

Run: `cd backend && npm run test:unit`
Expected: 4 test pass, 0 fail.

- [ ] **Step 5: Gắn `requireStaff` vào route quản trị**

Ở mỗi file dưới đây:
- đổi dòng import thành `const { authenticateToken, requireStaff } = require("../../middleware/auth");` (riêng `users.routes.js` thì giữ thêm `requireAdmin`);
- chèn `requireStaff` ngay sau `authenticateToken` ở các route được liệt kê.

`bus-routes/bus-routes.routes.js`:
```js
router.post("/routes", authenticateToken, requireStaff, controller.createRoute);
router.put("/routes/:route_id", authenticateToken, requireStaff, controller.updateRoute);
router.delete("/routes/:route_id", authenticateToken, requireStaff, controller.deleteRoute);
```

`paths/paths.routes.js`:
```js
router.post("/routes/:route_id/path", authenticateToken, requireStaff, controller.saveRoutePath);
```

`stops/stops.routes.js`:
```js
router.post("/stops", authenticateToken, requireStaff, controller.createStop);
router.put("/stops/:stop_id", authenticateToken, requireStaff, controller.updateStop);
router.delete("/stops/:stop_id", authenticateToken, requireStaff, controller.deleteStop);
router.post("/routes/:route_id/stops", authenticateToken, requireStaff, controller.assignStopToRoute);
router.delete("/routes/:route_id/stops/:stop_id", authenticateToken, requireStaff, controller.removeStopFromRoute);
```

`vehicles/vehicles.routes.js`:
```js
router.post("/vehicles", authenticateToken, requireStaff, controller.createVehicle);
router.put("/vehicles/:vehicle_id", authenticateToken, requireStaff, controller.updateVehicle);
router.delete("/vehicles/:vehicle_id", authenticateToken, requireStaff, controller.deleteVehicle);
```

`schedules/schedules.routes.js`:
```js
router.post("/schedules", authenticateToken, requireStaff, controller.createSchedule);
router.put("/schedules/:id", authenticateToken, requireStaff, controller.updateSchedule);
router.delete("/schedules/:id", authenticateToken, requireStaff, controller.deleteSchedule);
```

`import-export/import-export.routes.js`:
```js
router.post("/import/json", authenticateToken, requireStaff, controller.importJson);
router.get("/export/json", authenticateToken, requireStaff, controller.exportJson);
```

`admin-stats/admin-stats.routes.js`:
```js
router.get("/admin/stats", authenticateToken, requireStaff, controller.getStats);
```

`users/users.routes.js` (import `{ authenticateToken, requireAdmin, requireStaff }`):
```js
router.get("/users", authenticateToken, requireStaff, controller.listUsers);
```

Kiểm tra không sót route ghi nào:

```bash
cd backend && grep -rn "router\.\(post\|put\|delete\)" src/modules | grep -v "requireStaff\|requireAdmin\|auth/login"
```

Expected: không có dòng nào.

- [ ] **Step 6: Whitelist role trong `users.controller.js`**

Thêm ngay dưới các dòng `require`:

```js
// Vai trò được phép gán qua trang quản trị (VIEWER không đăng nhập được nên không cấp)
const ALLOWED_ROLES = ["ADMIN", "MANAGER", "DRIVER"];
```

Trong `createUser`, ngay sau khối kiểm tra thiếu thông tin bắt buộc, thêm:

```js
  const finalRole = role || "MANAGER";
  if (!ALLOWED_ROLES.includes(finalRole)) {
    return res.status(400).json({ error: "Vai trò không hợp lệ" });
  }
```

rồi đổi `role || "MANAGER"` trong mảng tham số INSERT thành `finalRole`.

Trong `updateUser`, ngay sau dòng `const { full_name, email, role, password } = req.body;`, thêm:

```js
  if (!ALLOWED_ROLES.includes(role)) {
    return res.status(400).json({ error: "Vai trò không hợp lệ" });
  }
```

- [ ] **Step 7: Thêm option DRIVER vào modal user**

Trong `frontend/src/views/admin/sections/modals/user.html`, ngay sau option ADMIN, thêm:

```html
            <option value="DRIVER">DRIVER (Tài xế)</option>
```

- [ ] **Step 8: Kiểm tra trên server thật**

Khởi động lại backend (lệnh ở Global Constraints), rồi chạy:

```bash
M=$(curl -s -X POST localhost:3000/api/v1/auth/login -H 'Content-Type: application/json' -d '{"username":"manager","password":"manager123"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).token')
A=$(curl -s -X POST localhost:3000/api/v1/auth/login -H 'Content-Type: application/json' -d '{"username":"admin","password":"admin123"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).token')
curl -s -o /dev/null -w "manager GET /users: %{http_code}\n" localhost:3000/api/v1/users -H "Authorization: Bearer $M"
curl -s -o /dev/null -w "admin PUT bad role: %{http_code}\n" -X PUT localhost:3000/api/v1/users/0 -H "Authorization: Bearer $A" -H 'Content-Type: application/json' -d '{"full_name":"x","email":"","role":"SUPERUSER"}'
```

Expected: `manager GET /users: 200`, `admin PUT bad role: 400`.

- [ ] **Step 9: Commit**

```bash
git add backend/src/middleware backend/src/modules backend/package.json frontend/src/views/admin/sections/modals/user.html
git commit -m "feat(auth): require staff role on admin APIs and whitelist user roles

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: API đăng nhập tài xế, `/driver/me`, CORS theo env

**Files:**
- Create: `backend/src/modules/driver/driver.controller.js`
- Create: `backend/src/modules/driver/driver.routes.js`
- Modify: `backend/src/app.js`
- Modify: `backend/src/config/env.js`
- Modify: `backend/server.js`

**Interfaces:**
- Consumes: `requireRole` (Task 2); bảng `vehicles.driver_user_id` (Task 1).
- Produces:
  - `POST /api/v1/auth/driver/login {username, password}`:
    - 200 → `{token, user:{user_id, username, full_name, role:"DRIVER", vehicle_id}}`
    - 400 khi thiếu field; 401 khi sai thông tin; 403 khi không phải DRIVER hoặc chưa gán xe
  - `GET /api/v1/driver/me` (Bearer token DRIVER):
    - 200 → `{user:{user_id, username, full_name}, vehicle:{vehicle_id, plate_number}, schedules:[{schedule_id, route_id, route_number, route_name, direction, departure_time:"HH:MM"}]}`
  - `env.CORS_ORIGIN: string[] | null`.

- [ ] **Step 1: Xác nhận endpoint chưa tồn tại**

Run: `curl -s -o /dev/null -w "%{http_code}\n" -X POST localhost:3000/api/v1/auth/driver/login -H 'Content-Type: application/json' -d '{"username":"driver01","password":"driver123"}'`
Expected: `404`.

- [ ] **Step 2: Tạo `backend/src/modules/driver/driver.controller.js`**

```js
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const { dbPool } = require("../../config/db");
const { JWT_SECRET } = require("../../config/env");

// Xe đang gán cho tài xế (đọc từ DB mỗi lần → gán lại xe có hiệu lực ngay)
async function findDriverVehicle(userId) {
  const [rows] = await dbPool.query(
    "SELECT vehicle_id, plate_number FROM vehicles WHERE driver_user_id = ?",
    [userId]
  );
  return rows[0] || null;
}

// Đăng nhập tài xế: chỉ role DRIVER và đã được gán xe
async function login(req, res) {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: "Vui lòng nhập tên đăng nhập và mật khẩu" });
  }

  try {
    const [users] = await dbPool.query("SELECT * FROM users WHERE username = ?", [username]);
    const user = users[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: "Tên đăng nhập hoặc mật khẩu không chính xác" });
    }
    if (user.role !== "DRIVER") {
      return res.status(403).json({ error: "Tài khoản không phải tài xế" });
    }

    const vehicle = await findDriverVehicle(user.user_id);
    if (!vehicle) {
      return res.status(403).json({ error: "Tài xế chưa được gán xe" });
    }

    const payload = {
      user_id: user.user_id,
      username: user.username,
      full_name: user.full_name,
      role: "DRIVER",
      vehicle_id: vehicle.vehicle_id
    };
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: "12h" });
    res.json({ token, user: payload });
  } catch (error) {
    console.error("Lỗi đăng nhập tài xế:", error);
    res.status(500).json({ error: "Lỗi hệ thống máy chủ" });
  }
}

// Hồ sơ tài xế: xe đang phụ trách + các lịch trình của xe
async function me(req, res) {
  try {
    const vehicle = await findDriverVehicle(req.user.user_id);
    if (!vehicle) {
      return res.status(403).json({ error: "Tài xế chưa được gán xe" });
    }

    const [schedules] = await dbPool.query(
      `SELECT s.schedule_id, s.route_id, r.route_number, r.route_name, s.direction,
              TIME_FORMAT(s.departure_time, '%H:%i') AS departure_time
       FROM schedules s
       JOIN bus_routes r ON r.route_id = s.route_id
       WHERE s.vehicle_id = ?
       ORDER BY s.departure_time ASC`,
      [vehicle.vehicle_id]
    );

    const { user_id, username, full_name } = req.user;
    res.json({ user: { user_id, username, full_name }, vehicle, schedules });
  } catch (error) {
    console.error("Lỗi lấy hồ sơ tài xế:", error);
    res.status(500).json({ error: "Lỗi kết nối CSDL" });
  }
}

module.exports = { login, me };
```

- [ ] **Step 3: Tạo `backend/src/modules/driver/driver.routes.js`**

```js
const express = require("express");
const { authenticateToken, requireRole } = require("../../middleware/auth");
const controller = require("./driver.controller");

const router = express.Router();

router.post("/auth/driver/login", controller.login);
router.get("/driver/me", authenticateToken, requireRole("DRIVER"), controller.me);

module.exports = router;
```

- [ ] **Step 4: Đăng ký module và CORS trong `backend/src/app.js`**

Đổi:

```js
const app = express();
app.use(cors());
```

thành:

```js
const { CORS_ORIGIN } = require("./config/env");

const app = express();
// Frontend được phục vụ cùng origin → chỉ bật CORS khi khai báo CORS_ORIGIN (vd. chạy frontend ở cổng khác)
if (CORS_ORIGIN) app.use(cors({ origin: CORS_ORIGIN }));
```

Trong mảng `modules`, thêm sau dòng `auth.routes`:

```js
  require("./modules/driver/driver.routes"),
```

- [ ] **Step 5: Thêm `CORS_ORIGIN` vào `backend/src/config/env.js`**

Thêm thuộc tính sau `JWT_SECRET` trong object export:

```js
  // Danh sách origin được phép gọi API/socket từ nơi khác, phân tách bằng dấu phẩy; null = chỉ cùng origin
  CORS_ORIGIN: process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(",").map(s => s.trim()).filter(Boolean)
    : null,
```

- [ ] **Step 6: Cảnh báo `JWT_SECRET` trong `backend/server.js`**

Thêm ngay sau dòng `const { PORT } = require("./src/config/env");`:

```js
if (!process.env.JWT_SECRET) {
  console.warn(">>> [Cảnh báo] Chưa đặt JWT_SECRET trong .env — đang dùng khóa mặc định, không dùng cho môi trường thật.");
}
```

- [ ] **Step 7: Kiểm tra trên server thật**

Khởi động lại backend, rồi chạy:

```bash
API=localhost:3000/api/v1; J='Content-Type: application/json'
D=$(curl -s -X POST localhost:3000/api/v1/auth/driver/login -H 'Content-Type: application/json' -d '{"username":"driver01","password":"driver123"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).token')
curl -s localhost:3000/api/v1/driver/me -H "Authorization: Bearer $D"; echo
curl -s -o /dev/null -w "driver POST /routes: %{http_code}\n" -X POST $API/routes -H "$J" -H "Authorization: Bearer $D" -d '{"route_id":"X"}'
curl -s -o /dev/null -w "driver GET /export/json: %{http_code}\n" $API/export/json -H "Authorization: Bearer $D"
curl -s -o /dev/null -w "driver01 at staff login: %{http_code}\n" -X POST $API/auth/login -H "$J" -d '{"username":"driver01","password":"driver123"}'
curl -s -o /dev/null -w "admin at driver login: %{http_code}\n" -X POST $API/auth/driver/login -H "$J" -d '{"username":"admin","password":"admin123"}'
curl -s -o /dev/null -w "driver wrong password: %{http_code}\n" -X POST $API/auth/driver/login -H "$J" -d '{"username":"driver01","password":"x"}'
```

Expected:
- JSON `/driver/me` có `vehicle.vehicle_id = "DRV_01"` và một schedule có `departure_time` dạng `"05:10"`.
- `driver POST /routes: 403`, `driver GET /export/json: 403`
- `driver01 at staff login: 403`, `admin at driver login: 403`, `driver wrong password: 401`

- [ ] **Step 8: Commit**

```bash
git add backend/src/modules/driver backend/src/app.js backend/src/config/env.js backend/server.js
git commit -m "feat(auth): add driver login and profile endpoints, env-based CORS

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Validator gói GPS

**Files:**
- Create: `backend/src/sockets/gps.validate.js`
- Create: `backend/src/sockets/gps.validate.test.js`

**Interfaces:**
- Produces: `validateGpsPing(raw) → {ok:true, value:{latitude, longitude, speed_kmh, heading}} | {ok:false, reason}`, với `reason ∈ {"NOT_OBJECT","BAD_LATITUDE","BAD_LONGITUDE","BAD_SPEED","BAD_HEADING"}`.

- [ ] **Step 1: Viết test fail `backend/src/sockets/gps.validate.test.js`**

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const { validateGpsPing } = require("./gps.validate");

const valid = { latitude: 10.87, longitude: 106.8, speed_kmh: 35, heading: 90 };

test("gói hợp lệ trả đúng 4 trường", () => {
  assert.deepEqual(validateGpsPing(valid), { ok: true, value: valid });
});

test("bỏ trường thừa — client không tự khai vehicle_id/route", () => {
  const r = validateGpsPing({ ...valid, vehicle_id: "DRV_99", route_id: "X", timestamp: "fake" });
  assert.deepEqual(r.value, valid);
});

test("thiếu speed/heading thì mặc định 0", () => {
  const r = validateGpsPing({ latitude: 10.87, longitude: 106.8 });
  assert.deepEqual(r.value, { latitude: 10.87, longitude: 106.8, speed_kmh: 0, heading: 0 });
});

test("speed/heading null (GPS điện thoại đứng yên) thì mặc định 0", () => {
  const r = validateGpsPing({ latitude: 10.87, longitude: 106.8, speed_kmh: null, heading: null });
  assert.equal(r.ok, true);
  assert.equal(r.value.speed_kmh, 0);
  assert.equal(r.value.heading, 0);
});

test("không phải object", () => {
  assert.deepEqual(validateGpsPing(null), { ok: false, reason: "NOT_OBJECT" });
  assert.deepEqual(validateGpsPing("10,106"), { ok: false, reason: "NOT_OBJECT" });
});

test("latitude thiếu, ngoài khoảng, NaN", () => {
  assert.equal(validateGpsPing({ longitude: 106.8 }).reason, "BAD_LATITUDE");
  assert.equal(validateGpsPing({ ...valid, latitude: 999 }).reason, "BAD_LATITUDE");
  assert.equal(validateGpsPing({ ...valid, latitude: NaN }).reason, "BAD_LATITUDE");
});

test("longitude dạng chuỗi bị từ chối", () => {
  assert.equal(validateGpsPing({ ...valid, longitude: "106.8" }).reason, "BAD_LONGITUDE");
  assert.equal(validateGpsPing({ ...valid, longitude: 181 }).reason, "BAD_LONGITUDE");
});

test("speed âm hoặc > 200", () => {
  assert.equal(validateGpsPing({ ...valid, speed_kmh: -1 }).reason, "BAD_SPEED");
  assert.equal(validateGpsPing({ ...valid, speed_kmh: 201 }).reason, "BAD_SPEED");
});

test("heading biên: 0 và 359.9 hợp lệ, 360 và -1 bị từ chối", () => {
  assert.equal(validateGpsPing({ ...valid, heading: 0 }).ok, true);
  assert.equal(validateGpsPing({ ...valid, heading: 359.9 }).ok, true);
  assert.equal(validateGpsPing({ ...valid, heading: 360 }).reason, "BAD_HEADING");
  assert.equal(validateGpsPing({ ...valid, heading: -1 }).reason, "BAD_HEADING");
});
```

- [ ] **Step 2: Chạy test, xác nhận fail**

Run: `cd backend && npm run test:unit`
Expected: FAIL với `Cannot find module './gps.validate'`.

- [ ] **Step 3: Cài đặt `backend/src/sockets/gps.validate.js`**

```js
// Kiểm tra gói gps_ping từ thiết bị. Chỉ giữ 4 trường vị trí;
// vehicle_id/route/timestamp do server tự điền từ phiên đã xác thực.
const isNum = v => typeof v === "number" && Number.isFinite(v);

function validateGpsPing(raw) {
  if (!raw || typeof raw !== "object") return { ok: false, reason: "NOT_OBJECT" };

  const { latitude, longitude } = raw;
  if (!isNum(latitude) || latitude < -90 || latitude > 90) return { ok: false, reason: "BAD_LATITUDE" };
  if (!isNum(longitude) || longitude < -180 || longitude > 180) return { ok: false, reason: "BAD_LONGITUDE" };

  const speed = raw.speed_kmh ?? 0;
  if (!isNum(speed) || speed < 0 || speed > 200) return { ok: false, reason: "BAD_SPEED" };

  const heading = raw.heading ?? 0;
  if (!isNum(heading) || heading < 0 || heading >= 360) return { ok: false, reason: "BAD_HEADING" };

  return { ok: true, value: { latitude, longitude, speed_kmh: speed, heading } };
}

module.exports = { validateGpsPing };
```

- [ ] **Step 4: Chạy test, xác nhận pass**

Run: `cd backend && npm run test:unit`
Expected: mọi test pass.

- [ ] **Step 5: Commit**

```bash
git add backend/src/sockets/gps.validate.js backend/src/sockets/gps.validate.test.js
git commit -m "feat(socket): add GPS ping validator

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Ghi log hành trình có throttle

**Files:**
- Create: `backend/src/sockets/tracking-log.js`
- Create: `backend/src/sockets/tracking-log.test.js`

**Interfaces:**
- Produces: `createTrackingLog(db, { intervalMs = 5000, errorIntervalMs = 30000, now = Date.now, logError = console.error }) → { record(packet): Promise<boolean> }`.
  - `packet` có `vehicle_id, longitude, latitude, speed_kmh, heading`.
  - Trả `true` khi đã INSERT; `false` khi bị throttle hoặc lỗi. Không bao giờ throw.

- [ ] **Step 1: Viết test fail `backend/src/sockets/tracking-log.test.js`**

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const { createTrackingLog } = require("./tracking-log");

const packet = (vehicle_id = "DRV_01") => ({ vehicle_id, longitude: 106.8, latitude: 10.87, speed_kmh: 30, heading: 90 });

function setup({ fail = false } = {}) {
  const clock = { t: 100000 };
  const queries = [];
  const errors = [];
  const db = {
    async query(sql, params) {
      queries.push({ sql, params });
      if (fail) throw new Error("FK fail");
      return [{ affectedRows: 1 }];
    }
  };
  const log = createTrackingLog(db, { now: () => clock.t, logError: (...a) => errors.push(a) });
  return { clock, queries, errors, log };
}

test("ghi lần đầu với WKT POINT(lon lat)", async () => {
  const { log, queries } = setup();
  assert.equal(await log.record(packet()), true);
  assert.equal(queries.length, 1);
  assert.deepEqual(queries[0].params, ["DRV_01", 30, 90, "POINT(106.8 10.87)"]);
});

test("cùng xe trong vòng 5s bị bỏ, sau 5s ghi tiếp", async () => {
  const { log, queries, clock } = setup();
  await log.record(packet());
  clock.t += 4999;
  assert.equal(await log.record(packet()), false);
  clock.t += 1;
  assert.equal(await log.record(packet()), true);
  assert.equal(queries.length, 2);
});

test("các xe khác nhau throttle độc lập", async () => {
  const { log, queries } = setup();
  await log.record(packet("DRV_01"));
  await log.record(packet("DRV_02"));
  assert.equal(queries.length, 2);
});

test("lỗi DB: không throw, log lỗi tối đa 1 lần / 30s / xe", async () => {
  const { log, errors, clock } = setup({ fail: true });
  assert.equal(await log.record(packet()), false);
  clock.t += 5000;
  await log.record(packet());
  assert.equal(errors.length, 1);
  clock.t += 25000;
  await log.record(packet());
  assert.equal(errors.length, 2);
});
```

- [ ] **Step 2: Chạy test, xác nhận fail**

Run: `cd backend && npm run test:unit`
Expected: FAIL với `Cannot find module './tracking-log'`.

- [ ] **Step 3: Cài đặt `backend/src/sockets/tracking-log.js`**

```js
// Ghi vết hành trình vào vehicle_tracking_logs: tối đa 1 bản ghi / xe / intervalMs
// (realtime vẫn phát mọi gói). Lỗi DB được log có giới hạn thay vì nuốt im lặng.
function createTrackingLog(db, { intervalMs = 5000, errorIntervalMs = 30000, now = Date.now, logError = console.error } = {}) {
  const lastLoggedAt = new Map();
  const lastErrorAt = new Map();

  async function record(packet) {
    const t = now();
    const id = packet.vehicle_id;
    if (t - (lastLoggedAt.get(id) ?? -Infinity) < intervalMs) return false;
    lastLoggedAt.set(id, t);

    try {
      await db.query(
        `INSERT INTO vehicle_tracking_logs (vehicle_id, speed_kmh, heading, geom)
         VALUES (?, ?, ?, ST_GeomFromText(?, 4326))`,
        [id, packet.speed_kmh, packet.heading, `POINT(${packet.longitude} ${packet.latitude})`]
      );
      return true;
    } catch (err) {
      if (t - (lastErrorAt.get(id) ?? -Infinity) >= errorIntervalMs) {
        lastErrorAt.set(id, t);
        logError(`[tracking-log] Không ghi được log xe ${id}:`, err.message);
      }
      return false;
    }
  }

  return { record };
}

module.exports = { createTrackingLog };
```

- [ ] **Step 4: Chạy test, xác nhận pass**

Run: `cd backend && npm run test:unit`
Expected: mọi test pass.

- [ ] **Step 5: Commit**

```bash
git add backend/src/sockets/tracking-log.js backend/src/sockets/tracking-log.test.js
git commit -m "feat(socket): throttle tracking log writes and surface DB errors

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Namespace `/device` có xác thực + viewer chỉ nhận

**Files:**
- Create: `backend/src/sockets/viewer.socket.js`
- Create: `backend/src/sockets/device.auth.js`
- Create: `backend/src/sockets/device.socket.js`
- Create: `backend/src/sockets/index.js`
- Create: `backend/src/sockets/device.socket.test.js`
- Delete: `backend/src/sockets/tracking.socket.js`
- Modify: `backend/server.js`
- Modify: `backend/package.json` (chuyển `socket.io-client` sang `devDependencies`)

**Interfaces:**
- Consumes:
  - `validateGpsPing` (Task 4)
  - `createTrackingLog` (Task 5)
  - `CORS_ORIGIN`, `JWT_SECRET` từ `env.js` (Task 3)
- Produces:
  - `createViewerBroadcaster(io) → { publishLocation(packet), publishOffline(vehicleId) }`
  - `createDeviceAuth({ db, jwtSecret }) → socket.io middleware`. Gán `socket.data = { user, vehicle:{vehicle_id, plate_number}, trip:null, lastPingAt:0, lastWarnAt:0 }`.
  - `registerDeviceSocket(io, { db, jwtSecret, broadcaster, trackingLog, now = Date.now })`
  - `registerSockets(io)`
  - Gói `fleet_location_update`: `{ vehicle_id, plate_number, route_id, route_number, direction, latitude, longitude, speed_kmh, heading, timestamp }`
  - Sự kiện `vehicle_offline`: `{ vehicle_id }`

- [ ] **Step 1: Chuyển `socket.io-client` sang devDependencies**

```bash
cd backend && npm uninstall socket.io-client && npm install --save-dev socket.io-client@^4.7.5
```

Expected: `backend/package.json` có `"devDependencies": { "socket.io-client": "^4.7.5" }` và không còn trong `dependencies`.

- [ ] **Step 2: Viết test fail `backend/src/sockets/device.socket.test.js`**

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const jwt = require("jsonwebtoken");
const { Server } = require("socket.io");
const { io: ioClient } = require("socket.io-client");
const { registerDeviceSocket } = require("./device.socket");

const SECRET = "test-secret";
const VEHICLES = [
  { vehicle_id: "DRV_01", plate_number: "51B-900.01", driver_user_id: 1 },
  { vehicle_id: "DRV_02", plate_number: "51B-900.02", driver_user_id: 2 }
];
const SCHEDULES = [
  { schedule_id: 11, route_id: "R1", vehicle_id: "DRV_01", direction: 1, route_number: "08" },
  { schedule_id: 22, route_id: "R2", vehicle_id: "DRV_02", direction: 2, route_number: "19" }
];

// DB giả: chỉ trả lời 2 truy vấn mà handshake và trip:start dùng
const fakeDb = {
  async query(sql, params) {
    if (sql.includes("FROM vehicles")) return [VEHICLES.filter(v => v.driver_user_id === params[0])];
    if (sql.includes("FROM schedules")) return [SCHEDULES.filter(s => s.schedule_id === params[0])];
    throw new Error(`SQL không mong đợi: ${sql}`);
  }
};

const driverToken = userId => jwt.sign({ user_id: userId, username: `driver0${userId}`, role: "DRIVER" }, SECRET);
const tick = (ms = 80) => new Promise(r => setTimeout(r, ms));

async function startServer() {
  const httpServer = http.createServer();
  const io = new Server(httpServer);
  const clock = { t: 1_000_000 };
  const published = { locations: [], offline: [] };
  const broadcaster = {
    publishLocation: p => published.locations.push(p),
    publishOffline: id => published.offline.push(id)
  };
  registerDeviceSocket(io, {
    db: fakeDb, jwtSecret: SECRET, broadcaster,
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
  return { connect, published, clock, close };
}

const waitConnect = s => new Promise((resolve, reject) => {
  s.once("connect", resolve);
  s.once("connect_error", reject);
});
const startTrip = (s, scheduleId) => s.timeout(2000).emitWithAck("trip:start", { schedule_id: scheduleId });

test("không có token → UNAUTHORIZED", async t => {
  const srv = await startServer(); t.after(srv.close);
  await assert.rejects(waitConnect(srv.connect()), { message: "UNAUTHORIZED" });
});

test("token không phải DRIVER → UNAUTHORIZED", async t => {
  const srv = await startServer(); t.after(srv.close);
  const adminToken = jwt.sign({ user_id: 1, role: "ADMIN" }, SECRET);
  await assert.rejects(waitConnect(srv.connect(adminToken)), { message: "UNAUTHORIZED" });
});

test("tài xế chưa gán xe → NO_VEHICLE", async t => {
  const srv = await startServer(); t.after(srv.close);
  await assert.rejects(waitConnect(srv.connect(driverToken(99))), { message: "NO_VEHICLE" });
});

test("trip:start với lịch trình của xe khác → SCHEDULE_NOT_ALLOWED", async t => {
  const srv = await startServer(); t.after(srv.close);
  const s = srv.connect(driverToken(1)); await waitConnect(s);
  assert.deepEqual(await startTrip(s, 22), { ok: false, error: "SCHEDULE_NOT_ALLOWED" });
});

test("ping trước trip:start bị bỏ", async t => {
  const srv = await startServer(); t.after(srv.close);
  const s = srv.connect(driverToken(1)); await waitConnect(s);
  s.emit("gps_ping", { latitude: 10.8, longitude: 106.7 });
  await tick();
  assert.equal(srv.published.locations.length, 0);
});

test("ping hợp lệ → server dựng gói theo xe đã xác thực, bỏ vehicle_id client gửi", async t => {
  const srv = await startServer(); t.after(srv.close);
  const s = srv.connect(driverToken(1)); await waitConnect(s);
  const ack = await startTrip(s, 11);
  assert.deepEqual(ack, { ok: true, trip: { schedule_id: 11, route_id: "R1", route_number: "08", direction: 1 } });
  s.emit("gps_ping", { vehicle_id: "DRV_02", latitude: 10.8, longitude: 106.7, speed_kmh: 30, heading: 45 });
  await tick();
  assert.equal(srv.published.locations.length, 1);
  const p = srv.published.locations[0];
  assert.equal(p.vehicle_id, "DRV_01");
  assert.equal(p.plate_number, "51B-900.01");
  assert.equal(p.route_id, "R1");
  assert.equal(p.route_number, "08");
  assert.equal(p.direction, 1);
  assert.equal(p.latitude, 10.8);
  assert.equal(p.longitude, 106.7);
  assert.equal(p.speed_kmh, 30);
  assert.equal(p.heading, 45);
  assert.equal(p.timestamp, new Date(srv.clock.t).toISOString());
});

test("ping sai định dạng bị bỏ; ping cách nhau < 250ms bị bỏ", async t => {
  const srv = await startServer(); t.after(srv.close);
  const s = srv.connect(driverToken(1)); await waitConnect(s);
  await startTrip(s, 11);
  s.emit("gps_ping", { latitude: 999, longitude: 106.7 });
  await tick();
  assert.equal(srv.published.locations.length, 0);

  s.emit("gps_ping", { latitude: 10.8, longitude: 106.7 });
  await tick();
  srv.clock.t += 249;
  s.emit("gps_ping", { latitude: 10.81, longitude: 106.7 });
  await tick();
  srv.clock.t += 1;
  s.emit("gps_ping", { latitude: 10.82, longitude: 106.7 });
  await tick();
  assert.deepEqual(srv.published.locations.map(p => p.latitude), [10.8, 10.82]);
});

test("phiên thứ hai cùng xe → phiên cũ nhận session:replaced, KHÔNG phát vehicle_offline", async t => {
  const srv = await startServer(); t.after(srv.close);
  const first = srv.connect(driverToken(1)); await waitConnect(first);
  await startTrip(first, 11);
  const replaced = new Promise(r => first.once("session:replaced", r));
  const second = srv.connect(driverToken(1)); await waitConnect(second);
  await replaced;
  await tick();
  assert.equal(first.connected, false);
  assert.deepEqual(srv.published.offline, []);
});

test("trip:end → phát vehicle_offline", async t => {
  const srv = await startServer(); t.after(srv.close);
  const s = srv.connect(driverToken(1)); await waitConnect(s);
  await startTrip(s, 11);
  assert.deepEqual(await s.timeout(2000).emitWithAck("trip:end", {}), { ok: true });
  assert.deepEqual(srv.published.offline, ["DRV_01"]);
});

test("ngắt kết nối khi đang có trip → phát vehicle_offline", async t => {
  const srv = await startServer(); t.after(srv.close);
  const s = srv.connect(driverToken(1)); await waitConnect(s);
  await startTrip(s, 11);
  s.disconnect();
  await tick();
  assert.deepEqual(srv.published.offline, ["DRV_01"]);
});
```

- [ ] **Step 3: Chạy test, xác nhận fail**

Run: `cd backend && npm run test:unit`
Expected: FAIL với `Cannot find module './device.socket'`.

- [ ] **Step 4: Tạo `backend/src/sockets/viewer.socket.js`**

```js
// Namespace "/" cho bản đồ công khai & trang tài xế: chỉ NHẬN dữ liệu.
// Server không lắng nghe sự kiện nào từ viewer → viewer không thể phát vị trí giả.
function createViewerBroadcaster(io) {
  const viewers = io.of("/");
  return {
    publishLocation: packet => viewers.emit("fleet_location_update", packet),
    publishOffline: vehicleId => viewers.emit("vehicle_offline", { vehicle_id: vehicleId })
  };
}

module.exports = { createViewerBroadcaster };
```

- [ ] **Step 5: Tạo `backend/src/sockets/device.auth.js`**

```js
const jwt = require("jsonwebtoken");

// Handshake namespace /device: JWT của tài xế (role DRIVER) + tài xế đang được gán xe.
// Lỗi trả về client qua connect_error với message UNAUTHORIZED | NO_VEHICLE | SERVER_ERROR.
function createDeviceAuth({ db, jwtSecret }) {
  return async (socket, next) => {
    let user;
    try {
      user = jwt.verify(socket.handshake.auth?.token || "", jwtSecret);
    } catch {
      return next(new Error("UNAUTHORIZED"));
    }
    if (user.role !== "DRIVER") return next(new Error("UNAUTHORIZED"));

    try {
      const [rows] = await db.query(
        "SELECT vehicle_id, plate_number FROM vehicles WHERE driver_user_id = ?",
        [user.user_id]
      );
      if (rows.length === 0) return next(new Error("NO_VEHICLE"));
      socket.data = { user, vehicle: rows[0], trip: null, lastPingAt: 0, lastWarnAt: 0 };
      next();
    } catch (err) {
      console.error("[device] Lỗi tra xe của tài xế:", err.message);
      next(new Error("SERVER_ERROR"));
    }
  };
}

module.exports = { createDeviceAuth };
```

- [ ] **Step 6: Tạo `backend/src/sockets/device.socket.js`**

```js
const { validateGpsPing } = require("./gps.validate");
const { createDeviceAuth } = require("./device.auth");

const MIN_PING_INTERVAL_MS = 250;   // Simulator 500ms, điện thoại 1s; chừa độ trễ dao động qua tunnel
const WARN_INTERVAL_MS = 10000;

// --------------------------------------------------------------------
// NAMESPACE /device: thiết bị của tài xế (điện thoại hoặc simulator) phát GPS.
// Danh tính xe lấy từ phiên đã xác thực; client chỉ gửi vị trí.
// --------------------------------------------------------------------
function registerDeviceSocket(io, { db, jwtSecret, broadcaster, trackingLog, now = Date.now }) {
  const devices = io.of("/device");
  const activeDevices = new Map(); // vehicle_id → socket đang giữ xe (mỗi xe 1 phiên)

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
        socket.data.trip = {
          schedule_id: schedule.schedule_id,
          route_id: schedule.route_id,
          route_number: schedule.route_number,
          direction: schedule.direction
        };
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
        route_id: trip.route_id,
        route_number: trip.route_number,
        direction: trip.direction,
        ...result.value,
        timestamp: new Date(t).toISOString()
      };
      broadcaster.publishLocation(packet);
      trackingLog.record(packet);
    });

    socket.on("trip:end", (...args) => {
      const ack = args.find(a => typeof a === "function") || (() => {});
      if (socket.data.trip) {
        socket.data.trip = null;
        broadcaster.publishOffline(vehicle.vehicle_id);
      }
      ack({ ok: true });
    });

    socket.on("disconnect", () => {
      // Phiên đã bị thay thì xe vẫn đang chạy ở phiên mới → không báo offline
      if (activeDevices.get(vehicle.vehicle_id) !== socket) return;
      activeDevices.delete(vehicle.vehicle_id);
      if (socket.data.trip) broadcaster.publishOffline(vehicle.vehicle_id);
    });
  });
}

module.exports = { registerDeviceSocket };
```

- [ ] **Step 7: Chạy test, xác nhận pass**

Run: `cd backend && npm run test:unit`
Expected: mọi test pass, gồm 10 test của `device.socket.test.js`.

- [ ] **Step 8: Tạo `backend/src/sockets/index.js`, nối vào `server.js`, xóa file cũ**

`backend/src/sockets/index.js`:

```js
const { dbPool } = require("../config/db");
const { JWT_SECRET } = require("../config/env");
const { createViewerBroadcaster } = require("./viewer.socket");
const { registerDeviceSocket } = require("./device.socket");
const { createTrackingLog } = require("./tracking-log");

// Hub realtime: "/" (viewer, chỉ nhận) + "/device" (tài xế đã xác thực, phát GPS)
function registerSockets(io) {
  registerDeviceSocket(io, {
    db: dbPool,
    jwtSecret: JWT_SECRET,
    broadcaster: createViewerBroadcaster(io),
    trackingLog: createTrackingLog(dbPool)
  });
}

module.exports = { registerSockets };
```

Thay toàn bộ `backend/server.js` bằng:

```js
const http = require("http");
const { Server } = require("socket.io");
const { PORT, CORS_ORIGIN } = require("./src/config/env");
const { initDatabase } = require("./src/config/db");
const app = require("./src/app");
const { registerSockets } = require("./src/sockets");

if (!process.env.JWT_SECRET) {
  console.warn(">>> [Cảnh báo] Chưa đặt JWT_SECRET trong .env — đang dùng khóa mặc định, không dùng cho môi trường thật.");
}

const server = http.createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 16 * 1024, // Gói GPS chỉ vài trăm byte
  ...(CORS_ORIGIN ? { cors: { origin: CORS_ORIGIN } } : {})
});

initDatabase();
registerSockets(io);

server.listen(PORT, () => {
  console.log(`>>> Máy chủ Web GIS & Admin Hub đang hoạt động tại: http://localhost:${PORT}`);
});
```

```bash
git rm backend/src/sockets/tracking.socket.js
```

- [ ] **Step 9: Kiểm tra trên server thật**

Khởi động lại backend, rồi chạy kịch bản dưới (chỉ dùng `socket.io-client` của backend):

```bash
cd backend && node -e '
const {io}=require("socket.io-client");
(async()=>{
const r=await fetch("http://localhost:3000/api/v1/auth/driver/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username:"driver01",password:"driver123"})});
const {token}=await r.json();
const me=await (await fetch("http://localhost:3000/api/v1/driver/me",{headers:{Authorization:"Bearer "+token}})).json();
const viewer=io("http://localhost:3000");viewer.on("fleet_location_update",d=>{console.log("viewer got",d.vehicle_id,d.route_number,d.latitude);});
const dev=io("http://localhost:3000/device",{auth:{token}});
dev.on("connect",async()=>{const ack=await dev.emitWithAck("trip:start",{schedule_id:me.schedules[0].schedule_id});console.log("trip",ack);
dev.emit("gps_ping",{latitude:10.87,longitude:106.8,speed_kmh:30,heading:90});
setTimeout(()=>{dev.disconnect();viewer.disconnect();},800);});
})()'
```

Expected:
- `trip { ok: true, trip: { schedule_id: …, route_id: …, route_number: …, direction: 1 } }`
- `viewer got DRV_01 <route_number> 10.87`

Đợi 1 giây, đếm log:

```bash
cd backend && node -e 'const {dbPool}=require("./src/config/db");dbPool.query("SELECT COUNT(*) n FROM vehicle_tracking_logs WHERE vehicle_id=\"DRV_01\"").then(([r])=>{console.log("DRV_01 logs:",r[0].n);dbPool.end()})'
```

Expected: con số tăng so với trước khi chạy kịch bản.

- [ ] **Step 10: Commit**

```bash
git add backend/src/sockets backend/server.js backend/package.json backend/package-lock.json
git commit -m "feat(socket): authenticated /device namespace, read-only viewer namespace

Server derives vehicle identity from the driver session, validates and
rate-limits pings, enforces one session per vehicle, and emits
vehicle_offline when a trip ends.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Frontend cùng origin, xử lý `vehicle_offline`, token theo trang

**Files:**
- Modify: `frontend/src/core/config.js`
- Modify: `frontend/src/core/session.js`
- Modify: `frontend/src/core/http.js:28-60`
- Create: `frontend/src/core/geo-error.js`
- Modify: `frontend/src/views/map/features/geolocation.js:4-13`
- Modify: `frontend/src/modules/realtime/realtime.service.js`
- Modify: `frontend/src/views/map/features/fleet-tracking.js` (thêm `onVehicleOffline`, sửa `initSocketRealtime`)
- Modify: `frontend/admin.html:8-9`

**Interfaces:**
- Produces:
  - `API_BASE = "/api/v1"`, `TOKEN_KEY`, `DRIVER_TOKEN_KEY = "bus_driver_token"`
  - `getToken(key = TOKEN_KEY)`, `setToken(token, key = TOKEN_KEY)`, `clearToken(key = TOKEN_KEY)`
  - `request(path, { method, body, auth, tokenKey })`
  - `geolocationErrorMessage(err) → string` (trong `core/geo-error.js`)
  - `connectRealtime({ onConnect, onDisconnect, onFleetUpdate, onVehicleOffline }) → socket` (viewer `/`, cùng origin)

- [ ] **Step 1: Xác nhận trạng thái hiện tại**

Run: `grep -rn "localhost:3000\|SOCKET_URL" frontend/src frontend/*.html`
Expected: thấy `config.js:1-2` và `realtime.service.js`.

- [ ] **Step 2: Thay toàn bộ `frontend/src/core/config.js`**

```js
// Frontend được Express phục vụ cùng origin với API → đường dẫn tương đối, để truy cập qua
// IP LAN hoặc tunnel HTTPS trên điện thoại vẫn gọi đúng server (không phải "localhost" của điện thoại).
export const API_BASE = "/api/v1";

// Token theo trang: bản đồ & admin dùng chung (đăng nhập một lần); trang tài xế tách riêng
export const TOKEN_KEY = "bus_admin_token";
export const DRIVER_TOKEN_KEY = "bus_driver_token";
```

- [ ] **Step 3: Thay toàn bộ `frontend/src/core/session.js`**

```js
import { TOKEN_KEY } from "./config.js";

// key: khóa localStorage theo trang (mặc định token nhân viên của bản đồ/admin)
export function getToken(key = TOKEN_KEY) {
  return localStorage.getItem(key);
}

export function setToken(token, key = TOKEN_KEY) {
  localStorage.setItem(key, token);
}

export function clearToken(key = TOKEN_KEY) {
  localStorage.removeItem(key);
}
```

- [ ] **Step 4: Sửa `frontend/src/core/http.js`**

Đổi dòng doc của `request`:

```js
 * @param {object} opts   { method, body, auth } — auth: gửi kèm Bearer token
```

thành:

```js
 * @param {object} opts   { method, body, auth, tokenKey } — auth: gửi kèm Bearer token (lấy theo tokenKey, mặc định token nhân viên)
```

Đổi chữ ký và dòng Authorization trong `send`:

```js
async function send(path, { method = "GET", body, auth = false, tokenKey } = {}) {
  const headers = {};
  if (auth) {
    headers["Content-Type"] = "application/json";
    headers["Authorization"] = `Bearer ${getToken(tokenKey)}`;
  }
```

- [ ] **Step 5: Tách `geolocationErrorMessage` sang core**

Tạo `frontend/src/core/geo-error.js`:

```js
// Thông báo lỗi định vị (GeolocationPositionError: 1 từ chối, 2 không xác định, 3 hết giờ)
export function geolocationErrorMessage(err) {
  const code = err?.code ?? err?.details?.code ?? err?.details?.error?.code;
  if (code === 1) return "Bạn đã từ chối quyền truy cập vị trí. Hãy cho phép trong cài đặt trình duyệt.";
  if (code === 2) return "Không xác định được vị trí hiện tại. Kiểm tra GPS / kết nối mạng.";
  if (code === 3) return "Hết thời gian chờ định vị. Vui lòng thử lại.";
  return "Không thể định vị vị trí của bạn.";
}
```

Trong `frontend/src/views/map/features/geolocation.js`, xóa khối comment và hàm `geolocationErrorMessage` (dòng 4-13), rồi thêm ngay dưới các dòng import:

```js
import { geolocationErrorMessage } from "../../../core/geo-error.js";
export { geolocationErrorMessage };
```

(`base-map.js` vẫn import từ `./geolocation.js`, không cần sửa.)

- [ ] **Step 6: Thay toàn bộ `frontend/src/modules/realtime/realtime.service.js`**

```js
/**
 * Kết nối namespace viewer "/" cùng origin (window.io nạp từ CDN socket.io trong <head>).
 * Viewer chỉ nhận dữ liệu; vị trí xe do thiết bị tài xế phát qua namespace /device.
 * @param {{onConnect?, onDisconnect?, onFleetUpdate?, onVehicleOffline?}} handlers
 */
export function connectRealtime({ onConnect, onDisconnect, onFleetUpdate, onVehicleOffline }) {
  const socket = window.io({ reconnection: true, timeout: 5000 });
  if (onConnect) socket.on("connect", onConnect);
  if (onDisconnect) socket.on("disconnect", onDisconnect);
  // Gói GPS: { vehicle_id, plate_number, route_id, route_number, direction, longitude, latitude, speed_kmh, heading, timestamp }
  if (onFleetUpdate) socket.on("fleet_location_update", onFleetUpdate);
  // Xe kết thúc chuyến / thiết bị mất kết nối: { vehicle_id }
  if (onVehicleOffline) socket.on("vehicle_offline", onVehicleOffline);
  return socket;
}
```

- [ ] **Step 7: Gỡ xe khi offline trong `fleet-tracking.js`**

Thêm hàm ngay trước `export function initSocketRealtime()`:

```js
// Xe kết thúc chuyến hoặc thiết bị mất kết nối → gỡ khỏi bản đồ và xóa cache hoạt họa
function onVehicleOffline({ vehicle_id } = {}) {
  const g = state.busGraphics[vehicle_id];
  if (g && map.fleetLayer) map.fleetLayer.remove(g);
  delete state.busGraphics[vehicle_id];
  delete busAnimStates[vehicle_id];
  delete busCurrentPositions[vehicle_id];
  if (state.selectedTrackedVehicleId === vehicle_id) state.selectedTrackedVehicleId = null;
}
```

Trong `initSocketRealtime`, thêm handler vào object truyền cho `connectRealtime`:

```js
      onFleetUpdate: onFleetLocationUpdate,
      onVehicleOffline
```

- [ ] **Step 8: Bỏ CDN socket.io thừa trong `frontend/admin.html`**

Đổi:

```html
  <!-- Socket.io & ArcGIS Maps SDK v4.29 -->
  <script src="https://cdn.socket.io/4.7.5/socket.io.min.js"></script>
```

thành:

```html
  <!-- ArcGIS Maps SDK v4.29 -->
```

- [ ] **Step 9: Kiểm tra**

```bash
grep -rn "localhost:3000\|SOCKET_URL" frontend/src frontend/*.html; echo "grep exit: $?"
for f in frontend/src/core/config.js frontend/src/core/session.js frontend/src/core/http.js frontend/src/core/geo-error.js frontend/src/views/map/features/geolocation.js frontend/src/modules/realtime/realtime.service.js frontend/src/views/map/features/fleet-tracking.js; do node --check "$f" || echo "SYNTAX FAIL $f"; done
```

Expected: `grep exit: 1` (không còn dòng nào) và không có `SYNTAX FAIL`.

Kiểm tra thủ công (backend đang chạy):
1. Mở `http://localhost:3000/` → bản đồ tải, badge kết nối ONLINE, console không có lỗi.
2. Chạy lại kịch bản ở Task 6 Step 9 → xe đỏ `DRV_01` hiện trên bản đồ rồi biến mất khi kịch bản ngắt kết nối (`vehicle_offline`).
3. Đăng nhập `manager` trên bản đồ → mở trang Quản Trị → tab Người dùng hiển thị (token dùng chung vẫn chạy).
4. Mở `http://127.0.0.1:3000/` → bản đồ và danh sách tuyến vẫn tải (đường dẫn tương đối, không bị CORS).

- [ ] **Step 10: Commit**

```bash
git add frontend/src frontend/admin.html
git commit -m "feat(frontend): same-origin API/socket, remove offline buses, per-page token key

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Simulator độc lập (tài xế ảo)

**Files:**
- Create: `simulator/package.json`
- Create: `simulator/.env.example`
- Create: `simulator/README.md`
- Create: `simulator/src/route-geometry.js`
- Create: `simulator/src/route-geometry.test.js`
- Create: `simulator/src/virtual-driver.js`
- Create: `simulator/src/index.js`
- Delete: `backend/simulator.js`
- Modify: `backend/package.json` (xóa script `simulate`)

**Interfaces:**
- Consumes (qua HTTP và socket, không import):
  - `POST /api/v1/auth/driver/login`, `GET /api/v1/driver/me`
  - `GET /api/v1/routes/:id/path?direction=`
  - `/device`: `trip:start` (ack), `gps_ping`, `trip:end` (ack), `session:replaced`
- Produces:
  - `processRouteGeometry(coords) → {coords, segments, totalDist} | null`
  - `getInterpolatedPosition(route, distMeters) → {longitude, latitude, heading}`, với heading ∈ [0, 360)
  - `class VirtualDriver({apiUrl, username, password, log})` có `start()`, `stop(endTrip = true): Promise`

- [ ] **Step 1: Tạo `simulator/package.json` và cài đặt**

```json
{
  "name": "bus-gis-simulator",
  "version": "1.0.0",
  "private": true,
  "description": "Tài xế ảo phát GPS cho demo Web GIS xe buýt. Độc lập với backend: chỉ dùng REST public + socket /device. Xóa thư mục này khi triển khai thật.",
  "main": "src/index.js",
  "scripts": {
    "start": "node src/index.js",
    "test:unit": "node --test \"src/**/*.test.js\""
  },
  "dependencies": {
    "dotenv": "^16.4.5",
    "socket.io-client": "^4.7.5"
  }
}
```

Run: `cd simulator && npm install`
Expected: tạo `simulator/node_modules` và `simulator/package-lock.json`.

- [ ] **Step 2: Viết test fail `simulator/src/route-geometry.test.js`**

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const { processRouteGeometry, getInterpolatedPosition, getDistanceMeters } = require("./route-geometry");

// Đoạn 1 đi về phía đông, đoạn 2 đi về phía bắc
const COORDS = [[106.0, 10.0], [106.001, 10.0], [106.001, 10.001]];
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

test("dưới 2 điểm → null", () => {
  assert.equal(processRouteGeometry([[106, 10]]), null);
  assert.equal(processRouteGeometry(null), null);
});

test("tổng quãng đường bằng tổng các đoạn", () => {
  const r = processRouteGeometry(COORDS);
  const expected = getDistanceMeters(COORDS[0], COORDS[1]) + getDistanceMeters(COORDS[1], COORDS[2]);
  assert.ok(near(r.totalDist, expected, 1e-6));
  assert.ok(r.totalDist > 200 && r.totalDist < 230);
});

test("tại 0 m: điểm đầu, hướng đông (90°)", () => {
  const p = getInterpolatedPosition(processRouteGeometry(COORDS), 0);
  assert.deepEqual(p, { longitude: 106.0, latitude: 10.0, heading: 90 });
});

test("giữa đoạn đầu: nội suy tuyến tính", () => {
  const r = processRouteGeometry(COORDS);
  const p = getInterpolatedPosition(r, r.segments[0].dist / 2);
  assert.ok(near(p.longitude, 106.0005));
  assert.ok(near(p.latitude, 10.0));
});

test("vượt tổng quãng đường thì quấn về đầu tuyến", () => {
  const r = processRouteGeometry(COORDS);
  const a = getInterpolatedPosition(r, 10);
  const b = getInterpolatedPosition(r, r.totalDist + 10);
  assert.ok(near(a.longitude, b.longitude) && near(a.latitude, b.latitude));
});

test("hướng gần 360° được chuẩn hóa về [0, 360) — server từ chối heading = 360", () => {
  // Đi gần như chính bắc, lệch tây rất nhỏ → atan2 cho ~359.97°, toFixed(1) sẽ ra "360.0"
  const r = processRouteGeometry([[106.0, 10.0], [105.9999995, 10.001]]);
  const { heading } = getInterpolatedPosition(r, 1);
  assert.ok(heading >= 0 && heading < 360, `heading = ${heading}`);
});
```

- [ ] **Step 3: Chạy test, xác nhận fail**

Run: `cd simulator && npm run test:unit`
Expected: FAIL với `Cannot find module './route-geometry'`.

- [ ] **Step 4: Tạo `simulator/src/route-geometry.js`**

Logic chuyển từ `backend/simulator.js` (dòng 21-94). Chỉ thêm `roundHeading` để chuẩn hóa hướng về [0, 360).

```js
// Hình học lộ trình cho tài xế ảo: tính quãng đường tích lũy & nội suy vị trí theo mét đã đi

// Khoảng cách thực tế giữa 2 tọa độ [lon, lat] (Haversine, mét)
function getDistanceMeters(p1, p2) {
  const R = 6371000;
  const dLat = (p2[1] - p1[1]) * Math.PI / 180;
  const dLon = (p2[0] - p1[0]) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(p1[1] * Math.PI / 180) * Math.cos(p2[1] * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Làm tròn 1 chữ số nhưng giữ trong [0, 360): 359.96 → 0 thay vì 360 (server từ chối 360)
const roundHeading = h => Number(h.toFixed(1)) % 360;

// Tiền xử lý lộ trình: quãng đường tích lũy và góc phương vị từng đoạn
function processRouteGeometry(coords) {
  if (!coords || coords.length < 2) return null;
  const segments = [];
  let totalDist = 0;

  for (let i = 0; i < coords.length - 1; i++) {
    const p1 = coords[i];
    const p2 = coords[i + 1];
    const dist = getDistanceMeters(p1, p2);

    const dLon = p2[0] - p1[0];
    const dLat = p2[1] - p1[1];
    let heading = 0;
    if (dLon !== 0 || dLat !== 0) {
      heading = (Math.atan2(dLon, dLat) * 180 / Math.PI + 360) % 360;
    }

    segments.push({ p1, p2, dist, startDist: totalDist, endDist: totalDist + dist, heading });
    totalDist += dist;
  }

  return { coords, segments, totalDist: Math.max(10, totalDist) };
}

// Vị trí [lon, lat] và hướng tại quãng đường distMeters (quấn vòng khi vượt cuối tuyến)
function getInterpolatedPosition(processedRoute, distMeters) {
  const { segments, totalDist } = processedRoute;
  const targetDist = ((distMeters % totalDist) + totalDist) % totalDist;

  for (const seg of segments) {
    if (targetDist >= seg.startDist && targetDist <= seg.endDist) {
      const ratio = seg.dist > 0 ? (targetDist - seg.startDist) / seg.dist : 0;
      return {
        longitude: seg.p1[0] + (seg.p2[0] - seg.p1[0]) * ratio,
        latitude: seg.p1[1] + (seg.p2[1] - seg.p1[1]) * ratio,
        heading: roundHeading(seg.heading)
      };
    }
  }

  const last = segments[segments.length - 1];
  return { longitude: last.p2[0], latitude: last.p2[1], heading: roundHeading(last.heading) };
}

module.exports = { getDistanceMeters, processRouteGeometry, getInterpolatedPosition };
```

- [ ] **Step 5: Chạy test, xác nhận pass**

Run: `cd simulator && npm run test:unit`
Expected: 6 test pass.

- [ ] **Step 6: Tạo `simulator/src/virtual-driver.js`**

```js
const { io } = require("socket.io-client");
const { processRouteGeometry, getInterpolatedPosition } = require("./route-geometry");

const TICK_MS = 500;
const RETRY_MS = 5000;

// --------------------------------------------------------------------
// MỘT TÀI XẾ ẢO: đăng nhập như tài xế thật → nhận lịch trình → phát GPS qua /device.
// Chỉ dùng API public; không đọc CSDL, không import code backend.
// --------------------------------------------------------------------
class VirtualDriver {
  constructor({ apiUrl, username, password, log = msg => console.log(`>>> [Simulator] ${msg}`) }) {
    Object.assign(this, { apiUrl, username, password, log });
    this.stopped = false;
    this.socket = null;
    this.timer = null;
    this.trip = null;
    this.relogged = false;
  }

  async start() {
    if (this.stopped) return;
    try {
      await this.login();
      const me = await this.api("/driver/me");
      this.plate = me.vehicle.plate_number;
      this.schedule = me.schedules[0];
      if (!this.schedule) return this.fail("xe chưa có lịch trình");

      const { route_id, direction } = this.schedule;
      const path = await this.api(`/routes/${encodeURIComponent(route_id)}/path?direction=${direction}`);
      const coords = path.geometry.type === "MultiLineString" ? path.geometry.coordinates.flat() : path.geometry.coordinates;
      this.route = processRouteGeometry(coords);
      if (!this.route) return this.fail("lộ trình không hợp lệ");

      // Xuất phát ở vị trí ngẫu nhiên để các xe không chồng lên nhau
      this.distance = Math.random() * this.route.totalDist;
      this.baseSpeed = 30 + Math.random() * 10;
      this.connect();
    } catch (err) {
      if (err.fatal) return this.fail(err.message);
      if (this.stopped) return;
      this.log(`${this.username}: ${err.message} → thử lại sau ${RETRY_MS / 1000}s`);
      setTimeout(() => this.start(), RETRY_MS);
    }
  }

  async login() {
    const { token } = await this.fetchJson("/auth/driver/login", {
      method: "POST",
      body: { username: this.username, password: this.password }
    });
    this.token = token;
  }

  api(path) {
    return this.fetchJson(path, { token: this.token });
  }

  // Lỗi 4xx đánh dấu fatal (sai tài khoản / chưa gán xe) → bỏ tài xế; lỗi mạng / 5xx → thử lại
  async fetchJson(path, { method = "GET", body, token } = {}) {
    const headers = {};
    if (body) headers["Content-Type"] = "application/json";
    if (token) headers.Authorization = `Bearer ${token}`;

    let res;
    try {
      res = await fetch(`${this.apiUrl}/api/v1${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    } catch (err) {
      throw new Error(`không kết nối được ${this.apiUrl} (${err.cause?.code || err.message})`);
    }
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const error = new Error(`${method} ${path} → ${res.status} ${data?.error || ""}`.trim());
      error.fatal = res.status >= 400 && res.status < 500;
      throw error;
    }
    return data;
  }

  connect() {
    this.socket = io(`${this.apiUrl}/device`, { auth: { token: this.token }, reconnectionDelay: 2000 });
    // Mỗi lần (re)connect là socket mới trên server → phải gửi lại trip:start
    this.socket.on("connect", () => this.beginTrip());
    this.socket.on("disconnect", () => { this.trip = null; });
    this.socket.on("connect_error", err => this.onConnectError(err));
    this.socket.on("session:replaced", () => {
      this.log(`${this.username}: bị thay bởi thiết bị khác → dừng xe ${this.plate}`);
      this.stop(false);
    });
  }

  async beginTrip() {
    try {
      const ack = await this.socket.timeout(5000).emitWithAck("trip:start", { schedule_id: this.schedule.schedule_id });
      if (!ack.ok) return this.fail(`trip:start bị từ chối (${ack.error})`);
      this.trip = ack.trip;
      this.relogged = false;
      this.log(`${this.username}: xe ${this.plate} chạy Tuyến ${ack.trip.route_number} chiều ${ack.trip.direction}`);
      if (!this.timer) this.timer = setInterval(() => this.tick(), TICK_MS);
    } catch (err) {
      this.log(`${this.username}: trip:start không phản hồi (${err.message})`);
    }
  }

  async onConnectError(err) {
    if (this.stopped) return;
    // Lỗi tầng mạng: socket.io tự kết nối lại (socket.active = true)
    if (this.socket.active) return this.log(`${this.username}: mất kết nối socket (${err.message}), đang thử lại`);
    if (err.message !== "UNAUTHORIZED") return this.fail(`socket bị từ chối (${err.message})`);
    if (this.relogged) return this.fail("token vẫn bị từ chối sau khi đăng nhập lại");

    // Token hết hạn → đăng nhập lại một lần
    this.relogged = true;
    try {
      await this.login();
      this.socket.auth.token = this.token;
      this.socket.connect();
    } catch (e) {
      this.fail(e.message);
    }
  }

  tick() {
    if (!this.trip || !this.socket?.connected) return;
    const speed = Math.max(15, this.baseSpeed + Math.sin(Date.now() / 5000) * 3);
    this.distance = (this.distance + (speed / 3.6) * (TICK_MS / 1000)) % this.route.totalDist;
    const pos = getInterpolatedPosition(this.route, this.distance);
    this.socket.emit("gps_ping", {
      latitude: Number(pos.latitude.toFixed(6)),
      longitude: Number(pos.longitude.toFixed(6)),
      speed_kmh: Math.round(speed),
      heading: pos.heading
    });
  }

  // endTrip: báo trip:end để bản đồ gỡ xe ngay (khi Ctrl+C); false khi đã bị thay / bị từ chối
  stop(endTrip = true) {
    this.stopped = true;
    clearInterval(this.timer);
    this.timer = null;
    const socket = this.socket;
    if (!socket) return Promise.resolve();
    return new Promise(resolve => {
      const done = () => { socket.disconnect(); resolve(); };
      if (endTrip && this.trip && socket.connected) socket.timeout(1000).emit("trip:end", {}, done);
      else done();
    });
  }

  fail(reason) {
    this.log(`${this.username}: ${reason} → bỏ tài xế này`);
    this.stop(false);
  }
}

module.exports = { VirtualDriver };
```

- [ ] **Step 7: Tạo `simulator/src/index.js`**

```js
// --------------------------------------------------------------------
// SIMULATOR — N tài xế ảo đăng nhập thật và phát GPS (công cụ demo, xóa khi triển khai thật)
//   npm start -- --count 10                (driver01..driver10, quy ước tên của db:seed-drivers)
//   npm start -- --drivers driver01,driver05
// --------------------------------------------------------------------
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const { VirtualDriver } = require("./virtual-driver");

function parseUsernames(argv) {
  const get = flag => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const list = get("--drivers");
  if (list) return list.split(",").map(s => s.trim()).filter(Boolean);

  const count = Number(get("--count") ?? 5);
  if (!Number.isInteger(count) || count < 1 || count > 99) throw new Error("--count phải là số nguyên 1..99");
  return Array.from({ length: count }, (_, i) => `driver${String(i + 1).padStart(2, "0")}`);
}

let usernames;
try {
  usernames = parseUsernames(process.argv.slice(2));
} catch (err) {
  console.error(`>>> [Simulator] ${err.message}`);
  process.exit(1);
}

const apiUrl = (process.env.API_URL || "http://localhost:3000").replace(/\/$/, "");
const password = process.env.SIM_DRIVER_PASSWORD || "driver123";

console.log(`>>> [Simulator] ${usernames.length} tài xế ảo → ${apiUrl}`);
const drivers = usernames.map(username => new VirtualDriver({ apiUrl, username, password }));
drivers.forEach(d => d.start());

// Ctrl+C: báo trip:end cho từng xe để bản đồ gỡ xe ngay
process.on("SIGINT", async () => {
  console.log("\n>>> [Simulator] Kết thúc chuyến và thoát...");
  await Promise.all(drivers.map(d => d.stop()));
  process.exit(0);
});
```

- [ ] **Step 8: Tạo `simulator/.env.example` và `simulator/README.md`**

`simulator/.env.example`:

```
# Backend Web GIS (REST + Socket.io cùng cổng)
API_URL=http://localhost:3000
# Mật khẩu chung của tài khoản seed (backend: npm run db:seed-drivers)
SIM_DRIVER_PASSWORD=driver123
```

`simulator/README.md`:

````markdown
# Simulator — tài xế ảo (công cụ demo)

Mỗi tài xế ảo đăng nhập bằng tài khoản tài xế thật, nhận lịch trình của xe mình rồi phát GPS qua namespace `/device`. Đây là cùng giao thức với trang `driver.html` trên điện thoại.

Simulator **độc lập** với hệ thống: chỉ gọi REST public và Socket.io, không đọc CSDL, không import code backend. Khi triển khai thật, xóa cả thư mục `simulator/`.

## Chạy

```bash
# 1. Backend đang chạy và đã có tài khoản tài xế
cd backend && npm run db:seed-drivers -- --count 10

# 2. Chạy simulator
cd simulator && npm install && cp .env.example .env
npm start -- --count 10                  # driver01..driver10
npm start -- --drivers driver01,driver05 # chọn tài xế cụ thể
```

Ctrl+C: gửi `trip:end` cho từng xe để bản đồ gỡ xe ngay.

## Hành vi

- Mỗi tài xế chạy lịch trình đầu tiên của xe, lặp vòng trên lộ trình, 30–40 km/h, phát mỗi 500 ms.
- Tài xế thật mở `driver.html` và bấm "Bắt đầu chuyến" cho cùng xe: server gửi `session:replaced`, xe ảo đó dừng (không giành lại).
- Token hết hạn: đăng nhập lại một lần. Backend chưa chạy: thử lại mỗi 5 giây.

## Test

```bash
npm run test:unit
```
````

- [ ] **Step 9: Xóa simulator cũ khỏi backend**

```bash
git rm backend/simulator.js
```

Trong `backend/package.json`, xóa dòng `"simulate": "echo '…' && exit 1",` khỏi `"scripts"`.

Kiểm tra backend và frontend không còn tham chiếu tới simulator:

```bash
grep -rn "simulator" backend frontend --include='*.js' --include='*.json' --include='*.html' --exclude-dir=node_modules; echo "grep exit: $?"
```

Expected: `grep exit: 1`. Riêng `backend/test_suite.js` có thể còn chữ "Simulator" trong tiêu đề module 4; tiêu đề đó được viết lại ở Task 9.

- [ ] **Step 10: Chạy thử end-to-end**

Backend đang chạy và đã seed ≥ 3 tài xế. Mở terminal 1:

```bash
cd simulator && npm start -- --count 3
```

Expected: 3 dòng `driverNN: xe 51B-900.NN chạy Tuyến … chiều …`.

Terminal 2: đếm xe trong 3 giây.

```bash
cd backend && node -e '
const {io}=require("socket.io-client");const v=io("http://localhost:3000");const seen=new Map();
v.on("fleet_location_update",d=>seen.set(d.vehicle_id,(seen.get(d.vehicle_id)||0)+1));
setTimeout(()=>{console.log([...seen.entries()]);v.disconnect();},3000);'
```

Expected: `[["DRV_01",~6],["DRV_02",~6],["DRV_03",~6]]` (khoảng 5-6 gói mỗi xe).

Ctrl+C ở terminal 1. Expected: `Kết thúc chuyến và thoát...`, tiến trình thoát. Bản đồ (`http://localhost:3000/`) gỡ 3 xe ngay.

Kiểm tra reconnect (Review Focus #3): chạy lại simulator `--count 1`, khởi động lại backend, đợi 5 giây. Expected: log simulator in lại `driver01: xe … chạy Tuyến …` và xe lại xuất hiện trên bản đồ.

- [ ] **Step 11: Commit**

```bash
git add simulator backend/package.json
git commit -m "feat(simulator): standalone virtual drivers over public API and /device

Replaces backend/simulator.js. The simulator logs in as seeded drivers,
uses only REST + Socket.io, and can be deleted for production.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Bộ test tích hợp `test_suite.js`

**Files:**
- Modify: `backend/test_suite.js`:
  - helper sau `fetchJson`, khoảng dòng 70
  - module 2, sau test 2.4, khoảng dòng 195
  - module 4, dòng 323-376

**Interfaces:**
- Consumes: `/auth/driver/login`, `/driver/me`, `/device` (Task 3, 6); seed ≥ 2 tài xế (Task 1).

- [ ] **Step 1: Chạy test suite hiện tại, xác nhận module 4 fail**

Backend đang chạy. Run: `cd backend && node test_suite.js`
Expected: module 4 FAIL `Nhận Luồng GPS Realtime … Timeout`, vì viewer không còn phát được `gps_ping`.

- [ ] **Step 2: Thêm helper sau hàm `fetchJson`**

```js
const DRIVER_PASSWORD = process.env.SEED_DRIVER_PASSWORD || "driver123";

function driverLogin(username, password = DRIVER_PASSWORD) {
  return fetchJson(`${API_BASE}/auth/driver/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: { username, password }
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Chờ sự kiện thỏa điều kiện; hết giờ → reject
function waitFor(socket, event, match = () => true, ms = 3000) {
  return new Promise((resolve, reject) => {
    const handler = data => {
      if (!match(data)) return;
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(data);
    };
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`Timeout ${ms}ms chờ '${event}'`));
    }, ms);
    socket.on(event, handler);
  });
}

// true nếu KHÔNG nhận sự kiện thỏa điều kiện trong ms
const expectNone = (socket, event, match, ms = 1000) => waitFor(socket, event, match, ms).then(() => false, () => true);

const waitConnect = socket => new Promise((resolve, reject) => {
  socket.once("connect", resolve);
  socket.once("connect_error", reject);
});
```

- [ ] **Step 3: Thêm test RBAC cho tài xế vào module 2**

Chèn ngay trước dòng `  } catch (err) {` cuối module 2 (dòng `logFail("Module Auth & RBAC", err.message);` nằm ngay sau):

```js
    // 2.5 Tài khoản tài xế: chỉ đăng nhập ở cổng tài xế, không gọi được API quản trị
    const driver = await driverLogin("driver01");
    if (driver.status === 200 && driver.data.user.role === "DRIVER" && driver.data.user.vehicle_id) {
      logPass("Đăng nhập Tài xế (/auth/driver/login)", `driver01 → xe ${driver.data.user.vehicle_id}`);
    } else {
      logFail("Đăng nhập Tài xế", `Status ${driver.status} (đã chạy npm run db:seed-drivers chưa?)`);
    }

    const driverAtStaff = await fetchJson(`${API_BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: { username: "driver01", password: DRIVER_PASSWORD }
    });
    const adminAtDriver = await driverLogin("admin", "admin123");
    if (driverAtStaff.status === 403 && adminAtDriver.status === 403) {
      logPass("Tách cổng đăng nhập", "Tài xế bị chặn ở cổng nhân viên và ngược lại (403)");
    } else {
      logFail("Tách cổng đăng nhập", `driver@staff=${driverAtStaff.status}, admin@driver=${adminAtDriver.status}`);
    }

    const driverAuth = { "Content-Type": "application/json", "Authorization": `Bearer ${driver.data.token}` };
    const driverWrite = await fetchJson(`${API_BASE}/routes`, { method: "POST", headers: driverAuth, body: { route_id: "HACK" } });
    const driverExport = await fetchJson(`${API_BASE}/export/json`, { headers: driverAuth });
    if (driverWrite.status === 403 && driverExport.status === 403) {
      logPass("Bảo mật RBAC (Tài xế gọi API quản trị)", "POST /routes và GET /export/json bị chặn 403");
    } else {
      logFail("Bảo mật RBAC (Tài xế gọi API quản trị)", `POST /routes=${driverWrite.status}, GET /export/json=${driverExport.status}`);
    }

    const badRole = await fetchJson(`${API_BASE}/users/0`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${adminToken}` },
      body: { full_name: "x", email: "", role: "SUPERUSER" }
    });
    if (badRole.status === 400) {
      logPass("Whitelist vai trò người dùng", "role SUPERUSER bị từ chối 400");
    } else {
      logFail("Whitelist vai trò người dùng", `Mong đợi 400 nhưng nhận ${badRole.status}`);
    }
```

- [ ] **Step 4: Viết lại module 4**

Thay toàn bộ khối từ comment `// 4. KIỂM TRA WEBSOCKET REALTIME & LUỒNG GPS GIẢ LẬP` tới hết `} catch (err) { logFail("Module WebSocket Realtime", err.message); }` bằng:

```js
  // 4. KIỂM TRA WEBSOCKET: VIEWER "/" (CHỈ NHẬN) + THIẾT BỊ TÀI XẾ "/device"
  //    Cần seed ≥ 2 tài xế: npm run db:seed-drivers
  // ------------------------------------------------------------------
  console.log("\n\x1b[36m▶ [MODULE 4]: Kiểm Tra WebSocket Realtime (viewer + /device tài xế)\x1b[0m");
  const sockets = [];
  const openSocket = (nsp, auth = {}) => {
    const s = io(`${SOCKET_URL}${nsp}`, { auth, reconnection: false, forceNew: true, timeout: 4000 });
    sockets.push(s);
    return s;
  };
  try {
    const d1 = await driverLogin("driver01");
    const d2 = await driverLogin("driver02");
    if (d1.status !== 200 || d2.status !== 200) {
      throw new Error(`Chưa seed tài xế (driver01=${d1.status}, driver02=${d2.status}) → chạy npm run db:seed-drivers`);
    }
    const auth1 = { "Authorization": `Bearer ${d1.data.token}` };
    const auth2 = { "Authorization": `Bearer ${d2.data.token}` };
    const sch1 = (await fetchJson(`${API_BASE}/driver/me`, { headers: auth1 })).data.schedules[0];
    const sch2 = (await fetchJson(`${API_BASE}/driver/me`, { headers: auth2 })).data.schedules[0];
    const vehicleId = d1.data.user.vehicle_id;

    const viewer = openSocket("");
    await waitConnect(viewer);
    logPass("Kết nối viewer '/'", `Đã kết nối Socket.io tại ${SOCKET_URL}`);

    // 4.1 /device không token / token nhân viên
    const noToken = await waitConnect(openSocket("/device")).then(() => "connected", e => e.message);
    const staffToken = await waitConnect(openSocket("/device", { token: adminToken })).then(() => "connected", e => e.message);
    if (noToken === "UNAUTHORIZED" && staffToken === "UNAUTHORIZED") {
      logPass("Bảo mật /device", "Không token và token ADMIN đều bị từ chối UNAUTHORIZED");
    } else {
      logFail("Bảo mật /device", `không token=${noToken}, token ADMIN=${staffToken}`);
    }

    // 4.2 Viewer phát gps_ping giả → không ai nhận
    const viewer2 = openSocket("");
    await waitConnect(viewer2);
    const noLeak = expectNone(viewer, "fleet_location_update", d => d.vehicle_id === "BUS_FAKE");
    viewer2.emit("gps_ping", { vehicle_id: "BUS_FAKE", latitude: 10.87, longitude: 106.8 });
    if (await noLeak) logPass("Viewer không phát được GPS", "gps_ping từ namespace '/' bị bỏ qua");
    else logFail("Viewer không phát được GPS", "Gói giả từ viewer bị phát lại!");

    // 4.3 Thiết bị tài xế: lịch trình xe khác bị từ chối, lịch trình của mình được nhận
    const dev = openSocket("/device", { token: d1.data.token });
    await waitConnect(dev);
    const badTrip = await dev.timeout(3000).emitWithAck("trip:start", { schedule_id: sch2.schedule_id });
    if (badTrip.ok === false && badTrip.error === "SCHEDULE_NOT_ALLOWED") {
      logPass("trip:start lịch trình xe khác", "Bị từ chối SCHEDULE_NOT_ALLOWED");
    } else {
      logFail("trip:start lịch trình xe khác", JSON.stringify(badTrip));
    }

    const trip = await dev.timeout(3000).emitWithAck("trip:start", { schedule_id: sch1.schedule_id });
    const gotLocation = waitFor(viewer, "fleet_location_update", d => d.vehicle_id === vehicleId);
    dev.emit("gps_ping", { vehicle_id: "DRV_99", latitude: 10.87052, longitude: 106.80196, speed_kmh: 35, heading: 90 });
    const loc = await gotLocation;
    if (trip.ok && loc.vehicle_id === vehicleId && loc.route_id === sch1.route_id && loc.timestamp) {
      logPass("Luồng GPS tài xế → viewer", `Xe ${loc.plate_number} | Tuyến ${loc.route_number} | [${loc.longitude}, ${loc.latitude}] (vehicle_id giả bị bỏ)`);
    } else {
      logFail("Luồng GPS tài xế → viewer", JSON.stringify({ trip, loc }));
    }

    // 4.4 Gói sai định dạng không được phát
    await sleep(300);
    const noInvalid = expectNone(viewer, "fleet_location_update", d => d.vehicle_id === vehicleId);
    dev.emit("gps_ping", { latitude: 999, longitude: 106.8 });
    if (await noInvalid) logPass("Validate gói GPS", "latitude = 999 bị bỏ");
    else logFail("Validate gói GPS", "Gói sai định dạng vẫn được phát");

    // 4.5 Phiên thứ hai cùng xe thay phiên cũ
    const replaced = waitFor(dev, "session:replaced");
    const dev2 = openSocket("/device", { token: d1.data.token });
    await waitConnect(dev2);
    await replaced;
    logPass("Một xe một phiên", "Phiên cũ nhận session:replaced");

    // 4.6 Kết thúc chuyến → viewer nhận vehicle_offline
    await dev2.timeout(3000).emitWithAck("trip:start", { schedule_id: sch1.schedule_id });
    const offline = waitFor(viewer, "vehicle_offline", d => d.vehicle_id === vehicleId);
    await dev2.timeout(3000).emitWithAck("trip:end", {});
    await offline;
    logPass("Kết thúc chuyến", `Viewer nhận vehicle_offline cho ${vehicleId}`);
  } catch (err) {
    logFail("Module WebSocket Realtime", err.message);
  } finally {
    sockets.forEach(s => s.disconnect());
  }
```

- [ ] **Step 5: Chạy test suite**

Backend đang chạy, đã seed 20 tài xế, simulator **không** chạy. Run: `cd backend && node test_suite.js`

Expected:
- Module 2: 4 test mới PASS.
- Module 4: các test PASS gồm `Kết nối viewer`, `Bảo mật /device`, `Viewer không phát được GPS`, `trip:start lịch trình xe khác`, `Luồng GPS tài xế → viewer`, `Validate gói GPS`, `Một xe một phiên`, `Kết thúc chuyến`.
- Không có FAIL mới so với Step 1, ngoài các FAIL có sẵn từ trước (ghi rõ các FAIL đó trong báo cáo task nếu có).

- [ ] **Step 6: Commit**

```bash
git add backend/test_suite.js
git commit -m "test: cover driver auth, RBAC and /device socket flows in test suite

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Trang tài xế `driver.html`

**Files:**
- Create: `frontend/src/views/driver/features/next-stop.js`
- Create: `frontend/src/views/driver/features/next-stop.test.js`
- Create: `frontend/src/modules/driver/driver.service.js`
- Create: `frontend/src/modules/realtime/device.service.js`
- Create: `frontend/driver.html`
- Create: `frontend/assets/css/driver.css`
- Create: `frontend/src/views/driver/driver.state.js`
- Create: `frontend/src/views/driver/driver.view.js`
- Create: `frontend/src/views/driver/sections/{login,trip-select,drive-panel}.html`
- Create: `frontend/src/views/driver/features/{screens,driver-auth,trip-select,drive-map,phone-gps}.js`
- Modify: `frontend/src/views/map/sections/top-bar.html`
- Modify: `backend/test_suite.js` (module 5, danh sách `frontendFiles`)

**Interfaces:**
- Consumes:
  - `request`, `ApiError`, `apiErrorMessage` (core/http)
  - `getToken/setToken/clearToken(…, key)` (core/session)
  - `DRIVER_TOKEN_KEY` (core/config)
  - `geolocationErrorMessage` (core/geo-error)
  - `connectRealtime({…, onVehicleOffline})` (Task 7)
  - `getRoutePath`, `flattenPathCoords` (paths.service)
  - `listRouteStops(routeId, direction) → [{stop_id, stop_name, stop_order, longitude, latitude, …}]` (stops.service)
  - `loadArcgisModules`, `showToast`, `mountSections`, `registerActions`
- Produces:
  - `nextStop(position:[lon,lat], pathCoords:[[lon,lat]…], stops) → {stop, distanceMeters} | null`
  - `distanceAlongPath(coords, point) → mét`
  - `driverLogin(username, password) → {token, user}`; `getDriverMe() → {user, vehicle, schedules}`
  - `connectDevice(token, {onReconnect, onReplaced}) → Promise<socket>`. Reject với `Error(message ∈ UNAUTHORIZED | NO_VEHICLE | SERVER_ERROR | TIMEOUT)`.
  - `emitWithAck(socket, event, payload) → Promise<ack>`

- [ ] **Step 1: Viết test fail `frontend/src/views/driver/features/next-stop.test.js`**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { nextStop, distanceAlongPath } from "./next-stop.js";

// Lộ trình thẳng hướng đông ở vĩ độ 10°: A (đầu) – B (giữa) – C (cuối), mỗi đoạn 0.01° ≈ 1096 m
const PATH = [[106.0, 10.0], [106.01, 10.0], [106.02, 10.0]];
const A = { stop_id: "A", stop_name: "Trạm A", stop_order: 1, longitude: 106.0, latitude: 10.0 };
const B = { stop_id: "B", stop_name: "Trạm B", stop_order: 2, longitude: 106.01, latitude: 10.0 };
const C = { stop_id: "C", stop_name: "Trạm C", stop_order: 3, longitude: 106.02, latitude: 10.0 };
const STOPS = [A, B, C];
const SEG_M = 0.01 * 111320 * Math.cos(10 * Math.PI / 180);
const near = (a, b, eps = 5) => Math.abs(a - b) <= eps;

test("distanceAlongPath: điểm giữa đoạn đầu ≈ nửa đoạn", () => {
  assert.ok(near(distanceAlongPath(PATH, [106.005, 10.0]), SEG_M / 2));
});

test("xe ở đầu tuyến (tại trạm A) → trạm kế là B", () => {
  const r = nextStop([106.0, 10.0], PATH, STOPS);
  assert.equal(r.stop.stop_id, "B");
  assert.ok(near(r.distanceMeters, SEG_M));
});

test("xe giữa A và B → B, còn ~nửa đoạn", () => {
  const r = nextStop([106.005, 10.0001], PATH, STOPS);
  assert.equal(r.stop.stop_id, "B");
  assert.ok(near(r.distanceMeters, SEG_M / 2));
});

test("xe vừa qua B → C", () => {
  assert.equal(nextStop([106.0102, 10.0], PATH, STOPS).stop.stop_id, "C");
});

test("xe sau trạm cuối → null", () => {
  assert.equal(nextStop([106.02, 10.0], PATH, STOPS), null);
});

test("danh sách trạm lộn xộn vẫn chọn theo stop_order", () => {
  assert.equal(nextStop([106.0, 10.0], PATH, [C, B, A]).stop.stop_id, "B");
});

test("thiếu dữ liệu → null", () => {
  assert.equal(nextStop([106.0, 10.0], PATH, []), null);
  assert.equal(nextStop([106.0, 10.0], [[106.0, 10.0]], STOPS), null);
});
```

- [ ] **Step 2: Chạy test, xác nhận fail**

Run: `node --test frontend/src/views/driver/features/next-stop.test.js`
Expected: FAIL với `Cannot find module …/next-stop.js`.

- [ ] **Step 3: Cài đặt `frontend/src/views/driver/features/next-stop.js`**

```js
// Trạm kế tiếp phía trước xe trên lộ trình [lon, lat] — hàm thuần (không DOM/ArcGIS), test bằng node --test
const M_PER_DEG_LAT = 111320;
const ARRIVAL_TOLERANCE_M = 10; // Xe trong 10 m quanh trạm coi như đã tới trạm đó

// Chiếu p lên đoạn a-b, hiệu chỉnh kinh độ theo cos(vĩ độ) như path-clip.js
function projectOnSegment(p, a, b) {
  const kx = Math.cos(p[1] * Math.PI / 180);
  const dx = (b[0] - a[0]) * kx, dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  let t = len2 ? (((p[0] - a[0]) * kx) * dx + (p[1] - a[1]) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const ex = (p[0] - (a[0] + (b[0] - a[0]) * t)) * kx;
  const ey = p[1] - (a[1] + (b[1] - a[1]) * t);
  return { t, dist2: ex * ex + ey * ey };
}

function segmentLengthMeters(a, b) {
  const kx = Math.cos(((a[1] + b[1]) / 2) * Math.PI / 180);
  return Math.hypot((b[0] - a[0]) * kx, b[1] - a[1]) * M_PER_DEG_LAT;
}

// Quãng đường (mét) từ đầu tuyến tới điểm chiếu gần nhất của point trên lộ trình
export function distanceAlongPath(coords, point) {
  let along = 0;
  let best = null;
  for (let i = 0; i < coords.length - 1; i++) {
    const segLen = segmentLengthMeters(coords[i], coords[i + 1]);
    const pr = projectOnSegment(point, coords[i], coords[i + 1]);
    if (!best || pr.dist2 < best.dist2) best = { dist2: pr.dist2, along: along + pr.t * segLen };
    along += segLen;
  }
  return best ? best.along : 0;
}

// Trạm đầu tiên (theo stop_order) nằm phía trước xe; null khi đã qua trạm cuối hoặc thiếu dữ liệu
export function nextStop(position, pathCoords, stops) {
  if (!pathCoords || pathCoords.length < 2 || !stops || stops.length === 0) return null;
  const busAlong = distanceAlongPath(pathCoords, position);
  const ahead = stops
    .map(stop => ({ stop, along: distanceAlongPath(pathCoords, [stop.longitude, stop.latitude]) }))
    .filter(s => s.along > busAlong + ARRIVAL_TOLERANCE_M)
    .sort((x, y) => x.stop.stop_order - y.stop.stop_order)[0];
  return ahead ? { stop: ahead.stop, distanceMeters: ahead.along - busAlong } : null;
}
```

- [ ] **Step 4: Chạy test, xác nhận pass**

Run: `node --test frontend/src/views/driver/features/next-stop.test.js`
Expected: 7 test pass.

- [ ] **Step 5: Tạo service `frontend/src/modules/driver/driver.service.js`**

```js
import { request } from "../../core/http.js";
import { DRIVER_TOKEN_KEY } from "../../core/config.js";

// → { token, user: { user_id, username, full_name, role: "DRIVER", vehicle_id } }
export function driverLogin(username, password) {
  return request("/auth/driver/login", { method: "POST", body: { username, password } });
}

// → { user, vehicle: { vehicle_id, plate_number }, schedules: [{ schedule_id, route_id, route_number, route_name, direction, departure_time }] }
export function getDriverMe() {
  return request("/driver/me", { auth: true, tokenKey: DRIVER_TOKEN_KEY });
}
```

- [ ] **Step 6: Tạo `frontend/src/modules/realtime/device.service.js`**

```js
const CONNECT_TIMEOUT_MS = 10000;

/**
 * Kết nối namespace /device bằng token tài xế (window.io nạp từ CDN socket.io trong <head>).
 * Resolve khi kết nối lần đầu; reject Error(message = UNAUTHORIZED | NO_VEHICLE | SERVER_ERROR | TIMEOUT).
 * onReconnect(socket): chạy mỗi lần kết nối lại — trip gắn với socket trên server nên phải gửi lại trip:start.
 */
export function connectDevice(token, { onReconnect, onReplaced } = {}) {
  const socket = window.io("/device", { auth: { token }, reconnection: true, timeout: 5000 });
  let connectedOnce = false;
  socket.on("connect", () => {
    if (connectedOnce && onReconnect) onReconnect(socket);
    connectedOnce = true;
  });
  if (onReplaced) socket.on("session:replaced", onReplaced);

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      socket.off("connect", onOk);
      socket.off("connect_error", onError);
    };
    const fail = err => { cleanup(); socket.disconnect(); reject(err); };
    const onOk = () => { cleanup(); resolve(socket); };
    // socket.active = false: server từ chối handshake (không tự thử lại); true: lỗi mạng, đang thử lại
    const onError = err => { if (!socket.active) fail(err); };
    const timer = setTimeout(() => fail(new Error("TIMEOUT")), CONNECT_TIMEOUT_MS);
    socket.on("connect", onOk);
    socket.on("connect_error", onError);
  });
}

// Gửi sự kiện chờ ack, quá 5 s → reject
export function emitWithAck(socket, event, payload) {
  return socket.timeout(5000).emitWithAck(event, payload);
}
```

- [ ] **Step 7: Tạo `frontend/driver.html`**

```html
<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
  <meta name="theme-color" content="#0f172a" />
  <title>Tài Xế – Web GIS Xe Buýt</title>

  <!-- 1. Socket.io trước ArcGIS để window.io không xung đột AMD loader -->
  <script src="https://cdn.socket.io/4.7.5/socket.io.min.js"></script>

  <!-- 2. ArcGIS Maps SDK for JavaScript 4.29 -->
  <link rel="stylesheet" href="https://js.arcgis.com/4.29/esri/themes/light/main.css" />
  <script src="https://js.arcgis.com/4.29/"></script>

  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" />
  <link rel="stylesheet" href="assets/css/driver.css" />
</head>
<body>
  <div id="toastContainer"></div>

  <!-- 3 màn: Đăng nhập → Chọn chuyến → Chạy xe (nạp từ src/views/driver/sections/*.html) -->
  <div data-section="login"></div>
  <div data-section="trip-select"></div>
  <div data-section="drive-panel"></div>

  <script type="module" src="src/views/driver/driver.view.js"></script>
</body>
</html>
```

- [ ] **Step 8: Tạo 3 section HTML**

`frontend/src/views/driver/sections/login.html`:

```html
<section id="screenLogin" class="screen screen-center" hidden>
  <form class="card login-card" data-submit="driverLogin">
    <h1><i class="fa-solid fa-bus"></i> Tài xế</h1>
    <p class="muted">Đăng nhập để nhận chuyến và phát vị trí xe</p>
    <label for="driverUsername">Tên đăng nhập</label>
    <input id="driverUsername" autocomplete="username" autocapitalize="off" required />
    <label for="driverPassword">Mật khẩu</label>
    <input id="driverPassword" type="password" autocomplete="current-password" required />
    <p id="loginError" class="form-error" hidden></p>
    <button type="submit" class="btn btn-primary btn-block">Đăng nhập</button>
    <a href="index.html" class="link-muted">← Về bản đồ công khai</a>
  </form>
</section>
```

`frontend/src/views/driver/sections/trip-select.html`:

```html
<section id="screenTrips" class="screen" hidden>
  <header class="screen-header">
    <div>
      <div id="driverName" class="title"></div>
      <div class="muted"><i class="fa-solid fa-bus"></i> <span id="vehiclePlate"></span></div>
    </div>
    <button type="button" class="btn btn-ghost" data-action="driverLogout" title="Đăng xuất">
      <i class="fa-solid fa-right-from-bracket"></i>
    </button>
  </header>
  <h2 class="section-title">Chọn chuyến</h2>
  <ul id="scheduleList" class="schedule-list"></ul>
  <p id="scheduleEmpty" class="muted" hidden>Xe chưa được phân lịch trình</p>
</section>
```

`frontend/src/views/driver/sections/drive-panel.html`:

```html
<section id="screenDrive" class="screen screen-drive" hidden>
  <div id="driveMap"></div>

  <div class="drive-topbar">
    <button type="button" class="btn btn-round" data-action="changeTrip" title="Đổi chuyến">
      <i class="fa-solid fa-arrow-left"></i>
    </button>
    <span id="connBadge" class="badge badge-off">OFFLINE</span>
    <span id="gpsSourceBadge" class="badge badge-idle">Chưa có tín hiệu</span>
    <button type="button" id="btnFollow" class="btn btn-round active" data-action="toggleFollow" title="Bám theo xe">
      <i class="fa-solid fa-location-crosshairs"></i>
    </button>
  </div>

  <div id="replacedBanner" class="banner" hidden>
    <i class="fa-solid fa-triangle-exclamation"></i> Xe đang được điều khiển từ thiết bị khác
  </div>

  <div class="drive-panel">
    <div class="drive-route"><span id="tripRoute"></span> · <span id="tripDirection"></span></div>
    <div class="drive-stats">
      <div class="stat">
        <div class="stat-value" id="driveSpeed">0</div>
        <div class="stat-label">km/h</div>
      </div>
      <div class="stat stat-wide">
        <div class="stat-label">Trạm kế tiếp</div>
        <div class="stat-text" id="nextStopName">—</div>
        <div class="stat-label" id="nextStopDistance"></div>
      </div>
    </div>
    <button type="button" id="btnTripToggle" class="btn btn-primary btn-block btn-lg" data-action="toggleTrip">
      <i class="fa-solid fa-play"></i> Bắt đầu chuyến
    </button>
  </div>
</section>
```

- [ ] **Step 9: Tạo `frontend/assets/css/driver.css`**

```css
/* Trang tài xế — mobile-first */
:root {
  --bg: #0f172a;
  --surface: #ffffff;
  --text: #0f172a;
  --muted: #64748b;
  --border: #e2e8f0;
  --primary: #2563eb;
  --danger: #dc2626;
  --ok-bg: #dcfce7;  --ok-text: #166534;
  --off-bg: #fee2e2; --off-text: #b91c1c;
  --warn-bg: #fef3c7; --warn-text: #92400e;
  --idle-bg: #e2e8f0; --idle-text: #475569;
}

* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; }
body {
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  background: var(--bg);
  color: var(--text);
}

.screen { min-height: 100%; padding: 16px; background: #f1f5f9; }
.screen[hidden] { display: none; }
.screen-center { display: flex; align-items: center; justify-content: center; background: var(--bg); }

.card { background: var(--surface); border-radius: 14px; padding: 24px; box-shadow: 0 10px 30px rgba(0, 0, 0, 0.25); }
.login-card { width: 100%; max-width: 380px; display: flex; flex-direction: column; gap: 8px; }
.login-card h1 { margin: 0; font-size: 1.5rem; }
.login-card input {
  padding: 12px; border: 1px solid var(--border); border-radius: 10px; font-size: 1rem;
}
.muted { color: var(--muted); margin: 0 0 8px; }
.form-error { color: var(--danger); margin: 4px 0; }
.link-muted { color: var(--muted); text-align: center; margin-top: 8px; font-size: 0.9rem; }

.btn {
  border: 0; border-radius: 10px; padding: 12px 16px; font-size: 1rem; font-weight: 600;
  cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 8px;
}
.btn:disabled { opacity: 0.6; cursor: wait; }
.btn-primary { background: var(--primary); color: #fff; }
.btn-danger { background: var(--danger); color: #fff; }
.btn-ghost { background: transparent; color: var(--text); font-size: 1.2rem; }
.btn-block { width: 100%; }
.btn-lg { padding: 16px; font-size: 1.15rem; }
.btn-round { width: 44px; height: 44px; border-radius: 50%; padding: 0; background: var(--surface); color: var(--text); box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2); }
.btn-round.active { background: var(--primary); color: #fff; }

.screen-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
.title { font-size: 1.2rem; font-weight: 700; }
.section-title { font-size: 1rem; color: var(--muted); margin: 0 0 8px; }
.schedule-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 10px; }
.schedule-item {
  width: 100%; text-align: left; background: var(--surface); border: 1px solid var(--border);
  border-radius: 12px; padding: 14px 16px; display: grid; grid-template-columns: 1fr auto;
  gap: 4px 12px; cursor: pointer; font-size: 1rem; color: var(--text);
}
.schedule-route { font-weight: 600; }
.schedule-meta { grid-column: 1; color: var(--muted); font-size: 0.9rem; }
.schedule-item i { grid-column: 2; grid-row: 1 / span 2; align-self: center; color: var(--muted); }

.screen-drive { padding: 0; position: relative; height: 100vh; height: 100dvh; }
#driveMap { position: absolute; inset: 0; }
.drive-topbar {
  position: absolute; top: 12px; left: 12px; right: 12px; z-index: 10;
  display: flex; align-items: center; gap: 8px;
}
.drive-topbar #btnFollow { margin-left: auto; }
.badge { padding: 4px 10px; border-radius: 999px; font-size: 0.8rem; font-weight: 600; box-shadow: 0 2px 6px rgba(0, 0, 0, 0.15); }
.badge-on { background: var(--ok-bg); color: var(--ok-text); }
.badge-off { background: var(--off-bg); color: var(--off-text); }
.badge-warn { background: var(--warn-bg); color: var(--warn-text); }
.badge-idle { background: var(--idle-bg); color: var(--idle-text); }

.banner {
  position: absolute; top: 68px; left: 12px; right: 12px; z-index: 10;
  background: var(--warn-bg); color: var(--warn-text); padding: 10px 14px; border-radius: 10px; font-weight: 600;
}
.banner[hidden] { display: none; }

.drive-panel {
  position: absolute; left: 0; right: 0; bottom: 0; z-index: 10;
  background: var(--surface); border-radius: 18px 18px 0 0; padding: 16px 16px calc(16px + env(safe-area-inset-bottom));
  box-shadow: 0 -6px 20px rgba(0, 0, 0, 0.2); display: flex; flex-direction: column; gap: 12px;
}
.drive-route { font-weight: 700; font-size: 1.05rem; }
.drive-stats { display: flex; gap: 12px; }
.stat { background: #f8fafc; border-radius: 12px; padding: 10px 14px; min-width: 90px; }
.stat-wide { flex: 1; min-width: 0; }
.stat-value { font-size: 2rem; font-weight: 800; line-height: 1; }
.stat-text { font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.stat-label { color: var(--muted); font-size: 0.8rem; }

#toastContainer {
  position: fixed; top: 12px; left: 12px; right: 12px; z-index: 10000;
  display: flex; flex-direction: column; align-items: center; gap: 8px; pointer-events: none;
}
.toast-msg {
  pointer-events: auto; background: #0f172a; color: #fff; padding: 10px 14px; border-radius: 10px;
  display: flex; gap: 8px; align-items: center; max-width: 420px; width: 100%;
  border-left: 4px solid #38bdf8; animation: toastIn 0.25s ease-out;
}
.toast-msg.success { border-left-color: #22c55e; }
.toast-msg.error { border-left-color: #ef4444; }
.toast-msg.warning { border-left-color: #f59e0b; }
@keyframes toastIn { from { transform: translateY(-20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
```

- [ ] **Step 10: Tạo state và helper chuyển màn**

`frontend/src/views/driver/driver.state.js`:

```js
// Trạng thái dùng chung giữa các feature của trang tài xế (đọc/ghi qua thuộc tính)
export const state = {
  user: null,          // { user_id, username, full_name }
  vehicle: null,       // { vehicle_id, plate_number }
  schedules: [],       // lịch trình của xe
  schedule: null,      // lịch trình đang chạy
  broadcasting: false  // trang này đang phát GPS điện thoại qua /device
};
```

`frontend/src/views/driver/features/screens.js`:

```js
const SCREENS = ["screenLogin", "screenTrips", "screenDrive"];

// Hiện đúng một màn, ẩn các màn còn lại
export function showScreen(id) {
  SCREENS.forEach(s => { document.getElementById(s).hidden = s !== id; });
}
```

- [ ] **Step 11: Tạo `frontend/src/views/driver/features/driver-auth.js`**

```js
import { state } from "../driver.state.js";
import { DRIVER_TOKEN_KEY } from "../../../core/config.js";
import { getToken, setToken, clearToken } from "../../../core/session.js";
import { ApiError, apiErrorMessage } from "../../../core/http.js";
import { showToast } from "../../../core/toast.js";
import { driverLogin, getDriverMe } from "../../../modules/driver/driver.service.js";

async function loadProfile() {
  const me = await getDriverMe();
  state.user = me.user;
  state.vehicle = me.vehicle;
  state.schedules = me.schedules;
}

// Có token còn hạn → nạp hồ sơ; token hỏng/hết hạn → xóa và về màn đăng nhập
export async function restoreSession() {
  if (!getToken(DRIVER_TOKEN_KEY)) return false;
  try {
    await loadProfile();
    return true;
  } catch (err) {
    if (err instanceof ApiError) clearToken(DRIVER_TOKEN_KEY);
    else showToast("Không kết nối được máy chủ", "error");
    return false;
  }
}

export async function handleLogin() {
  const errorEl = document.getElementById("loginError");
  errorEl.hidden = true;
  const username = document.getElementById("driverUsername").value.trim();
  const passwordEl = document.getElementById("driverPassword");
  try {
    const { token } = await driverLogin(username, passwordEl.value);
    setToken(token, DRIVER_TOKEN_KEY);
    await loadProfile();
    passwordEl.value = "";
    return true;
  } catch (err) {
    errorEl.textContent = err instanceof ApiError ? apiErrorMessage(err, "Đăng nhập thất bại") : "Không kết nối được máy chủ";
    errorEl.hidden = false;
    return false;
  }
}

export function logout() {
  clearToken(DRIVER_TOKEN_KEY);
  state.user = null;
  state.vehicle = null;
  state.schedules = [];
  state.schedule = null;
}
```

- [ ] **Step 12: Tạo `frontend/src/views/driver/features/trip-select.js`**

```js
import { state } from "../driver.state.js";

const DIRECTION_LABEL = { 1: "Lượt đi", 2: "Lượt về" };
export const directionLabel = d => DIRECTION_LABEL[d] || `Chiều ${d}`;

// Danh sách lịch trình của xe; nội dung gán qua textContent (tên tuyến từ CSDL)
export function renderTrips() {
  document.getElementById("driverName").textContent = state.user.full_name;
  document.getElementById("vehiclePlate").textContent = state.vehicle.plate_number;

  const items = state.schedules.map(s => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "schedule-item";
    btn.dataset.action = "selectTrip";
    btn.dataset.arg = s.schedule_id;
    btn.innerHTML = '<span class="schedule-route"></span><span class="schedule-meta"></span><i class="fa-solid fa-chevron-right"></i>';
    btn.querySelector(".schedule-route").textContent = `Tuyến ${s.route_number} – ${s.route_name}`;
    btn.querySelector(".schedule-meta").textContent = `${directionLabel(s.direction)} · ${s.departure_time}`;
    const li = document.createElement("li");
    li.appendChild(btn);
    return li;
  });
  document.getElementById("scheduleList").replaceChildren(...items);
  document.getElementById("scheduleEmpty").hidden = state.schedules.length > 0;
}

export function selectTrip(scheduleId) {
  state.schedule = state.schedules.find(s => s.schedule_id === scheduleId) || null;
  return state.schedule;
}
```

- [ ] **Step 13: Tạo `frontend/src/views/driver/features/drive-map.js`**

```js
import { state } from "../driver.state.js";
import { loadArcgisModules } from "../../../core/arcgis.js";
import { showToast } from "../../../core/toast.js";
import { getRoutePath, flattenPathCoords } from "../../../modules/paths/paths.service.js";
import { listRouteStops } from "../../../modules/stops/stops.service.js";
import { connectRealtime } from "../../../modules/realtime/realtime.service.js";
import { nextStop } from "./next-stop.js";
import { directionLabel } from "./trip-select.js";

const SIGNAL_TIMEOUT_MS = 10000;

// Đối tượng ArcGIS & kết nối viewer của màn Chạy xe
const ctx = {
  view: null, Graphic: null, Point: null,
  routeLayer: null, stopsLayer: null, busLayer: null, busGraphic: null,
  socket: null, signalTimer: null,
  pathCoords: [], stops: [], follow: true, lastFixAt: 0
};

async function ensureMap() {
  if (ctx.view) return;
  const [EsriMap, MapView, Graphic, GraphicsLayer, Point] = await loadArcgisModules([
    "esri/Map", "esri/views/MapView", "esri/Graphic", "esri/layers/GraphicsLayer", "esri/geometry/Point"
  ]);
  Object.assign(ctx, { Graphic, Point });
  ctx.routeLayer = new GraphicsLayer();
  ctx.stopsLayer = new GraphicsLayer();
  ctx.busLayer = new GraphicsLayer();
  ctx.view = new MapView({
    container: "driveMap",
    map: new EsriMap({ basemap: "streets-navigation-vector", layers: [ctx.routeLayer, ctx.stopsLayer, ctx.busLayer] }),
    center: [106.70, 10.78],
    zoom: 13,
    ui: { components: ["zoom"] }
  });
  // Người dùng tự kéo bản đồ → tắt bám xe
  ctx.view.on("drag", () => setFollow(false));
  await ctx.view.when();
}

function setBadge(id, text, cls) {
  const el = document.getElementById(id);
  el.textContent = text;
  el.className = `badge ${cls}`;
}

// Nguồn GPS: trang này đang phát → Điện thoại; nhận vị trí xe mình mà không phát → Thiết bị khác
export function refreshSourceBadge() {
  if (Date.now() - ctx.lastFixAt >= SIGNAL_TIMEOUT_MS) return setBadge("gpsSourceBadge", "Chưa có tín hiệu", "badge-idle");
  if (state.broadcasting) return setBadge("gpsSourceBadge", "Điện thoại", "badge-on");
  setBadge("gpsSourceBadge", "Thiết bị khác", "badge-warn");
}

function setFollow(on) {
  ctx.follow = on;
  document.getElementById("btnFollow").classList.toggle("active", on);
}

export function toggleFollow() {
  setFollow(!ctx.follow);
  if (ctx.follow && ctx.busGraphic) ctx.view.goTo(ctx.busGraphic.geometry, { animate: false }).catch(() => {});
}

const formatDistance = m => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`);

function renderNextStop(position) {
  const result = nextStop(position, ctx.pathCoords, ctx.stops);
  document.getElementById("nextStopName").textContent = result
    ? result.stop.stop_name
    : (ctx.stops.length ? "Đã đến cuối tuyến" : "—");
  document.getElementById("nextStopDistance").textContent = result ? formatDistance(result.distanceMeters) : "";
}

function showBus({ longitude, latitude }) {
  const geometry = new ctx.Point({ longitude, latitude });
  if (!ctx.busGraphic) {
    ctx.busGraphic = new ctx.Graphic({
      geometry,
      symbol: { type: "simple-marker", color: [255, 59, 48], size: 18, outline: { color: [255, 255, 255], width: 3 } }
    });
    ctx.busLayer.add(ctx.busGraphic);
  } else {
    ctx.busGraphic.geometry = geometry;
  }
  if (ctx.follow && !ctx.view.interacting) ctx.view.goTo({ center: [longitude, latitude] }, { animate: false }).catch(() => {});
}

function hideBus() {
  if (ctx.busLayer) ctx.busLayer.removeAll();
  ctx.busGraphic = null;
  ctx.lastFixAt = 0;
  refreshSourceBadge();
}

// Vị trí xe mình lấy từ feed viewer → hiển thị đúng dù GPS đến từ điện thoại hay simulator
function onFleetUpdate(data) {
  if (!state.vehicle || data.vehicle_id !== state.vehicle.vehicle_id) return;
  ctx.lastFixAt = Date.now();
  refreshSourceBadge();
  showBus(data);
  document.getElementById("driveSpeed").textContent = Math.round(data.speed_kmh || 0);
  renderNextStop([data.longitude, data.latitude]);
}

async function drawRoute(schedule) {
  ctx.routeLayer.removeAll();
  ctx.stopsLayer.removeAll();
  ctx.pathCoords = [];
  ctx.stops = [];
  try {
    const [path, stops] = await Promise.all([
      getRoutePath(schedule.route_id, schedule.direction),
      listRouteStops(schedule.route_id, schedule.direction)
    ]);
    ctx.pathCoords = flattenPathCoords(path.geometry);
    ctx.stops = stops;
    const line = new ctx.Graphic({
      geometry: { type: "polyline", paths: [ctx.pathCoords] },
      symbol: { type: "simple-line", color: [37, 99, 235], width: 5 }
    });
    ctx.routeLayer.add(line);
    ctx.stopsLayer.addMany(stops.map(st => new ctx.Graphic({
      geometry: { type: "point", longitude: st.longitude, latitude: st.latitude },
      symbol: { type: "simple-marker", color: [20, 184, 166], size: 9, outline: { color: [255, 255, 255], width: 1.5 } },
      attributes: { name: st.stop_name },
      popupTemplate: { title: "{name}" }
    })));
    await ctx.view.goTo(line.geometry.extent.expand(1.2), { animate: false });
  } catch (err) {
    console.warn("Không tải được lộ trình:", err);
    showToast("Không tải được lộ trình tuyến", "error");
  }
}

function resetPanel() {
  document.getElementById("driveSpeed").textContent = "0";
  document.getElementById("nextStopName").textContent = "—";
  document.getElementById("nextStopDistance").textContent = "";
  document.getElementById("replacedBanner").hidden = true;
  setBadge("connBadge", "OFFLINE", "badge-off");
  setFollow(true);
  hideBus();
}

export async function openDrive() {
  const schedule = state.schedule;
  document.getElementById("tripRoute").textContent = `Tuyến ${schedule.route_number}`;
  document.getElementById("tripDirection").textContent = directionLabel(schedule.direction);
  await ensureMap();
  resetPanel();
  await drawRoute(schedule);

  ctx.socket = connectRealtime({
    onConnect: () => setBadge("connBadge", "ONLINE", "badge-on"),
    onDisconnect: () => setBadge("connBadge", "OFFLINE", "badge-off"),
    onFleetUpdate,
    onVehicleOffline: ({ vehicle_id }) => { if (vehicle_id === state.vehicle?.vehicle_id) hideBus(); }
  });
  ctx.signalTimer = setInterval(refreshSourceBadge, 2000);
}

export function closeDrive() {
  if (ctx.socket) ctx.socket.disconnect();
  ctx.socket = null;
  clearInterval(ctx.signalTimer);
  ctx.signalTimer = null;
  hideBus();
}
```

- [ ] **Step 14: Tạo `frontend/src/views/driver/features/phone-gps.js`**

```js
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
```

- [ ] **Step 15: Tạo entry `frontend/src/views/driver/driver.view.js`**

```js
// Entry trang tài xế (driver.html): Đăng nhập → Chọn chuyến → Chạy xe
import { mountSections } from "../../core/dom.js";
import { registerActions } from "../../core/actions.js";
import { showScreen } from "./features/screens.js";
import { restoreSession, handleLogin, logout } from "./features/driver-auth.js";
import { renderTrips, selectTrip } from "./features/trip-select.js";
import { openDrive, closeDrive, toggleFollow } from "./features/drive-map.js";
import { toggleTrip, stopBroadcast } from "./features/phone-gps.js";

function enterTrips() {
  renderTrips();
  showScreen("screenTrips");
}

// Rời màn Chạy xe: kết thúc chuyến đang phát (nếu có) và ngắt feed viewer
async function leaveDrive() {
  await stopBroadcast();
  closeDrive();
}

registerActions({
  driverLogin: async (el, e) => {
    e.preventDefault();
    if (await handleLogin()) enterTrips();
  },
  driverLogout: async () => {
    await leaveDrive();
    logout();
    showScreen("screenLogin");
  },
  selectTrip: async el => {
    if (!selectTrip(Number(el.dataset.arg))) return;
    showScreen("screenDrive");
    await openDrive();
  },
  changeTrip: async () => {
    await leaveDrive();
    enterTrips();
  },
  toggleTrip: () => toggleTrip(),
  toggleFollow: () => toggleFollow()
});

await mountSections(import.meta.url);
if (await restoreSession()) enterTrips();
else showScreen("screenLogin");
```

- [ ] **Step 16: Thêm link "Tài xế" vào top bar bản đồ và danh sách file test**

Trong `frontend/src/views/map/sections/top-bar.html`, ngay sau dòng `<div id="userProfileBar">`, thêm:

```html
  <a href="driver.html" class="btn-top-action" title="Trang dành cho tài xế">
    <i class="fa-solid fa-id-card"></i> Tài xế
  </a>
```

Trong `backend/test_suite.js` module 5, thêm vào mảng `frontendFiles`:

```js
    { path: path.join(__dirname, "../frontend/driver.html"), name: "Trang Tài xế (frontend/driver.html)" },
```

(Test module 5 yêu cầu file > 500 ký tự và chứa `<html`; `driver.html` ở Step 7 đáp ứng cả hai.)

- [ ] **Step 17: Kiểm tra cú pháp và test**

```bash
for f in frontend/src/modules/driver/driver.service.js frontend/src/modules/realtime/device.service.js frontend/src/views/driver/*.js frontend/src/views/driver/features/*.js; do node --check "$f" || echo "SYNTAX FAIL $f"; done
node --test frontend/src/views/driver/features/next-stop.test.js
```

Expected: không có `SYNTAX FAIL`; 7 test pass.

- [ ] **Step 18: Kiểm tra thủ công trên trình duyệt**

Backend đang chạy, đã seed, simulator chạy `--count 3`.

1. Mở `http://localhost:3000/` → có nút "Tài xế" → bấm vào → màn đăng nhập.
2. Đăng nhập `driver01` / `sai` → hiện "Tên đăng nhập hoặc mật khẩu không chính xác".
3. Đăng nhập `admin` / `admin123` → hiện "Tài khoản không phải tài xế".
4. Đăng nhập `driver01` / `driver123` → thấy "Tài xế 01", biển `51B-900.01`, một dòng lịch trình.
5. Bấm lịch trình → bản đồ toàn màn hình với polyline xanh và trạm xanh ngọc. Badge ONLINE. Trong ~2 giây, xe đỏ xuất hiện, badge nguồn hiện **"Thiết bị khác"** (simulator). Tốc độ và trạm kế tiếp cập nhật; trạm kế tiếp đổi khi xe đi qua trạm.
6. Kéo bản đồ → nút bám xe tắt màu. Bấm lại → camera về xe.
7. DevTools → More tools → Sensors → Location: chọn tọa độ gần tuyến (ví dụ điểm đầu polyline). Bấm **Bắt đầu chuyến** → toast "Đã bắt đầu chuyến", nút đổi thành "Kết thúc chuyến" màu đỏ. Terminal simulator in `driver01: bị thay bởi thiết bị khác`. Xe nhảy về vị trí giả lập, badge nguồn **"Điện thoại"**. Đổi tọa độ trong Sensors → xe di chuyển theo.
8. Mở tab thứ hai `http://localhost:3000/` (bản đồ công khai) → thấy xe `51B-900.01` ở vị trí giả lập.
9. Bấm **Kết thúc chuyến** → xe biến khỏi bản đồ công khai, badge nguồn về "Chưa có tín hiệu" sau ≤ 10 giây.
10. Bấm Bắt đầu lại, rồi mở tab thứ ba `driver.html` cùng tài khoản, chọn chuyến, bấm Bắt đầu → tab cũ hiện banner "Xe đang được điều khiển từ thiết bị khác" và nút về "Bắt đầu chuyến".
11. (Review Focus #3) Khi đang phát, khởi động lại backend → sau khi kết nối lại, xe vẫn cập nhật vị trí trên bản đồ công khai (trang tự gửi lại `trip:start`).
12. (Review Focus #5) Console: `localStorage.setItem("bus_driver_token","rac")` rồi tải lại trang → về màn đăng nhập, không có màn trắng hay lỗi chưa bắt.
13. Bấm "Đổi chuyến" khi đang phát → chuyến kết thúc, quay lại danh sách. Bấm Đăng xuất → về màn đăng nhập. Tải lại trang → vẫn ở màn đăng nhập.
14. Thu nhỏ trình duyệt về 375px (DevTools device toolbar) → panel dưới và topbar không tràn ngang.

- [ ] **Step 19: Commit**

```bash
git add frontend/driver.html frontend/assets/css/driver.css frontend/src/views/driver frontend/src/modules/driver frontend/src/modules/realtime/device.service.js frontend/src/views/map/sections/top-bar.html backend/test_suite.js
git commit -m "feat(driver): mobile driver page with trip selection, live map and phone GPS

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Cập nhật tài liệu

**Files:**
- Modify: `README.md`
- Modify: `ARCHITECTURE_SPEC.md:1-16`
- Modify: `docs/USE_CASES.md` (các dòng 16, 27-31, sơ đồ 39-97, bảng 99-124, UC-10 dòng 274, UC-15 dòng 328-329, UC-19 dòng 384-399, bảng hạn chế dòng 470-490)
- Modify: `docs/SOCKET_IO_TRACKING.md`

- [ ] **Step 1: README — cây thư mục**

Trong khối cây thư mục:
- thay dòng `│   │   └── sockets/tracking.socket.js # Hub realtime: …` bằng:
  ```
  │   │   └── sockets/                # index.js, viewer.socket.js ("/" chỉ nhận), device.socket.js + device.auth.js ("/device" tài xế), gps.validate.js, tracking-log.js
  ```
- xóa dòng `│   ├── simulator.js                # Bộ phát GPS giả lập lộ trình xe buýt (đang tạm tắt)`
- đổi dòng `│   └── scripts/                    # db:import / db:export busdata.sql` thành:
  ```
  │   └── scripts/                    # db:import / db:export busdata.sql, db:seed-drivers (tài xế demo)
  ```
- trong nhánh `frontend/`, thêm dòng `driver.html` cạnh `index.html`/`admin.html` theo cùng định dạng, mô tả `# Trang tài xế (mobile): đăng nhập, chọn chuyến, bản đồ, phát GPS điện thoại`;
- thêm nhánh cấp cao nhất sau `frontend/`:
  ```
  ├── simulator/                      # (Tùy chọn, công cụ demo) Tài xế ảo phát GPS — độc lập, xóa khi triển khai thật
  ```

- [ ] **Step 2: README — thay mục "### 3. Bộ giả lập GPS xe buýt (đang tạm tắt)"**

Thay tiêu đề và đoạn văn của mục đó bằng:

````markdown
### 3. Tài khoản tài xế & nguồn GPS

GPS chỉ được phát bởi **tài xế đã đăng nhập** (namespace Socket.io `/device`, JWT role `DRIVER`). Bản đồ chỉ nhận dữ liệu.

```bash
cd backend && npm run db:seed-drivers -- --count 20   # driver01..driver20 / mật khẩu driver123, xe DRV_01..DRV_20
```

`db:import` không đụng `users`/`vehicles`. Nếu import làm thay đổi danh sách tuyến, chạy lại seed để tài xế có lịch trình.

**Trang tài xế:** `http://localhost:3000/frontend/driver.html`. Đăng nhập → chọn chuyến → **Bắt đầu chuyến** để phát GPS điện thoại.
Trình duyệt chỉ cho đọc GPS trên HTTPS hoặc `localhost`:
- Test trên laptop: mở bằng `localhost`, giả lập vị trí bằng DevTools → Sensors.
- Test trên điện thoại thật: mở tunnel HTTPS (`cloudflared tunnel --url http://localhost:3000` hoặc `ngrok http 3000`).

**Simulator (tùy chọn):** tài xế ảo đăng nhập và phát GPS giống điện thoại. Xem [simulator/README.md](simulator/README.md).

```bash
cd simulator && npm install && npm start -- --count 10
```
````

Trong mục "Access URLs" của README (các URL `localhost:3000`), thêm một dòng cho `http://localhost:3000/frontend/driver.html` theo cùng định dạng các dòng đang có.

- [ ] **Step 3: ARCHITECTURE_SPEC — đánh dấu tài liệu cũ**

Chèn ngay dưới dòng `## ĐỀ TÀI: …` (dòng 2):

```markdown

> **Lưu ý:** Tài liệu này là bản tổng hợp mã nguồn giai đoạn đầu, chưa cập nhật theo cấu trúc hiện tại.
> Hub realtime nay nằm ở `backend/src/sockets/` (namespace `/` chỉ nhận, `/device` cho tài xế đã xác thực).
> Bộ giả lập đã tách thành thư mục độc lập `simulator/`.
> Xem [README.md](README.md) và [docs/superpowers/specs/2026-10-04-socket-security-driver-design.md](docs/superpowers/specs/2026-10-04-socket-security-driver-design.md).
```

Đổi mục lục dòng 10 thành:

```markdown
4. `backend/simulator.js` - *(đã thay bằng thư mục `simulator/` độc lập)* Tiến trình giả lập GPS phát tọa độ xe buýt di chuyển
```

- [ ] **Step 4: USE_CASES — tác nhân và tổng quan**

Dòng 16 (bảng tổng quan), thay hàng "Hub realtime Socket.io" bằng:

```markdown
| Hub realtime Socket.io | `backend/src/sockets/` — namespace `/` (viewer, chỉ nhận) và `/device` (tài xế, JWT) | Tài xế / simulator gửi lên, bản đồ nhận về |
| Trang tài xế | `frontend/driver.html` → `src/views/driver/` | Tài xế (DRIVER) |
```

Bảng tác nhân:
- dòng 28, cột cuối của MANAGER, đổi thành: `` `role = 'MANAGER'`; các route ghi dữ liệu yêu cầu `authenticateToken` + `requireStaff` ``
- thay hàng "Nguồn GPS" (dòng 30) bằng hai hàng:

```markdown
| **Tài xế (DRIVER)** | Người lái xe. Đăng nhập trang tài xế, chọn chuyến của xe mình, xem bản đồ tuyến và phát GPS từ điện thoại. | `role = 'DRIVER'`, được gán xe qua `vehicles.driver_user_id`; đăng nhập qua `POST /auth/driver/login` |
| **Nguồn GPS** (tác nhân hệ thống) | Thiết bị phát `gps_ping` qua namespace `/device`: điện thoại của tài xế hoặc simulator (tài xế ảo, công cụ demo trong `simulator/`). | Phải có JWT của tài xế đã gán xe; server tự điền danh tính xe |
```

- [ ] **Step 5: USE_CASES — sơ đồ và bảng use case**

Trong khối mermaid:
- thêm `TX(("👤 Tài xế"))` dưới dòng `GPS((…))`;
- thêm subgraph sau subgraph `ADMIN`:

```
    subgraph DRV["Trang tài xế (driver.html)"]
        UC23(["UC-23 Tài xế chạy chuyến & phát GPS"])
    end
```

- thêm dòng nối cạnh `GPS --- UC19`:

```
    TX --- UC23
    UC23 -. phát qua /device .-> UC19
```

Thêm vào cuối bảng mục 4:

```markdown
| UC-23 | Tài xế chạy chuyến & phát GPS | Tài xế | Trang tài xế | `POST /auth/driver/login`, `GET /driver/me`, Socket `/device`: `trip:start`, `gps_ping`, `trip:end` |
```

Đổi hàng UC-19 thành:

```markdown
| UC-19 | Gửi & phát vị trí GPS | Nguồn GPS | — | Socket `/device` `gps_ping` → `/` `fleet_location_update`, `vehicle_offline` |
```

- [ ] **Step 6: USE_CASES — nội dung UC-10, UC-15, UC-19, UC-23**

Dòng 274 (UC-10 ghi chú), thay bằng:

```markdown
- **Ghi chú:** "Nhật ký GPS đã ghi" tăng tối đa 1 bản ghi / xe / 5 giây khi có tài xế (thật hoặc ảo) đang chạy chuyến.
```

Dòng 328-329 (UC-15 ghi chú), thay hai gạch đầu dòng bằng:

```markdown
  - Ngoài trang quản trị, lịch trình được trang tài xế (UC-23) đọc qua `GET /driver/me` để tài xế chọn chuyến; server kiểm tra lịch trình thuộc xe của tài xế khi `trip:start`. Bản đồ công khai không đọc bảng này.
  - Trường **giờ xuất bến** (`departure_time`) chỉ để hiển thị trên trang tài xế; hệ thống không ép chạy theo giờ.
```

Thay toàn bộ nội dung UC-19 (từ `- **Tác nhân:** Nguồn GPS (hiện là …` tới hết dòng `- **Code:** [tracking.socket.js]…`) bằng:

```markdown
- **Tác nhân:** Nguồn GPS: điện thoại của tài xế (UC-23) hoặc simulator `simulator/` (công cụ demo).
- **Tiền điều kiện:** Thiết bị kết nối namespace `/device` với JWT của tài xế (role DRIVER) đang được gán xe. Sai token → `connect_error: UNAUTHORIZED`; chưa gán xe → `NO_VEHICLE`.
- **Luồng chính:**
  1. Thiết bị gửi `trip:start { schedule_id }` (có ack). Server kiểm tra lịch trình thuộc xe của tài xế rồi gắn tuyến + chiều vào phiên.
  2. Thiết bị gửi `gps_ping { latitude, longitude, speed_kmh?, heading? }`. Server kiểm tra định dạng/khoảng giá trị, bỏ gói cách gói trước < 250 ms, rồi **tự dựng** gói `{ vehicle_id, plate_number, route_id, route_number, direction, longitude, latitude, speed_kmh, heading, timestamp }` từ phiên đã xác thực (không tin `vehicle_id` client gửi).
  3. Gói được phát tới mọi viewer qua `fleet_location_update` (phục vụ UC-05).
  4. Ghi `vehicle_tracking_logs` tối đa 1 bản ghi / xe / 5 giây.
  5. `trip:end` hoặc mất kết nối khi đang có chuyến → phát `vehicle_offline { vehicle_id }`, bản đồ gỡ xe.
- **Luồng ngoại lệ:**
  - Lịch trình không thuộc xe → ack `SCHEDULE_NOT_ALLOWED`.
  - Gói sai định dạng → bỏ, server ghi cảnh báo có giới hạn.
  - Phiên mới cùng xe → phiên cũ nhận `session:replaced` và bị ngắt (không phát `vehicle_offline`).
  - Lỗi ghi log → `console.error` có giới hạn; gói vẫn được phát.
- **Viewer (namespace `/`)** chỉ nhận; server không xử lý sự kiện nào từ viewer.
- **Code:** [sockets/](../backend/src/sockets/), [simulator/](../simulator/).
```

Thêm mục mới ngay sau UC-19 (trước `#### UC-20`):

```markdown
#### UC-23 — Tài xế chạy chuyến & phát GPS

- **Tác nhân:** Tài xế (DRIVER).
- **Tiền điều kiện:** Tài khoản DRIVER được gán xe (`vehicles.driver_user_id`); xe có ít nhất một lịch trình.
- **Luồng chính:**
  1. Mở `driver.html` → đăng nhập (`POST /auth/driver/login`). Token lưu ở `bus_driver_token`, tách khỏi token nhân viên.
  2. Màn **Chọn chuyến** (`GET /driver/me`): họ tên, biển số, danh sách lịch trình (tuyến, chiều, giờ xuất bến).
  3. Chọn một chuyến → bản đồ toàn màn hình với lộ trình và trạm của tuyến/chiều, xe của mình (từ feed viewer), tốc độ, **trạm kế tiếp** (chiếu vị trí lên lộ trình, trạm đầu tiên phía trước theo `stop_order`).
  4. **Bắt đầu chuyến** → kết nối `/device`, `trip:start`, đọc GPS điện thoại (`watchPosition`, tối đa 1 gói/giây), giữ màn hình sáng (Wake Lock nếu hỗ trợ).
  5. **Kết thúc chuyến** → `trip:end`, dừng GPS. **Đổi chuyến** / **Đăng xuất** kết thúc chuyến đang chạy trước.
- **Luồng ngoại lệ:**
  - Trang không chạy trên HTTPS/localhost → không đọc được GPS, báo lỗi.
  - Thiết bị khác chiếm xe → banner "Xe đang được điều khiển từ thiết bị khác".
  - Token hết hạn → quay về màn đăng nhập.
- **Ghi chú:** Badge nguồn GPS cho biết vị trí xe đến từ `Điện thoại` (trang này đang phát), `Thiết bị khác` (simulator/điện thoại khác) hay `Chưa có tín hiệu` (> 10 giây).
- **Code:** [driver.html](../frontend/driver.html), [views/driver/](../frontend/src/views/driver/), [driver.controller.js](../backend/src/modules/driver/driver.controller.js).
```

- [ ] **Step 7: USE_CASES — bảng hạn chế (mục 7)**

- Xóa các hàng: "Ghi nhật ký GPS từ bộ giả lập", "Xác thực nguồn GPS", "Giả lập GPS mặc định".
- Đổi hàng "Chạy xe theo giờ xuất bến" thành:
  `| Chạy xe theo giờ xuất bến | `departure_time` chỉ hiển thị trên trang tài xế; simulator chạy liên tục bất kể giờ. |`
- Đổi hàng ""Trạm tiếp theo" chính xác" thành:
  `| "Trạm tiếp theo" chính xác trên bản đồ công khai | Trang tài xế đã tính theo lộ trình + stop_order; bảng "Theo dõi xe" của bản đồ công khai vẫn dùng trạm gần nhất. |`
- Thêm hàng:
  `| Gán tài xế cho xe trên trang quản trị | Chưa có UI; gán qua seed (`npm run db:seed-drivers`) hoặc SQL `vehicles.driver_user_id`. |`

- [ ] **Step 8: Cập nhật `docs/SOCKET_IO_TRACKING.md`**

Trong bảng Tổng quan:
- đổi cột Trạng thái của #1, #3, #11, #12, #13 thành `DONE`;
- #2 thành `DOING`;
- #8 thành `DOING`.

Ở tiêu đề chi tiết của từng mục tương ứng, đổi `` — `TODO` `` thành `` — `DONE` `` hoặc `` — `DOING` `` cho khớp.

Đánh dấu `[x]` cho các checklist đã làm:
- toàn bộ #1, #3, #11, #12, #13
- ở #2: dòng "Ghi log ra console…" và "Chỉ ghi log cho vehicle_id có trong vehicles…" (đã đạt nhờ auth + FK), cùng phần throttle 5–10 giây/xe trong dòng cuối
- ở #8: không đánh dấu dòng quét timeout. Thêm dòng con dưới mục #8: `- [x] Phát vehicle_offline khi trip:end / thiết bị ngắt kết nối; client gỡ graphic và cache (quét timeout vẫn để nhóm B)`

Ở #2, thêm ghi chú dưới checklist: `Còn lại: bulk INSERT theo lô — làm cùng nhóm B.`

Thêm dòng vào Nhật ký thay đổi:

```markdown
| 2026-10-04 | #1 #3 #11 #12 #13, một phần #2 #8 | Namespace /device có JWT tài xế, validate + rate limit, một xe một phiên, vehicle_offline, log có throttle; tài khoản tài xế + seed; simulator độc lập; trang driver.html | nhánh `feat/socket-security-driver` |
```

- [ ] **Step 9: Kiểm tra tham chiếu cũ**

```bash
grep -n "tracking.socket\|backend/simulator\|npm run simulate" README.md docs/USE_CASES.md
```

Expected: không có dòng nào. `ARCHITECTURE_SPEC.md` được phép còn, vì đã đánh dấu là tài liệu cũ.

- [ ] **Step 10: Commit**

```bash
git add README.md ARCHITECTURE_SPEC.md docs/USE_CASES.md docs/SOCKET_IO_TRACKING.md
git commit -m "docs: document driver accounts, /device protocol and standalone simulator

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
