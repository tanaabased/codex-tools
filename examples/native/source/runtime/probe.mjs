#!/usr/bin/env node
import { readFileSync } from 'node:fs';

const { message } = JSON.parse(readFileSync(new URL('./resource.json', import.meta.url), 'utf8'));
process.stdout.write(message + '\n');
