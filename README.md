# Gitdeck

macOS git client for your projects, with VS Code-style split and inline diffs; a companion to agentdeck.

## Features

- Projects are git repositories you add; the list shows each one's branch and changes. agentdeck opens a project here with a `gitdeck://open?path=...` link.
- **Changes**: staged and unstaged files, staged a whole file at a time; diff of the selected file, split or inline, with syntax colours and the changed part of each line marked; "Whole file" shows the file around the changes.
- Commit (⌘↵); "Write with Claude" (or agy) fills the message box from the staged diff, and never commits by itself.
- Fetch (⌘⇧T), Pull (⌘⇧P), Push (⌘P); the first push publishes the branch to origin.
- **History**: commits with a branch graph and ref badges, filter by message, author or SHA; each commit's files and diffs; check out, copy SHA, revert.
- **Branches**: switch, create, delete (asks first, and again if unmerged); switching with changes offers to stash them first. Remote branches check out as tracking branches.
- **Stashes**: stash all or some files (untracked included, staged kept if asked); saved stashes with their files and diffs; pop, apply, new branch from a stash, drop (asks first).
- Discard asks first; new files go to the Trash.
- Live: the open repo is polled every second, so an agent's edits show up as it saves them.
- Single user, local only: no account or sign-in.

## Stack

Go · Wails v3 · React 19 · TypeScript · Vite · Tailwind CSS v4 · shadcn/ui (Base UI) · Shiki · Vitest

## Development

Needs macOS, git, Go 1.25+, Node 22.18+ (`.nvmrc`) and the Wails v3 CLI, pinned to the beta this repo uses. The commit message button needs `claude` or `agy` on the login shell's `PATH`.

```bash
go install github.com/wailsapp/wails/v3/cmd/wails3@v3.0.0-beta.30
npm --prefix frontend install
wails3 dev          # app with hot reload
```

## Scripts

| Command | What it does |
|---|---|
| `wails3 dev` | Run the app with frontend hot reload |
| `wails3 task package` | Build `bin/gitdeck.app` (ad-hoc signed) |
| `scripts/install.sh` | Build and install to `/Applications/Gitdeck.app`, then relaunch |
| `scripts/check.sh` | Generate bindings, Go vet + tests, frontend typecheck + lint + tests |
| `npm --prefix frontend run check` | Frontend checks only |
| `npm --prefix frontend run icons` | Render `build/appicon.png` from `frontend/public/favicon.svg`; then `wails3 task common:generate:icons` |

## Deployment

No server. `scripts/install.sh` installs the app locally. The Release workflow (Actions → Release → Run workflow, or `gh workflow run release.yml`) builds an unsigned universal app and attaches `gitdeck-macos.zip` to a GitHub Release: https://github.com/mepkn/gitdeck/releases/latest/download/gitdeck-macos.zip. First launch: right-click → Open.

## How it works

- **git**: every action runs the system `git` in the repo (`internal/git`), so your config, SSH keys and credential helpers work as in a terminal. `GIT_TERMINAL_PROMPT=0` keeps it from waiting on a hidden password prompt. The app loads the login shell's `PATH` at start, as Finder gives apps a bare one.
- **Diffs**: git's unified diff is parsed in Go; `frontend/src/lib/diff.ts` pairs removed and added lines for the split view and finds the changed span; `lib/highlight.ts` colours both sides with Shiki's Dark+ theme, loading a grammar on first use.
- **Graph**: `lib/graph.ts` assigns lanes from `git log --topo-order` parents.
- **Live updates**: every second the service hashes `git status` plus the mtimes of `HEAD`, `refs/stash`, `packed-refs`, `logs/HEAD` and `FETCH_HEAD`, and sends `repo:changed` when it differs.
- **Commit messages**: `claude -p` or `agy -p` with the staged diff (cut at 60 KB) and the last 10 subjects, run in the repo; the answer only fills the box.
- **Links**: `gitdeck://open?path=/abs/folder` (registered in `build/darwin/Info.plist`) adds and opens that repo.
- **State** in `~/Library/Application Support/gitdeck/state.json`: projects, the open one, diff mode, whole file, agent. Commit message drafts are kept per project in the webview's storage.
- **Code map**: `main.go` (window, URL handling), `service.go` (methods the frontend calls, polling), `internal/git`, `internal/store`, `internal/shellenv`, `frontend/src` (UI; `frontend/bindings` is generated).
