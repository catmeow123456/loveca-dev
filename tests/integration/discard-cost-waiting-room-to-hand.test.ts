import { describe, expect, it } from 'vitest';
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
} from '../../src/domain/entities/game';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import {
  createActivateAbilityCommand,
  createAutoAdvancePublicCardSelectionCommand,
  createConfirmEffectStepCommand,
} from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import {
  HS_PB1_003_AUTO_HAND_TO_WAITING_GAIN_HEART_BLADE_ABILITY_ID,
  N_SD1_005_ACTIVATED_DISCARD_TWO_RECOVER_NIJIGASAKI_MEMBER_ABILITY_ID,
  N_SD1_007_ACTIVATED_DISCARD_TWO_RECOVER_NIJIGASAKI_LIVE_ABILITY_ID,
  PL_PR_003_ACTIVATED_DISCARD_TWO_RECOVER_YELLOW_THREE_LIVE_ABILITY_ID,
  PL_PR_004_ACTIVATED_DISCARD_TWO_RECOVER_PINK_THREE_LIVE_ABILITY_ID,
  PL_N_BP1_008_ACTIVATED_DISCARD_MEMBER_RECOVER_LOWER_COST_MEMBER_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import { PUBLIC_CARD_SELECTION_CONFIRMATION_STEP_ID } from '../../src/application/card-effects/runtime/public-card-selection-confirmation';
import { createPublicObjectId, projectPlayerViewState } from '../../src/online/projector';
import {
  CardType,
  FaceState,
  GamePhase,
  HeartColor,
  OrientationState,
  SlotPosition,
  SubPhase,
  TurnType,
  TriggerCondition,
} from '../../src/shared/types/enums';

const P1 = 'player1';
const P2 = 'player2';
const YELLOW_TEXT =
  '【起动】【1回合1次】将2张手牌放置入休息室：从自己的休息室将1张必要HEART中含有大于等于3个[黄ハート]的LIVE卡加入手牌。';
const PINK_TEXT =
  '【起动】【1回合1次】将2张手牌放置入休息室：从休息室将1张必要HEART中含有大于等于3个[桃ハート]的LIVE卡加入手牌。';

type Config = {
  readonly cardCode: string;
  readonly name: string;
  readonly abilityId: string;
  readonly color: HeartColor;
  readonly otherColor: HeartColor;
  readonly token: string;
  readonly effectText: string;
};

const CONFIGS: readonly Config[] = [
  {
    cardCode: 'PL!-PR-003-PR',
    name: '南ことり',
    abilityId: PL_PR_003_ACTIVATED_DISCARD_TWO_RECOVER_YELLOW_THREE_LIVE_ABILITY_ID,
    color: HeartColor.YELLOW,
    otherColor: HeartColor.PINK,
    token: '[黄ハート]',
    effectText: YELLOW_TEXT,
  },
  {
    cardCode: 'PL!-PR-004-PR',
    name: '園田海未',
    abilityId: PL_PR_004_ACTIVATED_DISCARD_TWO_RECOVER_PINK_THREE_LIVE_ABILITY_ID,
    color: HeartColor.PINK,
    otherColor: HeartColor.YELLOW,
    token: '[桃ハート]',
    effectText: PINK_TEXT,
  },
];

type NijigasakiConfig = Config & {
  readonly recoveryType: CardType.MEMBER | CardType.LIVE;
  readonly recoverySelectionLabel: string;
};

const NIJIGASAKI_CONFIGS: readonly NijigasakiConfig[] = [
  {
    cardCode: 'PL!N-sd1-005-PR',
    name: '宮下 愛',
    abilityId: N_SD1_005_ACTIVATED_DISCARD_TWO_RECOVER_NIJIGASAKI_MEMBER_ABILITY_ID,
    color: HeartColor.RED,
    otherColor: HeartColor.BLUE,
    token: '',
    effectText:
      '【起动】【1回合1次】将2张手牌放置入休息室：从自己的休息室将1张『虹咲』的成员卡加入手牌。',
    recoveryType: CardType.MEMBER,
    recoverySelectionLabel: '选择要加入手牌的虹咲成员卡',
  },
  {
    cardCode: 'PL!N-sd1-007-SD',
    name: '優木せつ菜',
    abilityId: N_SD1_007_ACTIVATED_DISCARD_TWO_RECOVER_NIJIGASAKI_LIVE_ABILITY_ID,
    color: HeartColor.RED,
    otherColor: HeartColor.BLUE,
    token: '',
    effectText:
      '【起动】【1回合1次】将2张手牌放置入休息室：从自己的休息室将1张『虹咲』的LIVE卡加入手牌。',
    recoveryType: CardType.LIVE,
    recoverySelectionLabel: '选择要加入手牌的虹咲LIVE卡',
  },
];

function member(
  cardCode: string,
  name = cardCode,
  cost = 4,
  groupNames: readonly string[] = []
): MemberCardData {
  return {
    cardCode,
    name,
    groupNames,
    cardType: CardType.MEMBER,
    cost,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.YELLOW, 3), createHeartIcon(HeartColor.PINK, 3)],
  };
}

