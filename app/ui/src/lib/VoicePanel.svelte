<script lang="ts">
  // Voice-over: which recording each line plays, in the story's order. Bring recordings in
  // (files in any common format, a Google Drive file or folder), let the app match them to
  // lines by their names, then add, change or remove a line's recording. A line's
  // recording is a tag on it (`[#dub=cavalo_intro_01]`), so the game can play it too.
  import { invoke } from "@tauri-apps/api/core";
  import { listen } from "@tauri-apps/api/event";
  import { open } from "@tauri-apps/plugin-dialog";
  import { onMount } from "svelte";
  import { projects } from "./app.svelte";
  import type { Edit } from "./bindings/Edit";
  import type { Session } from "./bindings/Session";
  import { useEditor } from "./editor.svelte";
  import { locale, plural, t } from "./i18n.svelte";
  import { fileName } from "./model";
  import { useReader } from "./reader.svelte";
  import { arrange, loadOrder, suggest } from "./story";
  import { normalize } from "./text";
  import { AUDIO_EXTENSIONS, type Proposal, type VoiceLine, isAudioName, match, player, soundTag, voiceLines } from "./voice.svelte";

  const reader = useReader();
  const editor = useEditor()!;

  const spec = $derived(soundTag(reader.view));
  // The story's order, as the scene list shows it.
  const story = $derived(arrange(suggest(reader.view), loadOrder(projects.current ?? reader.view.title)));
  const lines = $derived(voiceLines(reader.view, story.flatMap((f) => f.labels)));
  const available = $derived(new Set(spec?.available ?? []));
  const used = $derived(new Set(lines.map((l) => l.value).filter((v): v is string => !!v)));
  const unused = $derived((spec?.available ?? []).filter((v) => !used.has(v)));
  const voiced = $derived(lines.filter((l) => l.value).length);
  const missing = $derived(lines.filter((l) => l.value && !available.has(l.value)).length);

  // Setting up: the tag and where its files go.
  const pt = locale.language === "pt-BR";
  let tagName = $state(pt ? "dublagem" : "dub");
  let folder = $state(pt ? "audio/dublagem" : "audio/dub");
  const validTag = $derived(/^[A-Za-z_][A-Za-z0-9_]*$/.test(tagName.trim()) && !reader.view.tags.some((s) => s.name === tagName.trim()));
  async function setUp() {
    if (!editor.state.has_project_file && !(await editor.draftProject())) return;
    const dir = folder.trim().replace(/^\/+|\/+$/g, "") || "audio";
    await editor.editProject([
      {
        op: "set_tag",
        name: tagName.trim(),
        kind: "asset",
        values: [],
        path: `${dir}/{value}.*`,
        show: "sound",
        description: t("The line's voice-over recording."),
      },
    ]);
  }

  // Filters.
  type Show = "all" | "without" | "with" | "missing";
  let show: Show = $state("all");
  let speaker = $state("");
  let query = $state("");
  const q = $derived(normalize(query.trim()));
  const speakers = $derived([...new Set(lines.map((l) => l.speaker ?? ""))].sort());
  const shown = $derived(
    lines.filter(
      (l) =>
        (show === "all" || (show === "without" && !l.value) || (show === "with" && l.value) || (show === "missing" && l.value && !available.has(l.value))) &&
        (!speaker || (l.speaker ?? "") === speaker) &&
        (q.length < 2 || normalize(`${l.speaker ?? ""} ${l.text} ${l.label} ${l.value ?? ""}`).includes(q)),
    ),
  );
  const LIMIT = 400;
  let limit = $state(LIMIT);
  // Lines shown, under their file and scene.
  const rows = $derived(shown.slice(0, limit));

  // Changing a line's recording: one edit, undone like any other.
  async function setValue(line: VoiceLine, value: string | null) {
    if (!spec) return;
    const edit: Edit = value ? { op: "set_tag", at: line.at, name: spec.name, value } : { op: "remove_tag", at: line.at, name: spec.name };
    await editor.edit(line.path, [edit]);
    picking = null;
  }

  // Picking a recording for a line from those in the project.
  let picking: string | null = $state(null);
  let pickQuery = $state("");
  const pickList = $derived.by(() => {
    const pq = normalize(pickQuery.trim());
    const all = [...unused.map((v) => ({ v, free: true })), ...[...used].filter((v) => available.has(v)).sort().map((v) => ({ v, free: false }))];
    return all.filter((x) => !pq || normalize(x.v).includes(pq)).slice(0, 60);
  });

  // Bringing recordings in.
  let progress: { at: number; total: number; name: string } | null = $state(null);
  let report: { added: number; skipped: string[]; failed: [string, string][] } | null = $state(null);
  let proposals: (Proposal & { on: boolean })[] = $state([]);
  const chosen = $derived(proposals.filter((p) => p.on).length);
  let lastSources: string[] = $state([]);
  let driveLink = $state("");
  let driveFiles: { id: string; name: string; folder: string }[] | null = $state(null);
  let working = $state(false);
  let failure: string | null = $state(null);

  onMount(() => {
    const stop = listen<[number, number, string]>("asset-progress", (e) => {
      const [at, total, name] = e.payload;
      progress = at >= total ? null : { at, total, name };
    });
    return () => {
      stop.then((f) => f());
      player.stop();
    };
  });

  type Brought = { session: Session; added: [string, string][]; skipped: string[]; failed: [string, string][] };
  async function bring(call: () => Promise<Brought>) {
    working = true;
    failure = null;
    try {
      const result = await call();
      editor.receive(result.session);
      player.forget();
      report = { added: result.added.length, skipped: result.skipped, failed: result.failed };
      const values = result.added.map(([, value]) => value);
      // The view has the new files now; match the recordings just brought to lines.
      proposals = match(values, voiceLines(result.session.view, story.flatMap((f) => f.labels))).map((p) => ({ ...p, on: true }));
    } catch (e) {
      failure = String(e);
    } finally {
      working = false;
      progress = null;
    }
  }

  async function importFiles(replace = false, sources?: string[]) {
    if (!spec) return;
    if (!sources) {
      const chosen = await open({ title: t("Voice-over recordings"), multiple: true, directory: false, filters: [{ name: t("Sounds"), extensions: AUDIO_EXTENSIONS }] });
      if (!chosen) return;
      sources = Array.isArray(chosen) ? chosen : [chosen];
    }
    lastSources = sources;
    const from = sources;
    await bring(() => invoke<Brought>("import_assets", { tag: spec.name, sources: from, replace }));
  }

  async function replaceSkipped() {
    if (!report) return;
    const skipped = new Set(report.skipped);
    const again = lastSources.filter((s) => skipped.has(s.split(/[\\/]/).pop() ?? ""));
    if (again.length > 0) await importFiles(true, again);
  }

  async function fromDrive() {
    if (!spec || !driveLink.trim()) return;
    failure = null;
    if (driveLink.includes("/folders/")) {
      working = true;
      try {
        const files = await invoke<{ id: string; name: string; folder: string }[]>("drive_folder", { url: driveLink.trim() });
        driveFiles = files.filter((f) => isAudioName(f.name));
        if (driveFiles.length === 0) failure = t("No sounds in that folder.");
      } catch (e) {
        failure = String(e);
      } finally {
        working = false;
      }
    } else {
      await bring(() => invoke<Brought>("download_asset", { tag: spec.name, value: null, url: driveLink.trim(), replace: false }));
    }
  }

  async function bringDrive() {
    if (!spec || !driveFiles) return;
    const files = driveFiles.map((f) => ({ id: f.id, name: f.name, value: null }));
    driveFiles = null;
    await bring(() => invoke<Brought>("import_drive_assets", { tag: spec.name, files, replace: false }));
  }

  const lineAt = (key: string) => lines.find((l) => l.key === key);
  async function applyProposals() {
    if (!spec) return;
    const picked = proposals.filter((p) => p.on);
    // One step per file; from the end of the file, so earlier places stay put.
    const byFile = new Map<string, Extract<Edit, { op: "set_tag" }>[]>();
    for (const p of picked) {
      const line = lineAt(p.key);
      if (!line) continue;
      const edits = byFile.get(line.path) ?? [];
      edits.push({ op: "set_tag", at: line.at, name: spec.name, value: p.value });
      byFile.set(line.path, edits);
    }
    for (const [path, edits] of byFile) {
      edits.sort((a, b) => b.at - a.at);
      if ((await editor.edit(path, edits)) === null) return;
    }
    proposals = [];
    report = null;
  }

  // A recording for one line, from a file: named after its scene and place in it.
  async function uploadFor(line: VoiceLine) {
    if (!spec) return;
    const chosen = await open({ title: t("A recording for this line"), multiple: false, directory: false, filters: [{ name: t("Sounds"), extensions: AUDIO_EXTENSIONS }] });
    if (typeof chosen !== "string") return;
    let value = line.value;
    let replace = true;
    if (!value) {
      const base = `${line.label}_${String(line.nth).padStart(2, "0")}`;
      value = base;
      for (let i = 2; available.has(value) || used.has(value); i++) value = `${base}_${i}`;
      replace = false;
    }
    working = true;
    failure = null;
    try {
      const session = await invoke<Session>("add_asset", { tag: spec.name, value, source: chosen, replace });
      editor.receive(session);
      player.forget();
      if (line.value !== value) await setValue(line, value);
    } catch (e) {
      failure = String(e);
    } finally {
      working = false;
    }
  }

  function playLine(line: VoiceLine) {
    if (player.isPlaying(spec, line.value)) player.stop();
    else player.play(spec, line.value);
  }

  const whyText = (why: Proposal["why"]) =>
    ({ id: t("its ID"), label: t("scene and number"), speaker: t("speaker and number"), text: t("its first words") })[why];

  function goTo(line: VoiceLine) {
    reader.scene = line.label;
    reader.tab = "write";
  }
