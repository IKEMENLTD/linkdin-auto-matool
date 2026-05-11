# S06 キャンペーン詳細 — Designer Review (r1)

**対象**: `/campaigns/[id]` 一式 (page + 5 components + query + action)
**設計書**: `docs/ui-ux/UI_UX_Design.md` v1.3 §6.11.2
**評価日**: 2026-05-11
**Reviewer**: designer-agent

---

## 総合スコア: **91 / 100** — **PASS (90+)**

| 軸 | 配点 | スコア | 判定 |
|---|---|---|---|
| 1. ビジュアル (デザイントークン整合) | 20 | **19** | 強 |
| 2. 設計書整合 (タブ/KPI/ファネル/注意/Phase2) | 20 | **17** | 中 (注意リストの SAFE_MODE 想定欠落) |
| 3. インタラクション (URL同期/確認/useActionState) | 20 | **18** | 強 |
| 4. a11y (tab ARIA / h1 / フォーカス) | 20 | **17** | 中 (h1 重複, tabpanel id 不一致) |
| 5. 日本語 B2B トーン | 20 | **20** | 強 |

→ **PASS** (90 + 1 = 91)。HIGH ブロッカーは 1 件のみ (h1 重複)、ほかは MEDIUM/LOW。

---

## 1. ビジュアル (19 / 20)

### 強み
- 全箇所で CSS 変数トークン (`var(--color-brand-700)` / `[color:var(--color-ink-500)]`) を使用。ハードコード hex は **タブのアクティブ下線 (`#38BDF8 → #14B8A6` グラデ)** のみで、これはダッシュボード/サイドバーと同じブランドアクセントに合致 (許容)。
- フォントスタック: 見出し `font-display` + 数値 `tabular font-mono`、設計書 §4.3 と整合。
- カード/枠線/影は `card-solid` ユーティリティ・`rounded-2xl`・`border-[var(--color-ink-100)]` で他画面と統一。
- DetailHeader のステータス Chip + HITL Badge + 担当 + 開始日のメタライン情報密度・配色とも良好。

### 指摘
- **LOW**: `detail-header.tsx` L114 `border-[#FECACA]` / L194 `border-[#FECACA]` などダンガー系で hex 直書き。`var(--color-danger-200)` 相当を導入できないなら **CSS 変数化を Phase2 で**実施推奨。現在は他画面 (campaigns-bulk-bar など) と同じ慣習のため減点は 0.5 程度に留めた。
- **LOW**: `detail-header.tsx` H1 `text-[26px] lg:text-[34px]` は許容範囲だが、ダッシュボード H1 `text-[28px]/text-[36px]` と 1px 差。設計書 §4 にトークン未明示のため目立たないが、`text-display-lg` のようなクラスに昇格させると保守性アップ。

---

## 2. 設計書整合 (17 / 20)

### カバレッジ
| 設計書要件 (§6.11.2) | 実装 | OK? |
|---|---|---|
| パンくず「◀ 一覧に戻る」 | DetailHeader L46-52 | ✓ |
| 編集 (Phase2 disabled) | TabSettings L36-43 で表示 | ✓ (ヘッダではなく設定タブ内) |
| 一時停止 / 再開 / アーカイブ | DetailHeader L54-82 | ✓ |
| キャンペーン名 + 状態 + 開始日 + 担当 | DetailHeader L88-103 | ✓ |
| タブ [概要][リード][メッセージ][設定] | DetailTabs | ✓ |
| KPI 4 枚 (送信/承認率/返信率/商談化数) | TabOverview L11-37 | ✓ |
| 日次活動量 (ActivityChart) | TabOverview L48-50 | ✓ |
| 注意が必要なもの (要レビュー/ウォームアップ/失敗) | AttentionList + buildAttention | △ |
| ファネル | Funnel コンポーネント | ✓ |
| リード一覧 (S07 と同じテーブル) | TabLeads | △ (フィルタなし) |
| メッセージ (コネクト + 初回 DM / A/B / 採用ログ) | TabMessages | ✓ |
| 設定 (ICP / 担当アカウント / 上限 / 時間帯 / レビューモード / 開始日 / 停止日) | TabSettings | △ (停止日なし) |
| 実行中設定との差分 / 再承認案内 | TabSettings L25-30 Phase2 注記 | ✓ |
| Phase2 ガイド | 採用ログ / 編集差分 / 設定変更 | ✓ |

