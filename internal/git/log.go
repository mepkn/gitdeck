package git

import (
	"strconv"
	"strings"
)

type Commit struct {
	SHA     string   `json:"sha"`
	Parents []string `json:"parents"`
	Author  string   `json:"author"`
	Email   string   `json:"email"`
	Time    int64    `json:"time"`
	Refs    []string `json:"refs"` // "HEAD -> main", "origin/main", "tag: v1"
	Subject string   `json:"subject"`
	Body    string   `json:"body"`
}

// ChangedFile is one path a commit (or stash) changed.
type ChangedFile struct {
	Path     string `json:"path"`
	OrigPath string `json:"origPath"`
	Status   string `json:"status"` // A, M, D, R, C, T
	Added    int    `json:"added"`
	Removed  int    `json:"removed"`
	Binary   bool   `json:"binary"`
}

const logFormat = "%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%D%x1f%s%x1f%b%x1e"

// Log lists commits reachable from HEAD, newest first in topological order.
func (r *Repo) Log(skip, limit int) ([]Commit, error) {
	if !r.hasHead() {
		return []Commit{}, nil
	}
	out, err := r.run(nil, "log", "--topo-order", "--format="+logFormat,
		"--skip="+strconv.Itoa(skip), "-n", strconv.Itoa(limit), "HEAD")
	if err != nil {
		return nil, err
	}
	return ParseLog(out), nil
}

func ParseLog(out []byte) []Commit {
	commits := []Commit{}
	for _, rec := range strings.Split(string(out), "\x1e") {
		rec = strings.TrimLeft(rec, "\n")
		if rec == "" {
			continue
		}
		f := strings.SplitN(rec, "\x1f", 8)
		if len(f) < 8 {
			continue
		}
		t, _ := strconv.ParseInt(f[4], 10, 64)
		c := Commit{SHA: f[0], Parents: strings.Fields(f[1]), Author: f[2], Email: f[3], Time: t,
			Refs: []string{}, Subject: f[6], Body: strings.TrimSpace(f[7])}
		if f[5] != "" {
			c.Refs = strings.Split(f[5], ", ")
		}
		commits = append(commits, c)
	}
	return commits
}

// CommitFiles lists the files a commit changed against its first parent.
func (r *Repo) CommitFiles(sha string) ([]ChangedFile, error) {
	parent := r.FirstParent(sha)
	from := parent
	if from == "" {
		from = emptyTree
	}
	return r.changedFiles(from, sha)
}

// FirstParent is the commit's first parent, "" for a root commit.
func (r *Repo) FirstParent(sha string) string {
	out, err := r.run(nil, "rev-parse", "-q", "--verify", sha+"^1")
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}

func (r *Repo) changedFiles(from, to string) ([]ChangedFile, error) {
	ns, err := r.run(nil, "diff", "--name-status", "-z", "-M", from, to)
	if err != nil {
		return nil, err
	}
	num, err := r.run(nil, "diff", "--numstat", "-z", "-M", from, to)
	if err != nil {
		return nil, err
	}
	return ParseChangedFiles(ns, num), nil
}

// ParseChangedFiles joins `diff --name-status -z` with `diff --numstat -z`.
func ParseChangedFiles(nameStatus, numstat []byte) []ChangedFile {
	files := []ChangedFile{}
	byPath := map[string]int{}
	p := splitZ(nameStatus)
	for i := 0; i < len(p); i++ {
		st := p[i]
		if st == "" {
			continue
		}
		f := ChangedFile{Status: st[:1]}
		if (st[0] == 'R' || st[0] == 'C') && i+2 < len(p) {
			f.OrigPath, f.Path = p[i+1], p[i+2]
			i += 2
		} else if i+1 < len(p) {
			f.Path = p[i+1]
			i++
		}
		byPath[f.Path] = len(files)
		files = append(files, f)
	}
	n := splitZ(numstat)
	for i := 0; i < len(n); i++ {
		cols := strings.SplitN(n[i], "\t", 3)
		if len(cols) < 3 {
			continue
		}
		path := cols[2]
		if path == "" && i+2 < len(n) { // rename: the paths follow
			path = n[i+2]
			i += 2
		}
		idx, ok := byPath[path]
		if !ok {
			continue
		}
		if cols[0] == "-" {
			files[idx].Binary = true
			continue
		}
		files[idx].Added, _ = strconv.Atoi(cols[0])
		files[idx].Removed, _ = strconv.Atoi(cols[1])
	}
	return files
}

// Revert makes a new commit undoing sha.
func (r *Repo) Revert(sha string) error {
	_, err := r.run(nil, "revert", "--no-edit", sha)
	return err
}

// CheckoutCommit detaches HEAD at sha.
func (r *Repo) CheckoutCommit(sha string) error {
	_, err := r.run(nil, "switch", "--detach", sha)
	return err
}
