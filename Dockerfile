# Production Dockerfile for SafeSleep
FROM node:20-alpine AS runner

# Set production environment
ENV NODE_ENV=production
ENV PORT=3000

WORKDIR /app

# Install dependencies (only production)
COPY package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev

# Copy application source code
COPY server.js db.js ./
COPY routes ./routes
COPY middleware ./middleware
COPY public ./public
COPY scripts ./scripts
COPY data/seed-stops.json ./data/seed-stops.json

# Create data directory and set permissions for node user
RUN mkdir -p /app/data && chown -R node:node /app

# Switch to non-root user
USER node

# Mount point for persistent database file
VOLUME ["/app/data"]

EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

CMD ["node", "server.js"]
