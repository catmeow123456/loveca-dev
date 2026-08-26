export type RandomIntegerSource = (maxExclusive: number) => number;

/**
 * 生产默认随机源。
 *
 * 调用方必须传入正安全整数上界；返回值始终位于 [0, maxExclusive)。
 */
export const secureRandomInt: RandomIntegerSource = (maxExclusive) => {
  assertRandomUpperBound(maxExclusive);
  const array = new Uint32Array(1);
  globalThis.crypto.getRandomValues(array);
  return array[0] % maxExclusive;
};

export interface DecisionTapeSnapshot {
  readonly version: string;
  readonly cursor: number;
  readonly length: number;
}

/**
 * 版本化确定性随机决策带。
 *
 * 只供受信任场景、回放和确定性测试注入；决策带耗尽时立即失败，不能静默回退到生产随机。
 */
export class DecisionTapeRandomSource {
  readonly version: string;
  private readonly decisions: readonly number[];
  private cursor = 0;

  constructor(version: string, decisions: readonly number[]) {
    const normalizedVersion = version.trim();
    if (!normalizedVersion) {
      throw new Error('随机决策带版本不能为空');
    }
    if (decisions.some((decision) => !Number.isSafeInteger(decision) || decision < 0)) {
      throw new Error('随机决策带只能包含非负安全整数');
    }

    this.version = normalizedVersion;
    this.decisions = [...decisions];
  }

  readonly nextInt: RandomIntegerSource = (maxExclusive) => {
    assertRandomUpperBound(maxExclusive);
    const decision = this.decisions[this.cursor];
    if (decision === undefined) {
      throw new Error(
        `随机决策带已耗尽: version=${this.version} cursor=${this.cursor} maxExclusive=${maxExclusive}`
      );
    }

    this.cursor += 1;
    return decision % maxExclusive;
  };

  snapshot(): DecisionTapeSnapshot {
    return {
      version: this.version,
      cursor: this.cursor,
      length: this.decisions.length,
    };
  }
}

function assertRandomUpperBound(maxExclusive: number): void {
  if (!Number.isSafeInteger(maxExclusive) || maxExclusive <= 0) {
    throw new Error(`随机整数上界必须是正安全整数: ${maxExclusive}`);
  }
}
