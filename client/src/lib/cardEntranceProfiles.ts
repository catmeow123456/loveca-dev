import { entranceCards } from '@game/shared/card-entrance';
import type { EntranceBlinkProfile } from './cardEntranceBlink';
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
  /** A stationary foreground from the same atlas, drawn after body and arm. */
  foreground?: {
    crop: readonly [number, number, number, number];
    placement: readonly [number, number, number, number];
  };
}
/** A connected limb; its soft boundary belongs in clothing or an actual joint. */
export interface EntranceAttachedPart extends EntranceMotionTiming {
  region: readonly (readonly [number, number])[];
  feather: number;
  pivot: readonly [number, number];
  angles: readonly [number, number];
}
/** Cosmetic profiles only; card abilities remain in the shared rules engine. */
export interface EntranceMeshProfile {
  armLayers?: EntranceArmLayers;
  /** Intact-image gesture alongside group sway; use atlas layers for detached limbs. */
  attachedPart?: EntranceAttachedPart;
  /** Intact portrait: head, hands and props share one move; blend only in soft clothing. */
  portraitMotion?: EntranceMotionTiming & {
    pivot: readonly [number, number];
    blendY: readonly [number, number];
    /** Optional left-side anchor; keeps a foreground knee still without warping a low hand. */
    anchorX?: readonly [number, number];
    /** Pin a lower-left foreground object; x and y transition ranges in source UVs. */
    fixedCorner?: readonly [number, number, number, number];
    angle: number;
    travel: readonly [number, number];
    /** An intact limb in the same image; the soft polygon boundary belongs in sleeve or empty space. */
    attachedPart?: EntranceAttachedPart;
  };
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
  blink?: { loadArt: () => Promise<{ default: string }>; faces: readonly EntranceBlinkProfile[] };
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
    blink: {
      loadArt: () => import('../components/game/card-entrance/kanata-blink.png'),
      faces: [
        {
          start: 1.02,
          close: 0.065,
          hold: 0.045,
          open: 0.13,
          eyes: [
            {
              target: [648 / 1061, 252 / 1483, 98 / 1061, 61 / 1483],
              half: [520 / 1774, 140 / 887, 430 / 1774, 267 / 887],
              closed: [520 / 1774, 546 / 887, 430 / 1774, 267 / 887],
            },
            {
              target: [763 / 1061, 273 / 1483, 55 / 1061, 42 / 1483],
              half: [1125 / 1774, 230 / 887, 194 / 1774, 148 / 887],
              closed: [1125 / 1774, 636 / 887, 194 / 1774, 148 / 887],
            },
          ],
        },
      ],
    },
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
    blink: {
      loadArt: () => import('../components/game/card-entrance/ren-blink.png'),
      faces: [
        {
          start: 0.9,
          close: 0.055,
          hold: 0.035,
          open: 0.11,
          eyes: [
            {
              target: [480 / 1061, 280 / 1483, 102 / 1061, 76 / 1483],
              half: [370 / 1536, 206 / 1024, 340 / 1536, 253 / 1024],
              closed: [370 / 1536, 646 / 1024, 340 / 1536, 253 / 1024],
            },
            {
              target: [635 / 1061, 276 / 1483, 74 / 1061, 78 / 1483],
              half: [942 / 1536, 203 / 1024, 252 / 1536, 266 / 1024],
              closed: [942 / 1536, 643 / 1024, 252 / 1536, 266 / 1024],
            },
          ],
        },
      ],
    },
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
    blink: {
      loadArt: () => import('../components/game/card-entrance/shiki-blink.png'),
      faces: [
        {
          start: 0.94,
          close: 0.055,
          hold: 0.035,
          open: 0.11,
          eyes: [
            {
              target: [390 / 1061, 246 / 1483, 108 / 1061, 70 / 1483],
              half: [350 / 1536, 205 / 1024, 345 / 1536, 224 / 1024],
              closed: [350 / 1536, 715 / 1024, 345 / 1536, 224 / 1024],
            },
            {
              target: [544 / 1061, 269 / 1483, 114 / 1061, 68 / 1483],
              half: [817 / 1536, 242 / 1024, 345 / 1536, 206 / 1024],
              closed: [817 / 1536, 752 / 1024, 345 / 1536, 206 / 1024],
            },
          ],
        },
      ],
    },
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
    blink: {
      loadArt: () => import('../components/game/card-entrance/next-step-trio-blink.png'),
      faces: [
        {
          start: 0.73,
          close: 0.055,
          hold: 0.035,
          open: 0.11,
          eyes: [
            {
              target: [158 / 1152, 347 / 1366, 87 / 1152, 79 / 1366],
              half: [103 / 1536, 210 / 1024, 214 / 1536, 194 / 1024],
              closed: [103 / 1536, 722 / 1024, 214 / 1536, 194 / 1024],
            },
            {
              target: [283 / 1152, 358 / 1366, 86 / 1152, 81 / 1366],
              half: [419 / 1536, 210 / 1024, 210 / 1536, 198 / 1024],
              closed: [419 / 1536, 722 / 1024, 210 / 1536, 198 / 1024],
            },
          ],
        },
        {
          start: 1.15,
          close: 0.055,
          hold: 0.035,
          open: 0.11,
          eyes: [
            {
              target: [470 / 1152, 250 / 1366, 94 / 1152, 76 / 1366],
              half: [890 / 1536, 195 / 1024, 217 / 1536, 175 / 1024],
              closed: [890 / 1536, 707 / 1024, 217 / 1536, 175 / 1024],
            },
            {
              target: [608 / 1152, 259 / 1366, 90 / 1152, 77 / 1366],
              half: [1213 / 1536, 196 / 1024, 209 / 1536, 179 / 1024],
              closed: [1213 / 1536, 708 / 1024, 209 / 1536, 179 / 1024],
            },
          ],
        },
      ],
    },
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
    blink: {
      loadArt: () => import('../components/game/card-entrance/hime-blink.png'),
      faces: [
        {
          start: 0.84,
          close: 0.055,
          hold: 0.035,
          open: 0.11,
          eyes: [
            {
              target: [332 / 1500, 193 / 1049, 81 / 1500, 65 / 1049],
              half: [634 / 1991, 153 / 789, 280 / 1991, 225 / 789],
              closed: [634 / 1991, 548 / 789, 280 / 1991, 225 / 789],
            },
            {
              target: [445 / 1500, 174 / 1049, 82 / 1500, 65 / 1049],
              half: [1023 / 1991, 104 / 789, 287 / 1991, 228 / 789],
              closed: [1023 / 1991, 500 / 789, 287 / 1991, 228 / 789],
            },
          ],
        },
      ],
    },
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
    blink: {
      loadArt: () => import('../components/game/card-entrance/lanzhu-blink.png'),
      faces: [
        {
          start: 1.02,
          close: 0.055,
          hold: 0.035,
          open: 0.11,
          eyes: [
            {
              target: [349 / 1500, 228 / 1049, 80 / 1500, 52 / 1049],
              half: [830 / 2172, 172 / 724, 270 / 2172, 176 / 724],
              closed: [830 / 2172, 519 / 724, 270 / 2172, 176 / 724],
            },
            {
              target: [442 / 1500, 194 / 1049, 72 / 1500, 57 / 1049],
              half: [1135 / 2172, 59 / 724, 260 / 2172, 206 / 724],
              closed: [1135 / 2172, 405 / 724, 260 / 2172, 206 / 724],
            },
          ],
        },
      ],
    },
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
    blink: {
      loadArt: () => import('../components/game/card-entrance/eli-blink.png'),
      faces: [
        {
          start: 0.9,
          close: 0.055,
          hold: 0.035,
          open: 0.11,
          eyes: [
            {
              target: [249 / 1501, 306 / 1047, 88 / 1501, 77 / 1047],
              half: [608 / 1777, 207 / 885, 252 / 1777, 220 / 885],
              closed: [608 / 1777, 621 / 885, 252 / 1777, 220 / 885],
            },
            {
              target: [361 / 1501, 265 / 1047, 130 / 1501, 87 / 1047],
              half: [914 / 1777, 104 / 885, 354 / 1777, 237 / 885],
              closed: [914 / 1777, 518 / 885, 354 / 1777, 237 / 885],
            },
          ],
        },
      ],
    },
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
    blink: {
      loadArt: () => import('../components/game/card-entrance/honoka-blink.png'),
      faces: [
        {
          start: 0.82,
          close: 0.055,
          hold: 0.035,
          open: 0.11,
          eyes: [
            {
              target: [387 / 1500, 242 / 1049, 83 / 1500, 76 / 1049],
              half: [659 / 1900, 178 / 828, 275 / 1900, 252 / 828],
              closed: [659 / 1900, 566 / 828, 275 / 1900, 252 / 828],
            },
            {
              target: [497 / 1500, 202 / 1049, 75 / 1500, 77 / 1049],
              half: [1035 / 1900, 95 / 828, 254 / 1900, 261 / 828],
              closed: [1035 / 1900, 483 / 828, 254 / 1900, 261 / 828],
            },
          ],
        },
      ],
    },
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
    blink: {
      loadArt: () => import('../components/game/card-entrance/rin-hanayo-blink.png'),
      faces: [
        {
          start: 0.76,
          close: 0.055,
          hold: 0.035,
          open: 0.11,
          eyes: [
            {
              target: [303 / 1774, 185 / 887, 98 / 1774, 78 / 887],
              half: [131 / 1414, 199 / 1113, 222 / 1414, 177 / 1113],
              closed: [131 / 1414, 741 / 1113, 222 / 1414, 177 / 1113],
            },
            {
              target: [406 / 1774, 257 / 887, 81 / 1774, 80 / 887],
              half: [376 / 1414, 337 / 1113, 175 / 1414, 173 / 1113],
              closed: [376 / 1414, 879 / 1113, 175 / 1414, 173 / 1113],
            },
          ],
        },
        {
          start: 1.16,
          close: 0.055,
          hold: 0.035,
          open: 0.11,
          eyes: [
            {
              target: [1163.08 / 1774, 185.61 / 887, 103.84 / 1774, 83.78 / 887],
              half: [765.54 / 1414, 224.87 / 1113, 228.92 / 1414, 185.26 / 1113],
              closed: [765.54 / 1414, 766.87 / 1113, 228.92 / 1414, 185.26 / 1113],
            },
            {
              target: [1268.27 / 1774, 214.89 / 887, 114.46 / 1774, 93.22 / 887],
              half: [1028.74 / 1414, 282.34 / 1113, 252.52 / 1414, 205.32 / 1113],
              closed: [1028.74 / 1414, 824.34 / 1113, 252.52 / 1414, 205.32 / 1113],
            },
          ],
        },
      ],
    },
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
    blink: {
      loadArt: () => import('../components/game/card-entrance/seras-blink.png'),
      faces: [
        {
          start: 1.04,
          close: 0.055,
          hold: 0.035,
          open: 0.11,
          eyes: [
            {
              target: [390 / 1536, 287 / 1024, 103 / 1536, 77 / 1024],
              half: [365 / 1536, 245 / 1024, 358 / 1536, 249 / 1024],
              closed: [365 / 1536, 725 / 1024, 358 / 1536, 249 / 1024],
            },
            {
              target: [516 / 1536, 221 / 1024, 94 / 1536, 83 / 1024],
              half: [860 / 1536, 125 / 1024, 340 / 1536, 290 / 1024],
              closed: [860 / 1536, 605 / 1024, 340 / 1536, 290 / 1024],
            },
          ],
        },
      ],
    },
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
    blink: {
      loadArt: () => import('../components/game/card-entrance/kaho-blink.png'),
      faces: [
        {
          start: 0.94,
          close: 0.055,
          hold: 0.035,
          open: 0.11,
          eyes: [
            {
              target: [359 / 1536, 370 / 1024, 98 / 1536, 101 / 1024],
              half: [355 / 1024, 509 / 1536, 164 / 1024, 176 / 1536],
              closed: [355 / 1024, 1281 / 1536, 164 / 1024, 176 / 1536],
            },
            {
              target: [429 / 1536, 229 / 1024, 89 / 1536, 104 / 1024],
              half: [493 / 1024, 263 / 1536, 166 / 1024, 187 / 1536],
              closed: [493 / 1024, 1037 / 1536, 166 / 1024, 187 / 1536],
            },
          ],
        },
      ],
    },
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
  {
    id: 'rurino',
    blink: {
      loadArt: () => import('../components/game/card-entrance/rurino-blink.png'),
      faces: [
        {
          start: 0.88,
          close: 0.055,
          hold: 0.035,
          open: 0.11,
          eyes: [
            {
              target: [658 / 1199, 333 / 1312, 124 / 1199, 100 / 1312],
              half: [378 / 1536, 150 / 1024, 328 / 1536, 265 / 1024],
              closed: [378 / 1536, 605 / 1024, 328 / 1536, 265 / 1024],
            },
            {
              target: [820 / 1199, 357 / 1312, 131 / 1199, 101 / 1312],
              half: [838 / 1536, 194 / 1024, 331 / 1536, 255 / 1024],
              closed: [838 / 1536, 647 / 1024, 331 / 1536, 255 / 1024],
            },
          ],
        },
      ],
    },
    mobileSkipPosition: 'below-name',
    baseCode: entranceCards.rurino,
    name: '大泽瑠璃乃',
    loadArt: () => import('../components/game/card-entrance/rurino.png'),
    artAspectRatio: '1199 / 1312',
    center: '-50%',
    mobileHeight: 'min(76%, 110vw)',
    light: '#b3dfe977',
    mesh: {
      // Keep the face/choker intact; isolate the reaching arm at its loose sleeve.
      hair: [0, 0.01, 0.9, 0.99],
      hairEnd: [0.99, 1],
      rightHair: [0.81, 0.92, 0.27, 0.37, 0.53, 0.59],
      hem: [0.68, 0.74, 0.93, 0.99],
      strength: [0, 1.9, 0.65],
      portraitMotion: {
        start: 0.24,
        duration: 1.12,
        easing: 'smoothstep',
        pivot: [0.6, 0.69],
        blendY: [0.57, 0.76],
        anchorX: [0.28, 0.48],
        angle: -0.042,
        travel: [-0.006, -0.012],
        attachedPart: {
          start: 0.36,
          duration: 1.08,
          easing: 'smoothstep',
          pivot: [0.78, 0.63],
          region: [
            [0.72, 0.59],
            [0.85, 0.59],
            [1.08, 0.74],
            [1.08, 1.04],
            [0.73, 1.04],
            [0.71, 0.72],
          ],
          feather: 0.045,
          angles: [0.145, 0],
        },
      },
    },
  },
  {
    id: 'you',
    blink: {
      loadArt: () => import('../components/game/card-entrance/you-blink.png'),
      faces: [
        {
          start: 0.93,
          close: 0.055,
          hold: 0.035,
          open: 0.11,
          eyes: [
            {
              target: [584 / 1061, 283 / 1483, 99 / 1061, 65 / 1483],
              half: [381 / 1774, 155 / 887, 357 / 1774, 234 / 887],
              closed: [381 / 1774, 598 / 887, 357 / 1774, 234 / 887],
            },
            {
              target: [731 / 1061, 299 / 1483, 96 / 1061, 79 / 1483],
              half: [910 / 1774, 179 / 887, 337 / 1774, 277 / 887],
              closed: [910 / 1774, 622 / 887, 337 / 1774, 277 / 887],
            },
          ],
        },
      ],
    },
    mobileSkipPosition: 'below-name',
    baseCode: entranceCards.you,
    name: '渡边曜',
    loadArt: () => import('../components/game/card-entrance/you.png'),
    artAspectRatio: '1061 / 1483',
    center: '-50%',
    mobileHeight: 'min(76%, 123vw)',
    light: '#9bdbe577',
    mesh: {
      // Head and forehead hand share the torso. The full bottle follows one rigid arm region.
      hair: [0, 1, 0, 1],
      hairEnd: [0, 1],
      hem: [0, 1, 0, 1],
      strength: [0, 0, 0],
      portraitMotion: {
        start: 0.28,
        duration: 1.12,
        easing: 'smoothstep',
        pivot: [0.75, 0.58],
        blendY: [0.47, 0.65],
        fixedCorner: [0.25, 0.4, 0.27, 0.34],
        angle: 0.036,
        travel: [0.004, 0.008],
        attachedPart: {
          start: 0.4,
          duration: 1.03,
          easing: 'smoothstep',
          pivot: [0.755, 0.505],
          region: [
            [0.87, 0.2],
            [1.04, 0.2],
            [1.04, 0.62],
            [0.74, 0.62],
            [0.69, 0.5],
            [0.78, 0.44],
            [0.86, 0.37],
          ],
          feather: 0.018,
          angles: [-0.1, 0],
        },
      },
    },
  },
  {
    id: 'emma',
    blink: {
      loadArt: () => import('../components/game/card-entrance/emma-blink.png'),
      faces: [
        {
          start: 0.94,
          close: 0.055,
          hold: 0.035,
          open: 0.11,
          eyes: [
            {
              target: [398 / 1024, 282 / 1536, 94 / 1024, 81 / 1536],
              half: [515 / 1774, 169 / 887, 278 / 1774, 240 / 887],
              closed: [515 / 1774, 636 / 887, 278 / 1774, 240 / 887],
            },
            {
              target: [543 / 1024, 307 / 1536, 95 / 1024, 82 / 1536],
              half: [958 / 1774, 187 / 887, 272 / 1774, 222 / 887],
              closed: [958 / 1774, 652 / 887, 272 / 1774, 222 / 887],
            },
          ],
        },
      ],
    },
    baseCode: entranceCards.emma,
    name: '艾玛·维尔德',
    loadArt: () => import('../components/game/card-entrance/emma.png'),
    artAspectRatio: '2 / 3',
    center: '-52%',
    mobileHeight: 'min(76%, 125vw)',
    light: '#9ee6b477',
    mesh: {
      hair: [0.3, 0.37, 0.26, 0.29],
      hairEnd: [0.33, 0.36],
      rightHair: [0.65, 0.7, 0.28, 0.31, 0.34, 0.36],
      hem: [0.26, 0.34, 0.67, 0.85],
      strength: [0, 1.1, 0.6],
      portraitMotion: {
        start: 0.26,
        duration: 1.08,
        easing: 'smoothstep',
        pivot: [0.48, 0.64],
        blendY: [0.63, 0.85],
        angle: -0.035,
        travel: [-0.006, -0.009],
        attachedPart: {
          start: 0.28,
          duration: 1.05,
          easing: 'smoothstep',
          pivot: [0.69, 0.56],
          feather: 0.025,
          region: [
            [0.77, 0.34],
            [1.05, 0.34],
            [1.05, 0.66],
            [0.79, 0.69],
            [0.68, 0.61],
            [0.68, 0.56],
          ],
          angles: [0.28, 0],
        },
      },
    },
  },
  {
    id: 'festival-trio',
    blink: {
      loadArt: () => import('../components/game/card-entrance/festival-trio-blink.png'),
      faces: [
        {
          start: 0.66,
          close: 0.055,
          hold: 0.035,
          open: 0.11,
          eyes: [
            {
              target: [323 / 1375, 285 / 1144, 81 / 1375, 67 / 1144],
              half: [91 / 1536, 327 / 1024, 158 / 1536, 131 / 1024],
              closed: [91 / 1536, 682 / 1024, 158 / 1536, 131 / 1024],
            },
            {
              target: [432 / 1375, 319 / 1144, 68 / 1375, 63 / 1144],
              half: [345 / 1536, 382 / 1024, 125 / 1536, 116 / 1024],
              closed: [345 / 1536, 737 / 1024, 125 / 1536, 116 / 1024],
            },
          ],
        },
        {
          start: 0.97,
          close: 0.055,
          hold: 0.035,
          open: 0.11,
          eyes: [
            {
              target: [617 / 1375, 281 / 1144, 77 / 1375, 65 / 1144],
              half: [550 / 1536, 353 / 1024, 169 / 1536, 143 / 1024],
              closed: [550 / 1536, 710 / 1024, 169 / 1536, 143 / 1024],
            },
            {
              target: [736 / 1375, 276 / 1144, 80 / 1375, 65 / 1144],
              half: [822 / 1536, 350 / 1024, 160 / 1536, 130 / 1024],
              closed: [822 / 1536, 706 / 1024, 160 / 1536, 130 / 1024],
            },
          ],
        },
        {
          start: 1.27,
          close: 0.055,
          hold: 0.035,
          open: 0.11,
          eyes: [
            {
              target: [930 / 1375, 266 / 1144, 96 / 1375, 96 / 1144],
              half: [1054 / 1536, 335 / 1024, 195 / 1536, 195 / 1024],
              closed: [1054 / 1536, 692 / 1024, 195 / 1536, 195 / 1024],
            },
            {
              target: [1043 / 1375, 267 / 1144, 97 / 1375, 95 / 1144],
              half: [1301 / 1536, 328 / 1024, 204 / 1536, 199 / 1024],
              closed: [1301 / 1536, 685 / 1024, 204 / 1536, 199 / 1024],
            },
          ],
        },
      ],
    },
    baseCode: entranceCards['festival-trio'],
    name: '国木田花丸&优木雪菜&岚千砂都',
    loadArt: () => import('../components/game/card-entrance/festival-trio.png'),
    artAspectRatio: '1375 / 1144',
    center: '-50%',
    mobileHeight: 'min(70%, 78vw)',
    nameLayout: 'group',
    mobileSkipPosition: 'below-name',
    light: '#f7d88377',
    mesh: {
      attachedPart: {
        start: 0.28,
        duration: 0.98,
        easing: 'smoothstep',
        pivot: [0.107, 0.173],
        feather: 0.01,
        region: [
          [-0.1, -0.1],
          [0.145, -0.1],
          [0.145, 0.18],
          [-0.1, 0.18],
        ],
        angles: [0, 0.34],
      },
      // Column transitions stay between faces; hands remain in their original group.
      hair: [0.12, 0.2, 0.32, 0.38],
      hairEnd: [0.57, 0.65],
      rightHair: [0.92, 0.97, 0.31, 0.37, 0.48, 0.55],
      hem: [0.12, 0.28, 0.76, 0.95],
      strength: [0, 0.45, 0.25],
      groupSway: {
        columns: [0.35, 0.41, 0.64, 0.69],
        amplitude: [0.014, 0.009, 0.012],
        phase: [0.1, 0.8, 1.45],
      },
    },
  },
  {
    id: 'shizuku',
    blink: {
      loadArt: () => import('../components/game/card-entrance/shizuku-blink.png'),
      faces: [
        {
          start: 0.88,
          close: 0.055,
          hold: 0.035,
          open: 0.11,
          eyes: [
            {
              target: [394 / 1061, 286 / 1483, 92 / 1061, 77 / 1483],
              half: [547 / 1774, 176 / 887, 246 / 1774, 206 / 887],
              closed: [547 / 1774, 621 / 887, 246 / 1774, 206 / 887],
            },
            {
              target: [539 / 1061, 301 / 1483, 93 / 1061, 78 / 1483],
              half: [991 / 1774, 197 / 887, 258 / 1774, 216 / 887],
              closed: [991 / 1774, 642 / 887, 258 / 1774, 216 / 887],
            },
          ],
        },
      ],
    },
    baseCode: entranceCards.shizuku,
    name: '樱坂雫',
    loadArt: () => import('../components/game/card-entrance/shizuku.png'),
    artAspectRatio: '1061 / 1483',
    center: '-51%',
    mobileHeight: 'min(77%, 111vw)',
    mobileSkipPosition: 'below-name',
    light: '#8bc7ed77',
    mesh: {
      hair: [0.23, 0.34, 0.37, 0.46],
      hairEnd: [0.64, 0.71],
      rightHair: [0.73, 0.85, 0.27, 0.37, 0.54, 0.61],
      hem: [0.37, 0.56, 0.65, 0.8],
      strength: [0, 1.7, 0.55],
      portraitMotion: {
        start: 0.24,
        duration: 1.13,
        easing: 'smoothstep',
        pivot: [0.55, 0.66],
        blendY: [0.6, 0.8],
        angle: -0.035,
        travel: [-0.006, -0.006],
        attachedPart: {
          start: 0.35,
          duration: 1.04,
          easing: 'smoothstep',
          pivot: [0.68, 0.42],
          feather: 0.024,
          region: [
            [0.65, 0.41],
            [0.76, 0.4],
            [1.04, 0.63],
            [1.04, 0.79],
            [0.78, 0.79],
            [0.7, 0.56],
          ],
          angles: [0.075, 0],
        },
      },
    },
  },
  {
    id: 'kinako',
    blink: {
      loadArt: () => import('../components/game/card-entrance/kinako-blink.png'),
      faces: [
        {
          start: 0.98,
          close: 0.055,
          hold: 0.035,
          open: 0.11,
          eyes: [
            {
              target: [594 / 1061, 478 / 1483, 72 / 1061, 60 / 1483],
              half: [553 / 1774, 230 / 887, 230 / 1774, 190 / 887],
              closed: [553 / 1774, 674 / 887, 230 / 1774, 190 / 887],
            },
            {
              target: [673 / 1061, 455 / 1483, 88 / 1061, 72 / 1483],
              half: [890 / 1774, 147 / 887, 291 / 1774, 238 / 887],
              closed: [890 / 1774, 590 / 887, 291 / 1774, 238 / 887],
            },
          ],
        },
      ],
    },
    baseCode: entranceCards.kinako,
    name: '樱小路希奈子',
    loadArt: () => import('../components/game/card-entrance/kinako.png'),
    artAspectRatio: '1061 / 1483',
    center: '-51%',
    mobileHeight: 'min(74%, 110vw)',
    mobileSkipPosition: 'below-name',
    light: '#f8d86f77',
    mesh: {
      hair: [0, 0.01, 0.9, 0.99],
      hairEnd: [0.99, 1],
      rightHair: [0.83, 0.91, 0.43, 0.46, 0.55, 0.58],
      hem: [0, 1, 0, 1],
      strength: [0, 1.8, 0],
      portraitMotion: {
        start: 0.25,
        duration: 1.12,
        easing: 'smoothstep',
        pivot: [0.65, 0.59],
        blendY: [0.53, 0.69],
        fixedCorner: [0.49, 0.57, 0.32, 0.37],
        angle: 0.028,
        travel: [0.004, -0.007],
        attachedPart: {
          start: 0.38,
          duration: 1.02,
          easing: 'smoothstep',
          pivot: [0.76, 0.57],
          feather: 0.018,
          region: [
            [0.78, 0.54],
            [1.04, 0.52],
            [1.04, 0.68],
            [0.76, 0.69],
            [0.71, 0.62],
          ],
          angles: [-0.09, 0],
        },
      },
    },
  },
  {
    id: 'mei',
    baseCode: entranceCards.mei,
    name: '米女芽衣',
    loadArt: () => import('../components/game/card-entrance/mei.png'),
    artAspectRatio: '1061 / 1483',
    center: '-51%',
    mobileHeight: 'min(77%, 110vw)',
    light: '#edb49477',
    mesh: {
      // The left-side hair mask would cross the gripping hand and glass stem.
      // Leave that side rigid with the torso; only the right loose lock follows.
      // Preserve the existing wink and the independent invitation gesture.
      hair: [0, 0.01, 0.9, 0.99],
      hairEnd: [1, 1.01],
      rightHair: [0.79, 0.87, 0.25, 0.28, 0.34, 0.37],
      hem: [0, 1, 0, 1],
      strength: [0, 1.1, 0],
      portraitMotion: {
        start: 0.23,
        duration: 1.13,
        easing: 'smoothstep',
        pivot: [0.48, 0.61],
        blendY: [0.6, 0.78],
        angle: 0.034,
        travel: [0.004, -0.007],
        attachedPart: {
          start: 0.3,
          duration: 1.02,
          easing: 'smoothstep',
          pivot: [0.66, 0.33],
          feather: 0.025,
          region: [
            [0.62, 0.3],
            [0.78, 0.31],
            [1.02, 0.4],
            [1.03, 0.63],
            [0.7, 0.63],
            [0.59, 0.45],
          ],
          angles: [0.22, -0.04],
        },
      },
    },
  },
  {
    id: 'maki',
    blink: {
      loadArt: () => import('../components/game/card-entrance/maki-blink.png'),
      faces: [
        {
          start: 1.04,
          close: 0.055,
          hold: 0.035,
          open: 0.11,
          eyes: [
            {
              target: [414 / 1062, 265 / 1482, 101 / 1062, 70 / 1482],
              half: [238 / 1247, 353 / 1261, 281 / 1247, 195 / 1261],
              closed: [238 / 1247, 946 / 1261, 281 / 1247, 195 / 1261],
            },
            {
              target: [563 / 1062, 223 / 1482, 104 / 1062, 73 / 1482],
              half: [713 / 1247, 237 / 1261, 307 / 1247, 215 / 1261],
              closed: [713 / 1247, 828 / 1261, 307 / 1247, 215 / 1261],
            },
          ],
        },
      ],
    },
    baseCode: entranceCards.maki,
    name: '西木野真姬',
    loadArt: () => import('../components/game/card-entrance/maki.png'),
    artAspectRatio: '1062 / 1482',
    center: '-50%',
    mobileHeight: 'min(75%, 108vw)',
    light: '#dfa3bc77',
    mesh: {
      // Keep glass/table stationary; the cheek and touching hand lean together.
      hair: [0, 0.01, 0.9, 0.99],
      hairEnd: [0.99, 1],
      rightHair: [0.7, 0.77, 0.27, 0.29, 0.33, 0.36],
      hem: [0, 1, 0, 1],
      strength: [0, 0.7, 0],
      portraitMotion: {
        start: 0.25,
        duration: 1.1,
        easing: 'smoothstep',
        pivot: [0.5, 0.39],
        blendY: [0.31, 0.43],
        angle: -0.034,
        travel: [-0.005, -0.003],
      },
    },
  },
  {
    id: 'hime-bp6',
    blink: {
      loadArt: () => import('../components/game/card-entrance/hime-bp6-blink.png'),
      faces: [
        {
          start: 0.87,
          close: 0.055,
          hold: 0.035,
          open: 0.11,
          eyes: [
            {
              target: [351 / 2168, 208 / 725, 67 / 2168, 62 / 725],
              half: [513 / 1774, 148 / 887, 335 / 1774, 280 / 887],
              closed: [513 / 1774, 590 / 887, 335 / 1774, 280 / 887],
            },
            {
              target: [458 / 2168, 175 / 725, 69 / 2168, 62 / 725],
              half: [963 / 1774, 47 / 887, 343 / 1774, 300 / 887],
              closed: [963 / 1774, 489 / 887, 343 / 1774, 300 / 887],
            },
          ],
        },
      ],
    },
    baseCode: entranceCards['hime-bp6'],
    name: '安养寺姬芽',
    loadArt: () => import('../components/game/card-entrance/hime-bp6-layers.png'),
    artAspectRatio: '900 / 925',
    center: '-50%',
    mobileHeight: 'min(74%, 92vw)',
    mobileSkipPosition: 'below-name',
    light: '#edb9d777',
    mesh: {
      hair: [0.16, 0.3, 0.52, 0.64],
      hairEnd: [0.85, 0.98],
      hem: [0, 1, 0, 1],
      strength: [0, 1.1, 0],
      armLayers: {
        bodyCrop: [0, 0, 800 / 2168, 1],
        bodyPlacement: [0, 0, 800 / 900, 725 / 925],
        armCrop: [865 / 2168, 0, 350 / 2168, 1],
        armPlacement: [0.62, 0.05, 350 / 900, 725 / 925],
        pivot: [0.8, 0.74],
        offset: [0, 0],
        angles: [0.06, -0.2],
        armTravel: [-0.015, -0.015],
        sleeveAnchor: [0.8, 0.74, 0.12],
        rigidBodyFollow: true,
        start: 0.28,
        duration: 1.06,
        easing: 'smoothstep',
        bodyMotion: { start: 0.15, duration: 1.05, easing: 'smoothstep' },
        bodyPivot: [0.52, 0.56],
        bodyBlendY: [0.6, 0.8],
        bodyAngle: 0.025,
        bodyLift: 0.003,
        foreground: {
          crop: [1300 / 2168, 0, 868 / 2168, 1],
          placement: [-0.04, 0.216, 868 / 900, 725 / 925],
        },
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
