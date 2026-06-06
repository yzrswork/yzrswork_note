# YZRSWORK Editorial Editor — Stabilization Log v1

> Permanent engineering log for the editor stabilization phase. Written for future
> maintainers (human or Claude Code sessions) onboarding to this codebase. It records
> what was built, the rules it must obey, and why those rules exist.

---

## 1. Project Context

The YZRSWORK Editorial Editor is a single-user, local, vanilla-JS tool for laying out
A5 "note" cards that document hardware works. It edits cards visually in the browser and
saves **differences against baseline data**, not full documents.

Key properties of the system as it exists today:

- **Purpose.** Per-card visual editing (text, difficulty stars, photo crop/position,
  typography, column layout) on top of authored baseline data, producing print-ready A5
  HTML pages.
- **Render-only philosophy.** The output pipeline (`scripts/generate_pages.py`) merges
  baseline + override into a static HTML template and writes `output/yzrs-note-*.html`.
  Output is a pure render target: it contains no editor logic, classes, or state.
- **Sparse override architecture.** Canonical editorial truth lives only in
  `data/overrides/<id>.json`. Each file stores **only** the keys that differ from
  baseline (`data/data.json`). Absent keys inherit baseline. This keeps intent explicit,
  diffs small, and rendering deterministic.
- **Disposable iframe architecture.** The editor shows the real generated card inside an
  iframe and decorates/mutates it for live preview. The iframe DOM is a **projection**,
  never a source of truth; it can be torn down and rebuilt from state at any time.
- **Additive-module philosophy.** Each feature is an independent script that registers on
  a thin shared hub (`core.js`) via `onChange` / `onCardSwitch` / `onIframeLoad` /
  `onInspectorRender`. `editor.js` orchestrates; modules attach. No feature reaches into
  another feature's internals.
- **Windows 11 environment.** Primary target is Windows 11 + Chrome. Implementation avoids
  macOS/Retina assumptions, fractional-pixel dependence, CRLF/LF corruption, and
  path-separator assumptions.
- **Why contamination prevention matters.** The output HTML is the deliverable (it gets
  printed). Any editor class, injected CSS, overlay, or debug marker leaking into output
  would corrupt the print artifact. The editor/output boundary is therefore a hard
  guarantee, verified by grep, not assumed.

---

## 2. Core Architectural Rules

These are the final, non-negotiable rules. Every feature obeys them.

1. **The iframe DOM is never the source of truth.**
   *Rationale:* the iframe is regenerated on rebuild/reload/card-switch; treating it as
   state would make truth unreconstructable and tie persistence to render timing.

2. **State → projection only (never projection → state).**
   *Rationale:* one-directional flow keeps reasoning local and deterministic. Reading
   values back out of rendered DOM invites drift between what is saved and what is shown.

3. **No `MutationObserver`, no reactive synchronization engine.**
   *Rationale:* observers create implicit, order-dependent feedback loops. The editor
   instead re-projects explicitly after a known state change.

4. **No persistent iframe element cache.**
   *Rationale:* cached element references dangle after any iframe reload. Modules query
   fresh each time (`fieldToElements`, direct `querySelector`).

5. **Output HTML must remain editor-clean.**
   *Rationale:* the print artifact must contain zero editor traces. All editor CSS is
   injected into the **iframe document** (or a separate editor overlay layer), never the
   generated template.

6. **Sparse, deterministic override model.**
   *Rationale:* store only intentional differences. Deterministic, key-order-independent
   serialization makes dirty-state and equality reliable.

7. **Additive-module expansion only.**
   *Rationale:* features must not require editing each other. New capability = new module +
   hub registration + (optionally) a minimal exposed helper on the hub.

8. **`editor.js` stays orchestration-light.**
   *Rationale:* it owns selection, projection, save/load, and the hub wiring. Feature logic
   (locks, overflow, heatmap, autofit, cleanup) lives in modules, not in `editor.js`.

