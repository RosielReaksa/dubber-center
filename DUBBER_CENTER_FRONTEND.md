# Dubber Center — Frontend Plan

The website for the Dubber Center: a public model catalog, a customer area (dub videos, jobs, keys, credits) and an admin dashboard. This file covers design, UX and build steps. The backend is in `DUBBER_CENTER_PROJECT.md`.

**Style goal:** the calm, warm, editorial feel of the Claude website, with the practical catalog-and-dashboard UX of OpenRouter. It must feel fast, smooth and uncluttered.

> "Inspired by" means we borrow the qualities (warm neutrals, serif headings, generous space, quiet borders), not logos, exact brand assets or copied pages. Use your own name, logo and licensed fonts.

---

## 1. Principles

1. **Calm and clear.** Few colors, lots of space, one accent. No visual noise.
2. **Fast first.** Every screen shows something within 200 ms (skeletons), never a blank page or a spinner on a white screen.
3. **Catalog-first UX.** Finding and trying a model takes under a minute: search, filter, open, try.
4. **Copy-paste friendly.** Model IDs, API keys and code snippets have a copy button everywhere.
5. **Problems first in admin.** What needs attention is shown before charts.
6. **Plain words.** Errors say what happened and what to do next, never raw stack traces.
7. **Works in Khmer and English** from day one (fonts, text length, switcher).

## 2. Stack (defaults, change if needed)

| Need | Choice |
|---|---|
| Framework | **Next.js** (App Router) + **TypeScript** |
| Styling | **Tailwind CSS** with CSS variables for tokens |
| UI primitives | **shadcn/ui** (Radix) for accessible dialogs, menus, tabs, tooltips |
| Server state | **TanStack Query** |
| Forms | **react-hook-form** + **zod** |
| Tables | **TanStack Table** (+ virtualization for long lists) |
| Charts | **Recharts** (simple) or **visx** (custom) |
| Icons | **lucide-react** |
| Motion | **Framer Motion** (small, purposeful) |
| Code editor (manifest) | **CodeMirror 6** (light) or Monaco (lazy loaded) |
| i18n | **next-intl** (en, km) |
| API client | Generated from the backend OpenAPI file (`openapi-typescript` + `openapi-fetch`) |
| Mock and tests | **MSW**, **Vitest**, **Playwright** |
| Auth | Session login (see section 11, backend additions) |

Decision for now: **one Next.js app** with three areas, `(marketing)`, `(app)` and `(admin)`. Admin can be split into its own app later without rewriting components.

## 3. Design language

### 3.1 Color tokens

Warm neutrals with one terracotta-style accent. Defined as CSS variables, used through Tailwind.

```css
:root {
  --bg:            #FAF9F5;  /* page, warm off-white */
  --surface:       #FFFFFF;  /* cards, inputs */
  --surface-2:     #F3F1EA;  /* subtle panels, table header, hover */
  --border:        #E7E4DA;
  --border-strong: #D5D1C4;

  --text:          #1F1E1B;
  --text-muted:    #6B675E;
  --text-faint:    #9A968B;

  --accent:        #C96442;  /* primary buttons, links, focus */
  --accent-hover:  #B5573A;
  --accent-soft:   #F6E4DC;  /* tinted backgrounds, selected rows */
  --on-accent:     #FFFFFF;

  --success: #3F7D58;  --success-soft: #E3F0E8;
  --warning: #B7791F;  --warning-soft: #F8EBCF;
  --danger:  #B3402F;  --danger-soft:  #F7E1DC;
  --info:    #3B6EA5;  --info-soft:    #E1ECF6;

  --radius-sm: 8px;    /* controls */
  --radius-md: 12px;   /* cards */
  --radius-lg: 16px;   /* modals, large panels */
}

[data-theme="dark"] {
  --bg:            #1C1B18;
  --surface:       #262521;
  --surface-2:     #2F2D28;
  --border:        #3A3832;
  --border-strong: #4A473F;

  --text:          #F2EFE8;
  --text-muted:    #A8A396;
  --text-faint:    #7E7A6F;

  --accent:        #D9785A;
  --accent-hover:  #E58A6D;
  --accent-soft:   #3A2A24;
  --on-accent:     #1C1B18;

  --success: #6BB487;  --success-soft: #1F2E25;
  --warning: #D9A441;  --warning-soft: #33291A;
  --danger:  #E07A68;  --danger-soft:  #382320;
  --info:    #7FA9D6;  --info-soft:    #1E2A38;
}
```

