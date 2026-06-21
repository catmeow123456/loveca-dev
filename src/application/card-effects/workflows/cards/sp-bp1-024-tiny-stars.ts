import {
  addAction,
  getPlayerById,
  type ActiveEffectState,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { addHeartLiveModifierForMember } from '../../../../domain/rules/live-modifiers.js';
import { HeartColor } from '../../../../shared/types/enums.js';
import {
  SP_BP1_024_LIVE_START_KANON_KEKE_GAIN_HEART_BLADE_ABILITY_ID,
  SP_BP1_024_LIVE_SUCCESS_STAGE_KANON_KEKE_DRAW_ABILITY_ID,
} from '../../ability-ids.js';
import {
  addBladeLiveModifierForSourceMember,
  drawCardsForPlayer,
} from '../../runtime/actions.js';
import {
  startConfirmOnlyPendingAbilityEffect,
  startPendingActiveEffect,
} from '../../runtime/active-effect.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';
import { cardNameAliasIs } from '../../../effects/card-selectors.js';
import { getStageMemberCardIdsMatching } from '../../../effects/stage-targets.js';

const SELECT_KANON_TARGET_STEP_ID = 'SP_BP1_024_SELECT_KANON_TARGET';
const SELECT_KEKE_TARGET_STEP_ID = 'SP_BP1_024_SELECT_KEKE_TARGET';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

interface TinyStarsTargets {
  readonly kanonTargetId: string | null;
  readonly kekeTargetId: string | null;
  readonly kanonCandidateIds: readonly string[];
  readonly kekeCandidateIds: readonly string[];
}

type TinyStarsAbilityRef = Pick<
  PendingAbilityState,
  'id' | 'abilityId' | 'sourceCardId' | 'controllerId'
>;

export function registerSpBp1024TinyStarsWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    SP_BP1_024_LIVE_START_KANON_KEKE_GAIN_HEART_BLADE_ABILITY_ID,
    (game, ability, options, context) =>
      startTinyStarsLiveStart(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerPendingAbilityStarterHandler(
    SP_BP1_024_LIVE_SUCCESS_STAGE_KANON_KEKE_DRAW_ABILITY_ID,
    (game, ability, options, context) =>
      startTinyStarsLiveSuccess(
        game,
        ability,
        {
          orderedResolution: options.orderedResolution === true,
          manualConfirmation: options.manualConfirmation === true,
          skipManualConfirmation: options.skipManualConfirmation === true,
        },
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    SP_BP1_024_LIVE_START_KANON_KEKE_GAIN_HEART_BLADE_ABILITY_ID,
    SELECT_KANON_TARGET_STEP_ID,
    (game, input, context) =>
      finishSelectKanonTarget(game, input.selectedCardId ?? null, context.continuePendingCardEffects)
  );
  registerActiveEffectStepHandler(
    SP_BP1_024_LIVE_START_KANON_KEKE_GAIN_HEART_BLADE_ABILITY_ID,
    SELECT_KEKE_TARGET_STEP_ID,
    (game, input, context) =>
      finishSelectKekeTarget(game, input.selectedCardId ?? null, context.continuePendingCardEffects)
  );
}

function startTinyStarsLiveStart(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const kanonCandidateIds = getKanonCandidateIds(game, player.id);
  const kekeCandidateIds = getKekeCandidateIds(game, player.id);
  const targets: TinyStarsTargets = {
    kanonCandidateIds,
    kekeCandidateIds,
    kanonTargetId: kanonCandidateIds.length === 1 ? kanonCandidateIds[0] : null,
    kekeTargetId: kekeCandidateIds.length === 1 ? kekeCandidateIds[0] : null,
  };

  if (kanonCandidateIds.length > 1) {
    return startTargetSelection(game, ability, orderedResolution, {
      stepId: SELECT_KANON_TARGET_STEP_ID,
      step: 'START_SELECT_KANON_TARGET',
      stepText: '请选择1名「澁谷かのん」获得[青ハート][BLADE]。',
      selectionLabel: '选择「澁谷かのん」',
      selectableCardIds: kanonCandidateIds,
      targets,
    });
  }

  if (kekeCandidateIds.length > 1) {
    return startTargetSelection(game, ability, orderedResolution, {
      stepId: SELECT_KEKE_TARGET_STEP_ID,
      step: 'START_SELECT_KEKE_TARGET',
      stepText: '请选择1名「唐可可」获得[桃ハート][BLADE]。',
      selectionLabel: '选择「唐可可」',
      selectableCardIds: kekeCandidateIds,
      targets,
    });
  }

  return resolveTinyStarsLiveStartTargets(
    game,
    ability,
    orderedResolution,
    continuePendingCardEffects,
    targets
  );
}

function startTargetSelection(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  config: {
    readonly stepId: string;
    readonly step: string;
    readonly stepText: string;
    readonly selectionLabel: string;
    readonly selectableCardIds: readonly string[];
    readonly targets: TinyStarsTargets;
  }
): GameState {
  return startPendingActiveEffect(game, {
    ability,
    playerId: ability.controllerId,
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: ability.controllerId,
      effectText: getAbilityEffectText(ability.abilityId),
      stepId: config.stepId,
      stepText: config.stepText,
      awaitingPlayerId: ability.controllerId,
      selectableCardIds: config.selectableCardIds,
      selectableCardVisibility: 'PUBLIC',
      selectionLabel: config.selectionLabel,
      confirmSelectionLabel: '确定',
      canSkipSelection: false,
      metadata: {
        orderedResolution,
        kanonCandidateIds: config.targets.kanonCandidateIds,
        kekeCandidateIds: config.targets.kekeCandidateIds,
        kanonTargetId: config.targets.kanonTargetId,
        kekeTargetId: config.targets.kekeTargetId,
      },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: config.step,
      kanonCandidateIds: config.targets.kanonCandidateIds,
      kekeCandidateIds: config.targets.kekeCandidateIds,
      kanonTargetId: config.targets.kanonTargetId,
      kekeTargetId: config.targets.kekeTargetId,
      selectableCardIds: config.selectableCardIds,
    },
  });
}

function finishSelectKanonTarget(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = getTinyStarsSelectionEffect(game, SELECT_KANON_TARGET_STEP_ID);
  if (!effect || !selectedCardId || !effect.selectableCardIds?.includes(selectedCardId)) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (!player || !getKanonCandidateIds(game, player.id).includes(selectedCardId)) {
    return game;
  }

  const kekeCandidateIds = getKekeCandidateIds(game, player.id);
  const selectedKekeTargetId =
    kekeCandidateIds.length === 1 ? kekeCandidateIds[0] : getStringMetadata(effect, 'kekeTargetId');
  const selectionState = addAction(game, 'RESOLVE_ABILITY', player.id, {
    pendingAbilityId: effect.id,
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    step: 'SELECT_KANON_TARGET',
    selectedKanonTargetId: selectedCardId,
  });

  if (kekeCandidateIds.length > 1) {
    return addAction(
      {
        ...selectionState,
        activeEffect: {
          ...effect,
          stepId: SELECT_KEKE_TARGET_STEP_ID,
          stepText: '请选择1名「唐可可」获得[桃ハート][BLADE]。',
          selectableCardIds: kekeCandidateIds,
          selectionLabel: '选择「唐可可」',
          metadata: {
            ...effect.metadata,
            kanonTargetId: selectedCardId,
            kekeCandidateIds,
            kekeTargetId: selectedKekeTargetId,
          },
        },
      },
      'RESOLVE_ABILITY',
      player.id,
      {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'START_SELECT_KEKE_TARGET',
        kanonTargetId: selectedCardId,
        kekeCandidateIds,
      }
    );
  }

  return resolveTinyStarsLiveStartTargets(
    selectionState,
    effect,
    effect.metadata?.orderedResolution === true,
    continuePendingCardEffects,
    {
      kanonCandidateIds: getStringArrayMetadata(effect, 'kanonCandidateIds'),
      kekeCandidateIds,
      kanonTargetId: selectedCardId,
      kekeTargetId: selectedKekeTargetId,
    }
  );
}

function finishSelectKekeTarget(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = getTinyStarsSelectionEffect(game, SELECT_KEKE_TARGET_STEP_ID);
  if (!effect || !selectedCardId || !effect.selectableCardIds?.includes(selectedCardId)) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (!player || !getKekeCandidateIds(game, player.id).includes(selectedCardId)) {
    return game;
  }

  const selectionState = addAction(game, 'RESOLVE_ABILITY', player.id, {
    pendingAbilityId: effect.id,
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    step: 'SELECT_KEKE_TARGET',
    selectedKekeTargetId: selectedCardId,
  });

  return resolveTinyStarsLiveStartTargets(
    selectionState,
    effect,
    effect.metadata?.orderedResolution === true,
    continuePendingCardEffects,
    {
      kanonCandidateIds: getStringArrayMetadata(effect, 'kanonCandidateIds'),
      kekeCandidateIds: getStringArrayMetadata(effect, 'kekeCandidateIds'),
      kanonTargetId: getStringMetadata(effect, 'kanonTargetId'),
      kekeTargetId: selectedCardId,
    }
  );
}

function resolveTinyStarsLiveStartTargets(
  game: GameState,
  ability: TinyStarsAbilityRef,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  targets: TinyStarsTargets
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  let state: GameState = {
    ...game,
    activeEffect: null,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
  let kanonHeartBonus: unknown = null;
  let kekeHeartBonus: unknown = null;
  let kanonBladeBonus = 0;
  let kekeBladeBonus = 0;

  if (targets.kanonTargetId) {
    const heartResult = addHeartLiveModifierForMember(state, {
      playerId: player.id,
      memberCardId: targets.kanonTargetId,
      sourceCardId: ability.sourceCardId,
      abilityId: ability.abilityId,
      hearts: [{ color: HeartColor.BLUE, count: 1 }],
    });
    if (heartResult) {
      state = heartResult.gameState;
      kanonHeartBonus = heartResult.heartBonus;
    }
    const bladeResult = addBladeLiveModifierForSourceMember(state, {
      playerId: player.id,
      sourceCardId: targets.kanonTargetId,
      abilityId: ability.abilityId,
      amount: 1,
    });
    if (bladeResult) {
      state = bladeResult.gameState;
      kanonBladeBonus = bladeResult.bladeBonus;
    }
  }

  if (targets.kekeTargetId) {
    const heartResult = addHeartLiveModifierForMember(state, {
      playerId: player.id,
      memberCardId: targets.kekeTargetId,
      sourceCardId: ability.sourceCardId,
      abilityId: ability.abilityId,
      hearts: [{ color: HeartColor.PINK, count: 1 }],
    });
    if (heartResult) {
      state = heartResult.gameState;
      kekeHeartBonus = heartResult.heartBonus;
    }
    const bladeResult = addBladeLiveModifierForSourceMember(state, {
      playerId: player.id,
      sourceCardId: targets.kekeTargetId,
      abilityId: ability.abilityId,
      amount: 1,
    });
    if (bladeResult) {
      state = bladeResult.gameState;
      kekeBladeBonus = bladeResult.bladeBonus;
    }
  }

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'LIVE_START_KANON_KEKE_GAIN_HEART_BLADE',
      kanonCandidateIds: targets.kanonCandidateIds,
      kekeCandidateIds: targets.kekeCandidateIds,
      kanonTargetId: targets.kanonTargetId,
      kekeTargetId: targets.kekeTargetId,
      kanonHeartBonus,
      kekeHeartBonus,
      kanonBladeBonus,
      kekeBladeBonus,
    }),
    orderedResolution
  );
}

