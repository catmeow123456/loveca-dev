import { entranceCards } from '@game/shared/card-entrance';
import type { EntranceMotionTiming } from './cardEntranceArticulation';

/** Two registered atlas panels: repaired body plus an intact arm or second character. */
export interface EntranceArmLayers extends EntranceMotionTiming {
  /** Normalized atlas crops and placement within the composed portrait. */
  bodyCrop: readonly [number, number, number, number];
  /** Optional placement for a smaller back character in a wider duo composition. */
  bodyPlacement?: readonly [number, number, number, number];
  armCrop: readonly [number, number, number, number];
  armPlacement: readonly [number, number, number, number];
  /** Source pivot and alignment, in one portrait panel's normalized coordinates. */
  pivot: readonly [number, number];
  offset: readonly [number, number];
  angles: readonly [number, number];
  /** Optional torso lead; absent preserves the hand's existing timing. */
  bodyMotion?: EntranceMotionTiming;
  bodyPivot: readonly [number, number];
  /** Composed portrait Y range where torso rotation fades into the fixed lower body. */
  bodyBlendY?: readonly [number, number];
  bodyAngle: number;
  bodyLift: number;
  /** Elbow tuck as the hand approaches its final pose. */
  armTravel?: readonly [number, number];
  /** Start nearer the final gesture without moving the shoulder attachment. */
  armTravelStart?: readonly [number, number];
  /** Pin the sleeve's shoulder; the radius must exclude the rigid hand and prop. */
  sleeveAnchor?: readonly [number, number, number];
  /** Let the repaired sleeve/torso cover the joint's attachment cap. */
  behindBody?: boolean;
  /** Long rigid props inherit the body's weight at the joint, not per vertex. */
  rigidBodyFollow?: boolean;
  /** A second character may lean independently instead of following the first body. */
  independentBody?: boolean;
}
/** Cosmetic profiles only; card abilities remain in the shared rules engine. */
export interface EntranceMeshProfile {
  armLayers?: EntranceArmLayers;
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
  nameLayout?: 'group' | 'long';
  /** Keep the shared skip button clear of artwork with a raised arm on mobile. */
  mobileSkipPosition?: 'below-name';
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
  {
    id: 'hime',
    baseCode: entranceCards.hime,
    name: '安养寺姬芽',
    loadArt: () => import('../components/game/card-entrance/hime-layers.png'),
    center: '-50%',
    mobileHeight: 'min(76%, 126vw)',
    light: '#eabfc477',
    mesh: {
      hair: [0, 0.01, 0.8, 0.9],
      hairEnd: [0.95, 1],
      rightHair: [0.91, 0.99, 0.49, 0.55, 0.66, 0.71],
      hem: [0.83, 0.98, 0.67, 0.82],
      strength: [0, 0.7, 0.45],
      armLayers: {
        bodyCrop: [0, 0, 0.498, 1],
        armCrop: [0.5, 0, 0.5, 1],
        armPlacement: [0, 0, 1, 1],
        pivot: [0.65, 0.652],
        offset: [0.157, 0.014],
        angles: [-0.23, -0.4],
        start: 0.19,
        duration: 1.06,
        easing: 'smoothstep',
        bodyMotion: { start: 0.03, duration: 1.12, easing: 'smoothstep' },
        bodyPivot: [0.54, 0.7],
        bodyBlendY: [0.7, 0.88],
        bodyAngle: -0.024,
        bodyLift: 0.002,
        rigidBodyFollow: true,
      },
    },
  },
  {
    id: 'lanzhu',
    baseCode: entranceCards.lanzhu,
    name: '钟岚珠',
    loadArt: () => import('../components/game/card-entrance/lanzhu-layers.png'),
    artAspectRatio: '830 / 1050',
    center: '-50%',
    mobileHeight: 'min(76%, 126vw)',
    light: '#e5a6ba77',
    mesh: {
      hair: [0.035, 0.1, 0.48, 0.54],
      hairEnd: [0.62, 0.68],
      rightHair: [0.92, 0.99, 0.44, 0.49, 0.64, 0.7],
      hem: [0.89, 1, 0.65, 0.83],
      strength: [0, 1.1, 0.65],
      armLayers: {
        bodyCrop: [0, 0, 0.552, 1],
        armCrop: [0.795, 0.25, 0.18, 0.33],
        armPlacement: [0.68, 0.25, 0.326, 0.33],
        pivot: [0.85, 0.51],
        offset: [0, 0],
        angles: [-0.44, -0.72],
        start: 0.18,
        duration: 1.08,
        easing: 'smoothstep',
        bodyMotion: { start: 0.04, duration: 1.08, easing: 'smoothstep' },
        bodyPivot: [0.55, 0.57],
        bodyAngle: 0.025,
        bodyLift: 0.003,
        sleeveAnchor: [0.7, 0.36, 0.095],
        armTravelStart: [-0.043, -0.031],
        armTravel: [-0.07, -0.05],
        rigidBodyFollow: true,
      },
    },
  },
  {
    id: 'eli',
    baseCode: entranceCards.eli,
    name: '绚濑绘里',
    loadArt: () => import('../components/game/card-entrance/eli-layers.png'),
    artAspectRatio: '1050.7 / 1047',
    center: '-50%',
    mobileHeight: 'min(74%, 100vw)',
    light: '#a9d9ef77',
    mesh: {
      hair: [0.18, 0.28, 0.33, 0.42],
      hairEnd: [0.59, 0.66],
      hem: [0.85, 0.98, 0.84, 0.95],
      strength: [0, 0.8, 0.4],
      armLayers: {
        bodyCrop: [0, 0, 0.7, 1],
        armCrop: [0.705, 0.325, 0.29, 0.355],
        armPlacement: [0.552, 0.363, 0.414286, 0.355],
        pivot: [0.62, 0.623],
        offset: [0, 0],
        angles: [0.14, -0.04],
        start: 0.18,
        duration: 1.1,
        easing: 'smoothstep',
        bodyMotion: { start: 0.02, duration: 1.12, easing: 'smoothstep' },
        bodyPivot: [0.55, 0.88],
        bodyBlendY: [0.8, 1.04],
        bodyAngle: -0.022,
        bodyLift: 0.004,
        rigidBodyFollow: true,
      },
    },
  },
  {
    id: 'honoka',
    baseCode: entranceCards.honoka,
    name: '高坂穗乃果',
    loadArt: () => import('../components/game/card-entrance/honoka-layers.png'),
    artAspectRatio: '1050 / 1049',
    center: '-50%',
    mobileHeight: 'min(74%, 100vw)',
    light: '#e3a2c877',
    mesh: {
      hair: [0.19, 0.29, 0.25, 0.34],
      hairEnd: [0.52, 0.58],
      hem: [0.42, 0.55, 0.73, 0.9],
      strength: [0, 0.6, 0.4],
      armLayers: {
        bodyCrop: [0, 0, 0.7, 1],
        armCrop: [0.74, 0, 0.22, 1],
        armPlacement: [0.581, 0, 0.314286, 1],
        pivot: [0.63, 0.63],
        offset: [0, 0],
        angles: [-0.05, 0.025],
        start: 0.23,
        duration: 1.08,
        easing: 'smoothstep',
        bodyMotion: { start: 0.05, duration: 1.1, easing: 'smoothstep' },
        bodyPivot: [0.51, 0.76],
        bodyBlendY: [0.78, 0.95],
        bodyAngle: -0.014,
        bodyLift: 0.002,
        behindBody: true,
        rigidBodyFollow: true,
        armTravel: [-0.003, -0.009],
      },
    },
  },
  {
    id: 'rin-hanayo',
    baseCode: entranceCards['rin-hanayo'],
    name: '星空凛&小泉花阳',
    loadArt: () => import('../components/game/card-entrance/rin-hanayo-layers.png'),
    artAspectRatio: '1150 / 887',
    center: '-50%',
    mobileHeight: 'min(72%, 83vw)',
    nameLayout: 'group',
    light: '#e3c69b77',
    mesh: {
      hair: [0.2, 0.3, 0.24, 0.32],
      hairEnd: [0.43, 0.5],
      hem: [0.45, 0.65, 0.77, 0.9],
      strength: [0, 0.35, 0.35],
      armLayers: {
        bodyCrop: [0, 0, 0.36, 1],
        bodyPlacement: [0, 0, 0.555339, 1],
        armCrop: [0.386, 0, 0.614, 1],
        armPlacement: [0.052, 0, 0.947172, 1],
        // Both figures lean around their shared hand contact, keeping the embrace joined.
        pivot: [0.34, 0.79],
        offset: [0, 0],
        angles: [0.025, -0.018],
        start: 0.08,
        duration: 1.18,
        easing: 'smoothstep',
        bodyPivot: [0.34, 0.79],
        bodyBlendY: [0.86, 1.04],
        bodyAngle: 0.02,
        bodyLift: 0,
        independentBody: true,
      },
    },
  },
  {
    id: 'seras',
    baseCode: entranceCards.seras,
    name: '赛拉丝·柳田·利林费尔德',
    loadArt: () => import('../components/game/card-entrance/seras-layers.png'),
    artAspectRatio: '1136.64 / 1024',
    center: '-50%',
    mobileHeight: 'min(74%, 94vw)',
    light: '#d58c9b77',
    nameLayout: 'long',
    mesh: {
      hair: [0.26, 0.33, 0.34, 0.43],
      hairEnd: [0.63, 0.69],
      rightHair: [0.66, 0.74, 0.36, 0.45, 0.62, 0.69],
      hem: [0.75, 0.95, 0.77, 0.9],
      strength: [0, 0.4, 0.3],
      armLayers: {
        bodyCrop: [0, 0, 0.74, 1],
        armCrop: [0.79, 0.34, 0.19, 0.53],
        armPlacement: [0.47, 0.355, 0.231081, 0.477],
        pivot: [0.646, 0.805],
        offset: [0, 0],
        // Keep the support hand near the chin; the upper body leads a small lean.
        angles: [-0.04, 0.012],
        start: 0.19,
        duration: 1.12,
        easing: 'smoothstep',
        bodyMotion: { start: 0.04, duration: 1.15, easing: 'smoothstep' },
        bodyPivot: [0.52, 0.84],
        bodyBlendY: [0.88, 1.06],
        bodyAngle: -0.022,
        bodyLift: 0.001,
        rigidBodyFollow: true,
      },
    },
  },
  {
    id: 'kaho',
    mobileSkipPosition: 'below-name',
    baseCode: entranceCards.kaho,
    name: '日野下花帆',
    loadArt: () => import('../components/game/card-entrance/kaho-layers.png'),
    artAspectRatio: '1059.84 / 1137.78',
    center: '-50%',
    mobileHeight: 'min(74%, 105vw)',
    light: '#89c8dd77',
    mesh: {
      hair: [0.5, 0.59, 0.43, 0.5],
      hairEnd: [0.6, 0.66],
      rightHair: [0.62, 0.7, 0.26, 0.33, 0.44, 0.5],
      // This atlas includes another face below Kaho's head. Broad hair masks
      // also hit their necklines; keep both faces and necklaces undeformed.
      hem: [0.86, 0.98, 0.9, 0.99],
      strength: [0, 0, 0.3],
      armLayers: {
        bodyCrop: [0, 0, 0.69, 1],
        bodyPlacement: [0, 0.1, 1, 0.9],
        armCrop: [0.7, 0.05, 0.3, 0.24],
        armPlacement: [0.488, 0.067, 0.434783, 0.216],
        pivot: [0.902, 0.226],
        offset: [0, 0],
        angles: [-0.035, 0.095],
        start: 0.2,
        duration: 1.08,
        easing: 'smoothstep',
        bodyMotion: { start: 0.04, duration: 1.1, easing: 'smoothstep' },
        bodyPivot: [0.61, 0.72],
        bodyBlendY: [0.87, 1.02],
        bodyAngle: 0.024,
        bodyLift: 0.002,
        rigidBodyFollow: true,
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
