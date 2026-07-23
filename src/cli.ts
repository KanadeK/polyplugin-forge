#!/usr/bin/env node

import { Command } from "commander";

import { VERSION } from "./version.js";

export function createProgram(): Command {
  return new Command()
    .name("polyplugin")
    .description(
      "Scaffold, validate, and compare plugins across MCP, VS Code, Chrome, and webhook targets."
    )
    .version(VERSION);
}

if (import.meta.url === new URL(process.argv[1] ?? "", "file:").href) {
  await createProgram().parseAsync(process.argv);
}
