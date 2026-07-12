import { describe, expect, it } from 'vitest';
import type { MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import {
  createGameState,
  emitGameEvent,
  registerCards,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import { createEnterStageEvent } from '../../src/domain/events/game-events';
import {
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  HS_CL1_006_ON_ENTER_GAIN_THREE_BLADE_ABILITY_ID,
  S_BP6_013_ON_ENTER_GAIN_TWO_BLADE_ABILITY_ID,
  S_PR_016_ON_ENTER_GAIN_ONE_BLADE_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import { getMemberEffectiveBladeCount } from '../../src/domain/rules/live-modifiers';
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

function createMember(cardCode: string, name: string, cost: number): MemberCardData {
  return {
    cardCode,
    name,
    groupNames: ['Aqours', '蓮ノ空女学院スクールアイドルクラブ'],
    cardType: CardType.MEMBER,
    cost,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function placeSourceMemberOnStage(game: GameState, cardId: string): GameState {
  return updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, cardId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
  }));
}

function resolveOnEnterForSource(options: {
  readonly cardCode: string;
  readonly name: string;
  readonly cost: number;
  readonly sourceId: string;
}): { readonly state: GameState; readonly sourceId: string } {
  const source = createCardInstance(
    createMember(options.cardCode, options.name, options.cost),
    PLAYER1,
    options.sourceId
  );
  let game = createGameState(options.sourceId, PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [source]);
  game = placeSourceMemberOnStage(game, source.instanceId);
  game = emitGameEvent(
    game,
    createEnterStageEvent(source.instanceId, ZoneType.HAND, SlotPosition.CENTER, PLAYER1, PLAYER1)
  );

  const stateWithPending = enqueueTriggeredCardEffects(game, [TriggerCondition.ON_ENTER_STAGE]);
  return {
    state: resolvePendingCardEffects(stateWithPending).gameState,
    sourceId: source.instanceId,
  };
}

function pending(
  abilityId: string,
  sourceCardId: string,
  controllerId = PLAYER1
): PendingAbilityState {
  return {
    id: `${abilityId}:${sourceCardId}:pending`,
    abilityId,
    sourceCardId,
    controllerId,
    mandatory: true,
    timingId: TriggerCondition.ON_ENTER_STAGE,
    eventIds: ['manual-enter-stage'],
    sourceSlot: SlotPosition.CENTER,
  };
}

function latestPayload(game: GameState, abilityId: string) {
  return game.actionHistory
    .filter((action) => action.type === 'RESOLVE_ABILITY' && action.payload.abilityId === abilityId)
    .at(-1)?.payload;
}

describe('shared on-enter source member gain BLADE workflow', () => {
  it.each([
    ['PL!S-PR-016-PR', '黒澤ダイヤ', 9],
    ['PL!S-PR-020-PR', '小原鞠莉', 9],
    ['PL!S-PR-021-PR', '黒澤ルビィ', 9],
  ])('adds SOURCE_MEMBER BLADE +1 for %s with the shared S-PR definition', (cardCode, name, cost) => {
    const { state, sourceId } = resolveOnEnterForSource({
      cardCode,
      name,
      cost,
      sourceId: `${cardCode}:source`,
    });

    expect(state.pendingAbilities).toEqual([]);
    expect(getMemberEffectiveBladeCount(state, PLAYER1, sourceId)).toBe(2);
    expect(state.liveResolution.liveModifiers).toContainEqual({
      kind: 'BLADE',
      playerId: PLAYER1,
      countDelta: 1,
      sourceCardId: sourceId,
      abilityId: S_PR_016_ON_ENTER_GAIN_ONE_BLADE_ABILITY_ID,
    });
    expect(latestPayload(state, S_PR_016_ON_ENTER_GAIN_ONE_BLADE_ABILITY_ID)).toMatchObject({
      step: 'ON_ENTER_SOURCE_MEMBER_GAIN_ONE_BLADE',
      sourceOnStage: true,
      bladeBonus: 1,
      bladeApplied: true,
    });
  });

  it('adds SOURCE_MEMBER BLADE +2 for PL!S-bp6-013-N', () => {
    const { state, sourceId } = resolveOnEnterForSource({
      cardCode: 'PL!S-bp6-013-N',
      name: '黒澤ダイヤ',
      cost: 5,
      sourceId: 's-bp6-013-source',
    });

    expect(state.pendingAbilities).toEqual([]);
    expect(getMemberEffectiveBladeCount(state, PLAYER1, sourceId)).toBe(3);
    expect(state.liveResolution.liveModifiers).toContainEqual({
      kind: 'BLADE',
      playerId: PLAYER1,
      countDelta: 2,
      sourceCardId: sourceId,
      abilityId: S_BP6_013_ON_ENTER_GAIN_TWO_BLADE_ABILITY_ID,
    });
    expect(latestPayload(state, S_BP6_013_ON_ENTER_GAIN_TWO_BLADE_ABILITY_ID)).toMatchObject({
      step: 'ON_ENTER_SOURCE_MEMBER_GAIN_TWO_BLADE',
      sourceOnStage: true,
      bladeBonus: 2,
      bladeApplied: true,
    });
  });

  it('adds SOURCE_MEMBER BLADE +3 for PL!HS-cl1-006-CL', () => {
    const { state, sourceId } = resolveOnEnterForSource({
      cardCode: 'PL!HS-cl1-006-CL',
      name: '安養寺 姫芽',
      cost: 11,
      sourceId: 'hs-cl1-006-source',
    });

    expect(state.pendingAbilities).toEqual([]);
    expect(getMemberEffectiveBladeCount(state, PLAYER1, sourceId)).toBe(4);
    expect(state.liveResolution.liveModifiers).toContainEqual({
      kind: 'BLADE',
      playerId: PLAYER1,
      countDelta: 3,
      sourceCardId: sourceId,
      abilityId: HS_CL1_006_ON_ENTER_GAIN_THREE_BLADE_ABILITY_ID,
    });
    expect(latestPayload(state, HS_CL1_006_ON_ENTER_GAIN_THREE_BLADE_ABILITY_ID)).toMatchObject({
      step: 'ON_ENTER_SOURCE_MEMBER_GAIN_THREE_BLADE',
      sourceOnStage: true,
      bladeBonus: 3,
      bladeApplied: true,
    });
  });

  it('consumes the pending ability when the source is no longer on stage', () => {
    const source = createCardInstance(
      createMember('PL!HS-cl1-006-CL', '安養寺 姫芽', 11),
      PLAYER1,
      'hs-cl1-006-left-stage'
    );
    let game = createGameState('source-left-stage', PLAYER1, 'P1', PLAYER2, 'P2');
    game = registerCards(game, [source]);

    const state = resolvePendingCardEffects({
      ...game,
      pendingAbilities: [
        pending(HS_CL1_006_ON_ENTER_GAIN_THREE_BLADE_ABILITY_ID, source.instanceId),
      ],
    }).gameState;

    expect(state.pendingAbilities).toEqual([]);
    expect(state.liveResolution.liveModifiers).toEqual([]);
    expect(latestPayload(state, HS_CL1_006_ON_ENTER_GAIN_THREE_BLADE_ABILITY_ID)).toMatchObject({
      step: 'SOURCE_MEMBER_GAIN_BLADE_NO_OP',
      sourceOnStage: false,
      bladeBonus: 0,
      bladeApplied: false,
    });
  });

  it('consumes the pending ability when the source id is on stage but not a legal source card', () => {
    const invalidSourceId = 'unknown-source-on-stage';
    let game = createGameState('invalid-source-card', PLAYER1, 'P1', PLAYER2, 'P2');
    game = placeSourceMemberOnStage(game, invalidSourceId);

    const state = resolvePendingCardEffects({
      ...game,
      pendingAbilities: [
        pending(S_BP6_013_ON_ENTER_GAIN_TWO_BLADE_ABILITY_ID, invalidSourceId),
      ],
    }).gameState;

    expect(state.pendingAbilities).toEqual([]);
    expect(state.liveResolution.liveModifiers).toEqual([]);
    expect(latestPayload(state, S_BP6_013_ON_ENTER_GAIN_TWO_BLADE_ABILITY_ID)).toMatchObject({
      step: 'SOURCE_MEMBER_GAIN_BLADE_NO_OP',
      sourceOnStage: true,
      bladeBonus: 0,
      bladeApplied: false,
    });
  });

  it('keeps a pending ability auditable when its controller cannot be found', () => {
    const source = createCardInstance(
      createMember('PL!S-PR-016-PR', '黒澤ダイヤ', 9),
      PLAYER1,
      's-pr-016-missing-controller'
    );
    let game = createGameState('missing-controller', PLAYER1, 'P1', PLAYER2, 'P2');
    game = registerCards(game, [source]);
    game = placeSourceMemberOnStage(game, source.instanceId);

    const state = resolvePendingCardEffects({
      ...game,
      pendingAbilities: [
        pending(S_PR_016_ON_ENTER_GAIN_ONE_BLADE_ABILITY_ID, source.instanceId, 'missing-player'),
      ],
    }).gameState;

    expect(state.pendingAbilities).toHaveLength(1);
    expect(state.liveResolution.liveModifiers).toEqual([]);
    expect(latestPayload(state, S_PR_016_ON_ENTER_GAIN_ONE_BLADE_ABILITY_ID)).toBeUndefined();
  });
});
