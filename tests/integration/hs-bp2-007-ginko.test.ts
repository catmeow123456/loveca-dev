import { describe, expect, it } from 'vitest';
import { confirmPublicSelectionIfNeeded } from '../helpers/public-card-selection-confirmation';
import type { LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
} from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import { createConfirmEffectStepCommand } from '../../src/application/game-commands';
import { resolvePendingCardEffects } from '../../src/application/card-effect-runner';
import { createGameSession } from '../../src/application/game-session';
import {
  HS_BP2_007_LIVE_START_DISCARD_MEMBER_TARGET_SAME_NAME_GREEN_HEART_BLADE_ABILITY_ID,
  HS_BP2_007_ON_ENTER_LOWER_COST_CERISE_RELAY_RECOVER_HASUNOSORA_LIVE_ABILITY_ID,
  HS_PB1_003_AUTO_HAND_TO_WAITING_GAIN_HEART_BLADE_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import {
  getMemberEffectiveBladeCount,
  getMemberEffectiveHeartIcons,
} from '../../src/domain/rules/live-modifiers';
import {
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
  ZoneType,
} from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';
const SELECT_WAITING_ROOM_LIVE_STEP_ID = 'HS_BP2_007_SELECT_WAITING_ROOM_LIVE';
const SELECT_DISCARD_HAND_STEP_ID = 'HS_BP2_007_SELECT_DISCARD_HAND';
const SELECT_SAME_NAME_TARGET_STEP_ID = 'HS_BP2_007_SELECT_SAME_NAME_TARGET';

function member(options: {
  readonly cardCode: string;
  readonly name: string;
  readonly cost?: number;
  readonly unitName?: string;
  readonly groupNames?: readonly string[];
  readonly workNames?: readonly string[];
}): MemberCardData {
  return {
    cardCode: options.cardCode,
    name: options.name,
    groupNames: options.groupNames ?? ['蓮ノ空女学院スクールアイドルクラブ'],
    workNames: options.workNames,
    unitName: options.unitName ?? 'スリーズブーケ',
    cardType: CardType.MEMBER,
    cost: options.cost ?? 4,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function live(cardCode: string, groupNames = ['蓮ノ空女学院スクールアイドルクラブ']): LiveCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames,
    cardType: CardType.LIVE,
    score: 2,
    requirements: createHeartRequirement({ [HeartColor.GREEN]: 1 }),
  };
}

function pending(
  id: string,
  abilityId: string,
  sourceCardId: string,
  timingId: TriggerCondition,
  metadata?: Readonly<Record<string, unknown>>
): PendingAbilityState {
  return {
    id,
    abilityId,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId,
    sourceSlot: SlotPosition.CENTER,
    eventIds: [`event-${id}`],
    metadata,
  };
}

function sessionFromState(state: GameState): ReturnType<typeof createGameSession> {
  const session = createGameSession();
  session.createGame('hs-bp2-007-session', PLAYER1, 'P1', PLAYER2, 'P2');
  (session as unknown as { authorityState: GameState }).authorityState = state;
  return session;
}

function confirm(session: ReturnType<typeof createGameSession>, selectedCardId?: string) {
  const result = session.executeCommand(
    createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, selectedCardId)
  );
  confirmPublicSelectionIfNeeded(session);
  return result;
}

function startOnEnterScenario(options: {
  readonly testId: string;
  readonly sourceCardCode?: string;
  readonly sourceOnStage?: boolean;
  readonly replacementCost?: number;
  readonly replacementUnit?: string;
  readonly relay?: boolean;
  readonly waitingLive?: boolean;
  readonly waitingLiveGroupNames?: readonly string[];
}) {
  const source = createCardInstance(
    member({
      cardCode: options.sourceCardCode ?? 'PL!HS-bp2-007-R＋',
      name: '百生 吟子',
      cost: 11,
    }),
    PLAYER1,
    `${options.testId}-source`
  );
  const replacement = createCardInstance(
    member({
      cardCode: 'RELAY',
      name: 'Relay Member',
      cost: options.replacementCost ?? 10,
      unitName: options.replacementUnit ?? 'スリーズブーケ',
    }),
    PLAYER1,
    `${options.testId}-replacement`
  );
  const waitingLive =
    options.waitingLive === false
      ? null
      : createCardInstance(
          live('PL!HS-test-live', options.waitingLiveGroupNames),
          PLAYER1,
          `${options.testId}-live`
        );

  let game = createGameState(options.testId, PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [source, replacement, ...(waitingLive ? [waitingLive] : [])]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    waitingRoom: {
      ...player.waitingRoom,
      cardIds: waitingLive ? [waitingLive.instanceId] : [],
    },
    memberSlots:
      options.sourceOnStage === false
        ? player.memberSlots
        : placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
            orientation: OrientationState.ACTIVE,
            face: FaceState.FACE_UP,
          }),
  }));
  game = {
    ...game,
    pendingAbilities: [
      pending(
        `${options.testId}-pending`,
        HS_BP2_007_ON_ENTER_LOWER_COST_CERISE_RELAY_RECOVER_HASUNOSORA_LIVE_ABILITY_ID,
        source.instanceId,
        TriggerCondition.ON_ENTER_STAGE,
        options.relay === false
          ? undefined
          : {
              relayReplacements: [
                { cardId: replacement.instanceId, effectiveCost: options.replacementCost ?? 10 },
              ],
            }
      ),
    ],
  };
  return {
    session: sessionFromState(resolvePendingCardEffects(game).gameState),
    sourceId: source.instanceId,
    waitingLiveId: waitingLive?.instanceId ?? null,
  };
}

