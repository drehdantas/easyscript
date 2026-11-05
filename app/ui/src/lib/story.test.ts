import { describe, expect, it } from "vitest";
import type { FlowEdge } from "./bindings/FlowEdge";
import type { Label } from "./bindings/Label";
import type { ReadView } from "./bindings/ReadView";
import { arrange, numberIn, suggest, thread } from "./story";

const label = (id: string, file: number): Label => ({ id, span: { file, start: 0, end: 0 }, place: null, notes: [], marks: [], body: [] });

/** A view with files of labels (`{ "a.dialogue": ["x", "y"] }`) and flow edges. */
function view(files: Record<string, string[]>, edges: Array<[string, string, FlowEdge["kind"]?]>, entries: string[] = [], places: string[][] = []): ReadView {
  const paths = Object.keys(files);
  const key = (id: string) => {
    const file = paths.findIndex((p) => files[p].includes(id));
    return `${file}:${id}`;
  };
  return {
    script: {
      files: paths.map((path, i) => ({ path, imports: [], notes: [], preamble: [], sections: [{ title: null, notes: [], labels: files[path].map((id) => label(id, i)) }] })),
    },
    places: places.map((f, i) => ({ id: `p${i}`, name: `p${i}`, group: null, files: f, labels: [], exclude_labels: [] })),
    flow: { edges: edges.map(([from, to, kind]) => ({ from: key(from), to: key(to), kind: kind ?? "jump", flag: null })), entries: entries.map(key) },
  } as unknown as ReadView;
}

describe("story order", () => {
  it("follows jumps and flags between files", () => {
    const v = view(
      { "bar.dialogue": ["bar"], "docks.dialogue": ["docks"], "intro.dialogue": ["intro"], "end.dialogue": ["finale"] },
      [
        ["intro", "docks"],
        ["docks", "bar", "flag"],
        ["bar", "finale", "choice"],
      ],
    );
    const order = suggest(v);
    expect(order.map((f) => f.path)).toEqual(["intro.dialogue", "docks.dialogue", "bar.dialogue", "end.dialogue"]);
    expect(order[0].reason).toEqual({ kind: "start" });
    expect(order[1].reason).toEqual({ kind: "after", file: "intro.dialogue", how: "jump" });
    expect(order[2].reason).toEqual({ kind: "after", file: "docks.dialogue", how: "flag" });
  });

  it("uses numbers in names and places when nothing links files", () => {
    const v = view({ "c.dialogue": ["c"], "ch2.dialogue": ["b"], "ch1.dialogue": ["a"] }, []);
    expect(suggest(v).map((f) => f.path)).toEqual(["ch1.dialogue", "ch2.dialogue", "c.dialogue"]);
    const placed = view({ "x.dialogue": ["x"], "y.dialogue": ["y"] }, [], [], [["y.dialogue"], ["x.dialogue"]]);
    expect(suggest(placed).map((f) => f.path)).toEqual(["y.dialogue", "x.dialogue"]);
  });

  it("follows a thread before starting another", () => {
    const v = view({ "a1.dialogue": ["a"], "a2.dialogue": ["b"], "z.dialogue": ["z"], "zz.dialogue": ["zz"] }, [["a", "zz"]]);
    // a1 leads to zz, so zz comes right after it, before a2 and z.
    expect(suggest(v).map((f) => f.path)).toEqual(["a1.dialogue", "zz.dialogue", "a2.dialogue", "z.dialogue"]);
  });

  it("orders scenes in a file by how they play, and breaks loops", () => {
    const v = view({ "a.dialogue": ["hub", "talk", "start"] }, [
      ["start", "hub", "fall_through"],
      ["hub", "talk", "choice"],
      ["talk", "hub", "jump"],
    ]);
    expect(suggest(v)[0].labels.map((l) => l.id)).toEqual(["start", "hub", "talk"]);
    expect(thread(3, [[0, 1], [1, 2], [2, 0]], (n) => [n])).toEqual([0, 1, 2]);
  });

  it("keeps the writer's order, placing new files after their neighbour", () => {
    const v = view({ "a.dialogue": ["a"], "b.dialogue": ["b"], "c.dialogue": ["c"] }, [
      ["a", "b"],
      ["b", "c"],
    ]);
    const s = suggest(v);
    expect(arrange(s, ["c.dialogue", "a.dialogue"]).map((f) => f.path)).toEqual(["c.dialogue", "a.dialogue", "b.dialogue"]);
    expect(arrange(s, ["gone.dialogue"]).map((f) => f.path)).toEqual(["a.dialogue", "b.dialogue", "c.dialogue"]);
    expect(arrange(s, null)).toBe(s);
  });

  it("reads numbers in names", () => {
    expect(numberIn("dialogue/02_bar.dialogue")).toBe(2);
    expect(numberIn("dialogue/v2/bar.dialogue")).toBe(null);
  });
});
