const test = require("node:test");
const assert = require("node:assert/strict");
const { haversineM, buildLine, project, stopProgress } = require("./route-geometry");

const LAT = 10.8;
const A = [106.70, LAT], B = [106.72, LAT], C = [106.74, LAT];
const near = (actual, expected, tol = 5) =>
  assert.ok(Math.abs(actual - expected) <= tol, `${actual} không gần ${expected} (±${tol})`);

test("buildLine: < 2 điểm hợp lệ → null", () => {
  assert.equal(buildLine([]), null);
  assert.equal(buildLine([A]), null);
  assert.equal(buildLine([A, [NaN, 1]]), null);
});

test("buildLine: quãng đường tích lũy theo haversine", () => {
  const line = buildLine([A, B, C]);
  near(line.cum[1], haversineM(A, B), 0.001);
  near(line.total, haversineM(A, B) + haversineM(B, C), 0.001);
});

test("project: điểm lệch khỏi đường chiếu về giữa đoạn", () => {
  const line = buildLine([A, C]);
  near(project(line, [106.71, LAT + 0.001]), haversineM(A, [106.71, LAT]));
});

test("project: điểm trước đầu tuyến → 0, sau cuối tuyến → total", () => {
  const line = buildLine([A, C]);
  near(project(line, [106.69, LAT]), 0);
  near(project(line, [106.75, LAT]), line.total);
});

test("project với fromM: chỉ tìm từ fromM trở đi (tuyến vòng đi rồi về)", () => {
  const line = buildLine([A, C, A]);
  near(project(line, A), 0);
  near(project(line, A, line.total / 2), line.total);
  // fromM nằm giữa đoạn: hình chiếu không lùi về trước fromM
  near(project(line, A, 1000), line.total);
});

test("stopProgress: tuyến vòng ghé A hai lần → giữ lần đầu, trạm sau tìm tiếp về phía trước", () => {
  const line = buildLine([A, C, A]);
  const stops = [
    { stop_id: "A", longitude: A[0], latitude: A[1] },
    { stop_id: "B", longitude: B[0], latitude: B[1] },
    { stop_id: "C", longitude: C[0], latitude: C[1] },
    { stop_id: "B2", longitude: B[0], latitude: B[1] },
    { stop_id: "A", longitude: A[0], latitude: A[1] }
  ];
  const m = stopProgress(line, stops);
  near(m.get("A"), 0);
  near(m.get("B"), haversineM(A, B));
  near(m.get("C"), line.total / 2);
  near(m.get("B2"), line.total / 2 + haversineM(C, B));
});
