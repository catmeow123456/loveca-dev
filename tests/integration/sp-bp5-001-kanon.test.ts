import { describe, expect, it } from 'vitest';
import type { EnergyCardData, MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import {
  createActivateAbilityCommand,
  createConfirmEffectStepCommand,
} from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import {
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { resolveActiveEffectStepWithRegistry } from '../../src/application/card-effects/runtime/step-registry';
import {
  SP_BP5_001_ACTIVATED_WAIT_SELF_OR_DISCARD_ACTIVATE_ENERGY_ABILITY_ID,
  SP_BP5_001_LIVE_START_PAY_ENERGY_WAIT_OPPONENT_OR_DRAW_ABILITY_ID,
  SP_BP5_001_ON_ENTER_PAY_ENERGY_WAIT_OPPONENT_OR_DRAW_ABILITY_ID,
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
  TurnType,
} from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function createMember(cardCode: string, options: Partial<MemberCardData> = {}): MemberCardData {
  return {
    cardCode,
    name: options.name ?? cardCode,
    groupNames: options.groupNames ?? ['Liella!'],
    unitName: options.unitName ?? 'CatChu!',
    cardType: CardType.MEMBER,
    cost: options.cost ?? 10,
    blade: options.blade ?? 2,
    hearts: options.hearts ?? [createHeartIcon(HeartColor.RED, 1)],
    ...options,
  };
}

function createEnergy(cardCode: string): EnergyCardData {
  return {
    cardCode,
    name: cardCode,
    cardType: CardType.ENERGY,
  };
}

function createBaseCards() {
  const source = createCardInstance(
    createMember('PL!SP-bp5-001-R＋', { name: '澁谷かのん' }),
    PLAYER1,
    'sp-bp5-001-source'
  );
  const lowOpponent = createCardInstance(
    createMember('OPP-LOW', { name: 'Opponent low', cost: 4 }),
    PLAYER2,
    'opponent-low-cost'
  );
  const highOpponent = createCardInstance(
    createMember('OPP-HIGH', { name: 'Opponent high', cost: 5 }),
    PLAYER2,
    'opponent-high-cost'
  );
  const waitingOpponent = createCardInstance(
    createMember('OPP-WAITING', { name: 'Opponent waiting', cost: 4 }),
    PLAYER2,
    'opponent-waiting-cost'
  );
  const energyCards = [0, 1].map((index) =>
    createCardInstance(createEnergy(`ENERGY-${index}`), PLAYER1, `energy-${index}`)
  );
  const drawCard = createCardInstance(
    createMember('DRAW-CARD', { name: 'Draw card', cost: 1 }),
    PLAYER1,
    'draw-card'
  );
  const handCard = createCardInstance(
    createMember('HAND-CARD', { name: 'Hand card', cost: 1 }),
    PLAYER1,
    'hand-card'
  );
  return { source, lowOpponent, highOpponent, waitingOpponent, energyCards, drawCard, handCard };
}

function setupTriggeredState(options: {
  readonly abilityId?: string;
  readonly triggerCondition?: TriggerCondition;
  readonly activeEnergyCount?: number;
  readonly sourceOnStage?: boolean;
} = {}) {
  const cards = createBaseCards();
  let game = createGameState('sp-bp5-001-kanon-triggered', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [
    cards.source,
    cards.lowOpponent,
    cards.highOpponent,
    cards.waitingOpponent,
    ...cards.energyCards,
    cards.drawCard,
    cards.handCard,
  ]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    memberSlots:
      options.sourceOnStage === false
        ? player.memberSlots
        : placeCardInSlot(player.memberSlots, SlotPosition.CENTER, cards.source.instanceId),
    mainDeck: { ...player.mainDeck, cardIds: [cards.drawCard.instanceId] },
    hand: { ...player.hand, cardIds: [cards.handCard.instanceId] },
    energyZone: {
      ...player.energyZone,
      cardIds: cards.energyCards.map((card) => card.instanceId),
      cardStates: new Map(
        cards.energyCards.map((card, index) => [
          card.instanceId,
          {
            orientation:
              index < (options.activeEnergyCount ?? 1)
                ? OrientationState.ACTIVE
                : OrientationState.WAITING,
            face: FaceState.FACE_UP,
          },
        ])
      ),
    },
  }));
  game = updatePlayer(game, PLAYER2, (player) => ({
    ...player,
    memberSlots: {
      ...placeCardInSlot(
        placeCardInSlot(
          placeCardInSlot(player.memberSlots, SlotPosition.LEFT, cards.lowOpponent.instanceId),
          SlotPosition.CENTER,
          cards.highOpponent.instanceId
        ),
        SlotPosition.RIGHT,
        cards.waitingOpponent.instanceId
      ),
      cardStates: new Map([
        [
          cards.lowOpponent.instanceId,
          { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP },
        ],
        [
          cards.highOpponent.instanceId,
          { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP },
        ],
        [
          cards.waitingOpponent.instanceId,
          { orientation: OrientationState.WAITING, face: FaceState.FACE_UP },
        ],
      ]),
    },
  }));
  return { game, ...cards };
}

