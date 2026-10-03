// ====================================================================
// NẠP database/busdata.sql VÀO CSDL
// - CSDL trống (chưa có bảng users): nạp database/schema.sql như server.js lúc khởi động
// - CSDL tạo từ schema cũ (demo ĐHQG): bổ sung cột mới & đổi khóa chính route_stops
// - Thay toàn bộ dữ liệu bus_routes, bus_stops, route_paths, route_stops
// - Cả file dữ liệu chạy trong 1 transaction: lỗi giữa chừng thì dữ liệu cũ giữ nguyên
//
// Chạy: cd backend && npm run db:import
// ====================================================================
const fs = require("fs");
const { DB_CONFIG, connectDbCreatingIfMissing, BUSDATA_SQL_FILE, SCHEMA_SQL_FILE } = require("./busdata_db");

const TABLES = ["bus_routes", "bus_stops", "route_paths", "route_stops"];

// Cột thêm vào so với schema cũ: [bảng, cột, định nghĩa]
const NEW_COLUMNS = [
  ["bus_routes", "route_type", "VARCHAR(60) NULL"],
  ["bus_routes", "color", "VARCHAR(9) NULL"],
  ["bus_routes", "operation_time", "VARCHAR(30) NULL"],
  ["bus_routes", "headway_text", "VARCHAR(20) NULL"],
  ["bus_stops", "stop_code", "VARCHAR(30) NULL AFTER stop_id"],
  ["bus_stops", "stop_type", "VARCHAR(50) NULL AFTER address"],
  ["bus_stops", "status", "VARCHAR(30) NOT NULL DEFAULT 'Đang khai thác' AFTER stop_type"]
];

// Số dòng kỳ vọng ghi ở đầu file: "-- Số dòng: bus_routes: 178, bus_stops: 5898, ..."
function expectedCounts(sql) {
  const header = sql.match(/^-- Số dòng: (.*)$/m);
  if (!header) return {};
  return Object.fromEntries(header[1].split(", ").map(part => {
    const [table, n] = part.split(": ");
    return [table, Number(n)];
  }));
}

async function ensureSchema(conn) {
  const [tables] = await conn.query("SHOW TABLES LIKE 'users'");
  if (tables.length === 0) {
    console.log("    CSDL trống → nạp database/schema.sql");
    // Bỏ CREATE DATABASE / USE cứng trong schema.sql để luôn chạy trên DB_NAME đang kết nối
    const schemaSql = fs.readFileSync(SCHEMA_SQL_FILE, "utf8")
      .replace(/^CREATE DATABASE[^;]*;/m, "")
      .replace(/^USE [^;]*;/m, "");
    await conn.query(schemaSql);
    return;
  }

  const [columns] = await conn.query(
    "SELECT table_name AS t, column_name AS c FROM information_schema.columns WHERE table_schema = ?",
    [DB_CONFIG.database]
  );
  const existing = new Set(columns.map(r => `${r.t}.${r.c}`));
  for (const [table, column, definition] of NEW_COLUMNS) {
    if (!existing.has(`${table}.${column}`)) {
      console.log(`    Bổ sung cột ${table}.${column}`);
      await conn.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  }

  // Khóa chính cũ (route_id, stop_id, direction) không cho tuyến vòng ghé một trạm 2 lần
  const [pk] = await conn.query(
    `SELECT column_name AS c FROM information_schema.key_column_usage
     WHERE table_schema = ? AND table_name = 'route_stops' AND constraint_name = 'PRIMARY'`,
    [DB_CONFIG.database]
  );
  if (pk.some(r => r.c === "stop_id")) {
    console.log("    Đổi khóa chính route_stops → (route_id, direction, stop_order)");
    // Dữ liệu cũ có thể trùng vị trí (route, direction, stop_order); busdata.sql nạp lại toàn bộ bảng ngay sau
    await conn.query("DELETE FROM route_stops");
    await conn.query("ALTER TABLE route_stops DROP PRIMARY KEY, ADD PRIMARY KEY (route_id, direction, stop_order), ADD INDEX (stop_id)");
  }
}

async function main() {
  const sql = fs.readFileSync(BUSDATA_SQL_FILE, "utf8");
  const expected = expectedCounts(sql);
  const conn = await connectDbCreatingIfMissing({ multipleStatements: true });

  let ok = true;
  try {
    await ensureSchema(conn);
    await conn.query(sql);

    // busdata.sql nạp với FOREIGN_KEY_CHECKS = 0 → lịch trình của tuyến đã bị thay (vd. demo BUS_01) thành mồ côi
    const [orphans] = await conn.query("DELETE FROM schedules WHERE route_id NOT IN (SELECT route_id FROM bus_routes)");
    if (orphans.affectedRows > 0) console.log(`    Xóa ${orphans.affectedRows} lịch trình trỏ tới tuyến không còn tồn tại`);

    for (const table of TABLES) {
      const [[row]] = await conn.query(`SELECT COUNT(*) AS n FROM ${table}`);
      const match = expected[table] === undefined || row.n === expected[table];
      ok = ok && match;
      console.log(`    ${match ? "✔" : "✘"} ${table}: ${row.n}${expected[table] !== undefined ? ` / ${expected[table]}` : ""}`);
    }
  } finally {
    await conn.end();
  }

  if (!ok) throw new Error("Số dòng sau khi nạp không khớp file");
  console.log(">>> Nạp busdata.sql thành công.");
}

main().catch(err => {
  console.error(">>> Nạp busdata.sql thất bại:", err.message);
  process.exit(1);
});
