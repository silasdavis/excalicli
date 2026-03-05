/**
 * Excalidraw scene schema definitions and utilities.
 * Uses Effect Schema for type-safe parsing of untyped inputs.
 */

import { Effect, Option, Schema } from "effect";
import { extractSceneFromPng } from "./png.ts";
import { extractSceneFromSvg } from "./svg.ts";
import {
  DecodeError,
  FileReadError,
  InvalidSceneError,
  NoSceneDataError,
  UnsupportedFormatError,
} from "./errors.ts";

// --- Schema definitions ---

// Index signature preserves extra properties (strokeColor, angle, etc.)
// during round-trip so we don't lose data for fields we don't interpret.
const ExcalidrawElement = Schema.Struct({
  type: Schema.String,
  id: Schema.String,
  x: Schema.Number,
  y: Schema.Number,
  width: Schema.Number,
  height: Schema.Number,
  isDeleted: Schema.Boolean,
}, Schema.Record({ key: Schema.String, value: Schema.Unknown }));

const ExcalidrawFile = Schema.Struct({
  mimeType: Schema.String,
  id: Schema.String,
  dataURL: Schema.String,
  created: Schema.optional(Schema.Number),
});

export const ExcalidrawScene = Schema.Struct({
  type: Schema.Literal("excalidraw"),
  version: Schema.Number,
  source: Schema.String,
  elements: Schema.Array(ExcalidrawElement),
  appState: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  files: Schema.optional(
    Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  ),
});

export type ExcalidrawScene = Schema.Schema.Type<typeof ExcalidrawScene>;
export type ExcalidrawElement = Schema.Schema.Type<typeof ExcalidrawElement>;

// --- Format detection ---

export type InputFormat = "png" | "svg" | "excalidraw";

export const detectFormat = (
  filePath: string,
): Effect.Effect<InputFormat, UnsupportedFormatError> => {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".png")) return Effect.succeed("png");
  if (lower.endsWith(".svg")) return Effect.succeed("svg");
  if (lower.endsWith(".excalidraw") || lower.endsWith(".json")) {
    return Effect.succeed("excalidraw");
  }
  return Effect.fail(new UnsupportedFormatError({ filePath }));
};

// --- Scene loading ---

/**
 * Load scene JSON string from a file, handling format detection and extraction.
 */
export const loadSceneJson = (
  filePath: string,
): Effect.Effect<
  string,
  | UnsupportedFormatError
  | FileReadError
  | NoSceneDataError
  | DecodeError
> =>
  Effect.gen(function* () {
    const format = yield* detectFormat(filePath);

    switch (format) {
      case "png": {
        const data = yield* Effect.tryPromise({
          try: () => Bun.file(filePath).arrayBuffer(),
          catch: (e) => new FileReadError({ filePath, cause: e }),
        });
        const result = yield* extractSceneFromPng(new Uint8Array(data));
        if (Option.isNone(result)) {
          return yield* new NoSceneDataError({ filePath, format: "PNG" });
        }
        return result.value;
      }
      case "svg": {
        const content = yield* Effect.tryPromise({
          try: () => Bun.file(filePath).text(),
          catch: (e) => new FileReadError({ filePath, cause: e }),
        });
        const result = yield* extractSceneFromSvg(content);
        if (Option.isNone(result)) {
          return yield* new NoSceneDataError({ filePath, format: "SVG" });
        }
        return result.value;
      }
      case "excalidraw": {
        return yield* Effect.tryPromise({
          try: () => Bun.file(filePath).text(),
          catch: (e) => new FileReadError({ filePath, cause: e }),
        });
      }
    }
  });

/**
 * Load and parse a scene from a file.
 */
export const loadScene = (
  filePath: string,
): Effect.Effect<
  ExcalidrawScene,
  | UnsupportedFormatError
  | FileReadError
  | NoSceneDataError
  | DecodeError
  | InvalidSceneError
> =>
  Effect.gen(function* () {
    const json = yield* loadSceneJson(filePath);
    return yield* parseScene(json);
  });

/**
 * Parse and validate scene JSON string.
 */
export const parseScene = (
  json: string,
): Effect.Effect<ExcalidrawScene, InvalidSceneError> =>
  Effect.gen(function* () {
    const parsed = yield* Effect.try({
      try: () => JSON.parse(json),
      catch: (e) =>
        new InvalidSceneError({ message: "Invalid JSON", cause: e }),
    });

    const decode = Schema.decodeUnknown(ExcalidrawScene);
    const result = yield* Effect.mapError(decode(parsed), (parseError) =>
      new InvalidSceneError({
        message: `Invalid excalidraw scene: ${parseError.message}`,
        cause: parseError,
      }),
    );
    return result;
  });

// --- Scene info ---

export interface SceneInfo {
  version: number;
  source: string;
  elementCount: number;
  activeElementCount: number;
  elementsByType: Record<string, number>;
  fileCount: number;
  boundingBox: {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  } | null;
  appState: Record<string, unknown>;
}

export const getSceneInfo = (scene: ExcalidrawScene): SceneInfo => {
  const activeElements = scene.elements.filter((e) => !e.isDeleted);

  const elementsByType: Record<string, number> = {};
  for (const el of activeElements) {
    elementsByType[el.type] = (elementsByType[el.type] ?? 0) + 1;
  }

  let boundingBox: SceneInfo["boundingBox"] = null;
  if (activeElements.length > 0) {
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const el of activeElements) {
      minX = Math.min(minX, el.x);
      minY = Math.min(minY, el.y);
      maxX = Math.max(maxX, el.x + el.width);
      maxY = Math.max(maxY, el.y + el.height);
    }
    boundingBox = { minX, minY, maxX, maxY };
  }

  const fileCount = scene.files ? Object.keys(scene.files).length : 0;

  return {
    version: scene.version,
    source: scene.source,
    elementCount: scene.elements.length,
    activeElementCount: activeElements.length,
    elementsByType,
    fileCount,
    boundingBox,
    appState: scene.appState,
  };
};
