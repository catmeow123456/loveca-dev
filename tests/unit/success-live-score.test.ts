import { describe, expect, it } from 'vitest';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
  type LiveCardData,
  type MemberCardData,
} from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import {
  addMemberBelowMember,
  placeCardInSlot,
  removeCardFromSlot,
} from '../../src/domain/entities/zone';
import {
  getSuccessfulLiveEffectiveScore,
  successLiveScoreAtLeast,
  sumSuccessfulLiveScore,
} from '../../src/domain/rules/success-live-score';
import { getMemberEffectiveCost } from '../../src/domain/rules/member-effective-cost';
import { collectLiveModifiers } from '../../src/domain/rules/live-modifiers';
import {
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
} from '../../src/shared/types/enums';

const PLAYER1 = 'p1';
const PLAYER2 = 'p2';
const ANGELIC_ABILITY_ID =
  'PL!-bp4-019:continuous-success-zone-muse-stage-this-card-score-plus-five';
const NICO_ABILITY_ID = 'PL!-bp4-018:continuous-success-score-lead-gain-two-blade';

function liveCard(
  instanceId: string,
  options: { readonly cardCode?: string; readonly ownerId?: string; readonly score?: number } = {}
) {
  const data: LiveCardData = {
    cardCode: options.cardCode ?? instanceId,
    name: instanceId,
    cardType: CardType.LIVE,
    score: options.score ?? 4,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
  };
  return createCardInstance(data, options.ownerId ?? PLAYER1, instanceId);
}

function memberCard(
  instanceId: string,
  options: {
    readonly cardCode?: string;
    readonly ownerId?: string;
    readonly groupNames?: readonly string[];
    readonly cost?: number;
  } = {}
) {
  const data: MemberCardData = {
    cardCode: options.cardCode ?? instanceId,
    name: instanceId,
    cardType: CardType.MEMBER,
    cost: options.cost ?? 4,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
    groupNames: options.groupNames,
  };
  return createCardInstance(data, options.ownerId ?? PLAYER1, instanceId);
}

function setupSuccessGame(options: {
  readonly ownSuccess?: readonly ReturnType<typeof liveCard>[];
  readonly opponentSuccess?: readonly ReturnType<typeof liveCard>[];
  readonly ownStage?: readonly ReturnType<typeof memberCard>[];
  readonly opponentStage?: readonly ReturnType<typeof memberCard>[];
  readonly ownMemberBelow?: readonly ReturnType<typeof memberCard>[];
  readonly ownExtraCards?: readonly ReturnType<typeof memberCard>[];
  readonly waitingOwnStage?: boolean;
}): GameState {
  const ownSuccess = options.ownSuccess ?? [];
  const opponentSuccess = options.opponentSuccess ?? [];
  const ownStage = options.ownStage ?? [];
  const opponentStage = options.opponentStage ?? [];
  const ownMemberBelow = options.ownMemberBelow ?? [];
  let game = createGameState('success-live-score', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [
    ...ownSuccess,
    ...opponentSuccess,
    ...ownStage,
    ...opponentStage,
    ...ownMemberBelow,
    ...(options.ownExtraCards ?? []),
  ]);
  game = updatePlayer(game, PLAYER1, (player) => {
    let memberSlots = player.memberSlots;
    ownStage.forEach((card, index) => {
      const slot = [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT][index];
      if (slot) {
        memberSlots = placeCardInSlot(memberSlots, slot, card.instanceId, {
          orientation: options.waitingOwnStage ? OrientationState.WAITING : OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        });
      }
    });
    ownMemberBelow.forEach((card) => {
      memberSlots = addMemberBelowMember(memberSlots, SlotPosition.LEFT, card.instanceId);
    });
    return {
      ...player,
      memberSlots,
      successZone: { ...player.successZone, cardIds: ownSuccess.map((card) => card.instanceId) },
    };
  });
  return updatePlayer(game, PLAYER2, (player) => {
    let memberSlots = player.memberSlots;
    opponentStage.forEach((card, index) => {
      const slot = [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT][index];
      if (slot) {
        memberSlots = placeCardInSlot(memberSlots, slot, card.instanceId);
      }
    });
    return {
      ...player,
      memberSlots,
      successZone: {
        ...player.successZone,
        cardIds: opponentSuccess.map((card) => card.instanceId),
      },
    };
  });
}

