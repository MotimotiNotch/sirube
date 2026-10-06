# How to use Sirube

This is the manual inside the app. Use the contents above to jump to a chapter.

## 0. The idea

### Work down from a goal

In Sirube, you don't list tasks in the order they occur to you. **You set one goal and keep asking “what does that need?”, working your way down.** Tasks only come into being when you break something down.

```
Move house
  ├─ New home
  │    └─ Visit an agent
  └─ Save money
```

The ends you reach at the bottom (here, “Visit an agent” and “Save money”) are **what you can do today**.

### No priorities by hand

The “Ready now” list comes out of the structure you have written so far.

- Only things whose needs are all in place become “ready”
- Something needed by several goals (**shared**) moves several of them forward at once when you finish it. The list shows how many places share it

There is no priority field and no tags. The direction of the breakdown takes the place of priority.

### Only “done or not” is saved

The only state Sirube remembers is **whether each node is done**. States like “ready” and “waiting” are worked out from the structure again every time you open it.

| State | Meaning |
|---|---|
| Ready | Everything it needs is in place |
| Waiting | Something it needs is not in place yet |
| Done | Finished |
| Cycle | Nodes are waiting on each other and can't move (→ 7. Tidying up) |

Thanks to this, **even if you open it after six months away, “where you are and what to do next” is right there.** You don't need to decide your next step again by hand.

### Two ways to link

There are two kinds of “what it needs”.

- **Prerequisite**: once it is in place, you still have work of your own left (even with the home and the money ready, the move itself remains)
- **Part**: once all of them are done, that's the end of it (a set of shares or components)

How to tell them apart and when to use which is explained in “3. Breaking down”.

### Your data is plain files

One node is one Markdown file. You can read them outside the app too (in an editor or Obsidian). See “8. Handing off” for details.

## 1. The screen at a glance

The screen is made of the header at the top and three columns: left, center, and right.

| Where | What's there |
|---|---|
| Top (header) | Search box, folder name, Undo, Auto-fix, settings, Help |
| Left (sidebar) | Ready now, Recent changes, the goal list |
| Center | Breadcrumbs at the top, and a list or a graph below |
| Right (details panel) | Details of the selected node |

### Header

| Part | What it does |
|---|---|
| Search box | Searches names and notes. Clear it to go back to “Ready now” (→ 2. Getting in) |
| Folder name | Where the data you have open lives. Press it to check the location and to open another folder |
| Undo | Undoes just the last action. It only appears when there is something to undo (→ 3. Breaking down) |
| Auto-fix | Suggestions for fixing inconsistencies. It only appears when there are suggestions, with their count (→ 7. Tidying up) |
| Settings (gear icon) | Switches appearance and language. Appearance is “Match OS”, “Light”, or “Dark”; language is “Match OS”, “日本語”, or “English”. Both start at Match OS. Changing the language reloads the window. It doesn't appear in other windows; they follow what you chose in the first window |
| Help | This manual. You can go through the tutorial again from the top. “Open in new window” lets you keep it beside you while you work |

### Sidebar (left)

- **Ready now** — the screen you see right after starting. The number is how many nodes are ready
- **Recent changes** — a list in the order things changed. A clue when you come back after a while
- **Goals** — the goals shown on the map. The number is “done / total”. Use the **+** beside it to create a new goal

### Center

Either a list or a graph appears here.

- The top row is the **breadcrumbs**: where you are looking now and the path you took to get there. Press one to go back to it
- The **+** at the start of that row means “**add here**”. It adds below the node you have selected (→ 3. Breaking down)
- “Overview”, “Map”, and “Graph” at the right end switch how things are shown (→ 5. Seeing the whole)
- The round button at the bottom left of the graph explains the marks (the legend)

### Details panel (right)

Details of the selected node. When nothing is selected, it is folded away.

- Name (rename with the pencil), number (`#12`), state, progress
- The **Mark as done** / **Break down** buttons
- **Color tag** — a color you can attach to goals only
- **Waiting on this** / **Part of** — the nodes above that need this node. Press one to move there. Right-click to detach
- **Note** — the body text. Write it with “Edit”
- Created and updated dates
- **More** — due date, show on map / remove from map, delete

