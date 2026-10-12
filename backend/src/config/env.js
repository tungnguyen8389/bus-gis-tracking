require("dotenv").config();

module.exports = {
  PORT: process.env.PORT || 3000,
  JWT_SECRET: process.env.JWT_SECRET || "bus_gis_jwt_secret_token_2026_secure",
  // Danh sách origin được phép gọi API/socket từ nơi khác, phân tách bằng dấu phẩy; null = chỉ cùng origin
  CORS_ORIGIN: process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(",").map(s => s.trim()).filter(Boolean)
    : null,
  DB: {
    host: process.env.DB_HOST || "localhost",
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_NAME || "bus_management_db"
  }
};
