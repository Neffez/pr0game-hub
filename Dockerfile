FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages/parser/package.json packages/parser/
COPY packages/flight/package.json packages/flight/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY apps/tools/package.json apps/tools/
RUN pnpm install --frozen-lockfile
COPY packages packages
COPY apps apps
RUN pnpm --filter "./packages/*" build \
 && pnpm --filter @pr0hub/web build \
 && pnpm --filter @pr0hub/tools build \
 && pnpm --filter @pr0hub/server build \
 && pnpm --filter @pr0hub/server deploy --legacy --prod /out

# Static pr0game tools (flight calculator): `docker build --target tools`.
FROM nginx:1.27-alpine AS tools
COPY --from=build /app/apps/tools/dist /usr/share/nginx/html

# Hub (default target, last stage).
FROM node:22-bookworm-slim
WORKDIR /app
COPY --from=build /out ./
COPY --from=build /app/apps/web/dist ./web
RUN mkdir -p /data && chown node:node /data
ENV NODE_ENV=production \
    PORT=3000 \
    BASE_PATH=/hub \
    DATA_DIR=/data \
    WEB_DIR=/app/web
VOLUME /data
EXPOSE 3000
USER node
HEALTHCHECK --interval=30s --timeout=5s \
  CMD node -e "fetch('http://localhost:'+process.env.PORT+process.env.BASE_PATH+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "dist/main.js"]
