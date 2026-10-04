// --------------------------------------------------------------------
// SEED TÀI XẾ DEMO: driverNN (role DRIVER) + xe DRV_NN + 1 lịch trình / xe
// Chạy: npm run db:seed-drivers -- --count 20
// Chạy lại an toàn: upsert theo khóa cố định để KHÔNG mất log hành trình
// (vehicle_tracking_logs xóa theo xe — ON DELETE CASCADE).
// --------------------------------------------------------------------
const bcrypt = require("bcryptjs");
const { dbPool } = require("../src/config/db");
const { migrateDriverSchema } = require("../src/config/migrations");

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
    await migrateDriverSchema(conn);

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
