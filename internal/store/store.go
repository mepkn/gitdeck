// Package store keeps gitdeck's project list and settings in
// ~/Library/Application Support/gitdeck/state.json.
package store

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
)

type Project struct {
	Path   string `json:"path"`
	Name   string `json:"name"`
	Opened int64  `json:"opened"` // unix seconds, for "recent" order
}

type State struct {
	Projects []Project `json:"projects"`
	Active   string    `json:"active"` // path of the open project, "" for the picker
	// DiffMode is "split" or "inline".
	DiffMode string `json:"diffMode"`
	// FullFile shows the whole file around changes, not 3 lines.
	FullFile bool `json:"fullFile"`
	// Agent writes commit messages: "claude" or "agy".
	Agent string `json:"agent"`
}

type Store struct {
	path string
	mu   sync.Mutex
}

func Open() (*Store, error) {
	cfg, err := os.UserConfigDir() // ~/Library/Application Support on macOS
	if err != nil {
		return nil, err
	}
	dir := filepath.Join(cfg, "gitdeck")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	return &Store{path: filepath.Join(dir, "state.json")}, nil
}

// OpenAt uses a given file, for tests.
func OpenAt(path string) *Store {
	return &Store{path: path}
}

func (s *Store) Get() State {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.load()
}

// Update changes the state under the lock and saves it.
func (s *Store) Update(fn func(*State)) (State, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	st := s.load()
	fn(&st)
	b, err := json.MarshalIndent(st, "", "  ")
	if err != nil {
		return st, err
	}
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return st, err
	}
	return st, os.Rename(tmp, s.path)
}

func (s *Store) load() State {
	st := State{Projects: []Project{}, DiffMode: "split", Agent: "claude"}
	if b, err := os.ReadFile(s.path); err == nil {
		_ = json.Unmarshal(b, &st)
	}
	if st.Projects == nil {
		st.Projects = []Project{}
	}
	if st.DiffMode != "inline" {
		st.DiffMode = "split"
	}
	if st.Agent != "agy" {
		st.Agent = "claude"
	}
	return st
}
