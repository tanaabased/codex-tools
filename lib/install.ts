import { installNpmPlugin } from './npm-install.ts';
import { performInstall } from './native-install.ts';
import type { InstallDependencies, InstallationResult, InstallOptions } from './install-types.ts';

/**
 * Installs a local or npm-backed plugin while preserving unrelated Codex state.
 *
 * Dry-run mode validates local inputs and returns a plan without writing or starting child
 * processes. Execution can create marketplace directories, mappings, and catalog entries before
 * invoking native Codex. Partial effects are reported and are not automatically rolled back.
 *
 * @param options Source or npm selector, marketplace, Codex home, and dry-run settings.
 * @param dependencies Injectable environment and native/npm boundaries.
 * @returns A structured plan, completed and remaining operations, native results, and installation
 * readback.
 * @throws When selection, source metadata, paths, marketplace state, or configuration are invalid.
 */
export async function installPlugin(
  options: InstallOptions = {},
  dependencies: InstallDependencies = {},
): Promise<InstallationResult> {
  return options.npmSelector
    ? installNpmPlugin(options, dependencies)
    : performInstall(options, dependencies);
}
