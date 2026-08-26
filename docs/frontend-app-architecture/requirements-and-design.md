# Loveca 前端外层架构重构需求与设计

> 文档类型：历史/计划文档
> 适用范围：公开首页、登录后大厅、业务子页面、对局页面及其返回链路的前端外层重构
> 当前状态：实施中；P1/P2 与阶段 A 观测基线已进入开发基线，阶段 B–E 待实施

日期：2026-08-25

## 1. 背景与结论

用户频繁反馈：从大厅进入卡组、对局准备、排位、娱乐模式、历史等页面，或从对局返回大厅/准备页时，会经历一段明显的刷新和重新加载。部分入口还会触发真正的浏览器整页重载。

本次代码审计确认，这不是单个接口慢或单个 loading 样式不佳，而是以下问题叠加：

1. `client/src/App.tsx` 以 `currentPage` 和大量条件分支手写页面切换，没有正式路由树。
2. 页面切换会卸载旧页面、挂载新页面；大厅、对局准备、卡组、排位等页面在每次挂载时主动重新请求数据。
3. 项目没有统一的服务端数据缓存层。Zustand store 的缓存、请求合并、失效和 loading 语义各不相同。
4. 分享卡组、观战等同源入口仍使用 `window.location.href`，会重新执行完整应用启动链。
5. 全量卡池启动请求使用 `getAllCards(true, 'PUBLISHED')`，绕过了 `cardService` 现有内存缓存。
6. 根入口同步导入 `gameStore`，后者同步导入 `GameSession`、命令层和完整卡效运行时，使大厅也承担对局引擎的下载、解析和初始化成本。
7. 根级 `Suspense` 会在首次加载懒页面时用整屏 loading 替换整个应用。
8. PWA 使用自动更新、`skipWaiting`、`clientsClaim`，并在 `controllerchange` 后直接刷新页面，发布期间可能打断对局或编辑。

生产构建基线：

- 初始 JS 为 `4,010,638 bytes` minified / `895,981 bytes` gzip。
- `GameBoard` 独立 chunk 为 `492,326 bytes` / `103,555 bytes` gzip。
- PWA 预缓存为 86 项、`9,872,403 bytes`。
- 构建成功，但 Vite 报告初始 chunk 超过 500 KB。

结论：需要进行一次中等规模的前端架构重构，但不需要重写游戏规则内核，不需要迁移到 Next.js/SSR，也不需要采用微前端。重构重点是正式路由、服务端数据缓存、持久应用壳层、对局运行时拆包和安全的 PWA 更新流程。

## 2. 目标

### 2.1 用户体验目标

- 登录后站内导航不再触发浏览器整页重载。
- 从对局返回大厅或准备页时，已有卡组、赛季等数据立即可见。
- 后台刷新不得清空已有内容或替换为整屏加载页。
- 首次进入一个懒加载子页面时，顶栏和当前应用壳层保持可见。
- 浏览器前进、后退、刷新和深链接具有一致行为。
- 应用更新不得在进行中对局、卡组编辑或未提交表单中自动刷新页面。
- 公开首页不加载完整本地对局引擎和卡效运行时。

### 2.2 工程目标

- 明确区分服务端状态、对局权威状态、静态参考数据和局部 UI 状态。
- 对相同 query 的并发请求进行合并，并提供统一 freshness、失效和重试策略。
- 数据 mutation 后只失效受影响的 query，不依赖页面重新挂载刷新全部内容。
- 路由、权限边界、错误边界、loading 边界和预加载策略集中声明。
- 保留现有 `GameSession` / `GameService` / command 权威规则边界。
- 本地调试、对墙打、正式联机、观战和回放继续复用 `GameBoard` / `PlayerArea`。

## 3. 非目标

- 不重写游戏规则、卡效框架、服务端房间或历史记录模型。
- 不把所有 Zustand store 一次性替换掉。
- 不为“保活”而将所有页面永久挂载并用 CSS 隐藏。
- 不为了该问题引入 SSR、React Server Components 或微前端。
- 不在本次重构中改变卡牌规则、对局协议或隐藏信息投影。
- 不通过延长动画、增加过渡遮罩来掩盖真实的重复请求。
- 不为计划内发布建立新旧前端/服务端协议的长期兼容、dual-read 或双版本并行路径。
- 不在本次重构中实现“服务中断后恢复进行中对局”。计划内发布继续以限制新开局、排空对局与候场、停机迁移和部署为前提；意外故障下的正式联机运行态恢复仍属于独立缺口。

## 4. 设计原则

### 4.1 状态按职责分层

| 状态类型     | 示例                                               | 目标归属                                                                     |
| ------------ | -------------------------------------------------- | ---------------------------------------------------------------------------- |
| 路由状态     | 当前页面、路径参数、筛选 query、浏览器历史         | React Router                                                                 |
| 服务端状态   | 云端卡组、徽章、历史列表、赛季概览、娱乐模式节目单 | TanStack Query                                                               |
| 对局状态     | 权威快照、命令、轮询序号、pending effect、动画反馈 | battle Zustand store                                                         |
| 静态参考数据 | 已发布卡池、PT 限制表、公开配置                    | 版本化 Query Cache；必要时持久化公开数据；轻量 catalog 层只提供索引/selector |
| 局部 UI 状态 | 弹窗、表单输入、当前选择、临时反馈                 | 组件 state 或窄 UI store                                                     |

Zustand 继续用于对局和复杂本地交互；TanStack Query 负责“服务端是事实来源”的数据。不得把所有数据强行放入同一种状态工具。

同一份数据只能有一个客户端事实来源。卡池原始快照归 Query Cache；如需按卡号建立 `Map`、图片路径索引或领域适配对象，应由同一 query 结果派生并按 revision 记忆化，不能再建立一套独立请求、freshness 和失效生命周期。

