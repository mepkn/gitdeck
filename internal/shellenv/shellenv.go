// Package shellenv gives the app the PATH of the user's login shell. An app
// opened from Finder only gets launchd's minimal PATH, which has none of
// ~/.local/bin, Homebrew or nvm, where git helpers and the claude and agy CLIs live.
package shellenv

import (
	"context"
	"os"
	"os/exec"
	"strings"
	"time"
)

const marker = "__GITDECK_PATH__"

// Load sets PATH from `$SHELL -l -i`, keeping the current one on failure.
func Load() {
	shell := os.Getenv("SHELL")
	if shell == "" {
		shell = "/bin/zsh"
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	// Interactive so .zshrc runs; the markers cut away anything it prints.
	out, err := exec.CommandContext(ctx, shell, "-l", "-i", "-c", "printf '"+marker+"%s"+marker+"' \"$PATH\"").Output()
	if err != nil {
		return
	}
	parts := strings.Split(string(out), marker)
	if len(parts) >= 3 && parts[1] != "" {
		os.Setenv("PATH", parts[1])
	}
}
