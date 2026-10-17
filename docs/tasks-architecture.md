# Tasks (`/staff/tasks`) — data model and sync

Design for the Tasks feature. Covers the whole vision (pages, images,
templates, recipes, repeating pages) so that the slices in steps 2–6 don't
need schema changes between them.

## Guiding decisions

1. **One table for pages and templates.** A template is a page with
   `kind = 'template'`. Same editor, same blocks table. "Create from template"
   is a copy of that row and its blocks (and recipe rows, and images).
2. **One row per block, and each checklist item is its own block** (agreed
   2026-09-13). This is
   the Notion model: `text`, `header`, and `todo` blocks; consecutive `todo`
   blocks render as one checklist. Reasons:
   - Sync granularity: two devices editing different blocks, or ticking
     different checklist items, never overwrite each other. Ticking an item
     is a one-column PATCH on one row.
   - Images attach to "a block or a checklist item" — with items as blocks,
     that's just "images attach to a block". One code path.
   - The completion indicator is `count(todo where done) / count(todo)`.
3. **Ordering with a fractional `position`.** Insert between two blocks =
   midpoint; only the moved row is written. Renumber the page's blocks if a
   gap gets smaller than 1e-6 (practically never).
4. **Client-generated UUIDs** (`crypto.randomUUID()`), so the UI can insert
   optimistically and never waits on the server to know an id.
5. **Sync = poll + focus refresh, like the schedule.** No new dependency.
   Details below. Supabase Realtime now nudges devices on every change
   (see "Live updates").
6. **Same openness as the rest of the site**: anon key, wide-open RLS, no
   auth. Documented as a TODO like the other tables.

## Tables

```sql
-- Pages and templates.
create table if not exists task_pages (
  id           uuid primary key,                       -- client-generated
  kind         text not null check (kind in ('page', 'template')),
  day          date,                                   -- null = undated. Templates are always null.
  title        text not null default '',
  emoji        text not null default '',               -- '' = no icon
  start_min    integer,                                -- minutes since midnight; null = no start time
  template_id  uuid references task_pages (id) on delete set null,
                                                       -- pages only: the template this was copied from
                                                       -- (powers the "Edit template" shortcut)
  is_recipe    boolean not null default false,
  recipe       jsonb not null default '[]',            -- [{ id, amount, unit, name }] — see Recipes
  repeat       jsonb,                                  -- templates only; null = doesn't repeat. See Repeating
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists task_pages_kind_day on task_pages (kind, day);

-- Content blocks. A checklist is a run of consecutive `todo` blocks.
create table if not exists task_blocks (
  id         uuid primary key,                         -- client-generated
  page_id    uuid not null references task_pages (id) on delete cascade,
  position   double precision not null,
  kind       text not null check (kind in ('text', 'header', 'todo')),
  text       text not null default '',                 -- may contain [[ing:<id>|<name>]] tokens (recipes)
  done       boolean not null default false,           -- todo only
  images     jsonb not null default '[]',              -- [{ id, path, w, h }] — objects in Storage
  updated_at timestamptz not null default now()
);
create index if not exists task_blocks_page_pos on task_blocks (page_id, position);

-- Occurrences of a repeating template that must NOT be generated from the
-- rule any more: either because they became a real page, or because they
-- were deleted while still virtual.
create table if not exists task_repeat_exceptions (
  template_id     uuid not null references task_pages (id) on delete cascade,
  occurrence_day  date not null,
  page_id         uuid references task_pages (id) on delete set null,
                  -- the real page this occurrence became; null = skipped/deleted
  primary key (template_id, occurrence_day)
);

-- Keep updated_at honest without trusting clients' clocks.
create or replace function set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
create trigger task_pages_updated  before update on task_pages  for each row execute function set_updated_at();
create trigger task_blocks_updated before update on task_blocks for each row execute function set_updated_at();

-- RLS: wide open, same as the other tables. TODO tighten with staff auth.
alter table task_pages enable row level security;
alter table task_blocks enable row level security;
alter table task_repeat_exceptions enable row level security;
-- (four policies per table: select/insert/update/delete using (true))
```

