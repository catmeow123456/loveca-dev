import type { PublicSiteMaintenanceStatus } from './appConfig';

const SNAPSHOT_URL = '/site-status.json';

export interface PublicSiteStatusSnapshot {
  readonly schemaVersion: 1;
  readonly availability: 'OPEN' | 'MAINTENANCE';
  readonly generatedAt: string;
  readonly maintenance: PublicSiteMaintenanceStatus | null;
}

export type PublicSiteStatusSnapshotResult =
  | { readonly kind: 'VALID'; readonly snapshot: PublicSiteStatusSnapshot }
  | { readonly kind: 'MISSING' | 'INVALID' | 'UNAVAILABLE'; readonly snapshot: null };

export async function loadPublicSiteStatusSnapshot(): Promise<PublicSiteStatusSnapshotResult> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 5_000);
  try {
    const url = new URL(SNAPSHOT_URL, window.location.origin);
    url.searchParams.set('t', String(Date.now()));
    const response = await fetch(url, {
      cache: 'no-store',
      headers: { 'cache-control': 'no-cache' },
      signal: controller.signal,
    });
    if (response.status === 404) {
      return { kind: 'MISSING', snapshot: null };
    }
    if (!response.ok) {
      return { kind: 'UNAVAILABLE', snapshot: null };
    }
    const snapshot = parseSnapshot(await response.json());
    return snapshot ? { kind: 'VALID', snapshot } : { kind: 'INVALID', snapshot: null };
  } catch {
    return { kind: 'UNAVAILABLE', snapshot: null };
  } finally {
    window.clearTimeout(timeout);
  }
}

function parseSnapshot(value: unknown): PublicSiteStatusSnapshot | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (
    record.schemaVersion !== 1 ||
    (record.availability !== 'OPEN' && record.availability !== 'MAINTENANCE') ||
    typeof record.generatedAt !== 'string' ||
    !Number.isFinite(Date.parse(record.generatedAt))
  ) {
    return null;
  }

  const maintenance = parseMaintenance(record.maintenance);
  if (record.availability === 'MAINTENANCE' && !maintenance) return null;
  if (record.availability === 'OPEN' && record.maintenance !== null) return null;

  return {
    schemaVersion: 1,
    availability: record.availability,
    generatedAt: record.generatedAt,
    maintenance,
  };
}

function parseMaintenance(value: unknown): PublicSiteMaintenanceStatus | null {
  if (value === null) return null;
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (
    typeof record.id !== 'string' ||
    typeof record.title !== 'string' ||
    !record.title.trim() ||
    typeof record.summary !== 'string' ||
    !record.summary.trim() ||
    !isStringArray(record.impactScopes) ||
    !isStringArray(record.restrictions)
  ) {
    return null;
  }
  return {
    id: record.id,
    title: record.title,
    summary: record.summary,
    detail: nullableString(record.detail),
    startsAt: nullableString(record.startsAt),
    estimatedEndsAt: nullableString(record.estimatedEndsAt),
    restrictsNewGamesAt: nullableString(record.restrictsNewGamesAt),
    impactScopes: record.impactScopes,
    restrictions: record.restrictions,
    action: nullableString(record.action),
    updatedAt: nullableString(record.updatedAt),
  };
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}
