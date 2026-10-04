import test from "node:test";
import assert from "node:assert/strict";
import { nextStop, distanceAlongPath } from "./next-stop.js";

// Lộ trình thẳng hướng đông ở vĩ độ 10°: A (đầu) – B (giữa) – C (cuối), mỗi đoạn 0.01° ≈ 1096 m
const PATH = [[106.0, 10.0], [106.01, 10.0], [106.02, 10.0]];
const A = { stop_id: "A", stop_name: "Trạm A", stop_order: 1, longitude: 106.0, latitude: 10.0 };
const B = { stop_id: "B", stop_name: "Trạm B", stop_order: 2, longitude: 106.01, latitude: 10.0 };
const C = { stop_id: "C", stop_name: "Trạm C", stop_order: 3, longitude: 106.02, latitude: 10.0 };
const STOPS = [A, B, C];
const SEG_M = 0.01 * 111320 * Math.cos(10 * Math.PI / 180);
const near = (a, b, eps = 5) => Math.abs(a - b) <= eps;

test("distanceAlongPath: điểm giữa đoạn đầu ≈ nửa đoạn", () => {
  assert.ok(near(distanceAlongPath(PATH, [106.005, 10.0]), SEG_M / 2));
});

test("xe ở đầu tuyến (tại trạm A) → trạm kế là B", () => {
  const r = nextStop([106.0, 10.0], PATH, STOPS);
  assert.equal(r.stop.stop_id, "B");
  assert.ok(near(r.distanceMeters, SEG_M));
});

test("xe giữa A và B → B, còn ~nửa đoạn", () => {
  const r = nextStop([106.005, 10.0001], PATH, STOPS);
  assert.equal(r.stop.stop_id, "B");
  assert.ok(near(r.distanceMeters, SEG_M / 2));
});

test("xe vừa qua B → C", () => {
  assert.equal(nextStop([106.0102, 10.0], PATH, STOPS).stop.stop_id, "C");
});

test("xe sau trạm cuối → null", () => {
  assert.equal(nextStop([106.02, 10.0], PATH, STOPS), null);
});

test("danh sách trạm lộn xộn vẫn chọn theo stop_order", () => {
  assert.equal(nextStop([106.0, 10.0], PATH, [C, B, A]).stop.stop_id, "B");
});

test("thiếu dữ liệu → null", () => {
  assert.equal(nextStop([106.0, 10.0], PATH, []), null);
  assert.equal(nextStop([106.0, 10.0], [[106.0, 10.0]], STOPS), null);
});
