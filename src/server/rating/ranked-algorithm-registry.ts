import {
  GLICKO1_PER_MATCH_SHADOW_V2,
  GLICKO1_PER_MATCH_V1,
  GLICKO1_PER_MATCH_V2,
  type Glicko1Config,
} from './glicko.js';

export interface RankedAlgorithmDescriptor {
  readonly algorithmVersion: string;
  readonly status: 'SHADOW_CANDIDATE' | 'FORMAL';
  readonly config: Glicko1Config;
}

const FORMAL_RANKED_CONFIGS: readonly Glicko1Config[] = Object.freeze([
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

export function getFormalRankedAlgorithmConfig(algorithmVersion: string): Glicko1Config {
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
