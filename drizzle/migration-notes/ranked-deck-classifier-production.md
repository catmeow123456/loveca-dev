# 赛季排位卡组分类、卡组环境与卡牌使用率：生产迁移说明

> 适用范围：首次将“卡组分类／赛季卡组环境饼图／卡牌使用率独立展示口径”部署到生产环境
> 前提：生产尚未执行开发期的任何卡组分类迁移，正式代码中的卡组分类结构只由收束后的单一 `0032_add_deck_classifier.sql` 创建；同版另有独立的 `0033_harden_card_sync.sql`
> 性质：需要停写、备份、结构迁移、种子 dry-run／apply、同版 API 与前端部署、管理端首次发布和玩家端验收
> 总迁移说明：[`3.9.9-to-3.10.0.md`](3.9.9-to-3.10.0.md)

## 1. 与“小能苗新卡同步”说明的关系

本说明与同目录的 [`cloudbase-new-card-sync-production.md`](cloudbase-new-card-sync-production.md) 保持独立，不合并。两者随 v3.10.0 同版上线，但风险边界不同：

- 小能苗同步需要额外的腾讯 CloudBase 密钥和 API 容器环境变量；
- 卡组分类不需要新的生产密钥，但需要 Postgres 迁移、外部种子包导入、首次发布和后台分类任务验收；卡牌使用率继续读取既有长期卡组观察，只新增独立的玩家展示设置，不依赖分类版本是否已经发布。

本次版本同时包含小能苗同步及其 `0033_harden_card_sync.sql`，还必须另行完成那份说明中的 `.env` 配置、迁移核对和无泄漏验证；不要因已完成本迁移而跳过密钥配置。

## 2. 交付物与固定事实

正式发布提交应包含：

- 唯一卡组分类迁移：`drizzle/0032_add_deck_classifier.sql`；
- 对应卡组分类快照：`drizzle/meta/0032_snapshot.json`；
- 同版后续还包含与卡组分类无关的 `drizzle/0033_harden_card_sync.sql` 及 `drizzle/meta/0033_snapshot.json`；
- `_journal.json` 中 `0032_add_deck_classifier` 的下一项、也是当前最新条目，应为 `0033_harden_card_sync`；
- 不应再存在 `0033_add_hidden_deck_classifier_display_mode.sql` 或 `0034_add_deck_environment_display_sections.sql`。

开发期的三份卡组分类迁移——`0032_add_deck_classifier.sql`、旧 `0033_add_hidden_deck_classifier_display_mode.sql`、旧 `0034_add_deck_environment_display_sections.sql`——均未进入生产，因此已在首次生产发布前压缩成单一最终 0032。这是未发布迁移的收束，不是在生产上删除或伪造迁移历史。当前正式的 `0033_harden_card_sync.sql` 是另一项新卡同步加固迁移，不是被压缩删除的旧卡组分类 0033。

初始种子包不进 Git，需要作为单独文件安全传给部署人：

- 文件名：`loveca_deck_classifier_codex_package.zip`
- 文件大小：79,461 bytes
- SHA-256：`629fcf85c71080b20427e31457563117b2a44d28e8408c7320d9d930508a2380`
- 预期内容：41 个分类、366 个样板（343 个启用、23 个 provisional 停用）、2 条严格规则、2 条仅作提示而忽略的软签名。

本功能不要求上传新卡图到对象存储。代表卡只保存现有 `cards.card_code`，玩家端继续使用现有卡图链路。

## 3. 强制前置检查

