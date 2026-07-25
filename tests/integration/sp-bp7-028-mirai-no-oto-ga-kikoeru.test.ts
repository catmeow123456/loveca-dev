import { describe, expect, it } from 'vitest';
import {
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  SP_BP7_028_LIVE_START_BOTTOM_NINE_LIELLA_MEMBERS_ALL_STAGE_GAIN_BLADE_ABILITY_ID,
  SP_BP7_028_LIVE_SUCCESS_ALL_CHEER_LIELLA_SCORE_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import { registerSpBp7028MiraiNoOtoGaKikoeruWorkflowHandlers } from '../../src/application/card-effects/workflows/cards/sp-bp7-028-mirai-no-oto-ga-kikoeru';
import {
  createAutoAdvancePublicCardSelectionCommand,
  createConfirmEffectStepCommand,
} from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
  type EnergyCardData,
  type LiveCardData,
  type MemberCardData,
} from '../../src/domain/entities/card';
import { createCheerEvent } from '../../src/domain/events/game-events';
import {
  createGameState,
  emitGameEvent,
  registerCards,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { addCardToStatefulZone, placeCardInSlot } from '../../src/domain/entities/zone';
import {
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
} from '../../src/shared/types/enums';

const P1 = 'p1';
const P2 = 'p2';
const LIVE_START_ABILITY_ID =
  SP_BP7_028_LIVE_START_BOTTOM_NINE_LIELLA_MEMBERS_ALL_STAGE_GAIN_BLADE_ABILITY_ID;
const LIVE_SUCCESS_ABILITY_ID = SP_BP7_028_LIVE_SUCCESS_ALL_CHEER_LIELLA_SCORE_ABILITY_ID;

registerSpBp7028MiraiNoOtoGaKikoeruWorkflowHandlers();

function sourceLive(id = 'future-sound') {
  const data: LiveCardData = {
    cardCode: 'PL!SP-bp7-028-L',
    name: '未来の音が聴こえる',
    groupNames: ['Liella!'],
    cardType: CardType.LIVE,
    score: 8,
    requirements: createHeartRequirement({ [HeartColor.RAINBOW]: 9 }),
  };
  return createCardInstance(data, P1, id);
}

function member(
  id: string,
  options: {
    readonly ownerId?: string;
    readonly groupNames?: readonly string[];
  } = {}
) {
  const data: MemberCardData = {
    cardCode: `TEST-${id}`,
    name: id,
    groupNames: options.groupNames ?? ['Liella!'],
    cardType: CardType.MEMBER,
    cost: 4,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PURPLE, 1)],
  };
  return createCardInstance(data, options.ownerId ?? P1, id);
}

function cheerLive(id: string, groupNames: readonly string[] = ['Liella!']) {
  const data: LiveCardData = {
    cardCode: `TEST-LIVE-${id}`,
    name: id,
    groupNames,
    cardType: CardType.LIVE,
    score: 1,
    requirements: createHeartRequirement({ [HeartColor.PURPLE]: 1 }),
  };
  return createCardInstance(data, P1, id);
}

function energy(id: string, groupNames: readonly string[] = ['Liella!']) {
  const data: EnergyCardData = {
    cardCode: `TEST-ENERGY-${id}`,
    name: id,
    groupNames,
    cardType: CardType.ENERGY,
  };
  return createCardInstance(data, P1, id);
}

function pending(
  abilityId: string,
  sourceCardId: string,
  id = `${abilityId}:pending`
): PendingAbilityState {
  return {
    id,
    abilityId,
    sourceCardId,
    controllerId: P1,
    mandatory: true,
    timingId:
      abilityId === LIVE_START_ABILITY_ID
        ? TriggerCondition.ON_LIVE_START
        : TriggerCondition.ON_LIVE_SUCCESS,
    eventIds: [],
  };
}

function setupLiveStart(candidateCount: number) {
  let now = 20_000;
  const source = sourceLive();
  const candidates = Array.from({ length: candidateCount }, (_, index) =>
    member(`liella-waiting-${index}`)
  );
  const nonLiella = member('aqours-waiting', { groupNames: ['Aqours'] });
  const deckCards = [member('deck-top'), member('deck-bottom')];
  const stageMembers = [
    member('stage-left', { groupNames: ['Aqours'] }),
    member('stage-center'),
    member('stage-right', { groupNames: ['虹ヶ咲'] }),
  ];
  let game = registerCards(createGameState('sp-bp7-028-live-start', P1, 'P1', P2, 'P2'), [
    source,
    ...candidates,
    nonLiella,
    ...deckCards,
    ...stageMembers,
  ]);
  game = updatePlayer(game, P1, (player) => {
    let memberSlots = player.memberSlots;
    for (const [index, stageMember] of stageMembers.entries()) {
      const slot = [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT][index]!;
      memberSlots = placeCardInSlot(memberSlots, slot, stageMember.instanceId, {
        orientation: index === 1 ? OrientationState.WAITING : OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      });
    }
    return {
      ...player,
      liveZone: addCardToStatefulZone(player.liveZone, source.instanceId),
      waitingRoom: {
        ...player.waitingRoom,
        cardIds: [...candidates.map((card) => card.instanceId), nonLiella.instanceId],
      },
      mainDeck: {
        ...player.mainDeck,
        cardIds: deckCards.map((card) => card.instanceId),
      },
      memberSlots,
    };
  });
  game = resolvePendingCardEffects({
    ...game,
    pendingAbilities: [pending(LIVE_START_ABILITY_ID, source.instanceId)],
  }).gameState;
  const session = createGameSession({ now: () => now });
  session.createGame('sp-bp7-028-session', P1, 'P1', P2, 'P2');
  (session as unknown as { authorityState: GameState }).authorityState = game;
  return {
    session,
    game,
    source,
    candidates,
    nonLiella,
    deckCards,
    stageMembers,
    setNow: (value: number) => {
      now = value;
    },
  };
}

