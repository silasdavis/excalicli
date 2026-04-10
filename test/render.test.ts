import { test, expect, beforeAll } from "bun:test";
import { Effect, Option } from "effect";
import { renderToSvg, renderToPng } from "../src/lib/render.ts";
import { embedSceneInPng, extractSceneFromPng } from "../src/lib/png.ts";
import { embedSceneInSvg, extractSceneFromSvg } from "../src/lib/svg.ts";
import { writeSceneToFile } from "../src/lib/write.ts";
import { loadSceneJson } from "../src/lib/scene.ts";
import { existsSync, rmSync, mkdirSync } from "node:fs";

const TEST_SCENE = JSON.stringify({
  type: "excalidraw",
  version: 2,
  source: "https://excalidraw.com",
  elements: [
    {
      type: "rectangle",
      id: "render-test-rect",
      x: 50,
      y: 50,
      width: 200,
      height: 100,
      angle: 0,
      strokeColor: "#1e1e1e",
      backgroundColor: "#a5d8ff",
      fillStyle: "solid",
      strokeWidth: 2,
      strokeStyle: "solid",
      roughness: 1,
      opacity: 100,
      roundness: { type: 3 },
      seed: 42,
      version: 1,
      versionNonce: 1,
      isDeleted: false,
      groupIds: [],
      boundElements: null,
      updated: 1,
      link: null,
      locked: false,
      frameId: null,
    },
    {
      type: "text",
      id: "render-test-text",
      x: 100,
      y: 80,
      width: 100,
      height: 40,
      angle: 0,
      strokeColor: "#1e1e1e",
      backgroundColor: "transparent",
      fillStyle: "solid",
      strokeWidth: 2,
      strokeStyle: "solid",
      roughness: 1,
      opacity: 100,
      roundness: null,
      seed: 43,
      version: 1,
      versionNonce: 2,
      isDeleted: false,
      groupIds: [],
      boundElements: null,
      updated: 1,
      link: null,
      locked: false,
      text: "Test",
      fontSize: 20,
      fontFamily: 5,
      textAlign: "center",
      verticalAlign: "middle",
      containerId: null,
      originalText: "Test",
      autoResize: true,
      lineHeight: 1.25,
      frameId: null,
    },
  ],
  appState: {
    viewBackgroundColor: "#ffffff",
    exportBackground: true,
    exportWithDarkMode: false,
  },
  files: {},
});

const RENDER_OUT_DIR = "test/fixtures/render-output";

beforeAll(() => {
  if (existsSync(RENDER_OUT_DIR)) {
    rmSync(RENDER_OUT_DIR, { recursive: true });
  }
  mkdirSync(RENDER_OUT_DIR, { recursive: true });
});

test("renderToSvg produces valid SVG", async () => {
  const svg = await Effect.runPromise(renderToSvg(TEST_SCENE));

  expect(svg).toContain("<svg");
  expect(svg).toContain("</svg>");
  // Should contain rendered shapes (paths from roughjs)
  expect(svg).toContain("<path");
  // Should contain text
  expect(svg).toContain("Test");
});

test("renderToPng produces valid PNG", async () => {
  const png = await Effect.runPromise(renderToPng(TEST_SCENE));

  // PNG magic bytes
  expect(png[0]).toBe(0x89);
  expect(png[1]).toBe(0x50); // P
  expect(png[2]).toBe(0x4e); // N
  expect(png[3]).toBe(0x47); // G
  // Reasonable size (not empty)
  expect(png.length).toBeGreaterThan(1000);
});

