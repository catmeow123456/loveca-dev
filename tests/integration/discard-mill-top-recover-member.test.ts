import { describe, expect, it } from 'vitest';
import type { CardInstance, LiveCardData, MemberCardData } from '../../src/domain/entities/card';
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
import { addCardToZone, placeCardInSlot } from '../../src/domain/entities/zone';
import { resolvePendingCardEffects } from '../../src/application/card-effect-runner';
import {
  createAutoAdvancePublicCardSelectionCommand,
  createConfirmEffectStepCommand,
} from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import {
  BP5_010_LIVE_START_DISCARD_MILL_RECOVER_ARISE_MEMBER_ABILITY_ID,
  PL_N_BP1_009_ON_ENTER_OPTIONAL_DISCARD_MILL_TWO_RECOVER_MEMBER_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import {
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
  ZoneType,
} from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function member(code: string, id: string, groupNames: readonly string[] = ['虹ヶ咲'], owner = PLAYER1) {
  const data: MemberCardData = {
    cardCode: code,
    name: code,
    groupNames,
    cardType: CardType.MEMBER,
    cost: 5,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
  return createCardInstance(data, owner, id);
}

function live(code: string, id: string) {
  const data: LiveCardData = {
    cardCode: code,
    name: code,
    groupNames: ['虹ヶ咲'],
    cardType: CardType.LIVE,
    score: 3,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
  };
  return createCardInstance(data, PLAYER1, id);
}

interface ScenarioOptions {
  readonly abilityId?: string;
  readonly sourceCode?: string;
  readonly handCards?: readonly CardInstance[];
  readonly deckCards?: readonly CardInstance[];
  readonly waitingCards?: readonly CardInstance[];
  readonly sourceOnStage?: boolean;
}

function setup(options: ScenarioOptions = {}) {
  const abilityId =
    options.abilityId ??
    PL_N_BP1_009_ON_ENTER_OPTIONAL_DISCARD_MILL_TWO_RECOVER_MEMBER_ABILITY_ID;
  const source = member(
    options.sourceCode ?? 'PL!N-bp1-009-R',
    'source',
    abilityId === BP5_010_LIVE_START_DISCARD_MILL_RECOVER_ARISE_MEMBER_ABILITY_ID
      ? ["μ's"]
      : ['虹ヶ咲']
  );
  const handCards = options.handCards ?? [member('HAND', 'hand')];
  const deckCards = options.deckCards ?? [];
  const waitingCards = options.waitingCards ?? [];
  let game = registerCards(
    createGameState('discard-mill-recover', PLAYER1, 'P1', PLAYER2, 'P2'),
    [source, ...handCards, ...deckCards, ...waitingCards]
  );
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    memberSlots:
      options.sourceOnStage === false
        ? player.memberSlots
        : placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
            orientation: OrientationState.ACTIVE,
            face: FaceState.FACE_UP,
          }),
    hand: handCards.reduce((zone, card) => addCardToZone(zone, card.instanceId), player.hand),
    mainDeck: deckCards.reduce((zone, card) => addCardToZone(zone, card.instanceId), player.mainDeck),
    waitingRoom: waitingCards.reduce(
      (zone, card) => addCardToZone(zone, card.instanceId),
      player.waitingRoom
    ),
  }));
  const pending: PendingAbilityState = {
    id: `pending:${abilityId}`,
    abilityId,
    sourceCardId: source.instanceId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId:
      abilityId === BP5_010_LIVE_START_DISCARD_MILL_RECOVER_ARISE_MEMBER_ABILITY_ID
        ? TriggerCondition.ON_LIVE_START
        : TriggerCondition.ON_ENTER_STAGE,
    eventIds: ['event'],
  };
  return { game: { ...game, pendingAbilities: [pending] }, source, handCards, deckCards, waitingCards };
}

function sessionWithState(game: GameState) {
  let now = 10_000;
  const session = createGameSession({ now: () => now });
  session.createGame('discard-mill-recover-session', PLAYER1, 'P1', PLAYER2, 'P2');
  (session as unknown as { authorityState: GameState }).authorityState = game;
  return { session, setNow: (value: number) => (now = value) };
}