9. **Unknown override keys must be preserved.**
   *Rationale:* forward compatibility. Cleanup and serialization subtract known-redundant
   keys; they never reserialize by whitelist, so a future module's keys survive untouched.

10. **Fail toward preservation, not deletion.**
    *Rationale:* editorial data outranks tidiness. When equality/ownership is uncertain,
    keep the data. False negatives (leftover redundancy) are acceptable; false positives
    (lost intent) are not.

---

## 3. Implemented Tasks Overview

| Task | Feature | Status | Notes |
|---|---|---|---|
| 1 | Session Restore + Recent Cards | Complete | `storage.js`. Persists `lastCardId` + `recentCards` (max 5) in `localStorage` key `yzrs.editor.session.v1`. Corruption-safe: load is `try/catch`, bad data is discarded and reset to defaults. |
| 2 | Undo / Redo | Complete | `history.js`. Snapshots **override state only** (never iframe DOM). Max 50 states, immutable via `structuredClone`, input coalesced with 350 ms debounce. `locks` excluded from history. |
| 3 | Print Guides | Complete | `guides.js`. A5 SAFE / CUT / BLEED overlay drawn in an editor overlay layer **above** the iframe (`pointer-events:none`), dimensions derived from iframe width in mm. Never touches output. |
| 4 | Overflow Detection | Complete | `overflow.js`. Flags field overflow and page (A5) overflow with editor-only outlines injected into the iframe. Exposes `pageMetrics()` (read-only, `clientWidth`-based A5 target, `>1px` tolerance). |
| 5 | Lock System | Complete | `locks.js`. Field-level locks stored in `override.locks`. Disables inspector controls + marks iframe elements. Lock is editor-protection state, persisted but kept out of history. |
| 6 | Diff Heatmap | Complete | `heatmap.js`. Editor-only visualization of which fields carry overrides, by override-key existence. Uses background tints + inset box-shadow (outline-free) so it never competes with lock/overflow/selection outlines. |
| 7 | Auto-Fit | Complete | `autofit.js`. Manual, deterministic, staged overflow mitigation: line-height → spacing → font-size → warning. Bounded binary search, safety floors, locks-aware, single undo step. No layout rebalance. |
| 8 | Override Cleanup | Complete | `cleanup.js`. Manual, conservative removal of override keys provably equal to baseline or identity-default. Never touches locks, `font_size`, `line_height`, unknown keys, or locked fields. Reversible (one undo); persists via normal save. |

---

## 4. Final State Model

An override is a sparse JSON object. Only differing keys are present; everything else
inherits baseline (`data/data.json`).

**Slices:** `schema_version` (always `1`), `id`, `text`, `font_size`, `line_height`,
`spacing`, `layout`, `stars`, `photo`, `locks`, plus any future/unknown keys (preserved).

**Sparse text override** — only `memo` differs from baseline:

```json
{
  "schema_version": 1,
  "id": "001",
  "text": { "memo": "revised assembly note" }
}
```

**Lock slice** — protection state, value-independent:

```json
{
  "schema_version": 1,
  "id": "001",
  "locks": { "memo": true, "stars": true }
}
```

**Layout override** — column ratio (baseline default is `1 / 1`):

```json
{
  "schema_version": 1,
  "id": "001",
  "layout": { "left_fr": 1.2, "right_fr": 0.9 }
}
```

**Font / spacing / line-height override** — typically produced by Auto-Fit or manual tuning:

```json
{
  "schema_version": 1,
  "id": "001",
  "font_size":   { "concept-text": 11, "spec-val": 9 },
  "line_height": { "concept-text": 1.6 },
  "spacing":     { "scale": 0.8 }
}
```

**Baseline inheritance.** `baselineText(field)` in `editor.js` is the single source of
truth for "value rendered when the override is absent" (e.g. `parts` joins the baseline
array with `", "`). Both live projection (`effectiveText`) and Task 8 cleanup use it, so
they cannot disagree about what baseline means.

