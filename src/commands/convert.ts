/**
 * Convert command: convert between excalidraw file formats.
 *
 * Usage:
 *   excalicli convert diagram.png -o diagram.svg
 *   excalicli convert diagram.svg -o scene.excalidraw
 *   excalicli convert scene.excalidraw -o diagram.png
 */

import { Effect } from "effect";
import { loadSceneJson } from "../lib/scene.ts";
import { writeSceneToFile } from "../lib/write.ts";
import type {
  DecodeError,
  EncodeError,
  FileReadError,
  FileWriteError,
  NoSceneDataError,
  RenderError,
  UnsupportedFormatError,
} from "../lib/errors.ts";

export const convertCommand = (
  input: string,
  output: string,
): Effect.Effect<void, never> =>
  Effect.gen(function* () {
    const sceneJson = yield* loadSceneJson(input);
    yield* writeSceneToFile(output, sceneJson);

    const stderr = Bun.stderr.writer();
    stderr.write(`Converted ${input} → ${output}\n`);
    stderr.flush();
  }).pipe(
    Effect.catchAll((error) => {
      const stderr = Bun.stderr.writer();
      switch (error._tag) {
        case "NoSceneDataError":
          stderr.write(
            `Error: No embedded excalidraw scene data found in ${error.filePath}\n`,
          );
          break;
        case "UnsupportedFormatError":
          stderr.write(
            `Error: Unsupported file format: ${error.filePath}\n`,
          );
          break;
        case "FileReadError":
          stderr.write(`Error: Cannot read ${error.filePath}: ${error.cause}\n`);
          break;
        case "DecodeError":
          stderr.write(`Error: Failed to decode scene data: ${error.message}\n`);
          break;
        case "RenderError":
          stderr.write(`Error: Rendering failed: ${error.message}\n`);
          break;
        case "EncodeError":
          stderr.write(`Error: Encoding failed: ${error.message}\n`);
          break;
        case "FileWriteError":
          stderr.write(
            `Error: Cannot write ${error.filePath}: ${error.cause}\n`,
          );
          break;
      }
      stderr.flush();
      return Effect.sync(() => process.exit(1));
    }),
  );
