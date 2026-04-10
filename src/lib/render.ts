/**
 * Headless rendering of excalidraw scenes to SVG and PNG.
 *
 * Uses @excalidraw/excalidraw's exportToSvg with jsdom for DOM,
 * and @resvg/resvg-js for SVG→PNG rasterization.
 *
 * The jsdom environment is set up lazily on first render and reused.
 */

import { Effect } from "effect";
import { existsSync, readdirSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { tmpdir } from "node:os";
import { RenderError } from "./errors.ts";
import jsdomDefaultStylesheet from "../../node_modules/jsdom/lib/jsdom/browser/default-stylesheet.css" with { type: "text" };

// Lazy-initialized excalidraw exportToSvg function
let _exportToSvg: typeof import("@excalidraw/excalidraw").exportToSvg | null =
  null;

// Tracks whether we've already installed the jsdom-backed globals.
let _domEnvironmentReady = false;

// Cached TTF font file paths for resvg (converted from WOFF2)
let _fontFilesPromise: Promise<string[]> | null = null;

function formatCause(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  return String(cause);
}

let _jsdomSyncXhrWorkerPath: string | null = null;

const JSDOM_SYNC_XHR_WORKER_STUB = `"use strict";
const { parentPort } = require("node:worker_threads");

parentPort.on("message", ({ sharedBuffer, responsePort }) => {
  const int32 = new Int32Array(sharedBuffer);
  responsePort.postMessage({
    status: 0,
    statusText: "",
    responseURL: "",
    responseBytes: null,
    totalReceivedChunkSize: 0,
    responseHeaders: [],
    filteredResponseHeaders: [],
    error: "Synchronous XHR is unavailable in the compiled excalicli jsdom worker stub.",
    uploadComplete: true,
    cookieJar: null,
  });
  Atomics.store(int32, 0, 1);
  Atomics.notify(int32, 0);
});
`;

function ensureJsdomSyncXhrWorkerStub(): string {
  if (_jsdomSyncXhrWorkerPath) return _jsdomSyncXhrWorkerPath;

  const workerDir = join(tmpdir(), "excalicli-jsdom");
  mkdirSync(workerDir, { recursive: true });

  const workerPath = join(workerDir, "xhr-sync-worker.js");
  if (!existsSync(workerPath)) {
    writeFileSync(workerPath, JSDOM_SYNC_XHR_WORKER_STUB);
  }

  _jsdomSyncXhrWorkerPath = workerPath;
  return workerPath;
}

function patchJsdomDefaultStylesheet(): void {
  const fs = require("node:fs") as typeof import("node:fs") & {
    readFileSync: typeof import("node:fs").readFileSync & {
      __excalicliJsdomPatched?: boolean;
    };
  };

  if (fs.readFileSync.__excalicliJsdomPatched) return;

  const originalReadFileSync = fs.readFileSync.bind(fs);
  const defaultStylesheetSuffix = "/jsdom/lib/jsdom/browser/default-stylesheet.css";

  const patchedReadFileSync = ((pathLike: Parameters<typeof fs.readFileSync>[0], options?: Parameters<typeof fs.readFileSync>[1]) => {
    const pathString =
      typeof pathLike === "string"
        ? pathLike
        : pathLike instanceof URL
          ? pathLike.pathname
          : Buffer.isBuffer(pathLike)
            ? pathLike.toString("utf8")
            : null;

    if (
      pathString &&
      pathString.endsWith(defaultStylesheetSuffix) &&
      !existsSync(pathString)
    ) {
      const encoding =
        typeof options === "string"
          ? options
          : typeof options === "object" && options !== null
            ? options.encoding
            : undefined;

      if (encoding === "utf8" || encoding === "utf-8") {
        return jsdomDefaultStylesheet;
      }

      return Buffer.from(jsdomDefaultStylesheet, "utf8");
    }

    return originalReadFileSync(pathLike, options as never);
  }) as typeof fs.readFileSync;

  patchedReadFileSync.__excalicliJsdomPatched = true;
  fs.readFileSync = patchedReadFileSync;
}

function patchJsdomSyncXhrWorker(): void {
  const workerPath = ensureJsdomSyncXhrWorkerStub();
  const isJsdomSyncWorkerRequest = (request: string) =>
    request === "./xhr-sync-worker.js" ||
    request.replaceAll("\\", "/").endsWith("/jsdom/lib/jsdom/living/xhr/xhr-sync-worker.js");

  const runtimeRequire = require as typeof require & {
    resolve?: ((request: string, options?: unknown) => string) & {
      __excalicliJsdomPatched?: boolean;
    };
  };

  if (runtimeRequire.resolve && !runtimeRequire.resolve.__excalicliJsdomPatched) {
    const originalResolve = runtimeRequire.resolve.bind(runtimeRequire);
    const patchedResolve = ((request: string, options?: unknown) => {
      if (isJsdomSyncWorkerRequest(request)) {
        return workerPath;
      }

      return originalResolve(request, options);
    }) as typeof runtimeRequire.resolve;

    patchedResolve.__excalicliJsdomPatched = true;
    runtimeRequire.resolve = patchedResolve;
  }

  const moduleExports = require("node:module") as {
    _resolveFilename?: ((request: string, parent: unknown, ...rest: unknown[]) => string) & {
      __excalicliJsdomPatched?: boolean;
    };
  };

  if (!moduleExports._resolveFilename || moduleExports._resolveFilename.__excalicliJsdomPatched) {
    return;
  }

  const originalResolveFilename = moduleExports._resolveFilename;

  const patchedResolveFilename = ((request: string, parent: unknown, ...rest: unknown[]) => {
    if (isJsdomSyncWorkerRequest(request)) {
      return workerPath;
    }

    return originalResolveFilename.call(moduleExports, request, parent, ...rest);
  }) as typeof originalResolveFilename;

  patchedResolveFilename.__excalicliJsdomPatched = true;
  moduleExports._resolveFilename = patchedResolveFilename;
}

/**
 * Discover excalidraw's bundled WOFF2 fonts, decompress them to TTF
 * (since resvg-js cannot load WOFF2), and cache the results.
 *
 * TTF files are written to a temp directory and reused across renders.
 * Returns an empty array if fonts can't be found (graceful fallback).
 */
async function discoverExcalidrawFonts(): Promise<string[]> {
  if (_fontFilesPromise !== null) return _fontFilesPromise;

  _fontFilesPromise = (async () => {
    try {
      // Find the excalidraw package root via require.resolve
      const excalidrawEntry = require.resolve("@excalidraw/excalidraw");
      let pkgDir = dirname(excalidrawEntry);
      while (pkgDir !== "/" && !existsSync(join(pkgDir, "package.json"))) {
        pkgDir = dirname(pkgDir);
      }

      const fontsDir = join(pkgDir, "dist", "prod", "fonts");
      if (!existsSync(fontsDir)) return [];

      // Collect all .woff2 files recursively from font subdirectories
      const woff2Paths: string[] = [];
      const subdirs = readdirSync(fontsDir, { withFileTypes: true });
      for (const subdir of subdirs) {
        if (!subdir.isDirectory()) continue;
        const subPath = join(fontsDir, subdir.name);
        const files = readdirSync(subPath);
        for (const file of files) {
          if (file.endsWith(".woff2")) {
            woff2Paths.push(join(subPath, file));
          }
        }
      }

      if (woff2Paths.length === 0) return [];

      // Decompress WOFF2 → TTF into a temp directory
      const ttfDir = join(tmpdir(), "excalicli-fonts");
      mkdirSync(ttfDir, { recursive: true });

      const { decompress } = await import("wawoff2");
      const ttfPaths: string[] = [];

      for (const woff2Path of woff2Paths) {
        const ttfName = basename(woff2Path).replace(/\.woff2$/, ".ttf");
        const ttfPath = join(ttfDir, ttfName);

        // Skip if already converted
        if (existsSync(ttfPath)) {
          ttfPaths.push(ttfPath);
          continue;
        }

        const woff2Data = readFileSync(woff2Path);
        const ttfData = await decompress(woff2Data);
        writeFileSync(ttfPath, Buffer.from(ttfData));
        ttfPaths.push(ttfPath);
      }

      return ttfPaths;
    } catch {
      return [];
    }
  })();

  return _fontFilesPromise;
}

/**
 * Set up jsdom globals required by @excalidraw/excalidraw.
 * Must be called before the first import of excalidraw.
 */
function installGlobal(name: keyof typeof globalThis, value: unknown): void {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);

  if (!descriptor) {
    Object.defineProperty(globalThis, name, {
      configurable: true,
      enumerable: true,
      writable: true,
      value,
    });
    return;
  }

  if (descriptor.writable || descriptor.set) {
    Reflect.set(globalThis as Record<string, unknown>, name as string, value);
    return;
  }

  if (descriptor.configurable) {
    Object.defineProperty(globalThis, name, {
      configurable: true,
      enumerable: descriptor.enumerable ?? true,
      writable: true,
      value,
    });
  }
}

