import { addAction, getCardById, type GameState } from '../../../../domain/entities/game.js';
import { countSuccessZoneCardsForCardEffect } from '../../../../domain/rules/success-zone-card-queries.js';
import { CardType } from '../../../../shared/types/enums.js';
import { and, groupAliasIs, typeIs } from '../../../effects/card-selectors.js';
import { PL_BP8_021_AUTO_ENTER_SUCCESS_LOOK_TOP_FOUR_MUSE_MEMBER_ABILITY_ID } from '../../ability-ids.js';
import type { EnqueueTriggeredCardEffectsForEnterWaitingRoom } from '../../runtime/enter-waiting-room-triggers.js';
import { queryCardSelection } from '../../runtime/selection-query.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';
import {
  startLookTopSelectToHandWorkflow,
  resolveLookTopSelectToHandSelection,
  finishRevealedLookTopSelectToHandWorkflow,
} from '../shared/look-top-select-to-hand.js';

const SELECT_STEP = 'PL_BP8_021_SELECT_MUSE_MEMBER_FROM_TOP_FOUR';
const REVEAL_STEP = 'PL_BP8_021_REVEAL_SELECTED_MUSE_MEMBER';
const selector = and(typeIs(CardType.MEMBER), groupAliasIs('μ’s'));

function selectionStillValid(game: GameState, cardIds: readonly string[]): boolean {
  return cardIds.every((cardId) => {
    const card = getCardById(game, cardId);
    return card !== null && selector(card);
  });
}

export function registerPlBp8021SoreWaBokutachiNoKisekiWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom;
}): void {
  const abilityId = PL_BP8_021_AUTO_ENTER_SUCCESS_LOOK_TOP_FOUR_MUSE_MEMBER_ABILITY_ID;
  registerPendingAbilityStarterHandler(abilityId, (game, ability, options, context) => {
    const successZoneCardCount = countSuccessZoneCardsForCardEffect(
      game,
      ability.controllerId,
      ability.sourceCardId
    );
    if (successZoneCardCount > 1) {
      return context.continuePendingCardEffects(
        addAction(
          {
            ...game,
            pendingAbilities: game.pendingAbilities.filter(
              (candidate) => candidate.id !== ability.id
            ),
          },
          'RESOLVE_ABILITY',
          ability.controllerId,
          {
            pendingAbilityId: ability.id,
            abilityId,
            sourceCardId: ability.sourceCardId,
            step: 'SUCCESS_ZONE_CARD_COUNT_CONDITION_NOT_MET',
            successZoneCardCount,
            resultText: `成功LIVE卡区中现有${successZoneCardCount}张卡片，不满足小于等于1张的条件，不检视卡组顶。`,
          }
        ),
        options.orderedResolution === true
      );
    }
    return startLookTopSelectToHandWorkflow(
      game,
      ability,
      {
        effectText: getAbilityEffectText(abilityId),
        topCount: 4,
        selector,
        countRule: { minCount: 0, maxCount: 1 },
        revealSelectedBeforeHand: true,
        selectStepId: SELECT_STEP,
        revealStepId: REVEAL_STEP,
        selectStepText: '可以选择1张『μ’s』成员卡公开并加入手牌，其余卡片放置入休息室。',
        noTargetStepText: '检视的卡片中没有『μ’s』成员卡，全部放置入休息室。',
        revealStepText: '公开选中的『μ’s』成员卡，展示结束后将其加入手牌，其余卡片放置入休息室。',
        selectionLabel: '选择要公开并加入手牌的『μ’s』成员',
        confirmSelectionLabel: '公开并加入手牌',
        skipSelectionLabel: '全部放置入休息室',
        noCardsMode: 'open-selection',
      },
      {
        orderedResolution: options.orderedResolution,
        continuePendingCardEffects: context.continuePendingCardEffects,
        enqueueTriggeredCardEffects: deps.enqueueTriggeredCardEffects,
      }
    );
  });
  registerActiveEffectStepHandler(
    abilityId,
    SELECT_STEP,
    (game, input, context) =>
      resolveLookTopSelectToHandSelection(
        game,
        input.selectedCardId ?? null,
        input.selectedCardIds,
        {
          continuePendingCardEffects: context.continuePendingCardEffects,
          enqueueTriggeredCardEffects: deps.enqueueTriggeredCardEffects,
        },
        selectionStillValid
      ),
    queryCardSelection
  );
  registerActiveEffectStepHandler(abilityId, REVEAL_STEP, (game, _input, context) =>
    finishRevealedLookTopSelectToHandWorkflow(
      game,
      {
        continuePendingCardEffects: context.continuePendingCardEffects,
        enqueueTriggeredCardEffects: deps.enqueueTriggeredCardEffects,
      },
      selectionStillValid
    )
  );
}
