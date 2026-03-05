/**
 * Generate test fixture files (PNG and SVG with embedded excalidraw scene data).
 * Uses the encoding pipeline from src/lib/encode.ts and src/lib/png.ts.
 */

import { Effect } from "effect";
import pako from "pako";
import { encodeSceneData } from "../src/lib/encode.ts";
import { embedSceneInPng } from "../src/lib/png.ts";

const EXCALIDRAW_MIME = "application/vnd.excalidraw+json";

// A minimal but realistic excalidraw scene
const testScene = {
  type: "excalidraw",
  version: 2,
  source: "https://excalidraw.com",
  elements: [
    {
      type: "rectangle",
      id: "rect1",
      x: 100,
      y: 100,
      width: 200,
      height: 150,
      strokeColor: "#1e1e1e",
      backgroundColor: "transparent",
      fillStyle: "hachure",
      strokeWidth: 2,
      strokeStyle: "solid",
      roundness: { type: 3 },
      roughness: 1,
      opacity: 100,
      angle: 0,
      seed: 1234567,
      version: 1,
      versionNonce: 9876543,
      index: "a0",
      isDeleted: false,
      groupIds: [],
      frameId: null,
      boundElements: null,
      updated: 1700000000000,
      link: null,
      locked: false,
    },
    {
      type: "text",
      id: "text1",
      x: 150,
      y: 160,
      width: 100,
      height: 25,
      strokeColor: "#1e1e1e",
      backgroundColor: "transparent",
      fillStyle: "hachure",
      strokeWidth: 2,
      strokeStyle: "solid",
      roundness: null,
      roughness: 1,
      opacity: 100,
      angle: 0,
      seed: 7654321,
      version: 1,
      versionNonce: 1234567,
      index: "a1",
      isDeleted: false,
      groupIds: [],
      frameId: null,
      boundElements: null,
      updated: 1700000000000,
      link: null,
      locked: false,
      fontSize: 20,
      fontFamily: 1,
      text: "Hello",
      textAlign: "left",
      verticalAlign: "top",
      containerId: null,
      originalText: "Hello",
      autoResize: true,
      lineHeight: 1.25,
    },
  ],
  appState: {
    gridSize: null,
    viewBackgroundColor: "#ffffff",
  },
  files: {},
};

const sceneJson = JSON.stringify(testScene);

// A complex scene with 999 elements of diverse types (deterministic generation)
function generateComplexScene() {
  // Simple seeded PRNG for deterministic output
  let seed = 42;
  function rand(): number {
    seed = (seed * 1664525 + 1013904223) & 0x7fffffff;
    return seed / 0x7fffffff;
  }
  function randInt(min: number, max: number): number {
    return Math.floor(rand() * (max - min + 1)) + min;
  }

  const elementTypes = [
    "rectangle",
    "text",
    "diamond",
    "line",
    "ellipse",
    "arrow",
  ] as const;

  const colors = ["#1e1e1e", "#e03131", "#2f9e44", "#1971c2", "#f08c00"];
  const fillStyles = ["hachure", "cross-hatch", "solid"] as const;

  const elements: Record<string, unknown>[] = [];

  for (let i = 0; i < 999; i++) {
    const type = elementTypes[i % elementTypes.length]!;
    const x = randInt(-2000, 2000);
    const y = randInt(-2000, 2000);
    const width = randInt(20, 400);
    const height = randInt(20, 300);

    const base: Record<string, unknown> = {
      type,
      id: `el-${i}`,
      x,
      y,
      width,
      height,
      strokeColor: colors[randInt(0, colors.length - 1)],
      backgroundColor: rand() > 0.7 ? colors[randInt(0, colors.length - 1)] : "transparent",
      fillStyle: fillStyles[randInt(0, fillStyles.length - 1)],
      strokeWidth: rand() > 0.5 ? 2 : 1,
      strokeStyle: "solid",
      roundness: type === "rectangle" ? { type: 3 } : null,
      roughness: randInt(0, 2),
      opacity: 100,
      angle: 0,
      seed: randInt(1, 2000000000),
      version: randInt(1, 50),
      versionNonce: randInt(1, 2000000000),
      index: `a${i}`,
      isDeleted: false,
      groupIds: [],
      frameId: null,
      boundElements: null,
      updated: 1700000000000 + i * 1000,
      link: null,
      locked: false,
    };

    if (type === "text") {
      const words = ["Hello", "World", "Test", "Label", "Node", "Edge", "Flow", "Data"];
      base.fontSize = randInt(12, 36);
      base.fontFamily = 1;
      base.text = words[randInt(0, words.length - 1)];
      base.textAlign = "left";
      base.verticalAlign = "top";
      base.containerId = null;
      base.originalText = base.text;
      base.autoResize = true;
      base.lineHeight = 1.25;
    }

    if (type === "line" || type === "arrow") {
      const numPoints = randInt(2, 6);
      const points: [number, number][] = [[0, 0]];
      for (let p = 1; p < numPoints; p++) {
        points.push([randInt(-200, 200), randInt(-200, 200)]);
      }
      base.points = points;
      if (type === "arrow") {
        base.startArrowhead = null;
        base.endArrowhead = "arrow";
        base.startBinding = null;
        base.endBinding = null;
      }
    }

    elements.push(base);
  }

  return {
    type: "excalidraw",
    version: 2,
    source: "https://excalidraw.com",
    elements,
    appState: {
      gridSize: null,
      viewBackgroundColor: "#ffffff",
    },
    files: {},
  };
}

