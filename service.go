package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"

	"gitdeck/internal/git"
	"gitdeck/internal/store"
)

// Gitdeck is the service the frontend calls. Every repo method takes the
// project folder, so a slow call can't land on a project opened since.
type Gitdeck struct {
	store *store.Store
	home  string

	mu      sync.Mutex
	watched string // the project polled for changes
	onOpen  func() // shows the window when a link opens a project
}

// RepoChanged tells the UI that the watched repo changed on disk.
type RepoChanged struct {
	Dir string `json:"dir"`
}

func init() {
	application.RegisterEvent[RepoChanged]("repo:changed")
	application.RegisterEvent[string]("project:opened")
}

func NewGitdeck() (*Gitdeck, error) {
	st, err := store.Open()
	if err != nil {
		return nil, err
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return nil, err
	}
	return &Gitdeck{store: st, home: home}, nil
}

func (g *Gitdeck) ServiceStartup(ctx context.Context, _ application.ServiceOptions) error {
	go g.poll(ctx)
	return nil
}

// --- projects and settings ---

func (g *Gitdeck) State() store.State {
	return g.store.Get()
}

func (g *Gitdeck) SetDiffMode(mode string) error {
	_, err := g.store.Update(func(s *store.State) { s.DiffMode = mode })
	return err
}

func (g *Gitdeck) SetFullFile(full bool) error {
	_, err := g.store.Update(func(s *store.State) { s.FullFile = full })
	return err
}

func (g *Gitdeck) SetAgent(agent string) error {
	_, err := g.store.Update(func(s *store.State) { s.Agent = agent })
	return err
}

// PickFolder asks for a repository folder; "" when cancelled.
func (g *Gitdeck) PickFolder() (string, error) {
	return application.Get().Dialog.OpenFile().
		SetTitle("Choose a git repository").
		CanChooseDirectories(true).
		CanChooseFiles(false).
		CanCreateDirectories(false).
		SetDirectory(filepath.Join(g.home, "Desktop")).
		PromptForSingleSelection()
}

// OpenProject adds the repository containing dir (if new) and opens it.
func (g *Gitdeck) OpenProject(dir string) (store.State, error) {
	repo, err := git.Open(dir)
	if err != nil {
		return store.State{}, err
	}
	now := time.Now().Unix()
	return g.store.Update(func(s *store.State) {
		s.Active = repo.Dir
		for i := range s.Projects {
			if s.Projects[i].Path == repo.Dir {
				s.Projects[i].Opened = now
				return
			}
		}
		s.Projects = append(s.Projects, store.Project{Path: repo.Dir, Name: filepath.Base(repo.Dir), Opened: now})
	})
}

// CloseProject goes back to the project list.
func (g *Gitdeck) CloseProject() (store.State, error) {
	return g.store.Update(func(s *store.State) { s.Active = "" })
}

// RemoveProject forgets a project; its folder is left alone.
func (g *Gitdeck) RemoveProject(path string) (store.State, error) {
	return g.store.Update(func(s *store.State) {
		out := s.Projects[:0]
		for _, p := range s.Projects {
			if p.Path != path {
				out = append(out, p)
			}
		}
		s.Projects = out
		if s.Active == path {
			s.Active = ""
		}
	})
}

// ProjectInfo is a project's state for the project list.
type ProjectInfo struct {
	Path    string `json:"path"`
	Branch  string `json:"branch"`
	Changed int    `json:"changed"`
	Ahead   int    `json:"ahead"`
	Behind  int    `json:"behind"`
	Error   string `json:"error"`
}

// Overview reads every project's branch and changes, in parallel.
func (g *Gitdeck) Overview() []ProjectInfo {
	projects := g.store.Get().Projects
	out := make([]ProjectInfo, len(projects))
	var wg sync.WaitGroup
	for i, p := range projects {
		wg.Add(1)
		go func() {
			defer wg.Done()
			info := ProjectInfo{Path: p.Path}
			st, err := (&git.Repo{Dir: p.Path}).Status()
			if err != nil {
				info.Error = "Folder missing or not a git repository"
			} else {
				info.Branch, info.Changed, info.Ahead, info.Behind = st.Branch, len(st.Files), st.Ahead, st.Behind
				if info.Branch == "" {
					info.Branch = "detached"
				}
			}
			out[i] = info
		}()
	}
	wg.Wait()
	return out
}

// HandleURL opens gitdeck://open?path=/abs/folder links (from agentdeck).
func (g *Gitdeck) HandleURL(raw string) {
	path, ok := parseOpenURL(raw)
	if !ok {
		return
	}
	if _, err := g.OpenProject(path); err != nil {
		return
	}
	application.Get().Event.Emit("project:opened", path)
	if g.onOpen != nil {
		g.onOpen()
	}
}

// --- working tree ---

func repo(dir string) *git.Repo {
	return &git.Repo{Dir: dir}
}

func (g *Gitdeck) Status(dir string) (*git.Status, error) {
	return repo(dir).Status()
}

func context3(full bool) int {
	if full {
		return git.FullContext
	}
	return 3
}