**Deterministic hashing & canonical serialization.** Dirty-state compares a
`stableStringify(canonicalOverride(...))` hash against the last-saved hash.
`canonicalOverride` strips structural/empty slices (`id`, `schema_version`, empty
containers) and `stableStringify` sorts object keys, so logically-equal overrides hash
identically regardless of key order.

**Dirty-state calculation.** `markDirty()` recomputes the hash on every change;
`state.dirty = (currentHash !== savedHash)`. After save/load, `clearDirty()` rebases
`savedHash` to the current state. Undoing back to the saved state clears dirty naturally.

---

## 5. History System Design

- **Snapshot strategy.** Each history entry is a deep clone (`structuredClone`, JSON
  fallback) of the **override object only**, with non-historical slices removed
  (`NON_HISTORICAL = ['locks']`). The iframe DOM is never snapshotted.
- **Debounce strategy.** Changes schedule a commit via a 350 ms debounce
  (`record()` → `commitPending()`), so a burst of edits (typing, a multi-setter Auto-Fit,
  a Cleanup batch) coalesces into **one** undo step.
- **Why locks are excluded.** Locks are editor-protection state, not editorial content.
  `historical()` strips `locks` before comparison and storage, so a lock toggle is a
  no-op for history and undo/redo never adds/removes a lock.
- **Undo/redo guarantees.** `apply()` sets `_applyingHistory` (so re-entrant `record()`
  is suppressed), restores the target override, **re-attaches the live locks**, re-projects
  via `applyOverrideToDom`, clears selection, and recomputes dirty. Max depth 50.
- **Rollback behavior.** Undo restores content/layout/typography exactly to a prior
  committed state while preserving current locks. A pending debounce is flushed before an
  undo so nothing is lost mid-keystroke.
- **Why iframe DOM snapshots are forbidden.** The DOM is regenerated by rebuild/reload and
  is not canonical. Snapshotting it would couple history to render timing and break
  reconstruction. Snapshotting state keeps undo independent of projection.

**Edge cases handled:** undo back to baseline clears content but keeps locks; locks-only
changes never create history entries; applying history does not recursively record.

---

## 6. Lock System Design

- **Field-level lock philosophy.** Locks protect confirmed fields from accidental edits.
  They are stored sparsely as `override.locks = { field: true }`.
- **Why locks are editor-state, not editorial-state.** A lock changes *who may edit*, not
  *what the card says*. It therefore lives outside the content-history timeline but inside
  the persisted override (so it survives reload).
- **Persistence behavior.** Locks save/load with the override like any slice. The server
  deletes an override file only when **every** slice — including `locks` — is empty
  (`is_empty`), so a locks-only override is a legitimate, persisted file.
- **Why lock state survives undo/redo.** History excludes locks (§5); `apply()`
  re-attaches the live locks after restoring content. Undo cannot resurrect or drop a lock.
- **DOM marker projection strategy.** Locks inject editor-only CSS into the iframe and tag
  locked elements with `.__locked__`; the inspector disables that field's controls (the
  lock toggle itself stays enabled). Markers are re-projected on change/iframe-load; no
  element references are cached.

**Final global visual priority order:**

```
locked  >  overflow  >  heatmap  >  selected
```

Enforced **by CSS specificity/exclusion**, not by `<style>` injection order:

- `.editor-selected:not(.__locked__):not(.__overflow__):not(.__page_overflow__)` — selection
  yields to locked and overflow.
- `.__overflow__:not(.__locked__)` / `.__page_overflow__:not(.__locked__)` — overflow yields
  to locked.
- heatmap uses `background` + inset `box-shadow` (no outline), a separate visual channel
  that coexists beneath all outline indicators.

**Why this ordering exists.** Lock is a safety state — the user must always see that a
field is protected, even when it also overflows or is selected. Overflow is a correctness
warning and outranks mere selection. Heatmap is ambient information and must never mask a
warning or a lock. Selection is the most transient signal, so it yields to all of them.

---

## 7. Overflow + Auto-Fit Strategy

