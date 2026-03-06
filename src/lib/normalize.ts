/**
 * Scene normalization — fills sensible defaults for missing fields.
 *
 * Allows callers to specify minimal element specs (type, x, y + type-specific
 * fields) and get fully-formed excalidraw elements back.
 */

let _counter = 1;

function nextSeed(): number {
  return _counter++;
}

function randomId(): string {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Defaults shared by every element type. */
const BASE_DEFAULTS: Record<string, unknown> = {
  angle: 0,
  strokeColor: "#1e1e1e",
  backgroundColor: "transparent",
  fillStyle: "solid",
  strokeWidth: 2,
  strokeStyle: "solid",
  roughness: 0,
  opacity: 100,
  groupIds: [],
  frameId: null,
  boundElements: [],
  isDeleted: false,
  updated: 1,
  link: null,
  locked: false,
};

/** Fill a single field only if it's not already present on the element. */
function defaults(
  el: Record<string, unknown>,
  key: string,
  value: unknown,
): void {
  if (!(key in el)) {
    el[key] = value;
  }
}

/** Apply defaults from an object, skipping keys already present. */
function applyDefaults(
  el: Record<string, unknown>,
  defs: Record<string, unknown>,
): void {
  for (const [k, v] of Object.entries(defs)) {
    defaults(el, k, v);
  }
}

function normalizeText(el: Record<string, unknown>): void {
  defaults(el, "strokeWidth", 1);
  defaults(el, "fontSize", 20);
  defaults(el, "fontFamily", 1);
  defaults(el, "textAlign", "left");
  defaults(el, "verticalAlign", "top");
  defaults(el, "lineHeight", 1.25);
  defaults(el, "autoResize", true);
  defaults(el, "roundness", null);
  defaults(el, "containerId", null);

  const text = (el.text as string) ?? "";
  defaults(el, "originalText", text);

  const fontSize = el.fontSize as number;
  const lineHeight = el.lineHeight as number;
  const lines = text.split("\n").length;

  defaults(el, "width", text.length * fontSize * 0.6);
  defaults(el, "height", fontSize * lineHeight * lines);
}

function normalizeRectangle(el: Record<string, unknown>): void {
  defaults(el, "roundness", { type: 3 });
}

function normalizeEllipse(el: Record<string, unknown>): void {
  defaults(el, "roundness", { type: 2 });
}

function normalizeLineOrArrow(el: Record<string, unknown>): void {
  defaults(el, "roundness", { type: 2 });
  defaults(el, "lastCommittedPoint", null);
  defaults(el, "startBinding", null);
  defaults(el, "endBinding", null);
  defaults(el, "startArrowhead", null);
  defaults(el, "polygon", false);

  if (el.type === "arrow") {
    defaults(el, "endArrowhead", "arrow");
  } else {
    defaults(el, "endArrowhead", null);
  }

  // Derive width/height from points bounding box if missing
  const points = el.points as number[][] | undefined;
  if (points && points.length > 0) {
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const pt of points) {
      const px = pt[0] ?? 0;
      const py = pt[1] ?? 0;
      minX = Math.min(minX, px);
      minY = Math.min(minY, py);
      maxX = Math.max(maxX, px);
      maxY = Math.max(maxY, py);
    }
    defaults(el, "width", maxX - minX);
    defaults(el, "height", maxY - minY);
  }
}

function normalizeElement(el: Record<string, unknown>): Record<string, unknown> {
  // Generate identity fields
  defaults(el, "id", randomId());
  defaults(el, "seed", nextSeed());
  defaults(el, "versionNonce", nextSeed());
  defaults(el, "version", 2);

  // Type-specific normalization runs BEFORE shared defaults so that
  // type-specific values (e.g. text strokeWidth: 1) take priority
  // over the shared base (strokeWidth: 2).
  switch (el.type) {
    case "text":
      normalizeText(el);
      break;
    case "rectangle":
      normalizeRectangle(el);
      break;
    case "ellipse":
      normalizeEllipse(el);
      break;
    case "line":
    case "arrow":
      normalizeLineOrArrow(el);
      break;
  }

  // Apply shared defaults (won't override type-specific values set above)
  applyDefaults(el, BASE_DEFAULTS);

  // Default width/height for shape types if still missing
  defaults(el, "width", 0);
  defaults(el, "height", 0);

  return el;
}

/**
 * Normalize a scene object, filling defaults for missing fields at both
 * the scene level and the element level.
 *
 * **Key principle:** If a field is already present, it is never overridden.
 *
 * @param scene - A potentially-sparse scene object (parsed JSON)
 * @returns A fully-formed excalidraw scene object
 */
export function normalizeScene(scene: Record<string, unknown>): Record<string, unknown> {
  // Scene-level defaults
  defaults(scene, "type", "excalidraw");
  defaults(scene, "version", 2);
  defaults(scene, "source", "https://excalidraw.com");
  defaults(scene, "files", {});

  if (!scene.appState || typeof scene.appState !== "object") {
    scene.appState = { viewBackgroundColor: "#ffffff" };
  } else {
    const appState = scene.appState as Record<string, unknown>;
    defaults(appState, "viewBackgroundColor", "#ffffff");
  }

  // Normalize each element
  const elements = scene.elements;
  if (Array.isArray(elements)) {
    scene.elements = elements.map((el) =>
      normalizeElement({ ...el }),
    );
  } else {
    scene.elements = [];
  }

  return scene;
}
