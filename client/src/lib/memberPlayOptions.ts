import type { ViewCommandHint } from '@game/online';
import type {
  CardDefinedSpecialMemberPlayMode,
  MemberPlayOptionSelectionDescriptor,
} from '@game/shared/rules/member-play-options';
import { SlotPosition } from '@game/shared/types/enums';

interface MemberPlayOptionViewBase {
  readonly label: string;
  readonly title: string;
  readonly description: string;
  readonly targetSlots: readonly SlotPosition[];
}

export type MemberPlayOptionView =
  | (MemberPlayOptionViewBase & {
      readonly id: CardDefinedSpecialMemberPlayMode;
      readonly kind: 'CARD_DEFINED';
      readonly mode: CardDefinedSpecialMemberPlayMode;
    })
  | (MemberPlayOptionViewBase & {
      readonly id: 'DOUBLE_RELAY';
      readonly kind: 'DOUBLE_RELAY';
      readonly selection: MemberPlayOptionSelectionDescriptor;
    });

const MEMBER_SLOT_SET = new Set<SlotPosition>([
  SlotPosition.LEFT,
  SlotPosition.CENTER,
  SlotPosition.RIGHT,
]);

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readNonEmptyString(record: Readonly<Record<string, unknown>>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function readTargetSlots(value: unknown): readonly SlotPosition[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const slots = value.filter((slot): slot is SlotPosition => MEMBER_SLOT_SET.has(slot));
  return slots.length === value.length ? [...new Set(slots)] : null;
}

function readSelectionDescriptor(value: unknown): MemberPlayOptionSelectionDescriptor | null {
  if (!isRecord(value)) {
    return null;
  }
  const minTargets = value.minTargets;
  const maxTargets = value.maxTargets;
  const mustIncludeTarget = value.mustIncludeTarget;
  if (
    !Number.isInteger(minTargets) ||
    !Number.isInteger(maxTargets) ||
    typeof minTargets !== 'number' ||
    typeof maxTargets !== 'number' ||
    minTargets < 1 ||
    maxTargets < minTargets ||
    typeof mustIncludeTarget !== 'boolean'
  ) {
    return null;
  }
  return { minTargets, maxTargets, mustIncludeTarget };
}

function parseMemberPlayOption(value: unknown): MemberPlayOptionView | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = readNonEmptyString(value, 'id');
  const label = readNonEmptyString(value, 'label');
  const title = readNonEmptyString(value, 'title');
  const description = readNonEmptyString(value, 'description');
  const targetSlots = readTargetSlots(value.targetSlots);
  if (!id || !label || !title || !description || !targetSlots || targetSlots.length === 0) {
    return null;
  }

  if (value.kind === 'CARD_DEFINED') {
    const mode = typeof value.mode === 'string' && value.mode.trim().length > 0 ? value.mode : null;
    if (!mode || id !== mode) {
      return null;
    }
    return {
      id: mode as CardDefinedSpecialMemberPlayMode,
      label,
      kind: 'CARD_DEFINED',
      title,
      description,
      targetSlots,
      mode: mode as CardDefinedSpecialMemberPlayMode,
    };
  }

  if (value.kind === 'DOUBLE_RELAY' && id === 'DOUBLE_RELAY') {
    const selection = readSelectionDescriptor(value.selection);
    if (!selection || targetSlots.length < selection.minTargets) {
      return null;
    }
    return {
      id: 'DOUBLE_RELAY',
      label,
      kind: 'DOUBLE_RELAY',
      title,
      description,
      targetSlots,
      selection,
    };
  }

  return null;
}

export function getMemberPlayOptions(
  hint: ViewCommandHint | null,
  sourceObjectId: string | null
): readonly MemberPlayOptionView[] {
  if (!hint?.enabled || !sourceObjectId || !hint.scope?.objectIds?.includes(sourceObjectId)) {
    return [];
  }
  const optionsByObjectId = hint.params?.memberPlayOptionsByObjectId;
  if (!isRecord(optionsByObjectId)) {
    return [];
  }
  const rawOptions = optionsByObjectId[sourceObjectId];
  if (!Array.isArray(rawOptions)) {
    return [];
  }

  const seenIds = new Set<string>();
  return rawOptions.flatMap((rawOption) => {
    const option = parseMemberPlayOption(rawOption);
    if (!option || seenIds.has(option.id)) {
      return [];
    }
    seenIds.add(option.id);
    return [option];
  });
}
