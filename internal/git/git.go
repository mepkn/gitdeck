// Package git runs the system git binary in a repository and parses its
// output. Using the real git keeps the user's config, SSH keys and
// credential helpers working exactly as they do in a terminal.
package git

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// Repo is one working tree, addressed by its top-level folder.
type Repo struct {
	Dir string
}

// Error is a failed git command, with git's own message.
type Error struct {
	Args   []string
	Stderr string
	Code   int
}

func (e *Error) Error() string {
	msg := strings.TrimSpace(e.Stderr)
	if msg == "" {
		msg = fmt.Sprintf("git %s exited with %d", strings.Join(e.Args, " "), e.Code)
	}
	return msg
}

// Long-running network commands get more time than local ones.
const (
	localTimeout  = 30 * time.Second
	remoteTimeout = 5 * time.Minute
)

// Open returns the repository that contains dir.
func Open(dir string) (*Repo, error) {
	out, err := (&Repo{Dir: dir}).run(nil, "rev-parse", "--show-toplevel")
	if err != nil {
		return nil, fmt.Errorf("%s is not a git repository", dir)
	}
	return &Repo{Dir: filepath.Clean(strings.TrimSpace(string(out)))}, nil
}

func (r *Repo) run(stdin []byte, args ...string) ([]byte, error) {
	return r.runTimeout(localTimeout, stdin, args...)
}

func (r *Repo) runTimeout(timeout time.Duration, stdin []byte, args ...string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, "git", args...)
	cmd.Dir = r.Dir
	cmd.Env = append(os.Environ(),
		// Never wait for a password prompt nobody can see.
		"GIT_TERMINAL_PROMPT=0",
		"GIT_OPTIONAL_LOCKS=0",
		"LC_ALL=C",
	)
	if stdin != nil {
		cmd.Stdin = bytes.NewReader(stdin)
	}
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	err := cmd.Run()
	if err != nil {
		if ctx.Err() != nil {
			return nil, fmt.Errorf("git %s timed out", args[0])
		}
		var exit *exec.ExitError
		if errors.As(err, &exit) {
			return stdout.Bytes(), &Error{Args: args, Stderr: stderr.String(), Code: exit.ExitCode()}
		}
		return nil, err
	}
	return stdout.Bytes(), nil
}

// splitZ splits NUL-separated output, dropping the empty tail.
func splitZ(b []byte) []string {
	s := strings.TrimSuffix(string(b), "\x00")
	if s == "" {
		return nil
	}
	return strings.Split(s, "\x00")
}