function resolveTinyStarsLiveSuccess(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const kanonCandidateIds = getKanonCandidateIds(game, player.id);
  const kekeCandidateIds = getKekeCandidateIds(game, player.id);
  const conditionMet = kanonCandidateIds.length > 0 && kekeCandidateIds.length > 0;
  const stateWithoutPending: GameState = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
  const drawResult = conditionMet ? drawCardsForPlayer(stateWithoutPending, player.id, 1) : null;
  const state = drawResult?.gameState ?? stateWithoutPending;

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'LIVE_SUCCESS_STAGE_KANON_KEKE_DRAW',
      kanonCandidateIds,
      kekeCandidateIds,
      conditionMet,
      drawnCardIds: drawResult?.drawnCardIds ?? [],
    }),
    orderedResolution
  );
}

function startTinyStarsLiveSuccess(
  game: GameState,
  ability: PendingAbilityState,
  options: {
    readonly orderedResolution: boolean;
    readonly manualConfirmation: boolean;
    readonly skipManualConfirmation: boolean;
  },
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  if (options.manualConfirmation && !options.skipManualConfirmation) {
    const kanonCandidateIds = getKanonCandidateIds(game, player.id);
    const kekeCandidateIds = getKekeCandidateIds(game, player.id);
    const conditionMet = kanonCandidateIds.length > 0 && kekeCandidateIds.length > 0;
    return startConfirmOnlyPendingAbilityEffect(game, {
      ability,
      effectText: getAbilityEffectText(SP_BP1_024_LIVE_SUCCESS_STAGE_KANON_KEKE_DRAW_ABILITY_ID),
      orderedResolution: options.orderedResolution,
      stepText: conditionMet
        ? '自己的舞台存在「澁谷かのん」与「唐 可可」，条件满足。确认后抽 1 张卡。'
        : '自己的舞台未同时存在「澁谷かのん」与「唐 可可」，条件不满足。确认后不抽牌。',
    });
  }

  return resolveTinyStarsLiveSuccess(
    game,
    ability,
    options.orderedResolution,
    continuePendingCardEffects
  );
}

function getTinyStarsSelectionEffect(
  game: GameState,
  stepId: string
): ActiveEffectState | null {
  const effect = game.activeEffect;
  return effect?.abilityId === SP_BP1_024_LIVE_START_KANON_KEKE_GAIN_HEART_BLADE_ABILITY_ID &&
    effect.stepId === stepId
    ? effect
    : null;
}

function getKanonCandidateIds(game: GameState, playerId: string): readonly string[] {
  return getStageMemberCardIdsMatching(game, playerId, cardNameAliasIs('澁谷かのん'));
}

function getKekeCandidateIds(game: GameState, playerId: string): readonly string[] {
  return getStageMemberCardIdsMatching(game, playerId, cardNameAliasIs('唐可可'));
}

function getStringMetadata(effect: ActiveEffectState, key: string): string | null {
  const value = effect.metadata?.[key];
  return typeof value === 'string' ? value : null;
}

function getStringArrayMetadata(effect: ActiveEffectState, key: string): readonly string[] {
  const value = effect.metadata?.[key];
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}
