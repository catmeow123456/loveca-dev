import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import {
  findRepoRoot,
  listFilesRecursively,
  loadDefinitions,
  parseScopeArguments,
  type AbilityDefinition,
} from './tooling.js';

const VISIBLE_FIELDS = new Set([
  'effectText',
  'stepText',
  'selectionLabel',
  'confirmSelectionLabel',
  'skipSelectionLabel',
  'label',
  'confirmLabel',
]);
const MIXED_PAYMENT_PATTERNS = [/支付(?:[1-9]\d*|\$\{[^}]+\})(?:个)?\[E\]/, /每支付\d+个(?!\[E\])/];

interface TextSource {
  readonly owner: string;
  readonly field: string;
  readonly text: string;
  readonly line?: number;
}

function propertyName(node: ts.PropertyName | undefined): string | undefined {
  if (!node) return undefined;
  if (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node)) {
    return node.text;
  }
  return undefined;
}

function collectReturnExpressions(node: ts.Node): ts.Expression[] {
  const expressions: ts.Expression[] = [];
  const visit = (child: ts.Node): void => {
    if (ts.isReturnStatement(child) && child.expression) expressions.push(child.expression);
    ts.forEachChild(child, visit);
  };
  visit(node);
  return expressions;
}

function expressionCandidates(
  expression: ts.Expression,
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
  seen = new Set<ts.Node>()
): { readonly text: string; readonly node: ts.Node }[] {
  if (seen.has(expression)) return [];
  seen.add(expression);
  const candidates: { text: string; node: ts.Node }[] = [
    { text: expression.getText(sourceFile), node: expression },
  ];

  const referenced = ts.isCallExpression(expression) ? expression.expression : expression;
  if (ts.isIdentifier(referenced)) {
    const symbol = checker.getSymbolAtLocation(referenced);
    for (const declaration of symbol?.declarations ?? []) {
      if (ts.isVariableDeclaration(declaration) && declaration.initializer) {
        candidates.push(
          ...expressionCandidates(declaration.initializer, checker, sourceFile, seen)
        );
      } else if (ts.isFunctionDeclaration(declaration) || ts.isFunctionExpression(declaration)) {
        for (const returned of collectReturnExpressions(declaration)) {
          candidates.push(...expressionCandidates(returned, checker, sourceFile, seen));
        }
      }
    }
  }

  const nestedExpressions: ts.Expression[] = [];
  if (ts.isConditionalExpression(expression)) {
    nestedExpressions.push(expression.whenTrue, expression.whenFalse);
  } else if (ts.isBinaryExpression(expression)) {
    nestedExpressions.push(expression.left, expression.right);
  } else if (
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isSatisfiesExpression(expression) ||
    ts.isNonNullExpression(expression)
  ) {
    nestedExpressions.push(expression.expression);
  }
  for (const nested of nestedExpressions) {
    candidates.push(...expressionCandidates(nested, checker, sourceFile, seen));
  }
  return candidates;
}

