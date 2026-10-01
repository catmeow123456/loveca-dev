/** Cosmetic profiles only; card abilities remain in the shared rules engine. */
export interface EntranceMeshProfile {
  /** UV mask: x fade start/end, y fade start/end. */
  hair: readonly [number, number, number, number];
  hairEnd: readonly [number, number];
  hem: readonly [number, number, number, number];
  /** Upper body, hair, hem displacement multipliers. */
  strength: readonly [number, number, number];
}
export interface CardEntranceProfile {
  id: 'kanata' | 'ren';
  baseCode: string;
  name: string;
  center: string;
  mobileHeight: string;
  light: string;
  mesh: EntranceMeshProfile;
}
const profiles: readonly CardEntranceProfile[] = [
  {
    id: 'kanata',
    baseCode: 'PL!N-bp7-006',
    name: '近江彼方',
    center: '-62%',
    mobileHeight: '76%',
    light: '#efb79199',
    mesh: {
      hair: [0.35, 0.57, 0.2, 0.4],
      hairEnd: [0.63, 0.73],
      hem: [0.43, 0.75, 0.68, 0.88],
      strength: [1, 1, 1],
    },
  },
  {
    id: 'ren',
    baseCode: 'PL!SP-pb2-005',
    name: '叶月恋',
    center: '-56%',
    mobileHeight: 'min(76%, 123vw)',
    light: '#bda4ed99',
    mesh: {
      hair: [0.22, 0.42, 0.24, 0.44],
      hairEnd: [0.65, 0.78],
      hem: [0.4, 0.8, 0.7, 0.9],
      strength: [0.4, 0.8, 0.55],
    },
  },
];
export function getCardEntranceProfile(code: string): CardEntranceProfile | undefined {
  return profiles.find(
    ({ baseCode }) =>
      code === baseCode ||
      (code.startsWith(`${baseCode}-`) && /^[^-]+$/.test(code.slice(baseCode.length + 1)))
  );
}
