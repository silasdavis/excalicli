import { test, expect, beforeAll } from "bun:test";
import { Effect, Option } from "effect";
import { loadSceneJson } from "../src/lib/scene.ts";
import { writeSceneToFile, embedSceneInFile } from "../src/lib/write.ts";
import { extractSceneFromPng } from "../src/lib/png.ts";
import { extractSceneFromSvg } from "../src/lib/svg.ts";
import { existsSync, rmSync, mkdirSync } from "node:fs";

const OUT_DIR = "test/fixtures/convert-output";

beforeAll(async () => {
  // Regenerate fixtures
  const proc = Bun.spawn(["bun", "test/create-fixtures.ts"], {
    stdout: "ignore",
    stderr: "inherit",
  });
  const code = await proc.exited;
  if (code !== 0) throw new Error("Failed to create test fixtures");

  if (existsSync(OUT_DIR)) rmSync(OUT_DIR, { recursive: true });
  mkdirSync(OUT_DIR, { recursive: true });
});

// --- Convert tests ---

test("convert PNG → SVG preserves scene data", async () => {
  const sceneJson = await Effect.runPromise(
    loadSceneJson("test/fixtures/test-scene.excalidraw.png"),
  );
  const outPath = `${OUT_DIR}/converted.svg`;
  await Effect.runPromise(writeSceneToFile(outPath, sceneJson));

  const svgContent = await Bun.file(outPath).text();
  expect(svgContent).toContain("<svg");
  expect(svgContent).toContain("payload-start");

  const extracted = await Effect.runPromise(extractSceneFromSvg(svgContent));
  expect(Option.isSome(extracted)).toBe(true);
  const roundtripped = JSON.parse(Option.getOrThrow(extracted));
  const original = JSON.parse(sceneJson);
  expect(roundtripped.elements.length).toBe(original.elements.length);
  expect(roundtripped.type).toBe("excalidraw");
});

test("convert SVG → PNG preserves scene data", async () => {
  const sceneJson = await Effect.runPromise(
    loadSceneJson("test/fixtures/test-scene.excalidraw.svg"),
  );
  const outPath = `${OUT_DIR}/converted.png`;
  await Effect.runPromise(writeSceneToFile(outPath, sceneJson));

  const data = new Uint8Array(await Bun.file(outPath).arrayBuffer());
  expect(data[0]).toBe(0x89); // PNG magic

  const extracted = await Effect.runPromise(extractSceneFromPng(data));
  expect(Option.isSome(extracted)).toBe(true);
  const roundtripped = JSON.parse(Option.getOrThrow(extracted));
  const original = JSON.parse(sceneJson);
  expect(roundtripped.elements.length).toBe(original.elements.length);
});

test("convert PNG → excalidraw extracts scene JSON", async () => {
  const sceneJson = await Effect.runPromise(
    loadSceneJson("test/fixtures/test-scene.excalidraw.png"),
  );
  const outPath = `${OUT_DIR}/converted.excalidraw`;
  await Effect.runPromise(writeSceneToFile(outPath, sceneJson));

  const written = await Bun.file(outPath).text();
  const parsed = JSON.parse(written);
  const original = JSON.parse(sceneJson);
  expect(parsed.type).toBe("excalidraw");
  expect(parsed.elements.length).toBe(original.elements.length);
});

test("convert excalidraw → PNG renders and embeds", async () => {
  const sceneJson = await Bun.file("test/fixtures/test-scene.excalidraw").text();
  const outPath = `${OUT_DIR}/from-json.png`;
  await Effect.runPromise(writeSceneToFile(outPath, sceneJson));

  const data = new Uint8Array(await Bun.file(outPath).arrayBuffer());
  expect(data[0]).toBe(0x89); // PNG magic
  expect(data.length).toBeGreaterThan(1000);

  // Verify embedded scene round-trips
  const extracted = await Effect.runPromise(extractSceneFromPng(data));
  expect(Option.isSome(extracted)).toBe(true);
  const roundtripped = JSON.parse(Option.getOrThrow(extracted));
  const original = JSON.parse(sceneJson);
  expect(roundtripped.elements.length).toBe(original.elements.length);
  for (let i = 0; i < original.elements.length; i++) {
    expect(roundtripped.elements[i].id).toBe(original.elements[i].id);
  }
});

// --- --base flag tests ---

