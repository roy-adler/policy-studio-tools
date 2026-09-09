const TOKEN_MAP: Array<[RegExp, string]> = [
  [/\(slash\)/gi, '/'],
  [/\(bslash\)/gi, '\\'],
  [/\(quote\)/gi, '"'],
  [/\(colon\)/gi, ':'],
  [/\(lt\)/gi, '<'],
  [/\(gt\)/gi, '>'],
  [/\(asterisk\)/gi, '*'],
  [/\(qmark\)/gi, '?'],
  [/\(pipe\)/gi, '|'],
];

const HTTP_METHODS = new Set([
  'GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'TRACE', 'CONNECT',
]);

export function decodeFilenameTokens(input: string): string {
  let out = input;
  for (const [pattern, replacement] of TOKEN_MAP) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

export function stripCollisionSuffix(basenameWithoutExt: string): string {
  return basenameWithoutExt.replace(/ (\d+)$/, '');
}

export function parseFilenameKeyFields(basenameWithoutExt: string): {
  keys: string[];
  httpMethod?: string;
  uriMatcher?: string;
} {
  const stripped = stripCollisionSuffix(basenameWithoutExt);
  const keys = stripped
    .split(',')
    .map((part) => decodeFilenameTokens(part.trim()))
    .filter(Boolean);
  let httpMethod: string | undefined;
  let uriMatcher: string | undefined;
  for (const key of keys) {
    if (key === '*') {
      uriMatcher = '*';
      continue;
    }
    const upper = key.toUpperCase();
    if (HTTP_METHODS.has(upper)) {
      httpMethod = upper;
    }
  }
  return { keys, httpMethod, uriMatcher };
}
