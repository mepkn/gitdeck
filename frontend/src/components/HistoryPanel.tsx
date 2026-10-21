import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Gitdeck, errorMessage, type Commit } from "@/lib/api";
import { layoutGraph, type GraphRow } from "@/lib/graph";
import { shortTime } from "@/lib/format";
import { cn } from "@/lib/utils";

const PAGE = 300;
const ROW = 32;
const LANE = 14;
const PAD = 12;
// Lane colours: emerald first, like the app's accent.
const COLORS = ["#34d399", "#93c5fd", "#fcd34d", "#f9a8d4", "#c4b5fd", "#fdba74", "#67e8f9", "#fca5a5"];

type Props = {
  dir: string;
  /** Bumped when the repo changes on disk. */
  version: number;
  selected: Commit | null;
  onSelect: (c: Commit) => void;
};

export function HistoryPanel({ dir, version, selected, onSelect }: Props) {
  const [commits, setCommits] = useState<Commit[] | null>(null);
  const [limit, setLimit] = useState(PAGE);
  const [query, setQuery] = useState("");

  // Reloads on every change on disk too, so new commits and moved refs show.
  useEffect(() => {
    let live = true;
    Gitdeck.Log(dir, 0, limit)
      .then((c) => {
        if (!live) return;
        const list = c ?? [];
        setCommits(list);
        if (list.length && (!selected || !list.some((x) => x.sha === selected.sha))) onSelect(list[0]);
      })
      .catch((e) => toast.error(errorMessage(e)));
    return () => {
      live = false;
    };
  }, [dir, limit, version]); // eslint-disable-line react-hooks/exhaustive-deps

  const graph = useMemo(() => layoutGraph((commits ?? []).map((c) => ({ sha: c.sha, parents: c.parents ?? [] }))), [commits]);
  const q = query.trim().toLowerCase();
  const shown = useMemo(() => {
    const all = (commits ?? []).map((c, i) => ({ c, row: graph[i] }));
    if (!q) return all;
    return all.filter(({ c }) => c.subject.toLowerCase().includes(q) || c.author.toLowerCase().includes(q) || c.sha.startsWith(q));
  }, [commits, graph, q]);
  const graphWidth = PAD * 2 + Math.max(0, Math.min(8, Math.max(1, ...graph.map((r) => r.width))) - 1) * LANE;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-2.5 pt-1.5 pb-2">
        <label className="flex h-8 items-center gap-2 rounded-lg bg-secondary px-2.5 text-muted-foreground">
          <Search className="size-3.5" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by message, author or SHA"
            aria-label="Filter commits"
            className="w-full bg-transparent text-[13px] text-foreground outline-none"
          />
        </label>
      </div>
      <div className="min-h-0 flex-1 overflow-auto border-t pb-2">
        {commits?.length === 0 && <div className="p-4 text-sm text-muted-foreground">No commits yet.</div>}
        {shown.map(({ c, row }) => (
          <button
            key={c.sha}
            onClick={() => onSelect(c)}
            className={cn(
              "flex w-full items-center pr-3 text-left text-[13px]",
              selected?.sha === c.sha ? "bg-sidebar-accent text-foreground" : "text-foreground/85 hover:bg-sidebar-accent/50",
            )}
            style={{ height: ROW }}
            title={c.subject}
          >
            {q ? <span className="w-3 shrink-0" /> : <GraphCell row={row} width={graphWidth} />}
            <span className="min-w-0 flex-1 truncate">
              {(c.refs ?? []).map((r) => (
                <RefBadge key={r} name={r} />
              ))}
              {c.subject}
            </span>
            <span className="ml-2 shrink-0 text-xs text-muted-foreground">{shortTime(c.time)}</span>
          </button>
        ))}
        {commits && commits.length >= limit && !q && (
          <div className="p-2">
            <Button variant="ghost" size="sm" className="w-full" onClick={() => setLimit((l) => l + PAGE)}>
              Load older commits
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function GraphCell({ row, width }: { row: GraphRow; width: number }) {
  const x = (i: number) => PAD + i * LANE;
  const mid = ROW / 2;
  const color = (lane: number) => COLORS[lane % COLORS.length];
  const path = (from: number, to: number, y1: number, y2: number) =>
    from === to ? `M${x(from)} ${y1}V${y2}` : `M${x(from)} ${y1}C${x(from)} ${(y1 + y2) / 2} ${x(to)} ${(y1 + y2) / 2} ${x(to)} ${y2}`;
  return (
    <svg width={width} height={ROW} className="shrink-0 overflow-hidden" aria-hidden>
      {row.top.map((s, i) => (
        <path key={"t" + i} d={path(s.from, s.to, 0, mid)} stroke={color(s.lane)} strokeWidth={2} fill="none" />
      ))}
      {row.bottom.map((s, i) => (
        <path key={"b" + i} d={path(s.from, s.to, mid, ROW)} stroke={color(s.lane)} strokeWidth={2} fill="none" />
      ))}
      <circle cx={x(row.lane)} cy={mid} r={4.5} className="fill-sidebar" stroke={color(row.lane)} strokeWidth={2.5} />
    </svg>
  );
}

function RefBadge({ name }: { name: string }) {
  const head = name.startsWith("HEAD -> ");
  const tag = name.startsWith("tag: ");
  const label = head ? name.slice(8) : tag ? name.slice(5) : name;
  if (name === "HEAD" || name.endsWith("/HEAD")) return null;
  const remote = !head && !tag && label.includes("/") && label.split("/")[0] === "origin";
  return (
    <span
      className={cn(
        "mr-1.5 rounded px-1.5 py-px font-mono text-[11px] font-medium",
        head ? "bg-primary/15 text-primary" : remote ? "bg-status-untracked/15 text-status-untracked" : tag ? "bg-status-modified/15 text-status-modified" : "bg-secondary text-foreground/80",
      )}
    >
      {label}
    </span>
  );
}
