# Loveca 生产部署 Runbook

> 文档类型：专题说明
> 适用范围：自托管生产环境的停机部署、验证和回滚
> 当前状态：2026-08-24 现行部署流程

本文只负责把已经发布并验证的 Loveca 版本部署到生产环境。版本号、发布提交、GitHub CI、tag、GitHub Release 和 GHCR 镜像发布由 [`prepare-for-release`](../.agents/skills/prepare-for-release/SKILL.md) skill 负责；版本特有的数据迁移步骤写在对应的 `drizzle/migration-notes/` 中。

## 1. 生产约定

- PostgreSQL 与 API 由 `/root/loveca/docker-compose.yml` 管理。
- 前端由宿主机 `pnpm --dir client preview --host 0.0.0.0 --port 4173` 提供，Nginx 反代到 `127.0.0.1:4173`。
- API 镜像固定为 `linux/amd64`，正常发布必须使用不可变 GHCR tag 或 digest，禁止使用 `latest`。
- 生产机通常不构建 API 镜像。只有已发布镜像确认无法启动且必须紧急恢复时，才允许在维护模式下使用本地 hotfix 镜像；随后必须立刻上游修复并换回新的不可变镜像。
- 前端 preview 运行期间不得重新构建 `client/dist`，因为正在运行的服务会直接读取该目录。前端构建只能在停机后进行。
- 通用流程以本文为准；某版本新增表、种子或一次性脚本以对应迁移说明为准。

## 2. 发布产物门禁

进入生产机前完成以下检查：

1. `VERSION`、`package.json`、`client/package.json` 与目标 tag 一致。
2. tag 指向已经通过 CI 的 exact SHA。
3. API 镜像标签、revision label、平台和 digest 与该 SHA 对应。
4. 使用与生产一致的镜像依赖运行入口语法检查和运行时导入检查。

```bash
docker pull --platform linux/amd64 ghcr.io/catmeow123456/loveca-api:<version>

docker run --rm --entrypoint node \
  ghcr.io/catmeow123456/loveca-api:<version> \
  --check dist/server/index.js

docker run --rm --entrypoint node \
  ghcr.io/catmeow123456/loveca-api:<version> \
  -e "import('./dist/scripts/sync-cards-cloudbase-new.js').then(() => console.log('runtime imports ok'))"
```

仅做 `node --check` 不足以发现生产依赖缺失。凡是被服务端运行路径复用的脚本，都必须在只安装生产依赖的候选镜像中实际 import 或启动一次。

## 3. 在线准备

这些操作不需要停机：

```bash
cd /root/loveca

df -h /
docker compose ps
git status --short
git fetch --tags origin
git pull --ff-only
pnpm install --frozen-lockfile

cat VERSION
node -p "require('./package.json').version"
node -p "require('./client/package.json').version"
```

同时完成：

- 根分区至少保留 3 GB 可用空间。
- 阅读本次版本的 `drizzle/migration-notes/`。
- 核对 `.env` 中本次迁移需要的变量是否存在，但不要输出变量值。
- 拉取并检查目标 API 镜像：

```bash
docker compose pull api
docker image inspect "$(sed -n 's/^LOVECA_API_IMAGE=//p' .env)" \
  --format '{{.Id}} {{.Architecture}} {{json .Config.Labels}}'
```

如果当前明确使用本地 emergency image，则跳过 `pull`，改为对 `.env` 中的精确镜像名执行 `docker image inspect`。

## 4. 停机迁移

### 4.1 进入维护模式

依次执行并确认：

1. 平台状态 `NORMAL -> RESTRICTING_NEW_GAMES -> MAINTENANCE`。
2. 维护快照可访问，SPA 深链接也返回维护页。
3. 没有运行中对局或写入任务。
4. 记录旧 API 容器 ID、镜像引用和可用的 RepoDigest。

```bash
cd /root/loveca
docker inspect "$(docker compose ps -q api)" \
  --format 'container={{.Id}} image={{.Config.Image}} image_id={{.Image}}'
```

### 4.2 停止写入并构建前端

```bash
tmux kill-session -t loveca
docker compose stop api

pnpm --dir client build
```

### 4.3 数据库迁移

数据库备份默认是停机迁移的前置条件。若负责人明确放弃备份，必须在部署记录中写明“无数据库回滚能力”；失败后只能保持维护模式并向前修复，不能把旧应用直接接回已变化的 schema。

```bash
pnpm db:migrate
```

禁止在生产环境使用 `db:push` 或重新执行 `init.sql`。随后执行本版本迁移说明中的一次性脚本和校验；任一步失败都保持 API、前端停止和平台维护状态。

## 5. 部署应用

将 `.env` 的 `LOVECA_API_IMAGE` 更新为已验证的不可变镜像引用，然后：

```bash
cd /root/loveca
docker compose pull api
docker compose up -d --no-build --no-deps api

tmux new-session -d -s loveca \
  'cd /root/loveca && pnpm run start:prod'
```

本地 emergency image 不可 `pull`；确认本地镜像 ID 后直接执行 `docker compose up -d --no-build --no-deps api`。

## 6. 验证与开放

先在维护模式下验证：

