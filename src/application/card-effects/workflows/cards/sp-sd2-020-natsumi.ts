import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { isMemberCardData } from '../../../../domain/entities/card.js';
import { SlotPosition } from '../../../../shared/types/enums.js';
import { groupAliasIs } from '../../../effects/card-selectors.js';
import { SP_SD2_020_LIVE_START_ENERGY_SEVEN_SOURCE_AND_OTHER_LIELLA_GAIN_BLADE_ABILITY_ID } from '../../ability-ids.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import { addBladeLiveModifierForSourceMember } from '../../runtime/actions.js';
import { getSourceMemberSlot } from '../../runtime/source-member.js';
import {
  registerPendingAbilityStarterHandler,
  type PendingAbilityStarterOptions,
} from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  getAbilityEffectText,
  maybeStartConfirmablePendingAbilityConfirmation,
} from '../../runtime/workflow-helpers.js';

export const SP_SD2_020_SELECT_OTHER_LIELLA_BLADE_TARGET_STEP_ID =
  'SP_SD2_020_SELECT_OTHER_LIELLA_BLADE_TARGET';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

const MEMBER_SLOT_ORDER = [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT] as const;
const liellaMember = groupAliasIs('Liella!');

export function registerSpSd2020NatsumiWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    SP_SD2_020_LIVE_START_ENERGY_SEVEN_SOURCE_AND_OTHER_LIELLA_GAIN_BLADE_ABILITY_ID,
    (game, ability, options, context) =>
      startSpSd2020NatsumiLiveStart(
        game,
        ability,
        options,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    SP_SD2_020_LIVE_START_ENERGY_SEVEN_SOURCE_AND_OTHER_LIELLA_GAIN_BLADE_ABILITY_ID,
    SP_SD2_020_SELECT_OTHER_LIELLA_BLADE_TARGET_STEP_ID,
    (game, input, context) =>
      finishSpSd2020NatsumiLiveStart(
        game,
        input.selectedCardId ?? null,
        context.continuePendingCardEffects
      )
  );
}

