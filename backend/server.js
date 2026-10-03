const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const mysql = require("mysql2/promise");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true, limit: "20mb" }));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

const JWT_SECRET = process.env.JWT_SECRET || "bus_gis_jwt_secret_token_2026_secure";

// --------------------------------------------------------------------
// KẾT NỐI VÀ TỰ ĐỘNG KHỞI TẠO CSDL
// --------------------------------------------------------------------
const dbPool = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "bus_management_db",
  waitForConnections: true,
  connectionLimit: 10,
  multipleStatements: true
});

async function initDatabase() {
  try {
    const rootConn = await mysql.createConnection({
      host: process.env.DB_HOST || "localhost",
      user: process.env.DB_USER || "root",
      password: process.env.DB_PASSWORD || "",
      multipleStatements: true
    });
    
    await rootConn.query(`CREATE DATABASE IF NOT EXISTS \`${process.env.DB_NAME || "bus_management_db"}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`);
    await rootConn.end();

    const conn = await dbPool.getConnection();
    console.log(">>> [Database] Kết nối MySQL Spatial thành công.");

    // Kiểm tra bảng users & schema
    const [tables] = await conn.query("SHOW TABLES LIKE 'users'");
    if (tables.length === 0) {
      console.log(">>> [Database] Đang nạp cấu trúc và dữ liệu ban đầu từ schema.sql...");
      const schemaPath = path.join(__dirname, "../database/schema.sql");
      if (fs.existsSync(schemaPath)) {
        const schemaSql = fs.readFileSync(schemaPath, "utf8");
        await conn.query(schemaSql);
        console.log(">>> [Database] Đã khởi tạo cấu trúc CSDL thành công!");
      }
    }

    // Đảm bảo có tài khoản khách mặc định (role VIEWER)
    try {
      const [khachUsers] = await conn.query("SELECT user_id FROM users WHERE username = 'khach'");
      if (khachUsers.length === 0) {
        const salt = await bcrypt.genSalt(10);
        const khachHash = await bcrypt.hash("khach123", salt);
        await conn.query(
          "INSERT INTO users (username, password_hash, full_name, email, role) VALUES (?, ?, ?, ?, ?)",
          ["khach", khachHash, "Khách Tham Quan", "khach@busgis.vn", "VIEWER"]
        );
        console.log(">>> [Database] Đã tạo tài khoản khách mặc định: khach / khach123 (Role: VIEWER)");
      }

      const [viewerUsers] = await conn.query("SELECT user_id FROM users WHERE username = 'viewer'");
      if (viewerUsers.length === 0) {
        const salt = await bcrypt.genSalt(10);
        const viewerHash = await bcrypt.hash("viewer123", salt);
        await conn.query(
          "INSERT INTO users (username, password_hash, full_name, email, role) VALUES (?, ?, ?, ?, ?)",
          ["viewer", viewerHash, "Người dùng Viewer", "viewer@busgis.vn", "VIEWER"]
        );
      }
    } catch (uErr) {
      console.warn(">>> [Database] Kiểm tra tài khoản người dùng:", uErr.message);
    }
    conn.release();
  } catch (err) {
    console.warn(">>> [Database Cảnh báo] Kiểm tra CSDL:", err.message);
  }
}
initDatabase();

// --------------------------------------------------------------------
// AUTH MIDDLEWARE (JWT & ROLE PERMISSION)
// --------------------------------------------------------------------
function authenticateToken(req, res, next) {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    return res.status(401).json({ error: "Yêu cầu đăng nhập để truy cập tài nguyên" });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: "Token không hợp lệ hoặc đã hết hạn" });
    }
    req.user = user;
    next();
  });
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== "ADMIN") {
    return res.status(403).json({ error: "Chỉ quản trị viên cấp cao (ADMIN) mới có quyền thực hiện thao tác này" });
  }
  next();
}

// --------------------------------------------------------------------
// 1. AUTHENTICATION APIS
// --------------------------------------------------------------------

// Đăng nhập
app.post("/api/v1/auth/login", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: "Vui lòng nhập tên đăng nhập và mật khẩu" });
  }

  try {
    const [users] = await dbPool.query("SELECT * FROM users WHERE username = ?", [username]);
    if (users.length === 0) {
      return res.status(401).json({ error: "Tên đăng nhập hoặc mật khẩu không chính xác" });
    }

    const user = users[0];
    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ error: "Tên đăng nhập hoặc mật khẩu không chính xác" });
    }

    const tokenPayload = {
      user_id: user.user_id,
      username: user.username,
      full_name: user.full_name,
      role: user.role
    };

    const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: "24h" });

    res.json({
      message: "Đăng nhập thành công",
      token,
      user: tokenPayload
    });
  } catch (error) {
    console.error("Lỗi đăng nhập:", error);
    res.status(500).json({ error: "Lỗi hệ thống máy chủ" });
  }
});

// Đăng ký tài khoản mới
app.post("/api/v1/auth/register", async (req, res) => {
  const { username, password, full_name, email, role } = req.body;
  if (!username || !password || !full_name) {
    return res.status(400).json({ error: "Vui lòng điền đầy đủ các thông tin bắt buộc" });
  }

  try {
    const [existing] = await dbPool.query("SELECT user_id FROM users WHERE username = ?", [username]);
    if (existing.length > 0) {
      return res.status(400).json({ error: "Tên đăng nhập đã tồn tại trong hệ thống" });
    }

    const salt = await bcrypt.genSalt(10);
    const password_hash = await bcrypt.hash(password, salt);
    const assignedRole = (role === "ADMIN" || role === "MANAGER" || role === "VIEWER") ? role : "MANAGER";

    const [result] = await dbPool.query(
      "INSERT INTO users (username, password_hash, full_name, email, role) VALUES (?, ?, ?, ?, ?)",
      [username, password_hash, full_name, email || "", assignedRole]
    );

    res.status(201).json({
      message: "Đăng ký tài khoản thành công",
      user_id: result.insertId,
      username,
      full_name,
      role: assignedRole
    });
  } catch (error) {
    console.error("Lỗi đăng ký:", error);
    res.status(500).json({ error: "Lỗi tạo tài khoản" });
  }
});

