package git

import (
	"strconv"
	"strings"
)

// File is one changed path. Index and Work are git's one-letter states
// (M, A, D, R, C, T, U, ?) for the staged and unstaged side, "" when that
// side is unchanged.
type File struct {
	Path     string `json:"path"`
	OrigPath string `json:"origPath"`
	Index    string `json:"index"`
	Work     string `json:"work"`
	Conflict bool   `json:"conflict"`
}

type Status struct {
	Branch   string `json:"branch"` // "" when detached
	Head     string `json:"head"`   // commit SHA, "" before the first commit
	Upstream string `json:"upstream"`
	Ahead    int    `json:"ahead"`
	Behind   int    `json:"behind"`
	Files    []File `json:"files"`
}

// StatusRaw is git's status output, cheap enough to poll for changes.
func (r *Repo) StatusRaw() ([]byte, error) {
	return r.run(nil, "status", "--porcelain=v2", "-z", "--branch", "--untracked-files=all")
}

func (r *Repo) Status() (*Status, error) {
	out, err := r.StatusRaw()
	if err != nil {
		return nil, err
	}
	return ParseStatus(out), nil
}

// ParseStatus reads `git status --porcelain=v2 -z --branch`.
func ParseStatus(out []byte) *Status {
	st := &Status{Files: []File{}}
	parts := splitZ(out)
	for i := 0; i < len(parts); i++ {
		line := parts[i]
		switch {
		case strings.HasPrefix(line, "# branch.oid "):
			if oid := strings.TrimPrefix(line, "# branch.oid "); oid != "(initial)" {
				st.Head = oid
			}
		case strings.HasPrefix(line, "# branch.head "):
			if h := strings.TrimPrefix(line, "# branch.head "); h != "(detached)" {
				st.Branch = h
			}
		case strings.HasPrefix(line, "# branch.upstream "):
			st.Upstream = strings.TrimPrefix(line, "# branch.upstream ")
		case strings.HasPrefix(line, "# branch.ab "):
			f := strings.Fields(strings.TrimPrefix(line, "# branch.ab "))
			if len(f) == 2 {
				st.Ahead, _ = strconv.Atoi(strings.TrimPrefix(f[0], "+"))
				b, _ := strconv.Atoi(strings.TrimPrefix(f[1], "-"))
				st.Behind = b
			}
		case strings.HasPrefix(line, "1 "):
			f := strings.SplitN(line, " ", 9)
			if len(f) == 9 {
				st.Files = append(st.Files, entry(f[1], f[8], ""))
			}
		case strings.HasPrefix(line, "2 "):
			f := strings.SplitN(line, " ", 10)
			if len(f) == 10 && i+1 < len(parts) {
				st.Files = append(st.Files, entry(f[1], f[9], parts[i+1]))
				i++ // the original path is the next NUL field
			}
		case strings.HasPrefix(line, "u "):
			f := strings.SplitN(line, " ", 11)
			if len(f) == 11 {
				st.Files = append(st.Files, File{Path: f[10], Index: "U", Work: "U", Conflict: true})
			}
		case strings.HasPrefix(line, "? "):
			st.Files = append(st.Files, File{Path: line[2:], Work: "?"})
		}
	}
	return st
}

func entry(xy, path, orig string) File {
	side := func(c byte) string {
		if c == '.' {
			return ""
		}
		return string(c)
	}
	return File{Path: path, OrigPath: orig, Index: side(xy[0]), Work: side(xy[1])}
}

// Stage adds whole files to the index, including deletions.
func (r *Repo) Stage(paths []string) error {
	if len(paths) == 0 {
		return nil
	}
	_, err := r.run(nil, append([]string{"add", "-A", "--"}, paths...)...)
	return err
}

// Unstage takes whole files out of the index, keeping the working tree.
func (r *Repo) Unstage(paths []string) error {
	if len(paths) == 0 {
		return nil
	}
	if !r.hasHead() {
		_, err := r.run(nil, append([]string{"rm", "--cached", "-r", "-q", "--"}, paths...)...)
		return err
	}
	_, err := r.run(nil, append([]string{"restore", "--staged", "--"}, paths...)...)
	return err
}

// Discard returns a file to its last committed state, staged and unstaged.
// A file git doesn't track is left for the caller to remove.
func (r *Repo) Discard(f File) error {
	paths := []string{f.Path}
	if f.OrigPath != "" {
		paths = append(paths, f.OrigPath)
	}
	if f.Index == "A" {
		// Added to the index only: take it out; the caller trashes the file.
		_, err := r.run(nil, "rm", "--cached", "-q", "--", f.Path)
		return err
	}
	_, err := r.run(nil, append([]string{"restore", "--source=HEAD", "--staged", "--worktree", "--"}, paths...)...)
	return err
}

func (r *Repo) hasHead() bool {
	_, err := r.run(nil, "rev-parse", "--verify", "-q", "HEAD")
	return err == nil
}

// Commit commits the index with the given message.
func (r *Repo) Commit(message string) error {
	_, err := r.run([]byte(message), "commit", "-F", "-")
	return err
}

func (r *Repo) Fetch() error {
	_, err := r.runTimeout(remoteTimeout, nil, "fetch", "--all", "--prune")
	return err
}

func (r *Repo) Pull() error {
	_, err := r.runTimeout(remoteTimeout, nil, "pull")
	return err
}

// Push pushes the current branch, setting its upstream on the first push.
func (r *Repo) Push(hasUpstream bool) error {
	if hasUpstream {
		_, err := r.runTimeout(remoteTimeout, nil, "push")
		return err
	}
	_, err := r.runTimeout(remoteTimeout, nil, "push", "-u", "origin", "HEAD")
	return err
}

// StagedDiff is the staged change, for writing a commit message.
func (r *Repo) StagedDiff() (stat, diff string, err error) {
	s, err := r.run(nil, "diff", "--cached", "--stat")
	if err != nil {
		return "", "", err
	}
	d, err := r.run(nil, "diff", "--cached", "--no-color", "--no-ext-diff")
	return string(s), string(d), err
}

// RecentSubjects returns the last n commit subjects, to match their style.
func (r *Repo) RecentSubjects(n int) []string {
	out, err := r.run(nil, "log", "-n", strconv.Itoa(n), "--format=%s")
	if err != nil {
		return nil
	}
	return strings.Split(strings.TrimSpace(string(out)), "\n")
}