func (g *Gitdeck) Diff(dir string, f git.File, staged, full bool) (*git.Diff, error) {
	return repo(dir).WorkDiff(f, staged, context3(full))
}

func (g *Gitdeck) Stage(dir string, paths []string) error {
	return repo(dir).Stage(paths)
}

func (g *Gitdeck) Unstage(dir string, paths []string) error {
	return repo(dir).Unstage(paths)
}

// Discard throws away a file's changes. Files git doesn't track (untracked,
// or only added to the index) go to the Trash, so a mistake can be undone.
func (g *Gitdeck) Discard(dir string, f git.File) error {
	r := repo(dir)
	if f.Work != "?" {
		if err := r.Discard(f); err != nil {
			return err
		}
	}
	if f.Work == "?" || f.Index == "A" {
		full := filepath.Join(dir, f.Path)
		if !strings.HasPrefix(full, filepath.Clean(dir)+string(os.PathSeparator)) {
			return errors.New("path is outside the repository")
		}
		if _, err := os.Lstat(full); err == nil {
			return trash(full)
		}
	}
	return nil
}

func (g *Gitdeck) Commit(dir, message string) error {
	if strings.TrimSpace(message) == "" {
		return errors.New("write a commit message first")
	}
	return repo(dir).Commit(message)
}

func (g *Gitdeck) Fetch(dir string) error {
	return repo(dir).Fetch()
}

func (g *Gitdeck) Pull(dir string) error {
	return repo(dir).Pull()
}

func (g *Gitdeck) Push(dir string) error {
	r := repo(dir)
	st, err := r.Status()
	if err != nil {
		return err
	}
	if st.Branch == "" {
		return errors.New("HEAD is detached; switch to a branch to push")
	}
	return r.Push(st.Upstream != "")
}

// --- history ---

func (g *Gitdeck) Log(dir string, skip, limit int) ([]git.Commit, error) {
	return repo(dir).Log(skip, limit)
}

func (g *Gitdeck) CommitFiles(dir, sha string) ([]git.ChangedFile, error) {
	return repo(dir).CommitFiles(sha)
}

func (g *Gitdeck) CommitDiff(dir, sha, path string, full bool) (*git.Diff, error) {
	r := repo(dir)
	return r.RangeDiff(r.FirstParent(sha), sha, path, context3(full))
}

func (g *Gitdeck) Revert(dir, sha string) error {
	return repo(dir).Revert(sha)
}

func (g *Gitdeck) CheckoutCommit(dir, sha string) error {
	return repo(dir).CheckoutCommit(sha)
}

// --- branches ---

func (g *Gitdeck) Branches(dir string) ([]git.Branch, error) {
	return repo(dir).Branches()
}

func (g *Gitdeck) Switch(dir, name string, remote bool) error {
	return repo(dir).Switch(name, remote)
}

func (g *Gitdeck) CreateBranch(dir, name string) error {
	return repo(dir).CreateBranch(strings.TrimSpace(name))
}

func (g *Gitdeck) DeleteBranch(dir, name string, force bool) error {
	return repo(dir).DeleteBranch(name, force)
}

// --- stashes ---

func (g *Gitdeck) Stashes(dir string) ([]git.Stash, error) {
	return repo(dir).Stashes()
}

func (g *Gitdeck) StashPush(dir, message string, paths []string, untracked, keepIndex bool) error {
	return repo(dir).StashPush(strings.TrimSpace(message), paths, untracked, keepIndex)
}

func (g *Gitdeck) StashFiles(dir string, s git.Stash) ([]git.ChangedFile, error) {
	return repo(dir).StashFiles(s)
}

func (g *Gitdeck) StashDiff(dir string, s git.Stash, f git.ChangedFile, full bool) (*git.Diff, error) {
	return repo(dir).StashDiff(s, f, context3(full))
}

func (g *Gitdeck) StashPop(dir, ref string) error {
	return repo(dir).StashPop(ref)
}

func (g *Gitdeck) StashApply(dir, ref string) error {
	return repo(dir).StashApply(ref)
}

func (g *Gitdeck) StashDrop(dir, ref string) error {
	return repo(dir).StashDrop(ref)
}

func (g *Gitdeck) StashBranch(dir, name, ref string) error {
	return repo(dir).StashBranch(strings.TrimSpace(name), ref)
}

// --- commit message from an agent ---

// maxPromptDiff keeps the prompt small enough for a quick answer.
const maxPromptDiff = 60_000