### 指摘
- **MEDIUM**: 設計書 §6.11.2 リードタブは「状態フィルタ + リード一覧 (S07 と同じテーブル)」。現実装 (`tab-leads.tsx`) は状態フィルタがなく、25 件固定。最低限 `?leadState=` クエリパラメータ受け取りでフィルタ機能を実装する、または **「このキャンペーンのリード一覧を見る」リンクで S07 へ抜けるのが主動線である旨を README/CHANGELOG に明示**。現状は「リンクで誘導」になっているが、設計書から見ると詳細タブ内で完結する想定。
- **MEDIUM**: 設計書 §6.11.2「停止日」が TabSettings の Row に存在しない。`status === "paused"` のキャンペーンで停止日を表示できないと、Manager がいつ停止されたか分からない。`pausedAt` / `completedAt` 相当のフィールドを `CampaignDetail` 型に追加するか、なければ `(設定なし)` Row で枠だけ用意し設計書整合を担保。
- **MEDIUM**: `buildAttention` (`campaign-detail.ts` L191-218) が「ウォームアップ」「失敗」を live モードで生成していない (mock のみ)。設計書例「要レビュー 8, ウォームアップ Day 9, 失敗 1」と live で乖離。本番 DB 接続時は **AttentionList が `review` のみで貧しく**見える。Phase2 で追加するなら、その旨をコード内コメントに明記してテックデットを可視化。
- **LOW**: 設計書「タブ: 概要 / リード / メッセージ / 設定」と完全一致 ✓。順序・ラベル文字列とも OK。
- **LOW**: 設計書 §10.3 安全モード状態 (`SAFE_MODE` chip = ShieldAlert + danger) を **キャンペーン状態が `safe_mode` に遷移したケースで DetailHeader はどう表示するか**ロジック未確認。`CampaignStatusChip` 実装が `safe_mode` を扱っているなら問題ないが、念のため確認推奨 (今レビュー対象外なので減点せず注記のみ)。

---

## 3. インタラクション (18 / 20)

### 強み
- **URL 同期 (PASS)**: `DetailTabs` は `<Link href="...?tab=leads">` でタブ切替→`searchParams.tab` をサーバ側で読む方式。リロード耐性・共有 URL 可・戻る/進む対応すべて素直。設計書 §7.4 「URL は信頼できる状態源」に整合。`overview` は `?tab=` なしの正規 URL になっている点もブックマーク観点で良い設計。
- **確認ダイアログ (PASS)**: 一時停止と Archive に `confirmMessage` を渡し `window.confirm` を発火。Archive 文言「実行中のジョブは停止されます。よろしいですか？」は副作用を明示しており Cialdini 観点も OK。
- **`useActionState` + `useFormStatus` (PASS)**: `ActionForm` / `ActionSubmit` の分離が綺麗で、Server Action 失敗時も `state.message` が toast 表示される (`onResult` コールバック)。pending 中はボタン disabled + スピナー、二重送信予防 ✓。
- **`singleCampaignAction` (PASS)**: `bulkPauseCampaigns` 等を内部再利用しており、監査ログ・トランザクション・revalidatePath が一貫。単独操作 UI で型/振る舞いを別管理する罠を回避している点は強い。
- **resume では確認なし**: Pause/Archive は副作用大、Resume は元に戻すだけ→確認なし、という濃淡の付け方が UX 王道に従っている。

### 指摘
- **MEDIUM**: `singleCampaignAction` が `revalidatePath("/campaigns")` のみ呼び (内部 `bulkSetStatus`)、`/campaigns/[id]` を revalidate しない。**詳細画面で pause した直後、同画面のステータス chip がすぐ更新されない可能性** (Next.js のキャッシュ境界次第で UI 更新が遅延)。`singleCampaignAction` の最後で `revalidatePath('/campaigns/[id]', 'page')` を追加するか、`router.refresh()` をクライアントから呼ぶのが安全。`bulkSetStatus` 側を変えると bulk 操作で重くなるので、`singleCampaignAction` でラッパーした方が良い。
- **LOW**: `confirm()` は ブラウザネイティブで a11y 的に最低限のフォーカス管理しかなく、設計書 §11.2 のモーダルパターンと**スタイル差異**がある。MVP では妥協可能だが、将来は `Dialog` コンポーネント (frontend-design パターン) に揃える計画を CHANGELOG/README に書いておくと良い。
- **LOW**: `DetailHeader` 内の toast (`role=status` / `aria-live=polite`) は 3.5s 自動消滅。`role=alert` 経路 (失敗時) は **読み上げ機が `aria-live=polite` で渡されている**ため、`role=alert` と `aria-live=polite` が同時指定されてしまっている (`role=alert` の暗黙は `assertive`)。失敗時は `aria-live="assertive"` を指定するか、`role=alert` のままにして `aria-live` を削除する方が一貫する。

