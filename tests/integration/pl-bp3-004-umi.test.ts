import { confirmActiveEffectStepThroughPublicReveal } from '../helpers/public-card-selection-confirmation';
import { describe, expect, it } from 'vitest';
import type { LiveCardData, MemberCardData } from '../../src/domain/entities/card';
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
import {
  addCardToZone,
  addMemberBelowMember,
  placeCardInSlot,
  removeCardFromZone,
} from '../../src/domain/entities/zone';
import {
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  PL_BP3_004_LIVE_START_DISCARD_RECOVER_MUSE_LIVE_ABILITY_ID,
  PL_BP3_004_ON_ENTER_DRAW_PER_STAGE_MEMBER_DISCARD_ONE_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
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
  name = cardCode,
  groupNames: readonly string[] = ["μ's"]
): MemberCardData {
  return {
    cardCode,
    name,
    groupNames,
    cardType: CardType.MEMBER,
    cost: 1,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.YELLOW, 1)],
  };
}

function live(
  cardCode: string,
  name = cardCode,
  groupNames: readonly string[] = ["μ's"]
): LiveCardData {
  return {
    cardCode,
    name,
    groupNames,
    cardType: CardType.LIVE,
    score: 1,
    requirements: createHeartRequirement({ [HeartColor.YELLOW]: 1 }),
  };
}

function pending(
  id: string,
  sourceCardId: string,
  abilityId:
    | typeof PL_BP3_004_ON_ENTER_DRAW_PER_STAGE_MEMBER_DISCARD_ONE_ABILITY_ID
    | typeof PL_BP3_004_LIVE_START_DISCARD_RECOVER_MUSE_LIVE_ABILITY_ID
): PendingAbilityState {
  return {
    id,
    abilityId,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId:
      abilityId === PL_BP3_004_ON_ENTER_DRAW_PER_STAGE_MEMBER_DISCARD_ONE_ABILITY_ID
        ? TriggerCondition.ON_ENTER_STAGE
        : TriggerCondition.ON_LIVE_START,
    eventIds: [`event-${id}`],
    sourceSlot: SlotPosition.CENTER,
  };
}

interface SetupOptions {
  readonly abilityId?:
    | typeof PL_BP3_004_ON_ENTER_DRAW_PER_STAGE_MEMBER_DISCARD_ONE_ABILITY_ID
    | typeof PL_BP3_004_LIVE_START_DISCARD_RECOVER_MUSE_LIVE_ABILITY_ID;
  readonly sourceOnStage?: boolean;
  readonly extraOwnStageMembers?: number;
  readonly includeMemberBelow?: boolean;
  readonly includeOpponentStageMember?: boolean;
  readonly handCards?: readonly ReturnType<typeof createCardInstance>[];
  readonly deckCards?: readonly ReturnType<typeof createCardInstance>[];
  readonly waitingCards?: readonly ReturnType<typeof createCardInstance>[];
  readonly hasSuccessfulLive?: boolean;
  readonly pendingCount?: number;
}

