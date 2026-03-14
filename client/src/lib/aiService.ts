/**
 * AI 服务 — 调用 Qwen 多模态大模型提取卡牌效果文本
 *
 * 通过 Vite proxy (/api/dashscope) 转发到 DashScope API，
 * API Key 由 proxy 自动注入，前端无需感知。
 */

const DASHSCOPE_PROXY = '/api/dashscope';
const MODEL = 'qwen3.5-flash';

const SYSTEM_PROMPT = `你是一名 Love Live! 卡牌游戏(ラブライブ！スクールアイドルコレクション)的卡牌效果翻译专家。

你的任务：从卡牌图片中提取日文效果文本，并翻译成中文。

## 翻译规范

### 效果时机关键词（保留【】格式）
- 【常时】【登场】【起动】【自动】【LIVE开始时】【LIVE成功時】

### 术语表
- 手札 → 手牌
- 控え室 → 休息室
- ステージ → 舞台
- レスト状態 / レスト → 待机状态
- スタンド状態 / スタンド → 活跃状态
- スタンバイ状態 → 待机状态
- コスト → 费用
- メンバー / メンバーカード → 成员 / 成员卡
- ライブ → LIVE
- エネルギー → 能量
- ドロー → 抽卡（"1ドロー" → "抽1张卡"）
- ターン → 回合
- フェイズ → 阶段
- メインフェイズ → 主要阶段
- ライブセットフェイズ → LIVE卡设置阶段
- パフォーマンスフェイズ → 表演阶段
- 声援 → 声援
- 公開 → 公开
- 同名 → 同名
- 表側表示 → 表侧表示
- 裏側表示 → 里侧表示
- 成功 → 成功
- 上限 → 上限
- 枚 → 张
- 名 → 名
- 種 → 种

### 特殊符号表记（保留[]格式）
- ブレード / 《ブレード》 → [BLADE]
- オールブレード / 《オールブレード》→ [ALLBLADE]
- ピンクハート → [桃ハート]
- レッドハート → [赤ハート]
- イエローハート → [黄ハート]
- グリーンハート → [緑ハート]
- ブルーハート → [青ハート]
- パープルハート → [紫ハート]
- レインボーハート → [虹ハート]
- 無色ハート → [無ハート]
- 心形图标根据颜色翻译为对应的 [Xハート]

### 组合/团体名（用『』括起来）
- ラブライブ中的组合名如 Printemps、μ's、Aqours、虹ヶ咲 等用 『』 括起来
- 虹ヶ咲 → 『虹咲』

### 格式要求
- 每个效果条目单独一行
- 效果时机关键词用【】包裹放在行首
- 补充说明用（）包裹
- 不要添加任何额外的解释、注释或前缀
- 直接输出翻译后的效果文本`;

const USER_PROMPT = '请提取这张卡牌图片上的效果文本，并按照规范翻译成中文。只输出翻译结果，不要其他内容。';

/**
 * 调用 Qwen 多模态模型提取并翻译卡牌效果文本
 *
 * @param imageUrl 卡牌图片的可访问 URL
 * @returns 翻译后的中文效果文本
 */
export async function extractCardEffect(imageUrl: string): Promise<string> {
  const response = await fetch(`${DASHSCOPE_PROXY}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: imageUrl } },
            { type: 'text', text: USER_PROMPT },
          ],
        },
      ],
      max_tokens: 1024,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`AI 请求失败 (${response.status}): ${errorText || response.statusText}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error('AI 返回了空结果');
  }

  return content.trim();
}
