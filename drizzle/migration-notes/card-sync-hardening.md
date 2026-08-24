# 上游新卡同步加固迁移说明

> 适用范围：`0033_harden_card_sync.sql`、运营管理中心“上游新卡同步”

## 迁移内容

`0033` 为 `card_sync_runs` 增加 lease generation、随机 token 和到期时间，用于心跳、超时回收和旧 worker fencing。迁移同时为 `cards` 增加规范卡号以及 `cost` / `blade` / `score` 非负约束。它不连接 CloudBase、不执行卡牌同步，也不修改任何 CloudBase 数据。

四个 `cards` CHECK 使用 `NOT VALID`：PostgreSQL 会立即约束迁移后的新增和更新，但不会因历史卡牌的旧格式阻断本次发布。本次不在运行时为旧卡号增加 fallback；历史数据清理和 `VALIDATE CONSTRAINT` 应在独立停机窗口完成。

商品代号中 `sd` / `bp` / `cl` / `pb` 后接一位或多位数字即符合格式，未来 `bp9`、`bp10` 等新商品无需再修改代码或迁移；`PR` 和 `E` 保留为固定代号。这一放宽只针对商品编号，卡号的四段结构、系列前缀、序号和稀有度仍须通过校验。

## 发布前检查

停止旧 API worker 和人工同步脚本后，备份 PostgreSQL，再用只读 SQL 记录历史异常数量：

```sql
SELECT count(*) AS invalid_card_codes
FROM cards
WHERE card_code !~ '^(PL!|PL!S|PL!N|PL!SP|PL!HS|PL!SIM|LL|IKZL|PYHN)-((sd|bp|cl|pb)[0-9]+|PR|E)-([0-9]{3}|E[0-9]{2,})-(SD|SD2|N|R|R[+]|P|P[+]|AR|CL|L|L[+]|SEC|SEC[+]|SECL|SECE|SECS|PR|PR[+]|PP|DUO|SRL|PE|PE[+]|RE|SRE|RM|LLE)$';

SELECT count(*) AS negative_rule_fields
FROM cards
WHERE cost < 0 OR blade < 0 OR score < 0;

SELECT id, status, lease_generation, lease_token, lease_expires_at
FROM card_sync_runs
WHERE kind = 'APPLY' AND status IN ('QUEUED', 'RUNNING');
```

如果存在活动 APPLY 任务，不要在旧 worker 仍运行时迁移或手工改状态，应先确认其停止边界。历史异常只记录与分类，本次发布不自动改写。

## 发布顺序

1. 在旧 API 和人工新卡脚本均停止的窗口执行 `pnpm db:migrate`。
2. 使用只含 `CLOUDBASE_ENV_ID`、`CLOUDBASE_SECRET_ID`、`CLOUDBASE_SECRET_KEY` 正式变量的仓库外 `.env`；旧别名不再被服务端接受。
3. 部署同一提交的 API 与前端，启动后先确认无活动任务时租约字段为空。
4. 第一次只执行“检查新卡”，核对非规范卡号、负数字段、图片冲突和阻断项；确认无误后再创建正式任务。

## 后续验证历史约束

历史异常在独立迁移中清理并审核后，再逐条执行：

```sql
ALTER TABLE cards VALIDATE CONSTRAINT cards_card_code_format_check;
ALTER TABLE cards VALIDATE CONSTRAINT cards_cost_non_negative_check;
ALTER TABLE cards VALIDATE CONSTRAINT cards_blade_non_negative_check;
ALTER TABLE cards VALIDATE CONSTRAINT cards_score_non_negative_check;
```

如果任一验证失败，保留 `NOT VALID` 状态并根据查询结果制定明确的人工修复策略；不得为绕过历史异常而放宽新卡运行时验证。
