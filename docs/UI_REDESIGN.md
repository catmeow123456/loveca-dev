# Loveca UI 重设计方案 v2 — 双主题设计系统

> Love Live! series official card game 的数字化实现。
> 樱花与舞台——两种光线下的同一个世界。

---

## 为什么要重设计

当前 UI 存在六个核心问题：

1. **三套配色并存**——游戏板用深蓝 `#1a1a2e`，主页用棕橙 `#2d2820`，卡组管理用粉紫 `#2d2438`，视觉身份完全割裂
2. **开发者原型感**——系统字体默认堆叠、emoji 做图标（🎴📚🎮⚙️）、虚线边框做区域，像半成品而非游戏
3. **游戏板缺氛围**——背景图（deck.png 樱花插画）直接裸用，无遮罩无景深，UI 浮在亮色图上可读性差
4. **组件风格混乱**——按钮有 3+ 种样式（红渐变 / 粉渐变 / 内联 Tailwind），面板、模态框各用各的颜色
5. **无 Love Live 特征**——看不出这是偶像卡牌游戏，Heart 六色没有成为设计语言的一部分
6. **无主题切换**——强制深色背景，无法适应不同环境和用户偏好；浅色认证页与深色游戏板之间的割裂尤为明显

---

## 核心设计原则

### 原则一：双主题统一（Dual Theme Unity）

**一套语义令牌，两种色彩表达。深色与浅色共享同一个设计骨架。**

游戏的两个关键素材决定了色温方向：
- `deck.png`（游戏桌背景）：明亮的樱花场景插画，暖白天空、粉色樱花、棕色制服、绿色植被
- `back.jpg`（卡背）：白底 + 热粉色 Love Live Logo

两种主题分别诠释这份温暖：

| 维度 | 深色主题「夜之舞台」 | 浅色主题「樱之午后」 |
|------|----------------------|----------------------|
| 意境 | 演唱会灯光下的温暖暗场 | 春日午后樱花树下的明媚 |
| 底色 | 深巧克力棕 `#1A1510` → `#362E25` | 暖奶油白 `#FBF7F4` → `#FFFFFF` |
| 主强调 | 樱花玫瑰 `#EC6B8A` | 深樱玫瑰 `#DC5A7A`（白底需更深以保证对比度） |
| 次强调 | 琥珀橙 `#E8985A` | 深琥珀 `#D4864E` |
| 文字 | 暖白/米色 `#F5EDE4` | 暖近黑 `#2D2420` |
| 边框 | `rgba(210,180,140,...)` 暖米色 | `rgba(160,130,100,...)` 暖棕色 |

**禁止**：在任何主题中使用冷蓝、冷紫、冷灰作为大面积底色。

### 原则二：素材共生（Live with Assets）

**保留 deck.png 作为游戏板背景，遮罩跟随主题变化。**

```
深色主题——游戏板背景层（从后到前）：
1. deck.png 原图（cover, center）
2. 半透明暖棕遮罩 rgba(26,21,16,0.55) —— 压暗背景
3. 顶部/底部微弱径向光（玫瑰粉/琥珀色，opacity < 0.06）
4. 边缘暗角 vignette

浅色主题——游戏板背景层（从后到前）：
1. deck.png 原图（cover, center）
2. 极淡暖白 wash rgba(255,248,244,0.25) —— 轻微统一色调
3. 顶部/底部微弱径向光（玫瑰粉，opacity < 0.04）
4. 无暗角（保持明亮通透感）
```

非游戏板页面不使用背景图，仅用 `var(--gradient-page)` + 微弱径向聚光灯。

### 原则三：磨砂玻璃统一语言（Frosted Glass Unification）

**所有浮动 UI 元素统一使用磨砂玻璃面板，参数跟随主题。**

```css
/* 深色主题 */
background:     rgba(35,30,23,0.88);
backdrop-filter: blur(16px) saturate(1.2);
border:         1px solid rgba(210,180,140,0.18);
border-radius:  20px;

/* 浅色主题 */
background:     rgba(255,255,255,0.82);
backdrop-filter: blur(16px) saturate(1.3);
border:         1px solid rgba(160,130,100,0.15);
border-radius:  20px;
```

适用于：阶段指示器、游戏日志、效果窗口、判定面板、分数面板、换牌面板、卡组管理面板、主页导航卡片。

模态框额外加 3px 顶部渐变强调条（颜色随面板类型变化：琥珀/玫瑰/金色）。强调条色值两个主题保持一致——在深色底上它是发光色，在浅色底上它是点缀色。

### 原则四：告别原型感（No More Prototype Look）

三个具体动作：

**4a. 字体系统**

使用系统字体栈，不依赖 Google Fonts，保证零加载延迟和最佳渲染：

| 用途 | 字体栈 |
|------|--------|
| 标题/横幅 | `system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif` |
| 正文/界面 | 同上（系统字体在各平台已足够优秀） |
| 游戏日志/等宽 | `ui-monospace, 'Cascadia Code', 'Source Code Pro', Menlo, Consolas, monospace` |
| CJK 回退 | 在上述栈末尾追加 `'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif` |

