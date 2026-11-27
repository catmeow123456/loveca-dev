import {
  getCardActiveEffect,
  type ActiveEffectState,
  type GameState,
} from '../../../../domain/entities/game.js';
import { getMemberEffectiveHeartIcons } from '../../../../domain/rules/live-modifiers.js';
import { createHeartCountsFromIcons } from '../../../../domain/value-objects/heart.js';
import { HeartColor } from '../../../../shared/types/enums.js';
import { groupAliasIs } from '../../../effects/card-selectors.js';
import { getStageMemberCardIdsMatching } from '../../../effects/stage-targets.js';
import { S_PB2_004_LIVE_SUCCESS_LOOK_TOP_BY_MEMBER_HEART_COLOR_ABILITY_ID as ABILITY_ID } from '../../ability-ids.js';
import { getStageMemberLifecycleId } from '../../runtime/ability-source-lifecycle.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import type { EnqueueTriggeredCardEffectsForEnterWaitingRoom } from '../../runtime/enter-waiting-room-triggers.js';
import { queryCardSelection } from '../../runtime/selection-query.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';
import {
  resolveLookTopSelectToHandSelection,
  startPrivateLookTopTakeOneWorkflow,
} from '../shared/look-top-select-to-hand.js';

const TARGET_STEP_ID = 'S_PB2_004_SELECT_AQOURS_STAGE_MEMBER';
const INSPECT_STEP_ID = 'S_PB2_004_SELECT_CARD_FROM_INSPECTION';
const isAqours = groupAliasIs('Aqours');

function targets(game: GameState, playerId: string): readonly string[] {
  return getStageMemberCardIdsMatching(game, playerId, isAqours);
}

function currentCapturedTargets(game: GameState, effect: ActiveEffectState): readonly string[] {
  const captured = effect.metadata?.targetLifecycles as
    Readonly<Record<string, string>> | undefined;
  return targets(game, effect.controllerId).filter(
    (targetId) => captured?.[targetId] === getStageMemberLifecycleId(game, targetId)
  );
}

function getLargestSpecificColorCount(game: GameState, playerId: string, memberId: string) {
  const counts = createHeartCountsFromIcons(getMemberEffectiveHeartIcons(game, playerId, memberId));
  counts.delete(HeartColor.GRAY);
  counts.delete(HeartColor.RAINBOW);
  return Math.max(0, ...counts.values());
}

export function registerSPb2004DiaWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom;
}): void {
  registerPendingAbilityStarterHandler(ABILITY_ID, (game, ability, options, context) => {
    const selectableCardIds = targets(game, ability.controllerId);
    const orderedResolution = options.orderedResolution === true;
    if (selectableCardIds.length === 0) {
      return startPrivateLookTopTakeOneWorkflow(
        game,
        ability,
        {
          topCount: 0,
          selectStepId: INSPECT_STEP_ID,
          sourceActionLabel: 'LIVE成功',
        },
        {
          ...deps,
          orderedResolution,
          continuePendingCardEffects: context.continuePendingCardEffects,
        }
      );
    }

    return startPendingActiveEffect(game, {
      ability,
      playerId: ability.controllerId,
      activeEffect: {
        id: ability.id,
        abilityId: ABILITY_ID,
        sourceCardId: ability.sourceCardId,
        controllerId: ability.controllerId,
        effectText: getAbilityEffectText(ABILITY_ID),
        stepId: TARGET_STEP_ID,
        stepText: '请选择自己舞台上的１名『Aqours』成员，按其数量最多的一种HEART颜色检视卡组顶。',
        awaitingPlayerId: ability.controllerId,
        selectableCardIds,
        selectableCardVisibility: 'PUBLIC',
        selectionLabel: '选择要计算HEART的Aqours成员',
        confirmSelectionLabel: '检视卡组顶',
        canSkipSelection: false,
        metadata: {
          orderedResolution,
          targetLifecycles: Object.fromEntries(
            selectableCardIds.map((id) => [id, getStageMemberLifecycleId(game, id)])
          ),
        },
      },
      actionPayload: { step: 'SELECT_HEART_COUNT_MEMBER' },
    });
  });

  registerActiveEffectStepHandler(
    ABILITY_ID,
    TARGET_STEP_ID,
    (game, input, context) => {
      const effect = getCardActiveEffect(game);
      const targetId = input.selectedCardId;
      if (!effect) return game;
      const currentTargets = currentCapturedTargets(game, effect);
      const selectedTarget = targetId && currentTargets.includes(targetId) ? targetId : null;
      if (currentTargets.length > 0 && !selectedTarget) return game;
      const topCount = selectedTarget
        ? getLargestSpecificColorCount(game, effect.controllerId, selectedTarget)
        : 0;
      return startPrivateLookTopTakeOneWorkflow(
        { ...game, activeEffect: null },
        effect,
        {
          topCount,
          selectStepId: INSPECT_STEP_ID,
          sourceActionLabel: 'LIVE成功',
          startActionPayload: { targetCardId: selectedTarget, topCount },
        },
        {
          ...deps,
          orderedResolution: effect.metadata?.orderedResolution === true,
          continuePendingCardEffects: context.continuePendingCardEffects,
        }
      );
    },
    (game) => {
      const effect = getCardActiveEffect(game);
      const selection = queryCardSelection(game);
      return effect &&
        selection?.kind === 'CARDS' &&
        currentCapturedTargets(game, effect).length === 0
        ? { ...selection, canSkip: true }
        : selection;
    }
  );

  registerActiveEffectStepHandler(
    ABILITY_ID,
    INSPECT_STEP_ID,
    (game, input, context) =>
      resolveLookTopSelectToHandSelection(
        game,
        input.selectedCardId ?? null,
        input.selectedCardIds,
        {
          ...deps,
          continuePendingCardEffects: context.continuePendingCardEffects,
        }
      ),
    queryCardSelection
  );
}