### Changing widths

Drag the border between columns to change their width. Drag one all the way to the edge to fold it, and double-click to return to the default width.

### Node numbers

Every node has a number like `#12`. It's a tag for pointing at a node out loud (“about #12…”). Type `12` or `#12` in the search box and that node comes up.

## 2. Getting in

These screens help you decide “where to start” when you open the app.

### Choosing where your data lives

The first time you start the app, it asks for **a folder to keep your data in**. Choose an empty folder to start fresh, or a folder that already has Sirube data to pick up where it left off. The first time you open an empty folder, the tutorial starts on its own.

The app remembers the folder you chose and opens it directly from then on. To switch to another folder, press the folder name in the header and choose “**Open another folder**”.

### Picking up where you left off

The app remembers where you were when you closed it (the list, which node's graph, or the map) and starts there next time. To go back, press “Ready now” in the sidebar; it always takes you to the first list.

### Ready now

The list of things whose needs are all in place, **things you can start on right now**. This is what you see right after starting.

| Column | Meaning |
|---|---|
| No. | The `#12` tag |
| Name | The node's name |
| Shared | How many places need it. Shown only when it is 2 or more |
| Due | Only for nodes with a due date. A dashed frame means the due date came down from a node above (→ 6. Moving forward) |
| Goal | Which goal it sits under |

- **The list is ordered by how many places share each node.** You can read it as “what moves the most forward when finished” first. Pressing a column header does not re-sort it — the order is the priority that comes out of the structure
- The color at the left edge of a row is the color tag of the goal it belongs to
- Press a row to open the graph where that node sits
- When nothing can move because nodes are waiting on each other in a cycle, that cycle appears above the list (→ 7. Tidying up)

### Recent changes

The 30 most recently changed files, newest first. **This list is for remembering “what was I working on?” when you come back after a while.**

- It shows not only what you touched, but also what changed together when something was marked done, and what AI or other tools wrote
- Press a column header to sort by number, goal, state, or updated date. Press it again for reverse order. The sort isn't remembered; reopening returns to newest first

### The goal list

“Goals” in the sidebar lists **the goals shown on the map** (→ 5. Seeing the whole).

- The number is “done / total”
- Press one to open that goal's graph
- The row for the goal closest to where you are looking is highlighted
- Never-ending goals (roots taken off the map) don't appear here

### Search

Typing in the search box in the header turns the center into search results.

- It searches **both names and notes**. Full-width vs. half-width and upper vs. lower case don't matter
- Type `12` or `#12` and the node with that number comes first
- Matches on the name come before matches in the note
- Under each result, its **neighbors** are shown too (Needs / Waiting on this / Parts / Part of). Even if you can't recall the words, you can get there from something nearby
- When states are mixed, a “State” column appears
- Clear the search box to go back to “Ready now”

## 3. Breaking down

This chapter is about working down from a goal by asking “what does it need?”. It's the central operation in Sirube.

### Creating a goal

Press the **+** beside “Goals” in the sidebar, write a name, and press “Create”. A node that nothing else needs becomes a goal automatically.

You can't create two nodes with the same name (you'll see ““…” already exists.”).

### Prerequisite or part?

When you add “what it needs”, you choose whether to add it as a **prerequisite** or as a **part**. If you're unsure, this one question decides it.

> **Once everything it needs is in place, is there still work of your own left?**

| Answer | Choose | Example |
|---|---|---|
| Yes | **Prerequisite** | Moving house — even with the home and the money ready, the move itself remains |
| No | **Part** | “A's share” — once all the tasks in it are done, nothing is left to do for the share itself |

The difference is **how “done” spreads**.

- **Prerequisite**: when you mark the node above as done, its prerequisites are marked done too, since they “must have been finished” (it spreads downward)
- **Part**: when all the parts are done, the node above becomes done automatically. Put one part back to not done, and the node above goes back to not done too (it spreads upward)