关键排版参数：
- 标题：`font-weight: 700`，`letter-spacing: -0.01em`（紧凑有力）
- 正文：`font-weight: 400`，`line-height: 1.5`
- 小标签/徽章：`font-weight: 600`，`font-size: 0.75rem`，`letter-spacing: 0.02em`

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
| ✅ | `<Check />` | 确认 |
| ↩️ | `<Undo2 />` | 撤销 |
| 📊 | `<BarChart3 />` | 判定/统计 |
| 🎵 | `<Music />` | Live Start |
| ✨ | `<Sparkles />` | 装饰/特效 |
| 📴 | `<WifiOff />` | 离线 |
| 🌐 | `<Globe />` | 在线 |
| ⚡ | `<Zap />` | 本地模式 |
| ♥ | 自定义 SVG 心形 | Heart 图标 |
| ☀️/🌙 | `<Sun />` / `<Moon />` | 主题切换 |

**4c. 边框升级**

游戏区域的虚线边框 (`border: 2px dashed`) 全部改为**实线 + 状态发光**：

| 区域状态 | 边框 | 额外效果 |
|----------|------|----------|
| 空槽位 | `1.5px solid var(--border-subtle)` | 无 |
| 有卡牌 | `1.5px solid var(--border-default)` | 无 |
| 拖拽目标 | `1.5px solid var(--accent-primary) / 60%` | `box-shadow: 0 0 12px var(--accent-primary) / 25%` |
| 活跃高亮 | `1.5px solid var(--border-active)` | `box-shadow: 0 0 16px var(--border-active) / 30%` |

### 原则五：Heart 色彩作为设计语言（Heart Colors as Design Language）

Love Live TCG 的六色 Heart + 彩虹是游戏的视觉灵魂。Heart 色值**两个主题完全一致**——它们是游戏语义色，不随主题变化：

```
--heart-pink    #FF69B4     --heart-green   #34D399
--heart-red     #EF4444     --heart-blue    #60A5FA
--heart-yellow  #FBBF24     --heart-purple  #A78BFA
--heart-rainbow linear-gradient(90deg, 以上六色)
```

**用途扩展**：
- 阶段横幅的强调色（MAIN 用玫瑰、LIVE_SET 用琥珀、PERFORMANCE 用粉、LIVE_RESULT 用绿、GAME_END 用金）
- 主页导航卡片的左侧 3px 强调条
- 活跃玩家区域的边框发光色
- Live 成功动画的粒子颜色（随机取自 Heart 色板）
- 成功 Live 区的金色边框
- 判定面板中每种 Heart 的计数标签颜色

### 原则六：动画有目的（Purposeful Motion）

规则不因主题而变：

- **日常交互**（150-300ms）：卡牌悬停抬起、按钮微移、区域高亮渐变——快速、不打断操作
- **戏剧性时刻**（500-2500ms）：阶段横幅的字间距动画 + 淡入、Live 结果的粒子 + 金色光晕——制造情绪高点
- **待机呼吸**（3-20s 循环）：背景聚光灯缓慢漂移、活跃玩家边框微弱脉冲——让界面"活着"但不分心
- **性能底线**：只动画 `transform` 和 `opacity`，禁止动画 `width`/`height`/`margin`

---

## 主题机制

### data-theme 属性

在 `<html>` 元素上设置 `data-theme="dark"` 或 `data-theme="light"`。所有语义令牌通过 CSS 自定义属性按主题覆盖：

```css
:root { /* 主题无关令牌 */ }
html[data-theme="dark"]  { /* 深色令牌 */ }
html[data-theme="light"] { /* 浅色令牌 */ }
```

### 主题检测与持久化

```typescript
// 初始化逻辑（App.tsx useEffect 或 index.html <script>）
const stored = localStorage.getItem('loveca-theme');
const preferred = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
const theme = stored || preferred;  // 默认跟随系统
document.documentElement.setAttribute('data-theme', theme);
```

### ThemeToggle 组件

- 药丸形按钮（`--radius-full`），内含 Lucide `<Sun />` / `<Moon />` 图标
- 点击时图标做 180° 旋转过渡（`transition: transform 300ms`）
- 位置：
  - 主页 header 右侧（登出按钮旁）
  - 游戏板 PhaseIndicator 上方
  - 认证页右上角
  - 卡组管理 header 右侧

---

## 色彩令牌

### 主题无关令牌（`:root`）

这些值在深色/浅色主题中**完全一致**：

```css
:root {
  /* Heart 色（游戏语义色） */
  --heart-pink: #FF69B4;
  --heart-red: #EF4444;
  --heart-yellow: #FBBF24;
  --heart-green: #34D399;
  --heart-blue: #60A5FA;
  --heart-purple: #A78BFA;
  --heart-rainbow: linear-gradient(90deg, #FF69B4, #EF4444, #FBBF24, #34D399, #60A5FA, #A78BFA);

  /* 字体 */
  --font-display: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto,
                  'Helvetica Neue', Arial, 'PingFang SC', 'Hiragino Sans GB',
                  'Microsoft YaHei', sans-serif;
  --font-body: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto,
               'Helvetica Neue', Arial, 'PingFang SC', 'Hiragino Sans GB',
               'Microsoft YaHei', sans-serif;
  --font-mono: ui-monospace, 'Cascadia Code', 'Source Code Pro', Menlo, Consolas,
               'PingFang SC', monospace;

  /* 卡牌尺寸 */
  --card-width-sm: 75px;
  --card-height-sm: 105px;
  --card-width-md: 110px;
  --card-height-md: 154px;
  --card-width-lg: 180px;
  --card-height-lg: 252px;

  /* 间距（8px 基准网格） */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-6: 24px;
  --space-8: 32px;
  --space-10: 40px;
  --space-12: 48px;

  /* 圆角 */
  --radius-sm: 6px;
  --radius-md: 10px;
  --radius-lg: 14px;
  --radius-xl: 20px;
  --radius-full: 9999px;

  /* 动画时长 */
  --duration-fast: 150ms;
  --duration-normal: 250ms;
  --duration-slow: 500ms;
  --duration-dramatic: 2500ms;

  /* Z-index 层级 */
  --z-game-log: 50;
  --z-phase-indicator: 60;
  --z-live-result: 100;
  --z-modal: 101;
  --z-card-detail: 200;
  --z-phase-banner: 1000;
}
```

