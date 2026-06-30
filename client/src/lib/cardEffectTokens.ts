import type { ModifierIconName } from '@/lib/modifierIconAssets';

export type CardEffectTokenKind =
  | 'text'
  | 'ability'
  | 'limit'
  | 'slot'
  | 'heart'
  | 'blade'
  | 'cost'
  | 'score'
  | 'other';

export type CardEffectPlaceholderKind = Exclude<CardEffectTokenKind, 'text'>;

export type CardEffectTokenIcon = ModifierIconName;

export interface CardEffectTextPart {
  readonly kind: 'text';
  readonly text: string;
}

export interface CardEffectPlaceholderPart {
  readonly kind: CardEffectPlaceholderKind;
  readonly raw: string;
  readonly label: string;
  readonly icon?: CardEffectTokenIcon;
}

export type CardEffectPart = CardEffectTextPart | CardEffectPlaceholderPart;

const TOKEN_PATTERN = /【[^】\r\n]+】|\[[^\]\r\n]+\]/g;

const TOKEN_DEFINITIONS = new Map<
  string,
  Omit<CardEffectPlaceholderPart, 'raw'>
>([
  ['【登場】', { kind: 'ability', label: '登場' }],
  ['【登场】', { kind: 'ability', label: '登场' }],
  ['【ライブ開始時】', { kind: 'ability', label: 'LIVE開始時' }],
  ['【LIVE开始时】', { kind: 'ability', label: 'LIVE开始时' }],
  ['【ライブ成功時】', { kind: 'ability', label: 'LIVE成功時' }],
  ['【LIVE成功时】', { kind: 'ability', label: 'LIVE成功时' }],
  ['【起動】', { kind: 'ability', label: '起動' }],
  ['【起动】', { kind: 'ability', label: '起动' }],
  ['【常時】', { kind: 'ability', label: '常時' }],
  ['【常时】', { kind: 'ability', label: '常时' }],
  ['【自動】', { kind: 'ability', label: '自動' }],
  ['【自动】', { kind: 'ability', label: '自动' }],
  ['【ターン1回】', { kind: 'limit', label: 'ターン1回' }],
  ['【1回合1次】', { kind: 'limit', label: '1回合1次' }],
  ['【1回合1 次】', { kind: 'limit', label: '1回合1次' }],
  ['【ターン2回】', { kind: 'limit', label: 'ターン2回' }],
  ['【1回合2次】', { kind: 'limit', label: '1回合2次' }],
  ['【センター】', { kind: 'slot', label: 'センター' }],
  ['【中央】', { kind: 'slot', label: '中央' }],
  ['【左サイド】', { kind: 'slot', label: '左サイド' }],
  ['【左侧】', { kind: 'slot', label: '左侧' }],
  ['【右サイド】', { kind: 'slot', label: '右サイド' }],
  ['【右侧】', { kind: 'slot', label: '右侧' }],
  ['[E]', { kind: 'cost', label: 'E', icon: 'cost' }],
  ['[スコア]', { kind: 'score', label: 'スコア' }],
  ['[BLADE]', { kind: 'blade', label: 'BLADE', icon: 'blade' }],
  ['[ALLBLADE]', { kind: 'blade', label: 'ALLBLADE', icon: 'blade' }],
  ['[ブレード]', { kind: 'blade', label: 'ブレード', icon: 'blade' }],
  ['[ALLブレード]', { kind: 'blade', label: 'ALLブレード', icon: 'blade' }],
  ['[桃ブレード]', { kind: 'blade', label: '桃ブレード', icon: 'blade' }],
  ['[赤ブレード]', { kind: 'blade', label: '赤ブレード', icon: 'blade' }],
  ['[黄ブレード]', { kind: 'blade', label: '黄ブレード', icon: 'blade' }],
  ['[緑ブレード]', { kind: 'blade', label: '緑ブレード', icon: 'blade' }],
  ['[青ブレード]', { kind: 'blade', label: '青ブレード', icon: 'blade' }],
  ['[紫ブレード]', { kind: 'blade', label: '紫ブレード', icon: 'blade' }],
  ['[桃ハート]', { kind: 'heart', label: '桃ハート', icon: 'heart_pink' }],
  ['[赤ハート]', { kind: 'heart', label: '赤ハート', icon: 'heart_red' }],
  ['[红HEART]', { kind: 'heart', label: '红HEART', icon: 'heart_red' }],
  ['[黄ハート]', { kind: 'heart', label: '黄ハート', icon: 'heart_yellow' }],
  ['[黄HEART]', { kind: 'heart', label: '黄HEART', icon: 'heart_yellow' }],
  ['[緑ハート]', { kind: 'heart', label: '緑ハート', icon: 'heart_green' }],
  ['[青ハート]', { kind: 'heart', label: '青ハート', icon: 'heart_blue' }],
  ['[蓝HEART]', { kind: 'heart', label: '蓝HEART', icon: 'heart_blue' }],
  ['[紫ハート]', { kind: 'heart', label: '紫ハート', icon: 'heart_purple' }],
  ['[紫HEART]', { kind: 'heart', label: '紫HEART', icon: 'heart_purple' }],
  ['[虹ハート]', { kind: 'heart', label: '虹ハート', icon: 'heart_all' }],
  ['[無ハート]', { kind: 'heart', label: '無ハート', icon: 'heart_all' }],
  ['[無色ハート]', { kind: 'heart', label: '無色ハート', icon: 'heart_all' }],
  ['[无色HEART]', { kind: 'heart', label: '无色HEART', icon: 'heart_all' }],
  ['[ALLハート]', { kind: 'heart', label: 'ALLハート', icon: 'heart_all' }],
]);

export function parseCardEffectText(text: string): CardEffectPart[] {
  const parts: CardEffectPart[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = TOKEN_PATTERN.exec(text)) !== null) {
    const raw = match[0];
    if (match.index > lastIndex) {
      parts.push({ kind: 'text', text: text.slice(lastIndex, match.index) });
    }

    const definition = TOKEN_DEFINITIONS.get(raw);
    if (definition) {
      parts.push({ ...definition, raw });
    } else {
      parts.push({ kind: 'text', text: raw });
    }

    lastIndex = match.index + raw.length;
  }

  if (lastIndex < text.length) {
    parts.push({ kind: 'text', text: text.slice(lastIndex) });
  }

  return parts;
}
