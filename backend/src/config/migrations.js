// --------------------------------------------------------------------
// MIGRATION CSDL: chạy idempotent lúc khởi động server (và từ script seed)
// --------------------------------------------------------------------

// DB đang chạy có thể tạo từ schema cũ → bổ sung DRIVER & driver_user_id (DDL, chạy ngoài transaction)
async function migrateDriverSchema(conn) {
  const [[roleCol]] = await conn.query(
    `SELECT COLUMN_TYPE AS type FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'role'`
  );
  if (!roleCol.type.includes("'DRIVER'")) {
    await conn.query("ALTER TABLE users MODIFY role ENUM('ADMIN','MANAGER','VIEWER','DRIVER') DEFAULT 'MANAGER'");
    console.log("    + users.role thêm DRIVER");
  }

  const [driverCol] = await conn.query(
    `SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'vehicles' AND COLUMN_NAME = 'driver_user_id'`
  );
  if (driverCol.length === 0) {
    await conn.query(
      `ALTER TABLE vehicles
         ADD COLUMN driver_user_id INT NULL UNIQUE,
         ADD CONSTRAINT fk_vehicles_driver FOREIGN KEY (driver_user_id) REFERENCES users(user_id) ON DELETE SET NULL`
    );
    console.log("    + vehicles.driver_user_id");
  }
}

module.exports = { migrateDriverSchema };
