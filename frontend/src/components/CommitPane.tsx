import { useEffect, useState } from "react";
import { Copy, GitCommitHorizontal, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/lib/confirm";
import { DiffView, type DiffMode } from "@/components/DiffView";
import { Gitdeck, errorMessage, type ChangedFile, type Commit, type Diff } from "@/lib/api";
import { plural, relativeTime } from "@/lib/format";
import { stateColor } from "@/lib/status";
import { cn } from "@/lib/utils";

type Props = {
  dir: string;
  commit: Commit;
  mode: DiffMode;
  onModeChange: (m: DiffMode) => void;
  full: boolean;
  onFullChange: (f: boolean) => void;
  onChanged: () => void;
};

export function CommitPane({ dir, commit, mode, onModeChange, full, onFullChange, onChanged }: Props) {
  const confirm = useConfirm();
  const [files, setFiles] = useState<ChangedFile[]>([]);
  const [path, setPath] = useState<string | null>(null);
  const [diff, setDiff] = useState<Diff | null>(null);

  useEffect(() => {
    let live = true;
    Gitdeck.CommitFiles(dir, commit.sha)
      .then((f) => {
        if (!live) return;
        setFiles(f ?? []);
        setPath(f?.[0]?.path ?? null);
      })
      .catch((e) => toast.error(errorMessage(e)));
    return () => {
      live = false;
    };
  }, [dir, commit.sha]);

  useEffect(() => {
    if (!path) return;
    let live = true;
    Gitdeck.CommitDiff(dir, commit.sha, path, full)
      .then((d) => live && setDiff(d))
      .catch((e) => toast.error(errorMessage(e)));
    return () => {
      live = false;
    };
  }, [dir, commit.sha, path, full]);

  const short = commit.sha.slice(0, 7);
  const added = files.reduce((n, f) => n + f.added, 0);
  const removed = files.reduce((n, f) => n + f.removed, 0);

  const act = async (fn: () => Promise<void>, done: string) => {
    try {
      await fn();
      toast.success(done);
    } catch (e) {
      toast.error(errorMessage(e));
    }
    onChanged();
  };

  const checkout = async () => {
    const ok = await confirm({
      title: `Check out ${short}?`,
      description: "HEAD is detached at this commit. Switch to a branch to keep working on it.",
      action: "Check out",
    });
    if (ok) act(() => Gitdeck.CheckoutCommit(dir, commit.sha), `Checked out ${short}`);
  };

  const revert = async () => {
    const ok = await confirm({
      title: `Revert ${short}?`,
      description: "Makes a new commit that undoes this one.",
      action: "Revert",
    });
    if (ok) act(() => Gitdeck.Revert(dir, commit.sha), `Reverted ${short}`);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="drag flex flex-col gap-1.5 border-b px-4.5 py-4">
        <div className="selectable no-drag text-[15px] font-semibold">{commit.subject}</div>
        {commit.body && <div className="selectable no-drag max-h-24 overflow-auto text-[13px] whitespace-pre-wrap text-muted-foreground">{commit.body}</div>}
        <div className="flex flex-wrap gap-3 text-[12.5px] text-muted-foreground">
          <span className="selectable no-drag font-mono text-foreground/80">{short}</span>
          <span title={commit.email}>{commit.author}</span>
          <span title={new Date(commit.time * 1000).toLocaleString()}>{relativeTime(commit.time)}</span>
          <span>
            {plural(files.length, "file")} · <span className="text-diff-add-fg">+{added}</span> <span className="text-diff-del-fg">−{removed}</span>
          </span>
        </div>
        <div className="no-drag mt-1 flex gap-1.5">
          <Button variant="secondary" size="xs" onClick={checkout}>
            <GitCommitHorizontal /> Checkout
          </Button>
          <Button
            variant="secondary"
            size="xs"
            onClick={() => navigator.clipboard.writeText(commit.sha).then(() => toast.success("Copied SHA"))}
          >
            <Copy /> Copy SHA
          </Button>
          <Button variant="ghost" size="xs" onClick={revert}>
            <Undo2 /> Revert
          </Button>
        </div>
      </div>
      <div className="flex max-h-28 flex-wrap gap-0.5 overflow-auto border-b px-2.5 py-2">
        {files.map((f) => (
          <button
            key={f.path}
            onClick={() => setPath(f.path)}
            title={f.origPath ? `${f.origPath} → ${f.path}` : f.path}
            className={cn(
              "flex h-7 items-center gap-2 rounded-md px-2.5 font-mono text-[12.5px]",
              path === f.path ? "bg-accent text-foreground" : "text-foreground/80 hover:bg-accent/50",
            )}
          >
            <span className={cn("font-semibold", stateColor[f.status])}>{f.status}</span>
            {f.path}
          </button>
        ))}
      </div>
      {path ? (
        <DiffView diff={diff?.path === path ? diff : null} loading path={path} mode={mode} onModeChange={onModeChange} full={full} onFullChange={onFullChange} />
      ) : (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">This commit changes no files.</div>
      )}
    </div>
  );
}