### Storage (images, step 3)

- Bucket `task-images`, public read, anon write (matches the tables).
- **Objects are immutable and shared.** Path: `images/<image_id>.<ext>`,
  not tied to a page. A block holds a reference `{ id, path, w, h }` in
  `task_blocks.images`; any number of blocks may reference the same object.
  Copying a template, materializing a repeat occurrence, or moving a page
  copies only the reference — no extra storage, ever.
- The client downsizes to max 1600 px on the long edge before upload —
  tablet cameras produce 12 MP files nobody needs on a prep list. `w`/`h`
  let the UI reserve space before the image loads.
- **Deleting a block or page never deletes objects**, since another page may
  still reference the same image. Instead, a cleanup sweep (an admin button,
  later) collects every path referenced in `task_blocks.images`, lists the
  bucket, and removes anything unreferenced. Orphans are harmless until then.
- Consequence: removing an image from a template does not remove it from
  pages already made from that template — they keep their own reference,
  consistent with how everything else diverges from the template.

## Reads the UI needs

Everything is PostgREST with resource embedding via the FKs above, so each
screen is one or two requests.

| Screen | Request |
|---|---|
| Sidebar, day D | `task_pages?kind=eq.page&day=eq.D&select=id,title,emoji,start_min,template_id,task_blocks(kind,done)` |
| Sidebar, undated | same with `day=is.null` |
| Sidebar, repeats for D | `task_pages?kind=eq.template&repeat=not.is.null&select=*,task_repeat_exceptions(occurrence_day,page_id)` — rule evaluated client-side |
| Open page | `task_pages?id=eq.X&select=*,task_blocks(*)` |
| Template picker | `task_pages?kind=eq.template&select=id,title,emoji,is_recipe,repeat` |

Sidebar order: pages with `start_min` first, by `start_min`; then the rest by
`created_at`. (Manual ordering of the rest can be a `position` column later.)

## Sync

Same shape as `Schedule.tsx`: refetch every 5 s while the tab is visible, and
immediately on `visibilitychange`. Two things the editor adds on top:

- **Debounced writes.** Typing patches the block row ~400 ms after the last
  keystroke. Structural edits (Enter, Backspace-merge, `/` conversions,
  reorder, tick a checkbox) write immediately.
- **Dirty guard.** A poll never overwrites a block that has an unsaved local
  edit or is currently focused. Everything else takes the server's version.
  Effect: last-write-wins per row, and you never lose what you're typing.