test("embedSceneInFile: PNG metadata-only replacement", async () => {
  // First, create a rendered PNG
  const sceneJson = await Bun.file("test/fixtures/test-scene.excalidraw").text();
  const basePath = `${OUT_DIR}/base.png`;
  await Effect.runPromise(writeSceneToFile(basePath, sceneJson));

  const baseSize = (await Bun.file(basePath).arrayBuffer()).byteLength;

  // Now modify the scene (add an element) and embed without re-rendering
  const scene = JSON.parse(sceneJson);
  scene.elements.push({
    type: "ellipse",
    id: "added-ellipse",
    x: 400, y: 400, width: 80, height: 80,
    strokeColor: "#e03131",
    backgroundColor: "transparent",
    fillStyle: "hachure",
    strokeWidth: 2,
    strokeStyle: "solid",
    roughness: 1,
    opacity: 100,
    angle: 0,
    seed: 999,
    version: 1,
    versionNonce: 999,
    isDeleted: false,
    groupIds: [],
    frameId: null,
    boundElements: null,
    updated: 1700000000000,
    link: null,
    locked: false,
  });
  const modifiedJson = JSON.stringify(scene);

  const outPath = `${OUT_DIR}/base-modified.png`;
  await Effect.runPromise(embedSceneInFile(outPath, modifiedJson, basePath));

  // The output should be a valid PNG with the modified scene
  const data = new Uint8Array(await Bun.file(outPath).arrayBuffer());
  expect(data[0]).toBe(0x89);

  const extracted = await Effect.runPromise(extractSceneFromPng(data));
  expect(Option.isSome(extracted)).toBe(true);
  const roundtripped = JSON.parse(Option.getOrThrow(extracted));
  expect(roundtripped.elements.length).toBe(3); // 2 original + 1 added
  expect(roundtripped.elements[2].id).toBe("added-ellipse");

  // Pixel data should be similar size (same rendering, just different metadata)
  const modifiedSize = data.byteLength;
  // Base and modified should be similar size (not re-rendered, just metadata diff)
  expect(Math.abs(modifiedSize - baseSize)).toBeLessThan(baseSize * 0.5);
});

test("embedSceneInFile: SVG metadata-only replacement", async () => {
  // Create a rendered SVG
  const sceneJson = await Bun.file("test/fixtures/test-scene.excalidraw").text();
  const basePath = `${OUT_DIR}/base.svg`;
  await Effect.runPromise(writeSceneToFile(basePath, sceneJson));

  const baseSvg = await Bun.file(basePath).text();
  expect(baseSvg).toContain("<svg");

  // Modify scene and embed without re-rendering
  const scene = JSON.parse(sceneJson);
  scene.elements.push({
    type: "diamond",
    id: "added-diamond",
    x: 500, y: 500, width: 60, height: 60,
    strokeColor: "#2f9e44",
    backgroundColor: "transparent",
    fillStyle: "hachure",
    strokeWidth: 2,
    strokeStyle: "solid",
    roughness: 1,
    opacity: 100,
    angle: 0,
    seed: 888,
    version: 1,
    versionNonce: 888,
    isDeleted: false,
    groupIds: [],
    frameId: null,
    boundElements: null,
    updated: 1700000000000,
    link: null,
    locked: false,
  });
  const modifiedJson = JSON.stringify(scene);

  const outPath = `${OUT_DIR}/base-modified.svg`;
  await Effect.runPromise(embedSceneInFile(outPath, modifiedJson, basePath));

  const modifiedSvg = await Bun.file(outPath).text();
  expect(modifiedSvg).toContain("<svg");
  expect(modifiedSvg).toContain("payload-start");

  // The SVG rendering (paths, shapes) should be preserved from the base
  // Only the metadata block should differ
  const extracted = await Effect.runPromise(extractSceneFromSvg(modifiedSvg));
  expect(Option.isSome(extracted)).toBe(true);
  const roundtripped = JSON.parse(Option.getOrThrow(extracted));
  expect(roundtripped.elements.length).toBe(3);
  expect(roundtripped.elements[2].id).toBe("added-diamond");

  // The SVG body (minus metadata) should contain the original rendering
  // i.e. it should still have <path elements from the original render
  expect(modifiedSvg).toContain("<path");
});

test("embedSceneInFile: excalidraw ignores base", async () => {
  const sceneJson = await Bun.file("test/fixtures/test-scene.excalidraw").text();
  const outPath = `${OUT_DIR}/base-ignored.excalidraw`;

  // Pass a base file that is a PNG — should be ignored for .excalidraw output
  await Effect.runPromise(
    embedSceneInFile(outPath, sceneJson, "test/fixtures/test-scene.excalidraw.png"),
  );

  const written = await Bun.file(outPath).text();
  expect(JSON.parse(written)).toEqual(JSON.parse(sceneJson));
});
