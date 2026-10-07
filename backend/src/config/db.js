const mysql = require("mysql2/promise");
const fs = require("fs");
const path = require("path");
const { DB } = require("./env");
const { migrateDriverSchema } = require("./migrations");

// --------------------------------------------------------------------
// KẾT NỐI VÀ TỰ ĐỘNG KHỞI TẠO CSDL
// --------------------------------------------------------------------
const dbPool = mysql.createPool({
  host: DB.host,
  user: DB.user,
  password: DB.password,
  database: DB.database,
  waitForConnections: true,
  connectionLimit: 10,
  multipleStatements: true
});

async function initDatabase() {
  try {
    const rootConn = await mysql.createConnection({
      host: DB.host,
      user: DB.user,
      password: DB.password,
      multipleStatements: true
    });

    await rootConn.query(`CREATE DATABASE IF NOT EXISTS \`${DB.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`);
    await rootConn.end();

    const conn = await dbPool.getConnection();
    console.log(">>> [Database] Kết nối MySQL Spatial thành công.");

    // Kiểm tra bảng users & schema
    const [tables] = await conn.query("SHOW TABLES LIKE 'users'");
    if (tables.length === 0) {
      console.log(">>> [Database] Đang nạp cấu trúc và dữ liệu ban đầu từ schema.sql...");
      const schemaPath = path.join(__dirname, "../../../database/schema.sql");
      if (fs.existsSync(schemaPath)) {
        const schemaSql = fs.readFileSync(schemaPath, "utf8");
        await conn.query(schemaSql);
        console.log(">>> [Database] Đã khởi tạo cấu trúc CSDL thành công!");
      }
    }

    // DB tạo từ schema cũ → bổ sung vai trò DRIVER và vehicles.driver_user_id
    try {
      await migrateDriverSchema(conn);
    } finally {
      conn.release();
    }
  } catch (err) {
    console.warn(">>> [Database Cảnh báo] Kiểm tra CSDL:", err.message);
  }
}

module.exports = { dbPool, initDatabase };
