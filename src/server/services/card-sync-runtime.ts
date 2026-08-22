import { cloudbaseCardSyncEngine } from './cloudbase-card-sync-engine.js';
import { CardSyncService } from './card-sync-service.js';
import { CardSyncWorker } from './card-sync-worker.js';

export const cardSyncService = new CardSyncService(cloudbaseCardSyncEngine);
export const cardSyncWorker = new CardSyncWorker(cloudbaseCardSyncEngine);
