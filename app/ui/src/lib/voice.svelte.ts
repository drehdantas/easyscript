// Voice-over (dubbing): the tag that names a line's recording, playing recordings, and
// finding which recording goes with which line.

import { invoke, isTauri } from "@tauri-apps/api/core";
import type { Label } from "./bindings/Label";
import type { Node } from "./bindings/Node";
import type { ReadView } from "./bindings/ReadView";
import type { Tag } from "./bindings/Tag";
import type { TagView } from "./bindings/TagView";
import { walk } from "./model";
import { normalize } from "./text";

/** Sounds the app brings in: Ogg, MP3 and WAV as they are; the others become WAV. */
export const AUDIO_EXTENSIONS = ["ogg", "mp3", "wav", "flac", "m4a", "aac", "aif", "aiff", "caf", "mp4", "oga"];

export const isAudioName = (name: string) => AUDIO_EXTENSIONS.includes(name.slice(name.lastIndexOf(".") + 1).toLowerCase());

/** The tag naming a line's recording: an asset tag shown as `sound`. */
export function soundTag(view: ReadView): TagView | undefined {
  return view.tags.find((t) => t.kind === "asset" && t.show === "sound" && t.path);
}

/** The recording a line's tags name, if any. */
export function soundOf(view: ReadView, tags: Tag[]): string | null {
  const spec = soundTag(view);
  return (spec && tags.find((t) => t.name === spec.name)?.value) || null;
}

/** Plays one recording at a time; recordings are read from the project once. */
class Player {
  /** The recording playing, as its path pattern filled in. */
  playing: string | null = $state(null);
  #cache = new Map<string, string | null>();
  #audio: HTMLAudioElement | null = null;

  available = isTauri();

  async data(path: string): Promise<string | null> {
    if (!this.#cache.has(path)) {
      try {
        this.#cache.set(path, await invoke<string | null>("asset_data", { path }));
      } catch {
        this.#cache.set(path, null);
      }
    }
    return this.#cache.get(path) ?? null;
  }

  /** Forget what was read (files were added or replaced). */
  forget() {
    this.#cache.clear();
  }

  /** Play `value`'s recording for the sound tag; resolves false when there is none. */
  async play(spec: TagView | undefined, value: string | null): Promise<boolean> {
    this.stop();
    if (!spec?.path || !value || !this.available) return false;
    const path = spec.path.replace("{value}", value);
    const uri = await this.data(path);
    if (!uri) return false;
    const audio = new Audio(uri);
    this.#audio = audio;
    this.playing = path;
    audio.onended = () => {
      if (this.#audio === audio) this.playing = null;
    };
    try {
      await audio.play();
      return true;
    } catch {
      this.playing = null;
      return false;
    }
  }

  stop() {
    this.#audio?.pause();
    this.#audio = null;
    this.playing = null;
  }

  isPlaying(spec: TagView | undefined, value: string | null): boolean {
    return !!spec?.path && !!value && this.playing === spec.path.replace("{value}", value);
  }
}

export const player = new Player();

/** A line that can take a recording. */
export type VoiceLine = {
  /** `file:at`, where the line starts. */
  key: string;
  file: number;
  path: string;
  at: number;
  label: string;
  speaker: string | null;
  text: string;
  id: string | null;
  /** Its recording, if tagged. */
  value: string | null;
  /** Its place among the label's lines (1-based), and among its speaker's (in order). */
  nth: number;
  nthBySpeaker: number;
};

/** The lines of the labels given (in that order), with their recordings. */
export function voiceLines(view: ReadView, labels: Label[]): VoiceLine[] {
  const spec = soundTag(view);
  const out: VoiceLine[] = [];
  const bySpeaker = new Map<string, number>();
  for (const label of labels) {
    let nth = 0;
    const lines: Node[] = [];
    for (const node of walk(label.body)) if (node.type === "line") lines.push(node);
    for (const node of lines) {
      if (node.type !== "line") continue;
      nth++;
      const speaker = node.speaker;
      const who = speaker ?? "";
      bySpeaker.set(who, (bySpeaker.get(who) ?? 0) + 1);
      out.push({
        key: `${node.span.file}:${node.span.start}`,
        file: node.span.file,
        path: view.script.files[node.span.file].path,
        at: node.span.start,
        label: label.id,
        speaker,
        text: node.words,
        id: node.id,
        value: (spec && node.tags.find((t) => t.name === spec.name)?.value) || null,
        nth,
        nthBySpeaker: bySpeaker.get(who)!,
      });
    }
  }
  return out;
}

/** Letters and digits only, lowercase, no accents: `Cavalo_Intro` → `cavalointro`. */
const squash = (s: string) => normalize(s).replace(/[^a-z0-9]/g, "");
const words = (s: string) => normalize(s).split(/[^a-z0-9]+/).filter(Boolean);

export type Proposal = { value: string; key: string; why: "id" | "label" | "speaker" | "text" };

/**
 * Which line each recording goes with, by its name: a line's ID (`[ID:x]`), a label and
 * the line's place in it (`cavalo_intro_03`), a speaker and their line's place in the
 * story (`Cavalo_12`), or the line's first words (`ola_detetive_tudo_bem`). Lines that
 * have a recording are left alone; each line takes one at most.
 */
export function match(values: string[], lines: VoiceLine[]): Proposal[] {
  const free = lines.filter((l) => !l.value);
  const taken = new Set<string>();
  const out: Proposal[] = [];
  const take = (value: string, line: VoiceLine | undefined, why: Proposal["why"]) => {
    if (!line || taken.has(line.key)) return false;
    taken.add(line.key);
    out.push({ value, key: line.key, why });
    return true;
  };
  for (const value of values) {
    const v = squash(value);
    if (v && take(value, free.find((l) => l.id && squash(l.id) === v), "id")) continue;
    // A name and a number: `cavalo_intro_03`, `Cavalo 12 - medo`.
    const tokens = value.split(/[_\-\s.]+/).filter(Boolean);
    const k = tokens.findIndex((t) => /^\d+$/.test(t));
    if (k > 0) {
      const prefix = squash(tokens.slice(0, k).join(""));
      const n = Number(tokens[k]);
      if (take(value, free.find((l) => squash(l.label) === prefix && l.nth === n), "label")) continue;
      if (take(value, free.find((l) => l.speaker && squash(l.speaker) === prefix && l.nthBySpeaker === n), "speaker")) continue;
    }
    // The line's words: three or more, in order, at its start.
    const w = words(value).filter((x) => !/^\d+$/.test(x));
    if (w.length >= 3) {
      const found = free.filter((l) => !taken.has(l.key) && words(l.text).slice(0, w.length).join(" ") === w.join(" "));
      if (found.length === 1) take(value, found[0], "text");
    }
  }
  return out;
}
