import { installNpmPlugin } from './npm-install.ts';
import { performInstall } from './native-install.ts';
import type { InstallDependencies, InstallationResult, InstallOptions } from './install-types.ts';

/** Installs a local or npm-backed plugin while preserving unrelated Codex state. */
export async function installPlugin(
  options: InstallOptions = {},
  dependencies: InstallDependencies = {},
): Promise<InstallationResult> {
  return options.npmSelector
    ? installNpmPlugin(options, dependencies)
    : performInstall(options, dependencies);
}
