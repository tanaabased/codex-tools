import { readFile } from 'node:fs/promises';

import packageJson from '../../package.json' with { type: 'json' };
import validateToolchain from '../utils/validate-toolchain.ts';

const expected = (await readFile(new URL('../../.bun-version', import.meta.url), 'utf8')).trim();
validateToolchain(expected, packageJson.packageManager, Bun.version);
process.stdout.write(`Verified Bun ${expected}.\n`);
