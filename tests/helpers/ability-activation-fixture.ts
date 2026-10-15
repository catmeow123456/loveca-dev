import type { GameSession } from '../../src/application/game-session';
import { createCardInstance, type AnyCardData } from '../../src/domain/entities/card';
import { registerCards, updatePlayer, type GameState } from '../../src/domain/entities/game';
import { CardType, HeartColor } from '../../src/shared/types/enums';
import { prepareRecoveryScenario } from './recovery-animation-fixture';

export type ActivationScenario = 'stage' | 'hand' | 'waiting';
export function prepareAbilityActivationScenario(
  scenario: ActivationScenario,
  session: GameSession
) {
  const fixture = prepareRecoveryScenario('single', session);
  if (scenario === 'stage') return { ...fixture, sourceId: 'source' };
  const hand = scenario === 'hand';
  const data: AnyCardData = hand
    ? {
        cardCode: 'PL!HS-bp6-014-R',
        name: '安養寺 姫芽',
        nameCn: '安养寺姬芽',
        cardType: CardType.MEMBER,
        cost: 2,
        blade: 1,
        groupNames: ['蓮ノ空'],
        hearts: [{ color: HeartColor.PINK, count: 1 }],
        cardText:
          '【起动】将此卡从手牌放置入休息室：抽1张卡，LIVE结束时为止，存在于自己的舞台的1名「藤岛慈」或「大泽瑠璃乃」获得[BLADE]。此能力仅可在此卡存在于手牌的场合起动。',
      }
    : {
        cardCode: 'PL!N-bp1-002-P',
        name: '中須かすみ',
        nameCn: '中须霞',
        cardType: CardType.MEMBER,
        cost: 2,
        blade: 2,
        groupNames: ['虹ヶ咲'],
        hearts: [{ color: HeartColor.YELLOW, count: 1 }],
        cardText:
          '【登场】检视自己卡组顶的3张卡。将其中任意张数的卡片按任意顺序放置于卡组顶，其余的卡片放置入休息室。\n【起动】[E][E]将1张手牌放置入休息室：将此卡从休息室登场至舞台。此能力仅可在此卡存在于休息室的场合起动。',
      };
  const sourceId = hand ? 'hand-source' : 'waiting-source';
  const source = createCardInstance(data, 'p1', sourceId);
  const state = updatePlayer(registerCards(session.state!, [source]), 'p1', (player) => ({
    ...player,
    hand: { ...player.hand, cardIds: [...(hand ? [sourceId] : []), 'hand-0', 'hand-1', 'hand-2'] },
    mainDeck: { ...player.mainDeck, cardIds: ['hand-3', 'hand-4', 'hand-5'] },
    waitingRoom: { ...player.waitingRoom, cardIds: [...(hand ? [] : [sourceId]), 'recover-a'] },
  }));
  (session as unknown as { authorityState: GameState }).authorityState = state;
  return { ...fixture, cardData: [...fixture.cardData, data], sourceId };
}
