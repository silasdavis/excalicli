/**
 * SVG scene data extraction.
 *
 * Excalidraw embeds scene JSON in SVG files inside a <metadata> element
 * using comment delimiters:
 *
 *   <metadata>
 *     <!-- payload-type:application/vnd.excalidraw+json -->
 *     <!-- payload-version:2 -->
 *     <!-- payload-start -->
 *     <base64-encoded-compressed-scene-json>
 *     <!-- payload-end -->
 *   </metadata>
 */

import { Effect, Option } from "effect";
import { decodeSvgPayload } from "./decode.ts";
import { encodeSceneData } from "./encode.ts";
import type { DecodeError, EncodeError } from "./errors.ts";

const EXCALIDRAW_MIME = "application/vnd.excalidraw+json";
const PAYLOAD_REGEX =
  /<!-- payload-start -->\s*(.+?)\s*<!-- payload-end -->/s;
const VERSION_REGEX = /<!-- payload-version:(\d+) -->/;

/**
 * Extract embedded excalidraw scene JSON from an SVG string.
 * Returns the raw scene JSON string, or None if no embedded data found.
 */
export const extractSceneFromSvg = (
  svgContent: string,
): Effect.Effect<Option.Option<string>, DecodeError> =>
  Effect.gen(function* () {
    if (!svgContent.includes(`payload-type:${EXCALIDRAW_MIME}`)) {
      return Option.none();
    }

    const payloadMatch = svgContent.match(PAYLOAD_REGEX);
    if (!payloadMatch?.[1]) {
      return Option.none();
    }

    const versionMatch = svgContent.match(VERSION_REGEX);
    const version = versionMatch?.[1] ?? "1";
    const isByteString = version !== "1";

    const sceneJson = yield* decodeSvgPayload(payloadMatch[1], isByteString);
    return Option.some(sceneJson);
  });

const METADATA_REGEX = /<metadata>[\s\S]*?<\/metadata>/;

/**
 * Embed excalidraw scene JSON into an SVG string.
 * Replaces or inserts a <metadata> block with the encoded payload.
 */
export const embedSceneInSvg = (
  svgContent: string,
  sceneJson: string,
): Effect.Effect<string, EncodeError> =>
  Effect.gen(function* () {
    const envelopeJson = yield* encodeSceneData(sceneJson);
    const base64Payload = btoa(envelopeJson);

    const metadataBlock = [
      "<metadata>",
      `  <!-- payload-type:${EXCALIDRAW_MIME} -->`,
      "  <!-- payload-version:2 -->",
      "  <!-- payload-start -->",
      `  ${base64Payload}`,
      "  <!-- payload-end -->",
      "</metadata>",
    ].join("\n");

    // Replace existing <metadata> or insert after opening <svg> tag
    if (METADATA_REGEX.test(svgContent)) {
      return svgContent.replace(METADATA_REGEX, metadataBlock);
    }

    // Insert after the <svg ...> opening tag
    const svgOpenEnd = svgContent.indexOf(">") + 1;
    return (
      svgContent.slice(0, svgOpenEnd) +
      metadataBlock +
      svgContent.slice(svgOpenEnd)
    );
  });
