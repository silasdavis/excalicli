/**
 * Encoding pipeline for excalidraw scene data.
 *
 * Mirrors the decoding pipeline in decode.ts, but in reverse:
 *   1. Scene JSON string
 *   2. pako.deflate() -> Uint8Array
 *   3. Uint8Array -> "bstring" (each byte -> String.fromCharCode)
 *   4. Wrap in EncodedData envelope: { encoded, encoding, compressed, version }
 *   5. JSON.stringify the envelope
 */

import { Effect } from "effect";
import pako from "pako";
import { EncodeError } from "./errors.ts";

function encodeToBstring(data: Uint8Array): string {
  return Array.from(data, (byte) => String.fromCharCode(byte)).join("");
}

/**
 * Encode scene JSON into a compressed EncodedData envelope string.
 * This is the inverse of decodePngMetadata / decodeSvgPayload in decode.ts.
 */
export const encodeSceneData = (
  sceneJson: string,
): Effect.Effect<string, EncodeError> =>
  Effect.try({
    try: () => {
      const compressed = pako.deflate(sceneJson);
      const encoded = encodeToBstring(compressed);
      const envelope = {
        encoded,
        encoding: "bstring",
        compressed: true,
        version: "1",
      };
      return JSON.stringify(envelope);
    },
    catch: (e) =>
      new EncodeError({
        message: "Failed to encode scene data",
        cause: e,
      }),
  });
