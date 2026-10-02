# IHL Patient Explorer

A customizable React app for browsing the synthetic IBD cohort served by a
[smart-on-fhir/fhir-rest-api](https://github.com/smart-on-fhir/fhir-rest-api#usage)
endpoint, built with components from
[smart-on-fhir/clinical-primitives](https://github.com/smart-on-fhir/clinical-primitives).

## Run it

Requires Node.js 20.19+ or 22.12+ (Vite 7).

```bash
npm install      # pulls clinical-primitives from GitHub and builds it (about a minute)
npm run dev      # opens http://localhost:5173
```

Production build: `npm run build && npm run preview`.

## Deploying

The app is static: `npm run build` writes plain files to `dist/`, the browser calls the cohort
API directly, and routing is hash-based, so any static host works. `vite.config.ts` uses
`base: './'` so the build runs from a subpath.

This repo deploys to GitHub Pages with `.github/workflows/deploy.yml` on every push to `main`
(it runs `npm ci` and `npm run build`, then publishes `dist/`). One-time setup in the GitHub
repo: **Settings › Pages › Build and deployment › Source: GitHub Actions**. The site is then at
`https://<user>.github.io/<repo>/`.

Each viewer's layout and section settings live in their own browser storage. The cohort API is
unauthenticated and the data is synthetic; anything pointed at real data needs authentication
(for example SMART on FHIR) before a link is shared.

## Pointing at another cohort

The API base URL defaults to the `sim-ibd-patients` cohort. To change it:

```bash
cp .env.example .env.local   # then edit VITE_FHIR_API_BASE
```

## What's in it

The patient page is a grid of **sections**. Each section has a gear in its header that opens
a modal with its own settings (labs to show, chart height, data source, and so on) plus layout controls
(full or half width, move up or down); changes apply live behind the modal. An × hides the section. The **Sections** button in the top
bar brings hidden sections back and sets the theme. Settings are saved in localStorage.

| Section | Built from | Its settings |
|---|---|---|
| Patient | `PatientSummary` (app) | none |
| Search this record | `RecordSearch` (app) with library `Dialog`, `SourceDialog` | notes-only matches, resource types to leave out, results per page |
| Treatment timeline | `TimelineChart` with `MedicationsTimeline`, `ObservationsTimeline`, `BarChartTimeline` | lab rows, non-IBD meds, encounter classes (or all), rows by class or visit type, endoscopy |
| IBD lab trends | `LabTrendPanel` | labs |
| IBD lab charts | `ObservationChart` per lab | labs, chart height |
| Conditions | `ConditionList` | none |
| Medications | `MedicationList` | prescriptions or administrations |
| Observations | `ObservationsPanel` | which filter tabs |
| Immunizations (hidden by default) | `ImmunizationList` | none |

| File | Purpose |
|---|---|
| `src/search.ts`, `src/components/RecordSearch.tsx`, `src/components/SearchResultDialog.tsx`, `src/components/Highlight.tsx` | Full-text record search: index, query, results, detail dialog |
| `src/routes.ts` | Hash routes: `#/`, `#/patient/<id>`, `#/patient/<id>/encounter/<encId>` |
| `src/components/PatientPage.tsx` | Loads a patient's record once; shows the dashboard or one encounter |
| `src/components/EncounterDetail.tsx`, `src/encounter.ts` | One encounter: details, clinical notes, every linked resource, source viewer. Shown in the timeline sidebar and on the encounter page |
| `src/components/EncounterView.tsx` | Full-page wrapper around `EncounterDetail` with previous/next visit |
| `src/encounterClasses.ts` | Encounter class labels and colors (HL7 v3 ActCode) |
| `src/components/NoteText.tsx` | Renders plain-text notes (headings, bullets) as React elements, never raw HTML |
| `src/api.ts` | Cohort API client: paging, retry with backoff, resolves `medicationReference` to names |
| `src/sections.tsx` | Section registry: title, render, and settings panel for each section |
| `src/settings.ts` | Settings model (layout + per-section config), defaults, persistence |
| `src/components/Section.tsx` | Section frame: header, settings modal with layout controls, hide |
| `src/components/TreatmentTimeline.tsx` | IBD drug-class classifier, lab rows, endoscopy and encounter rows |
| `src/components/LabCharts.tsx`, `src/labs.ts` | Dated lab charts and the lab-to-LOINC map |
| `src/components/PatientList.tsx` | Searchable, sortable, paginated, selectable patient list (`DataGrid`), with cohort record search |
| `src/visits.ts` | Most recent visit and most recent IBD clinic visit per patient, and the IBD clinic visit rule |
| `src/cohortSearch.ts` | Loads and indexes every patient's record (3 at a time, cached for the session) and runs a query across them |
| `src/components/SearchResultsList.tsx` | Result rows shared by the record search and the cohort matches dialog |

### Encounter details

Clicking an encounter or endoscopy bar on the treatment timeline opens that visit in the
timeline's sidebar, the same place medication and lab selections appear. The panel shows:

- The visit's type, class, times, reason, provider, location and clinicians (resolved from the
  record's Practitioner, Location and Organization resources).
- Its clinical notes: DocumentReferences whose `context.encounter` points at it, plus any
  DiagnosticReport with a `presentedForm`. Text notes are decoded as UTF-8 and rendered;
  other attachment types (PDF, images, HTML) go through the library's `AttachmentPreview`.
- Every other resource that references the encounter anywhere, grouped by type. Clicking one
  opens the library's `SourceDialog` (tree and JSON views, references resolved).

"Open as page" shows the same content full width at `#/patient/<id>/encounter/<encId>`, with
previous and next visit buttons, for long notes or a link to share.

The library keeps the chart's selection in a context it does not export, so the encounters row
tracks its own pick: any click in the plot area clears it first (capture phase), and the
clicked encounter bar, if any, selects again. Worth raising upstream: exporting
`useTimelineChartContext`, or passing the selected id to `BarChartTimeline`'s `selection`,
would remove the workaround.

### Record search

Indexes every string and number in every loaded resource, plus the decoded text of inline note
attachments (DocumentReference content, DiagnosticReport presentedForm). IDs, references,
code-system URLs, base64 data and the HTML narrative (`text.div`, which duplicates the note)
are skipped. All words must match somewhere in a resource; quotes keep a phrase together.
Results are newest first, filterable by resource type, with highlighted snippets. Clicking a
result opens a dialog with every matching field, the full note text with matches highlighted,
the raw source, and "Show visit" for the encounter it belongs to (shown with `EncounterDetail`).

### Visit columns (patient list)

**Last visit** and **Last IBD clinic visit** show the date (linking to that visit's page) with
its reason underneath; both sort by date and can be shown or hidden from the grid's column menu.
They come from two cohort-wide calls (Encounter and DocumentReference, field-filtered, about
1 MB together), not from each patient's full record. Visits dated after today are ignored.

An **IBD clinic visit** is an ambulatory or virtual encounter whose reason is an IBD diagnosis
(Crohn's disease, ulcerative colitis, indeterminate colitis, suspected IBD; pathology consults
excluded), or any encounter with a pediatric gastroenterology note. The rule is
`isIbdClinicVisit` in `src/visits.ts`; adjust it there if your definition differs.

### Cohort search (patient list)

The box above the patient grid searches inside every patient's record, with the same rules as
the record search. The first query loads and indexes each record in the browser (three at a
time; about 1.8 MB per patient in this cohort), and matches appear as records finish. A
**Matches** column shows each patient's result count, and "Only patients with matches" hides
the rest. Clicking a count opens that patient's results; picking one opens the patient at
`#/patient/<id>?q=<query>&open=<Type/id>`, with the search run and that result's dialog open.
Clicking a patient's name while a query is active opens them with the search run.

Records and indexes are cached for the session, so opening a patient afterwards does not fetch
again, and the query is remembered when coming back to the list. The API has no server-side
text search, so this is all client-side; for cohorts much larger than this one it would need a
server-side index instead.

### Adding a section

1. Add an id to `SECTION_IDS`, its config type to `SectionConfigs`, and defaults to
   `DEFAULT_SETTINGS` (layout entry and config) in `src/settings.ts`.
2. Add an entry to `SECTIONS` in `src/sections.tsx` with `title`, `render(config, ctx)` and
   optionally `settings(config, set)`. Saved layouts from older versions get the new section
   at its default position.

### Treatment timeline notes

- Medications are grouped by IBD drug class (anti-TNF, other biologic, JAK/S1P,
  immunomodulator, systemic corticosteroid, 5-ASA) by name. Inhaled and topical steroids are
  excluded because this cohort uses them for asthma and eczema.
- IBD therapy courses are always shown, completed ones included. The timeline's own
  "Only show active medications" toggle (gear in the IBD therapy row) applies to the non-IBD
  medications, which are off by default.
- Encounters can be filtered by class (ambulatory, emergency, inpatient, observation, virtual,
  home health, other) or shown all at once, and grouped one row per class or per visit type.
  Defaults are emergency and inpatient, by class.
- Clicking any bar or point opens its details in the timeline sidebar.

## API notes

- CORS allows any origin, but the preflight response does not allow the `Content-Type`
  header, so `src/api.ts` sends JSON bodies without one (a simple request, no preflight).
- `POST /patient/{id}` returns `{ fhir: { [resourceType]: [...] } }` but its `Patient` array
  is empty, so the app takes the Patient resource from the cached cohort list.
- Medication orders reference a `Medication` resource with no display text; `src/api.ts` copies
  the medication's code onto each order so the library can name it.
- The `patients` body filter is ignored on `/patient/`; it works for other resource types.
- Requests fail intermittently with no CORS headers (seen as "Failed to fetch"); `src/api.ts`
  retries network errors, 429 and 5xx up to 3 times with backoff.
- `POST /patient/count` currently returns 502; use `pagination.total` from a list call instead.

## Known library quirks

- `LabTrendPanel` falls back to substring keyword matching, so in this cohort its Weight and
  BMI rows also pick up percentile observations (`77606-2` weight-for-length %, `59576-9`
  BMI percentile %). The dated charts match by LOINC only for that reason.
- `LabTrendPanel`'s LOINC list lacks `38445-3` (stool calprotectin, the code this cohort uses);
  `src/labs.ts` adds it.

- `.cp-row` gets `min-height: 500px` unless an ancestor has a `cp-*` class; `app.css`
  overrides it for the `DataGrid` toolbar.
- clinical-primitives is pre-1.0. `package-lock.json` pins the commit that was tested; run
  `npm update clinical-primitives` to pull the latest `main`.
