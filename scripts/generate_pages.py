#!/usr/bin/env python3
"""YZRS NOTE — 作品カードHTML生成スクリプト

data/data.json を読み込み、template/yzrs-note-template.html の
{{PLACEHOLDER}} を各作品データで置換して output/ に出力する。
data/overrides/{id}.json が存在すれば、その差分をマージして適用する。
標準ライブラリのみで動作する。

実行:
    python scripts/generate_pages.py
"""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TEMPLATE_PATH = ROOT / "template" / "yzrs-note-template.html"
DATA_PATH = ROOT / "data" / "data.json"
OVERRIDES_DIR = ROOT / "data" / "overrides"
PHOTOS_DIR = ROOT / "photos"
OUTPUT_DIR = ROOT / "output"

# 編集対象要素 → (STYLEプレースホルダ名, CSSクラス, フィールド名)
# クラス単位の override（font_size / line_height / text_style）と
# フィールド単位の override（transform = 位置オフセット）を1つの style 属性に合成する。
ELEMENT_STYLES = [
    ("HEADER_TITLE_JP_STYLE", "header-title-jp", "title_en"),
    ("TYPE_STYLE",            "s-val",           "type"),
    ("RARITY_STYLE",          "s-val",           "rarity"),
    ("STARS_VAL_STYLE",       "stars-val",       "stars"),
    ("CONCEPT_STYLE",         "concept-text",    "concept_jp"),
    ("MEMO_STYLE",            "memo-text",       "memo"),
    ("SIZE_STYLE",            "spec-val",        "size"),
    ("MOUNT_STYLE",           "spec-val",        "mount"),
    ("POWER_STYLE",           "spec-val",        "power"),
    ("MCU_STYLE",             "spec-val",        "mcu"),
    ("PARTS_STYLE",           "spec-val",        "parts"),
    ("WIRE_STYLE",            "spec-val",        "wire"),
]

# text_align で許可する値（不正値は黙って無視＝stylesheet 既定）
TEXT_ALIGN_ALLOWED = ("left", "center", "right", "justify")

# テキストオーバーライド対応：override.text[FIELD] → context KEY
TEXT_FIELDS = {
    "title_en":   "TITLE_EN",
    "title_jp":   "SUBTITLE_JP",
    "year":       "YEAR",
    "size_short": "SIZE_SHORT",
    "type":       "TYPE",
    "rarity":     "RARITY",
    "size":       "SIZE",
    "mount":      "MOUNT",
    "power":      "POWER",
    "mcu":        "MCU",
    "wire":       "WIRE",
}


def render_difficulty(level):
    """difficulty（1〜5の数値）を ★ 表示用 HTML に変換する。"""
    level = max(0, min(5, int(level)))
    filled = "★" * level
    dimmed = "★" * (5 - level)
    if dimmed:
        return f'{filled}<span class="dim">{dimmed}</span>'
    return filled


def render_stars_from_array(arr):
    """5要素のブール配列から ★ 表示用 HTML を生成する。

    非単調パターン（例: [T,F,T,F,T]）も忠実に表現するため、
    各スターを個別 span でラップする。
    """
    parts = []
    for i, on in enumerate(arr[:5]):
        if on:
            parts.append("★")
        else:
            parts.append('<span class="dim">★</span>')
    # 残りを dim で埋める（配列が5未満なら）
    for _ in range(5 - len(arr)):
        parts.append('<span class="dim">★</span>')
    return "".join(parts)


