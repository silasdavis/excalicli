#!/usr/bin/env bun
import { Effect } from "effect";
import { Command } from "commander";
import { extractCommand } from "./commands/extract.ts";
import { infoCommand } from "./commands/info.ts";
import { writeCommand } from "./commands/write.ts";
import { convertCommand } from "./commands/convert.ts";

const program = new Command();

program
  .name("excalicli")
  .description("CLI tool for working with excalidraw files")
  .version("0.1.0");

program
  .command("extract")
  .description("Extract embedded excalidraw JSON from PNG/SVG")
  .argument("<input>", "Input file (.png, .svg, or .excalidraw)")
  .action(async (input: string) => {
    await Effect.runPromise(extractCommand(input));
  });

program
  .command("info")
  .description("Show metadata about an excalidraw file")
  .argument("<input>", "Input file (.png, .svg, or .excalidraw)")
  .action(async (input: string) => {
    await Effect.runPromise(infoCommand(input));
  });

program
  .command("write")
  .description("Render excalidraw scene to PNG/SVG with embedded scene data")
  .argument("<output>", "Output file (.png, .svg, or .excalidraw)")
  .requiredOption("-s, --scene <file>", "Scene JSON source (file path or - for stdin)")
  .option("-b, --base <file>", "Base file to embed into (skip re-rendering, metadata-only replacement)")
  .action(async (output: string, opts: { scene: string; base?: string }) => {
    await Effect.runPromise(writeCommand(output, opts.scene, opts.base));
  });

program
  .command("convert")
  .description("Convert between excalidraw file formats")
  .argument("<input>", "Input file (.png, .svg, or .excalidraw)")
  .requiredOption("-o, --output <file>", "Output file (.png, .svg, or .excalidraw)")
  .action(async (input: string, opts: { output: string }) => {
    await Effect.runPromise(convertCommand(input, opts.output));
  });

program
  .command("mcp")
  .description("Start MCP server for AI-assisted excalidraw editing")
  .action(async () => {
    const { startMcpServer } = await import("./mcp.ts");
    await startMcpServer();
  });

program
  .command("setup")
  .description("Register excalicli as an MCP server with Claude Code")
  .option("--scope <scope>", "MCP scope: user (default), project, or local", "user")
  .action(async (opts: { scope: string }) => {
    const { basename, resolve } = await import("path");

    // Determine how to invoke `excalicli mcp`.
    // process.execPath reliably returns the actual binary path, whereas
    // process.argv[0] points to the embedded bun runtime in compiled binaries.
    const execPath = resolve(process.execPath);
    const isBunRuntime =
      basename(execPath) === "bun" || basename(execPath) === "bun.exe";

    let command: string;
    let mcpArgs: string[];
    if (isBunRuntime) {
      // Dev mode: bun /abs/path/to/cli.ts mcp
      command = execPath;
      mcpArgs = [resolve(process.argv[1] ?? "src/cli.ts"), "mcp"];
    } else {
      // Compiled binary: /abs/path/to/excalicli mcp
      command = execPath;
      mcpArgs = ["mcp"];
    }

    console.error(`Registering excalicli MCP server (scope: ${opts.scope})...`);

    // Remove any existing entry first to make setup idempotent
    const remove = Bun.spawn(
      ["claude", "mcp", "remove", "--scope", opts.scope, "excalicli"],
      { stdout: "ignore", stderr: "ignore" },
    );
    await remove.exited;

    const args = [
      "claude",
      "mcp",
      "add",
      "--scope",
      opts.scope,
      "excalicli",
      "--",
      command,
      ...mcpArgs,
    ];

    console.error(`Running: ${args.join(" ")}`);

    const proc = Bun.spawn(args, {
      stdout: "inherit",
      stderr: "inherit",
    });

    const exitCode = await proc.exited;
    if (exitCode === 0) {
      console.error(
        `\nDone! excalicli MCP server is now available in Claude Code.`,
      );
      console.error(
        `Tools: excalidraw_read, excalidraw_write, excalidraw_info`,
      );
    } else {
      console.error(`\nFailed to register (exit code ${exitCode}).`);
      console.error(
        `Make sure 'claude' CLI is installed: https://docs.anthropic.com/en/docs/claude-code`,
      );
      process.exit(1);
    }
  });

program.parse();
