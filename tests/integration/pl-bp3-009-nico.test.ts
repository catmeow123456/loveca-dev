import { describe, expect, it } from 'vitest';
import type { MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { placeCardInSlot, removeCardFromSlot } from '../../src/domain/entities/zone';
import {
  activateCardAbility,
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  PL_BP3_009_ACTIVATED_WAIT_SELF_CHOOSE_HEART_ABILITY_ID,
  PL_BP3_009_ON_ENTER_COST_THIRTEEN_DRAW_ONE_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import {
  CardType,
  FaceState,
  GamePhase,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
} from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function member(cardCode: string, cost: number, name = cardCode): MemberCardData {
  return {
    cardCode,
    name,
    groupNames: ["\u03bc's"],
    cardType: CardType.MEMBER,
    cost,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PURPLE, 1)],
  };
}

function pending(sourceCardId: string, id = 'nico-on-enter'): PendingAbilityState {
  return {
    id,
    abilityId: PL_BP3_009_ON_ENTER_COST_THIRTEEN_DRAW_ONE_ABILITY_ID,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId: TriggerCondition.ON_ENTER_STAGE,
    eventIds: [`event-${id}`],
    sourceSlot: SlotPosition.CENTER,
  };
}

function setup(
  options: {
    readonly rarity?: 'R＋' | 'P' | 'P＋' | 'SEC';
    readonly qualifierCost?: number;
    readonly qualifierModifier?: number;
    readonly sourceOnStage?: boolean;
    readonly sourceOrientation?: OrientationState;
    readonly deckCount?: number;
    readonly pendingCount?: number;
  } = {}
) {
  const source = createCardInstance(
    member(`PL!-bp3-009-${options.rarity ?? 'P'}`, 2, '矢澤にこ'),
    PLAYER1,
    'nico-source'
  );
  const qualifier = createCardInstance(
    member('TEST-QUALIFIER', options.qualifierCost ?? 13, '费用条件成员'),
    PLAYER1,
    'qualifier'
  );
  const deckCards = Array.from({ length: options.deckCount ?? 2 }, (_, index) =>
    createCardInstance(member(`TEST-DECK-${index}`, 1), PLAYER1, `deck-${index}`)
  );
  let game = registerCards(createGameState('pl-bp3-009-nico', PLAYER1, 'P1', PLAYER2, 'P2'), [
    source,
    qualifier,
    ...deckCards,
  ]);
  game = updatePlayer(game, PLAYER1, (player) => {
    let memberSlots = placeCardInSlot(player.memberSlots, SlotPosition.LEFT, qualifier.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    });
    if (options.sourceOnStage !== false) {
      memberSlots = placeCardInSlot(memberSlots, SlotPosition.CENTER, source.instanceId, {
        orientation: options.sourceOrientation ?? OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      });
    }
    return {
      ...player,
      memberSlots,
      mainDeck: { ...player.mainDeck, cardIds: deckCards.map((card) => card.instanceId) },
      waitingRoom:
        options.sourceOnStage === false
          ? { ...player.waitingRoom, cardIds: [source.instanceId] }
          : player.waitingRoom,
    };
  });
  game = {
    ...game,
    currentPhase: GamePhase.MAIN_PHASE,
    pendingAbilities: Array.from({ length: options.pendingCount ?? 1 }, (_, index) =>
      pending(source.instanceId, `nico-on-enter-${index + 1}`)
    ),
    liveResolution: {
      ...game.liveResolution,
      liveModifiers:
        options.qualifierModifier === undefined
          ? []
          : [
              {
                kind: 'MEMBER_COST' as const,
                playerId: PLAYER1,
                memberCardId: qualifier.instanceId,
                countDelta: options.qualifierModifier,
                sourceCardId: 'cost-modifier-source',
                abilityId: 'TEST_COST_MODIFIER',
              },
            ],
    },
  };
  return { game, source, qualifier, deckCards };
}

function chooseOption(game: GameState, optionId: string): GameState {
  const publicChoice = confirmActiveEffectStep(
    game,
    PLAYER1,
    game.activeEffect!.id,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    [optionId]
  );
  return publicChoice === game
    ? game
    : confirmActiveEffectStep(publicChoice, PLAYER1, publicChoice.activeEffect!.id);
}

