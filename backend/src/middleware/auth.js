const jwt = require("jsonwebtoken");
const { JWT_SECRET } = require("../config/env");

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

module.exports = { authenticateToken, requireAdmin };
