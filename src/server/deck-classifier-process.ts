import { pool } from './db/pool.js';
import { deckClassificationWorker } from './services/deck-classification-worker.js';
import {
  deckClassifierAdminService,
  DeckClassifierAdminServiceError,
} from './services/deck-classifier-admin-service.js';
import type {
  DeckClassifierProcessRequest,
  DeckClassifierProcessResponse,
} from './services/deck-classifier-process-protocol.js';

function send(message: DeckClassifierProcessResponse): void {
  if (process.connected) process.send?.(message);
}

process.on('message', (message: DeckClassifierProcessRequest) => {
  if (message.kind === 'notify') deckClassificationWorker.notify();
  else if (message.kind === 'preview') {
    void deckClassifierAdminService.previewRelease(message.revision, message.matchLimit).then(
      (result) => send({ kind: 'preview-result', id: message.id, result }),
      (error: unknown) =>
        send({
          kind: 'preview-error',
          id: message.id,
          message: error instanceof Error ? error.message : '分类预览失败',
          code:
            error instanceof DeckClassifierAdminServiceError
              ? error.code
              : 'DECK_CLASSIFIER_PREVIEW_FAILED',
          statusCode: error instanceof DeckClassifierAdminServiceError ? error.statusCode : 500,
        })
    );
  }
});

let stopping = false;
function stop(): void {
  if (stopping) return;
  stopping = true;
  deckClassificationWorker.stop();
  setTimeout(() => process.exit(1), 5_000).unref();
  void pool.end().finally(() => process.exit(0));
}
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
process.on('disconnect', stop);
deckClassificationWorker.start();