function setupDomEnvironment(): void {
  if (_domEnvironmentReady) return;

  patchJsdomDefaultStylesheet();
  patchJsdomSyncXhrWorker();

  // Dynamic require to avoid loading jsdom when not rendering
  const { JSDOM } = require("jsdom");

  const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", {
    url: "https://excalidraw.com",
    pretendToBeVisual: true,
  });
  const win = dom.window;

  // Bun can expose readonly browser globals (notably navigator). Install
  // our jsdom-backed globals one-by-one so readonly descriptors don't abort
  // the whole bootstrap.
  const globalBindings = {
    window: win,
    document: win.document,
    navigator: win.navigator,
    SVGSVGElement: win.SVGSVGElement,
    HTMLCanvasElement: win.HTMLCanvasElement,
    HTMLElement: win.HTMLElement,
    Element: win.Element,
    Node: win.Node,
    DOMParser: win.DOMParser,
    XMLSerializer: win.XMLSerializer,
    getComputedStyle: win.getComputedStyle,
    devicePixelRatio: 1,
    localStorage: win.localStorage,
    sessionStorage: win.sessionStorage,
    location: win.location,
    requestAnimationFrame: (cb: () => void) => setTimeout(cb, 0),
    cancelAnimationFrame: clearTimeout,
    ResizeObserver: class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
    matchMedia: () => ({
      matches: false,
      addListener: () => {},
      removeListener: () => {},
    }),
    FontFace: class {
      family: string;
      source: string;
      loaded: Promise<void>;
      unicodeRange: string = "U+0-10FFFF";
      weight: string = "normal";
      style: string = "normal";
      display: string = "auto";
      featureSettings: string = "";
      stretch: string = "normal";
      variant: string = "normal";
      status: string = "loaded";
      constructor(family: string, source: string, descriptors?: Record<string, string>) {
        this.family = family;
        this.source = source;
        if (descriptors?.unicodeRange) this.unicodeRange = descriptors.unicodeRange;
        if (descriptors?.weight) this.weight = descriptors.weight;
        if (descriptors?.style) this.style = descriptors.style;
        this.loaded = Promise.resolve();
      }
      load() {
        return this.loaded;
      }
    },
  } satisfies Partial<Record<keyof typeof globalThis, unknown>>;

  for (const [name, value] of Object.entries(globalBindings)) {
    installGlobal(name as keyof typeof globalThis, value);
  }

  // Stub Canvas2D context for excalidraw's feature detection and text measurement
  const canvasProto = win.HTMLCanvasElement.prototype as any;
  const origGetContext = canvasProto.getContext;
  canvasProto.getContext = function (type: string, ...args: any[]) {
    if (type === "2d") {
      return {
        filter: "",
        fillStyle: "",
        strokeStyle: "",
        lineWidth: 1,
        lineCap: "butt",
        lineJoin: "miter",
        miterLimit: 10,
        globalAlpha: 1,
        globalCompositeOperation: "source-over",
        font: "10px sans-serif",
        textAlign: "start",
        textBaseline: "alphabetic",
        direction: "ltr",
        imageSmoothingEnabled: true,
        canvas: this,
        save: () => {},
        restore: () => {},
        scale: () => {},
        rotate: () => {},
        translate: () => {},
        transform: () => {},
        setTransform: () => {},
        resetTransform: () => {},
        createLinearGradient: () => ({ addColorStop: () => {} }),
        createRadialGradient: () => ({ addColorStop: () => {} }),
        createPattern: () => null,
        clearRect: () => {},
        fillRect: () => {},
        strokeRect: () => {},
        beginPath: () => {},
        closePath: () => {},
        moveTo: () => {},
        lineTo: () => {},
        bezierCurveTo: () => {},
        quadraticCurveTo: () => {},
        arc: () => {},
        arcTo: () => {},
        ellipse: () => {},
        rect: () => {},
        fill: () => {},
        stroke: () => {},
        clip: () => {},
        isPointInPath: () => false,
        isPointInStroke: () => false,
        measureText: (text: string) => ({
          width: text.length * 7,
          actualBoundingBoxLeft: 0,
          actualBoundingBoxRight: text.length * 7,
          actualBoundingBoxAscent: 10,
          actualBoundingBoxDescent: 3,
          fontBoundingBoxAscent: 12,
          fontBoundingBoxDescent: 4,
        }),
        fillText: () => {},
        strokeText: () => {},
        drawImage: () => {},
        createImageData: (w: number, h: number) => ({
          data: new Uint8ClampedArray(w * h * 4),
          width: w,
          height: h,
        }),
        getImageData: (_x: number, _y: number, w: number, h: number) => ({
          data: new Uint8ClampedArray(w * h * 4),
          width: w,
          height: h,
        }),
        putImageData: () => {},
        setLineDash: () => {},
        getLineDash: () => [],
        lineDashOffset: 0,
        shadowBlur: 0,
        shadowColor: "rgba(0, 0, 0, 0)",
        shadowOffsetX: 0,
        shadowOffsetY: 0,
      };
    }
    return origGetContext?.call(this, type, ...args) ?? null;
  };

  // Stub document.fonts if not present
  if (!document.fonts) {
    (document as any).fonts = {
      add: () => {},
      has: () => false,
      check: () => true,
      ready: Promise.resolve(),
      [Symbol.iterator]: function* () {},
      forEach: () => {},
      entries: function* () {},
      keys: function* () {},
      values: function* () {},
      size: 0,
    };
  }

  _domEnvironmentReady = true;
}