function startTriggeredAbility(
  game: GameState,
  sourceId: string,
  abilityId: string,
  triggerCondition: TriggerCondition
): GameState {
  const pending: PendingAbilityState = {
    id: `${abilityId}:pending`,
    abilityId,
    sourceCardId: sourceId,
    controllerId: PLAYER1,
    mandatory: false,
    timingId: triggerCondition,
    eventIds: [triggerCondition],
    sourceSlot: SlotPosition.CENTER,
  };
  return resolvePendingCardEffects({
    ...game,
    pendingAbilities: [pending],
  }).gameState;
}

function confirmStep(game: GameState, input: Parameters<typeof resolveActiveEffectStepWithRegistry>[1]) {
  const state = resolveActiveEffectStepWithRegistry(game, input, {
    continuePendingCardEffects: (nextGame, orderedResolution) =>
      resolvePendingCardEffects(nextGame, orderedResolution).gameState,
    delegatePendingAbility: (nextGame) => nextGame,
  });
  expect(state).not.toBeNull();
  return state!;
}

function confirmOption(game: GameState, selectedOptionId: string): GameState {
  return confirmStep(game, { selectedOptionId });
}

function setupActivatedSession(options: {
  readonly sourceOrientation?: OrientationState;
  readonly handCount?: number;
  readonly waitingEnergyCount?: number;
}) {
  const session = createGameSession();
  session.createGame('sp-bp5-001-kanon-activated', PLAYER1, 'P1', PLAYER2, 'P2');
  const cards = createBaseCards();
  let game = registerCards(session.state!, [
    cards.source,
    cards.handCard,
    ...cards.energyCards,
  ]);
  game = {
    ...game,
    currentPhase: GamePhase.MAIN_PHASE,
    currentSubPhase: SubPhase.NONE,
    currentTurnType: TurnType.NORMAL,
    activePlayerIndex: 0,
    waitingPlayerId: null,
  };
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    hand: {
      ...player.hand,
      cardIds: options.handCount === 0 ? [] : [cards.handCard.instanceId],
    },
    memberSlots: {
      ...placeCardInSlot(player.memberSlots, SlotPosition.CENTER, cards.source.instanceId),
      cardStates: new Map([
        [
          cards.source.instanceId,
          {
            orientation: options.sourceOrientation ?? OrientationState.ACTIVE,
            face: FaceState.FACE_UP,
          },
        ],
      ]),
    },
    energyZone: {
      ...player.energyZone,
      cardIds: cards.energyCards.map((card) => card.instanceId),
      cardStates: new Map(
        cards.energyCards.map((card, index) => [
          card.instanceId,
          {
            orientation:
              index < (options.waitingEnergyCount ?? 1)
                ? OrientationState.WAITING
                : OrientationState.ACTIVE,
            face: FaceState.FACE_UP,
          },
        ])
      ),
    },
  }));
  (session as unknown as { authorityState: GameState }).authorityState = game;
  return { session, ...cards };
}

function activate(session: ReturnType<typeof createGameSession>) {
  return session.executeCommand(
    createActivateAbilityCommand(
      PLAYER1,
      'sp-bp5-001-source',
      SP_BP5_001_ACTIVATED_WAIT_SELF_OR_DISCARD_ACTIVATE_ENERGY_ABILITY_ID
    )
  );
}

function confirmSessionOption(session: ReturnType<typeof createGameSession>, optionId: string): void {
  const effectId = session.state!.activeEffect!.id;
  expect(
    session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, effectId, undefined, undefined, undefined, optionId)
    ).success
  ).toBe(true);
}

function confirmSessionCard(session: ReturnType<typeof createGameSession>, cardId: string): void {
  const effectId = session.state!.activeEffect!.id;
  expect(session.executeCommand(createConfirmEffectStepCommand(PLAYER1, effectId, cardId)).success).toBe(
    true
  );
}

