import { Effect } from "effect";
import {
  loadScene,
  getSceneInfo,
  detectFormat,
  type InputFormat,
} from "../lib/scene.ts";

export const infoCommand = (inputPath: string): Effect.Effect<void, never> =>
  Effect.gen(function* () {
    const format = yield* detectFormat(inputPath);
    const scene = yield* loadScene(inputPath);
    const info = getSceneInfo(scene);

    const formatLabel: Record<InputFormat, string> = {
      png: "PNG with embedded scene",
      svg: "SVG with embedded scene",
      excalidraw: "Excalidraw JSON",
    };

    console.log(`File:       ${inputPath}`);
    console.log(`Format:     ${formatLabel[format]}`);
    console.log(`Version:    ${info.version}`);
    console.log(`Source:     ${info.source}`);
    console.log(
      `Elements:   ${info.activeElementCount} active (${info.elementCount} total)`,
    );

    if (Object.keys(info.elementsByType).length > 0) {
      console.log(`Types:`);
      const sorted = Object.entries(info.elementsByType).sort(
        ([, a], [, b]) => b - a,
      );
      for (const [type, count] of sorted) {
        console.log(`  ${type}: ${count}`);
      }
    }

    if (info.boundingBox) {
      const bb = info.boundingBox;
      const width = Math.round(bb.maxX - bb.minX);
      const height = Math.round(bb.maxY - bb.minY);
      console.log(
        `Bounds:     ${width}x${height} (at ${Math.round(bb.minX)},${Math.round(bb.minY)})`,
      );
    }

    if (info.fileCount > 0) {
      console.log(`Files:      ${info.fileCount} embedded`);
    }

    if (info.appState.viewBackgroundColor) {
      console.log(`Background: ${info.appState.viewBackgroundColor}`);
    }
  }).pipe(
    Effect.catchAll((error) =>
      Effect.sync(() => {
        switch (error._tag) {
          case "NoSceneDataError":
            console.error(
              `Error: No embedded excalidraw scene data found in ${error.filePath}`,
            );
            break;
          case "UnsupportedFormatError":
            console.error(`Error: Unsupported file format: ${error.filePath}`);
            break;
          case "FileReadError":
            console.error(`Error: Could not read file: ${error.filePath}`);
            break;
          case "DecodeError":
            console.error(`Error: Failed to decode scene data: ${error.message}`);
            break;
          case "InvalidSceneError":
            console.error(`Error: ${error.message}`);
            break;
        }
        process.exit(1);
      }),
    ),
  );
