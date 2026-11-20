import { readFileSync } from 'node:fs';
import greeting from './greeting.txt' with { type: 'file' };
import { suffix } from '../../../shared.js' with { type: 'macro' };
process.stdout.write(readFileSync(new URL(greeting, import.meta.url), 'utf8').trim() + suffix());
