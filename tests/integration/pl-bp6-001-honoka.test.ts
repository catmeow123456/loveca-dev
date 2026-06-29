import { describe, expect, it } from 'vitest';
import type { BladeHearts, LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
} from '../../src/domain/entities/card';
import {
  createGameState,
  getPlayerById,
  registerCards,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { addCardToZone, placeCardInSlot } from '../../src/domain/entities/zone';
import {
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  BP6_001_LIVE_START_CENTER_MUSE_LIVE_STAGE_MUSE_MEMBERS_GAIN_BLADE_ABILITY_ID,
  BP6_001_LIVE_SUCCESS_CHEER_NO_BLADE_MUSE_MEMBER_DRAW_DISCARD_ABILITY_ID,
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
const MUSE = "μ's";

function createMemberCard(
  cardCode: string,
  options: {
    readonly name?: string;
    readonly groupName?: string;
    readonly bladeHearts?: BladeHearts;
  } = {}
): MemberCardData {
  return {
    cardCode,
    name: options.name ?? cardCode,
    groupName: options.groupName ?? MUSE,
    cardType: CardType.MEMBER,
    cost: 2,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
    bladeHearts: options.bladeHearts,
  };
}

function createLiveCard(
  cardCode: string,
  options: { readonly groupName?: string } = {}
): LiveCardData {
  return {
    cardCode,
    name: cardCode,
    groupName: options.groupName ?? MUSE,
    cardType: CardType.LIVE,
    score: 3,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
  };
}

function createPendingAbility(
  abilityId: string,
  sourceCardId: string,
  timingId: TriggerCondition,
  sourceSlot = SlotPosition.CENTER
): PendingAbilityState {
  return {
    id: `${abilityId}:${sourceCardId}:pending`,
    abilityId,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId,
    eventIds: [`${abilityId}:event`],
    sourceSlot,
  };
}

function placeStageMembers(
  game: GameState,
  members: readonly { readonly cardId: string; readonly slot: SlotPosition }[]
): GameState {
  return updatePlayer(game, PLAYER1, (player) => {
    let memberSlots = player.memberSlots;
    for (const member of members) {
      memberSlots = placeCardInSlot(memberSlots, member.slot, member.cardId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      });
    }
    return { ...player, memberSlots };
  });
}

function placeOwnLiveZone(game: GameState, liveCardIds: readonly string[]): GameState {
  return updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    liveZone: {
      ...player.liveZone,
      cardIds: [...liveCardIds],
      cardStates: new Map(
        liveCardIds.map((cardId) => [
          cardId,
          { orientation: OrientationState.ACTIVE, face: FaceState.FACE_DOWN },
        ])
      ),
    },
  }));
}

function setPlayerZones(
  game: GameState,
  zones: {
    readonly hand?: readonly string[];
    readonly mainDeck?: readonly string[];
    readonly waitingRoom?: readonly string[];
  }
): GameState {
  return updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    hand: zones.hand
      ? zones.hand.reduce((zone, cardId) => addCardToZone(zone, cardId), {
          ...player.hand,
          cardIds: [],
        })
      : player.hand,
    mainDeck: zones.mainDeck
      ? {
          ...player.mainDeck,
          cardIds: [...zones.mainDeck],
        }
      : player.mainDeck,
    waitingRoom: zones.waitingRoom
      ? {
          ...player.waitingRoom,
          cardIds: [...zones.waitingRoom],
        }
      : player.waitingRoom,
  }));
}

function setCheerResolution(
  game: GameState,
  options: {
    readonly firstPlayerCheerCardIds?: readonly string[];
    readonly secondPlayerCheerCardIds?: readonly string[];
    readonly resolutionCardIds?: readonly string[];
    readonly revealedCardIds?: readonly string[];
  }
): GameState {
  return {
    ...game,
    resolutionZone: {
      ...game.resolutionZone,
      cardIds: [...(options.resolutionCardIds ?? [])],
      revealedCardIds: [...(options.revealedCardIds ?? [])],
    },
    liveResolution: {
      ...game.liveResolution,
      firstPlayerCheerCardIds: [...(options.firstPlayerCheerCardIds ?? [])],
      secondPlayerCheerCardIds: [...(options.secondPlayerCheerCardIds ?? [])],
    },
  };
}

