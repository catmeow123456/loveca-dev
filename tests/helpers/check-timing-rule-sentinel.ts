import {
  createCardInstance,
  createHeartIcon,
  type MemberCardData,
} from '../../src/domain/entities/card';
import {
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import { addCardToZone } from '../../src/domain/entities/zone';
import { CardType, HeartColor } from '../../src/shared/types/enums';

/**
 * Keeps focused ability tests out of the deck-refresh/game-loss rule path.
 * The card is registered and legal so trigger/rule processing can inspect it normally.
 */
export function addCheckTimingRuleSentinel(
  game: GameState,
  playerId: string,
  suffix: string
): GameState {
  const data: MemberCardData = {
    cardCode: `TEST-CHECK-TIMING-SENTINEL-${suffix}`,
    name: 'Check timing rule sentinel',
    groupNames: ['TEST'],
    cardType: CardType.MEMBER,
    cost: 1,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
  const card = createCardInstance(data, playerId, `check-timing-rule-sentinel-${suffix}`);
  return updatePlayer(registerCards(game, [card]), playerId, (player) => ({
    ...player,
    mainDeck: addCardToZone(player.mainDeck, card.instanceId),
  }));
}
