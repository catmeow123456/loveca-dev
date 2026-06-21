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
import { addCardToStatefulZone, placeCardInSlot } from '../../src/domain/entities/zone';
import { createConfirmEffectStepCommand } from '../../src/application/game-commands';
import { GameService } from '../../src/application/game-service';
import { createGameSession } from '../../src/application/game-session';
import {
  SP_BP1_024_LIVE_START_KANON_KEKE_GAIN_HEART_BLADE_ABILITY_ID,
  SP_BP1_024_LIVE_SUCCESS_STAGE_KANON_KEKE_DRAW_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import {
  CardType,
  FaceState,
  GamePhase,
  HeartColor,
  OrientationState,
  SlotPosition,
  SubPhase,
  TriggerCondition,
} from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function createTinyStars(): LiveCardData {
  return {
    cardCode: 'PL!SP-bp1-024-L',
    name: 'Tiny Stars',
    groupName: 'Liella!',
    cardType: CardType.LIVE,
    score: 2,
    requirements: createHeartRequirement({
      [HeartColor.PINK]: 1,
      [HeartColor.BLUE]: 1,
    }),
  };
}

function createVitaminSummerLive(): LiveCardData {
  return {
    cardCode: 'PL!SP-bp2-024-SECL',
    name: 'ビタミンSUMMER!',
    groupName: 'Liella!',
    cardType: CardType.LIVE,
    score: 5,
    requirements: createHeartRequirement({
      [HeartColor.YELLOW]: 1,
    }),
  };
}

function createMember(cardCode: string, name: string): MemberCardData {
  return {
    cardCode,
    name,
    groupName: 'Liella!',
    unitName: 'Liella!',
    cardType: CardType.MEMBER,
    cost: 4,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.RED, 1)],
  };
}

interface TinyStarsState {
  readonly game: GameState;
  readonly live: ReturnType<typeof createCardInstance>;
  readonly memberIds: Readonly<Record<string, string>>;
  readonly drawCardId: string;
}

function setupTinyStarsState(
  members: readonly {
    readonly key: string;
    readonly slot: SlotPosition;
    readonly name: string;
    readonly cardCode: string;
  }[],
  options: {
    readonly includeExtraLiveSuccess?: boolean;
  } = {}
): TinyStarsState {
  const live = createCardInstance(createTinyStars(), PLAYER1, 'tiny-stars-live');
  const extraLive = options.includeExtraLiveSuccess
    ? createCardInstance(createVitaminSummerLive(), PLAYER1, 'vitamin-summer-live')
    : null;
  const drawCard = createCardInstance(
    createMember('PL!SP-test-draw', 'Draw Card'),
    PLAYER1,
    'p1-draw-card'
  );
  const memberCards = members.map((member) =>
    createCardInstance(createMember(member.cardCode, member.name), PLAYER1, member.key)
  );

  let game = createGameState('sp-bp1-024-tiny-stars', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [live, ...(extraLive ? [extraLive] : []), drawCard, ...memberCards]);
  game = updatePlayer(game, PLAYER1, (player) => {
    let memberSlots = player.memberSlots;
    for (const member of members) {
      memberSlots = placeCardInSlot(memberSlots, member.slot, member.key, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      });
    }
    return {
      ...player,
      liveZone: extraLive
        ? addCardToStatefulZone(
            addCardToStatefulZone(player.liveZone, live.instanceId),
            extraLive.instanceId
          )
        : addCardToStatefulZone(player.liveZone, live.instanceId),
      mainDeck: {
        ...player.mainDeck,
        cardIds: [drawCard.instanceId],
      },
      memberSlots,
    };
  });
  game = {
    ...game,
    liveResolution: {
      ...game.liveResolution,
      performingPlayerId: PLAYER1,
      liveResults: new Map([
        [live.instanceId, true],
        ...(extraLive ? ([[extraLive.instanceId, true]] as const) : []),
      ]),
      playerScores: new Map([[PLAYER1, 2]]),
    },
  };

  return {
    game,
    live,
    drawCardId: drawCard.instanceId,
    memberIds: Object.fromEntries(members.map((member) => [member.key, member.key])),
  };
}