- **A5 overflow philosophy.** The print target is A5 (148 × 210 mm). The authoritative
  signal is **page-level** overflow: page `scrollHeight` exceeds the A5 target height
  derived from on-screen width (`clientWidth * 210/148`), with a `>1px` tolerance.
- **Page-overflow vs field-overflow.** Field overflow (a single block exceeding its box)
  is a local hint; **page overflow** is the real print failure. Auto-Fit optimizes against
  page overflow, not per-field heuristics.
- **Monotonic reduction strategy.** Each Auto-Fit stage reduces one lever that is
  monotonic in page height (smaller → shorter-or-equal), so a bounded binary search finds
  the minimal reduction that fits. Stages are cumulative; each rechecks page fit and stops
  as soon as the page fits.
- **Why layout rebalance was removed.** Column-ratio changes affect text wrapping and are
  **non-monotonic** in page height (and visually surprising). Auto-Fit is overflow
  mitigation, not layout intelligence, so the layout stage was dropped to preserve
  determinism and predictability. Manual layout editing remains available.
- **Safety floors (hard minimums).** line-height ≥ `1.30`, spacing scale ≥ `0.60`,
  font-size ≥ `10px`. These guarantee readable output; Auto-Fit will warn rather than go
  below them.
- **Why Auto-Fit is explicit/manual.** It runs only on a button click (page) or a per-field
  inspector action — never on typing, load, or in a background loop. One click = one
  bounded, synchronous pass = one undo step. No rAF, observers, retries, or learning.
- **Why preservation bias matters.** Locked fields are excluded from adjustment. If the
  page cannot fit within the floors, Auto-Fit applies best-effort minimums and surfaces a
  **visible warning chip** rather than silently mangling typography or content.

**Auto-Fit order (final):**

```
Stage 1  line-height   (floor 1.30,  binary search 0.05)
Stage 2  spacing scale (floor 0.60,  binary search 0.02; skipped if layout is locked)
Stage 3  font-size     (floor 10px,  binary search 0.5px)   ← typography shrink is last
Stage 4  warning only  (no layout rebalance; best-effort minimums already applied)
```

Least-disruptive lever first (line-height), most-noticeable (font-size) last.

---

## 8. Cleanup System Philosophy

- **Why cleanup is manual.** It is an explicit toolbar action with a dry-run confirmation,
  not save-time mutation. Silent normalization on save risks destroying intent and
  surprising the user; an explicit, reviewable action does not.
- **Why cleanup is conservative.** It removes only what it can prove is redundant against
  baseline or an identity default. Everything uncertain is kept (Rule 10).
- **What can be safely removed:**
  - `text.<field>` equal to `baselineText(field)`,
  - `stars` equal to the baseline difficulty array,
  - `photo` whose `file` equals the baseline photo **and** `object_fit`/`object_position`
    are defaults **and** the object has no unknown sub-keys,
  - `spacing` with `scale === 1` (identity),
  - `layout` equal to `{ left_fr: 1, right_fr: 1 }` (the `_merged` default).
- **What must NEVER be auto-removed:** `locks`; unknown/future keys; any slice belonging
  to a **locked** field; and `font_size` / `line_height` (see below).
- **Why unknown keys are preserved.** Cleanup is *subtractive* — it deletes specific
  known-redundant keys and copies everything else through. It never rebuilds the object by
  whitelist, so future schema extensions survive untouched.
- **Why `font_size` and `line_height` are intentionally retained.** Their baseline lives in
  template CSS, not in `data/data.json`, so the editor has no authoritative baseline to
  compare against. They are also the primary output of approved Auto-Fit adjustments.
  Removing them risks deleting real intent, so they are preserved by design (under-cleaning,
  never wrong-cleaning).

**Example — input override:**

```json
{
  "schema_version": 1, "id": "001",
  "text": { "memo": "<equals baseline>", "concept_jp": "edited" },
  "stars": [true, true, true, true, false],
  "spacing": { "scale": 1 },
  "font_size": { "memo-text": 11 },
  "future_widget": { "x": 1 }
}
```

