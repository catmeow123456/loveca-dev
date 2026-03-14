# Loveca UI 重设计方案

> Love Live! series official card game 的数字化实现，需要一套与 IP 气质匹配的视觉语言。

---

## 为什么要重设计

当前 UI 存在五个核心问题：

1. **三套配色并存**——游戏板用深蓝 `#1a1a2e`，主页用棕橙 `#2d2820`，卡组管理用粉紫 `#2d2438`，视觉身份完全割裂
2. **开发者原型感**——系统字体（Segoe UI / Roboto）、emoji 做图标（🎴📚🎮⚙️）、虚线边框做区域，像半成品而非游戏
3. **游戏板缺氛围**——背景图（deck.png 樱花插画）直接裸用，无遮罩无景深，UI 浮在亮色图上可读性差
4. **组件风格混乱**——按钮有 3+ 种样式（红渐变 / 粉渐变 / 内联 Tailwind），面板、模态框各用各的颜色
5. **无 Love Live 特征**——看不出这是偶像卡牌游戏，Heart 六色没有成为设计语言的一部分

---

## 核心设计原则

### 原则一：暖色统一（Warm Palette Unity）

**所有页面共享同一套暖棕色基调。**

游戏的两个关键素材决定了色温方向：
- `deck.png`（游戏桌背景）：明亮的樱花场景插画，暖白天空、粉色樱花、棕色制服、绿色植被
- `back.jpg`（卡背）：白底 + 热粉色 Love Live Logo

深紫/深蓝冷色调会与这些素材产生色温冲突。因此：

- **底色**：深巧克力棕 `#1A1510` → `#362E25` 的渐变层级，温暖而不刺眼
- **主强调色**：樱花玫瑰 `#EC6B8A`，直接从卡背的热粉色和背景的樱花色中提取
- **次强调色**：琥珀橙 `#E8985A`，与棕色底色自然协调
- **文字**：暖白/米色 `#F5EDE4`，不用冷白 `#FFFFFF`
- **边框**：基于 `rgba(210,180,140,...)` 的暖米色，不用冷蓝灰

**禁止**：在任何页面使用冷蓝、冷紫、冷灰作为大面积底色或边框色。

### 原则二：素材共生（Live with Assets）

**保留 deck.png 作为游戏板背景，但必须加半透明暖棕遮罩。**

当前的做法是让 UI 直接浮在明亮的插画上，导致文字难读、层次不清。正确做法：

```
游戏板背景层（从后到前）：
1. deck.png 原图（cover, center）
2. 半透明暖棕遮罩 rgba(26,21,16,0.55) —— 压暗背景，让 UI 可读
3. 顶部/底部微弱的径向光（粉色/琥珀色，opacity < 0.06）—— 营造舞台灯光感
4. 边缘暗角 vignette —— 引导视觉焦点到中心
```

非游戏板页面（主页、认证、卡组管理）不使用背景图，仅用暖棕渐变 + 微弱的径向聚光灯效果。

### 原则三：磨砂玻璃统一语言（Frosted Glass Unification）

**所有浮动 UI 元素统一使用磨砂玻璃面板。**

当前的面板、模态框、侧边栏各有各的背景色和透明度。统一为一种模式：

```css
background:     rgba(35,30,23,0.88);
backdrop-filter: blur(16px) saturate(1.2);
border:         1px solid rgba(210,180,140,0.18);
border-radius:  20px;
```

适用于：阶段指示器、游戏日志、效果窗口、判定面板、分数面板、换牌面板、卡组管理面板、主页导航卡片。

模态框额外加 3px 顶部渐变强调条（颜色随面板类型变化：琥珀/玫瑰/金色）。

### 原则四：告别原型感（No More Prototype Look）

三个具体动作：

**4a. 字体升级**

| 用途 | 现在 | 改为 |
|------|------|------|
| 标题/横幅 | Segoe UI | **Quicksand**（圆润几何，传达活力与亲和） |
| 正文/界面 | Segoe UI | **Nunito Sans**（干净圆润，良好 CJK 回退） |
| 游戏日志 | Fira Code | **JetBrains Mono** |
| 中文兜底 | 系统字体 | **Noto Sans SC** |

**4b. 图标升级**

全部 emoji 替换为 **Lucide Icons**（MIT 协议，React 原生支持，24px 网格统一）：

| 现在 | 改为 | 场景 |
|------|------|------|
| 🎴 | `<Layers />` | Logo |
| 📚 | `<BookOpen />` | 卡组管理 |
| 🎮 | `<Gamepad2 />` | 开始游戏 |
| ⚙️ | `<Settings />` | 管理 |
| 🚪 | `<LogOut />` | 登出 |
| 🎤 | `<Mic />` | 演出 |
| 🏆 | `<Trophy />` | 胜利 |
| ♥ | 自定义 SVG 心形 | Heart 图标 |
| ...其余 emoji | 对应 Lucide 图标 | 全局 |

