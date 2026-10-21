package git

import (
	"errors"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// Line is one line of a hunk. Kind is " " (context), "+" or "-"; Old and
// New are its line numbers on each side, 0 where it has none.
type Line struct {
	Kind string `json:"kind"`
	Text string `json:"text"`
	Old  int    `json:"old"`
	New  int    `json:"new"`
}

type Hunk struct {
	Header string `json:"header"` // the text after the @@ range, e.g. a function name
	Lines  []Line `json:"lines"`
}

type Diff struct {
	Path      string `json:"path"`
	Binary    bool   `json:"binary"`
	Added     int    `json:"added"`
	Removed   int    `json:"removed"`
	Hunks     []Hunk `json:"hunks"`
	Truncated bool   `json:"truncated"`
}

// maxLines caps a diff so a huge generated file can't stall the UI.
const maxLines = 20000

// FullContext asks for the whole file around the changes.
const FullContext = 1_000_000

func diffArgs(context int) []string {
	return []string{"diff", "--no-color", "--no-ext-diff", "-M", "-U" + strconv.Itoa(context)}
}

// WorkDiff is the diff of one changed file: staged (index vs HEAD) or
// unstaged (working tree vs index). Untracked files show as all added.
func (r *Repo) WorkDiff(f File, staged bool, context int) (*Diff, error) {
	if !staged && f.Work == "?" {
		return r.untrackedDiff(f.Path, context)
	}
	args := diffArgs(context)
	if staged {
		args = append(args, "--cached")
	}
	args = append(args, "--", f.Path)
	if f.OrigPath != "" {
		args = append(args, f.OrigPath)
	}
	out, err := r.run(nil, args...)
	if err != nil {
		return nil, err
	}
	return ParseDiff(f.Path, out), nil
}

func (r *Repo) untrackedDiff(path string, context int) (*Diff, error) {
	full := filepath.Join(r.Dir, path)
	if info, err := os.Lstat(full); err == nil && info.IsDir() {
		return &Diff{Path: path, Hunks: []Hunk{}}, nil
	}
	args := append(diffArgs(context), "--no-index", "--", os.DevNull, path)
	out, err := r.run(nil, args...)
	// --no-index exits 1 when the files differ, which they always do here.
	var gerr *Error
	if err != nil && !(errors.As(err, &gerr) && gerr.Code == 1) {
		return nil, err
	}
	return ParseDiff(path, out), nil
}

// RangeDiff is the diff of one path between two commits ("" from = empty tree).
func (r *Repo) RangeDiff(from, to, path string, context int) (*Diff, error) {
	args := diffArgs(context)
	if from == "" {
		from = emptyTree
	}
	args = append(args, from, to, "--", path)
	out, err := r.run(nil, args...)
	if err != nil {
		return nil, err
	}
	return ParseDiff(path, out), nil
}

// emptyTree is git's well-known hash of the empty tree.
const emptyTree = "4b825dc642cb6eb9a060e54bf8d69288fbee4904"

// ParseDiff reads unified diff output for a single file.
func ParseDiff(path string, out []byte) *Diff {
	d := &Diff{Path: path, Hunks: []Hunk{}}
	var cur *Hunk
	var oldN, newN, count int
	for _, line := range strings.Split(string(out), "\n") {
		if strings.HasPrefix(line, "Binary files ") || line == "GIT binary patch" {
			d.Binary = true
			continue
		}
		if strings.HasPrefix(line, "@@ ") {
			o, n, header, ok := parseHunkHeader(line)
			if !ok {
				continue
			}
			d.Hunks = append(d.Hunks, Hunk{Header: header, Lines: []Line{}})
			cur = &d.Hunks[len(d.Hunks)-1]
			oldN, newN = o, n
			continue
		}
		if cur == nil || line == "" {
			continue
		}
		if count >= maxLines {
			d.Truncated = true
			break
		}
		switch line[0] {
		case ' ':
			cur.Lines = append(cur.Lines, Line{Kind: " ", Text: line[1:], Old: oldN, New: newN})
			oldN++
			newN++
		case '-':
			cur.Lines = append(cur.Lines, Line{Kind: "-", Text: line[1:], Old: oldN})
			oldN++
			d.Removed++
		case '+':
			cur.Lines = append(cur.Lines, Line{Kind: "+", Text: line[1:], New: newN})
			newN++
			d.Added++
		default:
			continue // "\ No newline at end of file"
		}
		count++
	}
	return d
}

// parseHunkHeader reads "@@ -12,9 +12,15 @@ func Notify()".
func parseHunkHeader(line string) (oldStart, newStart int, header string, ok bool) {
	rest := strings.TrimPrefix(line, "@@ ")
	end := strings.Index(rest, " @@")
	if end < 0 {
		return 0, 0, "", false
	}
	f := strings.Fields(rest[:end])
	if len(f) < 2 {
		return 0, 0, "", false
	}
	start := func(s string) int {
		s = strings.TrimLeft(s, "-+")
		if i := strings.IndexByte(s, ','); i >= 0 {
			s = s[:i]
		}
		n, _ := strconv.Atoi(s)
		return n
	}
	return start(f[0]), start(f[1]), strings.TrimSpace(rest[end+3:]), true
}