### 深色主题（`html[data-theme="dark"]`）

| 分类 | 令牌 | 值 | 用途 |
|------|------|------|------|
| **背景** | `--bg-deep` | `#1A1510` | body 最深背景 |
| | `--bg-surface` | `#231E17` | 主表面（卡片、面板） |
| | `--bg-elevated` | `#2D261E` | 抬升面板、模态框 |
| | `--bg-overlay` | `#362E25` | 悬停、次要表面 |
| | `--bg-frosted` | `rgba(35,30,23,0.88)` | 磨砂玻璃面板 |
| | `--bg-input` | `#1E1912` | 输入框背景 |
| **边框** | `--border-subtle` | `rgba(210,180,140,0.10)` | 默认边框 |
| | `--border-default` | `rgba(210,180,140,0.18)` | 面板边框 |
| | `--border-focus` | `rgba(236,147,165,0.40)` | 聚焦环 |
| | `--border-active` | `rgba(255,130,160,0.50)` | 活跃区域 |
| **文字** | `--text-primary` | `#F5EDE4` | 主文字（暖白/米色） |
| | `--text-secondary` | `#B8A898` | 次要文字 |
| | `--text-muted` | `#7A6D60` | 淡化文字 |
| | `--text-inverse` | `#1A1510` | 反色文字（用于亮底按钮） |
| **强调** | `--accent-primary` | `#EC6B8A` | 樱花玫瑰 |
| | `--accent-primary-hover` | `#F28DA5` | 玫瑰悬停（提亮） |
| | `--accent-secondary` | `#E8985A` | 琥珀橙 |
| | `--accent-gold` | `#FBBF24` | 金色 |
| | `--accent-gold-light` | `#FDE68A` | 浅金 |
| **语义** | `--semantic-success` | `#5CB87A` | 成功（暖绿） |
| | `--semantic-error` | `#E85D75` | 错误（玫瑰红） |
| | `--semantic-warning` | `#E8A84C` | 警告（琥珀） |
| | `--semantic-info` | `#6BA3D6` | 信息（柔蓝） |
| **游戏板** | `--board-overlay` | `rgba(26,21,16,0.55)` | 背景图遮罩 |
| | `--board-overlay-heavy` | `rgba(26,21,16,0.75)` | 面板区域加强遮罩 |
| | `--board-zone-bg` | `rgba(35,30,23,0.65)` | 区域容器背景 |
| **渐变** | `--gradient-page` | `linear-gradient(135deg, #1A1510 0%, #231E17 40%, #1E1914 100%)` | 页面背景 |
| | `--gradient-panel` | `linear-gradient(145deg, rgba(45,38,30,0.95), rgba(35,30,23,0.95))` | 面板背景 |
| | `--gradient-spotlight` | `radial-gradient(ellipse at 50% 0%, rgba(236,107,138,0.06), transparent 60%)` | 顶部聚光灯 |
| | `--gradient-stage-glow` | `radial-gradient(ellipse at 50% 100%, rgba(232,152,90,0.05), transparent 50%)` | 底部舞台光 |
| | `--gradient-button` | `linear-gradient(135deg, #EC6B8A, #E8985A)` | 主按钮 |
| | `--gradient-button-hover` | `linear-gradient(135deg, #F28DA5, #F0B070)` | 主按钮悬停 |
| | `--gradient-gold` | `linear-gradient(135deg, #FBBF24, #F59E0B)` | 金色按钮 |
| **阴影** | `--shadow-sm` | `0 1px 3px rgba(0,0,0,0.4)` | 小阴影 |
| | `--shadow-md` | `0 4px 12px rgba(0,0,0,0.5)` | 中阴影 |
| | `--shadow-lg` | `0 8px 24px rgba(0,0,0,0.6)` | 大阴影 |
| | `--shadow-glow` | `0 0 20px rgba(236,107,138,0.25)` | 发光阴影 |
| **滚动条** | `--scrollbar-thumb` | `rgba(210,180,140,0.35)` | 滚动条滑块 |
| | `--scrollbar-track` | `rgba(210,180,140,0.08)` | 滚动条轨道 |
| **遮罩** | `--modal-backdrop` | `rgba(0,0,0,0.70)` | 模态框背景遮罩 |

### 浅色主题（`html[data-theme="light"]`）

