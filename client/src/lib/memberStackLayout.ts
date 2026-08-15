const MEMBER_STACK_Z_INDEX_BASE = 5;
const MAIN_MEMBER_MIN_Z_INDEX = 10;

export function getEnergyBelowCardZIndex(reverseIndex: number): number {
  return MEMBER_STACK_Z_INDEX_BASE + reverseIndex;
}

export function getMemberBelowCardZIndex(energyBelowCount: number, reverseIndex: number): number {
  return MEMBER_STACK_Z_INDEX_BASE + energyBelowCount + reverseIndex;
}

export function getMainMemberCardZIndex(
  energyBelowCount: number,
  memberBelowCount: number
): number {
  return Math.max(
    MAIN_MEMBER_MIN_Z_INDEX,
    MEMBER_STACK_Z_INDEX_BASE + energyBelowCount + memberBelowCount
  );
}
