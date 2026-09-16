#!/usr/bin/env bun
import { runCLI } from '../lib/run-cli.ts';
process.exitCode = await runCLI();