function select(session: ReturnType<typeof createGameSession>, selectedCardIds: readonly string[]) {
  return session.executeCommand(
    createConfirmEffectStepCommand(
      P1,
      session.state!.activeEffect!.id,
      selectedCardIds.length === 0 ? null : undefined,
      undefined,
      undefined,
      undefined,
      selectedCardIds.length === 0 ? undefined : selectedCardIds
    )
  );
}

function expire(
  session: ReturnType<typeof createGameSession>,
  setNow: (value: number) => void,
  participantId = P2
) {
  const reveal = session.state!.activeEffect!;
  const deadline = reveal.publicCardSelectionAutoAdvanceAt!;
  setNow(deadline);
  return session.executeCommand(
    createAutoAdvancePublicCardSelectionCommand(participantId, reveal.id, deadline)
  );
}

function bladeModifiers(game: GameState) {
  return game.liveResolution.liveModifiers.filter(
    (modifier) => modifier.kind === 'BLADE' && modifier.abilityId === LIVE_START_ABILITY_ID
  );
}

function withCheerFacts(game: GameState, revealedCardIds: readonly string[]): GameState {
  const event = createCheerEvent(P1, revealedCardIds, revealedCardIds.length, {
    automated: true,
  });
  return emitGameEvent(
    {
      ...game,
      liveResolution: {
        ...game.liveResolution,
        firstPlayerCheerCardIds: revealedCardIds,
      },
    },
    event
  );
}

function setupLiveSuccess(revealedCards: readonly ReturnType<typeof createCardInstance>[]) {
  const source = sourceLive('success-source');
  let game = registerCards(createGameState('sp-bp7-028-live-success', P1, 'P1', P2, 'P2'), [
    source,
    ...revealedCards,
  ]);
  game = updatePlayer(game, P1, (player) => ({
    ...player,
    liveZone: addCardToStatefulZone(player.liveZone, source.instanceId),
  }));
  game = {
    ...game,
    liveResolution: {
      ...game.liveResolution,
      playerScores: new Map([[P1, 8]]),
    },
  };
  if (revealedCards.length > 0) {
    game = withCheerFacts(
      game,
      revealedCards.map((card) => card.instanceId)
    );
  }
  return { game, source };
}

function resolveSuccess(game: GameState, sourceCardId: string, pendingId: string): GameState {
  const selecting = resolvePendingCardEffects({
    ...game,
    pendingAbilities: [pending(LIVE_SUCCESS_ABILITY_ID, sourceCardId, pendingId)],
  }).gameState;
  expect(selecting.activeEffect?.metadata?.confirmOnlyPendingAbility).toBe(true);
  return confirmActiveEffectStep(selecting, P1, selecting.activeEffect!.id);
}