**After cleanup** (memo, stars, identity spacing removed; everything else kept):

```json
{
  "schema_version": 1, "id": "001",
  "text": { "concept_jp": "edited" },
  "font_size": { "memo-text": 11 },
  "future_widget": { "x": 1 }
}
```

Cleanup applies as one reversible edit (single undo restores all removed keys) and persists
through the normal save path; if every slice becomes empty, the server deletes the file.

---

## 9. Output Isolation Guarantees

All editor decoration is confined to the iframe document or a separate editor overlay
layer in the parent page. The generated template carries none of it.

- **No editor classes in output.** `.editor-selected`, `.__locked__`, `.__overflow__`,
  `.__page_overflow__`, `.override-*`, `data-editor-field` exist only at runtime in the
  iframe DOM, added by editor scripts — not in the template or generated files.
- **No heatmap traces.** Heatmap CSS is injected as `#__heatmap_css__` into the iframe head
  and removed/reapplied at runtime; nothing reaches output.
- **No lock traces.** Lock marker CSS (`#__locks_css__`) and `.__locked__` tags are
  runtime-only iframe decorations.
- **No selection traces.** Selection outline CSS lives in `#__editor_overlay__` injected
  into the iframe; selection classes are stripped on clear/card-switch.
- **No injected-CSS leakage.** Every injected `<style>` targets the iframe document or the
  parent overlay layer. The generator never reads or copies these.
- **Render-only rebuild guarantee.** `scripts/generate_pages.py` merges baseline + override
  into the static template and writes `output/`. The only override-driven additions are
  legitimate inline style attributes (font-size, line-height, column gap/padding, grid
  columns) and content — no classes, scripts, or editor markers.

**Verification performed.** A grep over `output/*.html` for 13 editor markers
(`editor-selected`, `__locked__`, `__overflow__`, `__page_overflow__`, `override-text`,
`override-font`, `override-layout`, `override-locked`, `__heatmap_css__`,
`__editor_overlay__`, `data-editor-field`, `__editor_preview__`, `autofit-`) returns zero
hits. A clean-baseline regeneration (no override files) produces elements with no inline
style attributes, confirming Absence = baseline render.

---

## 10. Windows 11 Considerations

- **CRLF/LF handling.** Equality and dirty-state operate on parsed JSON values, not raw
  bytes, so line-ending differences do not produce false diffs. The server writes JSON with
  a pinned `\n` + trailing newline to avoid churn.
- **`localStorage` corruption handling.** Session load is wrapped in `try/catch` with shape
  validation; corrupt or malformed data is discarded (`removeItem`) and reset to defaults.
  Writes ignore quota/serialization failures rather than throwing.
- **DPI / fractional-pixel tolerance.** Overflow detection uses integer-px reads and a
  `>1px` tolerance against a `clientWidth`-derived A5 target. Auto-Fit uses integer font
  steps and unitless line-heights. No Retina/`devicePixelRatio` assumptions.
- **Path-separator neutrality.** The client performs no path math; the server uses
  `pathlib` for all file paths. Uploaded photo names are server-minted from a slug + random
  suffix, avoiding OS-specific filename hazards.
- **Atomic file writes.** Override saves write to a `.json.tmp` file and `os.replace()` it
  into place — atomic on Windows — so an interrupted save never leaves a half-written
  canonical file.
- **Browser rendering assumptions.** Target is Chrome on Windows 11. Layout math is derived
  from live element measurements (`clientWidth`, `scrollHeight`), not hardcoded
  platform/display constants.

---

## 11. Verification Summary

- **Syntax validation.** All 10 editor JS modules pass `node --check`; both Python files
  (`generate_pages.py`, `editor_server.py`) pass `py_compile`.
