import { useMemo, type ReactNode } from "react";
import { FileWarning, Loader2 } from "lucide-react";
import type { Diff } from "@/lib/api";
import { buildModel, languageFor, type Cell, type Span } from "@/lib/diff";
import { useHighlight, type Token } from "@/lib/highlight";
import { splitPath } from "@/lib/format";
import { cn } from "@/lib/utils";

export type DiffMode = "split" | "inline";

type Props = {
  diff: Diff | null;
  loading?: boolean;
  path: string;
  mode: DiffMode;
  onModeChange: (m: DiffMode) => void;
  full: boolean;
  onFullChange: (full: boolean) => void;
  /** Buttons for the header's right end, e.g. Discard. */
  actions?: ReactNode;
};

export function DiffView({ diff, loading, path, mode, onModeChange, full, onFullChange, actions }: Props) {
  const model = useMemo(() => buildModel((diff?.hunks ?? []).map((h) => ({ header: h.header, lines: h.lines ?? [] }))), [diff]);
  const tokens = useHighlight(model.oldLines, model.newLines, languageFor(path));
  const { dir, name } = splitPath(path);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="drag flex h-11 shrink-0 items-center gap-2.5 border-b px-3.5">
        <span className="selectable no-drag truncate font-mono text-[13px] text-muted-foreground">
          {dir && `${dir}/`}
          <span className="text-foreground">{name}</span>
        </span>
        {diff && !diff.binary && (
          <span className="font-mono text-xs">
            <span className="text-diff-add-fg">+{diff.added}</span> <span className="text-diff-del-fg">−{diff.removed}</span>
          </span>
        )}
        <div className="flex-1" />
        <div className="no-drag flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <input type="checkbox" checked={full} onChange={(e) => onFullChange(e.target.checked)} className="accent-primary" />
            Whole file
          </label>
          <Segmented
            value={mode}
            onChange={onModeChange}
            options={[
              { value: "split", label: "Split" },
              { value: "inline", label: "Inline" },
            ]}
          />
          {actions}
        </div>
      </div>
      <div className="selectable min-h-0 flex-1 overflow-auto pb-4 font-mono text-[12.5px] leading-5">
        {loading && !diff ? (
          <Centered>
            <Loader2 className="size-4 animate-spin" />
          </Centered>
        ) : !diff ? null : diff.binary ? (
          <Centered>
            <FileWarning className="size-4" /> Binary file; no text diff.
          </Centered>
        ) : model.sections.length === 0 ? (
          <Centered>No changes to show.</Centered>
        ) : (
          <>
            {model.sections.map((s, i) => (
              <div key={i}>
                <div className="sticky top-0 z-10 bg-background">
                  <div className="truncate bg-diff-hunk/10 py-1 pl-3 text-xs text-diff-hunk">
                    @@ −{s.oldStart} +{s.newStart} @@ {s.header}
                  </div>
                </div>
                {mode === "split"
                  ? s.split.map((r, j) => (
                      <div key={j} className="flex">
                        <CodeCell cell={r.left} tokens={tokens?.old} lines={model.oldLines} className="border-r border-border/60" />
                        <CodeCell cell={r.right} tokens={tokens?.new} lines={model.newLines} />
                      </div>
                    ))
                  : s.inline.map((r, j) => {
                      const side = r.cell.side === "old" ? tokens?.old : tokens?.new;
                      const lines = r.cell.side === "old" ? model.oldLines : model.newLines;
                      return (
                        <div key={j} className={cn("flex", rowBg(r.cell.kind))}>
                          <Gutter n={r.old} kind={r.cell.kind} />
                          <Gutter n={r.new} kind={r.cell.kind} className="border-r border-border/60" />
                          <span className="w-4 shrink-0 text-center text-muted-foreground/60">
                            {r.cell.kind === "add" ? "+" : r.cell.kind === "del" ? "−" : ""}
                          </span>
                          <Code cell={r.cell} tokens={side} lines={lines} />
                        </div>
                      );
                    })}
              </div>
            ))}
            {diff.truncated && <div className="px-3 py-3 text-xs text-muted-foreground">Diff cut short: the file is very large.</div>}
          </>
        )}
      </div>
    </div>
  );
}

function rowBg(kind: Cell["kind"]) {
  return kind === "add" ? "bg-diff-add" : kind === "del" ? "bg-diff-del" : "";
}

function Gutter({ n, kind, className }: { n?: number; kind?: Cell["kind"]; className?: string }) {
  return (
    <span
      className={cn(
        "w-12 shrink-0 pr-2.5 text-right text-muted-foreground/50 select-none",
        kind === "add" && "text-diff-add-fg/70",
        kind === "del" && "text-diff-del-fg/70",
        className,
      )}
    >
      {n || ""}
    </span>
  );
}

function CodeCell({ cell, tokens, lines, className }: { cell?: Cell; tokens?: Token[][]; lines: string[]; className?: string }) {
  if (!cell) return <div className={cn("diff-pad flex min-w-0 flex-1", className)} />;
  return (
    <div className={cn("flex min-w-0 flex-1", rowBg(cell.kind), className)}>
      <Gutter n={cell.number} kind={cell.kind} />
      <Code cell={cell} tokens={tokens} lines={lines} />
    </div>
  );
}

function Code({ cell, tokens, lines }: { cell: Cell; tokens?: Token[][]; lines: string[] }) {
  const line = tokens?.[cell.index] ?? [{ content: lines[cell.index] ?? "" }];
  const strong = cell.kind === "add" ? "bg-diff-add-strong" : "bg-diff-del-strong";
  return (
    <span className="min-w-0 flex-1 pl-2 whitespace-pre-wrap break-words">
      {withSpan(line, cell.span).map((t, i) => (
        <span key={i} style={t.color ? { color: t.color } : undefined} className={t.mark ? cn(strong, "rounded-[2px]") : undefined}>
          {t.content}
        </span>
      ))}
      {line.length === 0 || (line.length === 1 && line[0].content === "") ? "​" : null}
    </span>
  );
}

/** Splits tokens at the changed span's edges so it can be marked. */
function withSpan(tokens: Token[], span?: Span): (Token & { mark?: boolean })[] {
  if (!span) return tokens;
  const out: (Token & { mark?: boolean })[] = [];
  let pos = 0;
  for (const t of tokens) {
    const start = pos;
    const end = pos + t.content.length;
    pos = end;
    const cuts = [start, Math.max(start, Math.min(end, span[0])), Math.max(start, Math.min(end, span[1])), end];
    for (let i = 0; i < 3; i++) {
      if (cuts[i + 1] > cuts[i]) out.push({ ...t, content: t.content.slice(cuts[i] - start, cuts[i + 1] - start), mark: i === 1 });
    }
  }
  return out;
}

function Centered({ children }: { children: ReactNode }) {
  return <div className="flex h-full items-center justify-center gap-2 font-sans text-sm text-muted-foreground">{children}</div>;
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode }[];
  className?: string;
}) {
  return (
    <div className={cn("flex gap-0.5 rounded-lg bg-secondary p-0.5", className)} role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "flex h-6 flex-1 items-center justify-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-muted-foreground transition-colors",
            value === o.value ? "bg-accent text-foreground shadow-sm" : "hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