Every write is a plain PATCH/POST/DELETE on one row (bulk POST with
`Prefer: resolution=merge-duplicates` when copying a template's blocks). No
transactions are needed; the only multi-step write that must not half-apply
is materializing a repeat occurrence, handled below.

### Live updates (Realtime)

`src/lib/tasks-realtime.ts` speaks Supabase Realtime's Phoenix protocol over
a plain WebSocket (still no supabase-js) and subscribes to
`postgres_changes` on the three tables, which must be in the
`supabase_realtime` publication (last block of `tasks.sql`).

- An event is only a nudge: the app refetches the lists (and the open page
  if the change touches it) 250 ms later, after its own queued writes.
- Echoes of our own writes are ignored: the store remembers the rows it wrote
  in the last few seconds (`wroteRecently`).
- The 5 s poll stays until the first event proves events arrive; then it
  runs only if nothing has synced for 60 s. A dropped socket reconnects with
  backoff, at once on wake, and catches up with one refetch.
- Ticking a box updates the sidebar's progress ring locally; several ticks
  share one list refresh.

### Cook mode

"▶ Cook" on a recipe page or template opens `CookMode.tsx`: one step per
screen (every non-empty block except headers; a header names the steps
under it), big text with the pills at the current scale, the amounts that
step uses, its timers and its first photo. Back / Next (or a swipe, or the
arrow keys) move between steps; "Done · next" ticks a checklist step on the
page itself. It opens at the first unticked step. Pages get ×½ ×1 ×2 ×3
buttons, which set `recipe_scale` like rebasing on a row does.

### Who ticked it

- `task_blocks.done_by` (text, "" = unknown) and `done_at` (timestamptz)
  are set on ticking and cleared on unticking; copies from templates start
  clear, moved blocks keep theirs. A done item shows "Sam · 10:42" (or
  "Fri 10:42" on another day) faintly at its right.
- There's no login: the tablet asks "Who's on?" on the first tick of a shift
  (`WhoPicker.tsx`), suggesting the people on today's schedule and recent
  names, and remembers the answer for 10 hours (`who.ts`, localStorage).
  "Not now" stops asking until a reload; the footer chip changes it any time.
- Installs without the two columns keep working: the first write the server
  rejects for them is retried without, and later writes leave them out.

### Kitchen timers

- A step that mentions a time ("rest 30 min", "1 h 15 min", "20–25
  minutes", the lower figure) gets a ⏱ button (`src/lib/tasks-durations.ts`
  finds them; bare "m" doesn't count). Tapping it starts a timer; on an
  untouched repeat that also starts the page.
- Timers are per device (`timers.ts`, localStorage `tasks-timers-v1`): they
  survive a reload and keep running whatever is open. The bar bottom right
  shows each one with pause and cancel; tapping one opens its page.
- When one runs out it turns red and beeps (Web Audio) and buzzes every
  2.5 s for up to two minutes until Stop. Sound needs a tap since load,
  which any touch of the screen gives. Its page's sidebar row shows ⏱ while
  running and "⏰ Done" when it has gone off.
- While a page is open the screen is kept on (Wake Lock).

### Offline and start-up

- **Snapshot.** The lists (days around today, Ongoing, templates) and the
  80 most recently used pages are kept in `localStorage`
  (`tasks-snapshot-v1`), so the app opens with them on screen and refreshes
  behind. Offline it keeps showing them ("Offline — showing the last copy").
- **Writes wait for the connection.** A write that gets no answer (fetch
  throws) is retried in order with backoff, and at once on `online`, holding
  the queue behind it; the status reads "Offline — changes kept, will sync".
  Every step is safe to repeat: `createPage` is an upsert, and an "exists"
  on our own repeat exception counts as success. The queue lives in memory:
  edits made offline survive as long as the app stays open, not a restart.
- **Service worker** (`public/sw.js`, registered in production only): build
  files and task photos cache-first, pages network-first with a 3 s fallback
  to the last copy. Supabase data is never cached there.

### Page cache and prefetch

Every page the sidebar lists is fetched in one request (`getPages`) after the
list loads; templates of untouched occurrences too. Opening a cached page
shows it at once and revalidates it; the lists for the days either side are
built ahead on a day change. A changed page from another device drops out of
the cache and is fetched again on the next list load.

## Templates (step 4)

- Templates have no sidebar section of their own (removed 2026-10-13).
  Every "+" in the sidebar opens the full-screen **New page** view
  (`NewPageView.tsx`): a header naming the day ("New page for Tue 13 Oct",
  "New ongoing page") with a small Blank page button and Close, a title
  filter, then two columns, **Recipes** (`is_recipe`) and **Checklists**,
  side by side on a tablet and stacked on a phone. Rows are ordered repeats
  first, then by title; tapping a row makes the page for that day, its Edit
  button opens the template instead. Each column ends with "+ New recipe" /
  "+ New checklist". Blank page is deliberately low-key: recipes are added
  daily, blank pages rarely.
- Create template: "+ New recipe" / "+ New checklist" insert a
  `task_pages` row with `kind='template'`, an empty title and `is_recipe`
  set by which button was tapped, then open it with the title focused; the
  name, icon, start time and repeat rule are all set in the editor (no
  creation form). Edited in the same editor as a page, marked with a
  Template tag and a "Use for <day>" button; its menu offers Delete only.
- Create page from template: read template + blocks, insert a new page with
  `template_id = template.id`, `kind='page'`, chosen `day` (or null), copied
  `title`/`emoji`/`start_min`/`recipe`, then bulk-insert copied blocks with
  fresh ids, the same positions and every checklist tick cleared (image
  references copied as-is; the objects are shared). After that it is
  independent.
- "Edit template" opens `template_id`. If the template was deleted, the FK
  sets it to null and the shortcut disappears.
- Deleting a template does not touch pages made from it.

## Recipes (step 5)

- `task_pages.recipe` is the ingredient table, an ordered array:
  `[{ id: "a1c3", amount: 300, unit: "g", name: "flour" }]`. Rows are
  defined on the template (add, remove, move up/down) and **copied**
  unchanged onto every page made from it.
- **Scaling** (agreed 2026-09-13): a page never edits its rows. It keeps a
  single `recipe_scale` (double, default 1); every shown amount is
  `amount × scale`. Tapping an amount on a page makes that row the base:
  typing a new value sets `scale = new / row.amount`, so every other row
  follows and precision never drifts across rebasings. "Reset" sets 1.
  Templates always render at ×1. Rows with amount 0 can't be a base.
- **Display**: up to two decimals, trailing zeros trimmed (8.53 pieces,
  212.5 g). No rounding of counts to whole numbers.
- **Ingredient pills** are tokens in block text: `[[ing:a1c3|flour]]`.
  Typing `[` in a block on a recipe page or template opens a picker of the
  rows (filtered as you type); picking one inserts the token. The editor
  renders a token as a non-editable pill reading "300 g flour" from the
  page's rows × scale, so steps follow the scaling. Backspace removes a pill
  whole. The name is cached in the token, which is what's shown (greyed,
  struck through) when the row no longer exists.
- "Ingredients" (the table) vs "Steps" (the blocks) is a segmented toggle on recipe pages and
  templates alike, defaulting to Table; nothing stored.

## Repeating pages (step 6)

- `task_pages.repeat` on a template is our own JSON, shaped after Google
  Calendar's dialog (agreed 2026-09-13), with one addition: a **start
  date**, because a template has no date of its own.
  `{ freq: "daily"|"weekly"|"monthly"|"yearly", interval: 1,
     start: "2026-09-14", weekdays: [1,2,3,4,5], monthly: "day"|"weekday",
     end: { kind: "never" } | { kind: "on", date } | { kind: "after", count } }`
  The weekday circles appear for weekly rules only (as in Google), so "every
  day except Monday" is Weekly with six days ticked; "Every weekday" is
  Weekly on Mon–Fri. The quick menu offers Does not repeat / Daily / Every
  weekday / Weekly on <weekday of start> / Monthly on the nth <weekday> /
  Custom; the rule is shown in plain words ("Every 2 weeks on Tue and Fri,
  until 31 Dec 2026") on the template's chip and in the dialog.
- For a day D, the sidebar loads templates with a rule (with their
  exceptions embedded), keeps those whose rule hits D and that have no
  exception row for D, and lists them as **virtual** occurrences: ↻ icon,
  lighter title, ordered by the template's start time among the real
  pages. Opening one shows a local copy of the template (new ids already
  assigned, ticks cleared) marked "Not started"; nothing is written.
- **Materialize** on the first edit (typing, ticking, photo, move, time,
  emoji…): the local copy is inserted as the page, then the exception
  `(template_id, D, page_id)` is inserted. A unique violation means another
  device got there first: our page is deleted and theirs is opened. A
  materialized occurrence that is later moved keeps its exception on the
  original day, so nothing reappears there.
- **Skip this day** on a virtual occurrence inserts `(template_id, D, null)`.
- Changing the rule only affects untouched occurrences. Deleting a template
  says its repeats stop; pages already started stay (their `template_id`
  goes null via the FK).
- **No confirm dialogs.** Deleting a page or template and skipping an
  occurrence happen on screen at once, with an Undo toast for 6 s; the
  write waits until the toast goes (or the app is left), and the item stays
  out of refreshed lists meanwhile. Deleted blocks (select mode) and removed
  photos are written at once and Undo puts them back.

## Prep steps done days ahead (lead time)

- Some recipe steps happen before the day (soak beans the night before).
  Rather than a second page, a block carries `lead_days` (0 = the page's
  day, N = N days before). On a template, the grip menu's "When" sets it;
  applied to a header it covers the header's section up to the next header.
- **One page, shown on two days** (agreed 2026-09-14). A page on day D with
  blocks at lead N also appears in the sidebar on D−N as a *prep entry*:
  named after the section's first header ("Soak beans"), subtitled "for
  Tue 15 Sept · Hummus", with a done count of just those blocks. Opening it
  (`?page=…&lead=N`) shows that section active, the rest folded under "On
  the day". The page's own entry on D shows the prep section dimmed at the
  top under "Day before". Same blocks, so ticks and amounts are shared and
  scaling flows through pills.
- Prep entries derive from pages in the next 7 days (`listUpcoming`) and
  from untouched repeat occurrences in that window; touching a virtual prep
  entry materializes the occurrence exactly as touching the page would.
  Moving or deleting the page moves or removes its prep entries. Undated
  pages have none.
- Schema: `task_blocks.lead_days integer not null default 0`.

## Moving and copying blocks between pages

- **Select mode** (agreed 2026-09-14): from the page menu ("Select blocks…")
  or a block's grip ("Select…"). Blocks become tappable rows with a check
  box; tapping a header selects its section (up to the next header). A bar
  at the bottom offers Move to…, Copy to…, Delete, Cancel.
- The **page picker** lists a new page (on the sidebar's day), this week's
  pages grouped by day, untouched repeat occurrences in that window (picking
  one starts it), Ongoing, and Templates, with a title filter. The current
  page is excluded.
- Blocks land at the end of the target in their original order. A move is
  one upsert of the same block ids under the new `page_id` (no schema
  change); a copy is one insert with fresh ids. Kind, text, lead time and
  photo references travel; ticks are kept unless the target is a template.
  Ingredient pills keep working when the target shares the source's recipe
  rows (same template); elsewhere they show as a struck-through name.
- A toast confirms the result with an Open link. No undo beyond moving back.

## Code layout

| File | Contents |
|---|---|
| `src/lib/tasks-store.ts` | Types, normalizers, REST store for the three tables (step 2) |
| `src/lib/tasks-images.ts` | Storage upload/copy/delete + client-side downsizing (step 3) |
| `src/lib/tasks-recipe.ts` | Scaling math, token parse/serialize (step 5) |
| `src/lib/tasks-repeat.ts` | Rule → occurrences for a date range (step 6) |
| `src/app/staff/tasks/` | `page.tsx`, `Tasks.tsx` (layout, sidebar, data + sync), `Editor.tsx` (blocks), `PageMenu.tsx`, `EmojiPicker.tsx`, `tasks.module.css` |
| `src/app/staff/tasks/Lightbox.tsx` | Full-screen image viewer (swipe, remove, add) |
| `src/app/staff/tasks/NewPageView.tsx` | The full-screen "+" view: Recipes / Checklists to use or edit, new template, Blank page |
| `src/app/staff/tasks/RecipeTable.tsx` | Ingredient table: editable on templates, scale-by-base-row on pages |
| `src/app/staff/tasks/blockText.ts` | Block text ⇄ contentEditable DOM with pills; caret offset mapping |
| `src/lib/tasks-recipe.ts` | Tokens, amount formatting, scaling helpers |
| `src/lib/tasks-repeat.ts` | Rule type, occurrence maths, presets, plain-words summary |
| `src/app/staff/tasks/RepeatDialog.tsx` | The recurrence editor |
| `src/app/staff/tasks/PagePicker.tsx` | Page chooser for moving/copying blocks |
| `supabase/tasks.sql` | The table SQL above, ready to paste into the SQL editor |
| `supabase/task-images.sql` | Bucket + storage policies |

Not carried over from the other features (agreed 2026-09-13): the
localStorage fallback. With
resource embedding and three related tables it would be a second, sizeable
implementation to keep in step. `/staff/tasks` shows a clear "needs Supabase"
state when the env vars are missing.
