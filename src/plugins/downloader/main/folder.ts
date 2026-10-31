import { isAbsolute, win32 } from 'node:path';

// A folder saved on another OS must not become a relative directory here.
export const resolveDownloadFolder = (
  customFolder: string | undefined,
  fallback: string,
) =>
  customFolder &&
  isAbsolute(customFolder) &&
  (process.platform !== 'win32' || win32.parse(customFolder).root.length > 1)
    ? customFolder
    : fallback;
