#!/usr/bin/env bun
import { runCLI } from '../lib/run-cli.js';
process.exitCode = await runCLI();