```bash
docker compose ps
docker compose logs --tail=200 api
curl -fsS http://127.0.0.1:3007/api/health
curl -fsS http://127.0.0.1:3007/api/ready
curl -fsS http://127.0.0.1:4173/version.json
curl -fsS http://127.0.0.1:4173/manifest.webmanifest >/dev/null
```

再核对：

- API 实际容器使用目标镜像。
- 前端 `version.json` 的版本和 commit SHA 正确。
- 当前构建的 JS/CSS 资源返回 200。
- `loveca.lovelivefun.xyz` 正常。
- 管理员登录、牌组读取及本版本最小业务 smoke 通过。
- 平台状态和站点快照读取正常。

全部通过后，使用正常管理接口将平台恢复为 `NORMAL`。不要在离线状态下直接把快照改成 `OPEN` 绕过状态机。

## 7. 回滚边界

- 数据库迁移前失败：恢复旧镜像和旧前端即可。
- 数据库迁移后但 schema 向后不兼容：只有数据库备份存在时才能完整回滚。
- 明确放弃数据库备份：迁移失败后只能保持维护模式并向前修复。
- 已发布 tag 和镜像 tag 不得覆盖；修复应发布新的 patch 版本或新的不可变 hotfix tag。
- 回滚完成后仍需重新执行健康检查、前端资源检查和最小业务 smoke。

## 8. 部署记录

每次生产更新至少记录：

- 版本、tag、exact SHA、镜像引用与 digest。
- 停机开始和恢复时间。
- 数据库备份是否存在；若放弃，记录明确授权。
- 执行过的迁移与一次性脚本及结果。
- API、前端、域名和业务 smoke 结果。
- 任何 hotfix、失败、回滚或遗留事项。

## 9. 启动请求诊断日志

仓库 [`loveca.conf`](../loveca.conf) 保留原访问日志，另将已发布卡池、公开配置、站点快照和登录恢复请求写入 `/var/log/nginx/loveca.startup-diagnostic.log`（逐行 JSON）。生产配置同步并通过 `nginx -t` 后，需要 reload 才开始记录；历史日志无法补出耗时。`map` 和 `log_format` 必须由 `http` 块加载，不能放在 `server` 块内。配置备份应放在 `/etc/nginx/sites-enabled/` 之外，避免被通配 include 加载。

卡池采样包含当前 `GET /api/cards/published`，以及用于观察旧页面残留请求的 `GET /api/cards?status=PUBLISHED`。发布时核对实际客户端路径与采样规则同步；旧接口的 404 不代表新卡池故障，也不能因旧接口不再出现而认定新接口没有下载中断。接入新规则前，普通访问日志只有状态与字节数，无法补出历史请求耗时或完成状态。

日志记录来源 IP、路径、状态、发送字节数、请求总耗时、上游连接/首包/响应耗时、上游响应长度、压缩协商、请求完成状态及请求 ID。新日志不记录查询串、Cookie、Authorization 或请求/响应正文。确认主机的 logrotate 规则覆盖 `/var/log/nginx/*.log`；本机现有规则按天轮转，保留 14 份。

分析时结合以下字段，不能仅以 HTTP `200` 判断浏览器加载成功：

- `request_completion` 为 `OK` 表示 Nginx 侧请求完成，空字符串表示未完成；它不能证明浏览器已成功解压、解析或渲染。
- `request_time` 与 `upstream_response_time` 对照可帮助定位等待阶段，但总耗时与上游耗时的差值不是精确的网络下载耗时，代理缓冲和并行收发也会影响它。
- `body_bytes_sent` 是发往客户端的正文大小；开启 gzip 时，不能直接与未压缩的 `upstream_response_length` 比较。应同时看 `content_encoding`、`gzip_ratio` 和同期同一卡池的正常响应。
- 连续出现接近前端超时预算的未完成请求，且上游耗时较短，才支持客户端等待超时或传输问题的判断；立即刷新、页面关闭也可能产生未完成请求。来源 IP 的注册地区与运营商不能确认具体用户、物理位置或 Wi-Fi/移动网络类型。

变更日志配置时先检查配置并验证正常请求、客户端中断与非采样路径，再按当次授权 reload。新增日志仅用于定位问题，不改变 API 超时、重试、压缩或业务行为。

服务端 `api-runtime-stats` 记录连接池总数、空闲数、等待数，以及本统计周期的事件循环延迟（毫秒，mean/p99/max）；`api-request-error` 补充错误请求 ID 与当时的相同指标。事件循环未取得样本时为 `null`，错误记录不重置统计周期。

公开配置的站点设置查询与登录续期的连接获取使用 `startup-database-operation`：仅失败或耗时达到 1 秒时记录，区分 `acquire`（等待/建立数据库连接）与 `query`（已获连接后的执行）。登录续期当前只采集 `acquire`；它的事务及加密耗时仍需结合请求总耗时调查。记录包含请求 ID、阶段耗时、结果和运行指标，不包含 SQL、查询参数、Cookie、令牌或连接串。通过 `upstream_request_id` 与 Nginx 记录关联；这些指标用于定位等待阶段，不能单凭一次连接超时断言连接泄漏或直接提高连接池上限。