function resolveLiveStart(game: GameState): GameState {
  const result = new GameService().executeCheckTiming(game, [TriggerCondition.ON_LIVE_START]);
  expect(result.success).toBe(true);
  return result.gameState;
}

function resolveLiveSuccess(game: GameState): GameState {
  const liveSuccessState = {
    ...game,
    currentPhase: GamePhase.LIVE_RESULT_PHASE,
    currentSubPhase: SubPhase.RESULT_FIRST_SUCCESS_EFFECTS,
    activePlayerIndex: 0,
  };
  const result = new GameService().executeCheckTiming(liveSuccessState, [
    TriggerCondition.ON_LIVE_SUCCESS,
  ]);
  expect(result.success).toBe(true);
  return result.gameState;
}

function confirmActiveEffect(game: GameState, selectedCardId: string): GameState {
  const session = createGameSession();
  session.createGame('sp-bp1-024-tiny-stars-session', PLAYER1, 'P1', PLAYER2, 'P2');
  (session as unknown as { authorityState: GameState }).authorityState = game;
  const result = session.executeCommand(
    createConfirmEffectStepCommand(PLAYER1, game.activeEffect!.id, selectedCardId)
  );
  expect(result.success).toBe(true);
  return session.state!;
}

function confirmActiveEffectWithoutSelection(game: GameState): GameState {
  const session = createGameSession();
  session.createGame('sp-bp1-024-tiny-stars-session', PLAYER1, 'P1', PLAYER2, 'P2');
  (session as unknown as { authorityState: GameState }).authorityState = game;
  const result = session.executeCommand(
    createConfirmEffectStepCommand(PLAYER1, game.activeEffect!.id)
  );
  expect(result.success).toBe(true);
  return session.state!;
}

function heartModifierFor(state: GameState, targetMemberCardId: string) {
  return state.liveResolution.liveModifiers.find(
    (modifier) =>
      modifier.kind === 'HEART' &&
      modifier.abilityId === SP_BP1_024_LIVE_START_KANON_KEKE_GAIN_HEART_BLADE_ABILITY_ID &&
      modifier.target === 'TARGET_MEMBER' &&
      modifier.targetMemberCardId === targetMemberCardId
  );
}

function bladeModifierFor(state: GameState, targetMemberCardId: string) {
  return state.liveResolution.liveModifiers.find(
    (modifier) =>
      modifier.kind === 'BLADE' &&
      modifier.abilityId === SP_BP1_024_LIVE_START_KANON_KEKE_GAIN_HEART_BLADE_ABILITY_ID &&
      modifier.sourceCardId === targetMemberCardId
  );
}