describe('PL!SP-bp7-028-L 分数8「能够听见未来的声音」', () => {
  it('requires at least nine legal waiting-room members and exposes optional unordered semantics', () => {
    const insufficient = setupLiveStart(8);
    expect(insufficient.game.activeEffect).toBeNull();
    expect(insufficient.game.pendingAbilities).toEqual([]);

    const enough = setupLiveStart(10);
    expect(enough.game.activeEffect).toMatchObject({
      selectableCardIds: enough.candidates.map((card) => card.instanceId),
      selectableCardMode: 'ORDERED_MULTI',
      minSelectableCards: 9,
      maxSelectableCards: 9,
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
      confirmSelectionLabel: '洗牌并放置于卡组底',
      metadata: {
        publicCardSelectionConfirmation: {
          destination: 'MAIN_DECK_BOTTOM',
        },
      },
    });
    expect(enough.game.activeEffect?.stepText).not.toContain('顺序');
    expect(enough.game.activeEffect?.selectionLabel).not.toContain('顺序');
  });

  it('first reveals the exact nine-card set, then shuffles only that set and gives every top-stage member BLADE', () => {
    const scenario = setupLiveStart(10);
    const selectedCardIds = scenario.candidates
      .slice(0, 9)
      .map((card) => card.instanceId)
      .reverse();
    expect(select(scenario.session, selectedCardIds).success).toBe(true);
    const reveal = scenario.session.state!.activeEffect!;
    expect(reveal.revealedCardIds).toEqual(selectedCardIds);
    expect(reveal.publicCardSelectionOrdered).toBe(false);
    expect(reveal.publicCardSelectionAutoAdvanceAt).toBe(23_500);
    expect(scenario.session.state?.players[0].mainDeck.cardIds).toEqual(
      scenario.deckCards.map((card) => card.instanceId)
    );
    expect(scenario.session.state?.players[0].waitingRoom.cardIds).toEqual([
      ...scenario.candidates.map((card) => card.instanceId),
      scenario.nonLiella.instanceId,
    ]);

    expect(expire(scenario.session, scenario.setNow).success).toBe(true);
    const state = scenario.session.state!;
    expect(state.players[0].mainDeck.cardIds.slice(0, 2)).toEqual(
      scenario.deckCards.map((card) => card.instanceId)
    );
    expect(new Set(state.players[0].mainDeck.cardIds.slice(2))).toEqual(new Set(selectedCardIds));
    expect(state.players[0].waitingRoom.cardIds).toEqual([
      scenario.candidates[9]!.instanceId,
      scenario.nonLiella.instanceId,
    ]);
    expect(bladeModifiers(state)).toHaveLength(3);
    expect(bladeModifiers(state)).toEqual(
      expect.arrayContaining(
        scenario.stageMembers.map((stageMember) =>
          expect.objectContaining({
            sourceCardId: scenario.source.instanceId,
            targetMemberCardId: stageMember.instanceId,
            countDelta: 1,
          })
        )
      )
    );
  });

  it('moves none of the selected group and grants no BLADE when one revealed card is stale', () => {
    const scenario = setupLiveStart(9);
    const selectedCardIds = scenario.candidates.map((card) => card.instanceId);
    expect(select(scenario.session, selectedCardIds).success).toBe(true);
    (scenario.session as unknown as { authorityState: GameState }).authorityState = updatePlayer(
      scenario.session.state!,
      P1,
      (player) => ({
        ...player,
        waitingRoom: {
          ...player.waitingRoom,
          cardIds: player.waitingRoom.cardIds.filter((cardId) => cardId !== selectedCardIds[4]),
        },
        hand: addCardToStatefulZone(player.hand, selectedCardIds[4]!),
      })
    );
    expect(expire(scenario.session, scenario.setNow).success).toBe(true);
    expect(scenario.session.state?.players[0].mainDeck.cardIds).toEqual(
      scenario.deckCards.map((card) => card.instanceId)
    );
    for (const cardId of selectedCardIds.filter((_, index) => index !== 4)) {
      expect(scenario.session.state?.players[0].waitingRoom.cardIds).toContain(cardId);
    }
    expect(bladeModifiers(scenario.session.state!)).toEqual([]);
  });

  it('requires at least one revealed card and accepts structured Liella identity across card types', () => {
    const allLiella = setupLiveSuccess([
      member('cheer-member'),
      cheerLive('cheer-live'),
      energy('cheer-energy'),
    ]);
    const first = resolveSuccess(allLiella.game, allLiella.source.instanceId, 'success-1');
    expect(first.liveResolution.playerScores.get(P1)).toBe(9);
    expect(
      first.liveResolution.liveModifiers.filter(
        (modifier) => modifier.kind === 'SCORE' && modifier.abilityId === LIVE_SUCCESS_ABILITY_ID
      )
    ).toHaveLength(1);
    const repeated = resolveSuccess(first, allLiella.source.instanceId, 'success-2');
    expect(repeated.liveResolution.playerScores.get(P1)).toBe(9);
    expect(
      repeated.liveResolution.liveModifiers.filter(
        (modifier) => modifier.kind === 'SCORE' && modifier.abilityId === LIVE_SUCCESS_ABILITY_ID
      )
    ).toHaveLength(1);

    const mixed = setupLiveSuccess([member('liella-member'), cheerLive('aqours-live', ['Aqours'])]);
    const mixedSelecting = resolvePendingCardEffects({
      ...mixed.game,
      pendingAbilities: [
        pending(LIVE_SUCCESS_ABILITY_ID, mixed.source.instanceId, 'mixed-success'),
      ],
    }).gameState;
    expect(mixedSelecting.activeEffect?.effectText).toContain('未满足条件');
    const mixedResolved = confirmActiveEffectStep(
      mixedSelecting,
      P1,
      mixedSelecting.activeEffect!.id
    );
    expect(mixedResolved.liveResolution.playerScores.get(P1)).toBe(8);

    const empty = setupLiveSuccess([]);
    const emptySelecting = resolvePendingCardEffects({
      ...empty.game,
      pendingAbilities: [
        pending(LIVE_SUCCESS_ABILITY_ID, empty.source.instanceId, 'empty-success'),
      ],
    }).gameState;
    expect(emptySelecting.activeEffect?.effectText).toContain('自己的卡片0张');
    const emptyResolved = confirmActiveEffectStep(
      emptySelecting,
      P1,
      emptySelecting.activeEffect!.id
    );
    expect(emptyResolved.liveResolution.playerScores.get(P1)).toBe(8);
  });
});
