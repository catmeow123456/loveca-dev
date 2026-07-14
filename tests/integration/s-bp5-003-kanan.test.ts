import { confirmPublicSelectionIfNeeded } from '../helpers/public-card-selection-confirmation';
import { describe, expect, it } from 'vitest';
import type { AnyCardData, LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
  type CardInstance,
} from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { addCardToZone, placeCardInSlot } from '../../src/domain/entities/zone';
import { createConfirmEffectStepCommand } from '../../src/application/game-commands';
import { createGameSession, type GameSession } from '../../src/application/game-session';
import { resolvePendingCardEffects } from '../../src/application/card-effect-runner';
import {
  HS_PB1_003_AUTO_HAND_TO_WAITING_GAIN_HEART_BLADE_ABILITY_ID,
  PL_S_BP5_003_ON_ENTER_DISCARD_NO_BLADE_HEART_MEMBERS_RECOVER_AQOURS_LIVE_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import {
  BladeHeartEffect,
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
  options: {
    readonly name?: string;
    readonly groupNames?: readonly string[];
    readonly bladeHearts?: MemberCardData['bladeHearts'];
  } = {}
): MemberCardData {
  return {
    cardCode,
    name: options.name ?? cardCode,
    groupNames: options.groupNames ?? ['Aqours'],
    cardType: CardType.MEMBER,
    cost: 13,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.BLUE, 1)],
    bladeHearts: options.bladeHearts ?? [],
  };
}

function live(cardCode: string, groupNames: readonly string[] = ['Aqours']): LiveCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames,
    cardType: CardType.LIVE,
    score: 3,
    requirements: createHeartRequirement({ [HeartColor.BLUE]: 1 }),
  };
}

function instance<TData extends AnyCardData>(
  data: TData,
  id: string,
  ownerId = PLAYER1
): CardInstance<TData> {
  return createCardInstance(data, ownerId, id);
}

function pending(sourceCardId: string, id = 's-bp5-003-pending'): PendingAbilityState {
  return {
    id,
    abilityId: PL_S_BP5_003_ON_ENTER_DISCARD_NO_BLADE_HEART_MEMBERS_RECOVER_AQOURS_LIVE_ABILITY_ID,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId: TriggerCondition.ON_ENTER_STAGE,
    eventIds: [`event:${id}`],
    sourceSlot: SlotPosition.CENTER,
  };
}

function sessionWithState(game: GameState): GameSession {
  const session = createGameSession();
  session.createGame('s-bp5-003-kanan', PLAYER1, 'P1', PLAYER2, 'P2');
  (session as unknown as { authorityState: GameState }).authorityState = game;
  return session;
}

function setup(options: {
  readonly handCards?: readonly CardInstance<AnyCardData>[];
  readonly waitingCards?: readonly CardInstance<AnyCardData>[];
  readonly extraStageCards?: readonly CardInstance<AnyCardData>[];
  readonly extraPending?: readonly PendingAbilityState[];
} = {}) {
  const source = instance(member('PL!S-bp5-003-R', { name: '松浦果南' }), 'kanan-source');
  const handCards =
    options.handCards ??
    [instance(member('PL!S-test-no-blade-member'), 'discard-member-1')];
  const waitingCards =
    options.waitingCards ?? [instance(live('PL!S-test-aqours-live-L'), 'aqours-live-1')];
  const cards = [source, ...handCards, ...waitingCards, ...(options.extraStageCards ?? [])];
  let game = registerCards(createGameState('s-bp5-003-kanan', PLAYER1, 'P1', PLAYER2, 'P2'), cards);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    hand: handCards.reduce((zone, card) => addCardToZone(zone, card.instanceId), player.hand),
    waitingRoom: waitingCards.reduce(
      (zone, card) => addCardToZone(zone, card.instanceId),
      player.waitingRoom
    ),
    memberSlots: placeCardsInStage(player.memberSlots, source, options.extraStageCards ?? []),
  }));
  return {
    game: {
      ...game,
      pendingAbilities: [pending(source.instanceId), ...(options.extraPending ?? [])],
    },
    source,
    handCards,
    waitingCards,
  };
}

function placeCardsInStage(
  memberSlots: GameState['players'][number]['memberSlots'],
  source: CardInstance<AnyCardData>,
  extraStageCards: readonly CardInstance<AnyCardData>[]
): GameState['players'][number]['memberSlots'] {
  let slots = placeCardInSlot(memberSlots, SlotPosition.CENTER, source.instanceId, {
    orientation: OrientationState.ACTIVE,
    face: FaceState.FACE_UP,
  });
  const positions = [SlotPosition.RIGHT, SlotPosition.LEFT];
  for (const [index, card] of extraStageCards.entries()) {
    slots = placeCardInSlot(slots, positions[index] ?? SlotPosition.RIGHT, card.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    });
  }
  return slots;
}

function start(game: GameState): GameState {
  return resolvePendingCardEffects(game).gameState;
}