**4c. 边框升级**

游戏区域的虚线边框 (`border: 2px dashed`) 全部改为**实线 + 状态发光**：

| 区域状态 | 边框 | 额外效果 |
|----------|------|----------|
| 空槽位 | 1.5px solid 暖米色 10% | 无 |
| 有卡牌 | 1.5px solid 暖米色 18% | 无 |
| 拖拽目标 | 1.5px solid 樱花玫瑰 60% | box-shadow 发光 |
| 活跃高亮 | 1.5px solid 热粉 50% | box-shadow 发光 |

### 原则五：Heart 色彩作为设计语言（Heart Colors as Design Language）

Love Live TCG 的六色 Heart + 彩虹是游戏的视觉灵魂，但当前 UI 只在卡牌的小心形图标上使用它们。应该让 Heart 色彩渗透到 UI 的更多层面：

```
--heart-pink    #FF69B4     --heart-green   #34D399
--heart-red     #EF4444     --heart-blue    #60A5FA
--heart-yellow  #FBBF24     --heart-purple  #A78BFA
--heart-rainbow linear-gradient(90deg, 以上六色)
```

**用途扩展**：
- 阶段横幅的强调色（MAIN 用玫瑰、LIVE_SET 用琥珀、PERFORMANCE 用粉、LIVE_RESULT 用绿、GAME_END 用金）
- 主页导航卡片的左侧强调条
- 活跃玩家区域的边框发光色
- Live 成功动画的粒子颜色（随机取自 Heart 色板）
- 成功 Live 区的金色边框

### 原则六：动画有目的（Purposeful Motion）

当前的动画要么太少（游戏板几乎无动画），要么太随意（emoji sparkle）。规则：

- **日常交互**（150-300ms）：卡牌悬停抬起、按钮微移、区域高亮渐变——快速、不打断操作
- **戏剧性时刻**（500-2500ms）：阶段横幅的字间距动画 + 淡入、Live 结果的粒子 + 金色光晕——制造情绪高点
- **待机呼吸**（3-20s 循环）：背景聚光灯缓慢漂移、活跃玩家边框微弱脉冲——让界面"活着"但不分心
- **性能底线**：只动画 `transform` 和 `opacity`，禁止动画 `width`/`height`/`margin`

---

## 色彩令牌完整表

### 背景层级

| 令牌 | 值 | 用途 |
|------|------|------|
| `--bg-deep` | `#1A1510` | 最深背景（body） |
| `--bg-surface` | `#231E17` | 主表面（卡片、面板） |
| `--bg-elevated` | `#2D261E` | 抬升面板、模态框 |
| `--bg-overlay` | `#362E25` | 悬停、次要表面 |
| `--bg-frosted` | `rgba(35,30,23,0.88)` | 磨砂玻璃面板 |

### 边框

| 令牌 | 值 | 用途 |
|------|------|------|
| `--border-subtle` | `rgba(210,180,140,0.10)` | 默认边框 |
| `--border-default` | `rgba(210,180,140,0.18)` | 面板边框 |
| `--border-focus` | `rgba(236,147,165,0.40)` | 聚焦环 |
| `--border-active` | `rgba(255,130,160,0.50)` | 活跃区域 |

### 文字

| 令牌 | 值 | 用途 |
|------|------|------|
| `--text-primary` | `#F5EDE4` | 主文字（暖白/米色） |
| `--text-secondary` | `#B8A898` | 次要文字 |
| `--text-muted` | `#7A6D60` | 淡化文字 |
| `--text-inverse` | `#1A1510` | 反色文字 |

### 强调色

| 令牌 | 值 | 用途 |
|------|------|------|
| `--accent-primary` | `#EC6B8A` | 主强调——樱花玫瑰 |
| `--accent-primary-hover` | `#F28DA5` | 悬停态 |
| `--accent-secondary` | `#E8985A` | 次强调——琥珀橙 |
| `--accent-gold` | `#FBBF24` | 金色——成功、成就 |
| `--accent-gold-light` | `#FDE68A` | 浅金 |

### 语义色

| 令牌 | 值 | 用途 |
|------|------|------|
| `--semantic-success` | `#5CB87A` | 成功（暖绿） |
| `--semantic-error` | `#E85D75` | 错误（玫瑰红） |
| `--semantic-warning` | `#E8A84C` | 警告（琥珀） |
| `--semantic-info` | `#6BA3D6` | 信息（柔蓝） |