排位/娱乐模式最终按服务端字段职责拆分：赛季、榜单、节目单和环境统计等普通概览归 Query Cache；候场票据、心跳、确认倒计时、配对预留和房间进入协调归实时 store。当前服务端响应仍将普通概览与 `queue` 组合在同一个 `overview` 中，因此迁移必须遵守以下过渡契约：

1. 在服务端提供独立普通概览与实时状态读取契约前，现有 combined `overview` 继续完整归对应实时 store，不提前复制一份到 Query Cache。
2. 完成接口拆分后，Query 只接收不含实时字段的普通概览 DTO，实时 store 只接收候场/确认/房间协调 DTO；两者可以共享同一底层 transport 类型定义，但不得保存对方字段。
3. 禁止 queryFn 以副作用写 Zustand，也禁止实时 store 通过订阅 Query Cache 镜像普通概览。mutation 可以分别使用 `setQueryData` 更新普通概览、使用命令结果更新实时状态，但每个字段只能写入其唯一所有者。
4. 若本批不调整服务端读取契约，则排位/娱乐模式普通概览从阶段 B 的 Query 迁移清单中顺延，不以临时双写换取表面完成。

### 4.2 stale-while-revalidate

页面存在缓存时立即展示缓存数据，在后台按 freshness 策略刷新。只有“没有任何可展示数据”的冷启动才使用骨架屏。

`staleTime` 只决定数据何时需要后台刷新，`gcTime` 决定页面卸载后缓存能否保留。两者必须按 query family 同时声明。卡组、赛季入口等返回页数据的 `gcTime` 必须覆盖观测到的 P95 对局时长再加至少 30 分钟余量，否则玩家打完一局返回时仍会退化为冷启动。阶段 A 尚未形成可靠时长数据前，卡组等核心返回页 query 暂按 2 小时保留，不把未经验证的“典型对局”作为 60 分钟阈值依据。

统一区分：

- `pending`：首次读取且没有数据。
- `fetching`：已有数据时后台刷新。
- `mutating`：用户提交写操作。
- `error with data`：刷新失败但仍可展示旧数据。
- `error without data`：冷启动失败，需要错误页或局部重试。

### 4.3 缓存数据而不是缓存页面组件

页面切换后可以正常卸载。需要保留的是服务端数据、必要的筛选/滚动位置和未完成草稿，而不是整个页面 DOM。这样可避免隐藏页面继续轮询、订阅和保留大量卡图节点。

### 4.4 对局实时性独立处理

正式对局、房间状态和候场状态不能直接套用普通页面的长 `staleTime`。它们继续采用权威快照、序号去重、短轮询/心跳或未来 WebSocket，并在应用 layout 中保持必要的全局协调器。

## 5. 目标架构

```text
main.tsx
└─ AppProviders
   ├─ QueryClientProvider
   ├─ Theme / Auth / PublicConfig bootstrap
   └─ RouterProvider
      ├─ PublicLayout
      │  ├─ 公开首页
      │  ├─ 登录/注册/验证
      │  └─ 共享卡组
      └─ SessionRoot
         ├─ Session Boundary（在线认证或离线身份）
         ├─ Permission Boundary（按路由）
         ├─ MatchmakingCoordinator（仅在线认证会话持久）
         └─ Outlet
            ├─ ProductLayout
            │  ├─ ProductFrame（持久）
            │  └─ Outlet
            │     ├─ 大厅
            │     ├─ 卡组
            │     ├─ 对局准备
            │     ├─ 排位/娱乐模式
            │     ├─ 观战大厅/历史/账户
            │     └─ 管理页面
            └─ BattleLayout
               ├─ 沉浸式对局壳层
               ├─ 按需加载 GameBoard
               └─ 仅本地裁判 surface 按需加载 localBattleRuntime
```

`SessionRoot` 表示已经形成可用玩家会话，不等同于必须登录：在线账号与离线身份都可以进入，但各路由再声明所需 capability。进入沉浸式对局时只卸载 `ProductFrame`，不会意外卸载当前会话状态；在线认证会话的候场协调器继续跨页面持久，离线身份不启动任何候场、心跳或房间恢复请求。

访问边界固定为：

- 公开首页、登录/验证、共享卡组和公开 token 观战属于 `PublicLayout`；token 观战建立独立授权边界，不复用玩家登录权限推断隐藏信息。
- `/decks`、`/battle/setup` 和 `/battle/local` 可以由在线账号或离线身份访问；离线身份只能读取本地卡组/公开卡池，不得触发云端卡组、候场、房间、排位、娱乐模式、历史或账户请求。
- `/rooms/*`、`/battle/matches/*`、公共牌桌、排位、娱乐模式、历史和账户要求在线认证；管理路由还必须通过 permission guard。
- `/battle/local` 在生产环境是否展示调试能力由显式 feature/capability 决定；隐藏入口不能代替路由 guard。刷新后没有可恢复本地运行态时展示明确不可恢复页，可返回准备页，不伪造新对局。
- 离线刷新只能复水已经验证且仍可读取的公开 catalog revision 与本地卡组。首次离线且不存在可用卡池快照时，明确提示需联网初始化，不以空卡池启动一个看似可用的对局。

### 5.1 建议路由

| 页面                  | 规范路径                                                          |
| --------------------- | ----------------------------------------------------------------- |
| 公开首页 / 登录后大厅 | `/`，由认证边界决定内容，不维护两套路由状态                       |
| 登录/注册/找回密码    | `/login`、`/register`、`/forgot-password`                         |
| 邮箱验证/重置密码     | `/verify-email`、`/verify-email-change`、`/reset-password`        |
| 卡组管理              | `/decks`                                                          |
| 卡组编辑              | `/decks/:deckId/edit`                                             |
| 对局准备              | `/battle/setup`                                                   |
| 房间                  | `/rooms/:roomCode`；当前房间从会话恢复后重定向到该规范路径        |
| 服务端权威对局        | `/battle/matches/:matchId`                                        |
| 本地调试对局          | `/battle/local`；刷新后没有可恢复运行态时返回明确提示，不伪造恢复 |
| 公共牌桌              | `/battle/public-table`                                            |
| 排位                  | `/ranked`                                                         |
| 娱乐模式              | `/theme-table`                                                    |
| 观战大厅              | `/online/spectate`                                                |
| 观战链接              | `/online/spectate/:token`                                         |
| 历史                  | `/history`                                                        |
| 历史详情/回放         | `/history/:matchId`、`/history/:matchId/replay`                   |
| 账户                  | `/account/:section?`                                              |
| 共享卡组              | `/decks/share/:shareId`                                           |
| 管理中心及子页面      | `/admin`、`/admin/*`，由 permission route guard 控制              |

