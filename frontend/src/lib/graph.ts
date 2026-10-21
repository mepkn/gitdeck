// Lays out the commit graph: which lane (column) each commit sits in and
// the line segments drawn in its row. Commits come newest first in
// topological order, as `git log --topo-order` gives them.

/** A line from column `from` to column `to`, coloured by `lane`. */
export type Segment = { from: number; to: number; lane: number };

export type GraphRow = {
  lane: number;
  /** Segments in the row's top half (top edge → dot). */
  top: Segment[];
  /** Segments in the bottom half (dot → bottom edge). */
  bottom: Segment[];
  width: number;
};

type Node = { sha: string; parents: string[] };

export function layoutGraph(commits: Node[]): GraphRow[] {
  // lanes[i] is the commit the line in column i is heading down to.
  let lanes: (string | null)[] = [];
  const rows: GraphRow[] = [];

  for (const c of commits) {
    // Lines coming down from the row above; those heading here bend in.
    let lane = lanes.indexOf(c.sha);
    const top: Segment[] = [];
    lanes.forEach((sha, i) => {
      if (sha !== null) top.push({ from: i, to: sha === c.sha ? lane : i, lane: i });
    });
    // A branch tip nobody pointed at starts a new lane, with no line above.
    if (lane < 0) lane = freeLane(lanes);

    // Lanes that pointed here are free now; this lane goes on to the first parent.
    const after = lanes.map((sha) => (sha === c.sha ? null : sha));
    while (after.length <= lane) after.push(null);
    after[lane] = c.parents[0] ?? null;

    const bottom: Segment[] = [];
    if (after[lane] !== null) bottom.push({ from: lane, to: lane, lane });
    // Merge parents join an existing lane or open a new one.
    for (const parent of c.parents.slice(1)) {
      let target = after.indexOf(parent);
      if (target < 0) {
        target = freeLane(after);
        after[target] = parent;
      }
      bottom.push({ from: lane, to: target, lane: target });
    }
    // Other lines pass straight through.
    after.forEach((sha, i) => {
      if (sha !== null && i !== lane && lanes[i] === sha) bottom.push({ from: i, to: i, lane: i });
    });

    const width = Math.max(lanes.length, after.length, lane + 1);
    while (after.length && after[after.length - 1] === null) after.pop();
    lanes = after;
    rows.push({ lane, top, bottom, width });
  }
  return rows;
}

function freeLane(lanes: (string | null)[]): number {
  const i = lanes.indexOf(null);
  return i < 0 ? lanes.length : i;
}
