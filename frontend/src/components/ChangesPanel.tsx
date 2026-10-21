import { useEffect, useState } from "react";
import { Archive, ChevronDown, Loader2, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Gitdeck, errorMessage, type File, type Status } from "@/lib/api";
import { plural, splitPath } from "@/lib/format";
import { stateColor, stateLabel } from "@/lib/status";
import { cn } from "@/lib/utils";
import type { Selected } from "@/components/Workspace";

type Agent = "claude" | "agy";

type Props = {
  dir: string;
  status: Status;
  selected: Selected | null;
  onSelect: (s: Selected) => void;
  onDiscard: (f: File) => void;
  onChanged: () => void;
  stashCount: number;
  onStash: () => void;
  onStashes: () => void;
  agent: Agent;
  onAgent: (a: Agent) => void;
};

const agentName: Record<Agent, string> = { claude: "Claude", agy: "agy" };

// Commit messages survive switching projects and reloads.
const draftKey = (dir: string) => `gitdeck:draft:${dir}`;
function loadDraft(dir: string): string {
  try {
    return localStorage.getItem(draftKey(dir)) ?? "";
  } catch {
    return "";
  }
}
function saveDraft(dir: string, text: string) {
  try {
    if (text) localStorage.setItem(draftKey(dir), text);
    else localStorage.removeItem(draftKey(dir));
  } catch {
    // Storage blocked: the draft just isn't kept.
  }
}

export function ChangesPanel(p: Props) {
  const { dir, status } = p;
  const files = status.files ?? [];
  const staged = files.filter((f) => f.index);
  const unstaged = files.filter((f) => f.work);
  const [message, setMessage] = useState(() => loadDraft(dir));
  const [committing, setCommitting] = useState(false);
  const [writing, setWriting] = useState(false);

  useEffect(() => saveDraft(dir, message), [dir, message]);

  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e) {
      toast.error(errorMessage(e));
    }
    p.onChanged();
  };

  const commit = async () => {
    if (!staged.length || !message.trim() || committing) return;
    setCommitting(true);
    try {
      await Gitdeck.Commit(dir, message);
      setMessage("");
      toast.success("Committed");
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setCommitting(false);
      p.onChanged();
    }
  };

  const write = async () => {
    if (writing) return;
    setWriting(true);
    try {
      setMessage(await Gitdeck.WriteMessage(dir));
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setWriting(false);
    }
  };

  const branch = status.branch || "detached HEAD";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-auto pb-2">
        <ListHeader
          title={`Staged · ${staged.length}`}
          action={staged.length > 0 && <Button variant="ghost" size="xs" onClick={() => run(() => Gitdeck.Unstage(dir, staged.map((f) => f.path)))}>Unstage all</Button>}
        />
        {staged.map((f) => (
          <FileRow
            key={"s" + f.path}
            file={f}
            state={f.index}
            checked
            selected={p.selected?.path === f.path && p.selected.staged}
            onSelect={() => p.onSelect({ path: f.path, staged: true })}
            onToggle={() => run(() => Gitdeck.Unstage(dir, [f.path]))}
          />
        ))}
        {staged.length === 0 && <Hint>Tick a file below to stage it.</Hint>}

        <ListHeader
          title={`Changes · ${unstaged.length}`}
          action={unstaged.length > 0 && <Button variant="ghost" size="xs" onClick={() => run(() => Gitdeck.Stage(dir, unstaged.map((f) => f.path)))}>Stage all</Button>}
        />
        {unstaged.map((f) => (
          <FileRow
            key={"u" + f.path}
            file={f}
            state={f.work}
            checked={false}
            selected={p.selected?.path === f.path && !p.selected.staged}
            onSelect={() => p.onSelect({ path: f.path, staged: false })}
            onToggle={() => run(() => Gitdeck.Stage(dir, [f.path]))}
            onDiscard={() => p.onDiscard(f)}
          />
        ))}
        {unstaged.length === 0 && <Hint>No unstaged changes.</Hint>}
      </div>

      <div className="flex gap-1.5 border-t px-3 py-2">
        <Button variant="ghost" size="sm" onClick={p.onStash} disabled={files.length === 0}>
          <Archive /> Stash changes
        </Button>
        <Button variant="ghost" size="sm" onClick={p.onStashes}>
          Saved stashes <span className="text-muted-foreground">({p.stashCount})</span>
        </Button>
      </div>

      <div className="flex flex-col gap-2 border-t p-3">
        <label htmlFor="commit-message" className="text-[11px] tracking-wider text-muted-foreground uppercase">
          Commit message
        </label>
        <textarea
          id="commit-message"
          rows={4}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && e.metaKey) {
              e.preventDefault();
              commit();
            }
          }}
          placeholder="feat: what changed"
          className="resize-none rounded-lg border bg-input/30 px-2.5 py-2 text-[13px] leading-snug outline-none focus:border-ring"
        />
        <div className="flex gap-1.5">
          <Button variant="secondary" size="sm" className="flex-1" onClick={write} disabled={writing || staged.length === 0}>
            {writing ? <Loader2 className="animate-spin" /> : <Sparkles className="text-[oklch(0.75_0.1_50)]" />}
            {writing ? `${agentName[p.agent]} is writing…` : `Write with ${agentName[p.agent]}`}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="secondary" size="icon-sm" aria-label="Choose the agent that writes messages" />}>
              <ChevronDown />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuRadioGroup value={p.agent} onValueChange={(v) => p.onAgent(v as Agent)}>
                <DropdownMenuRadioItem value="claude">Claude (claude -p)</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="agy">agy (agy -p)</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <Button onClick={commit} disabled={!staged.length || !message.trim() || committing} className="h-9 font-semibold">
          {committing && <Loader2 className="animate-spin" />}
          {staged.length ? `Commit ${plural(staged.length, "file")} to ${branch}` : "Nothing staged"}
          <span className="font-normal opacity-60">⌘↵</span>
        </Button>
      </div>
    </div>
  );
}