`?page=...` 生成逻辑应停止使用。是否需要对已公开的旧链接提供临时服务端重定向，必须先确认其外部协议属性；如需保留，应使用有明确退役日期的 HTTP 重定向，不在 React 业务路径长期 dual-read。

从阶段 C 开始，URL 是站内导航的唯一事实来源。迁移中的旧页面可以暂时保留 `onBack` / `onNavigate...` props，但这些回调只能调用 `navigate()`；不得再让 `currentPage` 与 URL 双向同步。`openDeckId` 等具有刷新/返回价值的状态应进入规范路径或 query string，普通瞬时弹窗状态才留在组件内。

### 5.2 路由模式

建议采用 React Router Data Mode，保留现有 Vite 构建和 Express API：

- 路由配置置于 React render 之外。
- 同步 route config 只允许导入轻量 layout、guard、query option factory 和类型；页面组件、页面 loader 及大型依赖通过 `route.lazy` 动态加载。仅使用组件内 `React.lazy` 不视为完成路由级拆包。
- 使用 layout route 保持 `ProductFrame` 和全局候场协调器。
- 使用 route-level error boundary 和局部 pending UI。
- 页面级 query 可以在 loader 中 `ensureQueryData`，组件中读取同一 query。
- 所有站内按钮和链接使用 `Link` / `NavLink` / `navigate`，禁止同源 `window.location.href`。
- Auth loader/guard 负责未登录回跳目标，permission guard 负责管理页 403；组件内隐藏入口不能代替路由权限校验。
- `BattleLayout` 统一处理浏览器后退和站内离开意图。导航本身不得隐式等价于认输或权威离场；应按本地对局、正式对局、观战/回放分别复用现有离场语义，并在需要确认或等待命令完成时阻止导航。

不要求在第一阶段把所有数据都搬入 route loader；可以先使用普通 query hooks，再逐步把关键预加载收口到 loader。

### 5.3 深链接与部署回退契约

`createBrowserRouter` 的规范路径必须在 Vite 开发环境、生产静态服务器/反向代理和 PWA 导航中具有一致的直接访问行为：

- 对不匹配真实静态文件的前端 GET/HEAD 路径返回 `index.html`，由 React Router 继续解析；生产服务器不得只支持从 `/` 进入后的 SPA 导航。
- `/api/*`、`/version.json`、`/site-status.json`、`/.well-known/*`、卡图/表情/其他静态资源和带 hash 的构建产物不得落入 SPA fallback；不存在时保持真实 404/错误响应。
- `index.html` 使用 `no-cache` + `ETag`，fallback 响应不得被 CDN 错误缓存为某个具体深链接的数据响应。
- PWA navigation fallback 使用同一排除表。离线访问允许返回应用壳层，但受保护路由仍必须重新执行 session/permission boundary，不能因为 Service Worker 命中而绕过授权。
- 阶段 C 合入前必须在生产等价代理配置中验证代表性公开、在线、离线、管理、对局和回放深链接的直接打开与刷新；仅通过 Vite dev server 不算完成。

## 6. 服务端数据设计

### 6.1 Query key 规范

建议集中定义 query factories，禁止页面散写字符串：

```ts
queryKeys.cards.published();
queryKeys.deckPointTable.current();
queryKeys.decks.mine({ userId, authorizationEpoch });
queryKeys.playerBadges.mine({ userId, authorizationEpoch });
queryKeys.matchRecords.list({ userId, authorizationEpoch, filters });
queryKeys.ranked.overview({ userId, authorizationEpoch });
queryKeys.ranked.environment(seasonId);
queryKeys.themeTable.overview({ userId, authorizationEpoch });
```

私有 query key 必须包含用户身份以及当前认证/权限代际；登录用户切换、退出登录、会话失效、角色或权限变化时清除私有 query cache，防止跨用户或跨权限展示旧数据。服务端权限校验仍是安全边界，query key 只负责避免客户端误展示。

`authorizationEpoch` 是当前浏览器会话中的单调代际，只在用户主体变化、退出/失效、角色或权限集合变化时递增。普通 access token 续签、refresh token 轮换或同权限会话恢复不得递增代际，也不得因此清空正常业务缓存。切换代际时先取消旧代际的进行中私有 query，再 remove/clear 对应私有 cache；即使旧网络响应稍后返回，也不能重新写入新代际。允许持久化的公开卡池、公开 PT 表等公共 query 不随退出登录清除。

Query Client 还应集中声明重试与取消策略：401/403 和确定性 4xx 不自动重试；普通读取只对可恢复错误有限重试；mutation 默认不自动重放，除非端点已有幂等键；queryFn 应传递 `AbortSignal`，避免路由切换后的无效工作。现有 `apiClient` 必须扩展为接收并组合调用方 signal 与请求超时，不能由内部新建的 AbortController 吞掉 Query cancellation。

带筛选条件的 query key 必须先规范化可选字段、排序和分页参数，不能把语义相同但对象顺序不同的参数变成不同缓存条目。

### 6.2 初始 freshness 建议

以下数值是初始策略，最终以生产观测调整：

