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
import {
  addCardToStatefulZone,
  addMemberBelowMember,
  placeCardInSlot,
  removeCardFromStatefulZone,
} from '../../src/domain/entities/zone';
import {
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { createPublicObjectId, projectPlayerViewState } from '../../src/online/projector';
import {
  S_BP7_020_LIVE_START_ALL_STAGE_MEMBERS_ACTIVE_REDUCE_COLORLESS_REQUIREMENT_ABILITY_ID,
  S_BP7_020_LIVE_START_MILL_BOTTOM_ONE_AQOURS_MEMBER_REDUCE_COLORLESS_REQUIREMENT_ABILITY_ID,
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

const P1 = 'p1';
const P2 = 'p2';
const ACTIVE_ABILITY =
  S_BP7_020_LIVE_START_ALL_STAGE_MEMBERS_ACTIVE_REDUCE_COLORLESS_REQUIREMENT_ABILITY_ID;
const MILL_ABILITY =
  S_BP7_020_LIVE_START_MILL_BOTTOM_ONE_AQOURS_MEMBER_REDUCE_COLORLESS_REQUIREMENT_ABILITY_ID;

function member(id: string, groupNames: readonly string[] = ['Aqours'], ownerId = P1) {
  const data: MemberCardData = {
    cardCode: id,
    name: id,
    groupNames,
    cardType: CardType.MEMBER,
    cost: 1,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.RED, 1)],
  };
  return createCardInstance(data, ownerId, id);
}

function live(id: string, groupNames: readonly string[] = ['Aqours']) {
  const data: LiveCardData = {
    cardCode: id,
    name: id,
    groupNames,
    cardType: CardType.LIVE,
    score: 3,
    requirements: createHeartRequirement({ [HeartColor.RAINBOW]: 3 }),
  };
  return createCardInstance(data, P1, id);
}

function energy(id: string) {
  const data: EnergyCardData = { cardCode: id, name: id, cardType: CardType.ENERGY };
  return createCardInstance(data, P1, id);
}

function pending(abilityId: string, sourceCardId: string, id = 'pending'): PendingAbilityState {
  return {
    id,
    abilityId,
    sourceCardId,
    controllerId: P1,
    mandatory: true,
    timingId: TriggerCondition.ON_LIVE_START,
  };
}

