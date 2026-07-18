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
import { addCardToZone, placeCardInSlot } from '../../src/domain/entities/zone';
import {
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  HS_BP1_023_LIVE_SUCCESS_HIGHER_SCORE_PLACE_WAITING_ENERGY_ABILITY_ID,
  SP_BP1_023_LIVE_SUCCESS_HIGHER_SCORE_PLACE_WAITING_ENERGY_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
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

function live(cardCode: string): LiveCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: [cardCode.includes('HS') ? '蓮ノ空女学院スクールアイドルクラブ' : 'Liella!'],
    cardType: CardType.LIVE,
    score: cardCode.includes('HS') ? 2 : 1,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
  };
}

function member(cardCode: string, groupName: string): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: [groupName],
    cardType: CardType.MEMBER,
    cost: 1,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function energy(cardCode: string): EnergyCardData {
  return { cardCode, name: cardCode, cardType: CardType.ENERGY };
}

function setup(
  options: {
    readonly family?: 'HS' | 'SP';
    readonly ownScore?: number;
    readonly opponentScore?: number;
    readonly energyDeckCount?: number;
    readonly stagePlacement?: 'OWN_TOP' | 'OPPONENT_TOP' | 'MEMBER_BELOW' | 'WAITING_ROOM' | 'NONE';
    readonly stageGroup?: 'HASUNOSORA' | 'LIELLA';
    readonly sourceOwnerId?: string;
    readonly sourceInLiveZone?: boolean;
    readonly sourceAsMember?: boolean;
  } = {}
) {
  const family = options.family ?? 'HS';
  const abilityId =
    family === 'HS'
      ? HS_BP1_023_LIVE_SUCCESS_HIGHER_SCORE_PLACE_WAITING_ENERGY_ABILITY_ID
      : SP_BP1_023_LIVE_SUCCESS_HIGHER_SCORE_PLACE_WAITING_ENERGY_ABILITY_ID;
  const sourceCode = family === 'HS' ? 'PL!HS-bp1-023-L' : 'PL!SP-bp1-023-L';
  const source = createCardInstance(
    options.sourceAsMember ? member(sourceCode, 'Liella!') : live(sourceCode),
    options.sourceOwnerId ?? P1,
    'source-live'
  );
  const stageGroup = options.stageGroup ?? 'HASUNOSORA';
  const stageMember = createCardInstance(
    member(
      'stage-member',
      stageGroup === 'HASUNOSORA'
        ? '蓮ノ空女学院スクールアイドルクラブ'
        : 'ラブライブ！スーパースター!!'
    ),
    options.stagePlacement === 'OPPONENT_TOP' ? P2 : P1,
    'stage-member'
  );
  const energies = Array.from({ length: options.energyDeckCount ?? 1 }, (_, index) =>
    createCardInstance(energy(`ENERGY-${index}`), P1, `energy-${index}`)
  );
  let game = registerCards(createGameState('higher-score-energy', P1, 'P1', P2, 'P2'), [
    source,
    stageMember,
    ...energies,
  ]);
  game = updatePlayer(game, P1, (player) => {
    let memberSlots = player.memberSlots;
    let waitingRoom = player.waitingRoom;
    if ((options.stagePlacement ?? 'OWN_TOP') === 'OWN_TOP') {
      memberSlots = placeCardInSlot(memberSlots, SlotPosition.CENTER, stageMember.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      });
    } else if (options.stagePlacement === 'MEMBER_BELOW') {
      memberSlots = {
        ...memberSlots,
        memberBelow: {
          ...memberSlots.memberBelow,
          [SlotPosition.CENTER]: [stageMember.instanceId],
        },
      };
    } else if (options.stagePlacement === 'WAITING_ROOM') {
      waitingRoom = addCardToZone(waitingRoom, stageMember.instanceId);
    }
    return {
      ...player,
      liveZone:
        options.sourceInLiveZone === false
          ? player.liveZone
          : addCardToZone(player.liveZone, source.instanceId),
      energyDeck: energies.reduce((zone, card) => addCardToZone(zone, card.instanceId), {
        ...player.energyDeck,
        cardIds: [],
      }),
      energyZone: { ...player.energyZone, cardIds: [], cardStates: new Map() },
      memberSlots,
      waitingRoom,
    };
  });
  if (options.stagePlacement === 'OPPONENT_TOP') {
    game = updatePlayer(game, P2, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(
        player.memberSlots,
        SlotPosition.CENTER,
        stageMember.instanceId,
        { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }
      ),
    }));
  }
  game = {
    ...game,
    liveResolution: {
      ...game.liveResolution,
      playerScores: new Map([
        [P1, options.ownScore ?? 5],
        [P2, options.opponentScore ?? 3],
      ]),
    },
  };
  const pending: PendingAbilityState = {
    id: `pending-${family}`,
    abilityId,
    sourceCardId: source.instanceId,
    controllerId: P1,
    mandatory: true,
    timingId: TriggerCondition.ON_LIVE_SUCCESS,
    eventIds: ['live-success-event'],
  };
  return { game: { ...game, pendingAbilities: [pending] }, pending, source, stageMember, energies };
}

function start(game: GameState): GameState {
  return resolvePendingCardEffects(game).gameState;
}

function confirm(game: GameState): GameState {
  return confirmActiveEffectStep(game, P1, game.activeEffect!.id);
}

