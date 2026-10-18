import { createGameSession, type GameSession } from '../../src/application/game-session';
import {
  createAutoAdvancePublicCardSelectionCommand,
  createAutoAdvancePublicEffectChoiceCommand,
  createActivateAbilityCommand,
  createConfirmEffectStepCommand,
  type GameCommand,
} from '../../src/application/game-commands';
import { resolvePendingCardEffects } from '../../src/application/card-effect-runner';
import * as abilities from '../../src/application/card-effects/ability-ids';
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

export const EFFECT_FEEDBACK_SCENARIOS = [
  {
    id: 'mixed',
    name: '同一成员同时获得 HEART 与 BLADE',
    code: 'PL!HS-pb1-001-R',
    cost: 11,
    cardName: '日野下花帆',
    ability: abilities.HS_PB1_001_LIVE_START_PAY_TWO_ENERGY_GAIN_GREEN_HEART_BLADE_ABILITY_ID,
  },
  {
    id: 'heart',
    name: '给另一名成员加心',
    code: 'PL!N-PR-036-PR',
    cost: 2,
    cardName: '樱坂雫',
    ability: abilities.N_PR_036_LIVE_START_OTHER_NIJIGASAKI_YELLOW_HEART_ABILITY_ID,
  },
  {
    id: 'wait',
    name: '使对方成员待机',
    code: 'PL!-pb2-029-N',
    cost: 9,
    cardName: '绚濑绘里',
    ability: abilities.PL_PB2_029_LIVE_START_ONLY_MUSE_WAIT_LOW_ORIGINAL_BLADE_ABILITY_ID,
  },
  {
    id: 'multi',
    name: '三名成员同时获得 BLADE',
    code: 'PL!-bp6-001-P',
    cost: 2,
    cardName: '高坂穗乃果',
    ability: abilities.BP6_001_LIVE_START_CENTER_MUSE_LIVE_STAGE_MUSE_MEMBERS_GAIN_BLADE_ABILITY_ID,
  },
  {
    id: 'score',
    name: 'LIVE 分数增加',
    code: 'PL!N-sd1-028-SD',
    score: 4,
    cardName: 'Dream with You',
    ability: abilities.N_SD1_028_LIVE_START_STAGE_BLADE_TEN_GAIN_SCORE_ABILITY_ID,
  },
  {
    id: 'requirement',
    name: 'LIVE 必要 HEART 减少',
    code: 'PL!HS-pb1-026-L',
    score: 4,
    cardName: '雪舞う空と二秒の永遠',
    ability:
      abilities.HS_PB1_026_LIVE_START_DIFFERENT_HASUNOSORA_MEMBER_REDUCE_REQUIREMENT_ABILITY_ID,
  },
  {
    id: 'self',
    name: '自身待机费用 → 获得 HEART',
    code: 'PL!-bp3-009-P',
    cost: 2,
    cardName: '矢泽日香',
    ability: abilities.PL_BP3_009_ACTIVATED_WAIT_SELF_CHOOSE_HEART_ABILITY_ID,
  },
  {
    id: 'recover',
    name: '支付能量、弃牌、回收',
    code: 'PL!N-bp5-014-N',
    cost: 4,
    cardName: '中须霞',
    ability:
      abilities.N_BP5_014_ACTIVATED_PAY_TWO_ENERGY_DISCARD_RECOVER_NIJIGASAKI_LIVE_ABILITY_ID,
  },
  {
    id: 'no-target',
    name: '费用合法、回收无目标',
    code: 'PL!N-bp5-014-N',
    cost: 4,
    cardName: '中须霞',
    ability:
      abilities.N_BP5_014_ACTIVATED_PAY_TWO_ENERGY_DISCARD_RECOVER_NIJIGASAKI_LIVE_ABILITY_ID,
  },
] as const;
export type FeedbackScenarioId = (typeof EFFECT_FEEDBACK_SCENARIOS)[number]['id'];

const active = { face: FaceState.FACE_UP, orientation: OrientationState.ACTIVE };
let fixtureSequence = 0;

