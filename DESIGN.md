# excalicli - Design Document

## Context

### Problem
Working with excalidraw diagrams in AI-assisted workflows requires manual round-trips through the web UI. We need a CLI tool that enables:
1. **Extract** embedded scene data (raw excalidraw JSON) from PNGs/SVGs
2. **Embed** excalidraw JSON back into PNG/SVG with full re-rendering
3. **Convert** between formats (.excalidraw JSON <-> PNG <-> SVG)

The output format is the **exact excalidraw JSON** - no interpretation, no lossy transformation. An LLM or tool takes the raw JSON as input, modifies it, and feeds it back.

### Ecosystem Context
- **Issue [#1261](https://github.com/excalidraw/excalidraw/issues/1261)** (2020, still open): Maintainer suggested official CLI but nothing materialized.
- **@excalidraw/utils**: Official npm package with `exportToSvg`, `exportToBlob`. **Requires DOM** (jsdom) and **Canvas** (node-canvas). This is our rendering backend.
- **excalidraw_export** (21 stars): Proven that jsdom + @excalidraw/utils works for headless SVG/PNG export.
- **excalidraw-mcp** (2959 stars): Official MCP server for AI-driven creation. Different use case (interactive HTML, not file-based).

---

## Technical Analysis

### How Excalidraw Embeds Scene Data

#### In PNGs
- Standard **PNG `tEXt` chunk** with keyword `"application/vnd.excalidraw+json"`
- Value is JSON: `{ version: "1", encoding: "bstring", compressed: true, encoded: "<zlib-deflated JSON as byte string>" }`
- Chunk inserted before `IEND`
- Source: `packages/excalidraw/data/image.ts`
- NPM deps: `png-chunks-extract`, `png-chunks-encode`, `png-chunk-text` (all v1.0.0)

#### In SVGs
- Scene data in `<metadata>` element with comment delimiters:
  ```xml
  <metadata>
    <!-- payload-type:application/vnd.excalidraw+json -->
    <!-- payload-version:2 -->
    <!-- payload-start -->
    <base64-encoded-compressed-scene-json>
    <!-- payload-end -->
  </metadata>
  ```
- Extraction regex: `/<!-- payload-start -->\s*(.+?)\s*<!-- payload-end -->/`
- Source: `packages/excalidraw/scene/export.ts`

#### Compression Pipeline
1. Scene JSON -> `pako.deflate()` (zlib) -> byte string per byte
2. Wrap in `EncodedData` envelope -> `JSON.stringify`
3. PNG: store as tEXt value
4. SVG: additionally base64 encode

### .excalidraw JSON Format
```json
{
  "type": "excalidraw",
  "version": 2,
  "source": "https://excalidraw.com",
  "elements": [...],
  "appState": { "viewBackgroundColor": "#ffffff", "gridSize": null, ... },
  "files": { "<fileId>": { "mimeType": "...", "dataURL": "data:...", ... } }
}
```

### Schema Stability
- Version `2` for years. Changes are additive (new optional fields).
- No formal migration system; restore-on-load handles legacy.
- **Assessment**: Stable enough. By using raw JSON pass-through, we're inherently forward-compatible.

### Rendering Requirements
- **SVG**: Needs DOM APIs (jsdom works). Uses roughjs for hand-drawn aesthetic.
- **PNG**: SVG-first pipeline: generate SVG, then rasterize via `@resvg/resvg-js` (NAPI, no C++ system deps needed).
- Font loading: excalidraw bundles Virgil (hand-drawn) and Cascadia (monospace) fonts internally. Fonts are included in the `@excalidraw/excalidraw` npm package and bundled into the compiled binary by Bun.

---

## Approach: TypeScript CLI with Bun

### Why Bun
- `bun build --compile` produces a single executable binary (cross-platform)
- Full npm compatibility - can use `@excalidraw/excalidraw`, jsdom, png-chunk libs directly
- Fast runtime (~4x faster startup than Node.js)
- Built-in TypeScript support
- No separate compile/transpile step

### Why not alternatives
- **Go**: Can't use @excalidraw/excalidraw for rendering. Would need to reimplement roughjs.
- **Deno**: `deno compile` works but npm compat via `npm:` specifiers is less mature for complex packages like excalidraw.
- **Node.js**: No single-binary compilation. Requires node installed + npm install.

### Rendering Strategy (Implemented)
1. **SVG generation**: `@excalidraw/excalidraw` `exportToSvg()` with jsdom providing DOM
2. **PNG generation**: Generate SVG first, then rasterize via `@resvg/resvg-js` (NAPI, bundles into compiled binary)
3. **Scene embedding**: Custom PNG chunk encoder (CRC32 + chunk assembly) and SVG metadata insertion
4. **Headless DOM**: jsdom with Canvas2D context stub, FontFace polyfill, and full browser global setup. DOM environment is initialized lazily on first render.

### CLI Design

```
excalicli extract <input.png|svg|excalidraw>
    Extract embedded excalidraw JSON from PNG/SVG.
    Outputs raw scene JSON to stdout.

excalicli write <output.png|svg|excalidraw> --scene <file|->
    Render scene JSON to PNG/SVG with embedded scene data.
    --scene: scene JSON source (file path or - for stdin)
    --base:  use existing file as starting point (metadata-only, skip re-render)

excalicli convert <input> -o <output>
    Convert between formats:
      .excalidraw -> .png, .svg
      .png -> .excalidraw, .svg
      .svg -> .excalidraw, .png
    Always embeds scene data in PNG/SVG outputs.

excalicli info <input.png|svg|excalidraw>
    Show metadata: element count by type, dimensions, has embedded scene, etc.

excalicli mcp
    Start MCP server over stdio for AI-assisted editing.
    Tools: excalidraw_read, excalidraw_write, excalidraw_info.

excalicli setup [--scope user]
    Register excalicli as an MCP server with Claude Code.
```

### Implementation Plan

#### Phase 1: Extract & Info (MVP) — DONE
- [x] Project setup: Bun, TypeScript, commander
- [x] PNG tEXt chunk reader (using png-chunks-extract + png-chunk-text)
- [x] SVG metadata reader (regex extraction)
- [x] Decompression: zlib inflate, bstring decode, base64 decode
- [x] `extract` command: PNG/SVG -> stdout JSON
- [x] `info` command: element summary
- [x] Test with synthetic fixtures (deterministic 999-element stress test)

#### Phase 2: Rendering & Write — DONE
- [x] jsdom setup for headless DOM (with Canvas2D stub, FontFace polyfill)
- [x] @excalidraw/excalidraw integration for SVG rendering
- [x] SVG -> PNG rasterization via @resvg/resvg-js (NAPI)
- [x] PNG tEXt chunk writer (scene data embedding, custom CRC32)
- [x] SVG metadata writer (scene data embedding)
- [x] `write` command: JSON -> rendered PNG/SVG with embedded data
- [x] `--base` flag: metadata-only replacement (skip re-rendering)
- [x] Fonts bundled via @excalidraw/excalidraw npm package

#### Phase 3: Convert, MCP & Polish — DONE
- [x] `convert` command: format conversion
- [x] MCP server with stdio transport (excalidraw_read, excalidraw_write, excalidraw_info)
- [x] `setup` command for Claude Code MCP registration
- [x] `bun build --compile` for single binary
- [x] Cross-platform build matrix (Linux x64/arm64, macOS x64/arm64, Windows x64)
- [x] CI workflow (typecheck + test on push/PR)
- [x] Release workflow (tag-triggered, builds all platforms)
- [x] Error handling with Effect tagged errors
- [x] Images (fileId references with dataURLs) preserved through round-trip

### Key Files

```
excalicli/
  src/
    cli.ts              # CLI entry point + command definitions
    mcp.ts              # MCP server (stdio JSON-RPC)
    commands/
      extract.ts        # extract command
      write.ts          # write command (render + embed)
      convert.ts        # convert command (extract + write)
      info.ts           # info command
    lib/
      png.ts            # PNG chunk read/write + CRC32
      svg.ts            # SVG metadata read/write
      decode.ts         # Decompress excalidraw encoded data
      encode.ts         # Compress scene data for embedding
      render.ts         # jsdom + @excalidraw/excalidraw + resvg-js
      write.ts          # Format-aware writing (render + embed)
      scene.ts          # Scene schema (Effect.Schema), loading, info
      errors.ts         # Tagged error types
  test/
    extract.test.ts     # PNG/SVG extraction, roundtrip, schema
    render.test.ts      # SVG/PNG rendering, write pipeline
    write.test.ts       # Full write workflow, roundtrip
    convert.test.ts     # Convert between formats, --base flag
    mcp.test.ts         # MCP server tools, initialization
    create-fixtures.ts  # Test fixture generation
  .github/workflows/
    ci.yml              # Test + typecheck on push/PR
    release.yml         # Cross-platform binary builds on tag
  package.json
  tsconfig.json
```

### Key Dependencies
- `@excalidraw/excalidraw` - rendering engine (includes fonts)
- `jsdom` - DOM shim for headless rendering
- `@resvg/resvg-js` - SVG to PNG rasterization (NAPI)
- `png-chunks-extract`, `png-chunk-text` - PNG metadata read
- `pako` - zlib compatible compression/decompression
- `commander` - CLI framework
- `effect` - functional error handling (tagged errors, Schema)
- `@modelcontextprotocol/sdk` - MCP server
- `zod` - schema validation (MCP tool parameters)

### Risks & Mitigations

| Risk | Mitigation | Outcome |
|------|------------|---------|
| `bun build --compile` doesn't bundle NAPI modules | Build matrix with native runners per platform | Resolved: NAPI modules bundle correctly per-platform |
| @excalidraw/excalidraw jsdom compatibility | Canvas2D stub + FontFace polyfill + lazy DOM init | Resolved: works with comprehensive browser global setup |
| Font rendering differences vs web | Fonts bundled via @excalidraw/excalidraw npm package | Resolved: fonts included in compiled binary |
| Large binary size from bundling excalidraw | Accept it - single binary convenience outweighs size | Accepted |
| excalidraw breaking changes | Pin to specific version, update periodically | Mitigated |

### Verification Plan
1. ~~Export test diagrams from excalidraw.com with "Embed scene" enabled~~ → Synthetic fixtures with deterministic generation
2. `extract` on fixtures produces valid JSON matching the original scene ✓
3. `write` with scene JSON produces PNG/SVG that round-trips correctly ✓
4. Round-trip test: extract -> modify JSON (add element) -> embed -> extract -> verify modification present ✓
5. ~~Visual comparison: rendered output vs excalidraw.com export~~ → Structural verification (PNG magic bytes, SVG structure, element counts)
6. Test with: simple shapes, arrows with bindings, text elements ✓ (999-element stress test with diverse types)
