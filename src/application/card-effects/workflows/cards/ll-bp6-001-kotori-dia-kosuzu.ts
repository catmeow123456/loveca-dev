import {
  isMemberCardData,
} from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { addHeartLiveModifierForMember } from '../../../../domain/rules/live-modifiers.js';
import {
  HeartColor,
  SlotPosition,
} from '../../../../shared/types/enums.js';
import { cardNameAliasAny } from '../../../effects/card-selectors.js';
import {
  LL_BP6_001_LIVE_START_DISCARD_NAMED_MEMBERS_GAIN_HEARTS_ABILITY_ID,
  LL_BP6_001_ON_ENTER_LOOK_TOP_SIX_TAKE_TWO_ABILITY_ID,
} from '../../ability-ids.js';
import {
  discardHandCardsToWaitingRoomAndEnqueueTriggers,
  type EnqueueTriggeredCardEffectsForEnterWaitingRoom,
} from '../../runtime/enter-waiting-room-triggers.js';
import { getSourceMemberSlot } from '../../runtime/source-member.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';
import {
  resolveLookTopSelectToHandSelection,
  startLookTopSelectToHandWorkflow,
} from '../shared/look-top-select-to-hand.js';

const LL_BP6_001_SELECT_TOP_TWO_STEP_ID = 'LL_BP6_001_SELECT_TOP_TWO_TO_HAND';
const LL_BP6_001_SELECT_NAMED_MEMBERS_STEP_ID = 'LL_BP6_001_SELECT_NAMED_MEMBERS';

