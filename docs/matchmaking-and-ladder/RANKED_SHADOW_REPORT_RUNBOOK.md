# 赛季排位影子报告临时运行说明

> 文档类型：专题运行说明
> 适用范围：`scripts/generate-ranked-shadow-report.mjs` 的只读生产运行边界
> 当前状态：用于按需复现或更新匿名影子报告，不属于常规服务运行任务
> 脚本用途：从生产 PostgreSQL 只读提取符合条件的历史对局，生成 Glicko 影子报告

当前脚本生成报告结构 `loveca-ranked-shadow-report-v2`，使用候选算法 `GLICKO1_PER_MATCH_SHADOW_V2`（10 场定位）。2026-07-29 已生成的 V1 报告是首轮参数判断的不可变输入，不需要为了版本升级重新运行或覆盖。

## 安全边界

- 脚本只连接 `DATABASE_URL`；
- 数据库事务强制使用 `REPEATABLE READ READ ONLY`；
- 只对 `match_records` 执行一条参数化 `SELECT`；
- 默认只读取 `PUBLIC_TABLE` 来源；
- 不读取用户邮箱、用户名、显示名、卡组、checkpoint、聊天或隐藏对局数据；
- 报告不包含原始玩家 ID、`matchId` 或房间号；
- 玩家使用不可逆的稳定哈希前缀表示，仅用于报告内区分；
- JSON 和 Markdown 文件以 `0600` 权限创建。

报告中的 `match_records.cardDataHash` 是本局双方卡组快照的重放完整性哈希，不是全局卡牌目录或赛季环境哈希。V2 只输出其去标识汇总，不列出哈希前缀。

## 推荐：在现有 API 容器中临时运行

将单文件脚本复制到容器：

```bash
docker compose cp \
  scripts/generate-ranked-shadow-report.mjs \
  api:/app/generate-ranked-shadow-report.mjs
```

运行默认报告：

```bash
docker compose exec -T api \
  node /app/generate-ranked-shadow-report.mjs \
  --output-dir=/tmp/loveca-ranked-shadow
```

如需限制时间范围，使用 ISO 时间；`--to` 不包含结束值：

```bash
docker compose exec -T api \
  node /app/generate-ranked-shadow-report.mjs \
  --output-dir=/tmp/loveca-ranked-shadow \
  --from=2026-06-01T00:00:00+08:00 \
  --to=2026-08-01T00:00:00+08:00
```

默认只分析公共牌桌。若需要同时观察普通房间历史作为敏感性对照，显式增加：

```bash
--origins=PUBLIC_TABLE,ONLINE_ROOM
```

将报告复制回宿主机：

```bash
docker compose cp \
  api:/tmp/loveca-ranked-shadow \
  ./loveca-ranked-shadow
```

确认成功拿到报告后删除容器内临时文件：

```bash
docker compose exec -T api sh -lc \
  'rm -f /app/generate-ranked-shadow-report.mjs /tmp/loveca-ranked-shadow/loveca-ranked-shadow-*.json /tmp/loveca-ranked-shadow/loveca-ranked-shadow-*.md'
```

## 在生产宿主机直接运行

宿主机需要 Node.js 22 和已经安装的 `pg` 生产依赖：

```bash
env DATABASE_URL='<生产只读连接串>' \
  node scripts/generate-ranked-shadow-report.mjs \
  --output-dir=./loveca-ranked-shadow
```

优先使用数据库只读账号；即使使用应用账号，脚本仍会在会话和事务层强制只读。

## 需要返还的文件

请返还同一次运行生成的：

- `loveca-ranked-shadow-*.json`：用于进一步计算和参数比较；
- `loveca-ranked-shadow-*.md`：用于快速人工审阅。

不需要返还运行日志、数据库连接串或任何 `.env` 文件。
