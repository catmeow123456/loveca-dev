import { describe, expect, it } from 'vitest';
import type { EnergyCardData, LiveCardData, MemberCardData } from '../../src/domain/entities/card';
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
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import {
  createAutoAdvancePublicCardSelectionCommand,
  createConfirmEffectStepCommand,
} from '../../src/application/game-commands';
import { resolvePendingCardEffects } from '../../src/application/card-effect-runner';
import { createGameSession } from '../../src/application/game-session';
import {
  MEMBER_ON_ENTER_DRAW_ONE_ABILITY_ID,
  SP_BP1_007_ON_ENTER_ENERGY_ELEVEN_RECOVER_LIVE_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import { PUBLIC_CARD_SELECTION_CONFIRMATION_STEP_ID } from '../../src/application/card-effects/runtime/public-card-selection-confirmation';
import { createPublicObjectId, projectPlayerViewState } from '../../src/online/projector';
import {
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
} from '../../src/shared/types/enums';

const P1 = 'player1';
const P2 = 'player2';

function member(cardCode: string, name = cardCode): MemberCardData {
  return {
    cardCode,
    name,
    cardType: CardType.MEMBER,
    cost: 13,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.YELLOW, 1)],
  };
}

function live(cardCode: string): LiveCardData {
  return {
    cardCode,
    name: cardCode,
    cardType: CardType.LIVE,
    score: 1,
    requirements: createHeartRequirement({ [HeartColor.YELLOW]: 1 }),
    bladeHearts: [],
  };
}

function energy(cardCode: string): EnergyCardData {
  return { cardCode, name: cardCode, cardType: CardType.ENERGY };
}

function pending(sourceCardId: string): PendingAbilityState {
  return {
    id: 'sp-bp1-007-pending',
    abilityId: SP_BP1_007_ON_ENTER_ENERGY_ELEVEN_RECOVER_LIVE_ABILITY_ID,
    sourceCardId,
    controllerId: P1,
    timingId: TriggerCondition.ON_ENTER_STAGE,
    sourceSlot: SlotPosition.CENTER,
    eventIds: ['sp-bp1-007-enter-event'],
  };
}

function setup(options: {
  readonly energyCount: number;
  readonly waitingCards?: readonly (LiveCardData | MemberCardData)[];
  readonly waitingCardOwnerIds?: readonly string[];
}) {
  let now = 10_000;
  const source = createCardInstance(member('PL!SP-bp1-007-P', '米女メイ'), P1, 'source');
  const energyCards = Array.from({ length: options.energyCount }, (_, index) =>
    createCardInstance(energy(`ENERGY-${index}`), P1, `energy-${index}`)
  );
  const waitingCards = (options.waitingCards ?? []).map((data, index) =>
    createCardInstance(data, options.waitingCardOwnerIds?.[index] ?? P1, `waiting-${index}`)
  );
  let game = registerCards(createGameState('sp-bp1-007', P1, 'P1', P2, 'P2'), [
    source,
    ...energyCards,
    ...waitingCards,
  ]);
  game = updatePlayer(game, P1, (player) => ({
    ...player,
    energyZone: {
      ...player.energyZone,
      cardIds: energyCards.map((card) => card.instanceId),
      cardStates: new Map(
        energyCards.map((card, index) => [
          card.instanceId,
          {
            orientation: index % 2 === 0 ? OrientationState.ACTIVE : OrientationState.WAITING,
            face: FaceState.FACE_UP,
          },
        ])
      ),
    },
    waitingRoom: {
      ...player.waitingRoom,
      cardIds: waitingCards.map((card) => card.instanceId),
    },
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
  }));
  game = {
    ...game,
    energyActivePhaseSkips:
      energyCards.length > 0
        ? [
            {
              playerId: P1,
              energyCardId: energyCards[0]!.instanceId,
              sourceCardId: 'special-energy-marker-source',
              abilityId: 'special-energy-marker-ability',
              createdTurnCount: game.turnCount,
            },
          ]
        : [],
    pendingAbilities: [pending(source.instanceId)],
  };
  const resolved = resolvePendingCardEffects(game).gameState;
  const session = createGameSession({ now: () => now });
  session.createGame('sp-bp1-007-session', P1, 'P1', P2, 'P2');
  (session as unknown as { authorityState: GameState }).authorityState = resolved;
  return {
    session,
    source,
    energyCards,
    waitingCards,
    setNow(value: number) {
      now = value;
    },
  };
}