describe('discard/mill-top/recover-member shared family', () => {
  it('keeps the two configurations narrow and resolves Rina through shared public confirmation', () => {
    const discardedMember = member('DISCARDED-MEMBER', 'discarded-member');
    const milledLive = live('MILLED-LIVE', 'milled-live');
    const milledMember = member('MILLED-MEMBER', 'milled-member');
    const deckRemainder = member('DECK-REMAINDER', 'deck-remainder');
    const scenario = setup({
      handCards: [discardedMember],
      deckCards: [milledLive, milledMember, deckRemainder],
    });
    const started = resolvePendingCardEffects(scenario.game).gameState;
    expect(started.activeEffect).toMatchObject({
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
      confirmSelectionLabel: '放置入休息室',
      selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
    });
    expect(started.activeEffect?.selectableOptions).toBeUndefined();
    const { session, setNow } = sessionWithState(started);
    const discard = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, started.activeEffect!.id, discardedMember.instanceId)
    );
    expect(discard.success, discard.error).toBe(true);
    expect(session.state?.activeEffect).toMatchObject({
      selectionLabel: '选择要加入手牌的成员卡',
      confirmSelectionLabel: '加入手牌',
      selectableCardIds: [discardedMember.instanceId, milledMember.instanceId],
    });
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([
      discardedMember.instanceId,
      milledLive.instanceId,
      milledMember.instanceId,
    ]);
    expect(session.state?.players[0].mainDeck.cardIds).toEqual([deckRemainder.instanceId]);

    const recoveryEffect = session.state!.activeEffect!;
    expect(
      session.executeCommand(
        createConfirmEffectStepCommand(PLAYER1, recoveryEffect.id, milledMember.instanceId)
      ).success
    ).toBe(true);
    const reveal = session.state!.activeEffect!;
    const deadline = reveal.publicCardSelectionAutoAdvanceAt!;
    expect(reveal.stepId).toBe('COMMON_PUBLIC_CARD_SELECTION_CONFIRMATION');
    expect(session.state?.players[0].waitingRoom.cardIds).toContain(milledMember.instanceId);
    expect(session.state?.players[0].hand.cardIds).not.toContain(milledMember.instanceId);
    for (const playerId of [PLAYER1, PLAYER2]) {
      expect(session.getPlayerViewState(playerId)?.activeEffect).toMatchObject({
        revealedObjectIds: [`obj_${milledMember.instanceId}`],
        publicCardSelectionAutoAdvanceAt: deadline,
      });
    }
    expect(
      session.executeCommand(
        createAutoAdvancePublicCardSelectionCommand(PLAYER2, reveal.id, deadline)
      ).success
    ).toBe(false);
    setNow(deadline);
    expect(
      session.executeCommand(
        createAutoAdvancePublicCardSelectionCommand(PLAYER2, reveal.id, deadline)
      ).success
    ).toBe(true);
    expect(session.state?.players[0].hand.cardIds).toContain(milledMember.instanceId);
    expect(
      session.executeCommand(
        createAutoAdvancePublicCardSelectionCommand(PLAYER1, reveal.id, deadline)
      ).success
    ).toBe(false);

    const handEvent = session.state?.eventLog.find(
      ({ event }) => event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM && event.fromZone === ZoneType.HAND
    );
    const millEvent = session.state?.eventLog.find(
      ({ event }) => event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM && event.fromZone === ZoneType.MAIN_DECK
    );
    expect(handEvent?.event.cardInstanceIds).toEqual([discardedMember.instanceId]);
    expect(millEvent?.event.cardInstanceIds).toEqual([milledLive.instanceId, milledMember.instanceId]);
  });

  it('keeps Rina pending valid after source departure, while Honoka still requires stage presence', () => {
    const rina = setup({ sourceOnStage: false, handCards: [member('HAND', 'rina-hand')] });
    const rinaStarted = resolvePendingCardEffects(rina.game).gameState;
    expect(rinaStarted.activeEffect?.abilityId).toBe(
      PL_N_BP1_009_ON_ENTER_OPTIONAL_DISCARD_MILL_TWO_RECOVER_MEMBER_ABILITY_ID
    );

    const honoka = setup({
      abilityId: BP5_010_LIVE_START_DISCARD_MILL_RECOVER_ARISE_MEMBER_ABILITY_ID,
      sourceCode: 'PL!-bp5-010-N',
      sourceOnStage: false,
      handCards: [member('HAND', 'honoka-hand')],
    });
    const honokaResolved = resolvePendingCardEffects(honoka.game).gameState;
    expect(honokaResolved.activeEffect).toBeNull();
    expect(honokaResolved.pendingAbilities).toEqual([]);
  });

  it('supports decline/no-hand, rejects forged discard IDs, and keeps paid mill on no target', () => {
    const declineStarted = resolvePendingCardEffects(setup().game).gameState;
    const declined = sessionWithState(declineStarted).session;
    expect(
      declined.executeCommand(
        createConfirmEffectStepCommand(PLAYER1, declineStarted.activeEffect!.id)
      ).success
    ).toBe(true);
    expect(declined.state?.activeEffect).toBeNull();
    expect(declined.state?.players[0].waitingRoom.cardIds).toEqual([]);

    const noHand = resolvePendingCardEffects(setup({ handCards: [] }).game).gameState;
    expect(noHand.activeEffect).toBeNull();
    expect(noHand.pendingAbilities).toEqual([]);

    const discardLive = live('DISCARD-LIVE', 'discard-live');
    const deckLiveA = live('DECK-LIVE-A', 'deck-live-a');
    const deckLiveB = live('DECK-LIVE-B', 'deck-live-b');
    const deckRemainder = live('DECK-REMAINDER', 'deck-remainder');
    const started = resolvePendingCardEffects(
      setup({ handCards: [discardLive], deckCards: [deckLiveA, deckLiveB, deckRemainder] }).game
    ).gameState;
    const { session } = sessionWithState(started);
    expect(
      session.executeCommand(
        createConfirmEffectStepCommand(PLAYER1, started.activeEffect!.id, 'forged')
      ).success
    ).toBe(false);
    expect(session.state?.activeEffect?.stepId).toBe('PL_N_BP1_009_SELECT_HAND_CARD_TO_DISCARD');
    expect(
      session.executeCommand(
        createConfirmEffectStepCommand(PLAYER1, started.activeEffect!.id, discardLive.instanceId)
      ).success
    ).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([
      discardLive.instanceId,
      deckLiveA.instanceId,
      deckLiveB.instanceId,
    ]);
  });

  it('preserves Honoka mill-three and A-RISE-only semantics after promotion', () => {
    const discardedArise = member('DISCARD-ARISE', 'discard-arise', ['A-RISE']);
    const deckArise = member('DECK-ARISE', 'deck-arise', ['A-RISE']);
    const nonArise = member('NON-ARISE', 'non-arise');
    const liveArise = live('LIVE-ARISE', 'live-arise');
    const deckRemainder = live('DECK-REMAINDER', 'honoka-deck-remainder');
    const scenario = setup({
      abilityId: BP5_010_LIVE_START_DISCARD_MILL_RECOVER_ARISE_MEMBER_ABILITY_ID,
      sourceCode: 'PL!-bp5-010-N',
      handCards: [discardedArise],
      deckCards: [nonArise, deckArise, liveArise, deckRemainder],
    });
    const started = resolvePendingCardEffects(scenario.game).gameState;
    const { session } = sessionWithState(started);
    expect(
      session.executeCommand(
        createConfirmEffectStepCommand(PLAYER1, started.activeEffect!.id, discardedArise.instanceId)
      ).success
    ).toBe(true);
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([
      discardedArise.instanceId,
      deckArise.instanceId,
    ]);
    expect(
      session.state?.actionHistory.find(
        (action) => action.payload.abilityId === BP5_010_LIVE_START_DISCARD_MILL_RECOVER_ARISE_MEMBER_ABILITY_ID && action.payload.step === 'MILL_TOP_THREE'
      )?.payload.milledCardIds
    ).toEqual([nonArise.instanceId, deckArise.instanceId, liveArise.instanceId]);
  });

  it('rejects duplicate recovery input and resolves a stale public target without moving it', () => {
    const cost = member('COST', 'cost');
    const target = member('TARGET', 'target');
    const deckLive = live('DECK-LIVE', 'deck-live');
    const remainder = live('REMAINDER', 'remainder');
    const started = resolvePendingCardEffects(
      setup({ handCards: [cost], deckCards: [deckLive, target, remainder] }).game
    ).gameState;
    const { session, setNow } = sessionWithState(started);
    expect(
      session.executeCommand(
        createConfirmEffectStepCommand(PLAYER1, started.activeEffect!.id, cost.instanceId)
      ).success
    ).toBe(true);
    const recovery = session.state!.activeEffect!;
    expect(
      session.executeCommand(
        createConfirmEffectStepCommand(
          PLAYER1,
          recovery.id,
          undefined,
          undefined,
          undefined,
          undefined,
          [target.instanceId, target.instanceId]
        )
      ).success
    ).toBe(false);
    expect(
      session.executeCommand(
        createConfirmEffectStepCommand(PLAYER1, recovery.id, target.instanceId)
      ).success
    ).toBe(true);
    const reveal = session.state!.activeEffect!;
    const deadline = reveal.publicCardSelectionAutoAdvanceAt!;
    (session as unknown as { authorityState: GameState }).authorityState = updatePlayer(
      session.state!,
      PLAYER1,
      (player) => ({
        ...player,
        waitingRoom: {
          ...player.waitingRoom,
          cardIds: player.waitingRoom.cardIds.filter((cardId) => cardId !== target.instanceId),
        },
      })
    );
    setNow(deadline);
    expect(
      session.executeCommand(
        createAutoAdvancePublicCardSelectionCommand(PLAYER1, reveal.id, deadline)
      ).success
    ).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).not.toContain(target.instanceId);
  });
});
