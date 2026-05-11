# S06 キャンペーン詳細 — 精密コードレビュー (r1)

- **対象**: `app/(app)/campaigns/[id]/page.tsx` + `components/campaigns/detail/*` (5ファイル) + `server/actions/campaigns.ts` (`singleCampaignAction`) + `server/queries/campaign-detail.ts`
- **基準日**: 2026-05-11
- **レビュアー**: code-review-agent (collaborative mode)
- **判定**: **CHANGES REQUIRED** — 総合 84/100 (90+ 未達)

---

## 総合スコア: **84 / 100**

| # | 軸 | 配点 | 得点 | 主因 |
| --- | --- | --- | --- | --- |
| 1 | 型安全 | 20 | 16 | `productDocs.message/delivery` の `as MessageStep` / `as Delivery` キャスト、`hitlState` の文字列共用体 3 箇所重複、`tab` の `as DetailTab` 二重キャスト |
| 2 | React 19 / Next.js 15 | 20 | 16 | `useActionState` を 3 つの `<ActionForm>` で並列に持っていて初期 state 共有による誤通知リスク、`singleCampaignAction` の `new FormData()` 経由再構築、`server-only` import が detail page 直下に無い |
| 3 | a11y | 20 | 13 | `tablist` に **`aria-controls` 欠落**・**`id` 欠落** (tablabel-*) — tabpanel 側 `aria-labelledby` が宛先不在、`role="tab"` を `<Link>` (= `<a>`) に付けるとキーボード操作矢印キー未実装、編集 (Phase2) リンクが `href="#"` + `aria-disabled` のみ (フォーカス可能なまま) |
| 4 | エッジケース | 20 | 17 | `status === "safe_mode"` 時のアクションボタン UX、`status === "completed"` でも resume/pause 不可は OK だが `Archive` のみ非表示 ⇒ 何も出ない (空コンテナ)、`tab` 不正値時の現リダイレクト無し |
| 5 | コード匂い | 20 | 22→**18** | HITL ラベル分岐が detail-header / tab-settings に重複、日付フォーマット `Intl.DateTimeFormat(...)` が detail-header / tab-settings に同形重複、UUID_RE が緩い (`startsWith("c")` & `startsWith("00000000")` 文字列短絡) |

> 90+ 判定: **NO** (84/100)。HIGH を 3 件解消で 90 ライン到達見込み。

---

## HIGH (must fix — 3 件)

### H1. `<DetailTabs>` の `aria-controls` / `id="tablabel-*"` 欠落 — タブの参照が壊れている

- **ファイル**: `components/campaigns/detail/detail-tabs.tsx:28-49`
- **症状**: `page.tsx:108` が `<div role="tabpanel" id="tab-${tab}" aria-labelledby="tablabel-${tab}">` を出しているのに、対応する `<Link role="tab" id="tablabel-...">` も `aria-controls="tab-..."` も無い。スクリーンリーダがタブ↔パネル関係を辿れない。
- **影響**: a11y rubric 違反 (WAI-ARIA APG Tabs Pattern 1.2)。NVDA/VoiceOver で「tab, 1 of 4」相当のアナウンスが出るが、リンクされたパネル名を読み上げられない。
- **修正**:
  ```tsx
  <Link
    key={t.key}
    id={`tablabel-${t.key}`}
    role="tab"
    aria-selected={active}
    aria-controls={`tab-${t.key}`}
    tabIndex={active ? 0 : -1}
    aria-current={active ? "page" : undefined}
    href={`/campaigns/${campaignId}${t.key === "overview" ? "" : `?tab=${t.key}`}`}
    …
  >
  ```
- **補足**: `role="tab"` を `<a>` に付ける場合、APG では矢印キー操作も期待される。今回は **タブ＝ページ遷移** モデルなので、APG 厳密準拠より「`role="tab"` を捨てて `role="link"` (デフォルト) のまま `aria-current="page"` だけ残す」設計の方が誠実。`tablist` ロール自体を外し、`<nav aria-label="キャンペーン詳細タブ">` で十分。**どちらを取るかの判断**を要求 (現状はハイブリッドで中途半端)。

---

### H2. `<ActionForm>` を 3 つマウントすると `useActionState` が独立 ⇒ 各フォームで初期 state を踏み続ける

