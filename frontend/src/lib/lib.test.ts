import { describe, expect, it } from "vitest";
import { buildModel, changedSpans, languageFor } from "./diff";
import { layoutGraph } from "./graph";
import { relativeTime } from "./format";

describe("buildModel", () => {
  const hunks = [
    {
      header: "func a()",
      lines: [
        { kind: " ", text: "x := 1", old: 10, new: 10 },
        { kind: "-", text: "y := 2", old: 11, new: 0 },
        { kind: "-", text: "z := 3", old: 12, new: 0 },
        { kind: "+", text: "y := 20", old: 0, new: 11 },
        { kind: " ", text: "}", old: 13, new: 12 },
      ],
    },
  ];

  it("pairs removed and added lines side by side", () => {
    const m = buildModel(hunks);
    const s = m.sections[0];
    expect(s.split).toHaveLength(4);
    expect(s.split[1].left?.number).toBe(11);
    expect(s.split[1].right?.number).toBe(11);
    expect(s.split[2].left?.number).toBe(12);
    expect(s.split[2].right).toBeUndefined();
    expect(s.oldStart).toBe(10);
  });

  it("lists removed lines before added ones inline", () => {
    const kinds = buildModel(hunks).sections[0].inline.map((r) => r.cell.kind);
    expect(kinds).toEqual(["ctx", "del", "del", "add", "ctx"]);
  });

  it("keeps whole sides for highlighting", () => {
    const m = buildModel(hunks);
    expect(m.oldLines).toEqual(["x := 1", "y := 2", "z := 3", "}"]);
    expect(m.newLines).toEqual(["x := 1", "y := 20", "}"]);
  });

  it("marks the changed part of paired lines", () => {
    const s = buildModel(hunks).sections[0];
    expect(s.split[1].right?.span).toEqual([6, 7]);
    expect(s.split[1].left?.span).toBeUndefined();
  });
});

describe("changedSpans", () => {
  it("skips lines that share little", () => {
    expect(changedSpans("abc", "xyz")).toEqual([undefined, undefined]);
  });
  it("finds the edited middle", () => {
    expect(changedSpans("send(msg)", "post(msg)")).toEqual([[0, 4], [0, 4]]);
  });
});

describe("languageFor", () => {
  it("maps extensions and names", () => {
    expect(languageFor("desktop/push.go")).toBe("go");
    expect(languageFor("src/App.tsx")).toBe("tsx");
    expect(languageFor("Dockerfile")).toBe("docker");
    expect(languageFor("LICENSE")).toBeUndefined();
  });
});

describe("layoutGraph", () => {
  it("keeps a straight history in one lane", () => {
    const rows = layoutGraph([
      { sha: "c", parents: ["b"] },
      { sha: "b", parents: ["a"] },
      { sha: "a", parents: [] },
    ]);
    expect(rows.map((r) => r.lane)).toEqual([0, 0, 0]);
    expect(rows[0].top).toEqual([]);
    expect(rows[2].bottom).toEqual([]);
  });

  it("opens and closes a lane around a merge", () => {
    // m merges f into b; f branched off a.
    const rows = layoutGraph([
      { sha: "m", parents: ["b", "f"] },
      { sha: "f", parents: ["a"] },
      { sha: "b", parents: ["a"] },
      { sha: "a", parents: [] },
    ]);
    expect(rows.map((r) => r.lane)).toEqual([0, 1, 0, 0]);
    expect(rows[0].bottom).toContainEqual({ from: 0, to: 1, lane: 1 });
    // f's line bends back into lane 0 at a.
    expect(rows[3].top).toContainEqual({ from: 1, to: 0, lane: 1 });
    expect(rows[3].width).toBe(2);
  });
});

describe("relativeTime", () => {
  it("rounds to the largest unit", () => {
    const now = 1_000_000;
    expect(relativeTime(now - 30, now)).toBe("just now");
    expect(relativeTime(now - 5 * 60, now)).toBe("5 min ago");
    expect(relativeTime(now - 3 * 3600, now)).toBe("3 h ago");
    expect(relativeTime(now - 2 * 86400, now)).toBe("2 days ago");
  });
});
