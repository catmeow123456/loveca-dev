export function toTransport<T>(value: T): unknown {
  return serializeTransportValue(value);
}

export function fromTransport<T>(value: unknown): T {
  return deserializeTransportValue(value) as T;
}

function serializeTransportValue(value: unknown): unknown {
  if (value instanceof Map) {
    return {
      __transportType: 'Map',
      entries: Array.from(value.entries()).map(([key, entryValue]) => [
        serializeTransportValue(key),
        serializeTransportValue(entryValue),
      ]),
    };
  }

  if (Array.isArray(value)) {
    return value.map((entry) => serializeTransportValue(entry));
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value).map(([key, entryValue]) => [
      key,
      serializeTransportValue(entryValue),
    ]);
    return Object.fromEntries(entries);
  }

  return value;
}

function deserializeTransportValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => deserializeTransportValue(entry));
  }

  if (value && typeof value === 'object') {
    const candidate = value as { __transportType?: string; entries?: unknown[] };
    if (candidate.__transportType === 'Map' && Array.isArray(candidate.entries)) {
      return new Map(
        candidate.entries.map((entry) => {
          const [key, entryValue] = (entry as [unknown, unknown]) ?? [undefined, undefined];
          return [deserializeTransportValue(key), deserializeTransportValue(entryValue)];
        })
      );
    }

    return Object.fromEntries(
      Object.entries(value).map(([key, entryValue]) => [key, deserializeTransportValue(entryValue)])
    );
  }

  return value;
}