- **ファイル**: `components/campaigns/detail/detail-header.tsx:147-157`
- **症状**: `pause` / `resume` / `archive` の `<ActionForm>` がそれぞれ `useActionState(singleCampaignAction, INITIAL_BULK_STATE)` を呼び、`reported.current` ガードはコンポーネント単位で別物。問題そのものは無いが、`state === INITIAL_BULK_STATE` を **参照等値** で比較しているため、`INITIAL_BULK_STATE` が外部からシャローコピーされたり、`affected:0` のフェイル状態 (`{ ok:false, affected:0, message:"…" }`) が返るとそれは「初期状態」と判定されず通知される一方で、**もう片方のフェイルレスポンスが同じ shape だと** `reported.current === state` 比較 (参照等値) で再通知が走るリスク。
- **修正**: 通知の重複防止は内容比較 (`!Object.is(reported.current?.message, state.message) || reported.current.ok !== state.ok`) か、または `useActionState` の戻り値で increment する `sequence` を state 内に持たせる。最も簡単なのは:
  ```ts
  const isInitial = state === INITIAL_BULK_STATE;
  React.useEffect(() => {
    if (isInitial) return;
    onResult(state);
  }, [state]); // state は新オブジェクトが返るため依存配列で十分
  ```
  ただし React 19 + form action の挙動上、**同じフェイル文字列が連続2回返ると useEffect が発火しない** (state がシャロー等値で同じ参照を返すケース) — 現実には Server Action は毎回新規オブジェクトを返すので問題は起きにくいが、`INITIAL_BULK_STATE` を **モジュールトップで凍結された定数** として使うのではなく、`useActionState(action, { ok:false, affected:0 })` と毎回新規オブジェクトを渡すのが安全。

---

### H3. `page.tsx` の `UUID_RE` 判定が緩すぎ (`startsWith("c") || startsWith("00000000")`)

- **ファイル**: `app/(app)/campaigns/[id]/page.tsx:19-44`
- **症状**:
  ```ts
  const UUID_RE = /^[0-9a-fA-F-]{36}$/;
  const isReasonable = UUID_RE.test(id) || id.startsWith("c") || id.startsWith("00000000");
  ```
  1. `UUID_RE` は **36文字なら何でも通す** (例: `------------------------------------` も合格、ハイフン位置のチェック無し)。本物の UUID は `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx` (8-4-4-4-12)。
  2. `id.startsWith("c")` で **「`c` で始まる文字列を全て許可」**。`c<script>alert(1)</script>` も 404 を回避できる。後段で `db` が `not_found` を返すから安全ではあるが、本来 `notFound()` で弾くべきものを DB クエリまで通している (DoS 面)。
  3. mock id (`c1`) は `getCampaignDetail` 内では完全に無視されており、`mockDetail(campaignId)` がそのまま `c1` を `detail.id` に詰めて返す。つまり page で id 検証を緩めても **DB クエリは UUID 必須** で別途 400/失敗する (drizzle が `uuid` カラムへの非 UUID 文字列で死ぬ)。`live` 系では緩い許容が裏切られる。
- **修正**:
  ```ts
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const MOCK_ID_RE = /^c\d+$/; // mock 専用フィクスチャだけ許す (c1, c2, …)
  const isReasonable =
    UUID_RE.test(id) ||
    (process.env.NODE_ENV !== "production" && MOCK_ID_RE.test(id));
  if (!isReasonable) notFound();
  ```
  併せて `getCampaignDetail` 側で `!UUID_RE.test(campaignId) && db` のケースを早期 `mock` 返却に分岐すれば、live 環境で `c1` を叩いても 404 ではなく mock を返せる (好みの問題)。

---

## MEDIUM (should fix — 6 件)

### M1. `singleCampaignAction` が `new FormData()` で再構築している

- **ファイル**: `server/actions/campaigns.ts:150-165`
- **症状**: `formData.get("id")` から id を取り出して `fakeForm = new FormData(); fakeForm.append("ids", parsed.data.id)` で **bulk 版に転送**している。意図は分かるが:
  - `bulkPauseCampaigns(undefined, fakeForm)` を直接呼ぶことで `_prev` を `undefined` 固定 → 上位の `useActionState` が前回 state を渡しても無視される。bulk 版の関数仕様としては `_prev` を読まないので副作用は無いが、**呼出契約から逸脱**。
  - `fakeForm` 経由なので **再 zod 検証 (UUID)** が二重実行される (singleId で一度、bulkSetStatus 内で再度)。性能影響は無いが冗長。