Rules:
- One accent color only. Status colors are used only for status.
- Text on colored backgrounds uses the matching dark tone, never pure black or gray.
- Check contrast: body text at least 4.5:1 in both themes.
- Default theme follows the system, with a manual toggle that is remembered.

### 3.2 Typography

| Use | Font | Notes |
|---|---|---|
| Headings, hero, big numbers | **Source Serif 4** (open license) | Gives the editorial, calm feel. Fallback: Georgia, serif. |
| Body, UI, tables | **Inter** | Fallback: system-ui. |
| Code, IDs, keys | **JetBrains Mono** | Model IDs like `paidv1` always in mono. |
| Khmer | **Noto Sans Khmer** (UI) and **Noto Serif Khmer** (headings) | Load only when the locale is `km`. Use slightly larger line height. |

Scale: 12, 13, 14 (default UI), 16 (body), 20, 24, 32, 44 (hero). Weights: 400 and 500 only. Line height 1.6 for body, 1.2 for headings. Sentence case everywhere, no ALL CAPS labels.

Load fonts with `next/font` (self-hosted, `display: swap`, subset) to avoid layout shift.

### 3.3 Surfaces, borders and shadows

- Cards are flat: 1px `--border`, `--surface` background, radius 12. No heavy shadows.
- Only menus, popovers and modals get a soft shadow.
- Dividers are 1px `--border`. Prefer space over lines where possible.
- Max content width: 1120px for pages, 1280px for the admin tables.

### 3.4 Spacing and layout

- 4px base grid. Common gaps: 8, 12, 16, 24, 32, 48.
- Page padding: 16 on mobile, 24 on tablet, 32 on desktop.
- Section spacing on marketing pages: 80 to 120px.

### 3.5 Motion (smoothness)

- Duration 120 to 200 ms, easing `ease-out`. Nothing longer than 300 ms.
- Animate only `opacity` and `transform` (cheap, no layout jank).
- Use motion for: page fade-in, dialog and drawer open, toast in and out, accordion, progress bar change, number count-up on the overview.
- Respect `prefers-reduced-motion`: turn animations off.
- Hover: background shifts to `--surface-2`. Focus: 2px accent ring with 2px offset, always visible for keyboard users.

### 3.6 Components look

| Component | Style |
|---|---|
| Primary button | Accent background, white text, radius 8, height 36 (40 in forms). Hover darkens. |
| Secondary button | Surface background, 1px border, text color. |
| Ghost button | No border, hover `--surface-2`. |
| Input | Surface background, 1px border, radius 8, accent ring on focus. |
| Badge | Soft status background with matching dark text, radius 999, 12px. |
| Table | No outer border box, header on `--surface-2`, row hover tint, sticky header. |
| Tabs | Underline style, accent underline on the active tab. |
| Toast | Bottom right, 4 s, with an action when useful ("Undo", "View job"). |
| Empty state | Small icon, one sentence, one primary action. |

## 4. Information architecture

```
(marketing)
  /                       Landing: what it is, featured models, quickstart
  /models                 Model catalog (public)
  /models/[id]            Model detail
  /docs                   Docs and quickstart
  /status                 Public status of each model
  /login  /signup

(app)  — signed-in customer area
  /dub                    Dub studio (new job)
  /jobs                   Activity (all my jobs)
  /jobs/[id]              Job page
  /keys                   API keys
  /credits                Balance, top-up, history
  /usage                  My usage and cost
  /settings               Profile, webhooks, language, theme

(admin)  — role: support, admin, owner
  /admin                  Overview
  /admin/models           Models (+ /new, /[id])
  /admin/jobs             Jobs (+ /[id])
  /admin/users            Users (+ /[id])
  /admin/usage            Usage and billing
  /admin/queue            Queue and workers
  /admin/alerts           Alerts
  /admin/settings         Settings
  /admin/audit            Audit log
```

Global helpers:
- **Command palette** (`Cmd/Ctrl + K`): jump to any page, search models, search jobs by ID.
- **Language switcher** (English, Khmer) and **theme toggle** in the top bar and in settings.
- **Breadcrumbs** on detail pages.

## 5. Screens (customer side)

### 5.1 Landing `/`
- Hero (serif, 44px): one-line promise, short subtitle, two buttons: "Browse models" and "Read the docs".
- Live strip: number of models, languages, jobs dubbed.
- Featured models (3 cards).
- "How it works" in three steps: pick a model, upload, download.
- Code snippet block with tabs (curl, Python, JavaScript) and a copy button.
- Footer: docs, status, contact.

