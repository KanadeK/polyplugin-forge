#!/usr/bin/env node

import { Command } from "commander";
import { pathToFileURL } from "node:url";

import { registerCommands } from "./commands/index.js";
import {
  CliFailure,
  createCliContext,
  type CliContextOptions
} from "./commands/shared.js";
import { VERSION } from "./version.js";

export interface CreateProgramOptions extends CliContextOptions {
  readonly exitOverride?: boolean;
}

export function createProgram(options: CreateProgramOptions = {}): Command {
  const context = createCliContext(options);
  const program = new Command()
    .name("polyplugin")
    .description(
      "Scaffold, validate, and compare plugins across MCP, VS Code, Chrome, and webhook targets."
    )
    .version(VERSION);
  program.configureOutput({
    writeOut: context.stdout,
    writeErr: context.stderr
  });
  if (options.exitOverride === true) {
    program.exitOverride();
  }
  registerCommands(program, context);
  return program;
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    await createProgram().parseAsync(process.argv);
  } catch (error) {
    if (error instanceof CliFailure) {
      if (!error.reported) {
        process.stderr.write(`${error.message}\n`);
      }
      process.exitCode = error.exitCode;
    } else {
      throw error;
    }
  }
}
