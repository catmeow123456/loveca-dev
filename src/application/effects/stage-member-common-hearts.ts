import type { GameState } from '../../domain/entities/game.js';
import {
  collectLiveModifiers,
  getMemberEffectiveHeartIcons,
} from '../../domain/rules/live-modifiers.js';
import { CardType, type HeartColor } from '../../shared/types/enums.js';
import { and, groupAliasIs, typeIs } from './card-selectors.js';
import { getStageMemberCardIdsMatching } from './stage-targets.js';

/** Common ordinary Heart colors of at least three own top-level Aqours members. */
export function getOwnAqoursStageMemberCommonHeartColors(
  game: GameState,
  playerId: string
): readonly HeartColor[] {
  const memberIds = getStageMemberCardIdsMatching(
    game,
    playerId,
    and(typeIs(CardType.MEMBER), groupAliasIs('Aqours'))
  );
  if (memberIds.length < 3) return [];
  const modifiers = collectLiveModifiers(game);
  const colorsByMember = memberIds.map(
    (id) =>
      new Set(
        getMemberEffectiveHeartIcons(game, playerId, id, modifiers)
          .filter((heart) => heart.count > 0)
          .map((heart) => heart.color)
      )
  );
  return [...colorsByMember[0]!].filter((color) =>
    colorsByMember.every((colors) => colors.has(color))
  );
}