function startLiveStartScenario(options: {
  readonly testId: string;
  readonly handCardData?: MemberCardData | LiveCardData;
  readonly secondHandCardData?: MemberCardData;
  readonly targetCardData?: MemberCardData;
  readonly sourceOnStage?: boolean;
  readonly includeDiscardTriggerSource?: boolean;
}) {
  const source = createCardInstance(
    member({ cardCode: 'PL!HS-bp2-007-R＋', name: '百生 吟子', cost: 11 }),
    PLAYER1,
    `${options.testId}-source`
  );
  const handCard = options.handCardData
    ? createCardInstance(options.handCardData, PLAYER1, `${options.testId}-hand`)
    : null;
  const secondHandCard = options.secondHandCardData
    ? createCardInstance(options.secondHandCardData, PLAYER1, `${options.testId}-hand-2`)
    : null;
  const target = options.targetCardData
    ? createCardInstance(options.targetCardData, PLAYER1, `${options.testId}-target`)
    : null;
  const triggerSource = options.includeDiscardTriggerSource
    ? createCardInstance(
        member({ cardCode: 'PL!HS-pb1-003-R', name: '大沢瑠璃乃' }),
        PLAYER1,
        `${options.testId}-trigger-source`
      )
    : null;

  const cards = [
    source,
    ...(handCard ? [handCard] : []),
    ...(secondHandCard ? [secondHandCard] : []),
    ...(target ? [target] : []),
    ...(triggerSource ? [triggerSource] : []),
  ];
  let game = registerCards(createGameState(options.testId, PLAYER1, 'P1', PLAYER2, 'P2'), cards);
  game = updatePlayer(game, PLAYER1, (player) => {
    let memberSlots = player.memberSlots;
    if (options.sourceOnStage !== false) {
      memberSlots = placeCardInSlot(memberSlots, SlotPosition.CENTER, source.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      });
    }
    if (target) {
      memberSlots = placeCardInSlot(memberSlots, SlotPosition.LEFT, target.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      });
    }
    if (triggerSource) {
      memberSlots = placeCardInSlot(memberSlots, SlotPosition.RIGHT, triggerSource.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      });
    }
    return {
      ...player,
      hand: {
        ...player.hand,
        cardIds: [handCard?.instanceId, secondHandCard?.instanceId].filter(
          (cardId): cardId is string => typeof cardId === 'string'
        ),
      },
      waitingRoom: { ...player.waitingRoom, cardIds: [] },
      memberSlots,
    };
  });
  game = {
    ...game,
    pendingAbilities: [
      pending(
        `${options.testId}-pending`,
        HS_BP2_007_LIVE_START_DISCARD_MEMBER_TARGET_SAME_NAME_GREEN_HEART_BLADE_ABILITY_ID,
        source.instanceId,
        TriggerCondition.ON_LIVE_START
      ),
    ],
  };
  return {
    session: sessionFromState(resolvePendingCardEffects(game).gameState),
    sourceId: source.instanceId,
    handCardId: handCard?.instanceId ?? null,
    secondHandCardId: secondHandCard?.instanceId ?? null,
    targetId: target?.instanceId ?? null,
  };
}