// Lấy thông tin tài khoản hiện tại
app.get("/api/v1/auth/me", authenticateToken, async (req, res) => {
  try {
    const [users] = await dbPool.query(
      "SELECT user_id, username, full_name, email, role, created_at FROM users WHERE user_id = ?",
      [req.user.user_id]
    );
    if (users.length === 0) {
      return res.status(404).json({ error: "Không tìm thấy người dùng" });
    }
    res.json(users[0]);
  } catch (error) {
    res.status(500).json({ error: "Lỗi kết nối CSDL" });
  }
});

// --------------------------------------------------------------------
// 2. USER MANAGEMENT APIS (ADMIN ONLY)
// --------------------------------------------------------------------

app.get("/api/v1/users", authenticateToken, async (req, res) => {
  try {
    const [rows] = await dbPool.query(
      "SELECT user_id, username, full_name, email, role, created_at FROM users ORDER BY user_id DESC"
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: "Lỗi lấy danh sách người dùng" });
  }
});

app.post("/api/v1/users", authenticateToken, requireAdmin, async (req, res) => {
  const { username, password, full_name, email, role } = req.body;
  if (!username || !password || !full_name) {
    return res.status(400).json({ error: "Thiếu thông tin người dùng bắt buộc" });
  }
  try {
    const salt = await bcrypt.genSalt(10);
    const password_hash = await bcrypt.hash(password, salt);
    await dbPool.query(
      "INSERT INTO users (username, password_hash, full_name, email, role) VALUES (?, ?, ?, ?, ?)",
      [username, password_hash, full_name, email || "", role || "MANAGER"]
    );
    res.status(201).json({ message: "Thêm người dùng thành công" });
  } catch (error) {
    res.status(500).json({ error: "Lỗi thêm người dùng: " + error.message });
  }
});

app.put("/api/v1/users/:id", authenticateToken, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { full_name, email, role, password } = req.body;
  try {
    if (password && password.trim() !== "") {
      const salt = await bcrypt.genSalt(10);
      const password_hash = await bcrypt.hash(password, salt);
      await dbPool.query(
        "UPDATE users SET full_name = ?, email = ?, role = ?, password_hash = ? WHERE user_id = ?",
        [full_name, email, role, password_hash, id]
      );
    } else {
      await dbPool.query(
        "UPDATE users SET full_name = ?, email = ?, role = ? WHERE user_id = ?",
        [full_name, email, role, id]
      );
    }
    res.json({ message: "Cập nhật thông tin người dùng thành công" });
  } catch (error) {
    res.status(500).json({ error: "Lỗi cập nhật người dùng" });
  }
});

app.delete("/api/v1/users/:id", authenticateToken, requireAdmin, async (req, res) => {
  const { id } = req.params;
  if (parseInt(id) === req.user.user_id) {
    return res.status(400).json({ error: "Không thể tự xóa tài khoản đang đăng nhập" });
  }
  try {
    await dbPool.query("DELETE FROM users WHERE user_id = ?", [id]);
    res.json({ message: "Xóa người dùng thành công" });
  } catch (error) {
    res.status(500).json({ error: "Lỗi xóa người dùng" });
  }
});

// --------------------------------------------------------------------
// 3. BUS ROUTES MANAGEMENT APIS
// --------------------------------------------------------------------

// Lấy danh sách tất cả các tuyến kèm số lượng trạm & có lộ trình chưa
app.get("/api/v1/routes", async (req, res) => {
  try {
    const [rows] = await dbPool.query(`
      SELECT r.*, 
             COUNT(DISTINCT rs.stop_id) AS total_stops,
             COUNT(DISTINCT p.path_id) AS total_paths
      FROM bus_routes r
      LEFT JOIN route_stops rs ON r.route_id = rs.route_id
      LEFT JOIN route_paths p ON r.route_id = p.route_id
      GROUP BY r.route_id
      ORDER BY r.route_number ASC
    `);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: "Lỗi lấy danh sách tuyến xe" });
  }
});

app.post("/api/v1/routes", authenticateToken, async (req, res) => {
  const { route_id, route_number, route_name, distance_km, headway_min } = req.body;
  if (!route_id || !route_number || !route_name) {
    return res.status(400).json({ error: "Vui lòng nhập đầy đủ mã tuyến, số hiệu và tên tuyến" });
  }
  try {
    await dbPool.query(
      "INSERT INTO bus_routes (route_id, route_number, route_name, distance_km, headway_min) VALUES (?, ?, ?, ?, ?)",
      [route_id, route_number, route_name, distance_km || 0, headway_min || 15]
    );
    res.status(201).json({ message: "Thêm tuyến xe thành công", route_id });
  } catch (error) {
    res.status(500).json({ error: "Lỗi tạo tuyến xe: " + error.message });
  }
});

app.put("/api/v1/routes/:route_id", authenticateToken, async (req, res) => {
  const { route_id } = req.params;
  const { route_number, route_name, distance_km, headway_min } = req.body;
  try {
    await dbPool.query(
      "UPDATE bus_routes SET route_number = ?, route_name = ?, distance_km = ?, headway_min = ? WHERE route_id = ?",
      [route_number, route_name, distance_km, headway_min, route_id]
    );
    res.json({ message: "Cập nhật thông tin tuyến thành công" });
  } catch (error) {
    res.status(500).json({ error: "Lỗi cập nhật tuyến xe" });
  }
});

app.delete("/api/v1/routes/:route_id", authenticateToken, async (req, res) => {
  const { route_id } = req.params;
  try {
    await dbPool.query("DELETE FROM bus_routes WHERE route_id = ?", [route_id]);
    res.json({ message: "Xóa tuyến xe thành công" });
  } catch (error) {
    res.status(500).json({ error: "Lỗi xóa tuyến xe" });
  }
});

