// --------------------------------------------------------------------
// SIMULATOR — N tài xế ảo đăng nhập thật và phát GPS (công cụ demo, xóa khi triển khai thật)
//   npm start -- --count 10                (driver01..driver10, quy ước tên của db:seed-drivers)
//   npm start -- --drivers driver01,driver05
// --------------------------------------------------------------------
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const { VirtualDriver } = require("./virtual-driver");

function parseUsernames(argv) {
  const get = flag => {
    const i = argv.indexOf(flag);
    if (i >= 0) return argv[i + 1];
    const prefix = flag + "=";
    const eq = argv.find(a => typeof a === "string" && a.startsWith(prefix));
    if (eq) return eq.slice(prefix.length);
    return undefined;
  };
  const list = get("--drivers");
  if (list) return list.split(",").map(s => s.trim()).filter(Boolean);

  // Nhận --count 20, --count=20 hoặc số tự do (do PowerShell/npm có thể chuyển cờ thành '20')
  const countArg = get("--count") ?? argv.find(a => /^\d+$/.test(a));
  const count = Number(countArg ?? 5);
  if (!Number.isInteger(count) || count < 1 || count > 99) throw new Error("--count phải là số nguyên 1..99");
  return Array.from({ length: count }, (_, i) => `driver${String(i + 1).padStart(2, "0")}`);
}

let usernames;
try {
  usernames = parseUsernames(process.argv.slice(2));
} catch (err) {
  console.error(`>>> [Simulator] ${err.message}`);
  process.exit(1);
}

const apiUrl = (process.env.API_URL || "http://localhost:3000").replace(/\/$/, "");
const password = process.env.SIM_DRIVER_PASSWORD || "driver123";

console.log(`>>> [Simulator] ${usernames.length} tài xế ảo → ${apiUrl}`);
const drivers = usernames.map(username => new VirtualDriver({ apiUrl, username, password }));
drivers.forEach(d => d.start());

// Ctrl+C: báo trip:end cho từng xe để bản đồ gỡ xe ngay
process.on("SIGINT", async () => {
  console.log("\n>>> [Simulator] Kết thúc chuyến và thoát...");
  await Promise.all(drivers.map(d => d.stop()));
  process.exit(0);
});
