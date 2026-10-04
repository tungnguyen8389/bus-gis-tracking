const { dbPool } = require("../../config/db");

// --------------------------------------------------------------------
// BULK JSON IMPORT / EXPORT (CẬP NHẬT TỌA ĐỘ VÀ DỮ LIỆU TỪ JSON)
// Hỗ trợ 100% định dạng từ công cụ trích xuất get_coords_1.html
// --------------------------------------------------------------------

// Import dữ liệu từ JSON string hoặc file upload
async function importJson(req, res) {
  let { type, route_id, direction, data } = req.body;
  if (!data) {
    return res.status(400).json({ error: "Thiếu nội dung data JSON để import" });
  }

  let jsonData = data;
  if (typeof data === "string") {
    try {
      jsonData = JSON.parse(data);
    } catch (e) {
      return res.status(400).json({ error: "Nội dung JSON không đúng định dạng cú pháp: " + e.message });
    }
  }

  // Tự động nhận diện định dạng (Auto-detect) nếu type là 'auto' hoặc chưa chọn
  if (!type || type === "auto") {
    if (jsonData && (jsonData.routeGeometry || (jsonData.stops && Array.isArray(jsonData.stops) && jsonData.stops.length > 0 && jsonData.stops[0].geometry))) {
      type = "full_package";
    } else if (Array.isArray(jsonData) && jsonData.length > 0 && Array.isArray(jsonData[0]) && typeof jsonData[0][0] === "number") {
      type = "route_path";
    } else if (Array.isArray(jsonData) && jsonData.length > 0 && (jsonData[0].coords_arcgis_wgs84 || jsonData[0].coords || jsonData[0].stop_name || jsonData[0].name)) {
      type = "stops";
    } else if (jsonData && jsonData.type === "FeatureCollection") {
      type = "stops";
    } else if (Array.isArray(jsonData) && jsonData.length > 0 && jsonData[0].plate_number) {
      type = "vehicles";
    } else if (Array.isArray(jsonData) && jsonData.length > 0 && jsonData[0].route_number) {
      type = "routes";
    } else if (jsonData && (jsonData.routes || jsonData.vehicles || jsonData.stops)) {
      type = "full_backup";
    } else {
      type = "route_path";
    }
  }

  const conn = await dbPool.getConnection();
  try {
    await conn.beginTransaction();

    let importedCount = 0;
    let extraDetails = {};
    const dir = direction ? parseInt(direction) : 1;

    // A. NHẬP GÓI TRỌN GÓI (FULL PACKAGE TỪ get_coords_1.html: Bao gồm cả Lộ trình + Trạm dừng)
    if (type === "full_package" || type === "fullPackage") {
      let targetRouteId = route_id;
      
      // Nếu chưa chọn route_id trên form, kiểm tra hoặc tự tạo từ routeName trong file
      if (!targetRouteId) {
        if (jsonData.routeName) {
          const cleanName = jsonData.routeName.replace(/_/g, " ");
          const [foundRoutes] = await conn.query(
            "SELECT route_id FROM bus_routes WHERE route_name LIKE ? OR route_id = ?",
            [`%${cleanName}%`, jsonData.routeName]
          );
          if (foundRoutes.length > 0) {
            targetRouteId = foundRoutes[0].route_id;
          } else {
            targetRouteId = "BUS_" + Date.now().toString().slice(-4);
            await conn.query(
              "INSERT INTO bus_routes (route_id, route_number, route_name, distance_km, headway_min) VALUES (?, ?, ?, ?, ?)",
              [targetRouteId, "AUTO", cleanName, 15.0, 10]
            );
          }
        } else {
          throw new Error("Vui lòng chọn Tuyến xe áp dụng để nạp gói dữ liệu trọn gói");
        }
      }

      // 1. Lưu LineString Lộ trình
      let routeCoords = [];
      if (jsonData.routeGeometry && Array.isArray(jsonData.routeGeometry.coordinates)) {
        routeCoords = jsonData.routeGeometry.coordinates;
      } else if (Array.isArray(jsonData.coordinates)) {
        routeCoords = jsonData.coordinates;
      } else if (Array.isArray(jsonData.routeJson)) {
        routeCoords = jsonData.routeJson;
      }

      let pathSaved = 0;
      if (routeCoords && routeCoords.length >= 2) {
        const lineStringWkt = `LINESTRING(${routeCoords.map(pt => `${pt[0]} ${pt[1]}`).join(", ")})`;
        await conn.query("DELETE FROM route_paths WHERE route_id = ? AND direction = ?", [targetRouteId, dir]);
        await conn.query(
          "INSERT INTO route_paths (route_id, direction, geom) VALUES (?, ?, ST_GeomFromText(?, 4326))",
          [targetRouteId, dir, lineStringWkt]
        );
        pathSaved = routeCoords.length;
      }

      // 2. Lưu danh sách Trạm dừng & Gán vào Tuyến
      let stopsList = Array.isArray(jsonData.stops) ? jsonData.stops : [];
      let stopsSaved = 0;

      // Xóa các liên kết trạm cũ của tuyến này theo chiều này để nạp mới chính xác
      await conn.query("DELETE FROM route_stops WHERE route_id = ? AND direction = ?", [targetRouteId, dir]);

      for (let idx = 0; idx < stopsList.length; idx++) {
        const st = stopsList[idx];
        let lon, lat;

        if (st.geometry && Array.isArray(st.geometry.coordinates)) {
          lon = st.geometry.coordinates[0];
          lat = st.geometry.coordinates[1];
        } else if (Array.isArray(st.coords_arcgis_wgs84)) {
          lon = st.coords_arcgis_wgs84[0];
          lat = st.coords_arcgis_wgs84[1];
        } else if (Array.isArray(st.coords)) {
          lon = st.coords[0];
          lat = st.coords[1];
        } else if (st.longitude !== undefined && st.latitude !== undefined) {
          lon = st.longitude;
          lat = st.latitude;
        }

        if (lon !== undefined && lat !== undefined) {
          const stopName = st.name || st.stop_name || `Trạm ${idx + 1}`;
          const stopAddress = st.address || "";
          const stopOrder = st.stt || st.id || st.stop_order || (idx + 1);
          const stopId = st.stop_id || `ST_${targetRouteId.replace(/[^a-zA-Z0-9]/g, "")}_D${dir}_${stopOrder}`;

          const pointWkt = `POINT(${lon} ${lat})`;

          // Thêm / Cập nhật bảng bus_stops
          await conn.query(
            `INSERT INTO bus_stops (stop_id, stop_name, address, geom)
             VALUES (?, ?, ?, ST_GeomFromText(?, 4326))
             ON DUPLICATE KEY UPDATE stop_name = VALUES(stop_name), address = VALUES(address), geom = VALUES(geom)`,
            [stopId, stopName, stopAddress, pointWkt]
          );

          // Gán vào bảng route_stops
          await conn.query(
            `INSERT INTO route_stops (route_id, stop_id, direction, stop_order)
             VALUES (?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE stop_id = VALUES(stop_id)`,
            [targetRouteId, stopId, dir, stopOrder]
          );

          stopsSaved++;
        }
      }

      importedCount = stopsSaved;
      extraDetails = {
        route_id: targetRouteId,
        direction: dir,
        path_points: pathSaved,
        stops_count: stopsSaved
      };
    }

    // B. NHẬP TỌA ĐỘ LỘ TRÌNH TIM ĐƯỜNG (routeJson từ get_coords_1.html hoặc LineString)
    else if (type === "route_path") {
      if (!route_id) {
        throw new Error("Vui lòng chọn Tuyến xe (Route ID) cần cập nhật lộ trình");
      }
      let coords = [];
      if (Array.isArray(jsonData)) {
        coords = jsonData;
      } else if (jsonData.geometry && Array.isArray(jsonData.geometry.coordinates)) {
        coords = jsonData.geometry.coordinates;
      } else if (jsonData.routeGeometry && Array.isArray(jsonData.routeGeometry.coordinates)) {
        coords = jsonData.routeGeometry.coordinates;
      } else if (Array.isArray(jsonData.coordinates)) {
        coords = jsonData.coordinates;
      }

      if (!coords || coords.length < 2) {
        throw new Error("Dữ liệu lộ trình cần tối thiểu 2 cặp tọa độ [lon, lat]");
      }

      const lineStringWkt = `LINESTRING(${coords.map(pt => `${pt[0]} ${pt[1]}`).join(", ")})`;

      await conn.query("DELETE FROM route_paths WHERE route_id = ? AND direction = ?", [route_id, dir]);
      await conn.query(
        "INSERT INTO route_paths (route_id, direction, geom) VALUES (?, ?, ST_GeomFromText(?, 4326))",
        [route_id, dir, lineStringWkt]
      );
      importedCount = coords.length;
      extraDetails = { route_id, direction: dir, points: coords.length };
    }

    // C. NHẬP DANH SÁCH TRẠM DỪNG (stopsJson từ get_coords_1.html hoặc GeoJSON)
    else if (type === "stops") {
      let rawList = [];
      if (jsonData.type === "FeatureCollection" && Array.isArray(jsonData.features)) {
        rawList = jsonData.features.map((f, idx) => ({
          stop_id: f.properties?.stop_id,
          stop_name: f.properties?.stop_name || f.properties?.name || `Trạm ${idx + 1}`,
          address: f.properties?.address || "",
          longitude: f.geometry.coordinates[0],
          latitude: f.geometry.coordinates[1],
          stop_order: f.properties?.stop_order || f.properties?.stt || (idx + 1)
        }));
      } else if (Array.isArray(jsonData)) {
        rawList = jsonData.map((item, idx) => {
          let lon, lat;
          if (Array.isArray(item.coords_arcgis_wgs84)) {
            lon = item.coords_arcgis_wgs84[0];
            lat = item.coords_arcgis_wgs84[1];
          } else if (Array.isArray(item.coords)) {
            lon = item.coords[0];
            lat = item.coords[1];
          } else if (item.geometry && Array.isArray(item.geometry.coordinates)) {
            lon = item.geometry.coordinates[0];
            lat = item.geometry.coordinates[1];
          } else if (item.longitude !== undefined && item.latitude !== undefined) {
            lon = item.longitude;
            lat = item.latitude;
          } else if (Array.isArray(item) && typeof item[0] === "number") {
            lon = item[0];
            lat = item[1];
          }

          return {
            stop_id: item.stop_id,
            stop_name: item.name || item.stop_name || `Trạm ${idx + 1}`,
            address: item.address || "",
            longitude: lon,
            latitude: lat,
            stop_order: item.stt || item.id || item.stop_order || (idx + 1)
          };
        });
      }

      if (route_id) {
        // Xóa liên kết cũ nếu nạp trạm cho tuyến cụ thể
        await conn.query("DELETE FROM route_stops WHERE route_id = ? AND direction = ?", [route_id, dir]);
      }

      for (let idx = 0; idx < rawList.length; idx++) {
        const st = rawList[idx];
        if (st.longitude !== undefined && st.latitude !== undefined) {
          const stopId = st.stop_id || (route_id ? `ST_${route_id.replace(/[^a-zA-Z0-9]/g, "")}_D${dir}_${st.stop_order}` : `ST_IMP_${Date.now()}_${idx + 1}`);
          const wkt = `POINT(${st.longitude} ${st.latitude})`;

          await conn.query(
            `INSERT INTO bus_stops (stop_id, stop_name, address, geom)
             VALUES (?, ?, ?, ST_GeomFromText(?, 4326))
             ON DUPLICATE KEY UPDATE stop_name = VALUES(stop_name), address = VALUES(address), geom = VALUES(geom)`,
            [stopId, st.stop_name, st.address, wkt]
          );

          if (route_id) {
            await conn.query(
              `INSERT INTO route_stops (route_id, stop_id, direction, stop_order)
               VALUES (?, ?, ?, ?)
               ON DUPLICATE KEY UPDATE stop_id = VALUES(stop_id)`,
              [route_id, stopId, dir, st.stop_order]
            );
          }

          importedCount++;
        }
      }
      extraDetails = { route_id: route_id || "GLOBAL", direction: dir, stops_count: importedCount };
    }

    // D. NHẬP DANH SÁCH XE BUÝT (Vehicles)
    else if (type === "vehicles") {
      const list = Array.isArray(jsonData) ? jsonData : [jsonData];
      for (const v of list) {
        if (v.vehicle_id && v.plate_number) {
          await conn.query(
            `INSERT INTO vehicles (vehicle_id, plate_number, capacity, driver_name, status)
             VALUES (?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE plate_number = VALUES(plate_number), capacity = VALUES(capacity), driver_name = VALUES(driver_name), status = VALUES(status)`,
            [v.vehicle_id, v.plate_number, v.capacity || 40, v.driver_name || "", v.status || "ACTIVE"]
          );
          importedCount++;
        }
      }
    }

    // E. NHẬP DANH SÁCH TUYẾN XE (Routes)
    else if (type === "routes") {
      const list = Array.isArray(jsonData) ? jsonData : [jsonData];
      for (const r of list) {
        if (r.route_id && r.route_number && r.route_name) {
          await conn.query(
            `INSERT INTO bus_routes (route_id, route_number, route_name, distance_km, headway_min)
             VALUES (?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE route_number = VALUES(route_number), route_name = VALUES(route_name), distance_km = VALUES(distance_km), headway_min = VALUES(headway_min)`,
            [r.route_id, r.route_number, r.route_name, r.distance_km || 0, r.headway_min || 15]
          );
          importedCount++;
        }
      }
    }

    // F. KHÔI PHỤC TOÀN BỘ (Full Backup)
    else if (type === "full_backup") {
      if (jsonData.routes) {
        for (const r of jsonData.routes) {
          await conn.query(
            `INSERT INTO bus_routes (route_id, route_number, route_name, distance_km, headway_min) VALUES (?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE route_number=VALUES(route_number), route_name=VALUES(route_name)`,
            [r.route_id, r.route_number, r.route_name, r.distance_km || 0, r.headway_min || 15]
          );
        }
      }
      if (jsonData.stops) {
        for (const s of jsonData.stops) {
          const wkt = `POINT(${s.longitude} ${s.latitude})`;
          await conn.query(
            `INSERT INTO bus_stops (stop_id, stop_name, address, geom) VALUES (?, ?, ?, ST_GeomFromText(?, 4326))
             ON DUPLICATE KEY UPDATE stop_name=VALUES(stop_name), address=VALUES(address), geom=VALUES(geom)`,
            [s.stop_id, s.stop_name, s.address, wkt]
          );
        }
      }
      if (jsonData.vehicles) {
        for (const v of jsonData.vehicles) {
          await conn.query(
            `INSERT INTO vehicles (vehicle_id, plate_number, capacity, driver_name, status) VALUES (?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE plate_number=VALUES(plate_number), driver_name=VALUES(driver_name)`,
            [v.vehicle_id, v.plate_number, v.capacity || 40, v.driver_name || "", v.status || "ACTIVE"]
          );
        }
      }
      importedCount = 1;
    } else {
      throw new Error(`Loại dữ liệu import '${type}' không được hỗ trợ`);
    }

    await conn.commit();
    res.json({
      message: `Đã import thành công dữ liệu loại '${type}'`,
      type,
      imported_count: importedCount,
      details: extraDetails
    });
  } catch (error) {
    await conn.rollback();
    console.error("Lỗi Import JSON:", error);
    res.status(500).json({ error: "Lỗi import dữ liệu: " + error.message });
  } finally {
    conn.release();
  }
}

