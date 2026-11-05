import { describe, expect, it } from "vitest";
import type { Label } from "./bindings/Label";
import type { Node } from "./bindings/Node";
import type { ReadView } from "./bindings/ReadView";
import { type VoiceLine, isAudioName, match, voiceLines } from "./voice.svelte";

let at = 0;
const say = (speaker: string | null, text: string, tags: Array<[string, string]> = [], id: string | null = null): Node => ({
  span: { file: 0, start: at++, end: 0 },
  notes: [],
  marks: [],
  type: "line",
  speaker,
  text: [{ type: "text", text }],
  words: text,
  tags: tags.map(([name, value]) => ({ name, value, span: { file: 0, start: 0, end: 0 } })),
  jump: null,
  id,
  concurrent: false,
});
const label = (id: string, body: Node[]): Label => ({ id, span: { file: 0, start: 0, end: 0 }, place: null, notes: [], marks: [], body });
const view = {
  script: { files: [{ path: "a.dialogue" }] },
  tags: [{ name: "dub", kind: "asset", values: [], path: "audio/{value}.*", show: "sound", description: null, available: [] }],
} as unknown as ReadView;

describe("voice-over", () => {
  const labels = [
    label("cavalo_intro", [say("Cavalo", "Olá, detetive. Tudo bem?"), say("Detetive", "Quem é você?"), say("Cavalo", "Ninguém.", [["dub", "old"]])]),
    label("bar", [say("Cavalo", "Mais um café.", [], "CAFE_1"), say("Garçom", "Saindo!")]),
  ];
  const lines: VoiceLine[] = voiceLines(view, labels);

  it("lists lines with their recordings and places", () => {
    expect(lines.map((l) => [l.label, l.nth, l.speaker, l.nthBySpeaker, l.value])).toEqual([
      ["cavalo_intro", 1, "Cavalo", 1, null],
      ["cavalo_intro", 2, "Detetive", 1, null],
      ["cavalo_intro", 3, "Cavalo", 2, "old"],
      ["bar", 1, "Cavalo", 3, null],
      ["bar", 2, "Garçom", 1, null],
    ]);
  });

  it("matches recordings by ID, label and number, speaker and number, and words", () => {
    const got = match(["cafe_1", "Cavalo_Intro_02", "garcom_1", "ola_detetive_tudo_bem", "cavalo_intro_03", "nothing"], lines);
    const at = (key: string) => lines.find((l) => l.key === key)!;
    expect(got.map((p) => [p.value, at(p.key).text, p.why])).toEqual([
      ["cafe_1", "Mais um café.", "id"],
      ["Cavalo_Intro_02", "Quem é você?", "label"],
      ["garcom_1", "Saindo!", "speaker"],
      ["ola_detetive_tudo_bem", "Olá, detetive. Tudo bem?", "text"],
    ]);
  });

  it("knows sound files", () => {
    expect(isAudioName("x.OGG")).toBe(true);
    expect(isAudioName("x.flac")).toBe(true);
    expect(isAudioName("x.png")).toBe(false);
  });
});