### 5.2 Model catalog `/models` (OpenRouter-style)

```
┌──────────────────────────────────────────────────────────────┐
│  Models                                    [ Search models…  ]│
│  12 models                       Sort: Popular ▾   [grid|list]│
├───────────────┬──────────────────────────────────────────────┤
│ Filters       │  paidv1                  [copy id]  API       │
│  Type         │  Full dubbing through paid APIs               │
│  ☐ API        │  en→km · th→km     $0.40/min   ~0.5x   99.2% │
│  ☐ Local      ├──────────────────────────────────────────────┤
│  ☐ Hybrid     │  localv1                 [copy id]  Local     │
│  Language     │  Full dubbing on local models                 │
│  Source ▾     │  en→km             $0.05/min   ~2x     97.8% │
│  Target ▾     ├──────────────────────────────────────────────┤
│  Price        │  …                                            │
│  ─○───────    │                                               │
│  Features     │                                               │
│  ☐ Subtitles  │                                               │
│  ☐ Multi-spk  │                                               │
│  Status       │                                               │
│  ☐ Active     │                                               │
└───────────────┴──────────────────────────────────────────────┘
```

- Search is instant (debounced 200 ms) and matches name, ID and description.
- Filters: type, source language, target language, price range, features, status, and a "Healthy only" toggle. All filter state lives **in the URL** so links are shareable and the back button works.
- Each row shows the model's **health state** with the shared status dot (see 5.11), for example "Degraded", not just a colored dot.
- Sort: popular, cheapest, fastest, newest, most reliable.
- Each row shows: name, ID with copy button, one-line description, type badge, language pairs (max 2 then "+3"), price per minute, average speed, 30-day success rate, health dot.
- Grid and list toggle, remembered.
- Server-render the first page for speed. Filtering after that happens on the client with cached data.
- Empty result: "No models match these filters" with a "Clear filters" button.

### 5.3 Model detail `/models/[id]`
Header: name, ID (copy), type badge, status dot, "Try this model" (primary) and "Use in API" (secondary).

Tabs:
1. **Overview:** description, features, limits (max minutes, concurrency), average time, success rate chart (30 days).
2. **Languages:** searchable matrix of supported source and target languages.
3. **Pricing:** price per minute, an estimator ("Video length: 12 min → about $4.80"), what is included.
4. **Try it:** mini playground (see Dub studio, limited to a short clip).
5. **API:** ready-to-copy snippets for this model in curl, Python and JavaScript, with the user's real key prefix filled in when signed in.
6. **Status:** uptime bar for the last 30 days, recent incidents.

### 5.4 Dub studio `/dub`

Single page, three clear blocks, no wizard.

```
 1  Video            [ Drop a video here or browse ]   or paste a URL
                      mp4, mov, mkv, webm · up to 2 GB · 60 min

 2  Settings         Model        [ paidv1 ▾ ]  (or "Auto")
                      From         [ English ▾ ]  →  To  [ Khmer ▾ ]
                      Options      ☐ Subtitles   ☐ Keep background audio

 3  Summary          Length 12:40 · Estimated cost $5.06 · Your credits $22.00
                      [ Start dubbing ]
```

- Upload goes straight to storage with a presigned URL. Show a progress bar with speed and time left, and let the user cancel.
- After upload, read the video length in the browser and show the **estimated cost live** as model and options change.
- The language dropdowns only show languages the chosen model supports. If a pair is not supported, say so and suggest models that do support it.
- The button is disabled with a clear reason: "Add credits", "Choose a language", "Video too long for this model".
- On submit: go to the job page immediately (optimistic), do not wait.
- Remember the last used model and languages.

### 5.5 Job page `/jobs/[id]`

```
 Job 01H…   paidv1   en → km             [ Running ]
 ──────────────────────────────────────────────────
 ████████████░░░░░░░░  62%   Voice generation · about 4 min left
 Queued ✓   Transcribing ✓   Translating ✓   Voice ●   Finishing ○

 ┌── Original ─────────┐  ┌── Dubbed ───────────┐
 │       ▶ video       │  │       ▶ video       │   [ Sync playback ]
 └─────────────────────┘  └─────────────────────┘

 Downloads   Video · Audio · Subtitles (.srt) · Timing JSON
 Details     Cost $5.06 · Duration 7m 12s · Created 14:32 · Model paidv1
 Timeline    14:32 queued · 14:33 started · …
```