| 数据           | 建议 staleTime                  | 建议 gcTime                                        | 刷新方式                                                               |
| -------------- | ------------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------- |
| 已发布卡池     | 60 秒                           | 应用会话内保留；可从 IndexedDB 复水                | 使用 ETag；需要卡池的页面可见时每 60 秒检查，另在 focus/reconnect 检查 |
| PT 限制表      | 15 分钟，并保留生效边界定时刷新 | 30 分钟                                            | focus/边界/管理发布                                                    |
| 我的卡组       | 30 秒                           | 暂定 2 小时；观测后不得低于 P95 对局时长 + 30 分钟 | mount/focus 后台刷新；写操作后精确更新；卡组页可见时每 60 秒检查       |
| 徽章           | 5 分钟                          | 30 分钟                                            | 账户进入后台刷新；授予事件后失效                                       |
| 历史列表       | 30–60 秒                        | 30 分钟                                            | 后台刷新；对局封存后失效                                               |
| 排位赛季/榜单  | 15–30 秒                        | 15 分钟                                            | 页面可见时后台刷新                                                     |
| 排位环境统计   | 5 分钟                          | 30 分钟                                            | seasonId keyed；手动重试                                               |
| 娱乐模式节目单 | 30–60 秒                        | 15 分钟                                            | 活动发布/切换后失效                                                    |
| 候场/房间/对局 | 不进入普通长缓存 query          | 不适用                                             | 2.5 秒轮询/心跳或实时通道                                              |
| 公开应用配置   | 保留现有退避刷新                | 应用会话内保留                                     | 数据不变时不触发 render                                                |

### 6.3 卡池缓存

全量卡池是低频变化、高复用的大对象，应使用单调 revision 和条件请求，而不是每次启动强制读取。第一版不引入 SSE/WebSocket、事务 outbox、跨标签页广播或内容寻址快照服务；普通轮询、focus/reconnect 与 mutation 精确失效已经足以明显改善当前实现，后续只有生产观测证明延迟不可接受时再增加推送。

#### 6.3.1 Revision 与读取契约

- 数据库保存单行、单调递增的公开 `catalogRevision`。同步任务新增的 `DRAFT`、对草稿的编辑和管理员预览不改变 revision；发布、下线、删除或修改任一当前 `PUBLISHED` 卡牌的公开字段、图片元数据时，必须在同一数据库事务内递增 revision。
- 服务端提供一个无需登录的 `GET /api/cards/catalog`，返回 `{ schemaVersion, catalogRevision, cards }`，并使用由 schema version 与 revision 生成的 `ETag`。读取 revision 与卡牌列表必须看到同一个数据库快照，不能返回 revision 已更新但 cards 仍是旧版的混合结果。
- 客户端只使用固定 query key `queryKeys.cards.published()`。需要卡池的页面存在 active observer 时每 60 秒检查一次，并在 focus/reconnect 时检查；请求允许浏览器用 `ETag` 做条件验证。公开首页没有卡池消费者时不启动该读取，因此仍不下载全量卡池。
- 管理员在本客户端完成影响公开卡池的 mutation 后立即 invalidate 该 query。其他用户不要求毫秒级同步，最迟在下一次可见页周期检查或 focus/reconnect 时取得新 revision。
- 计划内发布必须先上线 revision/catalog 契约，再上线只读取新契约的前端；不在业务路径保留旧无 revision 卡池的长期 fallback。

#### 6.3.2 校验与原子切换

1. 客户端收到 200 响应后校验 envelope schema、单调 revision、卡牌数组结构和必要字段；304 或浏览器条件缓存命中继续使用现有 Query 数据。
2. 客户端已有旧卡池时继续展示旧数据；只有新响应完整解析和校验成功后，才用一次 `setQueryData`/query success 提交替换整份 catalog。请求、解析或校验失败时保留旧数据并展示窄错误状态，不先清空 registry，也不逐张写入形成半新半旧状态。
3. Query Cache 保存 JSON 兼容的 catalog envelope；`cardCatalog` 适配层按 `catalogRevision` 派生只读 `Map`、图片路径和领域对象并复用同一对象身份，不拥有第二套请求、freshness 或失效状态。大对象按 revision 直接复用，避免每次条件检查对全量卡池做无收益的深比较。
4. 本地对局启动时冻结本局使用的 catalog revision/registry 引用；卡池后台切换不得在进行中的本地对局里替换卡牌定义。远程对局继续以服务端投影和本局冻结数据契约为准。

#### 6.3.3 IndexedDB 与离线边界

公开卡池可以持久化到 IndexedDB，但不得将登录凭据或私有用户数据一并持久化。第一版只建立一个窄的 `catalog` object store，并以固定 key `current` 保存 `{ schemaVersion, catalogRevision, cards }`；一次 `put` 本身即为原子事务，不建立临时表、多版本指针或通用 Query 持久化框架。

应用在需要卡池时先读取并校验这一条记录，用它作为 Query 的初始数据，再发起正常的条件请求。网络返回的新 catalog 校验成功后先更新内存 Query；IndexedDB 写入失败只影响下次离线复水，不阻止当前在线会话使用已经验证的新数据。复水失败、配额不足或记录损坏时删除损坏记录并回到网络读取，不影响认证状态。

离线模式只能使用完整且验证通过的快照，不能把部分下载、旧 schema 或空数组视为有效卡池。卡图仍由现有 Cache Storage 管理，不写入该 IndexedDB。

### 6.4 管理变更与用户缓存传播

- 普通用户修改自己的云端卡组时，mutation 成功响应直接更新 `decks.mine` 和对应 detail query，再精确 invalidate 做后台确认；不等待页面重新挂载。
- 平台管理员修改其他用户卡组属于低频操作，不建立专用推送通道。卡组列表/detail 在相关页面可见时每 60 秒检查，并在 focus/reconnect 时刷新，因此其他客户端最终看到服务端结果。
- 云端卡组增加单调 `revision`，更新请求携带 `expectedRevision`。服务端 revision 不一致时返回 409；正在编辑的表单保留本地草稿并提示服务端版本已变化，不能因后台刷新直接覆盖未提交内容。
- 云端卡组、徽章、历史和其他私有 query 不写入 IndexedDB。跨设备更新由服务端重读收敛，而不是依赖浏览器持久化同步。