1. 固定本次发布的提交 SHA、API 镜像 digest、前端产物和上一版回滚镜像；完成仓库现行生产发布 Runbook 的质量门禁。
2. 确认生产从未执行当前 `0032_add_deck_classifier`，也从未执行已删除的旧 `0033_add_hidden_deck_classifier_display_mode` 或旧 `0034_add_deck_environment_display_sections`。如任意 `deck_classifier_*`、`deck_archetype_*` 或 `deck_classification_*` 表已存在，立即停止，不要继续执行压缩后的 0032，应先针对该环境单独核对迁移历史。
3. 确认本次发布源码的 Drizzle journal 顺序为 `0031_add_card_sync_jobs` → `0032_add_deck_classifier` → `0033_harden_card_sync`。生产如尚未执行 0031，`pnpm db:migrate` 会按 journal 顺序执行全部待执行迁移；应一并审查它们，不要只把 0032 或 0033 单独手工粘贴到生产。
4. 完成 Postgres 发布前备份，记录备份时间、文件位置、校验值和已验证的恢复命令。
5. 将平台切换到停写流程：先 `RESTRICTING_NEW_GAMES`，等待存量对局与必要后台写入收束，再进入 `MAINTENANCE`；确认未登录窗口和深链都显示维护页。
6. 停止旧 API，因为迁移会替换 `management_audit_logs` 的 scope 约束，且新 API 启动后会开始运行卡组分类 worker。
7. 确认发布环境有完整源码、锁定依赖和 devDependencies。`pnpm db:migrate` 与种子导入脚本不应假设能在精简 API runtime 镜像中运行。

可用以下只读 SQL 辅助确认“生产尚无卡组分类结构”；八项均应返回 `NULL`：

```sql
SELECT to_regclass('public.deck_archetypes');
SELECT to_regclass('public.deck_archetype_templates');
SELECT to_regclass('public.deck_archetype_rules');
SELECT to_regclass('public.deck_classifier_settings');
SELECT to_regclass('public.deck_classifier_releases');
SELECT to_regclass('public.deck_classification_runs');
SELECT to_regclass('public.deck_classification_assignments');
SELECT to_regclass('public.deck_classification_overrides');
```

## 4. 迁移文件检查

在固定的发布源码目录执行：

```bash
test -f drizzle/0032_add_deck_classifier.sql
test -f drizzle/meta/0032_snapshot.json
test -f drizzle/0033_harden_card_sync.sql
test -f drizzle/meta/0033_snapshot.json
test ! -e drizzle/0033_add_hidden_deck_classifier_display_mode.sql
test ! -e drizzle/0034_add_deck_environment_display_sections.sql
tail -n 20 drizzle/meta/_journal.json
sha256sum drizzle/0032_add_deck_classifier.sql
sha256sum drizzle/0033_harden_card_sync.sql
```

`sha256sum` 必须与最终提交附带的发布记录一致；不要仅凭本文的历史校验值跳过对最终 commit 的核对。如迁移文件、journal 或快照不符，停止部署。

当前交付版本中两份迁移的 SHA-256 为：

```text
7ac9cf3967f169fafd53668d745ed7c0f1335e53e20ab5d1ec2d89b14593869a  drizzle/0032_add_deck_classifier.sql
36c3467b0a96ba81d9318f8d15a436230dd7749326ad5f95aa405f19c52ec18e  drizzle/0033_harden_card_sync.sql
```

作者在最终合并／rebase 后应再次对最终 commit 中的文件计算校验值；如 SQL 内容因冲突解决而变化，以审查后最终 commit 的新校验值为准，并将变化记入发布记录。

## 5. 执行数据库迁移

从生产仓库根目录使用已核对的生产 `DATABASE_URL`。不要在命令或日志中回显完整连接串：

```bash
test -n "$DATABASE_URL"
pnpm install --frozen-lockfile
pnpm db:migrate
```

生产只使用 `db:migrate`，禁止用 `db:push` 替代。不要手工单独粘贴 0032 或 0033，也不要手工向 Drizzle 迁移表插入伪造记录。