---

## 4. a11y (17 / 20)

### 強み
- `DetailTabs`: `role="tablist"`, 各 Link が `role="tab"` + `aria-selected={active}` + `aria-current="page"`。設計書 §11 のロール定義と整合 ✓。
- `tabpanel`: page.tsx L108 で `role="tabpanel"` + `id={`tab-${tab}`}` + `aria-labelledby={`tablabel-${tab}`}`。
- アイコン: ほぼ全てに `aria-hidden` 付与、装飾アイコンと意味アイコンの分離 ✓。
- ヘッダ「メニュー / 通知 / 検索」もきちんと `aria-label` 完備 (検査済)。
- toast: 成功 = `role="status"`、失敗 = `role="alert"`。`aria-live="polite"` は前述の通り tweak 余地あり (LOW)。

### 指摘
- **HIGH**: **h1 が 2 つレンダリングされている**。`app/(app)/campaigns/[id]/page.tsx` L85 で `<Header title={detail.name} subtitle="キャンペーン詳細" />` → グローバル `Header` 内 (components/app/header.tsx L24) で `<h1>` 出力。さらに `DetailHeader` (detail-header.tsx L88) でも `<h1 className="font-display text-[26px] ...">{name}</h1>` 出力。HTML 構造として **同一ドキュメント内に同じテキストの h1 が 2 個**。SR ユーザは混乱、SEO/構造化検査も警告。
  - **修正案 A (推奨)**: グローバル `Header` の `<h1>` を `<div role="banner" aria-label={title}>` または `<p>` に変更し、各ページ側の本文 H1 を「ページの唯一の h1」にする。サイドバー/ヘッダはランドマークなので h1 不要。
  - **修正案 B**: `DetailHeader` の見出しを `<h2>` に降格し、`Header` 側を h1 として保つ。ただしビジュアル的に詳細名がページの主題なので案 A が望ましい。
- **MEDIUM**: `DetailTabs` の `Link` に `id={`tablabel-${t.key}`}` がない。一方 `page.tsx` の tabpanel は `aria-labelledby={`tablabel-${tab}`}` で参照している → **参照先 ID が存在しない**。SR で tabpanel の見出しが読まれない。`DetailTabs` の Link に `id={`tablabel-${t.key}`}` を追加するだけで解決。
- **MEDIUM**: タブが矢印キーで横移動できない (Roving Tabindex 未実装)。WAI-ARIA Authoring Practice の Tab パターン推奨機能。`Link` ベースで実装している以上、`onKeyDown` で `ArrowLeft/ArrowRight` を捕まえて `router.push` するか、Tab パターンを諦めて `nav role="tablist"` を `role="navigation"` に変える (= LinkedIn 風) ことも検討。MVP では Tab パターン宣言を保ちつつアロー対応未実装で 1 点減。
- **LOW**: `ActionSubmit` のスピナー `<span aria-hidden>...</span>` だけで pending 中の SR フィードバックがない。ボタンに `aria-busy={pending}` または `aria-label="一時停止中..."` を pending 時のみ重ねると親切。
- **LOW**: TabLeads のテーブル風レイアウトが `<ul><li>` 構造。設計書では「テーブル」と表現されており、SR で「リスト 7 項目」と読まれる。意味的には `<table role="table">` または `aria-label` 付き grid pattern が望ましいが、現実装でも実害は小さい。
- **LOW**: `DetailHeader` パンくず「キャンペーン一覧へ戻る」リンク (L46-52) — 単体としては OK だが、よりセマンティックには `<nav aria-label="breadcrumb">` で囲むと SR でランドマークとして拾える。

---

## 5. 日本語 B2B トーン (20 / 20)