## 7. 导航与加载体验

### 7.1 Suspense 边界

- 根级 fallback 只服务于真正的应用冷启动。
- `SessionRoot` / `ProductLayout` 外壳不得因为子页面 chunk 暂未完成而消失。
- 每个较大路由使用局部 Suspense 和贴合页面结构的 skeleton。
- 已显示内容在导航 transition 中保持，导航按钮可以显示窄的 pending 状态。
- 后台数据刷新不触发 Suspense，不清空页面。

### 7.2 预加载

- 顶部导航在 hover/focus 时预加载对应 route chunk 和首屏 query。
- 移动端入口可在进入 viewport 时预加载。
- 应用空闲后优先预加载高频的“对局准备”和“卡组管理”。
- 从对局退出前，可以预热返回目的地的卡组 query，但不得延迟或改变权威离场命令。
- 不预加载完整管理后台和低频调试页面。

### 7.3 返回对局外页面

从对局离开时应遵循：

1. 先由 `BattleLayout` 判断当前 surface 的离开语义；观战/回放可直接离开，普通返回不得自动等价为认输。
2. 需要权威离场、认输或本地会话清理时，先阻止路由切换并完成现有命令；成功后再导航到明确的规范路由。
3. 目标页立即读取 Query Cache。
4. 数据过期时在后台刷新，不显示整屏 loading。
5. 对局状态与普通页面 query 相互独立；清理对局不得顺带清空卡组、赛季和卡池缓存。

浏览器后退、站内导航和关闭/刷新标签页必须分别覆盖。React Router blocker 负责 SPA 内导航；`beforeunload` 只作为浏览器关闭/刷新时的同步提示兜底，不能在其中承诺异步权威命令一定完成。

## 8. 对局运行时拆包

当前 `gameStore` 同时承担卡牌目录查询、远程快照和本地 `GameSession`，使完整规则/卡效链进入初始包。以下是职责边界，不要求每项都建立一个新的 Zustand store：

- `cardCatalog`：从版本化 Query Cache 派生的轻量卡牌索引、图片路径和展示查询，不拥有第二套请求状态。
- `battleSessionStore`：轻量的当前 match identity、surface、恢复状态。
- `remoteBattleStore`：远程投影、序号、轮询和命令 transport。
- `localBattleRuntime`：`GameSession`、本地调试和需要浏览器本地裁判的适配器，仅在对应 surface 动态加载；服务端权威对墙打只使用远程投影，不因产品名称而加载本地引擎。
- `battleUiStore`：选择、hover、面板、动画反馈等局内 UI 状态。

第一步不必拆开所有方法，也不以“必须形成五个 store”为验收条件。可以先将本地 `GameSession` factory 改为动态加载，并把卡池 selector 从 `gameStore` 抽出；随后再按真实依赖图决定是否拆远程/UI store。动态边界使用显式 bootstrap 接口，例如由调用方把冻结的 catalog registry、PT 规则和本地对局 setup 传给 `createLocalBattleRuntime`；`localBattleRuntime` 不反向导入 Router、Query Client 或普通页面 store。

最低要求是：

- 公开首页和普通大厅的入口依赖图不再同步到 `GameSession -> card-effect-runner -> 全部 workflow registry`。
- `deckStore`、共享卡组、排位和娱乐模式等非对局页面读取卡池时不再导入 `gameStore`。
- 排位/娱乐模式的普通概览与实时候场状态只有一个事实来源，不出现 Query/Zustand 双写。
- 服务端权威正式对局、服务端权威对墙打、观战和历史回放 chunk 不包含 `GameSession`、`card-effect-runner` 或具体 workflow registry；它们只加载共享 `GameBoard`、远程投影和对应 transport。
- `/battle/local` 等真正需要浏览器本地裁判的路由，在玩家进入且 catalog bootstrap 成功后才 import `localBattleRuntime`。仅因 `BattleLayout` 挂载不得触发该 import。
- route module、共享 UI 或 barrel export 不得把本地 runtime 重新静态引回入口；依赖检查必须分析真实构建图，而不只搜索源码 import 文本。

阶段性 bundle 验收目标：初始 JS gzip 相比 `895,981 bytes` 基线至少下降 40%，并确认公开首页、普通业务页和远程对局相关 chunk 不包含本地 `GameSession` 和具体卡效 workflow。最终阈值根据 bundle analyzer 和真实设备数据调整。

## 9. HTTP 与 PWA 缓存策略

### 9.1 HTTP 缓存

不得继续为所有 GET 请求统一指定 `no-store`。按端点分类：

| 响应                                  | 建议策略                                                   |
| ------------------------------------- | ---------------------------------------------------------- |
| refresh token、权限复核、实时对局快照 | `private, no-store`                                        |
| 用户卡组、徽章、历史                  | 客户端 query cache；HTTP 可用 `private, no-cache` + `ETag` |
| 公开卡池/PT 表                        | revision URL 或 `ETag`；允许浏览器/CDN 缓存                |
| `version.json`、维护快照              | `no-store`                                                 |
| `index.html`                          | `no-cache` + `ETag`                                        |
| 带内容 hash 的 JS/CSS/图片            | 长 `max-age` + `immutable`                                 |

HTTP 缓存与 TanStack Query 缓存是两层不同机制：前者减少传输和服务端查询，后者负责应用内 freshness、并发合并和 UI 连续性。

私有响应的 `ETag` 必须按用户、权限和完整响应表示生成，并保持 `private`；经 Cookie 或 Authorization 区分的响应应配置正确的 `Vary` 或完全禁止共享缓存，不能因为引入 304 而扩大数据可见范围。

