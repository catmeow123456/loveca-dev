import {
  addAction,
  getCardById,
  type ActiveEffectState,
  type GameState,
} from '../../../../domain/entities/game.js';
import { addHeartLiveModifierForTargetMember } from '../../../../domain/rules/live-modifiers.js';
import { CardType, HeartColor } from '../../../../shared/types/enums.js';
import { cardCodeMatchesBase } from '../../../../shared/utils/card-code.js';
import { and, groupAliasIs, typeIs } from '../../../effects/card-selectors.js';
import { getMemberEffectiveCost } from '../../../effects/conditions.js';
import { getStageMemberCardIdsMatching } from '../../../effects/stage-targets.js';
import { N_PR_036_LIVE_START_OTHER_NIJIGASAKI_YELLOW_HEART_ABILITY_ID } from '../../ability-ids.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import { getStageMemberLifecycleId } from '../../runtime/ability-source-lifecycle.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  getAbilityEffectText,
  maybeStartConfirmablePendingAbilityConfirmation,
} from '../../runtime/workflow-helpers.js';

const ABILITY_ID = N_PR_036_LIVE_START_OTHER_NIJIGASAKI_YELLOW_HEART_ABILITY_ID;
const SELECT_STEP_ID = 'N_PR_036_SELECT_OTHER_NIJIGASAKI_MEMBER';
const nijigasakiMember = and(typeIs(CardType.MEMBER), groupAliasIs('虹ヶ咲'));
type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerNPr036ShizukuWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(ABILITY_ID, (game, ability, options, context) => {
    const selectableCardIds = sourceMatches(game, ability.controllerId, ability.sourceCardId)
      ? selectTargets(game, ability.controllerId, ability.sourceCardId)
      : [];
    if (selectableCardIds.length === 0) {
      const confirmation =
        options.orderedResolution === true
          ? null
          : maybeStartConfirmablePendingAbilityConfirmation(game, ability, options, {
              effectText: `${getAbilityEffectText(ABILITY_ID)}\n当前没有可选择的其他『虹咲』成员，不获得[黄ハート]。`,
              stepText: '没有可选择的目标。',
            });
      if (confirmation) return confirmation;
      return context.continuePendingCardEffects(
        addAction(
          {
            ...game,
            pendingAbilities: game.pendingAbilities.filter((item) => item.id !== ability.id),
          },
          'RESOLVE_ABILITY',
          ability.controllerId,
          {
            pendingAbilityId: ability.id,
            abilityId: ABILITY_ID,
            sourceCardId: ability.sourceCardId,
            step: 'NO_OTHER_NIJIGASAKI_TARGET',
          }
        ),
        options.orderedResolution === true
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
        stepId: SELECT_STEP_ID,
        stepText:
          '请选择自己舞台上1名其他的『虹咲』成员获得[黄ハート]；该成员费用大于等于15时，再获得[黄ハート]。',
        awaitingPlayerId: ability.controllerId,
        selectableCardIds,
        selectableCardVisibility: 'PUBLIC',
        selectableCardMode: 'SINGLE',
        selectionLabel: '选择获得[黄ハート]的其他『虹咲』成员',
        confirmSelectionLabel: '获得[黄ハート]',
        canSkipSelection: false,
        metadata: {
          orderedResolution: options.orderedResolution === true,
          targetLifecycles: Object.fromEntries(
            selectableCardIds.map((id) => [id, getStageMemberLifecycleId(game, id)])
          ),
        },
      },
      actionPayload: { step: 'SELECT_OTHER_NIJIGASAKI_MEMBER', selectableCardIds },
    });
  });
  registerActiveEffectStepHandler(ABILITY_ID, SELECT_STEP_ID, (game, input, context) =>
    finishSelection(game, input.selectedCardId ?? null, context.continuePendingCardEffects)
  );
}

function finishSelection(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (!effect || effect.abilityId !== ABILITY_ID || effect.stepId !== SELECT_STEP_ID) return game;
  if (!sourceMatches(game, effect.controllerId, effect.sourceCardId)) {
    return finish(game, effect, 'SOURCE_NO_LONGER_CURRENT', continuePendingCardEffects);
  }
  const currentTargets = selectTargets(game, effect.controllerId, effect.sourceCardId).filter(
    (cardId) =>
      effect.selectableCardIds?.includes(cardId) &&
      (effect.metadata?.targetLifecycles as Readonly<Record<string, string>> | undefined)?.[
        cardId
      ] === getStageMemberLifecycleId(game, cardId)
  );
  if (currentTargets.length === 0) {
    return finish(game, effect, 'NO_OTHER_NIJIGASAKI_TARGET', continuePendingCardEffects);
  }
  if (!selectedCardId || !effect.selectableCardIds?.includes(selectedCardId)) return game;
  if (!currentTargets.includes(selectedCardId)) {
    return { ...game, activeEffect: { ...effect, selectableCardIds: currentTargets } };
  }
  const effectiveCost = getMemberEffectiveCost(game, effect.controllerId, selectedCardId);
  const yellowHeartCount = effectiveCost >= 15 ? 2 : 1;
  const result = addHeartLiveModifierForTargetMember(game, {
    playerId: effect.controllerId,
    sourceCardId: effect.sourceCardId,
    targetMemberCardId: selectedCardId,
    abilityId: ABILITY_ID,
    hearts: [{ color: HeartColor.YELLOW, count: yellowHeartCount }],
  });
  if (!result) return game;
  return finish(result.gameState, effect, 'GAIN_YELLOW_HEART', continuePendingCardEffects, {
    targetMemberCardId: selectedCardId,
    effectiveCost,
    yellowHeartCount,
  });
}

function selectTargets(game: GameState, playerId: string, sourceCardId: string): readonly string[] {
  return getStageMemberCardIdsMatching(game, playerId, nijigasakiMember).filter(
    (cardId) => cardId !== sourceCardId && getCardById(game, cardId)?.ownerId === playerId
  );
}

function sourceMatches(game: GameState, playerId: string, sourceCardId: string): boolean {
  const card = getCardById(game, sourceCardId);
  return card?.ownerId === playerId && cardCodeMatchesBase(card.data.cardCode, 'PL!N-PR-036');
}

function finish(
  game: GameState,
  effect: ActiveEffectState,
  step: string,
  continuePendingCardEffects: ContinuePendingCardEffects,
  payload: Readonly<Record<string, unknown>> = {}
): GameState {
  return continuePendingCardEffects(
    addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', effect.controllerId, {
      pendingAbilityId: effect.id,
      abilityId: ABILITY_ID,
      sourceCardId: effect.sourceCardId,
      step,
      ...payload,
    }),
    effect.metadata?.orderedResolution === true
  );
}
