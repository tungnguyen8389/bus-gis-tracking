# Simulator — tài xế ảo (công cụ demo)

Mỗi tài xế ảo đăng nhập bằng tài khoản tài xế thật, nhận lịch trình của xe mình rồi phát GPS qua namespace `/device`. Đây là cùng giao thức với trang `driver.html` trên điện thoại.

Simulator **độc lập** với hệ thống: chỉ gọi REST public và Socket.io, không đọc CSDL, không import code backend. Khi triển khai thật, xóa cả thư mục `simulator/`.

## Chạy

```bash
# 1. Backend đang chạy và đã có tài khoản tài xế
cd backend && npm run db:seed-drivers -- --count 10

# 2. Chạy simulator
cd simulator && npm install && cp .env.example .env
npm start -- --count 10                  # driver01..driver10
npm start -- --drivers driver01,driver05 # chọn tài xế cụ thể
```

Ctrl+C: gửi `trip:end` cho từng xe để bản đồ gỡ xe ngay.

## Hành vi

- Mỗi tài xế chạy lịch trình đầu tiên của xe, lặp vòng trên lộ trình, 30–40 km/h, phát mỗi 500 ms.
- Tài xế thật mở `driver.html` và bấm "Bắt đầu chuyến" cho cùng xe: server gửi `session:replaced`, xe ảo đó dừng (không giành lại).
- Token hết hạn: đăng nhập lại một lần. Backend chưa chạy: thử lại mỗi 5 giây.

## Test

```bash
npm run test:unit
```