function ListHeader({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div className="flex h-8 items-center px-3.5 pt-2 text-[11px] tracking-wider text-muted-foreground uppercase">
      <span className="flex-1">{title}</span>
      {action}
    </div>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return <div className="px-3.5 py-1 text-xs text-muted-foreground/70">{children}</div>;
}

function FileRow({
  file,
  state,
  checked,
  selected,
  onSelect,
  onToggle,
  onDiscard,
}: {
  file: File;
  state: string;
  checked: boolean;
  selected: boolean;
  onSelect: () => void;
  onToggle: () => void;
  onDiscard?: () => void;
}) {
  const { dir, name } = splitPath(file.path);
  const letter = file.conflict ? "U" : state;
  return (
    <div
      className={cn(
        "group mx-1.5 flex h-[30px] items-center gap-2 rounded-md pr-1.5 pl-2.5 text-[13px]",
        selected ? "bg-sidebar-accent text-foreground" : "text-foreground/85 hover:bg-sidebar-accent/50",
      )}
      onClick={onSelect}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        onClick={(e) => e.stopPropagation()}
        aria-label={`${checked ? "Unstage" : "Stage"} ${file.path}`}
        className="accent-primary"
      />
      <span className={cn("w-3.5 text-center font-mono text-[11px] font-semibold", stateColor[letter])} title={stateLabel[letter]}>
        {letter === "?" ? "U" : letter === "U" ? "!" : letter}
      </span>
      <button className="min-w-0 flex-1 truncate text-left" title={file.origPath ? `${file.origPath} → ${file.path}` : file.path}>
        {name} <span className="text-muted-foreground">{dir}</span>
      </button>
      {onDiscard && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDiscard();
          }}
          aria-label={`Discard changes to ${file.path}`}
          className="rounded p-0.5 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-diff-del-fg"
        >
          <Trash2 className="size-3.5" />
        </button>
      )}
    </div>
  );
}