// --------------------------------------------------------------------
// 4. ROUTE PATHS & COORDINATES (TỌA ĐỘ TIM ĐƯỜNG)
// --------------------------------------------------------------------

// Lấy lộ trình tim đường (Polyline) theo route_id dạng GeoJSON
app.get("/api/v1/routes/:route_id/path", async (req, res) => {
  const { route_id } = req.params;
  const direction = req.query.direction || 1;
  try {
    const [rows] = await dbPool.query(
      `SELECT p.path_id, p.route_id, p.direction, r.route_number, r.route_name,
              ST_AsGeoJSON(p.geom) AS geom_json
       FROM route_paths p
       JOIN bus_routes r ON p.route_id = r.route_id
       WHERE p.route_id = ? AND p.direction = ? LIMIT 1`,
      [route_id, direction]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: "Không tìm thấy lộ trình tim đường của tuyến này" });
    }

    const row = rows[0];
    const geojson = {
      type: "Feature",
      geometry: JSON.parse(row.geom_json),
      properties: {
        path_id: row.path_id,
        route_id: row.route_id,
        route_number: row.route_number,
        route_name: row.route_name,
        direction: row.direction
      }
    };
    res.json(geojson);
  } catch (error) {
    res.status(500).json({ error: "Lỗi truy vấn lộ trình tim đường" });
  }
});

// Cập nhật hoặc thêm mới lộ trình tim đường (Coordinates: [[lon, lat], ...])
app.post("/api/v1/routes/:route_id/path", authenticateToken, async (req, res) => {
  const { route_id } = req.params;
  const { direction, coordinates } = req.body; // coordinates: [[lon, lat], [lon, lat], ...]

  if (!coordinates || !Array.isArray(coordinates) || coordinates.length < 2) {
    return res.status(400).json({ error: "Lộ trình cần tối thiểu 2 điểm tọa độ hợp lệ dạng [[lon, lat], ...]" });
  }

  try {
    // Chuyển mảng tọa độ thành chuỗi WKT LINESTRING
    const lineStringWkt = `LINESTRING(${coordinates.map(pt => `${pt[0]} ${pt[1]}`).join(", ")})`;
    const dir = direction ? parseInt(direction) : 1;

    // Xóa lộ trình cũ của chiều này nếu có
    await dbPool.query("DELETE FROM route_paths WHERE route_id = ? AND direction = ?", [route_id, dir]);

    // Thêm lộ trình mới
    await dbPool.query(
      "INSERT INTO route_paths (route_id, direction, geom) VALUES (?, ?, ST_GeomFromText(?, 4326))",
      [route_id, dir, lineStringWkt]
    );

    res.status(201).json({
      message: "Cập nhật lộ trình tọa độ thành công",
      route_id,
      direction: dir,
      points_count: coordinates.length
    });
  } catch (error) {
    console.error("Lỗi lưu lộ trình:", error);
    res.status(500).json({ error: "Lỗi lưu lộ trình vào CSDL: " + error.message });
  }
});

// --------------------------------------------------------------------
// 5. BUS STOPS MANAGEMENT APIS (TRẠM DỪNG XE BUÝT)
// --------------------------------------------------------------------

// Lấy toàn bộ danh sách trạm dừng dạng GeoJSON FeatureCollection
app.get("/api/v1/stops", async (req, res) => {
  try {
    const [rows] = await dbPool.query(
      `SELECT stop_id, stop_name, address, ST_AsGeoJSON(geom) AS geom_json FROM bus_stops`
    );

    const geojson = {
      type: "FeatureCollection",
      features: rows.map(row => {
        const geom = JSON.parse(row.geom_json);
        return {
          type: "Feature",
          geometry: geom,
          properties: {
            stop_id: row.stop_id,
            stop_name: row.stop_name,
            address: row.address,
            longitude: geom.coordinates[0],
            latitude: geom.coordinates[1]
          }
        };
      })
    };
    res.json(geojson);
  } catch (error) {
    res.status(500).json({ error: "Lỗi lấy danh sách trạm dừng" });
  }
});

// Thêm mới trạm xe buýt
app.post("/api/v1/stops", authenticateToken, async (req, res) => {
  const { stop_id, stop_name, address, longitude, latitude } = req.body;
  if (!stop_id || !stop_name || longitude === undefined || latitude === undefined) {
    return res.status(400).json({ error: "Thiếu tham số dữ liệu trạm bắt buộc (Mã, Tên, Kinh độ, Vĩ độ)" });
  }

  try {
    const wktPoint = `POINT(${longitude} ${latitude})`;
    await dbPool.query(
      `INSERT INTO bus_stops (stop_id, stop_name, address, geom)
       VALUES (?, ?, ?, ST_GeomFromText(?, 4326))`,
      [stop_id, stop_name, address || "", wktPoint]
    );
    res.status(201).json({ message: "Thêm trạm thành công", stop_id });
  } catch (error) {
    res.status(500).json({ error: "Lỗi thêm trạm: " + error.message });
  }
});

// Cập nhật trạm xe buýt
app.put("/api/v1/stops/:stop_id", authenticateToken, async (req, res) => {
  const { stop_id } = req.params;
  const { stop_name, address, longitude, latitude } = req.body;

  try {
    if (longitude !== undefined && latitude !== undefined) {
      const wktPoint = `POINT(${longitude} ${latitude})`;
      await dbPool.query(
        `UPDATE bus_stops 
         SET stop_name = ?, address = ?, geom = ST_GeomFromText(?, 4326)
         WHERE stop_id = ?`,
        [stop_name, address || "", wktPoint, stop_id]
      );
    } else {
      await dbPool.query(
        `UPDATE bus_stops SET stop_name = ?, address = ? WHERE stop_id = ?`,
        [stop_name, address || "", stop_id]
      );
    }
    res.json({ message: "Cập nhật trạm dừng thành công" });
  } catch (error) {
    res.status(500).json({ error: "Lỗi cập nhật trạm" });
  }
});