describe('successful LIVE effective score', () => {
  it('returns zero for an empty success zone', () => {
    const game = setupSuccessGame({});
    expect(sumSuccessfulLiveScore(game, PLAYER1)).toBe(0);
  });

  it('keeps printed-score sums when no dynamic modifier applies', () => {
    const game = setupSuccessGame({
      ownSuccess: [liveCard('score-two', { score: 2 }), liveCard('score-four', { score: 4 })],
    });
    expect(sumSuccessfulLiveScore(game, PLAYER1)).toBe(6);
  });

  it('gives Angelic Angel effective score 9 in its owner success zone with a main-stage muse', () => {
    const angelic = liveCard('angelic', { cardCode: 'PL!-bp4-019-L' });
    const muse = memberCard('muse', { groupNames: ['μ’s'] });
    const game = setupSuccessGame({ ownSuccess: [angelic], ownStage: [muse] });

    expect(getSuccessfulLiveEffectiveScore(game, PLAYER1, angelic.instanceId)).toBe(9);
    expect(sumSuccessfulLiveScore(game, PLAYER1)).toBe(9);
    expect(game.liveResolution.liveModifiers).toEqual([]);
    expect(game.liveResolution.playerScores.size).toBe(0);
  });

  it('keeps Angelic Angel at 4 without a muse or with only a non-muse member', () => {
    const angelic = liveCard('angelic-no-muse', { cardCode: 'PL!-bp4-019-L' });
    const noStageGame = setupSuccessGame({ ownSuccess: [angelic] });
    const aqoursGame = setupSuccessGame({
      ownSuccess: [angelic],
      ownStage: [memberCard('aqours', { groupNames: ['Aqours'] })],
    });

    expect(getSuccessfulLiveEffectiveScore(noStageGame, PLAYER1, angelic.instanceId)).toBe(4);
    expect(getSuccessfulLiveEffectiveScore(aqoursGame, PLAYER1, angelic.instanceId)).toBe(4);
  });

  it('does not count a muse in memberBelow as a main-stage member', () => {
    const angelic = liveCard('angelic-below', { cardCode: 'PL!-bp4-019-L' });
    const museBelow = memberCard('muse-below', { groupNames: ['μ’s'] });
    const game = setupSuccessGame({ ownSuccess: [angelic], ownMemberBelow: [museBelow] });
    expect(getSuccessfulLiveEffectiveScore(game, PLAYER1, angelic.instanceId)).toBe(4);
  });

  it('accepts a WAITING muse that remains in a main member slot', () => {
    const angelic = liveCard('angelic-waiting', { cardCode: 'PL!-bp4-019-L' });
    const muse = memberCard('waiting-muse', { groupNames: ['μ’s'] });
    const game = setupSuccessGame({
      ownSuccess: [angelic],
      ownStage: [muse],
      waitingOwnStage: true,
    });
    expect(getSuccessfulLiveEffectiveScore(game, PLAYER1, angelic.instanceId)).toBe(9);
  });

  it('does not use a muse from the opponent stage', () => {
    const angelic = liveCard('angelic-opponent-stage', { cardCode: 'PL!-bp4-019-L' });
    const opponentMuse = memberCard('opponent-muse', {
      ownerId: PLAYER2,
      groupNames: ['μ’s'],
    });
    const game = setupSuccessGame({ ownSuccess: [angelic], opponentStage: [opponentMuse] });
    expect(getSuccessfulLiveEffectiveScore(game, PLAYER1, angelic.instanceId)).toBe(4);
  });

  it.each(['hand', 'mainDeck', 'waitingRoom', 'liveZone'] as const)(
    'does not activate Angelic Angel from %s',
    (zoneName) => {
      const angelic = liveCard(`angelic-${zoneName}`, { cardCode: 'PL!-bp4-019-L' });
      const muse = memberCard(`muse-${zoneName}`, { groupNames: ['μ’s'] });
      let game = setupSuccessGame({ ownStage: [muse], ownExtraCards: [] });
      game = registerCards(game, [angelic]);
      game = updatePlayer(game, PLAYER1, (player) => ({
        ...player,
        [zoneName]: {
          ...player[zoneName],
          cardIds: [angelic.instanceId],
        },
      }));

      expect(getSuccessfulLiveEffectiveScore(game, PLAYER1, angelic.instanceId)).toBe(0);
      expect(sumSuccessfulLiveScore(game, PLAYER1)).toBe(0);
    }
  );

  it('rejects missing cards, wrong-owner cards, and duplicate invalid zone entries', () => {
    const wrongOwner = liveCard('wrong-owner-angelic', {
      cardCode: 'PL!-bp4-019-L',
      ownerId: PLAYER2,
    });
    const muse = memberCard('ownership-muse', { groupNames: ['μ’s'] });
    let game = setupSuccessGame({ ownStage: [muse] });
    game = registerCards(game, [wrongOwner]);
    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      successZone: {
        ...player.successZone,
        cardIds: [wrongOwner.instanceId, wrongOwner.instanceId, 'missing-live'],
      },
    }));

    expect(getSuccessfulLiveEffectiveScore(game, PLAYER1, wrongOwner.instanceId)).toBe(0);
    expect(getSuccessfulLiveEffectiveScore(game, PLAYER1, 'missing-live')).toBe(0);
    expect(sumSuccessfulLiveScore(game, PLAYER1)).toBe(0);
  });

  it('stacks two distinct Angelic Angel cards independently to 18', () => {
    const first = liveCard('angelic-first', { cardCode: 'PL!-bp4-019-L' });
    const second = liveCard('angelic-second', { cardCode: 'PL!-bp4-019-L' });
    const muse = memberCard('two-angelic-muse', { groupNames: ['μ’s'] });
    const game = setupSuccessGame({ ownSuccess: [first, second], ownStage: [muse] });
    expect(sumSuccessfulLiveScore(game, PLAYER1)).toBe(18);
  });

  it('adds Angelic Angel effective score to other successful LIVE scores', () => {
    const angelic = liveCard('angelic-with-other', { cardCode: 'PL!-bp4-019-L' });
    const other = liveCard('other-score-three', { score: 3 });
    const muse = memberCard('coexist-muse', { groupNames: ['μ’s'] });
    const game = setupSuccessGame({ ownSuccess: [angelic, other], ownStage: [muse] });
    expect(sumSuccessfulLiveScore(game, PLAYER1)).toBe(12);
  });

  it('recomputes immediately after the last muse leaves and leaves no stale modifier', () => {
    const angelic = liveCard('dynamic-angelic', { cardCode: 'PL!-bp4-019-L' });
    const muse = memberCard('dynamic-muse', { groupNames: ['μ’s'] });
    const active = setupSuccessGame({ ownSuccess: [angelic], ownStage: [muse] });
    expect(sumSuccessfulLiveScore(active, PLAYER1)).toBe(9);

    const inactive = updatePlayer(active, PLAYER1, (player) => ({
      ...player,
      memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.LEFT),
      waitingRoom: { ...player.waitingRoom, cardIds: [muse.instanceId] },
    }));
    expect(sumSuccessfulLiveScore(inactive, PLAYER1)).toBe(4);
    expect(inactive.liveResolution.liveModifiers).toEqual([]);
  });

  it('uses effective score for successLiveScoreAtLeast thresholds 6 and 9', () => {
    const angelic = liveCard('threshold-angelic', { cardCode: 'PL!-bp4-019-L' });
    const muse = memberCard('threshold-muse', { groupNames: ['μ’s'] });
    const game = setupSuccessGame({ ownSuccess: [angelic], ownStage: [muse] });
    expect(successLiveScoreAtLeast(game, PLAYER1, 6)).toBe(true);
    expect(successLiveScoreAtLeast(game, PLAYER1, 9)).toBe(true);
    expect(successLiveScoreAtLeast(game, PLAYER1, 10)).toBe(false);
  });

  it('ignores a non-LIVE card anomalously placed in the success zone', () => {
    const nonLive = memberCard('non-live-success', { groupNames: ['μ’s'] });
    let game = setupSuccessGame({});
    game = registerCards(game, [nonLive]);
    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      successZone: { ...player.successZone, cardIds: [nonLive.instanceId] },
    }));
    expect(getSuccessfulLiveEffectiveScore(game, PLAYER1, nonLive.instanceId)).toBe(0);
    expect(sumSuccessfulLiveScore(game, PLAYER1)).toBe(0);
  });

  it('returns zero after Angelic Angel leaves the success zone without changing live score state', () => {
    const angelic = liveCard('departing-angelic', { cardCode: 'PL!-bp4-019-L' });
    const muse = memberCard('departing-muse', { groupNames: ['μ’s'] });
    const active = setupSuccessGame({ ownSuccess: [angelic], ownStage: [muse] });
    const playerScores = active.liveResolution.playerScores;
    const moved = updatePlayer(active, PLAYER1, (player) => ({
      ...player,
      successZone: { ...player.successZone, cardIds: [] },
      waitingRoom: { ...player.waitingRoom, cardIds: [angelic.instanceId] },
    }));

    expect(getSuccessfulLiveEffectiveScore(moved, PLAYER1, angelic.instanceId)).toBe(0);
    expect(sumSuccessfulLiveScore(moved, PLAYER1)).toBe(0);
    expect(moved.liveResolution.playerScores).toBe(playerScores);
    expect(moved.liveResolution.liveModifiers).toEqual([]);
  });
});

