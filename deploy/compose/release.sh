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
# 先核对镜像中的构建版本，防止三个同名标签实际来自不同提交。
version=$(sed -nE 's/^当前版本：v([0-9]+\.[0-9]+\.[0-9]+)$/\1/p' ../../version.md)
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo 'version.md 版本无效' >&2; exit 1; }
"${compose[@]}" run --rm --no-deps -T --entrypoint cat server /workspace/server/dist/version.json > "$backup/server-version.json"
for service in student-web admin-web; do
  "${compose[@]}" run --rm --no-deps -T --entrypoint cat "$service" /usr/share/nginx/html/version.json > "$backup/$service-version.json"
done
"${compose[@]}" run --rm --no-deps -T --entrypoint node server -e '
const [version, commit, ...artifacts] = process.argv.slice(1);
for (const value of artifacts) require("node:assert/strict").deepEqual(JSON.parse(value), { version, commit });
console.log(JSON.stringify({version, commit, artifactsVerified: artifacts.length}));
' "$version" "$APP_COMMIT_SHA" "$(cat "$backup/server-version.json")" "$(cat "$backup/student-web-version.json")" "$(cat "$backup/admin-web-version.json")" > "$backup/release-version.json"
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
"${compose[@]}" exec -T server node -e '
fetch("http://127.0.0.1:3000/api/v1/version").then(async response => {
  require("node:assert/strict").equal(response.ok, true);
  const actual = (await response.json()).data;
  const expected = require("./dist/version.json");
  require("node:assert/strict").deepEqual({version: actual.version, commit: actual.commit}, expected);
}).catch(error => { console.error(error.message); process.exit(1) });
'
"${compose[@]}" up -d --no-deps --wait student-web admin-web
echo "发布完成：v$version $APP_COMMIT_SHA；备份及内容报告：$backup"