function setup(options: SetupOptions = {}) {
  const abilityId =
    options.abilityId ?? PL_BP3_004_ON_ENTER_DRAW_PER_STAGE_MEMBER_DISCARD_ONE_ABILITY_ID;
  const source = createCardInstance(
    member('PL!-bp3-004-P', '園田海未'),
    PLAYER1,
    'umi-source'
  );
  const extras = Array.from({ length: options.extraOwnStageMembers ?? 0 }, (_, index) =>
    createCardInstance(member(`OWN-STAGE-${index}`), PLAYER1, `own-stage-${index}`)
  );
  const below = createCardInstance(member('MEMBER-BELOW'), PLAYER1, 'member-below');
  const opponentMember = createCardInstance(
    member('OPPONENT-STAGE'),
    PLAYER2,
    'opponent-stage'
  );
  const successLive = createCardInstance(live('SUCCESS-LIVE'), PLAYER1, 'success-live');
  const handCards = options.handCards ?? [];
  const deckCards = options.deckCards ?? [];
  const waitingCards = options.waitingCards ?? [];
  const allCards = [
    source,
    ...extras,
    below,
    opponentMember,
    successLive,
    ...handCards,
    ...deckCards,
    ...waitingCards,
  ];
  let game = registerCards(
    createGameState('pl-bp3-004-umi', PLAYER1, 'P1', PLAYER2, 'P2'),
    allCards
  );
  game = updatePlayer(game, PLAYER1, (player) => {
    let memberSlots = player.memberSlots;
    if (options.sourceOnStage !== false) {
      memberSlots = placeCardInSlot(memberSlots, SlotPosition.CENTER, source.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      });
    }
    const availableSlots = [SlotPosition.LEFT, SlotPosition.RIGHT];
    extras.slice(0, availableSlots.length).forEach((card, index) => {
      memberSlots = placeCardInSlot(memberSlots, availableSlots[index]!, card.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      });
    });
    if (options.includeMemberBelow) {
      memberSlots = addMemberBelowMember(memberSlots, SlotPosition.CENTER, below.instanceId);
    }
    return {
      ...player,
      memberSlots,
      hand: handCards.reduce((zone, card) => addCardToZone(zone, card.instanceId), player.hand),
      mainDeck: deckCards.reduce(
        (zone, card) => addCardToZone(zone, card.instanceId),
        player.mainDeck
      ),
      waitingRoom: [
        ...(options.sourceOnStage === false ? [source] : []),
        ...waitingCards,
      ].reduce((zone, card) => addCardToZone(zone, card.instanceId), player.waitingRoom),
      successZone:
        options.hasSuccessfulLive === true
          ? addCardToZone(player.successZone, successLive.instanceId)
          : player.successZone,
    };
  });
  if (options.includeOpponentStageMember) {
    game = updatePlayer(game, PLAYER2, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(
        player.memberSlots,
        SlotPosition.CENTER,
        opponentMember.instanceId,
        {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        }
      ),
    }));
  }
  game = {
    ...game,
    pendingAbilities: Array.from({ length: options.pendingCount ?? 1 }, (_, index) =>
      pending(`umi-pending-${index + 1}`, source.instanceId, abilityId)
    ),
  };
  return { game, source, extras, below, opponentMember, successLive };
}

function card(id: string, kind: 'member' | 'live' = 'member', groups: readonly string[] = ["μ's"]) {
  return createCardInstance(
    kind === 'member' ? member(`TEST-${id}`, id, groups) : live(`TEST-${id}`, id, groups),
    PLAYER1,
    id
  );
}

function resolve(game: GameState): GameState {
  return resolvePendingCardEffects(game).gameState;
}

function confirm(game: GameState, selectedCardId?: string | null): GameState {
  return confirmActiveEffectStepThroughPublicReveal(game, PLAYER1, game.activeEffect!.id, selectedCardId);
}

function enterWaitingRoomEvents(game: GameState) {
  return game.eventLog
    .map((entry) => entry.event)
    .filter((event) => event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM);
}

