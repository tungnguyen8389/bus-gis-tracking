const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const { dbPool } = require("../../config/db");
const { JWT_SECRET } = require("../../config/env");

// Đăng nhập
async function login(req, res) {
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

    // Chỉ tài khoản quản trị (ADMIN/MANAGER) được đăng nhập; bản đồ công khai không cần tài khoản
    if (user.role !== "ADMIN" && user.role !== "MANAGER") {
      return res.status(403).json({ error: "Tài khoản không có quyền truy cập trang quản trị" });
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
}

async function me(req, res) {
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
}

module.exports = { login, me };
