import type { InstallationResult, InstallDependencies, InstallOptions } from './install-types.ts';
import { installNpmPlugin } from './npm-install.ts';
import { performInstall } from './native-install.ts';

/**
 * installs a local or npm-backed plugin while preserving unrelated codex state.
 *
 * dry-run mode plans the installation without writes or child processes.
 *
 * @example
 * preview acquisition of a pinned npm release.
 *
 * ```js
 * import { installPlugin } from '@tanaab/codex-tools';
 *
 * const { plan } = await installPlugin({
 *   npmSelector: 'npm:@scope/plugin@1.2.3',
 *   dryRun: true,
 * });
 * console.table(plan, ['operation', 'condition']);
 * ```
 *
 * @returns the plan or result. on partial failure, completed steps can remain in effect.
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
