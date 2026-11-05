// The story's order: which dialogue file (and which scene in it) a player meets first, then
// next. Worked out from how the story moves (jumps, choices, falling through, flags one
// scene sets and a later one reads), with the files' names and the project's places as
// hints. It is a suggestion the writer can reorder; only the app's lists follow it, the
// files are never changed by it.

import type { FlowKind } from "./bindings/FlowKind";
import type { Label } from "./bindings/Label";
import type { ReadView } from "./bindings/ReadView";
import { normalize } from "./text";

/** Why a file is where it is in the suggestion. */
export type Reason =
  | { kind: "start" }
  | { kind: "entry" }
  | { kind: "numbered"; n: number }
  | { kind: "after"; file: string; how: FlowKind }
  | { kind: "rest" };

export type StoryFile = {
  /** The file's index in the script. */
  file: number;
  path: string;
  /** Its scenes, in the order the story plays them. */
  labels: Label[];
  reason: Reason;
};

/** Names that open a story: `intro`, `inicio`, `prologo`, `tutorial`, `abertura`… */
const START = /(^|[^a-z])(intro|introducao|inicio|start|begin|beginning|prolog|prologo|prologue|opening|abertura|tutorial|comeco)([^a-z]|$)/;

/** The first number in a file's name (`02_bar`, `cap3`, `ato-1`), as a hint of its place. */
export function numberIn(path: string): number | null {
  const name = path.slice(path.lastIndexOf("/") + 1).replace(/\.[^.]+$/, "");
  const m = /\d+/.exec(name);
  return m ? Number(m[0]) : null;
}

const STRONG: FlowKind[] = ["jump", "choice", "conditional", "fall_through"];

/**
 * Order nodes so the story reads as one thread: a node comes after the nodes leading to
 * it; among those ready, the ones the latest node leads to come first (following the
 * thread), then the lowest `rank`. A loop is broken at its lowest-ranked node.
 */
export function thread(count: number, edges: Array<[number, number]>, rank: (n: number) => number[]): number[] {
  const preds = Array.from({ length: count }, () => new Set<number>());
  for (const [from, to] of edges) if (from !== to) preds[to].add(from);
  const done = new Map<number, number>(); // node → when it was placed
  const order: number[] = [];
  const cmp = (a: number[], b: number[]) => {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const d = (a[i] ?? 0) - (b[i] ?? 0);
      if (d !== 0) return d;
    }
    return 0;
  };
  // How recently a node's latest placed predecessor was placed (higher: more recent).
  const recency = (n: number) => Math.max(-1, ...[...preds[n]].map((p) => done.get(p) ?? -1));
  while (order.length < count) {
    const left = [...Array(count).keys()].filter((n) => !done.has(n));
    let ready = left.filter((n) => [...preds[n]].every((p) => done.has(p)));
    if (ready.length === 0) {
      // A loop: take up where the story already reaches, else anywhere.
      const reached = left.filter((n) => [...preds[n]].some((p) => done.has(p)));
      ready = reached.length > 0 ? reached : left;
    }
    ready.sort((a, b) => recency(b) - recency(a) || cmp(rank(a), rank(b)));
    done.set(ready[0], order.length);
    order.push(ready[0]);
  }
  return order;
}

