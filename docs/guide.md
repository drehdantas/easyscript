# Using easyscript

## Opening a game

Open a game project's folder (the one with `project.godot`), or **Open from GitHub** (sign in, pick one of your repositories, and the app clones it into a folder and opens it). It reads the dialogue files where they are, follows them as they change on disk, and writes only the files you change, when you save. The bar at the top switches between four views:

- **Write**: the scenes (labels) place by place, or in **Story order**, searchable; the scene as line cards, each with the speaker's face, how it is said (voice, thought, shake, face) and its words. Click a line to change it, with a preview of the balloon. Its tags are under **Tags**: switch them, change their values, remove them, or **+ Tag** to add one the script already uses or a new one (which the game's dialogue code then has to learn). Add lines, choices and jumps to other scenes; move or remove them; edit `if` and `when` conditions with the project's flags at hand; add and remove scenes. Beside it, **Play** runs the script as the game would, from the scene or one you choose: lines one at a time, choices to pick, flags and variables tracked. What only the game knows (its own functions) it asks once and remembers, and a variant's question is asked by its sides' names. With voice-over set up, each line's recording plays as the line shows (**Voices** turns it off), and ▶ beside a line plays it again.
  - **Story order** lists the dialogue files in the order a player meets them, numbered, each with its scenes in the order they play and a line saying why it is there. The order is a suggestion worked out from how the story moves: a file whose name says it opens the story (`intro`, `inicio`, `prologo`, `abertura`, `tutorial`…) first; then the files the one before jumps to (through `import … as` and `=> alias/scene`), leads to by a choice, or sets a flag for; then numbers in file names (`02_bar`, `cap3`); then the project file's places. **Rearrange** moves files up and down; **Back to the suggestion** forgets your order. It is kept in the app on this computer, and only the list follows it: no file changes, and exports are the same.
- **Read**: the whole script as one document, with its documents, a flags index, who talks and the problems; searchable, filtered by the project's variants.
- **Map**: the scenes place by place and the links between them, with a key beside it that says what each kind of link is (goes to, a choice leads to, only if, visits and comes back, runs on into, sets a flag read by) and lets you hide it. Click a scene to see where it comes from and where it goes, then write it or play it. Also: who speaks where, and which flags each place sets and reads.
- **Voice-over**: which recording each line plays, line by line in the story's order, with how many lines have one, the recordings no line uses yet, and the lines that name a file that is not there. The first time, **Set up voice-over** adds a tag for it to the project file (`dublagem` in Portuguese, `dub` in English; its files in `audio/dublagem/` or `audio/dub/`, in any format). Then:
  - **Bring in recordings…** copies sound files into that folder: Ogg, MP3 and WAV as they are, FLAC, M4A/AAC, AIFF and CAF converted to WAV (what Godot plays). A file's name is its tag value. A Google Drive link (a file, or a folder and the folders in it, shared with anyone with the link) brings them from there. Files there already are skipped, or replaced if you ask.
  - The app then matches the new recordings to lines by their names and lists what it found to tick and **Tag** at once: a line's `[ID:…]` (`CAFE_1`), a scene and the line's number in it (`cavalo_intro_03`), a speaker and their line's number in the story (`Cavalo_12`), or the line's first words (`ola_detetive_tudo_bem`). Lines that have a recording keep it.
  - Each line has ▶ to listen, **Add** or **Change** to pick one of the project's recordings (searchable, the unused ones first), **File…** to bring a file in for that line alone (named after its scene and number, `docas_03`), and ✕ to take the recording off the line (the file stays). Filter the lines by those with or without a recording, a missing file, a speaker, or words.
  - A line's recording is a tag on it, `Cavalo: Olá! [#dublagem=cavalo_intro_01]`: edited, undone and saved like any other change, shown on the line in Write (▶ plays it), and in the line editor under **Voice-over**. The game can read the tag to play the same file.
- **Project**: the project file's builders, a tab each: characters (a portrait picked with **Browse…**), tags (a face tag's folder picked from one of its files), flags, places, variants; or, for a project with none, a draft from the dialogue.