> 注意：仓库的 `0000_baseline_current_schema.sql` 按设计不创建物理基线表。只有在搭建一套**全新的空白演练数据库**时，才应先对该临时库执行 `docker/init.sql`，然后再运行全部 Drizzle 迁移。本说明面向已经在运行的生产数据库，**生产迁移时不得重新执行 `docker/init.sql`**，否则可能与既有表和数据冲突。本次发布前应按“临时空库 → `docker/init.sql` → 全部 34 条迁移”的真实路径重新完成演练，并确认迁移序列成功执行至 0033。最终 0032 应成功建立 8 张卡组分类相关表；设置单例中的卡组环境应为 `HIDDEN / false / false / false`，卡牌使用率应为 `PLAYER_EQUAL / true / false / false`，共享高排名人数为 `30`。0033 的专项核对见同目录的小能苗同步说明。

迁移完成后执行以下只读核对：

```sql
SELECT id,
       display_mode, show_usage, show_winner, show_top_ranked,
       card_display_mode, card_show_usage, card_show_winner, card_show_top_ranked,
       top_ranked_player_count, draft_revision
FROM deck_classifier_settings;

SELECT
  to_regclass('public.deck_archetypes') AS archetypes,
  to_regclass('public.deck_archetype_templates') AS templates,
  to_regclass('public.deck_archetype_rules') AS rules,
  to_regclass('public.deck_classifier_releases') AS releases,
  to_regclass('public.deck_classification_runs') AS runs,
  to_regclass('public.deck_classification_assignments') AS assignments,
  to_regclass('public.deck_classification_overrides') AS overrides;

SELECT scope, count(*)
FROM management_audit_logs
GROUP BY scope
ORDER BY scope;
```

首次生产迁移后，`deck_classifier_settings` 应恰好有一行，且为：`id=1`；卡组环境 `display_mode=HIDDEN`、三个 `show_*` 均为 `false`；卡牌使用率 `card_display_mode=PLAYER_EQUAL`、`card_show_usage=true`、其余两个 `card_show_*` 为 `false`；共享 `top_ranked_player_count=30`、`draft_revision=0`。这保证种子、代表卡和首次发布未完成前，新的卡组环境保持隐藏，同时既有卡牌使用率继续以“玩家等权／使用占比”的原有口径展示。

## 6. 校验并导入初始种子

将外部 ZIP 放到发布机上不会被 Git 跟踪的受控路径，限制文件权限，然后核对校验值：

```bash
chmod 600 /secure/path/loveca_deck_classifier_codex_package.zip
sha256sum /secure/path/loveca_deck_classifier_codex_package.zip
```

期望 SHA-256：

```text
629fcf85c71080b20427e31457563117b2a44d28e8408c7320d9d930508a2380
```

先执行默认 dry-run。dry-run 只解析和校验 ZIP，不连接数据库：

```bash
pnpm deck-classifier:import-seed \
  --zip=/secure/path/loveca_deck_classifier_codex_package.zip
```

必须核对输出：

```json
{
  "catalogVersion": "2026-08-22-v1",
  "ruleVersion": "2026-08-22-v1",
  "archetypeCount": 41,
  "templateCount": 366,
  "activeTemplateCount": 343,
  "provisionalTemplateCount": 23,
  "ruleCount": 2,
  "ignoredSoftSignatureCount": 2,
  "apply": false
}
```

如数量或版本不符，停止导入。不要把用于方案讨论的 `loveca-ranked-volatility.zip` 当作种子包导入。

选择一个真实的平台管理员或赛季管理员 UUID 作为审计操作人：

```sql
SELECT id, username, role
FROM profiles
WHERE role IN ('admin', 'season_admin')
ORDER BY role, username;
```

确认操作人后再 apply。apply 会先按生产 `cards` 权威目录复核全部样板和严格规则：基础卡号必须存在，声明的 MEMBER／LIVE 类型必须一致，同一 `countSums` 合计条件也不得通过不同罕度重复引用同一基础编号。导入在单个 `SERIALIZABLE` 事务中执行，任一校验或写入异常都应整体回滚；遇到卡号或类型错误时应先修正权威卡牌数据或种子规则，不要绕过校验或直接修改分类表：

