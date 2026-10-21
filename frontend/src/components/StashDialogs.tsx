import { useEffect, useState } from "react";
import { GitBranchPlus, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useConfirm } from "@/lib/confirm";
import { DiffView, type DiffMode } from "@/components/DiffView";
import { Gitdeck, errorMessage, type ChangedFile, type Diff, type Stash, type Status } from "@/lib/api";
import { plural, relativeTime } from "@/lib/format";
import { stateColor } from "@/lib/status";
import { cn } from "@/lib/utils";

type StashChangesProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dir: string;
  status: Status;
  onDone: () => void;
};

export function StashChangesDialog({ open, onOpenChange, dir, status, onDone }: StashChangesProps) {
  // Mounted only while open, so every opening starts fresh.
  const files = status.files ?? [];
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<Set<string>>(() => new Set(files.map((f) => f.path)));
  const [untracked, setUntracked] = useState(true);
  const [keepIndex, setKeepIndex] = useState(false);
  const [busy, setBusy] = useState(false);

  const chosen = files.filter((f) => picked.has(f.path) && (untracked || f.work !== "?"));
  const toggle = (path: string) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(path)) n.delete(path);
      else n.add(path);
      return n;
    });

  const stash = async () => {
    if (!chosen.length) return;
    setBusy(true);
    try {
      // Every file picked: stash without paths, which also covers deletions git can't name.
      const all = chosen.length === files.filter((f) => untracked || f.work !== "?").length;
      await Gitdeck.StashPush(dir, name, all ? [] : chosen.map((f) => f.path), untracked, keepIndex);
      toast.success(`Stashed ${plural(chosen.length, "file")}`);
      onOpenChange(false);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
      onDone();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Stash changes</DialogTitle>
          <DialogDescription>Saves your changes and cleans the working tree on {status.branch || "this commit"}.</DialogDescription>
        </DialogHeader>
        <label className="flex flex-col gap-1.5 text-[11px] tracking-wider text-muted-foreground uppercase">
          Name (optional)
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && stash()}
            placeholder="WIP: what you were doing"
            className="h-9 rounded-lg border bg-input/30 px-2.5 text-[13px] tracking-normal text-foreground normal-case outline-none focus:border-ring"
          />
        </label>
        <div>
          <div className="flex items-center text-[11px] tracking-wider text-muted-foreground uppercase">
            <span className="flex-1">Files · {files.length}</span>
            <Button variant="ghost" size="xs" onClick={() => setPicked(picked.size ? new Set() : new Set(files.map((f) => f.path)))}>
              {picked.size ? "Select none" : "Select all"}
            </Button>
          </div>
          <div className="mt-1 max-h-56 overflow-auto">
            {files.map((f) => {
              const st = f.conflict ? "U" : f.index || f.work;
              const skipped = f.work === "?" && !untracked;
              return (
                <label key={f.path} className={cn("flex h-7 items-center gap-2 px-1 text-[13px]", skipped && "opacity-40")}>
                  <input type="checkbox" checked={picked.has(f.path) && !skipped} disabled={skipped} onChange={() => toggle(f.path)} className="accent-primary" />
                  <span className={cn("w-3.5 text-center font-mono text-[11px] font-semibold", stateColor[st])}>{st === "?" ? "U" : st}</span>
                  <span className="min-w-0 flex-1 truncate">{f.path}</span>
                  <span className="text-[11.5px] text-muted-foreground">{f.work === "?" ? "untracked" : f.index && !f.work ? "staged" : ""}</span>
                </label>
              );
            })}
          </div>
        </div>
        <div className="flex flex-col gap-2 text-[13px] text-foreground/85">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={untracked} onChange={(e) => setUntracked(e.target.checked)} className="accent-primary" />
            Include untracked files
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={keepIndex} onChange={(e) => setKeepIndex(e.target.checked)} className="accent-primary" />
            Keep staged changes in the working tree
          </label>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={stash} disabled={!chosen.length || busy}>
            {busy && <Loader2 className="animate-spin" />}
            Stash {plural(chosen.length, "file")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type SavedStashesProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dir: string;
  name: string;
  stashes: Stash[];
  mode: DiffMode;
  onDone: () => void;
};

export function SavedStashesDialog({ open, onOpenChange, dir, name, stashes, mode: initialMode, onDone }: SavedStashesProps) {
  const confirm = useConfirm();
  const [chosenRef, setRef] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<{ key: string; files: ChangedFile[] } | null>(null);
  const [chosenPath, setFile] = useState<string | null>(null);
  const [diffResult, setDiffResult] = useState<{ key: string; diff: Diff } | null>(null);
  const [mode, setMode] = useState<DiffMode>(initialMode);
  const [full, setFull] = useState(false);
  const [busy, setBusy] = useState(false);
  // Mounted only while open. The picked stash, or the newest when it's gone.
  const stash = stashes.find((s) => s.ref === chosenRef) ?? stashes[0] ?? null;
  const ref = stash?.ref ?? null;
  // A stash's ref shifts as others are dropped; its time names it.
  const stashKey = stash ? `${stash.ref}|${stash.time}` : "";
  const files = loaded?.key === stashKey ? loaded.files : [];
  const file = files.find((f) => f.path === chosenPath) ?? files[0] ?? null;
  const diffKey = file ? `${stashKey}|${file.path}|${full}` : "";
  const diff = diffResult?.key === diffKey ? diffResult.diff : null;

  useEffect(() => {
    if (!stash) return;
    let live = true;
    Gitdeck.StashFiles(dir, stash)
      .then((f) => live && setLoaded({ key: stashKey, files: f ?? [] }))
      .catch((e) => toast.error(errorMessage(e)));
    return () => {
      live = false;
    };
  }, [dir, stashKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!stash || !file) return;
    let live = true;
    Gitdeck.StashDiff(dir, stash, file, full)
      .then((d) => live && d && setDiffResult({ key: diffKey, diff: d }))
      .catch((e) => toast.error(errorMessage(e)));
    return () => {
      live = false;
    };
  }, [dir, diffKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (fn: () => Promise<void>, done: string) => {
    setBusy(true);
    try {
      await fn();
      toast.success(done);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
      onDone();
    }
  };

  const drop = async (s: Stash) => {
    const ok = await confirm({
      title: `Drop ${s.message || s.ref}?`,
      description: "The stashed changes are deleted.",
      action: "Drop",
      destructive: true,
    });
    if (ok) act(() => Gitdeck.StashDrop(dir, s.ref), "Stash dropped");
  };

  // "New branch from stash" asks for the name inline.
  const [branchName, setBranchName] = useState<string | null>(null);
  const branchFrom = (s: Stash) => {
    const name = branchName?.trim();
    if (!name) return;
    setBranchName(null);
    act(() => Gitdeck.StashBranch(dir, name, s.ref), `Created ${name}`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(760px,88vh)] flex-col gap-0 p-0 sm:max-w-[min(1200px,92vw)]">
        <DialogHeader className="border-b px-4 py-3.5">
          <DialogTitle>Saved stashes · {name}</DialogTitle>
        </DialogHeader>
        {stashes.length === 0 ? (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">No stashes. “Stash changes” saves your work here.</div>
        ) : (
          <div className="flex min-h-0 flex-1">
            <div className="w-72 shrink-0 overflow-auto border-r">
              {stashes.map((s) => (
                <button
                  key={s.ref}
                  onClick={() => setRef(s.ref)}
                  className={cn("flex w-full flex-col gap-1 border-b px-3.5 py-3 text-left", s.ref === ref ? "bg-accent" : "hover:bg-accent/50")}
                >
                  <span className="flex items-center gap-2">
                    <span className="font-mono text-xs text-muted-foreground">{s.ref}</span>
                    <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{s.message || "(no name)"}</span>
                  </span>
                  <span className="text-xs text-muted-foreground">
                    on {s.branch || "?"} · {relativeTime(s.time)}
                  </span>
                </button>
              ))}
            </div>
            {stash && (
              <div className="flex min-w-0 flex-1 flex-col">
                <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold">{stash.message || stash.ref}</div>
                    <div className="text-xs text-muted-foreground">
                      {stash.ref} · on {stash.branch} · {plural(files.length, "file")}
                    </div>
                  </div>
                  <Button size="sm" disabled={busy} onClick={() => act(() => Gitdeck.StashPop(dir, stash.ref), "Stash popped")}>
                    Pop
                  </Button>
                  <Button size="sm" variant="secondary" disabled={busy} onClick={() => act(() => Gitdeck.StashApply(dir, stash.ref), "Stash applied")}>
                    Apply (keep stash)
                  </Button>
                  {branchName === null ? (
                    <Button size="sm" variant="secondary" disabled={busy} onClick={() => setBranchName("")}>
                      <GitBranchPlus /> New branch from stash
                    </Button>
                  ) : (
                    <form
                      className="flex gap-1"
                      onSubmit={(e) => {
                        e.preventDefault();
                        branchFrom(stash);
                      }}
                    >
                      <input
                        autoFocus
                        value={branchName}
                        onChange={(e) => setBranchName(e.target.value.replace(/\s/g, "-"))}
                        onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), setBranchName(null))}
                        placeholder="branch name"
                        aria-label="New branch name"
                        className="h-7 w-40 rounded-md border bg-input/30 px-2 font-mono text-xs outline-none focus:border-ring"
                      />
                      <Button size="sm" type="submit" variant="secondary" disabled={!branchName.trim()}>
                        Create
                      </Button>
                    </form>
                  )}
                  <Button size="sm" variant="ghost" className="text-diff-del-fg" disabled={busy} onClick={() => drop(stash)}>
                    Drop…
                  </Button>
                </div>
                <div className="flex max-h-24 flex-wrap gap-0.5 overflow-auto border-b px-2.5 py-2">
                  {files.map((f) => (
                    <button
                      key={f.path}
                      onClick={() => setFile(f.path)}
                      className={cn(
                        "flex h-7 items-center gap-2 rounded-md px-2.5 font-mono text-[12.5px]",
                        file?.path === f.path ? "bg-accent" : "text-foreground/80 hover:bg-accent/50",
                      )}
                    >
                      <span className={cn("font-semibold", stateColor[f.status])}>{f.status}</span>
                      {f.path}
                      <span className="text-diff-add-fg">+{f.added}</span>
                      {f.removed > 0 && <span className="text-diff-del-fg">−{f.removed}</span>}
                    </button>
                  ))}
                </div>
                {file && <DiffView diff={diff} loading path={file.path} mode={mode} onModeChange={setMode} full={full} onFullChange={setFull} />}
              </div>
            )}
          </div>
        )}
        <DialogFooter className="mx-0 mb-0 border-t px-4 py-2.5 text-xs text-muted-foreground sm:justify-start">
          A pop that conflicts keeps the stash and marks the files as conflicted in Changes.
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
