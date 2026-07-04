import { type CardInstance } from '../../../../domain/entities/card.js';
import { type GameState, type PendingAbilityState } from '../../../../domain/entities/game.js';
import { ZoneType } from '../../../../shared/types/enums.js';
import { S_BP6_016_ON_ENTER_FROM_WAITING_LOOK_TOP_THREE_TAKE_ONE_ABILITY_ID } from '../../ability-ids.js';
import { type EnqueueTriggeredCardEffectsForEnterWaitingRoom } from '../../runtime/enter-waiting-room-triggers.js';
import {
  consumeOnEnterSourceZoneMismatch,
  isOnEnterFromWaitingRoom,
} from '../../runtime/on-enter-source-zone.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';
import {
  finishRevealedLookTopSelectToHandWorkflow,
  resolveLookTopSelectToHandSelection,
  startLookTopSelectToHandWorkflow,
} from '../shared/look-top-select-to-hand.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

const S_BP6_016_SELECT_CARD_STEP_ID = 'S_BP6_016_SELECT_CARD_FROM_TOP_THREE';

export function registerSBp6016HanamaruWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom;
}): void {
  registerPendingAbilityStarterHandler(
    S_BP6_016_ON_ENTER_FROM_WAITING_LOOK_TOP_THREE_TAKE_ONE_ABILITY_ID,
    (game, ability, options, context) =>
      startSBp6016HanamaruWorkflow(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects,
        deps.enqueueTriggeredCardEffects
      )
  );
  registerActiveEffectStepHandler(
    S_BP6_016_ON_ENTER_FROM_WAITING_LOOK_TOP_THREE_TAKE_ONE_ABILITY_ID,
    S_BP6_016_SELECT_CARD_STEP_ID,
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
}

function startSBp6016HanamaruWorkflow(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom
): GameState {
  if (!isOnEnterFromWaitingRoom(ability)) {
    return consumeOnEnterSourceZoneMismatch(game, ability, {
      expectedFromZone: ZoneType.WAITING_ROOM,
      orderedResolution,
      continuePendingCardEffects,
    });
  }

  return startLookTopSelectToHandWorkflow(
    game,
    ability,
    {
      effectText: getAbilityEffectText(ability.abilityId),
      topCount: 3,
      selector: (_card: CardInstance) => true,
      countRule: { exactCount: 1 },
      revealSelectedBeforeHand: false,
      selectStepId: S_BP6_016_SELECT_CARD_STEP_ID,
      selectStepText: '请选择1张查看到的卡加入手牌。其余卡片放置入休息室。',
      noTargetStepText: '没有可查看的卡。确认后继续。',
      selectionLabel: '选择要加入手牌的卡',
      confirmSelectionLabel: '加入手牌',
      startActionStep: 'START_LOOK_TOP_THREE',
      finishActionStep: 'TAKE_ONE_REST_TO_WAITING_ROOM',
      clampExactCountToInspectedCount: true,
      publicEffectSummaryContext: {
        effectKind: 'DISCARD_LOOK_TOP_SELECT_TO_HAND',
        sourceActionLabel: '登场',
        inspectSourceZone: ZoneType.MAIN_DECK,
        requestedInspectCount: 3,
      },
    },
    {
      orderedResolution,
      continuePendingCardEffects,
      enqueueTriggeredCardEffects,
    }
  );
}