/** The suggested order of the files that have scenes, and of the scenes in each. */
export function suggest(view: ReadView): StoryFile[] {
  const files = view.script.files
    .map((f, i) => ({ file: i, path: f.path, labels: f.sections.flatMap((s) => s.labels) }))
    .filter((f) => f.labels.length > 0);
  const index = new Map(files.map((f, i) => [f.file, i]));
  const fileOf = (key: string) => Number(key.slice(0, key.indexOf(":")));
  const labelOf = (key: string) => key.slice(key.indexOf(":") + 1);

  // Places in the project file's order: a file's earliest place.
  const placeRank = new Map<string, number>();
  view.places.forEach((p, i) => p.files.forEach((f) => placeRank.has(f) || placeRank.set(f, i)));
  const entries = new Set(view.flow.entries.map(fileOf));
  const edges = view.flow.edges.filter((e) => e.kind !== "return");

  const fileEdges: Array<[number, number]> = [];
  for (const e of edges) {
    const a = index.get(fileOf(e.from));
    const b = index.get(fileOf(e.to));
    if (a !== undefined && b !== undefined && a !== b) fileEdges.push([a, b]);
  }
  const startOf = (path: string) => START.test(normalize(path.slice(path.lastIndexOf("/") + 1)));
  const rank = (i: number) => {
    const f = files[i];
    return [startOf(f.path) ? 0 : 1, numberIn(f.path) ?? 1e9, placeRank.get(f.path) ?? 1e9, entries.has(f.file) ? 0 : 1, f.file];
  };
  const order = thread(files.length, fileEdges, rank);

  const placed = new Set<number>();
  return order.map((i) => {
    const f = files[i];
    // The file it follows: one placed before that leads into it, the strongest way first.
    const into = edges
      .filter((e) => fileOf(e.to) === f.file && fileOf(e.from) !== f.file && placed.has(index.get(fileOf(e.from)) ?? -1))
      .sort((a, b) => Number(!STRONG.includes(a.kind)) - Number(!STRONG.includes(b.kind)));
    placed.add(i);
    const n = numberIn(f.path);
    const reason: Reason = startOf(f.path)
      ? { kind: "start" }
      : into.length > 0
        ? { kind: "after", file: view.script.files[fileOf(into[0].from)].path, how: into[0].kind }
        : n !== null
          ? { kind: "numbered", n }
          : entries.has(f.file)
            ? { kind: "entry" }
            : { kind: "rest" };

    // The scenes: as the story moves between them in the file, else as written.
    const ids = new Map(f.labels.map((l, k) => [l.id, k]));
    const inner: Array<[number, number]> = [];
    for (const e of edges) {
      if (fileOf(e.from) !== f.file || fileOf(e.to) !== f.file) continue;
      const a = ids.get(labelOf(e.from));
      const b = ids.get(labelOf(e.to));
      if (a !== undefined && b !== undefined) inner.push([a, b]);
    }
    const labels = thread(f.labels.length, inner, (k) => [k]).map((k) => f.labels[k]);
    return { file: f.file, path: f.path, labels, reason };
  });
}

/** The suggestion, rearranged as the writer ordered it (by path). Files the writer has not
 *  placed (new ones) keep their suggested place relative to the file before them. */
export function arrange(suggested: StoryFile[], saved: string[] | null): StoryFile[] {
  if (!saved || saved.length === 0) return suggested;
  const byPath = new Map(suggested.map((f) => [f.path, f]));
  const out = saved.map((p) => byPath.get(p)).filter((f): f is StoryFile => !!f);
  const placed = new Set(out.map((f) => f.path));
  suggested.forEach((f, i) => {
    if (placed.has(f.path)) return;
    const before = suggested.slice(0, i).reverse().find((g) => placed.has(g.path));
    const at = before ? out.findIndex((g) => g.path === before.path) + 1 : 0;
    out.splice(at, 0, f);
    placed.add(f.path);
  });
  return out;
}

/** Where the writer's order of a project is kept (in this app only). */
export const orderKey = (project: string) => `easyscript:story-order:${project}`;

export function loadOrder(project: string): string[] | null {
  try {
    const saved = localStorage.getItem(orderKey(project));
    return saved ? (JSON.parse(saved) as string[]) : null;
  } catch {
    return null;
  }
}

export function saveOrder(project: string, order: string[] | null) {
  try {
    if (order) localStorage.setItem(orderKey(project), JSON.stringify(order));
    else localStorage.removeItem(orderKey(project));
  } catch {
    // Not remembered; it still shows until the app closes.
  }
}
