# yzrswork_yzrs-note

**YZRS NOTE** — や印工務店（yzrswork）が制作する電子工作シリーズ「**e-photoframe（いい額縁）**」の作品カードZINE。各作品のスペックとコンセプトをトレーディングカード風のHTMLページとして生成・公開する。

> **📦 vault に統合済み（2026-06-10）**
> このリポジトリは履歴ごと obsidian-vault の `PlayGuide_HTML/yzrsnote_A5_pages/` に
> git subtree で統合された。以後の開発・編集は vault 側で行うこと。
> このリポジトリはアーカイブとして残す（こちらへの直接コミットは不要）。

---

## このリポジトリについて

写真立てに電子工作を組み込んだ作品群を、A5サイズの作品カード形式でドキュメント化するためのテンプレート・データ・生成スクリプトを管理する。

- **シリーズ**：2026-HW-06 e-photoframe（19作品予定）
- **展示予定**：JUNK YARD @ Tiny Café（仙川）、2026年夏〜秋
- **印刷想定**：しまうまプリント A5

「ジャンク美学」を制作思想とし、露出した配線・産業部品・回路をそのまま意匠として扱う。作品カードもその文脈を引き継ぎ、スペックシート的な無骨さと装飾性を両立させたデザインを採用している。

---

## ディレクトリ構造

```
yzrswork_yzrs-note/
├── template/   # HTMLテンプレート（{{PLACEHOLDER}} 形式）
├── data/       # data.json（全作品データ）
├── output/     # 生成済みHTML（gitignore対象予定）
├── scripts/    # generate_pages.py 等の生成スクリプト
├── photos/     # 作品写真（差し込み用）
├── archive/    # 旧版テンプレート・プレビュー
└── README.md
```

---

## ファイル命名規則

- **テンプレート**：`yzrs-note-template.html`
- **生成HTML**：`yzrs-note-{ID3桁}-{title_en}.html`
  - 例：`yzrs-note-001-pdb-1.html`、`yzrs-note-004-howl.html`
- **写真**：`photos/{ID3桁}-{title_en}.jpg`（命名規則は運用しながら確定）

---

## 作品データのスキーマ（予定）

`data/data.json` に全作品データを配列として格納する。1作品 = 1オブジェクト。スキーマ詳細は実装時に確定。

主要フィールド：

- `id`（3桁文字列：`"001"`）
- `title_en` / `title_jp`
- `type`（`power` / `light` / `kinetic` / `sound` / etc.）
- `difficulty`（★1〜5）
- `size` / `mount`
- `power`（後述の表記ルールに従う）
- `mcu` / `wire` / `parts`
- `concept_jp` / `concept_en`
- `photo`（写真ファイル名、未撮影時は `null`）

---

## POWER 表記ルール

電源仕様は以下のフォーマットで統一する：

```
{電圧}/{電流} {コネクタ}
```

- 電圧はDC前提。`DC` は省略（例：`5V`）
- 電流が不明な場合は `n/a`
- コネクタは物理形状名で記述：`3.5mm-jack` / `DC-jack-2.1mm` / `WAGO` / `battery-AA` 等
- 電池複数本は `×N` 表記

**例：**

| 電源 | 表記 |
|---|---|
| 5V 0.5A 3.5mmモノラルジャック | `5V/0.5A 3.5mm-jack` |
| 5V 4A DCジャック2.1mm | `5V/4A DC-jack-2.1mm` |
| 単3電池×2本 | `1.5V/n/a battery-AA×2` |

---

## ビルド（予定）

```bash
python scripts/generate_pages.py
```

`data/data.json` を読み込み、`template/yzrs-note-template.html` の `{{PLACEHOLDER}}` を置換、`output/` に全作品分のHTMLを出力する。

---

## 関連リンク

- 作者：[や印工務店（yzrswork）](https://note.com/yzrswork)
- 制作プロジェクト：2026-HW-06 e-photoframe
- 展示：JUNK YARD @ Tiny Café（仙川） — 2026年夏〜秋

---

## License

作品コンテンツの著作権は や印工務店 に帰属。テンプレートおよび生成スクリプトのコードは自由に参考にしてください。
