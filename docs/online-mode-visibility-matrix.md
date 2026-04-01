# Loveca 联机模式卡牌可见面与动作审计设计

> 文档类型：联机设计文档
> 适用范围：基于 [detail_rules.md](/root/loveca/detail_rules.md) 为 Loveca 的联机“远程实体卡对战模拟/判桌辅助”模式定义统一的信息投影、动作公开与审计模型。
> 最后更新：2026-04-01

---

## 1. 文档目标

本文档用于直接取代旧版“信息可见性与动作审计矩阵”。

旧方案的问题不是结论错，而是抽象层级不够稳定：

- 它把“领域是否公开”“张数是否公开”“过程是否公开”“结果是否公开”“审计是否密封”混在同一层。
- 它把很多规则结果写成枚举，导致动作一多，矩阵会迅速膨胀。
- 它把“张数总是公开”当成核心出发点，但这只是规则条文层结论，不是更底层的建模方式。

联机模型更适合从实体牌桌的本质出发：

- 牌总是位于某个容器或桌面位置中。
- 对每位玩家而言，一张牌可能根本不可单独辨认、只能看到背面、或者能看到正面。
- 动作公开与否，本质上是“谁看到了哪张牌的哪个面，以及在什么时点看到”。

---

## 2. 核心设计结论

### 2.1 真正的基础不是“张数是否公开”

