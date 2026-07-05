import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { CardType } from '../../../../shared/types/enums.js';
import { typeIs } from '../../../effects/card-selectors.js';
import { getStageMemberCardIdsMatching } from '../../../effects/stage-targets.js';
import { PL_PB1_010_LIVE_START_DISCARD_HAND_OTHER_MEMBERS_GAIN_BLADE_ABILITY_ID } from '../../ability-ids.js';
import {
  createOptionalDiscardHandToWaitingRoomActiveEffect,
  finishSkippedActiveEffect,
  startPendingActiveEffect,
} from '../../runtime/active-effect.js';
import { addBladeLiveModifierForSourceMember } from '../../runtime/actions.js';
import {
  discardOneHandCardToWaitingRoomAndEnqueueTriggers,
  type EnqueueTriggeredCardEffectsForEnterWaitingRoom,
} from '../../runtime/enter-waiting-room-triggers.js';
import { getSourceMemberSlot } from '../../runtime/source-member.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

const SELECT_DISCARD_STEP_ID = 'PL_PB1_010_SELECT_DISCARD_FOR_OTHER_MEMBERS_BLADE';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerPlPb1010HonokaWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom;
}): void {
  registerPendingAbilityStarterHandler(
    PL_PB1_010_LIVE_START_DISCARD_HAND_OTHER_MEMBERS_GAIN_BLADE_ABILITY_ID,
    (game, ability, options, context) =>
      startHonokaLiveStartDiscardForOtherMembersBlade(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    PL_PB1_010_LIVE_START_DISCARD_HAND_OTHER_MEMBERS_GAIN_BLADE_ABILITY_ID,
    SELECT_DISCARD_STEP_ID,
    (game, input, context) =>
      input.selectedCardId
        ? finishHonokaDiscardForOtherMembersBlade(
            game,
            input.selectedCardId,
            context.continuePendingCardEffects,
            deps.enqueueTriggeredCardEffects
          )
        : finishSkippedActiveEffect(game, context.continuePendingCardEffects, {
            step: 'DECLINE_DISCARD_HAND_CARD',
          })
  );
}

function startHonokaLiveStartDiscardForOtherMembersBlade(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  const sourceSlot = player ? getSourceMemberSlot(game, player.id, ability.sourceCardId) : null;
  if (!player || sourceSlot === null) {
    return consumeNoOp(game, ability, ability.controllerId, orderedResolution, continuePendingCardEffects, {
      step: 'SOURCE_NOT_ON_STAGE',
      sourceSlot,
    });
  }

  const otherStageMemberCardIds = getOtherStageMemberCardIds(game, player.id, ability.sourceCardId);
  if (player.hand.cardIds.length === 0) {
    return consumeNoOp(game, ability, player.id, orderedResolution, continuePendingCardEffects, {
      step: 'NO_HAND_TO_DISCARD',
      sourceSlot,
      otherStageMemberCount: otherStageMemberCardIds.length,
    });
  }
  if (otherStageMemberCardIds.length === 0) {
    return consumeNoOp(game, ability, player.id, orderedResolution, continuePendingCardEffects, {
      step: 'NO_OTHER_STAGE_MEMBER',
      sourceSlot,
      handCount: player.hand.cardIds.length,
    });
  }

  const effectText = `${getAbilityEffectText(
    PL_PB1_010_LIVE_START_DISCARD_HAND_OTHER_MEMBERS_GAIN_BLADE_ABILITY_ID
  )}（当前手牌 ${player.hand.cardIds.length}张，其他舞台成员 ${otherStageMemberCardIds.length}名；弃置1张后各获得[BLADE]+1。）`;

  return startPendingActiveEffect(game, {
    ability,
    playerId: player.id,
    activeEffect: createOptionalDiscardHandToWaitingRoomActiveEffect({
      ability,
      playerId: player.id,
      effectText,
      stepId: SELECT_DISCARD_STEP_ID,
      selectableCardIds: player.hand.cardIds,
      orderedResolution,
      stepText: `请选择1张手牌放置入休息室。支付后，当前其他舞台成员 ${otherStageMemberCardIds.length}名各获得[BLADE]+1。也可以选择不发动。`,
      selectionLabel: '选择要放置入休息室的手牌',
      skipSelectionLabel: '不发动',
      metadata: {
        sourceSlot,
        previewTargetMemberCardIds: otherStageMemberCardIds,
      },
    }),
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      sourceSlot,
      step: 'START_SELECT_DISCARD_FOR_OTHER_MEMBERS_BLADE',
      selectableCardIds: player.hand.cardIds,
      previewTargetMemberCardIds: otherStageMemberCardIds,
    },
  });
}

function finishHonokaDiscardForOtherMembersBlade(
  game: GameState,
  discardCardId: string,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== PL_PB1_010_LIVE_START_DISCARD_HAND_OTHER_MEMBERS_GAIN_BLADE_ABILITY_ID ||
    effect.stepId !== SELECT_DISCARD_STEP_ID ||
    effect.selectableCardIds?.includes(discardCardId) !== true
  ) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (!player || !player.hand.cardIds.includes(discardCardId)) {
    return game;
  }

  const discardResult = discardOneHandCardToWaitingRoomAndEnqueueTriggers(
    game,
    player.id,
    discardCardId,
    {
      candidateCardIds: effect.selectableCardIds ?? [],
    },
    enqueueTriggeredCardEffects
  );
  if (!discardResult) {
    return game;
  }

  const sourceSlot = getSourceMemberSlot(discardResult.gameState, player.id, effect.sourceCardId);
  const targetMemberCardIds =
    sourceSlot === null
      ? []
      : getOtherStageMemberCardIds(discardResult.gameState, player.id, effect.sourceCardId);
  let state = discardResult.gameState;
  const appliedTargetMemberCardIds: string[] = [];

  for (const targetMemberCardId of targetMemberCardIds) {
    const bladeResult = addBladeLiveModifierForSourceMember(state, {
      playerId: player.id,
      sourceCardId: targetMemberCardId,
      abilityId: effect.abilityId,
      amount: 1,
    });
    if (!bladeResult) {
      continue;
    }
    state = bladeResult.gameState;
    appliedTargetMemberCardIds.push(targetMemberCardId);
  }

  return continuePendingCardEffects(
    addAction({ ...state, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step:
        appliedTargetMemberCardIds.length > 0
          ? 'DISCARD_HAND_OTHER_MEMBERS_GAIN_BLADE'
          : 'DISCARD_HAND_NO_TARGET_AFTER_PAYMENT',
      sourceSlot,
      discardedCardId: discardResult.discardedCardIds[0],
      targetMemberCardIds,
      appliedTargetMemberCardIds,
      bladeBonusPerMember: 1,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function consumeNoOp(
  game: GameState,
  ability: PendingAbilityState,
  playerId: string,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  payload: Readonly<Record<string, unknown>>
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

function getOtherStageMemberCardIds(
  game: GameState,
  playerId: string,
  sourceCardId: string
): readonly string[] {
  return getStageMemberCardIdsMatching(game, playerId, typeIs(CardType.MEMBER)).filter(
    (cardId) => cardId !== sourceCardId
  );
}
