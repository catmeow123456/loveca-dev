# UI 设计文档索引

> 文档类型：总览文档
> 适用范围：前端 UI 规范、主题重设计、移动端适配和游戏桌交互设计相关文档
> 当前状态：现行专题导航；本主题新增长期文档时应同步更新

本目录集中维护 UI design 主题文档。游戏桌交互现状见 [游戏桌 UI 现状](game-table/current-state.md)，移动端差距见 [移动端差距分析](mobile-adaptation-gap-analysis.md)；全项目入口仍以 [Loveca 文档地图](../README.md) 为准。

## 推荐阅读顺序

| 文档                                                                                                      | 类型            | 维护边界                                                         |
| --------------------------------------------------------------------------------------------------------- | --------------- | ---------------------------------------------------------------- |
| [产品视觉系统与页面统一规范](product-visual-system.md)                                                    | 视觉设计规范    | 产品视觉语言、页面组织、导航、组件层级与体验要求                 |
| [前端 UI 开发规范](standard.md)                                                                           | 编码标准        | React 组件、主题 token、页面布局、覆盖层和产品文案规范           |
| [移动端适配需求](mobile-adaptation-requirements.md)                                                       | 需求文档        | 手机/平板布局、触控、覆盖层和移动端验收目标                      |
| [移动端现状差距清单](mobile-adaptation-gap-analysis.md)                                                   | 专题说明        | 移动端目标态与当前前端实现之间的差距和优先级                     |
| [对局入口卡组选择现状](deck-selection-entry-current-state.md)                                             | 专题说明        | 游戏准备、正式联机和联机调试入口的选组体验、当前事实与未落地项   |
| [社区对战大厅设计](../online-mode/community-lobby-design.md)、[交互原型](prototypes/community-lobby.html) | 设计文档 / 原型 | 现行大厅实现与状态交互原型；原型用示例数据，不作现行视觉基线     |
| [登录后主页候选原型](prototypes/player-home/index.html)                                                   | 对比原型        | C 已落地玩家大厅；此处保留候选与示例状态，不作规则实现基线       |
| [游戏桌 UI 现状](game-table/current-state.md)                                                             | 专题说明        | 当前 `GameBoard` / `PlayerArea` / `JudgmentPanel` 布局和交互事实 |
| [解决区行为](game-table/resolution-zone-behavior.md)                                                      | 专题说明        | 解决区局部交互定稿                                               |
| [卡组点击行为](game-table/deck-click-behavior.md)                                                         | 专题说明        | 卡组点击局部交互定稿                                             |

## 维护规则

- 当前 UI 编码约束优先写入 `standard.md`，不要让历史设计稿替代现行规范。
- 产品视觉语言、页面组织和体验要求写入 `product-visual-system.md`；页面原型按任务采用或调整，实施顺序由当前问题决定。
- 移动端目标写入 `mobile-adaptation-requirements.md`；当前差距写入 `mobile-adaptation-gap-analysis.md`。
- 游戏桌局部交互设计统一放在 `game-table/` 下，不再在 `docs/` 根层新增 `game-table-*` 或 `UI_*` 文档。
- 已被现行规范吸收、且不再对应当前实现的阶段性方案直接从主题索引移除；需要追溯时使用 Git 历史，不长期保留并列权威。
