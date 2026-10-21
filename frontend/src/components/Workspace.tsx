import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Events } from "@wailsio/runtime";
import { ArrowDown, ArrowUp, ChevronDown, Folder, FolderPlus, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { BranchMenu } from "@/components/BranchMenu";
import { ChangesPanel } from "@/components/ChangesPanel";
import { CommitPane } from "@/components/CommitPane";
import { useConfirm } from "@/lib/confirm";
import { DiffView, Segmented, type DiffMode } from "@/components/DiffView";
import { HistoryPanel } from "@/components/HistoryPanel";
import { SavedStashesDialog, StashChangesDialog } from "@/components/StashDialogs";
import { Gitdeck, errorMessage, type Commit, type Diff, type File, type RepoChanged, type Stash, type State, type Status } from "@/lib/api";
import { cn } from "@/lib/utils";

type Props = {
  state: State;
  onState: (s: State) => void;
  onOpen: (path: string) => void;
  onClose: () => void;
};

export type Selected = { path: string; staged: boolean };
type Busy = "fetch" | "pull" | "push" | null;

export function Workspace({ state, onState, onOpen, onClose }: Props) {
  const dir = state.active;
  const confirm = useConfirm();
  const [status, setStatus] = useState<Status | null>(null);
  const [stashes, setStashes] = useState<Stash[]>([]);
  const [tab, setTab] = useState<"changes" | "history">("changes");
  // What the user clicked; `selected` below falls back when it's gone.
  const [chosen, setSelected] = useState<Selected | null>(null);
  const [mode, setMode] = useState<DiffMode>(state.diffMode === "inline" ? "inline" : "split");
  const [full, setFull] = useState(state.fullFile);
  const [busy, setBusy] = useState<Busy>(null);
  // Bumped on every change on disk, so open views reload.
  const [version, setVersion] = useState(0);
  const [live, setLive] = useState(false);
  const liveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [commit, setCommit] = useState<Commit | null>(null);
  const [stashOpen, setStashOpen] = useState<"new" | "list" | null>(null);

  const refresh = useCallback(
    () =>
      Promise.all([Gitdeck.Status(dir), Gitdeck.Stashes(dir)])
        .then(([st, ss]) => {
          setStatus(st);
          setStashes(ss ?? []);
          setVersion((v) => v + 1);
        })
        .catch((e) => toast.error(errorMessage(e))),
    [dir],
  );

  useEffect(() => {
    refresh();
    Gitdeck.Watch(dir);
    const off = Events.On("repo:changed", (e) => {
      if ((e.data as RepoChanged).dir !== dir) return;
      refresh();
      // "Live" while files keep changing, e.g. an agent at work.
      setLive(true);
      clearTimeout(liveTimer.current);
      liveTimer.current = setTimeout(() => setLive(false), 6000);
    });
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      off();
      window.removeEventListener("focus", onFocus);
      Gitdeck.Watch("");
      clearTimeout(liveTimer.current);
    };
  }, [dir, refresh]);

  const files = useMemo(() => status?.files ?? [], [status]);
  const { selected, selectedFile } = useMemo(() => pickSelection(files, chosen), [files, chosen]);

  // The diff of the selected file; reloaded when it changes on disk (version).
  const diffKey = selected ? `${selected.path}|${selected.staged}|${full}|${version}` : "";
  const [diffResult, setDiffResult] = useState<{ key: string; path: string; diff: Diff } | null>(null);
  useEffect(() => {
    if (!selected || !selectedFile) return;
    let live = true;
    Gitdeck.Diff(dir, selectedFile, selected.staged, full)
      .then((d) => live && d && setDiffResult({ key: diffKey, path: selected.path, diff: d }))
      .catch((e) => live && toast.error(errorMessage(e)));
    return () => {
      live = false;
    };
  }, [diffKey]); // eslint-disable-line react-hooks/exhaustive-deps
  // While reloading the same file, keep showing its last diff (no flicker).
  const diff = diffResult && selected && diffResult.path === selected.path ? diffResult.diff : null;
  const diffLoading = !!selected && diffResult?.key !== diffKey;

  const changeMode = (m: DiffMode) => {
    setMode(m);
    Gitdeck.SetDiffMode(m);
  };
  const changeFull = (f: boolean) => {
    setFull(f);
    Gitdeck.SetFullFile(f);
  };

  const remote = useCallback(
    async (op: Exclude<Busy, null>) => {
      if (busy) return;
      setBusy(op);
      try {
        if (op === "fetch") await Gitdeck.Fetch(dir);
        if (op === "pull") await Gitdeck.Pull(dir);
        if (op === "push") await Gitdeck.Push(dir);
        toast.success(op === "fetch" ? "Fetched" : op === "pull" ? "Pulled" : "Pushed");
      } catch (e) {
        toast.error(errorMessage(e));
      } finally {
        setBusy(null);
        refresh();
      }
    },
    [busy, dir, refresh],
  );

  const discard = async (f: File) => {
    const untracked = f.work === "?" || f.index === "A";
    const ok = await confirm({
      title: `Discard changes to ${f.path.split("/").pop()}?`,
      description: untracked
        ? "The file is new, so it moves to the Trash."
        : "Its staged and unstaged changes are lost; this can't be undone.",
      action: "Discard",
      destructive: true,
    });
    if (!ok) return;
    try {
      await Gitdeck.Discard(dir, f);
    } catch (e) {
      toast.error(errorMessage(e));
    }
    refresh();
  };

  // Keyboard: ⌘1 / ⌘2 tabs, ⌘P push, ⌘⇧P pull, ⌘⇧T fetch.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.metaKey) return;
      const k = e.key.toLowerCase();
      if (k === "1") setTab("changes");
      else if (k === "2") setTab("history");
      else if (k === "p" && e.shiftKey) remote("pull");
      else if (k === "p") remote("push");
      else if (k === "t" && e.shiftKey) remote("fetch");
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [remote]);

  const recent = [...(state.projects ?? [])].sort((a, b) => b.opened - a.opened);
  const name = recent.find((p) => p.path === dir)?.name ?? dir.split("/").pop();
  const pick = async () => {
    const d = await Gitdeck.PickFolder().catch(() => "");
    if (d) onOpen(d);
  };

  return (
    <div className="flex h-full flex-col">
      {/* top bar; the left padding clears the window buttons */}
      <div className="drag flex h-12 shrink-0 items-center gap-2 border-b bg-sidebar pr-3 pl-[84px]">
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" size="sm" className="no-drag font-semibold" />}>
            <Folder className="text-primary" /> {name} <ChevronDown className="opacity-60" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64">
            {recent.map((p) => (
              <DropdownMenuItem key={p.path} onClick={() => p.path !== dir && onOpen(p.path)}>
                <Folder className={p.path === dir ? "text-primary" : ""} /> {p.name}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={pick}>
              <FolderPlus /> Add folder…
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onClose}>All projects</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {status && <BranchMenu dir={dir} status={status} hasChanges={files.length > 0} onChanged={refresh} />}
        <div className="flex-1" />
        {live && (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="size-1.5 animate-pulse rounded-full bg-status-modified" /> files changing · live
          </span>
        )}
        <RemoteButton label="Fetch" busy={busy === "fetch"} onClick={() => remote("fetch")} icon={<RefreshCw />} title="Fetch (⌘⇧T)" />
        <RemoteButton
          label="Pull"
          busy={busy === "pull"}
          onClick={() => remote("pull")}
          icon={<ArrowDown />}
          count={status?.behind}
          title="Pull (⌘⇧P)"
        />
        <RemoteButton
          label="Push"
          primary
          busy={busy === "push"}
          onClick={() => remote("push")}
          icon={<ArrowUp />}
          count={status?.upstream ? status.ahead : undefined}
          title={status?.upstream ? "Push (⌘P)" : "Publish branch to origin (⌘P)"}
        />
      </div>

      <div className="flex min-h-0 flex-1">
        {/* left: the diff or the selected commit */}
        <div className="flex min-w-0 flex-1 flex-col">
          {tab === "changes" ? (
            selected && selectedFile ? (
              <DiffView
                diff={diff}
                loading={diffLoading}
                path={selected.path}
                mode={mode}
                onModeChange={changeMode}
                full={full}
                onFullChange={changeFull}
                actions={
                  <Button variant="ghost" size="sm" className="text-diff-del-fg" onClick={() => discard(selectedFile)}>
                    <Trash2 /> Discard file
                  </Button>
                }
              />
            ) : (
              <Empty title={status ? "No changes" : ""} text={status ? "Nothing to commit. Edits show up here as soon as they're saved." : ""} />
            )
          ) : commit ? (
            <CommitPane key={commit.sha} dir={dir} commit={commit} mode={mode} onModeChange={changeMode} full={full} onFullChange={changeFull} onChanged={refresh} />
          ) : (
            <Empty title="No commit selected" text="Pick a commit on the right." />
          )}
        </div>

        {/* right sidebar */}
        <aside className="flex w-[340px] shrink-0 flex-col border-l bg-sidebar">
          <div className="p-2.5 pb-1">
            <Segmented
              className="[&>button]:h-7"
              value={tab}
              onChange={setTab}
              options={[
                {
                  value: "changes",
                  label: (
                    <>
                      Changes {files.length > 0 && <span className="text-primary">{files.length}</span>}
                    </>
                  ),
                },
                { value: "history", label: "History" },
              ]}
            />
          </div>
          {tab === "changes" ? (
            status && (
              <ChangesPanel
                dir={dir}
                status={status}
                selected={selected}
                onSelect={setSelected}
                onDiscard={discard}
                onChanged={refresh}
                stashCount={stashes.length}
                onStash={() => setStashOpen("new")}
                onStashes={() => setStashOpen("list")}
                agent={state.agent === "agy" ? "agy" : "claude"}
                onAgent={async (a) => {
                  await Gitdeck.SetAgent(a);
                  onState({ ...state, agent: a });
                }}
              />
            )
          ) : (
            <HistoryPanel dir={dir} version={version} selected={commit} onSelect={setCommit} />
          )}
        </aside>
      </div>

      {status && stashOpen === "new" && (
        <StashChangesDialog open onOpenChange={(o) => !o && setStashOpen(null)} dir={dir} status={status} onDone={refresh} />
      )}
      {stashOpen === "list" && (
        <SavedStashesDialog
          open
          onOpenChange={(o) => !o && setStashOpen(null)}
          dir={dir}
          name={name ?? ""}
          stashes={stashes}
          mode={mode}
          onDone={refresh}
        />
      )}
    </div>
  );
}

function RemoteButton({
  label,
  icon,
  busy,
  count,
  primary,
  title,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  busy: boolean;
  count?: number;
  primary?: boolean;
  title: string;
  onClick: () => void;
}) {
  return (
    <Button variant={primary ? "default" : "secondary"} size="sm" className="no-drag" onClick={onClick} disabled={busy} title={title}>
      {busy ? <Loader2 className="animate-spin" /> : icon}
      {label}
      {count !== undefined && count > 0 && <span className={cn("tabular-nums", primary ? "opacity-70" : "text-muted-foreground")}>{count}</span>}
    </Button>
  );
}

function Empty({ title, text }: { title: string; text: string }) {
  return (
    <div className="drag flex flex-1 flex-col items-center justify-center gap-1 text-center">
      <div className="font-medium">{title}</div>
      <div className="max-w-xs text-sm text-muted-foreground">{text}</div>
    </div>
  );
}

/**
 * The file to show: the one picked, or where it moved (staged ↔ unstaged),
 * or the first staged / changed file when it's gone.
 */
function pickSelection(files: File[], chosen: Selected | null): { selected: Selected | null; selectedFile?: File } {
  const onSide = (s: Selected) => files.find((f) => f.path === s.path && (s.staged ? f.index : f.work));
  if (chosen) {
    const f = onSide(chosen);
    if (f) return { selected: chosen, selectedFile: f };
    const other = { path: chosen.path, staged: !chosen.staged };
    const g = onSide(other);
    if (g) return { selected: other, selectedFile: g };
  }
  const first = files.find((f) => f.index) ?? files[0];
  if (!first) return { selected: null };
  return { selected: { path: first.path, staged: !!first.index }, selectedFile: first };
}