| 分类 | 令牌 | 值 | 用途 |
|------|------|------|------|
| **背景** | `--bg-deep` | `#FBF7F4` | body 最浅背景（暖奶油白） |
| | `--bg-surface` | `#FFFFFF` | 主表面（卡片、面板） |
| | `--bg-elevated` | `#FFF8F5` | 抬升面板、模态框（微粉调） |
| | `--bg-overlay` | `#F5EDE8` | 悬停、次要表面 |
| | `--bg-frosted` | `rgba(255,255,255,0.82)` | 磨砂玻璃面板 |
| | `--bg-input` | `#FBF7F4` | 输入框背景 |
| **边框** | `--border-subtle` | `rgba(160,130,100,0.12)` | 默认边框 |
| | `--border-default` | `rgba(160,130,100,0.22)` | 面板边框 |
| | `--border-focus` | `rgba(220,90,120,0.35)` | 聚焦环 |
| | `--border-active` | `rgba(236,107,138,0.45)` | 活跃区域 |
| **文字** | `--text-primary` | `#2D2420` | 主文字（暖近黑） |
| | `--text-secondary` | `#6B5D52` | 次要文字 |
| | `--text-muted` | `#A89888` | 淡化文字 |
| | `--text-inverse` | `#F5EDE4` | 反色文字（用于深底按钮） |
| **强调** | `--accent-primary` | `#DC5A7A` | 深樱玫瑰（白底对比度更高） |
| | `--accent-primary-hover` | `#C94D6D` | 玫瑰悬停（加深） |
| | `--accent-secondary` | `#D4864E` | 深琥珀 |
| | `--accent-gold` | `#D4A017` | 深金 |
| | `--accent-gold-light` | `#F0D060` | 浅金 |
| **语义** | `--semantic-success` | `#2D9E55` | 成功（深暖绿） |
| | `--semantic-error` | `#D4465E` | 错误（深玫瑰） |
| | `--semantic-warning` | `#C4882A` | 警告（深琥珀） |
| | `--semantic-info` | `#4A86BE` | 信息（深柔蓝） |
| **游戏板** | `--board-overlay` | `rgba(255,248,244,0.25)` | 极淡暖白 wash |
| | `--board-overlay-heavy` | `rgba(255,248,244,0.55)` | 面板区域浅遮罩 |
| | `--board-zone-bg` | `rgba(255,255,255,0.55)` | 区域容器（半透明白） |
| **渐变** | `--gradient-page` | `linear-gradient(135deg, #FBF7F4 0%, #FFF0EB 40%, #FBF7F4 100%)` | 页面背景 |
| | `--gradient-panel` | `linear-gradient(145deg, rgba(255,255,255,0.95), rgba(255,248,244,0.95))` | 面板背景 |
| | `--gradient-spotlight` | `radial-gradient(ellipse at 50% 0%, rgba(236,107,138,0.08), transparent 60%)` | 顶部聚光灯 |
| | `--gradient-stage-glow` | `radial-gradient(ellipse at 50% 100%, rgba(232,152,90,0.06), transparent 50%)` | 底部舞台光 |
| | `--gradient-button` | `linear-gradient(135deg, #EC6B8A, #E8985A)` | 主按钮（保持鲜艳） |
| | `--gradient-button-hover` | `linear-gradient(135deg, #DC5A7A, #D4864E)` | 主按钮悬停（加深） |
| | `--gradient-gold` | `linear-gradient(135deg, #FBBF24, #F59E0B)` | 金色按钮 |
| **阴影** | `--shadow-sm` | `0 1px 3px rgba(160,130,100,0.12)` | 小阴影 |
| | `--shadow-md` | `0 4px 12px rgba(160,130,100,0.15)` | 中阴影 |
| | `--shadow-lg` | `0 8px 24px rgba(160,130,100,0.18)` | 大阴影 |
| | `--shadow-glow` | `0 0 20px rgba(220,90,120,0.18)` | 发光阴影 |
| **滚动条** | `--scrollbar-thumb` | `rgba(160,130,100,0.30)` | 滚动条滑块 |
| | `--scrollbar-track` | `rgba(160,130,100,0.08)` | 滚动条轨道 |
| **遮罩** | `--modal-backdrop` | `rgba(0,0,0,0.40)` | 模态框背景遮罩（浅色更轻） |

---

## 按钮规范

统一为 5 种按钮，**所有按钮使用 CSS 变量**，自动适配双主题：

| 类型 | 外观 | 场景 |
|------|------|------|
| **Primary** | `var(--gradient-button)` 背景，`var(--text-inverse)` 文字（深色主题为深色字，浅色主题为白字），圆角 `--radius-md`，`var(--shadow-glow)` | 主要操作（开始游戏、保存、确认） |
| **Secondary** | 透明底，`var(--border-default)` 边框，`var(--accent-primary)` 文字 | 次要操作（取消、导出） |
| **Ghost** | 无底无框，`var(--text-secondary)` 文字，hover 时 `var(--bg-overlay)` 背景 | 细微操作（忘记密码、链接） |
| **Gold** | `var(--gradient-gold)` 背景，`var(--text-inverse)` 文字，金色发光 | 特殊确认（Live 成功选择） |
| **Icon** | 36px 方形，`var(--bg-surface)` 底，`var(--border-subtle)` 边框，Lucide 图标 | 工具栏（撤销、展开、设置、主题切换） |

Primary 按钮的文字颜色说明：渐变背景（玫瑰 → 琥珀）在两个主题中都足够鲜艳，因此文字统一使用白色（`#FFFFFF`），不使用 `--text-inverse`。

---

## 逐页/逐组件要点

### 全局

- 所有页面底色：`var(--gradient-page)`
- 顶部/底部各一个极淡的径向聚光灯（`var(--gradient-spotlight)` / `var(--gradient-stage-glow)`）
- 滚动条：使用 `var(--scrollbar-thumb)` / `var(--scrollbar-track)`，替换当前 `.cute-scrollbar` 的硬编码粉紫色
- 全局字体：`var(--font-body)`
- 主题切换时添加 `transition: background-color 300ms, color 300ms` 在 `html` 上，避免闪烁

