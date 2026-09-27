import { z } from 'zod';
import { GameCommandType as T, type GameCommand } from '../../application/game-commands.js';
import { SlotPosition, SubPhase } from '../../shared/types/enums.js';
import { CARD_DEFINED_SPECIAL_MEMBER_PLAY_MODES } from '../../shared/rules/member-play-options.js';
import { AiBattleSetupError } from './presets.js';

const id = z.string().min(1).max(500);
const base = z.object({
  playerId: z.string().optional(),
  timestamp: z.number().finite().optional(),
  idempotencyKey: id.optional(),
});
const schema = z.discriminatedUnion('type', [
  base.extend({ type: z.literal(T.MULLIGAN), cardIdsToMulligan: z.array(id) }).strict(),
  base
    .extend({
      type: z.literal(T.BEGIN_SPECIAL_MEMBER_PLAY),
      cardId: id,
      targetSlot: z.enum(SlotPosition),
      mode: z.enum(CARD_DEFINED_SPECIAL_MEMBER_PLAY_MODES),
    })
    .strict(),
  base
    .extend({
      type: z.literal(T.CONFIRM_SPECIAL_MEMBER_PLAY),
      pendingId: id,
      selectedCardIds: z.array(id),
    })
    .strict(),
  base.extend({ type: z.literal(T.CANCEL_SPECIAL_MEMBER_PLAY), pendingId: id }).strict(),
  base
    .extend({
      type: z.literal(T.PLAY_MEMBER_TO_SLOT),
      cardId: id,
      targetSlot: z.enum(SlotPosition),
      freePlay: z.literal(false).optional(),
      relayMode: z.literal('SINGLE').optional(),
      relayReplacementSlots: z.array(z.enum(SlotPosition)).optional(),
    })
    .strict(),
  base
    .extend({
      type: z.literal(T.ACTIVATE_ABILITY),
      cardId: id,
      abilityId: id,
      abilityInstanceId: id.optional(),
    })
    .strict(),
  base.extend({ type: z.literal(T.SET_LIVE_CARD), cardId: id, faceDown: z.boolean() }).strict(),
  base.extend({ type: z.literal(T.UNSET_LIVE_CARD), cardId: id }).strict(),
  base.extend({ type: z.literal(T.END_PHASE) }).strict(),
  base
    .extend({
      type: z.literal(T.CONFIRM_STEP),
      subPhase: z.enum(SubPhase),
      skipSuccessLiveSelection: z.literal(false).optional(),
    })
    .strict(),
  base
    .extend({
      type: z.literal(T.CONFIRM_EFFECT_STEP),
      effectId: id,
      publicCardSelectionAutoAdvanceAt: z.number().finite().optional(),
      publicEffectChoiceAutoAdvanceAt: z.number().finite().optional(),
      publicRevealAutoAdvanceAt: z.number().finite().optional(),
      publicRevealGeneration: id.optional(),
      selectedCardId: id.nullable().optional(),
      selectedCardIds: z.array(id).optional(),
      selectedSlot: z.enum(SlotPosition).nullable().optional(),
      resolveInOrder: z.boolean().optional(),
      selectedOptionId: id.nullable().optional(),
      selectedEffectOptionIds: z.array(id).optional(),
      selectedNumber: z.number().int().nullable().optional(),
    })
    .strict(),
  base
    .extend({ type: z.literal(T.SUBMIT_JUDGMENT), judgmentResults: z.map(id, z.boolean()) })
    .strict(),
  base
    .extend({ type: z.literal(T.SUBMIT_SCORE), adjustedScore: z.number().int().optional() })
    .strict(),
  base.extend({ type: z.literal(T.SELECT_SUCCESS_LIVE), cardId: id }).strict(),
  base.extend({ type: z.literal(T.SURRENDER) }).strict(),
]);

/** Structural HTTP validation for the supported curated RULES pool; legality remains authoritative. */
export function parseAiHumanCommand(value: unknown): GameCommand {
  const parsed = schema.safeParse(value);
  if (!parsed.success)
    throw new AiBattleSetupError(
      'INVALID_REQUEST',
      '命令参数非法或不属于当前精选构筑的规则操作',
      400
    );
  // The authenticated owner and the server clock replace these placeholders in the service.
  return { ...parsed.data, playerId: '', timestamp: 0 };
}
