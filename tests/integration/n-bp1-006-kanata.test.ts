import { describe, expect, it } from 'vitest';
import type { EnergyCardData, MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import { createGameState, emitGameEvent, registerCards, updatePlayer, type GameState } from '../../src/domain/entities/game';
import { createEnterStageEvent } from '../../src/domain/events/game-events';
import { addCardToStatefulZone, addCardToZone, placeCardInSlot } from '../../src/domain/entities/zone';
import { createActivateAbilityCommand, createConfirmEffectStepCommand } from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import { GameService } from '../../src/application/game-service';
import { createPublicObjectId } from '../../src/online/projector';
import {
  PL_N_BP1_006_ACTIVATED_DISCARD_ONE_IF_NIJIGASAKI_ENTERED_ACTIVATE_TWO_ENERGY_ABILITY_ID,
  SP_BP5_020_ACTIVATED_PAY_TWO_ENERGY_DRAW_ONE_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import { CardType, FaceState, GamePhase, HeartColor, OrientationState, SlotPosition, SubPhase, TurnType, ZoneType } from '../../src/shared/types/enums';

const P1 = 'player1';
const P2 = 'player2';

function member(code: string, groupNames: readonly string[] = ['虹ヶ咲'], cost = 4): MemberCardData {
  return { cardCode: code, name: code, groupNames, cardType: CardType.MEMBER, cost, blade: 1, hearts: [createHeartIcon(HeartColor.PURPLE, 1)] };
}
function energy(code: string): EnergyCardData {
  return { cardCode: code, name: code, cardType: CardType.ENERGY };
}

function setup(options: { waiting?: number; active?: number; entered?: 'SOURCE' | 'LEFT' | 'OPPONENT' | 'OTHER' | 'NONE'; specialIndex?: number } = {}) {
  const source = createCardInstance(member('PL!N-bp1-006-P', ['虹ヶ咲'], 13), P1, 'source');
  const hand = createCardInstance(member('HAND-COST'), P1, 'hand');
  const draw = createCardInstance(member('DRAW'), P1, 'draw');
  const enteredOwner = options.entered === 'OPPONENT' ? P2 : P1;
  const entered = createCardInstance(
    member('ENTERED', options.entered === 'OTHER' ? ['Aqours'] : ['虹ヶ咲']),
    enteredOwner,
    'entered'
  );
  const energies = Array.from({ length: (options.waiting ?? 2) + (options.active ?? 2) }, (_, index) =>
    createCardInstance(energy(`ENERGY-${index}`), P1, `energy-${index}`)
  );
  let game = registerCards(createGameState('kanata', P1, 'P1', P2, 'P2'), [source, hand, draw, entered, ...energies]);
  game = updatePlayer(game, P1, (player) => ({
    ...player,
    hand: addCardToZone(player.hand, hand.instanceId),
    mainDeck: addCardToZone(player.mainDeck, draw.instanceId),
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }),
    energyZone: energies.reduce((zone, card, index) => addCardToStatefulZone(zone, card.instanceId, {
      orientation: index < (options.waiting ?? 2) ? OrientationState.WAITING : OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }), player.energyZone),
  }));
  game = { ...game, currentPhase: GamePhase.MAIN_PHASE, currentSubPhase: SubPhase.NONE, currentTurnType: TurnType.NORMAL, activePlayerIndex: 0 };
  if (options.entered && options.entered !== 'NONE') {
    const eventCard = options.entered === 'SOURCE' ? source : entered;
    game = emitGameEvent(game, createEnterStageEvent(eventCard.instanceId, ZoneType.HAND, SlotPosition.LEFT, enteredOwner, enteredOwner));
  }
  if (options.specialIndex !== undefined) {
    game = { ...game, energyActivePhaseSkips: [{ playerId: P1, energyCardId: energies[options.specialIndex]!.instanceId, sourceCardId: 'marker-source', abilityId: 'marker' }] };
  }
  const session = createGameSession();
  session.createGame('kanata-session', P1, 'P1', P2, 'P2');
  (session as unknown as { authorityState: GameState }).authorityState = game;
  return { session, source, hand, draw, entered, energies };
}

