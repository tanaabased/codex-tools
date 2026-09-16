import { installNpmPlugin } from './npm-install.js';
import { performInstall } from './native-install.js';

export async function installPlugin(options = {}, dependencies = {}) {
  return options.npmSelector
    ? installNpmPlugin(options, dependencies)
    : performInstall(options, dependencies);
}
