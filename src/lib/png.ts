/**
 * PNG scene data extraction.
 *
 * Excalidraw embeds scene JSON in a PNG tEXt chunk with keyword
 * "application/vnd.excalidraw+json". The chunk value is a JSON-encoded
 * EncodedData envelope containing zlib-compressed scene data.
 */

import { Effect, Option, Schema } from "effect";

// These packages don't have type declarations
// @ts-expect-error no types
import extractChunks from "png-chunks-extract";
// @ts-expect-error no types
import { decode as decodeRawTextChunk, encode as encodeRawTextChunk } from "png-chunk-text";

import { decodePngMetadata } from "./decode.ts";
import { encodeSceneData } from "./encode.ts";
import { DecodeError, EncodeError } from "./errors.ts";

const EXCALIDRAW_MIME = "application/vnd.excalidraw+json";

const PngChunk = Schema.Struct({
  name: Schema.String,
  data: Schema.instanceOf(Uint8Array),
});

const PngChunks = Schema.Array(PngChunk);

const TextChunk = Schema.Struct({
  keyword: Schema.String,
  text: Schema.String,
});

const decodePngChunk = Schema.decodeUnknownSync(PngChunk);
const decodePngChunks = Schema.decodeUnknownSync(PngChunks);
const decodeTextChunk = Schema.decodeUnknownSync(TextChunk);

/**
 * Find the excalidraw tEXt chunk in a list of PNG chunks.
 */
const findExcalidrawChunk = (
  pngData: Uint8Array,
): Effect.Effect<Option.Option<string>, DecodeError> =>
  Effect.gen(function* () {
    const rawChunks = yield* Effect.try({
      try: () => decodePngChunks(extractChunks(pngData)),
      catch: (e) =>
        new DecodeError({ message: "Failed to parse PNG chunks", cause: e }),
    });

    for (const chunk of rawChunks) {
      if (chunk.name === "tEXt") {
        const textChunk = decodeTextChunk(decodeRawTextChunk(chunk.data));
        if (textChunk.keyword === EXCALIDRAW_MIME) {
          return Option.some(textChunk.text);
        }
      }
    }

    return Option.none();
  });

/**
 * Extract embedded excalidraw scene JSON from a PNG file.
 * Returns the raw scene JSON string, or None if no embedded data found.
 */
export const extractSceneFromPng = (
  pngData: Uint8Array,
): Effect.Effect<Option.Option<string>, DecodeError> =>
  Effect.gen(function* () {
    const metadataText = yield* findExcalidrawChunk(pngData);

    if (Option.isNone(metadataText)) {
      return Option.none();
    }

    const sceneJson = yield* decodePngMetadata(metadataText.value);
    return Option.some(sceneJson);
  });

// --- PNG chunk encoding utilities ---

const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i]!;
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Build a raw PNG chunk: 4-byte length + 4-byte type + data + 4-byte CRC.
 */
function buildRawChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const chunk = new Uint8Array(4 + 4 + data.length + 4);
  const view = new DataView(chunk.buffer);

  view.setUint32(0, data.length);
  chunk.set(typeBytes, 4);
  chunk.set(data, 8);

  // CRC over type + data
  const crcInput = new Uint8Array(4 + data.length);
  crcInput.set(typeBytes, 0);
  crcInput.set(data, 4);
  view.setUint32(8 + data.length, crc32(crcInput));

  return chunk;
}

/**
 * Reassemble parsed PNG chunks into a valid PNG file.
 */
function encodeChunks(
  chunks: ReadonlyArray<{ readonly name: string; readonly data: Uint8Array }>,
): Uint8Array {
  const rawChunks = chunks.map((c) => buildRawChunk(c.name, c.data));
  const totalLength =
    PNG_SIGNATURE.length + rawChunks.reduce((sum, c) => sum + c.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;

  result.set(PNG_SIGNATURE, offset);
  offset += PNG_SIGNATURE.length;

  for (const raw of rawChunks) {
    result.set(raw, offset);
    offset += raw.length;
  }

  return result;
}

/**
 * Embed excalidraw scene JSON into a PNG file.
 * Parses existing chunks, removes any existing excalidraw tEXt chunk,
 * inserts a new one before IEND, and re-encodes the PNG.
 */
export const embedSceneInPng = (
  pngData: Uint8Array,
  sceneJson: string,
): Effect.Effect<Uint8Array, DecodeError | EncodeError> =>
  Effect.gen(function* () {
    const rawChunks = yield* Effect.try({
      try: () =>
        decodePngChunks(extractChunks(pngData)) as Array<{
          name: string;
          data: Uint8Array;
        }>,
      catch: (e) =>
        new DecodeError({ message: "Failed to parse PNG chunks", cause: e }),
    });

    // Remove any existing excalidraw tEXt chunks
    const filtered = rawChunks.filter((chunk) => {
      if (chunk.name !== "tEXt") return true;
      const textChunk = decodeTextChunk(decodeRawTextChunk(chunk.data));
      return textChunk.keyword !== EXCALIDRAW_MIME;
    });

    // Encode the scene data into an envelope string
    const envelopeJson = yield* encodeSceneData(sceneJson);

    // Build the new tEXt chunk
    const newTextChunk = yield* Effect.try({
      try: () =>
        decodePngChunk(encodeRawTextChunk(EXCALIDRAW_MIME, envelopeJson)),
      catch: (e) =>
        new EncodeError({
          message: "Failed to encode PNG tEXt chunk",
          cause: e,
        }),
    });

    // Insert before IEND (last chunk)
    const iendIndex = filtered.findIndex((c) => c.name === "IEND");
    if (iendIndex === -1) {
      return yield* new DecodeError({
        message: "PNG is missing IEND chunk",
      });
    }

    const withScene = [
      ...filtered.slice(0, iendIndex),
      newTextChunk,
      ...filtered.slice(iendIndex),
    ];

    return yield* Effect.try({
      try: () => encodeChunks(withScene),
      catch: (e) =>
        new EncodeError({
          message: "Failed to re-encode PNG",
          cause: e,
        }),
    });
  });
