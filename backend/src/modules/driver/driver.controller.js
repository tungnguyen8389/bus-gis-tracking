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