// Xóa trạm dừng
app.delete("/api/v1/stops/:stop_id", authenticateToken, async (req, res) => {
  const { stop_id } = req.params;
  try {
    await dbPool.query("DELETE FROM bus_stops WHERE stop_id = ?", [stop_id]);
    res.json({ message: "Xóa trạm dừng thành công" });
  } catch (error) {
    res.status(500).json({ error: "Lỗi xóa trạm dừng" });
  }
});

// Lấy danh sách trạm thuộc tuyến đường theo thứ tự
app.get("/api/v1/routes/:route_id/stops", async (req, res) => {
  const { route_id } = req.params;
  const direction = req.query.direction || 1;
  try {
    const [rows] = await dbPool.query(`
      SELECT rs.route_id, rs.stop_id, rs.direction, rs.stop_order,
             s.stop_name, s.address, ST_AsGeoJSON(s.geom) AS geom_json
      FROM route_stops rs
      JOIN bus_stops s ON rs.stop_id = s.stop_id
      WHERE rs.route_id = ? AND rs.direction = ?
      ORDER BY rs.stop_order ASC
    `, [route_id, direction]);

    const stops = rows.map(r => {
      const geom = JSON.parse(r.geom_json);
      return {
        ...r,
        longitude: geom.coordinates[0],
        latitude: geom.coordinates[1]
      };
    });
    res.json(stops);
  } catch (error) {
    res.status(500).json({ error: "Lỗi lấy danh sách trạm trên tuyến" });
  }
});

// Gán trạm dừng vào tuyến
app.post("/api/v1/routes/:route_id/stops", authenticateToken, async (req, res) => {
  const { route_id } = req.params;
  const { stop_id, direction, stop_order } = req.body;
  if (!stop_id || !direction || stop_order === undefined) {
    return res.status(400).json({ error: "Thiếu thông tin gán trạm" });
  }
  try {
    await dbPool.query(
      `INSERT INTO route_stops (route_id, stop_id, direction, stop_order)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE stop_id = VALUES(stop_id)`,
      [route_id, stop_id, direction, stop_order]
    );
    res.status(201).json({ message: "Gán trạm vào tuyến thành công" });
  } catch (error) {
    res.status(500).json({ error: "Lỗi gán trạm: " + error.message });
  }
});

// Xóa trạm khỏi tuyến (truyền stop_order để chỉ xóa đúng 1 lượt ghé trên tuyến vòng)
app.delete("/api/v1/routes/:route_id/stops/:stop_id", authenticateToken, async (req, res) => {
  const { route_id, stop_id } = req.params;
  const direction = req.query.direction || 1;
  const { stop_order } = req.query;
  try {
    if (stop_order !== undefined) {
      await dbPool.query(
        "DELETE FROM route_stops WHERE route_id = ? AND stop_id = ? AND direction = ? AND stop_order = ?",
        [route_id, stop_id, direction, stop_order]
      );
    } else {
      await dbPool.query(
        "DELETE FROM route_stops WHERE route_id = ? AND stop_id = ? AND direction = ?",
        [route_id, stop_id, direction]
      );
    }
    res.json({ message: "Đã xóa trạm khỏi tuyến" });
  } catch (error) {
    res.status(500).json({ error: "Lỗi xóa trạm khỏi tuyến" });
  }
});

// --------------------------------------------------------------------
// 6. VEHICLES MANAGEMENT APIS (ĐỘI XE BUÝT & THÔNG TIN ĐIỀU PHỐI)
// --------------------------------------------------------------------

app.get("/api/v1/vehicles", async (req, res) => {
  try {
    const [rows] = await dbPool.query(`
      SELECT v.*, 
             GROUP_CONCAT(DISTINCT CONCAT('Tuyến ', r.route_number, ' - ', r.route_name) SEPARATOR ', ') AS assigned_routes,
             COUNT(s.schedule_id) AS total_trips
      FROM vehicles v
      LEFT JOIN schedules s ON v.vehicle_id = s.vehicle_id
      LEFT JOIN bus_routes r ON s.route_id = r.route_id
      GROUP BY v.vehicle_id
      ORDER BY v.vehicle_id ASC
    `);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: "Lỗi lấy danh sách phương tiện" });
  }
});

app.post("/api/v1/vehicles", authenticateToken, async (req, res) => {
  const { vehicle_id, plate_number, capacity, driver_name, status } = req.body;
  if (!vehicle_id || !plate_number) {
    return res.status(400).json({ error: "Vui lòng nhập Mã xe và Biển số xe" });
  }
  try {
    await dbPool.query(
      "INSERT INTO vehicles (vehicle_id, plate_number, capacity, driver_name, status) VALUES (?, ?, ?, ?, ?)",
      [vehicle_id, plate_number, capacity || 40, driver_name || "", status || "ACTIVE"]
    );
    res.status(201).json({ message: "Thêm phương tiện thành công", vehicle_id });
  } catch (error) {
    res.status(500).json({ error: "Lỗi thêm phương tiện: " + error.message });
  }
});

app.put("/api/v1/vehicles/:vehicle_id", authenticateToken, async (req, res) => {
  const { vehicle_id } = req.params;
  const { plate_number, capacity, driver_name, status } = req.body;
  try {
    await dbPool.query(
      "UPDATE vehicles SET plate_number = ?, capacity = ?, driver_name = ?, status = ? WHERE vehicle_id = ?",
      [plate_number, capacity, driver_name, status, vehicle_id]
    );
    res.json({ message: "Cập nhật phương tiện thành công" });
  } catch (error) {
    res.status(500).json({ error: "Lỗi cập nhật phương tiện" });
  }
});

