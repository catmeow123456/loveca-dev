import { findAiCardSelection } from '../../src/server/ai-battle/protocol';
import type { AiDecisionInput, AiSelection } from '../../src/server/ai-battle/protocol';

// This strategy reads exactly the transmitted visible input, never authority or command closures.
// Its purpose is exercising the full service/recording/UI flow, not evaluating model quality.
export function chooseAiTestSelection({ space, state, purpose }: AiDecisionInput): AiSelection {
  if (space.kind === 'CARDS') {
    if (space.groups)
      return findAiCardSelection({ ...space, canSkip: false, min: Math.max(1, space.min) });
    const candidates =
      purpose === 'MULLIGAN'
        ? space.candidates.filter((c) => (state.objects[c.objectId!]?.frontInfo?.cost ?? 0) > 4)
        : space.candidates;
    const count =
      purpose === 'MULLIGAN'
        ? candidates.length
        : Math.min(space.max, Math.max(space.min, candidates.length ? 1 : 0));
    return { kind: 'CARDS', cardRefs: candidates.slice(0, count).map((c) => c.ref) };
  }
  if (purpose === 'MAIN') {
    const plays = space.candidates.filter(
      (c) =>
        c.targetSlot &&
        c.replacedObjectIds?.every(
          (id) =>
            (state.objects[c.objectId!]?.frontInfo?.cost ?? 0) >
            (state.objects[id]?.frontInfo?.cost ?? 0)
        )
    );
    plays.sort(
      (a, b) =>
        (state.objects[b.objectId!]?.frontInfo?.cost ?? 0) -
        (state.objects[a.objectId!]?.frontInfo?.cost ?? 0)
    );
    const candidate =
      plays[0] ?? space.candidates.find((c) => c.description.startsWith('结束主要阶段'));
    if (!candidate) throw new Error('P5 MAIN fixture expected play or end');
    return { kind: 'ACTION', actionRef: candidate.ref };
  }
  if (purpose === 'LIVE_SET') {
    const alreadySet = space.candidates.some((c) => c.description.startsWith('撤回本次盖牌'));
    const live =
      !alreadySet &&
      space.candidates.find(
        (c) =>
          c.description.startsWith('里侧设置') &&
          state.objects[c.objectId!]?.frontInfo?.cardType === 'LIVE'
      );
    const candidate =
      live || space.candidates.find((c) => c.description.startsWith('完成 LIVE 设置'));
    if (!candidate) throw new Error('P5 LIVE fixture expected setup completion');
    return { kind: 'ACTION', actionRef: candidate.ref };
  }
  return { kind: 'ACTION', actionRef: space.candidates[0]!.ref };
}
