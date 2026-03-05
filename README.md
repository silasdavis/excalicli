# excalicli

CLI tool for working with [Excalidraw](https://excalidraw.com) files. Extract, render, convert, and embed scene data in PNG and SVG files.

## Features

- **Extract** embedded scene JSON from PNG/SVG files
- **Write** scene JSON to rendered PNG/SVG with embedded scene data
- **Convert** between formats (.excalidraw, .png, .svg)
- **Info** — inspect scene metadata (element counts, dimensions, etc.)
- **MCP server** for AI-assisted editing with Claude Code
- Full round-trip: extract scene → edit JSON → re-render with updated pixels

## Installation

### Download binary

Download the latest release for your platform from [Releases](../../releases).

### Build from source

Requires [Bun](https://bun.sh) v1.3.9+.

```bash
bun install
bun run build
```

## Usage

### Extract scene JSON

```bash
excalicli extract diagram.png      # from PNG
excalicli extract diagram.svg      # from SVG
excalicli extract scene.excalidraw # passthrough
```

### Write rendered output

```bash
# Render scene to PNG with embedded data
excalicli write output.png --scene scene.excalidraw

# Render scene to SVG with embedded data
excalicli write output.svg --scene scene.excalidraw

# Read from stdin
cat scene.json | excalicli write output.png --scene -

# Metadata-only: embed new scene into existing file without re-rendering
excalicli write output.png --scene modified.json --base existing.png
```

### Convert between formats

```bash
excalicli convert diagram.png -o diagram.svg
excalicli convert diagram.svg -o scene.excalidraw
excalicli convert scene.excalidraw -o diagram.png
```

### Show file info

```bash
excalicli info diagram.png
```

```
File:       diagram.png
Format:     PNG with embedded scene
Version:    2
Elements:   5 active (5 total)
Types:
  rectangle: 2
  text: 2
  arrow: 1
Bounds:     800x600 (at 50,50)
Background: #ffffff
```

### MCP server (AI integration)

Register excalicli as an MCP server so Claude Code can read, edit, and render excalidraw files directly:

```bash
# Automatic setup (recommended)
excalicli setup

# Or manual registration:
claude mcp add excalicli -- /path/to/excalicli mcp

# For development (from source):
claude mcp add excalicli -- bun /path/to/excalicli/src/cli.ts mcp
```

The `setup` command auto-detects the binary path and registers it with Claude Code. Use `--scope user` to register globally instead of per-project.

**Available MCP tools:**

| Tool | Description |
|------|-------------|
| `excalidraw_read` | Extract scene JSON from a PNG, SVG, or .excalidraw file |
| `excalidraw_write` | Render scene JSON to PNG/SVG with embedded data |
| `excalidraw_info` | Show scene metadata (element counts, dimensions, etc.) |

**Workflow**: Claude can read an existing diagram, modify the scene JSON (add/remove/edit elements), and write it back — producing an updated image with both rendered pixels and embedded scene data for future editing.

## Supported formats

| Format | Read | Write |
|--------|------|-------|
| `.excalidraw` / `.json` | Scene JSON passthrough | Direct write |
| `.png` | Extract from tEXt chunk | Render + embed scene |
| `.svg` | Extract from metadata | Render + embed scene |

## How it works

Excalidraw embeds scene JSON in exported files:
- **PNG**: tEXt chunk with keyword `application/vnd.excalidraw+json`
- **SVG**: Base64-encoded payload in `<metadata>` element

excalicli uses the same format, so files produced by this tool are fully compatible with excalidraw.com.

For rendering, the pipeline is:
1. `@excalidraw/excalidraw` `exportToSvg()` with jsdom for headless DOM
2. `@resvg/resvg-js` for SVG → PNG rasterization

## Development

```bash
bun install          # install dependencies
bun test             # run tests (includes typecheck)
bun run typecheck    # typecheck only
bun run build        # compile to single binary
```

## License

MIT
