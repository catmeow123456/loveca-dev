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
import { createCheerEvent } from '../../src/domain/events/game-events';
import { collectLiveModifiers } from '../../src/domain/rules/live-modifiers';
import {
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  S_BP2_023_LIVE_START_OTHER_AQOURS_LIVE_STAGE_MEMBERS_GAIN_BLADE_ABILITY_ID,
  S_BP6_009_CONTINUOUS_SUCCESS_LIVE_DIFFERENCE_GAIN_BLADE_ABILITY_ID,
  S_BP6_009_LIVE_SUCCESS_CENTER_CHEER_SCORE_AQOURS_LIVE_SCORE_ABILITY_ID,
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
  sourceSlot = SlotPosition.CENTER
): PendingAbilityState {
  return {
    id: `${abilityId}:${sourceCardId}:pending`,
    abilityId,
    sourceCardId,
    controllerId: PLAYER1,
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

function placeLiveZone(game: GameState, liveCardIds: readonly string[]): GameState {
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

  it('PL!S-bp2-023 does not give BLADE with only MY舞☆TONIGHT or non-Aqours LIVE cards', () => {
    const sourceLive = createCardInstance(
      createLiveCard('PL!S-bp2-023-L', { name: 'MY舞☆TONIGHT' }),
      PLAYER1,
      'my-mai-only'
    );
    const sameNameLive = createCardInstance(
      createLiveCard('PL!S-bp2-023-L', { name: 'MY舞☆TONIGHT' }),
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

    const resolved = confirmIfConfirmOnly(resolvePendingCardEffects(game).gameState);

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
