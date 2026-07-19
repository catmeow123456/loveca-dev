import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { isLiveCardData, isMemberCardData } from '../../../../domain/entities/card.js';
import { CardType } from '../../../../shared/types/enums.js';
import { and, groupAliasIs, typeIs, type CardSelector } from '../../../effects/card-selectors.js';
import { hasLiveWithoutLiveStartOrSuccessAbility } from '../../../effects/conditions.js';
import { getStageMemberCardIdsMatching } from '../../../effects/stage-targets.js';
import {
  PL_BP4_014_LIVE_START_LIVE_WITHOUT_TIMING_TARGET_OTHER_MEMBER_GAIN_TWO_BLADE_ABILITY_ID,
  PL_BP4_024_LIVE_START_TARGET_MUSE_MEMBER_GAIN_ONE_BLADE_ABILITY_ID,
  S_BP2_025_LIVE_START_SUCCESS_TWO_TARGET_MEMBER_GAIN_TWO_BLADE_ABILITY_ID,
} from '../../ability-ids.js';
import { addBladeLiveModifierForMember } from '../../runtime/actions.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

const SELECT_MEMBER_STEP_ID = 'LIVE_START_TARGET_MEMBER_GAIN_BLADE_SELECT_MEMBER';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

type SourceZone = 'STAGE_MEMBER' | 'LIVE_CARD';

type LiveStartTargetMemberGainBladeCondition =
  | { readonly type: 'NONE' }
  | { readonly type: 'SUCCESS_LIVE_COUNT_AT_LEAST'; readonly count: number }
  | { readonly type: 'LIVE_WITHOUT_LIVE_START_OR_SUCCESS' };

interface LiveStartTargetMemberGainBladeConfig {
  readonly abilityId: string;
  readonly sourceZone: SourceZone;
  readonly bladeAmount: number;
  readonly targetGroup?: string;
  readonly excludeSourceMember: boolean;
  readonly condition: LiveStartTargetMemberGainBladeCondition;
  readonly bladeCopy: string;
}

const CONFIGS: readonly LiveStartTargetMemberGainBladeConfig[] = [
  {
    abilityId: S_BP2_025_LIVE_START_SUCCESS_TWO_TARGET_MEMBER_GAIN_TWO_BLADE_ABILITY_ID,
    sourceZone: 'LIVE_CARD',
    bladeAmount: 2,
    excludeSourceMember: false,
    condition: { type: 'SUCCESS_LIVE_COUNT_AT_LEAST', count: 2 },
    bladeCopy: '[BLADE][BLADE]',
  },
  {
    abilityId:
      PL_BP4_014_LIVE_START_LIVE_WITHOUT_TIMING_TARGET_OTHER_MEMBER_GAIN_TWO_BLADE_ABILITY_ID,
    sourceZone: 'STAGE_MEMBER',
    bladeAmount: 2,
    excludeSourceMember: true,
    condition: { type: 'LIVE_WITHOUT_LIVE_START_OR_SUCCESS' },
    bladeCopy: '[ブレード][ブレード]',
  },
  {
    abilityId: PL_BP4_024_LIVE_START_TARGET_MUSE_MEMBER_GAIN_ONE_BLADE_ABILITY_ID,
    sourceZone: 'LIVE_CARD',
    bladeAmount: 1,
    targetGroup: "μ's",
    excludeSourceMember: false,
    condition: { type: 'NONE' },
    bladeCopy: '[ブレード]',
  },
] as const;