function activateDiscard(context: ReturnType<typeof setup>) {
  return context.session.executeCommand(createActivateAbilityCommand(P1, context.source.instanceId, PL_N_BP1_006_ACTIVATED_DISCARD_ONE_IF_NIJIGASAKI_ENTERED_ACTIVATE_TWO_ENERGY_ABILITY_ID));
}
function confirmDiscard(
  context: ReturnType<typeof setup>,
  selectedCardId: string | null = context.hand.instanceId
) {
  return context.session.executeCommand(
    createConfirmEffectStepCommand(
      P1,
      context.session.state!.activeEffect!.id,
      selectedCardId
    )
  );
}
function abilityUses(game: GameState, abilityId: string) {
  return game.actionHistory.filter((action) => action.type === 'RESOLVE_ABILITY' && action.payload.abilityId === abilityId && action.payload.step === 'ABILITY_USE').length;
}

function advanceToNextMainPhase(game: GameState): GameState {
  const service = new GameService();
  let state: GameState = {
    ...game,
    currentPhase: GamePhase.LIVE_RESULT_PHASE,
    currentSubPhase: SubPhase.NONE,
    currentTurnType: TurnType.LIVE_PHASE,
    activePlayerIndex: 0,
  };
  for (let index = 0; index < 4; index += 1) {
    const result = service.advancePhase(state);
    expect(result.success, result.error).toBe(true);
    state = result.gameState;
  }
  expect(state.currentPhase).toBe(GamePhase.MAIN_PHASE);
  return state;
}

