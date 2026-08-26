import { z } from 'zod';
import { GameCommandType, type GameCommand } from '../../application/game-commands.js';
import { SlotPosition, SubPhase } from '../../shared/types/enums.js';
import { fromTransport } from '../../online/serde.js';
import {
  MAX_TUTORIAL_IDEMPOTENCY_KEY_LENGTH,
  TutorialSessionServiceError,
} from './tutorial-session-service.js';

const MAX_IDENTIFIER_LENGTH = 256;
const MAX_SELECTION_SIZE = 64;

const identifierSchema = z.string().min(1).max(MAX_IDENTIFIER_LENGTH);
const nullableIdentifierSchema = identifierSchema.nullable().optional();
const timestampSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const idempotencyKeySchema = z.string().min(1).max(MAX_TUTORIAL_IDEMPOTENCY_KEY_LENGTH).optional();
const slotSchema = z.nativeEnum(SlotPosition);
const subPhaseSchema = z.nativeEnum(SubPhase);
const identifierListSchema = z.array(identifierSchema).max(MAX_SELECTION_SIZE);

const baseCommandShape = {
  playerId: identifierSchema,
  timestamp: timestampSchema,
  idempotencyKey: idempotencyKeySchema,
};

const tutorialCommandSchema = z.discriminatedUnion('type', [
  z.strictObject({
    ...baseCommandShape,
    type: z.literal(GameCommandType.MULLIGAN),
    cardIdsToMulligan: identifierListSchema,
  }),
  z.strictObject({
    ...baseCommandShape,
    type: z.literal(GameCommandType.PLAY_MEMBER_TO_SLOT),
    cardId: identifierSchema,
    targetSlot: slotSchema,
    freePlay: z.boolean().optional(),
    relayMode: z.enum(['SINGLE', 'DOUBLE']).optional(),
    relayReplacementSlots: z.array(slotSchema).max(2).optional(),
  }),
  z.strictObject({
    ...baseCommandShape,
    type: z.literal(GameCommandType.END_PHASE),
  }),
  z.strictObject({
    ...baseCommandShape,
    type: z.literal(GameCommandType.SET_LIVE_CARD),
    cardId: identifierSchema,
    faceDown: z.boolean(),
  }),
  z.strictObject({
    ...baseCommandShape,
    type: z.literal(GameCommandType.CONFIRM_STEP),
    subPhase: subPhaseSchema,
    skipSuccessLiveSelection: z.boolean().optional(),
  }),
  z.strictObject({
    ...baseCommandShape,
    type: z.literal(GameCommandType.SUBMIT_JUDGMENT),
    judgmentResults: z
      .map(identifierSchema, z.boolean())
      .refine((results) => results.size <= MAX_SELECTION_SIZE),
  }),
  z.strictObject({
    ...baseCommandShape,
    type: z.literal(GameCommandType.SUBMIT_SCORE),
    adjustedScore: z.number().int().min(-1_000).max(1_000).optional(),
  }),
  z.strictObject({
    ...baseCommandShape,
    type: z.literal(GameCommandType.SELECT_SUCCESS_LIVE),
    cardId: identifierSchema,
  }),
  z.strictObject({
    ...baseCommandShape,
    type: z.literal(GameCommandType.ACTIVATE_ABILITY),
    cardId: identifierSchema,
    abilityId: identifierSchema,
    abilityInstanceId: identifierSchema.optional(),
  }),
  z.strictObject({
    ...baseCommandShape,
    type: z.literal(GameCommandType.CONFIRM_EFFECT_STEP),
    effectId: identifierSchema,
    publicCardSelectionAutoAdvanceAt: timestampSchema.optional(),
    publicEffectChoiceAutoAdvanceAt: timestampSchema.optional(),
    publicRevealAutoAdvanceAt: timestampSchema.optional(),
    publicRevealGeneration: z.string().min(1).max(512).optional(),
    selectedCardId: nullableIdentifierSchema,
    selectedCardIds: identifierListSchema.optional(),
    selectedSlot: slotSchema.nullable().optional(),
    resolveInOrder: z.boolean().optional(),
    selectedOptionId: nullableIdentifierSchema,
    selectedEffectOptionIds: identifierListSchema.optional(),
    selectedNumber: z.number().int().min(-1_000).max(1_000).nullable().optional(),
    stageFormationMoveHistory: z
      .array(z.strictObject({ cardId: identifierSchema, toSlot: slotSchema }))
      .max(3)
      .optional(),
    stageFormationPlacements: z
      .array(z.strictObject({ cardId: identifierSchema, toSlot: slotSchema }))
      .max(3)
      .optional(),
  }),
]);

/**
 * 教程公开接口只接受当前场景可能用到的窄命令集。
 * 先恢复 Map 等 transport 结构，再严格校验并拒绝额外字段。
 */
export function parseTutorialGameCommand(value: unknown): GameCommand {
  let restored: unknown;
  try {
    restored = fromTransport<unknown>(value);
  } catch {
    throw invalidTutorialCommand();
  }

  const parsed = tutorialCommandSchema.safeParse(restored);
  if (!parsed.success) {
    throw invalidTutorialCommand();
  }
  return parsed.data as GameCommand;
}

function invalidTutorialCommand(): TutorialSessionServiceError {
  return new TutorialSessionServiceError('TUTORIAL_INVALID_INPUT', '教程命令参数非法', 400);
}