function setup(options: {
  readonly abilityId: string;
  readonly stageOrientations?: readonly OrientationState[];
  readonly deckCards?: readonly ReturnType<typeof member>[];
  readonly waitingCards?: readonly ReturnType<typeof member>[];
  readonly includeBelow?: boolean;
  readonly opponentWaiting?: boolean;
}) {
  const source = live('PL!S-bp7-020-SECL');
  const stageMembers = (options.stageOrientations ?? []).map((_, index) =>
    member(`stage-${index}`)
  );
  const below = member('member-below');
  const opponent = member('opponent-member', ['Aqours'], P2);
  const deckCards = options.deckCards ?? [];
  const waitingCards = options.waitingCards ?? [];
  let game = registerCards(createGameState('s-bp7-020', P1, 'P1', P2, 'P2'), [
    source,
    ...stageMembers,
    below,
    opponent,
    ...deckCards,
    ...waitingCards,
  ]);
  game = updatePlayer(game, P1, (player) => {
    let memberSlots = player.memberSlots;
    const slots = [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT] as const;
    stageMembers.forEach((card, index) => {
      memberSlots = placeCardInSlot(memberSlots, slots[index]!, card.instanceId, {
        orientation: options.stageOrientations![index]!,
        face: FaceState.FACE_UP,
      });
    });
    if (options.includeBelow) {
      memberSlots = addMemberBelowMember(memberSlots, SlotPosition.CENTER, below.instanceId);
    }
    return {
      ...player,
      memberSlots,
      liveZone: addCardToStatefulZone(player.liveZone, source.instanceId),
      mainDeck: { ...player.mainDeck, cardIds: deckCards.map((card) => card.instanceId) },
      waitingRoom: {
        ...player.waitingRoom,
        cardIds: waitingCards.map((card) => card.instanceId),
      },
    };
  });
  game = updatePlayer(game, P2, (player) => ({
    ...player,
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, opponent.instanceId, {
      orientation: options.opponentWaiting ? OrientationState.WAITING : OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
  }));
  return {
    source,
    game: { ...game, pendingAbilities: [pending(options.abilityId, source.instanceId)] },
  };
}

function confirm(game: GameState): GameState {
  const waiting = resolvePendingCardEffects(game).gameState;
  if (waiting.activeEffect?.abilityId === MILL_ABILITY) {
    expect(waiting.activeEffect.metadata?.confirmOnlyPendingAbility).not.toBe(true);
    expect(waiting.activeEffect.stepId).toBe('S_BP7_020_REVEAL_MILLED_BOTTOM_ONE');
  } else {
    expect(waiting.activeEffect?.metadata?.confirmOnlyPendingAbility).toBe(true);
  }
  return confirmActiveEffectStep(waiting, P1, waiting.activeEffect!.id);
}

function requirementModifiers(game: GameState) {
  return game.liveResolution.liveModifiers.filter((modifier) => modifier.kind === 'REQUIREMENT');
}

describe('PL!S-bp7-020-SECL 分数3「快乐派对火车」', () => {
  it.each([
    [1, [OrientationState.ACTIVE]],
    [2, [OrientationState.ACTIVE, OrientationState.ACTIVE]],
    [3, [OrientationState.ACTIVE, OrientationState.ACTIVE, OrientationState.ACTIVE]],
  ])(
    'reduces one colorless requirement when all %i stage members are ACTIVE',
    (_count, orientations) => {
      const { game, source } = setup({
        abilityId: ACTIVE_ABILITY,
        stageOrientations: orientations,
      });
      expect(requirementModifiers(confirm(game))).toEqual([
        expect.objectContaining({
          liveCardId: source.instanceId,
          sourceCardId: source.instanceId,
          abilityId: ACTIVE_ABILITY,
          modifiers: [{ color: HeartColor.RAINBOW, countDelta: -1 }],
        }),
      ]);
    }
  );

  it.each([
    [OrientationState.ACTIVE, OrientationState.WAITING],
    [OrientationState.WAITING, OrientationState.WAITING],
  ])('does not reduce when any own top-stage member is WAITING', (...orientations) => {
    expect(
      requirementModifiers(
        setup({ abilityId: ACTIVE_ABILITY, stageOrientations: orientations }).game
      )
    ).toEqual([]);
    expect(
      requirementModifiers(
        confirm(setup({ abilityId: ACTIVE_ABILITY, stageOrientations: orientations }).game)
      )
    ).toEqual([]);
  });

  it('treats zero stage members as not satisfying the condition and says so in confirm-only copy', () => {
    const waiting = resolvePendingCardEffects(
      setup({ abilityId: ACTIVE_ABILITY, stageOrientations: [] }).game
    ).gameState;
    expect(waiting.activeEffect?.effectText).toContain('当前舞台成员0名');
    expect(waiting.activeEffect?.effectText).toContain('未满足条件');
    expect(requirementModifiers(confirm(waiting))).toEqual([]);
  });

  it('ignores memberBelow and opponent orientation while showing the public live condition', () => {
    const waiting = resolvePendingCardEffects(
      setup({
        abilityId: ACTIVE_ABILITY,
        stageOrientations: [OrientationState.ACTIVE],
        includeBelow: true,
        opponentWaiting: true,
      }).game
    ).gameState;
    expect(waiting.activeEffect?.effectText).toContain('当前舞台成员1名，其中活跃成员1名');
    expect(waiting.activeEffect?.effectText).toContain('满足条件');
    expect(requirementModifiers(confirm(waiting))).toHaveLength(1);
  });

  it('safely no-ops when the source LIVE leaves its LIVE zone', () => {
    const scenario = setup({
      abilityId: ACTIVE_ABILITY,
      stageOrientations: [OrientationState.ACTIVE],
    });
    const game = updatePlayer(scenario.game, P1, (player) => ({
      ...player,
      liveZone: removeCardFromStatefulZone(player.liveZone, scenario.source.instanceId),
    }));
    expect(requirementModifiers(confirm(game))).toEqual([]);
  });

  it.each([
    ['non-Aqours member', member('other-member', ['虹ヶ咲'])],
    ['Aqours LIVE', live('aqours-live')],
    ['energy', energy('bottom-energy')],
  ])('mills but does not reduce for %s', (_label, bottomCard) => {
    const done = confirm(
      setup({
        abilityId: MILL_ABILITY,
        stageOrientations: [OrientationState.ACTIVE],
        deckCards: [bottomCard],
      }).game
    );
    expect(requirementModifiers(done)).toEqual([]);
  });

  it('publicly reveals the moved bottom card to both players before reducing the requirement', () => {
    const top = member('top');
    const bottom = member('aqours-bottom');
    const revealed = resolvePendingCardEffects(
      setup({
        abilityId: MILL_ABILITY,
        stageOrientations: [OrientationState.ACTIVE],
        deckCards: [top, bottom],
      }).game
    ).gameState;
    expect(revealed.players[0].mainDeck.cardIds).toEqual([top.instanceId]);
    expect(revealed.players[0].waitingRoom.cardIds).toEqual([bottom.instanceId]);
    expect(revealed.activeEffect?.revealedCardIds).toEqual([bottom.instanceId]);
    expect(revealed.activeEffect?.stepText).toContain('这张卡为『Aqours』成员卡');
    expect(revealed.activeEffect?.stepText).toContain('确认后此LIVE所需的[無ハート]减少1个');
    expect(requirementModifiers(revealed)).toEqual([]);
    for (const viewerId of [P1, P2]) {
      expect(projectPlayerViewState(revealed, viewerId).activeEffect?.revealedObjectIds).toEqual([
        createPublicObjectId(bottom.instanceId),
      ]);
    }
    const done = confirmActiveEffectStep(revealed, P1, revealed.activeEffect!.id);
    expect(requirementModifiers(done)).toHaveLength(1);
  });

  it('reduces for an actually moved Aqours member, including after refresh, and emits one exact grouped event', () => {
    const bottom = member('refresh-aqours');
    const scenario = setup({
      abilityId: MILL_ABILITY,
      stageOrientations: [OrientationState.ACTIVE],
      waitingCards: [bottom],
    });
    const done = confirm(scenario.game);
    expect(requirementModifiers(done)).toEqual([
      expect.objectContaining({
        liveCardId: scenario.source.instanceId,
        sourceCardId: scenario.source.instanceId,
        abilityId: MILL_ABILITY,
        modifiers: [{ color: HeartColor.RAINBOW, countDelta: -1 }],
      }),
    ]);
    const events = done.eventLog
      .map((entry) => entry.event)
      .filter((event) => event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      cardInstanceIds: [bottom.instanceId],
      fromZone: ZoneType.MAIN_DECK,
      toZone: ZoneType.WAITING_ROOM,
      cause: {
        kind: 'CARD_EFFECT',
        playerId: P1,
        sourceCardId: scenario.source.instanceId,
        abilityId: MILL_ABILITY,
        pendingAbilityId: 'pending',
      },
    });
  });

  it('does not reduce when zero cards actually move', () => {
    expect(
      requirementModifiers(confirm(setup({ abilityId: MILL_ABILITY, stageOrientations: [] }).game))
    ).toEqual([]);
  });

  it('stacks the two ability ids to -2 without replacing each other', () => {
    const bottom = member('aqours-bottom');
    const scenario = setup({
      abilityId: ACTIVE_ABILITY,
      stageOrientations: [OrientationState.ACTIVE],
      deckCards: [bottom],
    });
    const afterActive = confirm(scenario.game);
    const afterMill = confirm({
      ...afterActive,
      pendingAbilities: [pending(MILL_ABILITY, scenario.source.instanceId, 'mill-pending')],
    });
    const modifiers = requirementModifiers(afterMill);
    expect(modifiers).toHaveLength(2);
    expect(modifiers.map((modifier) => modifier.abilityId)).toEqual(
      expect.arrayContaining([ACTIVE_ABILITY, MILL_ABILITY])
    );
    expect(afterMill.liveResolution.liveRequirementReductions.get(scenario.source.instanceId)).toBe(
      2
    );
  });
});
