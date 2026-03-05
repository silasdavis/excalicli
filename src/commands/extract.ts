import { Effect } from "effect";
import { loadSceneJson } from "../lib/scene.ts";

export const extractCommand = (inputPath: string): Effect.Effect<void, never> =>
  Effect.gen(function* () {
    const sceneJson = yield* loadSceneJson(inputPath);

    // Pretty-print the JSON for readability
    const parsed = JSON.parse(sceneJson);
    process.stdout.write(JSON.stringify(parsed, null, 2) + "\n");
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
        }
        process.exit(1);
      }),
    ),
  );
