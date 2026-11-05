import { existsSync, statSync } from "node:fs";

export function isFile(path: string) {
  return existsSync(path) && statSync(path).isFile();
}