function abilityUseCount(game: GameState): number {
  return game.actionHistory.filter(
    (action) =>
      action.type === 'RESOLVE_ABILITY' &&
      action.payload.abilityId ===
        SP_BP5_001_ACTIVATED_WAIT_SELF_OR_DISCARD_ACTIVATE_ENERGY_ABILITY_ID &&
      action.payload.step === 'ABILITY_USE'
  ).length;
}

describe('PL!SP-bp5-001 Kanon workflows', () => {
  it('on-enter consumes pending without paying when there is no active energy', () => {
    const scenario = setupTriggeredState({ activeEnergyCount: 0 });
    const state = startTriggeredAbility(
      scenario.game,
      scenario.source.instanceId,
      SP_BP5_001_ON_ENTER_PAY_ENERGY_WAIT_OPPONENT_OR_DRAW_ABILITY_ID,
      TriggerCondition.ON_ENTER_STAGE
    );

    expect(state.activeEffect).toBeNull();
    expect(state.players[0].energyZone.cardStates.get(scenario.energyCards[0].instanceId)?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(state.pendingAbilities).toEqual([]);
    expect(
      state.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            SP_BP5_001_ON_ENTER_PAY_ENERGY_WAIT_OPPONENT_OR_DRAW_ABILITY_ID &&
          action.payload.step === 'SKIP_NO_ACTIVE_ENERGY'
      )
    ).toBe(true);
  });

  it('on-enter pays energy and draws one card', () => {
    const scenario = setupTriggeredState({ activeEnergyCount: 1 });
    let state = startTriggeredAbility(
      scenario.game,
      scenario.source.instanceId,
      SP_BP5_001_ON_ENTER_PAY_ENERGY_WAIT_OPPONENT_OR_DRAW_ABILITY_ID,
      TriggerCondition.ON_ENTER_STAGE
    );

    state = confirmOption(state, 'pay');
    expect(state.players[0].energyZone.cardStates.get(scenario.energyCards[0].instanceId)?.orientation).toBe(
      OrientationState.WAITING
    );
    state = confirmOption(state, 'draw');

    expect(state.activeEffect).toBeNull();
    expect(state.players[0].hand.cardIds).toContain(scenario.drawCard.instanceId);
    expect(state.players[0].mainDeck.cardIds).not.toContain(scenario.drawCard.instanceId);
  });

  it('on-enter pays energy and waits only an opponent cost 4 or lower non-waiting member', () => {
    const scenario = setupTriggeredState({ activeEnergyCount: 1 });
    let state = startTriggeredAbility(
      scenario.game,
      scenario.source.instanceId,
      SP_BP5_001_ON_ENTER_PAY_ENERGY_WAIT_OPPONENT_OR_DRAW_ABILITY_ID,
      TriggerCondition.ON_ENTER_STAGE
    );

    state = confirmOption(state, 'pay');
    expect(state.activeEffect?.selectableOptions?.map((option) => option.id)).toEqual([
      'wait-opponent',
      'draw',
    ]);
    state = confirmOption(state, 'wait-opponent');
    expect(state.activeEffect?.selectableCardIds).toEqual([scenario.lowOpponent.instanceId]);
    state = confirmStep(state, { selectedCardId: scenario.lowOpponent.instanceId });

    expect(state.players[1].memberSlots.cardStates.get(scenario.lowOpponent.instanceId)?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(state.players[1].memberSlots.cardStates.get(scenario.highOpponent.instanceId)?.orientation).toBe(
      OrientationState.ACTIVE
    );
    expect(state.players[1].memberSlots.cardStates.get(scenario.waitingOpponent.instanceId)?.orientation).toBe(
      OrientationState.WAITING
    );
  });

  it('live-start pays energy and can draw when source remains on stage', () => {
    const scenario = setupTriggeredState({ activeEnergyCount: 1 });
    let state = startTriggeredAbility(
      scenario.game,
      scenario.source.instanceId,
      SP_BP5_001_LIVE_START_PAY_ENERGY_WAIT_OPPONENT_OR_DRAW_ABILITY_ID,
      TriggerCondition.ON_LIVE_START
    );
    state = confirmOption(state, 'pay');
    state = confirmOption(state, 'draw');

    expect(state.activeEffect).toBeNull();
    expect(state.players[0].hand.cardIds).toContain(scenario.drawCard.instanceId);
  });

  it('live-start consumes pending without effect when source is not on stage', () => {
    const scenario = setupTriggeredState({ activeEnergyCount: 1, sourceOnStage: false });
    const state = startTriggeredAbility(
      scenario.game,
      scenario.source.instanceId,
      SP_BP5_001_LIVE_START_PAY_ENERGY_WAIT_OPPONENT_OR_DRAW_ABILITY_ID,
      TriggerCondition.ON_LIVE_START
    );

    expect(state.activeEffect).toBeNull();
    expect(state.players[0].energyZone.cardStates.get(scenario.energyCards[0].instanceId)?.orientation).toBe(
      OrientationState.ACTIVE
    );
    expect(
      state.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.step === 'SKIP_SOURCE_NOT_ON_STAGE'
      )
    ).toBe(true);
  });

  it('activated ability pays source-wait cost and activates one waiting energy', () => {
    const scenario = setupActivatedSession({ waitingEnergyCount: 1 });
    expect(activate(scenario.session).success).toBe(true);
    expect(scenario.session.state?.activeEffect?.selectableOptions?.map((option) => option.id)).toEqual([
      'wait-self',
      'discard-hand',
    ]);

    confirmSessionOption(scenario.session, 'wait-self');

    expect(
      scenario.session.state?.players[0].memberSlots.cardStates.get(scenario.source.instanceId)?.orientation
    ).toBe(OrientationState.WAITING);
    expect(
      scenario.session.state?.players[0].energyZone.cardStates.get(scenario.energyCards[0].instanceId)
        ?.orientation
    ).toBe(OrientationState.ACTIVE);
    expect(abilityUseCount(scenario.session.state!)).toBe(1);
  });

  it('activated ability can pay by discarding one hand card', () => {
    const scenario = setupActivatedSession({
      sourceOrientation: OrientationState.WAITING,
      waitingEnergyCount: 1,
    });
    expect(activate(scenario.session).success).toBe(true);
    expect(scenario.session.state?.activeEffect?.selectableOptions?.map((option) => option.id)).toEqual([
      'discard-hand',
    ]);

    confirmSessionOption(scenario.session, 'discard-hand');
    confirmSessionCard(scenario.session, scenario.handCard.instanceId);

    expect(scenario.session.state?.players[0].waitingRoom.cardIds).toContain(
      scenario.handCard.instanceId
    );
    expect(
      scenario.session.state?.players[0].energyZone.cardStates.get(scenario.energyCards[0].instanceId)
        ?.orientation
    ).toBe(OrientationState.ACTIVE);
    expect(abilityUseCount(scenario.session.state!)).toBe(1);
  });

  it('activated ability does not start without a legal cost', () => {
    const noCost = setupActivatedSession({
      sourceOrientation: OrientationState.WAITING,
      handCount: 0,
      waitingEnergyCount: 1,
    });
    expect(activate(noCost.session).success).toBe(false);
    expect(noCost.session.state?.activeEffect).toBeNull();
    expect(abilityUseCount(noCost.session.state!)).toBe(0);
  });

  it('activated ability can pay a legal cost even when no energy is waiting', () => {
    const scenario = setupActivatedSession({
      sourceOrientation: OrientationState.ACTIVE,
      handCount: 1,
      waitingEnergyCount: 0,
    });
    expect(activate(scenario.session).success).toBe(true);
    confirmSessionOption(scenario.session, 'wait-self');

    expect(scenario.session.state?.activeEffect).toBeNull();
    expect(
      scenario.session.state?.players[0].memberSlots.cardStates.get(scenario.source.instanceId)?.orientation
    ).toBe(OrientationState.WAITING);
    expect(
      scenario.session.state?.players[0].energyZone.cardStates.get(scenario.energyCards[0].instanceId)
        ?.orientation
    ).toBe(OrientationState.ACTIVE);
    expect(
      scenario.session.state?.players[0].energyZone.cardStates.get(scenario.energyCards[1].instanceId)
        ?.orientation
    ).toBe(OrientationState.ACTIVE);
    expect(abilityUseCount(scenario.session.state!)).toBe(1);
    const resolveAction = [...(scenario.session.state?.actionHistory ?? [])]
      .reverse()
      .find(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            SP_BP5_001_ACTIVATED_WAIT_SELF_OR_DISCARD_ACTIVATE_ENERGY_ABILITY_ID
      );
    expect(resolveAction?.payload.activatedEnergyCardIds).toEqual([]);
  });

  it('activated ability is limited to once per turn after a successful cost', () => {
    const scenario = setupActivatedSession({ waitingEnergyCount: 2 });
    expect(activate(scenario.session).success).toBe(true);
    confirmSessionOption(scenario.session, 'wait-self');

    const second = activate(scenario.session);
    expect(second.success).toBe(false);
    expect(second.error).toContain('本回合已发动');
  });
});
