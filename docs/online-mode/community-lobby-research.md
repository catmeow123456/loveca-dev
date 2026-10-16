# 熟人社区对战大厅调研

> 文档类型：专题调研
> 适用范围：休闲匹配、房间约战、活跃对局发现及大厅 UI 的方案依据
> 当前状态：需求与设计输入；不代表已实现或已通过玩家验证
> 调研日期：2026-10-16

## 1. 调研结论

建议将「公共牌桌」和「房间联机」合并为一个「对战大厅」，采用以房间为核心的组织方式。玩家能够看到谁在等人、谁正在对战，可以直接加入、创建房间或观战；「找对手」从同一批公开等人房间中自动选择，没有合适房间时再创建一个公开等人房间。

这是一项业务模型重构：公开找人与手动选房共享供给，好友约战保留凭链接或房间号加入的独立访问范围。排位、娱乐活动继续使用各自的匹配规则。

产品案例支持这些交互模式可行，HCI 研究支持活动可见性、识别与反馈等设计原则。它们不能证明本方案一定提高 Loveca 的开局率；最终布局、默认设置和操作效率仍需按[需求文档](community-lobby-requirements.md)进行本地玩家测试。

## 2. 重构前基线与约束

以下是重构前 `c7e641bc` 的仓库代码基线，不是生产使用数据。相关旧页面已随统一大厅移除；保留此表用于解释设计动机，当前模块与入口以[大厅设计](community-lobby-design.md)为准。

| 重构前事实 | 基线代码依据 | 对重构的影响 |
| --- | --- | --- |
| 首页平行提供公共牌桌、房间联机和房间观战 | `client/src/components/pages/HomePage.tsx` | 导航需要围绕玩家任务收敛 |
| 公共牌桌先锁组、持久候场、双方确认，之后创建封闭房间 | `src/server/services/public-table-service.ts`、`src/server/services/online-room-service.ts` | 仅在前端拼接两页，仍会留下两个等人池 |
| 手建房先创建，再加入、锁组、准备 | `client/src/components/pages/OnlineRoomPage.tsx` | 两条路径的准备语义也需要统一 |
| 普通房间与对局运行态主要在进程内；候场票据、预留和跨模式占用在 PostgreSQL | `src/server/services/online-room-service.ts`、`src/server/services/gameplay-participation-service.ts` | 大厅持久化不能被描述为进行中对局已经可跨进程恢复 |
| 房间号观战按玩家视角授权，当前需先知道房间号 | `client/src/components/pages/OnlineSpectatorLobbyPage.tsx`、`src/server/routes/online.ts` | 房间摘要、房间可发现性与观战授权必须分开 |
| 现有匹配服务同时承载休闲、排位和主题队列 | `src/server/services/public-table-service.ts` | 休闲改造不能删除共享的赛季能力 |
| 玩家跨模式占用有数据库唯一约束与服务逻辑 | `src/server/services/gameplay-participation-service.ts` | 新入口必须复用统一占用，避免重复坐席 |

用户明确的产品定位是熟人社区。低并发、反复遇到熟人、从站外群聊约战，是本方案采用的场景假设；没有将它们写成已经统计确认的用户行为。

## 3. 产品案例

### 3.1 Board Game Arena 自动与手动建桌互通

