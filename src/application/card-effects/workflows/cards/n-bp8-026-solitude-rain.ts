import {
  addAction,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import {
  addMemberHeartColorSnapshot,
  getMemberHeartContributionLifecycleId,
} from '../../../../domain/rules/live-modifiers.js';
import { CardType, HeartColor } from '../../../../shared/types/enums.js';
import { and, groupAliasIs, typeIs } from '../../../effects/card-selectors.js';
import { getStageMemberCardIdsMatching } from '../../../effects/stage-targets.js';
import { N_BP8_026_LIVE_START_CONVERT_TARGET_RED_BLUE_TO_PURPLE_SCORE_ABILITY_ID as ABILITY_ID } from '../../ability-ids.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import { getPendingAbilitySourceLifecycleId } from '../../runtime/ability-source-lifecycle.js';
import { replaceSourceLiveCardScoreModifierAndRefresh } from '../../runtime/live-card-score.js';
import { queryCardSelection } from '../../runtime/selection-query.js';
import { isCurrentLiveCardAbilitySource } from '../../runtime/source-live.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

const STEP_ID = 'N_BP8_026_SELECT_NIJIGASAKI_MEMBER';
type Continue = (game: GameState, ordered: boolean) => GameState;

export function registerNBp8026SolitudeRainWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(ABILITY_ID, (game, ability, options, runtime) => {
    const sourceLifecycleId = getPendingAbilitySourceLifecycleId(game, ability);
    const targets = getTargets(game, ability.controllerId);
    if (targets.length === 0) {
      return finish(
        game,
        ability,
        options.orderedResolution === true,
        runtime.continuePendingCardEffects,
        0
      );
    }
    return startPendingActiveEffect(game, {
      ability,
      playerId: ability.controllerId,
      activeEffect: {
        id: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        sourceLifecycleId,
        controllerId: ability.controllerId,
        effectText: getAbilityEffectText(ABILITY_ID),
        stepId: STEP_ID,
        stepText:
          '请选择自己舞台上的1名『虹咲』成员，将其当前持有的[赤ハート]和[青ハート]变为[紫ハート]。',
        awaitingPlayerId: ability.controllerId,
        selectableCardIds: targets,
        selectableCardMode: 'SINGLE',
        minSelectableCards: 1,
        maxSelectableCards: 1,
        selectableCardVisibility: 'PUBLIC',
        canSkipSelection: false,
        selectionLabel: '选择变更HEART颜色的虹咲成员',
        confirmSelectionLabel: '将红蓝HEART变为紫色',
        metadata: {
          orderedResolution: options.orderedResolution === true,
          targetLifecycles: Object.fromEntries(
            targets.map((id) => [id, getMemberHeartContributionLifecycleId(game, id)])
          ),
        },
      },
      actionPayload: { sourceCardId: ability.sourceCardId, step: 'SELECT_NIJIGASAKI_MEMBER' },
    });
  });
  registerActiveEffectStepHandler(
    ABILITY_ID,
    STEP_ID,
    (game, input, runtime) => {
      const effect = game.activeEffect;
      const id = input.selectedCardId;
      if (!effect || effect.stepId !== STEP_ID || !id || !effect.selectableCardIds?.includes(id))
        return game;
      const captured = effect.metadata?.targetLifecycles as
        Readonly<Record<string, string>> | undefined;
      const valid =
        getTargets(game, effect.controllerId).includes(id) &&
        captured?.[id] === getMemberHeartContributionLifecycleId(game, id);
      const converted = valid
        ? addMemberHeartColorSnapshot(
            { ...game, activeEffect: null },
            {
              playerId: effect.controllerId,
              memberCardId: id,
              targetLifecycleId: captured![id]!,
              sourceCardId: effect.sourceCardId,
              abilityId: effect.abilityId,
              snapshotId: effect.id,
              fromColors: [HeartColor.RED, HeartColor.BLUE],
              toColor: HeartColor.PURPLE,
            }
          )
        : null;
      const count = converted?.convertedHeartCount ?? 0;
      let state = converted?.gameState ?? { ...game, activeEffect: null };
      // User ruling for this implementation: assess only the completed, fixed conversion now.
      // Later Hearts are not converted and never cause a delayed score award.
      const scoreGranted = count >= 5 && isCurrentLiveCardAbilitySource(game, effect);
      if (scoreGranted) state = replaceSourceLiveCardScoreModifierAndRefresh(state, effect, 1);
      return finish(
        state,
        effect,
        effect.metadata?.orderedResolution === true,
        runtime.continuePendingCardEffects,
        count,
        scoreGranted
      );
    },
    queryCardSelection
  );
}

function getTargets(game: GameState, playerId: string): readonly string[] {
  return getStageMemberCardIdsMatching(
    game,
    playerId,
    and(typeIs(CardType.MEMBER), groupAliasIs('虹ヶ咲'))
  );
}

function finish(
  game: GameState,
  ability: Pick<PendingAbilityState, 'id' | 'abilityId' | 'controllerId' | 'sourceCardId'>,
  ordered: boolean,
  continuation: Continue,
  convertedHeartCount: number,
  scoreGranted = false
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
        step: 'SNAPSHOT_RED_BLUE_TO_PURPLE',
        convertedHeartCount,
        scoreBonus: Number(scoreGranted),
      }
    ),
    ordered
  );
}
