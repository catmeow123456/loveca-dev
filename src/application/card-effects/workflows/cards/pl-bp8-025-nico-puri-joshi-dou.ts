import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { getAllMemberCardIds } from '../../../../domain/entities/zone.js';
import {
  collectLiveModifiers,
  getMemberEffectiveBladeCount,
  selectUniqueStageMemberWithMostEffectiveHearts,
} from '../../../../domain/rules/live-modifiers.js';
import { getMemberEffectiveCost } from '../../../../domain/rules/member-effective-cost.js';
import { cardNameAliasIs } from '../../../effects/card-selectors.js';
import { getStageMemberCardIdsMatching } from '../../../effects/stage-targets.js';
import { PL_BP8_025_LIVE_START_NICO_STRICT_ATTRIBUTE_LEADS_SCORE_ABILITY_ID as ABILITY_ID } from '../../ability-ids.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import {
  getPendingAbilitySourceLifecycleId,
  getStageMemberLifecycleId,
} from '../../runtime/ability-source-lifecycle.js';
import { replaceSourceLiveCardScoreModifierAndRefresh } from '../../runtime/live-card-score.js';
import { queryCardSelection } from '../../runtime/selection-query.js';
import { isCurrentLiveCardAbilitySource } from '../../runtime/source-live.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

const STEP_ID = 'PL_BP8_025_SELECT_NICO';
type Invocation = Pick<PendingAbilityState, 'id' | 'abilityId' | 'sourceCardId' | 'controllerId'>;
type Continue = (game: GameState, ordered: boolean) => GameState;

export function registerPlBp8025NicoPuriJoshiDouWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(ABILITY_ID, (game, ability, options, runtime) => {
    const source = {
      ...ability,
      sourceLifecycleId: getPendingAbilitySourceLifecycleId(game, ability),
    };
    const targets = getTargets(game, ability.controllerId);
    if (!isCurrentLiveCardAbilitySource(game, source) || targets.length === 0) {
      return finish(
        game,
        ability,
        options.orderedResolution === true,
        runtime.continuePendingCardEffects,
        null,
        0
      );
    }
    return startPendingActiveEffect(game, {
      ability,
      playerId: ability.controllerId,
      activeEffect: {
        id: ability.id,
        abilityId: ABILITY_ID,
        sourceCardId: ability.sourceCardId,
        sourceLifecycleId: source.sourceLifecycleId,
        controllerId: ability.controllerId,
        effectText: getAbilityEffectText(ABILITY_ID),
        stepId: STEP_ID,
        stepText:
          '请选择自己舞台上的１名「矢泽日香（矢泽妮可）」，比较双方其他成员的HEART、BLADE和费用。',
        awaitingPlayerId: ability.controllerId,
        selectableCardIds: targets,
        selectableCardMode: 'SINGLE',
        selectableCardVisibility: 'PUBLIC',
        minSelectableCards: 1,
        maxSelectableCards: 1,
        canSkipSelection: false,
        selectionLabel: '选择比较的日香',
        confirmSelectionLabel: '比较HEART、BLADE和费用',
        metadata: {
          orderedResolution: options.orderedResolution === true,
          targetLifecycles: Object.fromEntries(
            targets.map((id) => [id, getStageMemberLifecycleId(game, id)])
          ),
        },
      },
      actionPayload: { step: 'SELECT_NICO' },
    });
  });
  registerActiveEffectStepHandler(
    ABILITY_ID,
    STEP_ID,
    (game, input, runtime) => {
      const effect = game.activeEffect;
      const targetId = input.selectedCardId;
      if (!effect || !targetId || !effect.selectableCardIds?.includes(targetId)) return game;
      const captured = effect.metadata?.targetLifecycles as
        Readonly<Record<string, string>> | undefined;
      const targetValid =
        getTargets(game, effect.controllerId).includes(targetId) &&
        captured?.[targetId] === getStageMemberLifecycleId(game, targetId);
      const modifiers = collectLiveModifiers(game);
      const leader = targetValid
        ? selectUniqueStageMemberWithMostEffectiveHearts(game, modifiers)
        : null;
      const others = game.players.flatMap((player) =>
        getAllMemberCardIds(player.memberSlots)
          .filter((id) => {
            const card = getCardById(game, id);
            return id !== targetId && card !== null && isMemberCardData(card.data);
          })
          .map((id) => ({ id, playerId: player.id }))
      );
      const heartLead =
        targetValid && leader?.playerId === effect.controllerId && leader.memberCardId === targetId;
      const bladeLead =
        targetValid &&
        others.every(
          ({ id, playerId }) =>
            getMemberEffectiveBladeCount(game, effect.controllerId, targetId, modifiers) >
            getMemberEffectiveBladeCount(game, playerId, id, modifiers)
        );
      const costLead =
        targetValid &&
        others.every(
          ({ id, playerId }) =>
            getMemberEffectiveCost(game, effect.controllerId, targetId) >
            getMemberEffectiveCost(game, playerId, id)
        );
      const scoreBonus = Number(heartLead) + Number(bladeLead) + Number(costLead);
      let state: GameState = { ...game, activeEffect: null };
      const sourceCurrent = isCurrentLiveCardAbilitySource(game, effect);
      if (targetValid && sourceCurrent)
        state = replaceSourceLiveCardScoreModifierAndRefresh(state, effect, scoreBonus);
      return finish(
        state,
        effect,
        effect.metadata?.orderedResolution === true,
        runtime.continuePendingCardEffects,
        targetId,
        sourceCurrent ? scoreBonus : 0,
        { targetValid, sourceCurrent, heartLead, bladeLead, costLead }
      );
    },
    queryCardSelection
  );
}

function getTargets(game: GameState, playerId: string): readonly string[] {
  return getStageMemberCardIdsMatching(game, playerId, cardNameAliasIs('矢澤にこ'));
}

function finish(
  game: GameState,
  ability: Invocation,
  ordered: boolean,
  continuation: Continue,
  targetCardId: string | null,
  scoreBonus: number,
  detail: Readonly<Record<string, unknown>> = {}
): GameState {
  return continuation(
    addAction(
      { ...game, pendingAbilities: game.pendingAbilities.filter((item) => item.id !== ability.id) },
      'RESOLVE_ABILITY',
      ability.controllerId,
      {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        step: 'NICO_STRICT_ATTRIBUTE_LEADS_SCORE',
        targetCardId,
        scoreBonus,
        ...detail,
      }
    ),
    ordered
  );
}
