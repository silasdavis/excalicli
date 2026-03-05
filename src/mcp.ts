/**
 * MCP server for AI-assisted excalidraw editing.
 *
 * Exposes three tools over stdio JSON-RPC:
 * - excalidraw_read:  Extract scene JSON from a file
 * - excalidraw_write: Render scene JSON to a file (with embedded scene data)
 * - excalidraw_info:  Show scene metadata
 *
 * IMPORTANT: MCP stdio servers must never write to stdout (corrupts JSON-RPC).
 * All logging goes to stderr.
 */

import { Cause, Effect, Option } from "effect";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { loadSceneJson, loadScene, getSceneInfo } from "./lib/scene.ts";
import { writeSceneToFile } from "./lib/write.ts";

/**
 * Extract the tagged error from an Effect Cause and format it as a string.
 */
function formatCause(cause: Cause.Cause<unknown>): string {
  const failure = Cause.failureOption(cause);
  if (Option.isSome(failure)) {
    return formatError(failure.value as any);
  }
  return `Unexpected error: ${Cause.pretty(cause)}`;
}

function formatError(error: { readonly _tag: string; [key: string]: unknown }): string {
  switch (error._tag) {
    case "FileReadError":
      return `Cannot read file: ${(error as any).filePath}`;
    case "FileWriteError":
      return `Cannot write file: ${(error as any).filePath}`;
    case "NoSceneDataError":
      return `No excalidraw scene data found in ${(error as any).filePath} (${(error as any).format})`;
    case "UnsupportedFormatError":
      return `Unsupported file format: ${(error as any).filePath}. Use .png, .svg, .excalidraw, or .json`;
    case "DecodeError":
      return `Failed to decode scene data: ${(error as any).message}`;
    case "InvalidSceneError":
      return `Invalid excalidraw scene: ${(error as any).message}`;
    case "RenderError":
      return `Rendering failed: ${(error as any).message}`;
    case "EncodeError":
      return `Failed to encode scene data: ${(error as any).message}`;
    default:
      return `Error: ${JSON.stringify(error)}`;
  }
}

export async function startMcpServer(): Promise<void> {
  const server = new McpServer({
    name: "excalicli",
    version: "0.1.0",
  });

  server.tool(
    "excalidraw_read",
    "Extract excalidraw scene JSON from a PNG, SVG, or .excalidraw file. Returns the full scene JSON that can be edited and written back.",
    { path: z.string().describe("Path to the file to read (.png, .svg, .excalidraw, or .json)") },
    async ({ path }) => {
      const result = await Effect.runPromiseExit(loadSceneJson(path));
      if (result._tag === "Failure") {
        return {
          isError: true as const,
          content: [{ type: "text" as const, text: formatCause(result.cause as Cause.Cause<unknown>) }],
        };
      }

      // Pretty-print the JSON for readability
      const pretty = JSON.stringify(JSON.parse(result.value), null, 2);
      return {
        content: [{ type: "text" as const, text: pretty }],
      };
    },
  );

  server.tool(
    "excalidraw_write",
    "Write excalidraw scene JSON to a file. For PNG/SVG, renders the scene to pixels and embeds the scene data so the file can be reopened in excalidraw. For .excalidraw/.json, writes the JSON directly.",
    {
      path: z.string().describe("Output file path (.png, .svg, .excalidraw, or .json)"),
      scene: z.string().describe("The full excalidraw scene JSON string"),
    },
    async ({ path, scene }) => {
      const result = await Effect.runPromiseExit(writeSceneToFile(path, scene));
      if (result._tag === "Failure") {
        return {
          isError: true as const,
          content: [{ type: "text" as const, text: formatCause(result.cause as Cause.Cause<unknown>) }],
        };
      }

      return {
        content: [{ type: "text" as const, text: `Written to ${path}` }],
      };
    },
  );

  server.tool(
    "excalidraw_info",
    "Show metadata about an excalidraw file: element counts by type, dimensions, background color, etc.",
    { path: z.string().describe("Path to the file to inspect (.png, .svg, .excalidraw, or .json)") },
    async ({ path }) => {
      const result = await Effect.runPromiseExit(loadScene(path));
      if (result._tag === "Failure") {
        return {
          isError: true as const,
          content: [{ type: "text" as const, text: formatCause(result.cause as Cause.Cause<unknown>) }],
        };
      }

      const scene = result.value;
      const info = getSceneInfo(scene);

      const lines: string[] = [
        `Version:    ${info.version}`,
        `Source:     ${info.source}`,
        `Elements:   ${info.activeElementCount} active (${info.elementCount} total)`,
      ];

      if (Object.keys(info.elementsByType).length > 0) {
        lines.push("Types:");
        for (const [type, count] of Object.entries(info.elementsByType)) {
          lines.push(`  ${type}: ${count}`);
        }
      }

      if (info.boundingBox) {
        const { minX, minY, maxX, maxY } = info.boundingBox;
        const w = Math.round(maxX - minX);
        const h = Math.round(maxY - minY);
        lines.push(
          `Bounds:     ${w}x${h} (at ${Math.round(minX)},${Math.round(minY)})`,
        );
      }

      if (info.fileCount > 0) {
        lines.push(`Files:      ${info.fileCount}`);
      }

      const bg = info.appState.viewBackgroundColor;
      if (bg) {
        lines.push(`Background: ${bg}`);
      }

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
      };
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