def render_photo(work, override_photo=None):
    """photo フィールドの有無で visual-box の中身を切り替える。

    override に photo.file があれば優先。object-fit / object-position も
    style 属性として出力する。
    """
    if override_photo and override_photo.get("file"):
        f = override_photo["file"]
        fit = override_photo.get("object_fit", "cover")
        pos = override_photo.get("object_position", "50% 50%")
        alt = work.get("title_en", "")
        style = f'object-fit:{fit};object-position:{pos}'
        scale = override_photo.get("scale")
        if scale is not None and float(scale) != 1:
            style += f';transform:scale({_num(scale)})'
        return f'<img src="../photos/{f}" alt="{alt}" style="{style}">'
    photo = work.get("photo")
    if photo:
        return f'<img src="../photos/{photo}" alt="{work.get("title_en", "")}">'
    return '<span class="photo-placeholder">PHOTO HERE</span>'


def to_html_text(text):
    """改行を <br> に変換する（concept / memo 用）。"""
    return "<br>".join(text.split("\n"))


def load_override(work_id):
    """data/overrides/{id}.json を読み込む。無ければ空 dict。"""
    p = OVERRIDES_DIR / f"{work_id}.json"
    if not p.exists():
        return {}
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        print(f"  ⚠ override {p.name} のJSONが壊れています: {e}（無視して処理続行）")
        return {}


def _text_with_override(work, override, field):
    """override.text[field] があればそれ、無ければ work[field]。"""
    t = override.get("text") or {}
    if field in t:
        return t[field]
    return work.get(field, "")


def _num(v):
    """数値を末尾の余分な 0 を落として文字列化する（line-height 等）。"""
    f = float(v)
    if f == int(f):
        return str(int(f))
    return ("%.3f" % f).rstrip("0").rstrip(".")


def _class_style_parts(css_class, override):
    """1クラス分の inline style 宣言リストを組み立てる。
    font_size[class]（px）/ line_height[class]（無単位）に加え、
    text_style[class]（letter_spacing px / font_weight / text_align / color）をマージする。
    """
    parts = []
    fs = (override.get("font_size") or {}).get(css_class)
    if fs is not None:
        parts.append(f"font-size:{int(fs)}px")
    lh = (override.get("line_height") or {}).get(css_class)
    if lh is not None:
        parts.append(f"line-height:{_num(lh)}")
    ts = (override.get("text_style") or {}).get(css_class) or {}
    if ts.get("letter_spacing") is not None:
        parts.append(f"letter-spacing:{_num(ts['letter_spacing'])}px")
    if ts.get("font_weight") is not None:
        parts.append(f"font-weight:{int(ts['font_weight'])}")
    if ts.get("text_align") in TEXT_ALIGN_ALLOWED:
        parts.append(f"text-align:{ts['text_align']}")
    if ts.get("color"):
        parts.append(f"color:{ts['color']}")
    return parts


def _transform_parts(field, override):
    """フィールド単位の位置オフセット（transform.dx/dy px）。両方 0 なら無し。"""
    tr = (override.get("transform") or {}).get(field) or {}
    dx = tr.get("dx") or 0
    dy = tr.get("dy") or 0
    if dx or dy:
        return [f"transform:translate({_num(dx)}px,{_num(dy)}px)"]
    return []


def _element_style(css_class, field, override):
    """1要素分の style 属性（クラス単位 + フィールド単位の合成）。無ければ空文字。"""
    parts = _class_style_parts(css_class, override) + _transform_parts(field, override)
    if not parts:
        return ""
    return 'style="' + ";".join(parts) + '"'


def _col_style(override):
    """spacing.scale から col-left / col-right の gap・縦 padding を縮める inline style。
    無ければ空文字（＝stylesheet 既定の gap:20px / padding:22px 24px 26px）。
    """
    sp = override.get("spacing") or {}
    scale = sp.get("scale")
    if scale is None:
        return ""
    s = float(scale)
    gap = _num(round(20 * s, 2))
    pt = _num(round(22 * s, 2))
    pb = _num(round(26 * s, 2))
    return f'style="gap:{gap}px;padding:{pt}px 24px {pb}px"'