### 认证页面（AuthLayout / Login / Register / ForgotPassword / ResetPassword）

- 不再区分"浅色认证页"和"深色游戏页"——**认证页跟随当前主题**
- 居中磨砂玻璃卡片（`var(--bg-frosted)` + `backdrop-filter`，max-width 400px）
- Logo + 渐变文字标题（`var(--gradient-button)` 做 `background-clip: text`）
- 输入框：`var(--bg-input)` 底色，`var(--border-default)` 边框，聚焦时 `var(--border-focus)` + `var(--shadow-glow)`
- 装饰粒子：用 `var(--accent-primary)` 颜色的小圆点替代 emoji 星星，保留呼吸动画
- 底部文字：`var(--text-muted)`

### 主页（HomePage）

- 磨砂玻璃顶栏（`var(--bg-frosted)`，logo + 用户 + 主题切换 + 登出）
- Logo 使用 `/icon.jpg`，边框 `var(--border-default)`，`var(--shadow-md)`
- Lucide 图标替换所有 emoji（`<BookOpen />`、`<Gamepad2 />`、`<Settings />`、`<LogOut />`、`<WifiOff />`、`<Globe />`、`<Zap />`）
- 2 列网格：卡组管理 / 开始游戏 卡片
  - 卡片：`var(--bg-frosted)` + `backdrop-filter: blur(12px)` + `var(--border-default)`
  - 左侧 3px 高度 100% 的 Heart 色强调条（卡组管理用 `--heart-pink`，开始游戏用 `--heart-green`）
  - hover：边框渐变为 `var(--accent-primary)`，`var(--shadow-glow)`
- 标签徽章：`var(--bg-overlay)` 底色 + `var(--border-subtle)` 边框（替换硬编码 `bg-orange-500/10`）
- 状态指示器药丸：`var(--bg-surface)` + `var(--border-subtle)`
- Footer：`var(--text-muted)`

### 游戏板 ★（GameBoard + PlayerArea）

**布局完全不变**——flex 比例（5/auto/5）、区域排列（member slots、live zone、success zone、hand、energy、decks）、dnd-kit 拖拽逻辑全部保持。

仅改视觉：

- **背景**：保留 `deck.png`，上方叠加 `var(--board-overlay)` + `var(--gradient-spotlight)` + `var(--gradient-stage-glow)`
  - 深色：暖棕遮罩压暗，营造夜间演唱会
  - 浅色：极淡 wash，樱花插画自然透出，春日午后感
- **VS 分隔线**：32px 高，水平渐变细线（`var(--accent-primary)` → `var(--accent-secondary)`），居中 "VS" 字样，`text-shadow: 0 0 12px var(--accent-primary)`
  - 对墙打模式：弱化为 `var(--text-muted)` 色
- **区域边框**：全部实线（见原则四 4c），使用 `var(--border-*)` 令牌
- **手牌区**：扇形排列保持，hover `translateY(-8px) scale(1.05)` + 类型色发光环
- **活跃玩家**：边框 `var(--border-active)` + `var(--shadow-glow)` + 3s 脉冲动画（`opacity: 0.5 → 1 → 0.5`）
- **能量区/牌组堆叠**：伪元素颜色改为 `var(--bg-elevated)` + `var(--border-subtle)`（替换硬编码 `#667eea → #764ba2`）

### 阶段指示器（PhaseIndicator）

- 位置：固定右下角，z-index `var(--z-phase-indicator)`
- 宽度：w-64
- 容器：`var(--bg-frosted)` + `backdrop-filter: blur(16px)` + `var(--border-default)` + `var(--radius-lg)` + `var(--shadow-lg)`
- 回合数区域：`var(--bg-surface)` 底色，`var(--border-subtle)` 下边框
- 阶段色点：保持各阶段 config 定义的颜色
- "你的回合" 标签：`var(--semantic-success) / 20%` 底色 + `var(--semantic-success)` 文字
- "对手回合" 标签：`var(--bg-overlay)` 底色 + `var(--text-muted)` 文字
- 按钮：保持各阶段渐变色（rose/amber/pink/green/emerald），这些是 Heart 语义色不随主题变化

### 游戏日志（GameLog）

- 位置：固定左侧可折叠侧边栏，z-index `var(--z-game-log)`
- 展开时：280px 宽，`var(--bg-frosted)` + `backdrop-filter: blur(16px)`
- 折叠按钮：`var(--bg-surface)` + `var(--border-subtle)`
- 字体：`var(--font-mono)`
- 日志条目分色（两个主题值一致，因为是语义色）：
  - info: `var(--text-muted)`
  - action: `#22d3ee`（cyan）
  - phase: `var(--accent-gold)`
  - error: `var(--semantic-error)`

### 游戏面板（模态框：JudgmentPanel / ScorePanel / MulliganPanel / EffectWindow / DeckPeekModal）

- **统一遮罩**：`var(--modal-backdrop)` + `backdrop-filter: blur(4px)`
- **统一容器**：`var(--bg-elevated)` + `var(--radius-xl)` + `var(--shadow-lg)` + 顶部 3px 渐变强调条
  - 换牌面板（MulliganPanel）：琥珀强调条 `linear-gradient(90deg, var(--accent-secondary), var(--accent-gold))`
  - 判定面板（JudgmentPanel）：玫瑰强调条 `linear-gradient(90deg, var(--accent-primary), var(--heart-pink))`
  - 分数面板（ScorePanel）：玫瑰强调条
  - 效果窗口（EffectWindow）：玫瑰 → 琥珀强调条
  - 牌组窥视（DeckPeekModal）：紫色强调条 `linear-gradient(90deg, var(--heart-purple), var(--heart-blue))`