function collectSourceTexts(repoRoot: string): TextSource[] {
  const files = listFilesRecursively(
    repoRoot,
    [
      'src/application/card-effects/runtime',
      'src/application/card-effects/workflows',
      'src/application/effects',
    ],
    ['.ts']
  );
  const absoluteFiles = files.map((file) => join(repoRoot, file));
  const program = ts.createProgram(absoluteFiles, {
    allowJs: false,
    noEmit: true,
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
  });
  const checker = program.getTypeChecker();
  const output: TextSource[] = [];

  for (const relativePath of files) {
    const sourceFile = program.getSourceFile(join(repoRoot, relativePath));
    if (!sourceFile) continue;
    const visit = (node: ts.Node): void => {
      if (ts.isPropertyAssignment(node)) {
        const field = propertyName(node.name);
        if (field && VISIBLE_FIELDS.has(field)) {
          for (const candidate of expressionCandidates(node.initializer, checker, sourceFile)) {
            const line =
              sourceFile.getLineAndCharacterOfPosition(candidate.node.getStart(sourceFile)).line +
              1;
            output.push({ owner: relativePath, field, text: candidate.text, line });
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return output;
}

function collectDefinitionTexts(definitions: readonly AbilityDefinition[]): TextSource[] {
  return definitions.flatMap((definition) => {
    const activatedUi = (
      definition as AbilityDefinition & {
        readonly activatedUi?: { readonly title?: string; readonly text?: string };
      }
    ).activatedUi;
    return [
      { owner: definition.abilityId, field: 'effectText', text: definition.effectText ?? '' },
      { owner: definition.abilityId, field: 'activatedUi.title', text: activatedUi?.title ?? '' },
      { owner: definition.abilityId, field: 'activatedUi.text', text: activatedUi?.text ?? '' },
    ].filter((source) => source.text);
  });
}

function normalizeSourceText(text: string): string {
  if (
    (text.startsWith("'") && text.endsWith("'")) ||
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith('`') && text.endsWith('`'))
  ) {
    return text.slice(1, -1);
  }
  return text;
}

function hasLegacyPaymentText(text: string): boolean {
  if (MIXED_PAYMENT_PATTERNS.some((pattern) => pattern.test(text))) return true;
  const paymentSegments = text.match(/支付[^，。；：\n]{0,32}能量/g) ?? [];
  return paymentSegments.some(
    (segment) =>
      !segment.includes('[E]') &&
      !segment.includes('支付费用的能量') &&
      !/支付\$\{[^}]+\}的活跃能量/.test(segment)
  );
}

async function main(): Promise<void> {
  const repoRoot = findRepoRoot();
  const { flags } = parseScopeArguments(process.argv.slice(2));
  if (flags.has('--self-test')) {
    const cases: readonly [string, boolean][] = [
      ['支付1能量', true],
      ['支付2张活跃能量', true],
      ['支付2个[E]', true],
      ['每支付4个，此卡分数+1。', true],
      ['支付[E][E]', false],
      ['支付0个[E]', false],
      ['选择用于支付费用的能量卡', false],
      ['将2张能量变为活跃状态', false],
    ];
    const failures = cases.filter(([text, expected]) => hasLegacyPaymentText(text) !== expected);
    if (failures.length > 0) {
      throw new Error(`审计规则自测失败：${JSON.stringify(failures)}`);
    }
    console.log(`审计规则自测通过（${cases.length} 个样例）。`);
    return;
  }
  const sources = [
    ...collectDefinitionTexts(await loadDefinitions(repoRoot)),
    ...collectSourceTexts(repoRoot),
  ];
  const unique = new Map<string, TextSource>();
  for (const source of sources) {
    const normalized = normalizeSourceText(source.text);
    const key = `${source.owner}:${source.line ?? 0}:${source.field}:${normalized}`;
    unique.set(key, { ...source, text: normalized });
  }

  if (flags.has('--list-energy')) {
    const energyTexts = [...unique.values()].filter(
      (source) => source.text.includes('能量') || source.text.includes('[E]')
    );
    for (const source of energyTexts) {
      console.log(
        `${source.owner}${source.line ? `:${source.line}` : ''}\t${source.field}\t${source.text}`
      );
    }
    console.error(`列出 ${energyTexts.length} 条含“能量”或 [E] 的玩家可见文本。`);
    return;
  }

  const violations = [...unique.values()].filter((source) => hasLegacyPaymentText(source.text));
  if (violations.length === 0) {
    console.log(`玩家可见能量支付文本审计通过（检查 ${unique.size} 条候选文本）。`);
    return;
  }
  for (const violation of violations) {
    console.error(
      `${violation.owner}${violation.line ? `:${violation.line}` : ''} ${violation.field}: ${violation.text}`
    );
  }
  throw new Error(`发现 ${violations.length} 条旧式或混合能量支付文本。`);
}

await main();
