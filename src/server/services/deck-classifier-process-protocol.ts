import type {
  DeckClassificationScopeMode,
  DeckClassifierPreviewView,
} from '../../online/deck-classifier-types.js';

export type DeckClassifierProcessRequest =
  | { kind: 'notify' }
  | { kind: 'preview'; id: string; revision: number; scopeMode: DeckClassificationScopeMode };
export type DeckClassifierProcessResponse =
  | { kind: 'preview-result'; id: string; result: DeckClassifierPreviewView }
  | { kind: 'preview-error'; id: string; message: string; code: string; statusCode: number };