def build_context(work, override):
    """1作品分のプレースホルダ置換テーブルを組み立てる。

    override が渡されればテキスト・font_size・layout・stars・photo を反映する。
    """
    # テキスト系
    title_en   = _text_with_override(work, override, "title_en")
    title_jp   = _text_with_override(work, override, "title_jp")
    year       = _text_with_override(work, override, "year") or "2026"
    size_short = _text_with_override(work, override, "size_short")
    type_v     = _text_with_override(work, override, "type")
    rarity     = _text_with_override(work, override, "rarity")
    size       = _text_with_override(work, override, "size")
    mount      = _text_with_override(work, override, "mount")
    power      = _text_with_override(work, override, "power")
    mcu        = _text_with_override(work, override, "mcu")
    wire       = _text_with_override(work, override, "wire")

    # 改行入り
    ot = override.get("text") or {}
    concept_jp = ot.get("concept_jp", work.get("concept_jp", ""))
    memo       = ot.get("memo", work.get("memo", ""))

    # PARTS：override は文字列、無ければ data の配列を join
    if "parts" in ot:
        parts = ot["parts"]
    else:
        parts = ", ".join(work.get("parts", []))

    # DIFFICULTY：stars 配列があればそれ、無ければ数値
    if isinstance(override.get("stars"), list):
        difficulty_html = render_stars_from_array(override["stars"])
    else:
        difficulty_html = render_difficulty(work.get("difficulty", 0))

    # PHOTO
    photo_html = render_photo(work, override.get("photo"))

    # font_size / line_height / text_style / transform → 要素別 STYLE プレースホルダ
    style_ctx = {}
    for ph_name, css_class, field in ELEMENT_STYLES:
        style_ctx[ph_name] = _element_style(css_class, field, override)

    # layout → BODY_STYLE
    layout = override.get("layout") or {}
    if "left_fr" in layout or "right_fr" in layout:
        lf = float(layout.get("left_fr", 1.0))
        rf = float(layout.get("right_fr", 1.0))
        body_style = f'style="grid-template-columns: {lf}fr 1px {rf}fr"'
    else:
        body_style = ""

    ctx = {
        "TITLE_EN":    title_en,
        "SUBTITLE_JP": title_jp,
        "YEAR":        year,
        "ID":          work.get("id", ""),
        "SIZE_SHORT":  size_short,
        "PHOTO_HTML":  photo_html,
        "TYPE":        type_v,
        "RARITY":      rarity,
        "DIFFICULTY":  difficulty_html,
        "CONCEPT":     to_html_text(concept_jp),
        "MEMO":        to_html_text(memo),
        "SIZE":        size,
        "MOUNT":       mount,
        "POWER":       power,
        "MCU":         mcu,
        "PARTS":       parts,
        "WIRE":        wire,
        "BODY_STYLE":  body_style,
        "COL_STYLE":   _col_style(override),
    }
    ctx.update(style_ctx)
    return ctx


def render(template, context):
    """テンプレート中の {{KEY}} を context の値で置換する。"""
    html = template
    for key, value in context.items():
        html = html.replace("{{" + key + "}}", str(value))
    return html


def generate_one(work, template):
    """1作品をHTML化して output/ に書き出す。override 自動読込。"""
    override = load_override(work["id"])
    context = build_context(work, override)
    html = render(template, context)
    filename = f"yzrs-note-{work['id']}-{work['title_en']}.html"
    out_path = OUTPUT_DIR / filename
    with open(out_path, "w", encoding="utf-8", newline="\n") as f:
        f.write(html)
    has_ov = " (override適用)" if override else ""
    print(f"生成: {filename}{has_ov}")
    return filename


def main():
    template = TEMPLATE_PATH.read_text(encoding="utf-8")
    works = json.loads(DATA_PATH.read_text(encoding="utf-8"))
    OUTPUT_DIR.mkdir(exist_ok=True)

    for work in works:
        generate_one(work, template)

    print(f"完了: {len(works)} 作品を output/ に出力しました。")


if __name__ == "__main__":
    main()
