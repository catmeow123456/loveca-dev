import { getCardActiveEffect } from '../../../../domain/entities/game.js';
import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  type ActiveEffectState,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { CardType, ZoneType } from '../../../../shared/types/enums.js';
import {
  and,
  costLte,
  groupAliasIs,
  typeIs,
  unitAliasIs,
  type CardSelector,
} from '../../../effects/card-selectors.js';
import { selectWaitingRoomCardIds } from '../../../effects/zone-selection.js';
import {
  N_PR_026_ON_ENTER_STACK_LOW_COST_NIJIGASAKI_MEMBER_FROM_WAITING_ABILITY_ID,
  PL_PB2_017_ON_ENTER_STACK_FOUR_PRINTEMPS_MEMBERS_ABILITY_ID,
} from '../../ability-ids.js';
import {
  doesCardAbilityDefinitionMatchCardCode,
  getCardAbilityDefinitionById,
} from '../../definitions/lookup.js';
import { getAbilitySourceLifecycleId } from '../../runtime/ability-source-lifecycle.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import { stackMemberCardBelowStageMember } from '../../runtime/actions.js';
import { getSourceMemberSlot } from '../../runtime/source-member.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

interface Config {
  readonly abilityId: string;
  readonly stepId: string;
  readonly count: number;
  readonly selector: CardSelector;
  readonly memberLabel: string;
  readonly emptyStep: string;
}
const CONFIGS: readonly Config[] = [
  {
    abilityId: N_PR_026_ON_ENTER_STACK_LOW_COST_NIJIGASAKI_MEMBER_FROM_WAITING_ABILITY_ID,
    stepId: 'N_PR_026_RINA_SELECT_WAITING_MEMBER',
    count: 1,
    selector: and(typeIs(CardType.MEMBER), costLte(9), groupAliasIs('虹ヶ咲')),
    memberLabel: '费用小于等于9的『虹ヶ咲』成员卡',
    emptyStep: 'NO_WAITING_LOW_COST_NIJIGASAKI_MEMBER',
  },
  {
    abilityId: PL_PB2_017_ON_ENTER_STACK_FOUR_PRINTEMPS_MEMBERS_ABILITY_ID,
    stepId: 'SELECT_WAITING_MEMBERS_BELOW_SOURCE',
    count: 4,
    selector: and(typeIs(CardType.MEMBER), unitAliasIs('Printemps')),
    memberLabel: '『Printemps』成员卡',
    emptyStep: 'NO_WAITING_PRINTEMPS_MEMBER',
  },
];
type Continue = (game: GameState, ordered: boolean) => GameState;
type SourceContext = PendingAbilityState | ActiveEffectState;

