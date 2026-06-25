import * as crypto from 'crypto';

export function createProjectId(rootPath: string): string {
  return crypto.createHash('sha256').update(rootPath).digest('hex').slice(0, 16);
}
