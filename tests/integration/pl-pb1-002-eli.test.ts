import { describe, expect, it } from 'vitest';
import type { MemberCardData } from '../../src/domain/entities/card';
import {
  createCardInstance,
  createHeartIcon,
  type CardInstance,
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
import { createGameSession, type GameSession } from '../../src/application/game-session';
import { resolvePendingCardEffects } from '../../src/application/card-effect-runner';
import {
  PL_PB1_002_LIVE_START_WAIT_SELF_ONLY_BIBI_WAIT_OPPONENT_LOW_ORIGINAL_BLADE_ABILITY_ID,
  PL_PB1_002_ON_ENTER_WAIT_SELF_ONLY_BIBI_WAIT_OPPONENT_LOW_ORIGINAL_BLADE_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import { addLiveModifier } from '../../src/domain/rules/live-modifiers';
import {
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
} from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

interface StageMemberEntry {
  readonly card: CardInstance<MemberCardData>;
  readonly orientation: OrientationState;
  readonly slot: SlotPosition;
}

function member(
  cardCode: string,
  name: string,
  unitName: string,
  blade = 1
): MemberCardData {
  return {
    cardCode,
    name,
    groupNames: ["μ's"],
    unitName,
    cardType: CardType.MEMBER,
    cost: 4,
    blade,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function card(
  data: MemberCardData,
  instanceId: string,
  ownerId = PLAYER1
): CardInstance<MemberCardData> {
  return createCardInstance(data, ownerId, instanceId);
}

function pending(
  abilityId: string,
  sourceCardId: string,
  timingId: TriggerCondition,
  id = `pending:${abilityId}:${sourceCardId}`
): PendingAbilityState {
  return {
    id,
    abilityId,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId,
    eventIds: [`event:${id}`],
  };
}

function sessionWithState(game: GameState): GameSession {
  const session = createGameSession();
  session.createGame('pl-pb1-002-eli', PLAYER1, 'P1', PLAYER2, 'P2');
  (session as unknown as { authorityState: GameState }).authorityState = game;
  return session;
}

function confirmActiveEffect(
  session: GameSession,
  selectedCardId?: string | null
): GameState {
  const effectId = session.state!.activeEffect!.id;
  const result = session.executeCommand(
    createConfirmEffectStepCommand(PLAYER1, effectId, selectedCardId)
  );
  expect(result.success, result.error).toBe(true);
  return result.gameState;
}

function confirmActiveEffectOption(
  session: GameSession,
  selectedOptionId: string | null
): GameState {
  const effectId = session.state!.activeEffect!.id;
  const result = session.executeCommand(
    createConfirmEffectStepCommand(
      PLAYER1,
      effectId,
      undefined,
      undefined,
      undefined,
      selectedOptionId
    )
  );
  expect(result.success, result.error).toBe(true);
  return result.gameState;
}

function resolvePending(game: GameState): GameState {
  return resolvePendingCardEffects(game).gameState;
}

function sourceEli(orientation = OrientationState.ACTIVE): StageMemberEntry {
  return {
    card: card(member('PL!-pb1-002-R', '絢瀬絵里', 'BiBi', 3), 'eli-source'),
    orientation,
    slot: SlotPosition.CENTER,
  };
}

function opponentMember(id: string, blade: number, orientation = OrientationState.ACTIVE): StageMemberEntry {
  return {
    card: card(member(`PL!-test-opponent-${id}`, `opponent-${id}`, 'BiBi', blade), id, PLAYER2),
    orientation,
    slot: SlotPosition.CENTER,
  };
}

function setup002(options: {
  readonly abilityId?: string;
  readonly timingId?: TriggerCondition;
  readonly source?: StageMemberEntry;
  readonly ownMembers?: readonly StageMemberEntry[];
  readonly opponentMembers?: readonly StageMemberEntry[];
  readonly sourceOnStage?: boolean;
  readonly extraPending?: readonly PendingAbilityState[];
} = {}): {
  readonly game: GameState;
  readonly source: CardInstance<MemberCardData>;
  readonly opponentMembers: readonly StageMemberEntry[];
} {
  const source = options.source ?? sourceEli();
  const ownMembers = options.ownMembers ?? [source];
  const opponents = options.opponentMembers ?? [opponentMember('low-blade-target', 3)];
  const allCards = [
    source.card,
    ...ownMembers
      .filter((entry) => entry.card.instanceId !== source.card.instanceId)
      .map((entry) => entry.card),
    ...opponents.map((entry) => entry.card),
  ];
  let game = createGameState('pl-pb1-002-eli', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, allCards);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    memberSlots: ownMembers.reduce((slots, entry) => {
      if (entry.card.instanceId === source.card.instanceId && options.sourceOnStage === false) {
        return slots;
      }
      return placeCardInSlot(slots, entry.slot, entry.card.instanceId, {
        orientation: entry.orientation,
        face: FaceState.FACE_UP,
      });
    }, player.memberSlots),
  }));
  game = updatePlayer(game, PLAYER2, (player) => ({
    ...player,
    memberSlots: opponents.reduce(
      (slots, entry) =>
        placeCardInSlot(slots, entry.slot, entry.card.instanceId, {
          orientation: entry.orientation,
          face: FaceState.FACE_UP,
        }),
      player.memberSlots
    ),
  }));
  const abilityId =
    options.abilityId ??
    PL_PB1_002_ON_ENTER_WAIT_SELF_ONLY_BIBI_WAIT_OPPONENT_LOW_ORIGINAL_BLADE_ABILITY_ID;
  const timingId = options.timingId ?? TriggerCondition.ON_ENTER_STAGE;
  return {
    game: {
      ...game,
      pendingAbilities: [
        pending(abilityId, source.card.instanceId, timingId, 'pending-eli'),
        ...(options.extraPending ?? []),
      ],
    },
    source: source.card,
    opponentMembers: opponents,
  };
}

function actionPayload(game: GameState, step: string) {
  return [...game.actionHistory].reverse().find((action) => action.payload?.step === step)?.payload;
}

function actionTypePayload(game: GameState, type: string) {
  return [...game.actionHistory].reverse().find((action) => action.type === type)?.payload;
}

function choosePendingAbilityBySource(session: GameSession, sourceCardId: string): GameState {
  const effectId = session.state!.activeEffect!.id;
  const result = session.executeCommand(
    createConfirmEffectStepCommand(PLAYER1, effectId, sourceCardId)
  );
  expect(result.success, result.error).toBe(true);
  return result.gameState;
}

describe('PL!-pb1-002-R / PL!-pb1-002-P+ Eli workflows', () => {
  it('ON_ENTER waits source as PAY_COST, enqueues member-state triggers, then waits an opponent printed [BLADE]<=3 member', () => {
    const { game, source, opponentMembers } = setup002();
    const started = resolvePending(game);
    expect(started.activeEffect?.metadata?.confirmOnlyPendingAbility).not.toBe(true);
    expect(started.activeEffect).toMatchObject({
      abilityId: PL_PB1_002_ON_ENTER_WAIT_SELF_ONLY_BIBI_WAIT_OPPONENT_LOW_ORIGINAL_BLADE_ABILITY_ID,
      stepText: '可以发动此效果，将此成员变为待机状态。支付后会重新检查自己舞台是否只有『BiBi』成员。',
      selectableOptions: [{ id: 'WAIT_SOURCE', label: '发动' }],
      skipSelectionLabel: '不发动',
    });
    expect(started.activeEffect?.selectableCardIds).toBeUndefined();
    expect(started.activeEffect?.effectText).toContain('当前自己舞台成员 1名');
    expect(started.activeEffect?.effectText).toContain('均为BiBi');

    const afterCost = confirmActiveEffectOption(sessionWithState(started), 'WAIT_SOURCE');
    expect(afterCost.players[0].memberSlots.cardStates.get(source.instanceId)?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(actionPayload(afterCost, 'START_SELECT_OPPONENT_LOW_ORIGINAL_BLADE_MEMBER')).toBeTruthy();
    expect(actionTypePayload(afterCost, 'PAY_COST')).toMatchObject({
      paidCostCardId: source.instanceId,
      previousOrientation: OrientationState.ACTIVE,
      nextOrientation: OrientationState.WAITING,
    });
    expect(
      afterCost.eventLog.some(
        (entry) =>
          entry.event.eventType === TriggerCondition.ON_MEMBER_STATE_CHANGED &&
          entry.event.cardInstanceId === source.instanceId
      )
    ).toBe(true);
    expect(afterCost.activeEffect).toMatchObject({
      stepText:
        '请选择对方舞台上1名原本[BLADE]小于等于3，且当前非待机状态的成员变为待机状态。',
      selectionLabel: '选择对方舞台上原本[BLADE]小于等于3的成员',
    });

    const target = opponentMembers[0]!.card.instanceId;
    const resolved = confirmActiveEffect(sessionWithState(afterCost), target);
    expect(resolved.players[1].memberSlots.cardStates.get(target)?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(
      resolved.eventLog.some(
        (entry) =>
          entry.event.eventType === TriggerCondition.ON_MEMBER_STATE_CHANGED &&
          entry.event.cardInstanceId === target
      )
    ).toBe(true);
    expect(resolved.pendingAbilities).toEqual([]);
    expect(resolved.activeEffect).toBeNull();
  });

  it('LIVE_START follows the same flow and continues later pending abilities', () => {
    const extraPending = pending(
      PL_PB1_002_LIVE_START_WAIT_SELF_ONLY_BIBI_WAIT_OPPONENT_LOW_ORIGINAL_BLADE_ABILITY_ID,
      'missing-source',
      TriggerCondition.ON_LIVE_START,
      'pending-missing-source'
    );
    const { game, source, opponentMembers } = setup002({
      abilityId: PL_PB1_002_LIVE_START_WAIT_SELF_ONLY_BIBI_WAIT_OPPONENT_LOW_ORIGINAL_BLADE_ABILITY_ID,
      timingId: TriggerCondition.ON_LIVE_START,
      extraPending: [extraPending],
    });
    const orderSelection = resolvePending(game);
    expect(orderSelection.activeEffect?.abilityId).toBe('system:select-pending-card-effect');
    const started = choosePendingAbilityBySource(sessionWithState(orderSelection), source.instanceId);
    expect(started.activeEffect?.abilityId).toBe(
      PL_PB1_002_LIVE_START_WAIT_SELF_ONLY_BIBI_WAIT_OPPONENT_LOW_ORIGINAL_BLADE_ABILITY_ID
    );

    const afterCost = confirmActiveEffectOption(sessionWithState(started), 'WAIT_SOURCE');
    const resolved = confirmActiveEffect(sessionWithState(afterCost), opponentMembers[0]!.card.instanceId);

    expect(resolved.pendingAbilities).toEqual([]);
    expect(actionPayload(resolved, 'SOURCE_NOT_ON_STAGE')).toMatchObject({
      pendingAbilityId: 'pending-missing-source',
      sourceCardId: 'missing-source',
    });
  });

  it('skip consumes pending without paying cost or changing the opponent', () => {
    const { game, source, opponentMembers } = setup002();
    const started = resolvePending(game);
    const skipped = confirmActiveEffect(sessionWithState(started), null);

    expect(skipped.players[0].memberSlots.cardStates.get(source.instanceId)?.orientation).toBe(
      OrientationState.ACTIVE
    );
    expect(
      skipped.players[1].memberSlots.cardStates.get(opponentMembers[0]!.card.instanceId)?.orientation
    ).toBe(OrientationState.ACTIVE);
    expect(actionPayload(skipped, 'PAY_COST')).toBeUndefined();
    expect(skipped.pendingAbilities).toEqual([]);
  });

  it('safely consumes when source is already WAITING or has left the stage', () => {
    const alreadyWaiting = resolvePending(
      setup002({ source: sourceEli(OrientationState.WAITING) }).game
    );
    expect(alreadyWaiting.activeEffect).toBeNull();
    expect(actionPayload(alreadyWaiting, 'SOURCE_ALREADY_WAITING')).toBeTruthy();

    const sourceLeft = resolvePending(setup002({ sourceOnStage: false }).game);
    expect(sourceLeft.activeEffect).toBeNull();
    expect(actionPayload(sourceLeft, 'SOURCE_NOT_ON_STAGE')).toBeTruthy();
  });

  it('keeps paid cost when the post-cost only-BiBi condition fails', () => {
    const source = sourceEli();
    const nonBiBi = {
      card: card(member('PL!-test-non-bibi', 'non-bibi', 'Printemps'), 'non-bibi'),
      orientation: OrientationState.ACTIVE,
      slot: SlotPosition.LEFT,
    };
    const { game } = setup002({ source, ownMembers: [source, nonBiBi] });
    const started = resolvePending(game);
    const resolved = confirmActiveEffectOption(sessionWithState(started), 'WAIT_SOURCE');

    expect(resolved.players[0].memberSlots.cardStates.get(source.card.instanceId)?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(actionPayload(resolved, 'PAY_COST_CONDITION_NOT_MET')).toMatchObject({
      ownStageOnlyBiBi: false,
    });
    expect(resolved.activeEffect).toBeNull();
    expect(resolved.pendingAbilities).toEqual([]);
  });

  it('keeps paid cost and resolves when no opponent target has original [BLADE]<=3 and non-WAITING', () => {
    const source = sourceEli();
    const highBlade = opponentMember('high-blade', 4);
    const alreadyWaiting = opponentMember('already-waiting', 3, OrientationState.WAITING);
    const { game } = setup002({
      source,
      opponentMembers: [
        { ...highBlade, slot: SlotPosition.LEFT },
        { ...alreadyWaiting, slot: SlotPosition.RIGHT },
      ],
    });
    const started = resolvePending(game);
    const resolved = confirmActiveEffectOption(sessionWithState(started), 'WAIT_SOURCE');

    expect(resolved.players[0].memberSlots.cardStates.get(source.card.instanceId)?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(actionPayload(resolved, 'PAY_COST_NO_OPPONENT_TARGET')).toMatchObject({
      opponentTargetCount: 0,
    });
    expect(resolved.activeEffect).toBeNull();
    expect(resolved.players[1].memberSlots.cardStates.get(highBlade.card.instanceId)?.orientation).toBe(
      OrientationState.ACTIVE
    );
  });

  it('uses printed [BLADE] for opponent target filtering, ignoring effective [BLADE] modifiers', () => {
    const source = sourceEli();
    const lowPrinted = opponentMember('low-printed', 2);
    const highPrinted = opponentMember('high-printed', 4);
    let game = setup002({
      source,
      opponentMembers: [
        { ...lowPrinted, slot: SlotPosition.LEFT },
        { ...highPrinted, slot: SlotPosition.RIGHT },
      ],
    }).game;
    game = addLiveModifier(game, {
      kind: 'BLADE',
      playerId: PLAYER2,
      countDelta: 5,
      sourceCardId: lowPrinted.card.instanceId,
      abilityId: 'test:effective-blade-boost',
    });

    const afterCost = confirmActiveEffectOption(sessionWithState(resolvePending(game)), 'WAIT_SOURCE');
    expect(afterCost.activeEffect?.selectableCardIds).toEqual([lowPrinted.card.instanceId]);
    expect(afterCost.activeEffect?.selectableCardIds).not.toContain(highPrinted.card.instanceId);
  });
});
