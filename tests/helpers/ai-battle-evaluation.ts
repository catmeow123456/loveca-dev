import { createHash } from 'node:crypto';
import type { AiTraceExport, AiTraceMaterial } from '../../src/online/ai-battle-observation-types';
import type { AiKnowledgeMaterial } from '../../src/server/ai-battle/presets';

interface Message {
  readonly role: 'system' | 'user';
  readonly content: string;
}
const variants = ['RULES', 'TUTORIAL', 'HANDBOOK_A', 'HANDBOOK_B'] as const;
export type EvaluationVariant = (typeof variants)[number];
const hash = (text: string) => createHash('sha256').update(text).digest('hex');

/** Offline test preparation only. No model, database, authority or normal-command dependency. */
export function prepareAiEvaluation(
  bundle: AiTraceExport,
  decisionIds: readonly string[],
  alternateHandbook: AiKnowledgeMaterial
) {
  if (bundle.format !== 'loveca-ai-observation-v1') throw Error('Unsupported observation export');
  if (!decisionIds.length || new Set(decisionIds).size !== decisionIds.length)
    throw Error('Select distinct retained decision IDs');
  if (hash(alternateHandbook.content) !== alternateHandbook.sha256)
    throw Error('Alternate handbook hash mismatch');
  const materials = new Map(bundle.materials.map((material) => [material.id, material]));
  const cases = decisionIds.map((id) => {
    const decision = bundle.decisions.find((item) => item.id === id);
    if (!decision) throw Error(`Decision ${id} is not retained`);
    const requestEvent = decision.events.find((event) => event.stage === 'REQUEST');
    if (!requestEvent) throw Error(`Decision ${id} has no actual request`);
    const requestText = complete(materials.get(requestEvent.materialId));
    const request = JSON.parse(requestText) as {
      body: string;
      assembly: { sourceId: string; sourceSha256: string; messageIndex: number }[];
    };
    const body = JSON.parse(request.body) as { messages: Message[]; model: string };
    if (
      body.messages.length !== 6 ||
      body.messages[0]?.role !== 'system' ||
      body.messages.slice(1).some((message) => message.role !== 'user') ||
      request.assembly.length !== 4
    )
      throw Error(`Decision ${id} does not have the supported complete six-message assembly`);
    const sources = request.assembly.map((entry, index) => {
      if (entry.messageIndex !== index + 1) throw Error(`Decision ${id} has reordered sources`);
      const materialId = `source:${entry.sourceId}`;
      if (!decision.sourceMaterialIds.includes(materialId))
        throw Error(`Decision ${id} references an unrelated source`);
      const material = materials.get(materialId);
      const content = complete(material);
      if (
        entry.sourceSha256 !== hash(content) ||
        body.messages[entry.messageIndex]!.content !== `${material!.title}\n${content}`
      )
        throw Error(`Decision ${id} source differs from its actual request`);
      return { ...material!, content };
    });
    if (
      request.assembly[0]!.sourceId !== 'rules' ||
      request.assembly[1]!.sourceId !== 'tutorial' ||
      !request.assembly[3]!.sourceId.startsWith('deck:')
    )
      throw Error(`Decision ${id} has unsupported source roles`);
    const inputMessage = body.messages[5]!;
    const prefix = '本次决策；只使用本次引用\n';
    if (!inputMessage.content.startsWith(prefix)) throw Error('Missing captured decision input');
    const inputJson = inputMessage.content.slice(prefix.length);
    const input = JSON.parse(inputJson) as { purpose: string; space: { candidates: unknown[] } };
    if (input.purpose !== decision.purpose || !Array.isArray(input.space.candidates))
      throw Error('Captured input does not match its decision');
    const [control, rules, tutorial, handbook, ownDeck] = body.messages;
    const comparisons = variants.map((variant) => {
      const messages: Message[] = [control!, rules!];
      if (variant !== 'RULES') messages.push(tutorial!);
      if (variant === 'HANDBOOK_A') messages.push(handbook!);
      if (variant === 'HANDBOOK_B')
        messages.push({
          role: 'user',
          content: `${alternateHandbook.title}\n${alternateHandbook.content}`,
        });
      messages.push(ownDeck!, inputMessage);
      return { variant, messagesSha256: hash(JSON.stringify(messages)), messages };
    });
    return {
      id,
      purpose: decision.purpose,
      candidateCount: input.space.candidates.length,
      inputSha256: hash(inputJson),
      inputJson,
      capturedModel: body.model,
      capturedRequestSha256: hash(request.body),
      sources: sources.map(({ id: sourceId, title, source, sha256, content }) => ({
        id: sourceId,
        title,
        source,
        sha256,
        content,
      })),
      comparisons,
    };
  });
  // Interleave conditions within each repeat. A sample is pending until a real result is saved.
  const samples = Array.from({ length: 3 }, (_, repeat) =>
    cases.flatMap((item) =>
      variants.map((_, index) => ({
        id: `${item.id}-${variants[(index + repeat) % variants.length]}-${repeat + 1}`,
        caseId: item.id,
        variant: variants[(index + repeat) % variants.length]!,
        repeat: repeat + 1,
        status: 'NOT_RUN' as const,
      }))
    )
  ).flat();
  return {
    format: 'loveca-ai-fixed-input-plan-v1' as const,
    sourceMatchId: bundle.matchId,
    modelConfiguration: null,
    commandExecution: 'NONE' as const,
    alternateHandbook,
    cases,
    samples,
  };
}

function complete(material: AiTraceMaterial | undefined): string {
  if (
    !material ||
    material.status !== 'COMPLETE' ||
    material.content === null ||
    material.redactionCount !== 0 ||
    hash(material.content) !== material.sha256
  )
    throw Error('Evaluation requires complete, unredacted, hash-verified captured material');
  return material.content;
}