// WriteMessage asks the chosen agent CLI for a commit message for the staged
// changes. It only returns text; the user edits it and commits.
func (g *Gitdeck) WriteMessage(dir string) (string, error) {
	r := repo(dir)
	stat, diff, err := r.StagedDiff()
	if err != nil {
		return "", err
	}
	if strings.TrimSpace(diff) == "" {
		return "", errors.New("stage some files first")
	}
	if len(diff) > maxPromptDiff {
		diff = diff[:maxPromptDiff] + "\n[diff truncated]"
	}
	prompt := buildPrompt(stat, diff, r.RecentSubjects(10))

	agent := g.store.Get().Agent
	bin := agent
	if _, err := exec.LookPath(bin); err != nil {
		return "", fmt.Errorf("%s is not on your PATH", bin)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()
	cmd := exec.CommandContext(ctx, bin, "-p", prompt)
	cmd.Dir = dir
	var stdout, stderr bytes.Buffer
	cmd.Stdout, cmd.Stderr = &stdout, &stderr
	if err := cmd.Run(); err != nil {
		if ctx.Err() != nil {
			return "", fmt.Errorf("%s took too long", agent)
		}
		msg := strings.TrimSpace(stderr.String())
		if msg == "" {
			msg = err.Error()
		}
		return "", fmt.Errorf("%s failed: %s", agent, msg)
	}
	return cleanMessage(stdout.String()), nil
}

func buildPrompt(stat, diff string, recent []string) string {
	var b strings.Builder
	b.WriteString("Write a git commit message for the staged changes below.\n")
	b.WriteString("Rules: a subject line under 72 characters, in the same style as the recent commits ")
	b.WriteString("(they use prefixes like feat:, fix:, chore:, refactor:, style:); then, only if it helps, ")
	b.WriteString("a blank line and a short body saying why. Reply with the message only: no quotes, ")
	b.WriteString("no code fences, no explanation. Do not run any tools.\n\n")
	if len(recent) > 0 {
		b.WriteString("Recent commits:\n")
		for _, s := range recent {
			b.WriteString("- " + s + "\n")
		}
		b.WriteString("\n")
	}
	b.WriteString("Files:\n" + stat + "\nDiff:\n" + diff)
	return b.String()
}

// cleanMessage strips code fences an agent may wrap the message in.
func cleanMessage(s string) string {
	s = strings.TrimSpace(s)
	if strings.HasPrefix(s, "```") {
		lines := strings.Split(s, "\n")
		lines = lines[1:]
		if n := len(lines); n > 0 && strings.HasPrefix(strings.TrimSpace(lines[n-1]), "```") {
			lines = lines[:n-1]
		}
		s = strings.TrimSpace(strings.Join(lines, "\n"))
	}
	return s
}

// --- watching ---

// Watch picks the project polled for changes ("" stops).
func (g *Gitdeck) Watch(dir string) {
	g.mu.Lock()
	g.watched = dir
	g.mu.Unlock()
}

// poll checks the watched repo every second and tells the UI when its
// status, HEAD, refs or stashes change, e.g. while an agent edits files.
func (g *Gitdeck) poll(ctx context.Context) {
	var lastDir string
	var last [32]byte
	tick := time.NewTicker(time.Second)
	defer tick.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
		}
		g.mu.Lock()
		dir := g.watched
		g.mu.Unlock()
		if dir == "" {
			lastDir = ""
			continue
		}
		sum, err := fingerprint(dir)
		if err != nil {
			continue
		}
		if dir == lastDir && sum != last {
			application.Get().Event.Emit("repo:changed", RepoChanged{Dir: dir})
		}
		lastDir, last = dir, sum
	}
}

func fingerprint(dir string) ([32]byte, error) {
	r := repo(dir)
	st, err := r.StatusRaw()
	if err != nil {
		return [32]byte{}, err
	}
	h := sha256.New()
	h.Write(st)
	// Branch tips and stashes don't all show in status.
	if gitDir, err := gitPath(dir); err == nil {
		for _, name := range []string{"HEAD", "refs/stash", "packed-refs", "logs/HEAD", "FETCH_HEAD"} {
			if info, err := os.Stat(filepath.Join(gitDir, name)); err == nil {
				fmt.Fprint(h, name, info.ModTime().UnixNano(), info.Size())
			}
		}
	}
	var sum [32]byte
	copy(sum[:], h.Sum(nil))
	return sum, nil
}

// gitPath finds the .git folder, also for worktrees where .git is a file.
func gitPath(dir string) (string, error) {
	p := filepath.Join(dir, ".git")
	info, err := os.Stat(p)
	if err != nil {
		return "", err
	}
	if info.IsDir() {
		return p, nil
	}
	b, err := os.ReadFile(p)
	if err != nil {
		return "", err
	}
	line := strings.TrimSpace(strings.TrimPrefix(string(b), "gitdir:"))
	if !filepath.IsAbs(line) {
		line = filepath.Join(dir, line)
	}
	return line, nil
}

// trash moves path into ~/.Trash under a unique name.
func trash(path string) error {
	home, err := os.UserHomeDir()
	if err != nil {
		return err
	}
	dir := filepath.Join(home, ".Trash")
	name := filepath.Base(path)
	dest := filepath.Join(dir, name)
	for i := 2; ; i++ {
		if _, err := os.Lstat(dest); errors.Is(err, os.ErrNotExist) {
			break
		}
		ext := filepath.Ext(name)
		dest = filepath.Join(dir, fmt.Sprintf("%s %d%s", strings.TrimSuffix(name, ext), i, ext))
	}
	return os.Rename(path, dest)
}
