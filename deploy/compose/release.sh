#!/usr/bin/env bash
# 在目标主机执行。ENV_FILE、APP_COMMIT_SHA 和 APP_IMAGE_TAG 由该环境提供。
set -euo pipefail
umask 077
cd "$(dirname "$0")"
: "${APP_COMMIT_SHA:?必须指定已推送的固定 Git 提交}"
: "${APP_IMAGE_TAG:?必须指定该提交对应的镜像标签}"
: "${ENV_FILE:?必须指定该环境的私有配置文件}"
[[ "$APP_COMMIT_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo 'Git 提交格式无效' >&2; exit 1; }
export APP_COMMIT_SHA APP_IMAGE_TAG ENV_FILE
backup="${BACKUP_DIRECTORY:-./backups}/$(date -u +%Y%m%dT%H%M%SZ)-${APP_COMMIT_SHA}"
mkdir -p "$backup"
compose=(docker compose --env-file "$ENV_FILE" -f "${COMPOSE_FILE:-docker-compose.yml}")
"${compose[@]}" config --quiet
"${compose[@]}" run --rm --no-deps preflight
"${compose[@]}" up -d --wait postgres
# 停止写入后备份；失败时保持关闭，禁止带着未完成内容开放新服务。
"${compose[@]}" stop student-web admin-web server
"${compose[@]}" exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$backup/database.dump"
test -s "$backup/database.dump"
"${compose[@]}" run --rm --no-deps -T --entrypoint tar content-sync -czf - -C /workspace/server/var/uploads . > "$backup/uploads.tar.gz"
"${compose[@]}" images --format json > "$backup/images.json"
cp "$ENV_FILE" "$backup/environment.private"
printf '%s\n' "$APP_COMMIT_SHA" > "$backup/commit"
"${compose[@]}" run --rm --no-deps migrate
"${compose[@]}" run --rm --no-deps bootstrap
"${compose[@]}" run --rm --no-deps content-sync | tee "$backup/content-sync.log"
"${compose[@]}" run --rm --no-deps content-sync node dist/modules/project-content/sync.js --verify | tee "$backup/content-verify.log"
"${compose[@]}" up -d --no-deps --wait server
"${compose[@]}" up -d --no-deps --wait student-web admin-web
echo "发布完成：$APP_COMMIT_SHA；备份及内容报告：$backup"