- **内部元素**：
  - 输入框：`var(--bg-input)` + `var(--border-default)` + focus 时 `var(--border-focus)`
  - 次要区域：`var(--bg-surface)` + `var(--border-subtle)`
  - 按钮：使用统一按钮规范

### 阶段横幅（PhaseBanner）

- 全屏覆盖，z-index `var(--z-phase-banner)`
- 径向渐变背景（阶段 Heart 色 5% opacity）
- 系统字体 `var(--font-display)`，`font-weight: 700`，`font-size: 2rem`
- 字间距动画（`letter-spacing: 0.5em → 0.05em`）+ `text-shadow: 0 0 20px var(--accent-primary)`
- 6-8 个 CSS 伪元素粒子（小圆形，Heart 随机色，从中心扩散 + 淡出）
- 500ms 动画序列：`blur(8px) → blur(0) → hold → translateY(-20px) + opacity(0)`
- 容器：`var(--bg-elevated) / 95%` + `var(--border-active)` + `var(--radius-xl)`

### 卡牌组件（Card）

- **卡背**：
  - 深色：暖棕渐变 `#2A1F18` → `#4A3428` + 星形 SVG 水印
  - 浅色：暖米渐变 `#E8DDD5` → `#D4C4B8` + 星形 SVG 水印
  - 用 CSS 变量：`var(--card-back-from)` / `var(--card-back-to)`
- **hover**：`translateY(-8px) scale(1.05)` + 类型色发光环（Heart 色，两个主题一致）
- **选中**：`ring-2 ring-[var(--accent-gold)]`
- **待机/休息**：`brightness(0.5)`，不用灰度滤镜
- **能量区小卡**：边框 `var(--border-default)` + `var(--bg-surface)` fallback

### 卡牌详情浮窗（CardDetailOverlay）

- 位置：固定右侧，z-index `var(--z-card-detail)`
- 容器：`var(--bg-frosted)` + `backdrop-filter: blur(16px)` + `var(--border-default)` + `var(--radius-xl)` + `var(--shadow-lg)`
- 宽度：280px
- 效果文字区域：`var(--border-subtle)` 顶部分隔线

### 卡组管理（DeckManager + CardEditor + 子组件）

**彻底移除 `.cute-*` 和 `.deck-manager` 硬编码样式**，改用令牌系统：

- **DeckManager 列表视图**：
  - 页面背景：`var(--gradient-page)`
  - 卡组卡片：`var(--bg-frosted)` + `var(--border-default)` + `var(--radius-lg)`
  - hover：边框渐变为 `var(--accent-primary)`，`var(--shadow-glow)`
  - 有效性徽章：绿色 `var(--semantic-success)` / 红色 `var(--semantic-error)`
- **CardEditor 编辑视图**：
  - 左侧浏览区：`var(--bg-surface)` + `var(--border-subtle)` 右边框
  - 右侧 DeckSidebar：`var(--bg-elevated)` + `var(--border-default)` 左边框
  - CardTypeTabs：`var(--bg-overlay)` 底色，选中态 `var(--accent-primary)` 下边框
  - SearchBar：`var(--bg-input)` + `var(--border-default)` + focus `var(--border-focus)`
  - FilterPanel/FilterChipGroup：chip 使用 `var(--bg-overlay)` + `var(--border-subtle)`，选中态 `var(--accent-primary)` 底色 10%
  - BrowserCardCell：hover `var(--shadow-md)` + 抬起效果
  - DeckAnalysisPanel：图表颜色使用 Heart 色
- **滚动条**：`var(--scrollbar-thumb)` / `var(--scrollbar-track)`（替换 `.cute-scrollbar` 粉紫色）

### Live 结果动画（LiveResultAnimation）

- **成功**：
  - 径向金光：`radial-gradient(ellipse, var(--accent-gold) / 30%, transparent)`
  - "LIVE SUCCESS!" 金色大字（`var(--accent-gold)`），`text-shadow: 0 0 40px var(--accent-gold) / 80%`
  - 12-16 个 CSS 粒子（随机 Heart 色，从中心径向扩散 + 缩放 + 淡出）
  - 2.5s 总时长
- **失败**：
  - 径向冷灰光（两个主题均使用灰调，失败就是失败）
  - "LIVE FAILED" `var(--text-muted)` 色
  - 无粒子，2s 总时长

### 管理页面（CardAdminPage / CardEditModal）

- 跟随全局主题令牌
- 管理专用强调色可用 `var(--heart-purple)` 作为区分

---

## 动画速度参考

```
日常交互          150-300ms    卡牌悬停、按钮、区域高亮、侧边栏
面板开关          200-250ms    opacity + scale(0.95 → 1)
戏剧性时刻        500-2500ms   阶段横幅、Live 结果、游戏结束
待机呼吸          3-20s        聚光灯漂移、活跃玩家脉冲
主题切换          300ms        background-color + color 过渡
```

---

## 间距与圆角

8px 基准网格：`4 / 8 / 12 / 16 / 24 / 32 / 40 / 48 px`

