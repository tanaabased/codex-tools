import { readFileSync } from 'node:fs';
import greeting from './greeting.txt' with { type: 'file' };
import { suffix } from '../../../shared.js';
import { line } from '../../inspector/lib/line.js';

process.stdout.write(
  line(readFileSync(new URL(greeting, import.meta.url), 'utf8').trim() + suffix()),
);
