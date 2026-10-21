// Turns git's hunks into rows for the split and inline diff views. Each
// cell points at a line of the old or new side (oldLines / newLines), so
// both sides can be syntax highlighted as whole text.

export type DiffLine = { kind: string; text: string; old: number; new: number };
export type DiffHunk = { header: string; lines: DiffLine[] };

/** A changed span inside a line, [start, end) in characters. */
export type Span = [number, number];

export type Cell = { side: "old" | "new"; index: number; number: number; kind: "ctx" | "add" | "del"; span?: Span };

export type SplitRow = { left?: Cell; right?: Cell };
/** An inline row shows both line numbers; context lines have both. */
export type InlineRow = { cell: Cell; old?: number; new?: number };

export type Section = { header: string; oldStart: number; newStart: number; split: SplitRow[]; inline: InlineRow[] };

export type DiffModel = { oldLines: string[]; newLines: string[]; sections: Section[] };

export function buildModel(hunks: DiffHunk[]): DiffModel {
  const oldLines: string[] = [];
  const newLines: string[] = [];
  const sections: Section[] = [];

  for (const hunk of hunks) {
    const split: SplitRow[] = [];
    const inline: InlineRow[] = [];
    let dels: Cell[] = [];
    let adds: Cell[] = [];

    // A run of removed lines followed by added lines is shown side by side,
    // with the changed part of each paired line marked.
    const flush = () => {
      const n = Math.max(dels.length, adds.length);
      for (let i = 0; i < n; i++) {
        const l = dels[i];
        const r = adds[i];
        if (l && r) {
          const [ls, rs] = changedSpans(oldLines[l.index], newLines[r.index]);
          l.span = ls;
          r.span = rs;
        }
        split.push({ left: l, right: r });
      }
      inline.push(...dels.map((c) => ({ cell: c, old: c.number })), ...adds.map((c) => ({ cell: c, new: c.number })));
      dels = [];
      adds = [];
    };

    for (const line of hunk.lines) {
      if (line.kind === "-") {
        if (adds.length) flush();
        oldLines.push(line.text);
        dels.push({ side: "old", index: oldLines.length - 1, number: line.old, kind: "del" });
      } else if (line.kind === "+") {
        newLines.push(line.text);
        adds.push({ side: "new", index: newLines.length - 1, number: line.new, kind: "add" });
      } else {
        flush();
        oldLines.push(line.text);
        newLines.push(line.text);
        const left: Cell = { side: "old", index: oldLines.length - 1, number: line.old, kind: "ctx" };
        const right: Cell = { side: "new", index: newLines.length - 1, number: line.new, kind: "ctx" };
        split.push({ left, right });
        inline.push({ cell: right, old: line.old, new: line.new });
      }
    }
    flush();
    const first = hunk.lines[0];
    sections.push({
      header: hunk.header,
      oldStart: first?.old || first?.new || 0,
      newStart: first?.new || first?.old || 0,
      split,
      inline,
    });
  }
  return { oldLines, newLines, sections };
}

/**
 * The differing middle of two lines, after their common prefix and suffix.
 * No span when the lines share almost nothing (a rewrite, not an edit).
 */
export function changedSpans(a: string, b: string): [Span | undefined, Span | undefined] {
  let start = 0;
  const max = Math.min(a.length, b.length);
  while (start < max && a[start] === b[start]) start++;
  let end = 0;
  while (end < max - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++;
  const kept = start + end;
  if (kept < Math.min(a.length, b.length) * 0.3) return [undefined, undefined];
  const sa: Span = [start, a.length - end];
  const sb: Span = [start, b.length - end];
  return [sa[0] < sa[1] ? sa : undefined, sb[0] < sb[1] ? sb : undefined];
}

/** File extension → Shiki language id; undefined shows plain text. */
export function languageFor(path: string): string | undefined {
  const name = path.split("/").pop()?.toLowerCase() ?? "";
  const byName: Record<string, string> = {
    dockerfile: "docker",
    makefile: "make",
    "go.mod": "go",
    caddyfile: "nginx",
  };
  if (byName[name]) return byName[name];
  const ext = name.includes(".") ? name.split(".").pop()! : "";
  const byExt: Record<string, string> = {
    ts: "typescript", mts: "typescript", cts: "typescript", tsx: "tsx",
    js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "jsx",
    go: "go", py: "python", rs: "rust", rb: "ruby", java: "java", kt: "kotlin", swift: "swift",
    c: "c", h: "c", cpp: "cpp", cc: "cpp", hpp: "cpp", m: "objective-c", mm: "objective-cpp",
    cs: "csharp", php: "php", lua: "lua", dart: "dart", scala: "scala", zig: "zig",
    sh: "bash", bash: "bash", zsh: "bash", fish: "fish",
    json: "json", jsonc: "jsonc", json5: "json5", yaml: "yaml", yml: "yaml", toml: "toml", xml: "xml", plist: "xml",
    html: "html", htm: "html", css: "css", scss: "scss", less: "less", vue: "vue", svelte: "svelte",
    md: "markdown", mdx: "mdx", sql: "sql", graphql: "graphql", gql: "graphql", proto: "proto",
    tf: "terraform", ini: "ini", env: "dotenv", gradle: "groovy", kts: "kotlin", svg: "xml",
  };
  return byExt[ext];
}
