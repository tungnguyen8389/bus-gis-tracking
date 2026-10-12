FROM node:20-alpine

WORKDIR /app

# Cài đặt dependencies cho backend
COPY backend/package*.json ./backend/
RUN cd backend && npm install --omit=dev

# Sao chép mã nguồn các module
COPY backend/ ./backend/
COPY frontend/ ./frontend/
COPY tools/ ./tools/
COPY database/ ./database/

WORKDIR /app/backend

EXPOSE 3000

CMD ["npm", "start"]