- **修正**: 内部実装関数 `bulkSetStatusImpl(ids: string[], session, …)` を抽出し、`bulk*Campaigns` も `singleCampaignAction` も両方が `ids: string[]` で呼ぶ形に。FormData 再構築は不要になる。

### M2. `productDocs` の as キャストが 2 箇所 — Zod パースに統一すべき

- **ファイル**: `components/campaigns/detail/tab-messages.tsx:22`, `tab-settings.tsx:19-20`
- **症状**:
  ```ts
  const message = (detail.productDocs?.message ?? {}) as MessageStep; // tab-messages
  const objective = detail.productDocs?.objective as Objective | undefined; // tab-settings
  const delivery = (detail.productDocs?.delivery ?? {}) as Delivery; // tab-settings
  ```
  `productDocs: Record<string, unknown> | null` を**根拠なしに narrow** している。DB に過去バージョンのドキュメントが残っていた場合、`tone` が `"super-formal"` 等の未知文字列でも `TONE_LABEL[tone] ?? tone` でかろうじて落ちないが、`reviewMode === "semi_auto"` 等の **未知値で false 経路に流れる**バグを型が拾えない。
- **修正**: 既に `lib/wizard-schema.ts` に Zod スキーマがあるなら、`safeParse` して `productDocs.message` を厳密に正規化。失敗時は空オブジェクト + DEMO バッジ表示 (現在の `mock` 表示と同パターン)。

### M3. HITL ラベル分岐が detail-header と tab-settings に重複

- **ファイル**: `detail-header.tsx:95`, `tab-settings.tsx:53-57`
- **症状**: 同じ三項演算子 `hitlState === "FULL_AUTO" ? "自動送信" : hitlState === "SEMI_AUTO" ? "セミ自動" : "レビュー必須"` が 2 箇所に手書きでコピペされている。
- **修正**: `lib/hitl.ts` (or `lib/campaign-status.ts`) に `HITL_LABEL: Record<HitlState, string>` を定義。`type HitlState` も同所で export して、`detail-header.tsx:30` / `campaign-detail.ts:13` の文字列共用体ハードコードを撤廃。3 箇所重複の解消。

### M4. `status === "completed"` で アクション領域が完全空 (DOM だけ残る)

- **ファイル**: `detail-header.tsx:53-83`
- **症状**: `completed` のとき pause/resume いずれも非表示 + archive も非表示。結果として `<div className="flex items-center gap-2"> </div>` が空のまま残るのは無害だが、**右側に何も無い視覚状態**になる。設計書 §5.6 で「完了済みでも複製/監査ログ閲覧は可能」想定なので、ここに `<DropdownMenu>` を出すか、最低限 `「複製して新規キャンペーン作成」` リンクを置きたい。**現状は仕様上の判断待ち** だが UX 観点では指摘事項。
- **修正案**: `status === "completed"` 時に「複製」リンク (Phase2 でも可) をプレースホルダで出す、または `<div>` ごと条件レンダリング (`status === "completed" || ...` で skip)。

### M5. `tab` 不正値で `notFound()` ではなく `overview` にフォールバック — 仕様判断

- **ファイル**: `page.tsx:46`
- **症状**: `rawTab` が `"foo"` でも `overview` にフォールバック。サーチエンジン経由で `?tab=invalid` が広まると重複 URL になる。**SEO 観点では `redirect` で正規 URL に流す**のが筋。
- **修正**:
  ```ts
  if (rawTab && !ALLOWED_TABS.has(rawTab as DetailTab)) {
    redirect(`/campaigns/${id}`);
  }
  ```

### M6. 編集 (Phase2) リンクが `<Link href="#" aria-disabled>` — フォーカスは取れる

- **ファイル**: `tab-settings.tsx:36-42`
- **症状**: `aria-disabled` 属性はスクリーンリーダ向けの宣言で、**キーボードフォーカスは普通に取れる** (Tab で当たる)。`pointer-events-none` でクリックも消されているので「機能はしないがフォーカスは奪う死亡リンク」。
- **修正**: `<button type="button" disabled>` に変える、または `tabIndex={-1}` で **フォーカスから外す**。`<Link href="#">` は `e.preventDefault()` も無いのでアンカーリンクの `#` ジャンプが厳密には動いてしまう (history が積まれる) — 実際は `pointer-events-none` で防がれるが、防御は重ねたい。