describe('existing successful-LIVE score consumers', () => {
  it('lets PL!-bp4-008 read Angelic Angel effective score through the unified threshold query', () => {
    const angelic = liveCard('cost-threshold-angelic', { cardCode: 'PL!-bp4-019-L' });
    const hanayo = memberCard('bp4-008-hanayo', {
      cardCode: 'PL!-bp4-008-P',
      groupNames: ['μ’s'],
      cost: 4,
    });
    const game = setupSuccessGame({ ownSuccess: [angelic], ownStage: [hanayo] });

    expect(sumSuccessfulLiveScore(game, PLAYER1)).toBe(9);
    expect(getMemberEffectiveCost(game, PLAYER1, hanayo.instanceId)).toBe(7);
  });

  it('lets PL!-bp4-018 compare effective success scores through the unified sum query', () => {
    const angelic = liveCard('lead-angelic', { cardCode: 'PL!-bp4-019-L' });
    const nico = memberCard('bp4-018-nico', {
      cardCode: 'PL!-bp4-018-N',
      groupNames: ['μ’s'],
      cost: 11,
    });
    const opponentLive = liveCard('opponent-score-six', {
      ownerId: PLAYER2,
      score: 6,
    });
    const game = setupSuccessGame({
      ownSuccess: [angelic],
      ownStage: [nico],
      opponentSuccess: [opponentLive],
    });

    expect(sumSuccessfulLiveScore(game, PLAYER1)).toBe(9);
    expect(sumSuccessfulLiveScore(game, PLAYER2)).toBe(6);
    expect(collectLiveModifiers(game)).toContainEqual({
      kind: 'BLADE',
      playerId: PLAYER1,
      countDelta: 2,
      sourceCardId: nico.instanceId,
      abilityId: NICO_ABILITY_ID,
    });
    expect(
      collectLiveModifiers(game).some((modifier) => modifier.abilityId === ANGELIC_ABILITY_ID)
    ).toBe(false);
  });
});
