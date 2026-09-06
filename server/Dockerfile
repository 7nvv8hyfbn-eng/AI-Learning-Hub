FROM node:22.14.0-bookworm-slim@sha256:1c18d9ab3af4585870b92e4dbc5cac5a0dc77dd13df1a5905cea89fc720eb05b AS build
WORKDIR /workspace
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/contracts/tsconfig.json packages/contracts/tsconfig.json
COPY packages/contracts/src packages/contracts/src
COPY packages/demo-fixtures/package.json packages/demo-fixtures/package.json
COPY packages/demo-fixtures/src packages/demo-fixtures/src
COPY packages/catalog-assets packages/catalog-assets
COPY frontend/public/demo/resource-hub /workspace/demo/resource-hub
COPY server/package.json server/package-lock.json server/
RUN cd server && npm ci
COPY server server
RUN cd server && npx prisma generate && npm run build

FROM node:22.14.0-bookworm-slim@sha256:1c18d9ab3af4585870b92e4dbc5cac5a0dc77dd13df1a5905cea89fc720eb05b AS runtime
ENV NODE_ENV=production
WORKDIR /workspace/server
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg openssl && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /workspace/server/var/uploads && chown node:node /workspace/server/var/uploads
COPY --chown=node:node --from=build /workspace/packages /workspace/packages
COPY --chown=node:node --from=build /workspace/demo /workspace/demo
COPY --chown=node:node --from=build /workspace/server/node_modules ./node_modules
COPY --chown=node:node --from=build /workspace/server/package.json /workspace/server/package-lock.json ./
COPY --chown=node:node --from=build /workspace/server/scripts/check-runtime-imports.cjs ./scripts/check-runtime-imports.cjs
COPY --chown=node:node --from=build /workspace/server/scripts/check-seed-runtime.cjs ./scripts/check-seed-runtime.cjs
COPY --chown=node:node --from=build /workspace/server/prisma ./prisma
COPY --chown=node:node --from=build /workspace/server/src/modules/homepage/upgrade-landing.ts ./src/modules/homepage/upgrade-landing.ts
COPY --chown=node:node --from=build /workspace/server/src/modules/persistence/bootstrap.ts ./src/modules/persistence/bootstrap.ts
COPY --chown=node:node --from=build /workspace/server/dist ./dist
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