---

## LOW (nice to have — 5 件)

### L1. `Intl.DateTimeFormat` がリクエスト毎にインスタンス化されている

`detail-header.tsx:100`, `tab-settings.tsx:63-67`, `:76-80` の 3 箇所で毎レンダ `new Intl.DateTimeFormat("ja-JP", …)` を生成。`lib/formatters.ts` に既に `fmtRelative` があるなら、そこに `fmtDateJa(iso, granularity)` を集約してモジュールスコープでメモ化。

### L2. `daily` が常に **30日分の空配列** (`buildEmptyDaily`)

`campaign-detail.ts:127` のコメントで明示されているが、**実画面では`ActivityChart` が常時フラットになる** (live 環境)。最低限 `TabOverview` 側で `daily` が全てゼロなら placeholder 文言を出すべき (`mock` 経路は乱数で動くため気付きにくい)。

### L3. `funnel` のラベルが server / mock で同じハードコード (2 箇所)

`campaign-detail.ts:112-123` と `:264-269` で同じ `[state, ja]` 配列が重複。`lib/state-machine.ts` に `STATE_LABEL_JA: Record<LeadState, string>` を置いて両者が参照する形に。

### L4. `tab-messages.tsx` の `text.length` カウントは **文字単位ではなく UTF-16 code unit**

絵文字 (`🚀`) を含むと 2 にカウントされる。LinkedIn 連結申請の 300 字制限は文字種で違う扱いだが、`Array.from(text).length` (グラフェム近似) または `Intl.Segmenter` を使うのがより誠実。MVP では問題なし。

### L5. `ActionSubmit` のスピナー `aria-hidden` のみで `aria-busy` 無し

`detail-header.tsx:199` の pending スピナーは `aria-hidden`。`<form aria-busy={pending}>` を足すか、`<button>` 自体に `aria-busy={pending}` を追加するとスクリーンリーダ向けの進行通知が出る。`disabled` 属性で十分という議論もあり、必須ではない。

---

## ポジティブ評価 (積極的に守りたい点)

- **server / client 境界が綺麗**: `page.tsx` `tab-*.tsx` 全てが server component で、`detail-header.tsx` だけ `"use client"`。Action は server actions で完結し、`KpiCard` 等のチャート系も dashboard と共有 — Next.js 15 のパターンを正しく踏襲。
- **degraded 経路 (`incidentId`)** がきちんと UI に出る (page.tsx:64-72)。多くのプロジェクトで欠落する箇所がカバーされている。
- **`source: "mock"` バッジ** で DB 未接続をユーザに明示。
- **`hasAtLeastRole` + `requireManagerSession`** が server action に必ず通っており、orgId スコープも `bulkSetStatus` 内で **`eq(schema.campaigns.orgId, session.orgId)` を強制**。組織越境の事故が起きない。
- **Audit log** が更新成功した行に対してのみ発行されている (`for (const row of updated)`)。冪等性は弱いが MVP として妥当、コメントで Phase2 改善計画も明記。

---

## 修正優先度サマリ

| 優先度 | 件数 | 90+ への寄与 |
| --- | --- | --- |
| HIGH | 3 (H1/H2/H3) | +5 〜 +6 (a11y +4 / type +1 / edge +1) |
| MEDIUM | 6 | +2 〜 +3 |
| LOW | 5 | +0 〜 +1 |

**H1 + H2 + H3 + M3 を直すだけで 90/100 ラインを越える** 見込み。

---

## BEADS 更新 (推奨)

```bash
bd update <s06-task-id> --status blocked
bd label add <s06-task-id> needs:fixes
bd label add <s06-task-id> review:iteration-1
```

---

## 関連ファイル (絶対パス)

- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\app\(app)\campaigns\[id]\page.tsx`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\components\campaigns\detail\detail-tabs.tsx`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\components\campaigns\detail\detail-header.tsx`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\components\campaigns\detail\tab-overview.tsx`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\components\campaigns\detail\tab-leads.tsx`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\components\campaigns\detail\tab-messages.tsx`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\components\campaigns\detail\tab-settings.tsx`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\server\actions\campaigns.ts`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\server\queries\campaign-detail.ts`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\lib\campaign-status.ts`
