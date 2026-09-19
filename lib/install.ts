import { installNpmPlugin } from './npm-install.ts';
import { performInstall } from './native-install.ts';
import type { InstallDependencies, InstallationResult, InstallOptions } from './install-types.ts';

/**
 * installs a local or npm-backed plugin while preserving unrelated codex state.
 *
 * dry-run mode validates local inputs and returns a plan without writing or starting child
 * processes. execution can create marketplace directories, mappings, and catalog entries before
 * invoking native codex. partial effects are reported and are not automatically rolled back.
 *
 * @param options source or npm selector, marketplace, codex home, and dry-run settings.
 * @param dependencies injectable environment and native/npm boundaries.
 * @returns a structured plan, completed and remaining operations, native results, and installation
 * readback.
 * @throws when selection, source metadata, paths, marketplace state, or configuration are invalid.
 */
export async function installPlugin(
  options: InstallOptions = {},
  dependencies: InstallDependencies = {},
): Promise<InstallationResult> {
  return options.npmSelector
    ? installNpmPlugin(options, dependencies)
    : performInstall(options, dependencies);
}