### 9.2 计划内停机更新边界

本项目计划内发布继续遵守停机迁移原则：

1. 先进入限制新开局或维护状态，停止新的候场、配对、房间和对局写入。
2. 等待正式对局、对墙打服务端会话、候场票据、配对预留和跨模式占用排空。
3. 发布工具必须读取并确认上述计数为零；未排空时阻止继续部署，而不是依赖新旧协议兼容。
4. 完成备份、dry-run、停机迁移和结果校验后，部署只接受新格式的新版本。
5. 恢复服务后再解除维护状态并允许新开局。

因此，本次前端重构不承担“服务部署中断导致进行中对局丢失后恢复”的设计责任，也不为此增加旧协议 fallback。正式联机进程意外退出后的运行态恢复仍按现有项目缺口独立推进，不能借 PWA 更新机制伪装为已解决。

### 9.3 PWA 更新

建立单一 `UpdateCoordinator`，移除多个更新/强制刷新机制之间的竞争：

- `vite-plugin-pwa` 改为 prompt 更新模式，关闭构建期无条件 `skipWaiting` / `clientsClaim` 自动接管；通过单一注册入口把 `onNeedRefresh` 转成 `updateAvailable` 状态。
- Service Worker 发现新版本后只记录 `updateAvailable`。
- 非对局、无未保存编辑时展示“立即更新”。
- 对局路由或编辑中默认延后；计划内发布时对局应已由服务端发布门禁排空，编辑页仍明确提示保存或放弃草稿后更新。
- 用户确认或进入安全边界后，才由 `UpdateCoordinator` 请求 waiting worker 执行 `skipWaiting`，等待新 worker 接管后完成一次受控刷新；不得同时保留版本检查、`controllerchange` 和注册器各自调用 reload 的路径。
- 如服务端协议升级必须强制客户端更新，应使用维护状态和停机发布门禁阻止新写入，部署完成后给旧客户端受控阻断/更新页；不要求业务路径长期兼容旧协议。
- 自动化测试必须证明普通版本检查不会在对局路由或存在未保存编辑时直接触发 `location.reload()`；发布 Runbook 另行验证部署前服务端对局与候场已排空。

## 10. 分阶段实施

本计划包含四条相关但验收责任不同的交付线：

- 核心前端交付：Query、Router、layout、状态所有权和 runtime 拆包。
- 安全前置交付：`UpdateCoordinator`，必须在大规模路由迁移前消除自动刷新风险。
- 前后端联动交付：catalog revision/catalog、云端卡组 revision、排位/娱乐普通概览与实时状态读取契约、HTTP/ETag。
- 发布系统外部前提：限制新开局、对局/候场/预留排空和停机迁移门禁。它们必须在上线前通过，但不以尚未执行一次真实生产发布为理由否定已经通过的核心前端验收。

### 首个稳定性版本：P1/P2 小步交付

在完整阶段 A–E 开始大范围迁移前，先完成一个用户可立即感知的 P1/P2 补丁版本：

1. P1 以独立 PR 收口版本检查与 Service Worker 更新，停止发布期间的自动清缓存和自动刷新。
2. P2 以第二个独立 PR 修正现有 `deckStore` 的云端卡组请求生命周期，使主页、准备页和卡组页返回时先展示当前会话缓存，并合并后台请求。
3. 两个 PR 均可独立合并、验证和回滚；两项完成后进入同一个补丁版本，不与 Router、完整 Query、catalog revision 或运行时拆包混在同一 PR。

P2 只是对当前唯一云端卡组事实来源的窄稳定化，不代表卡组已经完成 TanStack Query 迁移。后续阶段 B 正式迁移时，必须一次性把云端卡组列表所有权从 `deckStore` 交给 Query Cache，并删除 P2 的 store cache 状态，不能形成长期双写。

### 阶段 A：建立观测基线

实施状态：已落地。固定环境、指标契约、参考构建与复现命令见
[阶段 A 观测基线](phase-a-observability-baseline.md)。

- 为导航开始、目标壳层显示、首批数据可用、后台刷新完成增加 User Timing。
- 在 E2E 中记录关键 API 请求数和 document navigation 次数。
- 记录生产构建初始 chunk、各 route chunk 和 PWA precache 大小。
- 建立大厅 → 准备 → 对局 → 返回准备/大厅的基线视频或 trace。
- 固定基线 commit、Node/pnpm 版本、构建环境、gzip 统计脚本、标准测试设备和网络/缓存档位。

### 阶段 B：先消除重复读取

- 若首个稳定性版本 P1 已完成，验证并沿用单一 `UpdateCoordinator`；不得重新引入 `autoUpdate`、版本检查或 `controllerchange` 的竞争性强制刷新。HTTP/ETag 收束仍留在阶段 E。
- 引入 Query Client 和 query key factory。
- 首批迁移卡组、PT 表、徽章和历史列表。卡组迁移必须替换并删除 P2 在 `deckStore` 中增加的服务端缓存所有权；排位/娱乐模式只有在普通概览与实时状态读取契约已经拆分后才迁移普通概览，否则继续由现有实时 store 单独持有 combined `overview`。
- 统一 cold pending 与 background fetching 的 UI。
- 上线卡池 revision/catalog 契约，修正强制刷新并接入验证后的原子缓存切换。
- mutation 后精确 invalidation。

该阶段完成后，即使尚未迁移正式路由，返回大厅/准备页也应直接显示缓存内容。

### 阶段 C：迁移正式路由与持久壳层

- 建立 Public、Session、Product、Battle layout，并落实在线认证/离线身份 capability matrix。
- 逐页把 `currentPage` 分支迁移为规范 route。
- 从本阶段开始由 URL 单向驱动页面，旧组件导航 props 仅作为 `navigate()` 适配层，不保留双向同步状态。
- 替换同源 `window.location.href`。
- 接入前进/后退、对局离开 blocker、深链接、scroll restoration、session/auth/permission guard 和 route error boundary。
- 同步落地生产静态服务器/反向代理与 PWA navigation fallback 排除表，并在生产等价环境验证直接刷新。
- 添加 route/query 预加载。

