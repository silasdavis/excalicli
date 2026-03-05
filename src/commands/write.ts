/**
 * Write command: render excalidraw scene JSON to PNG/SVG with embedded scene data.
 *
 * Usage:
 *   excalicli write output.png --scene scene.excalidraw
 *   excalicli write output.svg --scene scene.excalidraw
 *   excalicli write output.png --scene scene.excalidraw --base existing.png
 *   cat scene.json | excalicli write output.png --scene -
 */

import { Effect } from "effect";
import { writeSceneToFile, embedSceneInFile } from "../lib/write.ts";
import {
  DecodeError,
  EncodeError,
  FileReadError,
  FileWriteError,
  RenderError,
  UnsupportedFormatError,
} from "../lib/errors.ts";

export const writeCommand = (
  output: string,
  sceneSource: string,
  baseFile?: string,
): Effect.Effect<void, never> =>
  Effect.gen(function* () {
    // Read scene JSON from file or stdin
    const sceneJson = yield* Effect.tryPromise({
      try: async () => {
        if (sceneSource === "-") {
          return await Bun.stdin.text();
        }
        return await Bun.file(sceneSource).text();
      },
      catch: (e) => new FileReadError({ filePath: sceneSource, cause: e }),
    });

    if (baseFile) {
      yield* embedSceneInFile(output, sceneJson, baseFile);
    } else {
      yield* writeSceneToFile(output, sceneJson);
    }

    const stderr = Bun.stderr.writer();
    stderr.write(`Written to ${output}\n`);
    stderr.flush();
  }).pipe(
    Effect.catchAll((error) => {
      const stderr = Bun.stderr.writer();
      switch (error._tag) {
        case "FileReadError":
          stderr.write(`Error: Cannot read ${error.filePath}: ${error.cause}\n`);
          break;
        case "UnsupportedFormatError":
          stderr.write(
            `Error: Unsupported output format for ${error.filePath}\n`,
          );
          break;
        case "RenderError":
          stderr.write(`Error: Rendering failed: ${error.message}\n`);
          break;
        case "EncodeError":
          stderr.write(`Error: Encoding failed: ${error.message}\n`);
          break;
        case "DecodeError":
          stderr.write(`Error: Decode error: ${error.message}\n`);
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
