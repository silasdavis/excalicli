/**
 * Write excalidraw scenes to files with format-appropriate rendering.
 *
 * - .excalidraw / .json → write scene JSON directly
 * - .png → render to PNG + embed scene data
 * - .svg → render to SVG + embed scene data
 *
 * The --base variant skips rendering and embeds scene data into an
 * existing file's pixels (metadata-only replacement).
 */

import { Effect } from "effect";
import { detectFormat } from "./scene.ts";
import { embedSceneInPng } from "./png.ts";
import { embedSceneInSvg } from "./svg.ts";
import { renderToPng, renderToSvg } from "./render.ts";
import type {
  DecodeError,
  EncodeError,
  FileReadError,
  FileWriteError,
  RenderError,
  UnsupportedFormatError,
} from "./errors.ts";
import {
  FileReadError as FileReadErrorClass,
  FileWriteError as FileWriteErrorClass,
} from "./errors.ts";

/**
 * Write a scene to a file, rendering and embedding as appropriate for the format.
 *
 * For PNG/SVG outputs, the scene is rendered to pixels and the scene JSON
 * is embedded so the file can be re-opened in excalidraw.
 */
export const writeSceneToFile = (
  filePath: string,
  sceneJson: string,
): Effect.Effect<
  void,
  UnsupportedFormatError | RenderError | DecodeError | EncodeError | FileWriteError
> =>
  Effect.gen(function* () {
    const format = yield* detectFormat(filePath);

    switch (format) {
      case "excalidraw": {
        yield* Effect.tryPromise({
          try: () => Bun.write(filePath, sceneJson),
          catch: (e) => new FileWriteErrorClass({ filePath, cause: e }),
        });
        break;
      }

      case "png": {
        const pngData = yield* renderToPng(sceneJson);
        const withScene = yield* embedSceneInPng(pngData, sceneJson);
        yield* Effect.tryPromise({
          try: () => Bun.write(filePath, withScene),
          catch: (e) => new FileWriteErrorClass({ filePath, cause: e }),
        });
        break;
      }

      case "svg": {
        const svgString = yield* renderToSvg(sceneJson);
        const withScene = yield* embedSceneInSvg(svgString, sceneJson);
        yield* Effect.tryPromise({
          try: () => Bun.write(filePath, withScene),
          catch: (e) => new FileWriteErrorClass({ filePath, cause: e }),
        });
        break;
      }
    }
  });

/**
 * Embed scene data into an existing file without re-rendering.
 * Replaces metadata only, preserving the original pixels/rendering.
 *
 * For PNG: replaces the tEXt chunk with new scene data.
 * For SVG: replaces the <metadata> block with new scene data.
 * For .excalidraw: writes scene JSON directly (base is ignored).
 */
export const embedSceneInFile = (
  filePath: string,
  sceneJson: string,
  baseFilePath: string,
): Effect.Effect<
  void,
  UnsupportedFormatError | DecodeError | EncodeError | FileReadError | FileWriteError
> =>
  Effect.gen(function* () {
    const format = yield* detectFormat(filePath);

    switch (format) {
      case "excalidraw": {
        yield* Effect.tryPromise({
          try: () => Bun.write(filePath, sceneJson),
          catch: (e) => new FileWriteErrorClass({ filePath, cause: e }),
        });
        break;
      }

      case "png": {
        const baseData = yield* Effect.tryPromise({
          try: () => Bun.file(baseFilePath).arrayBuffer(),
          catch: (e) => new FileReadErrorClass({ filePath: baseFilePath, cause: e }),
        });
        const withScene = yield* embedSceneInPng(new Uint8Array(baseData), sceneJson);
        yield* Effect.tryPromise({
          try: () => Bun.write(filePath, withScene),
          catch: (e) => new FileWriteErrorClass({ filePath, cause: e }),
        });
        break;
      }

      case "svg": {
        const baseContent = yield* Effect.tryPromise({
          try: () => Bun.file(baseFilePath).text(),
          catch: (e) => new FileReadErrorClass({ filePath: baseFilePath, cause: e }),
        });
        const withScene = yield* embedSceneInSvg(baseContent, sceneJson);
        yield* Effect.tryPromise({
          try: () => Bun.write(filePath, withScene),
          catch: (e) => new FileWriteErrorClass({ filePath, cause: e }),
        });
        break;
      }
    }
  });