function startSpSd2020NatsumiLiveStart(
  game: GameState,
  ability: PendingAbilityState,
  options: PendingAbilityStarterOptions,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  const sourceSlot = player ? getSourceMemberSlot(game, player.id, ability.sourceCardId) : null;
  const energyCount = player?.energyZone.cardIds.length ?? 0;
  const selectableCardIds = player
    ? getOtherOwnStageLiellaMemberCardIds(game, player.id, ability.sourceCardId)
    : [];
  if (!player || !sourceSlot) {
    const confirmation = maybeStartNoInteractionConfirmation(game, ability, options, {
      energyCount,
      selectableCardIds,
      resultText: '来源成员不在舞台，不写入 BLADE',
      stepText: `当前能量 ${energyCount} 张，其他 Liella! 目标 ${selectableCardIds.length} 名。来源成员不在舞台，确认后此效果不写入 BLADE。`,
    });
    if (confirmation) {
      return confirmation;
    }

    return finishPendingAbility(
      game,
      ability,
      ability.controllerId,
      orderedResolution,
      {
        step: 'SOURCE_NOT_ON_STAGE',
        sourceSlot,
        energyCount: player?.energyZone.cardIds.length ?? 0,
      },
      continuePendingCardEffects
    );
  }

  if (energyCount < 7) {
    const confirmation = maybeStartNoInteractionConfirmation(game, ability, options, {
      energyCount,
      selectableCardIds,
      resultText: '能量不足 7 张，不写入 BLADE',
      stepText: `当前能量 ${energyCount} 张，其他 Liella! 目标 ${selectableCardIds.length} 名。能量不足 7 张，确认后不写入 BLADE。`,
    });
    if (confirmation) {
      return confirmation;
    }

    return finishPendingAbility(
      game,
      ability,
      player.id,
      orderedResolution,
      {
        step: 'ENERGY_CONDITION_NOT_MET',
        sourceSlot,
        energyCount,
        requiredEnergyCount: 7,
      },
      continuePendingCardEffects
    );
  }

  if (selectableCardIds.length <= 1) {
    const targetCount = selectableCardIds.length;
    const confirmation = maybeStartNoInteractionConfirmation(game, ability, options, {
      energyCount,
      selectableCardIds,
      resultText:
        targetCount === 1
          ? '将给来源成员与 1 名其他 Liella! 成员各写入 BLADE +1'
          : '没有其他 Liella! 目标，将只给来源成员写入 BLADE +1',
      stepText:
        targetCount === 1
          ? `当前能量 ${energyCount} 张，其他 Liella! 目标 1 名。确认后来源成员与该目标各获得 BLADE +1。`
          : `当前能量 ${energyCount} 张，其他 Liella! 目标 0 名。确认后只给来源成员写入 BLADE +1，并消费此 pending。`,
    });
    if (confirmation) {
      return confirmation;
    }

    return resolveBladeModifiers(
      game,
      ability,
      player.id,
      orderedResolution,
      selectableCardIds[0] ?? null,
      {
        step:
          selectableCardIds.length === 1
            ? 'AUTO_SOURCE_AND_OTHER_LIELLA_GAIN_BLADE'
            : 'SOURCE_GAIN_BLADE_NO_OTHER_LIELLA_TARGET',
        sourceSlot,
        energyCount,
        selectableCardIds,
      },
      continuePendingCardEffects,
      true
    );
  }

  return startPendingActiveEffect(game, {
    ability,
    playerId: player.id,
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: ability.controllerId,
      effectText: getAbilityEffectText(
        SP_SD2_020_LIVE_START_ENERGY_SEVEN_SOURCE_AND_OTHER_LIELLA_GAIN_BLADE_ABILITY_ID
      ),
      stepId: SP_SD2_020_SELECT_OTHER_LIELLA_BLADE_TARGET_STEP_ID,
      stepText: '请选择获得[BLADE]的其他『Liella!』成员。',
      awaitingPlayerId: player.id,
      selectableCardIds,
      selectionLabel: '选择其他 Liella! 成员',
      confirmSelectionLabel: '获得[BLADE]',
      metadata: {
        orderedResolution,
        sourceSlot,
        energyCount,
      },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_SELECT_OTHER_LIELLA_BLADE_TARGET',
      sourceSlot,
      energyCount,
      selectableCardIds,
    },
  });
}

function maybeStartNoInteractionConfirmation(
  game: GameState,
  ability: PendingAbilityState,
  options: PendingAbilityStarterOptions,
  context: {
    readonly energyCount: number;
    readonly selectableCardIds: readonly string[];
    readonly resultText: string;
    readonly stepText: string;
  }
): GameState | null {
  return maybeStartConfirmablePendingAbilityConfirmation(game, ability, options, {
    effectText: `${getAbilityEffectText(ability.abilityId)}（当前能量 ${context.energyCount} 张，其他 Liella! 目标 ${context.selectableCardIds.length} 名，实际结算：${context.resultText}。）`,
    stepText: context.stepText,
  });
}

