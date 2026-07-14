import { confirmActiveEffectStepThroughPublicReveal } from '../helpers/public-card-selection-confirmation';
import { describe, expect, it } from 'vitest';
import type { LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
} from '../../src/domain/entities/card';
import {
  addAction,
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import {
  addCardToZone,
  placeCardInSlot,
  removeCardFromSlot,
  removeCardFromZone,
} from '../../src/domain/entities/zone';
import {
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { PL_BP3_003_ON_ENTER_WAIT_SELF_RECOVER_MUSE_MEMBER_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import {
  finishPlBp3003KotoriWaitSelfCost,
  startPlBp3003KotoriOnEnter,
} from '../../src/application/card-effects/workflows/cards/pl-bp3-003-kotori';
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

function member(
  cardCode: string,
  name: string,
  groupNames: readonly string[] = ["μ's"]
): MemberCardData {
  return {
    cardCode,
    name,
    groupNames,
    cardType: CardType.MEMBER,
    cost: 3,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.YELLOW, 1)],
  };
}

function live(cardCode: string, groupNames: readonly string[] = ["μ's"]): LiveCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames,
    cardType: CardType.LIVE,
    score: 1,
    requirements: createHeartRequirement({ [HeartColor.YELLOW]: 1 }),
  };
}

function pending(id: string, sourceCardId: string): PendingAbilityState {
  return {
    id,
    abilityId: PL_BP3_003_ON_ENTER_WAIT_SELF_RECOVER_MUSE_MEMBER_ABILITY_ID,
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
    readonly sourceCode?: 'PL!-bp3-003-P' | 'PL!-bp3-003-R';
    readonly sourceOrientation?: OrientationState;
    readonly sourceOnStage?: boolean;
    readonly waitingCards?: readonly ReturnType<typeof createCardInstance>[];
    readonly pendingCount?: number;
  } = {}
) {
  const source = createCardInstance(
    member(options.sourceCode ?? 'PL!-bp3-003-P', '南ことり'),
    PLAYER1,
    'kotori-source'
  );
  const waitingCards = options.waitingCards ?? [];
  let game = createGameState('pl-bp3-003-kotori', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [source, ...waitingCards]);
  game = updatePlayer(game, PLAYER1, (player) => {
    let memberSlots = player.memberSlots;
    if (options.sourceOnStage !== false) {
      memberSlots = placeCardInSlot(memberSlots, SlotPosition.CENTER, source.instanceId, {
        orientation: options.sourceOrientation ?? OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      });
    }
    return {
      ...player,
      memberSlots,
      waitingRoom: waitingCards.reduce(
        (zone, card) => addCardToZone(zone, card.instanceId),
        player.waitingRoom
      ),
    };
  });
  game = {
    ...game,
    pendingAbilities: Array.from({ length: options.pendingCount ?? 1 }, (_, index) =>
      pending(`kotori-pending-${index + 1}`, source.instanceId)
    ),
  };
  return { game, source };
}

function resolve(game: GameState): GameState {
  return resolvePendingCardEffects(game).gameState;
}

function confirm(game: GameState, selectedCardId?: string | null): GameState {
  return confirmActiveEffectStepThroughPublicReveal(game, PLAYER1, game.activeEffect!.id, selectedCardId);
}

function chooseOption(game: GameState, selectedOptionId: string | null): GameState {
  return confirmActiveEffectStepThroughPublicReveal(
    game,
    PLAYER1,
    game.activeEffect!.id,
    undefined,
    undefined,
    undefined,
    selectedOptionId
  );
}

function orientation(game: GameState, cardId: string): OrientationState | undefined {
  return game.players[0].memberSlots.cardStates.get(cardId)?.orientation;
}

function memberStateChangedEvents(game: GameState, cardId?: string) {
  return game.eventLog
    .map((entry) => entry.event)
    .filter(
      (event) =>
        event.eventType === TriggerCondition.ON_MEMBER_STATE_CHANGED &&
        (!cardId || event.cardInstanceId === cardId)
    );
}

