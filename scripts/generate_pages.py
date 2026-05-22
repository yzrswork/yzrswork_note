#!/usr/bin/env python3
"""YZRS NOTE — 作品カードHTML生成スクリプト

data/data.json を読み込み、template/yzrs-note-template.html の
{{PLACEHOLDER}} を各作品データで置換して output/ に出力する。
標準ライブラリのみで動作する。

実行:
    python scripts/generate_pages.py
"""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TEMPLATE_PATH = ROOT / "template" / "yzrs-note-template.html"
DATA_PATH = ROOT / "data" / "data.json"
PHOTOS_DIR = ROOT / "photos"
OUTPUT_DIR = ROOT / "output"


def render_difficulty(level):
    """difficulty（1〜5の数値）を ★ 表示用 HTML に変換する。"""
    level = max(0, min(5, int(level)))
    filled = "★" * level
    dimmed = "★" * (5 - level)
    if dimmed:
        return f'{filled}<span class="dim">{dimmed}</span>'
    return filled


def render_photo(work):
    """photo フィールドの有無で visual-box の中身を切り替える。"""
    photo = work.get("photo")
    if photo:
        return f'<img src="../photos/{photo}" alt="{work.get("title_en", "")}">'
    return '<span class="photo-placeholder">PHOTO HERE</span>'


def to_html_text(text):
    """改行を <br> に変換する（concept / memo 用）。"""
    return "<br>".join(text.split("\n"))


def build_context(work):
    """1作品分のプレースホルダ置換テーブルを組み立てる。"""
    return {
        "TITLE_EN": work.get("title_en", ""),
        "SUBTITLE_JP": work.get("title_jp", ""),
        "YEAR": work.get("year", "2026"),
        "ID": work.get("id", ""),
        "PHOTO_HTML": render_photo(work),
        "TYPE": work.get("type", ""),
        "RARITY": work.get("rarity", ""),
        "DIFFICULTY": render_difficulty(work.get("difficulty", 0)),
        "CONCEPT": to_html_text(work.get("concept_jp", "")),
        "MEMO": to_html_text(work.get("memo", "")),
        "SIZE": work.get("size", ""),
        "MOUNT": work.get("mount", ""),
        "POWER": work.get("power", ""),
        "MCU": work.get("mcu", ""),
        "PARTS": ", ".join(work.get("parts", [])),
        "WIRE": work.get("wire", ""),
    }


def render(template, context):
    """テンプレート中の {{KEY}} を context の値で置換する。"""
    html = template
    for key, value in context.items():
        html = html.replace("{{" + key + "}}", str(value))
    return html


def main():
    template = TEMPLATE_PATH.read_text(encoding="utf-8")
    works = json.loads(DATA_PATH.read_text(encoding="utf-8"))
    OUTPUT_DIR.mkdir(exist_ok=True)

    for work in works:
        context = build_context(work)
        html = render(template, context)
        filename = f"yzrs-note-{work['id']}-{work['title_en']}.html"
        out_path = OUTPUT_DIR / filename
        with open(out_path, "w", encoding="utf-8", newline="\n") as f:
            f.write(html)
        print(f"生成: {filename}")

    print(f"完了: {len(works)} 作品を output/ に出力しました。")


if __name__ == "__main__":
    main()
