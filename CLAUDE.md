## Project

excalicli - CLI tool for working with excalidraw files. See [DESIGN.md](DESIGN.md) for full architecture.

**Key concepts:**
- Extract/embed excalidraw scene JSON from/to PNG and SVG files
- Render scenes to PNG/SVG using @excalidraw/excalidraw + jsdom headless DOM
- PNG: scene stored in tEXt chunk with keyword `application/vnd.excalidraw+json`
- SVG: scene stored in `<metadata>` element between `<!-- payload-start -->` / `<!-- payload-end -->` comments
- Compression pipeline: scene JSON -> pako deflate -> bstring encoding -> JSON envelope -> (SVG: base64)
- Uses raw JSON pass-through (no interpretation) for forward-compatibility

**Structure:**
```
src/
  cli.ts              # CLI entry point
  mcp.ts              # MCP server (stdio JSON-RPC)
  commands/           # extract, info, write, convert
  lib/
    png.ts            # PNG chunk read/write
    svg.ts            # SVG metadata read/write
    decode.ts         # Decompression pipeline
    encode.ts         # Compression pipeline
    render.ts         # Headless rendering (jsdom + excalidraw + resvg)
    write.ts          # Write scene to file (render + embed)
    scene.ts          # Schema definitions & scene utilities
    errors.ts         # Effect-TS error types
```

## Bun

Default to using Bun instead of Node.js.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun test` instead of `jest` or `vitest`
- Use `bun install` instead of `npm install`
- Use `bun run <script>` instead of `npm run <script>`
- Prefer `Bun.file` over `node:fs`'s readFile/writeFile

## Testing

Use `bun test` to run tests. Test files are in `test/`.

```ts
import { test, expect } from "bun:test";

test("hello world", () => {
  expect(1).toBe(1);
});
```

## Rendering

The rendering pipeline uses jsdom for headless DOM (with Canvas2D stub and FontFace polyfill), @excalidraw/excalidraw's `exportToSvg()` for SVG generation, and @resvg/resvg-js for SVG→PNG rasterization. The DOM environment is set up lazily on first render call in `src/lib/render.ts`.
