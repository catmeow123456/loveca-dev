import { describe, expect, it } from 'vitest';
import type { LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
} from '../../src/domain/entities/card';
import {
  createGameState,
  emitGameEvent,
  registerCards,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { addCardToZone, placeCardInSlot } from '../../src/domain/entities/zone';
import { clearTurnMoveRecords } from '../../src/domain/entities/player';
import { createCheerEvent } from '../../src/domain/events/game-events';
import { collectLiveModifiers } from '../../src/domain/rules/live-modifiers';
import {
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  S_BP2_023_LIVE_START_OTHER_AQOURS_LIVE_STAGE_MEMBERS_GAIN_BLADE_ABILITY_ID,
  S_BP2_022_LIVE_SUCCESS_DECK_REFRESHED_THIS_TURN_THIS_LIVE_SCORE_ABILITY_ID,
  S_BP6_009_CONTINUOUS_SUCCESS_LIVE_DIFFERENCE_GAIN_BLADE_ABILITY_ID,
  S_BP6_009_LIVE_SUCCESS_CENTER_CHEER_SCORE_AQOURS_LIVE_SCORE_ABILITY_ID,
  S_SD1_022_LIVE_START_AQOURS_STAGE_MEMBERS_GAIN_BLADE_ABILITY_ID,
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

function confirmIfConfirmOnly(game: GameState): GameState {
  return game.activeEffect?.metadata?.confirmOnlyPendingAbility === true
    ? confirmActiveEffectStep(game, PLAYER1, game.activeEffect.id)
    : game;
}

function createMemberCard(
  cardCode: string,
  options: {
    readonly name?: string;
    readonly groupNames?: readonly string[];
    readonly cost?: number;
    readonly blade?: number;
  } = {}
): MemberCardData {
  return {
    cardCode,
    name: options.name ?? cardCode,
    groupNames: options.groupNames ?? ['Aqours'],
    cardType: CardType.MEMBER,
    cost: options.cost ?? 4,
    blade: options.blade ?? 1,
    hearts: [createHeartIcon(HeartColor.RED, 1)],
  };
}

function createLiveCard(
  cardCode: string,
  options: {
    readonly name?: string;
    readonly groupNames?: readonly string[];
    readonly hasScore?: boolean;
  } = {}
): LiveCardData {
  return {
    cardCode,
    name: options.name ?? cardCode,
    groupNames: options.groupNames ?? ['Aqours'],
    cardType: CardType.LIVE,
    score: 3,
    requirements: createHeartRequirement({ [HeartColor.RED]: 1 }),
    bladeHearts: options.hasScore ? [{ effect: BladeHeartEffect.SCORE }] : [],
  };
}

function createPendingAbility(
  abilityId: string,
  sourceCardId: string,
  triggerCondition: TriggerCondition,
  sourceSlot = SlotPosition.CENTER,
  controllerId = PLAYER1
): PendingAbilityState {
  return {
    id: `${abilityId}:${sourceCardId}:pending`,
    abilityId,
    sourceCardId,
    controllerId,
    mandatory: true,
    timingId: triggerCondition,
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

function placeOpponentStageMembers(
  game: GameState,
  members: readonly { readonly cardId: string; readonly slot: SlotPosition }[]
): GameState {
  return updatePlayer(game, PLAYER2, (player) => {
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

function placeLiveZone(
  game: GameState,
  liveCardIds: readonly string[],
  playerId = PLAYER1
): GameState {
  return updatePlayer(game, playerId, (player) => ({
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

function setCurrentCenterCheerCards(game: GameState, cardIds: readonly string[]): GameState {
  return {
    ...game,
    liveResolution: {
      ...game.liveResolution,
      firstPlayerCheerCardIds: [...cardIds],
    },
  };
}

describe('未来水卡组 执行批次3 focused workflows', () => {
  it('PL!S-bp2-023 gives BLADE to every own stage member when another Aqours LIVE is in liveZone', () => {
    const sourceLive = createCardInstance(
      createLiveCard('PL!S-bp2-023-L', { name: 'MY舞☆TONIGHT' }),
      PLAYER1,
      'my-mai-tonight'
    );
    const otherAqoursLive = createCardInstance(
      createLiveCard('PL!S-other-aqours-live', { name: 'MIRAI TICKET' }),
      PLAYER1,
      'other-aqours-live'
    );
    const members = [
      createCardInstance(createMemberCard('PL!S-stage-left'), PLAYER1, 'stage-left'),
      createCardInstance(createMemberCard('PL!S-stage-center'), PLAYER1, 'stage-center'),
      createCardInstance(createMemberCard('PL!S-stage-right'), PLAYER1, 'stage-right'),
    ];
    let game = registerCards(createGameState('bp2-023', PLAYER1, 'P1', PLAYER2, 'P2'), [
      sourceLive,
      otherAqoursLive,
      ...members,
    ]);
    game = placeLiveZone(game, [sourceLive.instanceId, otherAqoursLive.instanceId]);
    game = placeStageMembers(game, [
      { cardId: members[0]!.instanceId, slot: SlotPosition.LEFT },
      { cardId: members[1]!.instanceId, slot: SlotPosition.CENTER },
      { cardId: members[2]!.instanceId, slot: SlotPosition.RIGHT },
    ]);
    game = {
      ...game,
      pendingAbilities: [
        createPendingAbility(
          S_BP2_023_LIVE_START_OTHER_AQOURS_LIVE_STAGE_MEMBERS_GAIN_BLADE_ABILITY_ID,
          sourceLive.instanceId,
          TriggerCondition.ON_LIVE_START
        ),
      ],
    };

    const resolved = confirmIfConfirmOnly(resolvePendingCardEffects(game).gameState);

    for (const member of members) {
      expect(resolved.liveResolution.liveModifiers).toContainEqual({
        kind: 'BLADE',
        playerId: PLAYER1,
        countDelta: 1,
        sourceCardId: member.instanceId,
        abilityId: S_BP2_023_LIVE_START_OTHER_AQOURS_LIVE_STAGE_MEMBERS_GAIN_BLADE_ABILITY_ID,
      });
    }
  });

  it('PL!S-bp2-023 does not give BLADE when the localized source LIVE is the only LIVE card', () => {
    const sourceLive = createCardInstance(
      createLiveCard('PL!S-bp2-023-L', { name: '我的舞蹈☆今夜' }),
      PLAYER1,
      'my-mai-tonight-cn'
    );
    const member = createCardInstance(
      createMemberCard('PL!S-stage-member'),
      PLAYER1,
      'stage-member'
    );
    let game = registerCards(createGameState('bp2-023-cn-only', PLAYER1, 'P1', PLAYER2, 'P2'), [
      sourceLive,
      member,
    ]);
    game = placeLiveZone(game, [sourceLive.instanceId]);
    game = placeStageMembers(game, [{ cardId: member.instanceId, slot: SlotPosition.CENTER }]);
    game = {
      ...game,
      pendingAbilities: [
        createPendingAbility(
          S_BP2_023_LIVE_START_OTHER_AQOURS_LIVE_STAGE_MEMBERS_GAIN_BLADE_ABILITY_ID,
          sourceLive.instanceId,
          TriggerCondition.ON_LIVE_START
        ),
      ],
    };

    const resolved = confirmIfConfirmOnly(resolvePendingCardEffects(game).gameState);

    expect(resolved.liveResolution.liveModifiers).toHaveLength(0);
  });

  it('PL!S-bp2-023 does not give BLADE with only MY舞☆TONIGHT or non-Aqours LIVE cards', () => {
    const sourceLive = createCardInstance(
      createLiveCard('PL!S-bp2-023-L', { name: 'MY舞☆TONIGHT' }),
      PLAYER1,
      'my-mai-only'
    );
    const sameNameLive = createCardInstance(
      createLiveCard('PL!S-bp2-023-L', { name: '我的舞蹈☆今夜' }),
      PLAYER1,
      'same-name-live'
    );
    const nonAqoursLive = createCardInstance(
      createLiveCard('PL!SP-non-aqours-live', { name: 'Tiny Stars', groupNames: ['Liella!'] }),
      PLAYER1,
      'non-aqours-live'
    );
    const member = createCardInstance(createMemberCard('PL!S-stage-member'), PLAYER1, 'stage-member');
    let game = registerCards(createGameState('bp2-023-miss', PLAYER1, 'P1', PLAYER2, 'P2'), [
      sourceLive,
      sameNameLive,
      nonAqoursLive,
      member,
    ]);
    game = placeLiveZone(game, [sourceLive.instanceId, sameNameLive.instanceId, nonAqoursLive.instanceId]);
    game = placeStageMembers(game, [{ cardId: member.instanceId, slot: SlotPosition.CENTER }]);
    game = {
      ...game,
      pendingAbilities: [
        createPendingAbility(
          S_BP2_023_LIVE_START_OTHER_AQOURS_LIVE_STAGE_MEMBERS_GAIN_BLADE_ABILITY_ID,
          sourceLive.instanceId,
          TriggerCondition.ON_LIVE_START
        ),
      ],
    };

    const resolved = confirmIfConfirmOnly(resolvePendingCardEffects(game).gameState);

    expect(resolved.liveResolution.liveModifiers).toHaveLength(0);
  });

  it.each([
    { ownAqoursCount: 0, expectedBladeCount: 0 },
    { ownAqoursCount: 1, expectedBladeCount: 1 },
    { ownAqoursCount: 3, expectedBladeCount: 3 },
  ])(
    'PL!S-sd1-022 gives BLADE to current own Aqours stage members: $ownAqoursCount',
    ({ ownAqoursCount, expectedBladeCount }) => {
      const sourceLive = createCardInstance(
        createLiveCard('PL!S-sd1-022-SD', { name: 'Jump up HIGH!!' }),
        PLAYER1,
        `jump-up-high-${ownAqoursCount}`
      );
      const aqoursMembers = Array.from({ length: ownAqoursCount }, (_, index) =>
        createCardInstance(createMemberCard(`PL!S-aqours-member-${index}`), PLAYER1, `aqours-${index}`)
      );
      const nonAqoursMember = createCardInstance(
        createMemberCard('PL!SP-liella-member', { groupNames: ['Liella!'] }),
        PLAYER1,
        'own-non-aqours'
      );
      const opponentAqoursMember = createCardInstance(
        createMemberCard('PL!S-opponent-aqours-member'),
        PLAYER2,
        'opponent-aqours'
      );
      let game = registerCards(
        createGameState(`sd1-022-${ownAqoursCount}`, PLAYER1, 'P1', PLAYER2, 'P2'),
        [sourceLive, ...aqoursMembers, nonAqoursMember, opponentAqoursMember]
      );
      game = placeLiveZone(game, [sourceLive.instanceId]);
      game = placeStageMembers(game, [
        ...aqoursMembers.map((card, index) => ({
          cardId: card.instanceId,
          slot: [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT][index]!,
        })),
        ...(ownAqoursCount < 3
          ? [{ cardId: nonAqoursMember.instanceId, slot: SlotPosition.RIGHT }]
          : []),
      ]);
      game = placeOpponentStageMembers(game, [
        { cardId: opponentAqoursMember.instanceId, slot: SlotPosition.CENTER },
      ]);
      game = {
        ...game,
        pendingAbilities: [
          createPendingAbility(
            S_SD1_022_LIVE_START_AQOURS_STAGE_MEMBERS_GAIN_BLADE_ABILITY_ID,
            sourceLive.instanceId,
            TriggerCondition.ON_LIVE_START
          ),
        ],
      };

      const preview = resolvePendingCardEffects(game).gameState;
      expect(preview.activeEffect).toMatchObject({
        abilityId: S_SD1_022_LIVE_START_AQOURS_STAGE_MEMBERS_GAIN_BLADE_ABILITY_ID,
        metadata: { confirmOnlyPendingAbility: true },
      });
      expect(preview.activeEffect?.effectText).toContain(
        `当前自己舞台 Aqours 成员 ${ownAqoursCount}名`
      );
      expect(preview.activeEffect?.effectText).toContain(
        `实际获得[BLADE]的成员 ${expectedBladeCount}名`
      );

      const resolved = confirmActiveEffectStep(preview, PLAYER1, preview.activeEffect!.id);
      const bladeModifiers = resolved.liveResolution.liveModifiers.filter(
        (modifier) =>
          modifier.kind === 'BLADE' &&
          modifier.abilityId === S_SD1_022_LIVE_START_AQOURS_STAGE_MEMBERS_GAIN_BLADE_ABILITY_ID
      );
      expect(bladeModifiers).toHaveLength(expectedBladeCount);
      for (const aqoursMember of aqoursMembers) {
        expect(bladeModifiers).toContainEqual({
          kind: 'BLADE',
          playerId: PLAYER1,
          countDelta: 1,
          sourceCardId: aqoursMember.instanceId,
          abilityId: S_SD1_022_LIVE_START_AQOURS_STAGE_MEMBERS_GAIN_BLADE_ABILITY_ID,
        });
      }
      expect(bladeModifiers.some((modifier) => modifier.sourceCardId === nonAqoursMember.instanceId)).toBe(false);
      expect(
        bladeModifiers.some((modifier) => modifier.sourceCardId === opponentAqoursMember.instanceId)
      ).toBe(false);
    }
  );

  it('PL!S-sd1-022 rechecks the source LIVE and no-ops if it left own liveZone before confirmation', () => {
    const sourceLive = createCardInstance(
      createLiveCard('PL!S-sd1-022-SD', { name: 'Jump up HIGH!!' }),
      PLAYER1,
      'jump-up-high-left'
    );
    const aqoursMember = createCardInstance(
      createMemberCard('PL!S-aqours-member-left'),
      PLAYER1,
      'aqours-left'
    );
    let game = registerCards(createGameState('sd1-022-left', PLAYER1, 'P1', PLAYER2, 'P2'), [
      sourceLive,
      aqoursMember,
    ]);
    game = placeLiveZone(game, [sourceLive.instanceId]);
    game = placeStageMembers(game, [{ cardId: aqoursMember.instanceId, slot: SlotPosition.CENTER }]);
    game = {
      ...game,
      pendingAbilities: [
        createPendingAbility(
          S_SD1_022_LIVE_START_AQOURS_STAGE_MEMBERS_GAIN_BLADE_ABILITY_ID,
          sourceLive.instanceId,
          TriggerCondition.ON_LIVE_START
        ),
      ],
    };

    const preview = resolvePendingCardEffects(game).gameState;
    const sourceLeft = updatePlayer(preview, PLAYER1, (player) => ({
      ...player,
      liveZone: {
        ...player.liveZone,
        cardIds: [],
        cardStates: new Map(),
      },
    }));
    const resolved = confirmActiveEffectStep(sourceLeft, PLAYER1, sourceLeft.activeEffect!.id);

    expect(
      resolved.liveResolution.liveModifiers.some(
        (modifier) =>
          modifier.abilityId === S_SD1_022_LIVE_START_AQOURS_STAGE_MEMBERS_GAIN_BLADE_ABILITY_ID
      )
    ).toBe(false);
    expect(resolved.pendingAbilities).toEqual([]);
  });

  it('PL!S-sd1-022 resolves multiple pending abilities in order without confirm-only bridges', () => {
    const sourceLives = [
      createCardInstance(
        createLiveCard('PL!S-sd1-022-SD', { name: 'Jump up HIGH!! A' }),
        PLAYER1,
        'jump-up-high-order-a'
      ),
      createCardInstance(
        createLiveCard('PL!S-sd1-022-SD', { name: 'Jump up HIGH!! B' }),
        PLAYER1,
        'jump-up-high-order-b'
      ),
    ];
    const aqoursMember = createCardInstance(
      createMemberCard('PL!S-order-aqours-member'),
      PLAYER1,
      'order-aqours-member'
    );
    let game = registerCards(createGameState('sd1-022-order', PLAYER1, 'P1', PLAYER2, 'P2'), [
      ...sourceLives,
      aqoursMember,
    ]);
    game = placeLiveZone(
      game,
      sourceLives.map((card) => card.instanceId)
    );
    game = placeStageMembers(game, [{ cardId: aqoursMember.instanceId, slot: SlotPosition.CENTER }]);
    game = {
      ...game,
      pendingAbilities: sourceLives.map((sourceLive, index) =>
        createPendingAbility(
          S_SD1_022_LIVE_START_AQOURS_STAGE_MEMBERS_GAIN_BLADE_ABILITY_ID,
          sourceLive.instanceId,
          TriggerCondition.ON_LIVE_START,
          index === 0 ? SlotPosition.LEFT : SlotPosition.RIGHT
        )
      ),
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
    expect(
      resolved.liveResolution.liveModifiers.filter(
        (modifier) =>
          modifier.kind === 'BLADE' &&
          modifier.abilityId === S_SD1_022_LIVE_START_AQOURS_STAGE_MEMBERS_GAIN_BLADE_ABILITY_ID &&
          modifier.sourceCardId === aqoursMember.instanceId
      )
    ).toHaveLength(2);
  });

  it('PL!S-bp6-009 continuous BLADE equals the opponent success Live count lead', () => {
    const ruby = createCardInstance(
      createMemberCard('PL!S-bp6-009-P', { name: '黒澤ルビィ', cost: 9, blade: 2 }),
      PLAYER1,
      'ruby-continuous'
    );
    const ownSuccess = createCardInstance(createLiveCard('PL!S-own-success'), PLAYER1, 'own-success');
    const opponentSuccess = [1, 2, 3].map((index) =>
      createCardInstance(
        createLiveCard(`PL!S-opponent-success-${index}`),
        PLAYER2,
        `opponent-success-${index}`
      )
    );
    let game = registerCards(createGameState('bp6-009-continuous', PLAYER1, 'P1', PLAYER2, 'P2'), [
      ruby,
      ownSuccess,
      ...opponentSuccess,
    ]);
    game = placeStageMembers(game, [{ cardId: ruby.instanceId, slot: SlotPosition.CENTER }]);
    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      successZone: addCardToZone(player.successZone, ownSuccess.instanceId),
    }));
    game = updatePlayer(game, PLAYER2, (player) => ({
      ...player,
      successZone: opponentSuccess.reduce(
        (zone, card) => addCardToZone(zone, card.instanceId),
        player.successZone
      ),
    }));

    expect(collectLiveModifiers(game)).toContainEqual({
      kind: 'BLADE',
      playerId: PLAYER1,
      countDelta: 2,
      sourceCardId: ruby.instanceId,
      abilityId: S_BP6_009_CONTINUOUS_SUCCESS_LIVE_DIFFERENCE_GAIN_BLADE_ABILITY_ID,
    });

    const tiedGame = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      successZone: opponentSuccess.reduce(
        (zone, card) => addCardToZone(zone, card.instanceId),
        player.successZone
      ),
    }));
    expect(
      collectLiveModifiers(tiedGame).some(
        (modifier) =>
          modifier.abilityId === S_BP6_009_CONTINUOUS_SUCCESS_LIVE_DIFFERENCE_GAIN_BLADE_ABILITY_ID
      )
    ).toBe(false);
  });

  it('PL!S-bp6-009 LIVE_SUCCESS adds total score for non-additional center cheer SCORE Aqours LIVE', () => {
    const ruby = createCardInstance(
      createMemberCard('PL!S-bp6-009-P', { name: '黒澤ルビィ', cost: 9 }),
      PLAYER1,
      'ruby-live-success'
    );
    const scoreAqoursLive = createCardInstance(
      createLiveCard('PL!S-score-aqours-live', { hasScore: true }),
      PLAYER1,
      'score-aqours-live'
    );
    let game = registerCards(createGameState('bp6-009-live-success', PLAYER1, 'P1', PLAYER2, 'P2'), [
      ruby,
      scoreAqoursLive,
    ]);
    game = placeStageMembers(game, [{ cardId: ruby.instanceId, slot: SlotPosition.CENTER }]);
    game = emitGameEvent(
      game,
      createCheerEvent(PLAYER1, [scoreAqoursLive.instanceId], 1, { additional: false })
    );
    game = setCurrentCenterCheerCards(game, [scoreAqoursLive.instanceId]);
    game = {
      ...game,
      pendingAbilities: [
        createPendingAbility(
          S_BP6_009_LIVE_SUCCESS_CENTER_CHEER_SCORE_AQOURS_LIVE_SCORE_ABILITY_ID,
          ruby.instanceId,
          TriggerCondition.ON_LIVE_SUCCESS
        ),
      ],
    };

    const preview = resolvePendingCardEffects(game).gameState;
    expect(preview.activeEffect?.effectText).toContain('当前声援[スコア]Aqours LIVE 1张');
    expect(preview.activeEffect?.effectText).not.toContain('当前中央声援');
    const resolved = confirmIfConfirmOnly(preview);

    expect(resolved.liveResolution.playerScores.get(PLAYER1)).toBe(1);
    expect(resolved.liveResolution.liveModifiers).toContainEqual({
      kind: 'SCORE',
      playerId: PLAYER1,
      countDelta: 1,
      sourceCardId: ruby.instanceId,
      abilityId: S_BP6_009_LIVE_SUCCESS_CENTER_CHEER_SCORE_AQOURS_LIVE_SCORE_ABILITY_ID,
    });
  });

  it('PL!S-bp6-009 LIVE_SUCCESS ignores historical center cheer from a previous Live', () => {
    const ruby = createCardInstance(
      createMemberCard('PL!S-bp6-009-P', { name: '黒澤ルビィ', cost: 9 }),
      PLAYER1,
      'ruby-history'
    );
    const historicalScoreAqoursLive = createCardInstance(
      createLiveCard('PL!S-historical-score-aqours-live', { hasScore: true }),
      PLAYER1,
      'historical-score-aqours-live'
    );
    const currentNoScoreAqoursLive = createCardInstance(
      createLiveCard('PL!S-current-no-score-aqours-live'),
      PLAYER1,
      'current-no-score-aqours-live'
    );
    let game = registerCards(
      createGameState('bp6-009-live-success-history', PLAYER1, 'P1', PLAYER2, 'P2'),
      [ruby, historicalScoreAqoursLive, currentNoScoreAqoursLive]
    );
    game = placeStageMembers(game, [{ cardId: ruby.instanceId, slot: SlotPosition.CENTER }]);
    game = emitGameEvent(
      game,
      createCheerEvent(PLAYER1, [historicalScoreAqoursLive.instanceId], 1)
    );
    game = emitGameEvent(
      game,
      createCheerEvent(PLAYER1, [currentNoScoreAqoursLive.instanceId], 1)
    );
    game = setCurrentCenterCheerCards(game, [currentNoScoreAqoursLive.instanceId]);
    game = {
      ...game,
      pendingAbilities: [
        createPendingAbility(
          S_BP6_009_LIVE_SUCCESS_CENTER_CHEER_SCORE_AQOURS_LIVE_SCORE_ABILITY_ID,
          ruby.instanceId,
          TriggerCondition.ON_LIVE_SUCCESS
        ),
      ],
    };

    const resolved = confirmIfConfirmOnly(resolvePendingCardEffects(game).gameState);

    expect(resolved.liveResolution.playerScores.get(PLAYER1)).toBeUndefined();
    expect(resolved.liveResolution.liveModifiers).toHaveLength(0);
  });

  it('PL!S-bp6-009 LIVE_SUCCESS ignores non-score targets and additional cheer', () => {
    const ruby = createCardInstance(createMemberCard('PL!S-bp6-009-P'), PLAYER1, 'ruby-no-score');
    const scoreAqoursLive = createCardInstance(
      createLiveCard('PL!S-score-aqours-live', { hasScore: true }),
      PLAYER1,
      'additional-score-aqours-live'
    );
    const noScoreAqoursLive = createCardInstance(
      createLiveCard('PL!S-no-score-aqours-live'),
      PLAYER1,
      'no-score-aqours-live'
    );
    let game = registerCards(createGameState('bp6-009-live-success-miss', PLAYER1, 'P1', PLAYER2, 'P2'), [
      ruby,
      scoreAqoursLive,
      noScoreAqoursLive,
    ]);
    game = placeStageMembers(game, [{ cardId: ruby.instanceId, slot: SlotPosition.CENTER }]);
    game = emitGameEvent(game, createCheerEvent(PLAYER1, [noScoreAqoursLive.instanceId], 1));
    game = emitGameEvent(
      game,
      createCheerEvent(PLAYER1, [scoreAqoursLive.instanceId], 1, { additional: true })
    );
    game = setCurrentCenterCheerCards(game, [
      noScoreAqoursLive.instanceId,
      scoreAqoursLive.instanceId,
    ]);
    game = {
      ...game,
      pendingAbilities: [
        createPendingAbility(
          S_BP6_009_LIVE_SUCCESS_CENTER_CHEER_SCORE_AQOURS_LIVE_SCORE_ABILITY_ID,
          ruby.instanceId,
          TriggerCondition.ON_LIVE_SUCCESS
        ),
      ],
    };

    const resolved = confirmIfConfirmOnly(resolvePendingCardEffects(game).gameState);

    expect(resolved.liveResolution.playerScores.get(PLAYER1)).toBeUndefined();
    expect(resolved.liveResolution.liveModifiers).toHaveLength(0);
  });
});

describe('PL!S-bp2-022-L 未熟DREAMER', () => {
  function createDreamerGame(options: {
    readonly refreshed?: boolean;
    readonly opponentRefreshed?: boolean;
    readonly previousTurnRefreshed?: boolean;
    readonly controllerId?: string;
    readonly sourceIds?: readonly string[];
  } = {}): { readonly game: GameState; readonly sourceIds: readonly string[] } {
    const controllerId = options.controllerId ?? PLAYER1;
    const opponentId = controllerId === PLAYER1 ? PLAYER2 : PLAYER1;
    const sourceIds = options.sourceIds ?? ['dreamer-live'];
    const sourceLives = sourceIds.map((instanceId) =>
      createCardInstance(
        createLiveCard('PL!S-bp2-022-L', { name: '未熟DREAMER' }),
        controllerId,
        instanceId
      )
    );
    let game: GameState = {
      ...registerCards(
        createGameState('bp2-022-dreamer', PLAYER1, 'P1', PLAYER2, 'P2'),
        sourceLives
      ),
      turnCount: 1,
    };
    game = placeLiveZone(game, sourceIds, controllerId);
    game = updatePlayer(game, controllerId, (player) => ({
      ...player,
      ...(options.refreshed === true
        ? { lastDeckRefreshTurnCount: game.turnCount }
        : options.previousTurnRefreshed === true
          ? { lastDeckRefreshTurnCount: game.turnCount - 1 }
          : {}),
    }));
    game = updatePlayer(game, opponentId, (player) => ({
      ...player,
      ...(options.opponentRefreshed === true
        ? { lastDeckRefreshTurnCount: game.turnCount }
        : {}),
    }));
    return {
      game: {
        ...game,
        pendingAbilities: sourceIds.map((sourceCardId) =>
          createPendingAbility(
            S_BP2_022_LIVE_SUCCESS_DECK_REFRESHED_THIS_TURN_THIS_LIVE_SCORE_ABILITY_ID,
            sourceCardId,
            TriggerCondition.ON_LIVE_SUCCESS,
            SlotPosition.CENTER,
            controllerId
          )
        ),
      },
      sourceIds,
    };
  }

  it('shows a single confirm-only preview and gives only the source LIVE +2 after confirmation', () => {
    const { game, sourceIds } = createDreamerGame({ refreshed: true });
    const preview = resolvePendingCardEffects(game).gameState;

    expect(preview.activeEffect?.metadata?.confirmOnlyPendingAbility).toBe(true);
    expect(preview.activeEffect?.effectText).toBe(
      '【LIVE成功时】此回合中，自己的卡组更新的场合、此卡的分数+2。（本回合自己的卡组已更新，满足条件，实际分数+2。）'
    );
    expect(preview.liveResolution.playerScores.get(PLAYER1)).toBeUndefined();
    expect(preview.liveResolution.liveModifiers).toHaveLength(0);

    const resolved = confirmActiveEffectStep(preview, PLAYER1, preview.activeEffect!.id);
    expect(resolved.liveResolution.playerScores.get(PLAYER1)).toBe(2);
    expect(resolved.liveResolution.liveModifiers).toContainEqual(
      expect.objectContaining({
        kind: 'SCORE',
        abilityId: S_BP2_022_LIVE_SUCCESS_DECK_REFRESHED_THIS_TURN_THIS_LIVE_SCORE_ABILITY_ID,
        liveCardId: sourceIds[0],
        countDelta: 2,
      })
    );
    expect(resolved.actionHistory.at(-1)?.payload).toMatchObject({
      sourceCardId: sourceIds[0],
      deckRefreshedThisTurn: true,
      scoreBonus: 2,
      step: 'DECK_REFRESHED_THIS_TURN_THIS_LIVE_SCORE',
    });
  });

  it('does not add score when only the opponent refreshed or the controller refreshed last global turn', () => {
    for (const options of [
      { opponentRefreshed: true },
      { previousTurnRefreshed: true },
    ]) {
      const { game } = createDreamerGame(options);
      const preview = resolvePendingCardEffects(game).gameState;
      expect(preview.activeEffect?.effectText).toContain(
        '本回合自己的卡组未更新，未满足条件，实际分数+0。'
      );
      const resolved = confirmActiveEffectStep(preview, PLAYER1, preview.activeEffect!.id);
      expect(resolved.liveResolution.playerScores.get(PLAYER1)).toBeUndefined();
      expect(resolved.liveResolution.liveModifiers).toHaveLength(0);
      expect(resolved.actionHistory.at(-1)?.payload).toMatchObject({
        deckRefreshedThisTurn: false,
        scoreBonus: 0,
      });
    }
  });

  it('keeps a later player refresh valid across that player ACTIVE cleanup in the same global turn', () => {
    const { game } = createDreamerGame({ controllerId: PLAYER2, refreshed: true });
    const afterSecondPlayerActive = updatePlayer(game, PLAYER2, clearTurnMoveRecords);
    const preview = resolvePendingCardEffects(afterSecondPlayerActive).gameState;

    expect(preview.activeEffect?.effectText).toContain(
      '本回合自己的卡组已更新，满足条件，实际分数+2。'
    );
    const resolved = confirmActiveEffectStep(preview, PLAYER2, preview.activeEffect!.id);
    expect(resolved.liveResolution.playerScores.get(PLAYER2)).toBe(2);
  });

  it('does not write a modifier when the source LIVE is stale at final confirmation', () => {
    const { game } = createDreamerGame({ refreshed: true });
    const preview = resolvePendingCardEffects(game).gameState;
    const stale = updatePlayer(preview, PLAYER1, (player) => ({
      ...player,
      liveZone: { ...player.liveZone, cardIds: [], cardStates: new Map() },
    }));

    const resolved = confirmActiveEffectStep(stale, PLAYER1, stale.activeEffect!.id);
    expect(resolved.pendingAbilities).toEqual([]);
    expect(resolved.liveResolution.playerScores.get(PLAYER1)).toBeUndefined();
    expect(resolved.liveResolution.liveModifiers).toHaveLength(0);
    expect(resolved.actionHistory.at(-1)?.payload).toMatchObject({
      deckRefreshedThisTurn: true,
      scoreBonus: 0,
      step: 'SOURCE_LIVE_NOT_IN_OWN_LIVE_ZONE',
    });
  });

  it('resolves multiple pending abilities in order without confirm-only bridges', () => {
    const { game, sourceIds } = createDreamerGame({
      refreshed: true,
      sourceIds: ['dreamer-order-a', 'dreamer-order-b'],
    });
    const orderSelection = resolvePendingCardEffects(game).gameState;
    const resolved = confirmActiveEffectStep(
      orderSelection,
      PLAYER1,
      orderSelection.activeEffect!.id,
      null,
      null,
      true
    );

    expect(resolved.activeEffect).toBeNull();
    expect(resolved.liveResolution.playerScores.get(PLAYER1)).toBe(4);
    expect(
      resolved.liveResolution.liveModifiers.filter(
        (modifier) =>
          modifier.abilityId ===
          S_BP2_022_LIVE_SUCCESS_DECK_REFRESHED_THIS_TURN_THIS_LIVE_SCORE_ABILITY_ID
      )
    ).toHaveLength(2);
    expect(resolved.liveResolution.liveModifiers.map((modifier) => modifier.liveCardId)).toEqual(
      sourceIds
    );
  });

  it('opens confirm-only after manually selecting one ability from multiple pending abilities', () => {
    const { game, sourceIds } = createDreamerGame({
      refreshed: true,
      sourceIds: ['dreamer-manual-a', 'dreamer-manual-b'],
    });
    const orderSelection = resolvePendingCardEffects(game).gameState;
    const confirmation = confirmActiveEffectStep(
      orderSelection,
      PLAYER1,
      orderSelection.activeEffect!.id,
      sourceIds[1]
    );

    expect(confirmation.activeEffect?.metadata?.confirmOnlyPendingAbility).toBe(true);
    expect(confirmation.liveResolution.playerScores.get(PLAYER1)).toBeUndefined();
    const resolved = confirmActiveEffectStep(confirmation, PLAYER1, confirmation.activeEffect!.id);
    expect(resolved.liveResolution.playerScores.get(PLAYER1)).toBe(2);
    expect(resolved.liveResolution.liveModifiers).toContainEqual(
      expect.objectContaining({ liveCardId: sourceIds[1], countDelta: 2 })
    );
  });
});
