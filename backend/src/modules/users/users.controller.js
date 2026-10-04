const bcrypt = require("bcryptjs");
const { dbPool } = require("../../config/db");

// Vai trò được phép gán qua trang quản trị (VIEWER không đăng nhập được nên không cấp)
const ALLOWED_ROLES = ["ADMIN", "MANAGER", "DRIVER"];

async function listUsers(req, res) {
  try {
    const [rows] = await dbPool.query(
      "SELECT user_id, username, full_name, email, role, created_at FROM users ORDER BY user_id DESC"
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: "Lỗi lấy danh sách người dùng" });
  }
}

async function createUser(req, res) {
  const { username, password, full_name, email, role } = req.body;
  if (!username || !password || !full_name) {
    return res.status(400).json({ error: "Thiếu thông tin người dùng bắt buộc" });
  }
  const finalRole = role || "MANAGER";
  if (!ALLOWED_ROLES.includes(finalRole)) {
    return res.status(400).json({ error: "Vai trò không hợp lệ" });
  }
  try {
    const salt = await bcrypt.genSalt(10);
    const password_hash = await bcrypt.hash(password, salt);
    await dbPool.query(
      "INSERT INTO users (username, password_hash, full_name, email, role) VALUES (?, ?, ?, ?, ?)",
      [username, password_hash, full_name, email || "", finalRole]
    );
    res.status(201).json({ message: "Thêm người dùng thành công" });
  } catch (error) {
    res.status(500).json({ error: "Lỗi thêm người dùng: " + error.message });
  }
}

async function updateUser(req, res) {
  const { id } = req.params;
  const { full_name, email, role, password } = req.body;
  if (!ALLOWED_ROLES.includes(role)) {
    return res.status(400).json({ error: "Vai trò không hợp lệ" });
  }
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
}

async function deleteUser(req, res) {
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
}

module.exports = { listUsers, createUser, updateUser, deleteUser };
