# AI 调试对局来源

> 文档类型：专题说明
> 适用范围：AI_DEBUG 对局来源的停机迁移与回退边界
> 当前状态：待按目标环境发布流程执行；测试不代表生产迁移

`0039_add_ai_debug_match_origin.sql` 只扩展现有 `match_records_origin_kind_check`，允许 `AI_DEBUG`。不新增表、列或历史回填。对局仍使用 `match_mode = ONLINE`、`automation_game_mode = DEBUG`，系统参与者沿用 `SYSTEM / owner_user_id`。

发布时按既有停机迁移流程停止旧写入、备份并执行迁移，再部署新版本。迁移前确认 CHECK 只含现有四种来源；迁移后验证四种旧来源与 `AI_DEBUG` 均可写入、未知来源仍被拒绝。历史读取和传输沿用原字段，页面根据来源显示“AI 调试”。回退到旧版本前必须先处理已经存在的 AI 调试记录；不得让旧运行时静默改写或误标来源。

排位结算入口只接受 `RANKED`；长期卡组观察来自排位结果，主题赛季统计通过已有 `theme_table_assignments` 关联。AI 创建流程不取得排位或主题赛季席位，因此不会进入这些统计。不增加统计排除字段。

隔离库的迁移、权限、持久封存与普通回放验证入口见 [AI 完整环境验证](../../docs/ai-battle/full-environment-validation.md)。
