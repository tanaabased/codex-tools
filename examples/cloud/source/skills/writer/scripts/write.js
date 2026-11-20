import { readFileSync } from 'node:fs';
import greeting from './greeting.txt' with { type: 'file' };
import { finish } from '../../../shared.js';
process.stdout.write(finish(readFileSync(new URL(greeting, import.meta.url), 'utf8').trim()));