describe('PL!SP-bp1-024 Tiny Stars workflow', () => {
  it('auto-resolves one Kanon and one Keke on live start', () => {
    const { game, live } = setupTinyStarsState([
      {
        key: 'kanon',
        slot: SlotPosition.LEFT,
        name: '澁谷かのん',
        cardCode: 'PL!SP-test-kanon',
      },
      {
        key: 'keke',
        slot: SlotPosition.CENTER,
        name: '唐 可可',
        cardCode: 'PL!SP-test-keke',
      },
    ]);

    const state = resolveLiveStart(game);

    expect(state.activeEffect).toBeNull();
    expect(heartModifierFor(state, 'kanon')).toMatchObject({
      hearts: [{ color: HeartColor.BLUE, count: 1 }],
      sourceCardId: live.instanceId,
    });
    expect(bladeModifierFor(state, 'kanon')).toMatchObject({ countDelta: 1 });
    expect(heartModifierFor(state, 'keke')).toMatchObject({
      hearts: [{ color: HeartColor.PINK, count: 1 }],
      sourceCardId: live.instanceId,
    });
    expect(bladeModifierFor(state, 'keke')).toMatchObject({ countDelta: 1 });
  });

  it('opens target selection for multiple same-name candidates and modifies only the selected member', () => {
    const { game } = setupTinyStarsState([
      {
        key: 'kanon-a',
        slot: SlotPosition.LEFT,
        name: '澁谷かのん',
        cardCode: 'PL!SP-test-kanon-a',
      },
      {
        key: 'kanon-b',
        slot: SlotPosition.CENTER,
        name: '涩谷香音',
        cardCode: 'PL!SP-test-kanon-b',
      },
      {
        key: 'keke',
        slot: SlotPosition.RIGHT,
        name: '唐可可',
        cardCode: 'PL!SP-test-keke',
      },
    ]);

    const choosingState = resolveLiveStart(game);
    expect(choosingState.activeEffect).toMatchObject({
      abilityId: SP_BP1_024_LIVE_START_KANON_KEKE_GAIN_HEART_BLADE_ABILITY_ID,
      selectableCardIds: ['kanon-a', 'kanon-b'],
      canSkipSelection: false,
    });

    const state = confirmActiveEffect(choosingState, 'kanon-b');

    expect(heartModifierFor(state, 'kanon-a')).toBeUndefined();
    expect(bladeModifierFor(state, 'kanon-a')).toBeUndefined();
    expect(heartModifierFor(state, 'kanon-b')).toMatchObject({
      hearts: [{ color: HeartColor.BLUE, count: 1 }],
    });
    expect(bladeModifierFor(state, 'kanon-b')).toMatchObject({ countDelta: 1 });
    expect(heartModifierFor(state, 'keke')).toMatchObject({
      hearts: [{ color: HeartColor.PINK, count: 1 }],
    });
  });

  it('resolves only the present side when the other named member is missing', () => {
    const { game } = setupTinyStarsState([
      {
        key: 'kanon',
        slot: SlotPosition.LEFT,
        name: '澁谷かのん',
        cardCode: 'PL!SP-test-kanon',
      },
    ]);

    const state = resolveLiveStart(game);

    expect(state.activeEffect).toBeNull();
    expect(heartModifierFor(state, 'kanon')).toMatchObject({
      hearts: [{ color: HeartColor.BLUE, count: 1 }],
    });
    expect(bladeModifierFor(state, 'kanon')).toMatchObject({ countDelta: 1 });
    expect(
      state.liveResolution.liveModifiers.some(
        (modifier) =>
          modifier.abilityId ===
            SP_BP1_024_LIVE_START_KANON_KEKE_GAIN_HEART_BLADE_ABILITY_ID &&
          modifier.kind === 'HEART' &&
          modifier.hearts.some((heart) => heart.color === HeartColor.PINK)
      )
    ).toBe(false);
  });

  it('draws one on live success when both Kanon and Keke are on stage', () => {
    const { game, drawCardId } = setupTinyStarsState([
      {
        key: 'kanon',
        slot: SlotPosition.LEFT,
        name: '澁谷かのん',
        cardCode: 'PL!SP-test-kanon',
      },
      {
        key: 'keke',
        slot: SlotPosition.CENTER,
        name: '唐 可可',
        cardCode: 'PL!SP-test-keke',
      },
    ]);

    const state = resolveLiveSuccess(game);

    expect(state.players[0].hand.cardIds).toContain(drawCardId);
    expect(
      state.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            SP_BP1_024_LIVE_SUCCESS_STAGE_KANON_KEKE_DRAW_ABILITY_ID &&
          action.payload.conditionMet === true &&
          Array.isArray(action.payload.drawnCardIds) &&
          action.payload.drawnCardIds.includes(drawCardId)
      )
    ).toBe(true);
  });

  it('does not draw on live success when either named member is missing', () => {
    const { game, drawCardId } = setupTinyStarsState([
      {
        key: 'kanon',
        slot: SlotPosition.LEFT,
        name: '澁谷かのん',
        cardCode: 'PL!SP-test-kanon',
      },
    ]);

    const state = resolveLiveSuccess(game);

    expect(state.players[0].hand.cardIds).not.toContain(drawCardId);
    expect(
      state.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            SP_BP1_024_LIVE_SUCCESS_STAGE_KANON_KEKE_DRAW_ABILITY_ID &&
          action.payload.conditionMet === false &&
          Array.isArray(action.payload.drawnCardIds) &&
          action.payload.drawnCardIds.length === 0
      )
    ).toBe(true);
  });

  it('shows a condition summary before drawing when manually chosen from a live-success queue', () => {
    const { game, live, drawCardId } = setupTinyStarsState(
      [
        {
          key: 'kanon',
          slot: SlotPosition.LEFT,
          name: '澁谷かのん',
          cardCode: 'PL!SP-test-kanon',
        },
        {
          key: 'keke',
          slot: SlotPosition.CENTER,
          name: '唐 可可',
          cardCode: 'PL!SP-test-keke',
        },
      ],
      { includeExtraLiveSuccess: true }
    );
    const choosingState = resolveLiveSuccess(game);

    expect(choosingState.activeEffect?.canResolveInOrder).toBe(true);
    expect(choosingState.activeEffect?.selectableCardIds).toContain(live.instanceId);

    const session = createGameSession();
    session.createGame('sp-bp1-024-tiny-stars-live-success-order', PLAYER1, 'P1', PLAYER2, 'P2');
    (session as unknown as { authorityState: GameState }).authorityState = choosingState;
    const selectResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, choosingState.activeEffect!.id, live.instanceId)
    );

    expect(selectResult.success).toBe(true);
    expect(session.state?.activeEffect).toMatchObject({
      abilityId: SP_BP1_024_LIVE_SUCCESS_STAGE_KANON_KEKE_DRAW_ABILITY_ID,
      sourceCardId: live.instanceId,
      stepId: 'CONFIRM_ONLY_EFFECT',
      stepText: '自己的舞台存在「澁谷かのん」与「唐 可可」，条件满足。确认后抽 1 张卡。',
    });

    const state = confirmActiveEffectWithoutSelection(session.state!);

    expect(state.players[0].hand.cardIds).toContain(drawCardId);
    expect(
      state.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            SP_BP1_024_LIVE_SUCCESS_STAGE_KANON_KEKE_DRAW_ABILITY_ID &&
          action.payload.sourceCardId === live.instanceId &&
          action.payload.conditionMet === true &&
          Array.isArray(action.payload.drawnCardIds) &&
          action.payload.drawnCardIds.includes(drawCardId)
      )
    ).toBe(true);
  });

  it('shows a failed condition summary before not drawing when manually chosen', () => {
    const { game, live, drawCardId } = setupTinyStarsState(
      [
        {
          key: 'kanon',
          slot: SlotPosition.LEFT,
          name: '澁谷かのん',
          cardCode: 'PL!SP-test-kanon',
        },
      ],
      { includeExtraLiveSuccess: true }
    );
    const choosingState = resolveLiveSuccess(game);

    const session = createGameSession();
    session.createGame(
      'sp-bp1-024-tiny-stars-live-success-order-false',
      PLAYER1,
      'P1',
      PLAYER2,
      'P2'
    );
    (session as unknown as { authorityState: GameState }).authorityState = choosingState;
    const selectResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, choosingState.activeEffect!.id, live.instanceId)
    );

    expect(selectResult.success).toBe(true);
    expect(session.state?.activeEffect?.stepText).toBe(
      '自己的舞台未同时存在「澁谷かのん」与「唐 可可」，条件不满足。确认后不抽牌。'
    );

    const state = confirmActiveEffectWithoutSelection(session.state!);

    expect(state.players[0].hand.cardIds).not.toContain(drawCardId);
    expect(
      state.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            SP_BP1_024_LIVE_SUCCESS_STAGE_KANON_KEKE_DRAW_ABILITY_ID &&
          action.payload.sourceCardId === live.instanceId &&
          action.payload.conditionMet === false &&
          Array.isArray(action.payload.drawnCardIds) &&
          action.payload.drawnCardIds.length === 0
      )
    ).toBe(true);
  });
});
