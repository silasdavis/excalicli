import { test, expect, beforeAll } from "bun:test";
import { Effect, Option } from "effect";
import { extractSceneFromPng, embedSceneInPng } from "../src/lib/png.ts";
import { extractSceneFromSvg } from "../src/lib/svg.ts";
import { parseScene, getSceneInfo } from "../src/lib/scene.ts";

// Regenerate fixtures before tests to avoid IDE plugin interference
// (JetBrains excalidraw plugin can overwrite .excalidraw.png files)
beforeAll(async () => {
  const proc = Bun.spawn(["bun", "test/create-fixtures.ts"], {
    stdout: "ignore",
    stderr: "inherit",
  });
  const code = await proc.exited;
  if (code !== 0) {
    throw new Error("Failed to create test fixtures");
  }
});

async function loadExpectedScene() {
  return JSON.parse(
    await Bun.file("test/fixtures/test-scene.excalidraw").text(),
  );
}

test("extract scene from PNG", async () => {
  const expectedScene = await loadExpectedScene();
  const data = await Bun.file(
    "test/fixtures/test-scene.excalidraw.png",
  ).arrayBuffer();
  const result = await Effect.runPromise(
    extractSceneFromPng(new Uint8Array(data)),
  );

  expect(Option.isSome(result)).toBe(true);
  const parsed = JSON.parse(Option.getOrThrow(result));
  expect(parsed).toEqual(expectedScene);
});

test("extract scene from SVG", async () => {
  const expectedScene = await loadExpectedScene();
  const content = await Bun.file(
    "test/fixtures/test-scene.excalidraw.svg",
  ).text();
  const result = await Effect.runPromise(extractSceneFromSvg(content));

  expect(Option.isSome(result)).toBe(true);
  const parsed = JSON.parse(Option.getOrThrow(result));
  expect(parsed).toEqual(expectedScene);
});

test("PNG and SVG extractions match", async () => {
  const pngData = await Bun.file(
    "test/fixtures/test-scene.excalidraw.png",
  ).arrayBuffer();
  const pngResult = await Effect.runPromise(
    extractSceneFromPng(new Uint8Array(pngData)),
  );

  const svgContent = await Bun.file(
    "test/fixtures/test-scene.excalidraw.svg",
  ).text();
  const svgResult = await Effect.runPromise(extractSceneFromSvg(svgContent));

  expect(JSON.parse(Option.getOrThrow(pngResult))).toEqual(
    JSON.parse(Option.getOrThrow(svgResult)),
  );
});

test("extract from complex PNG (999 elements)", async () => {
  const data = await Bun.file(
    "test/fixtures/complex-scene.excalidraw.png",
  ).arrayBuffer();
  const result = await Effect.runPromise(
    extractSceneFromPng(new Uint8Array(data)),
  );

  expect(Option.isSome(result)).toBe(true);
  const parsed = JSON.parse(Option.getOrThrow(result));
  expect(parsed.type).toBe("excalidraw");
  expect(parsed.version).toBe(2);
  expect(Array.isArray(parsed.elements)).toBe(true);
  expect(parsed.elements.length).toBe(999);
});

test("PNG roundtrip: extract → embed → extract preserves scene data", async () => {
  const originalPngData = new Uint8Array(
    await Bun.file("test/fixtures/complex-scene.excalidraw.png").arrayBuffer(),
  );

  // Extract scene from original PNG
  const extractedOption = await Effect.runPromise(
    extractSceneFromPng(originalPngData),
  );
  expect(Option.isSome(extractedOption)).toBe(true);
  const sceneJson = Option.getOrThrow(extractedOption);
  const originalScene = JSON.parse(sceneJson);

  // Embed into a new PNG, then extract again
  const newPngData = await Effect.runPromise(
    embedSceneInPng(originalPngData, sceneJson),
  );
  const reExtractedOption = await Effect.runPromise(
    extractSceneFromPng(newPngData),
  );
  expect(Option.isSome(reExtractedOption)).toBe(true);
  const roundtrippedScene = JSON.parse(Option.getOrThrow(reExtractedOption));

  // Deep equality of the full scene objects
  expect(roundtrippedScene).toEqual(originalScene);

  // Verify specific invariants
  expect(roundtrippedScene.elements.length).toBe(999);
  expect(roundtrippedScene.type).toBe("excalidraw");
  expect(roundtrippedScene.version).toBe(originalScene.version);
  expect(roundtrippedScene.appState).toEqual(originalScene.appState);

  // Verify all element types are preserved
  const originalTypes = originalScene.elements.map(
    (e: { type: string }) => e.type,
  );
  const roundtrippedTypes = roundtrippedScene.elements.map(
    (e: { type: string }) => e.type,
  );
  expect(roundtrippedTypes).toEqual(originalTypes);
});

test("returns None for SVG without excalidraw data", async () => {
  const result1 = await Effect.runPromise(
    extractSceneFromSvg("<svg></svg>"),
  );
  expect(Option.isNone(result1)).toBe(true);

  const result2 = await Effect.runPromise(
    extractSceneFromSvg(
      `<svg xmlns="http://www.w3.org/2000/svg"><rect width="100" height="100"/></svg>`,
    ),
  );
  expect(Option.isNone(result2)).toBe(true);
});

test("parseScene rejects invalid type field", async () => {
  const result = await Effect.runPromiseExit(
    parseScene('{"type": "not-excalidraw", "version": 2, "source": "", "elements": [], "appState": {}}'),
  );
  expect(result._tag).toBe("Failure");
});

test("parseScene accepts valid scene", async () => {
  const json = await Bun.file("test/fixtures/test-scene.excalidraw").text();
  const scene = await Effect.runPromise(parseScene(json));

  expect(scene.type).toBe("excalidraw");
  expect(scene.version).toBe(2);
  expect(scene.elements.length).toBe(2);
});

test("getSceneInfo computes correct metadata", async () => {
  const json = await Bun.file("test/fixtures/test-scene.excalidraw").text();
  const scene = await Effect.runPromise(parseScene(json));
  const info = getSceneInfo(scene);

  expect(info.version).toBe(2);
  expect(info.source).toBe("https://excalidraw.com");
  expect(info.elementCount).toBe(2);
  expect(info.activeElementCount).toBe(2);
  expect(info.elementsByType).toEqual({ rectangle: 1, text: 1 });
  expect(info.boundingBox).toEqual({
    minX: 100,
    minY: 100,
    maxX: 300,
    maxY: 250,
  });
  expect(info.fileCount).toBe(0);
});

test("getSceneInfo excludes deleted elements", async () => {
  const json = await Bun.file("test/fixtures/test-scene.excalidraw").text();
  const scene = await Effect.runPromise(parseScene(json));
  const sceneWithDeleted = {
    ...scene,
    elements: [
      ...scene.elements,
      { ...scene.elements[0]!, id: "deleted1", isDeleted: true },
    ],
  };
  const info = getSceneInfo(sceneWithDeleted);

  expect(info.elementCount).toBe(3);
  expect(info.activeElementCount).toBe(2);
});