export function registerLiveStartTargetMemberGainBladeWorkflowHandlers(): void {
  for (const config of CONFIGS) {
    registerPendingAbilityStarterHandler(config.abilityId, (game, ability, options, context) =>
      startLiveStartTargetMemberGainBlade(
        game,
        ability,
        config,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
    );
    registerActiveEffectStepHandler(
      config.abilityId,
      SELECT_MEMBER_STEP_ID,
      (game, input, context) =>
        finishTargetMemberSelection(
          game,
          input.selectedCardId ?? null,
          config,
          context.continuePendingCardEffects
        )
    );
  }
}

function startLiveStartTargetMemberGainBlade(
  game: GameState,
  ability: PendingAbilityState,
  config: LiveStartTargetMemberGainBladeConfig,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const stateWithoutPending = removePendingAbility(game, ability.id);
  if (!isSourceValid(stateWithoutPending, player.id, ability.sourceCardId, config.sourceZone)) {
    return continueNoOp(
      stateWithoutPending,
      ability,
      player.id,
      orderedResolution,
      continuePendingCardEffects,
      { step: 'SOURCE_INVALID' }
    );
  }
  if (!conditionMatches(stateWithoutPending, player.id, config.condition)) {
    return continueNoOp(
      stateWithoutPending,
      ability,
      player.id,
      orderedResolution,
      continuePendingCardEffects,
      { step: 'CONDITION_NOT_MET', conditionType: config.condition.type }
    );
  }

  const targetMemberCardIds = getCurrentTargetMemberCardIds(
    stateWithoutPending,
    player.id,
    ability.sourceCardId,
    config
  );
  if (targetMemberCardIds.length === 0) {
    return continueNoOp(
      stateWithoutPending,
      ability,
      player.id,
      orderedResolution,
      continuePendingCardEffects,
      { step: 'NO_STAGE_MEMBER_TARGET' }
    );
  }
  if (targetMemberCardIds.length === 1) {
    return applyBladeAndContinue(
      stateWithoutPending,
      ability,
      player.id,
      targetMemberCardIds[0],
      config,
      orderedResolution,
      continuePendingCardEffects,
      'AUTO_TARGET_MEMBER_GAIN_BLADE'
    );
  }

  const targetDescription = config.targetGroup
    ? `自己舞台上的1名『${config.targetGroup}』成员`
    : config.excludeSourceMember
      ? '自己舞台上的此成员以外的1名成员'
      : '自己舞台上的1名成员';
  return addAction(
    {
      ...stateWithoutPending,
      activeEffect: {
        id: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        controllerId: player.id,
        effectText: getAbilityEffectText(ability.abilityId),
        stepId: SELECT_MEMBER_STEP_ID,
        stepText: `请选择${targetDescription}获得${config.bladeCopy}。`,
        awaitingPlayerId: player.id,
        selectableCardIds: targetMemberCardIds,
        selectableCardVisibility: 'PUBLIC',
        selectableCardMode: 'SINGLE',
        selectionLabel: `选择获得${config.bladeCopy}的成员`,
        confirmSelectionLabel: `获得${config.bladeCopy}`,
        canSkipSelection: false,
        metadata: { orderedResolution },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'SELECT_MEMBER_BLADE_TARGET',
      selectableCardIds: targetMemberCardIds,
    }
  );
}

function finishTargetMemberSelection(
  game: GameState,
  selectedCardId: string | null,
  config: LiveStartTargetMemberGainBladeConfig,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (!effect || effect.abilityId !== config.abilityId || effect.stepId !== SELECT_MEMBER_STEP_ID) {
    return game;
  }
  if (selectedCardId === null || effect.selectableCardIds?.includes(selectedCardId) !== true) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  const currentTargetMemberCardIds = player
    ? getCurrentTargetMemberCardIds(game, player.id, effect.sourceCardId, config)
    : [];
  const validSelection =
    player !== null &&
    isSourceValid(game, player.id, effect.sourceCardId, config.sourceZone) &&
    conditionMatches(game, player.id, config.condition) &&
    currentTargetMemberCardIds.includes(selectedCardId);

  if (!player || !validSelection) {
    return finishSelectionWithoutBlade(
      game,
      effect,
      player?.id ?? effect.controllerId,
      continuePendingCardEffects,
      {
        step: 'STALE_OR_INVALID_MEMBER_SELECTION',
        selectedCardId,
        selectableCardIds: currentTargetMemberCardIds,
      }
    );
  }

  const bladeResult = addBladeLiveModifierForMember(game, {
    playerId: player.id,
    memberCardId: selectedCardId,
    sourceCardId: effect.sourceCardId,
    abilityId: effect.abilityId,
    countDelta: config.bladeAmount,
  });
  if (!bladeResult) {
    return finishSelectionWithoutBlade(game, effect, player.id, continuePendingCardEffects, {
      step: 'TARGET_MEMBER_NO_LONGER_VALID',
      selectedCardId,
    });
  }

  return continuePendingCardEffects(
    addAction({ ...bladeResult.gameState, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'TARGET_MEMBER_GAIN_BLADE',
      targetMemberCardId: selectedCardId,
      bladeBonus: config.bladeAmount,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function applyBladeAndContinue(
  game: GameState,
  ability: PendingAbilityState,
  playerId: string,
  targetMemberCardId: string,
  config: LiveStartTargetMemberGainBladeConfig,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  step: string
): GameState {
  const bladeResult = addBladeLiveModifierForMember(game, {
    playerId,
    memberCardId: targetMemberCardId,
    sourceCardId: ability.sourceCardId,
    abilityId: ability.abilityId,
    countDelta: config.bladeAmount,
  });
  if (!bladeResult) {
    return continueNoOp(game, ability, playerId, orderedResolution, continuePendingCardEffects, {
      step: 'TARGET_MEMBER_NO_LONGER_VALID',
      targetMemberCardId,
    });
  }
  return continuePendingCardEffects(
    addAction(bladeResult.gameState, 'RESOLVE_ABILITY', playerId, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step,
      targetMemberCardId,
      bladeBonus: config.bladeAmount,
    }),
    orderedResolution
  );
}

function getCurrentTargetMemberCardIds(
  game: GameState,
  playerId: string,
  sourceCardId: string,
  config: LiveStartTargetMemberGainBladeConfig
): readonly string[] {
  const selectors: CardSelector[] = [typeIs(CardType.MEMBER)];
  if (config.targetGroup) {
    selectors.push(groupAliasIs(config.targetGroup));
  }
  return getStageMemberCardIdsMatching(game, playerId, and(...selectors)).filter((cardId) => {
    const card = getCardById(game, cardId);
    return card?.ownerId === playerId && (!config.excludeSourceMember || cardId !== sourceCardId);
  });
}

function isSourceValid(
  game: GameState,
  playerId: string,
  sourceCardId: string,
  sourceZone: SourceZone
): boolean {
  const player = getPlayerById(game, playerId);
  const sourceCard = getCardById(game, sourceCardId);
  if (!player || !sourceCard || sourceCard.ownerId !== playerId) {
    return false;
  }
  if (sourceZone === 'LIVE_CARD') {
    return isLiveCardData(sourceCard.data) && player.liveZone.cardIds.includes(sourceCardId);
  }
  return (
    isMemberCardData(sourceCard.data) &&
    getStageMemberCardIdsMatching(game, playerId, typeIs(CardType.MEMBER)).includes(sourceCardId)
  );
}

function conditionMatches(
  game: GameState,
  playerId: string,
  condition: LiveStartTargetMemberGainBladeCondition
): boolean {
  switch (condition.type) {
    case 'NONE':
      return true;
    case 'SUCCESS_LIVE_COUNT_AT_LEAST':
      return (getPlayerById(game, playerId)?.successZone.cardIds.length ?? 0) >= condition.count;
    case 'LIVE_WITHOUT_LIVE_START_OR_SUCCESS':
      return hasLiveWithoutLiveStartOrSuccessAbility(game, playerId);
  }
}

function continueNoOp(
  game: GameState,
  ability: PendingAbilityState,
  playerId: string,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  payload: Readonly<Record<string, unknown>>
): GameState {
  return continuePendingCardEffects(
    addAction(game, 'RESOLVE_ABILITY', playerId, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      ...payload,
    }),
    orderedResolution
  );
}

function finishSelectionWithoutBlade(
  game: GameState,
  effect: NonNullable<GameState['activeEffect']>,
  playerId: string,
  continuePendingCardEffects: ContinuePendingCardEffects,
  payload: Readonly<Record<string, unknown>>
): GameState {
  return continuePendingCardEffects(
    addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', playerId, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      ...payload,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function removePendingAbility(game: GameState, pendingAbilityId: string): GameState {
  return {
    ...game,
    pendingAbilities: game.pendingAbilities.filter(
      (candidate) => candidate.id !== pendingAbilityId
    ),
  };
}
