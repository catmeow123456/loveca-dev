import { describe, expect, it } from 'vitest';
import type { CardInstance, HeartIcon, MemberCardData } from '../../src/domain/entities/card';
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
  addHeartLiveModifierForSourceMember,
  addLiveModifier,
} from '../../src/domain/rules/live-modifiers';
import {
  confirmActiveEffectStep,
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  PL_PB2_033_LIVE_START_WAIT_OPPONENT_ORIGINAL_HEART_THREE_ABILITY_ID as LIVE_START_ABILITY_ID,
  PL_PB2_033_ON_ENTER_WAIT_OPPONENT_ORIGINAL_HEART_THREE_ABILITY_ID as ON_ENTER_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import { getCardAbilityDefinitionsForCardCode } from '../../src/application/card-effects/definitions/lookup';
import {
  CardAbilityCategory,
  CardAbilitySourceZone,
} from '../../src/application/card-effects/ability-definition-types';
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
const EFFECT_TEXT =
  '【登场】/【LIVE开始时】将存在于对方的舞台的1名原本持有的HEART的数量小于等于3的成员变为待机状态。（待机状态的成员持有的[ブレード]，不会使因声援公开的张数增加。）';

function member(
  cardCode: string,
  instanceId: string,
  ownerId: string,
  hearts: readonly HeartIcon[],
  name = cardCode
): CardInstance<MemberCardData> {
  return createCardInstance(
    {
      cardCode,
      name,
      groupNames: ["μ's"],
      cardType: CardType.MEMBER,
      cost: cardCode.startsWith('PL!-pb2-033') ? 13 : 4,
      blade: 1,
      hearts: [...hearts],
    },
    ownerId,
    instanceId
  );
}

interface Scenario {
  readonly game: GameState;
  readonly source: CardInstance<MemberCardData>;
  readonly lowHeartTarget: CardInstance<MemberCardData>;
  readonly highHeartTarget: CardInstance<MemberCardData>;
  readonly waitingTarget: CardInstance<MemberCardData>;
}

function setup(
  options: { readonly sourceCode?: string; readonly includeLowTarget?: boolean } = {}
): Scenario {
  const source = member(
    options.sourceCode ?? 'PL!-pb2-033-N',
    'pb2-033-source',
    P1,
    [createHeartIcon(HeartColor.PINK, 1)],
    '西木野真姬'
  );
  const lowHeartTarget = member('TEST-PRINTED-HEART-ZERO', 'printed-heart-zero', P2, []);
  const highHeartTarget = member('TEST-PRINTED-HEART-FOUR', 'printed-heart-four', P2, [
    createHeartIcon(HeartColor.PINK, 2),
    createHeartIcon(HeartColor.YELLOW, 2),
  ]);
  const waitingTarget = member('TEST-WAITING-HEART-TWO', 'waiting-heart-two', P2, [
    createHeartIcon(HeartColor.PURPLE, 2),
  ]);
  let game = registerCards(createGameState('pl-pb2-033-maki', P1, 'P1', P2, 'P2'), [
    source,
    lowHeartTarget,
    highHeartTarget,
    waitingTarget,
  ]);
  game = updatePlayer(game, P1, (player) => ({
    ...player,
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
  }));
  game = updatePlayer(game, P2, (player) => {
    let memberSlots = placeCardInSlot(
      player.memberSlots,
      SlotPosition.CENTER,
      highHeartTarget.instanceId,
      { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }
    );
    if (options.includeLowTarget !== false) {
      memberSlots = placeCardInSlot(memberSlots, SlotPosition.LEFT, lowHeartTarget.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      });
    }
    memberSlots = placeCardInSlot(memberSlots, SlotPosition.RIGHT, waitingTarget.instanceId, {
      orientation: OrientationState.WAITING,
      face: FaceState.FACE_UP,
    });
    return { ...player, memberSlots };
  });
  return { game, source, lowHeartTarget, highHeartTarget, waitingTarget };
}

function pending(
  abilityId: string,
  sourceCardId: string,
  timingId: TriggerCondition
): PendingAbilityState {
  return {
    id: `${abilityId}:pending`,
    abilityId,
    sourceCardId,
    controllerId: P1,
    mandatory: true,
    timingId,
    eventIds: [`${timingId}:event`],
    sourceSlot: SlotPosition.CENTER,
  };
}

function start(
  game: GameState,
  abilityId = ON_ENTER_ABILITY_ID,
  timingId = TriggerCondition.ON_ENTER_STAGE
): GameState {
  return resolvePendingCardEffects({
    ...game,
    pendingAbilities: [pending(abilityId, 'pb2-033-source', timingId)],
  }).gameState;
}

function choose(game: GameState, cardId: string): GameState {
  return confirmActiveEffectStep(game, P1, game.activeEffect!.id, cardId);
}

