import type { OnlineMatchEmoteId } from '@game/online';

export interface MatchEmoteDefinition {
  readonly id: OnlineMatchEmoteId;
  readonly label: string;
  readonly shortLabel: string;
}

export const MATCH_EMOTES: readonly MatchEmoteDefinition[] = [
  { id: 'DEEP_THINKING', label: '深度思考中…', shortLabel: '思考中' },
  { id: 'THANK_YOU', label: '谢谢！', shortLabel: '谢谢' },
  { id: 'NICE_TO_MEET_YOU', label: '请多指教！', shortLabel: '请多指教' },
  { id: 'NICE_PLAY', label: '漂亮！', shortLabel: '漂亮' },
  { id: 'GOOD_GAME', label: '好局！', shortLabel: '好局' },
  { id: 'SORRY_TO_KEEP_YOU_WAITING', label: '抱歉，久等了', shortLabel: '久等了' },
];

const MATCH_EMOTE_BY_ID = new Map(MATCH_EMOTES.map((emote) => [emote.id, emote]));

export function getMatchEmoteDefinition(emoteId: OnlineMatchEmoteId): MatchEmoteDefinition {
  return MATCH_EMOTE_BY_ID.get(emoteId) ?? MATCH_EMOTES[0]!;
}