### 游戏板专用

| 令牌 | 值 | 用途 |
|------|------|------|
| `--board-overlay` | `rgba(26,21,16,0.55)` | 背景图遮罩 |
| `--board-overlay-heavy` | `rgba(26,21,16,0.75)` | 面板区域加强遮罩 |
| `--board-zone-bg` | `rgba(35,30,23,0.65)` | 区域容器背景 |

### 渐变

```
--gradient-page          linear-gradient(135deg, #1A1510, #231E17, #1E1914)
--gradient-panel         linear-gradient(145deg, rgba(45,38,30,0.95), rgba(35,30,23,0.95))
--gradient-spotlight     radial-gradient(ellipse at 50% 0%, rgba(236,107,138,0.06), transparent 60%)
--gradient-stage-glow    radial-gradient(ellipse at 50% 100%, rgba(232,152,90,0.05), transparent 50%)
--gradient-button        linear-gradient(135deg, #EC6B8A, #E8985A)
--gradient-button-hover  linear-gradient(135deg, #F28DA5, #F0B070)
--gradient-gold          linear-gradient(135deg, #FBBF24, #F59E0B)
```

---

## 按钮规范

统一为 5 种按钮，替换当前散乱的样式：

| 类型 | 外观 | 场景 |
|------|------|------|
| **Primary** | 玫瑰→琥珀渐变，白字，圆角 10px，发光阴影 | 主要操作（开始游戏、保存、确认） |
| **Secondary** | 透明底，暖米色边框，主色文字 | 次要操作（取消、导出） |
| **Ghost** | 无底无框，次要色文字，hover 时微亮背景 | 细微操作（忘记密码、链接） |
| **Gold** | 金色渐变，深色文字，金色发光 | 特殊确认（Live 成功选择） |
| **Icon** | 36px 方形，表面色底，细边框，SVG 图标 | 工具栏（撤销、展开、设置） |

---

## 逐页要点

### 全局

- 所有页面底色：`var(--gradient-page)`（暖棕渐变）
- 顶部/底部各一个极淡的径向聚光灯（玫瑰粉 / 琥珀，opacity < 0.06）

### 认证页面

- 深色暖棕背景（与全局统一，不再用浅色琥珀主题）
- 居中磨砂玻璃卡片（max-width 400px）
- Logo + 渐变文字标题（玫瑰粉 → 琥珀）

### 主页

- 磨砂玻璃顶栏（logo + 用户 + 登出）
- Logo 带渐变发光环动画
- 2 列网格：卡组管理 / 开始游戏（磨砂玻璃卡片，左侧 Heart 色强调条，hover 发光边框）

### 游戏板 ★

- deck.png 背景 + `--board-overlay` 半透明遮罩 + 微弱灯光层
- VS 分隔线：40px 高，水平渐变细线（玫瑰 → 琥珀），居中 "VS" 字样带 text-shadow 发光
- 所有区域：实线发光边框替代虚线
- 手牌区：扇形排列，hover 抬起 + 发光，选中金色环
- 活跃玩家：边框渐变发光 + 微弱背景色调 + 3s 脉冲动画
- 阶段指示器（右下）：磨砂玻璃，240px，回合数 + 阶段名 + 操作按钮
- 游戏日志（左侧可折叠）：磨砂玻璃，JetBrains Mono，分色日志条目

### 游戏面板（模态框）

- 统一遮罩：`bg-black/70 backdrop-blur-sm`
- 统一容器：`--bg-elevated` + 圆角 20px + 顶部 3px 渐变强调条
- 换牌面板：琥珀强调条
- 判定面板：玫瑰强调条
- 分数面板：玫瑰强调条
- 效果窗口：玫瑰 → 琥珀强调条

### 阶段横幅

- 全屏覆盖，径向渐变背景（阶段色 5% opacity）
- Quicksand 大字，字间距动画（宽 → 窄），text-shadow 发光
- 6-8 个 CSS 粒子（不是 emoji）从中心向外扩散
- 500ms 动画序列：blur → clear → hold → fade up

### 卡牌组件

- 卡背：暖棕渐变 `#2A1F18` → `#4A3428` + 星形 SVG 水印
- hover：translateY(-8px) + scale(1.05) + 类型色发光环
- 选中：金色 ring
- 待机：brightness(0.5)，不用灰度滤镜

### 卡组管理

- 统一暖棕主题（不再用粉紫 cute theme）
- 卡组列表用磨砂玻璃卡片，hover 边框渐变为玫瑰粉

### Live 结果动画

- **成功**：金色径向光 + "LIVE SUCCESS!" 金色大字 + 12-16 个 Heart 色 CSS 粒子 + 2.5s
- **失败**：冷灰径向光 + "LIVE FAILED" 灰色字 + 无粒子 + 2s