- Live progress: poll every 2 s while running, slow to 10 s after a few minutes, stop when finished. If the backend adds an events stream, use it instead.
- The stage list comes from the model's progress messages. If a model gives only a percentage, show the percentage.
- When done: the dubbed player appears, with a confetti-free, quiet "Done" state and the download buttons.
- When failed: a plain-language reason, the model's error code in a collapsed "Technical details" block, and two buttons: "Retry" and "Try another model".
- "Cancel job" is available while queued or running, with a confirmation.
- The page can be left and reopened any time. Jobs always survive a refresh.

### 5.6 Activity `/jobs`
- Table: status, created time, model, languages, length, cost, actions. Filters for status, model and date, kept in the URL.
- Row click opens the job page. Running jobs update in place.
- Bulk actions: none at first. Keep it simple.

### 5.7 API keys `/keys`
- List: name, key prefix (`dk_live_ab12…`), created, last used, status.
- "Create key" opens a dialog (name, optional limits). The full key is shown **once** with a copy button and a clear warning, then only the prefix is ever shown.
- Revoke asks for confirmation and states what will stop working.

### 5.8 Credits `/credits`
- Big balance number (serif), recent transactions table, "Add credits" button (top-up amounts and a custom amount).
- Low-balance banner when credits are under the user's threshold.

### 5.9 Usage `/usage`
- Date range picker, charts for minutes dubbed and cost per day, table grouped by model. CSV export.

### 5.10 Settings `/settings`
- Profile, default model and languages, webhook URL and a "Send test webhook" button, language, theme.

### 5.11 Model status display

The backend separates **configured status** (`active`, `beta`, `disabled`, set by an admin) from **health state** (`healthy`, `degraded`, `down`, `unknown`, measured by the system). The UI shows both, always as text plus an icon, never color alone.

**Health states**

| State | Dot and icon | Label | Tooltip text |
|---|---|---|---|
| healthy | green dot, check | Healthy | "Working normally. Checked 40 s ago." |
| degraded | amber dot, alert triangle | Degraded | "Working but slower or less reliable than usual." |
| down | red dot, x | Unavailable | "Not accepting new jobs right now." |
| unknown | gray dot, dash | No data | "Not enough data yet." |

Configured `beta` shows a "Beta" badge next to the state. Configured `disabled` shows a gray "Disabled" badge and replaces the health state.

**Shared components**

| Component | What it does |
|---|---|
| `StatusDot` | Dot + label + tooltip with "since" and "checked" times. Sizes: small (tables) and normal (headers). |
| `UptimeBar` | 30 small blocks, one per day, colored by that day's state. Hover shows the date, uptime percentage and any incident. Shows "99.2% uptime" beside it. |
| `StatusBanner` | A full-width notice for degraded or down, with a plain sentence and a useful action. |
| `IncidentList` | Recent incidents: date, state, duration, short summary, "Resolved" or "Ongoing". |

**Model detail, Status tab**

```
 Status   ● Degraded   since 2 h ago · checked 40 s ago

 Last 30 days                                       99.2% uptime
 ▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▯▮▮▮▮▮▮▮▮▮▮▮▮▮▮     (hover a block for details)

 Last 24 hours
 Success rate 93%    Average time 6m 10s    Slowest 10% 11m 50s

 Recent incidents
 Oct 27   Degraded   ongoing   Slower than usual
 Oct 21   Down       38 min    Provider unavailable        Resolved
```

**Where status appears and what it changes**

| Place | healthy | degraded | down |
|---|---|---|---|
| Catalog row and model header | Green state | Amber state | Red state, row slightly muted |
| Model detail | Nothing extra | `StatusBanner`: "This model is slower than usual. Estimated time is longer." | `StatusBanner`: "This model is unavailable right now." with "See other models" |
| Dub studio model picker | Normal | Warning line under the picker, longer time estimate | Option disabled with "Unavailable", the next best healthy models suggested, and **Auto** keeps working |
| Dub studio submit | Normal | Normal, but the summary shows the longer estimate | If the model goes down while the user is on the page, show a dialog: "paidv1 became unavailable. Use localv1 instead?" |
| Job submit error `model_unavailable` | Not applicable | Not applicable | Dialog with the same choice (switch model, or wait), never a raw error |
| Job page | Normal | Note if the model was degraded when the job started | Running jobs continue as normal, no scary banner |
| Public `/status` | Row with green state | Row with amber state | Row with red state |

