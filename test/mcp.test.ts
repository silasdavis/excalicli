import { test, expect, beforeAll } from "bun:test";
import { existsSync, rmSync, mkdirSync } from "node:fs";

const MCP_OUT_DIR = "test/fixtures/mcp-output";

// Regenerate fixtures before tests
beforeAll(async () => {
  const proc = Bun.spawn(["bun", "test/create-fixtures.ts"], {
    stdout: "ignore",
    stderr: "inherit",
  });
  const code = await proc.exited;
  if (code !== 0) {
    throw new Error("Failed to create test fixtures");
  }
  if (existsSync(MCP_OUT_DIR)) {
    rmSync(MCP_OUT_DIR, { recursive: true });
  }
  mkdirSync(MCP_OUT_DIR, { recursive: true });
});

/**
 * Send a JSON-RPC request to the MCP server and get the response.
 */
async function mcpRequest(
  proc: ReturnType<typeof Bun.spawn>,
  method: string,
  params: Record<string, unknown>,
  id: number,
): Promise<any> {
  const stdin = proc.stdin as import("bun").FileSink;
  const stdout = proc.stdout as ReadableStream<Uint8Array>;

  const request = JSON.stringify({ jsonrpc: "2.0", method, params, id }) + "\n";
  stdin.write(request);
  stdin.flush();

  // Read response line
  const reader = stdout.getReader();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += new TextDecoder().decode(value);
    if (buffer.includes("\n")) {
      reader.releaseLock();
      break;
    }
  }
  return JSON.parse(buffer.trim());
}

/**
 * Spawn MCP server and run an initialization handshake.
 */
async function spawnMcpServer() {
  const proc = Bun.spawn(["bun", "src/cli.ts", "mcp"], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  // Initialize
  const initResponse = await mcpRequest(
    proc,
    "initialize",
    {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "test", version: "1.0" },
    },
    1,
  );

  expect(initResponse.result.serverInfo.name).toBe("excalicli");

  // Send initialized notification
  const stdin = proc.stdin as import("bun").FileSink;
  const notification =
    JSON.stringify({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    }) + "\n";
  stdin.write(notification);
  stdin.flush();

  return proc;
}

test("MCP server initializes and lists tools", async () => {
  const proc = await spawnMcpServer();

  try {
    const response = await mcpRequest(proc, "tools/list", {}, 2);
    const tools = response.result.tools;

    expect(tools).toHaveLength(3);
    const names = tools.map((t: any) => t.name).sort();
    expect(names).toEqual(["excalidraw_info", "excalidraw_read", "excalidraw_write"]);
  } finally {
    proc.kill();
    await proc.exited;
  }
});

test("MCP excalidraw_read extracts scene from PNG", async () => {
  const proc = await spawnMcpServer();

  try {
    const response = await mcpRequest(
      proc,
      "tools/call",
      {
        name: "excalidraw_read",
        arguments: { path: "test/fixtures/test-scene.excalidraw.png" },
      },
      2,
    );

    expect(response.result.isError).toBeUndefined();
    const content = response.result.content[0].text;
    const scene = JSON.parse(content);
    expect(scene.type).toBe("excalidraw");
    expect(scene.elements).toHaveLength(2);
  } finally {
    proc.kill();
    await proc.exited;
  }
});

test("MCP excalidraw_info returns metadata", async () => {
  const proc = await spawnMcpServer();

  try {
    const response = await mcpRequest(
      proc,
      "tools/call",
      {
        name: "excalidraw_info",
        arguments: { path: "test/fixtures/test-scene.excalidraw.png" },
      },
      2,
    );

    expect(response.result.isError).toBeUndefined();
    const text = response.result.content[0].text;
    expect(text).toContain("Elements:");
    expect(text).toContain("rectangle: 1");
    expect(text).toContain("text: 1");
  } finally {
    proc.kill();
    await proc.exited;
  }
});

test("MCP excalidraw_write creates rendered PNG with scene", async () => {
  const proc = await spawnMcpServer();
  const outPath = `${MCP_OUT_DIR}/mcp-write-test.png`;

  try {
    // Read scene first
    const readResponse = await mcpRequest(
      proc,
      "tools/call",
      {
        name: "excalidraw_read",
        arguments: { path: "test/fixtures/test-scene.excalidraw" },
      },
      2,
    );
    const sceneJson = readResponse.result.content[0].text;

    // Write to PNG
    const writeResponse = await mcpRequest(
      proc,
      "tools/call",
      {
        name: "excalidraw_write",
        arguments: { path: outPath, scene: sceneJson },
      },
      3,
    );

    expect(writeResponse.result.isError).toBeUndefined();
    expect(writeResponse.result.content[0].text).toContain("Written to");

    // Verify the file exists and is a valid PNG
    expect(existsSync(outPath)).toBe(true);
    const data = new Uint8Array(await Bun.file(outPath).arrayBuffer());
    expect(data[0]).toBe(0x89);
    expect(data[1]).toBe(0x50);
  } finally {
    proc.kill();
    await proc.exited;
  }
});

test("MCP excalidraw_read returns error for nonexistent file", async () => {
  const proc = await spawnMcpServer();

  try {
    const response = await mcpRequest(
      proc,
      "tools/call",
      {
        name: "excalidraw_read",
        arguments: { path: "nonexistent.png" },
      },
      2,
    );

    expect(response.result.isError).toBe(true);
    expect(response.result.content[0].text).toContain("Cannot read");
  } finally {
    proc.kill();
    await proc.exited;
  }
});
