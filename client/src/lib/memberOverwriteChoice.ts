import type { ViewCommandHint } from '@game/online';
import type { SlotPosition } from '@game/shared/types/enums';

export interface MemberOverwritePaymentChoice {
  readonly relayMode: 'SINGLE' | 'NONE';
  readonly energyCost: number;
}

export interface MemberOverwriteOption {
  readonly targetObjectId: string;
  readonly choices: readonly MemberOverwritePaymentChoice[];
}

const storageKey = 'loveca-ask-member-overwrite';

export function readAskMemberOverwrite(): boolean {
  try {
    return typeof window !== 'undefined' && window.localStorage.getItem(storageKey) === 'true';
  } catch {
    return false;
  }
}

export function saveAskMemberOverwrite(enabled: boolean): void {
  try {
    window.localStorage.setItem(storageKey, String(enabled));
  } catch {
    // The current board preference also works without persistent storage.
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** No cost or card-rule inference here: both alternatives must come from the authority. */
export function getMemberOverwriteOption(
  hint: ViewCommandHint | null,
  sourceObjectId: string,
  targetSlot: SlotPosition
): MemberOverwriteOption | null {
  const options = hint?.enabled ? hint.params?.memberOverwriteOptions : null;
  if (!Array.isArray(options)) return null;
  const option: unknown = options.find(
    (value: unknown) =>
      isRecord(value) && value.sourceObjectId === sourceObjectId && value.targetSlot === targetSlot
  );
  if (
    !isRecord(option) ||
    typeof option.targetObjectId !== 'string' ||
    !option.targetObjectId ||
    !Array.isArray(option.choices) ||
    option.choices.length !== 2
  )
    return null;
  const choices: MemberOverwritePaymentChoice[] = [];
  for (const choice of option.choices as unknown[]) {
    if (
      !isRecord(choice) ||
      (choice.relayMode !== 'SINGLE' && choice.relayMode !== 'NONE') ||
      typeof choice.energyCost !== 'number' ||
      !Number.isSafeInteger(choice.energyCost) ||
      choice.energyCost < 0 ||
      choices.some((existing) => existing.relayMode === choice.relayMode)
    )
      return null;
    choices.push({ relayMode: choice.relayMode, energyCost: choice.energyCost });
  }
  return { targetObjectId: option.targetObjectId, choices };
}