describe('PL!-bp3-009 矢澤にこ workflow', () => {
  it('uses current effective cost at the 12/13 boundary and draws only when qualified', () => {
    const printedTwelve = setup({ qualifierCost: 12 });
    const noDraw = resolvePendingCardEffects(printedTwelve.game).gameState;
    expect(noDraw.players[0].hand.cardIds).toEqual([]);

    const raised = setup({ qualifierCost: 12, qualifierModifier: 1 });
    const raisedResolved = resolvePendingCardEffects(raised.game).gameState;
    expect(raisedResolved.players[0].hand.cardIds).toEqual([raised.deckCards[0]!.instanceId]);

    const lowered = setup({ qualifierCost: 14, qualifierModifier: -2 });
    const loweredResolved = resolvePendingCardEffects(lowered.game).gameState;
    expect(loweredResolved.players[0].hand.cardIds).toEqual([]);
  });

  it('resolves from the current own main stage after the source has left', () => {
    const scenario = setup({ sourceOnStage: false, qualifierCost: 13 });
    const resolved = resolvePendingCardEffects(scenario.game).gameState;
    expect(resolved.players[0].waitingRoom.cardIds).toContain(scenario.source.instanceId);
    expect(resolved.players[0].hand.cardIds).toEqual([scenario.deckCards[0]!.instanceId]);
  });

  it('does not count memberBelow or the opponent stage toward the cost condition', () => {
    const scenario = setup({ qualifierCost: 12 });
    const below = createCardInstance(member('TEST-BELOW', 20), PLAYER1, 'below-member');
    const opponent = createCardInstance(member('TEST-OPPONENT', 20), PLAYER2, 'opponent-member');
    let game = registerCards(scenario.game, [below, opponent]);
    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      memberSlots: {
        ...player.memberSlots,
        memberBelow: {
          ...player.memberSlots.memberBelow,
          [SlotPosition.CENTER]: [below.instanceId],
        },
      },
    }));
    game = updatePlayer(game, PLAYER2, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, opponent.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
    }));
    expect(resolvePendingCardEffects(game).gameState.players[0].hand.cardIds).toEqual([]);
  });

  it('follows the shared draw helper for refresh and an actually empty deck', () => {
    const empty = setup({ qualifierCost: 13, deckCount: 0, pendingCount: 2 });
    const emptyOrder = resolvePendingCardEffects(empty.game).gameState;
    const emptyConfirmation = confirmActiveEffectStep(
      emptyOrder,
      PLAYER1,
      emptyOrder.activeEffect!.id,
      undefined,
      undefined,
      false,
      'nico-on-enter-2'
    );
    expect(emptyConfirmation.activeEffect?.effectText).toContain(
      '满足条件，但当前没有可抽的卡，实际抽0张卡'
    );
    const emptyResolved = confirmActiveEffectStep(
      emptyConfirmation,
      PLAYER1,
      emptyConfirmation.activeEffect!.id
    );
    expect(emptyResolved.players[0].hand.cardIds).toEqual([]);
    expect(emptyResolved.pendingAbilities).toEqual([]);

    const refresh = setup({ qualifierCost: 13, deckCount: 0, pendingCount: 2 });
    const refreshCard = createCardInstance(member('TEST-REFRESH', 1), PLAYER1, 'refresh-card');
    let refreshGame = registerCards(refresh.game, [refreshCard]);
    refreshGame = updatePlayer(refreshGame, PLAYER1, (player) => ({
      ...player,
      waitingRoom: { ...player.waitingRoom, cardIds: [refreshCard.instanceId] },
    }));
    const refreshOrder = resolvePendingCardEffects(refreshGame).gameState;
    const refreshConfirmation = confirmActiveEffectStep(
      refreshOrder,
      PLAYER1,
      refreshOrder.activeEffect!.id,
      undefined,
      undefined,
      false,
      'nico-on-enter-2'
    );
    expect(refreshConfirmation.activeEffect?.effectText).toContain('满足条件，实际抽1张卡');
    const refreshResolved = confirmActiveEffectStep(
      refreshConfirmation,
      PLAYER1,
      refreshConfirmation.activeEffect!.id
    );
    expect(refreshResolved.players[0].hand.cardIds).toEqual([refreshCard.instanceId]);
    expect(
      refreshResolved.actionHistory.some(
        (action) => action.type === 'RULE_ACTION' && action.payload.type === 'REFRESH'
      )
    ).toBe(true);
  });

  it('manual selection opens dynamic confirm-only and rechecks condition at confirmation', () => {
    const scenario = setup({ qualifierCost: 12, pendingCount: 2 });
    const order = resolvePendingCardEffects(scenario.game).gameState;
    let confirmation = confirmActiveEffectStep(
      order,
      PLAYER1,
      order.activeEffect!.id,
      undefined,
      undefined,
      false,
      'nico-on-enter-2'
    );
    expect(confirmation.activeEffect?.metadata?.confirmOnlyPendingAbility).toBe(true);
    expect(confirmation.activeEffect?.effectText).toContain('当前自己舞台费用大于等于13的成员 0名');
    expect(confirmation.players[0].hand.cardIds).toEqual([]);

    confirmation = {
      ...confirmation,
      liveResolution: {
        ...confirmation.liveResolution,
        liveModifiers: [
          {
            kind: 'MEMBER_COST',
            playerId: PLAYER1,
            memberCardId: scenario.qualifier.instanceId,
            countDelta: 1,
            sourceCardId: 'runtime-cost-source',
            abilityId: 'RUNTIME_COST',
          },
        ],
      },
    };
    const resolved = confirmActiveEffectStep(confirmation, PLAYER1, confirmation.activeEffect!.id);
    expect(resolved.players[0].hand.cardIds).toEqual([
      scenario.deckCards[0]!.instanceId,
      scenario.deckCards[1]!.instanceId,
    ]);
    expect(resolved.pendingAbilities).toEqual([]);

    const downward = setup({ qualifierCost: 13, pendingCount: 2 });
    const downwardOrder = resolvePendingCardEffects(downward.game).gameState;
    let downwardConfirmation = confirmActiveEffectStep(
      downwardOrder,
      PLAYER1,
      downwardOrder.activeEffect!.id,
      undefined,
      undefined,
      false,
      'nico-on-enter-2'
    );
    expect(downwardConfirmation.activeEffect?.effectText).toContain('满足条件，实际抽1张卡');
    downwardConfirmation = {
      ...downwardConfirmation,
      liveResolution: {
        ...downwardConfirmation.liveResolution,
        liveModifiers: [
          {
            kind: 'MEMBER_COST',
            playerId: PLAYER1,
            memberCardId: downward.qualifier.instanceId,
            countDelta: -1,
            sourceCardId: 'runtime-cost-source',
            abilityId: 'RUNTIME_COST',
          },
        ],
      },
    };
    const downwardResolved = confirmActiveEffectStep(
      downwardConfirmation,
      PLAYER1,
      downwardConfirmation.activeEffect!.id
    );
    expect(downwardResolved.players[0].hand.cardIds).toEqual([]);
  });

  it('pays ACTIVE to WAITING once, opens a mandatory three-color choice, and writes SOURCE_MEMBER Heart', () => {
    const scenario = setup();
    const withoutPending = { ...scenario.game, pendingAbilities: [] };
    const started = activateCardAbility(
      withoutPending,
      PLAYER1,
      scenario.source.instanceId,
      PL_BP3_009_ACTIVATED_WAIT_SELF_CHOOSE_HEART_ABILITY_ID
    );
    expect(
      started.players[0].memberSlots.cardStates.get(scenario.source.instanceId)?.orientation
    ).toBe(OrientationState.WAITING);
    expect(started.activeEffect?.canSkipSelection).toBe(false);
    expect(started.activeEffect?.effectChoice).toMatchObject({
      mode: 'SINGLE',
      minSelections: 1,
      maxSelections: 1,
      publicConfirmation: true,
      options: [
        { id: 'PINK', text: '此成员获得[桃ハート]。' },
        { id: 'YELLOW', text: '此成员获得[黄ハート]。' },
        { id: 'PURPLE', text: '此成员获得[紫ハート]。' },
      ],
    });
    expect(
      started.eventLog.filter(
        (entry) =>
          entry.event.eventType === TriggerCondition.ON_MEMBER_STATE_CHANGED &&
          entry.event.cardInstanceId === scenario.source.instanceId
      )
    ).toHaveLength(1);

    const resolved = chooseOption(started, 'PINK');
    expect(resolved.activeEffect).toBeNull();
    expect(resolved.liveResolution.liveModifiers.at(-1)).toMatchObject({
      kind: 'HEART',
      playerId: PLAYER1,
      sourceCardId: scenario.source.instanceId,
      abilityId: PL_BP3_009_ACTIVATED_WAIT_SELF_CHOOSE_HEART_ABILITY_ID,
      target: 'SOURCE_MEMBER',
      hearts: [{ color: HeartColor.PINK, count: 1 }],
    });
  });

  it.each([
    ['PINK', HeartColor.PINK],
    ['YELLOW', HeartColor.YELLOW],
    ['PURPLE', HeartColor.PURPLE],
  ] as const)('supports the %s Heart choice', (optionId, color) => {
    const scenario = setup();
    const started = activateCardAbility(
      { ...scenario.game, pendingAbilities: [] },
      PLAYER1,
      scenario.source.instanceId,
      PL_BP3_009_ACTIVATED_WAIT_SELF_CHOOSE_HEART_ABILITY_ID
    );
    expect(chooseOption(started, optionId).liveResolution.liveModifiers.at(-1)).toMatchObject({
      target: 'SOURCE_MEMBER',
      hearts: [{ color, count: 1 }],
    });
  });

  it('still grants the selected Heart if the paid source becomes ACTIVE again before color resolution', () => {
    const scenario = setup();
    const started = activateCardAbility(
      { ...scenario.game, pendingAbilities: [] },
      PLAYER1,
      scenario.source.instanceId,
      PL_BP3_009_ACTIVATED_WAIT_SELF_CHOOSE_HEART_ABILITY_ID
    );
    const reactivated = updatePlayer(started, PLAYER1, (player) => ({
      ...player,
      memberSlots: {
        ...player.memberSlots,
        cardStates: new Map(player.memberSlots.cardStates).set(scenario.source.instanceId, {
          ...player.memberSlots.cardStates.get(scenario.source.instanceId)!,
          orientation: OrientationState.ACTIVE,
        }),
      },
    }));

    const resolved = chooseOption(reactivated, 'YELLOW');
    expect(resolved.activeEffect).toBeNull();
    expect(resolved.liveResolution.liveModifiers.at(-1)).toMatchObject({
      kind: 'HEART',
      playerId: PLAYER1,
      sourceCardId: scenario.source.instanceId,
      abilityId: PL_BP3_009_ACTIVATED_WAIT_SELF_CHOOSE_HEART_ABILITY_ID,
      target: 'SOURCE_MEMBER',
      hearts: [{ color: HeartColor.YELLOW, count: 1 }],
    });
  });

  it('rejects illegal activation states and does not consume a use when the cost cannot be paid', () => {
    const waiting = setup({ sourceOrientation: OrientationState.WAITING });
    const game = { ...waiting.game, pendingAbilities: [] };
    expect(
      activateCardAbility(
        game,
        PLAYER1,
        waiting.source.instanceId,
        PL_BP3_009_ACTIVATED_WAIT_SELF_CHOOSE_HEART_ABILITY_ID
      )
    ).toBe(game);
    expect(game.actionHistory.some((action) => action.payload.step === 'ABILITY_USE')).toBe(false);

    const notMain = { ...game, currentPhase: GamePhase.LIVE_PHASE };
    expect(
      activateCardAbility(
        notMain,
        PLAYER1,
        waiting.source.instanceId,
        PL_BP3_009_ACTIVATED_WAIT_SELF_CHOOSE_HEART_ABILITY_ID
      )
    ).toBe(notMain);

    const activeSource = setup();
    const notCurrentPlayer = {
      ...activeSource.game,
      pendingAbilities: [],
      activePlayerIndex: 1,
    };
    expect(
      activateCardAbility(
        notCurrentPlayer,
        PLAYER1,
        activeSource.source.instanceId,
        PL_BP3_009_ACTIVATED_WAIT_SELF_CHOOSE_HEART_ABILITY_ID
      )
    ).toBe(notCurrentPlayer);
  });

  it('rejects an illegal color, safely closes stale source selection, and enforces turn once', () => {
    const scenario = setup();
    const base = { ...scenario.game, pendingAbilities: [] };
    const started = activateCardAbility(
      base,
      PLAYER1,
      scenario.source.instanceId,
      PL_BP3_009_ACTIVATED_WAIT_SELF_CHOOSE_HEART_ABILITY_ID
    );
    expect(chooseOption(started, 'BLUE')).toBe(started);

    const stale = updatePlayer(started, PLAYER1, (player) => ({
      ...player,
      memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.CENTER),
      waitingRoom: { ...player.waitingRoom, cardIds: [scenario.source.instanceId] },
    }));
    const staleResolved = chooseOption(stale, 'PURPLE');
    expect(staleResolved.activeEffect).toBeNull();
    expect(staleResolved.liveResolution.liveModifiers).toEqual([]);

    const fresh = setup();
    let resolved = chooseOption(
      activateCardAbility(
        { ...fresh.game, pendingAbilities: [] },
        PLAYER1,
        fresh.source.instanceId,
        PL_BP3_009_ACTIVATED_WAIT_SELF_CHOOSE_HEART_ABILITY_ID
      ),
      'YELLOW'
    );
    resolved = updatePlayer(resolved, PLAYER1, (player) => ({
      ...player,
      memberSlots: {
        ...player.memberSlots,
        cardStates: new Map(player.memberSlots.cardStates).set(fresh.source.instanceId, {
          ...player.memberSlots.cardStates.get(fresh.source.instanceId)!,
          orientation: OrientationState.ACTIVE,
        }),
      },
    }));
    const repeat = activateCardAbility(
      resolved,
      PLAYER1,
      fresh.source.instanceId,
      PL_BP3_009_ACTIVATED_WAIT_SELF_CHOOSE_HEART_ABILITY_ID
    );
    expect(repeat).toBe(resolved);

    const nextTurn = { ...resolved, turnCount: resolved.turnCount + 1 };
    expect(
      activateCardAbility(
        nextTurn,
        PLAYER1,
        fresh.source.instanceId,
        PL_BP3_009_ACTIVATED_WAIT_SELF_CHOOSE_HEART_ABILITY_ID
      ).activeEffect?.abilityId
    ).toBe(PL_BP3_009_ACTIVATED_WAIT_SELF_CHOOSE_HEART_ABILITY_ID);
  });
});