```
--radius-sm    6px      徽章、小元素
--radius-md    10px     按钮、输入框
--radius-lg    14px     卡牌、面板
--radius-xl    20px     模态框、大面板
--radius-full  9999px   药丸形、头像、主题切换按钮
```

---

## 完整 CSS 变量块

```css
/* ============================================
   主题无关令牌
   ============================================ */
:root {
  /* Heart 色（游戏语义色） */
  --heart-pink: #FF69B4;
  --heart-red: #EF4444;
  --heart-yellow: #FBBF24;
  --heart-green: #34D399;
  --heart-blue: #60A5FA;
  --heart-purple: #A78BFA;
  --heart-rainbow: linear-gradient(90deg, #FF69B4, #EF4444, #FBBF24, #34D399, #60A5FA, #A78BFA);

  /* 字体 */
  --font-display: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto,
                  'Helvetica Neue', Arial, 'PingFang SC', 'Hiragino Sans GB',
                  'Microsoft YaHei', sans-serif;
  --font-body: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto,
               'Helvetica Neue', Arial, 'PingFang SC', 'Hiragino Sans GB',
               'Microsoft YaHei', sans-serif;
  --font-mono: ui-monospace, 'Cascadia Code', 'Source Code Pro', Menlo, Consolas,
               'PingFang SC', monospace;

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
  --space-10: 40px;
  --space-12: 48px;

  /* 圆角 */
  --radius-sm: 6px;
  --radius-md: 10px;
  --radius-lg: 14px;
  --radius-xl: 20px;
  --radius-full: 9999px;

  /* 动画 */
  --duration-fast: 150ms;
  --duration-normal: 250ms;
  --duration-slow: 500ms;
  --duration-dramatic: 2500ms;

  /* Z-index */
  --z-game-log: 50;
  --z-phase-indicator: 60;
  --z-live-result: 100;
  --z-modal: 101;
  --z-card-detail: 200;
  --z-phase-banner: 1000;
}

/* ============================================
   深色主题「夜之舞台」
   ============================================ */
html[data-theme="dark"] {
  /* 背景 */
  --bg-deep: #1A1510;
  --bg-surface: #231E17;
  --bg-elevated: #2D261E;
  --bg-overlay: #362E25;
  --bg-frosted: rgba(35,30,23,0.88);
  --bg-input: #1E1912;

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

  /* 游戏板 */
  --board-overlay: rgba(26,21,16,0.55);
  --board-overlay-heavy: rgba(26,21,16,0.75);
  --board-zone-bg: rgba(35,30,23,0.65);

  /* 渐变 */
  --gradient-page: linear-gradient(135deg, #1A1510 0%, #231E17 40%, #1E1914 100%);
  --gradient-panel: linear-gradient(145deg, rgba(45,38,30,0.95), rgba(35,30,23,0.95));
  --gradient-spotlight: radial-gradient(ellipse at 50% 0%, rgba(236,107,138,0.06), transparent 60%);
  --gradient-stage-glow: radial-gradient(ellipse at 50% 100%, rgba(232,152,90,0.05), transparent 50%);
  --gradient-button: linear-gradient(135deg, #EC6B8A, #E8985A);
  --gradient-button-hover: linear-gradient(135deg, #F28DA5, #F0B070);
  --gradient-gold: linear-gradient(135deg, #FBBF24, #F59E0B);

  /* 阴影 */
  --shadow-sm: 0 1px 3px rgba(0,0,0,0.4);
  --shadow-md: 0 4px 12px rgba(0,0,0,0.5);
  --shadow-lg: 0 8px 24px rgba(0,0,0,0.6);
  --shadow-glow: 0 0 20px rgba(236,107,138,0.25);

  /* 滚动条 */
  --scrollbar-thumb: rgba(210,180,140,0.35);
  --scrollbar-track: rgba(210,180,140,0.08);

  /* 模态框 */
  --modal-backdrop: rgba(0,0,0,0.70);

  /* 卡背 */
  --card-back-from: #2A1F18;
  --card-back-to: #4A3428;
}

/* ============================================
   浅色主题「樱之午后」
   ============================================ */
html[data-theme="light"] {
  /* 背景 */
  --bg-deep: #FBF7F4;
  --bg-surface: #FFFFFF;
  --bg-elevated: #FFF8F5;
  --bg-overlay: #F5EDE8;
  --bg-frosted: rgba(255,255,255,0.82);
  --bg-input: #FBF7F4;

  /* 边框 */
  --border-subtle: rgba(160,130,100,0.12);
  --border-default: rgba(160,130,100,0.22);
  --border-focus: rgba(220,90,120,0.35);
  --border-active: rgba(236,107,138,0.45);

  /* 文字 */
  --text-primary: #2D2420;
  --text-secondary: #6B5D52;
  --text-muted: #A89888;
  --text-inverse: #F5EDE4;

  /* 强调色 */
  --accent-primary: #DC5A7A;
  --accent-primary-hover: #C94D6D;
  --accent-secondary: #D4864E;
  --accent-gold: #D4A017;
  --accent-gold-light: #F0D060;

  /* 语义色 */
  --semantic-success: #2D9E55;
  --semantic-error: #D4465E;
  --semantic-warning: #C4882A;
  --semantic-info: #4A86BE;

  /* 游戏板 */
  --board-overlay: rgba(255,248,244,0.25);
  --board-overlay-heavy: rgba(255,248,244,0.55);
  --board-zone-bg: rgba(255,255,255,0.55);

  /* 渐变 */
  --gradient-page: linear-gradient(135deg, #FBF7F4 0%, #FFF0EB 40%, #FBF7F4 100%);
  --gradient-panel: linear-gradient(145deg, rgba(255,255,255,0.95), rgba(255,248,244,0.95));
  --gradient-spotlight: radial-gradient(ellipse at 50% 0%, rgba(236,107,138,0.08), transparent 60%);
  --gradient-stage-glow: radial-gradient(ellipse at 50% 100%, rgba(232,152,90,0.06), transparent 50%);
  --gradient-button: linear-gradient(135deg, #EC6B8A, #E8985A);
  --gradient-button-hover: linear-gradient(135deg, #DC5A7A, #D4864E);
  --gradient-gold: linear-gradient(135deg, #FBBF24, #F59E0B);

  /* 阴影 */
  --shadow-sm: 0 1px 3px rgba(160,130,100,0.12);
  --shadow-md: 0 4px 12px rgba(160,130,100,0.15);
  --shadow-lg: 0 8px 24px rgba(160,130,100,0.18);
  --shadow-glow: 0 0 20px rgba(220,90,120,0.18);

  /* 滚动条 */
  --scrollbar-thumb: rgba(160,130,100,0.30);
  --scrollbar-track: rgba(160,130,100,0.08);

  /* 模态框 */
  --modal-backdrop: rgba(0,0,0,0.40);

  /* 卡背 */
  --card-back-from: #E8DDD5;
  --card-back-to: #D4C4B8;
}
```

