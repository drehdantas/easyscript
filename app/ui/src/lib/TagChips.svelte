<script lang="ts">
  // The tags of a line the way the project file says to show them.
  import type { Tag } from "./bindings/Tag";
  import { t } from "./i18n.svelte";
  import { useReader } from "./reader.svelte";
  import { player, soundTag } from "./voice.svelte";

  let { tags }: { tags: Tag[] } = $props();
  const reader = useReader();
  const sound = $derived(soundTag(reader.view));
  function play(e: MouseEvent, value: string | null) {
    // The line's own click opens it for editing; this only plays.
    e.stopPropagation();
    if (player.isPlaying(sound, value)) player.stop();
    else player.play(sound, value);
  }
</script>

{#each tags as tag, i (i)}{@const show = reader.tagSpec(tag.name)?.show}{#if show === "thought"}<span
      class="ttag">{t("thinks")}</span
    >{:else if show === "shake"}<span class="shtag" title={t("Shakes the screen")}>{t("shake")}</span>{:else if show === "voice"}<span
      class="vtag v-{tag.value}"
      title={t("Voice: {mood}", { mood: tag.value ?? "" })}>{tag.value}</span
    >{:else if show === "sound"}{#if player.available}<button
      type="button"
      class="stag"
      onclick={(e) => play(e, tag.value)}
      title={t("Voice-over: {value}", { value: tag.value ?? "" })}>{player.isPlaying(sound, tag.value) ? "■" : "▶"} {tag.value}</button
    >{:else}<span class="stag" title={t("Voice-over: {value}", { value: tag.value ?? "" })}>♪ {tag.value}</span>{/if}{:else if show === "face"}{#if reader.showIds}<span class="tid">{tag.value}</span>{/if}{:else if reader.showIds}<span
      class="tid">{tag.name}{tag.value ? `=${tag.value}` : ""}</span
    >{/if}{/each}
