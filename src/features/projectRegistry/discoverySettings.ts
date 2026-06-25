import type { DiscoverySettings } from './types';

export const DEFAULT_DISCOVERY_SETTINGS: DiscoverySettings = {
  scanDepth: 10,
  includePaths: ['**'],
  excludePaths: [
    '**/node_modules/**',
    '**/.git/**',
    '**/out/**',
    '**/dist/**',
    '**/build/**',
  ],
  autoDiscover: true,
};

export const CONFIG_SCAN_DEPTH = 'policyStudio.projects.scanDepth';
export const CONFIG_INCLUDE_PATHS = 'policyStudio.projects.includePaths';
export const CONFIG_EXCLUDE_PATHS = 'policyStudio.projects.excludePaths';
export const CONFIG_AUTO_DISCOVER = 'policyStudio.projects.autoDiscover';

export function readDiscoverySettings(
  getConfig: <T>(key: string, defaultValue: T) => T,
): DiscoverySettings {
  return {
    scanDepth: getConfig(CONFIG_SCAN_DEPTH, DEFAULT_DISCOVERY_SETTINGS.scanDepth),
    includePaths: getConfig(CONFIG_INCLUDE_PATHS, DEFAULT_DISCOVERY_SETTINGS.includePaths),
    excludePaths: getConfig(CONFIG_EXCLUDE_PATHS, DEFAULT_DISCOVERY_SETTINGS.excludePaths),
    autoDiscover: getConfig(CONFIG_AUTO_DISCOVER, DEFAULT_DISCOVERY_SETTINGS.autoDiscover),
  };
}
