package main

import "testing"

func TestParseOpenURL(t *testing.T) {
	cases := map[string]string{
		"gitdeck://open?path=/Users/me/repo":        "/Users/me/repo",
		"gitdeck://open?path=%2FUsers%2Fme%2Fa%20b": "/Users/me/a b",
		"gitdeck://open?path=relative":              "",
		"gitdeck://other?path=/x":                   "",
		"https://open?path=/x":                      "",
	}
	for in, want := range cases {
		got, ok := parseOpenURL(in)
		if ok != (want != "") || got != want {
			t.Errorf("%s → %q, %v", in, got, ok)
		}
	}
}

func TestCleanMessage(t *testing.T) {
	if got := cleanMessage("```\nfeat: x\n\nbody\n```\n"); got != "feat: x\n\nbody" {
		t.Errorf("got %q", got)
	}
	if got := cleanMessage("  fix: y \n"); got != "fix: y" {
		t.Errorf("got %q", got)
	}
}
