import * as fs from 'node:fs';
import * as path from 'node:path';

export const DEFAULT_LOVECA_EXCEL_SOURCES_DIR = 'docs/card-data-sync/sources';

const LOVECA_EXCEL_FILE_PATTERN = /^loveca_(\d{14})\.xlsx$/;

export function resolveLovecaExcelPath(explicitPath: string | null): string {
  if (explicitPath) {
    return path.resolve(explicitPath);
  }

  return findLatestLovecaExcelPath(DEFAULT_LOVECA_EXCEL_SOURCES_DIR);
}

function findLatestLovecaExcelPath(sourcesDir: string): string {
  const absoluteSourcesDir = path.resolve(sourcesDir);
  let entries: fs.Dirent[];

  try {
    entries = fs.readdirSync(absoluteSourcesDir, { withFileTypes: true });
  } catch (error) {
    throw new Error(
      `Unable to read Loveca Excel sources directory: ${absoluteSourcesDir}. Provide --xlsx=... to use an explicit file.`
    );
  }

  const candidates = entries
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const match = entry.name.match(LOVECA_EXCEL_FILE_PATTERN);
      return match
        ? {
            timestamp: match[1],
            path: path.join(absoluteSourcesDir, entry.name),
          }
        : null;
    })
    .filter((candidate): candidate is { timestamp: string; path: string } => candidate !== null)
    .sort((left, right) => right.timestamp.localeCompare(left.timestamp));

  const latest = candidates[0];
  if (!latest) {
    throw new Error(
      `No Loveca Excel source files found in ${absoluteSourcesDir}. Expected loveca_YYYYMMDDHHMMSS.xlsx or provide --xlsx=...`
    );
  }

  return latest.path;
}
