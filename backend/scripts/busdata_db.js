// Cấu hình CSDL & đường dẫn file dùng chung cho db:export, db:import
const path = require("path");
const mysql = require("mysql2/promise");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

const DATABASE_DIR = path.join(__dirname, "../../database");
const BUSDATA_SQL_FILE = path.join(DATABASE_DIR, "busdata.sql");
const SCHEMA_SQL_FILE = path.join(DATABASE_DIR, "schema.sql");

const DB_CONFIG = {
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "bus_management_db"
};

function connectDb(options = {}) {
  return mysql.createConnection({ ...DB_CONFIG, ...options });
}

// Tạo database (nếu chưa có) rồi kết nối vào
async function connectDbCreatingIfMissing(options = {}) {
  const { database, ...serverConfig } = DB_CONFIG;
  const root = await mysql.createConnection(serverConfig);
  await root.query(`CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await root.end();
  return connectDb(options);
}

module.exports = { DB_CONFIG, connectDb, connectDbCreatingIfMissing, BUSDATA_SQL_FILE, SCHEMA_SQL_FILE };
