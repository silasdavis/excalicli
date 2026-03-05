/**
 * Decoding pipeline for excalidraw embedded scene data.
 *
 * Excalidraw stores scene JSON in PNG/SVG files using this encoding:
 *   1. Scene JSON string
 *   2. pako.deflate() -> Uint8Array
 *   3. Uint8Array -> "bstring" (each byte -> String.fromCharCode)
 *   4. Wrap in EncodedData envelope: { version, encoding, compressed, encoded }
 *   5. JSON.stringify the envelope
 *   6. For SVG: additionally base64-encode the stringified envelope
 *
 * This module reverses that pipeline.
 */

import { Effect, Schema } from "effect";
import pako from "pako";
import { DecodeError } from "./errors.ts";

const EncodedData = Schema.Struct({
  encoded: Schema.String,
  encoding: Schema.Literal("bstring"),
  compressed: Schema.Boolean,
  version: Schema.String,
});


function decodeBstring(bstring: string): Uint8Array {
  const bytes = new Uint8Array(bstring.length);
  for (let i = 0; i < bstring.length; i++) {
    bytes[i] = bstring.charCodeAt(i);
  }
  return bytes;
}

function decodeEnvelope(
  envelope: Schema.Schema.Type<typeof EncodedData>,
): string {
  // encoding is always "bstring" (the only literal value in the schema)
  const bytes = decodeBstring(envelope.encoded);

  if (envelope.compressed) {
    return pako.inflate(bytes, { to: "string" });
  }

  return new TextDecoder().decode(bytes);
}

/**
 * Decode the raw metadata string from a PNG tEXt chunk.
 * The value is JSON.stringify({ encoded, encoding, compressed, version }).
 * Legacy files may contain raw scene JSON (no envelope).
 */
export const decodePngMetadata = (
  metadataText: string,
): Effect.Effect<string, DecodeError> =>
  Effect.gen(function* () {
    const parsed = yield* Effect.try({
      try: () => JSON.parse(metadataText),
      catch: (e) =>
        new DecodeError({
          message: "Failed to parse PNG metadata JSON",
          cause: e,
        }),
    });

    const decodeEncodedData = Schema.decodeUnknown(EncodedData);
    const envelopeResult = yield* Effect.either(decodeEncodedData(parsed));

    if (envelopeResult._tag === "Left") {
      // Not an EncodedData envelope - could be legacy raw scene JSON
      if (typeof parsed === "object" && parsed !== null && "type" in parsed) {
        return metadataText;
      }
      return yield* new DecodeError({
        message: "PNG metadata is neither an encoded envelope nor raw scene JSON",
        cause: envelopeResult.left,
      });
    }

    return yield* Effect.try({
      try: () => decodeEnvelope(envelopeResult.right),
      catch: (e) =>
        new DecodeError({
          message: "Failed to decode envelope data",
          cause: e,
        }),
    });
  });

/**
 * Decode the raw metadata string from an SVG payload.
 * The payload is base64(JSON.stringify({ encoded, encoding, compressed, version })).
 * The isByteString flag indicates payload-version:2 encoding.
 */
export const decodeSvgPayload = (
  base64Payload: string,
  isByteString: boolean,
): Effect.Effect<string, DecodeError> =>
  Effect.gen(function* () {
    const jsonStr = yield* Effect.try({
      try: () => base64ToString(base64Payload, isByteString),
      catch: (e) =>
        new DecodeError({
          message: "Failed to decode base64 SVG payload",
          cause: e,
        }),
    });

    const parsed = yield* Effect.try({
      try: () => JSON.parse(jsonStr),
      catch: (e) =>
        new DecodeError({
          message: "Failed to parse SVG payload JSON",
          cause: e,
        }),
    });

    const decodeEncodedData = Schema.decodeUnknown(EncodedData);
    const envelopeResult = yield* Effect.either(decodeEncodedData(parsed));

    if (envelopeResult._tag === "Left") {
      // Legacy format
      if (typeof parsed === "object" && parsed !== null && "type" in parsed) {
        return jsonStr;
      }
      return yield* new DecodeError({
        message: "SVG payload is neither an encoded envelope nor raw scene JSON",
        cause: envelopeResult.left,
      });
    }

    return yield* Effect.try({
      try: () => decodeEnvelope(envelopeResult.right),
      catch: (e) =>
        new DecodeError({
          message: "Failed to decode SVG envelope data",
          cause: e,
        }),
    });
  });

function base64ToString(base64: string, isByteString: boolean): string {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));

  if (isByteString) {
    return Array.from(bytes, (b) => String.fromCharCode(b)).join("");
  }

  return new TextDecoder().decode(bytes);
}
