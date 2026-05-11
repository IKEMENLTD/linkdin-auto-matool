# S09 受信箱 — Designer Review (r2)

- 対象: `app/(app)/inbox/page.tsx`, `components/inbox/inbox-filter-tabs.tsx`, `components/inbox/inbox-thread-list.tsx`, `server/queries/inbox.ts`
- 設計書: `docs/ui-ux/UI_UX_Design.md` v1.3 §6.11.4 / §25.3
- レビュー観点: UX / ビジュアル / API DX / a11y / 日本語 B2B トーン
- 判定基準: 90+ で PASS
- 前回: r1 = 91/100 PASS (BORDERLINE)

---

## 総合スコア

**合計: 95 / 100 → PASS**

| 軸 | r1 | r2 | 差分 | コメント要約 |
|----|---:|---:|---:|--------------|
| 1. ビジュアル (Refined Hydro Minimalism) | 18 | 19 | +1 | スコア列追加で情報密度が設計書ワイヤーに一致。grid 6 列はやや過密だが許容範囲 |
| 2. 設計書整合 (§6.11.4 / §25.3) | 18 | 19 | +1 | "各行のスコア" が明示列として復活。残るはキーボード / 保存ビューのみ |
| 3. インタラクション (URL同期/debounce/遷移) | 19 | 19 | 0 | r1 から変更なし。aria-live は依然未対応 (MEDIUM) |
| 4. a11y (tabパターン / SLA三重表現) | 17 | 19 | +2 | tabパターンを潔く撤回し `role="group"` + `aria-pressed` に統一。中途半端さ解消 |
| 5. 日本語 B2B トーン (敬体 / 絵文字なし / §25.3) | 19 | 19 | 0 | 変更なし。"NEW" 英大文字は MEDIUM のまま継続 |

---

## R1 指摘の解消状況

### HIGH 3 件

| # | r1 指摘 | r2 対応 | 判定 |
|---|---------|--------|------|
| HIGH 1 | キーボードショートカット (`J/K`, `G then I`, `⌘K`) 未実装 | Phase2 carry (本 PR スコープ外と明示) | **保留 (Phase2)** |
| HIGH 2 | WAI-ARIA tabs パターン不完全 (`role="tab"` に `aria-controls` 無し) | `role="group" aria-label="受信箱フィルタ"` + button `aria-pressed={active}` へ格下げ | **解消** |
| HIGH 3 | "各行のスコア" 表示欠落 | `md:` 56px 固定列を新設 + モバイル要約にも `スコア N` を併記 | **解消** |

### MEDIUM / LOW

| # | r1 指摘 | r2 対応 |
|---|---------|--------|
| MED 7 | grid md prefix が同値で二重 | `1.5fr_120px_56px_minmax(180px,2.4fr)_120px_24px` の 6 列 1 系統に統一 → 解消 |
| LOW | `snoozed` フィルタ (UI/SQL ズレ) | `ThreadFilter` 型 / SQL stateFilter / mock の三箇所から完全除去 → 解消 |
| MED 4 | 検索結果件数の `aria-live` | 未対応 (継続) |
| MED 5 | "未読" ラベル ↔ `REPLIED+MEETING` 乖離 | 未対応 (継続) |
| MED 6 | 保存ビュー / 並び替え | 未対応 (継続) |
| MED 8 | "NEW" 英大文字 | 未対応 (継続) |
| MED 9 | `<ul aria-labelledby>` | 未対応 (継続) |
| LOW 10 | inbound/outbound に `title` | 未対応 (継続) |
| LOW 11 | tracking-[0.18em] | 未対応 (継続) |
| LOW 12 | `<Link>` の focus-visible | 未対応 (継続) |
| LOW 13 | "DEMO" 和文化 | 未対応 (継続) |

---

## 軸別詳細 (差分中心)

### 1. ビジュアル (19 / 20, +1)