BGA 在 2017 年的官方公告中解释，原大厅出现桌子频繁增减、限制难理解和移动端选桌困难；新简单大厅自动建桌和匹配，并与原高级大厅兼容。这是历史设计案例，不用于描述 2026 年每个页面的具体布局。[BGA 官方公告](https://en.boardgamearena.com/news?id=341)

对 Loveca 的启示：保留低操作成本的「找对手」，同时让自动与手动方式共享供给。公告没有公开完整配桌算法，不能据此断言它采用本方案的具体事务或优先级规则。

### 3.2 Cockatrice 在同一列表中发现和进入对局

Cockatrice 的官方源码 `GameSelector` 在同一对局列表旁提供创建、加入与观战操作；快速筛选工具栏分别处理已满与已开始的对局。[对局列表源码](https://github.com/Cockatrice/Cockatrice/blob/master/cockatrice/src/interface/widgets/server/game_selector.cpp)、[筛选工具栏源码](https://github.com/Cockatrice/Cockatrice/blob/master/cockatrice/src/interface/widgets/server/game_selector_quick_filter_toolbar.cpp)。这些是调研日开发分支的实现证据，不代表每个已发布版本。

官方协议文档另行确认建房描述、加入限制与观战权限是不同字段。[官方协议文档](https://cockatrice.github.io/docs/dc/d97/room__commands_8proto_source.html)。[官方入门 Wiki](https://github.com/Cockatrice/Cockatrice/wiki/Getting-Started)明确提示内容陈旧，不将它当作上述列表和筛选能力的主要证据。

它与 Loveca 同属卡牌社区工具，最值得借鉴的是围绕真实对局对象组织行为；不引入它的全信息观战、复杂格式筛选和好友关系系统。

### 3.3 Tabletop Simulator 区分公开与受限房间

TTS 官方更新说明区分 public、friends、invite 三类服务器，并描述在服务器浏览器中优先取得好友服务器。这里参考的是访问范围和熟人可发现性的分离。[官方更新说明](https://www.tabletopsimulator.com/news/patch-notes/v12-4-0-line-tool-revamp-ghost-preview-tags-physics-improvements-and-more)

Loveca 没有因此获得好友鉴权能力。首版只提供「公开找人」和「凭链接加入」两种方式；第二种不能标成“仅好友”，也不能承诺链接转发后仍只有指定好友能进入。

### 3.4 PlayingCards.io 保留轻量的站外约战

PlayingCards.io 官方快速指南采用创建房间、取得房间码、分享给其他玩家的流程，并将交流留给外部工具。[官方快速指南](https://playingcards.io/docs/overview)

这一案例支持保留房间号和可复制链接。熟人社区已有的群聊可以继续承担约人的作用，首版无需同时建设全站聊天、社交关系和私信。

### 3.5 Lichess 在统一产品中保留不同意图

调研日的官方首页包含创建大厅对局、挑战好友，以及观看当前对局的入口。[Lichess 官方首页](https://lichess.org/)

这说明统一目的地仍可保留不同任务。由于棋类是完全信息游戏，不能将其对局预览和观战权限直接套到 Loveca 的隐藏信息对局。

## 4. 研究与设计系统依据

### 4.1 活动可见性与熟人社区

Erickson 与 Kellogg 在 ACM TOCHI 2000 的 Social Translucence 研究中讨论可见性、相互感知与责任感。论文中的 Babble 部署包括成员大多互相认识的小群体，也讨论公开活动与私人活动的可见边界。[IBM Research 摘要](https://research.ibm.com/publications/social-translucence-an-approach-to-designing-systems-that-support-social-processes)、[论文全文，尤其印刷页 73–75（PDF 第 15–17 页）](https://smg.media.mit.edu/library/erickson2000.pdf)

本项目推导：房间列表应展示参与者昵称与真实状态，帮助玩家理解社区此刻的活动；私人约战不因“增加热闹感”被公开。研究对象是协作交流系统，不能外推为游戏留存的量化证明。

### 4.2 识别优先于回忆

NN/g 说明，可见选项和上下文能降低从记忆中自行提取信息的负担。[Memory Recognition and Recall](https://www.nngroup.com/articles/recognition-and-recall/)

本项目推导：公开房间以昵称、状态、人数呈现，玩家无需记房间号；房间号继续服务于定向约战。

### 4.3 状态反馈与渐进展开

NN/g 的系统状态可见性原则要求及时反馈操作结果；渐进展开建议先呈现主要任务，把次要或复杂设置放到后续层级。[系统状态可见性](https://www.nngroup.com/articles/visibility-system-status/)、[渐进展开](https://www.nngroup.com/articles/progressive-disclosure/)

本项目推导：我的候场／确认／房间状态固定在同一位置；选择卡组和建房设置按操作展开；刷新失败保留已有房间并标记旧数据，不展示虚假的空大厅。

### 4.4 列表与表格的组件依据

Carbon 的数据表规范将标题、工具栏、列头与行区分，并说明搜索、筛选、分页和行操作的位置；少量行操作可保持直接可见。[Carbon 数据表](https://www.carbondesignsystem.com/building-blocks/core/components/data-table/guidelines)

本项目推导：桌面采用对齐的房间行与可见行操作，移动端结合 WCAG Reflow 重排为纵向列表；不复制 Carbon 的视觉主题。具体列宽、信息顺序、排序与断点属于 Loveca 的设计选择，不是组件规范给出的游戏大厅结论。

### 4.5 无障碍基线

WCAG 的状态消息要求支持辅助技术感知不抢焦点的反馈；Reflow 涵盖等效 320 CSS px 的重排；2.5.8 的最小指针目标是 24×24 CSS px 并有例外。[状态消息](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html)、[重排](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html)、[目标尺寸](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)

Loveca 继续采用既有 44px 控件目标，作为项目更宽裕的触控设计值；不将 44px 错写成 WCAG 2.5.8 的统一强制下限。

### 4.6 选组与建房弹层

W3C APG 的模态弹层模式要求弹层打开后获得内部焦点，Tab 与 Shift+Tab 在弹层中循环，Escape 关闭，关闭后通常将焦点交回触发控件；长内容可先聚焦标题。[W3C APG Dialog 模式](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/)

本项目推导：选组、建房与房间号查找采用带标题的原生模态弹层，手机使用可滚动的底部布局。底部形态和尺寸是项目取舍，APG 支持的是键盘和语义行为；浏览器检查也不能替代真人读屏测试。

## 5. 候选方向与取舍

| 方向 | 玩家体验 | 业务复杂度 | 结论 |
| --- | --- | --- | --- |
| 只把两个入口放进同一页 | 找人仍分队列与手建房，等待可能互相看不见 | 低 | 可作施工中的内部过渡，不算完成统一 |
| 公开房间列表，取消自动找人 | 对熟人挑房友好，新人每次都要自己选或建 | 中 | 保留发现能力，补回自动操作 |
| 同一房间池，自动或手动选择 | 两种操作共享公开等待供给，房间全程可识别 | 较高 | 推荐目标 |
| 仿大型竞技游戏，默认只有隐藏队列 | 操作少，但熟人活动和观战发现弱 | 中 | 与本次社区诉求匹配较差 |

推荐方案的复杂度集中在统一坐席认领、准备、恢复和赛后再战；它不要求重写规则引擎或进行全站社交重构。

## 6. UI 选择与依据对应

| UI 决策 | 外部依据 | Loveca 适配 |
| --- | --- | --- |
| 首屏直接看到等人和进行中房间 | Cockatrice；Social Translucence | 昵称优先，隐藏信息和私房不进入摘要 |
| 「找对手」与选房并存 | BGA | 同一供给池；默认操作自动选房 |
| 我的当前状态在上方持续可见 | NN/g 状态反馈 | 同一位置从候场变为确认、返回房间 |
| 建房通过局部弹窗完成 | NN/g 渐进展开；PlayingCards.io | 展示卡组、访问方式和必要的观战设置 |
| 桌面对齐行、手机纵向列表 | Carbon；WCAG Reflow | 复用现有产品视觉 token，减少窄屏横向滚动 |
| 弹层可用键盘完成与退出 | W3C APG Dialog | 初始焦点、内部循环、Escape 与归还焦点 |
| 公开与凭链接加入明确分开 | TTS；PlayingCards.io | 不引入尚不存在的“仅好友”权限 |
| 后台更新不频繁重排列表 | BGA 对动态列表困难的历史说明；NN/g 反馈原则 | 冻结阅读顺序，提供新房间提示；具体机制为本项目设计 |

## 7. 需要验证的产品假设

1. 玩家看到昵称和真实对局状态后，更容易决定加入或观战。
2. 默认「找对手」配合可见列表，比两个功能入口更容易理解。
3. 玩家能够理解公开找人同时接受直接加入和自动配对。
4. 局部选组流程能兼顾首次用户与熟人反复开局。
5. 私房不公开、公开房间逐人授权观战，符合社区成员的预期。

这些假设没有被外部案例自动验证。任务式测试、观测口径与上线验收分别见[需求](community-lobby-requirements.md)和[设计](community-lobby-design.md)。
