# Battle engine: Battlerust (Rust) built to WebAssembly at a pinned commit, with our Cargo.lock (Battlerust keeps
# none). `pnpm build:battle` exports it locally (`--target battle-wasm-out`).
FROM rust:1.99.1-slim-trixie AS battle-wasm
ARG BATTLERUST_REPO=https://github.com/Tsaranoga/Battlerust.git
ARG BATTLERUST_REF=4aba5885a0b6a262f04c7f934cbf6dea6b0db2e7
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/* \
 && rustup target add wasm32-unknown-unknown
WORKDIR /src
RUN git init -q . && git fetch -q --depth 1 "$BATTLERUST_REPO" "$BATTLERUST_REF" && git checkout -q FETCH_HEAD
COPY packages/battle/engine/Cargo.lock ./
# the CLI must match the wasm-bindgen crate of the lockfile
RUN cargo install wasm-bindgen-cli --locked \
    --version "$(awk '/^name = "wasm-bindgen"$/ { getline; gsub(/version = |"/, ""); print; exit }' Cargo.lock)"
RUN cargo build --locked --release --lib --target wasm32-unknown-unknown --no-default-features --features wasm \
 && wasm-bindgen --target web --out-dir /out --out-name battlerust target/wasm32-unknown-unknown/release/battlerustlib.wasm

FROM scratch AS battle-wasm-out
COPY --from=battle-wasm /out /

FROM node:24-trixie-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages/parser/package.json packages/parser/
COPY packages/flight/package.json packages/flight/
COPY packages/loot/package.json packages/loot/
COPY packages/battle/package.json packages/battle/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY apps/tools/package.json apps/tools/
RUN pnpm install --frozen-lockfile
COPY packages packages
COPY apps apps
COPY --from=battle-wasm /out packages/battle/wasm
RUN pnpm --filter "./packages/*" build \
 && pnpm --filter @pr0hub/web build \
 && pnpm --filter @pr0hub/tools build \
 && pnpm --filter @pr0hub/server build \
 && pnpm --filter @pr0hub/server deploy --legacy --prod /out

# Static pr0game tools (flight calculator): `docker build --target tools`.
FROM nginx:1.31-alpine AS tools
COPY --from=build /app/apps/tools/dist /usr/share/nginx/html

# Hub (default target, last stage).
FROM node:24-trixie-slim
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