function orientation(game: GameState, cardId: string): OrientationState | undefined {
  return game.players[1].memberSlots.cardStates.get(cardId)?.orientation;
}

function latestPayload(game: GameState, abilityId: string): Record<string, unknown> | undefined {
  return [...game.actionHistory]
    .reverse()
    .find((action) => action.type === 'RESOLVE_ABILITY' && action.payload.abilityId === abilityId)
    ?.payload;
}

function replaceOriginalHearts(
  game: GameState,
  cardId: string,
  count: number,
  abilityId: string
): GameState {
  return addLiveModifier(game, {
    kind: 'MEMBER_ORIGINAL_HEART_REPLACEMENT',
    playerId: P2,
    memberCardId: cardId,
    hearts: count > 0 ? [createHeartIcon(HeartColor.BLUE, count)] : [],
    sourceCardId: cardId,
    abilityId,
  });
}

describe('PL!-pb2-033 西木野真姬', () => {
  it('registers independent ON_ENTER and LIVE_START definitions for every rarity', () => {
    for (const cardCode of ['PL!-pb2-033-N', 'PL!-pb2-033-UNSEEN']) {
      const definitions = getCardAbilityDefinitionsForCardCode(cardCode);
      expect(definitions).toHaveLength(2);
      expect(definitions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            abilityId: ON_ENTER_ABILITY_ID,
            baseCardCodes: ['PL!-pb2-033'],
            category: CardAbilityCategory.ON_ENTER,
            sourceZone: CardAbilitySourceZone.PLAYED_MEMBER,
            triggerCondition: TriggerCondition.ON_ENTER_STAGE,
            queued: true,
            implemented: true,
            effectText: EFFECT_TEXT,
          }),
          expect.objectContaining({
            abilityId: LIVE_START_ABILITY_ID,
            baseCardCodes: ['PL!-pb2-033'],
            category: CardAbilityCategory.LIVE_START,
            sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
            triggerCondition: TriggerCondition.ON_LIVE_START,
            queued: true,
            implemented: true,
            effectText: EFFECT_TEXT,
          }),
        ])
      );
      expect(definitions.every((definition) => definition.cardCodes === undefined)).toBe(true);
    }
  });

  it('enqueues the two timings independently', () => {
    const scenario = setup();
    const entered = emitGameEvent(
      scenario.game,
      createEnterStageEvent(scenario.source.instanceId, ZoneType.HAND, SlotPosition.CENTER, P1, P1)
    );
    const onEnter = enqueueTriggeredCardEffects(entered, [TriggerCondition.ON_ENTER_STAGE]);
    expect(onEnter.pendingAbilities).toContainEqual(
      expect.objectContaining({
        abilityId: ON_ENTER_ABILITY_ID,
        sourceCardId: scenario.source.instanceId,
      })
    );
    expect(
      onEnter.pendingAbilities.some((ability) => ability.abilityId === LIVE_START_ABILITY_ID)
    ).toBe(false);

    const liveStart = enqueueTriggeredCardEffects(scenario.game, [TriggerCondition.ON_LIVE_START]);
    expect(liveStart.pendingAbilities).toContainEqual(
      expect.objectContaining({
        abilityId: LIVE_START_ABILITY_ID,
        sourceCardId: scenario.source.instanceId,
      })
    );
    expect(
      liveStart.pendingAbilities.some((ability) => ability.abilityId === ON_ENTER_ABILITY_ID)
    ).toBe(false);
  });

  it.each([
    [ON_ENTER_ABILITY_ID, TriggerCondition.ON_ENTER_STAGE],
    [LIVE_START_ABILITY_ID, TriggerCondition.ON_LIVE_START],
  ] as const)(
    'waits an original-HEART-eligible target for %s through the state event wrapper',
    (abilityId, timingId) => {
      const scenario = setup();
      const started = start(scenario.game, abilityId, timingId);

      expect(started.activeEffect).toMatchObject({
        abilityId,
        effectText: EFFECT_TEXT,
        stepText: '请选择对方舞台上1名原本持有的HEART数量小于等于3的成员变为待机状态。',
        selectionLabel: '选择要变为待机状态的成员',
        confirmSelectionLabel: '变为待机状态',
        selectableCardIds: [scenario.lowHeartTarget.instanceId],
      });

      const finished = choose(started, scenario.lowHeartTarget.instanceId);
      expect(orientation(finished, scenario.lowHeartTarget.instanceId)).toBe(
        OrientationState.WAITING
      );
      expect(finished.activeEffect).toBeNull();
      expect(finished.pendingAbilities).toEqual([]);
      expect(latestPayload(finished, abilityId)).toMatchObject({
        step: 'WAIT_OPPONENT_MEMBER',
        targetPlayerId: P2,
        targetCardId: scenario.lowHeartTarget.instanceId,
        nextOrientation: OrientationState.WAITING,
      });
      expect(
        finished.eventLog.some(
          (entry) =>
            entry.event.eventType === TriggerCondition.ON_MEMBER_STATE_CHANGED &&
            entry.event.cardInstanceId === scenario.lowHeartTarget.instanceId &&
            entry.event.cause?.kind === 'CARD_EFFECT' &&
            entry.event.cause.abilityId === abilityId
        )
      ).toBe(true);
    }
  );

  it('ignores an ordinary effective HEART bonus when checking original HEART eligibility', () => {
    const scenario = setup();
    const bonus = addHeartLiveModifierForSourceMember(scenario.game, {
      playerId: P2,
      sourceCardId: scenario.lowHeartTarget.instanceId,
      abilityId: 'test:target-effective-heart-bonus',
      hearts: [createHeartIcon(HeartColor.PURPLE, 3)],
    });
    expect(bonus).not.toBeNull();

    const started = start(bonus!.gameState);
    expect(started.activeEffect?.selectableCardIds).toEqual([scenario.lowHeartTarget.instanceId]);
    expect(started.activeEffect?.selectableCardIds).not.toContain(
      scenario.highHeartTarget.instanceId
    );
    expect(started.activeEffect?.selectableCardIds).not.toContain(
      scenario.waitingTarget.instanceId
    );
  });

  it.each([
    [ON_ENTER_ABILITY_ID, TriggerCondition.ON_ENTER_STAGE],
    [LIVE_START_ABILITY_ID, TriggerCondition.ON_LIVE_START],
  ] as const)(
    'uses replacement-aware original HEART eligibility for %s while ignoring ordinary HEART bonuses',
    (abilityId, timingId) => {
      const scenario = setup();
      let game = replaceOriginalHearts(
        scenario.game,
        scenario.lowHeartTarget.instanceId,
        4,
        'test:replace-printed-zero-with-four'
      );
      game = replaceOriginalHearts(
        game,
        scenario.highHeartTarget.instanceId,
        2,
        'test:replace-printed-four-with-two'
      );
      const bonus = addHeartLiveModifierForSourceMember(game, {
        playerId: P2,
        sourceCardId: scenario.highHeartTarget.instanceId,
        abilityId: 'test:ordinary-heart-bonus-does-not-change-original',
        hearts: [createHeartIcon(HeartColor.PURPLE, 5)],
      });
      expect(bonus).not.toBeNull();

      const started = start(bonus!.gameState, abilityId, timingId);
      expect(started.activeEffect?.selectableCardIds).toEqual([
        scenario.highHeartTarget.instanceId,
      ]);
      expect(started.activeEffect?.selectableCardIds).not.toContain(
        scenario.lowHeartTarget.instanceId
      );
    }
  );

  it('rejects an illegal target without changing the active selection', () => {
    const scenario = setup();
    const started = start(scenario.game);
    const rejected = choose(started, scenario.highHeartTarget.instanceId);

    expect(rejected).toBe(started);
    expect(rejected.activeEffect?.selectableCardIds).toEqual([scenario.lowHeartTarget.instanceId]);
    expect(orientation(rejected, scenario.highHeartTarget.instanceId)).toBe(
      OrientationState.ACTIVE
    );
  });

  it('consumes a selection whose original HEART replacement became ineligible and resumes continuation', () => {
    const scenario = setup();
    const started = start(scenario.game);
    const stale = replaceOriginalHearts(
      started,
      scenario.lowHeartTarget.instanceId,
      4,
      'test:stale-original-heart-replacement'
    );

    const finished = choose(stale, scenario.lowHeartTarget.instanceId);
    expect(finished.activeEffect).toBeNull();
    expect(finished.pendingAbilities).toEqual([]);
    expect(latestPayload(finished, ON_ENTER_ABILITY_ID)).toMatchObject({
      step: 'STALE_TARGET_NO_OP',
      targetCardId: scenario.lowHeartTarget.instanceId,
      currentSelectionIsLegal: false,
    });
    expect(orientation(finished, scenario.lowHeartTarget.instanceId)).toBe(OrientationState.ACTIVE);
  });

  it('settles safely without a selection when there is no legal target', () => {
    const scenario = setup({ includeLowTarget: false });
    const finished = start(scenario.game, LIVE_START_ABILITY_ID, TriggerCondition.ON_LIVE_START);

    expect(finished.activeEffect).toBeNull();
    expect(finished.pendingAbilities).toEqual([]);
    expect(orientation(finished, scenario.highHeartTarget.instanceId)).toBe(
      OrientationState.ACTIVE
    );
    expect(orientation(finished, scenario.waitingTarget.instanceId)).toBe(OrientationState.WAITING);
    expect(latestPayload(finished, LIVE_START_ABILITY_ID)).toMatchObject({
      step: 'SKIP_NO_TARGET',
      targetPlayerId: P2,
    });
  });
});
