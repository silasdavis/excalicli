import { test, expect, beforeAll } from "bun:test";
import { Effect, Option } from "effect";
import { extractSceneFromPng } from "../src/lib/png.ts";
import { extractSceneFromSvg } from "../src/lib/svg.ts";
import { writeSceneToFile } from "../src/lib/write.ts";
import { renderToSvg, renderToPng } from "../src/lib/render.ts";
import { loadSceneJson } from "../src/lib/scene.ts";

// Regenerate fixtures before tests
beforeAll(async () => {
  const proc = Bun.spawn(["bun", "test/create-fixtures.ts"], {
    stdout: "ignore",
    stderr: "inherit",
  });
  const code = await proc.exited;
  if (code !== 0) throw new Error("Failed to create test fixtures");
});

async function loadFixtureScene() {
  return await Bun.file("test/fixtures/test-scene.excalidraw").text();
}

test("renderToSvg produces valid SVG", async () => {
  const sceneJson = await loadFixtureScene();
  const svg = await Effect.runPromise(renderToSvg(sceneJson));

  expect(svg).toContain("<svg");
  expect(svg).toContain("</svg>");
  expect(svg).toContain("viewBox");
});

test("renderToPng produces valid PNG", async () => {
  const sceneJson = await loadFixtureScene();
  const png = await Effect.runPromise(renderToPng(sceneJson));

  // PNG magic bytes
  expect(png[0]).toBe(137);
  expect(png[1]).toBe(80);
  expect(png[2]).toBe(78);
  expect(png[3]).toBe(71);
  expect(png.length).toBeGreaterThan(100);
});

test("write PNG: renders + embeds scene data", async () => {
  const sceneJson = await loadFixtureScene();
  const outPath = "/tmp/test-write-png.png";

  await Effect.runPromise(writeSceneToFile(outPath, sceneJson));

  // Read back and verify scene data is embedded
  const written = new Uint8Array(await Bun.file(outPath).arrayBuffer());
  const extracted = await Effect.runPromise(extractSceneFromPng(written));
  expect(Option.isSome(extracted)).toBe(true);

  const extractedScene = JSON.parse(Option.getOrThrow(extracted));
  const originalScene = JSON.parse(sceneJson);
  expect(extractedScene.type).toBe("excalidraw");
  expect(extractedScene.elements.length).toBe(originalScene.elements.length);
});

test("write SVG: renders + embeds scene data", async () => {
  const sceneJson = await loadFixtureScene();
  const outPath = "/tmp/test-write-svg.svg";

  await Effect.runPromise(writeSceneToFile(outPath, sceneJson));

  // Read back and verify scene data is embedded
  const svgContent = await Bun.file(outPath).text();
  expect(svgContent).toContain("<svg");
  expect(svgContent).toContain("payload-start");

  const extracted = await Effect.runPromise(extractSceneFromSvg(svgContent));
  expect(Option.isSome(extracted)).toBe(true);

  const extractedScene = JSON.parse(Option.getOrThrow(extracted));
  const originalScene = JSON.parse(sceneJson);
  expect(extractedScene.type).toBe("excalidraw");
  expect(extractedScene.elements.length).toBe(originalScene.elements.length);
});

test("write .excalidraw: writes raw JSON", async () => {
  const sceneJson = await loadFixtureScene();
  const outPath = "/tmp/test-write-raw.excalidraw";

  await Effect.runPromise(writeSceneToFile(outPath, sceneJson));

  const written = await Bun.file(outPath).text();
  expect(JSON.parse(written)).toEqual(JSON.parse(sceneJson));
});

test("full round-trip: extract from fixture PNG → write new PNG → extract again", async () => {
  // Extract from the original fixture
  const originalJson = await Effect.runPromise(
    loadSceneJson("test/fixtures/test-scene.excalidraw.png"),
  );
  const originalScene = JSON.parse(originalJson);

  // Write to new PNG
  const outPath = "/tmp/test-roundtrip-full.png";
  await Effect.runPromise(writeSceneToFile(outPath, originalJson));

  // Extract from new PNG
  const extractedJson = await Effect.runPromise(loadSceneJson(outPath));
  const extractedScene = JSON.parse(extractedJson);

  // Verify scene integrity
  expect(extractedScene.type).toBe(originalScene.type);
  expect(extractedScene.version).toBe(originalScene.version);
  expect(extractedScene.elements.length).toBe(originalScene.elements.length);

  // Verify element-by-element
  for (let i = 0; i < originalScene.elements.length; i++) {
    expect(extractedScene.elements[i].id).toBe(originalScene.elements[i].id);
    expect(extractedScene.elements[i].type).toBe(originalScene.elements[i].type);
  }
});
