// ====================================================================
// SEED DỮ LIỆU XE BUÝT TP.HCM (database/busdata) VÀO CSDL
// - Xóa toàn bộ dữ liệu tuyến/trạm/xe/lịch hiện có (GIỮ NGUYÊN bảng users)
// - Nạp bus_routes, bus_stops, route_paths, route_stops trong 1 transaction
// - Chạy lại nhiều lần cho cùng kết quả
//
// Chạy: cd backend && npm run seed:busdata
// Yêu cầu: đã áp dụng database/migrations/001_busdata_schema.sql
// ====================================================================
const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

const DATA_DIR = path.join(__dirname, "../../database/busdata");

// Lượt phụ cùng chiều đi của DL01/DL02/DL05 — không nạp (quyết định D1-B)
const SKIPPED_VARIANTS = new Set(["336_2", "371_2", "406_2"]);

const DEFAULT_HEADWAY_MIN = 15;
const CHUNK_SIZE = 500;
const PATH_CHUNK_SIZE = 50;

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), "utf8"));
}

// Bỏ ký tự rác "¿" và khoảng trắng thừa từ nguồn
function cleanText(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).replace(/¿/g, "").trim();
  return text === "" ? null : text;
}

// "10 - 20" -> 10, "60" -> 60, null -> mặc định
function parseHeadwayMin(headway) {
  const match = headway && String(headway).match(/\d+/);
  return match ? parseInt(match[0], 10) : DEFAULT_HEADWAY_MIN;
}

function buildAddress(p) {
  return [p.AddressNo, p.Street, p.Ward, p.Zone].map(cleanText).filter(Boolean).join(", ") || null;
}

// Khử các điểm trùng liên tiếp (sinh đoạn dài 0 m)
function dedupeConsecutive(coords) {
  return coords.filter((c, i) => i === 0 || c[0] !== coords[i - 1][0] || c[1] !== coords[i - 1][1]);
}

function variantKey(routeId, routeVarId) {
  return `${routeId}_${routeVarId}`;
}

function chunk(rows, size) {
  const out = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

// Insert theo lô; geomIndex: vị trí cột hình học (WKT) cần bọc ST_GeomFromText
async function bulkInsert(conn, table, columns, rows, { geomIndex = -1, size = CHUNK_SIZE } = {}) {
  const placeholder = "(" + columns.map((_, i) => (i === geomIndex ? "ST_GeomFromText(?, 4326)" : "?")).join(", ") + ")";
  for (const part of chunk(rows, size)) {
    await conn.query(
      `INSERT INTO ${table} (${columns.join(", ")}) VALUES ${part.map(() => placeholder).join(", ")}`,
      part.flat()
    );
  }
}

function loadSource() {
  const routesJson = readJson("routes.json");
  const stopsGeo = readJson("stops.geojson");
  const routesGeo = readJson("routes.geojson");
  const routeStopsJson = readJson("route_stops.json");

  const routes = routesJson.map(({ route: r }) => [
    String(r.RouteId),
    cleanText(r.RouteNo),
    cleanText(r.RouteName),
    Math.round(r.Distance / 10) / 100, // mét -> km, 2 chữ số thập phân
    parseHeadwayMin(r.Headway),
    cleanText(r.Type),
    cleanText(r.Color),
    cleanText(r.OperationTime),
    cleanText(r.Headway)
  ]);

  const stops = stopsGeo.features.map(({ properties: p, geometry: g }) => [
    String(p.StopId),
    cleanText(p.Code),
    cleanText(p.Name),
    buildAddress(p),
    cleanText(p.StopType),
    cleanText(p.Status) || "Đang khai thác",
    `POINT(${g.coordinates[0]} ${g.coordinates[1]})`
  ]);

  // Chiều của từng lượt: Outbound = true -> 1 (Đi), false -> 2 (Về)
  const directionByVariant = new Map();
  for (const { variants } of routesJson) {
    for (const { var: v } of variants) {
      directionByVariant.set(variantKey(v.RouteId, v.RouteVarId), v.Outbound ? 1 : 2);
    }
  }

  const paths = [];
  let removedPoints = 0;
  for (const { properties: p, geometry: g } of routesGeo.features) {
    const key = variantKey(p.RouteId, p.RouteVarId);
    if (SKIPPED_VARIANTS.has(key)) continue;
    const coords = dedupeConsecutive(g.coordinates);
    removedPoints += g.coordinates.length - coords.length;
    paths.push([
      String(p.RouteId),
      p.Outbound ? 1 : 2,
      `LINESTRING(${coords.map(c => `${c[0]} ${c[1]}`).join(", ")})`
    ]);
  }

  const routeStops = [];
  for (const [key, stopIds] of Object.entries(routeStopsJson)) {
    if (SKIPPED_VARIANTS.has(key)) continue;
    const routeId = key.split("_")[0];
    const direction = directionByVariant.get(key);
    stopIds.forEach((stopId, idx) => routeStops.push([routeId, String(stopId), direction, idx + 1]));
  }

  return { routes, stops, paths, routeStops, removedPoints };
}

async function main() {
  const data = loadSource();
  console.log(
    `>>> Nguồn: ${data.routes.length} tuyến, ${data.stops.length} trạm, ${data.paths.length} lộ trình ` +
    `(khử ${data.removedPoints} điểm trùng), ${data.routeStops.length} liên kết trạm-tuyến`
  );

  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || "localhost",
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_NAME || "bus_management_db"
  });

  try {
    await conn.beginTransaction();

    // Xóa theo thứ tự phụ thuộc khóa ngoại; giữ nguyên bảng users
    for (const table of ["vehicle_tracking_logs", "schedules", "vehicles", "route_stops", "route_paths", "bus_stops", "bus_routes"]) {
      const [result] = await conn.query(`DELETE FROM ${table}`);
      console.log(`    - Xóa ${table}: ${result.affectedRows} dòng`);
    }

    await bulkInsert(conn, "bus_routes",
      ["route_id", "route_number", "route_name", "distance_km", "headway_min", "route_type", "color", "operation_time", "headway_text"],
      data.routes);
    await bulkInsert(conn, "bus_stops",
      ["stop_id", "stop_code", "stop_name", "address", "stop_type", "status", "geom"],
      data.stops, { geomIndex: 6 });
    await bulkInsert(conn, "route_paths",
      ["route_id", "direction", "geom"],
      data.paths, { geomIndex: 2, size: PATH_CHUNK_SIZE });
    await bulkInsert(conn, "route_stops",
      ["route_id", "stop_id", "direction", "stop_order"],
      data.routeStops);

    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  }

  // Đối chiếu số lượng sau khi nạp
  const expected = {
    bus_routes: data.routes.length,
    bus_stops: data.stops.length,
    route_paths: data.paths.length,
    route_stops: data.routeStops.length
  };
  let ok = true;
  for (const [table, count] of Object.entries(expected)) {
    const [[row]] = await conn.query(`SELECT COUNT(*) AS n FROM ${table}`);
    const match = row.n === count;
    ok = ok && match;
    console.log(`    ${match ? "✔" : "✘"} ${table}: ${row.n} / ${count}`);
  }
  await conn.end();

  if (!ok) throw new Error("Số lượng sau khi nạp không khớp nguồn");
  console.log(">>> Seed busdata thành công.");
}

main().catch(err => {
  console.error(">>> Seed busdata thất bại:", err.message);
  process.exit(1);
});
