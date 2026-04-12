FROM node:24-bookworm-slim AS build

WORKDIR /workspace

RUN corepack enable

COPY .npmrc package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json tsconfig.json ./

COPY artifacts/api-server/package.json ./artifacts/api-server/package.json
COPY artifacts/api-server/build.mjs ./artifacts/api-server/build.mjs
COPY artifacts/api-server/tsconfig.json ./artifacts/api-server/tsconfig.json
COPY artifacts/api-server/src ./artifacts/api-server/src

COPY lib/api-zod/package.json ./lib/api-zod/package.json
COPY lib/api-zod/src ./lib/api-zod/src

COPY lib/db/package.json ./lib/db/package.json
COPY lib/db/src ./lib/db/src

RUN pnpm install --no-frozen-lockfile --ignore-scripts
RUN pnpm --filter @workspace/api-server run build

FROM node:24-bookworm-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

COPY --from=build /workspace/artifacts/api-server/dist ./dist

CMD ["node", "--enable-source-maps", "dist/index.mjs"]
