// Kết nối CSDL & đường dẫn file dữ liệu dùng chung cho db:export / db:import
const path = require("path");
const mysql = require("mysql2/promise");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

const BUSDATA_SQL_FILE = path.join(__dirname, "../../database/busdata.sql");

function connectDb(options = {}) {
  return mysql.createConnection({
    host: process.env.DB_HOST || "localhost",
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_NAME || "bus_management_db",
    ...options
  });
}

module.exports = { connectDb, BUSDATA_SQL_FILE };