**Public status page `/status`**
- One row per model: name, state, 30-day `UptimeBar`, uptime percentage.
- An "Ongoing incidents" block at the top, shown only when something is wrong. When all is well it says "All systems normal".
- Refreshes every 60 seconds (pause when the tab is hidden).
- Shows only the short public data from `GET /v1/status`. No internal error codes, hostnames or job IDs.

**Data used:** `health_state`, `health_since`, `checked_at`, `success_rate_24h`, `avg_duration_sec`, `uptime_30d`, `daily[]`, `incidents[]` from `GET /v1/models`, `GET /v1/models/{id}/status` and `GET /v1/status`.

**Smoothness:** status data is cached for 30 seconds (catalog) and 60 seconds (status page). A state change fades the dot color over 200 ms and never moves the layout. The `UptimeBar` has a fixed height so it never shifts the page while loading, and it shows a skeleton of 30 gray blocks.

## 6. Screens (admin)

Shell: left sidebar (icons plus labels, collapsible), top bar with global search, alerts bell with a count, theme toggle, user menu. The sidebar shows only the pages the user's role may open.

### 6.1 Overview `/admin`

```
 Needs attention
 ┌──────────────────────────────────────────────────────────┐
 │ ● localv1 health check failed 3 times            [Open]   │
 │ ● 12 jobs failed in the last hour (paidv1)       [Open]   │
 └──────────────────────────────────────────────────────────┘

 Jobs today   Success rate   Active   In queue   Revenue   Cost   Margin
   248          97.6%          9         14       $412     $96    $316

 [ Jobs over time, stacked by status ]   [ Revenue vs cost ]

 Model health                              Recent failures
 paidv1   ● healthy   99.2%   0.5x          job_01H…  paidv1  Timeout   [View]
 localv1  ● down      91.0%   2.0x          job_01H…  localv1 GPU out…  [View]
```

- "Needs attention" is always first. It hides when empty and shows "All systems normal".
- Every number is a link that opens the related page already filtered.
- Date range switcher: today, 7 days, 30 days.

### 6.2 Models `/admin/models`
- Table: name, ID, type, status, health dot, success rate, average time, price, concurrency, queue paused.
- Row actions: edit, enable or disable, pause queue, test.
- **Add or edit model** opens a full page with two columns: a form on the left, and a **manifest editor (YAML)** on the right with live validation from `validate-manifest` and a preview of how the model will look in the public catalog.
- "Test with sample video" runs a small job and shows its result inline before the model goes active.
- Disable shows a dry-run summary ("3 running jobs will finish, 12 queued jobs will be rejected") in the confirm dialog.

### 6.3 Jobs `/admin/jobs`
- Filter bar (status, model, user, date, search by ID) with saved filter presets. Filters live in the URL.
- Virtualized table so 10,000+ rows stay smooth.
- Row click opens a **side panel quick view**. "Open full page" goes to `/admin/jobs/[id]`.
- Full page: timeline (queued, running, retry, fallback, done), logs viewer (monospace, search, copy), files with download buttons, cost, error in plain words, admin notes, and actions: retry, cancel.
- Bulk select for retry and cancel with a confirmation.

### 6.4 Users `/admin/users`
- Table: email, plan, role, status, credits, jobs, last active.
- User page: profile, credits (with "Add credits" and a required reason), keys list (prefix only), recent jobs, suspend button.

### 6.5 Usage and billing `/admin/usage`
- Group by model, user or day. Revenue, cost, margin columns with red for negative margin. CSV export.

### 6.6 Queue and workers `/admin/queue`
- One card per model: waiting, running, longest wait, concurrency used, and a pause or resume switch.
- Workers list with online or offline dot, current job and model, last heartbeat.
- "Sweep stuck jobs" shows the dry run result first.

### 6.7 Alerts, Settings and Audit
- **Alerts:** list of open alerts with severity, subject, time, and "Resolve".
- **Settings:** rate limits, file retention days, alert thresholds. Each setting has a short help text and a save bar that appears only when something changed.
- **Audit log:** who, what, target, time, with an expandable before and after diff.

### 6.8 Model health (admin)

Lives on the admin model page (`/admin/models/[id]`) as a **Health** tab, and as extra columns in the models table. Uses the same `StatusDot`, `UptimeBar` and `IncidentList` from 5.11, with extra detail.

