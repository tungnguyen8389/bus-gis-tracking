// Chỉ mục trạm cho ô "Bạn muốn đến đâu?": tìm theo tên trạm và khớp địa chỉ (không dùng geocode)
import { featureToStop } from "../../../../modules/stops/stops.service.js";

let stopIndex = [];          // Danh sách trạm đã chuẩn hóa để gợi ý điểm đến (khách)
let streetIndex = new Map(); // Tên đường (chuẩn hóa) → các trạm trên đường đó
let streetKeys = [];         // Tên đường sắp xếp dài → ngắn để khớp cụm dài nhất trước

export const getStopIndex = () => stopIndex;

// Bỏ dấu tiếng Việt để "ben thanh" khớp "Bến Thành"
export function normalizeText(value) {
  return String(value || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/\s+/g, " ").trim();
}

// --------------------------------------------------------------------
// KHỚP ĐỊA CHỈ KHÁCH NHẬP VỚI ĐỊA CHỈ TRẠM (không dùng geocode)
// Địa chỉ trạm có dạng "số nhà, tên đường, [phường], quận/huyện"
// --------------------------------------------------------------------
function streetKeyOf(value) {
  return normalizeText(value).replace(/^duong\s+/, "");
}

// "Quận 5" → "5", "Quận Bình Thạnh" → "binh thanh", "TP. Thủ Đức - KV1" → "thu duc"
function districtKeyOf(value) {
  return normalizeText(value)
    .replace(/\s*-\s*kv\d+$/, "")
    .replace(/^(quan|huyen|thanh pho|tp\.?|thi xa|tx\.?)\s*/, "")
    .trim();
}

// Số nhà đầu tiên đứng riêng: "653 (291/8)" → 653, "Đối diện số 235" → 235, "A3/68A" → 68
function houseNumberOf(value) {
  const m = normalizeText(value).match(/(?:^|[^a-z0-9])(\d+)/);
  return m ? Number(m[1]) : null;
}

function parseStopAddress(address) {
  const parts = String(address || "").split(",").map(p => p.trim()).filter(Boolean);
  return {
    houseNumber: parts.length >= 3 ? houseNumberOf(parts[0]) : null,
    streetKey: parts.length >= 3 ? streetKeyOf(parts[1]) : null,
    districtKey: parts.length >= 2 ? districtKeyOf(parts[parts.length - 1]) : null
  };
}

function buildStreetIndex() {
  streetIndex = new Map();
  stopIndex.forEach(st => {
    if (!st.streetKey || st.streetKey.length < 3 || /^\d+$/.test(st.streetKey)) return;
    if (!streetIndex.has(st.streetKey)) streetIndex.set(st.streetKey, []);
    streetIndex.get(st.streetKey).push(st);
  });
  streetKeys = [...streetIndex.keys()].sort((a, b) => b.length - a.length);
}

// Dựng chỉ mục từ GeoJSON FeatureCollection của /stops
export function buildStopIndex(features) {
  stopIndex = features.map(f => ({
    ...featureToStop(f),
    nameKey: normalizeText(f.properties.stop_name),
    searchKey: normalizeText(`${f.properties.stop_name} ${f.properties.address || ""}`),
    ...parseStopAddress(f.properties.address)
  }));
  buildStreetIndex();
}

// "220 Nguyễn Văn Cừ Q5" → các trạm trên Nguyễn Văn Cừ (Quận 5) có số nhà gần 220 nhất
export function findStopsByAddress(input) {
  const query = normalizeText(input)
    .replace(/[,;]/g, " ")
    .replace(/\bq\.?\s*(\d+)\b/g, "quan $1")
    .replace(/\s+/g, " ")
    .trim();
  const padded = ` ${query} `;
  const streetKey = streetKeys.find(key => padded.includes(` ${key} `));
  if (!streetKey) return null;

  const numberMatch = query.match(/^(?:so\s*)?(\d+)/);
  const houseNumber = numberMatch ? Number(numberMatch[1]) : null;

  // Lọc theo quận nếu khách có nhập (cùng tên đường có thể nằm ở nhiều quận, số nhà đánh riêng)
  let candidates = streetIndex.get(streetKey);
  const rest = ` ${padded.replace(` ${streetKey} `, " ").replace(/^\s*(?:so\s*)?\d+\S*/, " ")} `;
  const inDistrict = candidates.filter(st => st.districtKey && (/^\d+$/.test(st.districtKey)
    ? rest.includes(` quan ${st.districtKey} `)
    : rest.includes(` ${st.districtKey} `)));
  if (inDistrict.length > 0) candidates = inDistrict;

  let ranked = houseNumber === null
    ? [...candidates].sort((a, b) => (a.houseNumber ?? Infinity) - (b.houseNumber ?? Infinity))
    : candidates
        .filter(st => st.houseNumber !== null)
        .sort((a, b) => Math.abs(a.houseNumber - houseNumber) - Math.abs(b.houseNumber - houseNumber));

  // Không nhập quận mà đường có ở nhiều quận/tỉnh (VD Lê Lợi Quận 1 và Vũng Tàu): mỗi nơi lấy trạm gần nhất
  if (inDistrict.length === 0 && houseNumber !== null) {
    const seen = new Set();
    ranked = ranked.filter(st => !seen.has(st.districtKey) && seen.add(st.districtKey));
  }
  return { houseNumber, stops: ranked.slice(0, houseNumber === null ? 5 : 3) };
}

// Xếp hạng: tên bắt đầu bằng từ khóa > tên chứa cụm từ khóa > tên chứa đủ các từ > chỉ khớp địa chỉ
export function searchStopsByName(keyword, limit = 20) {
  const tokens = keyword.split(" ");
  const rank = s => s.nameKey.startsWith(keyword) ? 0
    : s.nameKey.includes(keyword) ? 1
    : tokens.every(t => s.nameKey.includes(t)) ? 2 : 3;
  return stopIndex
    .filter(s => tokens.every(t => s.searchKey.includes(t)))
    .map(s => ({ s, r: rank(s) }))
    .sort((a, b) => a.r - b.r || a.s.stop_name.localeCompare(b.s.stop_name, "vi"))
    .slice(0, limit)
    .map(m => m.s);
}
