import type { GameSession } from '../../src/application/game-session';
import { createPlayMemberToSlotCommand } from '../../src/application/game-commands';
import { resolvePendingCardEffects } from '../../src/application/card-effect-runner';
import { EMMA_ON_ENTER_ACTIVATE_MEMBER_OR_ENERGY_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import { createCardInstance, type AnyCardData } from '../../src/domain/entities/card';
import { registerCards, updatePlayer, type GameState } from '../../src/domain/entities/game';
import { OrientationState, SlotPosition, TriggerCondition } from '../../src/shared/types/enums';
import { prepareRecoveryScenario } from './recovery-animation-fixture';

function replaceState(session: GameSession, state: GameState) {
  (session as unknown as { authorityState: GameState }).authorityState = state;
}

/** Local initial positions; selections and resolution use the real shared commands. */
export function prepareBlindHandCandidateScenario(session: GameSession) {
  const base = prepareRecoveryScenario('single', session);
  const member = base.cards.find((card) => card.instanceId === 'source')!.data;
  const live = base.cards.find((card) => card.instanceId === 'recover-a')!.data;
  const source = createCardInstance(
    {
      ...member,
      cardCode: 'PL!-PR-014-PR',
      name: '园田海未',
      nameCn: '园田海未',
      cost: 2,
    } as AnyCardData,
    'p1',
    'blind-source'
  );
  const hidden = Array.from({ length: 4 }, (_, index) =>
    createCardInstance(
      {
        ...(index === 1 ? live : member),
        cardCode: `TEST-PRIVATE-CANDIDATE-${index}`,
        name: `隐藏卡牌${index}`,
        nameCn: `隐藏卡牌${index}`,
      } as AnyCardData,
      'p2',
      `private-hand-${index}`
    )
  );
  let state = registerCards(session.state!, [source, ...hidden]);
  state = updatePlayer(state, 'p1', (player) => ({
    ...player,
    hand: { ...player.hand, cardIds: [source.instanceId] },
  }));
  state = updatePlayer(state, 'p2', (player) => ({
    ...player,
    hand: { ...player.hand, cardIds: hidden.map((card) => card.instanceId) },
  }));
  replaceState(session, state);
  const result = session.executeCommand(
    createPlayMemberToSlotCommand('p1', source.instanceId, SlotPosition.LEFT, { freePlay: true })
  );
  if (!result.success) throw new Error(result.error);
  return {
    cardData: [...base.cardData, source.data, ...hidden.map((card) => card.data)],
    hiddenIds: hidden.map((card) => card.instanceId),
  };
}

export function prepareEnergyCandidateScenario(session: GameSession) {
  const base = prepareRecoveryScenario('single', session);
  const source = createCardInstance(
    {
      ...base.cards.find((card) => card.instanceId === 'source')!.data,
      cardCode: 'PL!N-pb1-008-P+',
      name: '艾玛·维尔德',
      nameCn: '艾玛·维尔德',
    } as AnyCardData,
    'p1',
    'source'
  );
  let state = registerCards(session.state!, [source]);
  state = updatePlayer(state, 'p1', (player) => ({
    ...player,
    energyZone: {
      ...player.energyZone,
      cardStates: new Map(
        player.energyZone.cardIds.map((id, index) => [
          id,
          {
            ...player.energyZone.cardStates.get(id)!,
            orientation: index < 3 ? OrientationState.WAITING : OrientationState.ACTIVE,
          },
        ])
      ),
    },
  }));
  replaceState(
    session,
    resolvePendingCardEffects({
      ...state,
      energyActivePhaseSkips: [
        {
          playerId: 'p1',
          energyCardId: 'energy-2',
          sourceCardId: 'source',
          abilityId: 'test:skip-marker',
        },
      ],
      pendingAbilities: [
        {
          id: 'energy-candidate-on-enter',
          eventIds: [],
          abilityId: EMMA_ON_ENTER_ACTIVATE_MEMBER_OR_ENERGY_ABILITY_ID,
          sourceCardId: 'source',
          controllerId: 'p1',
          mandatory: true,
          timingId: TriggerCondition.ON_ENTER_STAGE,
        },
      ],
    }).gameState
  );
  return { cardData: [...base.cardData, source.data] };
}