describe('PL!-bp6-001 高坂穂乃果 workflow', () => {
  it('LIVE_START gives BLADE to each current own μ’s stage member when source remains CENTER and own liveZone has μ’s LIVE', () => {
    const honoka = createCardInstance(
      createMemberCard('PL!-bp6-001-R＋', { name: '高坂穂乃果' }),
      PLAYER1,
      'honoka-center'
    );
    const museSide = createCardInstance(createMemberCard('PL!-muse-side'), PLAYER1, 'muse-side');
    const nonMuse = createCardInstance(
      createMemberCard('PL!-non-muse', { groupName: 'Liella!' }),
      PLAYER1,
      'non-muse'
    );
    const museLive = createCardInstance(createLiveCard('PL!-muse-live'), PLAYER1, 'muse-live');
    let game = registerCards(createGameState('bp6-001-live-start', PLAYER1, 'P1', PLAYER2, 'P2'), [
      honoka,
      museSide,
      nonMuse,
      museLive,
    ]);
    game = placeStageMembers(game, [
      { cardId: museSide.instanceId, slot: SlotPosition.LEFT },
      { cardId: honoka.instanceId, slot: SlotPosition.CENTER },
      { cardId: nonMuse.instanceId, slot: SlotPosition.RIGHT },
    ]);
    game = placeOwnLiveZone(game, [museLive.instanceId]);
    game = {
      ...game,
      pendingAbilities: [
        createPendingAbility(
          BP6_001_LIVE_START_CENTER_MUSE_LIVE_STAGE_MUSE_MEMBERS_GAIN_BLADE_ABILITY_ID,
          honoka.instanceId,
          TriggerCondition.ON_LIVE_START
        ),
      ],
    };

    const resolved = resolvePendingCardEffects(game).gameState;

    expect(resolved.activeEffect).toBeNull();
    expect(resolved.pendingAbilities).toEqual([]);
    expect(resolved.liveResolution.liveModifiers).toEqual(
      expect.arrayContaining([
        {
          kind: 'BLADE',
          playerId: PLAYER1,
          countDelta: 1,
          sourceCardId: museSide.instanceId,
          abilityId: BP6_001_LIVE_START_CENTER_MUSE_LIVE_STAGE_MUSE_MEMBERS_GAIN_BLADE_ABILITY_ID,
        },
        {
          kind: 'BLADE',
          playerId: PLAYER1,
          countDelta: 1,
          sourceCardId: honoka.instanceId,
          abilityId: BP6_001_LIVE_START_CENTER_MUSE_LIVE_STAGE_MUSE_MEMBERS_GAIN_BLADE_ABILITY_ID,
        },
      ])
    );
    expect(
      resolved.liveResolution.liveModifiers.some(
        (modifier) => modifier.sourceCardId === nonMuse.instanceId
      )
    ).toBe(false);
  });

  it.each([
    ['source is not CENTER', SlotPosition.LEFT, true],
    ['own liveZone has no μ’s LIVE', SlotPosition.CENTER, false],
    ['source has left the stage', null, true],
  ] as const)('LIVE_START no-ops when %s', (_label, sourceSlot, hasMuseLive) => {
    const honoka = createCardInstance(createMemberCard('PL!-bp6-001-P'), PLAYER1, 'honoka-miss');
    const museSide = createCardInstance(createMemberCard('PL!-muse-side'), PLAYER1, 'muse-side');
    const museLive = createCardInstance(createLiveCard('PL!-muse-live'), PLAYER1, 'muse-live');
    const otherLive = createCardInstance(
      createLiveCard('PL!-other-live', { groupName: 'Liella!' }),
      PLAYER1,
      'other-live'
    );
    let game = registerCards(
      createGameState('bp6-001-live-start-miss', PLAYER1, 'P1', PLAYER2, 'P2'),
      [honoka, museSide, museLive, otherLive]
    );
    const placements =
      sourceSlot === null
        ? [{ cardId: museSide.instanceId, slot: SlotPosition.RIGHT }]
        : [
            { cardId: honoka.instanceId, slot: sourceSlot },
            { cardId: museSide.instanceId, slot: SlotPosition.RIGHT },
          ];
    game = placeStageMembers(game, placements);
    game = placeOwnLiveZone(game, [hasMuseLive ? museLive.instanceId : otherLive.instanceId]);
    game = {
      ...game,
      pendingAbilities: [
        createPendingAbility(
          BP6_001_LIVE_START_CENTER_MUSE_LIVE_STAGE_MUSE_MEMBERS_GAIN_BLADE_ABILITY_ID,
          honoka.instanceId,
          TriggerCondition.ON_LIVE_START
        ),
      ],
    };

    const resolved = resolvePendingCardEffects(game).gameState;

    expect(resolved.liveResolution.liveModifiers).toHaveLength(0);
    expect(resolved.pendingAbilities).toHaveLength(0);
  });

  it('LIVE_START auto-resolves remaining Honoka pending abilities after choosing ordered resolution', () => {
    const honoka = createCardInstance(
      createMemberCard('PL!-bp6-001-R＋', { name: '高坂穂乃果' }),
      PLAYER1,
      'honoka-order-center'
    );
    const museSide = createCardInstance(
      createMemberCard('PL!-muse-side-order'),
      PLAYER1,
      'muse-side-order'
    );
    const museLive = createCardInstance(
      createLiveCard('PL!-muse-live-order'),
      PLAYER1,
      'muse-live-order'
    );
    let game = registerCards(
      createGameState('bp6-001-live-start-order', PLAYER1, 'P1', PLAYER2, 'P2'),
      [honoka, museSide, museLive]
    );
    game = placeStageMembers(game, [
      { cardId: museSide.instanceId, slot: SlotPosition.LEFT },
      { cardId: honoka.instanceId, slot: SlotPosition.CENTER },
    ]);
    game = placeOwnLiveZone(game, [museLive.instanceId]);
    game = {
      ...game,
      pendingAbilities: [
        createPendingAbility(
          BP6_001_LIVE_START_CENTER_MUSE_LIVE_STAGE_MUSE_MEMBERS_GAIN_BLADE_ABILITY_ID,
          honoka.instanceId,
          TriggerCondition.ON_LIVE_START
        ),
        createPendingAbility(
          BP6_001_LIVE_START_CENTER_MUSE_LIVE_STAGE_MUSE_MEMBERS_GAIN_BLADE_ABILITY_ID,
          museSide.instanceId,
          TriggerCondition.ON_LIVE_START,
          SlotPosition.LEFT
        ),
      ],
    };
    const orderSelection = resolvePendingCardEffects(game).gameState;

    expect(orderSelection.activeEffect?.canResolveInOrder).toBe(true);
    const resolved = confirmActiveEffectStep(
      orderSelection,
      PLAYER1,
      orderSelection.activeEffect!.id,
      undefined,
      undefined,
      true
    );

    expect(resolved.activeEffect).toBeNull();
    expect(resolved.pendingAbilities).toEqual([]);
    expect(
      resolved.liveResolution.liveModifiers.filter(
        (modifier) =>
          modifier.abilityId ===
          BP6_001_LIVE_START_CENTER_MUSE_LIVE_STAGE_MUSE_MEMBERS_GAIN_BLADE_ABILITY_ID
      )
    ).toHaveLength(2);
  });

  it('LIVE_START shows a confirm-only bridge before resolving manually selected Honoka pending ability', () => {
    const honoka = createCardInstance(
      createMemberCard('PL!-bp6-001-R＋', { name: '高坂穂乃果' }),
      PLAYER1,
      'honoka-manual-center'
    );
    const museSide = createCardInstance(
      createMemberCard('PL!-muse-side-manual'),
      PLAYER1,
      'muse-side-manual'
    );
    const museLive = createCardInstance(
      createLiveCard('PL!-muse-live-manual'),
      PLAYER1,
      'muse-live-manual'
    );
    let game = registerCards(
      createGameState('bp6-001-live-start-manual', PLAYER1, 'P1', PLAYER2, 'P2'),
      [honoka, museSide, museLive]
    );
    game = placeStageMembers(game, [
      { cardId: museSide.instanceId, slot: SlotPosition.LEFT },
      { cardId: honoka.instanceId, slot: SlotPosition.CENTER },
    ]);
    game = placeOwnLiveZone(game, [museLive.instanceId]);
    game = {
      ...game,
      pendingAbilities: [
        createPendingAbility(
          BP6_001_LIVE_START_CENTER_MUSE_LIVE_STAGE_MUSE_MEMBERS_GAIN_BLADE_ABILITY_ID,
          honoka.instanceId,
          TriggerCondition.ON_LIVE_START
        ),
        createPendingAbility(
          BP6_001_LIVE_START_CENTER_MUSE_LIVE_STAGE_MUSE_MEMBERS_GAIN_BLADE_ABILITY_ID,
          museSide.instanceId,
          TriggerCondition.ON_LIVE_START,
          SlotPosition.LEFT
        ),
      ],
    };
    const orderSelection = resolvePendingCardEffects(game).gameState;

    const preview = confirmActiveEffectStep(
      orderSelection,
      PLAYER1,
      orderSelection.activeEffect!.id,
      honoka.instanceId
    );

    expect(preview.activeEffect).toMatchObject({
      abilityId: BP6_001_LIVE_START_CENTER_MUSE_LIVE_STAGE_MUSE_MEMBERS_GAIN_BLADE_ABILITY_ID,
      sourceCardId: honoka.instanceId,
      metadata: { confirmOnlyPendingAbility: true },
    });
    expect(preview.liveResolution.liveModifiers).toEqual([]);

    const resolved = confirmActiveEffectStep(preview, PLAYER1, preview.activeEffect!.id);

    expect(resolved.activeEffect).toBeNull();
    expect(resolved.liveResolution.liveModifiers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'BLADE',
          sourceCardId: honoka.instanceId,
          abilityId: BP6_001_LIVE_START_CENTER_MUSE_LIVE_STAGE_MUSE_MEMBERS_GAIN_BLADE_ABILITY_ID,
        }),
        expect.objectContaining({
          kind: 'BLADE',
          sourceCardId: museSide.instanceId,
          abilityId: BP6_001_LIVE_START_CENTER_MUSE_LIVE_STAGE_MUSE_MEMBERS_GAIN_BLADE_ABILITY_ID,
        }),
      ])
    );
  });

  it('LIVE_SUCCESS draws one then discards one when current own revealed cheer includes a μ’s member without bladeHearts', () => {
    const honoka = createCardInstance(
      createMemberCard('PL!-bp6-001-SEC'),
      PLAYER1,
      'honoka-success'
    );
    const revealedMuseMember = createCardInstance(
      createMemberCard('PL!-revealed-muse-member'),
      PLAYER1,
      'revealed-muse-member'
    );
    const oldHand = createCardInstance(createMemberCard('PL!-old-hand'), PLAYER1, 'old-hand');
    const drawCard = createCardInstance(createMemberCard('PL!-draw-card'), PLAYER1, 'draw-card');
    let game = registerCards(
      createGameState('bp6-001-live-success', PLAYER1, 'P1', PLAYER2, 'P2'),
      [honoka, revealedMuseMember, oldHand, drawCard]
    );
    game = placeStageMembers(game, [{ cardId: honoka.instanceId, slot: SlotPosition.CENTER }]);
    game = setPlayerZones(game, {
      hand: [oldHand.instanceId],
      mainDeck: [drawCard.instanceId],
    });
    game = setCheerResolution(game, {
      firstPlayerCheerCardIds: [revealedMuseMember.instanceId],
      resolutionCardIds: [revealedMuseMember.instanceId],
      revealedCardIds: [revealedMuseMember.instanceId],
    });
    game = {
      ...game,
      pendingAbilities: [
        createPendingAbility(
          BP6_001_LIVE_SUCCESS_CHEER_NO_BLADE_MUSE_MEMBER_DRAW_DISCARD_ABILITY_ID,
          honoka.instanceId,
          TriggerCondition.ON_LIVE_SUCCESS
        ),
      ],
    };

    let resolved = resolvePendingCardEffects(game).gameState;
    expect(resolved.activeEffect).toMatchObject({
      abilityId: BP6_001_LIVE_SUCCESS_CHEER_NO_BLADE_MUSE_MEMBER_DRAW_DISCARD_ABILITY_ID,
      selectableCardIds: [oldHand.instanceId, drawCard.instanceId],
    });

    resolved = confirmActiveEffectStep(
      resolved,
      PLAYER1,
      resolved.activeEffect!.id,
      oldHand.instanceId
    );
    const player = getPlayerById(resolved, PLAYER1)!;
    expect(player.hand.cardIds).toEqual([drawCard.instanceId]);
    expect(player.waitingRoom.cardIds).toContain(oldHand.instanceId);
    expect(resolved.activeEffect).toBeNull();
  });

  it.each([
    ['non-μ’s member', createMemberCard('PL!-revealed-liella', { groupName: 'Liella!' })],
    ['LIVE card', createLiveCard('PL!-revealed-live')],
    [
      'μ’s member with bladeHeart',
      createMemberCard('PL!-revealed-blade-heart', {
        bladeHearts: [{ effect: BladeHeartEffect.DRAW }],
      }),
    ],
  ])('LIVE_SUCCESS no-ops for %s', (_label, revealedCardData) => {
    const honoka = createCardInstance(createMemberCard('PL!-bp6-001-P＋'), PLAYER1, 'honoka-noop');
    const revealed = createCardInstance(revealedCardData, PLAYER1, 'revealed-noop');
    const drawCard = createCardInstance(createMemberCard('PL!-draw-card'), PLAYER1, 'draw-card');
    let game = registerCards(
      createGameState('bp6-001-live-success-noop', PLAYER1, 'P1', PLAYER2, 'P2'),
      [honoka, revealed, drawCard]
    );
    game = placeStageMembers(game, [{ cardId: honoka.instanceId, slot: SlotPosition.CENTER }]);
    game = setPlayerZones(game, { mainDeck: [drawCard.instanceId] });
    game = setCheerResolution(game, {
      firstPlayerCheerCardIds: [revealed.instanceId],
      resolutionCardIds: [revealed.instanceId],
      revealedCardIds: [revealed.instanceId],
    });
    game = {
      ...game,
      pendingAbilities: [
        createPendingAbility(
          BP6_001_LIVE_SUCCESS_CHEER_NO_BLADE_MUSE_MEMBER_DRAW_DISCARD_ABILITY_ID,
          honoka.instanceId,
          TriggerCondition.ON_LIVE_SUCCESS
        ),
      ],
    };

    const resolved = resolvePendingCardEffects(game).gameState;

    expect(resolved.activeEffect).toBeNull();
    expect(getPlayerById(resolved, PLAYER1)!.mainDeck.cardIds).toEqual([drawCard.instanceId]);
    expect(resolved.pendingAbilities).toHaveLength(0);
  });

  it('LIVE_SUCCESS only reads current own cheer cards that remain revealed in resolutionZone', () => {
    const honoka = createCardInstance(
      createMemberCard('PL!-bp6-001-R＋'),
      PLAYER1,
      'honoka-own-only'
    );
    const opponentRevealed = createCardInstance(
      createMemberCard('PL!-opponent-revealed'),
      PLAYER2,
      'opponent-revealed'
    );
    const staleOwn = createCardInstance(createMemberCard('PL!-stale-own'), PLAYER1, 'stale-own');
    const hiddenOwn = createCardInstance(createMemberCard('PL!-hidden-own'), PLAYER1, 'hidden-own');
    const drawCard = createCardInstance(createMemberCard('PL!-draw-card'), PLAYER1, 'draw-card');
    let game = registerCards(
      createGameState('bp6-001-live-success-own-only', PLAYER1, 'P1', PLAYER2, 'P2'),
      [honoka, opponentRevealed, staleOwn, hiddenOwn, drawCard]
    );
    game = placeStageMembers(game, [{ cardId: honoka.instanceId, slot: SlotPosition.CENTER }]);
    game = setPlayerZones(game, { mainDeck: [drawCard.instanceId] });
    game = setCheerResolution(game, {
      firstPlayerCheerCardIds: [hiddenOwn.instanceId],
      secondPlayerCheerCardIds: [opponentRevealed.instanceId],
      resolutionCardIds: [opponentRevealed.instanceId, staleOwn.instanceId, hiddenOwn.instanceId],
      revealedCardIds: [opponentRevealed.instanceId, staleOwn.instanceId],
    });
    game = {
      ...game,
      pendingAbilities: [
        createPendingAbility(
          BP6_001_LIVE_SUCCESS_CHEER_NO_BLADE_MUSE_MEMBER_DRAW_DISCARD_ABILITY_ID,
          honoka.instanceId,
          TriggerCondition.ON_LIVE_SUCCESS
        ),
      ],
    };

    const resolved = resolvePendingCardEffects(game).gameState;

    expect(resolved.activeEffect).toBeNull();
    expect(getPlayerById(resolved, PLAYER1)!.mainDeck.cardIds).toEqual([drawCard.instanceId]);
  });

  it('LIVE_SUCCESS keeps draw/discard helper semantics when no card can be drawn and no hand can be discarded', () => {
    const honoka = createCardInstance(createMemberCard('PL!-bp6-001-P'), PLAYER1, 'honoka-empty');
    const revealedMuseMember = createCardInstance(
      createMemberCard('PL!-revealed-muse-member'),
      PLAYER1,
      'revealed-muse-member'
    );
    let game = registerCards(
      createGameState('bp6-001-live-success-empty', PLAYER1, 'P1', PLAYER2, 'P2'),
      [honoka, revealedMuseMember]
    );
    game = placeStageMembers(game, [{ cardId: honoka.instanceId, slot: SlotPosition.CENTER }]);
    game = setPlayerZones(game, { hand: [], mainDeck: [] });
    game = setCheerResolution(game, {
      firstPlayerCheerCardIds: [revealedMuseMember.instanceId],
      resolutionCardIds: [revealedMuseMember.instanceId],
      revealedCardIds: [revealedMuseMember.instanceId],
    });
    game = {
      ...game,
      pendingAbilities: [
        createPendingAbility(
          BP6_001_LIVE_SUCCESS_CHEER_NO_BLADE_MUSE_MEMBER_DRAW_DISCARD_ABILITY_ID,
          honoka.instanceId,
          TriggerCondition.ON_LIVE_SUCCESS
        ),
      ],
    };

    let resolved = resolvePendingCardEffects(game).gameState;
    expect(resolved.activeEffect?.canSkipSelection).toBe(true);
    resolved = confirmActiveEffectStep(resolved, PLAYER1, resolved.activeEffect!.id);

    expect(resolved.activeEffect).toBeNull();
    expect(getPlayerById(resolved, PLAYER1)!.waitingRoom.cardIds).toEqual([]);
  });
});