```
 paidv1   ● Degraded since 2 h 10 min        Configured: Active       [ Check now ]

 Last ping      OK · 220 ms · 40 s ago
 Last canary    Failed · output_silent · 18 min ago         Next canary in 42 min
 Last 60 min    Success 91% (33 jobs) · p95 11m 50s · baseline 5m 40s · oldest wait 2 min

 Latency (24 h)   [ line chart ]        Success rate (24 h)   [ line chart ]

 State changes
 14:10  healthy → degraded   Success rate 91% under 90% limit... (reason from backend)
 …

 Check log     Type    Result   Latency   Error code      Time
               ping    OK       220 ms    —               14:31
               canary  Failed   —         output_silent   14:13
 Thresholds    [ use defaults ▾ ]  or override for this model
 Canary        ☑ Enabled   every [ 60 ] min   sample [ sample_en_10s.mp4 ▾ ]   pair [ en → km ]
```

- **Check now** runs a ping and a canary and shows both results inline as they arrive, with a clear "Running…" state. The button is disabled while a check is running.
- The models table gets a **Health** column showing the state and how long ("Down for 12 min"), sortable, and a filter for "Not healthy".
- The Overview "Needs attention" strip gets an entry when a model moves to degraded or down, linking to this tab, and it disappears when the model recovers.
- The Queue page shows each model's health state next to its pause switch.
- **Check log** is filterable by type (ping, canary) and result, and error codes are shown with a plain-language explanation on hover (for example `gpu_unavailable`: "The GPU was not visible to the worker").
- **Thresholds** show the defaults from settings and let an admin override them for this model, with a short help line per field. Saving asks for confirmation and is written to the audit log.
- Canary jobs are not shown in the normal Jobs table. A "Show canary jobs" toggle in the check log links to them.

## 7. Making it feel smooth

| Area | What we do |
|---|---|
| Loading | Skeleton screens shaped like the real content. Never full-page spinners. |
| Navigation | `next/link` prefetch on hover. Keep the layout shell mounted so only the content changes. Short fade on route change. |
| Data | TanStack Query with sensible `staleTime` (catalog 60 s, jobs 0 s while running). Show cached data instantly, then refresh quietly. |
| Actions | Optimistic updates for toggles (enable model, pause queue), with rollback and an error toast on failure. |
| Lists | Virtualize anything longer than 100 rows. Server-side pagination and sorting for jobs. |
| Search | Debounce 200 ms. Cancel in-flight requests when the query changes. |
| Uploads | Direct to storage, with a progress bar. Multipart for files over 100 MB so a dropped connection can resume. |
| Polling | Pause when the tab is hidden. Slow down over time. Stop at a final state. |
| Images and video | Lazy load, correct sizes, `preload="metadata"` for players. |
| Bundles | Route-level code splitting. Lazy load charts, the code editor and the video players. |
| Layout shift | Reserve space for images, fonts via `next/font`, fixed heights for skeletons. |

**Performance targets** (measured with Lighthouse and real-user data):
- LCP under 2.0 s, INP under 200 ms, CLS under 0.1 on the public pages
- Initial JS under 200 KB gzipped on `/models`
- Admin tables scroll at 60 fps with 10,000 rows

## 8. UX details that matter

- **States for everything:** loading, empty, error, success. Each has a designed version.
- **Error messages:** say what happened and the next step. Example: "The video is longer than paidv1 allows (60 min). Choose a shorter video or use localv1."
- **Destructive actions:** confirm dialog that names the object and the impact (using the backend dry run). The confirm button uses danger color and the object's name in its label.
- **Forms:** validate on blur, show errors under the field, keep the user's input on error, disable submit only when needed and always say why.
- **Keyboard:** `Cmd/Ctrl + K` palette, `/` focuses search, `Esc` closes dialogs, full tab order, visible focus.
- **Responsive:** customer area works on phones (single column, bottom-safe buttons). Admin works from tablet width; on phones it shows a read-friendly version of Overview and Jobs.
- **Accessibility:** WCAG 2.2 AA. Semantic HTML, labels on every control, status never by color alone (icon or text too), captions or transcripts for demo videos.
- **Khmer and English:** all text through i18n keys. Test long Khmer strings in buttons and tables, and never cut Khmer text with fixed widths. Dates and numbers use the locale.
- **Copy buttons** on IDs, keys, snippets and job links, with a small "Copied" confirmation.
- **Time:** show relative time ("5 min ago") with the exact time on hover, in the user's time zone.

## 9. Code structure