describe('PL!N-bp1-006 费用13「近江彼方」 activated abilities', () => {
  it('pays one hand card and activates exactly the first two waiting energies after an own Nijigasaki entry', () => {
    const context = setup({ waiting: 3, active: 0, entered: 'SOURCE' });
    expect(activateDiscard(context).success).toBe(true);
    expect(context.session.state?.activeEffect).toMatchObject({ selectableCardMode: 'SINGLE', selectionLabel: '选择要放置入休息室的手牌', confirmSelectionLabel: '放置入休息室', canSkipSelection: true, skipSelectionLabel: '不发动', selectableCardVisibility: 'AWAITING_PLAYER_ONLY' });
    const confirmed = confirmDiscard(context);
    expect(confirmed.success, confirmed.error).toBe(true);
    expect(context.session.state?.players[0].waitingRoom.cardIds).toContain(context.hand.instanceId);
    expect(context.energies.map((card) => context.session.state!.players[0].energyZone.cardStates.get(card.instanceId)?.orientation)).toEqual([OrientationState.ACTIVE, OrientationState.ACTIVE, OrientationState.WAITING]);
    const resolve = context.session.state!.actionHistory.find((action) => action.payload.step === 'DISCARD_AND_ACTIVATE_WAITING_ENERGY');
    expect(resolve?.payload.activatedEnergyCardIds).toEqual(context.energies.slice(0, 2).map((card) => card.instanceId));
  });

  it.each([
    ['no entry', 'NONE'],
    ['opponent entry', 'OPPONENT'],
    ['non-Nijigasaki entry', 'OTHER'],
  ] as const)('%s still pays and consumes the ability without activating energy', (_label, entered) => {
    const context = setup({ waiting: 2, active: 0, entered });
    expect(activateDiscard(context).success).toBe(true);
    expect(confirmDiscard(context).success).toBe(true);
    expect(context.session.state?.players[0].waitingRoom.cardIds).toContain(context.hand.instanceId);
    expect(context.energies.every((card) => context.session.state!.players[0].energyZone.cardStates.get(card.instanceId)?.orientation === OrientationState.WAITING)).toBe(true);
    expect(abilityUses(context.session.state!, PL_N_BP1_006_ACTIVATED_DISCARD_ONE_IF_NIJIGASAKI_ENTERED_ACTIVATE_TWO_ENERGY_ABILITY_ID)).toBe(1);
  });

  it('does not carry a prior turn Nijigasaki entry into the next turn', () => {
    const context = setup({ waiting: 2, active: 0, entered: 'SOURCE' });
    let nextTurn = advanceToNextMainPhase(context.session.state!);
    nextTurn = updatePlayer(nextTurn, P1, (player) => ({
      ...player,
      energyZone: {
        ...player.energyZone,
        cardStates: new Map(
          [...player.energyZone.cardStates].map(([cardId, cardState]) => [
            cardId,
            { ...cardState, orientation: OrientationState.WAITING },
          ])
        ),
      },
    }));
    (context.session as unknown as { authorityState: GameState }).authorityState = nextTurn;

    expect(
      nextTurn.eventLog.some(
        ({ event }) => event.eventType === 'ON_TURN_START' && event.turnNumber === nextTurn.turnCount
      )
    ).toBe(true);
    expect(activateDiscard(context).success).toBe(true);
    expect(confirmDiscard(context).success).toBe(true);
    expect(
      context.energies.map(
        (card) =>
          context.session.state!.players[0].energyZone.cardStates.get(card.instanceId)?.orientation
      )
    ).toEqual([OrientationState.WAITING, OrientationState.WAITING]);
    expect(
      context.session.state?.actionHistory.find(
        (action) => action.payload.step === 'DISCARD_AND_ACTIVATE_WAITING_ENERGY'
      )?.payload
    ).toMatchObject({ conditionMet: false, activatedEnergyCardIds: [] });
  });

  it.each([0, 1])('handles %i waiting energy by the actual available count', (waiting) => {
    const context = setup({ waiting, active: 0, entered: 'SOURCE' });
    expect(activateDiscard(context).success).toBe(true);
    expect(confirmDiscard(context).success).toBe(true);
    expect(context.session.state?.activeEffect).toBeNull();
    expect(context.session.state?.actionHistory.find((action) => action.payload.step === 'DISCARD_AND_ACTIVATE_WAITING_ENERGY')?.payload.activatedEnergyCardIds).toEqual(context.energies.map((card) => card.instanceId));
  });

  it('uses the shared exact-selection continuation without half-committing the discard', () => {
    const context = setup({ waiting: 3, active: 0, entered: 'SOURCE', specialIndex: 2 });
    expect(activateDiscard(context).success).toBe(true);
    expect(confirmDiscard(context).success).toBe(true);
    expect(context.session.state?.activeEffect).toMatchObject({ stepId: 'COMMON_ENERGY_OPERATION_SELECTION', stepText: '请选择要变为活跃状态的待机能量。', selectionLabel: '选择要变为活跃的能量', confirmSelectionLabel: '变为活跃' });
    expect(context.session.state?.players[0].hand.cardIds).toContain(context.hand.instanceId);
    expect(context.session.state?.players[0].waitingRoom.cardIds).not.toContain(context.hand.instanceId);
    expect(abilityUses(context.session.state!, PL_N_BP1_006_ACTIVATED_DISCARD_ONE_IF_NIJIGASAKI_ENTERED_ACTIVATE_TWO_ENERGY_ABILITY_ID)).toBe(0);
    const effectId = context.session.state!.activeEffect!.id;
    for (const ids of [['energy-0', 'energy-0'], ['energy-0', 'forged']] as const) {
      context.session.executeCommand(createConfirmEffectStepCommand(P1, effectId, undefined, undefined, undefined, undefined, ids));
      expect(context.session.state?.activeEffect?.stepId).toBe('COMMON_ENERGY_OPERATION_SELECTION');
    }
    expect(context.session.executeCommand(createConfirmEffectStepCommand(P1, effectId, undefined, undefined, undefined, undefined, [context.energies[0]!.instanceId, context.energies[2]!.instanceId])).success).toBe(true);
    expect(context.session.state?.players[0].waitingRoom.cardIds).toContain(context.hand.instanceId);
    expect(abilityUses(context.session.state!, PL_N_BP1_006_ACTIVATED_DISCARD_ONE_IF_NIJIGASAKI_ENTERED_ACTIVATE_TWO_ENERGY_ABILITY_ID)).toBe(1);
  });

  it('rejects forged, duplicate, stale discard input and source departure without paying', () => {
    const forged = setup({ entered: 'SOURCE' });
    expect(activateDiscard(forged).success).toBe(true);
    confirmDiscard(forged, 'forged');
    expect(forged.session.state?.players[0].waitingRoom.cardIds).toEqual([]);

    const duplicate = setup({ entered: 'SOURCE' });
    expect(activateDiscard(duplicate).success).toBe(true);
    expect(
      duplicate.session.executeCommand(
        createConfirmEffectStepCommand(
          P1,
          duplicate.session.state!.activeEffect!.id,
          undefined,
          undefined,
          undefined,
          undefined,
          ['hand', 'hand']
        )
      ).success
    ).toBe(false);
    expect(duplicate.session.state?.players[0].waitingRoom.cardIds).toEqual([]);

    const stale = setup({ entered: 'SOURCE' });
    expect(activateDiscard(stale).success).toBe(true);
    (stale.session as unknown as { authorityState: GameState }).authorityState = updatePlayer(stale.session.state!, P1, (player) => ({ ...player, hand: { ...player.hand, cardIds: [] } }));
    confirmDiscard(stale);
    expect(stale.session.state?.players[0].waitingRoom.cardIds).toEqual([]);
    const departed = setup({ entered: 'SOURCE' });
    expect(activateDiscard(departed).success).toBe(true);
    (departed.session as unknown as { authorityState: GameState }).authorityState = updatePlayer(departed.session.state!, P1, (player) => ({ ...player, memberSlots: { ...player.memberSlots, slots: { ...player.memberSlots.slots, [SlotPosition.CENTER]: null } } }));
    confirmDiscard(departed);
    expect(departed.session.state?.players[0].waitingRoom.cardIds).toEqual([]);
  });

  it('does not discard or consume the turn use when the player chooses 不发动', () => {
    const context = setup({ entered: 'SOURCE' });
    expect(activateDiscard(context).success).toBe(true);
    expect(confirmDiscard(context, null).success).toBe(true);
    expect(context.session.state?.activeEffect).toBeNull();
    expect(context.session.state?.players[0].hand.cardIds).toContain(context.hand.instanceId);
    expect(context.session.state?.players[0].waitingRoom.cardIds).not.toContain(
      context.hand.instanceId
    );
    expect(
      abilityUses(
        context.session.state!,
        PL_N_BP1_006_ACTIVATED_DISCARD_ONE_IF_NIJIGASAKI_ENTERED_ACTIVATE_TWO_ENERGY_ABILITY_ID
      )
    ).toBe(0);
    expect(activateDiscard(context).success).toBe(true);
  });

  it('projects both activated ability choices in printed order', () => {
    const context = setup({ entered: 'SOURCE' });
    const view = context.session.getPlayerViewState(P1)!;
    const projected = view.objects[createPublicObjectId(context.source.instanceId)];
    expect(projected?.activatedAbilityUiConfigs?.map((config) => config.abilityId)).toEqual([
      PL_N_BP1_006_ACTIVATED_DISCARD_ONE_IF_NIJIGASAKI_ENTERED_ACTIVATE_TWO_ENERGY_ABILITY_ID,
      SP_BP5_020_ACTIVATED_PAY_TWO_ENERGY_DRAW_ONE_ABILITY_ID,
    ]);
    expect(projected?.activatedAbilityUiConfig?.abilityId).toBe(
      PL_N_BP1_006_ACTIVATED_DISCARD_ONE_IF_NIJIGASAKI_ENTERED_ACTIVATE_TWO_ENERGY_ABILITY_ID
    );
  });

  it('keeps the two once-per-turn identities independent and resets by turn count', () => {
    const context = setup({ waiting: 2, active: 2, entered: 'SOURCE' });
    expect(activateDiscard(context).success).toBe(true);
    expect(confirmDiscard(context).success).toBe(true);
    expect(context.session.executeCommand(createActivateAbilityCommand(P1, context.source.instanceId, SP_BP5_020_ACTIVATED_PAY_TWO_ENERGY_DRAW_ONE_ABILITY_ID)).success).toBe(true);
    expect(context.session.state?.players[0].hand.cardIds).toContain(context.draw.instanceId);
    expect(activateDiscard(context).success).toBe(false);
    expect(context.session.executeCommand(createActivateAbilityCommand(P1, context.source.instanceId, SP_BP5_020_ACTIVATED_PAY_TWO_ENERGY_DRAW_ONE_ABILITY_ID)).success).toBe(false);
    (context.session as unknown as { authorityState: GameState }).authorityState = { ...context.session.state!, turnCount: context.session.state!.turnCount + 1 };
    expect(context.session.executeCommand(createActivateAbilityCommand(P1, context.source.instanceId, PL_N_BP1_006_ACTIVATED_DISCARD_ONE_IF_NIJIGASAKI_ENTERED_ACTIVATE_TWO_ENERGY_ABILITY_ID)).success).toBe(true);
    expect(confirmDiscard(context, context.draw.instanceId).success).toBe(true);
    expect(abilityUses(context.session.state!, PL_N_BP1_006_ACTIVATED_DISCARD_ONE_IF_NIJIGASAKI_ENTERED_ACTIVATE_TWO_ENERGY_ABILITY_ID)).toBe(2);
  });

  it('does not record the draw ability when payment is short and preserves shared special-energy payment', () => {
    const short = setup({ waiting: 0, active: 1, entered: 'NONE' });
    expect(short.session.executeCommand(createActivateAbilityCommand(P1, short.source.instanceId, SP_BP5_020_ACTIVATED_PAY_TWO_ENERGY_DRAW_ONE_ABILITY_ID)).success).toBe(false);
    expect(abilityUses(short.session.state!, SP_BP5_020_ACTIVATED_PAY_TWO_ENERGY_DRAW_ONE_ABILITY_ID)).toBe(0);

    const special = setup({ waiting: 0, active: 3, entered: 'NONE', specialIndex: 2 });
    expect(special.session.executeCommand(createActivateAbilityCommand(P1, special.source.instanceId, SP_BP5_020_ACTIVATED_PAY_TWO_ENERGY_DRAW_ONE_ABILITY_ID)).success).toBe(true);
    expect(special.session.state?.activeEffect).toMatchObject({
      stepId: 'COMMON_ENERGY_OPERATION_SELECTION',
      stepText: '请选择用于支付[E][E]的活跃能量卡。',
      selectionLabel: '选择用于支付费用的能量卡',
      confirmSelectionLabel: '支付费用',
    });
    expect(special.session.state?.players[0].hand.cardIds).not.toContain(special.draw.instanceId);
    expect(special.session.executeCommand(createConfirmEffectStepCommand(P1, special.session.state!.activeEffect!.id, undefined, undefined, undefined, undefined, [special.energies[0]!.instanceId, special.energies[2]!.instanceId])).success).toBe(true);
    expect(special.session.state?.players[0].hand.cardIds).toContain(special.draw.instanceId);
    expect(abilityUses(special.session.state!, SP_BP5_020_ACTIVATED_PAY_TWO_ENERGY_DRAW_ONE_ABILITY_ID)).toBe(1);
  });
});
