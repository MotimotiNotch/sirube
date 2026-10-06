# Sirube

[日本語](README.md) | **English**

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/motimotinotch)

> Start from a goal and keep asking "what does that need?" — what you can do today shows up at the ends. Leave it for six months, and the path is still there.

A task manager for long-running projects that **holds up when you stop and come back**.

The name comes from the Japanese word *shirube* (道しるべ), "signpost", written in Kunrei-style romanization.

---

## What's different

Most task managers have you **attach dependencies afterwards to tasks that already exist**. Sirube works the other way round: **you start from a goal and recursively work down "what does that need?"** Tasks only come into being when you break something down.

```text
Move house
  ├─ needs → a new home
  │            └─ needs → a visit to an agent
  └─ needs → money
```

And **the tree you get from breaking things down runs as a state machine as it is.** Go all the way down and "what you can do today" appears; mark it done and the prerequisites fill in and carry upward.

- Outliners and mind maps can break things down, but the tree they produce doesn't move
- Dependency-based task managers can show "what's ready", but have no flow for growing a tree from a single goal

Sirube aims at the point where the two meet.

---

## Holding up after a break

Open it after six months away, and "where you are and what to do next" is rebuilt from the graph. You don't have to decide your next action again by hand.

- **One done fills in the prerequisites** — mark one node as done and its `requires` chain is walked back so the prerequisites become done too (when anything other than what you pressed would change, you see a list before it is written). Updating the state after weeks away takes no time
- **Search is not an exact-match game** — the **neighbors of a matching node show up with it**, so searching "CI/CD" also brings up "Runbook". You can get there even if you can't recall the word
- **It tells you why you're stuck** — when nothing can move because nodes are waiting on each other in a loop, that loop is shown above "Ready now"

---

## Getting started

Every part of the screen is explained under **"Help"** in the app's header (the same text as [`docs/manual.en.md`](docs/manual.en.md)). This section takes you from installing to your first round.

The app follows your OS language. To switch between Japanese and English, open the gear in the header and choose under **"Language"**.

### 1. Install

From the [latest release](https://github.com/MotimotiNotch/sirube/releases/latest), download the file for your OS.

**Windows**: run `Sirube_<version>_x64-setup.exe` (about 2.3MB).

> During installation you will see **"Windows protected your PC"**. This is only because the app has no code-signing certificate; the warning means "the publisher could not be verified". Continue with **More info → Run anyway**.

**Linux**: make `Sirube_<version>_amd64.AppImage` executable and start it. It runs on glibc 2.34 or later (roughly Ubuntu 22.04 and later).

```sh
chmod +x Sirube_<version>_amd64.AppImage
./Sirube_<version>_amd64.AppImage --appimage-extract-and-run
```

No network access, no account. Once it's installed, you're done.

<details>
<summary>Building it yourself</summary>

```
bun install
bun run release        # needs MSVC. Output goes to src-tauri/target/release/bundle/nsis/
```

</details>

### 2. Choose the folder to open first

On first launch you are asked for a folder. **An empty folder is fine** — a `nodes/` folder is created inside, and all your data lives there.

It works like an Obsidian vault: **you can carry the whole folder around with Git**. You can also put it inside an existing Obsidian vault.

### 3. Create one goal

Press **+** next to "Goals" on the left. Write just one thing you want to achieve (`Move house`, `File my tax return`, `Publish my portfolio`).

**You don't need to break anything down yet.** You can add that later.

### 4. Write down "what does that need?"

Open the goal you made and press **"Break down"** on the right. The heading of the dialog is the question itself:

> What does “Move house” need?

Write one per line. Press `Ctrl+Enter` to confirm.

```
New home
Save money
Visit an agent
```

**Open what came out and ask the same question again.** This is the heart of the tool: as you work down, "what you can do today" appears at the ends.

Switch to the **"Parts"** tab in the dialog and the question becomes "What is “Move house” made of?". Add things here when, once all of them are in place, nothing is left to do for the node itself (shares of work, components, groups of features).

To write everything out in one go, paste the DSL into the **"Bulk add"** tab of the screen that the **+** next to "Goals" opens (you can also open it by right-clicking empty space in the graph):

```
Move house -> New home -> Visit an agent, Move house -> Save money
```

### 5. Knock off the ends

**"Ready now"** at the top left shows only what has all its prerequisites in place. Mark one as done, and **its prerequisites are walked back and all marked done**, carrying upward.

Even after weeks away, you don't need to update the state by hand.

### 6. Six months later

Just open it. "Ready now" is right there. If it's empty because nodes are waiting on each other in a loop, **that loop is shown at the top of the list**.

If you can't remember what you were working on, use **"Recent changes"** on the left. It lists the 30 most recently changed nodes, newest first (it goes by file modification time, so things that changed along with them are included). A node's details panel also shows when it was created and last updated.

### Where your data lives

Only inside the folder you chose.

| | |
| --- | --- |
| `nodes/*.md` | **This is everything.** One file per node |
| `00_Sirube_MOC.md` / `goals/` / `90_達成済み.md` | Entry points that Sirube generates, **for opening in Obsidian** (readable from your phone too). Recreated if deleted. Written in Japanese regardless of the language setting |
| `AGENTS.md` | A spec for agents. Same as above |

Everything except `nodes/` is generated, so edits there are overwritten on the next save.

---

## Letting AI read and write

There is **no AI integration built into the app**. Because the data is Markdown, letting Claude Code or Cursor work on `nodes/` directly is the integration. No API key, no settings.

### 1. Tell the agent where to look

Every time the app starts, it writes out the path of the vault it has open:

```
%LOCALAPPDATA%\jp.motimotinotch.sirube\vault-path.txt
```

**Only the location of this file has to come from you, once.** Say "look at `%LOCALAPPDATA%\jp.motimotinotch.sirube\vault-path.txt`" and the agent can find its way to the vault. Unlike handing over the folder directly, what you tell it doesn't change when you move the vault to another folder (handing over the folder works too, but you'd have to say it again each time you move it).

