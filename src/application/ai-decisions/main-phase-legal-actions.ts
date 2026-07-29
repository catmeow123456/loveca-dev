import { isMemberCardData } from '../../domain/entities/card.js';
import { getCardById, getPlayerById, type GameState } from '../../domain/entities/game.js';
import { costCalculator, type CostPaymentPlan } from '../../domain/rules/cost-calculator.js';
import { SlotPosition } from '../../shared/types/enums.js';
import type { CardDefinedSpecialMemberPlayMode } from '../../shared/rules/member-play-options.js';
import {
  CardAbilitySourceZone,
  type ActivatedAbilityUiConfig,
} from '../card-effects/ability-definition-types.js';
import { canUseActivatedAbilityThisTurn } from '../card-effects/runtime/ability-turn-limit.js';
import { getActivatedAbilityUiConfigs } from '../card-effects/runtime/activated-ability-ui.js';
import { queryActivatedAbilityPreflight } from '../card-effects/runtime/activated-registry.js';
import { buildPlayMemberCostResources } from '../effects/play-member-cost.js';
import { getMemberPlayOptionsForHandCard } from '../member-play-options.js';

const MEMBER_SLOTS = [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT] as const;

export interface AiLegalPlayMemberAction {
  readonly kind: 'PLAY_MEMBER';
  readonly sourceCardId: string;
  readonly targetSlot: SlotPosition;
  readonly relayMode?: 'DOUBLE';
  readonly relayReplacementSlots?: readonly SlotPosition[];
  readonly paymentPreview: {
    readonly modifiedCost: number;
    readonly energyCost: number;
    readonly relayDiscount: number;
    readonly replacementCount: number;
  };
}

export interface AiLegalBeginSpecialMemberPlayAction {
  readonly kind: 'BEGIN_SPECIAL_MEMBER_PLAY';
  readonly sourceCardId: string;
  readonly targetSlot: SlotPosition;
  readonly mode: CardDefinedSpecialMemberPlayMode;
  readonly label: string;
}

export interface AiLegalActivateAbilityAction {
  readonly kind: 'ACTIVATE_ABILITY';
  readonly sourceCardId: string;
  readonly abilityId: string;
  readonly label: string;
}

export type AiLegalMainPhaseAction =
  AiLegalPlayMemberAction | AiLegalBeginSpecialMemberPlayAction | AiLegalActivateAbilityAction;

export interface AiUnqueriedActivatedAbility {
  readonly sourceCardId: string;
  readonly abilityId: string;
  readonly label: string;
}

export interface AiMainPhaseLegalActionQuery {
  readonly actions: readonly AiLegalMainPhaseAction[];
  readonly unqueriedActivatedAbilities: readonly AiUnqueriedActivatedAbility[];
}

/**
 * Collects main-phase actions whose legality is fully queryable without
 * speculatively running a command or resolver.
 */
export function collectAiMainPhaseLegalActions(
  game: GameState,
  playerId: string
): AiMainPhaseLegalActionQuery {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return { actions: [], unqueriedActivatedAbilities: [] };
  }

  const actions = player.hand.cardIds.flatMap((cardId) => {
    const card = getCardById(game, cardId);
    const resources = buildPlayMemberCostResources(game, playerId, cardId, player.hand.cardIds);
    if (!card || !isMemberCardData(card.data) || !resources) {
      return [];
    }
    const memberData = card.data;

    const normalActions = MEMBER_SLOTS.flatMap((targetSlot) => {
      if (
        !costCalculator.canPlayInSlot(
          targetSlot,
          player.movedToStageThisTurn,
          resources.stageMembers
        )
      ) {
        return [];
      }
      const plan = costCalculator.selectOptimalPlan(
        costCalculator.checkCanPayCost(memberData, targetSlot, resources).availablePlans
      );
      return plan ? [toPlayMemberAction(cardId, targetSlot, plan)] : [];
    });

    const optionActions = getMemberPlayOptionsForHandCard(game, playerId, cardId).flatMap(
      (option): readonly AiLegalMainPhaseAction[] => {
        if (option.kind === 'CARD_DEFINED' && option.mode) {
          return option.targetSlots.map((targetSlot) => ({
            kind: 'BEGIN_SPECIAL_MEMBER_PLAY',
            sourceCardId: cardId,
            targetSlot,
            mode: option.mode!,
            label: option.label,
          }));
        }
        if (option.kind !== 'DOUBLE_RELAY') {
          return [];
        }
        return option.targetSlots.flatMap((targetSlot) =>
          option.targetSlots.flatMap((additionalSlot) => {
            if (targetSlot === additionalSlot) return [];
            const relayReplacementSlots = [targetSlot, additionalSlot] as const;
            const plan = costCalculator.selectOptimalPlan(
              costCalculator.checkCanPayCost(memberData, targetSlot, resources, {
                relayMode: 'DOUBLE',
                relayReplacementSlots,
              }).availablePlans
            );
            return plan
              ? [
                  toPlayMemberAction(cardId, targetSlot, plan, {
                    relayMode: 'DOUBLE',
                    relayReplacementSlots,
                  }),
                ]
              : [];
          })
        );
      }
    );
    return [...normalActions, ...optionActions];
  });

  const activated = collectActivatedAbilityActions(game, playerId);
  return {
    actions: [...actions, ...activated.actions],
    unqueriedActivatedAbilities: activated.unqueried,
  };
}

