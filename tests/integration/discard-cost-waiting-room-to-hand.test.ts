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
  PL_PR_003_ACTIVATED_DISCARD_TWO_RECOVER_YELLOW_THREE_LIVE_ABILITY_ID,
  PL_PR_004_ACTIVATED_DISCARD_TWO_RECOVER_PINK_THREE_LIVE_ABILITY_ID,
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

function member(cardCode: string, name = cardCode): MemberCardData {
  return {
    cardCode,
    name,
    cardType: CardType.MEMBER,
    cost: 4,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.YELLOW, 3), createHeartIcon(HeartColor.PINK, 3)],
  };
}

function live(cardCode: string, requirements: Partial<Record<HeartColor, number>>): LiveCardData {
  return {
    cardCode,
    name: cardCode,
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