</script>

<div class="voice-panel">
  {#if !spec}
    <section class="sec">
      <h2>{t("Voice-over")}</h2>
      <p class="lede">{t("Give each line its recording. A line's recording is a tag on it, so the game can play it too; the Play panel plays it as the line shows.")}</p>
      <div class="voice-setup">
        <label class="field"><span class="k">{t("Tag on the lines")}</span>
          <input bind:value={tagName} spellcheck="false" />
        </label>
        <label class="field"><span class="k">{t("Folder for the recordings")}</span>
          <input bind:value={folder} spellcheck="false" />
        </label>
        <p class="hint">{t("Lines will read like {example}. The recordings go in {folder}, as Ogg, MP3 or WAV (other formats become WAV).", { example: `Cavalo: Olá! [#${tagName.trim() || "dub"}=cavalo_intro_01]`, folder: folder.trim() || "audio" })}</p>
        {#if !editor.state.has_project_file}<p class="hint">{t("This project has no project file yet: one is drafted from the dialogue, to save with the rest.")}</p>{/if}
        <button class="btn primary" type="button" onclick={setUp} disabled={!validTag || editor.busy}>{t("Set up voice-over")}</button>
        {#if editor.error}<p class="error">{editor.error}</p>{/if}
      </div>
    </section>
  {:else}
    <section class="voice-head">
      <div>
        <h2>{t("Voice-over")}</h2>
        <p class="hint">
          {t("{voiced} of {total} lines have a recording", { voiced, total: lines.length })}
          · {plural(unused.length, "{n} recording not used yet", "{n} recordings not used yet")}
          {#if missing > 0}· <span class="warn">{plural(missing, "{n} line names a missing file", "{n} lines name a missing file")}</span>{/if}
          · <code>[#{spec.name}=…]</code> → <code>{spec.path}</code>
        </p>
      </div>
      <div class="voice-bring">
        <button class="btn primary" type="button" onclick={() => importFiles()} disabled={working}>{t("Bring in recordings…")}</button>
        <form class="drive" onsubmit={(e) => { e.preventDefault(); fromDrive(); }}>
          <input type="url" bind:value={driveLink} placeholder={t("Google Drive link: a file or a folder")} spellcheck="false" />
          <button class="btn" type="submit" disabled={working || !driveLink.trim()}>{t("Bring from Drive")}</button>
        </form>
        <p class="hint">{t("Ogg, MP3 and WAV are kept as they are; FLAC, M4A, AAC, AIFF and CAF become WAV. The file's name is the tag's value. Drive files must be shared with anyone with the link.")}</p>
      </div>
    </section>

    {#if progress}<p class="voice-progress">{t("Bringing {name} ({at} of {total})…", { name: progress.name, at: progress.at + 1, total: progress.total })}</p>{/if}
    {#if failure}<p class="error">{failure}</p>{/if}

    {#if driveFiles}
      <section class="voice-review">
        <p>{plural(driveFiles.length, "{n} sound in the folder.", "{n} sounds in the folder.")}</p>
        <ul class="drive-list">{#each driveFiles.slice(0, 12) as f (f.id)}<li>{f.folder ? `${f.folder}/` : ""}{f.name}</li>{/each}{#if driveFiles.length > 12}<li>…</li>{/if}</ul>
        <div class="le-row">
          <button class="btn primary" type="button" onclick={bringDrive}>{t("Bring them in")}</button>
          <button class="btn" type="button" onclick={() => (driveFiles = null)}>{t("Cancel")}</button>
        </div>
      </section>
    {/if}

    {#if report}
      <section class="voice-review">
        <p>
          {plural(report.added, "{n} recording brought in.", "{n} recordings brought in.")}
          {#if report.skipped.length > 0}
            {plural(report.skipped.length, "{n} was there already.", "{n} were there already.")}
            {#if lastSources.length > 0}<button type="button" class="link" onclick={replaceSkipped}>{t("Replace them")}</button>{/if}
          {/if}
          <button type="button" class="link" onclick={() => (report = null)}>{t("Dismiss")}</button>
        </p>
        {#each report.failed as [name, why] (name)}<p class="error">{name}: {why}</p>{/each}
        {#if proposals.length > 0}
          <p class="k">{t("Matched to lines by their names")}</p>
          <ul class="proposals">
            {#each proposals as p (p.value)}
              {@const line = lineAt(p.key)}
              {#if line}
                <li>
                  <label class="tog"><input type="checkbox" bind:checked={p.on} /> <code>{p.value}</code></label>
                  <span class="arrow">→</span>
                  <span class="who">{line.speaker ?? t("narration")}</span>
                  <span class="text">{line.text}</span>
                  <span class="hint">{line.label} · {t("by {how}", { how: whyText(p.why) })}</span>
                </li>
              {/if}
            {/each}
          </ul>
          <div class="le-row">
            <button class="btn primary" type="button" onclick={applyProposals} disabled={editor.busy || chosen === 0}>
              {plural(chosen, "Tag {n} line", "Tag {n} lines")}
            </button>
            <button class="btn" type="button" onclick={() => (proposals = [])}>{t("Not now")}</button>
          </div>
        {:else if report.added > 0}
          <p class="hint">{t("No line matched their names: pick a recording for each line below.")}</p>
        {/if}
      </section>
    {/if}

    <div class="voice-filters">
      <div class="seg" role="group" aria-label={t("Lines")}>
        <button type="button" aria-pressed={show === "all"} onclick={() => (show = "all")}>{t("All")}</button>
        <button type="button" aria-pressed={show === "without"} onclick={() => (show = "without")}>{t("Without a recording")}</button>
        <button type="button" aria-pressed={show === "with"} onclick={() => (show = "with")}>{t("With one")}</button>
        <button type="button" aria-pressed={show === "missing"} onclick={() => (show = "missing")}>{t("File missing")}</button>
      </div>
      <select bind:value={speaker} aria-label={t("Speaker")}>
        <option value="">{t("Everyone")}</option>
        {#each speakers as s (s)}<option value={s}>{s || t("narration")}</option>{/each}
      </select>
      <input type="search" bind:value={query} placeholder={t("Find a line…")} aria-label={t("Find a line")} />
      <span class="hint">{plural(shown.length, "{n} line", "{n} lines")}</span>
    </div>

    <ol class="voice-lines">
      {#each rows as line, i (line.key)}
        {@const prev = rows[i - 1]}
        {#if !prev || prev.label !== line.label}
          <li class="voice-scene">
            {#if !prev || prev.path !== line.path}<span class="file">{fileName(line.path)}</span>{/if}
            <button type="button" class="link" onclick={() => goTo(line)} title={t("Write this scene")}>{line.label}</button>
          </li>
        {/if}
        <li class="voice-line" class:none={!line.value} class:missing={line.value && !available.has(line.value)}>
          <span class="n">{line.nth}</span>
          <span class="who">{line.speaker ?? t("narration")}</span>
          <span class="text">{line.text}</span>
          <span class="dub">
            {#if line.value}
              <button type="button" class="play-btn" onclick={() => playLine(line)} disabled={!available.has(line.value)}
                aria-label={player.isPlaying(spec, line.value) ? t("Stop") : t("Play {value}", { value: line.value })}
                title={available.has(line.value) ? t("Play {value}", { value: line.value }) : t("No file for {value} in {path}", { value: line.value, path: spec.path ?? "" })}
              >{player.isPlaying(spec, line.value) ? "■" : "▶"}</button>
              <code class="value">{line.value}</code>
            {:else}
              <span class="hint">{t("no recording")}</span>
            {/if}
            <button type="button" class="btn small" onclick={() => { picking = picking === line.key ? null : line.key; pickQuery = ""; }} aria-expanded={picking === line.key}>{line.value ? t("Change") : t("Add")}</button>
            <button type="button" class="btn small" onclick={() => uploadFor(line)} disabled={working} title={t("Bring a file in for this line")}>{t("File…")}</button>
            {#if line.value}<button type="button" class="link" onclick={() => setValue(line, null)} aria-label={t("Remove the recording")} title={t("Remove the recording from this line (the file stays)")}>✕</button>{/if}
          </span>
          {#if picking === line.key}
            <div class="voice-pick">
              <!-- svelte-ignore a11y_autofocus -->
              <input type="search" bind:value={pickQuery} placeholder={t("Find a recording…")} autofocus />
              {#if pickList.length === 0}<p class="hint">{t("No recordings in the project yet: bring some in above, or a file for this line.")}</p>{/if}
              <ul>
                {#each pickList as x (x.v)}
                  <li>
                    <button type="button" class="play-btn" onclick={() => (player.isPlaying(spec, x.v) ? player.stop() : player.play(spec, x.v))} aria-label={t("Play {value}", { value: x.v })}>{player.isPlaying(spec, x.v) ? "■" : "▶"}</button>
                    <button type="button" class="pick" onclick={() => setValue(line, x.v)}>
                      <code>{x.v}</code>{#if !x.free}<span class="hint"> · {t("used elsewhere")}</span>{/if}
                    </button>
                  </li>
                {/each}
              </ul>
            </div>
          {/if}
        </li>
      {/each}
    </ol>
    {#if shown.length > limit}<button class="btn" type="button" onclick={() => (limit += LIMIT)}>{t("Show more lines")}</button>{/if}
  {/if}
</div>
