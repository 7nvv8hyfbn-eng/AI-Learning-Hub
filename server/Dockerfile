FROM node:22.14.0-bookworm-slim@sha256:1c18d9ab3af4585870b92e4dbc5cac5a0dc77dd13df1a5905cea89fc720eb05b AS build
WORKDIR /workspace
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/contracts/tsconfig.json packages/contracts/tsconfig.json
COPY packages/contracts/src packages/contracts/src
COPY packages/demo-fixtures/package.json packages/demo-fixtures/package.json
COPY packages/demo-fixtures/src packages/demo-fixtures/src
COPY packages/catalog-assets packages/catalog-assets
COPY frontend/public/demo/resource-hub /workspace/frontend/public/demo/resource-hub
COPY server/package.json server/package-lock.json server/
RUN cd server && npm ci
COPY version.md ./version.md
COPY scripts/version.mjs ./scripts/version.mjs
COPY server server
ARG APP_COMMIT_SHA=development
ENV APP_COMMIT_SHA=${APP_COMMIT_SHA}
RUN cd server && npx prisma generate && npm run build

FROM node:22.14.0-bookworm-slim@sha256:1c18d9ab3af4585870b92e4dbc5cac5a0dc77dd13df1a5905cea89fc720eb05b AS runtime
ENV NODE_ENV=production
WORKDIR /workspace/server
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg openssl && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /workspace/server/var/uploads /workspace/server/var/initialization /workspace/server/var/operations/runtime && chown -R node:node /workspace/server/var
COPY --chown=node:node --from=build /workspace/packages/contracts/package.json /workspace/packages/contracts/package.json
COPY --chown=node:node --from=build /workspace/packages/contracts/dist /workspace/packages/contracts/dist
COPY --chown=node:node --from=build /workspace/packages/catalog-assets /workspace/packages/catalog-assets
COPY --chown=node:node --from=build /workspace/frontend/public/demo/resource-hub /workspace/frontend/public/demo/resource-hub
COPY --chown=node:node --from=build /workspace/server/node_modules ./node_modules
COPY --chown=node:node --from=build /workspace/server/package.json /workspace/server/package-lock.json ./
COPY --chown=node:node --from=build /workspace/server/scripts/check-runtime-imports.cjs ./scripts/check-runtime-imports.cjs
COPY --chown=node:node --from=build /workspace/server/prisma/schema.prisma ./prisma/schema.prisma
COPY --chown=node:node --from=build /workspace/server/prisma/migrations ./prisma/migrations
COPY --chown=node:node --from=build /workspace/server/dist ./dist
COPY --chown=node:node --from=build /workspace/server/resources/project-content ./resources/project-content
COPY --chown=node:node --from=build /workspace/server/resources/community-starter/images ./resources/community-starter/images
RUN rm -f dist/modules/community/import-starter.js dist/modules/community/import-starter.js.map dist/modules/community/import-starter.d.ts && rm -rf node_modules/@ai-learning-hub/demo-fixtures
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
