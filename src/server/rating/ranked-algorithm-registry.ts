import {
  GLICKO1_PER_MATCH_SHADOW_V2,
  GLICKO1_PER_MATCH_V1,
  GLICKO1_PER_MATCH_V2,
  GLICKO1_PER_MATCH_V3,
} from './glicko.js';
import { GLICKO1_PER_MATCH_V4, type RankedRatingConfig } from './ranked-rating.js';

export interface RankedAlgorithmDescriptor {
  readonly algorithmVersion: string;
  readonly status: 'SHADOW_CANDIDATE' | 'FORMAL';
  readonly config: RankedRatingConfig;
}

const FORMAL_RANKED_CONFIGS: readonly RankedRatingConfig[] = Object.freeze([
  GLICKO1_PER_MATCH_V4,
  GLICKO1_PER_MATCH_V3,
  GLICKO1_PER_MATCH_V2,
  GLICKO1_PER_MATCH_V1,
]);

export const RANKED_ALGORITHM_DESCRIPTORS: readonly RankedAlgorithmDescriptor[] = Object.freeze([
  {
    algorithmVersion: GLICKO1_PER_MATCH_SHADOW_V2.algorithmVersion,
    status: 'SHADOW_CANDIDATE',
    config: GLICKO1_PER_MATCH_SHADOW_V2,
  },
  ...FORMAL_RANKED_CONFIGS.map((config) => ({
    algorithmVersion: config.algorithmVersion,
    status: 'FORMAL' as const,
    config,
  })),
]);

export class RankedAlgorithmRegistryError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 409
  ) {
    super(message);
    this.name = 'RankedAlgorithmRegistryError';
  }
}

export function getFormalRankedAlgorithmConfig(algorithmVersion: string): RankedRatingConfig {
  const config = FORMAL_RANKED_CONFIGS.find(
    (candidate) => candidate.algorithmVersion === algorithmVersion
  );
  if (!config) {
    throw new RankedAlgorithmRegistryError(
      'RANKED_FORMAL_ALGORITHM_UNAVAILABLE',
      `评分算法 ${algorithmVersion} 尚未发布为正式排位算法`
    );
  }
  return config;
}

export function hasFormalRankedAlgorithm(): boolean {
  return FORMAL_RANKED_CONFIGS.length > 0;
}
