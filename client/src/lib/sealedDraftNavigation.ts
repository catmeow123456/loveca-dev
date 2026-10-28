// The builder listens only while it has unsaved local selections.
export const SEALED_DRAFT_LEAVE_EVENT = 'loveca:sealed-draft-leave';

export function canLeaveSealedDraft(): boolean {
  return window.dispatchEvent(new Event(SEALED_DRAFT_LEAVE_EVENT, { cancelable: true }));
}
