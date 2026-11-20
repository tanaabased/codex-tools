#!/usr/bin/env bun
import { iconBase64 } from '../../../shared.js' with { type: 'macro' };
import svg from '../assets/icon.svg' with { type: 'text' };

process.stdout.write(JSON.stringify([svg, iconBase64()]) + '\n');
