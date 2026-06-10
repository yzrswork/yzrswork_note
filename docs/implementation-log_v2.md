# YZRSWORK Editorial Editor — Fine Editing Log v2

> Permanent engineering log for the "fine editing" phase (Canva / Illustrator-like
> granular control). Continues `implementation-log_v1.md`; all architectural rules
> recorded there remain in force and are not restated, only referenced.

---

## 1. Goal of this phase

Make per-card editing significantly more granular, approaching the feel of Canva /
Illustrator, **without** breaking the stabilized architecture:

- sparse override remains the only editorial truth,
- the iframe stays a disposable projection,
- output HTML stays print-pure (no editor contamination),
- every change is bakeable by `generate_pages.py` (what you see in the editor is
  exactly what prints).

Four capabilities were added:

1. **Workspace zoom / pan** (editor-only, no schema change)
2. **Fine typography** — letter-spacing, font-weight, text-align, color, plus a
   line-height UI for the already-existing `line_height` slice
3. **Free element positioning** — drag / arrow-key nudge per field, baked into output
4. **Photo zoom** — scale inside the 4:3 frame, on top of existing crop + position

---

## 2. Override schema additions (schema_version stays 1 — purely additive)

```jsonc
{
  // クラス単位のタイポグラフィ（font_size / line_height と同じ粒度）
  "text_style": {
    "concept-text": {
      "letter_spacing": 0.5,   // px（小数可）
      "font_weight": 500,      // 400 | 500 | 700
      "text_align": "justify", // left | center | right | justify（他は無視）
      "color": "#8e3514"
    }
  },
  // フィールド単位の位置オフセット（CSS transform: translate, px 整数）
  "transform": {
    "memo": { "dx": 4, "dy": -6 }
  },
  // photo に scale を追加（フレーム内拡大、1.0–3.0）
  "photo": { "file": "…", "object_fit": "cover", "object_position": "40% 60%", "scale": 1.35 }
}
```

Design decisions:

- **`text_style` is class-keyed, `transform` is field-keyed.** Typography is a class
  concern (all `.spec-val` share one look); position is an element concern (move PARTS
  without moving MOUNT). Mixing the two granularities in one slice was rejected.
- **Position uses `transform: translate`, not `position:relative + left/top`.**
  Translate does not change the element's box in flow, so overflow detection and
  Auto-Fit measurements are untouched by offsets.
- **Identity self-cleaning.** `setTransformOverride(field, 0, 0)` deletes the entry;
  photo `scale === 1` deletes the key. Cleanup (Task8) additionally removes identity
  `transform.<field>` found in externally edited JSON, and photo identity now requires
  `scale` absent or 1. `text_style` is **never** cleaned (no authoritative baseline —
  same policy as `font_size` / `line_height`).

## 3. Output pipeline: per-element STYLE placeholders

The template previously shared `{{S_VAL_STYLE}}` (×2) and `{{SPEC_VAL_STYLE}}` (×6).
Per-field transforms require per-element style attributes, so the template now has one
placeholder per editable element (`TYPE_STYLE`, `RARITY_STYLE`, `SIZE_STYLE`, …
`WIRE_STYLE`). `generate_pages.py` composes each as:

```
class-level parts (font_size, line_height, text_style) + field-level parts (transform)
```

via the `ELEMENT_STYLES` table `(placeholder, css_class, field)`. With no override the
attribute renders empty — regenerated outputs were verified **byte-identical** for
override-free cards (backward compatibility proof). `text_align` values outside the
allowed set are silently ignored at bake time (defensive against hand-edited JSON).

## 4. Editor modules

### zoom.js (new, editor-only)

Scales `.frame-stage` (iframe + guides overlay together) with `transform: scale`,
origin 0 0, and sets the stage's box to the scaled size so scrollbars stay correct.
Toolbar −/＋/Fit/1:1, Ctrl+wheel zoom anchored at the cursor (handled both on the
canvas and inside the iframe with coordinate re-mapping), middle-drag pan.
`.canvas-wrap` centering moved from `justify-content:center` to `margin:0 auto` on the
stage — flex-centering clips the left edge once content overflows.
**Why drag-editing still works under zoom:** mouse events inside a CSS-transformed
iframe arrive in the iframe's own (unscaled) coordinate space, so col-divider drag and
nudge drag need no zoom compensation.

### nudge.js (new)

Canva interaction model: click = select (unchanged); dragging an **already selected**
text/stars element moves it (3px threshold separates click from drag). Arrow keys move
1px, Shift+Arrow 10px (suppressed while typing in inputs). Inspector gets an X/Y
section with reset. Writes only through `YZRS.setTransform` (apply + sparse write).
A `_suppressNextClick` flag on the hub prevents the post-drag click from re-selecting
or — critically — toggling a star. Locked fields don't move; preview mode disables all
of it.

### editor.js

- New setters/appliers: `setTextStyleOverride` / `applyTextStyleToClass`,
  `setTransformOverride` / `applyTransformToField` (+ hub exports `setTextStyle`,
  `setTransform`, `getTransform`).
- Inspector: typography section (行間 / 字間 / 太さ / 揃え / 色 with palette from the
  template's DESIGN_SPEC + free picker + 解除) for text and stars selections; photo
  zoom slider next to the position sliders.
- `applyOverrideToDom` normalizes the new slices exactly like the old ones (absent key
  ⇒ inline style cleared), so undo/redo via history.js needed **zero changes**.
- `canonicalOverride` includes the new slices → dirty-hash and save-clearing behave.
- フィールドReset now also deletes `transform.<field>`.

### heatmap.js / cleanup.js / editor_server.py

- Heatmap: `line_height` + `text_style` join `font_size` in the yellow "font" channel;
  `transform.<field>` shows in the blue "layout" channel. Detection stays key-existence
  only.
- Server: `is_empty` recognizes `text_style` / `transform` so an all-cleared override
  still deletes the file.

## 5. Verification (Playwright, Chromium headless, real server)

End-to-end against `editor_server.py`:

- zoom buttons / Fit / 1:1 change stage scale and label; guides stay aligned.
- typography controls mutate iframe inline styles immediately (letter-spacing 2.5px,
  text-align center, color → rgb(181,69,27)).
- drag on selected concept-text → `translate(20px, 10px)`, inspector X/Y sync 20/10;
  ArrowRight + Shift+ArrowDown → `translate(21px, 20px)`.
- 8× undo reverted everything → save correctly **cleared** (no override file).
- edit → save → `001.json` contained exactly the sparse slices; rebuild baked
  `style="letter-spacing:1.2px;text-align:justify;transform:translate(8px,-12px)"`;
  clearing the override and regenerating returned outputs to byte-identical clean state.
- zero page errors in console (the only console noise: favicon 404 and Google Fonts
  TLS, both environmental).

## 6. Known limits / next candidates

- Drag is lost if the cursor leaves the iframe mid-drag (same limitation as the
  existing col-divider drag). Acceptable for now.
- No multi-select, no rotation, no z-order — the card is a flow document, not a free
  canvas; offsets are deliberately bounded "fine adjustment", not absolute positioning.
- Pan is middle-button only; Space-drag pan would require swallowing keyboard events
  inside the iframe and was deferred.
