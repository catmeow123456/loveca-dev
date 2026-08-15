const GROUP_NAME_ALIASES: Readonly<Record<string, string>> = {
  'Aqours!': 'Aqours',
};

export function normalizeCardSyncGroupNames(values: readonly string[]): string[] {
  return [
    ...new Set(
      values
        .map((value) => value.trim())
        .filter(Boolean)
        .map((value) => GROUP_NAME_ALIASES[value] ?? value)
    ),
  ];
}
