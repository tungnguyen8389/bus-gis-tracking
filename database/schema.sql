-- ====================================================================
-- HỆ THỐNG CƠ SỞ DỮ LIỆU QUẢN LÝ XE BUÝT (MYSQL 8.0 / MARIADB SPATIAL)
-- Hệ quy chiếu: WGS84 (SRID 4326), Quy ước trục: axis-order=long-lat
-- ====================================================================

CREATE DATABASE IF NOT EXISTS bus_management_db 
CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE bus_management_db;

-- 0. Bảng Người dùng & Phân quyền Quản trị (Auth & Users)
DROP TABLE IF EXISTS users;
CREATE TABLE users (
    user_id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(50) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(100) NOT NULL,
    email VARCHAR(100),
    role ENUM('ADMIN', 'MANAGER', 'VIEWER') DEFAULT 'MANAGER',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- 1. Bảng Tuyến xe buýt (Thực thể thuộc tính)
DROP TABLE IF EXISTS route_stops;
DROP TABLE IF EXISTS route_paths;
DROP TABLE IF EXISTS vehicle_tracking_logs;
DROP TABLE IF EXISTS schedules;
DROP TABLE IF EXISTS vehicles;
DROP TABLE IF EXISTS bus_stops;
DROP TABLE IF EXISTS bus_routes;

CREATE TABLE bus_routes (
    route_id VARCHAR(20) PRIMARY KEY,
    route_number VARCHAR(10) NOT NULL,
    route_name VARCHAR(150) NOT NULL,
    distance_km FLOAT DEFAULT 0.0,
    headway_min INT DEFAULT 15
) ENGINE=InnoDB;

-- 2. Bảng Lộ trình tuyến đường (Thực thể Không gian: LineString)
CREATE TABLE route_paths (
    path_id INT AUTO_INCREMENT PRIMARY KEY,
    route_id VARCHAR(20) NOT NULL,
    direction TINYINT NOT NULL COMMENT '1: Đi, 2: Về',
    geom LINESTRING NOT NULL /* SRID 4326 */,
    SPATIAL INDEX(geom),
    FOREIGN KEY (route_id) REFERENCES bus_routes(route_id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- 3. Bảng Trạm dừng xe buýt (Thực thể Không gian: Point)
CREATE TABLE bus_stops (
    stop_id VARCHAR(20) PRIMARY KEY,
    stop_name VARCHAR(150) NOT NULL,
    address VARCHAR(255),
    geom POINT NOT NULL /* SRID 4326 */,
    SPATIAL INDEX(geom)
) ENGINE=InnoDB;

-- 4. Bảng liên kết Thứ tự Trạm dừng trên Tuyến (Quan hệ M - N)
CREATE TABLE route_stops (
    route_id VARCHAR(20) NOT NULL,
    stop_id VARCHAR(20) NOT NULL,
    direction TINYINT NOT NULL,
    stop_order INT NOT NULL,
    PRIMARY KEY (route_id, stop_id, direction),
    FOREIGN KEY (route_id) REFERENCES bus_routes(route_id) ON DELETE CASCADE,
    FOREIGN KEY (stop_id) REFERENCES bus_stops(stop_id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- 5. Bảng Phương tiện xe buýt
CREATE TABLE vehicles (
    vehicle_id VARCHAR(20) PRIMARY KEY,
    plate_number VARCHAR(20) NOT NULL UNIQUE,
    capacity INT DEFAULT 40,
    driver_name VARCHAR(100),
    status VARCHAR(30) DEFAULT 'ACTIVE'
) ENGINE=InnoDB;

-- 6. Bảng Lịch trình khởi hành
CREATE TABLE schedules (
    schedule_id INT AUTO_INCREMENT PRIMARY KEY,
    route_id VARCHAR(20) NOT NULL,
    vehicle_id VARCHAR(20) NOT NULL,
    departure_time TIME NOT NULL,
    direction TINYINT NOT NULL,
    FOREIGN KEY (route_id) REFERENCES bus_routes(route_id) ON DELETE CASCADE,
    FOREIGN KEY (vehicle_id) REFERENCES vehicles(vehicle_id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- 7. Bảng Nhật ký vết xe (Spatial Temporal: Điểm động theo thời gian)
CREATE TABLE vehicle_tracking_logs (
    log_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    vehicle_id VARCHAR(20) NOT NULL,
    speed_kmh FLOAT DEFAULT 0.0,
    heading FLOAT DEFAULT 0.0,
    geom POINT NOT NULL,
    recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    SPATIAL INDEX(geom),
    INDEX(vehicle_id, recorded_at),
    FOREIGN KEY (vehicle_id) REFERENCES vehicles(vehicle_id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ====================================================================
-- SEED DỮ LIỆU MẪU KHU VỰC ĐẠI HỌC QUỐC GIA TP.HCM
-- ====================================================================

-- Nạp Tài khoản Quản trị mẫu (Mật khẩu mặc định: admin123 / manager123)
INSERT INTO users (username, password_hash, full_name, email, role) VALUES
('admin', '$2b$10$be/YCW2AyTX1gvBhWxR5cOS1Ge1cKIogArSfSYQ.Aj79eofoXleWK', 'Quản trị viên Hệ thống', 'admin@busgis.vn', 'ADMIN'),
('manager', '$2b$10$PuxC1Sqo0DlyCRYGpQj8buYs8D0JMXfx.921s1thBPsbnW1aIS7Om', 'Quản lý Điều hành', 'manager@busgis.vn', 'MANAGER');

-- Nạp Danh sách Tuyến xe buýt
INSERT INTO bus_routes (route_id, route_number, route_name, distance_km, headway_min) VALUES
('BUS_01', '08', 'Bến xe Buýt ĐHQG - Bến Thành', 15.5, 10),
('BUS_02', '10', 'ĐHQG - Bến xe Miền Tây', 28.0, 15),
('BUS_03', '53', 'Lê Hồng Phong - ĐHQG', 22.0, 12);

-- Nạp Trạm dừng (Point WGS84)
INSERT INTO bus_stops (stop_id, stop_name, address, geom) VALUES
('ST_01', 'Trạm KTX Khu A', 'Đường Tạ Quang Bửu', ST_GeomFromText('POINT(106.795000 10.863000)', 4326)),
('ST_02', 'Trạm ĐH Khoa học Tự nhiên', 'Đường Vành Đai', ST_GeomFromText('POINT(106.800000 10.870000)', 4326)),
('ST_03', 'Trạm Thư viện Trung tâm', 'Khu trung tâm ĐHQG', ST_GeomFromText('POINT(106.801960 10.870525)', 4326)),
('ST_04', 'Trạm ĐH Quốc Tế', 'Đường Quảng Trường Sáng Tạo', ST_GeomFromText('POINT(106.803300 10.877800)', 4326)),
('ST_05', 'Trạm ĐH Bách Khoa CS2', 'Đường Lê Quý Đôn', ST_GeomFromText('POINT(106.805500 10.868500)', 4326)),
('ST_06', 'Trạm ĐH Công Nghệ Thông Tin', 'Đường Hàn Thuyên', ST_GeomFromText('POINT(106.801000 10.869000)', 4326)),
('ST_07', 'Trạm KTX Khu B', 'Đường Tô Vĩnh Diện', ST_GeomFromText('POINT(106.809000 10.879000)', 4326)),
('ST_08', 'Trạm ĐH Khoa học Xã hội & Nhân văn', 'Đường Lưu Hữu Phước', ST_GeomFromText('POINT(106.802000 10.873000)', 4326));

-- Nạp Lộ trình tim đường (LineString WGS84)
INSERT INTO route_paths (route_id, direction, geom) VALUES
('BUS_01', 1, ST_GeomFromText('LINESTRING(106.795000 10.863000, 106.798000 10.866000, 106.800000 10.870000, 106.801960 10.870525, 106.803300 10.877800, 106.805500 10.868500)', 4326)),
('BUS_01', 2, ST_GeomFromText('LINESTRING(106.805500 10.868500, 106.803300 10.877800, 106.801960 10.870525, 106.800000 10.870000, 106.798000 10.866000, 106.795000 10.863000)', 4326)),
('BUS_02', 1, ST_GeomFromText('LINESTRING(106.795000 10.863000, 106.801000 10.869000, 106.801960 10.870525, 106.809000 10.879000)', 4326)),
('BUS_03', 1, ST_GeomFromText('LINESTRING(106.802000 10.873000, 106.803300 10.877800, 106.805500 10.868500, 106.809000 10.879000)', 4326));

-- Gán thứ tự đón khách
INSERT INTO route_stops (route_id, stop_id, direction, stop_order) VALUES
('BUS_01', 'ST_01', 1, 1),
('BUS_01', 'ST_02', 1, 2),
('BUS_01', 'ST_03', 1, 3),
('BUS_01', 'ST_04', 1, 4),
('BUS_01', 'ST_05', 1, 5),
('BUS_02', 'ST_01', 1, 1),
('BUS_02', 'ST_06', 1, 2),
('BUS_02', 'ST_03', 1, 3),
('BUS_02', 'ST_07', 1, 4),
('BUS_03', 'ST_08', 1, 1),
('BUS_03', 'ST_04', 1, 2),
('BUS_03', 'ST_05', 1, 3),
('BUS_03', 'ST_07', 1, 4);

-- Nạp Xe buýt
INSERT INTO vehicles (vehicle_id, plate_number, capacity, driver_name, status) VALUES
('BUS_51B_01', '51B-123.45', 45, 'Nguyễn Văn A', 'ACTIVE'),
('BUS_51B_02', '51B-678.90', 45, 'Trần Văn B', 'ACTIVE'),
('BUS_51B_03', '51B-888.99', 45, 'Lê Văn C', 'ACTIVE'),
('BUS_51B_04', '51B-456.78', 45, 'Phạm Văn D', 'ACTIVE');

-- Nạp Phân công Chuyến xe & Lịch trình khởi hành mẫu
INSERT INTO schedules (route_id, vehicle_id, departure_time, direction) VALUES
('BUS_01', 'BUS_51B_01', '06:00:00', 1),
('BUS_01', 'BUS_51B_02', '06:30:00', 1),
('BUS_01', 'BUS_51B_01', '07:15:00', 2),
('BUS_02', 'BUS_51B_03', '06:15:00', 1),
('BUS_03', 'BUS_51B_04', '06:45:00', 1);

