#!/usr/bin/env bun
import { runCLI } from '../cli/run-cli.ts';

process.exitCode = await runCLI();