app.delete("/api/v1/vehicles/:vehicle_id", authenticateToken, async (req, res) => {
  const { vehicle_id } = req.params;
  try {
    await dbPool.query("DELETE FROM vehicles WHERE vehicle_id = ?", [vehicle_id]);
    res.json({ message: "Xóa phương tiện thành công" });
  } catch (error) {
    res.status(500).json({ error: "Lỗi xóa phương tiện" });
  }
});

// --------------------------------------------------------------------
// 7. SCHEDULES & TRIP ASSIGNMENT APIS (PHÂN CÔNG XE CHO CHUYẾN & LỊCH TRÌNH)
// --------------------------------------------------------------------

app.get("/api/v1/schedules", async (req, res) => {
  const { route_id, vehicle_id, direction } = req.query;
  try {
    let query = `
      SELECT s.schedule_id, s.route_id, s.vehicle_id, s.departure_time, s.direction,
             r.route_number, r.route_name, r.headway_min,
             v.plate_number, v.driver_name, v.capacity, v.status AS vehicle_status
      FROM schedules s
      JOIN bus_routes r ON s.route_id = r.route_id
      JOIN vehicles v ON s.vehicle_id = v.vehicle_id
      WHERE 1=1
    `;
    const params = [];
    if (route_id) {
      query += " AND s.route_id = ?";
      params.push(route_id);
    }
    if (vehicle_id) {
      query += " AND s.vehicle_id = ?";
      params.push(vehicle_id);
    }
    if (direction) {
      query += " AND s.direction = ?";
      params.push(direction);
    }
    query += " ORDER BY s.route_id ASC, s.direction ASC, s.departure_time ASC";

    const [rows] = await dbPool.query(query, params);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: "Lỗi lấy danh sách phân công chuyến: " + error.message });
  }
});

app.post("/api/v1/schedules", authenticateToken, async (req, res) => {
  const { route_id, vehicle_id, departure_time, direction } = req.body;
  if (!route_id || !vehicle_id || !departure_time) {
    return res.status(400).json({ error: "Vui lòng chọn Tuyến xe, Phương tiện và Giờ xuất bến" });
  }
  try {
    const [result] = await dbPool.query(
      "INSERT INTO schedules (route_id, vehicle_id, departure_time, direction) VALUES (?, ?, ?, ?)",
      [route_id, vehicle_id, departure_time, direction ? parseInt(direction) : 1]
    );
    res.status(201).json({ message: "Phân công chuyến xe thành công", schedule_id: result.insertId });
  } catch (error) {
    res.status(500).json({ error: "Lỗi phân công chuyến: " + error.message });
  }
});

app.put("/api/v1/schedules/:id", authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { route_id, vehicle_id, departure_time, direction } = req.body;
  if (!route_id || !vehicle_id || !departure_time) {
    return res.status(400).json({ error: "Thiếu thông tin cập nhật chuyến" });
  }
  try {
    await dbPool.query(
      "UPDATE schedules SET route_id = ?, vehicle_id = ?, departure_time = ?, direction = ? WHERE schedule_id = ?",
      [route_id, vehicle_id, departure_time, direction ? parseInt(direction) : 1, id]
    );
    res.json({ message: "Cập nhật chuyến xe thành công" });
  } catch (error) {
    res.status(500).json({ error: "Lỗi cập nhật chuyến: " + error.message });
  }
});

app.delete("/api/v1/schedules/:id", authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    await dbPool.query("DELETE FROM schedules WHERE schedule_id = ?", [id]);
    res.json({ message: "Đã hủy phân công chuyến xe" });
  } catch (error) {
    res.status(500).json({ error: "Lỗi xóa chuyến: " + error.message });
  }
});

// --------------------------------------------------------------------
// 8. DASHBOARD METRICS & STATS
// --------------------------------------------------------------------
app.get("/api/v1/admin/stats", authenticateToken, async (req, res) => {
  try {
    const [[{ count_routes }]] = await dbPool.query("SELECT COUNT(*) AS count_routes FROM bus_routes");
    const [[{ count_stops }]] = await dbPool.query("SELECT COUNT(*) AS count_stops FROM bus_stops");
    const [[{ count_vehicles }]] = await dbPool.query("SELECT COUNT(*) AS count_vehicles FROM vehicles");
    const [[{ count_schedules }]] = await dbPool.query("SELECT COUNT(*) AS count_schedules FROM schedules");
    const [[{ count_users }]] = await dbPool.query("SELECT COUNT(*) AS count_users FROM users");
    const [[{ count_logs }]] = await dbPool.query("SELECT COUNT(*) AS count_logs FROM vehicle_tracking_logs");

    res.json({
      routes: count_routes,
      stops: count_stops,
      vehicles: count_vehicles,
      schedules: count_schedules,
      users: count_users,
      tracking_logs: count_logs,
      server_time: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ error: "Lỗi lấy số liệu thống kê" });
  }
});

// --------------------------------------------------------------------
// 9. BULK JSON IMPORT / EXPORT (CẬP NHẬT TỌA ĐỘ VÀ DỮ LIỆU TỪ JSON)
// Hỗ trợ 100% định dạng từ công cụ trích xuất get_coords_1.html
// --------------------------------------------------------------------

