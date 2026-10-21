package git

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// newRepo makes a repository with one commit of a.txt.
func newRepo(t *testing.T) *Repo {
	t.Helper()
	dir := t.TempDir()
	sh := func(args ...string) {
		cmd := exec.Command("git", args...)
		cmd.Dir = dir
		cmd.Env = append(os.Environ(), "GIT_CONFIG_GLOBAL=/dev/null", "GIT_CONFIG_SYSTEM=/dev/null")
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v\n%s", args, err, out)
		}
	}
	sh("init", "-q", "-b", "main")
	sh("config", "user.name", "Test")
	sh("config", "user.email", "test@example.com")
	write(t, dir, "a.txt", "one\ntwo\nthree\n")
	sh("add", ".")
	sh("commit", "-q", "-m", "feat: first")
	r, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	return r
}

func write(t *testing.T, dir, name, body string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
}

func find(st *Status, path string) *File {
	for i := range st.Files {
		if st.Files[i].Path == path {
			return &st.Files[i]
		}
	}
	return nil
}

func TestStageCommitAndDiff(t *testing.T) {
	r := newRepo(t)
	write(t, r.Dir, "a.txt", "one\n2\nthree\n")
	write(t, r.Dir, "new.txt", "hello\n")

	st, err := r.Status()
	if err != nil {
		t.Fatal(err)
	}
	if st.Branch != "main" || len(st.Files) != 2 {
		t.Fatalf("status = %+v", st)
	}
	a := find(st, "a.txt")
	if a == nil || a.Work != "M" || a.Index != "" {
		t.Fatalf("a.txt = %+v", a)
	}
	if n := find(st, "new.txt"); n == nil || n.Work != "?" {
		t.Fatalf("new.txt = %+v", n)
	}

	d, err := r.WorkDiff(*a, false, 3)
	if err != nil {
		t.Fatal(err)
	}
	if d.Added != 1 || d.Removed != 1 || len(d.Hunks) != 1 {
		t.Fatalf("diff = %+v", d)
	}
	lines := d.Hunks[0].Lines
	if lines[1].Kind != "-" || lines[1].Text != "two" || lines[1].Old != 2 || lines[2].New != 2 {
		t.Fatalf("lines = %+v", lines)
	}

	u, err := r.WorkDiff(File{Path: "new.txt", Work: "?"}, false, 3)
	if err != nil || u.Added != 1 {
		t.Fatalf("untracked diff = %+v, %v", u, err)
	}

	if err := r.Stage([]string{"a.txt", "new.txt"}); err != nil {
		t.Fatal(err)
	}
	st, _ = r.Status()
	if f := find(st, "new.txt"); f == nil || f.Index != "A" {
		t.Fatalf("staged new.txt = %+v", f)
	}
	if err := r.Unstage([]string{"new.txt"}); err != nil {
		t.Fatal(err)
	}
	if err := r.Commit("fix: two"); err != nil {
		t.Fatal(err)
	}
	log, err := r.Log(0, 10)
	if err != nil || len(log) != 2 || log[0].Subject != "fix: two" {
		t.Fatalf("log = %+v, %v", log, err)
	}
	if !strings.Contains(strings.Join(log[0].Refs, ","), "main") {
		t.Fatalf("refs = %v", log[0].Refs)
	}
	files, err := r.CommitFiles(log[0].SHA)
	if err != nil || len(files) != 1 || files[0].Path != "a.txt" || files[0].Added != 1 {
		t.Fatalf("commit files = %+v, %v", files, err)
	}
	root, err := r.CommitFiles(log[1].SHA)
	if err != nil || len(root) != 1 || root[0].Status != "A" {
		t.Fatalf("root files = %+v, %v", root, err)
	}
}

