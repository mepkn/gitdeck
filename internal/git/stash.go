package git

import (
	"strconv"
	"strings"
)

type Stash struct {
	Ref     string `json:"ref"` // stash@{0}
	Message string `json:"message"`
	Branch  string `json:"branch"`
	Time    int64  `json:"time"`
	// Untracked: the stash holds untracked files (a third parent).
	Untracked bool `json:"untracked"`
}

func (r *Repo) Stashes() ([]Stash, error) {
	out, err := r.run(nil, "stash", "list", "--format=%gd%x1f%gs%x1f%ct%x1f%P%x1e")
	if err != nil {
		return nil, err
	}
	return ParseStashes(out), nil
}

func ParseStashes(out []byte) []Stash {
	stashes := []Stash{}
	for _, rec := range strings.Split(string(out), "\x1e") {
		rec = strings.TrimSpace(rec)
		if rec == "" {
			continue
		}
		f := strings.Split(rec, "\x1f")
		if len(f) < 4 {
			continue
		}
		s := Stash{Ref: f[0], Untracked: len(strings.Fields(f[3])) >= 3}
		s.Time, _ = strconv.ParseInt(f[2], 10, 64)
		s.Branch, s.Message = splitStashSubject(f[1])
		stashes = append(stashes, s)
	}
	return stashes
}

// splitStashSubject reads "On main: my message" or "WIP on main: 1a2b3c subject".
func splitStashSubject(s string) (branch, message string) {
	rest := s
	wip := false
	switch {
	case strings.HasPrefix(s, "WIP on "):
		rest, wip = strings.TrimPrefix(s, "WIP on "), true
	case strings.HasPrefix(s, "On "):
		rest = strings.TrimPrefix(s, "On ")
	default:
		return "", s
	}
	i := strings.Index(rest, ": ")
	if i < 0 {
		return "", s
	}
	branch, message = rest[:i], rest[i+2:]
	if wip {
		// Drop the short SHA git puts before the subject.
		if j := strings.IndexByte(message, ' '); j > 0 {
			message = "WIP: " + message[j+1:]
		}
	}
	return branch, message
}

// StashPush stashes changes. With paths, only those files are stashed.
func (r *Repo) StashPush(message string, paths []string, untracked, keepIndex bool) error {
	args := []string{"stash", "push"}
	if message != "" {
		args = append(args, "-m", message)
	}
	if untracked {
		args = append(args, "--include-untracked")
	}
	if keepIndex {
		args = append(args, "--keep-index")
	}
	if len(paths) > 0 {
		args = append(append(args, "--"), paths...)
	}
	_, err := r.run(nil, args...)
	return err
}

// StashFiles lists what a stash changed, untracked files included.
func (r *Repo) StashFiles(s Stash) ([]ChangedFile, error) {
	files, err := r.changedFiles(s.Ref+"^1", s.Ref)
	if err != nil {
		return nil, err
	}
	if s.Untracked {
		extra, err := r.changedFiles(emptyTree, s.Ref+"^3")
		if err != nil {
			return nil, err
		}
		files = append(files, extra...)
	}
	return files, nil
}

// StashDiff is one file's diff in a stash.
func (r *Repo) StashDiff(s Stash, f ChangedFile, context int) (*Diff, error) {
	if s.Untracked {
		if _, err := r.run(nil, "cat-file", "-e", s.Ref+"^3:"+f.Path); err == nil {
			return r.RangeDiff("", s.Ref+"^3", f.Path, context)
		}
	}
	return r.RangeDiff(s.Ref+"^1", s.Ref, f.Path, context)
}

func (r *Repo) StashPop(ref string) error {
	_, err := r.run(nil, "stash", "pop", "--index", ref)
	if err != nil && strings.Contains(err.Error(), "--index") {
		// The staged state didn't apply cleanly; pop without it.
		_, err = r.run(nil, "stash", "pop", ref)
	}
	return err
}

func (r *Repo) StashApply(ref string) error {
	_, err := r.run(nil, "stash", "apply", "--index", ref)
	if err != nil && strings.Contains(err.Error(), "--index") {
		_, err = r.run(nil, "stash", "apply", ref)
	}
	return err
}

func (r *Repo) StashDrop(ref string) error {
	_, err := r.run(nil, "stash", "drop", ref)
	return err
}

// StashBranch makes a branch from the stash's base commit, applies the
// stash there and drops it.
func (r *Repo) StashBranch(name, ref string) error {
	_, err := r.run(nil, "stash", "branch", name, ref)
	return err
}
