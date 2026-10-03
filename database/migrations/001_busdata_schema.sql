-- ====================================================================
-- MIGRATION 001: Chuẩn bị schema cho dữ liệu xe buýt TP.HCM (database/busdata)
-- Áp dụng cho DB đang chạy trên MariaDB (>= 10.0, dùng cú pháp ADD COLUMN IF NOT EXISTS).
-- MySQL 8 không hỗ trợ cú pháp này: hãy khởi tạo lại từ database/schema.sql.
-- Không động tới bảng users.
-- Có thể chạy lại nhiều lần (idempotent).
--
-- Chạy:
--   docker exec -i bus-gis-mariadb mysql -uroot bus_management_db < database/migrations/001_busdata_schema.sql
-- ====================================================================

-- 1. route_stops: cho phép một trạm xuất hiện nhiều lần trên cùng tuyến/chiều (tuyến vòng)
--    PK cũ (route_id, stop_id, direction) -> PK mới (route_id, direction, stop_order)
ALTER TABLE route_stops
    DROP PRIMARY KEY,
    ADD PRIMARY KEY (route_id, direction, stop_order);

-- 2. bus_stops: lưu mã trạm, loại trạm và trạng thái khai thác từ nguồn
ALTER TABLE bus_stops
    ADD COLUMN IF NOT EXISTS stop_code VARCHAR(30) NULL AFTER stop_id,
    ADD COLUMN IF NOT EXISTS stop_type VARCHAR(50) NULL AFTER address,
    ADD COLUMN IF NOT EXISTS status VARCHAR(30) NOT NULL DEFAULT 'Đang khai thác' AFTER stop_type;

-- 3. bus_routes: giữ lại thông tin vận hành gốc
ALTER TABLE bus_routes
    ADD COLUMN IF NOT EXISTS route_type VARCHAR(60) NULL,
    ADD COLUMN IF NOT EXISTS color VARCHAR(9) NULL,
    ADD COLUMN IF NOT EXISTS operation_time VARCHAR(30) NULL,
    ADD COLUMN IF NOT EXISTS headway_text VARCHAR(20) NULL;