const complexScene = generateComplexScene();
const complexSceneJson = JSON.stringify(complexScene);

// --- Create PNG fixture ---

function createMinimalPng(): Uint8Array {
  // Create a minimal valid 1x1 white PNG
  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdrData = new Uint8Array(13);
  const ihdrView = new DataView(ihdrData.buffer);
  ihdrView.setUint32(0, 1); // width
  ihdrView.setUint32(4, 1); // height
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 2; // color type: RGB
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter
  ihdrData[12] = 0; // interlace

  const ihdrChunk = makeChunk("IHDR", ihdrData);

  const rawData = new Uint8Array([0, 255, 255, 255]);
  const compressedData = pako.deflate(rawData);
  const idatChunk = makeChunk("IDAT", compressedData);

  const iendChunk = makeChunk("IEND", new Uint8Array(0));

  return concatArrays([signature, ihdrChunk, idatChunk, iendChunk]);
}

function makeChunk(type: string, data: Uint8Array): Uint8Array {
  const length = data.length;
  const typeBytes = new TextEncoder().encode(type);
  const chunk = new Uint8Array(4 + 4 + length + 4);
  const view = new DataView(chunk.buffer);

  view.setUint32(0, length);
  chunk.set(typeBytes, 4);
  chunk.set(data, 8);

  const crcData = new Uint8Array(4 + length);
  crcData.set(typeBytes, 0);
  crcData.set(data, 4);
  view.setUint32(8 + length, crc32(crcData));

  return chunk;
}

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

function concatArrays(arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

async function createPngFixture(): Promise<void> {
  const basePng = createMinimalPng();
  const pngWithScene = await Effect.runPromise(
    embedSceneInPng(basePng, sceneJson),
  );

  await Bun.write("test/fixtures/test-scene.excalidraw.png", pngWithScene);
  console.log("Created test/fixtures/test-scene.excalidraw.png");
}

// --- Create SVG fixture ---

async function createSvgFixture(): Promise<void> {
  const envelopeJson = await Effect.runPromise(encodeSceneData(sceneJson));
  const base64Payload = btoa(envelopeJson);

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 350" width="400" height="350">
  <!-- svg-source:excalidraw -->
  <metadata>
    <!-- payload-type:${EXCALIDRAW_MIME} -->
    <!-- payload-version:2 -->
    <!-- payload-start -->
    ${base64Payload}
    <!-- payload-end -->
  </metadata>
  <rect x="100" y="100" width="200" height="150" fill="none" stroke="#1e1e1e" stroke-width="2"/>
  <text x="150" y="175" font-size="20" fill="#1e1e1e">Hello</text>
</svg>`;

  await Bun.write("test/fixtures/test-scene.excalidraw.svg", svg);
  console.log("Created test/fixtures/test-scene.excalidraw.svg");
}

// --- Create raw .excalidraw fixture ---

async function createExcalidrawFixture(): Promise<void> {
  await Bun.write(
    "test/fixtures/test-scene.excalidraw",
    JSON.stringify(testScene, null, 2),
  );
  console.log("Created test/fixtures/test-scene.excalidraw");
}

// --- Create complex PNG fixture ---

async function createComplexPngFixture(): Promise<void> {
  const basePng = createMinimalPng();
  const pngWithScene = await Effect.runPromise(
    embedSceneInPng(basePng, complexSceneJson),
  );

  await Bun.write("test/fixtures/complex-scene.excalidraw.png", pngWithScene);
  console.log("Created test/fixtures/complex-scene.excalidraw.png");
}

// --- Run ---
await createPngFixture();
await createSvgFixture();
await createExcalidrawFixture();
await createComplexPngFixture();
console.log("\nAll fixtures created successfully.");