```bash
pnpm deck-classifier:import-seed \
  --zip=/secure/path/loveca_deck_classifier_codex_package.zip \
  --apply \
  --actor-user-id=<已核对的管理员UUID> \
  --reason=首次生产导入卡组分类种子
```

成功输出应包含 `committed: true`。然后执行：

```sql
SELECT count(*) AS archetype_count FROM deck_archetypes;
SELECT count(*) AS template_count,
       count(*) FILTER (WHERE enabled) AS active_template_count,
       count(*) FILTER (WHERE NOT enabled) AS disabled_template_count
FROM deck_archetype_templates;
SELECT count(*) AS rule_count FROM deck_archetype_rules;
SELECT display_mode, card_display_mode, draft_revision
FROM deck_classifier_settings
WHERE id = 1;
SELECT actor_user_id, actor_role, action, result, reason, created_at
FROM management_audit_logs
WHERE scope = 'DECK_CLASSIFIER'
ORDER BY created_at DESC
LIMIT 5;
```

首次导入的预期数据是 41／366／343／23／2，`draft_revision=1`，并且存在 `SEED_PACKAGE_IMPORTED` 成功审计记录。卡组环境 `display_mode` 仍应保持 `HIDDEN`；种子导入不得改变卡牌使用率的 `card_display_mode=PLAYER_EQUAL`。

## 7. 部署同版 API 与前端

使用已通过质量门禁的同一提交 SHA 部署 API 镜像和 `client/dist`。不得将新前端与旧 API，或新 API 与旧数据库混用。按现行发布 Runbook 记录上一版 API 不可变 digest，再拉取并重建 API 容器，部署前端并处理 Service Worker／CDN 缓存。

启动后检查：

```bash
docker compose ps
docker compose logs --tail=200 api
curl -fsS https://<生产域名>/api/health
curl -fsS https://<生产域名>/api/ready
```

日志中不应出现迁移缺失、无法读取 `deck_classifier_settings`、worker 循环异常或重复 RUNNING 任务。`/api/ready` 失败时不得解除维护。

## 8. 首次发布分类版本

迁移已默认完全隐藏玩家端卡组环境，因此应先保持隐藏，不要为了完成后台配置而提前开启展示。如整站维护页不允许进入普通管理页，可在 API 就绪后先切换到 `RESTRICTING_NEW_GAMES`，再用有权限账号完成卡组分类配置。

1. 以平台管理员或赛季管理员进入“运营管理中心 → 对局与赛季 → 卡组分类”。
2. 检查 41 个分类、366 个样板和 2 条严格规则；确认 23 个 provisional 样板保持停用。
3. 执行“全量预览”，记录可分类、未识别、冲突、无效和排除数量。异常时不要发布。
4. 输入可追溯的发布原因，发布首个分类版本。系统会先创建 `BUILDING` 发布和 `RELEASE_PUBLISHED` 任务，后台 worker 全量分类成功后才原子切换为 `ACTIVE`。
5. 等待页面明确显示任务 `SUCCEEDED` 和发布版本 `ACTIVE`；不要把 HTTP 202／“任务已受理”当作分类完成。
6. 为需要图片饼图的分类设置代表卡；代表卡和分类色为即时展示设置，不需要重新发布分类版本。卡图加载失败时会回退到分类色。
7. 在“发布与展示口径 → 玩家环境展示”中分别检查两块设置。保持“赛季卡组环境”全部取消，直到分类、代表卡、饼图和表格都已通过管理员验收；“赛季卡牌使用率”默认仍为“使用占比／玩家等权”，不依赖分类发布，可以单独验收和开关。
8. 最后分别选择两块模块需要向玩家展示的任意组合：使用占比、胜者构成、高排名玩家。两块模块的使用占比／胜者构成都可独立选择玩家等权、对局等权或两者均显示；任一块全部取消只隐藏对应模块。高排名默认取达到排行榜门槛的前 30 名，可设为 10–100，两块共享该 N，且高排名统计始终按玩家等权。