// Import dữ liệu từ JSON string hoặc file upload
app.post("/api/v1/import/json", authenticateToken, async (req, res) => {
  let { type, route_id, direction, data } = req.body;
  if (!data) {
    return res.status(400).json({ error: "Thiếu nội dung data JSON để import" });
  }

  let jsonData = data;
  if (typeof data === "string") {
    try {
      jsonData = JSON.parse(data);
    } catch (e) {
      return res.status(400).json({ error: "Nội dung JSON không đúng định dạng cú pháp: " + e.message });
    }
  }

  // Tự động nhận diện định dạng (Auto-detect) nếu type là 'auto' hoặc chưa chọn
  if (!type || type === "auto") {
    if (jsonData && (jsonData.routeGeometry || (jsonData.stops && Array.isArray(jsonData.stops) && jsonData.stops.length > 0 && jsonData.stops[0].geometry))) {
      type = "full_package";
    } else if (Array.isArray(jsonData) && jsonData.length > 0 && Array.isArray(jsonData[0]) && typeof jsonData[0][0] === "number") {
      type = "route_path";
    } else if (Array.isArray(jsonData) && jsonData.length > 0 && (jsonData[0].coords_arcgis_wgs84 || jsonData[0].coords || jsonData[0].stop_name || jsonData[0].name)) {
      type = "stops";
    } else if (jsonData && jsonData.type === "FeatureCollection") {
      type = "stops";
    } else if (Array.isArray(jsonData) && jsonData.length > 0 && jsonData[0].plate_number) {
      type = "vehicles";
    } else if (Array.isArray(jsonData) && jsonData.length > 0 && jsonData[0].route_number) {
      type = "routes";
    } else if (jsonData && (jsonData.routes || jsonData.vehicles || jsonData.stops)) {
      type = "full_backup";
    } else {
      type = "route_path";
    }
  }

  const conn = await dbPool.getConnection();
  try {
    await conn.beginTransaction();

    let importedCount = 0;
    let extraDetails = {};
    const dir = direction ? parseInt(direction) : 1;

    // A. NHẬP GÓI TRỌN GÓI (FULL PACKAGE TỪ get_coords_1.html: Bao gồm cả Lộ trình + Trạm dừng)
    if (type === "full_package" || type === "fullPackage") {
      let targetRouteId = route_id;
      
      // Nếu chưa chọn route_id trên form, kiểm tra hoặc tự tạo từ routeName trong file
      if (!targetRouteId) {
        if (jsonData.routeName) {
          const cleanName = jsonData.routeName.replace(/_/g, " ");
          const [foundRoutes] = await conn.query(
            "SELECT route_id FROM bus_routes WHERE route_name LIKE ? OR route_id = ?",
            [`%${cleanName}%`, jsonData.routeName]
          );
          if (foundRoutes.length > 0) {
            targetRouteId = foundRoutes[0].route_id;
          } else {
            targetRouteId = "BUS_" + Date.now().toString().slice(-4);
            await conn.query(
              "INSERT INTO bus_routes (route_id, route_number, route_name, distance_km, headway_min) VALUES (?, ?, ?, ?, ?)",
              [targetRouteId, "AUTO", cleanName, 15.0, 10]
            );
          }
        } else {
          throw new Error("Vui lòng chọn Tuyến xe áp dụng để nạp gói dữ liệu trọn gói");
        }
      }

      // 1. Lưu LineString Lộ trình
      let routeCoords = [];
      if (jsonData.routeGeometry && Array.isArray(jsonData.routeGeometry.coordinates)) {
        routeCoords = jsonData.routeGeometry.coordinates;
      } else if (Array.isArray(jsonData.coordinates)) {
        routeCoords = jsonData.coordinates;
      } else if (Array.isArray(jsonData.routeJson)) {
        routeCoords = jsonData.routeJson;
      }

      let pathSaved = 0;
      if (routeCoords && routeCoords.length >= 2) {
        const lineStringWkt = `LINESTRING(${routeCoords.map(pt => `${pt[0]} ${pt[1]}`).join(", ")})`;
        await conn.query("DELETE FROM route_paths WHERE route_id = ? AND direction = ?", [targetRouteId, dir]);
        await conn.query(
          "INSERT INTO route_paths (route_id, direction, geom) VALUES (?, ?, ST_GeomFromText(?, 4326))",
          [targetRouteId, dir, lineStringWkt]
        );
        pathSaved = routeCoords.length;
      }

      // 2. Lưu danh sách Trạm dừng & Gán vào Tuyến
      let stopsList = Array.isArray(jsonData.stops) ? jsonData.stops : [];
      let stopsSaved = 0;

      // Xóa các liên kết trạm cũ của tuyến này theo chiều này để nạp mới chính xác
      await conn.query("DELETE FROM route_stops WHERE route_id = ? AND direction = ?", [targetRouteId, dir]);

      for (let idx = 0; idx < stopsList.length; idx++) {
        const st = stopsList[idx];
        let lon, lat;

        if (st.geometry && Array.isArray(st.geometry.coordinates)) {
          lon = st.geometry.coordinates[0];
          lat = st.geometry.coordinates[1];
        } else if (Array.isArray(st.coords_arcgis_wgs84)) {
          lon = st.coords_arcgis_wgs84[0];
          lat = st.coords_arcgis_wgs84[1];
        } else if (Array.isArray(st.coords)) {
          lon = st.coords[0];
          lat = st.coords[1];
        } else if (st.longitude !== undefined && st.latitude !== undefined) {
          lon = st.longitude;
          lat = st.latitude;
        }

        if (lon !== undefined && lat !== undefined) {
          const stopName = st.name || st.stop_name || `Trạm ${idx + 1}`;
          const stopAddress = st.address || "";
          const stopOrder = st.stt || st.id || st.stop_order || (idx + 1);
          const stopId = st.stop_id || `ST_${targetRouteId.replace(/[^a-zA-Z0-9]/g, "")}_D${dir}_${stopOrder}`;

          const pointWkt = `POINT(${lon} ${lat})`;

          // Thêm / Cập nhật bảng bus_stops
          await conn.query(
            `INSERT INTO bus_stops (stop_id, stop_name, address, geom)
             VALUES (?, ?, ?, ST_GeomFromText(?, 4326))
             ON DUPLICATE KEY UPDATE stop_name = VALUES(stop_name), address = VALUES(address), geom = VALUES(geom)`,
            [stopId, stopName, stopAddress, pointWkt]
          );

          // Gán vào bảng route_stops
          await conn.query(
            `INSERT INTO route_stops (route_id, stop_id, direction, stop_order)
             VALUES (?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE stop_id = VALUES(stop_id)`,
            [targetRouteId, stopId, dir, stopOrder]
          );

          stopsSaved++;
        }
      }

      importedCount = stopsSaved;
      extraDetails = {
        route_id: targetRouteId,
        direction: dir,
        path_points: pathSaved,
        stops_count: stopsSaved
      };
    }

    // B. NHẬP TỌA ĐỘ LỘ TRÌNH TIM ĐƯỜNG (routeJson từ get_coords_1.html hoặc LineString)
    else if (type === "route_path") {
      if (!route_id) {
        throw new Error("Vui lòng chọn Tuyến xe (Route ID) cần cập nhật lộ trình");
      }
      let coords = [];
      if (Array.isArray(jsonData)) {
        coords = jsonData;
      } else if (jsonData.geometry && Array.isArray(jsonData.geometry.coordinates)) {
        coords = jsonData.geometry.coordinates;
      } else if (jsonData.routeGeometry && Array.isArray(jsonData.routeGeometry.coordinates)) {
        coords = jsonData.routeGeometry.coordinates;
      } else if (Array.isArray(jsonData.coordinates)) {
        coords = jsonData.coordinates;
      }

      if (!coords || coords.length < 2) {
        throw new Error("Dữ liệu lộ trình cần tối thiểu 2 cặp tọa độ [lon, lat]");
      }

      const lineStringWkt = `LINESTRING(${coords.map(pt => `${pt[0]} ${pt[1]}`).join(", ")})`;

      await conn.query("DELETE FROM route_paths WHERE route_id = ? AND direction = ?", [route_id, dir]);
      await conn.query(
        "INSERT INTO route_paths (route_id, direction, geom) VALUES (?, ?, ST_GeomFromText(?, 4326))",
        [route_id, dir, lineStringWkt]
      );
      importedCount = coords.length;
      extraDetails = { route_id, direction: dir, points: coords.length };
    }

    // C. NHẬP DANH SÁCH TRẠM DỪNG (stopsJson từ get_coords_1.html hoặc GeoJSON)
    else if (type === "stops") {
      let rawList = [];
      if (jsonData.type === "FeatureCollection" && Array.isArray(jsonData.features)) {
        rawList = jsonData.features.map((f, idx) => ({
          stop_id: f.properties?.stop_id,
          stop_name: f.properties?.stop_name || f.properties?.name || `Trạm ${idx + 1}`,
          address: f.properties?.address || "",
          longitude: f.geometry.coordinates[0],
          latitude: f.geometry.coordinates[1],
          stop_order: f.properties?.stop_order || f.properties?.stt || (idx + 1)
        }));
      } else if (Array.isArray(jsonData)) {
        rawList = jsonData.map((item, idx) => {
          let lon, lat;
          if (Array.isArray(item.coords_arcgis_wgs84)) {
            lon = item.coords_arcgis_wgs84[0];
            lat = item.coords_arcgis_wgs84[1];
          } else if (Array.isArray(item.coords)) {
            lon = item.coords[0];
            lat = item.coords[1];
          } else if (item.geometry && Array.isArray(item.geometry.coordinates)) {
            lon = item.geometry.coordinates[0];
            lat = item.geometry.coordinates[1];
          } else if (item.longitude !== undefined && item.latitude !== undefined) {
            lon = item.longitude;
            lat = item.latitude;
          } else if (Array.isArray(item) && typeof item[0] === "number") {
            lon = item[0];
            lat = item[1];
          }

          return {
            stop_id: item.stop_id,
            stop_name: item.name || item.stop_name || `Trạm ${idx + 1}`,
            address: item.address || "",
            longitude: lon,
            latitude: lat,
            stop_order: item.stt || item.id || item.stop_order || (idx + 1)
          };
        });
      }

      if (route_id) {
        // Xóa liên kết cũ nếu nạp trạm cho tuyến cụ thể
        await conn.query("DELETE FROM route_stops WHERE route_id = ? AND direction = ?", [route_id, dir]);
      }

      for (let idx = 0; idx < rawList.length; idx++) {
        const st = rawList[idx];
        if (st.longitude !== undefined && st.latitude !== undefined) {
          const stopId = st.stop_id || (route_id ? `ST_${route_id.replace(/[^a-zA-Z0-9]/g, "")}_D${dir}_${st.stop_order}` : `ST_IMP_${Date.now()}_${idx + 1}`);
          const wkt = `POINT(${st.longitude} ${st.latitude})`;

          await conn.query(
            `INSERT INTO bus_stops (stop_id, stop_name, address, geom)
             VALUES (?, ?, ?, ST_GeomFromText(?, 4326))
             ON DUPLICATE KEY UPDATE stop_name = VALUES(stop_name), address = VALUES(address), geom = VALUES(geom)`,
            [stopId, st.stop_name, st.address, wkt]
          );

          if (route_id) {
            await conn.query(
              `INSERT INTO route_stops (route_id, stop_id, direction, stop_order)
               VALUES (?, ?, ?, ?)
               ON DUPLICATE KEY UPDATE stop_id = VALUES(stop_id)`,
              [route_id, stopId, dir, st.stop_order]
            );
          }

          importedCount++;
        }
      }
      extraDetails = { route_id: route_id || "GLOBAL", direction: dir, stops_count: importedCount };
    }

    // D. NHẬP DANH SÁCH XE BUÝT (Vehicles)
    else if (type === "vehicles") {
      const list = Array.isArray(jsonData) ? jsonData : [jsonData];
      for (const v of list) {
        if (v.vehicle_id && v.plate_number) {
          await conn.query(
            `INSERT INTO vehicles (vehicle_id, plate_number, capacity, driver_name, status)
             VALUES (?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE plate_number = VALUES(plate_number), capacity = VALUES(capacity), driver_name = VALUES(driver_name), status = VALUES(status)`,
            [v.vehicle_id, v.plate_number, v.capacity || 40, v.driver_name || "", v.status || "ACTIVE"]
          );
          importedCount++;
        }
      }
    }

    // E. NHẬP DANH SÁCH TUYẾN XE (Routes)
    else if (type === "routes") {
      const list = Array.isArray(jsonData) ? jsonData : [jsonData];
      for (const r of list) {
        if (r.route_id && r.route_number && r.route_name) {
          await conn.query(
            `INSERT INTO bus_routes (route_id, route_number, route_name, distance_km, headway_min)
             VALUES (?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE route_number = VALUES(route_number), route_name = VALUES(route_name), distance_km = VALUES(distance_km), headway_min = VALUES(headway_min)`,
            [r.route_id, r.route_number, r.route_name, r.distance_km || 0, r.headway_min || 15]
          );
          importedCount++;
        }
      }
    }

    // F. KHÔI PHỤC TOÀN BỘ (Full Backup)
    else if (type === "full_backup") {
      if (jsonData.routes) {
        for (const r of jsonData.routes) {
          await conn.query(
            `INSERT INTO bus_routes (route_id, route_number, route_name, distance_km, headway_min) VALUES (?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE route_number=VALUES(route_number), route_name=VALUES(route_name)`,
            [r.route_id, r.route_number, r.route_name, r.distance_km || 0, r.headway_min || 15]
          );
        }
      }
      if (jsonData.stops) {
        for (const s of jsonData.stops) {
          const wkt = `POINT(${s.longitude} ${s.latitude})`;
          await conn.query(
            `INSERT INTO bus_stops (stop_id, stop_name, address, geom) VALUES (?, ?, ?, ST_GeomFromText(?, 4326))
             ON DUPLICATE KEY UPDATE stop_name=VALUES(stop_name), address=VALUES(address), geom=VALUES(geom)`,
            [s.stop_id, s.stop_name, s.address, wkt]
          );
        }
      }
      if (jsonData.vehicles) {
        for (const v of jsonData.vehicles) {
          await conn.query(
            `INSERT INTO vehicles (vehicle_id, plate_number, capacity, driver_name, status) VALUES (?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE plate_number=VALUES(plate_number), driver_name=VALUES(driver_name)`,
            [v.vehicle_id, v.plate_number, v.capacity || 40, v.driver_name || "", v.status || "ACTIVE"]
          );
        }
      }
      importedCount = 1;
    } else {
      throw new Error(`Loại dữ liệu import '${type}' không được hỗ trợ`);
    }

    await conn.commit();
    res.json({
      message: `Đã import thành công dữ liệu loại '${type}'`,
      type,
      imported_count: importedCount,
      details: extraDetails
    });
  } catch (error) {
    await conn.rollback();
    console.error("Lỗi Import JSON:", error);
    res.status(500).json({ error: "Lỗi import dữ liệu: " + error.message });
  } finally {
    conn.release();
  }
});