A game with no dialogue yet starts with its first file and scene. **+ File**, under the scene list, makes another dialogue file (a place, a character, a chapter); when the project file lists places, it can be a place of its own. The **+** beside a place adds a scene at its end, **+ Scene** after the scene open. The scene list and the Play panel are as wide as you drag their edges. A game with no project file (`easyscript.toml`) works too: the app guesses who speaks from the lines, and **Set it up** drafts a project file from the dialogue for the Project tab.

## Saving

Edits stay in the app until **Save**: the bar says what is not saved, and shows the change to each file before saving. When a file changes on disk under unsaved edits (the Godot editor saved it, the team's changes came in), the two are merged if they touch different lines; if they touch the same lines, nothing is written over: the bar says **Changed on disk: settle it**, and you keep your edits or take the version on disk, after seeing both. Undo and redo with Ctrl+Z and Ctrl+Shift+Z; save with Ctrl+S.

## Working with the team

**Work with the team** (the branch in the bar) is git, told by scene. Every few minutes the app asks `origin` what is new (a fetch: nothing of yours leaves, nothing changes; Settings turns it off). The bar shows ↓ for the team's changes your copy does not have and ↑ for your commits not sent; the scene list marks scenes changed on `origin` (↓), being changed on a teammate's branch (●), and changed since you last looked (•), and a scene says who changed it and how, before you write in it.

- **New from the team**: the commits, who made them, when, and the scenes they changed. **Bring them in** fast-forwards, or merges when you have commits of your own; your changes, committed, saved or not, are kept with the team's. Where you and the team changed the same lines, nothing changes and you are told which files.
- **Your work**: the scenes changed since the last commit; commit the project's own files (dialogue, project file, documents) as saved, and nothing else (what the team staged by hand stays staged), with a message written for you if you leave it empty. **Send** pushes the branch (never forced): on the branch the team shares, the team gets your commits the next time their app checks; on a branch of your own, with GitHub signed in, it also opens the pull request, or finds the one open.
- **Since you last looked** and **Teammates are working on**: what came in while you were away, and other branches on `origin` with the scenes they change.
- **Branch** and **GitHub**: make and switch branches; sign in to GitHub, link a repository with no `origin`.

The app checks and sends over SSH with your agent, or over HTTPS with the GitHub sign-in. **Sign in to GitHub** shows a code; GitHub, in your browser, asks you to authorize easyscript and to enter it (GitHub's device flow: no password reaches the app). The app keeps the sign-in in the system's password store (Keychain, Credential Manager, Secret Service), or only until it closes when there is none; revoke it any time in GitHub's settings under Applications. A folder that is not in git has nowhere to send: open the game from GitHub instead. Conflicts git stopped on are shown, never resolved. See [how writers use it](ux.md) for how a writer starts, catches up and works beside others.

## Export and import

**Export** has the dialogue files for the game first: each file's status and a look at it, saved in place, or as a ZIP that keeps the game's folders (it unzips over the project). Then the script for others: Dialogue Manager's translation table (exporting over a table keeps its translations), voice scripts and recording sheets by character and mood, a Fountain screenplay, and JSON for other tools (a documented format). **Import** turns a Twine (`.twee`), Yarn Spinner (`.yarn`) or Ink (`.ink`) script, or a `.dialogue` file from elsewhere, into a new file in the project, after showing it and what did not convert. See [the formats](formats/README.md).

## Settings

The app's language (English or Portuguese (Brazil); it follows the system's), light or dark (or like the system), and what the script shows. Voice scripts, recording sheets and screenplays are written with their own words (headings, stage directions) in the app's language (`--language pt-BR` on the command line). The command line and import warnings are in English for now.

## The command line

```sh
easyscript check path/to/game     # problems, compiler style; exit 1 on errors
easyscript stats path/to/game     # labels, lines, choices, speakers, tags
easyscript build path/to/game -o script.html   # the app's read view as one offline page
easyscript init path/to/game      # a first easyscript.toml, drafted from the dialogue
easyscript export translation path/to/game -o translations.csv --translate-to pt_BR
easyscript export zip path/to/game -o dialogue.zip   # the dialogue files themselves
easyscript import story.ink -o path/to/game/dialogue/story.dialogue
```

All read `easyscript.toml` at the game's root, or the file given with `--config`. See [the project file](project-file.md).