---

## 动画速度参考

```
日常交互          150-300ms    卡牌悬停、按钮、区域高亮、侧边栏
面板开关          200-250ms    opacity + scale
戏剧性时刻        500-2500ms   阶段横幅、Live 结果、游戏结束
待机呼吸          3-20s        聚光灯漂移、活跃玩家脉冲
```

---

## 间距与圆角

8px 基准网格：`4 / 8 / 12 / 16 / 24 / 32 / 40 / 48 px`

```
--radius-sm    6px      徽章、小元素
--radius-md    10px     按钮、输入框
--radius-lg    14px     卡牌、面板
--radius-xl    20px     模态框、大面板
--radius-full  9999px   药丸形、头像
```

---

## 实施优先级

| 阶段 | 做什么 | 涉及文件 |
|------|--------|----------|
| **1. 基础令牌** | CSS 变量、Google Fonts 导入、全局背景、按钮/输入框样式 | `index.css` |
| **2. 认证 + 主页** | 统一暖棕主题，磨砂玻璃面板，Lucide 图标 | `auth/*`, `pages/HomePage.tsx` |
| **3. 游戏板** | 背景遮罩、VS 分隔线、区域边框、卡牌状态、PlayerArea | `game/GameBoard.tsx`, `PlayerArea.tsx`, `Card.tsx` |
| **4. 游戏面板** | PhaseIndicator、PhaseBanner、各模态面板、GameLog | `game/*.tsx` |
| **5. 收尾** | LiveResultAnimation、DeckManager 统一、滚动条、待机动画 | 全局 |

---

## 完整 CSS 变量

```css
:root {
  /* 背景 */
  --bg-deep: #1A1510;
  --bg-surface: #231E17;
  --bg-elevated: #2D261E;
  --bg-overlay: #362E25;
  --bg-frosted: rgba(35,30,23,0.88);

  /* 边框 */
  --border-subtle: rgba(210,180,140,0.10);
  --border-default: rgba(210,180,140,0.18);
  --border-focus: rgba(236,147,165,0.40);
  --border-active: rgba(255,130,160,0.50);

  /* 文字 */
  --text-primary: #F5EDE4;
  --text-secondary: #B8A898;
  --text-muted: #7A6D60;
  --text-inverse: #1A1510;

  /* 强调色 */
  --accent-primary: #EC6B8A;
  --accent-primary-hover: #F28DA5;
  --accent-secondary: #E8985A;
  --accent-gold: #FBBF24;
  --accent-gold-light: #FDE68A;

  /* 语义色 */
  --semantic-success: #5CB87A;
  --semantic-error: #E85D75;
  --semantic-warning: #E8A84C;
  --semantic-info: #6BA3D6;

  /* Heart 色 */
  --heart-pink: #FF69B4;
  --heart-red: #EF4444;
  --heart-yellow: #FBBF24;
  --heart-green: #34D399;
  --heart-blue: #60A5FA;
  --heart-purple: #A78BFA;
  --heart-rainbow: linear-gradient(90deg, #FF69B4, #EF4444, #FBBF24, #34D399, #60A5FA, #A78BFA);

  /* 渐变 */
  --gradient-page: linear-gradient(135deg, #1A1510 0%, #231E17 40%, #1E1914 100%);
  --gradient-panel: linear-gradient(145deg, rgba(45,38,30,0.95), rgba(35,30,23,0.95));
  --gradient-button: linear-gradient(135deg, #EC6B8A, #E8985A);
  --gradient-button-hover: linear-gradient(135deg, #F28DA5, #F0B070);
  --gradient-gold: linear-gradient(135deg, #FBBF24, #F59E0B);

  /* 游戏板 */
  --board-overlay: rgba(26,21,16,0.55);
  --board-overlay-heavy: rgba(26,21,16,0.75);
  --board-zone-bg: rgba(35,30,23,0.65);

  /* 字体 */
  --font-display: 'Quicksand', sans-serif;
  --font-body: 'Nunito Sans', 'Noto Sans SC', sans-serif;
  --font-mono: 'JetBrains Mono', monospace;

  /* 卡牌尺寸 */
  --card-width-sm: 75px;
  --card-height-sm: 105px;
  --card-width-md: 110px;
  --card-height-md: 154px;
  --card-width-lg: 180px;
  --card-height-lg: 252px;

  /* 间距 */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-6: 24px;
  --space-8: 32px;

  /* 圆角 */
  --radius-sm: 6px;
  --radius-md: 10px;
  --radius-lg: 14px;
  --radius-xl: 20px;
  --radius-full: 9999px;
}
```