describe('PL!SP-bp1-007 waiting-room-to-hand shared workflow', () => {
  it('consumes the pending at ten energy without opening a selection window', () => {
    const { session } = setup({ energyCount: 10, waitingCards: [live('LIVE')] });
    expect(session.state?.pendingAbilities).toEqual([]);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.actionHistory.at(-1)?.payload).toMatchObject({
      abilityId: SP_BP1_007_ON_ENTER_ENERGY_ELEVEN_RECOVER_LIVE_ABILITY_ID,
      step: 'ENERGY_COUNT_BELOW_ELEVEN',
    });
  });

  it('counts ACTIVE, WAITING, and marked energy cards and forces exactly one LIVE target', () => {
    const { session, waitingCards } = setup({
      energyCount: 11,
      waitingCards: [live('LIVE-A'), member('MEMBER-A'), live('LIVE-B')],
    });
    expect(session.state?.activeEffect).toMatchObject({
      abilityId: SP_BP1_007_ON_ENTER_ENERGY_ELEVEN_RECOVER_LIVE_ABILITY_ID,
      stepText: '请选择自己休息室中1张LIVE卡加入手牌。',
      selectableCardIds: [waitingCards[0]!.instanceId, waitingCards[2]!.instanceId],
      canSkipSelection: false,
      metadata: {
        zoneSelection: {
          source: 'WAITING_ROOM',
          destination: 'HAND',
          minCount: 1,
          maxCount: 1,
          optional: false,
        },
      },
    });
  });

  it('safely consumes the pending when there is no LIVE target', () => {
    const { session } = setup({ energyCount: 11, waitingCards: [member('MEMBER')] });
    expect(session.state?.pendingAbilities).toEqual([]);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.actionHistory.at(-1)?.payload.step).toBe('NO_WAITING_ROOM_LIVE_TARGET');
  });

  it('does not offer a LIVE card owned by the opponent even if its id is in this waiting room', () => {
    const { session, waitingCards } = setup({
      energyCount: 11,
      waitingCards: [live('WRONG-OWNER-LIVE')],
      waitingCardOwnerIds: [P2],
    });
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].waitingRoom.cardIds).toContain(waitingCards[0]!.instanceId);
    expect(session.state?.actionHistory.at(-1)?.payload.step).toBe('NO_WAITING_ROOM_LIVE_TARGET');
  });

  it('reveals the chosen LIVE to both players, waits for the deadline, then moves it once', () => {
    const context = setup({ energyCount: 11, waitingCards: [live('LIVE-A'), live('LIVE-B')] });
    const targetId = context.waitingCards[0]!.instanceId;
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
    expect(context.session.state?.players[0].hand.cardIds).not.toContain(targetId);
    const publicId = createPublicObjectId(targetId);
    expect(
      projectPlayerViewState(context.session.state!, P1, { now: 10_000 }).activeEffect
    ).toMatchObject({ revealedObjectIds: [publicId], publicCardSelectionAutoAdvanceAt: 12_000 });
    expect(
      projectPlayerViewState(context.session.state!, P2, { now: 10_000 }).activeEffect
    ).toMatchObject({ revealedObjectIds: [publicId], publicCardSelectionAutoAdvanceAt: 12_000 });

    const continuationDraw = createCardInstance(
      member('CONTINUATION-DRAW'),
      P1,
      'continuation-draw'
    );
    let stateWithContinuation = registerCards(context.session.state!, [continuationDraw]);
    stateWithContinuation = updatePlayer(stateWithContinuation, P1, (player) => ({
      ...player,
      mainDeck: { ...player.mainDeck, cardIds: [continuationDraw.instanceId] },
    }));
    stateWithContinuation = {
      ...stateWithContinuation,
      pendingAbilities: [
        {
          id: 'continuation-pending',
          abilityId: MEMBER_ON_ENTER_DRAW_ONE_ABILITY_ID,
          sourceCardId: context.source.instanceId,
          controllerId: P1,
          timingId: TriggerCondition.ON_ENTER_STAGE,
          sourceSlot: SlotPosition.CENTER,
          eventIds: ['continuation-event'],
        },
      ],
    };
    (context.session as unknown as { authorityState: GameState }).authorityState =
      stateWithContinuation;

    context.setNow(11_999);
    expect(
      context.session.executeCommand(
        createAutoAdvancePublicCardSelectionCommand(P2, effectId, 12_000)
      ).success
    ).toBe(false);
    context.setNow(12_000);
    expect(
      context.session.executeCommand(
        createAutoAdvancePublicCardSelectionCommand(P2, effectId, 12_000)
      ).success
    ).toBe(true);
    expect(context.session.state?.activeEffect).toBeNull();
    expect(context.session.state?.pendingAbilities).toEqual([]);
    expect(context.session.state?.players[0].hand.cardIds).toEqual([
      targetId,
      continuationDraw.instanceId,
    ]);
    expect(
      context.session.executeCommand(
        createAutoAdvancePublicCardSelectionCommand(P1, effectId, 12_000)
      ).success
    ).toBe(false);
    expect(context.session.state?.players[0].hand.cardIds).toEqual([
      targetId,
      continuationDraw.instanceId,
    ]);
  });

  it('rejects illegal selection and does not move a stale revealed target', () => {
    const context = setup({
      energyCount: 11,
      waitingCards: [live('LIVE'), member('MEMBER')],
    });
    const effectId = context.session.state!.activeEffect!.id;
    const liveId = context.waitingCards[0]!.instanceId;
    const memberId = context.waitingCards[1]!.instanceId;
    expect(
      context.session.executeCommand(createConfirmEffectStepCommand(P1, effectId, memberId)).success
    ).toBe(false);
    expect(context.session.state?.players[0].waitingRoom.cardIds).toContain(liveId);
    expect(
      context.session.executeCommand(createConfirmEffectStepCommand(P1, effectId, liveId)).success
    ).toBe(true);
    (context.session as unknown as { authorityState: GameState }).authorityState = updatePlayer(
      context.session.state!,
      P1,
      (player) => ({
        ...player,
        waitingRoom: {
          ...player.waitingRoom,
          cardIds: player.waitingRoom.cardIds.filter((cardId) => cardId !== liveId),
        },
        mainDeck: { ...player.mainDeck, cardIds: [liveId, ...player.mainDeck.cardIds] },
      })
    );
    context.setNow(12_000);
    context.session.executeCommand(
      createAutoAdvancePublicCardSelectionCommand(P2, effectId, 12_000)
    );
    expect(context.session.state?.players[0].hand.cardIds).not.toContain(liveId);
    expect(context.session.state?.players[0].mainDeck.cardIds).toContain(liveId);
  });

  it.each(['OWNER', 'TYPE'] as const)(
    're-runs the current candidate selector after reveal when %s changes',
    (mutation) => {
      const context = setup({ energyCount: 11, waitingCards: [live('LIVE')] });
      const targetId = context.waitingCards[0]!.instanceId;
      const effectId = context.session.state!.activeEffect!.id;
      expect(
        context.session.executeCommand(createConfirmEffectStepCommand(P1, effectId, targetId))
          .success
      ).toBe(true);

      const currentState = context.session.state!;
      const currentCard = currentState.cardRegistry.get(targetId)!;
      const cardRegistry = new Map(currentState.cardRegistry);
      cardRegistry.set(
        targetId,
        mutation === 'OWNER'
          ? { ...currentCard, ownerId: P2 }
          : { ...currentCard, data: member('NO-LONGER-LIVE') }
      );
      (context.session as unknown as { authorityState: GameState }).authorityState = {
        ...currentState,
        cardRegistry,
      };

      context.setNow(12_000);
      expect(
        context.session.executeCommand(
          createAutoAdvancePublicCardSelectionCommand(P2, effectId, 12_000)
        ).success
      ).toBe(true);
      expect(context.session.state?.activeEffect).toBeNull();
      expect(context.session.state?.pendingAbilities).toEqual([]);
      expect(context.session.state?.players[0].waitingRoom.cardIds).toContain(targetId);
      expect(context.session.state?.players[0].hand.cardIds).not.toContain(targetId);
      expect(context.session.state?.actionHistory.at(-1)?.payload).toMatchObject({
        abilityId: SP_BP1_007_ON_ENTER_ENERGY_ELEVEN_RECOVER_LIVE_ABILITY_ID,
        step: 'STALE_SELECTION_NO_LONGER_ELIGIBLE',
        selectedCardIds: [targetId],
      });
    }
  );
});