describe('PL!HS-bp2-007 百生吟子 on-enter relay recovery', () => {
  it.each(['PL!HS-bp2-007-R＋', 'PL!HS-bp2-007-P', 'PL!HS-bp2-007-P＋', 'PL!HS-bp2-007-SEC'])(
    'recovers one Hasunosora LIVE after a lower-cost Cerise relay for %s',
    (sourceCardCode) => {
      const { session, waitingLiveId } = startOnEnterScenario({
        testId: `recover-${sourceCardCode}`,
        sourceCardCode,
      });
      expect(session.state?.activeEffect).toMatchObject({
        abilityId: HS_BP2_007_ON_ENTER_LOWER_COST_CERISE_RELAY_RECOVER_HASUNOSORA_LIVE_ABILITY_ID,
        stepId: SELECT_WAITING_ROOM_LIVE_STEP_ID,
        selectableCardIds: [waitingLiveId],
        canSkipSelection: false,
      });
      const result = confirm(session, waitingLiveId!);
      expect(result.success, result.error).toBe(true);
      expect(session.state?.players[0].hand.cardIds).toContain(waitingLiveId);
      expect(session.state?.players[0].waitingRoom.cardIds).not.toContain(waitingLiveId);
    }
  );

  it.each([
    ['no relay', { relay: false }],
    ['same cost', { replacementCost: 11 }],
    ['higher cost', { replacementCost: 12 }],
    ['wrong unit', { replacementUnit: 'DOLLCHESTRA' }],
    ['source left stage', { sourceOnStage: false }],
    ['no target', { waitingLive: false }],
    ['wrong-group LIVE', { waitingLiveGroupNames: ['虹ヶ咲学園スクールアイドル同好会'] }],
  ] as const)('consumes pending without recovery for %s', (_label, scenarioOptions) => {
    const { session } = startOnEnterScenario({
      testId: `on-enter-no-op-${_label}`,
      ...scenarioOptions,
    });
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.pendingAbilities).toEqual([]);
    expect(session.state?.players[0].hand.cardIds).toEqual([]);
  });
});