describe('higher-score-place-waiting-energy shared workflow', () => {
  it('preserves the full HS-bp1-023 behavior and action contract', () => {
    const scenario = setup();
    const started = start(scenario.game);
    expect(started.activeEffect?.effectText).toContain(
      '自己分数 5，对方分数 3，舞台有莲之空成员，满足条件，能量卡组有牌，实际放置1张待机能量。'
    );
    const done = confirm(started);
    expect(done.players[0].energyZone.cardIds).toEqual(['energy-0']);
    expect(done.players[0].energyZone.cardStates.get('energy-0')?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(done.actionHistory.at(-1)?.payload).toMatchObject({
      abilityId: HS_BP1_023_LIVE_SUCCESS_HIGHER_SCORE_PLACE_WAITING_ENERGY_ABILITY_ID,
      step: 'PLACE_WAITING_ENERGY_IF_HIGHER_SCORE_HASUNOSORA_MEMBER',
      ownScore: 5,
      opponentScore: 3,
      hasHasunosoraStageMember: true,
      conditionMet: true,
      placedEnergyCardIds: ['energy-0'],
    });
  });

  it.each([
    [5, 3, true],
    [3, 3, false],
    [2, 3, false],
  ])('uses strict score comparison for SP: %i vs %i', (ownScore, opponentScore, places) => {
    const scenario = setup({
      family: 'SP',
      ownScore,
      opponentScore,
      stagePlacement: 'NONE',
    });
    const done = confirm(start(scenario.game));
    expect(done.players[0].energyZone.cardIds).toEqual(places ? ['energy-0'] : []);
  });

  it('does not apply the HS stage-group condition to SP-bp1-023', () => {
    const scenario = setup({
      family: 'SP',
      stagePlacement: 'NONE',
      stageGroup: 'LIELLA',
    });
    const started = start(scenario.game);
    expect(started.activeEffect?.effectText).not.toContain('莲之空');
    expect(confirm(started).players[0].energyZone.cardIds).toEqual(['energy-0']);
  });

  it.each(['OPPONENT_TOP', 'MEMBER_BELOW', 'WAITING_ROOM', 'NONE'] as const)(
    'excludes %s from the HS structured main-stage group condition',
    (stagePlacement) => {
      const scenario = setup({ stagePlacement });
      const done = confirm(start(scenario.game));
      expect(done.players[0].energyZone.cardIds).toEqual([]);
    }
  );

  it('requires a structured Hasunosora identity rather than a name-like card code', () => {
    const scenario = setup({ stageGroup: 'LIELLA' });
    const done = confirm(start(scenario.game));
    expect(done.players[0].energyZone.cardIds).toEqual([]);
  });

  it('re-reads scores and conditions at final confirmation time', () => {
    const scenario = setup();
    const started = start(scenario.game);
    const changed = {
      ...started,
      liveResolution: {
        ...started.liveResolution,
        playerScores: new Map([
          [P1, 3],
          [P2, 3],
        ]),
      },
    };
    const done = confirm(changed);
    expect(done.players[0].energyZone.cardIds).toEqual([]);
    expect(done.actionHistory.at(-1)?.payload).toMatchObject({
      ownScore: 3,
      opponentScore: 3,
      conditionMet: false,
    });
  });

  it('safely no-ops with an empty energy deck and previews the actual result', () => {
    const scenario = setup({ energyDeckCount: 0 });
    const started = start(scenario.game);
    expect(started.activeEffect?.effectText).toContain('能量卡组无牌，实际不放置能量');
    const done = confirm(started);
    expect(done.players[0].energyZone.cardIds).toEqual([]);
    expect(done.pendingAbilities).toEqual([]);
  });

  it.each([{ sourceInLiveZone: false }, { sourceOwnerId: P2 }, { sourceAsMember: true }])(
    'rejects stale source owner, type, or live-zone state: %j',
    (stale) => {
      const scenario = setup(stale);
      const done = confirm(start(scenario.game));
      expect(done.players[0].energyZone.cardIds).toEqual([]);
      expect(done.actionHistory.at(-1)?.payload).toMatchObject({
        sourceValid: false,
        conditionMet: false,
        placedEnergyCardIds: [],
      });
    }
  );

  it('keeps ordered pending resolution continuous for the proven HS and SP configs', () => {
    const hs = setup({ energyDeckCount: 2 });
    const spSource = createCardInstance(live('PL!SP-bp1-023-L'), P1, 'sp-source-live');
    let game = registerCards(hs.game, [spSource]);
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      liveZone: addCardToZone(player.liveZone, spSource.instanceId),
    }));
    const spPending: PendingAbilityState = {
      ...hs.pending,
      id: 'pending-SP',
      abilityId: SP_BP1_023_LIVE_SUCCESS_HIGHER_SCORE_PLACE_WAITING_ENERGY_ABILITY_ID,
      sourceCardId: spSource.instanceId,
    };
    game = { ...game, pendingAbilities: [hs.pending, spPending] };
    const orderWindow = start(game);
    const done = confirmActiveEffectStep(
      orderWindow,
      P1,
      orderWindow.activeEffect!.id,
      null,
      null,
      true
    );
    expect(done.activeEffect).toBeNull();
    expect(done.pendingAbilities).toEqual([]);
    expect(done.players[0].energyZone.cardIds).toEqual(['energy-0', 'energy-1']);
  });
});