describe('PL!S-bp5-003 松浦果南', () => {
  it('can skip when there is no eligible hand card or no recoverable Aqours LIVE', () => {
    const noHand = start(setup({ handCards: [] }).game);
    expect(noHand.activeEffect).toMatchObject({
      abilityId: PL_S_BP5_003_ON_ENTER_DISCARD_NO_BLADE_HEART_MEMBERS_RECOVER_AQOURS_LIVE_ABILITY_ID,
      selectableCardIds: [],
      canSkipSelection: true,
    });
    const noHandSkip = sessionWithState(noHand).executeCommand(
      createConfirmEffectStepCommand(PLAYER1, noHand.activeEffect!.id)
    );
    expect(noHandSkip.success, noHandSkip.error).toBe(true);
    expect(noHandSkip.gameState.activeEffect).toBeNull();

    const noRecover = start(setup({ waitingCards: [] }).game);
    expect(noRecover.activeEffect).toMatchObject({
      selectableCardIds: [],
      canSkipSelection: true,
    });
    const noRecoverSkip = sessionWithState(noRecover).executeCommand(
      createConfirmEffectStepCommand(PLAYER1, noRecover.activeEffect!.id)
    );
    expect(noRecoverSkip.success, noRecoverSkip.error).toBe(true);
    expect(noRecoverSkip.gameState.activeEffect).toBeNull();
  });

  it('discards one no-BLADE HEART member and recovers one Aqours LIVE', () => {
    const hand = instance(member('PL!S-test-no-blade-member'), 'discard-member-1');
    const target = instance(live('PL!S-test-aqours-live-L'), 'aqours-live-1');
    const triggerSource = instance(
      member('PL!HS-pb1-003-R', { name: '大沢瑠璃乃', groupNames: ['蓮ノ空'] }),
      'trigger-source'
    );
    const started = start(
      setup({
        handCards: [hand],
        waitingCards: [target],
        extraStageCards: [triggerSource],
      }).game
    );

    expect(started.activeEffect?.selectableCardIds).toEqual([hand.instanceId]);
    const session = sessionWithState(started);
    const discard = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, started.activeEffect!.id, hand.instanceId)
    );
    expect(discard.success, discard.error).toBe(true);
    expect(session.state?.players[0].waitingRoom.cardIds).toContain(hand.instanceId);
    expect(session.state?.activeEffect).toMatchObject({
      stepId: 'PL_S_BP5_003_SELECT_AQOURS_LIVE_FROM_WAITING_ROOM',
      selectableCardIds: [target.instanceId],
    });

    const recover = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, target.instanceId)
    );
    expect(recover.success, recover.error).toBe(true);
    confirmPublicSelectionIfNeeded(session);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual([target.instanceId]);
    expect(session.state?.players[0].mainDeck.cardIds).toEqual([hand.instanceId]);
    expect(
      session.state?.eventLog.some(
        (entry) =>
          entry.event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM &&
          entry.event.cardInstanceId === hand.instanceId
      )
    ).toBe(true);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            HS_PB1_003_AUTO_HAND_TO_WAITING_GAIN_HEART_BLADE_ABILITY_ID &&
          action.payload.sourceCardId === triggerSource.instanceId
      )
    ).toBe(true);
  });

  it('discards two no-BLADE HEART members and recovers two Aqours LIVE cards', () => {
    const handCards = [
      instance(member('PL!S-test-no-blade-member-1'), 'discard-member-1'),
      instance(member('PL!S-test-no-blade-member-2'), 'discard-member-2'),
    ];
    const waitingCards = [
      instance(live('PL!S-test-aqours-live-1-L'), 'aqours-live-1'),
      instance(live('PL!S-test-aqours-live-2-L'), 'aqours-live-2'),
    ];
    const started = start(setup({ handCards, waitingCards }).game);
    expect(started.activeEffect?.maxSelectableCards).toBe(2);
    const session = sessionWithState(started);
    const discard = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        started.activeEffect!.id,
        undefined,
        undefined,
        undefined,
        undefined,
        handCards.map((card) => card.instanceId)
      )
    );
    expect(discard.success, discard.error).toBe(true);
    expect(session.state?.activeEffect?.minSelectableCards).toBe(2);
    expect(session.state?.activeEffect?.maxSelectableCards).toBe(2);

    const recover = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        undefined,
        undefined,
        undefined,
        undefined,
        waitingCards.map((card) => card.instanceId)
      )
    );
    expect(recover.success, recover.error).toBe(true);
    confirmPublicSelectionIfNeeded(session);
    expect(session.state?.players[0].hand.cardIds).toEqual(
      waitingCards.map((card) => card.instanceId)
    );
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual(
      handCards.map((card) => card.instanceId)
    );
  });

  it('rejects non-hand, non-member, BLADE HEART, duplicate, and stale discard selections', () => {
    const legal = instance(member('PL!S-test-no-blade-member'), 'legal-member');
    const nonMember = instance(live('PL!S-test-hand-live-L'), 'hand-live');
    const bladeMember = instance(
      member('PL!S-test-blade-member', {
        bladeHearts: [{ effect: BladeHeartEffect.SCORE }],
      }),
      'blade-member'
    );
    const offHand = instance(member('PL!S-test-off-hand-member'), 'off-hand-member');
    const target1 = instance(live('PL!S-test-aqours-live-1-L'), 'aqours-live-1');
    const target2 = instance(live('PL!S-test-aqours-live-2-L'), 'aqours-live-2');
    const started = start(
      setup({
        handCards: [legal, nonMember, bladeMember],
        waitingCards: [target1, target2, offHand],
      }).game
    );
    expect(started.activeEffect?.selectableCardIds).toEqual([legal.instanceId]);

    for (const invalidCardId of [nonMember.instanceId, bladeMember.instanceId, offHand.instanceId]) {
      const invalid = sessionWithState(started).executeCommand(
        createConfirmEffectStepCommand(PLAYER1, started.activeEffect!.id, invalidCardId)
      );
      expect(invalid.success).toBe(false);
    }

    const duplicate = sessionWithState(started).executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        started.activeEffect!.id,
        undefined,
        undefined,
        undefined,
        undefined,
        [legal.instanceId, legal.instanceId]
      )
    );
    expect(duplicate.success).toBe(false);

    const staleState = updatePlayer(started, PLAYER1, (player) => ({
      ...player,
      hand: { ...player.hand, cardIds: player.hand.cardIds.filter((id) => id !== legal.instanceId) },
      waitingRoom: addCardToZone(player.waitingRoom, legal.instanceId),
    }));
    const staleSession = sessionWithState(staleState);
    const stale = staleSession.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, staleState.activeEffect!.id, legal.instanceId)
    );
    expect(stale.success).toBe(false);
    expect(staleSession.state?.activeEffect).not.toBeNull();
  });

  it('limits discard count to recoverable Aqours LIVE count before payment', () => {
    const handCards = [
      instance(member('PL!S-test-no-blade-member-1'), 'discard-member-1'),
      instance(member('PL!S-test-no-blade-member-2'), 'discard-member-2'),
    ];
    const waitingCards = [instance(live('PL!S-test-aqours-live-1-L'), 'aqours-live-1')];
    const started = start(setup({ handCards, waitingCards }).game);
    expect(started.activeEffect?.maxSelectableCards).toBeUndefined();
    expect(started.activeEffect?.selectableCardMode).toBe('SINGLE');

    const tooMany = sessionWithState(started).executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        started.activeEffect!.id,
        undefined,
        undefined,
        undefined,
        undefined,
        handCards.map((card) => card.instanceId)
      )
    );
    expect(tooMany.success).toBe(false);
  });

  it('continues to the next pending ability after recovery finishes', () => {
    const source2 = instance(member('PL!S-bp5-003-P', { name: '松浦果南' }), 'kanan-source-2');
    const handCards = [
      instance(member('PL!S-test-no-blade-member-1'), 'discard-member-1'),
      instance(member('PL!S-test-no-blade-member-2'), 'discard-member-2'),
      instance(member('PL!S-test-no-blade-member-3'), 'discard-member-3'),
    ];
    const waitingCards = [
      instance(live('PL!S-test-aqours-live-1-L'), 'aqours-live-1'),
      instance(live('PL!S-test-aqours-live-2-L'), 'aqours-live-2'),
      instance(live('PL!S-test-aqours-live-3-L'), 'aqours-live-3'),
    ];
    const base = setup({
      handCards,
      waitingCards,
      extraStageCards: [source2],
      extraPending: [pending(source2.instanceId, 's-bp5-003-pending-2')],
    });
    const started = start(base.game);
    const session = sessionWithState(started);
    if (session.state?.activeEffect?.abilityId === 'system:select-pending-card-effect') {
      const orderResult = session.executeCommand(
        createConfirmEffectStepCommand(
          PLAYER1,
          session.state.activeEffect.id,
          undefined,
          undefined,
          true
        )
      );
      expect(orderResult.success, orderResult.error).toBe(true);
    }
    expect(session.state?.activeEffect?.sourceCardId).toBe(base.source.instanceId);

    const firstDiscard = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        undefined,
        undefined,
        undefined,
        undefined,
        [handCards[0]!.instanceId, handCards[1]!.instanceId]
      )
    );
    expect(firstDiscard.success, firstDiscard.error).toBe(true);
    expect(
      session.executeCommand(
        createConfirmEffectStepCommand(
          PLAYER1,
          session.state!.activeEffect!.id,
          undefined,
          undefined,
          undefined,
          undefined,
          [waitingCards[0]!.instanceId, waitingCards[1]!.instanceId]
        )
      ).success
    ).toBe(true);

    expect(session.state?.activeEffect?.abilityId).toBe(
      PL_S_BP5_003_ON_ENTER_DISCARD_NO_BLADE_HEART_MEMBERS_RECOVER_AQOURS_LIVE_ABILITY_ID
    );
    confirmPublicSelectionIfNeeded(session);
    expect(session.state?.activeEffect?.sourceCardId).toBe(source2.instanceId);
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([]);
  });
});
