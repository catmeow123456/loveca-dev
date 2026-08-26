import { TutorialSessionServiceError } from './tutorial-session-service.js';

interface TutorialAdmissionRecord {
  readonly createdAt: number;
}

interface ActiveTutorialRecord {
  readonly ip: string;
  expiresAt: number;
}

export interface TutorialAdmissionReservation {
  readonly id: symbol;
  readonly ip: string;
  readonly createdAt: number;
}

export interface TutorialAdmissionControllerOptions {
  readonly createWindowMs: number;
  readonly maxCreatesPerWindow: number;
  readonly maxActiveSessionsPerIp: number;
}

/**
 * 教程创建的进程内准入器。预占在异步加载场景之前完成，
 * 因此同一 IP 的并发首次请求也会计入上限。
 */
export class TutorialAdmissionController {
  private readonly admissionByIp = new Map<string, TutorialAdmissionRecord[]>();
  private readonly activeRuns = new Map<string, ActiveTutorialRecord>();
  private readonly pendingReservations = new Map<symbol, TutorialAdmissionReservation>();

  constructor(private readonly options: TutorialAdmissionControllerOptions) {
    assertPositiveSafeInteger(options.createWindowMs, '教程创建窗口');
    assertPositiveSafeInteger(options.maxCreatesPerWindow, '教程创建上限');
    assertPositiveSafeInteger(options.maxActiveSessionsPerIp, '教程活跃会话上限');
  }

  reserve(ip: string, now: number): TutorialAdmissionReservation {
    this.prune(now);
    const pendingForIp = [...this.pendingReservations.values()].filter(
      (reservation) => reservation.ip === ip
    ).length;
    const recentCreates = this.admissionByIp.get(ip) ?? [];
    if (recentCreates.length + pendingForIp >= this.options.maxCreatesPerWindow) {
      throw new TutorialSessionServiceError(
        'TUTORIAL_CREATE_RATE_LIMITED',
        '教程创建过于频繁，请稍后再试',
        429
      );
    }

    const activeCount = [...this.activeRuns.values()].filter((record) => record.ip === ip).length;
    if (activeCount + pendingForIp >= this.options.maxActiveSessionsPerIp) {
      throw new TutorialSessionServiceError(
        'TUTORIAL_ACTIVE_SESSION_LIMIT',
        '当前设备已有多个教程会话，请先关闭旧教程',
        429
      );
    }

    const reservation = { id: Symbol('tutorial-admission'), ip, createdAt: now };
    this.pendingReservations.set(reservation.id, reservation);
    return reservation;
  }

  commit(reservation: TutorialAdmissionReservation, runId: string, expiresAt: number): void {
    if (!this.pendingReservations.delete(reservation.id)) return;
    const records = this.admissionByIp.get(reservation.ip) ?? [];
    this.admissionByIp.set(reservation.ip, [...records, { createdAt: reservation.createdAt }]);
    this.activeRuns.set(runId, { ip: reservation.ip, expiresAt });
  }

  cancel(reservation: TutorialAdmissionReservation): void {
    this.pendingReservations.delete(reservation.id);
  }

  touch(runId: string, expiresAt: number): void {
    const active = this.activeRuns.get(runId);
    if (active) active.expiresAt = expiresAt;
  }

  remove(runId: string): void {
    this.activeRuns.delete(runId);
  }

  private prune(now: number): void {
    for (const [ip, records] of this.admissionByIp) {
      const retained = records.filter(
        (record) => record.createdAt + this.options.createWindowMs > now
      );
      if (retained.length > 0) this.admissionByIp.set(ip, retained);
      else this.admissionByIp.delete(ip);
    }
    for (const [runId, record] of this.activeRuns) {
      if (record.expiresAt <= now) this.activeRuns.delete(runId);
    }
  }
}

export interface TutorialMutationRateLimiterOptions {
  readonly windowMs: number;
  readonly maxRequestsPerRun: number;
  readonly maxRequestsPerIp: number;
}

/** 同时限制单个 run 和单个 IP 的命令/脚本变更请求。 */
export class TutorialMutationRateLimiter {
  private readonly requestsByRun = new Map<string, number[]>();
  private readonly requestsByIp = new Map<string, number[]>();

  constructor(private readonly options: TutorialMutationRateLimiterOptions) {
    assertPositiveSafeInteger(options.windowMs, '教程变更限流窗口');
    assertPositiveSafeInteger(options.maxRequestsPerRun, '单个教程会话请求上限');
    assertPositiveSafeInteger(options.maxRequestsPerIp, '单 IP 教程请求上限');
  }

  consume(ip: string, runId: string, now: number): void {
    this.prune(now);
    const runRecords = this.requestsByRun.get(runId) ?? [];
    const ipRecords = this.requestsByIp.get(ip) ?? [];
    if (
      runRecords.length >= this.options.maxRequestsPerRun ||
      ipRecords.length >= this.options.maxRequestsPerIp
    ) {
      throw new TutorialSessionServiceError(
        'TUTORIAL_REQUEST_RATE_LIMITED',
        '教程操作过于频繁，请稍后再试',
        429
      );
    }
    this.requestsByRun.set(runId, [...runRecords, now]);
    this.requestsByIp.set(ip, [...ipRecords, now]);
  }

  private prune(now: number): void {
    pruneWindowMap(this.requestsByRun, now, this.options.windowMs);
    pruneWindowMap(this.requestsByIp, now, this.options.windowMs);
  }
}

function pruneWindowMap(recordsByKey: Map<string, number[]>, now: number, windowMs: number): void {
  for (const [key, records] of recordsByKey) {
    const retained = records.filter((createdAt) => createdAt + windowMs > now);
    if (retained.length > 0) recordsByKey.set(key, retained);
    else recordsByKey.delete(key);
  }
}

function assertPositiveSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label}必须是正安全整数`);
  }
}