function finishSpSd2020NatsumiLiveStart(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  if (
    !effect ||
    !player ||
    effect.abilityId !==
      SP_SD2_020_LIVE_START_ENERGY_SEVEN_SOURCE_AND_OTHER_LIELLA_GAIN_BLADE_ABILITY_ID ||
    effect.stepId !== SP_SD2_020_SELECT_OTHER_LIELLA_BLADE_TARGET_STEP_ID ||
    !selectedCardId ||
    effect.selectableCardIds?.includes(selectedCardId) !== true
  ) {
    return game;
  }

  const sourceSlot = getSourceMemberSlot(game, player.id, effect.sourceCardId);
  const energyCount = player.energyZone.cardIds.length;
  const selectedStillLegal = getOtherOwnStageLiellaMemberCardIds(
    game,
    player.id,
    effect.sourceCardId
  ).includes(selectedCardId);
  if (!sourceSlot || energyCount < 7 || !selectedStillLegal) {
    return continuePendingCardEffects(
      addAction(
        {
          ...game,
          activeEffect: null,
        },
        'RESOLVE_ABILITY',
        player.id,
        {
          pendingAbilityId: effect.id,
          abilityId: effect.abilityId,
          sourceCardId: effect.sourceCardId,
          step: !sourceSlot
            ? 'SOURCE_NOT_ON_STAGE_AFTER_SELECTION'
            : energyCount < 7
              ? 'ENERGY_CONDITION_NOT_MET_AFTER_SELECTION'
              : 'SELECTED_TARGET_NOT_VALID',
          sourceSlot,
          energyCount,
          selectedCardId,
        }
      ),
      effect.metadata?.orderedResolution === true
    );
  }

  return resolveBladeModifiers(
    { ...game, activeEffect: null },
    {
      id: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
    },
    player.id,
    effect.metadata?.orderedResolution === true,
    selectedCardId,
    {
      step: 'SELECT_SOURCE_AND_OTHER_LIELLA_GAIN_BLADE',
      sourceSlot,
      energyCount,
      selectedCardId,
      selectableCardIds: effect.selectableCardIds ?? [],
    },
    continuePendingCardEffects,
    false
  );
}

function resolveBladeModifiers(
  game: GameState,
  ability: Pick<PendingAbilityState, 'id' | 'abilityId' | 'sourceCardId'>,
  playerId: string,
  orderedResolution: boolean,
  targetCardId: string | null,
  payload: Readonly<Record<string, unknown>>,
  continuePendingCardEffects: ContinuePendingCardEffects,
  removePendingAbility: boolean
): GameState {
  let state = removePendingAbility
    ? {
        ...game,
        pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
      }
    : game;
  const appliedTargetMemberCardIds: string[] = [];

  const sourceBladeResult = addBladeLiveModifierForSourceMember(state, {
    playerId,
    sourceCardId: ability.sourceCardId,
    abilityId: ability.abilityId,
    amount: 1,
  });
  if (sourceBladeResult) {
    state = sourceBladeResult.gameState;
    appliedTargetMemberCardIds.push(ability.sourceCardId);
  }

  if (targetCardId) {
    const targetBladeResult = addBladeLiveModifierForSourceMember(state, {
      playerId,
      sourceCardId: targetCardId,
      abilityId: ability.abilityId,
      amount: 1,
    });
    if (targetBladeResult) {
      state = targetBladeResult.gameState;
      appliedTargetMemberCardIds.push(targetCardId);
    }
  }

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', playerId, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      targetCardId,
      appliedTargetMemberCardIds,
      bladeBonusPerMember: 1,
      ...payload,
    }),
    orderedResolution
  );
}

function finishPendingAbility(
  game: GameState,
  ability: PendingAbilityState,
  playerId: string,
  orderedResolution: boolean,
  payload: Readonly<Record<string, unknown>>,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  return continuePendingCardEffects(
    addAction(
      {
        ...game,
        pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
      },
      'RESOLVE_ABILITY',
      playerId,
      {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        ...payload,
      }
    ),
    orderedResolution
  );
}

function getOtherOwnStageLiellaMemberCardIds(
  game: GameState,
  playerId: string,
  sourceCardId: string
): readonly string[] {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return [];
  }

  return MEMBER_SLOT_ORDER.flatMap((slot) => {
    const cardId = player.memberSlots.slots[slot];
    if (!cardId || cardId === sourceCardId) {
      return [];
    }
    const card = getCardById(game, cardId);
    return card && card.ownerId === playerId && isMemberCardData(card.data) && liellaMember(card)
      ? [cardId]
      : [];
  });
}