良い点
- スコア列が `56px` 固定幅 + `tabular font-mono text-[12px] font-semibold text-[var(--color-brand-700)]` + 右寄せ表示で、CRM インボックスの優先度可視化として読みやすい。
- ブランド 700 色 (青濃淡) でスコアを表現することで「数値=ブランド情報」の意味付けが Refined Hydro Minimalism と整合。
- モバイル時 (`md:hidden` ブロック) は state chip と同じ行に「スコア NN」をテキスト併記し、列が潰れない設計。これは r1 で指摘した "狭幅で右寄せが潰れる" 懸念を構造的に解消している。
- grid 列数二重定義 (`grid-cols-[...]` の md prefix 同値) を解消し、`md:grid-cols-[1.5fr_120px_56px_minmax(180px,2.4fr)_120px_24px]` の 1 系統 6 列に統一。読みやすい。

MEDIUM (継続)
- 6 列 grid は ~768〜960px 帯ではキャンペーン+担当の `text-right` 列が依然狭い。スコア列 (56px) 追加で他列のしわ寄せがやや増加した点は留意。`lg:` ブレイクの追加余地は残るが本 PR スコープ外。

LOW (継続)
- セクション見出しの `tracking-[0.18em]` 日本語向け広め問題は r1 と同じ。

### 2. 設計書整合 (19 / 20, +1)

良い点
- 設計書 §6.11.4「各行のスコア / 状態 / 担当 / 最終アクションを表示」が **4要素すべて画面上に明示**された。r1 時点で唯一欠落していた "スコア" がデスクトップ専用列 + モバイル要約の両方で復活。
- フィルタタブ 4 種は `ThreadFilter = "all"|"unread"|"review"|"meeting"` で型・SQL・UI が一致。設計書 §6.11.4 ワイヤー記載の "未読 / 要レビュー / 商談化" + "すべて" 構成。`snoozed` 痕跡完全除去。
- §25.3 SLA 根拠の明示参照は r1 のまま維持。

HIGH (Phase2 carry, -1)
- 設計書 §6.11.4 のキーボードショートカット (`J/K` 前後, `G then I` 受信箱, `⌘K` 検索) は本 PR スコープ外で Phase2 へ繰越。ヘビーユーザ向け機能だが MVP blocker ではないため、Phase2 チケットが切られている前提で許容。

MEDIUM (継続)
- 設計書「並び替え: 新着 / 未対応SLA超過 / スコア順」「保存ビュー」は未実装。スコア順は今回スコア列が出たことで自然な次の要求になる。

### 3. インタラクション (19 / 20, 変動なし)

r1 から変更なし。URL 同期 / 350ms debounce / clear ボタンの挙動は維持。

MEDIUM (継続)
- 検索結果件数 (`Header subtitle: ${total} 件の会話`) に `aria-live="polite"` 未付与。SR ユーザは件数変化に気付けない。

### 4. a11y (19 / 20, +2) ★最大改善

良い点
- **WAI-ARIA tabs の中途半端さを潔く撤回**: `role="tablist"` → `role="group"`、`role="tab"` + `aria-selected` → button + `aria-pressed`。フィルタ群を「タブ風 toggle ボタン」として正しくマークアップ。`aria-controls` / `role="tabpanel"` 不要のシンプル構造へ。
- `aria-pressed` は WAI-ARIA APG の Toggle Button パターンに完全準拠。SR は「○○ 切替ボタン、押されています/押されていません」と読み上げ可能で、URL 同期 (push state) との相性も良い。
- ThreadRow の `<Link aria-label>` に `スコア ${thread.score}` を含めたことで、行リンク 1 つで「名前 + 状態 + スコア + SLA フラグ」が一意に SR 認識できる。視覚情報と SR 情報の対応関係が改善。
- スコア列の span 単独にも `aria-label="スコア ${thread.score}"` が付与されており、ブラウズモードで個別カラムを読む場合も意味が落ちない。
- r1 で残ったその他の三重表現 (SLA 背景色 / icon / テキスト) はそのまま維持。