A node with parts does not become “ready” until its parts are all done, because the node above has no work of its own.

### Break down

Press “**Break down**” in the details panel (you can also open it by right-clicking a node in the graph, or from the **+** at the start of the breadcrumbs).

- Choose “**Prerequisites**” or “**Parts**” with the tabs at the top
- Write **one per line**. Enter makes a new line; **Ctrl+Enter** adds them
- **If you write a name that already exists, it links to that node instead of creating a new one.** The preview says things like “(N of them link to existing nodes)” or “N are already prerequisites”, so you know before you press
- If you switch between the Prerequisites and Parts tabs mid-way, what you wrote stays

If you add an unfinished part to a node that is already done, you're asked whether to “**Mark as not done**” or “**Leave as is**”, because a node can't consistently stay done while its parts aren't finished.

### Add here (+)

The **+** at the start of the breadcrumbs in the center opens “Break down” for **the node you have selected**. In the graph, click a node below the focus once to select it, then press + to add to that node. When nothing is selected, “Bulk add” opens instead.

You can also link two existing nodes from here by writing the other node's name.

### Bulk add

A way to write out the structure all at once. Open it from the “**Bulk add**” tab in the screen that the + in the sidebar opens, or by right-clicking an empty spot in the graph → “Bulk add”.

| Syntax | Meaning |
|---|---|
| `X -> Y` | X needs Y as a **prerequisite** |
| `X -> Y -> Z` | X needs Y, and Y needs Z (a chain) |
| `X -> [Y]` | Y is a **part** of X |
| `X -> [Y] -> [Z]` | Y and Z are both parts of X (siblings) |
| `,` | Separates expressions |

```
Move house -> New home -> Visit an agent,
Move house -> Save money
```

- The same name means the same node. If the name already exists, it links to that node
- Before you press, a preview says something like “Will create N new nodes and link N existing nodes.” If the syntax is wrong, it tells you where

### Removing shortcuts

When things you had placed side by side as siblings later turn out to have an order, and you link them, the direct line from above may no longer be needed.

```
Move house → Home → Visit an agent
Move house → Visit an agent        ← reached via Home, so not needed
```

When this happens, “**A direct link is no longer needed**” appears, and you're asked whether to “Detach” or “Leave as is”. Keeping it doesn't break any state, but the node looks as if it were needed from two places (shared), and it comes earlier in the list than it really should.

### Insert between

Press a line in the graph, or right-click → “**Insert a node between**”. This puts one new node between two nodes. The original line is removed and the chain grows by one.

### Detach

Cuts only the link. The node itself stays.

- Right-click a node in the graph → “**Detach from “…”**”. If it has several parents, there is one line per parent
- It also appears when you right-click a line in the graph, or a row under “Waiting on this / Part of” in the details panel
- **If you detach a node from its last parent, it appears in the list as a goal.** That's the case when the menu says “(it will appear in the list as a goal)”
- It doesn't appear on the map (the map's lines fold what's in between, so which parent you'd detach from wouldn't match what you see)

### Delete

At the bottom of the details panel, “More” → “Delete this node” → “Delete”.

- Among the nodes below it, those with no other parent will appear in the list as goals. The count is shown before you delete
- The lines that were attached are cleaned up too

### Undo

“**Undo**” in the header undoes just the last action. The button only appears when there is something to undo.

- You can undo deleting, detaching, removing shortcuts, and done states that changed together (→ 6. Moving forward)
- **Only one step.** As soon as you do something else, that becomes the thing you can undo
- If the files were changed outside the app before you undo, it won't undo

If you want a link back after detaching it, you can also reconnect it by writing `parent -> child` in “Bulk add”.

### Rename

Press the pencil beside the name in the details panel. Links from other nodes are not broken. You can't give it the same name as another node.

### Tips for naming

