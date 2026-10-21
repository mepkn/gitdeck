import { useMemo, useRef, useState } from "react";
import { ChevronDown, GitBranch, Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useConfirm } from "@/lib/confirm";
import { Gitdeck, errorMessage, type Branch, type Status } from "@/lib/api";
import { cn } from "@/lib/utils";

type Props = { dir: string; status: Status; hasChanges: boolean; onChanged: () => void };

export function BranchMenu({ dir, status, hasChanges, onChanged }: Props) {
  const confirm = useConfirm();
  const [open, setOpen] = useState(false);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [query, setQuery] = useState("");
  const input = useRef<HTMLInputElement>(null);

  const openMenu = (o: boolean) => {
    setOpen(o);
    if (!o) return;
    setQuery("");
    Gitdeck.Branches(dir)
      .then((b) => setBranches(b ?? []))
      .catch((e) => toast.error(errorMessage(e)));
  };

  const q = query.trim().toLowerCase();
  const local = useMemo(() => branches.filter((b) => !b.remote && b.name.toLowerCase().includes(q)), [branches, q]);
  const localNames = new Set(branches.filter((b) => !b.remote).map((b) => b.name));
  // Remote branches that have no local branch yet.
  const remote = useMemo(
    () => branches.filter((b) => b.remote && !localNames.has(b.name.slice(b.name.indexOf("/") + 1)) && b.name.toLowerCase().includes(q)),
    [branches, q], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const exact = branches.some((b) => b.name === query.trim());
  const current = status.branch || `${status.head.slice(0, 7)} (detached)`;

  const run = async (fn: () => Promise<void>, done?: string) => {
    try {
      await fn();
      if (done) toast.success(done);
      setOpen(false);
    } catch (e) {
      toast.error(errorMessage(e));
    }
    onChanged();
  };

  // With uncommitted changes, offer to stash them before switching.
  const prepare = async (target: string): Promise<boolean> => {
    if (!hasChanges) return true;
    const answer = await confirm({
      title: "You have uncommitted changes",
      description: `Stash them before switching to ${target}, or bring them along (git refuses if they clash).`,
      action: "Stash and switch",
      alt: "Bring them along",
    });
    if (!answer) return false;
    if (answer === true) {
      try {
        await Gitdeck.StashPush(dir, `before switching to ${target}`, [], true, false);
      } catch (e) {
        toast.error(errorMessage(e));
        return false;
      }
    }
    return true;
  };

  const switchTo = async (b: Branch) => {
    if (b.current) return;
    setOpen(false);
    if (await prepare(b.name)) run(() => Gitdeck.Switch(dir, b.name, b.remote), `Switched to ${b.remote ? b.name.slice(b.name.indexOf("/") + 1) : b.name}`);
  };

  const create = async () => {
    const name = query.trim();
    if (!name || exact) return;
    run(() => Gitdeck.CreateBranch(dir, name), `Created ${name}`);
  };

  const remove = async (b: Branch) => {
    setOpen(false);
    const ok = await confirm({
      title: `Delete branch ${b.name}?`,
      description: "Only the local branch is deleted; the remote one stays.",
      action: "Delete",
      destructive: true,
    });
    if (!ok) return;
    try {
      await Gitdeck.DeleteBranch(dir, b.name, false);
      toast.success(`Deleted ${b.name}`);
    } catch (e) {
      const msg = errorMessage(e);
      if (!msg.includes("not fully merged")) {
        toast.error(msg);
      } else if (
        await confirm({
          title: `${b.name} isn't merged`,
          description: "Its commits that aren't on another branch will be lost.",
          action: "Delete anyway",
          destructive: true,
        })
      ) {
        await run(() => Gitdeck.DeleteBranch(dir, b.name, true), `Deleted ${b.name}`);
      }
    }
    onChanged();
  };

  return (
    <Popover open={open} onOpenChange={openMenu}>
      <PopoverTrigger render={<Button variant="secondary" size="sm" className="no-drag max-w-72 font-mono" />}>
        <GitBranch /> <span className="truncate">{current}</span> <ChevronDown className="opacity-60" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[420px] gap-0 p-0" initialFocus={input}>
        <div className="flex flex-col gap-2.5 border-b p-3">
          <label className="flex h-9 items-center gap-2 rounded-lg border bg-background px-2.5 text-muted-foreground">
            <Search className="size-3.5" />
            <input
              ref={input}
              value={query}
              onChange={(e) => setQuery(e.target.value.replace(/\s/g, "-"))}
              onKeyDown={(e) => {
                if (e.key !== "Enter" || !q) return;
                // A name that matches a branch switches to it; a new one creates it.
                if (!exact) create();
                else {
                  const hit = branches.find((b) => b.name === query.trim());
                  if (hit) switchTo(hit);
                }
              }}
              placeholder="Find or create a branch"
              aria-label="Find or create a branch"
              className="w-full bg-transparent text-[13px] text-foreground outline-none"
            />
          </label>
          <button
            onClick={create}
            disabled={!q || exact}
            className="h-9 rounded-lg border border-dashed border-primary/40 bg-primary/5 text-[13px] font-medium text-primary disabled:opacity-50"
          >
            <Plus className="mr-1 inline size-3.5" />
            {q && !exact ? `Create ${query.trim()} from ${current}` : `New branch from ${current}`}
          </button>
        </div>
        <div className="max-h-96 overflow-auto p-2">
          <Section title="Local" />
          {local.map((b) => (
            <div
              key={b.name}
              className={cn("group flex h-[34px] items-center gap-2.5 rounded-md px-2.5 font-mono text-[13px]", b.current ? "bg-accent text-foreground" : "hover:bg-accent/50")}
            >
              <button className="flex min-w-0 flex-1 items-center gap-2.5 text-left" onClick={() => switchTo(b)}>
                <span className="w-3 text-primary">{b.current ? "●" : ""}</span>
                <span className="truncate">{b.name}</span>
              </button>
              <span className="font-sans text-xs text-muted-foreground">{sync(b)}</span>
              {!b.current && (
                <button
                  aria-label={`Delete branch ${b.name}`}
                  onClick={() => remove(b)}
                  className="rounded p-1 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-diff-del-fg"
                >
                  <Trash2 className="size-3.5" />
                </button>
              )}
            </div>
          ))}
          {remote.length > 0 && <Section title="Remote" />}
          {remote.map((b) => (
            <button
              key={b.name}
              onClick={() => switchTo(b)}
              className="flex h-[34px] w-full items-center gap-2.5 rounded-md px-2.5 text-left font-mono text-[13px] text-foreground/75 hover:bg-accent/50"
            >
              <span className="w-3" />
              <span className="truncate">{b.name}</span>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function Section({ title }: { title: string }) {
  return <div className="px-2.5 pt-1.5 pb-1 text-[11px] tracking-wider text-muted-foreground uppercase">{title}</div>;
}

function sync(b: Branch): string {
  if (b.gone) return "remote gone";
  if (!b.upstream) return "local only";
  return [b.ahead ? `↑${b.ahead}` : "", b.behind ? `↓${b.behind}` : ""].filter(Boolean).join(" ");
}
