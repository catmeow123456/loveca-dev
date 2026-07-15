import { describe, expect, it } from 'vitest';
import type { EnergyCardData, MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import { addCardToStatefulZone, placeCardInSlot } from '../../src/domain/entities/zone';
import {
  createActivateAbilityCommand,
  createConfirmEffectStepCommand,
} from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import { SP_BP1_009_ACTIVATED_PAY_ONE_ENERGY_DRAW_ONE_DISCARD_ONE_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
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

const P1 = 'player1';
const P2 = 'player2';

function member(cardCode: string, name = cardCode): MemberCardData {
  return {
    cardCode,
    name,
    groupNames: ['Liella!'],
    cardType: CardType.MEMBER,
    cost: 9,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.YELLOW, 1)],
  };
}

function energy(cardCode: string): EnergyCardData {
  return { cardCode, name: cardCode, cardType: CardType.ENERGY };
}

function setup(
  options: {
    readonly sourceCode?: string;
    readonly sourceOnStage?: boolean;
    readonly activePlayerIndex?: number;
    readonly phase?: GamePhase;
    readonly activeEnergyCount?: number;
    readonly waitingEnergyCount?: number;
    readonly handCount?: number;
    readonly deckCount?: number;
  } = {}
) {
  const source = createCardInstance(
    member(options.sourceCode ?? 'PL!SP-bp1-009-P', '鬼塚夏美'),
    P1,
    'source'
  );
  const activeEnergies = Array.from({ length: options.activeEnergyCount ?? 1 }, (_, index) =>
    createCardInstance(energy(`ACTIVE-${index}`), P1, `active-energy-${index}`)
  );
  const waitingEnergies = Array.from({ length: options.waitingEnergyCount ?? 0 }, (_, index) =>
    createCardInstance(energy(`WAITING-${index}`), P1, `waiting-energy-${index}`)
  );
  const handCards = Array.from({ length: options.handCount ?? 1 }, (_, index) =>
    createCardInstance(member(`HAND-${index}`), P1, `hand-${index}`)
  );
  const deckCards = Array.from({ length: options.deckCount ?? 1 }, (_, index) =>
    createCardInstance(member(`DRAW-${index}`), P1, `draw-${index}`)
  );
  let game = registerCards(createGameState('sp-bp1-009', P1, 'P1', P2, 'P2'), [
    source,
    ...activeEnergies,
    ...waitingEnergies,
    ...handCards,
    ...deckCards,
  ]);
  game = updatePlayer(game, P1, (player) => {
    let energyZone = player.energyZone;
    for (const card of activeEnergies) {
      energyZone = addCardToStatefulZone(energyZone, card.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      });
    }
    for (const card of waitingEnergies) {
      energyZone = addCardToStatefulZone(energyZone, card.instanceId, {
        orientation: OrientationState.WAITING,
        face: FaceState.FACE_UP,
      });
    }
    return {
      ...player,
      mainDeck: { ...player.mainDeck, cardIds: deckCards.map((card) => card.instanceId) },
      hand: { ...player.hand, cardIds: handCards.map((card) => card.instanceId) },
      energyZone,
      memberSlots:
        options.sourceOnStage === false
          ? player.memberSlots
          : placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
              orientation: OrientationState.ACTIVE,
              face: FaceState.FACE_UP,
            }),
    };
  });
  game = {
    ...game,
    currentPhase: options.phase ?? GamePhase.MAIN_PHASE,
    currentSubPhase: SubPhase.NONE,
    currentTurnType: TurnType.NORMAL,
    activePlayerIndex: options.activePlayerIndex ?? 0,
    waitingPlayerId: null,
  };
  const session = createGameSession();
  session.createGame('sp-bp1-009-session', P1, 'P1', P2, 'P2');
  (session as unknown as { authorityState: GameState }).authorityState = game;
  return { session, source, activeEnergies, waitingEnergies, handCards, deckCards };
}