describe('PL!-bp3-004 園田海未 workflow', () => {
  it.each([1, 2, 3])(
    'ON_ENTER counts %i current own main-stage members including the source and draws that many',
    (stageCount) => {
      const hand = card(`hand-${stageCount}`);
      const deckCards = Array.from({ length: 3 }, (_, index) => card(`draw-${stageCount}-${index}`));
      const scenario = setup({
        extraOwnStageMembers: stageCount - 1,
        handCards: [hand],
        deckCards,
      });

      const started = resolve(scenario.game);
      expect(started.activeEffect).toMatchObject({
        abilityId: PL_BP3_004_ON_ENTER_DRAW_PER_STAGE_MEMBER_DISCARD_ONE_ABILITY_ID,
        canSkipSelection: false,
      });
      expect(started.activeEffect?.metadata?.stageMemberCount).toBe(stageCount);
      expect(started.activeEffect?.metadata?.drawnCardIds).toEqual(
        deckCards.slice(0, stageCount).map((drawnCard) => drawnCard.instanceId)
      );
      expect(started.activeEffect?.selectableCardIds).toEqual([
        hand.instanceId,
        ...deckCards.slice(0, stageCount).map((drawnCard) => drawnCard.instanceId),
      ]);

      const finished = confirm(started, deckCards[0]!.instanceId);
      expect(finished.players[0].waitingRoom.cardIds).toContain(deckCards[0]!.instanceId);
      expect(enterWaitingRoomEvents(finished)).toHaveLength(1);
    }
  );

  it('does not count memberBelow or an opponent stage member', () => {
    const hand = card('count-filter-hand');
    const deckCards = [card('count-filter-draw-1'), card('count-filter-draw-2')];
    const scenario = setup({
      extraOwnStageMembers: 1,
      includeMemberBelow: true,
      includeOpponentStageMember: true,
      handCards: [hand],
      deckCards,
    });
    const started = resolve(scenario.game);

    expect(started.activeEffect?.metadata?.stageMemberCount).toBe(2);
    expect(started.activeEffect?.metadata?.drawnCardIds).toEqual(
      deckCards.map((drawnCard) => drawnCard.instanceId)
    );
  });

  it('continues after the source leaves, counts the current stage, and still discards after drawing zero', () => {
    const hand = card('source-left-hand');
    const scenario = setup({ sourceOnStage: false, handCards: [hand] });
    const started = resolve(scenario.game);

    expect(started.activeEffect?.metadata?.stageMemberCount).toBe(0);
    expect(started.activeEffect?.metadata?.drawnCardIds).toEqual([]);
    const finished = confirm(started, hand.instanceId);
    expect(finished.players[0].waitingRoom.cardIds).toEqual(
      expect.arrayContaining([scenario.source.instanceId, hand.instanceId])
    );
    expect(finished.pendingAbilities).toEqual([]);
  });

  it('draws only available cards and safely ends without an empty discard window when no hand remains', () => {
    const onlyDraw = card('only-available-draw');
    const withOneAvailable = resolve(
      setup({ extraOwnStageMembers: 2, deckCards: [onlyDraw] }).game
    );
    expect(withOneAvailable.activeEffect?.metadata?.drawnCardIds).toEqual([onlyDraw.instanceId]);
    expect(withOneAvailable.activeEffect?.selectableCardIds).toEqual([onlyDraw.instanceId]);

    const noHand = resolve(setup({ sourceOnStage: false }).game);
    expect(noHand.activeEffect).toBeNull();
    expect(noHand.pendingAbilities).toEqual([]);
    expect(
      noHand.actionHistory.some(
        (action) =>
          action.payload.abilityId ===
            PL_BP3_004_ON_ENTER_DRAW_PER_STAGE_MEMBER_DISCARD_ONE_ABILITY_ID &&
          action.payload.step === 'DRAW_NO_HAND_TO_DISCARD'
      )
    ).toBe(true);
  });

  it('uses the normal draw helper refresh boundary before opening the mandatory discard', () => {
    const refreshCard = card('refresh-draw-card');
    const started = resolve(setup({ waitingCards: [refreshCard] }).game);

    expect(started.activeEffect?.metadata?.stageMemberCount).toBe(1);
    expect(started.activeEffect?.metadata?.drawnCardIds).toEqual([refreshCard.instanceId]);
    expect(started.activeEffect?.selectableCardIds).toEqual([refreshCard.instanceId]);
    expect(
      started.actionHistory.some(
        (action) => action.type === 'RULE_ACTION' && action.payload.type === 'REFRESH'
      )
    ).toBe(true);
  });

  it('rejects stale/illegal ON_ENTER discard choices and emits only one event for the real discard', () => {
    const hand = card('legal-discard');
    const illegal = card('illegal-discard');
    let scenario = setup({ handCards: [hand], deckCards: [illegal] });
    let started = resolve(scenario.game);
    const unknownResult = confirm(started, 'unknown-card');
    expect(unknownResult).toBe(started);

    started = updatePlayer(started, PLAYER1, (player) => ({
      ...player,
      hand: removeCardFromZone(player.hand, hand.instanceId),
    }));
    const staleResult = confirm(started, hand.instanceId);
    expect(staleResult.activeEffect).toEqual(started.activeEffect);

    scenario = setup({ handCards: [hand], deckCards: [illegal] });
    const finished = confirm(resolve(scenario.game), illegal.instanceId);
    expect(enterWaitingRoomEvents(finished)).toHaveLength(1);
  });

  it.each([
    { name: '无成功LIVE', hasSuccessfulLive: false, hand: true },
    { name: '无手牌', hasSuccessfulLive: true, hand: false },
  ])('LIVE_START $name 时安全消费且不开空窗口', ({ hasSuccessfulLive, hand }) => {
    const handCard = card('live-gate-hand');
    const resolved = resolve(
      setup({
        abilityId: PL_BP3_004_LIVE_START_DISCARD_RECOVER_MUSE_LIVE_ABILITY_ID,
        hasSuccessfulLive,
        handCards: hand ? [handCard] : [],
      }).game
    );
    expect(resolved.activeEffect).toBeNull();
    expect(resolved.pendingAbilities).toEqual([]);
    expect(enterWaitingRoomEvents(resolved)).toEqual([]);
  });

  it('allows declining LIVE_START without discarding or recovering', () => {
    const hand = card('decline-hand');
    const waitingLive = card('decline-waiting-live', 'live');
    const started = resolve(
      setup({
        abilityId: PL_BP3_004_LIVE_START_DISCARD_RECOVER_MUSE_LIVE_ABILITY_ID,
        hasSuccessfulLive: true,
        handCards: [hand],
        waitingCards: [waitingLive],
      }).game
    );
    expect(started.activeEffect).toMatchObject({
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
    });
    const declined = confirm(started, null);
    expect(declined.players[0].hand.cardIds).toEqual([hand.instanceId]);
    expect(declined.players[0].waitingRoom.cardIds).toEqual([waitingLive.instanceId]);
    expect(enterWaitingRoomEvents(declined)).toEqual([]);
  });

  it("can recover the just-discarded μ's LIVE and filters non-LIVE/non-μ's cards", () => {
    const discardedMuseLive = card('discarded-muse-live', 'live');
    const otherMuseLive = card('other-muse-live', 'live');
    const museMember = card('muse-member');
    const aqoursLive = card('aqours-live', 'live', ['Aqours']);
    const started = resolve(
      setup({
        abilityId: PL_BP3_004_LIVE_START_DISCARD_RECOVER_MUSE_LIVE_ABILITY_ID,
        hasSuccessfulLive: true,
        handCards: [discardedMuseLive],
        waitingCards: [otherMuseLive, museMember, aqoursLive],
      }).game
    );
    const recovery = confirm(started, discardedMuseLive.instanceId);

    expect(recovery.activeEffect).toMatchObject({
      selectableCardIds: [otherMuseLive.instanceId, discardedMuseLive.instanceId],
      canSkipSelection: false,
      confirmSelectionLabel: '加入手牌',
    });
    expect(enterWaitingRoomEvents(recovery)).toHaveLength(1);
    const finished = confirm(recovery, discardedMuseLive.instanceId);
    expect(finished.players[0].hand.cardIds).toEqual([discardedMuseLive.instanceId]);
    expect(finished.players[0].waitingRoom.cardIds).toEqual([
      otherMuseLive.instanceId,
      museMember.instanceId,
      aqoursLive.instanceId,
    ]);
  });

  it('keeps the paid discard and ends when no legal recovery target exists', () => {
    const hand = card('paid-no-target');
    const finished = confirm(
      resolve(
        setup({
          abilityId: PL_BP3_004_LIVE_START_DISCARD_RECOVER_MUSE_LIVE_ABILITY_ID,
          hasSuccessfulLive: true,
          handCards: [hand],
        }).game
      ),
      hand.instanceId
    );
    expect(finished.activeEffect).toBeNull();
    expect(finished.players[0].waitingRoom.cardIds).toContain(hand.instanceId);
    expect(
      finished.actionHistory.some(
        (action) => action.payload.step === 'PAID_COST_NO_MUSE_LIVE_TO_RECOVER'
      )
    ).toBe(true);
  });

  it('rescans recovery candidates after payment and rejects stale recovery choices', () => {
    const hand = card('rescan-hand');
    const appears = card('appears-live', 'live');
    let scenario = setup({
      abilityId: PL_BP3_004_LIVE_START_DISCARD_RECOVER_MUSE_LIVE_ABILITY_ID,
      hasSuccessfulLive: true,
      handCards: [hand],
      waitingCards: [appears],
    });
    let started = resolve(scenario.game);
    started = updatePlayer(started, PLAYER1, (player) => ({
      ...player,
      waitingRoom: removeCardFromZone(player.waitingRoom, appears.instanceId),
    }));
    const disappeared = confirm(started, hand.instanceId);
    expect(disappeared.activeEffect).toBeNull();

    scenario = setup({
      abilityId: PL_BP3_004_LIVE_START_DISCARD_RECOVER_MUSE_LIVE_ABILITY_ID,
      hasSuccessfulLive: true,
      handCards: [hand],
      waitingCards: [appears],
    });
    started = resolve(
      updatePlayer(scenario.game, PLAYER1, (player) => ({
        ...player,
        waitingRoom: removeCardFromZone(player.waitingRoom, appears.instanceId),
      }))
    );
    started = updatePlayer(started, PLAYER1, (player) => ({
      ...player,
      waitingRoom: addCardToZone(player.waitingRoom, appears.instanceId),
    }));
    const appeared = confirm(started, hand.instanceId);
    expect(appeared.activeEffect?.selectableCardIds).toEqual([appears.instanceId]);

    const stale = updatePlayer(appeared, PLAYER1, (player) => ({
      ...player,
      waitingRoom: removeCardFromZone(player.waitingRoom, appears.instanceId),
    }));
    const staleResult = confirm(stale, appears.instanceId);
    expect(staleResult.activeEffect).toEqual(stale.activeEffect);
    expect(staleResult.players[0].hand.cardIds).not.toContain(appears.instanceId);
  });

  it('LIVE_START continues after the source leaves and preserves manual/ordered multi-pending flow', () => {
    const hand1 = card('multi-hand-1');
    const hand2 = card('multi-hand-2');
    const scenario = setup({
      abilityId: PL_BP3_004_LIVE_START_DISCARD_RECOVER_MUSE_LIVE_ABILITY_ID,
      sourceOnStage: false,
      hasSuccessfulLive: true,
      handCards: [hand1, hand2],
      pendingCount: 2,
    });
    const orderSelection = resolve(scenario.game);
    expect(orderSelection.activeEffect?.canResolveInOrder).toBe(true);

    let manual = confirmActiveEffectStepThroughPublicReveal(
      orderSelection,
      PLAYER1,
      orderSelection.activeEffect!.id,
      null,
      null,
      false,
      'umi-pending-2'
    );
    expect(manual.activeEffect?.id).toBe('umi-pending-2');
    manual = confirm(manual, null);
    expect(manual.activeEffect?.id).toBe('umi-pending-1');
    manual = confirm(manual, null);
    expect(manual.activeEffect).toBeNull();
    expect(manual.pendingAbilities).toEqual([]);

    const orderedSelection = resolve(scenario.game);
    let ordered = confirmActiveEffectStepThroughPublicReveal(
      orderedSelection,
      PLAYER1,
      orderedSelection.activeEffect!.id,
      null,
      null,
      true
    );
    expect(ordered.activeEffect?.id).toBe('umi-pending-1');
    ordered = confirm(ordered, null);
    expect(ordered.activeEffect?.id).toBe('umi-pending-2');
    ordered = confirm(ordered, null);
    expect(ordered.activeEffect).toBeNull();
    expect(ordered.pendingAbilities).toEqual([]);
  });
});