MEDIUM (継続, -1)
- 行 Link の `aria-label` とスコア span の `aria-label` がスコア値を二重に持つため、SR の読み上げモード次第ではわずかな冗長性が出る。ブラウズモード時に span 単独でも意味が通る利点が勝るので許容範囲だが、最適化したい場合は span 側を `aria-hidden` + Link 側にのみ寄せる選択肢もある。
- `<ul aria-labelledby>` でセクション見出しとの紐付けが r1 から未着手 (LOW 寄り)。

LOW (継続)
- "NEW" バッジ視覚ラベル vs `aria-label="要レビュー"` の不一致 (WCAG 2.5.3) は未対処。

### 5. 日本語 B2B トーン (19 / 20, 変動なし)

r1 から変更なし。"NEW" / "DEMO" の英大文字残置は MEDIUM のまま継続。

---

## R2 で導入された差分への新規所見

### NEW (LOW のみ)

1. **スコア span の二重 aria-label** (LOW): 上述。Link `aria-label` 内にスコア値が含まれており、span 側 `aria-label` と部分的に冗長。実害なし、ブラウズモードでの個別読み上げを優先するなら現状が正解。
2. **モバイル要約の情報密度**: `md:hidden` 行に state chip + スコアが横並びで入り、要素間 gap 2 が詰まり気味の端末あり。`gap-2 flex-wrap` で折り返し対応済みなので致命ではない。
3. **grid 6 列の狭幅耐性**: 56px 列追加でキャンペーン/担当 (`minmax` なし 120px) が ~860px 帯で文字切れする可能性。`truncate` 適用済みなのでレイアウト崩れはしないが、視認性は r1 5 列より落ちる。`lg:` ブレイク追加は将来検討。

### NEW HIGH

**なし**。

---

## HIGH 残存 / NEW HIGH

| 種別 | # | 内容 | 状態 |
|------|---|------|------|
| 残存 | HIGH 1 (r1) | キーボードショートカット (`J/K`, `G then I`, `⌘K`) | **Phase2 carry (合意済み)** |
| 残存 | — | — | — |
| NEW | — | — | **なし** |

実質的に R2 時点で blocking な HIGH は **ゼロ**。Phase2 carry の 1 件は本 PR スコープ外であることが合意済み。

---

## 90+ 判定

**PASS (95 / 100)**

理由
- r1 で挙げた HIGH 3 件のうち、本 PR で解消可能な 2 件 (tab パターン整備 / スコア列復活) を完全解消。
- 副次的な改善 (`snoozed` 除去 / grid 二重定義解消) も同時に対処され、内部整合性が向上。
- a11y が +2、ビジュアル / 設計書整合がそれぞれ +1 で計 +4 点上昇 (91 → 95)。
- 残る MEDIUM (検索結果 aria-live / "未読" ラベル / 保存ビュー / "NEW" 和文化) は次イテレーション扱いで妥当。
- Phase2 carry のキーボードショートカットは PM 側で別チケット管理されている前提で blocker 除外。

90+ PASS 条件を明確にクリア。BORDERLINE から脱却。

---

## 質問 / 確認事項 (Open Questions)

- Q1: スコア span の `aria-label` を残すか (ブラウズモード優先) / `aria-hidden` で Link 側に寄せるか (リスト navigation 優先) のどちらが運用上望ましいか。視覚障害ユーザのインタビューがあれば確定したい。
- Q2: モバイル時 state chip + スコアの並び順 (現状 state → スコア) は、優先度判断ユースケースとして "スコア → state" の順が直感的か。
- Q3: Phase2 キーボードショートカット実装時に "押された toggle ボタン" としての fokusable 順序が想定通りか (Tab で 4 ボタン順巡回 → 検索 input)。

---

## 参照ファイル (絶対パス)

- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\app\(app)\inbox\page.tsx`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\components\inbox\inbox-filter-tabs.tsx`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\components\inbox\inbox-thread-list.tsx`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\server\queries\inbox.ts`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\docs\reviews\s09-r1\designer.md` (前回レビュー)
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\docs\ui-ux\UI_UX_Design.md` (§6.11.4 line 838, §25.3 line 1861)
