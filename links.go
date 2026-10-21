package main

import (
	"net/url"
	"path/filepath"
)

// parseOpenURL reads gitdeck://open?path=/abs/folder.
func parseOpenURL(raw string) (string, bool) {
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "gitdeck" || u.Host != "open" {
		return "", false
	}
	path := u.Query().Get("path")
	if path == "" || !filepath.IsAbs(path) {
		return "", false
	}
	return filepath.Clean(path), true
}