---

## 实施优先级

| 阶段 | 做什么 | 涉及文件 |
|------|--------|----------|
| **1. 基础令牌 + 主题机制** | 用上述 CSS 变量替换 `index.css` 中所有硬编码颜色；删除 `.cute-*` 和旧 `.zone`/`.card-back` 硬编码样式；实现 `data-theme` 切换逻辑；创建 `ThemeToggle` 组件 | `index.css`、新建 `ThemeToggle.tsx`、`App.tsx` |
| **2. 认证 + 主页** | 统一双主题，磨砂玻璃面板，Lucide 图标替换 emoji | `auth/AuthLayout.tsx`、`auth/LoginPage.tsx`、`auth/RegisterPage.tsx`、`auth/ForgotPasswordPage.tsx`、`auth/ResetPasswordPage.tsx`、`pages/HomePage.tsx` |
| **3. 游戏板视觉** | 背景遮罩双主题、VS 分隔线、区域边框、卡牌状态、PlayerArea 颜色 | `game/GameBoard.tsx`、`game/PlayerArea.tsx`、`card/Card.tsx` |
| **4. 游戏面板** | PhaseIndicator、PhaseBanner、GameLog、JudgmentPanel、ScorePanel、MulliganPanel、EffectWindow、DeckPeekModal、CardDetailOverlay | `game/*.tsx` |
| **5. 卡组管理** | 删除所有 `.cute-*` 引用，改用令牌系统 | `deck/DeckManager.tsx`、`deck-editor/*.tsx`（14 个子组件） |
| **6. 收尾** | LiveResultAnimation CSS 粒子、管理页面、滚动条主题、待机动画 | `game/LiveResultAnimation.tsx`、`admin/*.tsx`、全局 |

---

## 需要删除的遗留代码

实施时应彻底清除以下硬编码样式：

| 遗留内容 | 位置 | 替换为 |
|----------|------|--------|
| `--cute-*` 全部变量 | `index.css :root` | 删除，使用 `--bg-*` / `--border-*` / `--text-*` 令牌 |
| `--bg-game: #1a1a2e` / `--bg-zone` / `--bg-card` / `--border-zone` | `index.css :root` | 删除，使用 `--bg-*` / `--border-*` 令牌 |
| `.cute-panel` / `.cute-input` / `.cute-button` / `.cute-button-secondary` / `.cute-card-hover` / `.cute-glow` / `.cute-border` / `.cute-gradient-text` | `index.css` | 删除，各组件改用 `var(--bg-frosted)` 等令牌 |
| `.cute-scrollbar` / `.deck-manager ::-webkit-scrollbar` | `index.css` | 替换为使用 `var(--scrollbar-*)` 的全局滚动条样式 |
| `.sparkle` / `.float-animation` | `index.css` | 保留动画关键帧，但改名为 `--breathe` / `--float` 等语义名 |
| `.card-back` 硬编码 `#667eea → #764ba2` | `index.css` | 使用 `var(--card-back-from)` / `var(--card-back-to)` |
| `.deck::before/after` 硬编码 `#667eea → #764ba2` | `index.css` | 使用 `var(--card-back-from)` / `var(--card-back-to)` |
| `.btn-primary` 硬编码 `#e94560` | `index.css` | 使用 `var(--gradient-button)` |
| `.zone` 虚线边框 `dashed rgba(233,69,96,0.3)` | `index.css` | 使用 `var(--border-subtle)` 实线 |
| 各组件中 `bg-slate-900`/`bg-slate-800`/`border-slate-700` | `game/*.tsx` | 使用 `var(--bg-*)` / `var(--border-*)` |
| `from-[#2d2820]`/`from-[#3d3020]` 等硬编码 hex | `HomePage.tsx` 等 | 使用 `var(--bg-*)` |
| `from-amber-50 via-orange-50 to-yellow-50` | `AuthLayout.tsx` | 使用 `var(--gradient-page)` |
| `bg-white/70` | `AuthLayout.tsx` | 使用 `var(--bg-frosted)` |