运营约束：新增或修改分类名、样板或规则只进入草稿，必须预览并发布后才影响分类。在当前版本中做人工归类时，只能选择已经进入当前 `ACTIVE` 发布快照的分类；如目标是新建的草稿分类，必须先发布新版本再人工归类，否则会形成“分类结果不在对应发布快照”的不一致数据。

## 9. 发布后数据核对

首次发布任务成功后执行以下只读 SQL。第一项应恰好有一个 `ACTIVE`且没有 `BUILDING`；第二项的最新任务应为 `SUCCEEDED`；后两项必须返回 0 行。

```sql
SELECT status, count(*)
FROM deck_classifier_releases
GROUP BY status
ORDER BY status;

SELECT run.id, release.version, run.trigger, run.status,
       run.total_count, run.processed_count, run.classified_count,
       run.unknown_count, run.ambiguous_count, run.invalid_count,
       run.excluded_count, run.error_message, run.finished_at
FROM deck_classification_runs AS run
JOIN deck_classifier_releases AS release ON release.id = run.release_id
ORDER BY run.created_at DESC
LIMIT 10;

SELECT assignment.release_id, assignment.archetype_id, count(*) AS invalid_assignment_count
FROM deck_classification_assignments AS assignment
JOIN deck_classifier_releases AS release ON release.id = assignment.release_id
WHERE assignment.status = 'CLASSIFIED'
  AND NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(release.snapshot_json -> 'archetypes') AS item
    WHERE item ->> 'id' = assignment.archetype_id::text
  )
GROUP BY assignment.release_id, assignment.archetype_id;

SELECT override.id, override.archetype_id, archetype.name, override.created_at
FROM deck_classification_overrides AS override
LEFT JOIN deck_archetypes AS archetype ON archetype.id = override.archetype_id
WHERE override.revoked_at IS NULL
  AND override.target_status = 'CLASSIFIED'
  AND NOT EXISTS (
    SELECT 1
    FROM deck_classifier_releases AS release,
         jsonb_array_elements(release.snapshot_json -> 'archetypes') AS item
    WHERE release.status = 'ACTIVE'
      AND item ->> 'id' = override.archetype_id::text
  );
```

使用普通玩家账号或未登录视角完成最小验收：

1. “赛季卡组环境”设置为“完全不展示”时，整个卡组环境面板（包括饼图和下方表格）不出现，但不应连带隐藏卡牌使用率；“赛季卡牌使用率”全部取消时也只隐藏卡牌模块。
2. 两块模块分别开启任一展示组合后，各自只出现被启用的 TAB；多个内容可正常切换，一块设置变化不改变另一块的 TAB 或计权方式。
3. 卡组饼图中有代表卡的分类使用卡图铺满扇区，加载失败时回退到分类色；LIVE 卡应展示主画面而非底部分数／Heart／效果区。
4. 卡组环境的使用占比、胜者构成和高排名饼图各项比例合计应接近 100%（只容许显示四舍五入差异）。卡牌使用率表示“某群体的卡组采用该卡的比例”，不是卡槽分布或单卡胜率，各卡比例不要求合计为 100%。
5. 卡牌使用率的使用占比、胜者构成和高排名玩家分别拥有独立 Top 30；切换计权后应读取对应榜单，不能只是重排同一份总体 Top 30。
6. 高排名样本显示共享配置的 N、实际达到排行榜门槛的人数和其中有可分析卡组的人数；卡组和卡牌两块的高排名群体定义应一致。
7. 卡组表格的出场、胜率和非镜像胜率正常，未识别与分类冲突仍作为系统分类显示。

完成后再将平台恢复到 `NORMAL`。如短期内不打算向玩家开放饼图，可以在保持“完全不展示”的前提下恢复平台其他功能，以后再由管理员完成代表卡和展示口径。

## 10. 回滚与故障处理

### 迁移或种子导入阶段失败

