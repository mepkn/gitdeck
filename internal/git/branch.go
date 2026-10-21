package git

import (
	"strconv"
	"strings"
)

type Branch struct {
	Name     string `json:"name"` // "main", or "origin/main" for a remote
	Remote   bool   `json:"remote"`
	Current  bool   `json:"current"`
	Upstream string `json:"upstream"`
	Ahead    int    `json:"ahead"`
	Behind   int    `json:"behind"`
	Gone     bool   `json:"gone"` // its upstream was deleted
	Time     int64  `json:"time"`
}

func (r *Repo) Branches() ([]Branch, error) {
	out, err := r.run(nil, "for-each-ref",
		"--format=%(refname)%1f%(refname:short)%1f%(upstream:short)%1f%(upstream:track,nobracket)%1f%(HEAD)%1f%(committerdate:unix)",
		"--sort=-committerdate", "refs/heads", "refs/remotes")
	if err != nil {
		return nil, err
	}
	return ParseBranches(out), nil
}

func ParseBranches(out []byte) []Branch {
	branches := []Branch{}
	for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
		f := strings.Split(line, "\x1f")
		if len(f) < 6 {
			continue
		}
		// origin/HEAD is an alias, not a branch.
		if strings.HasSuffix(f[0], "/HEAD") {
			continue
		}
		b := Branch{Name: f[1], Remote: strings.HasPrefix(f[0], "refs/remotes/"), Current: f[4] == "*", Upstream: f[2]}
		b.Time, _ = strconv.ParseInt(f[5], 10, 64)
		for _, part := range strings.Split(f[3], ", ") {
			switch {
			case part == "gone":
				b.Gone = true
			case strings.HasPrefix(part, "ahead "):
				b.Ahead, _ = strconv.Atoi(strings.TrimPrefix(part, "ahead "))
			case strings.HasPrefix(part, "behind "):
				b.Behind, _ = strconv.Atoi(strings.TrimPrefix(part, "behind "))
			}
		}
		branches = append(branches, b)
	}
	return branches
}

// Switch checks out a local branch, or creates a tracking branch for a
// remote one ("origin/x" → local "x").
func (r *Repo) Switch(name string, remote bool) error {
	if remote {
		local := name[strings.IndexByte(name, '/')+1:]
		if _, err := r.run(nil, "rev-parse", "-q", "--verify", "refs/heads/"+local); err == nil {
			_, err := r.run(nil, "switch", local)
			return err
		}
		_, err := r.run(nil, "switch", "--track", name)
		return err
	}
	_, err := r.run(nil, "switch", name)
	return err
}

// CreateBranch makes a branch at HEAD and switches to it.
func (r *Repo) CreateBranch(name string) error {
	_, err := r.run(nil, "switch", "-c", name)
	return err
}

// DeleteBranch deletes a local branch; force deletes it even if unmerged.
func (r *Repo) DeleteBranch(name string, force bool) error {
	flag := "-d"
	if force {
		flag = "-D"
	}
	_, err := r.run(nil, "branch", flag, name)
	return err
}