- **Give it an ending.** A bare noun like “Blog” makes it unclear what being done means. Use a form you can call finished, such as “Start a blog” or “Decide the blog's direction”
- **Things you can't finish yourself** (waiting for stock, waiting for a reply): split off the part you can finish today as a prerequisite. “Buy a used camera” → prerequisite “List the shops to check”. Write one line in the note about why you're waiting
- Something that spans two goals stays one node, linked from both. That is what makes it shared

## 4. Following

This chapter is about moving between a goal and its ends in the graph.

### What the graph draws

The graph draws only what surrounds **where you are now** (the focus). It never draws everything on one sheet.

- The focused node sits at the top center, with what it needs lined up below it
- **Prerequisites** are drawn to the end of the chain (so you can trace why something is ready now)
- **Parts** are drawn only one level down. To see below them, dive in
- The nodes above (the ones that need this node) are not drawn in the graph. They appear in the details panel under “Waiting on this” and “Part of”

### Reading the marks

Each node is drawn as a round mark with its name below. Hover over the round button at the lower left of the graph to see the legend (click it to keep it open).

| What you see | Meaning |
|---|---|
| Color of the mark | State (Ready, Waiting, Done, Cycle) |
| Solid line | Needs this (prerequisite) |
| Dashed line | Made of this (part) |
| Arc around the mark | Progress of what's below |
| Number next to the mark | How many places need this (shared) |

Hover over a mark to see the exact numbers. Hover over a node to highlight its lines.

### Select, dive in, go back

| Action | What happens |
|---|---|
| Click a node once | **Only selects it**. The details panel on the right switches to that node. The view does not move |
| Click the selected node again | **Dives into** that node (it becomes the focus). A node with nothing below it does not dive |
| Click the focused node once | Only selects it |
| Click it again while the focus is selected | **Goes back up one level** |
| Click a name in the breadcrumb | Returns to that point on the path you came along |

The first click only selects so that clicking a node just to see its details does not move you somewhere else.

### Peeking at what's below

Hover over a node that has something below it, and a list of what is stacked under it (only the ones that have more below) appears. Click a name in the list to jump straight there, skipping the levels in between.

### Moving and zooming

- **Drag** to move
- **Scroll the wheel** (or pinch on a trackpad) to zoom in and out. It zooms around the point under the mouse
- When you move or zoom, the zoom level (such as `120%`) appears in the corner. Click it to reset the view

The position and zoom are kept while you stay in the same place. Diving into another node resets the view.

### Open in new window

To compare two places side by side, right-click a node in the graph → “**Open in new window**”. Another window opens with that node as the focus. The manual can also stay open beside you with “Open in new window” at the top.

- Everything you usually do, such as marking as done, breaking down, and detaching, works in the new window too. Changes made in one window show up in the other automatically
- “Undo” is per window. Only the last step taken in that window is undone
- A new window does not remember where you were looking or the column widths. The next time it opens, it continues from the first window
- Opening another folder is done from the first window. Switching closes the other windows
- Closing the first window closes the other windows with it

### Going up in the details panel

The graph only draws downward, so going up is the job of the details panel.

- **Waiting on this** — the nodes above that have this node as a prerequisite
- **Part of** — the nodes above that have this node as a part

Click a name to move there. When a node has several parents (it is shared), the breadcrumb only holds the path you came along, so you reach the other parents from here.

### Note

This is the body of a node. It shows in reading mode by default; press “**Edit**” to write. When you finish and click outside the box, it is saved (“View” returns to reading mode). Right-click the note to get “Edit” and “Copy note”.

In reading mode, the following ways of writing are formatted. Anything else is shown as typed.

| How you write it | How it shows |
|---|---|
| `# Heading` (up to `##` and `###`) | Heading |
| `- item` | Bulleted list |
| Surround with two asterisks | Bold |
| Surround with one backquote, or put between lines of three | Monospace (code) |
| `> quote` | Quote |
| Rows separated by vertical bars, with a separator row below the first | Table |
| `---` | Horizontal rule |
| `https://…` | Link (opens in the browser) |

The note is the body of the node's file itself, so you see the same content when you open it in Obsidian or an editor.