- **Headless assertions.**
  - Cleanup logic: 20/20 — baseline-equal removal; differing values kept; locked fields
    immutable; `font_size`/`line_height`/unknown keys preserved; identity spacing/layout
    removed; non-identity and unknown-photo-subkey preserved.
  - Auto-Fit order: 7/7 — small overflow resolved by line-height first (no spacing/font
    written); impossible overflow drives all three levers to floors (1.30 / 0.60 / 10) plus
    a visible warning chip.
  - History/locks: 6/6 — undo restores content while preserving live locks; undo-to-baseline
    keeps locks; redo keeps locks; locks-only change is a history no-op.
- **Save/load tests (live server).** Sparse text override round-trips; locks-only override
  persists (not cleared); empty override clears and deletes the file; `cleanup.js` served
  with HTTP 200.
- **Undo/redo tests.** Covered by the history/locks headless suite, including debounce
  coalescing and live-lock preservation across undo and redo.
- **Lock persistence tests.** Locks-only save/reload confirmed via the server round-trip;
  history exclusion confirmed headlessly.
- **Cleanup tests.** See headless assertions above, plus protection cases (locked,
  non-redundant, unknown sub-key).
- **Output contamination grep tests.** Zero hits across 13 markers in `output/*.html`;
  clean-baseline regen yields no inline styles.
- **Overflow / generator round-trip.** Generator emits the expected inline styles for
  font/line-height/spacing/layout and omits them at baseline (Absence = restore).

Results are reported as-is. The headless Auto-Fit/overflow tests use a synthetic page-height
model (not a real browser layout engine), so they validate **control flow, ordering,
floors, and state writes** — not pixel-exact wrapping. Real layout behavior is exercised
manually in-browser.

---

## 12. Known Remaining Risks

- **Baseline drift.** Auto-Fit's `LH_BASE` constants and cleanup's identity assumptions
  encode current template defaults. A template restyle can silently desync them.
  *Acceptable because* the failure mode is under-adjustment / under-cleaning, never data
  loss; constants live beside the code that uses them and are easy to update.
- **CSS default dependency.** Because `font_size`/`line_height` baselines live in template
  CSS (not data), cleanup intentionally cannot reduce font/line-height overrides equal to
  template defaults. *Acceptable because* preserving them protects Auto-Fit/manual intent;
  the cost is residual redundancy, not incorrectness.
- **Manual cleanup cadence.** Redundant overrides accumulate until a user runs Cleanup.
  *Acceptable because* automatic save-time mutation was explicitly rejected to avoid silent
  intent loss; redundancy is harmless to rendering.
- **Heatmap redundancy over-reporting.** Heatmap flags by override-key existence, so a
  redundant (baseline-equal) key tints until cleaned. *Acceptable because* it is a visual
  hint, not truth; Task 8 is the remedy, and over-reporting fails safe.
- **Future-feature guard requirements.** New override slices must be added deliberately to
  `canonicalOverride` (dirty hashing), the server `is_empty` check, `applyOverrideToDom`
  (projection), and — if reducible — cleanup. Forgetting one degrades gracefully (a slice
  simply isn't hashed/cleaned) but should be checked when extending the schema.

---

## 13. Final Architectural Outcome

- **Architecture stabilized.** The eight tasks are integrated without regressions and
  without altering the core model. State remains sparse and canonical; the iframe remains a
  disposable projection; modules remain additive.
- **Editor is production-usable.** Session restore, undo/redo, print guides, overflow
  detection, locks, heatmap, Auto-Fit, and cleanup are implemented, tested, and isolated
  from output.
- **Future work should focus on UX, not architecture rewrite.** The hard constraints
  (render-only output, sparse truth, one-directional projection, locks-outside-history,
  preservation bias) are stable. Improvements should be incremental modules and interaction
  polish, not framework migration or a synchronization engine.
- **Additive expansion remains viable.** New features attach via the existing hub seams and
  exposed helpers; the schema extends by adding slices, not by reshaping existing ones.
- **Render-only philosophy survived implementation intact.** Despite adding live typography,
  layout, and cleanup behavior, the output pipeline still emits clean, editor-free A5 HTML.
  The editor/output boundary held and is verified, not assumed.
