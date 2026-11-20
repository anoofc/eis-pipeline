FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000 NEXT_TELEMETRY_DISABLED=1 CHROMIUM_PATH=/usr/bin/chromium
COPY --from=build /app/.next/standalone ./
RUN apt-get update && apt-get install -y --no-install-recommends chromium fonts-liberation ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
COPY --from=build /app/sql ./sql
COPY --from=build /app/scripts/database.mjs ./scripts/database.mjs
RUN chown -R node:node /app/.next
USER node
EXPOSE 3000
CMD ["node","server.js"]
