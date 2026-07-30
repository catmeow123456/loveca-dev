import { describe, expect, it } from 'vitest';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import { addCardToStatefulZone, placeCardInSlot } from '../../src/domain/entities/zone';
import {
  activateCardAbility,
  confirmActiveEffectStep,
} from '../../src/application/card-effect-runner';
import { createGameSession } from '../../src/application/game-session';
import { createConfirmEffectStepCommand } from '../../src/application/game-commands';
import {
  PL_PR_001_002_ON_LEAVE_STAGE_ACTIVATE_MEMBER_ABILITY_ID,
  SP_BP7_010_ACTIVATED_SELF_SACRIFICE_RETURN_ENERGY_RECOVER_CARD_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import { findCardAbilityDefinitionById } from '../../src/application/card-effects/definitions/lookup';
import { ENERGY_OPERATION_SELECTION_STEP_ID } from '../../src/application/card-effects/runtime/energy-operation-selection';
import { PUBLIC_CARD_SELECTION_CONFIRMATION_STEP_ID } from '../../src/application/card-effects/runtime/public-card-selection-confirmation';
import {
  CardAbilityCategory,
  CardAbilitySourceZone,
} from '../../src/application/card-effects/ability-definition-types';
import {
  CardType,
  FaceState,
  GamePhase,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
  ZoneType,
} from '../../src/shared/types/enums';

const P1 = 'p1';
const P2 = 'p2';
const SOURCE_ID = 'margarete-source';
const ABILITY = SP_BP7_010_ACTIVATED_SELF_SACRIFICE_RETURN_ENERGY_RECOVER_CARD_ABILITY_ID;
const EFFECT_TEXT =
  '【起动】将此成员从舞台放置入休息室：将存在于自己的能量区的1张能量放置于能量卡组。此后，从自己的休息室将1张卡加入手牌。';

function member(code: string, name: string, instanceId: string) {
  return createCardInstance(
    {
      cardCode: code,
      name,
      groupNames: ['Liella!'],
      cardType: CardType.MEMBER,
      cost: code.startsWith('PL!SP-bp7-010') ? 2 : 1,
      blade: 1,
      hearts: [createHeartIcon(HeartColor.PURPLE, 1)],
    },
    P1,
    instanceId
  );
}

function energy(instanceId: string) {
  return createCardInstance(
    { cardCode: `ENERGY-${instanceId}`, name: instanceId, cardType: CardType.ENERGY },
    P1,
    instanceId
  );
}

function setup(options: { energyCount?: number; markedIndex?: number } = {}) {
  const source = member('PL!SP-bp7-010-SEC', '薇恩・玛格丽特', SOURCE_ID);
  const target = member('TEST-TARGET', '回收目标', 'recovery-target');
  const energyCards = Array.from({ length: options.energyCount ?? 1 }, (_, index) =>
    energy(`energy-${index}`)
  );
  let game = registerCards(createGameState('sp-bp7-010', P1, 'P1', P2, 'P2'), [
    source,
    target,
    ...energyCards,
  ]);
  game = {
    ...game,
    currentPhase: GamePhase.MAIN_PHASE,
  };
  game = updatePlayer(game, P1, (player) => ({
    ...player,
    waitingRoom: { ...player.waitingRoom, cardIds: [target.instanceId] },
    energyZone: energyCards.reduce(
      (zone, card) =>
        addCardToStatefulZone(zone, card.instanceId, {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        }),
      player.energyZone
    ),
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
  }));
  if (options.markedIndex !== undefined) {
    game = {
      ...game,
      energyActivePhaseSkips: [
        {
          playerId: P1,
          energyCardId: energyCards[options.markedIndex]!.instanceId,
          sourceCardId: 'marker',
          abilityId: 'marker',
        },
      ],
    };
  }
  return { game, source, target, energyCards };
}

function activate(game: GameState) {
  return activateCardAbility(game, P1, SOURCE_ID, ABILITY);
}

function confirmRecovery(game: GameState, cardId: string) {
  const confirming = confirmActiveEffectStep(game, P1, game.activeEffect!.id, cardId);
  expect(confirming.activeEffect?.stepId).toBe(PUBLIC_CARD_SELECTION_CONFIRMATION_STEP_ID);
  return confirmActiveEffectStep(confirming, P1, confirming.activeEffect!.id);
}

describe('PL!SP-bp7-010 费用2「薇恩・玛格丽特」', () => {
  it('registers exact activated UI text for every rarity of the base number', () => {
    const definition = findCardAbilityDefinitionById(ABILITY)!;
    expect(definition).toMatchObject({
      baseCardCodes: ['PL!SP-bp7-010'],
      category: CardAbilityCategory.ACTIVATED,
      sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
      queued: false,
      implemented: true,
    });
    expect(definition.effectText).toBe(EFFECT_TEXT);
    expect(definition.activatedUi?.text).toBe(EFFECT_TEXT);
  });

  it('pays only the self-sacrifice cost, returns one energy, then recovers any waiting-room card', () => {
    const scenario = setup();
    const selecting = activate(scenario.game);
    expect(selecting.players[0].memberSlots.slots[SlotPosition.CENTER]).toBeNull();
    expect(selecting.players[0].waitingRoom.cardIds).toEqual([
      scenario.target.instanceId,
      SOURCE_ID,
    ]);
    expect(selecting.players[0].energyZone.cardIds).toEqual([]);
    expect(selecting.players[0].energyDeck.cardIds).toEqual([scenario.energyCards[0]!.instanceId]);
    expect(selecting.activeEffect).toMatchObject({
      effectText: EFFECT_TEXT,
      selectableCardIds: [scenario.target.instanceId, SOURCE_ID],
      selectionLabel: '选择要加入手牌的卡',
      confirmSelectionLabel: '加入手牌',
      canSkipSelection: false,
    });

    const finished = confirmRecovery(selecting, scenario.target.instanceId);
    expect(finished.activeEffect).toBeNull();
    expect(finished.players[0].hand.cardIds).toContain(scenario.target.instanceId);
    expect(finished.players[0].waitingRoom.cardIds).toContain(SOURCE_ID);
    expect(
      finished.eventLog.filter(
        ({ event }) =>
          event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM &&
          event.fromZone === ZoneType.MEMBER_SLOT
      )
    ).toHaveLength(1);
    expect(
      finished.eventLog.filter(({ event }) => event.eventType === TriggerCondition.ON_LEAVE_STAGE)
    ).toHaveLength(1);
    expect(
      finished.eventLog.filter(
        ({ event }) => event.eventType === TriggerCondition.ON_ENERGY_MOVED_TO_DECK
      )
    ).toHaveLength(1);
    expect(
      finished.eventLog.filter(
        ({ event }) =>
          event.eventType === TriggerCondition.ON_ENTER_HAND &&
          event.fromZone === ZoneType.WAITING_ROOM
      )
    ).toHaveLength(1);
  });

  it('does not let missing downstream energy prevent the legal self-sacrifice cost or recovery', () => {
    const scenario = setup({ energyCount: 0 });
    const selecting = activate(scenario.game);
    expect(selecting.players[0].memberSlots.slots[SlotPosition.CENTER]).toBeNull();
    expect(selecting.players[0].waitingRoom.cardIds).toContain(SOURCE_ID);
    expect(selecting.activeEffect?.selectableCardIds).toEqual([
      scenario.target.instanceId,
      SOURCE_ID,
    ]);
    const finished = confirmRecovery(selecting, SOURCE_ID);
    expect(finished.players[0].hand.cardIds).toContain(SOURCE_ID);
    expect(
      finished.eventLog.filter(
        ({ event }) => event.eventType === TriggerCondition.ON_ENERGY_MOVED_TO_DECK
      )
    ).toEqual([]);
  });

  it('opens special-energy selection before committing the replayed cost and returns the chosen marked energy', () => {
    const scenario = setup({ energyCount: 2, markedIndex: 1 });
    const energySelection = activate(scenario.game);
    expect(energySelection.activeEffect).toMatchObject({
      stepId: ENERGY_OPERATION_SELECTION_STEP_ID,
      effectText: EFFECT_TEXT,
      selectableCardIds: scenario.energyCards.map((card) => card.instanceId),
      minSelectableCards: 1,
      maxSelectableCards: 1,
      selectionLabel: '选择要放回能量卡组的能量',
      confirmSelectionLabel: '放回能量卡组',
    });
    expect(energySelection.players[0].memberSlots.slots[SlotPosition.CENTER]).toBe(SOURCE_ID);

    const session = createGameSession();
    (session as unknown as { authorityState: GameState }).authorityState = energySelection;
    const commandResult = session.executeCommand(
      createConfirmEffectStepCommand(
        P1,
        energySelection.activeEffect!.id,
        scenario.energyCards[1]!.instanceId
      )
    );
    expect(commandResult.success, commandResult.error).toBe(true);
    const selected = session.state!;
    expect(selected.players[0].memberSlots.slots[SlotPosition.CENTER]).toBeNull();
    expect(selected.players[0].energyDeck.cardIds).toEqual([scenario.energyCards[1]!.instanceId]);
    expect(selected.players[0].energyZone.cardIds).toEqual([scenario.energyCards[0]!.instanceId]);
    expect(selected.activeEffect?.selectableCardIds).toContain(SOURCE_ID);
    expect(
      selected.actionHistory.filter(
        (action) => action.payload.abilityId === ABILITY && action.payload.step === 'ABILITY_USE'
      )
    ).toHaveLength(1);
    expect(
      selected.eventLog.filter(({ event }) => event.eventType === TriggerCondition.ON_LEAVE_STAGE)
    ).toHaveLength(1);
  });

  it('keeps the paid cost and returned energy when the chosen recovery target becomes stale', () => {
    const scenario = setup();
    const selecting = activate(scenario.game);
    const confirming = confirmActiveEffectStep(
      selecting,
      P1,
      selecting.activeEffect!.id,
      scenario.target.instanceId
    );
    const stale = updatePlayer(confirming, P1, (player) => ({
      ...player,
      waitingRoom: {
        ...player.waitingRoom,
        cardIds: player.waitingRoom.cardIds.filter(
          (cardId) => cardId !== scenario.target.instanceId
        ),
      },
    }));
    const finished = confirmActiveEffectStep(stale, P1, stale.activeEffect!.id);
    expect(finished.activeEffect).toBeNull();
    expect(finished.players[0].memberSlots.slots[SlotPosition.CENTER]).toBeNull();
    expect(finished.players[0].energyZone.cardIds).toEqual([]);
    expect(finished.players[0].energyDeck.cardIds).toEqual([scenario.energyCards[0]!.instanceId]);
    expect(finished.players[0].hand.cardIds).not.toContain(scenario.target.instanceId);
  });

  it('keeps a leave-stage pending behind the recovery and resumes it only after recovery completes', () => {
    const scenario = setup();
    const waitingTarget = member('TEST-WAITING-STAGE', '待机成员', 'waiting-stage-target');
    let game = registerCards(scenario.game, [waitingTarget]);
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(
        player.memberSlots,
        SlotPosition.LEFT,
        waitingTarget.instanceId,
        {
          orientation: OrientationState.WAITING,
          face: FaceState.FACE_UP,
        }
      ),
    }));
    const selecting = activate(game);
    const leaveEventEntry = selecting.eventLog.find(
      ({ event }) => event.eventType === TriggerCondition.ON_LEAVE_STAGE
    );
    expect(leaveEventEntry).toBeDefined();
    const withLeavePending: GameState = {
      ...selecting,
      pendingAbilities: [
        ...selecting.pendingAbilities,
        {
          id: 'follow-up-leave-stage',
          abilityId: PL_PR_001_002_ON_LEAVE_STAGE_ACTIVATE_MEMBER_ABILITY_ID,
          sourceCardId: SOURCE_ID,
          controllerId: P1,
          mandatory: true,
          timingId: TriggerCondition.ON_LEAVE_STAGE,
          eventIds: [leaveEventEntry!.event.eventId],
          sourceSlot: SlotPosition.CENTER,
          metadata: { toZone: ZoneType.WAITING_ROOM },
        },
      ],
    };
    const confirming = confirmActiveEffectStep(
      withLeavePending,
      P1,
      withLeavePending.activeEffect!.id,
      scenario.target.instanceId
    );
    expect(confirming.activeEffect?.stepId).toBe(PUBLIC_CARD_SELECTION_CONFIRMATION_STEP_ID);
    const continued = confirmActiveEffectStep(confirming, P1, confirming.activeEffect!.id);
    expect(continued.activeEffect).toMatchObject({
      abilityId: PL_PR_001_002_ON_LEAVE_STAGE_ACTIVATE_MEMBER_ABILITY_ID,
      sourceCardId: SOURCE_ID,
      selectableCardIds: [waitingTarget.instanceId],
    });
  });
});
