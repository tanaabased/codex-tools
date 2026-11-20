#!/usr/bin/env bun
import { iconBase64 } from '../../../shared.js' with { type: 'macro' };
import svg from '../assets/icon.svg' with { type: 'text' };

console.log(JSON.stringify([svg, iconBase64()]));
