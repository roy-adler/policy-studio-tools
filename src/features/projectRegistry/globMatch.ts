function toPosix(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

function escapeRegex(char: string): string {
  return char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
}

function globPatternToRegExp(pattern: string): RegExp {
  const posix = toPosix(pattern);
  let regex = '^';
  let i = 0;

  while (i < posix.length) {
    if (posix[i] === '*' && posix[i + 1] === '*') {
      if (posix[i + 2] === '/') {
        regex += '(?:.*/)?';
        i += 3;
      } else {
        regex += '.*';
        i += 2;
      }
    } else if (posix[i] === '*') {
      regex += '[^/]*';
      i += 1;
    } else if (posix[i] === '?') {
      regex += '[^/]';
      i += 1;
    } else {
      regex += escapeRegex(posix[i]);
      i += 1;
    }
  }

  regex += '$';
  return new RegExp(regex);
}

export function pathMatchesGlob(relativePath: string, pattern: string): boolean {
  const normalized = toPosix(relativePath).replace(/^\.\//, '');
  const regex = globPatternToRegExp(toPosix(pattern));
  return regex.test(normalized) || regex.test(`${normalized}/`);
}

export function pathMatchesAnyGlob(relativePath: string, patterns: string[]): boolean {
  if (patterns.length === 0) {
    return false;
  }
  return patterns.some((pattern) => pathMatchesGlob(relativePath, pattern));
}

export function isPathIncluded(relativePath: string, includePaths: string[]): boolean {
  if (includePaths.includes('**')) {
    return true;
  }
  return pathMatchesAnyGlob(relativePath, includePaths);
}

export function isPathExcluded(relativePath: string, excludePaths: string[]): boolean {
  return pathMatchesAnyGlob(relativePath, excludePaths);
}