function activate(context: ReturnType<typeof setup>, playerId = P1) {
  return context.session.executeCommand(
    createActivateAbilityCommand(
      playerId,
      context.source.instanceId,
      SP_BP1_009_ACTIVATED_PAY_ONE_ENERGY_DRAW_ONE_DISCARD_ONE_ABILITY_ID
    )
  );
}

function abilityUseCount(game: GameState): number {
  return game.actionHistory.filter(
    (action) =>
      action.type === 'RESOLVE_ABILITY' &&
      action.payload.abilityId ===
        SP_BP1_009_ACTIVATED_PAY_ONE_ENERGY_DRAW_ONE_DISCARD_ONE_ABILITY_ID &&
      action.payload.step === 'ABILITY_USE'
  ).length;
}

describe('PL!SP-bp1-009 Natsumi activated draw-then-discard', () => {
  it.each(['PL!SP-bp1-009-P', 'PL!SP-bp1-009-R'])(
    '%s pays one ACTIVE energy, draws one, and opens the exact forced discard window',
    (sourceCode) => {
      const context = setup({ sourceCode });
      const result = activate(context);
      expect(result.success, result.error).toBe(true);
      expect(
        context.session.state?.players[0].energyZone.cardStates.get(
          context.activeEnergies[0]!.instanceId
        )?.orientation
      ).toBe(OrientationState.WAITING);
      expect(context.session.state?.activeEffect).toMatchObject({
        abilityId: SP_BP1_009_ACTIVATED_PAY_ONE_ENERGY_DRAW_ONE_DISCARD_ONE_ABILITY_ID,
        effectText: '【起动】【1回合1次】[E]：抽1张卡，将1张手牌放置入休息室。',
        stepText: '请选择1张手牌放置入休息室。',
        selectionLabel: '请选择要放置入休息室的手牌',
        canSkipSelection: false,
      });
      expect(context.session.state?.activeEffect?.selectableCardIds).toEqual([
        context.handCards[0]!.instanceId,
        context.deckCards[0]!.instanceId,
      ]);
      expect(context.session.state?.actionHistory).toContainEqual(
        expect.objectContaining({
          type: 'PAY_COST',
          payload: expect.objectContaining({
            abilityId: SP_BP1_009_ACTIVATED_PAY_ONE_ENERGY_DRAW_ONE_DISCARD_ONE_ABILITY_ID,
            energyCardIds: [context.activeEnergies[0]!.instanceId],
          }),
        })
      );
      expect(abilityUseCount(context.session.state!)).toBe(1);
    }
  );

  it('allows the drawn card to be discarded and emits the standard hand-to-waiting event', () => {
    const context = setup();
    expect(activate(context).success).toBe(true);
    const drawnId = context.deckCards[0]!.instanceId;
    const finished = context.session.executeCommand(
      createConfirmEffectStepCommand(P1, context.session.state!.activeEffect!.id, drawnId)
    );
    expect(finished.success, finished.error).toBe(true);
    expect(context.session.state?.activeEffect).toBeNull();
    expect(context.session.state?.players[0].waitingRoom.cardIds).toContain(drawnId);
    expect(
      context.session.state?.eventLog.find(
        (entry) =>
          entry.event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM &&
          entry.event.cardInstanceIds?.includes(drawnId)
      )?.event
    ).toMatchObject({ fromZone: 'HAND', toZone: 'WAITING_ROOM' });
  });

  it('records turn use only after payment and rejects a second activation in the same turn', () => {
    const context = setup({ activeEnergyCount: 2 });
    expect(activate(context).success).toBe(true);
    expect(
      context.session.executeCommand(
        createConfirmEffectStepCommand(
          P1,
          context.session.state!.activeEffect!.id,
          context.handCards[0]!.instanceId
        )
      ).success
    ).toBe(true);
    const beforeSecond = context.session.state!;
    expect(activate(context).success).toBe(false);
    expect(abilityUseCount(context.session.state!)).toBe(1);
    expect(context.session.state?.actionHistory).toHaveLength(beforeSecond.actionHistory.length);

    const noEnergy = setup({ activeEnergyCount: 0 });
    expect(activate(noEnergy).success).toBe(false);
    expect(abilityUseCount(noEnergy.session.state!)).toBe(0);
  });

  it.each([
    ['non-current player', { activePlayerIndex: 1 }],
    ['non-main phase', { phase: GamePhase.ACTIVE_PHASE }],
    ['source off stage', { sourceOnStage: false }],
    ['wrong card code', { sourceCode: 'PL!SP-bp1-008-P' }],
    ['WAITING energy only', { activeEnergyCount: 0, waitingEnergyCount: 1 }],
  ] as const)('rejects %s with zero modification', (_label, options) => {
    const context = setup(options);
    const before = context.session.state!;
    expect(activate(context).success).toBe(false);
    expect(context.session.state?.activeEffect).toBeNull();
    expect(context.session.state?.actionHistory).toHaveLength(before.actionHistory.length);
    expect(abilityUseCount(context.session.state!)).toBe(0);
  });

  it('rejects forged, duplicate, and stale discard selections without another payment', () => {
    for (const selectedCardIds of [['forged'], ['hand-0', 'hand-0']]) {
      const context = setup();
      expect(activate(context).success).toBe(true);
      const actionCount = context.session.state!.actionHistory.length;
      context.session.executeCommand(
        createConfirmEffectStepCommand(
          P1,
          context.session.state!.activeEffect!.id,
          undefined,
          undefined,
          undefined,
          undefined,
          selectedCardIds
        )
      );
      expect(context.session.state?.activeEffect).not.toBeNull();
      expect(context.session.state?.actionHistory).toHaveLength(actionCount);
      expect(abilityUseCount(context.session.state!)).toBe(1);
    }

    const stale = setup();
    expect(activate(stale).success).toBe(true);
    const staleId = stale.handCards[0]!.instanceId;
    (stale.session as unknown as { authorityState: GameState }).authorityState = updatePlayer(
      stale.session.state!,
      P1,
      (player) => ({
        ...player,
        hand: {
          ...player.hand,
          cardIds: player.hand.cardIds.filter((cardId) => cardId !== staleId),
        },
      })
    );
    const energyAfterPayment = stale.session.state?.players[0].energyZone.cardStates.get(
      stale.activeEnergies[0]!.instanceId
    )?.orientation;
    stale.session.executeCommand(
      createConfirmEffectStepCommand(P1, stale.session.state!.activeEffect!.id, staleId)
    );
    expect(stale.session.state?.activeEffect).not.toBeNull();
    expect(
      stale.session.state?.players[0].energyZone.cardStates.get(stale.activeEnergies[0]!.instanceId)
        ?.orientation
    ).toBe(energyAfterPayment);
    expect(abilityUseCount(stale.session.state!)).toBe(1);
  });

  it('continues to a forced discard with an empty deck and finishes by confirmation with no hand', () => {
    const emptyDeck = setup({ deckCount: 0, handCount: 1 });
    expect(activate(emptyDeck).success).toBe(true);
    expect(emptyDeck.session.state?.activeEffect?.selectableCardIds).toEqual([
      emptyDeck.handCards[0]!.instanceId,
    ]);

    const emptyBoth = setup({ deckCount: 0, handCount: 0 });
    expect(activate(emptyBoth).success).toBe(true);
    expect(emptyBoth.session.state?.activeEffect).toMatchObject({
      stepText: '没有可放置入休息室的手牌。确认后继续。',
      selectableCardIds: [],
      canSkipSelection: true,
      skipSelectionLabel: '确认',
    });
    expect(
      emptyBoth.session.executeCommand(
        createConfirmEffectStepCommand(P1, emptyBoth.session.state!.activeEffect!.id)
      ).success
    ).toBe(true);
    expect(emptyBoth.session.state?.activeEffect).toBeNull();
    expect(abilityUseCount(emptyBoth.session.state!)).toBe(1);
  });
});