- 全文面が B2B にふさわしい敬体・簡潔・命令にならない柔らかな指示形 ✓。
- 「キャンペーンを一時停止します。よろしいですか？」「実行中のジョブは停止されます。よろしいですか？」 — Cialdini「副作用先出し」+「能動的同意」が踏めている。
- エラー文「キャンペーン情報を取得できませんでした。時間をおいて再度お試しください。」+ インシデント ID 案内 — エンタープライズ B2B のサポート導線として満点。
- 「(設定されていません — 300 字以内)」プレースホルダの**全角ダッシュ + 文字数表示**は丁寧で英語直訳臭がない。
- ボタンラベル「一時停止 / 再開 / アーカイブ」「キャンペーン一覧へ戻る」— 体言止め + 助詞「へ」が日本語 UI の B2B 慣習に合致。
- 用語統一: 「コネクト申請 / 初回 DM / A/B 案 B / 担当アカウント / 日次上限 (申請) / 日次上限 (実効)」 — 設計書の用語辞書とぴったり整合 ✓。
- Phase2 案内文「実行中のキャンペーンの設定編集は Phase2 で対応予定です。設定変更後は「実行中の設定との差分」が表示され、Manager 以上の再承認が必要になります (設計書 §5.6.1)」 — **§参照付き**で開発・運用が同じ言葉を話せる。素晴らしい。

満点を引く理由なし。

---

## ブロッカー / 修正必要事項

### HIGH (PASS 後でも実装前に必修正)
1. **`<h1>` 重複** (`app/(app)/campaigns/[id]/page.tsx` L85 + `components/campaigns/detail/detail-header.tsx` L88) — 同じドキュメントに `<h1>` が 2 個。グローバル `Header` の `<h1>` を別タグに、または `DetailHeader` を `<h2>` に変更。

### MEDIUM (実装と同タイミングで修正推奨)
2. **`aria-labelledby` 参照先 ID 不在** — `page.tsx` の `aria-labelledby={`tablabel-${tab}`}` に対し、`DetailTabs` の `<Link>` に `id={`tablabel-${t.key}`}` を付与。
3. **タブのアロー操作未実装** — `role=tablist/tab` を宣言している以上、`ArrowLeft/Right` で前後移動できることが WAI-ARIA Authoring Practices の期待。`onKeyDown` ハンドラ追加。
4. **詳細画面 `revalidatePath` 漏れ** — `singleCampaignAction` で `/campaigns/[id]` も revalidate しないと、Pause/Resume 直後にチップが古いまま見える。
5. **設定タブ「停止日」表示欠落** — 設計書 §6.11.2 が要求。`pausedAt` がデータにない場合は Row 枠だけ用意して `(未停止)` 表示。
6. **リードタブ状態フィルタ未実装** — 設計書 §6.11.2 が要求。`?leadState=` でフィルタするか、S07 への誘導を主動線とする方針を明文化。
7. **`buildAttention` の live 側が貧しい** — ウォームアップ/失敗の生成が mock のみ。Phase2 への TODO コメントを `campaign-detail.ts` に明記。

### LOW (Phase2 / 改善余地)
8. ダンガー hex (`#FECACA` 等) を CSS 変数化。
9. `confirm()` を Dialog コンポーネントへ統一。
10. toast の `role=alert` + `aria-live=polite` の重複指定整理。
11. pending ボタンに `aria-busy={pending}`。
12. TabLeads を `<table>` 化、もしくは `role=grid`。
13. パンくずを `<nav aria-label="breadcrumb">` でラップ。

---

## 良い設計として残したい点
- **タブを Link で実現**: SPA tab の典型 (`useState`) を避け、URL を信頼の源にしている。共有・戻る進む・SSR・SEO すべてに勝つ正解。
- **`singleCampaignAction` の薄い委譲**: bulk を内部再利用し、監査ログ・トランザクション・revalidate を 1 箇所に集約。設計の単純化として優秀。
- **エラー時の Incident ID 表示**: B2B SaaS のサポート導線として完成形。
- **Phase2 注記の徹底**: 採用ログ / 編集差分 / 設定編集すべてに「Phase2」「設計書 §X.X」を明記。Manager 層の心理的安全を担保。

---

## 判定: **PASS (91 / 100)**

90 を超えており目標達成。ただし **HIGH 1 件 (h1 重複) は merge 前に必ず修正**してください。MEDIUM 群もすべて軽微 (10〜30 分) で、デザイン構造の変更は不要。実装は全体的に丁寧で、設計書整合・トークン使用・日本語トーンとも本リポジトリの中でもトップクラスの完成度です。