/**
 * Get the excalidraw exportToSvg function, initializing the DOM environment
 * and loading the module on first call.
 */
const getExportToSvg = (): Effect.Effect<
  typeof import("@excalidraw/excalidraw").exportToSvg,
  RenderError
> =>
  Effect.gen(function* () {
    if (_exportToSvg) return _exportToSvg;

    yield* Effect.try({
      try: () => setupDomEnvironment(),
      catch: (e) =>
        new RenderError({
          message: `Failed to set up DOM environment for rendering: ${formatCause(e)}`,
          cause: e,
        }),
    });

    const mod = yield* Effect.tryPromise({
      try: () => import("@excalidraw/excalidraw"),
      catch: (e) =>
        new RenderError({
          message: "Failed to load @excalidraw/excalidraw",
          cause: e,
        }),
    });

    _exportToSvg = mod.exportToSvg;
    return _exportToSvg;
  });

/**
 * Parse scene JSON into the elements/appState/files structure
 * expected by excalidraw's export functions.
 */
function parseSceneForExport(sceneJson: string): {
  elements: any[];
  appState: Record<string, unknown>;
  files: Record<string, unknown>;
} {
  const scene = JSON.parse(sceneJson);
  return {
    elements: (scene.elements ?? []).filter((e: any) => !e.isDeleted),
    appState: {
      exportBackground: true,
      viewBackgroundColor: scene.appState?.viewBackgroundColor ?? "#ffffff",
      exportWithDarkMode: scene.appState?.exportWithDarkMode ?? false,
      ...scene.appState,
    },
    files: scene.files ?? {},
  };
}

