import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { SlotPosition } from '../../../../shared/types/enums.js';
import { hasMemberPositionMovedThisTurn } from '../../../effects/conditions.js';
import {
  SP_BP4_017_LIVE_START_LEFT_MOVED_GAIN_TWO_BLADE_ABILITY_ID,
  SP_BP4_020_LIVE_START_RIGHT_MOVED_GAIN_TWO_BLADE_ABILITY_ID,
} from '../../ability-ids.js';
import { addBladeLiveModifierForSourceMember } from '../../runtime/actions.js';
import {
  getAbilityEffectText,
  registerManualConfirmablePendingAbilityStarterHandler,
} from '../../runtime/workflow-helpers.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

interface MovedSideBladeConfig {
  readonly abilityId: string;
  readonly baseCardCodes: readonly string[];
  readonly requiredSourceSlots: readonly SlotPosition[];
  readonly sideLabel: string;
  readonly bladeAmount: number;
  readonly actionStep: string;
}

const MOVED_SIDE_BLADE_CONFIGS: readonly MovedSideBladeConfig[] = [
  {
    abilityId: SP_BP4_017_LIVE_START_LEFT_MOVED_GAIN_TWO_BLADE_ABILITY_ID,
    baseCardCodes: ['PL!SP-bp4-017'],
    requiredSourceSlots: [SlotPosition.LEFT],
    sideLabel: '左侧',
    bladeAmount: 2,
    actionStep: 'LEFT_MOVED_GAIN_TWO_BLADE',
  },
  {
    abilityId: SP_BP4_020_LIVE_START_RIGHT_MOVED_GAIN_TWO_BLADE_ABILITY_ID,
    baseCardCodes: ['PL!SP-bp4-020'],
    requiredSourceSlots: [SlotPosition.RIGHT],
    sideLabel: '右侧',
    bladeAmount: 2,
    actionStep: 'RIGHT_MOVED_GAIN_TWO_BLADE',
  },
];

export function registerSpBp4MovedSideBladeWorkflowHandlers(): void {
  for (const config of MOVED_SIDE_BLADE_CONFIGS) {
    registerManualConfirmablePendingAbilityStarterHandler(
      config.abilityId,
      (game, ability, options, context) =>
        resolveMovedSideBlade(
          game,
          ability,
          config,
          options.orderedResolution === true,
          context.continuePendingCardEffects
        ),
      (game, ability) => getMovedSideBladeConfirmationConfig(game, ability, config)
    );
  }
}

function getMovedSideBladeConfirmationConfig(
  game: GameState,
  ability: PendingAbilityState,
  config: MovedSideBladeConfig
): { readonly effectText: string } {
  const context = getMovedSideBladeContext(game, ability, config);
  return {
    effectText: `${getAbilityEffectText(config.abilityId)}（成员位于${config.sideLabel}：${context.sourceStillInRequiredSlot ? '是' : '否'}，本回合移动：${context.movedThisTurn ? '是' : '否'}，${context.conditionMet ? `满足条件，[BLADE]+${config.bladeAmount}` : '未满足条件'}）`,
  };
}

function resolveMovedSideBlade(
  game: GameState,
  ability: PendingAbilityState,
  config: MovedSideBladeConfig,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const { sourceSlot, sourceStillInRequiredSlot, movedThisTurn, conditionMet } =
    getMovedSideBladeContext(game, ability, config);
  const stateWithoutPending: GameState = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
  const bladeResult = conditionMet
    ? addBladeLiveModifierForSourceMember(stateWithoutPending, {
        playerId: player.id,
        sourceCardId: ability.sourceCardId,
        abilityId: ability.abilityId,
        amount: config.bladeAmount,
      })
    : null;
  const stateAfterModifier = bladeResult?.gameState ?? stateWithoutPending;
  const bladeBonus = bladeResult?.bladeBonus ?? 0;

  return continuePendingCardEffects(
    addAction(stateAfterModifier, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: config.actionStep,
      requiredSourceSlots: config.requiredSourceSlots,
      sourceSlot,
      movedThisTurn,
      conditionMet,
      bladeBonus,
    }),
    orderedResolution
  );
}

function getMovedSideBladeContext(
  game: GameState,
  ability: PendingAbilityState,
  config: MovedSideBladeConfig
): {
  readonly sourceSlot: SlotPosition | null;
  readonly sourceStillInRequiredSlot: boolean;
  readonly movedThisTurn: boolean;
  readonly conditionMet: boolean;
} {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return {
      sourceSlot: null,
      sourceStillInRequiredSlot: false,
      movedThisTurn: false,
      conditionMet: false,
    };
  }

  const sourceSlot = ability.sourceSlot ?? null;
  const sourceStillInRequiredSlot =
    sourceSlot !== null &&
    config.requiredSourceSlots.includes(sourceSlot) &&
    player.memberSlots.slots[sourceSlot] === ability.sourceCardId;
  const movedThisTurn = hasMemberPositionMovedThisTurn(game, player.id, ability.sourceCardId);
  return {
    sourceSlot,
    sourceStillInRequiredSlot,
    movedThisTurn,
    conditionMet: sourceStillInRequiredSlot && movedThisTurn,
  };
}
