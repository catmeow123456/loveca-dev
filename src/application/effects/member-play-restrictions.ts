import { getCardById, type GameState } from '../../domain/entities/game.js';
import { CardType } from '../../shared/types/enums.js';
import { cardCodeMatchesBase } from '../../shared/utils/card-code.js';
import { and, typeIs, unitAliasIs } from './card-selectors.js';
import { hasStageMemberMatching } from './conditions.js';

const DOLLCHESTRA_MEMBER = and(typeIs(CardType.MEMBER), unitAliasIs('DOLLCHESTRA'));
const PLAY_RESTRICTIONS = [
  {
    baseCardCodes: ['PL!HS-bp8-005'],
    isAllowed: (game: GameState, playerId: string) =>
      hasStageMemberMatching(game, playerId, DOLLCHESTRA_MEMBER),
    reason: '自己的舞台上不存在『DOLLCHESTRA』成员，无法打出此卡',
  },
] as const;

/** Only governs playing a member; effects that directly place members on stage use separate actions. */
export function getMemberPlayRestrictionReason(
  game: GameState,
  playerId: string,
  cardId: string
): string | null {
  const card = getCardById(game, cardId);
  if (!card) return null;
  const restriction = PLAY_RESTRICTIONS.find((candidate) =>
    candidate.baseCardCodes.some((baseCardCode) =>
      cardCodeMatchesBase(card.data.cardCode, baseCardCode)
    )
  );
  return restriction && !restriction.isAllowed(game, playerId) ? restriction.reason : null;
}
