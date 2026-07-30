# 赛季排位管理员 API

> 文档类型：专题说明
> 适用范围：赛季排位管理员 HTTP 契约、权限边界与管理页面职责
> 当前状态：首批服务端接口与精简管理前端已实现，尚未部署生产
> 最后更新：2026-07-30

## 1. 边界

管理员接口统一挂载在 `/api/admin/ranked`，整组路由要求已登录且角色为
`admin`。本批只提供赛季运营、异常结算和基础监控能力，不提供玩家排位入口，
也不允许管理员直接写玩家 rating、RD、场次或排行榜名次。

当前服务端注册表包含影子候选 `GLICKO1_PER_MATCH_SHADOW_V2`、既有正式版本
`GLICKO1_PER_MATCH_V1` 和新赛季默认版本 `GLICKO1_PER_MATCH_V2`。V2 只把新玩家
初始 RD 从 350 轻微下调到 300；V1 保留用于既有赛季确定性重建。创建、编辑和激活
持久赛季只能引用正式版本。正式算法仍必须通过代码审查显式加入注册表，不能由请求
上传完整评分参数；唯一开放的赛季级评分参数是软重置策略。默认
`RESET_TO_INITIAL` 使用所选正式算法的初始积分/RD；管理员可在草稿期选择
`RETAIN_TOWARD_CENTER` 并配置中心值、原积分保留比例和重置后最小 RD。
这些参数写入 `ratingConfig`、参与竞技环境哈希并在激活后冻结。

赛季另存 `leaderboardMinimumMatchCount`，允许 1–100，管理页面默认填写 10。它只
控制参榜资格，不参与 Glicko 计算，也不改变 `competitiveEnvironmentId`；管理员可在
草稿或进行中赛季的前端表单修改。

## 2. 接口

| 方法   | 路径                                    | 用途                                              |
| ------ | --------------------------------------- | ------------------------------------------------- |
| `GET`  | `/environment`                          | 查看当前卡牌目录、Shadow/正式算法及其竞技环境身份 |
| `GET`  | `/seasons`                              | 查看赛季列表及当前开放窗口、有效候场状态          |
| `GET`  | `/seasons/:seasonId`                    | 查看冻结环境与当前部署环境差异                    |
| `POST` | `/seasons`                              | 使用服务端正式算法创建 `DRAFT + PAUSED` 赛季      |
| `PUT`  | `/seasons/:seasonId/draft`              | 全量编辑草稿并重新冻结当前环境                    |
| `PUT`  | `/seasons/:seasonId/operations`         | 修改进行中赛季的名称、开放窗口和参榜场次门槛      |
| `POST` | `/seasons/:seasonId/activate`           | 校验当前部署环境后进入 `ACTIVE + PAUSED`          |
| `PUT`  | `/seasons/:seasonId/admission`          | 在 `ACTIVE` 中切换 `OPEN / PAUSED`                |
| `POST` | `/seasons/:seasonId/finalize`           | 结束赛季，进入 `FINALIZING` 并停止新匹配          |
| `POST` | `/seasons/:seasonId/close`              | 无待计分对局和未开局预留时完成赛季结算            |
| `GET`  | `/matches`                              | 按赛季、结算状态查看排位对局                      |
| `GET`  | `/matches/:matchId`                     | 查看对局及其追加式评分事件                        |
| `POST` | `/matches/:matchId/settle`              | 幂等重试权威结果结算                              |
| `POST` | `/matches/:matchId/corrections/preview` | 只读回放 `VOID / REPLACEMENT` 的全赛季影响        |
| `POST` | `/matches/:matchId/corrections`         | 追加并执行已经预览的更正                          |
| `GET`  | `/monitoring/summary`                   | 汇总各结算状态数量及最早结束时间                  |

赛季的 `queueAdmission=OPEN` 表示运营允许候场，不表示此刻一定可以入队。玩家侧
最终准入必须同时满足：

```text
lifecycle == ACTIVE
&& queueAdmission == OPEN
&& now 位于赛季起止时间和每周开放窗口内
```

因此管理员可以在开放窗口开始前恢复 `OPEN`，无需卡点操作；窗口外的有效准入仍
为关闭。

草稿创建/编辑请求中的软重置配置形态为：