### Created and updated dates

They appear in small type below the note. The updated date is the last day the node's file was rewritten. It is not necessarily a day you touched it (it also counts rewrites that came with marking something else as done, writes by an AI, and so on).

## 5. Seeing the whole

The graph is a tool for diving in one level at a time. This chapter covers two views for **seeing widely at once**, and what to put on them.

### Overview (everything below here at once)

While looking at the graph, press “**Overview**” at the right end of the breadcrumb. **Everything ready now below the node you are on** appears as a list.

- Pressed on a goal, it shows everything under that goal; pressed after diving in, only what is under that branch
- The breadcrumb shows “Under ◯◯”
- Click a row to open the graph with that node as the focus. The breadcrumb keeps the goal you were viewing, so you can go back from there
- “Graph” at the right end takes you back to the graph
- Since everything is under the same goal, the goal column is not shown

### Map (only the goals stand out)

Press “**Map**” at the right end of the breadcrumb to get **a picture that keeps only the goals and folds away the nodes in between**.

- There is only one map. It is the same picture wherever you come up from, and the place you were before coming up is marked
- The number on a line from goal to goal is **how many nodes are folded in between**
- The number next to a mark is how many goals pass through it
- On the map, clicking a node only selects it. To go down into that goal's graph, press “**Graph**” at the right end, or right-click → “**Open in graph**”
- “Detach” does not appear on the map (→ 3. Breaking down)

### What becomes a goal

- **A node that nothing else needs** is a goal automatically
- A node in the middle can also become a goal with “More” → “**Show on map**” in the details panel. This is for when the tree under one goal gets too deep and you want a middle level as an entry point
- A goal can be taken off with “More” → “**Remove from map**”. Use it when you put a **never-ending goal**, something that lasts a lifetime, at the root. Removing it makes it disappear from the map and the sidebar, but its links and state stay as they are

**A caution when removing a root from the map**: even after you remove it, the nodes below it do not become goals automatically. If there is something below that you want on the map, set it to “Show on map” first. Otherwise that whole area disappears from the map together.

A rule of thumb: “**When I open this after six months away, do I want to remember the way from here?**” If you make bundles of tasks into goals, the map fills up with tasks.

### Color tag

You can put a color tag on a goal (Yellow, Orange, Pink, Purple, Blue, Green). Choose it from “Color tag” in the details panel; pressing the same color again removes it.

The color appears at the left end of the goal's row in the sidebar and of rows in “Ready now”. You can tell by color which goal a task belongs to. Nodes that are not goals cannot have a tag.

### How progress is shown

| Where | How |
|---|---|
| Goals in the sidebar | Done count / total |
| Details panel | Bar and numbers |
| Marks in the graph | Arc around the mark |

For a **never-ending goal** (a root taken off the map), a ratio means nothing, so instead of a fraction or bar it shows two numbers side by side: “**◯ done / ◯ total**”. The total is kept so you can see how far it has spread.

## 6. Moving forward

This chapter is about marking finished things as “done” and moving further along the way.

### Mark as done

Press “**Mark as done**” in the details panel (it is also in the right-click menu of a node in the graph). The nodes above that needed it, and are not missing anything else, change to “Ready”.

On a node that is already done, the same place becomes “**Mark as not done**” (the same label as in the right-click menu).

### What changes along with it

Marking as done does not always end with one node. Following how things are linked (→ 3. Breaking down), the surroundings are rewritten too.

| What you did | What happens along with it |
|---|---|
| Mark as done | Its **prerequisites**, all the way back up the chain, are also marked as done (if the later step is finished, the earlier ones must have been too) |
| Mark as done | A node above whose **parts** are all in place is marked as done (it has no work of its own) |
| Undo | Every **node above** that needed it, whether as a prerequisite or a part, goes back to not done (if the foundation fell through, what is above is not really finished either) |

Undoing does not touch the prerequisites below. Putting one thing back does not mean what you did before it never happened.

### Preview before writing