/**
 * Render an excalidraw scene to an SVG string.
 */
export const renderToSvg = (
  sceneJson: string,
): Effect.Effect<string, RenderError> =>
  Effect.gen(function* () {
    const exportToSvg = yield* getExportToSvg();

    const { elements, appState, files } = yield* Effect.try({
      try: () => parseSceneForExport(sceneJson),
      catch: (e) =>
        new RenderError({ message: "Failed to parse scene JSON", cause: e }),
    });

    const svgElement = yield* Effect.tryPromise({
      try: () =>
        exportToSvg({
          elements,
          appState: appState as any,
          files: files as any,
          exportPadding: 20,
        }) as Promise<{ outerHTML: string }>,
      catch: (e) =>
        new RenderError({
          message: "exportToSvg failed",
          cause: e,
        }),
    });

    return svgElement.outerHTML;
  });

/**
 * Render an excalidraw scene to a PNG buffer.
 * Pipeline: scene JSON → SVG → PNG (via resvg-js).
 */
export const renderToPng = (
  sceneJson: string,
): Effect.Effect<Uint8Array, RenderError> =>
  Effect.gen(function* () {
    const svgString = yield* renderToSvg(sceneJson);

    const { Resvg } = yield* Effect.tryPromise({
      try: () => import("@resvg/resvg-js"),
      catch: (e) =>
        new RenderError({
          message: "Failed to load @resvg/resvg-js",
          cause: e,
        }),
    });

    const fontFiles = yield* Effect.tryPromise({
      try: () => discoverExcalidrawFonts(),
      catch: (e) =>
        new RenderError({
          message: "Failed to discover excalidraw fonts",
          cause: e,
        }),
    });

    const pngBuffer = yield* Effect.try({
      try: () => {
        const resvg = new Resvg(svgString, {
          fitTo: { mode: "zoom" as const, value: 2 },
          font: {
            fontFiles,
            loadSystemFonts: true,
            defaultFontFamily: "Virgil",
          },
        });
        const rendered = resvg.render();
        return new Uint8Array(rendered.asPng());
      },
      catch: (e) =>
        new RenderError({
          message: "SVG to PNG rasterization failed",
          cause: e,
        }),
    });

    return pngBuffer;
  });
