import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { CardType, HeartColor } from '../../../../shared/types/enums.js';
import {
  and,
  cardNameAliasAny,
  groupAliasIs,
  typeIs,
} from '../../../effects/card-selectors.js';
import { getStageMemberCardIdsMatching } from '../../../effects/stage-targets.js';
import {
  SP_BP4_023_LIVE_START_CHEER_HEART_COLORS_TO_PURPLE_ABILITY_ID,
  SP_BP4_023_LIVE_START_SELECT_NAMED_AND_OTHER_LIELLA_GAIN_BLADE_ABILITY_ID,
} from '../../ability-ids.js';
import { addBladeLiveModifierForSourceMember } from '../../runtime/actions.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  getAbilityEffectText,
  maybeStartConfirmablePendingAbilityConfirmation,
} from '../../runtime/workflow-helpers.js';
import { registerCheerCardHeartColorReplacementWorkflowHandlers } from '../shared/cheer-card-heart-color-replacement.js';

const SELECT_NAMED_MEMBER_STEP_ID = 'SP_BP4_023_SELECT_NAMED_MEMBER_GAIN_BLADE';
const SELECT_OTHER_LIELLA_MEMBER_STEP_ID = 'SP_BP4_023_SELECT_OTHER_LIELLA_MEMBER_GAIN_BLADE';
const NAMED_MEMBER_NAMES = [
  '澁谷かのん',
  '涩谷香音',
  'ウィーン・マルガレーテ',
  '薇恩・玛格丽特',
  '鬼塚冬毬',
  '鬼冢冬毬',
] as const;
const NAMED_MEMBER_DISPLAY_TEXT = '「涩谷香音」「薇恩・玛格丽特」「鬼冢冬毬」';
const HEART_REPLACEMENT_FROM_COLORS = [
  HeartColor.PINK,
  HeartColor.RED,
  HeartColor.YELLOW,
  HeartColor.GREEN,
  HeartColor.BLUE,
  HeartColor.RAINBOW,
] as const;

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

const namedMemberSelector = and(typeIs(CardType.MEMBER), cardNameAliasAny(NAMED_MEMBER_NAMES));
const liellaMemberSelector = and(typeIs(CardType.MEMBER), groupAliasIs('Liella!'));

export function registerSpBp4023DazzlingGameWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    SP_BP4_023_LIVE_START_SELECT_NAMED_AND_OTHER_LIELLA_GAIN_BLADE_ABILITY_ID,
    (game, ability, options, context) =>
      startSelectNamedAndOtherLiellaBlade(
        game,
        ability,
        options,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    SP_BP4_023_LIVE_START_SELECT_NAMED_AND_OTHER_LIELLA_GAIN_BLADE_ABILITY_ID,
    SELECT_NAMED_MEMBER_STEP_ID,
    (game, input) => finishSelectNamedMember(game, input.selectedCardId ?? null)
  );
  registerActiveEffectStepHandler(
    SP_BP4_023_LIVE_START_SELECT_NAMED_AND_OTHER_LIELLA_GAIN_BLADE_ABILITY_ID,
    SELECT_OTHER_LIELLA_MEMBER_STEP_ID,
    (game, input, context) =>
      finishSelectOtherLiellaMember(
        game,
        input.selectedCardId ?? null,
        context.continuePendingCardEffects
      )
  );
  registerCheerCardHeartColorReplacementWorkflowHandlers([
    {
      abilityId: SP_BP4_023_LIVE_START_CHEER_HEART_COLORS_TO_PURPLE_ABILITY_ID,
      fromColors: HEART_REPLACEMENT_FROM_COLORS,
      toColor: HeartColor.PURPLE,
      actionStep: 'CHEER_HEART_COLORS_TO_PURPLE',
      getConfirmationEffectText: (_game, ability, _context) =>
        getAbilityEffectText(ability.abilityId),
      getConfirmationStepText: () => '确认后结算此效果。',
    },
  ]);
}