/** Only initial fixture setup mutates a snapshot. All review actions use GameSession commands. */
export function prepareEffectFeedbackScenario(
  id: FeedbackScenarioId,
  session: GameSession = createGameSession(),
  lookup?: (code: string) => AnyCardData | undefined,
  options: { readonly targetWaiting?: boolean } = {}
) {
  const scenario = EFFECT_FEEDBACK_SCENARIOS.find((item) => item.id === id)!;
  session.createGame(`effect-feedback-${++fixtureSequence}`, 'p1', '己方', 'p2', '对方');
  const muse = id === 'multi' || id === 'wait' || id === 'self';
  const group = id === 'requirement' || id === 'mixed' ? '蓮ノ空' : muse ? "μ's" : '虹ヶ咲';
  const member = (code: string, name: string, cost = 5, blade = 2): AnyCardData =>
    lookup?.(code) ?? {
      cardCode: code,
      name,
      cardType: CardType.MEMBER,
      cost,
      blade,
      hearts: [{ color: HeartColor.PINK, count: 1 }],
      groupNames: [group],
    };
  const live = (code: string, name: string, liveGroup = group): AnyCardData =>
    lookup?.(code) ?? {
      cardCode: code,
      name,
      cardType: CardType.LIVE,
      score: 4,
      groupNames: [liveGroup],
      requirements: createHeartRequirement({ [HeartColor.RAINBOW]: 11 }, 11),
    };
  const sourceData =
    'score' in scenario
      ? live(scenario.code, scenario.cardName)
      : member(scenario.code, scenario.cardName, scenario.cost);
  const allyCodes = muse
    ? ['PL!-pb2-021-N', 'PL!-bp3-009-P']
    : id === 'requirement'
      ? ['PL!HS-bp6-001-P', 'PL!HS-bp6-002-P']
      : ['PL!N-bp7-006-P', 'PL!N-bp7-003-P'];
  const source = createCardInstance(sourceData, 'p1', 'source');
  const target = createCardInstance(member(allyCodes[0]!, '目标成员', 17, 5), 'p1', 'target');
  const other = createCardInstance(member(allyCodes[1]!, '另一名成员', 15, 5), 'p1', 'other');
  const opponent = createCardInstance(member('PL!N-PR-036-PR', '樱坂雫', 2, 1), 'p2', 'opponent');
  const discard = createCardInstance(member('PL!N-bp5-014-N', '手牌成员', 4), 'p1', 'discard');
  const liveCard = createCardInstance(
    live(muse ? 'PL!-sd1-019-SD' : 'PL!N-sd1-028-SD', muse ? 'START:DASH!!' : 'Dream with You'),
    'p1',
    'live'
  );
  const energies = Array.from({ length: 4 }, (_, i) =>
    createCardInstance(
      { cardCode: 'ENERGY', name: '能量', cardType: CardType.ENERGY },
      'p1',
      `energy-${i}`
    )
  );
  const extraMembers = Array.from({ length: 4 }, (_, i) =>
    createCardInstance(member(`PL!HS-bp6-00${i + 3}-P`, `莲之空成员${i}`, 5), 'p1', `lotus-${i}`)
  );
  const deck = Array.from({ length: 20 }, (_, i) =>
    createCardInstance(target.data, 'p1', `deck-${i}`)
  );
  const cards = [
    source,
    target,
    other,
    opponent,
    discard,
    liveCard,
    ...energies,
    ...extraMembers,
    ...deck,
  ];
  let game = registerCards(session.state!, cards);
  game = {
    ...game,
    currentPhase: GamePhase.MAIN_PHASE,
    currentSubPhase: SubPhase.NONE,
    currentTurnType: TurnType.FIRST_PLAYER_TURN,
    activePlayerIndex: 0,
    waitingPlayerId: null,
    waitingForInput: false,
    manualOperationMode: 'FREE',
    liveResolution: { ...game.liveResolution, performingPlayerId: 'p1' },
  };
  game = updatePlayer(game, 'p1', (p) => {
    let memberSlots = placeCardInSlot(p.memberSlots, SlotPosition.LEFT, target.instanceId, {
      ...active,
      orientation: options.targetWaiting ? OrientationState.WAITING : OrientationState.ACTIVE,
    });
    memberSlots = placeCardInSlot(memberSlots, SlotPosition.RIGHT, other.instanceId, active);
    if (sourceData.cardType === CardType.MEMBER)
      memberSlots = placeCardInSlot(memberSlots, SlotPosition.CENTER, source.instanceId, active);
    else
      memberSlots = placeCardInSlot(
        memberSlots,
        SlotPosition.CENTER,
        id === 'requirement' ? extraMembers[0]!.instanceId : deck[0]!.instanceId,
        active
      );
    const liveIds =
      id === 'recover' || id === 'no-target'
        ? []
        : [sourceData.cardType === CardType.LIVE ? source.instanceId : liveCard.instanceId];
    return {
      ...p,
      memberSlots,
      mainDeck: { ...p.mainDeck, cardIds: deck.slice(1).map((c) => c.instanceId) },
      hand: { ...p.hand, cardIds: ['discard'] },
      waitingRoom: {
        ...p.waitingRoom,
        cardIds:
          id === 'recover'
            ? ['live']
            : id === 'requirement'
              ? extraMembers.slice(1).map((c) => c.instanceId)
              : [],
      },
      liveZone: {
        ...p.liveZone,
        cardIds: liveIds,
        cardStates: new Map(liveIds.map((cardId) => [cardId, active])),
      },
      energyZone: {
        ...p.energyZone,
        cardIds: energies.map((c) => c.instanceId),
        cardStates: new Map(energies.map((c) => [c.instanceId, active])),
      },
    };
  });
  game = updatePlayer(game, 'p2', (p) => ({
    ...p,
    memberSlots: placeCardInSlot(p.memberSlots, SlotPosition.CENTER, opponent.instanceId, active),
  }));
  const activated = id === 'self' || id === 'recover' || id === 'no-target';
  if (!activated) {
    game = resolvePendingCardEffects({
      ...game,
      pendingAbilities: [
        {
          id: `pending-${id}`,
          eventIds: [],
          abilityId: scenario.ability,
          sourceCardId: source.instanceId,
          controllerId: 'p1',
          mandatory: true,
          timingId: TriggerCondition.ON_LIVE_START,
          sourceSlot: sourceData.cardType === CardType.MEMBER ? SlotPosition.CENTER : undefined,
        },
      ],
    }).gameState;
  }
  (session as unknown as { authorityState: GameState }).authorityState = game;

  const nextCommand = (): GameCommand | null => {
    const effect = session.state!.activeEffect;
    if (!effect)
      return activated ? createActivateAbilityCommand('p1', 'source', scenario.ability) : null;
    if (effect.publicCardSelectionAutoAdvanceAt)
      return createAutoAdvancePublicCardSelectionCommand(
        'p1',
        effect.id,
        effect.publicCardSelectionAutoAdvanceAt
      );
    if (effect.publicEffectChoiceAutoAdvanceAt)
      return createAutoAdvancePublicEffectChoiceCommand(
        'p1',
        effect.id,
        effect.publicEffectChoiceAutoAdvanceAt
      );
    const cardId = effect.selectableCardIds?.includes(id === 'wait' ? 'opponent' : 'target')
      ? id === 'wait'
        ? 'opponent'
        : 'target'
      : effect.selectableCardIds?.[0];
    const optionId = effect.selectableOptions?.find(
      (option) => option.id === (id === 'mixed' ? 'pay' : 'YELLOW')
    )?.id;
    const choiceId = effect.effectChoice?.options.find((option) => option.id === 'YELLOW')?.id;
    return createConfirmEffectStepCommand(
      'p1',
      effect.id,
      effect.selectableCardMode === 'ORDERED_MULTI' ? undefined : cardId,
      undefined,
      undefined,
      optionId,
      effect.selectableCardMode === 'ORDERED_MULTI' && cardId ? [cardId] : undefined,
      undefined,
      undefined,
      undefined,
      choiceId ? [choiceId] : undefined
    );
  };
  return { session, scenario, cards, nextCommand };
}
