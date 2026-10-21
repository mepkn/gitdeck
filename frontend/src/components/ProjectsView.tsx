import { useEffect, useMemo, useRef, useState } from "react";
import { FolderPlus, Search, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/Logo";
import { Gitdeck, errorMessage, type ProjectInfo, type State } from "@/lib/api";
import { cn } from "@/lib/utils";

type Props = { state: State; onState: (s: State) => void; onOpen: (path: string) => void };

const tints = ["text-status-added", "text-status-untracked", "text-status-deleted", "text-status-modified", "text-status-conflict"];

export function ProjectsView({ state, onState, onOpen }: Props) {
  const [info, setInfo] = useState<Record<string, ProjectInfo>>({});
  const [query, setQuery] = useState("");
  const search = useRef<HTMLInputElement>(null);

  useEffect(() => {
    Gitdeck.Overview().then((list) => setInfo(Object.fromEntries((list ?? []).map((p) => [p.path, p]))));
  }, [state.projects?.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey && e.key === "k") {
        e.preventDefault();
        search.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const projects = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...(state.projects ?? [])]
      .sort((a, b) => b.opened - a.opened)
      .filter((p) => !q || p.name.toLowerCase().includes(q) || p.path.toLowerCase().includes(q));
  }, [state.projects, query]);

  const add = async () => {
    try {
      const dir = await Gitdeck.PickFolder();
      if (dir) onOpen(dir);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const remove = async (path: string) => {
    onState(await Gitdeck.RemoveProject(path));
  };

  const home = (p: string) => p.replace(/^\/Users\/[^/]+/, "~");

  return (
    <div className="flex h-full flex-col">
      <div className="drag h-12 shrink-0" />
      <div className="min-h-0 flex-1 overflow-auto px-6 pb-16">
        <div className="mx-auto flex max-w-2xl flex-col gap-5 pt-6">
          <div className="flex items-center gap-3.5">
            <Logo className="size-11" />
            <div className="flex-1">
              <h1 className="text-2xl font-semibold">Gitdeck</h1>
              <p className="text-muted-foreground">{state.projects?.length ? "Pick a repository" : "Add a git repository to start"}</p>
            </div>
            <Button onClick={add}>
              <FolderPlus /> Add folder…
            </Button>
          </div>

          {!!state.projects?.length && (
            <>
              <label className="flex h-10 items-center gap-2 rounded-lg border bg-secondary/60 px-3 text-muted-foreground">
                <Search className="size-4" />
                <input
                  ref={search}
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && projects[0] && onOpen(projects[0].path)}
                  placeholder="Search projects  ⌘K"
                  aria-label="Search projects"
                  className="w-full bg-transparent text-sm text-foreground outline-none"
                />
              </label>
              <div className="mt-1 text-[11px] tracking-wider text-muted-foreground uppercase">Recent</div>
              <div className="flex flex-col gap-2">
                {projects.map((p, i) => {
                  const inf = info[p.path];
                  return (
                    <div key={p.path} className="group relative">
                      <button
                        onClick={() => onOpen(p.path)}
                        className="flex w-full items-center gap-3.5 rounded-xl border bg-card px-4 py-3.5 text-left transition-colors hover:bg-accent"
                      >
                        <div className={cn("flex size-9 items-center justify-center rounded-lg bg-secondary text-[15px] font-semibold", tints[i % tints.length])}>
                          {p.name[0]?.toUpperCase()}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold">{p.name}</div>
                          <div className="mt-0.5 truncate font-mono text-xs text-muted-foreground">{home(p.path)}</div>
                        </div>
                        <div className="flex flex-col items-end gap-0.5 pr-6 text-xs text-muted-foreground">
                          {inf?.error ? (
                            <span className="text-destructive">{inf.error}</span>
                          ) : inf ? (
                            <>
                              <span className="font-mono text-foreground/80">{inf.branch}</span>
                              <span>{describe(inf)}</span>
                            </>
                          ) : null}
                        </div>
                      </button>
                      <button
                        onClick={() => remove(p.path)}
                        aria-label={`Remove ${p.name} from the list`}
                        title="Remove from list (the folder stays)"
                        className="absolute top-1/2 right-3 -translate-y-1/2 rounded-md p-1 text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-secondary hover:text-foreground"
                      >
                        <X className="size-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </>
          )}
          <p className="mt-1 text-[12.5px] text-muted-foreground">Also opens from agentdeck: the Git button on a project opens it here.</p>
        </div>
      </div>
    </div>
  );
}

function describe(p: ProjectInfo): string {
  const parts: string[] = [];
  if (p.changed) parts.push(`${p.changed} changed`);
  if (p.ahead) parts.push(`↑${p.ahead}`);
  if (p.behind) parts.push(`↓${p.behind}`);
  return parts.join(" · ") || "clean";
}