### 阶段 D：运行时拆包与冷启动优化

- 拆分轻量目录状态和 battle runtime。
- 使 `GameSession` / 卡效 registry 只在浏览器本地裁判 surface 需要时加载；远程对局、服务端对墙打、观战和回放不得加载。
- 用 bundle analyzer 检查依赖回流。
- 优化全量卡池序列化、传输和复水耗时。

### 阶段 E：PWA 和 HTTP 缓存收束

- 完成安全更新提示、跨版本阻断页和 UpdateCoordinator 的多环境收束。
- 逐端点配置 HTTP 缓存和 ETag。
- 验证普通网页、PWA、无痕、移动端和停机发布后的旧客户端更新；不把进行中对局跨服务中断恢复列入本阶段。

## 11. 验收标准

### 11.1 功能验收

- 所有站内主要页面具有规范 URL，可刷新和直接访问。
- 在线账号、离线身份、公开 token 和管理权限按访问矩阵进入各自允许的路由；离线身份不会启动云端卡组、候场、房间、历史或账户请求。
- 浏览器前进/后退能正确恢复页面和必要 URL 状态。
- 对局路由的浏览器后退遵循对应 surface 的确认/离开规则，不隐式认输，也不绕过权威命令。
- 同源主导航不产生新的 document navigation。
- 退出登录、切换用户和授权失效后不会展示前一用户的私有缓存。
- 同一用户角色或权限变化后，不会继续展示旧权限下的私有缓存；管理深链接由路由 guard 返回正确登录回跳或 403。
- 普通 token 续签不改变 `authorizationEpoch`，不清空正常业务缓存；用户/权限代际切换会取消旧私有 query，迟到响应不能污染新代际。
- 对局离开、认输、重开和恢复仍通过既有权威命令/服务层。
- 公共牌桌、排位、娱乐模式的跨页面候场和自动进入房间行为保持正确。
- catalog revision 变化时，旧卡池持续可用直到新快照完整校验并原子切换；校验失败不清空当前卡池，进行中的本地对局继续使用启动时冻结的 revision。
- 在生产等价静态服务器/反向代理中直接打开和刷新公开、在线、离线、管理、对局、观战及回放代表路径均得到正确应用或真实 401/403/404，不被错误 SPA fallback 掩盖。

### 11.2 体验验收

- 有缓存的内部导航不出现整屏 spinner。
- 大厅 → 对局准备 → 返回大厅，在 freshness 窗口内 `/api/decks` 最多读取一次。
- 模拟页面离开超过默认 5 分钟但未超过配置 `gcTime` 后返回，仍先展示缓存数据；阶段 A 没有生产时长数据时至少覆盖 2 小时，形成观测后至少覆盖 P95 对局时长 + 30 分钟。
- 对局结束或离开后，返回页首屏直接显示已有卡组和入口数据。
- 后台刷新期间旧内容保持可交互；失败时保留旧内容并提供窄错误提示。
- 首次加载懒页面时保留全站顶栏或对应 layout。
- 进行中对局和未保存编辑期间，PWA 更新不自动刷新页面。

### 11.3 性能验收

- 在文档固定的同一构建环境与统计脚本下，生产构建初始 JS gzip 相比 `895,981 bytes` 基线至少下降 40%，即不高于 `537,588 bytes`；如基线重测偏差，应先更新并说明基线，不能在结果出来后改变口径。
- 公开首页、普通业务页、服务端权威正式对局、服务端权威对墙打、观战和回放依赖图不包含本地 `GameSession` 和具体卡效 workflow；只有本地裁判 surface 的异步 chunk 可以包含这些模块。
- bundle 依赖审计应进入可重复的 CI/脚本检查，不能只依赖人工查看 analyzer 图。
- 缓存命中的常规内部导航，在固定标准设备、网络和热缓存档位下，从 navigation User Timing 开始到目标 route 主体标记可见的 P75 小于 200 ms。
- E2E 对关键流程设置 API 请求计数断言，防止 mount-fetch 回归。
- 后台刷新不得产生重复并发请求；相同 query key 同时只有一个活动读取。

### 11.4 联动与发布前提验收

以下项目必须在整批上线前通过，但与核心前端代码验收分别记录结果：

- catalog revision/catalog、云端卡组 revision、排位/娱乐状态拆分和逐端点 HTTP/ETag 的服务端契约测试通过。
- 生产代理 SPA fallback、缓存头和 PWA navigation fallback 使用同一排除清单并通过部署环境验证。
- 计划内发布检查能够证明正式对局、服务端对墙打、候场票据、配对预留和跨模式占用已经排空；未排空时部署步骤失败。
- 停机迁移、只接受新契约的服务端与新前端按 runbook 顺序部署，不为发布窗口增加业务路径 dual-read。

## 12. 测试策略

### 单元测试

- query key 稳定性和用户隔离。
- `authorizationEpoch` 只在用户/权限变化时更新，普通 token 续签不更新。
- freshness、失效和 mutation 后更新范围。
- 各 query family 的 `staleTime` / `gcTime` 及长对局返回场景。
- catalog revision 单调递增、响应结构校验、失败保留旧版、原子切换和持久缓存复水。
- 云端卡组 `expectedRevision` 成功更新与 409 冲突路径。
- PWA 安全更新时间点判断。
- 认证/权限代际变化后的私有 cache 清理。

### 集成测试