const LL_BP6_001_NAMED_MEMBER_NAMES = ['南ことり', '黒澤ダイヤ', '徒町小鈴'] as const;

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerLlBp6001KotoriDiaKosuzuWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom;
}): void {
  registerPendingAbilityStarterHandler(
    LL_BP6_001_ON_ENTER_LOOK_TOP_SIX_TAKE_TWO_ABILITY_ID,
    (game, ability, options, context) =>
      startLookTopSelectToHandWorkflow(
        game,
        ability,
        {
          effectText: getAbilityEffectText(LL_BP6_001_ON_ENTER_LOOK_TOP_SIX_TAKE_TWO_ABILITY_ID),
          topCount: 6,
          selector: () => true,
          countRule: { exactCount: 2 },
          clampExactCountToInspectedCount: true,
          revealSelectedBeforeHand: false,
          selectStepId: LL_BP6_001_SELECT_TOP_TWO_STEP_ID,
          selectStepText: '请选择2张卡加入手牌。其余卡片放置入休息室。',
          noTargetStepText: '没有可加入手牌的卡。确认后继续。',
          selectionLabel: '选择要加入手牌的卡',
          confirmSelectionLabel: '加入手牌',
          finishActionStep: 'TAKE_TWO_REST_TO_WAITING_ROOM',
          includeInspectedCardIdsInFinishAction: true,
          enqueueWaitingRoomTriggersForRemainder: true,
        },
        {
          orderedResolution: options.orderedResolution === true,
          continuePendingCardEffects: context.continuePendingCardEffects,
          enqueueTriggeredCardEffects: deps.enqueueTriggeredCardEffects,
        }
      )
  );
  registerActiveEffectStepHandler(
    LL_BP6_001_ON_ENTER_LOOK_TOP_SIX_TAKE_TWO_ABILITY_ID,
    LL_BP6_001_SELECT_TOP_TWO_STEP_ID,
    (game, input, context) =>
      resolveLookTopSelectToHandSelection(
        game,
        input.selectedCardId ?? null,
        input.selectedCardIds,
        {
          continuePendingCardEffects: context.continuePendingCardEffects,
          enqueueTriggeredCardEffects: deps.enqueueTriggeredCardEffects,
        }
      )
  );

  registerPendingAbilityStarterHandler(
    LL_BP6_001_LIVE_START_DISCARD_NAMED_MEMBERS_GAIN_HEARTS_ABILITY_ID,
    (game, ability, options, context) =>
      startLlBp6001LiveStart(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    LL_BP6_001_LIVE_START_DISCARD_NAMED_MEMBERS_GAIN_HEARTS_ABILITY_ID,
    LL_BP6_001_SELECT_NAMED_MEMBERS_STEP_ID,
    (game, input, context) =>
      finishLlBp6001LiveStart(
        game,
        input.selectedCardIds,
        context.continuePendingCardEffects,
        deps.enqueueTriggeredCardEffects
      )
  );
}

function startLlBp6001LiveStart(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }
  const sourceSlot = getSourceMemberSlot(game, player.id, ability.sourceCardId);
  if (sourceSlot === null) {
    return finishPendingAbility(game, ability, player.id, orderedResolution, {
      step: 'SOURCE_NOT_ON_STAGE',
    }, continuePendingCardEffects);
  }

  const isNamedMember = cardNameAliasAny(LL_BP6_001_NAMED_MEMBER_NAMES);
  const selectableCardIds = player.hand.cardIds.filter((cardId) => {
    const card = getCardById(game, cardId);
    return card !== null && card.ownerId === player.id && isMemberCardData(card.data) && isNamedMember(card);
  });

  return addAction(
    {
      ...game,
      pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
      activeEffect: {
        id: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        controllerId: ability.controllerId,
        effectText: getAbilityEffectText(ability.abilityId),
        stepId: LL_BP6_001_SELECT_NAMED_MEMBERS_STEP_ID,
        stepText:
          '请选择任意数量的「南ことり」「黒澤ダイヤ」「徒町小鈴」放置入休息室。也可以不放置。',
        awaitingPlayerId: player.id,
        selectableCardIds,
        selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
        selectableCardMode: 'ORDERED_MULTI',
        minSelectableCards: 0,
        maxSelectableCards: selectableCardIds.length,
        selectionLabel: '选择要放置入休息室的指定成员',
        confirmSelectionLabel: '放置入休息室',
        canSkipSelection: true,
        skipSelectionLabel: '不放置',
        metadata: {
          orderedResolution,
          sourceSlot,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'START_SELECT_NAMED_MEMBERS',
      sourceSlot,
      selectableCardIds,
    }
  );
}

function finishLlBp6001LiveStart(
  game: GameState,
  selectedCardIds: readonly string[] | undefined,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom
): GameState {
  const effect = game.activeEffect;
  if (!effect || effect.stepId !== LL_BP6_001_SELECT_NAMED_MEMBERS_STEP_ID) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }
  if (getSourceMemberSlot(game, player.id, effect.sourceCardId) === null) {
    return continuePendingCardEffects(
      addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'SOURCE_NOT_ON_STAGE',
      }),
      effect.metadata?.orderedResolution === true
    );
  }

  const selectedIds = selectedCardIds ? [...selectedCardIds] : [];
  const uniqueSelectedIds = [...new Set(selectedIds)];
  if (
    uniqueSelectedIds.length !== selectedIds.length ||
    uniqueSelectedIds.some(
      (cardId) => !effect.selectableCardIds?.includes(cardId) || !player.hand.cardIds.includes(cardId)
    )
  ) {
    return game;
  }

  const discardResult = discardHandCardsToWaitingRoomAndEnqueueTriggers(
    game,
    player.id,
    uniqueSelectedIds,
    {
      count: uniqueSelectedIds.length,
      candidateCardIds: effect.selectableCardIds ?? [],
    },
    enqueueTriggeredCardEffects
  );
  if (!discardResult) {
    return game;
  }

  const heartColors = getUniquePrintedHeartColors(game, discardResult.discardedCardIds);
  let state: GameState = { ...discardResult.gameState, activeEffect: null };
  const heartBonus = heartColors.map((color) => ({ color, count: 1 }));
  if (heartBonus.length > 0) {
    const modifierResult = addHeartLiveModifierForMember(state, {
      playerId: player.id,
      memberCardId: effect.sourceCardId,
      sourceCardId: effect.sourceCardId,
      abilityId: effect.abilityId,
      hearts: heartBonus,
    });
    if (!modifierResult) {
      return game;
    }
    state = modifierResult.gameState;
  }

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step:
        uniqueSelectedIds.length > 0
          ? 'DISCARD_NAMED_MEMBERS_GAIN_HEARTS'
          : 'NO_DISCARD_NAMED_MEMBERS',
      discardedCardIds: discardResult.discardedCardIds,
      heartColors,
      heartBonus,
      enterWaitingRoomEventId: discardResult.enterWaitingRoomEvent?.eventId ?? null,
    }),
    effect.metadata?.orderedResolution === true
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

function getUniquePrintedHeartColors(
  game: GameState,
  cardIds: readonly string[]
): readonly HeartColor[] {
  const colors = new Set<HeartColor>();
  for (const cardId of cardIds) {
    const card = getCardById(game, cardId);
    if (!card || !isMemberCardData(card.data)) {
      continue;
    }
    for (const heart of card.data.hearts) {
      if (heart.count > 0) {
        colors.add(heart.color);
      }
    }
  }
  return [...colors];
}