If saying it every time is a chore, put that one line in the agent's settings file — `CLAUDE.md` for Claude Code.

**The app doesn't read this file.** Rewriting it doesn't change which vault opens (switch from inside the app). It's a notice board the app only writes to; the source of truth is inside the app.

### 2. Have it read the spec

**There is an `AGENTS.md` inside the vault** (the app writes it out on every launch). Telling the agent "read `AGENTS.md` in the vault" is enough.

It covers **what you can't tell by looking at the files, not the format itself** — how to tell `requires` from `contains`, that references may be written by name, that `id` and `number` must not be written, and how waiting loops (cycles) are handled.

Because it sits in the same folder as the data, **it comes along whether you take the vault to another machine with git or hand over just the vault**. It always matches the app version.

### 3. What to ask for

- **Bulk breakdowns.** Say "break this goal down" and it writes out DSL or nodes. References can be written by name, so there's no back-and-forth looking up ids
- **Stocktaking.** "What's stuck under this goal?" "Where are nodes waiting on each other in a loop?"
- **Tidying notes.** The body is ordinary Markdown, so it can be added to as is

### 4. What not to ask for

**Rewriting `satisfied` directly.** Setting it to `true` in the file doesn't run the cascade, so prerequisites are left not done. **Mark things done in the app.**

(Nothing breaks if it happens anyway. "Auto-fix" in the header looks at modification times and makes things consistent.)

### 5. After it writes

The app watches the folder, so **what the agent writes shows up on screen automatically**.

### Keep it to two ways of writing

**People write from the app; AI writes the files directly.** If people also write directly in Obsidian or an editor, there are more ways in and contradictions show up in scattered places. Reading from anywhere is fine.

---

## The data is just Markdown

One node = one file. This is all it contains.

```markdown
---
name: File my tax return
number: 9
satisfied: false
requires:
  - 01M1DR2XM4BSDZTH8C12FMC0YC  # Sort receipts
contains: []
due: 2027-03-15
---

Filed it with accounting software last year. This year, add the medical expense deduction too.
```

The file name is a meaningless ID (a ULID). The display name is kept separately in `name`, so **renaming never breaks a single reference**. `number` is a tag for pointing at a node out loud, like `#9`; the app assigns both.

- **`git diff` is literally "who finished which node"**. Leave team sharing to Git (the tool doesn't take control of Git)
- **It opens as is in Obsidian**. A node's body becomes an ordinary note
- **If the tool dies, the data survives**

No network access, no account. Everything is local files.

---

## Cycles are not errors

"To build a track record you need a project. To get a project you need a track record" — waiting loops like this happen all the time in real life.

Sirube treats this as a **"not broken down enough" signal**. Going round in a loop is a sign that one name has two different things mixed into it.

```text
Build a track record → Get a project → Build a track record     ← stuck

Get a big project → Build a track record → Do one small project → Ask an acquaintance
                                                                  ↑ splitting it creates an action
```

So what the screen says is not "please cut one of these" but "**one of the nodes in this loop may need to be split in two**".

---

## Status

**In development. Windows and Linux (AppImage) builds are distributed through Releases.**

- ✅ Core (state derivation, cascade, cycle detection, due-date propagation, DSL, Markdown store, automatic consistency fixes)
- ✅ UI (Chain View / search and cross-cutting view / overview / map / recent changes / break down and bulk add / rename, delete, detach, undo / color tags and due dates / legend / auto-fix / tutorial and in-app manual / new windows / light and dark / Japanese and English)
- ✅ Tauri shell (`sirube.exe` about 11MB / installer about 2.3MB)
- ✅ UX checks on real hardware (ongoing on the author's machine)
- ✅ Distribution (Releases)
- ✅ Public repository (2026-10-06)

```
bun install
bun run dev     # http://127.0.0.1:5177
bun test
bun run typecheck
bun run release # needs MSVC. Runs through scripts/with-msvc.bat
```

---

## Design

`src/core/` is pure logic that depends on neither the UI nor the file system.

| File | Role |
| --- | --- |
| `core/model.ts` | The data model. The only state that is saved is `satisfied` |
| `core/engine.ts` | State derivation (4 values), cascade, cycle detection, neighbors |
| `core/dsl.ts` | The text DSL and bulk adding (prerequisites and parts) |
| `core/search.ts` | Search = the cross-cutting view (the same feature) |
| `core/reconcile.ts` | Automatic consistency fixes (the newer mtime wins) |
| `store/frontmatter.ts` | Markdown ⇄ node |
| `store/fs.ts` | File access abstraction (Tauri / in-memory) |
| `store/store.ts` | Writes only the files of nodes that changed |
| `i18n/` | Screen text in Japanese and English (Japanese is the source; English must match its shape) |

The model is kept deliberately minimal. It has no types, priorities, or tags because **allowing the same thing to be expressed two ways stalls the flow of breaking things down**. Priority is expressed structurally by how many places point into a shared node, and classification can be expressed with edges.

---

## Support

It's free to use. If it helps you, a tip on [Ko-fi](https://ko-fi.com/motimotinotch) would make me happy. I'll keep maintaining it as far as I can.

---

## License

MIT (planned)