- 多个页面同时订阅卡组 query 时请求合并。
- 缓存数据存在时后台刷新不进入 cold loading。
- 退出登录清除私有 cache，保留允许持久化的公开卡池。
- 取消旧认证代际 query 后模拟迟到响应，确认不会重新填充新代际 cache。
- route loader 与组件 query 使用同一缓存条目。
- 排位/娱乐模式普通概览与实时候场状态不发生双写覆盖。
- 本地 runtime bootstrap 冻结 catalog revision，后台 catalog 切换不改变进行中本地对局 registry。

### E2E

- 大厅 → 卡组 → 大厅。
- 大厅 → 准备 → 对墙打 → 离开 → 准备。
- 大厅 → 排位 → 大厅，同时保持候场。
- 娱乐模式匹配 → 房间 → 对局 → 返回娱乐模式。
- 共享卡组 → 登录 → 保存 → 卡组管理，全程无不必要硬重载。
- 观战大厅 → 观战 → 返回大厅。
- 浏览器前进/后退，以及在生产等价代理下对公开、离线、在线、管理、对局、观战和回放深链接直接打开/刷新。
- 离线身份访问允许页面并验证不会发出私有 API 请求；无有效 catalog 快照时显示联网初始化边界。
- 未登录/无权限直接访问受保护路由时，验证登录回跳和 403。
- 模拟新 Service Worker，在对局路由或未保存编辑中不得自动 reload，在安全页面可确认更新。
- 模拟计划内发布门禁，存在对局、候场或配对预留时不得进入部署步骤，排空后才允许继续。

## 13. 风险与控制

| 风险                                     | 控制方式                                                                           |
| ---------------------------------------- | ---------------------------------------------------------------------------------- |
| 缓存展示过期卡组或赛季状态               | 合理 staleTime/gcTime、mutation invalidation、后台刷新                             |
| 跨用户或跨权限缓存泄漏                   | 私有 query key 包含用户与认证/权限代际；认证边界清 cache                           |
| 路由迁移影响候场/房间恢复                | 先保留全局协调器，逐条 E2E 迁移                                                    |
| 运行时拆包形成循环依赖                   | 先定义轻量接口边界，再移动实现；bundle analyzer 审计                               |
| PWA 延迟更新导致协议不兼容               | 维护状态、对局/候场排空门禁、停机迁移、部署后受控更新；不做长期协议兼容            |
| 旧公开链接失效                           | 先盘点公开协议；必要时服务端限时重定向，不做长期 dual-read                         |
| Query 与 Zustand 双重持有同一服务端数据  | 明确唯一事实来源；概览与实时状态按字段边界拆分                                     |
| combined overview 在迁移期被双写         | 接口未拆分前完整保留在实时 store；拆分后 DTO 字段互斥；禁止 queryFn 副作用写 store |
| 客户端长时间不知道卡池已更新             | 卡池页面可见时 60 秒条件检查、focus/reconnect 检查、管理员本地失效、单调 revision  |
| 新卡池下载失败导致空卡池或影响进行中对局 | 旧数据持续可用、结构校验后整份原子切换、本地对局冻结 revision                      |
| 管理员与用户同时编辑云端卡组互相覆盖     | 卡组单调 revision、更新携带 `expectedRevision`、409 后保留本地草稿并提示冲突       |
| 离线身份误触发私有请求                   | Session capability matrix、在线协调器条件挂载、负向网络请求 E2E                    |
| 深链接只在 Vite 开发环境可用             | 生产代理与 PWA fallback 契约、静态/API 排除表、生产等价刷新测试                    |

## 14. 业界实践依据

- React Router 将 Data Mode 定位为保留现有 bundling/服务端抽象，同时获得 loader、action 和 pending 状态的方案：<https://reactrouter.com/start/modes>
- React 建议将导航标记为 Transition，避免已显示内容被突兀的全屏 loading 替换：<https://react.dev/reference/react/useTransition>
- React `lazy` 会缓存加载 Promise 和结果，重复导航的主要治理重点应放在数据生命周期而非重复实现代码懒加载：<https://react.dev/reference/react/lazy>
- TanStack Query 建议通过 `staleTime` 控制 mount、focus、reconnect 时的重复刷新，并保留 inactive query cache：<https://tanstack.com/query/latest/docs/framework/react/guides/important-defaults>
- MDN 不建议无差别使用 `no-store`，并建议对可验证内容使用 `no-cache`/`ETag`、对 hash 资源使用长期 immutable 缓存：<https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Caching>
- Vite PWA 官方指出自动更新可能导致正在填写表单的用户丢失数据，有重要进行中状态的应用应采用更新提示：<https://vite-pwa-org.netlify.app/guide/auto-update.html>

## 15. 决策摘要

1. 保留 React、Vite、Express、Zustand 和现有游戏领域架构。
2. 新增 React Router，替代 `currentPage` 手写路由，并通过 `SessionRoot` 明确在线认证、离线身份、公开 token 与权限边界。
3. 新增 TanStack Query，统一普通服务端数据的缓存与刷新。
4. 保持对局/候场的实时权威状态为独立 store，不使用普通页面长缓存；排位/娱乐 combined overview 在服务端契约拆分前不提前双写到 Query。
5. 将完整本地对局运行时从初始包、普通业务页和所有远程对局 surface 中拆出，只由浏览器本地裁判 surface 按需加载。
6. 采用缓存优先、后台刷新、局部 loading，不再用整屏刷新表达普通页面更新。
7. PWA 更新改为安全边界确认，不允许进行中对局自动 reload。
8. 采用分阶段迁移和可量化验收，不进行大爆炸式重写。
9. 计划内发布以限制新开局、排空对局/候场和停机迁移为前提；本重构不实现服务中断后的进行中对局恢复，也不增加旧协议业务兼容。
10. 卡池采用单调 revision、ETag 条件检查、响应结构校验和整份原子切换；IndexedDB 只保存一份已验证公开快照，离线模式不读取空或损坏数据。
11. 生产静态服务器、反向代理和 PWA navigation fallback 必须共同支持规范深链接，且不得吞掉 API、版本、维护快照和静态资源错误。