describe('PL!HS-bp2-007 百生吟子 LIVE-start discard and same-name target', () => {
  const kaho = () => member({ cardCode: 'PL!HS-test-kaho', name: '日野下花帆' });

  it('offers one optional discard with a single skip entry', () => {
    const { session, handCardId } = startLiveStartScenario({
      testId: 'optional-discard',
      handCardData: kaho(),
      targetCardData: kaho(),
    });
    expect(session.state?.activeEffect).toMatchObject({
      stepId: SELECT_DISCARD_HAND_STEP_ID,
      selectableCardIds: [handCardId],
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
    });
    expect(session.state?.activeEffect?.selectableOptions).toBeUndefined();
  });

  it('skips without paying the cost', () => {
    const { session, handCardId } = startLiveStartScenario({
      testId: 'skip',
      handCardData: kaho(),
      targetCardData: kaho(),
    });
    const result = confirm(session);
    expect(result.success, result.error).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual([handCardId]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([]);
  });

  it.each([
    ['no hand', {}],
    ['source left stage', { sourceOnStage: false, handCardData: kaho() }],
  ] as const)('consumes pending without opening a window for %s', (_label, options) => {
    const { session } = startLiveStartScenario({ testId: `no-window-${_label}`, ...options });
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.pendingAbilities).toEqual([]);
  });

  it('retains a discarded non-member cost and finishes without target selection', () => {
    const { session, handCardId } = startLiveStartScenario({
      testId: 'non-member',
      handCardData: live('PL!HS-hand-live'),
      targetCardData: kaho(),
    });
    const result = confirm(session, handCardId!);
    expect(result.success, result.error).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].waitingRoom.cardIds).toContain(handCardId);
    expect(session.state?.liveResolution.liveModifiers).toEqual([]);
  });

  it('retains a discarded member cost when there is no same-name stage target', () => {
    const { session, handCardId } = startLiveStartScenario({
      testId: 'no-target',
      handCardData: kaho(),
      targetCardData: member({ cardCode: 'OTHER', name: '村野さやか' }),
    });
    const result = confirm(session, handCardId!);
    expect(result.success, result.error).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].waitingRoom.cardIds).toContain(handCardId);
    expect(session.state?.liveResolution.liveModifiers).toEqual([]);
  });

  it('gives an ordinary same-name target green Heart and BLADE', () => {
    const { session, handCardId, targetId } = startLiveStartScenario({
      testId: 'ordinary-target',
      handCardData: kaho(),
      targetCardData: kaho(),
    });
    confirm(session, handCardId!);
    expect(session.state?.activeEffect).toMatchObject({
      stepId: SELECT_SAME_NAME_TARGET_STEP_ID,
      selectableCardIds: [targetId],
      canSkipSelection: false,
    });
    const result = confirm(session, targetId!);
    expect(result.success, result.error).toBe(true);
    expect(getMemberEffectiveHeartIcons(session.state!, PLAYER1, targetId!)).toContainEqual({
      color: HeartColor.GREEN,
      count: 1,
    });
    expect(getMemberEffectiveBladeCount(session.state!, PLAYER1, targetId!)).toBe(2);
  });

  it('uses Q62 multi-name identity to target LL-bp1-001-R＋ for a discarded 日野下花帆', () => {
    const tripleName = member({
      cardCode: 'LL-bp1-001-R＋',
      name: '上原歩夢&澁谷かのん&日野下花帆',
      cost: 20,
      groupNames: ['虹ヶ咲', 'Liella!', '蓮ノ空'],
    });
    const { session, handCardId, targetId } = startLiveStartScenario({
      testId: 'q62-multi-name',
      handCardData: kaho(),
      targetCardData: tripleName,
    });
    confirm(session, handCardId!);
    expect(session.state?.activeEffect).toMatchObject({
      stepId: SELECT_SAME_NAME_TARGET_STEP_ID,
      selectableCardIds: [targetId],
    });
    const result = confirm(session, targetId!);
    expect(result.success, result.error).toBe(true);
    expect(getMemberEffectiveHeartIcons(session.state!, PLAYER1, targetId!)).toContainEqual({
      color: HeartColor.GREEN,
      count: 1,
    });
    expect(getMemberEffectiveBladeCount(session.state!, PLAYER1, targetId!)).toBe(2);
    expect(session.state?.liveResolution.liveModifiers).toContainEqual({
      kind: 'HEART',
      target: 'TARGET_MEMBER',
      playerId: PLAYER1,
      hearts: [{ color: HeartColor.GREEN, count: 1 }],
      sourceCardId: expect.any(String),
      targetMemberCardId: targetId,
      abilityId: HS_BP2_007_LIVE_START_DISCARD_MEMBER_TARGET_SAME_NAME_GREEN_HEART_BLADE_ABILITY_ID,
    });
  });

  it('rejects an illegal or stale target without consuming the selection', () => {
    const { session, handCardId, targetId } = startLiveStartScenario({
      testId: 'stale-target',
      handCardData: kaho(),
      targetCardData: kaho(),
    });
    confirm(session, handCardId!);
    (session as unknown as { authorityState: GameState }).authorityState = updatePlayer(
      session.state!,
      PLAYER1,
      (player) => ({
        ...player,
        memberSlots: {
          ...player.memberSlots,
          slots: { ...player.memberSlots.slots, [SlotPosition.LEFT]: null },
        },
      })
    );
    const result = confirm(session, targetId!);
    expect(result.success).toBe(false);
    expect(session.state?.activeEffect?.stepId).toBe(SELECT_SAME_NAME_TARGET_STEP_ID);
    expect(session.state?.liveResolution.liveModifiers).toEqual([]);
  });

  it('enqueues the hand-discard trigger without swallowing target selection', () => {
    const { session, handCardId, targetId } = startLiveStartScenario({
      testId: 'discard-trigger',
      handCardData: kaho(),
      targetCardData: kaho(),
      includeDiscardTriggerSource: true,
    });
    confirm(session, handCardId!);
    expect(
      session.state?.eventLog.some(
        (entry) =>
          entry.event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM &&
          entry.event.fromZone === ZoneType.HAND &&
          entry.event.cardInstanceIds?.includes(handCardId!)
      )
    ).toBe(true);
    expect(session.state?.pendingAbilities).toContainEqual(
      expect.objectContaining({
        abilityId: HS_PB1_003_AUTO_HAND_TO_WAITING_GAIN_HEART_BLADE_ABILITY_ID,
      })
    );
    expect(session.state?.activeEffect).toMatchObject({
      stepId: SELECT_SAME_NAME_TARGET_STEP_ID,
      selectableCardIds: [targetId],
    });
  });

  it('continues to the next pending ability after target resolution', () => {
    const { session, sourceId, handCardId, secondHandCardId, targetId } = startLiveStartScenario({
      testId: 'continuation',
      handCardData: kaho(),
      secondHandCardData: kaho(),
      targetCardData: kaho(),
    });
    confirm(session, handCardId!);
    (session as unknown as { authorityState: GameState }).authorityState = {
      ...session.state!,
      pendingAbilities: [
        ...session.state!.pendingAbilities,
        pending(
          'later-pending',
          HS_BP2_007_LIVE_START_DISCARD_MEMBER_TARGET_SAME_NAME_GREEN_HEART_BLADE_ABILITY_ID,
          sourceId,
          TriggerCondition.ON_LIVE_START
        ),
      ],
    };
    const result = confirm(session, targetId!);
    expect(result.success, result.error).toBe(true);
    expect(session.state?.activeEffect).toMatchObject({
      stepId: SELECT_DISCARD_HAND_STEP_ID,
      selectableCardIds: [secondHandCardId],
    });
  });
});
