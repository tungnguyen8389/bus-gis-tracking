// ====================================================================
// XUẤT DỮ LIỆU XE BUÝT HIỆN TẠI TRONG CSDL RA database/busdata.sql
// - Gồm 4 bảng: bus_routes, bus_stops, route_paths, route_stops
// - Mỗi dòng dữ liệu nằm trên 1 dòng, sắp theo khóa ổn định → git diff chỉ hiện dòng bị sửa
// - Hình học ghi dạng WKT để đọc được (không dùng blob nhị phân như mysqldump)
//
// Chạy sau khi chỉnh sửa lộ trình / trạm trong CSDL (Admin Portal, JSON importer...):
//   cd backend && npm run db:export
// ====================================================================
const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");
const { connectDb, BUSDATA_SQL_FILE } = require("./busdata_db");

const ROWS_PER_INSERT = 500;
const PATHS_PER_INSERT = 20;

// Mỗi bảng: cột xuất, câu truy vấn đã sắp thứ tự; cột hình học được đọc ra dạng WKT
// route_paths bỏ path_id (tự tăng) để lộ trình sửa trên editor vẫn giữ nguyên vị trí trong file
const TABLES = [
  {
    name: "bus_routes",
    columns: ["route_id", "route_number", "route_name", "distance_km", "headway_min", "route_type", "color", "operation_time", "headway_text"],
    query: `SELECT route_id, route_number, route_name, distance_km, headway_min, route_type, color, operation_time, headway_text
            FROM bus_routes ORDER BY CAST(route_id AS UNSIGNED), route_id`
  },
  {
    name: "bus_stops",
    columns: ["stop_id", "stop_code", "stop_name", "address", "stop_type", "status", "geom"],
    query: `SELECT stop_id, stop_code, stop_name, address, stop_type, status, ST_AsText(geom) AS geom
            FROM bus_stops ORDER BY CAST(stop_id AS UNSIGNED), stop_id`
  },
  {
    name: "route_paths",
    columns: ["route_id", "direction", "geom"],
    query: `SELECT route_id, direction, ST_AsText(geom) AS geom
            FROM route_paths ORDER BY CAST(route_id AS UNSIGNED), route_id, direction, path_id`,
    rowsPerInsert: PATHS_PER_INSERT
  },
  {
    name: "route_stops",
    columns: ["route_id", "stop_id", "direction", "stop_order"],
    query: `SELECT route_id, stop_id, direction, stop_order
            FROM route_stops ORDER BY CAST(route_id AS UNSIGNED), route_id, direction, stop_order`
  }
];

function sqlValue(column, value) {
  if (column === "geom") return `ST_GeomFromText(${mysql.escape(value)}, 4326)`;
  return mysql.escape(value);
}

function insertStatements(table, rows) {
  const size = table.rowsPerInsert || ROWS_PER_INSERT;
  const statements = [];
  for (let i = 0; i < rows.length; i += size) {
    const values = rows.slice(i, i + size)
      .map(row => "(" + table.columns.map(c => sqlValue(c, row[c])).join(", ") + ")")
      .join(",\n");
    statements.push(`INSERT INTO ${table.name} (${table.columns.join(", ")}) VALUES\n${values};`);
  }
  return statements.join("\n");
}

async function main() {
  const conn = await connectDb();
  const sections = [];
  const counts = [];
  try {
    for (const table of TABLES) {
      const [rows] = await conn.query(table.query);
      counts.push(`${table.name}: ${rows.length}`);
      sections.push(`-- ${table.name} (${rows.length} dòng)\n${insertStatements(table, rows)}`);
    }
  } finally {
    await conn.end();
  }

  // Không ghi thời điểm xuất để chạy lại trên cùng dữ liệu cho ra file y hệt
  const content = [
    "-- ====================================================================",
    "-- DỮ LIỆU XE BUÝT TP.HCM (tuyến, trạm, lộ trình, trạm-tuyến)",
    "-- File sinh tự động bởi: cd backend && npm run db:export — KHÔNG sửa tay",
    "-- Nạp vào CSDL:          cd backend && npm run db:import",
    `-- Số dòng: ${counts.join(", ")}`,
    "-- ====================================================================",
    "SET NAMES utf8mb4;",
    // Tắt kiểm tra khóa ngoại trong lúc xóa / nạp lại để thứ tự bảng không gây lỗi ràng buộc
    "SET FOREIGN_KEY_CHECKS = 0;",
    "START TRANSACTION;",
    "",
    "DELETE FROM route_stops;",
    "DELETE FROM route_paths;",
    "DELETE FROM bus_stops;",
    "DELETE FROM bus_routes;",
    "",
    sections.join("\n\n"),
    "",
    "COMMIT;",
    "SET FOREIGN_KEY_CHECKS = 1;",
    ""
  ].join("\n");

  fs.writeFileSync(BUSDATA_SQL_FILE, content, "utf8");
  const sizeMb = (Buffer.byteLength(content) / 1024 / 1024).toFixed(1);
  console.log(`>>> Đã xuất ${path.relative(process.cwd(), BUSDATA_SQL_FILE)} (${sizeMb} MB) — ${counts.join(", ")}`);
}

main().catch(err => {
  console.error(">>> Xuất busdata.sql thất bại:", err.message);
  process.exit(1);
});