test("renderToSvg tolerates readonly runtime globals", async () => {
  const script = `
    Object.defineProperty(globalThis, "navigator", {
      value: { userAgent: "bun" },
      writable: false,
      configurable: true,
    });
    const { Effect } = await import("effect");
    const { renderToSvg } = await import("./src/lib/render.ts");
    const scene = ${JSON.stringify(TEST_SCENE)};
    const svg = await Effect.runPromise(renderToSvg(scene));
    if (!svg.includes("<svg")) {
      throw new Error("missing svg output");
    }
    console.log("ok");
  `;

  const proc = Bun.spawn(["bun", "-e", script], {
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  expect(exitCode).toBe(0);
  expect(stdout).toContain("ok");
  expect(stderr).not.toContain("Failed to set up DOM environment for rendering");
});

test("render PNG → embed scene → extract scene round-trip", async () => {
  const png = await Effect.runPromise(renderToPng(TEST_SCENE));
  const withScene = await Effect.runPromise(embedSceneInPng(png, TEST_SCENE));
  const extracted = await Effect.runPromise(extractSceneFromPng(withScene));

  expect(Option.isSome(extracted)).toBe(true);
  const parsed = JSON.parse(Option.getOrThrow(extracted));
  expect(parsed.type).toBe("excalidraw");
  expect(parsed.elements).toHaveLength(2);
  expect(parsed.elements[0].id).toBe("render-test-rect");
  expect(parsed.elements[1].id).toBe("render-test-text");
});

test("render SVG → embed scene → extract scene round-trip", async () => {
  const svg = await Effect.runPromise(renderToSvg(TEST_SCENE));
  const withScene = await Effect.runPromise(embedSceneInSvg(svg, TEST_SCENE));
  const extracted = await Effect.runPromise(extractSceneFromSvg(withScene));

  expect(Option.isSome(extracted)).toBe(true);
  const parsed = JSON.parse(Option.getOrThrow(extracted));
  expect(parsed.type).toBe("excalidraw");
  expect(parsed.elements).toHaveLength(2);
});

test("writeSceneToFile writes .excalidraw JSON", async () => {
  const outPath = `${RENDER_OUT_DIR}/test-write.excalidraw`;
  await Effect.runPromise(writeSceneToFile(outPath, TEST_SCENE));

  const written = await Bun.file(outPath).text();
  const parsed = JSON.parse(written);
  expect(parsed.type).toBe("excalidraw");
  expect(parsed.elements).toHaveLength(2);
});

test("writeSceneToFile writes rendered PNG with embedded scene", async () => {
  const outPath = `${RENDER_OUT_DIR}/test-write.png`;
  await Effect.runPromise(writeSceneToFile(outPath, TEST_SCENE));

  // Verify it's a valid PNG
  const data = new Uint8Array(await Bun.file(outPath).arrayBuffer());
  expect(data[0]).toBe(0x89);
  expect(data[1]).toBe(0x50);

  // Verify scene data is embedded
  const extracted = await Effect.runPromise(extractSceneFromPng(data));
  expect(Option.isSome(extracted)).toBe(true);
  const parsed = JSON.parse(Option.getOrThrow(extracted));
  expect(parsed.elements).toHaveLength(2);
});

test("writeSceneToFile writes rendered SVG with embedded scene", async () => {
  const outPath = `${RENDER_OUT_DIR}/test-write.svg`;
  await Effect.runPromise(writeSceneToFile(outPath, TEST_SCENE));

  const content = await Bun.file(outPath).text();
  expect(content).toContain("<svg");
  expect(content).toContain("payload-start");

  // Verify scene data is embedded
  const extracted = await Effect.runPromise(extractSceneFromSvg(content));
  expect(Option.isSome(extracted)).toBe(true);
  const parsed = JSON.parse(Option.getOrThrow(extracted));
  expect(parsed.elements).toHaveLength(2);
});

test("full pipeline: writeSceneToFile → loadSceneJson round-trip", async () => {
  const pngPath = `${RENDER_OUT_DIR}/roundtrip.png`;
  const svgPath = `${RENDER_OUT_DIR}/roundtrip.svg`;
  const jsonPath = `${RENDER_OUT_DIR}/roundtrip.excalidraw`;

  // Write all formats
  await Effect.runPromise(writeSceneToFile(pngPath, TEST_SCENE));
  await Effect.runPromise(writeSceneToFile(svgPath, TEST_SCENE));
  await Effect.runPromise(writeSceneToFile(jsonPath, TEST_SCENE));

  // Read back via loadSceneJson (the same function the extract command uses)
  const fromPng = JSON.parse(await Effect.runPromise(loadSceneJson(pngPath)));
  const fromSvg = JSON.parse(await Effect.runPromise(loadSceneJson(svgPath)));
  const fromJson = JSON.parse(
    await Effect.runPromise(loadSceneJson(jsonPath)),
  );

  // All three should produce the same scene
  const original = JSON.parse(TEST_SCENE);
  expect(fromPng).toEqual(original);
  expect(fromSvg).toEqual(original);
  expect(fromJson).toEqual(original);
});
