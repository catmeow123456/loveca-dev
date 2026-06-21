import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const workflowsRoot = fileURLToPath(
  new URL('../../src/application/card-effects/workflows/', import.meta.url)
);
const repoRoot = path.resolve(workflowsRoot, '../../../..');
const rawHandDiscardHelpers = [
  'discardHandCardsToWaitingRoomForPlayer',
  'discardOneHandCardToWaitingRoomForPlayer',
] as const;
const rawMemberSlotMovedHelpers = [
  'moveMemberBetweenSlots',
  'getNewMemberSlotMovedEvents',
] as const;
const rawMemberStateChangedEventHelpers = [
  'getNewMemberStateChangedEvents',
] as const;
const rawSourceMemberLeaveStageHelpers = [
  'getNewLeaveStageEvents',
  'SEND_SOURCE_MEMBER_TO_WAITING_ROOM',
] as const;
const disallowedWorkflowHelpers = [
  ...rawHandDiscardHelpers,
  ...rawMemberSlotMovedHelpers,
  ...rawMemberStateChangedEventHelpers,
  ...rawSourceMemberLeaveStageHelpers,
] as const;

type BoundaryViolation = {
  readonly filePath: string;
  readonly helperName: (typeof disallowedWorkflowHelpers)[number];
  readonly lines: readonly number[];
};

function collectTypeScriptFiles(directoryPath: string): readonly string[] {
  return readdirSync(directoryPath, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      return collectTypeScriptFiles(entryPath);
    }
    if (entry.isFile() && entry.name.endsWith('.ts')) {
      return [entryPath];
    }
    return [];
  });
}

function lineNumbersForIdentifier(source: string, identifier: string): readonly number[] {
  const escapedIdentifier = identifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const identifierPattern = new RegExp(`(^|[^A-Za-z0-9_$])${escapedIdentifier}([^A-Za-z0-9_$]|$)`);

  return source
    .split('\n')
    .flatMap((line, index) => {
      if (identifierPattern.test(line)) {
        return [index + 1];
      }
      return [];
    });
}

function boundaryMessageForHelper(helperName: (typeof disallowedWorkflowHelpers)[number]): string {
  if ((rawHandDiscardHelpers as readonly string[]).includes(helperName)) {
    return 'use enter-waiting-room trigger wrappers';
  }
  if ((rawMemberSlotMovedHelpers as readonly string[]).includes(helperName)) {
    return 'use member-slot-moved trigger wrapper';
  }
  if ((rawMemberStateChangedEventHelpers as readonly string[]).includes(helperName)) {
    return 'use member-state-changed trigger wrapper';
  }
  if ((rawSourceMemberLeaveStageHelpers as readonly string[]).includes(helperName)) {
    return 'use source-member leave-stage trigger wrapper';
  }
  return 'use runtime trigger wrappers';
}

function formatViolations(violations: readonly BoundaryViolation[]): string {
  if (violations.length === 0) {
    return 'Workflow modules should not call raw event runtime helpers.';
  }

  return [
    'Workflow modules must use runtime trigger wrappers instead of raw helpers:',
    ...violations.map((violation) => {
      const filePath = path.relative(repoRoot, violation.filePath);
      return `- ${filePath}: ${violation.helperName} on line(s) ${violation.lines.join(', ')}; ${boundaryMessageForHelper(violation.helperName)}.`;
    }),
  ].join('\n');
}

describe('card effect workflow boundaries', () => {
  it('keeps raw event helper call sites out of workflow modules', () => {
    const violations = collectTypeScriptFiles(workflowsRoot).flatMap((filePath) => {
      const source = readFileSync(filePath, 'utf8');
      return disallowedWorkflowHelpers.flatMap((helperName): readonly BoundaryViolation[] => {
        const lines = lineNumbersForIdentifier(source, helperName);
        if (lines.length === 0) {
          return [];
        }
        return [{ filePath, helperName, lines }];
      });
    });

    expect(violations, formatViolations(violations)).toEqual([]);
  });
});
