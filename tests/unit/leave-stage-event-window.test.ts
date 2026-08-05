import { describe, expect, it } from 'vitest';
import { enqueueTriggeredCardEffects } from '../../src/application/card-effect-runner';
import { HS_BP2_012_LEAVE_STAGE_LOOK_TOP_MEMBER_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import { GameService } from '../../src/application/game-service';
import {
  createCardInstance,
  createHeartIcon,
  type MemberCardData,
} from '../../src/domain/entities/card';
import {
  addAction,
  createGameState,
  emitGameEvent,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import { createLeaveStageEvent } from '../../src/domain/events/game-events';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import { addLiveModifier } from '../../src/domain/rules/live-modifiers';
import {
  CardType,
  HeartColor,
  SlotPosition,
  TriggerCondition,
  ZoneType,
} from '../../src/shared/types/enums';

const P1 = 'p1';
const P2 = 'p2';
const HISTORICAL_MEMBER_ID = 'historical-member';
const CURRENT_LEAVER_ID = 'current-leaver';
const HISTORICAL_BLADE_ABILITY_ID = 'test:historical-member-blade';
const CURRENT_BLADE_ABILITY_ID = 'test:current-leaver-blade';

function member(cardCode: string, name: string): MemberCardData {
  return {
    cardCode,
    name,
    cardType: CardType.MEMBER,
    cost: 1,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.GREEN, 1)],
  };
}

function setupLeaveStageHistory() {
  const historicalMember = createCardInstance(
    member('PL!HS-bp2-012-N', '乙宗梢'),
    P1,
    HISTORICAL_MEMBER_ID
  );
  const currentLeaver = createCardInstance(
    member('TEST-CURRENT-LEAVER', 'current'),
    P1,
    CURRENT_LEAVER_ID
  );
  let game = registerCards(createGameState('leave-stage-window', P1, 'P1', P2, 'P2'), [
    historicalMember,
    currentLeaver,
  ]);

  const historicalEvent = createLeaveStageEvent(
    historicalMember.instanceId,
    SlotPosition.LEFT,
    ZoneType.WAITING_ROOM,
    P1,
    P1
  );
  game = emitGameEvent(game, historicalEvent);

  game = updatePlayer(game, P1, (player) => ({
    ...player,
    memberSlots: placeCardInSlot(
      player.memberSlots,
      SlotPosition.CENTER,
      historicalMember.instanceId
    ),
  }));
  game = addLiveModifier(game, {
    kind: 'BLADE',
    target: 'SOURCE_MEMBER',
    playerId: P1,
    countDelta: 2,
    sourceCardId: historicalMember.instanceId,
    abilityId: HISTORICAL_BLADE_ABILITY_ID,
  });
  game = addLiveModifier(game, {
    kind: 'BLADE',
    target: 'SOURCE_MEMBER',
    playerId: P1,
    countDelta: 3,
    sourceCardId: currentLeaver.instanceId,
    abilityId: CURRENT_BLADE_ABILITY_ID,
  });

  const triggerEventLogStartIndex = game.eventLog.length;
  const currentEvent = createLeaveStageEvent(
    currentLeaver.instanceId,
    SlotPosition.RIGHT,
    ZoneType.WAITING_ROOM,
    P1,
    P1
  );
  game = emitGameEvent(game, currentEvent);

  return {
    game,
    historicalEvent,
    triggerEventLogStartIndex,
  };
}

function modifierAbilityIds(game: GameState): readonly string[] {
  return game.liveResolution.liveModifiers.map((modifier) => modifier.abilityId);
}

describe('leave-stage event-log window', () => {
  it('uses only this dispatch window for modifier cleanup and ON_LEAVE_STAGE auto abilities', () => {
    const scenario = setupLeaveStageHistory();

    const result = new GameService().executeCheckTiming(
      scenario.game,
      [TriggerCondition.ON_LEAVE_STAGE],
      { triggerEventLogStartIndex: scenario.triggerEventLogStartIndex }
    );
    const dispatched = result.gameState;

    expect(result.success).toBe(true);
    expect(modifierAbilityIds(dispatched)).toContain(HISTORICAL_BLADE_ABILITY_ID);
    expect(modifierAbilityIds(dispatched)).not.toContain(CURRENT_BLADE_ABILITY_ID);
    expect(dispatched.pendingAbilities).toEqual([]);
    expect(
      dispatched.actionHistory.filter(
        (action) =>
          action.type === 'TRIGGER_ABILITY' &&
          action.payload.abilityId === HS_BP2_012_LEAVE_STAGE_LOOK_TOP_MEMBER_ABILITY_ID
      )
    ).toEqual([]);
  });

  it('keeps explicit leaveStageEvents authoritative even when an event-log window is supplied', () => {
    const scenario = setupLeaveStageHistory();

    const dispatched = enqueueTriggeredCardEffects(
      scenario.game,
      [TriggerCondition.ON_LEAVE_STAGE],
      {
        triggerEventLogStartIndex: scenario.triggerEventLogStartIndex,
        leaveStageEvents: [scenario.historicalEvent],
      }
    );

    expect(modifierAbilityIds(dispatched)).not.toContain(HISTORICAL_BLADE_ABILITY_ID);
    expect(modifierAbilityIds(dispatched)).toContain(CURRENT_BLADE_ABILITY_ID);
    expect(dispatched.pendingAbilities).toHaveLength(1);
    expect(dispatched.pendingAbilities[0]).toMatchObject({
      abilityId: HS_BP2_012_LEAVE_STAGE_LOOK_TOP_MEMBER_ABILITY_ID,
      sourceCardId: HISTORICAL_MEMBER_ID,
      eventIds: [scenario.historicalEvent.eventId],
    });
  });

  it('does not fall back to a legacy leave action when the bounded event window is empty', () => {
    const scenario = setupLeaveStageHistory();
    const withLegacyLeaveAction = addAction(scenario.game, 'PLAY_MEMBER', P1, {
      cardId: 'incoming-member',
      targetSlot: SlotPosition.LEFT,
      isRelay: true,
      replacedCardId: HISTORICAL_MEMBER_ID,
    });

    const dispatched = enqueueTriggeredCardEffects(
      withLegacyLeaveAction,
      [TriggerCondition.ON_LEAVE_STAGE],
      { triggerEventLogStartIndex: withLegacyLeaveAction.eventLog.length }
    );

    expect(dispatched).toBe(withLegacyLeaveAction);
    expect(modifierAbilityIds(dispatched)).toContain(HISTORICAL_BLADE_ABILITY_ID);
    expect(dispatched.pendingAbilities).toEqual([]);
  });

  it('treats an explicit empty leaveStageEvents list as authoritative over legacy actions', () => {
    const scenario = setupLeaveStageHistory();
    const withLegacyLeaveAction = addAction(scenario.game, 'PLAY_MEMBER', P1, {
      cardId: 'incoming-member',
      targetSlot: SlotPosition.LEFT,
      isRelay: true,
      replacedCardId: HISTORICAL_MEMBER_ID,
    });

    const dispatched = enqueueTriggeredCardEffects(
      withLegacyLeaveAction,
      [TriggerCondition.ON_LEAVE_STAGE],
      { leaveStageEvents: [] }
    );

    expect(dispatched).toBe(withLegacyLeaveAction);
    expect(modifierAbilityIds(dispatched)).toContain(HISTORICAL_BLADE_ABILITY_ID);
    expect(dispatched.pendingAbilities).toEqual([]);
  });
});