“各领域中的卡牌数量始终对所有玩家可见”是 [detail_rules.md](/root/loveca/detail_rules.md#L123) 的规则结论，但在系统设计里它应被视为：

- 容器级公开属性
- 不是卡牌级可见性模型本身

更底层、也更稳定的建模单位应是：

1. 某位玩家是否知道一个容器里有几张牌。
2. 某位玩家是否能把其中某张牌作为一个独立对象看见。
3. 如果能看见该牌，这位玩家看到的是正面还是背面。
4. 如果涉及多张牌，这位玩家是否知道它们的相对顺序。

### 2.2 联机必须把“容器可见性”和“卡牌可见面”分开

统一用两层描述状态：

- 容器层：一个区域/槽位/临时选择集，对谁公开“数量、占用、顺序”。
- 卡牌层：某张牌对每个观察者显示 `NONE`、`BACK`、`FRONT` 哪一种表面。

这样你提出的实体牌桌四种基本形态就自然成立：

| 状态 | A 看到 | B 看到 |
| --- | --- | --- |
| 双方看正面 | `FRONT` | `FRONT` |
| 双方只看背面 | `BACK` | `BACK` |
| 仅 A 看正面 | `FRONT` | `BACK` 或 `NONE` |
| 仅 B 看正面 | `BACK` 或 `NONE` | `FRONT` |

这里 `BACK` 与 `NONE` 的差异取决于这张牌是否作为“桌面上的一个具体对象”对该观察者存在：

- `BACK`：对方知道这里有一张具体的牌，只是看不到正面。
- `NONE`：对方甚至不应单独看到这张牌对象，只能通过容器摘要得知数量变化。

这比“公开区/非公开区 + 张数公开”更接近实体牌桌，也更适合程序投影。

### 2.3 审计不是第六种可见性，而是另一条轴

审计不应继续和实时可见性混在一个枚举里。一个动作需要同时回答两件事：

- 实时对谁公开什么。
- 服务端密封保存什么。

因此建议把动作建模为：

- `publicDelta`：双方实时共享的状态变化和公共日志。
- `privateDeltaBySeat`：仅对应座位可见的私密变化。
- `sealedAudit`：仅服务端保存的完整审计记录。

---

## 3. 基础模型

### 3.1 容器层模型

一个容器指一个领域、槽位、暂存区、检视结果集，或其它能承载卡牌的集合。每个容器至少定义以下属性：

- `containerVisibility`
  哪些观察者知道这个容器存在。
- `countVisibility`
  哪些观察者知道该容器当前张数。
- `occupancyVisibility`
  哪些观察者知道容器中的单卡占位信息。
- `orderPolicy`
  `NONE | PUBLIC_ORDERED | OWNER_ORDERED_HIDDEN`
- `defaultSurfacePolicy`
  牌进入容器后，对各观察者默认显示哪一面。

解释：

- `countVisibility` 对应规则上的“张数公开”。
- `occupancyVisibility` 用来区分“对手知道你有 5 张手牌”与“对手看见桌上有 3 张盖放 Live”。
- `orderPolicy` 用来表达主卡组、成功 Live 区等“顺序管理”差异。

### 3.2 卡牌层模型

权威状态中的每张牌，对每个座位维护一个投影结果：

- `surfaceForSeat[A] = NONE | BACK | FRONT`
- `surfaceForSeat[B] = NONE | BACK | FRONT`

辅助属性：

- `location`
- `controllerSeat`
- `ownerSeat`
- `orientation`
  `ACTIVE | REST`
- `isIndividuallyAddressableToSeat`
  某位观察者能否把它作为独立卡对象看到并跟踪

其中：

- `FRONT` 表示该观察者可以查看该牌正面信息。
- `BACK` 表示该观察者知道这里有一张具体牌，但只能看到背面。
- `NONE` 表示该观察者不应看到这张独立牌对象。

### 3.3 状态变化应以“可见面变化”表达

很多动作都可以还原为卡牌可见面的变化，而不是特殊枚举：

- 抽牌：对手看不到单卡对象；自己看到新牌 `NONE -> FRONT`。
- 盖放 Live：自己通常 `FRONT`，对手 `NONE -> BACK`。
- Live 翻开：对手 `BACK -> FRONT`，自己保持 `FRONT`。
- 从手牌 play 成员：对双方都是该卡进入公开对象并变成 `FRONT`。
- 检视牌库顶：仅自己临时看到若干张牌 `NONE -> FRONT`，结束后再回到原位置规则。

这使协议与 UI 都更统一。

---

## 4. Loveca 的默认容器模型

### 4.1 公开桌面容器

适用于成员区、能量区、成功 Live 区、休息室、除外区、解决区。

默认规则：

- `containerVisibility = BOTH`
- `countVisibility = BOTH`
- `occupancyVisibility = BOTH`
- `defaultSurfacePolicy = FRONT for BOTH`

含义：

- 双方看到有哪几张牌。
- 双方看到正面。
- 这类区域中的动作默认进入公共日志。

### 4.2 公开桌面但允许背面存在的容器

适用于 Live 放置区。

默认规则：

- `containerVisibility = BOTH`
- `countVisibility = BOTH`
- `occupancyVisibility = BOTH`
- `defaultSurfacePolicy` 取决于当前展示面

当牌处于里侧时：

- 操作者：通常 `FRONT`
- 对手：`BACK`

当牌被翻开时：

- 双方：`FRONT`

这正是联机里最重要、也最像实体牌桌的情况：同一张牌对双方同时处于不同可见面。

### 4.3 私有容器

适用于手牌、主卡组、能量卡组。

默认规则：

- `containerVisibility = BOTH`
- `countVisibility = BOTH`
- `occupancyVisibility = OWNER_ONLY`

进一步区分：

#### 手牌

- 自己：各张牌 `FRONT`
- 对手：单卡对象 `NONE`

#### 主卡组

- 自己：通常单卡对象也是 `NONE`
- 仅当规则要求检视顶部若干张时，临时把对应卡牌投影为自己可见 `FRONT`
- 对手：始终 `NONE`

#### 能量卡组

- 与主卡组同理，但默认不强调顺序可见

设计重点：

- “对手知道你手牌有几张”来自 `countVisibility`
- 不是来自把每张手牌都投影成 `BACK`

### 4.4 临时私密选择集

适用于：

- Mulligan 暂放牌
- 检视到的一组候选
- 从私密区筛选出的候选列表

默认规则：

- 不要求对手看到单卡占位
- 对手通常最多只知道“这一步发生了，涉及 N 张”
- 详细内容只进入 `privateDeltaBySeat` 和 `sealedAudit`

---

## 5. 规则条文到模型的映射

### 5.1 公开领域 / 非公开领域

[detail_rules.md](/root/loveca/detail_rules.md#L122) 到 [detail_rules.md](/root/loveca/detail_rules.md#L127) 描述的是容器默认策略，而不是所有动作都必须用“公开/非公开”二分建模。

系统实现上应理解为：

- 公开领域：默认 `occupancyVisibility = BOTH`，卡牌通常 `FRONT`
- 非公开领域：默认 `occupancyVisibility` 不对对手开放，卡牌常为对手 `NONE`

### 5.2 张数公开

[detail_rules.md](/root/loveca/detail_rules.md#L123) 应落在 `countVisibility = BOTH`，不要再把它写成“卡牌可见性类型”。

### 5.3 里侧与表侧

[detail_rules.md](/root/loveca/detail_rules.md#L142) 到 [detail_rules.md](/root/loveca/detail_rules.md#L147) 对应的是卡牌层 `surfaceForSeat`：

- 表侧：允许相应观察者看到 `FRONT`
- 里侧：通常是 `BACK` 或 `NONE`

是否是 `BACK` 还是 `NONE`，不是单由“里侧”决定，而是由该卡是否作为对象对该观察者存在决定。

### 5.4 顺序管理

[detail_rules.md](/root/loveca/detail_rules.md#L127) 到 [detail_rules.md](/root/loveca/detail_rules.md#L136) 应落在容器层 `orderPolicy`：

- 主卡组：`OWNER_ORDERED_HIDDEN`
- 成功 Live 区：`PUBLIC_ORDERED`
- 成员区、Live 放置区、休息室：`NONE`

---

## 6. 区域设计矩阵

| 区域 | countVisibility | occupancyVisibility | 自己通常看到 | 对手通常看到 | orderPolicy |
| --- | --- | --- | --- | --- | --- |
| 成员区 | 双方 | 双方 | `FRONT` | `FRONT` | `NONE` |
| 成员下方能量 | 双方 | 双方 | `FRONT` | `FRONT` | `PUBLIC_ORDERED` |
| 能量区 | 双方 | 双方 | `FRONT` | `FRONT` | `NONE` |
| Live 放置区（里侧） | 双方 | 双方 | `FRONT` | `BACK` | `NONE` |
| Live 放置区（翻开后） | 双方 | 双方 | `FRONT` | `FRONT` | `NONE` |
| 主卡组 | 双方 | 仅自己 | 检视时局部 `FRONT`，否则单卡 `NONE` | 单卡 `NONE` | `OWNER_ORDERED_HIDDEN` |
| 能量卡组 | 双方 | 仅自己 | 通常单卡 `NONE` | 单卡 `NONE` | `OWNER_ORDERED_HIDDEN` 或 `NONE` |
| 手牌 | 双方 | 仅自己 | `FRONT` | 单卡 `NONE` | `NONE` |
| 成功 Live 区 | 双方 | 双方 | `FRONT` | `FRONT` | `PUBLIC_ORDERED` |
| 休息室 | 双方 | 双方 | `FRONT` | `FRONT` | `NONE` |
| 除外区 | 双方 | 双方 | `FRONT` | `FRONT` | `NONE` |
| 解决区 | 双方 | 双方 | `FRONT` | `FRONT` | `NONE` |
| Mulligan 暂存 | 视步骤摘要 | 仅自己 | `FRONT` | `NONE` | `NONE` |

说明：

- 这里不再用 `COUNT_ONLY` 之类标签描述整个区域。
- 对手是否能“看见背面卡对象”，关键看 `occupancyVisibility`。
- 手牌和牌库对手只看到张数，不看到单卡对象；Live 盖牌则对手看到具体几张背面牌。

---

## 7. 动作公开模型

### 7.1 不再给动作贴“唯一可见性标签”

旧文档把动作标成 `PUBLIC_FULL`、`COUNT_ONLY` 一类标签，太粗。

新方案中，每个动作要同时定义三层输出：

1. `publicDelta`
   双方共享的状态变化与公共日志。
2. `privateDeltaBySeat`
   只给某个座位的私密补充信息。
3. `sealedAudit`
   服务端密封保存的完整输入、候选、顺序、随机结果。

### 7.2 动作记录模板

建议统一成如下结构：

```ts
type AppliedActionRecord = {
  actionId: string
  actionType: string
  publicDelta: PublicDelta
  privateDeltaBySeat: Partial<Record<Seat, PrivateDelta>>
  sealedAudit: SealedAudit
}
```

### 7.3 公共日志只记录公共世界发生了什么

公共日志应描述“双方都该知道的桌面变化”，例如：

- `先攻盖放了 2 张 Live 卡。`
- `后攻补抽了 2 张。`
- `先攻翻开 Live：XXX。`
- `后攻从手牌 play 成员：YYY。`

它不应该描述：

- 检视到哪些候选
- Mulligan 换掉了哪些具体牌
- 私密区原本有哪些可选项

### 7.4 私密日志只补给相关玩家

例如：

- `你检视了主卡组上方 3 张：A / B / C`
- `你盖放到 Live 区的是：X / Y`
- `你选择用于 Mulligan 的牌为：M / N`

### 7.5 密封审计日志为争议服务

至少应保存：

- 私密候选全集
- 操作者实际选择
- 进入非公开区后的顺序
- 洗牌输入与随机种子/结果
- 任何系统自动补足的隐式动作

普通对手和普通观战不读取这层。

---

## 8. 关键动作映射

### 8.1 洗牌

- `publicDelta`
  记录“某玩家洗了某个合法牌群”
- `privateDeltaBySeat`
  通常为空
- `sealedAudit`
  记录原顺序、随机源、结果顺序或可重放随机参数

### 8.2 抽牌

- `publicDelta`
  手牌数 `+1`
- `privateDeltaBySeat`
  抽到哪张牌，对抽牌玩家显示 `FRONT`
- `sealedAudit`
  抽取来源、卡牌 ID、抽牌时顶牌顺序

### 8.3 检视牌库顶 N 张

- `publicDelta`
  最多记录“玩家检视了牌库上方 N 张”
- `privateDeltaBySeat`
  向该玩家展示这些牌的 `FRONT`
- `sealedAudit`
  记录被检视的完整牌组和顺序

### 8.4 Mulligan

- `publicDelta`
  记录“玩家已提交 Mulligan”，必要时可包含换牌张数
- `privateDeltaBySeat`
  向本人显示被换出的牌、换入的牌
- `sealedAudit`
  记录完整换牌集合与洗回牌库顺序变化

### 8.5 从手牌盖放 Live

- `publicDelta`
  Live 区新增若干 `BACK` 对象，对手可见数量与占位；随后补抽张数公开
- `privateDeltaBySeat`
  操作者继续看到这些盖牌的 `FRONT`
- `sealedAudit`
  记录具体卡牌 ID 和盖放顺序

这是最典型的：

- 同一张牌对自己是 `FRONT`
- 对对手是 `BACK`

### 8.6 翻开 Live

- `publicDelta`
  对手视角 `BACK -> FRONT`
- `privateDeltaBySeat`
  通常为空，因为操作者原本已知
- `sealedAudit`
  记录翻开前后对象、无效 Live 的去向

### 8.7 从手牌 play 到公开区

- `publicDelta`
  该牌进入公开对象并对双方为 `FRONT`
- `privateDeltaBySeat`
  仅可能补充本方手牌移除动画所需信息
- `sealedAudit`
  记录来源手牌对象 ID、支付费用、目标位置

### 8.8 从公开区移动到非公开区

- `publicDelta`
  公开对象离场；目标私有容器的张数变化对双方公开
- `privateDeltaBySeat`
  对拥有者补充进入的具体牌
- `sealedAudit`
  记录进入后顺序

---

## 9. 前端投影规则

### 9.1 玩家视图不是“权威状态打码版”

应直接从权威状态投影出：

- `PlayerViewState[A]`
- `PlayerViewState[B]`

每个视图中的每张牌都已带有本座位的 `surface` 结果，而不是让前端自己猜。

### 9.2 前端应按 `surface` 渲染

建议前端只处理三种卡面渲染：

- `FRONT`
- `BACK`
- `NONE`

其中：

- `NONE` 不渲染单卡，只显示容器摘要
- `BACK` 渲染背面卡对象
- `FRONT` 渲染真实卡面

### 9.3 计数、占位、卡面分别来自不同字段

不要再让前端从“渲染了几张背面牌”反推张数。

应明确区分：

- `zone.count`
- `zone.occupants`
- `card.surface`

否则手牌、牌库、Live 盖牌这三种语义会互相污染。

---

## 10. 最小护栏

在保留“信任玩家原则”的前提下，联机至少保留以下底线：

1. 对手手牌、主卡组、能量卡组的单卡对象不能泄露。
2. 里侧 Live 在翻开前，对手只能看到 `BACK`，不能看到 `FRONT`。
3. 从非公开域进入公开域的牌，进入公开域时必须向双方变为 `FRONT`。
4. 从公开域进入非公开域时，公开对象必须先从公共世界消失，再只保留容器级摘要。
5. 顺序受规则管理的区域，必须由服务端维护，不允许客户端自行重排。
6. 所有私密动作都必须写入 `sealedAudit`，否则无法争议回放。

---

## 11. 对协议层的直接要求

协议层不再建议继续传抽象标签如 `PUBLIC_FULL`。更适合直接传三类数据：

- 状态投影
- 公共事件
- 私密事件

示意：

```json
{
  "actionType": "SET_LIVE_FROM_HAND",
  "publicDelta": {
    "summary": "先攻盖放了 2 张 Live 卡，并补抽了 2 张",
    "zoneChanges": [
      {
        "zone": "p1.live",
        "visibleOccupantsForOpponent": [
          { "surface": "BACK" },
          { "surface": "BACK" }
        ]
      }
    ]
  },
  "privateDeltaBySeat": {
    "FIRST": {
      "revealedCardIds": ["c1", "c2"]
    }
  }
}
```

这样协议与渲染都围绕“谁看到哪一面”展开，而不是围绕不稳定的枚举命名展开。

---

## 12. 结论

Loveca 联机模式最稳固的设计基座应是：

- 容器层决定“数量、占位、顺序”对谁可见。
- 卡牌层决定“对每位玩家，这张牌显示正面、背面还是不存在”。
- 动作层只负责产生 `publicDelta / privateDeltaBySeat / sealedAudit` 三类结果。

这样之后：

- “张数始终公开”会自然落在容器层。
- “表侧/里侧/仅自己可看”会自然落在卡牌层。
- “过程公开、结果公开、还是仅密封审计”会自然落在动作层。

这套模型比旧版矩阵更接近实体卡牌桌，也更容易直接落到引擎、协议、前端投影和争议回放。