```
frontend/
├── package.json
├── next.config.ts
├── tailwind.config.ts
├── messages/               # i18n: en.json, km.json
├── public/
└── src/
    ├── app/
    │   ├── (marketing)/    # /, /models, /models/[id], /docs, /status
    │   ├── (app)/          # /dub, /jobs, /keys, /credits, /usage, /settings
    │   ├── (admin)/admin/  # overview, models, jobs, users, usage, queue, alerts, settings, audit
    │   ├── login/  signup/
    │   └── layout.tsx      # fonts, theme, providers
    ├── components/
    │   ├── ui/             # shadcn primitives restyled with our tokens
    │   ├── layout/         # app shell, admin shell, sidebar, topbar, command palette
    │   ├── models/         # ModelCard, ModelFilters, LanguageMatrix, PriceEstimator
    │   ├── jobs/           # JobProgress, JobTimeline, VideoCompare, DownloadList
    │   ├── upload/         # Dropzone, UploadProgress
    │   ├── admin/          # KpiCard, AlertStrip, HealthTable, ManifestEditor, AuditDiff
    │   ├── charts/
    │   └── common/         # CopyButton, StatusBadge, EmptyState, ConfirmDialog, RelativeTime
    ├── lib/
    │   ├── api/            # generated types + client + query keys
    │   ├── auth/
    │   ├── format.ts       # money, minutes, dates
    │   └── utils.ts
    ├── hooks/              # useJob, useModels, useDebounce, useUpload, usePolling
    ├── styles/             # globals.css (tokens), fonts
    └── tests/              # unit + e2e
```

## 10. Build steps (frontend)

Do these in order. Each step ends with **Done when**.

**Step F0 — Project setup**
- Create the Next.js app with TypeScript, Tailwind, ESLint, Prettier. Add shadcn/ui, TanStack Query, react-hook-form, zod, lucide-react, next-intl.
- Add MSW so the frontend can run against fake data before the backend is ready.
- **Done when:** `npm run dev` shows a blank styled page, and lint and type checks pass.

**Step F1 — Design tokens, theme and fonts**
- Add the tokens from 3.1, light and dark, to `globals.css` and map them in Tailwind.
- Load Source Serif 4, Inter, JetBrains Mono and Noto Khmer with `next/font`.
- Build the theme toggle (system, light, dark) without a flash on load.
- **Done when:** a test page shows every token, type scale and component in both themes.

**Step F2 — Base components**
- Restyle shadcn primitives: Button, Input, Select, Checkbox, Switch, Tabs, Dialog, Drawer, Dropdown, Tooltip, Toast, Badge, Table, Skeleton.
- Build common pieces: CopyButton, StatusBadge, EmptyState, ConfirmDialog, RelativeTime, PageHeader.
- **Done when:** a component gallery page (or Storybook) shows all of them with all states.

**Step F3 — App shells and navigation**
- Marketing layout, app layout (top bar, side nav), admin layout (sidebar, top bar, alerts bell).
- Command palette, language switcher, breadcrumbs.
- **Done when:** you can move between all empty pages with smooth transitions and the sidebar remembers its collapsed state.

**Step F4 — API client and auth**
- Generate the typed client from the backend OpenAPI file. Add the query setup, error mapping to friendly messages, and toast handling.
- Build login and signup pages, session handling, route guards for `(app)` and `(admin)` with role checks.
- **Done when:** a signed-in user reaches `/jobs`, a signed-out user is redirected to `/login`, and a `support` user cannot open `/admin/settings`.

**Step F5 — Model catalog and detail (public)**
- Build `/models` with search, filters, sort, grid or list, URL state, skeletons, empty state.
- Build `/models/[id]` with all six tabs (use real data for Overview, Languages, Pricing, API snippets, Status).
- Build the shared status components from 5.11 (`StatusDot`, `UptimeBar`, `StatusBanner`, `IncidentList`), use them in the catalog rows, the model header and the Status tab, and add the "Healthy only" filter.
- Server-render the catalog and model pages.
- **Done when:** filtering is instant, a filtered URL can be shared and reopened, and each tab loads without a layout jump.

**Step F6 — Dub studio**
- Dropzone with direct upload and progress, URL paste option, model and language selectors that respect model support, live cost estimate, submit.
- Model health behavior from 5.11: disabled option for `down` models with suggested alternatives, warning and longer estimate for `degraded`, the "model became unavailable" dialog, and graceful handling of the `model_unavailable` error.
- **Done when:** a user can upload a video and start a job, and sees the job page right away.

**Step F7 — Job page and activity**
- Progress and stage list, polling with backoff, side-by-side players with sync, downloads, failed state with retry, cancel.
- `/jobs` table with filters in the URL and live updates for running jobs.
- **Done when:** a running job updates without refresh, and a failed job offers retry and "try another model".