// Xuất dữ liệu hệ thống ra JSON
app.get("/api/v1/export/json", authenticateToken, async (req, res) => {
  const exportType = req.query.type || "all";
  try {
    const exportResult = {};

    if (exportType === "all" || exportType === "routes") {
      const [routes] = await dbPool.query("SELECT * FROM bus_routes");
      exportResult.routes = routes;
    }

    if (exportType === "all" || exportType === "stops") {
      const [stops] = await dbPool.query("SELECT stop_id, stop_name, address, ST_AsGeoJSON(geom) as geom_json FROM bus_stops");
      exportResult.stops = stops.map(s => {
        const geom = JSON.parse(s.geom_json);
        return {
          stop_id: s.stop_id,
          stop_name: s.stop_name,
          address: s.address,
          longitude: geom.coordinates[0],
          latitude: geom.coordinates[1]
        };
      });
    }

    if (exportType === "all" || exportType === "paths") {
      const [paths] = await dbPool.query("SELECT path_id, route_id, direction, ST_AsGeoJSON(geom) as geom_json FROM route_paths");
      exportResult.paths = paths.map(p => ({
        path_id: p.path_id,
        route_id: p.route_id,
        direction: p.direction,
        coordinates: JSON.parse(p.geom_json).coordinates
      }));
    }

    if (exportType === "all" || exportType === "vehicles") {
      const [vehicles] = await dbPool.query("SELECT * FROM vehicles");
      exportResult.vehicles = vehicles;
    }

    res.setHeader("Content-Disposition", `attachment; filename="bus_gis_export_${exportType}_${Date.now()}.json"`);
    res.setHeader("Content-Type", "application/json");
    res.json(exportResult);
  } catch (error) {
    res.status(500).json({ error: "Lỗi xuất dữ liệu JSON" });
  }
});

// --------------------------------------------------------------------
// 10. WEBSOCKET REALTIME BROADCAST HUB
// --------------------------------------------------------------------
io.on("connection", (socket) => {
  // Tiếp nhận gói GPS phát từ simulator
  socket.on("gps_ping", async (gpsData) => {
    // 1. Chuyển tiếp tức thời xuống toàn bộ Map Client đang mở
    io.emit("fleet_location_update", gpsData);

    // 2. Ghi vết lịch sử vào bảng vehicle_tracking_logs (Chạy bất đồng bộ)
    try {
      const wkt = `POINT(${gpsData.longitude} ${gpsData.latitude})`;
      await dbPool.query(
        `INSERT INTO vehicle_tracking_logs (vehicle_id, speed_kmh, heading, geom)
         VALUES (?, ?, ?, ST_GeomFromText(?, 4326))`,
        [gpsData.vehicle_id, gpsData.speed_kmh || 0, gpsData.heading || 0, wkt]
      );
    } catch (err) {
      // Bỏ qua lỗi nhẹ nếu log tạm thời không chèn được
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`>>> Máy chủ Web GIS & Admin Hub đang hoạt động tại: http://localhost:${PORT}`);
});
