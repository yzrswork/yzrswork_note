#!/usr/bin/env python3
"""YZRS NOTE — Canva風カードエディタのバックエンド

ローカルFlaskサーバ。http://localhost:5000 を開くとエディタSPAが起動する。

依存: pip install -r requirements.txt
実行: python scripts/editor_server.py
"""

import json
import os
import re
import secrets
import sys
from pathlib import Path

from flask import Flask, abort, jsonify, request, send_from_directory

ROOT = Path(__file__).resolve().parent.parent
DATA_PATH = ROOT / "data" / "data.json"
OVERRIDES_DIR = ROOT / "data" / "overrides"
PHOTOS_DIR = ROOT / "photos"
OUTPUT_DIR = ROOT / "output"
EDITOR_DIR = ROOT / "editor"

OVERRIDES_DIR.mkdir(exist_ok=True)
PHOTOS_DIR.mkdir(exist_ok=True)
OUTPUT_DIR.mkdir(exist_ok=True)

# generate_pages を同プロセス内で呼べるよう sys.path に追加
sys.path.insert(0, str(ROOT / "scripts"))
import generate_pages  # noqa: E402

app = Flask(__name__, static_folder=None)


# ─── 静的：エディタ本体・出力HTML・写真 ─────────────────
@app.get("/")
def index():
    return send_from_directory(EDITOR_DIR, "index.html")


@app.get("/editor/<path:filename>")
def editor_static(filename):
    return send_from_directory(EDITOR_DIR, filename)


@app.get("/output/<path:filename>")
def output_static(filename):
    return send_from_directory(OUTPUT_DIR, filename)


@app.get("/photos/<path:filename>")
def photos_static(filename):
    return send_from_directory(PHOTOS_DIR, filename)


# ─── データ読込 ──────────────────────────────
def _load_data():
    return json.loads(DATA_PATH.read_text(encoding="utf-8"))


def _find_work(work_id):
    for w in _load_data():
        if w["id"] == work_id:
            return w
    return None


def _load_override(work_id):
    p = OVERRIDES_DIR / f"{work_id}.json"
    if not p.exists():
        return {}
    return json.loads(p.read_text(encoding="utf-8"))


def _merged(work, override):
    """data + override を合成した「最終的に使われる値」を返す（エディタ初期表示用）。"""
    text_ov = override.get("text") or {}
    merged_text = {}
    for field in ("title_en", "title_jp", "year", "size_short", "type", "rarity",
                  "size", "mount", "power", "mcu", "wire", "concept_jp",
                  "concept_en", "memo"):
        if field in text_ov:
            merged_text[field] = text_ov[field]
        else:
            merged_text[field] = work.get(field, "")
    # PARTS
    if "parts" in text_ov:
        merged_text["parts"] = text_ov["parts"]
    else:
        merged_text["parts"] = ", ".join(work.get("parts", []))

    # stars
    if isinstance(override.get("stars"), list):
        stars = override["stars"]
    else:
        n = max(0, min(5, int(work.get("difficulty", 0))))
        stars = [True] * n + [False] * (5 - n)

    return {
        "text": merged_text,
        "font_size": override.get("font_size") or {},
        "layout": override.get("layout") or {"left_fr": 1.0, "right_fr": 1.0},
        "stars": stars,
        "photo": override.get("photo") or (
            {"file": work["photo"], "object_fit": "cover", "object_position": "50% 50%"}
            if work.get("photo") else None
        ),
    }


# ─── API: カード一覧 ────────────────────────────
@app.get("/api/cards")
def api_cards():
    works = _load_data()
    out = []
    for w in works:
        has_ov = (OVERRIDES_DIR / f"{w['id']}.json").exists()
        out.append({
            "id": w["id"],
            "title_en": w.get("title_en", ""),
            "title_jp": w.get("title_jp", ""),
            "has_override": has_ov,
        })
    return jsonify(out)


# ─── API: 1カードの取得 ─────────────────────────
@app.get("/api/card/<work_id>")
def api_card_get(work_id):
    work = _find_work(work_id)
    if work is None:
        abort(404)
    override = _load_override(work_id)
    return jsonify({
        "data": work,
        "override": override,
        "merged": _merged(work, override),
    })


# ─── API: 1カードの override 保存 ──────────────────
@app.post("/api/card/<work_id>")
def api_card_save(work_id):
    work = _find_work(work_id)
    if work is None:
        abort(404)
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify({"error": "JSON object required"}), 400
    if payload.get("schema_version") != 1:
        return jsonify({"error": "unsupported schema_version (need 1)"}), 400
    payload["id"] = work_id

    # 空 override（全フィールド未設定）なら override ファイルを削除
    is_empty = (
        not (payload.get("text") or {})
        and not (payload.get("font_size") or {})
        and not (payload.get("layout") or {})
        and not isinstance(payload.get("stars"), list)
        and not payload.get("photo")
    )
    out_path = OVERRIDES_DIR / f"{work_id}.json"
    if is_empty:
        if out_path.exists():
            out_path.unlink()
        return jsonify({"ok": True, "cleared": True})

    tmp_path = out_path.with_suffix(".json.tmp")
    tmp_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    os.replace(tmp_path, out_path)
    return jsonify({"ok": True, "saved": str(out_path.relative_to(ROOT))})


# ─── API: 画像アップロード ────────────────────────
_SLUG_RE = re.compile(r"[^a-z0-9]+")


def _slugify(name):
    base = os.path.splitext(name)[0].lower()
    s = _SLUG_RE.sub("-", base).strip("-")
    return s or "photo"


@app.post("/api/upload-image")
def api_upload_image():
    work_id = request.form.get("id", "")
    if not _find_work(work_id):
        return jsonify({"error": "unknown id"}), 400
    f = request.files.get("file")
    if not f:
        return jsonify({"error": "no file"}), 400
    ext = os.path.splitext(f.filename or "")[1].lower() or ".jpg"
    if ext not in (".jpg", ".jpeg", ".png", ".webp"):
        ext = ".jpg"
    slug = _slugify(f.filename or "photo")
    suffix = secrets.token_hex(3)  # 6 hex chars
    filename = f"{work_id}-{slug}-{suffix}{ext}"
    out_path = PHOTOS_DIR / filename
    f.save(out_path)
    return jsonify({"ok": True, "filename": filename})


# ─── API: rebuild ──────────────────────────────
@app.post("/api/rebuild")
def api_rebuild():
    try:
        generate_pages.main()
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    files = sorted(p.name for p in OUTPUT_DIR.glob("*.html"))
    return jsonify({"ok": True, "files": files})


def main():
    host = os.environ.get("HOST", "127.0.0.1")
    port = int(os.environ.get("PORT", "5000"))
    print(f"YZRS NOTE editor: http://{host}:{port}/")
    app.run(host=host, port=port, debug=False, use_reloader=False)


if __name__ == "__main__":
    main()