**Step F8 — Keys, credits, usage, settings**
- Key creation dialog (shown once), revoke, credits page with transactions, usage charts, webhook test.
- **Done when:** a new key can be created and copied once, and a revoked key shows as revoked.

**Step F9 — Docs and quickstart**
- Quickstart page, API reference rendered from the OpenAPI file, code snippets with tabs and copy.
- Public `/status` page from 5.11, with the 60 second refresh and the "All systems normal" state.
- **Done when:** a developer can go from signup to a first dubbed video using only the docs.

**Step F10 — Admin shell and Overview**
- KPI cards, needs-attention strip, charts, model health table, recent failures. Every number links to a filtered page.
- **Done when:** the overview loads with skeletons first and matches the backend numbers.

**Step F11 — Admin Models**
- Table, add and edit page with the YAML manifest editor, live validation, catalog preview, sample test run, enable or disable with dry-run confirmation.
- Health tab and table columns from 6.8: last ping and canary, charts, state changes, check log, "Check now", threshold overrides and canary settings.
- **Done when:** an admin can add a new model from a manifest, test it, and see it appear in the public catalog.

**Step F12 — Admin Jobs**
- Virtualized table, filters and presets, side panel quick view, full job page with timeline, logs, files, retry and cancel, bulk actions.
- **Done when:** 10,000 rows scroll smoothly and a failed job can be retried from the side panel.

**Step F13 — Admin Users, Usage, Queue, Alerts, Settings, Audit**
- Build each page from section 6, with confirmations for dangerous actions.
- **Done when:** every admin route in the backend file (section 14.3) has a screen.

**Step F14 — Polish**
- Add motion (route fade, dialogs, progress), check every loading, empty and error state, full keyboard pass, screen reader pass, Khmer layout pass, reduced-motion pass.
- **Done when:** the accessibility audit shows no serious issues and the performance targets in section 7 are met.

**Step F15 — Tests and deploy**
- Playwright tests: sign up, browse models, upload and dub (with the fake backend adapter), view job, create key, admin disable model.
- Set up CI (lint, types, unit, e2e) and deploy (Vercel, or S3 + CloudFront / Amplify on AWS).
- **Done when:** CI is green and a preview URL is created for each pull request.

## 11. Backend additions the frontend needs

The backend file plans API-key auth for API calls. The website also needs these. Add them to `DUBBER_CENTER_PROJECT.md`:

| Need | Addition |
|---|---|
| Website login | `POST /v1/auth/signup`, `/login`, `/logout`, `GET /v1/auth/me` using a secure session cookie (or a managed login such as Cognito) |
| Browser upload of large files | Multipart upload endpoints: start, presign each part, complete |
| Live job progress without polling | Optional `GET /v1/jobs/{id}/events` (server-sent events) |
| Top-ups | Payment provider integration and `POST /v1/credits/checkout` |
| Model health and status | Defined in `DUBBER_CENTER_PROJECT.md` section 15: `health_state`, `success_rate_24h` and `uptime_30d` in `GET /v1/models`, `GET /v1/models/{id}/status` (uptime bar and incidents), `GET /v1/status` (public page), and admin `check-now` and `health-history` |
| CORS | Allow the website origin, with credentials |
| Admin model editor | `POST /v1/admin/models/validate-manifest` (already in section 14.3) |

## 12. Definition of done (frontend)

- [ ] The same look in light and dark, with no unreadable text in either
- [ ] Catalog, model page, dub studio and job page work from signup to download
- [ ] Every screen has loading, empty and error states
- [ ] Model health states (healthy, degraded, down, unknown) show correctly, with text and icon, in the catalog, model page, dub studio, public status page and admin
- [ ] Admin overview, models, jobs, users, usage, queue, alerts, settings and audit all work with role checks
- [ ] English and Khmer both display correctly everywhere
- [ ] Keyboard-only use works, and the accessibility audit has no serious issues
- [ ] Performance targets are met on the public pages and the large jobs table
- [ ] E2E tests pass in CI

## 13. Open questions

1. Is the website already built, or is this a new site? (decides if we start from scratch or move parts over)
2. What will the product name and logo be? We need them for the header, favicon and page titles.
3. Will customers pay with a card (which provider), or is it invite-only at first?
4. Should the admin live on the same domain (`/admin`) or on its own (`admin.yourdomain.com`)?
5. Which languages must the interface support at launch: English and Khmer only, or more?
6. Do you want a public pricing page and public status page at launch, or later?
