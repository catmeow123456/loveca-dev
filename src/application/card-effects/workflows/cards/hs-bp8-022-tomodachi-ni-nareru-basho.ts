import { addAction, getOpponent, type GameState } from '../../../../domain/entities/game.js';
import { addHeartLiveModifierForTargetMember } from '../../../../domain/rules/live-modifiers.js';
import { HeartColor } from '../../../../shared/types/enums.js';
import { unitAliasIs } from '../../../effects/card-selectors.js';
import { getMemberEffectiveCost } from '../../../effects/conditions.js';
import { drawCardsFromMainDeckToHand } from '../../../effects/draw.js';
import { getStageMemberCardIdsMatching } from '../../../effects/stage-targets.js';
import { HS_BP8_022_LIVE_START_OPPONENT_DRAW_TARGET_MIRAKURA_GAIN_PINK_HEART_ABILITY_ID as ABILITY_ID } from '../../ability-ids.js';
import {
  startPendingActiveEffect,
  finishSkippedActiveEffect,
} from '../../runtime/active-effect.js';
import { getStageMemberLifecycleId } from '../../runtime/ability-source-lifecycle.js';
import { queryCardSelection } from '../../runtime/selection-query.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

const DRAW_STEP = 'HS_BP8_022_OPTIONAL_OPPONENT_DRAW';
const TARGET_STEP = 'HS_BP8_022_SELECT_MIRAKURA_TARGET';
function targets(game: GameState, playerId: string) {
  return getStageMemberCardIdsMatching(game, playerId, unitAliasIs('みらくらぱーく!')).filter(
    (id) => getMemberEffectiveCost(game, playerId, id) >= 10
  );
}
export function registerTomodachiNiNareruBashoWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(ABILITY_ID, (game, ability, options) =>
    startPendingActiveEffect(game, {
      ability,
      playerId: ability.controllerId,
      actionPayload: { step: 'START_OPPONENT_DRAW_OPTION' },
      activeEffect: {
        id: ability.id,
        abilityId: ABILITY_ID,
        sourceCardId: ability.sourceCardId,
        controllerId: ability.controllerId,
        effectText: getAbilityEffectText(ABILITY_ID),
        stepId: DRAW_STEP,
        stepText:
          '可以让对方抽1张卡。如此做时，选择自己的1名费用大于等于10的Mira-Cra Park!成员获得[桃ハート]。',
        awaitingPlayerId: ability.controllerId,
        selectableOptions: [{ id: 'draw', label: '让对方抽1张卡' }],
        canSkipSelection: true,
        skipSelectionLabel: '不发动',
        confirmSelectionLabel: '让对方抽1张卡',
        metadata: { orderedResolution: options.orderedResolution === true },
      },
    })
  );
  registerActiveEffectStepHandler(ABILITY_ID, DRAW_STEP, (game, input, context) => {
    if (
      input.selectedOptionId === null ||
      input.selectedOptionId === undefined ||
      input.selectedOptionId === 'decline'
    ) {
      return finishSkippedActiveEffect(game, context.continuePendingCardEffects);
    }
    if (input.selectedOptionId !== 'draw') return game;
    const effect = game.activeEffect!;
    const opponent = getOpponent(game, effect.controllerId);
    if (!opponent) return game;
    const draw = drawCardsFromMainDeckToHand(game, opponent.id, 1);
    if (!draw) return game;
    const state = addAction(draw.gameState, 'RESOLVE_ABILITY', effect.controllerId, {
      pendingAbilityId: effect.id,
      abilityId: ABILITY_ID,
      sourceCardId: effect.sourceCardId,
      step: 'OPPONENT_DRAW',
      opponentId: opponent.id,
      drawnCount: draw.drawnCardIds.length,
    });
    const ids = targets(state, effect.controllerId);
    if (ids.length === 0) {
      return context.continuePendingCardEffects(
        { ...state, activeEffect: null },
        effect.metadata?.orderedResolution === true
      );
    }
    return {
      ...state,
      activeEffect: {
        ...effect,
        stepId: TARGET_STEP,
        stepText: '请选择自己的1名费用大于等于10的Mira-Cra Park!成员获得[桃ハート]。',
        selectableOptions: undefined,
        selectableCardIds: ids,
        selectableCardVisibility: 'PUBLIC',
        selectableCardMode: 'SINGLE',
        canSkipSelection: false,
        selectionLabel: '选择获得[桃ハート]的成员',
        confirmSelectionLabel: '获得[桃ハート]',
        metadata: {
          ...effect.metadata,
          targetLifecycles: Object.fromEntries(
            ids.map((id) => [id, getStageMemberLifecycleId(state, id)])
          ),
        },
      },
    };
  });
  registerActiveEffectStepHandler(
    ABILITY_ID,
    TARGET_STEP,
    (game, input, context) => {
      const effect = game.activeEffect!;
      const id = input.selectedCardId;
      if (!id || !effect.selectableCardIds?.includes(id)) return game;
      const valid =
        targets(game, effect.controllerId).includes(id) &&
        (effect.metadata?.targetLifecycles as Readonly<Record<string, string>> | undefined)?.[
          id
        ] === getStageMemberLifecycleId(game, id);
      const reward = valid
        ? addHeartLiveModifierForTargetMember(game, {
            playerId: effect.controllerId,
            sourceCardId: effect.sourceCardId,
            targetMemberCardId: id,
            abilityId: ABILITY_ID,
            hearts: [{ color: HeartColor.PINK, count: 1 }],
          })
        : null;
      return context.continuePendingCardEffects(
        addAction(
          { ...(reward?.gameState ?? game), activeEffect: null },
          'RESOLVE_ABILITY',
          effect.controllerId,
          {
            pendingAbilityId: effect.id,
            abilityId: ABILITY_ID,
            sourceCardId: effect.sourceCardId,
            step: reward ? 'TARGET_MEMBER_GAIN_PINK_HEART' : 'TARGET_MEMBER_NO_LONGER_VALID',
            targetMemberCardId: id,
            pinkHeartBonus: reward ? 1 : 0,
          }
        ),
        effect.metadata?.orderedResolution === true
      );
    },
    queryCardSelection
  );
}