function startSelectNamedAndOtherLiellaBlade(
  game: GameState,
  ability: PendingAbilityState,
  options: {
    readonly orderedResolution?: boolean;
    readonly manualConfirmation?: boolean;
    readonly confirmBeforeResolution?: boolean;
    readonly skipManualConfirmation?: boolean;
  },
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const context = getBladeSelectionContext(game, ability);
  if (!context.sourceInLiveZone || context.selectableNamedMemberCardIds.length === 0) {
    const confirmation = maybeStartConfirmablePendingAbilityConfirmation(game, ability, options, {
      effectText: getBladeNoOpConfirmationText(context),
      stepText: '确认后，此效果不会使成员获得[BLADE]。',
    });
    if (confirmation) {
      return confirmation;
    }

    return resolveBladeNoOp(
      game,
      ability,
      options.orderedResolution === true,
      continuePendingCardEffects,
      context
    );
  }

  return addAction(
    {
      ...consumePendingAbility(game, ability.id),
      activeEffect: {
        id: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        controllerId: ability.controllerId,
        effectText: getAbilityEffectText(ability.abilityId),
        stepId: SELECT_NAMED_MEMBER_STEP_ID,
        stepText: `请选择自己舞台上1名${NAMED_MEMBER_DISPLAY_TEXT}获得[BLADE]。`,
        awaitingPlayerId: player.id,
        selectableCardIds: context.selectableNamedMemberCardIds,
        selectableCardVisibility: 'PUBLIC',
        selectableCardMode: 'SINGLE',
        selectionLabel: '选择获得[BLADE]的指定成员',
        confirmSelectionLabel: '选择成员',
        canSkipSelection: false,
        metadata: {
          orderedResolution: options.orderedResolution === true,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'START_SELECT_NAMED_MEMBER_GAIN_BLADE',
      namedMemberCount: context.namedMemberCardIds.length,
      otherLiellaCandidateCount: context.maxOtherLiellaCandidateCount,
      selectableCardIds: context.selectableNamedMemberCardIds,
    }
  );
}

function finishSelectNamedMember(game: GameState, selectedCardId: string | null): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !==
      SP_BP4_023_LIVE_START_SELECT_NAMED_AND_OTHER_LIELLA_GAIN_BLADE_ABILITY_ID ||
    effect.stepId !== SELECT_NAMED_MEMBER_STEP_ID ||
    selectedCardId === null ||
    effect.selectableCardIds?.includes(selectedCardId) !== true
  ) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (!player || !getSelectableNamedMemberCardIds(game, player.id).includes(selectedCardId)) {
    return game;
  }

  const otherLiellaMemberCardIds = getOtherLiellaMemberCardIds(game, player.id, selectedCardId);
  if (otherLiellaMemberCardIds.length === 0) {
    return addAction(
      {
        ...game,
        activeEffect: {
          ...effect,
          stepId: SELECT_OTHER_LIELLA_MEMBER_STEP_ID,
          stepText: '没有可选择的另一名『Liella!』成员。确认后不会获得[BLADE]。',
          selectableCardIds: [],
          selectableCardVisibility: 'PUBLIC',
          selectableCardMode: 'SINGLE',
          selectionLabel: '无可选目标',
          confirmSelectionLabel: '确认',
          canSkipSelection: false,
          metadata: {
            ...effect.metadata,
            selectedNamedMemberCardId: selectedCardId,
          },
        },
      },
      'RESOLVE_ABILITY',
      player.id,
      {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'SELECT_NAMED_MEMBER_NO_OTHER_LIELLA_TARGET',
        selectedNamedMemberCardId: selectedCardId,
        otherLiellaCandidateCount: 0,
      }
    );
  }

  return addAction(
    {
      ...game,
      activeEffect: {
        ...effect,
        stepId: SELECT_OTHER_LIELLA_MEMBER_STEP_ID,
        stepText: '请选择自己舞台上另1名不同卡牌的『Liella!』成员获得[BLADE]。',
        selectableCardIds: otherLiellaMemberCardIds,
        selectableCardVisibility: 'PUBLIC',
        selectableCardMode: 'SINGLE',
        selectionLabel: '选择另1名『Liella!』成员',
        confirmSelectionLabel: '获得[BLADE]',
        canSkipSelection: false,
        metadata: {
          ...effect.metadata,
          selectedNamedMemberCardId: selectedCardId,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'SELECT_NAMED_MEMBER_GAIN_BLADE',
      selectedNamedMemberCardId: selectedCardId,
      selectableCardIds: otherLiellaMemberCardIds,
    }
  );
}

function finishSelectOtherLiellaMember(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !==
      SP_BP4_023_LIVE_START_SELECT_NAMED_AND_OTHER_LIELLA_GAIN_BLADE_ABILITY_ID ||
    effect.stepId !== SELECT_OTHER_LIELLA_MEMBER_STEP_ID
  ) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  const namedMemberCardId = getStringMetadata(effect.metadata, 'selectedNamedMemberCardId');
  if (!player || namedMemberCardId === null) {
    return game;
  }

  const orderedResolution = effect.metadata?.orderedResolution === true;
  const sourceInLiveZone = player.liveZone.cardIds.includes(effect.sourceCardId);
  const currentOtherTargets = getOtherLiellaMemberCardIds(game, player.id, namedMemberCardId);
  if (
    !sourceInLiveZone ||
    selectedCardId === null ||
    effect.selectableCardIds?.includes(selectedCardId) !== true ||
    !currentOtherTargets.includes(selectedCardId)
  ) {
    return continuePendingCardEffects(
      addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'SELECT_NAMED_AND_OTHER_LIELLA_GAIN_BLADE_NO_OP',
        sourceInLiveZone,
        selectedNamedMemberCardId: namedMemberCardId,
        selectedOtherMemberCardId: selectedCardId,
        otherLiellaCandidateCount: currentOtherTargets.length,
        bladeBonus: 0,
      }),
      orderedResolution
    );
  }

  const namedBladeResult = addBladeLiveModifierForSourceMember(game, {
    playerId: player.id,
    sourceCardId: namedMemberCardId,
    abilityId: effect.abilityId,
    amount: 1,
  });
  const otherBladeResult = namedBladeResult
    ? addBladeLiveModifierForSourceMember(namedBladeResult.gameState, {
        playerId: player.id,
        sourceCardId: selectedCardId,
        abilityId: effect.abilityId,
        amount: 1,
      })
    : null;
  if (!namedBladeResult || !otherBladeResult) {
    return game;
  }

  return continuePendingCardEffects(
    addAction({ ...otherBladeResult.gameState, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'SELECT_NAMED_AND_OTHER_LIELLA_GAIN_BLADE',
      selectedNamedMemberCardId: namedMemberCardId,
      selectedOtherMemberCardId: selectedCardId,
      targetMemberCardIds: [namedMemberCardId, selectedCardId],
      bladeBonus: 1,
    }),
    orderedResolution
  );
}

