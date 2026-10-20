import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { replaceLiveModifier } from '../../../../domain/rules/live-modifiers.js';
import { HeartColor } from '../../../../shared/types/enums.js';
import { collectEffectiveStageMemberHeartColors } from '../../../effects/stage-member-heart-colors.js';
import { N_BP8_028_LIVE_START_MILL_MEMBER_STAGE_COLORS_REDUCE_REQUIREMENT_ABILITY_ID as ABILITY_ID } from '../../ability-ids.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import { getPendingAbilitySourceLifecycleId } from '../../runtime/ability-source-lifecycle.js';
import type { EnqueueTriggeredCardEffectsForEnterWaitingRoom } from '../../runtime/enter-waiting-room-triggers.js';
import { moveTopDeckCardsToWaitingRoomWithRefreshAndEnqueueTriggers } from '../../runtime/main-deck-waiting-room-triggers.js';
import { withPublicRevealDwell } from '../../runtime/public-reveal-dwell.js';
import { queryConfirmSelection } from '../../runtime/selection-query.js';
import { isCurrentLiveCardAbilitySource } from '../../runtime/source-live.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  getAbilityEffectText,
  registerManualConfirmablePendingAbilityStarterHandler,
} from '../../runtime/workflow-helpers.js';

const STEP_ID = 'N_BP8_028_MILLED_MEMBER_COLORS';
type Continue = (game: GameState, ordered: boolean) => GameState;

export function registerNBp8028DressCodeWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom;
}): void {
  registerManualConfirmablePendingAbilityStarterHandler(
    ABILITY_ID,
    (game, ability, options, runtime) => {
      const sourceLifecycleId = getPendingAbilitySourceLifecycleId(game, ability);
      const result = moveTopDeckCardsToWaitingRoomWithRefreshAndEnqueueTriggers(
        game,
        ability.controllerId,
        1,
        deps.enqueueTriggeredCardEffects,
        {
          cause: {
            kind: 'CARD_EFFECT',
            playerId: ability.controllerId,
            sourceCardId: ability.sourceCardId,
            abilityId: ability.abilityId,
            pendingAbilityId: ability.id,
          },
        }
      );
      if (!result || result.movedCardIds.length === 0)
        return finish(
          result?.gameState ?? game,
          ability,
          options.orderedResolution === true,
          runtime.continuePendingCardEffects,
          0
        );
      return startPendingActiveEffect(result.gameState, {
        ability,
        playerId: ability.controllerId,
        activeEffect: withPublicRevealDwell({
          id: ability.id,
          abilityId: ability.abilityId,
          sourceCardId: ability.sourceCardId,
          sourceLifecycleId,
          controllerId: ability.controllerId,
          effectText: getAbilityEffectText(ABILITY_ID),
          stepId: STEP_ID,
          awaitingPlayerId: ability.controllerId,
          revealedCardIds: [...result.movedCardIds],
          stepText: `已将卡组顶1张卡片放置入休息室。展示结束后，符合颜色条件时，此卡的必要HEART减少相应数量的[無ハート]。`,
          metadata: {
            orderedResolution: options.orderedResolution === true,
            milledCardId: result.movedCardIds[0],
          },
        }),
        actionPayload: {
          sourceCardId: ability.sourceCardId,
          step: 'MILL_TOP_ONE',
          milledCardIds: result.movedCardIds,
        },
      });
    }
  );
  registerActiveEffectStepHandler(
    ABILITY_ID,
    STEP_ID,
    (game, _input, runtime) => {
      const effect = game.activeEffect;
      if (!effect || effect.abilityId !== ABILITY_ID || effect.stepId !== STEP_ID) return game;
      const milled =
        typeof effect.metadata?.milledCardId === 'string'
          ? getCardById(game, effect.metadata.milledCardId)
          : null;
      const colors =
        milled && isMemberCardData(milled.data)
          ? [
              ...new Set(
                milled.data.hearts.filter((heart) => heart.count > 0).map((heart) => heart.color)
              ),
            ]
          : [];
      const stageColors = collectEffectiveStageMemberHeartColors(game, effect.controllerId);
      const reduction =
        isCurrentLiveCardAbilitySource(game, effect) &&
        colors.every((color) => stageColors.has(color))
          ? colors.length
          : 0;
      let state: GameState = { ...game, activeEffect: null };
      if (reduction > 0)
        state = replaceLiveModifier(
          state,
          { kind: 'REQUIREMENT', sourceCardId: effect.sourceCardId, abilityId: ABILITY_ID },
          {
            kind: 'REQUIREMENT',
            liveCardId: effect.sourceCardId,
            sourceCardId: effect.sourceCardId,
            abilityId: ABILITY_ID,
            modifiers: [{ color: HeartColor.RAINBOW, countDelta: -reduction }],
          }
        );
      return finish(
        state,
        effect,
        effect.metadata?.orderedResolution === true,
        runtime.continuePendingCardEffects,
        reduction
      );
    },
    queryConfirmSelection
  );
}

function finish(
  game: GameState,
  ability: Pick<PendingAbilityState, 'id' | 'abilityId' | 'controllerId' | 'sourceCardId'>,
  ordered: boolean,
  continuation: Continue,
  reduction: number
): GameState {
  return continuation(
    addAction(
      {
        ...game,
        pendingAbilities: game.pendingAbilities.filter((pending) => pending.id !== ability.id),
      },
      'RESOLVE_ABILITY',
      ability.controllerId,
      {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        step: 'MILLED_MEMBER_COLORS_REDUCE_REQUIREMENT',
        requirementReduction: reduction,
      }
    ),
    ordered
  );
}
