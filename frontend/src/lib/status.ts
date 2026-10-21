// Colours and names for git's one-letter file states.

export const stateColor: Record<string, string> = {
  M: "text-status-modified",
  T: "text-status-modified",
  A: "text-status-added",
  C: "text-status-added",
  R: "text-status-untracked",
  D: "text-status-deleted",
  "?": "text-status-untracked",
  U: "text-status-conflict",
};

export const stateLabel: Record<string, string> = {
  M: "Modified",
  T: "Type changed",
  A: "Added",
  C: "Copied",
  R: "Renamed",
  D: "Deleted",
  "?": "Untracked",
  U: "Conflict",
};
