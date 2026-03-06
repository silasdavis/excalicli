import { test, expect, describe } from "bun:test";
import { normalizeScene } from "../src/lib/normalize.ts";

describe("normalizeScene", () => {
  describe("scene-level defaults", () => {
    test("fills type, version, source, appState, files when missing", () => {
      const scene = normalizeScene({ elements: [] });

      expect(scene.type).toBe("excalidraw");
      expect(scene.version).toBe(2);
      expect(scene.source).toBe("https://excalidraw.com");
      expect(scene.files).toEqual({});
      expect((scene.appState as any).viewBackgroundColor).toBe("#ffffff");
    });

    test("preserves existing scene-level fields", () => {
      const scene = normalizeScene({
        type: "excalidraw",
        version: 3,
        source: "custom",
        appState: { viewBackgroundColor: "#000000", theme: "dark" },
        files: { "abc": {} },
        elements: [],
      });

      expect(scene.version).toBe(3);
      expect(scene.source).toBe("custom");
      expect((scene.appState as any).viewBackgroundColor).toBe("#000000");
      expect((scene.appState as any).theme).toBe("dark");
      expect(Object.keys(scene.files as any)).toEqual(["abc"]);
    });

    test("adds viewBackgroundColor to existing appState if missing", () => {
      const scene = normalizeScene({
        appState: { theme: "dark" },
        elements: [],
      });

      expect((scene.appState as any).viewBackgroundColor).toBe("#ffffff");
      expect((scene.appState as any).theme).toBe("dark");
    });

    test("creates elements array if missing", () => {
      const scene = normalizeScene({});
      expect(scene.elements).toEqual([]);
    });
  });

  describe("all-element defaults", () => {
    test("fills id, seed, versionNonce, angle, strokeColor, etc.", () => {
      const scene = normalizeScene({
        elements: [{ type: "rectangle", x: 10, y: 20, width: 100, height: 50 }],
      });

      const el = (scene.elements as any[])[0];
      expect(el.id).toBeTypeOf("string");
      expect(el.id.length).toBe(8);
      expect(el.seed).toBeTypeOf("number");
      expect(el.versionNonce).toBeTypeOf("number");
      expect(el.angle).toBe(0);
      expect(el.strokeColor).toBe("#1e1e1e");
      expect(el.backgroundColor).toBe("transparent");
      expect(el.fillStyle).toBe("solid");
      expect(el.strokeWidth).toBe(2);
      expect(el.strokeStyle).toBe("solid");
      expect(el.roughness).toBe(0);
      expect(el.opacity).toBe(100);
      expect(el.groupIds).toEqual([]);
      expect(el.frameId).toBeNull();
      expect(el.boundElements).toEqual([]);
      expect(el.isDeleted).toBe(false);
      expect(el.version).toBe(2);
    });

    test("never overrides existing fields", () => {
      const scene = normalizeScene({
        elements: [{
          type: "rectangle",
          id: "custom-id",
          x: 0,
          y: 0,
          width: 50,
          height: 50,
          strokeColor: "#ff0000",
          backgroundColor: "#00ff00",
          roughness: 2,
          opacity: 50,
          groupIds: ["g1"],
        }],
      });

      const el = (scene.elements as any[])[0];
      expect(el.id).toBe("custom-id");
      expect(el.strokeColor).toBe("#ff0000");
      expect(el.backgroundColor).toBe("#00ff00");
      expect(el.roughness).toBe(2);
      expect(el.opacity).toBe(50);
      expect(el.groupIds).toEqual(["g1"]);
    });
  });

  describe("text normalization", () => {
    test("auto-calculates width and height from text content", () => {
      const scene = normalizeScene({
        elements: [{ type: "text", x: 0, y: 0, text: "Hello", fontSize: 20 }],
      });

      const el = (scene.elements as any[])[0];
      // width = text.length * fontSize * 0.6 = 5 * 20 * 0.6 = 60
      expect(el.width).toBe(60);
      // height = fontSize * lineHeight * lines = 20 * 1.25 * 1 = 25
      expect(el.height).toBe(25);
    });

    test("handles multiline text height", () => {
      const scene = normalizeScene({
        elements: [{ type: "text", x: 0, y: 0, text: "Line1\nLine2\nLine3", fontSize: 20 }],
      });

      const el = (scene.elements as any[])[0];
      // height = 20 * 1.25 * 3 = 75
      expect(el.height).toBe(75);
    });

    test("sets text-specific defaults", () => {
      const scene = normalizeScene({
        elements: [{ type: "text", x: 0, y: 0, text: "Hi", fontSize: 20 }],
      });

      const el = (scene.elements as any[])[0];
      expect(el.strokeWidth).toBe(1);
      expect(el.fontFamily).toBe(1);
      expect(el.textAlign).toBe("left");
      expect(el.verticalAlign).toBe("top");
      expect(el.lineHeight).toBe(1.25);
      expect(el.autoResize).toBe(true);
      expect(el.roundness).toBeNull();
      expect(el.originalText).toBe("Hi");
      expect(el.containerId).toBeNull();
    });

    test("preserves explicit width/height on text", () => {
      const scene = normalizeScene({
        elements: [{ type: "text", x: 0, y: 0, text: "Hi", fontSize: 20, width: 200, height: 100 }],
      });

      const el = (scene.elements as any[])[0];
      expect(el.width).toBe(200);
      expect(el.height).toBe(100);
    });
  });

  describe("rectangle normalization", () => {
    test("sets roundness type 3", () => {
      const scene = normalizeScene({
        elements: [{ type: "rectangle", x: 0, y: 0, width: 100, height: 50 }],
      });

      const el = (scene.elements as any[])[0];
      expect(el.roundness).toEqual({ type: 3 });
    });

    test("preserves explicit roundness null", () => {
      const scene = normalizeScene({
        elements: [{ type: "rectangle", x: 0, y: 0, width: 100, height: 50, roundness: null }],
      });

      const el = (scene.elements as any[])[0];
      expect(el.roundness).toBeNull();
    });
  });

  describe("ellipse normalization", () => {
    test("sets roundness type 2", () => {
      const scene = normalizeScene({
        elements: [{ type: "ellipse", x: 0, y: 0, width: 100, height: 100 }],
      });

      const el = (scene.elements as any[])[0];
      expect(el.roundness).toEqual({ type: 2 });
    });
  });

  describe("line/arrow normalization", () => {
    test("derives width/height from points bounding box", () => {
      const scene = normalizeScene({
        elements: [{
          type: "line",
          x: 10,
          y: 20,
          points: [[0, 0], [100, 50], [200, -10]],
        }],
      });

      const el = (scene.elements as any[])[0];
      // width = 200 - 0 = 200
      expect(el.width).toBe(200);
      // height = 50 - (-10) = 60
      expect(el.height).toBe(60);
    });

    test("sets line-specific defaults", () => {
      const scene = normalizeScene({
        elements: [{
          type: "line",
          x: 0,
          y: 0,
          points: [[0, 0], [100, 0]],
        }],
      });

      const el = (scene.elements as any[])[0];
      expect(el.roundness).toEqual({ type: 2 });
      expect(el.lastCommittedPoint).toBeNull();
      expect(el.startBinding).toBeNull();
      expect(el.endBinding).toBeNull();
      expect(el.startArrowhead).toBeNull();
      expect(el.endArrowhead).toBeNull();
      expect(el.polygon).toBe(false);
    });

    test("arrow gets endArrowhead 'arrow' by default", () => {
      const scene = normalizeScene({
        elements: [{
          type: "arrow",
          x: 0,
          y: 0,
          points: [[0, 0], [100, 0]],
        }],
      });

      const el = (scene.elements as any[])[0];
      expect(el.endArrowhead).toBe("arrow");
      expect(el.startArrowhead).toBeNull();
    });

    test("preserves explicit endArrowhead on arrow", () => {
      const scene = normalizeScene({
        elements: [{
          type: "arrow",
          x: 0,
          y: 0,
          points: [[0, 0], [100, 0]],
          endArrowhead: "triangle",
        }],
      });

      const el = (scene.elements as any[])[0];
      expect(el.endArrowhead).toBe("triangle");
    });
  });

  describe("does not mutate input", () => {
    test("original element objects are not modified", () => {
      const original = { type: "rectangle", x: 0, y: 0, width: 50, height: 50 };
      const copy = { ...original };

      normalizeScene({ elements: [original] });

      expect(original).toEqual(copy);
    });
  });
});