export function registerWaitingRoomMembersBelowSourceWorkflowHandlers(): void {
  for (const config of CONFIGS) {
    registerPendingAbilityStarterHandler(config.abilityId, (game, ability, options, context) => {
      const ids = selectWaitingRoomCardIds(game, ability.controllerId, config.selector);
      if (!sourceIsCurrent(game, ability)) {
        return finish(
          game,
          ability,
          options.orderedResolution === true,
          context.continuePendingCardEffects,
          'SOURCE_NOT_ON_STAGE'
        );
      }
      if (ids.length === 0) {
        return finish(
          game,
          ability,
          options.orderedResolution === true,
          context.continuePendingCardEffects,
          config.emptyStep
        );
      }
      return startPendingActiveEffect(game, {
        ability,
        playerId: ability.controllerId,
        activeEffect: selectionEffect(
          game,
          ability,
          config,
          ids,
          options.orderedResolution === true
        ),
        actionPayload: {
          sourceCardId: ability.sourceCardId,
          step: 'SELECT_WAITING_MEMBERS_BELOW_SOURCE',
          selectableCardIds: ids,
        },
      });
    });
    registerActiveEffectStepHandler(config.abilityId, config.stepId, (game, input, context) => {
      const effect = getCardActiveEffect(game);
      if (!effect) return game;
      const ordered = effect.metadata?.orderedResolution === true;
      if (!sourceIsCurrent(game, effect)) {
        return finish(
          game,
          effect,
          ordered,
          context.continuePendingCardEffects,
          'SOURCE_NOT_ON_STAGE'
        );
      }
      const ids = selectWaitingRoomCardIds(game, effect.controllerId, config.selector);
      if (ids.length === 0)
        return finish(game, effect, ordered, context.continuePendingCardEffects, config.emptyStep);
      const selected =
        input.selectedCardIds ?? (input.selectedCardId ? [input.selectedCardId] : []);
      const count = Math.min(config.count, ids.length);
      if (
        selected.length !== count ||
        new Set(selected).size !== selected.length ||
        selected.some((id) => !ids.includes(id) || !effect.selectableCardIds?.includes(id))
      ) {
        const stale =
          ids.length !== effect.selectableCardIds?.length ||
          ids.some((id, i) => effect.selectableCardIds?.[i] !== id);
        return stale
          ? { ...game, activeEffect: selectionEffect(game, effect, config, ids, ordered) }
          : game;
      }
      let state = game;
      const sourceSlot = getSourceMemberSlot(game, effect.controllerId, effect.sourceCardId)!;
      for (const cardId of selected) {
        const result = stackMemberCardBelowStageMember(state, {
          playerId: effect.controllerId,
          sourceZone: ZoneType.WAITING_ROOM,
          movedCardId: cardId,
          hostCardId: effect.sourceCardId,
          targetSlot: sourceSlot,
        });
        if (!result) return game;
        state = result.gameState;
      }
      return finish(
        state,
        effect,
        ordered,
        context.continuePendingCardEffects,
        'STACK_WAITING_MEMBERS_BELOW_SOURCE',
        { stackedCardIds: selected, sourceSlot }
      );
    });
  }
}

function sourceIsCurrent(game: GameState, context: SourceContext): boolean {
  const source = getCardById(game, context.sourceCardId);
  return (
    source !== null &&
    source.ownerId === context.controllerId &&
    isMemberCardData(source.data) &&
    doesCardAbilityDefinitionMatchCardCode(
      getCardAbilityDefinitionById(context.abilityId),
      source.data.cardCode
    ) &&
    getSourceMemberSlot(game, context.controllerId, context.sourceCardId) !== null &&
    (context.sourceLifecycleId === undefined ||
      context.sourceLifecycleId ===
        getAbilitySourceLifecycleId(game, context.abilityId, context.sourceCardId))
  );
}

function selectionEffect(
  game: GameState,
  context: SourceContext,
  config: Config,
  ids: readonly string[],
  ordered: boolean
): ActiveEffectState {
  const count = Math.min(config.count, ids.length);
  return {
    id: context.id,
    abilityId: context.abilityId,
    sourceCardId: context.sourceCardId,
    sourceLifecycleId:
      context.sourceLifecycleId ??
      getAbilitySourceLifecycleId(game, context.abilityId, context.sourceCardId),
    controllerId: context.controllerId,
    awaitingPlayerId: context.controllerId,
    effectText: getAbilityEffectText(context.abilityId),
    stepId: config.stepId,
    stepText: `请选择自己休息室中${count}张${config.memberLabel}，放置于此成员下方。`,
    selectableCardIds: ids,
    selectableCardVisibility: 'PUBLIC',
    selectableCardMode: config.count > 1 ? 'ORDERED_MULTI' : 'SINGLE',
    minSelectableCards: count,
    maxSelectableCards: count,
    canSkipSelection: false,
    selectionLabel: '选择要放置于此成员下方的成员卡',
    confirmSelectionLabel: '放置于此成员下方',
    metadata: {
      orderedResolution: ordered,
    },
  };
}

function finish(
  game: GameState,
  context: SourceContext,
  ordered: boolean,
  continuation: Continue,
  step: string,
  payload: Readonly<Record<string, unknown>> = {}
): GameState {
  return continuation(
    addAction(
      {
        ...game,
        pendingAbilities: game.pendingAbilities.filter((ability) => ability.id !== context.id),
        activeEffect: game.activeEffect?.id === context.id ? null : game.activeEffect,
      },
      'RESOLVE_ABILITY',
      context.controllerId,
      {
        pendingAbilityId: context.id,
        abilityId: context.abilityId,
        sourceCardId: context.sourceCardId,
        step,
        ...payload,
      }
    ),
    ordered
  );
}