```json
{
  "softReset": {
    "mode": "RESET_TO_INITIAL",
    "center": 1500,
    "retention": 0.5,
    "minimumDeviation": 200
  }
}
```

`RESET_TO_INITIAL` 不读取公式参数，直接使用所选正式算法的初始积分和初始 RD；
字段仍完整保存，便于管理员切换到 `RETAIN_TOWARD_CENTER`。保留模式按
`center + retention × (旧积分 - center)` 计算新积分，并把 RD 提升到至少
`minimumDeviation`、同时限制在算法允许范围内。服务端拒绝超出正式算法边界的参数。

## 3. 更正安全契约

更正分为两个明确步骤：

1. 预览接口读取当前 `ledgerRevision`，构造未落库的 `VOID` 或
   `REPLACEMENT`，确定性重放整个赛季，并返回受影响玩家的 rating、RD、场次差异。
2. 执行接口必须携带预览返回的 `currentLedgerRevision` 作为
   `expectedLedgerRevision`，并提供原因和稳定幂等键。

若预览后有任何新结算或其他更正推进了流水版本，执行会返回
`RANKED_CORRECTION_PREVIEW_STALE`，要求管理员重新预览。相同幂等键的成功请求可
安全重试；若同一幂等键被用于不同对局、动作、胜方或原因，服务端返回冲突。执行仍
只追加 `VOID / REPLACEMENT` 事件并重建派生投影，不修改或删除历史流水。

赛季状态变化、候场开关、结算重试和更正执行都会写结构化
`ranked_admin` 应用日志；评分更正还在不可变事件中保存管理员、原因和幂等键。

进行中赛季的运营编辑使用独立白名单接口，只接受
`name / openWindows / leaderboardMinimumMatchCount`。赛季标识、平台时区、起止
时间、最晚结算时间、规则、卡池、卡组政策、算法和竞技环境均不进入该请求，也不会被
对应 SQL 更新。`FINALIZING / CLOSED` 赛季不再接受此类修改。

## 4. 管理页面

管理员首页提供“赛季排位管理”入口。页面只保留两个一级区域：

- “赛季”：创建/编辑未开始赛季、开始赛季、修改开放中赛季的名称、开放时段与参榜
  场次门槛、开放/暂停匹配、结束赛季和完成结算；
- “对局处理”：按赛季查看等待计分或已计分对局，重试计分，并预览后执行不计分/改判。

页面不直接展示完整算法参数、环境哈希或大段运营说明；草稿表单只展示允许配置的软重置
策略及其参数，这些审计详情仍由 API 和日志完整提供。移动端隐藏非必要的主题按钮，
保留返回与刷新，避免标题和操作拥挤。

## 5. 尚未覆盖

- 告警渠道、时序指标和更细的结算延迟分桶。
- 独立的批量运营导出和赛季实验结论记录页面。
- 生产迁移、首季配置与实际告警阈值。

## 6. E2E 验证

`client/tests/e2e/ranked-admin-api.spec.ts` 在作者提供的完整测试环境中使用
Playwright 验证：

- 未登录返回 `401`、普通玩家返回 `403`；
- 真实发布卡牌目录能够生成稳定格式的卡池哈希和竞技环境身份；
- Shadow 版本创建被拒绝，正式 V1/V2 可以创建草稿，新建页面默认 V2；
- 赛季、对局处理和监控读取正常；
- 在本地测试数据库注入明确标记的 `ACTIVE` fixture 后，真实 API/事务可以完成
  `PAUSED -> OPEN -> FINALIZING -> CLOSED`，并在测试结束后清理 fixture；
- 管理员可以从首页进入精简管理页面；
- 管理页面可以创建、编辑并保存赛季草稿及参榜场次门槛；
- 管理页面可以修改进行中赛季的名称、开放时间和参榜场次门槛；
- 改判预览显示原胜方与新胜方，确认原因不足时使用表单校验，请求失败时在弹窗内显示；
- 双账号排位 E2E 另行覆盖票据、确认、开局、禁止重开、认输、自动结算、玩家战绩
  回显，以及填写原因后真实执行一次改判。

测试 fixture 强制校验数据库只能是本机 `5432/loveca`，不能指向远程或生产数据库。