func TestDiscard(t *testing.T) {
	r := newRepo(t)
	write(t, r.Dir, "a.txt", "changed\n")
	_ = r.Stage([]string{"a.txt"})
	write(t, r.Dir, "a.txt", "changed again\n")
	if err := r.Discard(File{Path: "a.txt", Index: "M", Work: "M"}); err != nil {
		t.Fatal(err)
	}
	b, _ := os.ReadFile(filepath.Join(r.Dir, "a.txt"))
	if string(b) != "one\ntwo\nthree\n" {
		t.Fatalf("a.txt = %q", b)
	}
}

func TestBranches(t *testing.T) {
	r := newRepo(t)
	if err := r.CreateBranch("feat/x"); err != nil {
		t.Fatal(err)
	}
	bs, err := r.Branches()
	if err != nil || len(bs) != 2 {
		t.Fatalf("branches = %+v, %v", bs, err)
	}
	cur := 0
	for _, b := range bs {
		if b.Current {
			cur++
			if b.Name != "feat/x" {
				t.Fatalf("current = %s", b.Name)
			}
		}
	}
	if cur != 1 {
		t.Fatalf("current branches = %d", cur)
	}
	if err := r.Switch("main", false); err != nil {
		t.Fatal(err)
	}
	if err := r.DeleteBranch("feat/x", false); err != nil {
		t.Fatal(err)
	}
}

func TestStash(t *testing.T) {
	r := newRepo(t)
	write(t, r.Dir, "a.txt", "stashed\n")
	write(t, r.Dir, "u.txt", "untracked\n")
	if err := r.StashPush("my work", nil, true, false); err != nil {
		t.Fatal(err)
	}
	st, _ := r.Status()
	if len(st.Files) != 0 {
		t.Fatalf("tree not clean: %+v", st.Files)
	}
	ss, err := r.Stashes()
	if err != nil || len(ss) != 1 {
		t.Fatalf("stashes = %+v, %v", ss, err)
	}
	s := ss[0]
	if s.Ref != "stash@{0}" || s.Message != "my work" || s.Branch != "main" || !s.Untracked {
		t.Fatalf("stash = %+v", s)
	}
	files, err := r.StashFiles(s)
	if err != nil || len(files) != 2 {
		t.Fatalf("stash files = %+v, %v", files, err)
	}
	for _, f := range files {
		d, err := r.StashDiff(s, f, 3)
		if err != nil || d.Added == 0 {
			t.Fatalf("stash diff %s = %+v, %v", f.Path, d, err)
		}
	}
	if err := r.StashPop(s.Ref); err != nil {
		t.Fatal(err)
	}
	st, _ = r.Status()
	if len(st.Files) != 2 {
		t.Fatalf("after pop: %+v", st.Files)
	}
}

func TestParseStatusRenameAndAhead(t *testing.T) {
	out := "# branch.oid abc\x00# branch.head main\x00# branch.upstream origin/main\x00# branch.ab +2 -1\x00" +
		"2 R. N... 100644 100644 100644 h1 h2 R100 new.go\x00old.go\x00" +
		"u UU N... 100644 100644 100644 100644 h1 h2 h3 c.txt\x00"
	st := ParseStatus([]byte(out))
	if st.Ahead != 2 || st.Behind != 1 || st.Upstream != "origin/main" || st.Head != "abc" {
		t.Fatalf("branch = %+v", st)
	}
	if len(st.Files) != 2 || st.Files[0].OrigPath != "old.go" || st.Files[0].Index != "R" || !st.Files[1].Conflict {
		t.Fatalf("files = %+v", st.Files)
	}
}

func TestSplitStashSubject(t *testing.T) {
	cases := map[string][2]string{
		"On main: my msg":                   {"main", "my msg"},
		"WIP on feat/x: 1a2b3c4 fix: thing": {"feat/x", "WIP: fix: thing"},
		"odd":                               {"", "odd"},
	}
	for in, want := range cases {
		b, m := splitStashSubject(in)
		if b != want[0] || m != want[1] {
			t.Errorf("%q → %q, %q", in, b, m)
		}
	}
}