// Xuất dữ liệu hệ thống ra JSON
async function exportJson(req, res) {
  const exportType = req.query.type || "all";
  try {
    const exportResult = {};

    if (exportType === "all" || exportType === "routes") {
      const [routes] = await dbPool.query("SELECT * FROM bus_routes");
      exportResult.routes = routes;
    }

    if (exportType === "all" || exportType === "stops") {
      const [stops] = await dbPool.query("SELECT stop_id, stop_name, address, ST_AsGeoJSON(geom) as geom_json FROM bus_stops");
      exportResult.stops = stops.map(s => {
        const geom = JSON.parse(s.geom_json);
        return {
          stop_id: s.stop_id,
          stop_name: s.stop_name,
          address: s.address,
          longitude: geom.coordinates[0],
          latitude: geom.coordinates[1]
        };
      });
    }

    if (exportType === "all" || exportType === "paths") {
      const [paths] = await dbPool.query("SELECT path_id, route_id, direction, ST_AsGeoJSON(geom) as geom_json FROM route_paths");
      exportResult.paths = paths.map(p => ({
        path_id: p.path_id,
        route_id: p.route_id,
        direction: p.direction,
        coordinates: JSON.parse(p.geom_json).coordinates
      }));
    }

    if (exportType === "all" || exportType === "vehicles") {
      const [vehicles] = await dbPool.query("SELECT * FROM vehicles");
      exportResult.vehicles = vehicles;
    }

    res.setHeader("Content-Disposition", `attachment; filename="bus_gis_export_${exportType}_${Date.now()}.json"`);
    res.setHeader("Content-Type", "application/json");
    res.json(exportResult);
  } catch (error) {
    res.status(500).json({ error: "Lỗi xuất dữ liệu JSON" });
  }
}

module.exports = { importJson, exportJson };
