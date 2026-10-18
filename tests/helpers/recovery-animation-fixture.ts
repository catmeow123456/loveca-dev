import { createGameSession, type GameSession } from '../../src/application/game-session';
import {
  createActivateAbilityCommand,
  createAutoAdvancePublicCardSelectionCommand,
  createConfirmEffectStepCommand,
} from '../../src/application/game-commands';
import { resolvePendingCardEffects } from '../../src/application/card-effect-runner';
import {
  N_BP5_014_ACTIVATED_PAY_TWO_ENERGY_DISCARD_RECOVER_NIJIGASAKI_LIVE_ABILITY_ID,
  HS_PB1_020_ON_ENTER_DISCARD_TWO_RECOVER_CERISE_MEMBER_AND_HASUNOSORA_LIVE_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import {
  createCardInstance,
  createHeartRequirement,
  type AnyCardData,
} from '../../src/domain/entities/card';
import { registerCards, updatePlayer, type GameState } from '../../src/domain/entities/game';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import {
  CardType,
  FaceState,
  GamePhase,
  HeartColor,
  OrientationState,
  SlotPosition,
  SubPhase,
  TriggerCondition,
  TurnType,
} from '../../src/shared/types/enums';

export type RecoveryScenario = 'single' | 'multiple' | 'no-target';
const kasumi: AnyCardData = {
  cardCode: 'PL!N-bp5-014-N',
  name: '中须霞',
  nameCn: '中须霞',
  cardType: CardType.MEMBER,
  cost: 4,
  blade: 2,
  hearts: [{ color: HeartColor.YELLOW, count: 1 }],
  groupNames: ['虹ヶ咲'],
  cardText:
    '【起动】[1回合1次][E][E]将1张手牌放置入休息室：从自己的休息室将1张『虹咲』的LIVE卡加入手牌。',
};
const dream: AnyCardData = {
  cardCode: 'PL!N-sd1-028-SD',
  name: 'Dream with You',
  nameCn: 'Dream with You',
  cardType: CardType.LIVE,
  score: 4,
  groupNames: ['虹ヶ咲'],
  requirements: createHeartRequirement({ [HeartColor.PINK]: 4, [HeartColor.RAINBOW]: 7 }, 11),
};
const ginko: AnyCardData = {
  cardCode: 'PL!HS-pb1-020-N',
  name: '百生吟子',
  nameCn: '百生吟子',
  cardType: CardType.MEMBER,
  cost: 9,
  blade: 3,
  hearts: [{ color: HeartColor.GREEN, count: 1 }],
  groupNames: ['蓮ノ空'],
  unitName: 'Cerise Bouquet',
  cardText:
    '【登场】自己的休息室存在大于等于3张LIVE卡的场合，可以将2张手牌放置入休息室。如此做的场合，从自己的休息室将1张『Cerise Bouquet』的成员卡与1张『莲之空』的LIVE卡加入手牌。',
};
const ginkoTarget: AnyCardData = {
  cardCode: 'PL!HS-sd1-012-SD',
  name: '百生吟子',
  nameCn: '百生吟子',
  cardType: CardType.MEMBER,
  cost: 4,
  blade: 1,
  hearts: [{ color: HeartColor.GREEN, count: 2 }],
  groupNames: ['蓮ノ空'],
  unitName: 'Cerise Bouquet',
};
const aoku: AnyCardData = {
  cardCode: 'PL!HS-bp2-022-L',
  name: 'AOKUHARUKA',
  nameCn: 'AOKUHARUKA',
  cardType: CardType.LIVE,
  score: 2,
  groupNames: ['蓮ノ空'],
  unitName: 'Cerise Bouquet',
  requirements: createHeartRequirement({ [HeartColor.GREEN]: 4, [HeartColor.RAINBOW]: 1 }, 5),
};
let generation = 0;

/** Set up only the initial position. All later actions use the real session commands and undo. */
export function prepareRecoveryScenario(
  scenario: RecoveryScenario = 'single',
  session: GameSession = createGameSession()
) {
  session.createGame(`recovery-review-${++generation}`, 'p1', '己方', 'p2', '对方');
  const multiple = scenario === 'multiple';
  const source = createCardInstance(multiple ? ginko : kasumi, 'p1', 'source');
  const cards = [
    source,
    ...Array.from({ length: 6 }, (_, i) => createCardInstance(kasumi, 'p1', `hand-${i}`)),
    createCardInstance(multiple ? aoku : dream, 'p1', 'recover-a'),
    ...(multiple
      ? [
          createCardInstance(ginkoTarget, 'p1', 'recover-b'),
          createCardInstance(aoku, 'p1', 'waiting-live-2'),
          createCardInstance(aoku, 'p1', 'waiting-live-3'),
        ]
      : []),
    ...Array.from({ length: 4 }, (_, i) =>
      createCardInstance(
        { cardCode: 'ENERGY', name: '能量', cardType: CardType.ENERGY },
        'p1',
        `energy-${i}`
      )
    ),
  ];
  const active = { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP };
  let state = registerCards(session.state!, cards);
  state = {
    ...state,
    currentPhase: GamePhase.MAIN_PHASE,
    currentSubPhase: SubPhase.NONE,
    currentTurnType: TurnType.FIRST_PLAYER_TURN,
    activePlayerIndex: 0,
    waitingPlayerId: null,
    manualOperationMode: 'FREE',
  };
  state = updatePlayer(state, 'p1', (player) => ({
    ...player,
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, 'source', active),
    hand: {
      ...player.hand,
      cardIds: cards.filter((c) => c.instanceId.startsWith('hand-')).map((c) => c.instanceId),
    },
    waitingRoom: {
      ...player.waitingRoom,
      cardIds:
        scenario === 'no-target'
          ? []
          : multiple
            ? ['recover-a', 'recover-b', 'waiting-live-2', 'waiting-live-3']
            : ['recover-a'],
    },
    energyZone: {
      ...player.energyZone,
      cardIds: ['energy-0', 'energy-1', 'energy-2', 'energy-3'],
      cardStates: new Map(
        ['energy-0', 'energy-1', 'energy-2', 'energy-3'].map((id) => [id, active])
      ),
    },
  }));
  if (multiple)
    state = resolvePendingCardEffects({
      ...state,
      pendingAbilities: [
        {
          id: 'review-pending',
          eventIds: [],
          abilityId:
            HS_PB1_020_ON_ENTER_DISCARD_TWO_RECOVER_CERISE_MEMBER_AND_HASUNOSORA_LIVE_ABILITY_ID,
          sourceCardId: 'source',
          sourceSlot: SlotPosition.CENTER,
          controllerId: 'p1',
          mandatory: true,
          timingId: TriggerCondition.ON_ENTER_STAGE,
        },
      ],
    }).gameState;
  (session as unknown as { authorityState: GameState }).authorityState = state;
  const nextCommand = (illegal = false) => {
    const effect = session.state!.activeEffect;
    if (!effect)
      return createActivateAbilityCommand(
        'p1',
        'source',
        N_BP5_014_ACTIVATED_PAY_TWO_ENERGY_DISCARD_RECOVER_NIJIGASAKI_LIVE_ABILITY_ID
      );
    if (effect.publicCardSelectionAutoAdvanceAt)
      return createAutoAdvancePublicCardSelectionCommand(
        'p1',
        effect.id,
        effect.publicCardSelectionAutoAdvanceAt
      );
    const candidates = effect.selectableCardIds ?? [];
    const count = effect.minSelectableCards ?? 1;
    const selected = illegal ? ['invalid-target'] : candidates.slice(0, count);
    return createConfirmEffectStepCommand(
      'p1',
      effect.id,
      effect.selectableCardMode === 'ORDERED_MULTI' ? undefined : selected[0],
      undefined,
      undefined,
      undefined,
      effect.selectableCardMode === 'ORDERED_MULTI' ? selected : undefined
    );
  };
  return { session, cards, cardData: cards.map((card) => card.data as AnyCardData), nextCommand };
}
