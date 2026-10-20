import { isMemberCardData, isLiveCardData } from '../../src/domain/entities/card';
import { describe, expect, it } from 'vitest';
import { emitGameEvent } from '../../src/domain/entities/game';
import {
  createEnterStageEvent,
  createLiveStartEvent,
  createLiveSuccessEvent,
} from '../../src/domain/events/game-events';
import {
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  HS_BP8_003_ON_ENTER_BOTH_DISCARD_TO_SIX_ABILITY_ID as RURINO,
  HS_BP8_013_LIVE_START_DOLLCHESTRA_LIVE_GAIN_THREE_BLADE_ABILITY_ID as KOSUZU,
  N_BP8_010_LIVE_SUCCESS_THREE_NO_BLADE_HEART_NIJIGASAKI_CHEER_SCORE_ABILITY_ID as SHIORIKO,
  N_BP8_019_LIVE_START_CHOOSE_ABSENT_NIJIGASAKI_HEART_COLOR_ABILITY_ID as SETSUNA,
  N_BP8_026_LIVE_START_CONVERT_TARGET_RED_BLUE_TO_PURPLE_SCORE_ABILITY_ID as RAIN,
  N_BP8_028_LIVE_START_MILL_MEMBER_STAGE_COLORS_REDUCE_REQUIREMENT_ABILITY_ID as DRESS,
  SP_PR_035_LIVE_SUCCESS_OPPONENT_TWELVE_CHEER_SCORE_ABILITY_ID as TOMARI,
} from '../../src/application/card-effects/ability-ids';
import { P1, member, live, gameWith, stage, liveZone } from '../helpers/modifier-workflow-fixtures';
import { SlotPosition, TriggerCondition, ZoneType } from '../../src/shared/types/enums';

describe('task modifier sources trigger through real rule events with authoritative static rule fields', () => {
  it.each([
    ['PL!HS-bp8-003-P', RURINO, TriggerCondition.ON_ENTER_STAGE, 10],
    ['PL!HS-bp8-013-N', KOSUZU, TriggerCondition.ON_LIVE_START, 9],
    ['PL!N-bp8-010-P', SHIORIKO, TriggerCondition.ON_LIVE_SUCCESS, 9],
    ['PL!N-bp8-019-N', SETSUNA, TriggerCondition.ON_LIVE_START, 4],
    ['PL!SP-PR-035-PR', TOMARI, TriggerCondition.ON_LIVE_SUCCESS, 11],
    ['PL!N-bp8-026-SECL', RAIN, TriggerCondition.ON_LIVE_START, 6],
    ['PL!N-bp8-028-L', DRESS, TriggerCondition.ON_LIVE_START, 4],
  ] as const)(
    'enqueues %s only from its matching event and source zone',
    (code, abilityId, timing, printedNumber) => {
      const isLive = code.includes('-026-') || code.includes('-028-');
      const source = isLive ? live(code, 'source') : member(code, 'source');
      expect(
        isMemberCardData(source.data)
          ? source.data.cost
          : isLiveCardData(source.data)
            ? source.data.score
            : undefined
      ).toBe(printedNumber);
      const target = member('SYNTHETIC_TARGET', 'target');
      let game = isLive
        ? liveZone(stage(gameWith([source, target]), [target]), source)
        : stage(gameWith([source]), [source]);
      const event =
        timing === TriggerCondition.ON_ENTER_STAGE
          ? createEnterStageEvent(source.instanceId, ZoneType.HAND, SlotPosition.LEFT, P1, P1)
          : timing === TriggerCondition.ON_LIVE_SUCCESS
            ? createLiveSuccessEvent(P1, ['successful-live'], 4)
            : createLiveStartEvent(P1, isLive ? [source.instanceId] : []);
      game = emitGameEvent(game, event);
      game = enqueueTriggeredCardEffects(game, [timing], {
        ...(event.eventType === TriggerCondition.ON_ENTER_STAGE
          ? { enterStageEvents: [event] }
          : {}),
        ...(event.eventType === TriggerCondition.ON_LIVE_START ? { liveStartEvents: [event] } : {}),
        ...(event.eventType === TriggerCondition.ON_LIVE_SUCCESS
          ? { liveSuccessEvents: [event] }
          : {}),
      });
      const pending = game.pendingAbilities.find((ability) => ability.abilityId === abilityId);
      expect(pending).toMatchObject({
        sourceCardId: source.instanceId,
        timingId: timing,
        eventIds: [event.eventId],
      });
      const started = resolvePendingCardEffects(game).gameState;
      expect(
        started.actionHistory.some(
          (action) => action.type === 'TRIGGER_ABILITY' && action.payload.abilityId === abilityId
        )
      ).toBe(true);
      if (abilityId !== RURINO) expect(started.activeEffect?.abilityId).toBe(abilityId);
    }
  );
});
