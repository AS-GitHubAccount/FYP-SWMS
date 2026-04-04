# Build from repository root so ../prototypes exists (server.js resolves prototypes sibling to backend).
FROM node:20-bookworm-slim

WORKDIR /app

COPY backend/package.json backend/package-lock.json ./backend/
WORKDIR /app/backend
RUN npm ci --omit=dev

WORKDIR /app
COPY backend/ ./backend/
COPY prototypes/ ./prototypes/

WORKDIR /app/backend
RUN mkdir -p uploads
ENV NODE_ENV=production
CMD ["node", "server.js"]