- 保持 `MAINTENANCE`，不部署新 API，不解除维护。
- 种子 apply 使用单个可串行化事务，失败时应无部分导入；仍应用读取 SQL 核对表行数和审计记录。
- 不要手工删除 Drizzle 迁移记录后重试，不要用 `db:push` “修复”。先保留日志和数据库现状核对失败点。
- 如需要精确恢复迁移前状态，在确认新版本没有产生需要保留的写入后，停止 API 并使用发布前 Postgres 备份整库恢复。

### 已迁移，但新版本应用故障

- 先保持卡组环境为 `HIDDEN`，按现行发布 Runbook 回滚前端和 API 到部署前记录的不可变版本／digest。
- 0032 除扩展 `management_audit_logs` scope 检查外主要是新增表、索引和外键；0033 为 `card_sync_runs` 增加租约字段，并为卡号格式及非负数值增加约束。旧 API 不会读取卡组分类表，但数据库已经同时向前迁移到 0033。紧急应用回滚时可以暂时保留已执行的迁移，但必须在发布记录中明确数据库版本；不要重复执行或改写已应用的 0032／0033。
- 如必须完全回到迁移前数据库，只使用发布前备份恢复；该操作会丢失备份之后所有生产写入，必须单独审批 RPO／数据丢失范围。

### 卡组分类或玩家环境展示异常

- 优先在“卡组分类 → 发布与展示口径”只将异常模块的展示内容全部取消：卡组环境和卡牌使用率可以分别隐藏，不删除分类数据或长期卡组观察。若无法确定异常范围，可临时将两块都隐藏。
- 发布任务失败时，既有 `ACTIVE` 版本继续服务；首次发布失败时没有 `ACTIVE` 版本，但由于展示仍为 `HIDDEN`，玩家端不应出现不完整结果。
- 如报错“卡组分类结果不在对应发布快照中”，先执行第 9 节的两个不一致查询；撤销指向未发布草稿分类的人工锁定，等待对应重分类任务 `SUCCEEDED`，或先正式发布包含该分类的新版本；不要直接改写 assignments。

## 11. 生产禁止项

- 禁止在生产运行 `pnpm deck-classifier:seed-test-fixtures`；该脚本仅用于 localhost 生成约 50 场假对局。
- 禁止将 `loveca-ranked-volatility.zip` 作为种子导入。
- 禁止将本地测试数据库、fixture 账号、“测试”分类或本地人工锁定复制到生产。
- 禁止为了让饼图显示而直接手工修改 `deck_classification_assignments`、release snapshot 或迁移记录。
- 禁止在卡组分类仍为草稿／`BUILDING`、任务失败、快照完整性校验失败或不一致查询返回非零行时开启玩家展示。

## 12. 最终验收清单

- [ ] 生产前备份可用，恢复命令已记录。
- [ ] 迁移前确认生产无任何卡组分类表，源码中的卡组分类迁移只有最终 0032，journal 最新条目为独立的 `0033_harden_card_sync`。
- [ ] `pnpm db:migrate` 成功执行至 0033；设置单例中的卡组环境初始为 `HIDDEN`，卡牌使用率初始为 `PLAYER_EQUAL + 仅使用占比`。
- [ ] 种子 ZIP 校验值和 dry-run 数量全部一致。
- [ ] 种子 apply 已通过生产 `cards` 权威目录校验并成功提交，数据库数量为 41／366／343／23／2，审计记录存在。
- [ ] 同一 SHA 的 API 和前端已部署，`/api/health` 和 `/api/ready` 正常。
- [ ] 首次预览已审核，发布任务为 `SUCCEEDED`，恰好一个发布版本为 `ACTIVE`。
- [ ] 不一致 assignment 和不合法人工锁定查询都返回 0 行。
- [ ] 代表卡、卡图回退、两块独立 TAB／计权、共享高排名 N、卡组表格与卡牌独立 Top 30 已验收。
- [ ] 只在对应检查通过后才保存各自的玩家展示组合；卡组分类尚未验收时至少保持卡组环境完全隐藏。
- [ ] 同版含小能苗同步时，已另行完成那份密钥与容器注入说明。