When marking something changes whether other nodes are done, **a list appears before anything is rewritten**. Entries such as “Fill prerequisite”, “Mark as not done”, and “Parent done” line up by name, showing what changes and why.

- There are only two choices: “Run” or “Cancel”. You cannot leave out just one entry
- **If you see things you don't recognize, suspect how they are linked.** If something where “any one will do” is linked as a prerequisite, even the one you didn't use gets marked as done. Something where any one will do is a choice, not a prerequisite, so don't link it; write it in the note instead
- When the only change is a node above being marked done because its parts are all in place, no preview appears (to avoid a confirmation every time you finish one end)

Everything rewritten along with it can be put back at once with “**Undo**” in the header (→ 3. Breaking down).

### Due date

Give a due date only to **things whose date is really fixed by outside circumstances**. Do not add dates you set for yourself as a rough target.

Choose the date in the “**Due date**” field under “More” at the very bottom of the details panel. To remove it, use “**Clear due date**”.

A due date passes downward. If “Move house” is due March 31, its prerequisite “New home”, and that one's prerequisite “Visit an agent”, are also implicitly due by March 31.

- A due date passed down appears with a **dashed border** in the due date column of “Ready now”. Hover over it to see where it came from
- In the details panel, below the due date, it says in words where it came from: “**In time for “Move house”**”
- If the node's own due date is earlier, that one takes effect (the details panel shows both). A due date passed down belongs to the node above, so it does not go into the due date field. Set one yourself only when an earlier date has been fixed by outside circumstances
- A node that is done neither passes on nor receives due dates
- When a due date gets close, there are no reminders or warnings

### Clear shared nodes first

“Ready now” is sorted with the most shared first (→ 2. Getting in). Finishing a node shared by 2 or more **moves several paths forward at once**. If you are unsure where to start, taking them from the top follows the order the structure suggests.

### Things you can't finish yourself

A node you cannot finish even though its prerequisites are done, such as waiting for a reply or for stock, keeps appearing in “Ready now”. This is a sign the breakdown is not deep enough. Cut out the part you can finish today as a prerequisite, and write one line in the note about what you are waiting for (→ 3. Breaking down, “Tips for naming”).

## 7. Tidying up

This chapter is about fixing the structure when it contradicts itself or gets stuck.

### The four states, once more

| State | Meaning | What to do |
|---|---|---|
| Ready | Everything it needs is in place | Do it |
| Waiting | Something it needs is still missing | Take care of what is below |
| Done | Finished | Nothing |
| Cycle | Nodes are waiting on each other and cannot move | Split (explained below) |

States are not written in the files. They are recalculated from the structure every time you open the app (→ 0. The idea).

### Cycle

Sometimes nodes need each other and the chain loops back to where it started.

```
Build a track record → Win a contract → Build a track record
```

This is **not an error but a sign that the breakdown is not finished yet**. A cycle happens when one name holds two different things. In the example above, “Win a contract” mixes “a contract that needs a track record” and “a contract that does not”.

**What you do is not “cut a line” but “split a node”.**

```
Win a big contract → Build a track record → Do one small job → Ask an acquaintance
```

Splitting removes the cycle, and it also produces one thing you can do today (ask an acquaintance).

- When a cycle keeps everything from moving, the cycle is listed above “Ready now”. Click a name to select that node, and “**Split**” opens the breakdown
- The details panel of a node in the cycle also says “These nodes are waiting on each other”
- If it really is a mutual dependency that cannot be split, you may mark one of them as done to get out of the cycle (a statement that you are “starting while it is still incomplete”). Try splitting first, though

**A cycle of parts** (A is made of B, and B is made of A) is not split. Instead, remove one of the part links.

### Auto-fix

“**Auto-fix**” in the header suggests fixes for contradictions. It appears only when there are suggestions, with the count. Click it to see the list, check it, and then run it.

**Whichever file was modified more recently is treated as the “latest intent”.** These are the suggestions you may see:

| Suggestion | What is happening |
|---|---|
| Fill prerequisite | It is done but a prerequisite is not. The done side is newer |
| Mark as not done | It is done but a prerequisite is not. The prerequisite is newer (it was set back to not done later) |
| Parent done | All of its parts are done, but the node above is not |
| Mark as not done (parts) | A part is not done but the node above is done. The unfinished part is newer |
| Create empty node | The node at the other end of a link cannot be found |

When a part is not done but the node above is, **nothing is suggested if the node above is newer**. A done state that was actually reached is kept as a record.

Some things cannot be fixed automatically and are listed separately under **Needs your decision**.

| Heading | What to do |
|---|---|
| Cycle | Split (explained above) |
| Cycle of parts | Remove one of the part links |
| Similar names | There are several nodes with very similar names. Merge them into one, or make the names distinct |
| Can’t decide | It keeps flipping between done and not done. Decide by hand which is right |
| Times too close | It cannot tell which is newer. Decide by hand |

Files that could not be read are also listed, under “**File problems**”. These cannot be fixed from inside the app, so open the file and fix it (asking an AI is the quickest way → 8. Handing off).

### When files change outside the app

The app watches your data folder. **When an AI or another tool rewrites a file, the screen catches up automatically.**

- If something is rewritten outside while you have a done preview or a confirmation open, nothing is written and you see “Please press it again.” This is so the app never writes something different from what it showed you
- “Undo” works the same way: it does not undo changes made outside
- If you edit `satisfied` directly outside the app, prerequisites and parts are not changed along with it. Auto-fix picks up the resulting contradictions

### When numbers collide

If you combine nodes made separately on two machines, the same number can appear twice. The app finds this when it loads and **gives a new number to the one created later**. You do not need to fix it yourself.

## 8. Handing off

This chapter covers taking your data outside the app, letting an AI work with it, and keeping a backup.

### What the data looks like

The folder you chose contains the following.

| Location | Contents |
|---|---|
| `nodes/` | **This is everything**. One node is one Markdown file |
| `00_Sirube_MOC.md` | The entry point. The list of goals, and what is ready for each |
| `goals/` | An entry point for each goal |
| `90_達成済み.md` | The list of what is done |
| `AGENTS.md` | Instructions for AI |

Everything except `nodes/` is a **generated file** that the app rebuilds every time it starts. If you edit them, your edits are overwritten; if you delete them, they come back the next time you open the folder. The generated files are written in Japanese whatever language the app is set to.

A node file looks like this.

```
---
name: Tax return
number: 9
satisfied: false
requires:
  - 01M1DR2XM4BSDZTH8C12FMC0YC  # Sort receipts
contains: []
due: 2027-03-15
---

Filed it with accounting software last year. Add medical expenses this year.
```

The file name is an ID with no meaning. The name lives in `name` inside the file, so renaming a node does not break any links.

### Reading in Obsidian or an editor

You can open the folder as an Obsidian vault as it is. From the entry files you can follow links to each node, and you can read it from Obsidian on your phone too.

**Please write from the app.** What changes together when you click in the app (→ 6. Moving forward) does not change when you write a file directly. The more places you write from, the messier the contradictions get.

### Letting an AI read and write

The Sirube app has no AI features. Because the data is plain Markdown, letting an AI agent such as Claude Code or Cursor work in the folder is the integration.

Every time the app starts, it writes the location of the folder you have open to this file.

```
%LOCALAPPDATA%\jp.motimotinotch.sirube\vault-path.txt
```

1. **Tell it where.** Tell the AI “look at the file above” and it will find its way to the folder
2. **Have it read the instructions.** Ask it to read `AGENTS.md` in the folder. It explains rules you cannot see just by looking at the files, such as how to tell prerequisites from parts
3. **Ask.** Breaking down a goal, finding where things are stuck, tidying up notes, and so on

The app shows what the AI writes on screen automatically.

**Do not have the AI mark things as done; click it in the app.** Marking something done in the file does not update its prerequisites along with it (if it happens anyway, Auto-fix will reconcile things).

### Keeping a backup (git)