function toPlayMemberAction(
  sourceCardId: string,
  targetSlot: SlotPosition,
  plan: CostPaymentPlan,
  relay?: {
    readonly relayMode: 'DOUBLE';
    readonly relayReplacementSlots: readonly SlotPosition[];
  }
): AiLegalPlayMemberAction {
  return {
    kind: 'PLAY_MEMBER',
    sourceCardId,
    targetSlot,
    ...relay,
    paymentPreview: {
      modifiedCost: plan.modifiedCost,
      energyCost: plan.actualEnergyCost,
      relayDiscount: plan.relayDiscount,
      replacementCount: plan.relayReplacements.length,
    },
  };
}

function collectActivatedAbilityActions(
  game: GameState,
  playerId: string
): {
  readonly actions: readonly AiLegalActivateAbilityAction[];
  readonly unqueried: readonly AiUnqueriedActivatedAbility[];
} {
  const player = getPlayerById(game, playerId);
  if (!player) return { actions: [], unqueried: [] };

  const sources = [
    ...MEMBER_SLOTS.flatMap((slot) => {
      const cardId = player.memberSlots.slots[slot];
      return cardId ? [{ cardId, sourceZone: CardAbilitySourceZone.STAGE_MEMBER } as const] : [];
    }),
    ...player.hand.cardIds.map(
      (cardId) => ({ cardId, sourceZone: CardAbilitySourceZone.HAND }) as const
    ),
    ...player.waitingRoom.cardIds.map(
      (cardId) => ({ cardId, sourceZone: CardAbilitySourceZone.WAITING_ROOM }) as const
    ),
  ];

  const actions: AiLegalActivateAbilityAction[] = [];
  const unqueried: AiUnqueriedActivatedAbility[] = [];
  for (const { cardId, sourceZone } of sources) {
    const card = getCardById(game, cardId);
    if (!card || !isMemberCardData(card.data)) continue;
    const configs = getActivatedAbilityUiConfigs(card.data.cardCode, sourceZone, {
      game,
      playerId,
      sourceCardId: cardId,
    });
    for (const config of configs) {
      if (!canUseActivatedAbilityThisTurn(game, playerId, config.abilityId, cardId)) {
        continue;
      }
      const preflight = queryActivatedAbilityPreflight(game, playerId, cardId, config.abilityId);
      const action = toActivatedAbilityAction(cardId, config);
      if (preflight.status === 'UNREGISTERED') {
        unqueried.push(action);
      } else if (preflight.available) {
        actions.push(action);
      }
    }
  }
  return { actions, unqueried };
}

function toActivatedAbilityAction(
  sourceCardId: string,
  config: ActivatedAbilityUiConfig
): AiLegalActivateAbilityAction {
  return {
    kind: 'ACTIVATE_ABILITY',
    sourceCardId,
    abilityId: config.abilityId,
    label: config.text,
  };
}
