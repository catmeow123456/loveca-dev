import { entranceCards } from '@game/shared/card-entrance';

/** Cosmetic profiles only; card abilities remain in the shared rules engine. */
export interface EntranceMeshProfile {
  /** UV mask: x fade start/end, y fade start/end. */
  hair: readonly [number, number, number, number];
  hairEnd: readonly [number, number];
  /** Optional right-side hair: x fade start/end, y start/end, y fade-out start/end. */
  rightHair?: readonly [number, number, number, number, number, number];
  hem: readonly [number, number, number, number];
  /** Three softly joined upper-body regions; UV column transitions avoid faces. */
  groupSway?: {
    columns: readonly [number, number, number, number];
    amplitude: readonly [number, number, number];
    phase: readonly [number, number, number];
  };
  /** Upper body, hair, hem displacement multipliers. */
  strength: readonly [number, number, number];
}
export interface CardEntranceProfile {
  id: string;
  baseCode: string;
  name: string;
  /** Loaded only when this public card is about to present. */
  loadArt: () => Promise<{ default: string }>;
  center: string;
  mobileHeight: string;
  /** Preserve wider group artwork without stretching older portraits. */
  artAspectRatio?: string;
  nameLayout?: 'group';
  light: string;
  mesh: EntranceMeshProfile;
}
export function defineEntranceProfiles(entries: readonly CardEntranceProfile[]) {
  const ids = new Set<string>(),
    codes = new Set<string>();
  for (const entry of entries) {
    if (!entry.id || !entry.baseCode || ids.has(entry.id) || codes.has(entry.baseCode))
      throw new Error(`Duplicate or empty entrance registration: ${entry.id}/${entry.baseCode}`);
    ids.add(entry.id);
    codes.add(entry.baseCode);
  }
  return entries;
}
export const cardEntranceProfiles = defineEntranceProfiles([
  {
    id: 'kanata',
    loadArt: () => import('../components/game/card-entrance/kanata.png'),
    baseCode: entranceCards['kanata'],
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
    loadArt: () => import('../components/game/card-entrance/ren.png'),
    baseCode: entranceCards['ren'],
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
  {
    id: 'shiki',
    loadArt: () => import('../components/game/card-entrance/shiki.png'),
    baseCode: entranceCards['shiki'],
    name: '若菜四季',
    center: '-52%',
    mobileHeight: 'min(76%, 126vw)',
    light: '#83c9c599',
    mesh: {
      hair: [0.26, 0.36, 0.12, 0.2],
      hairEnd: [0.29, 0.34],
      rightHair: [0.67, 0.74, 0.12, 0.2, 0.29, 0.34],
      hem: [0.82, 0.96, 0.69, 0.84],
      strength: [0.15, 0.48, 0.38],
    },
  },
  {
    id: 'next-step-trio',
    loadArt: () => import('../components/game/card-entrance/next-step-trio.png'),
    baseCode: entranceCards['next-step-trio'],
    name: '渡边曜&鬼冢夏美&大泽瑠璃乃',
    center: '-50%',
    mobileHeight: 'min(74%, 110vw)',
    artAspectRatio: '1152 / 1366',
    nameLayout: 'group',
    light: '#9bcfea88',
    mesh: {
      // Broad regions move each face and its nearby props together. Only the
      // outer hair and skirt receive additional flexible displacement.
      hair: [0.08, 0.13, 0.29, 0.35],
      hairEnd: [0.4, 0.46],
      hem: [0.85, 0.98, 0.77, 0.86],
      rightHair: [0.91, 0.99, 0.23, 0.31, 0.68, 0.78],
      strength: [0, 0.65, 0.65],
      groupSway: {
        columns: [0.34, 0.43, 0.64, 0.71],
        amplitude: [0.012, 0.009, 0.013],
        phase: [0, 0.7, 1.4],
      },
    },
  },
]);
export function getCardEntranceProfile(code: string): CardEntranceProfile | undefined {
  return cardEntranceProfiles.find(
    ({ baseCode }) =>
      code === baseCode ||
      (code.startsWith(`${baseCode}-`) && /^[^-]+$/.test(code.slice(baseCode.length + 1)))
  );
}