function live(
  cardCode: string,
  requirements: Partial<Record<HeartColor, number>>,
  groupNames: readonly string[] = []
): LiveCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames,
    cardType: CardType.LIVE,
    score: 1,
    requirements: createHeartRequirement(requirements),
    bladeHearts: [],
  };
}

function setup(
  config: Config,
  options: {
    readonly handData?: readonly (MemberCardData | LiveCardData)[];
    readonly waitingData?: readonly (MemberCardData | LiveCardData)[];
    readonly sourceOnStage?: boolean;
    readonly activePlayerIndex?: number;
  } = {}
) {
  let now = 10_000;
  const source = createCardInstance(member(config.cardCode, config.name), P1, 'source');
  const hand = (options.handData ?? [member('cost-1'), member('cost-2')]).map((data, index) =>
    createCardInstance(data, P1, `hand-${index}`)
  );
  const waiting = (options.waitingData ?? []).map((data, index) =>
    createCardInstance(data, P1, `waiting-${index}`)
  );
  let game = registerCards(createGameState('discard-recover', P1, 'P1', P2, 'P2'), [
    source,
    ...hand,
    ...waiting,
  ]);
  game = updatePlayer(game, P1, (player) => ({
    ...player,
    hand: { ...player.hand, cardIds: hand.map((card) => card.instanceId) },
    waitingRoom: { ...player.waitingRoom, cardIds: waiting.map((card) => card.instanceId) },
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
    currentPhase: GamePhase.MAIN_PHASE,
    currentSubPhase: SubPhase.NONE,
    currentTurnType: TurnType.NORMAL,
    activePlayerIndex: options.activePlayerIndex ?? 0,
    waitingPlayerId: null,
  };
  const session = createGameSession({ now: () => now });
  session.createGame('discard-recover-session', P1, 'P1', P2, 'P2');
  (session as unknown as { authorityState: GameState }).authorityState = game;
  return {
    session,
    source,
    hand,
    waiting,
    setNow(value: number) {
      now = value;
    },
  };
}

function activate(context: ReturnType<typeof setup>, config: Config) {
  return context.session.executeCommand(
    createActivateAbilityCommand(P1, context.source.instanceId, config.abilityId)
  );
}

function pay(context: ReturnType<typeof setup>, selected = context.hand.map((card) => card.instanceId)) {
  return context.session.executeCommand(
    createConfirmEffectStepCommand(
      P1,
      context.session.state!.activeEffect!.id,
      undefined,
      undefined,
      undefined,
      undefined,
      selected
    )
  );
}

function paySingle(context: ReturnType<typeof setup>, selectedCardId: string | null) {
  return context.session.executeCommand(
    createConfirmEffectStepCommand(
      P1,
      context.session.state!.activeEffect!.id,
      selectedCardId
    )
  );
}

describe('discard-cost waiting-room-to-hand shared workflow', () => {
  for (const config of CONFIGS) {
    it(`${config.cardCode} opens the production discard window and filters printed ${config.token} requirements`, () => {
      const context = setup(config, {
        waitingData: [
          live('valid-3', { [config.color]: 3 }),
          live('valid-4', { [config.color]: 4 }),
          live('too-low-2', { [config.color]: 2 }),
          live('other-color-3', { [config.otherColor]: 3 }),
          live('purple-3', { [HeartColor.PURPLE]: 3 }),
          member('member-with-hearts'),
        ],
      });

      const started = activate(context, config);
      expect(started.success, started.error).toBe(true);
      expect(context.session.state?.activeEffect).toMatchObject({
        abilityId: config.abilityId,
        effectText: config.effectText,
        stepText: '请选择2张手牌放置入休息室。',
        selectionLabel: '选择要放置入休息室的2张手牌',
        confirmSelectionLabel: '放置入休息室',
        canSkipSelection: false,
        selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
        minSelectableCards: 2,
        maxSelectableCards: 2,
      });

      const paid = pay(context);
      expect(paid.success, paid.error).toBe(true);
      expect(context.session.state?.activeEffect).toMatchObject({
        stepText: `请选择自己的休息室中1张必要HEART中含有大于等于3个${config.token}的LIVE卡加入手牌。`,
        selectionLabel: '选择要加入手牌的LIVE卡',
        confirmSelectionLabel: '加入手牌',
        canSkipSelection: false,
      });
      expect(context.session.state?.activeEffect?.selectableCardIds).toEqual([
        context.waiting[0]!.instanceId,
        context.waiting[1]!.instanceId,
      ]);
      expect(context.session.state?.players[0].waitingRoom.cardIds).toEqual(
        expect.arrayContaining(context.hand.map((card) => card.instanceId))
      );
      const enterEvent = context.session.state?.eventLog.find(
        (entry) => entry.event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM
      )?.event;
      expect(enterEvent).toMatchObject({
        cardInstanceIds: context.hand.map((card) => card.instanceId),
        fromZone: 'HAND',
        toZone: 'WAITING_ROOM',
      });
    });
  }

  it('rescans after payment so an eligible discarded LIVE can be recovered', () => {
    const config = CONFIGS[0]!;
    const context = setup(config, {
      handData: [live('discarded-yellow-live', { [HeartColor.YELLOW]: 3 }), member('cost-2')],
    });
    expect(activate(context, config).success).toBe(true);
    expect(pay(context).success).toBe(true);
    expect(context.session.state?.activeEffect?.selectableCardIds).toEqual([
      context.hand[0]!.instanceId,
    ]);
  });

  it('keeps the paid cards in waiting room and finishes when the rescan has no target', () => {
    const config = CONFIGS[1]!;
    const context = setup(config);
    expect(activate(context, config).success).toBe(true);
    expect(pay(context).success).toBe(true);
    expect(context.session.state?.activeEffect).toMatchObject({
      selectableCardIds: [],
      canSkipSelection: true,
    });
    const finish = context.session.executeCommand(
      createConfirmEffectStepCommand(P1, context.session.state!.activeEffect!.id)
    );
    expect(finish.success, finish.error).toBe(true);
    expect(context.session.state?.activeEffect).toBeNull();
    expect(context.session.state?.players[0].waitingRoom.cardIds).toEqual(
      expect.arrayContaining(context.hand.map((card) => card.instanceId))
    );
  });

  it('rejects duplicate, forged, missing, and stale discard IDs without advancing', () => {
    const config = CONFIGS[0]!;
    for (const selected of [
      ['hand-0', 'hand-0'],
      ['hand-0', 'forged'],
      ['hand-0'],
    ]) {
      const context = setup(config);
      expect(activate(context, config).success).toBe(true);
      const stepId = context.session.state!.activeEffect!.stepId;
      context.session.executeCommand(
        createConfirmEffectStepCommand(
          P1,
          context.session.state!.activeEffect!.id,
          undefined,
          undefined,
          undefined,
          undefined,
          selected
        )
      );
      expect(context.session.state?.activeEffect?.stepId).toBe(stepId);
      expect(context.session.state?.players[0].waitingRoom.cardIds).toEqual([]);
    }

    const stale = setup(config);
    expect(activate(stale, config).success).toBe(true);
    (stale.session as unknown as { authorityState: GameState }).authorityState = updatePlayer(
      stale.session.state!,
      P1,
      (player) => ({
        ...player,
        hand: { ...player.hand, cardIds: [stale.hand[1]!.instanceId] },
      })
    );
    pay(stale);
    expect(stale.session.state?.activeEffect?.stepText).toBe('请选择2张手牌放置入休息室。');
    expect(stale.session.state?.players[0].waitingRoom.cardIds).toEqual([]);
  });

  it('rejects forged and unlisted recovery targets without moving or advancing', () => {
    const config = CONFIGS[0]!;
    const context = setup(config, {
      waitingData: [
        live('valid', { [HeartColor.YELLOW]: 3 }),
        live('invalid', { [HeartColor.YELLOW]: 2 }),
      ],
    });
    expect(activate(context, config).success).toBe(true);
    expect(pay(context).success).toBe(true);
    const effectId = context.session.state!.activeEffect!.id;
    for (const target of ['forged', context.waiting[1]!.instanceId]) {
      context.session.executeCommand(createConfirmEffectStepCommand(P1, effectId, target));
      expect(context.session.state?.activeEffect?.id).toBe(effectId);
      expect(context.session.state?.players[0].hand.cardIds).toEqual([]);
    }
  });

  it('publicly reveals only the chosen target, moves only after the deadline, and is idempotent', () => {
    const config = CONFIGS[0]!;
    const context = setup(config, {
      waitingData: [live('valid-a', { [HeartColor.YELLOW]: 3 }), live('valid-b', { [HeartColor.YELLOW]: 4 })],
    });
    expect(activate(context, config).success).toBe(true);
    expect(pay(context).success).toBe(true);
    const targetId = context.waiting[0]!.instanceId;
    const effectId = context.session.state!.activeEffect!.id;
    const selected = context.session.executeCommand(
      createConfirmEffectStepCommand(P1, effectId, targetId)
    );
    expect(selected.success, selected.error).toBe(true);
    const reveal = context.session.state!.activeEffect!;
    expect(reveal).toMatchObject({
      stepId: PUBLIC_CARD_SELECTION_CONFIRMATION_STEP_ID,
      revealedCardIds: [targetId],
      publicCardSelectionAutoAdvanceAt: 12_000,
    });
    expect(context.session.state?.players[0].waitingRoom.cardIds).toContain(targetId);
    expect(context.session.state?.players[0].hand.cardIds).toEqual([]);
    const publicId = createPublicObjectId(targetId);
    expect(projectPlayerViewState(context.session.state!, P1, { now: 10_000 }).activeEffect)
      .toMatchObject({ revealedObjectIds: [publicId], publicCardSelectionAutoAdvanceAt: 12_000 });
    expect(projectPlayerViewState(context.session.state!, P2, { now: 10_000 }).activeEffect)
      .toMatchObject({ revealedObjectIds: [publicId], publicCardSelectionAutoAdvanceAt: 12_000 });

    context.setNow(12_000);
    const advanced = context.session.executeCommand(
      createAutoAdvancePublicCardSelectionCommand(P2, effectId, 12_000)
    );
    expect(advanced.success, advanced.error).toBe(true);
    expect(context.session.state?.players[0].hand.cardIds).toEqual([targetId]);
    expect(context.session.state?.players[0].waitingRoom.cardIds).not.toContain(targetId);
    const repeated = context.session.executeCommand(
      createAutoAdvancePublicCardSelectionCommand(P1, effectId, 12_000)
    );
    expect(repeated.success).toBe(false);
    expect(context.session.state?.players[0].hand.cardIds).toEqual([targetId]);
  });

  it('does not move a substitute when the revealed target leaves waiting room before resume', () => {
    const config = CONFIGS[1]!;
    const context = setup(config, {
      waitingData: [live('selected', { [HeartColor.PINK]: 3 }), live('substitute', { [HeartColor.PINK]: 4 })],
    });
    expect(activate(context, config).success).toBe(true);
    expect(pay(context).success).toBe(true);
    const selectedId = context.waiting[0]!.instanceId;
    const substituteId = context.waiting[1]!.instanceId;
    const effectId = context.session.state!.activeEffect!.id;
    expect(
      context.session.executeCommand(createConfirmEffectStepCommand(P1, effectId, selectedId)).success
    ).toBe(true);
    (context.session as unknown as { authorityState: GameState }).authorityState = updatePlayer(
      context.session.state!,
      P1,
      (player) => ({
        ...player,
        waitingRoom: {
          ...player.waitingRoom,
          cardIds: player.waitingRoom.cardIds.filter((cardId) => cardId !== selectedId),
        },
        mainDeck: { ...player.mainDeck, cardIds: [selectedId, ...player.mainDeck.cardIds] },
      })
    );
    context.setNow(12_000);
    context.session.executeCommand(createAutoAdvancePublicCardSelectionCommand(P2, effectId, 12_000));
    expect(context.session.state?.players[0].hand.cardIds).toEqual([]);
    expect(context.session.state?.players[0].waitingRoom.cardIds).toContain(substituteId);
    expect(context.session.state?.players[0].mainDeck.cardIds).toContain(selectedId);
  });

  it('records the per-turn use and rejects a second production activation', () => {
    const config = CONFIGS[0]!;
    const context = setup(config, {
      handData: [member('cost-1'), member('cost-2'), member('cost-3'), member('cost-4')],
    });
    expect(activate(context, config).success).toBe(true);
    expect(pay(context, context.hand.slice(0, 2).map((card) => card.instanceId)).success).toBe(true);
    expect(
      context.session.executeCommand(
        createConfirmEffectStepCommand(P1, context.session.state!.activeEffect!.id)
      ).success
    ).toBe(true);
    const second = activate(context, config);
    expect(second.success).toBe(false);
    expect(context.session.state?.activeEffect).toBeNull();
  });

  it('cannot activate off stage, for the non-active player turn, or with fewer than two hand cards', () => {
    const config = CONFIGS[1]!;
    for (const context of [
      setup(config, { sourceOnStage: false }),
      setup(config, { activePlayerIndex: 1 }),
      setup(config, { handData: [member('only-one')] }),
    ]) {
      const result = activate(context, config);
      expect(result.success).toBe(false);
      expect(context.session.state?.activeEffect).toBeNull();
    }
  });
});

describe('PL!N-sd1-005 费用11「宮下 愛」与 PL!N-sd1-007 费用13「優木せつ菜」', () => {
  function eligibleTarget(config: NijigasakiConfig, code: string) {
    return config.recoveryType === CardType.MEMBER
      ? member(code, code, 4, ['虹ヶ咲学園スクールアイドル同好会'])
      : live(code, { [HeartColor.RED]: 1 }, ['虹ヶ咲学園スクールアイドル同好会']);
  }

  function oppositeTypeTarget(config: NijigasakiConfig, code: string) {
    return config.recoveryType === CardType.MEMBER
      ? live(code, { [HeartColor.RED]: 1 }, ['虹ヶ咲'])
      : member(code, code, 4, ['虹ヶ咲']);
  }

  function sameTypeOtherGroupTarget(config: NijigasakiConfig, code: string) {
    return config.recoveryType === CardType.MEMBER
      ? member(code, code, 4, ['Aqours'])
      : live(code, { [HeartColor.RED]: 1 }, ['Aqours']);
  }

  for (const config of NIJIGASAKI_CONFIGS) {
    it(`${config.cardCode} pays exactly two cards and recovers only the configured Nijigasaki type`, () => {
      const context = setup(config, {
        waitingData: [
          eligibleTarget(config, 'eligible'),
          oppositeTypeTarget(config, 'opposite-type'),
          sameTypeOtherGroupTarget(config, 'other-group'),
        ],
      });

      expect(activate(context, config).success).toBe(true);
      expect(context.session.state?.activeEffect).toMatchObject({
        abilityId: config.abilityId,
        effectText: config.effectText,
        minSelectableCards: 2,
        maxSelectableCards: 2,
        confirmSelectionLabel: '放置入休息室',
        canSkipSelection: false,
      });
      expect(pay(context).success).toBe(true);
      expect(context.session.state?.players[0].waitingRoom.cardIds).toEqual(
        expect.arrayContaining(context.hand.map((card) => card.instanceId))
      );
      expect(context.session.state?.activeEffect).toMatchObject({
        selectableCardIds: [context.waiting[0]!.instanceId],
        selectionLabel: config.recoverySelectionLabel,
        confirmSelectionLabel: '加入手牌',
        canSkipSelection: false,
      });

      const effectId = context.session.state!.activeEffect!.id;
      const targetId = context.waiting[0]!.instanceId;
      expect(
        context.session.executeCommand(createConfirmEffectStepCommand(P1, effectId, targetId))
          .success
      ).toBe(true);
      expect(context.session.state?.players[0].waitingRoom.cardIds).toContain(targetId);
      context.setNow(12_000);
      expect(
        context.session.executeCommand(
          createAutoAdvancePublicCardSelectionCommand(P2, effectId, 12_000)
        ).success
      ).toBe(true);
      expect(context.session.state?.players[0].hand.cardIds).toContain(targetId);
      expect(context.session.state?.activeEffect).toBeNull();
    });

    it(`${config.cardCode} rescans after payment so a just-discarded legal target can be recovered`, () => {
      const context = setup(config, {
        handData: [eligibleTarget(config, 'just-discarded'), oppositeTypeTarget(config, 'cost')],
      });
      expect(activate(context, config).success).toBe(true);
      expect(pay(context).success).toBe(true);
      expect(context.session.state?.activeEffect?.selectableCardIds).toEqual([
        context.hand[0]!.instanceId,
      ]);
    });

    it(`${config.cardCode} cannot activate with fewer than two hand cards`, () => {
      const context = setup(config, { handData: [oppositeTypeTarget(config, 'only-one')] });
      expect(activate(context, config).success).toBe(false);
      expect(context.session.state?.activeEffect).toBeNull();
    });
  }

  it('allows payment with no target before activation and finishes as a paid no-op after rescan', () => {
    const config = NIJIGASAKI_CONFIGS[0]!;
    const context = setup(config, {
      handData: [
        live('non-member-cost-1', { [HeartColor.RED]: 1 }, ['虹ヶ咲']),
        live('non-member-cost-2', { [HeartColor.RED]: 1 }, ['Aqours']),
      ],
    });
    expect(activate(context, config).success).toBe(true);
    expect(pay(context).success).toBe(true);
    expect(context.session.state?.activeEffect).toBeNull();
    expect(context.session.state?.players[0].waitingRoom.cardIds).toEqual(
      context.hand.map((card) => card.instanceId)
    );
    expect(context.session.state?.actionHistory.at(-1)).toMatchObject({
      type: 'RESOLVE_ABILITY',
      payload: {
        abilityId: config.abilityId,
        sourceCardId: context.source.instanceId,
        step: 'DISCARD_HAND_NO_RECOVERY_TARGET',
        result: 'NO_RECOVERY_TARGET',
        discardedHandCardIds: context.hand.map((card) => card.instanceId),
        selectableCardIds: [],
      },
    });
  });

  it('returns a paid no-target result to the checkpoint before resolving hand-to-waiting autos', () => {
    const config = NIJIGASAKI_CONFIGS[0]!;
    const context = setup(config, {
      handData: [
        live('non-member-cost-1', { [HeartColor.RED]: 1 }, ['虹ヶ咲']),
        live('non-member-cost-2', { [HeartColor.RED]: 1 }, ['Aqours']),
      ],
    });
    const listener = createCardInstance(
      member('PL!HS-pb1-003-R', '大沢瑠璃乃', 15, [
        '蓮ノ空女学院スクールアイドルクラブ',
      ]),
      P1,
      'hand-to-waiting-listener'
    );
    const deckCard = createCardInstance(member('deck-card'), P1, 'deck-card');
    let state = registerCards(context.session.state!, [listener, deckCard]);
    state = updatePlayer(state, P1, (player) => ({
      ...player,
      mainDeck: { ...player.mainDeck, cardIds: [deckCard.instanceId] },
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.LEFT, listener.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
    }));
    (context.session as unknown as { authorityState: GameState }).authorityState = state;

    expect(activate(context, config).success).toBe(true);
    expect(pay(context).success).toBe(true);

    expect(context.session.state?.activeEffect).toBeNull();
    expect(context.session.state?.pendingChoice).toBeNull();
    expect(context.session.state?.pendingAbilities).toEqual([]);
    expect(context.session.state?.players[0].waitingRoom.cardIds).toEqual(
      context.hand.map((card) => card.instanceId)
    );

    const noTargetActionIndex = context.session.state!.actionHistory.findIndex(
      (action) =>
        action.type === 'RESOLVE_ABILITY' &&
        action.payload.abilityId === config.abilityId &&
        action.payload.step === 'DISCARD_HAND_NO_RECOVERY_TARGET'
    );
    const listenerActionIndex = context.session.state!.actionHistory.findIndex(
      (action) =>
        action.type === 'RESOLVE_ABILITY' &&
        action.payload.abilityId ===
          HS_PB1_003_AUTO_HAND_TO_WAITING_GAIN_HEART_BLADE_ABILITY_ID &&
        action.payload.sourceCardId === listener.instanceId &&
        action.payload.step === 'GAIN_PINK_HEART_AND_BLADE_FROM_HAND_TO_WAITING'
    );
    expect(noTargetActionIndex).toBeGreaterThanOrEqual(0);
    expect(listenerActionIndex).toBeGreaterThan(noTargetActionIndex);
    expect(context.session.state?.actionHistory[noTargetActionIndex]?.payload).toMatchObject({
      sourceCardId: context.source.instanceId,
      result: 'NO_RECOVERY_TARGET',
      discardedHandCardIds: context.hand.map((card) => card.instanceId),
    });
    expect(
      context.session.state?.liveResolution.liveModifiers.filter(
        (modifier) =>
          modifier.abilityId ===
            HS_PB1_003_AUTO_HAND_TO_WAITING_GAIN_HEART_BLADE_ABILITY_ID &&
          modifier.sourceCardId === listener.instanceId
      )
    ).toHaveLength(2);
  });

  it('requires current player main phase, the source on own stage, and no other active effect', () => {
    const config = NIJIGASAKI_CONFIGS[0]!;
    const offStage = setup(config, { sourceOnStage: false });
    expect(activate(offStage, config).success).toBe(false);

    const nonActive = setup(config, { activePlayerIndex: 1 });
    expect(activate(nonActive, config).success).toBe(false);

    const wrongPhase = setup(config);
    (wrongPhase.session as unknown as { authorityState: GameState }).authorityState = {
      ...wrongPhase.session.state!,
      currentPhase: GamePhase.ACTIVE_PHASE,
    };
    expect(activate(wrongPhase, config).success).toBe(false);

    const activeEffect = setup(config);
    expect(activate(activeEffect, config).success).toBe(true);
    const effectId = activeEffect.session.state!.activeEffect!.id;
    expect(activate(activeEffect, config).success).toBe(false);
    expect(activeEffect.session.state?.activeEffect?.id).toBe(effectId);
  });

  it('enforces once per turn and allows the same source ability again next turn', () => {
    const config = NIJIGASAKI_CONFIGS[0]!;
    const context = setup(config, {
      handData: [
        live('cost-1', { [HeartColor.RED]: 1 }, ['Aqours']),
        live('cost-2', { [HeartColor.RED]: 1 }, ['Aqours']),
        live('cost-3', { [HeartColor.RED]: 1 }, ['Aqours']),
        live('cost-4', { [HeartColor.RED]: 1 }, ['Aqours']),
      ],
    });
    expect(activate(context, config).success).toBe(true);
    expect(pay(context, context.hand.slice(0, 2).map((card) => card.instanceId)).success).toBe(
      true
    );
    expect(context.session.state?.activeEffect).toBeNull();
    expect(activate(context, config).success).toBe(false);
    (context.session as unknown as { authorityState: GameState }).authorityState = {
      ...context.session.state!,
      turnCount: context.session.state!.turnCount + 1,
    };
    expect(activate(context, config).success).toBe(true);
  });

  it('uses the shared authoritative public confirmation lifecycle for the new 005 base', () => {
    const config = NIJIGASAKI_CONFIGS[0]!;
    const context = setup(config, {
      waitingData: [eligibleTarget(config, 'public-target')],
    });
    expect(activate(context, config).success).toBe(true);
    expect(pay(context).success).toBe(true);
    const targetId = context.waiting[0]!.instanceId;
    const effectId = context.session.state!.activeEffect!.id;
    expect(
      context.session.executeCommand(createConfirmEffectStepCommand(P1, effectId, targetId)).success
    ).toBe(true);
    expect(context.session.state?.activeEffect).toMatchObject({
      stepId: PUBLIC_CARD_SELECTION_CONFIRMATION_STEP_ID,
      revealedCardIds: [targetId],
      publicCardSelectionAutoAdvanceAt: 12_000,
    });
    expect(context.session.state?.players[0].waitingRoom.cardIds).toContain(targetId);
    expect(context.session.state?.players[0].hand.cardIds).not.toContain(targetId);
    const publicId = createPublicObjectId(targetId);
    expect(
      projectPlayerViewState(context.session.state!, P1, { now: 10_000 }).activeEffect
    ).toMatchObject({
      revealedObjectIds: [publicId],
      publicCardSelectionAutoAdvanceAt: 12_000,
    });
    expect(
      projectPlayerViewState(context.session.state!, P2, { now: 10_000 }).activeEffect
    ).toMatchObject({
      revealedObjectIds: [publicId],
      publicCardSelectionAutoAdvanceAt: 12_000,
    });

    context.setNow(11_999);
    expect(
      context.session.executeCommand(
        createAutoAdvancePublicCardSelectionCommand(P1, effectId, 12_000)
      ).success
    ).toBe(false);
    expect(context.session.state?.players[0].waitingRoom.cardIds).toContain(targetId);

    context.setNow(12_000);
    expect(
      context.session.executeCommand(
        createAutoAdvancePublicCardSelectionCommand(P2, effectId, 12_000)
      ).success
    ).toBe(true);
    expect(context.session.state?.players[0].hand.cardIds).toContain(targetId);
    expect(
      context.session.executeCommand(
        createAutoAdvancePublicCardSelectionCommand(P1, effectId, 12_000)
      ).success
    ).toBe(false);
    expect(context.session.state?.players[0].hand.cardIds.filter((id) => id === targetId)).toHaveLength(
      1
    );
  });
});

describe('PL!N-bp1-008 费用9「艾玛·维尔德」 dynamic printed-cost recovery', () => {
  const config: Config = {
    cardCode: 'PL!N-bp1-008-P',
    name: 'エマ・ヴェルデ',
    abilityId: PL_N_BP1_008_ACTIVATED_DISCARD_MEMBER_RECOVER_LOWER_COST_MEMBER_ABILITY_ID,
    color: HeartColor.GREEN,
    otherColor: HeartColor.BLUE,
    token: '',
    effectText:
      '【起动】【1回合1次】将1张手牌的成员卡放置入休息室：从自己的休息室将1张费用低于因支付此费用被放置入休息室的成员卡的成员卡加入手牌。',
  };

  it('offers only member hand costs and rescans strict lower printed-cost members after payment', () => {
    const context = setup(config, {
      handData: [member('discard-8', 'discard-8', 8), live('not-a-member', { [HeartColor.GREEN]: 1 })],
      waitingData: [member('lower-7', 'lower-7', 7), member('equal-8', 'equal-8', 8), member('higher-9', 'higher-9', 9), live('low-live', { [HeartColor.GREEN]: 1 })],
    });
    expect(activate(context, config).success).toBe(true);
    expect(context.session.state?.activeEffect).toMatchObject({
      stepText: '请选择1张成员卡放置入休息室。',
      selectableCardIds: [context.hand[0]!.instanceId],
      selectableCardMode: 'SINGLE',
      minSelectableCards: 1,
      maxSelectableCards: 1,
      selectionLabel: '选择要放置入休息室的成员卡',
      confirmSelectionLabel: '放置入休息室',
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
      selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
    });
    expect(paySingle(context, context.hand[0]!.instanceId).success).toBe(true);
    expect(context.session.state?.activeEffect).toMatchObject({
      selectableCardIds: [context.waiting[0]!.instanceId],
      selectionLabel: '选择要加入手牌的成员卡',
      confirmSelectionLabel: '加入手牌',
      canSkipSelection: false,
    });
    expect(context.session.state?.activeEffect?.metadata?.discardedMemberPrintedCost).toBe(8);
    expect(context.session.state?.activeEffect?.selectableCardIds).not.toContain(context.hand[0]!.instanceId);
  });

  it('keeps the paid member and finishes directly without an empty confirmation when no lower target exists', () => {
    const context = setup(config, { handData: [member('discard-2', 'discard-2', 2)], waitingData: [member('equal-2', 'equal-2', 2)] });
    expect(activate(context, config).success).toBe(true);
    expect(paySingle(context, context.hand[0]!.instanceId).success).toBe(true);
    expect(context.session.state?.activeEffect).toBeNull();
    expect(context.session.state?.players[0].waitingRoom.cardIds).toContain(context.hand[0]!.instanceId);
    expect(context.session.state?.actionHistory.filter((action) => action.type === 'RESOLVE_ABILITY' && action.payload.abilityId === config.abilityId && action.payload.step === 'ABILITY_USE')).toHaveLength(1);
  });

  it('does not pay or consume turn use for forged, duplicate, stale, non-member, or departed-source input', () => {
    const scenarios = ['forged', 'hand-1'] as const;
    for (const selected of scenarios) {
      const context = setup(config, { handData: [member('member-8', 'member-8', 8), live('live', { [HeartColor.GREEN]: 1 })] });
      expect(activate(context, config).success).toBe(true);
      paySingle(context, selected);
      expect(context.session.state?.players[0].waitingRoom.cardIds).toEqual([]);
      expect(context.session.state?.actionHistory.some((action) => action.payload.abilityId === config.abilityId && action.payload.step === 'ABILITY_USE')).toBe(false);
    }

    const duplicate = setup(config, { handData: [member('member-8', 'member-8', 8)] });
    expect(activate(duplicate, config).success).toBe(true);
    expect(pay(duplicate, ['hand-0', 'hand-0']).success).toBe(false);
    expect(duplicate.session.state?.players[0].waitingRoom.cardIds).toEqual([]);

    const stale = setup(config, { handData: [member('member-8', 'member-8', 8)] });
    expect(activate(stale, config).success).toBe(true);
    (stale.session as unknown as { authorityState: GameState }).authorityState = updatePlayer(
      stale.session.state!,
      P1,
      (player) => ({ ...player, hand: { ...player.hand, cardIds: [] } })
    );
    paySingle(stale, stale.hand[0]!.instanceId);
    expect(stale.session.state?.players[0].waitingRoom.cardIds).toEqual([]);

    const departed = setup(config, { handData: [member('member-8', 'member-8', 8)] });
    expect(activate(departed, config).success).toBe(true);
    (departed.session as unknown as { authorityState: GameState }).authorityState = updatePlayer(departed.session.state!, P1, (player) => ({ ...player, memberSlots: { ...player.memberSlots, slots: { ...player.memberSlots.slots, [SlotPosition.CENTER]: null } } }));
    paySingle(departed, departed.hand[0]!.instanceId);
    expect(departed.session.state?.players[0].waitingRoom.cardIds).toEqual([]);
  });

  it('不发动 closes the single-card payment window without discarding or consuming the turn use', () => {
    const context = setup(config, { handData: [member('member-8', 'member-8', 8)] });
    expect(activate(context, config).success).toBe(true);
    expect(paySingle(context, null).success).toBe(true);
    expect(context.session.state?.activeEffect).toBeNull();
    expect(context.session.state?.players[0].hand.cardIds).toEqual([
      context.hand[0]!.instanceId,
    ]);
    expect(context.session.state?.players[0].waitingRoom.cardIds).toEqual([]);
    expect(
      context.session.state?.actionHistory.some(
        (action) =>
          action.payload.abilityId === config.abilityId &&
          action.payload.step === 'ABILITY_USE'
      )
    ).toBe(false);
    expect(activate(context, config).success).toBe(true);
  });

  it('uses shared public confirmation and dynamically rejects a stale or newly illegal recovery target', () => {
    const context = setup(config, { handData: [member('discard-8', 'discard-8', 8)], waitingData: [member('lower-7', 'lower-7', 7)] });
    expect(activate(context, config).success).toBe(true);
    expect(paySingle(context, context.hand[0]!.instanceId).success).toBe(true);
    const targetId = context.waiting[0]!.instanceId;
    const effectId = context.session.state!.activeEffect!.id;
    expect(context.session.executeCommand(createConfirmEffectStepCommand(P1, effectId, targetId)).success).toBe(true);
    expect(context.session.state?.activeEffect).toMatchObject({ stepId: PUBLIC_CARD_SELECTION_CONFIRMATION_STEP_ID, revealedCardIds: [targetId], publicCardSelectionAutoAdvanceAt: 12_000 });
    expect(context.session.state?.players[0].waitingRoom.cardIds).toContain(targetId);
    const publicId = createPublicObjectId(targetId);
    expect(projectPlayerViewState(context.session.state!, P1, { now: 10_000 }).activeEffect?.revealedObjectIds).toEqual([publicId]);
    expect(projectPlayerViewState(context.session.state!, P2, { now: 10_000 }).activeEffect?.revealedObjectIds).toEqual([publicId]);
    (context.session as unknown as { authorityState: GameState }).authorityState = updatePlayer(context.session.state!, P1, (player) => ({ ...player, waitingRoom: { ...player.waitingRoom, cardIds: player.waitingRoom.cardIds.filter((id) => id !== targetId) }, mainDeck: { ...player.mainDeck, cardIds: [targetId, ...player.mainDeck.cardIds] } }));
    context.setNow(12_000);
    context.session.executeCommand(createAutoAdvancePublicCardSelectionCommand(P2, effectId, 12_000));
    expect(context.session.state?.players[0].hand.cardIds).not.toContain(targetId);
    expect(context.session.state?.players[0].mainDeck.cardIds).toContain(targetId);
  });
});