describe('PL!-bp3-003 南ことり workflow', () => {
  it("pays the optional wait cost once, filters structured μ's members, and forces one recovery", () => {
    const muse1 = createCardInstance(member('MUSE-1', '穗乃果'), PLAYER1, 'muse-1');
    const muse2 = createCardInstance(member('MUSE-2', '海未'), PLAYER1, 'muse-2');
    const aqours = createCardInstance(
      member('AQOURS', '千歌', ['Aqours']),
      PLAYER1,
      'aqours-member'
    );
    const museLive = createCardInstance(live('MUSE-LIVE'), PLAYER1, 'muse-live');
    const scenario = setup({ waitingCards: [muse1, muse2, aqours, museLive] });

    const costWindow = resolve(scenario.game);
    expect(costWindow.activeEffect).toMatchObject({
      abilityId: PL_BP3_003_ON_ENTER_WAIT_SELF_RECOVER_MUSE_MEMBER_ABILITY_ID,
      selectableOptions: [{ id: 'activate', label: '发动' }],
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
    });
    expect(costWindow.activeEffect?.selectableCardIds).toBeUndefined();
    expect(costWindow.activeEffect?.effectText).toContain('[BLADE]');

    const recoverWindow = chooseOption(costWindow, 'activate');
    expect(orientation(recoverWindow, scenario.source.instanceId)).toBe(OrientationState.WAITING);
    expect(memberStateChangedEvents(recoverWindow, scenario.source.instanceId)).toHaveLength(1);
    expect(recoverWindow.activeEffect).toMatchObject({
      selectableCardIds: [muse1.instanceId, muse2.instanceId],
      canSkipSelection: false,
      confirmSelectionLabel: '加入手牌',
    });
    const costAction = recoverWindow.actionHistory.find(
      (action) =>
        action.type === 'PAY_COST' &&
        action.payload.abilityId === PL_BP3_003_ON_ENTER_WAIT_SELF_RECOVER_MUSE_MEMBER_ABILITY_ID
    );
    expect(costAction?.payload.memberStateChangedEventIds).toEqual([
      memberStateChangedEvents(recoverWindow, scenario.source.instanceId)[0]?.eventId,
    ]);

    const finished = confirm(recoverWindow, muse2.instanceId);
    expect(finished.activeEffect).toBeNull();
    expect(finished.players[0].hand.cardIds).toContain(muse2.instanceId);
    expect(finished.players[0].waitingRoom.cardIds).toEqual([
      muse1.instanceId,
      aqours.instanceId,
      museLive.instanceId,
    ]);
  });

  it('declines without paying the cost, moving a card, or emitting a state event', () => {
    const muse = createCardInstance(member('MUSE', '穗乃果'), PLAYER1, 'muse');
    const scenario = setup({ sourceCode: 'PL!-bp3-003-R', waitingCards: [muse] });
    const declined = confirm(resolve(scenario.game), null);

    expect(orientation(declined, scenario.source.instanceId)).toBe(OrientationState.ACTIVE);
    expect(declined.players[0].waitingRoom.cardIds).toEqual([muse.instanceId]);
    expect(declined.players[0].hand.cardIds).toEqual([]);
    expect(memberStateChangedEvents(declined)).toEqual([]);
    expect(declined.pendingAbilities).toEqual([]);
  });

  it('rejects an unknown activation option without paying the cost', () => {
    const scenario = setup();
    const started = resolve(scenario.game);
    const invalid = chooseOption(started, 'unknown');

    expect(invalid).toBe(started);
    expect(orientation(invalid, scenario.source.instanceId)).toBe(OrientationState.ACTIVE);
    expect(memberStateChangedEvents(invalid)).toEqual([]);
    expect(invalid.actionHistory.some((action) => action.type === 'PAY_COST')).toBe(false);
  });

  it('keeps the paid cost and ends safely without opening an empty recovery selection', () => {
    const aqours = createCardInstance(
      member('AQOURS', '千歌', ['Aqours']),
      PLAYER1,
      'aqours-member'
    );
    const scenario = setup({ waitingCards: [aqours] });
    const finished = chooseOption(resolve(scenario.game), 'activate');

    expect(orientation(finished, scenario.source.instanceId)).toBe(OrientationState.WAITING);
    expect(finished.activeEffect).toBeNull();
    expect(finished.pendingAbilities).toEqual([]);
    expect(finished.players[0].hand.cardIds).toEqual([]);
    expect(
      finished.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.step === 'PAID_COST_NO_MUSE_MEMBER_TO_RECOVER'
      )
    ).toBe(true);
  });

  it.each([
    { name: '来源登场后已离场', sourceOnStage: false, sourceOrientation: OrientationState.ACTIVE },
    { name: '来源已为待机状态', sourceOnStage: true, sourceOrientation: OrientationState.WAITING },
  ])('$name 时不将费用视为已支付', ({ sourceOnStage, sourceOrientation }) => {
    const scenario = setup({ sourceOnStage, sourceOrientation });
    const finished = resolve(scenario.game);

    expect(finished.activeEffect).toBeNull();
    expect(finished.pendingAbilities).toEqual([]);
    expect(memberStateChangedEvents(finished)).toEqual([]);
    expect(finished.actionHistory.some((action) => action.type === 'PAY_COST')).toBe(false);
  });

  it('rechecks the source after the cost window opens and consumes a stale payment choice safely', () => {
    const scenario = setup();
    const started = resolve(scenario.game);
    const sourceLeft = updatePlayer(started, PLAYER1, (player) => ({
      ...player,
      memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.CENTER),
      waitingRoom: addCardToZone(player.waitingRoom, scenario.source.instanceId),
    }));
    const finished = chooseOption(sourceLeft, 'activate');

    expect(finished.activeEffect).toBeNull();
    expect(memberStateChangedEvents(finished)).toEqual([]);
    expect(finished.actionHistory.some((action) => action.type === 'PAY_COST')).toBe(false);
  });

  it('rescans after payment so newly present targets appear and disappeared targets do not', () => {
    const appears = createCardInstance(member('APPEARS', '穗乃果'), PLAYER1, 'appears');
    let scenario = setup({ waitingCards: [appears] });
    let started = resolve(scenario.game);
    started = updatePlayer(started, PLAYER1, (player) => ({
      ...player,
      waitingRoom: removeCardFromZone(player.waitingRoom, appears.instanceId),
    }));
    const absentAfterPayment = chooseOption(started, 'activate');
    expect(absentAfterPayment.activeEffect).toBeNull();

    scenario = setup({ waitingCards: [appears] });
    started = resolve(
      updatePlayer(scenario.game, PLAYER1, (player) => ({
        ...player,
        waitingRoom: removeCardFromZone(player.waitingRoom, appears.instanceId),
      }))
    );
    const targetAppears = updatePlayer(started, PLAYER1, (player) => ({
      ...player,
      waitingRoom: addCardToZone(player.waitingRoom, appears.instanceId),
    }));
    const presentAfterPayment = chooseOption(targetAppears, 'activate');
    expect(presentAfterPayment.activeEffect?.selectableCardIds).toEqual([appears.instanceId]);
  });

  it('does not move an illegal or stale recovery choice', () => {
    const legal = createCardInstance(member('LEGAL', '穗乃果'), PLAYER1, 'legal');
    const illegal = createCardInstance(member('ILLEGAL', '千歌', ['Aqours']), PLAYER1, 'illegal');
    const scenario = setup({ waitingCards: [legal, illegal] });
    const recoverWindow = chooseOption(resolve(scenario.game), 'activate');

    const illegalResult = confirm(recoverWindow, illegal.instanceId);
    expect(illegalResult).toBe(recoverWindow);
    const stale = updatePlayer(recoverWindow, PLAYER1, (player) => ({
      ...player,
      waitingRoom: removeCardFromZone(player.waitingRoom, legal.instanceId),
    }));
    const staleResult = confirm(stale, legal.instanceId);
    expect(staleResult.activeEffect).toEqual(stale.activeEffect);
    expect(staleResult.players[0].hand.cardIds).not.toContain(legal.instanceId);
  });

  it('records PAY_COST before enqueueing the one real member-state event', () => {
    const scenario = setup();
    const ability = scenario.game.pendingAbilities[0]!;
    const started = startPlBp3003KotoriOnEnter(scenario.game, ability, false, (state) => state);
    let recordedBeforeEnqueue = false;
    let eventCount = 0;

    const paid = finishPlBp3003KotoriWaitSelfCost(
      started,
      'activate',
      (state) => state,
      (state, triggerConditions, options) => {
        eventCount = options?.memberStateChangedEvents?.length ?? 0;
        recordedBeforeEnqueue = state.actionHistory.some(
          (action) =>
            action.type === 'PAY_COST' &&
            action.payload.abilityId ===
              PL_BP3_003_ON_ENTER_WAIT_SELF_RECOVER_MUSE_MEMBER_ABILITY_ID
        );
        return addAction(state, 'TRIGGER_ABILITY', PLAYER1, {
          abilityId: 'DOWNSTREAM_MEMBER_STATE_ASSERTION',
          triggerConditions,
        });
      }
    );

    expect(recordedBeforeEnqueue).toBe(true);
    expect(eventCount).toBe(1);
    expect(memberStateChangedEvents(paid, scenario.source.instanceId)).toHaveLength(1);
    expect(paid.actionHistory.findIndex((action) => action.type === 'PAY_COST')).toBeLessThan(
      paid.actionHistory.findIndex(
        (action) => action.payload.abilityId === 'DOWNSTREAM_MEMBER_STATE_ASSERTION'
      )
    );
  });

  it('preserves manual choice and ordered multi-pending continuity', () => {
    const scenario = setup({ pendingCount: 2 });
    const orderSelection = resolve(scenario.game);
    expect(orderSelection.activeEffect?.canResolveInOrder).toBe(true);

    let manual = confirmActiveEffectStepThroughPublicReveal(
      orderSelection,
      PLAYER1,
      orderSelection.activeEffect!.id,
      null,
      null,
      false,
      'kotori-pending-2'
    );
    expect(manual.activeEffect?.id).toBe('kotori-pending-2');
    manual = confirm(manual, null);
    expect(manual.activeEffect?.id).toBe('kotori-pending-1');
    manual = confirm(manual, null);
    expect(manual.activeEffect).toBeNull();
    expect(manual.pendingAbilities).toEqual([]);

    const orderedSelection = resolve(setup({ pendingCount: 2 }).game);
    let ordered = confirmActiveEffectStepThroughPublicReveal(
      orderedSelection,
      PLAYER1,
      orderedSelection.activeEffect!.id,
      null,
      null,
      true
    );
    expect(ordered.activeEffect?.id).toBe('kotori-pending-1');
    ordered = confirm(ordered, null);
    expect(ordered.activeEffect?.id).toBe('kotori-pending-2');
    ordered = confirm(ordered, null);
    expect(ordered.activeEffect).toBeNull();
    expect(ordered.pendingAbilities).toEqual([]);
  });
});