You can manage the whole folder with git. If you exclude the generated files, each diff shows exactly which nodes were changed and how.

```
/00_Sirube_MOC.md
/90_達成済み.md
/goals/
```

(Write the lines above in `.gitignore`.)

The app does not run git. You commit yourself (or ask an AI to).

### Using it on another PC

Bring the folder over with git or cloud sync, and choose it with “**Open another folder**” in the app on the other machine to pick up where you left off (→ 2. Getting in).

- If the same node is changed on two machines at the same time, you get a git conflict. Decide which one is right and fix it
- The app fixes number collisions (→ 7. Tidying up)

## 9. Appendix

### Keys

| Key | Where | What happens |
|---|---|---|
| Ctrl+Enter | Break down / Bulk add | Adds |
| Enter | Create a goal / Insert between | Creates |
| Enter | Rename | Confirms |
| Escape | Rename | Cancels |
| Escape | Confirmations and menus | Closes (cancel) |
| Wheel | Graph and map | Zoom in and out |
| Pinch | Graph and map (trackpad) | Zoom in and out |

When a done confirmation opens, “Cancel” is selected. This is so that pressing Enter on impulse does not write anything.

### Glossary

The Japanese term is given in parentheses, because you will meet it in the generated files and in `AGENTS.md`.

| Term | Meaning |
|---|---|
| Node (ノード) | One “thing to do” or “goal”. One file |
| Goal (目的・ゴール) | A node shown on the map. Anything that nothing else needs becomes one automatically |
| Prerequisite (前提) | Something needed, where work of your own still remains after it is in place |
| Part (中身) | Something needed, where once all of them are in place, you are finished |
| Ready (今やれる) | The state where everything needed is in place |
| Waiting (前提待ち) | The state where something needed is still missing |
| Cycle (待ち合って一周している) | The state where nodes need each other and cannot move |
| Shared (合流) | Needed from several places. Finishing it moves several things forward at once |
| Focus (焦点) | Where you currently are in the graph |
| Breadcrumb (パンくず) | The path you came along |
| Overview (俯瞰) | A list of what is ready below the current node |
| Map (地図) | A view that keeps only the goals and folds away everything between them |
| Color tag (付箋) | A color you put on a goal |
| Inherited due date (伝わった期限) | A due date from a node above that implicitly applies to the nodes below |
| Auto-fix (自動解決) | Suggestions that fix contradictions based on modification times |
| Generated file (生成物) | A file the app rebuilds. Everything except `nodes/` |

### FAQ

**I want to set priorities or tags**

You can’t. The order of “Ready now” (most shared first) takes the place of priority, and how things are linked (which goal a node sits under) takes the place of categories. If the same thing could be written in two ways, you would have to decide which way every time you create a node, and breaking things down would stall.

**“Ready now” is empty**

If a cycle is the cause, that cycle appears at the top of the list. Fix it with “Split” (→ 7. Tidying up). If no cycle is shown, then everything unfinished is “Waiting”, or everything is done. Check whether there is something at the bottom of the waiting chain that you have not broken down yet.

**Something that is only waiting stays in “Ready now”**

For a node that is waiting on a reply or on stock, cut out the part you can finish today as a prerequisite, and write why it is waiting in the note (→ 3. Breaking down, “Tips for naming”).

**Clicking marked things as done that I did not expect**

You can revert it with “Undo” in the header. Then review how things are linked. This happens when something where “any one will do” is linked as a prerequisite (→ 6. Moving forward).

**I deleted something by mistake**

If it was just now, “Undo” brings it back. It only goes back one step, so do it before your next action.

**Can I edit directly in Obsidian?**

You can read from anywhere, but please write from the app (→ 8. Handing off). If you did write there, Auto-fix picks up any contradictions.

**I want to see the tutorial again**

Click “Help” in the header, and “Take the tutorial again” is at the top of this manual.

## 10. Support

Sirube is free. If it helps you, I would be glad if you supported it on Ko-fi. I will keep maintaining it as far as I can.

https://ko-fi.com/motimotinotch
