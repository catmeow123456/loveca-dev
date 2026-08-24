import { describe, expect, it } from 'vitest';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
  type BladeHearts,
  type LiveCardData,
  type MemberCardData,
} from '../../src/domain/entities/card';
import {
  createGameState,
  emitGameEvent,
  registerCards,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { createEnterStageEvent } from '../../src/domain/events/game-events';
import { placeCardInSlot, removeCardFromSlot } from '../../src/domain/entities/zone';
import {
  confirmActiveEffectStep,
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { PL_PB2_005_ON_ENTER_GAIN_MUSE_STAGE_BLADE_AURA_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import {
  CardAbilityCategory,
  CardAbilitySourceZone,
} from '../../src/application/card-effects/ability-definition-types';
import { getCardAbilityDefinitionsForCardCode } from '../../src/application/card-effects/definitions/lookup';
import {
  getMemberEffectiveBladeCount,
  removeStageMemberBoundLiveModifiers,
} from '../../src/domain/rules/live-modifiers';
import {
  BladeHeartEffect,
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
const EFFECT_TEXT =
  '【登场】自己的成功LIVE卡区存在持有[スコア]的『μ’s』的卡片的场合，LIVE结束时为止，获得『【常时】存在于自己的舞台的『μ’s』的成员，获得[ブレード]。』。';

function member(
  cardCode: string,
  options: {
    readonly name?: string;
    readonly groupNames?: readonly string[];
    readonly blade?: number;
    readonly bladeHearts?: BladeHearts;
  } = {}
): MemberCardData {
  return {
    cardCode,
    name: options.name ?? cardCode,
    groupNames: options.groupNames ?? ["μ's"],
    cardType: CardType.MEMBER,
    cost: 5,
    blade: options.blade ?? 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
    bladeHearts: options.bladeHearts,
  };
}

function rin(cardCode = 'PL!-pb2-005-PP'): MemberCardData {
  return member(cardCode, { name: '星空凛', blade: 0 });
}

function live(
  cardCode: string,
  options: {
    readonly groupNames?: readonly string[];
    readonly bladeHearts?: BladeHearts;
  } = {}
): LiveCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: options.groupNames ?? ["μ's"],
    cardType: CardType.LIVE,
    score: 2,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
    bladeHearts: options.bladeHearts,
  };
}

function scoreBladeHearts(): BladeHearts {
  return [{ effect: BladeHeartEffect.SCORE }];
}

function pending(sourceCardId: string, suffix = sourceCardId): PendingAbilityState {
  return {
    id: `pb2-005:${suffix}:pending`,
    abilityId: PL_PB2_005_ON_ENTER_GAIN_MUSE_STAGE_BLADE_AURA_ABILITY_ID,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId: TriggerCondition.ON_ENTER_STAGE,
    eventIds: [`enter:${suffix}`],
    sourceSlot: SlotPosition.CENTER,
  };
}

function place(
  game: GameState,
  playerId: string,
  slot: SlotPosition,
  cardId: string,
  orientation = OrientationState.ACTIVE
): GameState {
  return updatePlayer(game, playerId, (player) => ({
    ...player,
    memberSlots: placeCardInSlot(player.memberSlots, slot, cardId, {
      orientation,
      face: FaceState.FACE_UP,
    }),
  }));
}

function enqueueRinOnEnter(game: GameState, sourceCardId: string): GameState {
  const event = createEnterStageEvent(
    sourceCardId,
    ZoneType.HAND,
    SlotPosition.CENTER,
    PLAYER1,
    PLAYER1
  );
  return enqueueTriggeredCardEffects(
    emitGameEvent(game, event),
    [TriggerCondition.ON_ENTER_STAGE],
    { enterStageEvents: [event] }
  );
}

function grantAura(game: GameState, sourceCardId: string): GameState {
  let state = resolvePendingCardEffects(enqueueRinOnEnter(game, sourceCardId)).gameState;
  expect(state.activeEffect?.abilityId).toBe(
    PL_PB2_005_ON_ENTER_GAIN_MUSE_STAGE_BLADE_AURA_ABILITY_ID
  );
  state = confirmActiveEffectStep(state, PLAYER1, state.activeEffect!.id);
  expect(state.activeEffect).toBeNull();
  expect(state.pendingAbilities).toEqual([]);
  return state;
}

describe('PL!-pb2-005 星空凛', () => {
  it('registers one ON_ENTER definition by base code with exact exported Chinese text', () => {
    for (const cardCode of ['PL!-pb2-005-PP', 'PL!-pb2-005-R']) {
      expect(getCardAbilityDefinitionsForCardCode(cardCode)).toEqual([
        expect.objectContaining({
          abilityId: PL_PB2_005_ON_ENTER_GAIN_MUSE_STAGE_BLADE_AURA_ABILITY_ID,
          baseCardCodes: ['PL!-pb2-005'],
          category: CardAbilityCategory.ON_ENTER,
          sourceZone: CardAbilitySourceZone.PLAYED_MEMBER,
          triggerCondition: TriggerCondition.ON_ENTER_STAGE,
          queued: true,
          implemented: true,
          effectText: EFFECT_TEXT,
        }),
      ]);
    }
  });

  it('checks own successful structured μ’s SCORE cards of either card type and shows exact realtime confirmation text', () => {
    const source = createCardInstance(rin(), PLAYER1, 'rin-source');
    const scoreMember = createCardInstance(
      member('score-member', { bladeHearts: scoreBladeHearts() }),
      PLAYER1,
      'score-member'
    );
    const scoreLive = createCardInstance(
      live('score-live', { bladeHearts: scoreBladeHearts() }),
      PLAYER1,
      'score-live'
    );
    const noScore = createCardInstance(live('no-score'), PLAYER1, 'no-score');
    const wrongGroup = createCardInstance(
      live('aqours-score', { groupNames: ['Aqours'], bladeHearts: scoreBladeHearts() }),
      PLAYER1,
      'aqours-score'
    );
    const opponentOwned = createCardInstance(
      live('opponent-owned-score', { bladeHearts: scoreBladeHearts() }),
      PLAYER2,
      'opponent-owned-score'
    );
    let game = registerCards(createGameState('pb2-005-query', PLAYER1, 'P1', PLAYER2, 'P2'), [
      source,
      scoreMember,
      scoreLive,
      noScore,
      wrongGroup,
      opponentOwned,
    ]);
    game = place(game, PLAYER1, SlotPosition.CENTER, source.instanceId);
    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      successZone: {
        ...player.successZone,
        cardIds: [
          scoreMember.instanceId,
          scoreLive.instanceId,
          noScore.instanceId,
          wrongGroup.instanceId,
          opponentOwned.instanceId,
        ],
      },
    }));

    const preview = resolvePendingCardEffects(enqueueRinOnEnter(game, source.instanceId)).gameState;

    expect(preview.activeEffect).toMatchObject({
      abilityId: PL_PB2_005_ON_ENTER_GAIN_MUSE_STAGE_BLADE_AURA_ABILITY_ID,
      effectText: `${EFFECT_TEXT}\n\n（当前自己的成功LIVE卡区有2张符合条件的卡片，条件满足；实际自己舞台上的『μ’s』成员各获得[ブレード]。）`,
      stepText: '确认后，自己舞台上的『μ’s』成员各获得[ブレード]。',
    });
  });

  it('persists the granted aura, includes source and future top-level μ’s members, and excludes other recipients', () => {
    const source = createCardInstance(rin(), PLAYER1, 'rin-aura');
    const museTarget = createCardInstance(member('muse-target'), PLAYER1, 'muse-target');
    const nonMuseTarget = createCardInstance(
      member('aqours-target', { groupNames: ['Aqours'] }),
      PLAYER1,
      'aqours-target'
    );
    const below = createCardInstance(member('muse-below'), PLAYER1, 'muse-below');
    const opponentMuse = createCardInstance(member('opponent-muse'), PLAYER2, 'opponent-muse');
    const score = createCardInstance(
      live('qualifying-score', { bladeHearts: scoreBladeHearts() }),
      PLAYER1,
      'qualifying-score'
    );
    let game = registerCards(createGameState('pb2-005-aura', PLAYER1, 'P1', PLAYER2, 'P2'), [
      source,
      museTarget,
      nonMuseTarget,
      below,
      opponentMuse,
      score,
    ]);
    game = place(game, PLAYER1, SlotPosition.CENTER, source.instanceId);
    game = place(game, PLAYER1, SlotPosition.LEFT, museTarget.instanceId);
    game = place(game, PLAYER1, SlotPosition.RIGHT, nonMuseTarget.instanceId);
    game = place(game, PLAYER2, SlotPosition.CENTER, opponentMuse.instanceId);
    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      memberSlots: {
        ...player.memberSlots,
        memberBelow: {
          ...player.memberSlots.memberBelow,
          [SlotPosition.LEFT]: [below.instanceId],
        },
      },
      successZone: { ...player.successZone, cardIds: [score.instanceId] },
    }));

    let state = grantAura(game, source.instanceId);
    expect(state.liveResolution.liveModifiers).toContainEqual({
      kind: 'BLADE',
      target: 'SOURCE_MEMBER',
      playerId: PLAYER1,
      countDelta: 1,
      sourceCardId: source.instanceId,
      abilityId: PL_PB2_005_ON_ENTER_GAIN_MUSE_STAGE_BLADE_AURA_ABILITY_ID,
    });
    expect(getMemberEffectiveBladeCount(state, PLAYER1, source.instanceId)).toBe(1);
    expect(getMemberEffectiveBladeCount(state, PLAYER1, museTarget.instanceId)).toBe(2);
    expect(getMemberEffectiveBladeCount(state, PLAYER1, nonMuseTarget.instanceId)).toBe(1);
    expect(getMemberEffectiveBladeCount(state, PLAYER1, below.instanceId)).toBe(1);
    expect(getMemberEffectiveBladeCount(state, PLAYER2, opponentMuse.instanceId)).toBe(1);

    const futureMuse = createCardInstance(member('future-muse'), PLAYER1, 'future-muse');
    state = registerCards(state, [futureMuse]);
    state = updatePlayer(state, PLAYER1, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(
        removeCardFromSlot(player.memberSlots, SlotPosition.RIGHT),
        SlotPosition.RIGHT,
        futureMuse.instanceId,
        { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }
      ),
    }));
    expect(getMemberEffectiveBladeCount(state, PLAYER1, futureMuse.instanceId)).toBe(2);

    state = updatePlayer(state, PLAYER1, (player) => ({
      ...player,
      memberSlots: {
        ...player.memberSlots,
        cardStates: new Map(player.memberSlots.cardStates).set(source.instanceId, {
          orientation: OrientationState.WAITING,
          face: FaceState.FACE_UP,
        }),
      },
    }));
    expect(getMemberEffectiveBladeCount(state, PLAYER1, futureMuse.instanceId)).toBe(2);

    state = updatePlayer(state, PLAYER1, (player) => ({
      ...player,
      memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.CENTER),
      waitingRoom: {
        ...player.waitingRoom,
        cardIds: [...player.waitingRoom.cardIds, source.instanceId],
      },
    }));
    state = removeStageMemberBoundLiveModifiers(state, [source.instanceId]);
    expect(getMemberEffectiveBladeCount(state, PLAYER1, futureMuse.instanceId)).toBe(1);
  });

  it('snapshots only the successful condition check and does not retroactively grant after failure', () => {
    const source = createCardInstance(rin(), PLAYER1, 'snapshot-rin');
    const target = createCardInstance(member('snapshot-target'), PLAYER1, 'snapshot-target');
    const score = createCardInstance(
      live('snapshot-score', { bladeHearts: scoreBladeHearts() }),
      PLAYER1,
      'snapshot-score'
    );
    let game = registerCards(createGameState('pb2-005-snapshot', PLAYER1, 'P1', PLAYER2, 'P2'), [
      source,
      target,
      score,
    ]);
    game = place(game, PLAYER1, SlotPosition.CENTER, source.instanceId);
    game = place(game, PLAYER1, SlotPosition.LEFT, target.instanceId);
    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      successZone: { ...player.successZone, cardIds: [score.instanceId] },
    }));
    let granted = grantAura(game, source.instanceId);
    granted = updatePlayer(granted, PLAYER1, (player) => ({
      ...player,
      successZone: { ...player.successZone, cardIds: [] },
    }));
    expect(getMemberEffectiveBladeCount(granted, PLAYER1, target.instanceId)).toBe(2);

    let failed = registerCards(createGameState('pb2-005-failed', PLAYER1, 'P1', PLAYER2, 'P2'), [
      source,
      target,
      score,
    ]);
    failed = place(failed, PLAYER1, SlotPosition.CENTER, source.instanceId);
    failed = place(failed, PLAYER1, SlotPosition.LEFT, target.instanceId);
    failed = grantAura(failed, source.instanceId);
    expect(getMemberEffectiveBladeCount(failed, PLAYER1, target.instanceId)).toBe(1);
    failed = updatePlayer(failed, PLAYER1, (player) => ({
      ...player,
      successZone: { ...player.successZone, cardIds: [score.instanceId] },
    }));
    expect(getMemberEffectiveBladeCount(failed, PLAYER1, target.instanceId)).toBe(1);
  });

  it('stacks two granted Rin auras without double-counting either source', () => {
    const rinA = createCardInstance(rin('PL!-pb2-005-PP'), PLAYER1, 'rin-a');
    const rinB = createCardInstance(rin('PL!-pb2-005-R'), PLAYER1, 'rin-b');
    const target = createCardInstance(member('stack-target'), PLAYER1, 'stack-target');
    const score = createCardInstance(
      member('stack-score', { bladeHearts: scoreBladeHearts() }),
      PLAYER1,
      'stack-score'
    );
    let game = registerCards(createGameState('pb2-005-stack', PLAYER1, 'P1', PLAYER2, 'P2'), [
      rinA,
      rinB,
      target,
      score,
    ]);
    game = place(game, PLAYER1, SlotPosition.LEFT, rinA.instanceId);
    game = place(game, PLAYER1, SlotPosition.CENTER, rinB.instanceId);
    game = place(game, PLAYER1, SlotPosition.RIGHT, target.instanceId);
    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      successZone: { ...player.successZone, cardIds: [score.instanceId] },
    }));
    game = {
      ...game,
      pendingAbilities: [pending(rinA.instanceId, 'a'), pending(rinB.instanceId, 'b')],
    };

    let order = resolvePendingCardEffects(game).gameState;
    expect(order.activeEffect?.canResolveInOrder).toBe(true);
    order = confirmActiveEffectStep(order, PLAYER1, order.activeEffect!.id, null, null, true);
    expect(order.activeEffect).toBeNull();
    expect(order.pendingAbilities).toEqual([]);
    expect(getMemberEffectiveBladeCount(order, PLAYER1, rinA.instanceId)).toBe(2);
    expect(getMemberEffectiveBladeCount(order, PLAYER1, rinB.instanceId)).toBe(2);
    expect(getMemberEffectiveBladeCount(order, PLAYER1, target.instanceId)).toBe(3);

    let manual = resolvePendingCardEffects(game).gameState;
    manual = confirmActiveEffectStep(manual, PLAYER1, manual.activeEffect!.id, rinB.instanceId);
    expect(manual.activeEffect).toMatchObject({
      abilityId: PL_PB2_005_ON_ENTER_GAIN_MUSE_STAGE_BLADE_AURA_ABILITY_ID,
      sourceCardId: rinB.instanceId,
    });
    expect(manual.activeEffect?.metadata?.orderedResolution).toBe(false);
    expect(manual.liveResolution.liveModifiers).toEqual([]);
    manual = confirmActiveEffectStep(manual, PLAYER1, manual.activeEffect!.id);
    expect(getMemberEffectiveBladeCount(manual, PLAYER1, rinB.instanceId)).toBe(1);
    expect(manual.activeEffect).toMatchObject({
      abilityId: PL_PB2_005_ON_ENTER_GAIN_MUSE_STAGE_BLADE_AURA_ABILITY_ID,
      sourceCardId: rinA.instanceId,
    });
  });

  it('consumes stale or illegal sources without opening a confirmation or hanging continuation', () => {
    const source = createCardInstance(rin(), PLAYER1, 'stale-rin');
    let game = registerCards(createGameState('pb2-005-stale', PLAYER1, 'P1', PLAYER2, 'P2'), [
      source,
    ]);
    game = { ...game, pendingAbilities: [pending(source.instanceId)] };

    const resolved = resolvePendingCardEffects(game).gameState;

    expect(resolved.activeEffect).toBeNull();
    expect(resolved.pendingAbilities).toEqual([]);
    expect(
      resolved.actionHistory
        .filter(
          (action) =>
            action.type === 'RESOLVE_ABILITY' &&
            action.payload.abilityId === PL_PB2_005_ON_ENTER_GAIN_MUSE_STAGE_BLADE_AURA_ABILITY_ID
        )
        .at(-1)?.payload
    ).toMatchObject({
      step: 'SOURCE_NOT_ON_STAGE_NO_OP',
      sourceOnStage: false,
      legalSource: false,
      conditionMet: false,
      bladeBonus: 0,
    });
  });
});