function resolveBladeNoOp(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  context: BladeSelectionContext
): GameState {
  const stateWithoutPending = consumePendingAbility(game, ability.id);
  return continuePendingCardEffects(
    addAction(stateWithoutPending, 'RESOLVE_ABILITY', ability.controllerId, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'SELECT_NAMED_AND_OTHER_LIELLA_GAIN_BLADE_NO_TARGET',
      sourceInLiveZone: context.sourceInLiveZone,
      namedMemberCount: context.namedMemberCardIds.length,
      otherLiellaCandidateCount: context.maxOtherLiellaCandidateCount,
      willGainBlade: false,
      bladeBonus: 0,
    }),
    orderedResolution
  );
}

interface BladeSelectionContext {
  readonly sourceInLiveZone: boolean;
  readonly namedMemberCardIds: readonly string[];
  readonly selectableNamedMemberCardIds: readonly string[];
  readonly maxOtherLiellaCandidateCount: number;
}

function getBladeSelectionContext(
  game: GameState,
  ability: Pick<PendingAbilityState, 'controllerId' | 'sourceCardId'>
): BladeSelectionContext {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return {
      sourceInLiveZone: false,
      namedMemberCardIds: [],
      selectableNamedMemberCardIds: [],
      maxOtherLiellaCandidateCount: 0,
    };
  }

  const namedMemberCardIds = getNamedMemberCardIds(game, player.id);
  const selectableNamedMemberCardIds = getSelectableNamedMemberCardIds(game, player.id);
  const maxOtherLiellaCandidateCount = namedMemberCardIds.reduce(
    (maxCount, cardId) =>
      Math.max(maxCount, getOtherLiellaMemberCardIds(game, player.id, cardId).length),
    0
  );

  return {
    sourceInLiveZone: player.liveZone.cardIds.includes(ability.sourceCardId),
    namedMemberCardIds,
    selectableNamedMemberCardIds,
    maxOtherLiellaCandidateCount,
  };
}

function getNamedMemberCardIds(game: GameState, playerId: string): readonly string[] {
  return getStageMemberCardIdsMatching(game, playerId, namedMemberSelector);
}

function getSelectableNamedMemberCardIds(game: GameState, playerId: string): readonly string[] {
  return getNamedMemberCardIds(game, playerId).filter(
    (cardId) => getOtherLiellaMemberCardIds(game, playerId, cardId).length > 0
  );
}

function getOtherLiellaMemberCardIds(
  game: GameState,
  playerId: string,
  selectedNamedMemberCardId: string
): readonly string[] {
  return getStageMemberCardIdsMatching(game, playerId, liellaMemberSelector).filter(
    (cardId) => cardId !== selectedNamedMemberCardId
  );
}

function getBladeNoOpConfirmationText(context: BladeSelectionContext): string {
  return `${getAbilityEffectText(
    SP_BP4_023_LIVE_START_SELECT_NAMED_AND_OTHER_LIELLA_GAIN_BLADE_ABILITY_ID
  )}（当前指定成员 ${context.namedMemberCardIds.length}名，其他『Liella!』候选 ${context.maxOtherLiellaCandidateCount}名，${
    context.sourceInLiveZone && context.selectableNamedMemberCardIds.length > 0
      ? '确认后可选择成员获得[BLADE]'
      : '确认后不会获得[BLADE]'
  }。）`;
}

function consumePendingAbility(game: GameState, pendingAbilityId: string): GameState {
  return {
    ...game,
    pendingAbilities: game.pendingAbilities.filter(
      (candidate) => candidate.id !== pendingAbilityId
    ),
  };
}

function getStringMetadata(
  metadata: Readonly<Record<string, unknown>> | undefined,
  key: string
): string | null {
  const value = metadata?.[key];
  return typeof value === 'string' ? value : null;
}
