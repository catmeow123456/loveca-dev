export interface PublicTableLifecycleEvent {
  readonly eventType: string;
  readonly eventKey: string;
  readonly userId?: string;
  readonly ticketId?: string;
  readonly reservationId?: string;
  readonly roomGeneration?: string;
  readonly matchId?: string;
  readonly detail?: Record<string, unknown>;
}

export function logPublicTableLifecycleEvent(event: PublicTableLifecycleEvent): void {
  try {
    console.info(
      JSON.stringify({
        scope: 'public_table',
        occurredAt: new Date().toISOString(),
        ...event,
        detail: event.detail ?? {},
      })
    );
  } catch {
    // Telemetry must never change matchmaking state or fail a committed operation.
  }
}
