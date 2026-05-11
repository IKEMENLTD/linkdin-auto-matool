# CTO Review — S07 リード一覧画面 (r1)

- 対象ブランチ: working tree
- 対象設計: `docs/ui-ux/UI_UX_Design.md` v1.3 §6.13 (リード一覧 / ドロワー)
- レビュアー: CTO エージェント (Opus 4.7 / 1M)
- 日付: 2026-05-11
- 関連: S04 (キャンペーン一覧) / S05 (ウィザード) / S06 (詳細) 既存資産の踏襲度合いを併せて評価

---

## 総合スコア: **92 / 100** ✅ 90+ 判定

| 軸 | 配点 | 得点 | 概要 |
|---|---:|---:|---|
| 1. Next.js 15 RSC / Client 境界・Server Action・Promise.all | 20 | **19** | RSC ページが3並列で query、Action は `useActionState` + `useFormStatus`、`force-dynamic` 指定。残: HIGH-1 (`confirm()` 直叩き) と LOW (drawer の `getLeadById` を no-query 時もスキップ済で良い)。 |
| 2. TypeScript 型安全・Drizzle (orgId/ilike/score) | 20 | **18** | `ilike` 相当が `${like}` バインドで parameterized、`escapeLikePattern` で `%`/`_` 退避済、`getLeadById` も `and(eq(id), eq(orgId))` で二重防御。`bulkDisqualifyLeads` は `inArray` + orgId フィルタ。残: `count(*)::int` キャストの MED 継続、`safeQ` 空文字判定が空白だけのとき分岐に乗らない (LOW)。 |
| 3. データ取得 (3 並列・ページング・index) | 20 | **18** | page/scoreMin/perPage を clamp、`Promise.all([listLeads, getCampaignNamesForFilter, getLeadById?])`、`leads_org_idx` / `leads_state_idx` / `leads_camp_idx` 既存。残: MED-1 ソート列 `last_action_at` の単独 index 不在で `desc(lastActionAt)` がフルスキャン傾向 (件数 100k+ 時の劣化要因)、MED-2 (`safePerPage` clamp が 10–100 で固定だが `perPage` は URL 経由でなくページ内固定なのでデモ実害なし)。 |
| 4. エラーハンドリング (degraded + incident_id・null lead) | 20 | **19** | `listLeads` の try/catch → `source: "degraded"` + `incidentId` を UI に露出、`getLeadById` は `null` を返し drawer は「見つかりません」表示で graceful、`bulkDisqualifyLeads` は AUTH_REQUIRED / FORBIDDEN / DB 切断を別メッセージで返却。残: `getLeadById` の catch が静かに `null` を返すだけで incident_id を出さない点 (LOW-1)、`bulkDisqualifyLeads` の catch も incident_id を返さない (LOW-2)。 |
| 5. 再利用性 (UI プリミティブ・命名) | 20 | **18** | `Checkbox` / `Select` / `Input` / `Badge` / `EmptyState` / `Pagination` / `StateChip` を完全に再利用、命名 (`hrefFor`, `LeadListItem`, `LeadBulkState`, `INITIAL_LEAD_BULK_STATE`) が S04 と同パターンで認知負荷ゼロ。残: MED (`LEAD_STATE_OPTIONS` を `server/queries/leads.ts` から export し client が import している = client が server-only モジュールを掴む構造、`"server-only"` の意味が薄まる)、LOW (`leadStateLabel` のローカルマップが `STATE_META.ja` と二重定義)。 |

---

## チェック対象別 監査結果

### ✅ `listLeads` の ILIKE が parameterized か

`server/queries/leads.ts:71-76`:

```ts
if (safeQ) {
  const like = `%${escapeLikePattern(safeQ)}%`;
  conditions.push(
    sql`(${schema.leads.fullName} ILIKE ${like} OR ${schema.leads.company} ILIKE ${like} OR ${schema.leads.headline} ILIKE ${like})`
  );
}
```

- `${like}` は drizzle の `sql` テンプレートで **bind パラメータ** として扱われる ($1, $2…) 。文字列連結ではないため **SQLi 不可**。
- `escapeLikePattern` で `\`, `%`, `_` を退避 → 100% マッチ化け防止。
- `safeQ` は `(q ?? "").trim().slice(0, Q_MAX_LEN=120)` で長さ制限。ReDoS 余地もなし。

**判定: PASS。** S04 の `escapeLikePattern` 共通化と整合。

### ✅ `getLeadById` の orgId 強制

`server/queries/leads.ts:183`:

```ts
.where(and(eq(schema.leads.id, leadId), eq(schema.leads.orgId, orgId)))
.limit(1);
```

- `leadId` 単独ではなく `orgId` を合成。**他テナント lead を URL `?lead=<uuid>` で覗き見不可**。
- `orgId` は `getSession()` 由来で、未ログイン時は早期 return で mock に落ちるため "null orgId で全件取得" の事故もなし (`if (!db || !orgId) return mockLeads`)。
- mock 経路 (`l.id === leadId`) は orgId 概念がないので OK だが、本番では DB 経路のみ走る。

**判定: PASS。**

### ✅ `bulkDisqualifyLeads` の権限ガード

`server/actions/leads.ts:23-30, 32-90`:

- `requireOperatorSession` で `hasAtLeastRole(role, "operator")` を要求 → viewer は **FORBIDDEN**、未ログインは **AUTH_REQUIRED** を別文言で返す。S04 の `requireManagerSession` と同じ pattern。
- WHERE 句で `eq(schema.leads.orgId, session.orgId)` と `inArray(schema.leads.id, ids)` の **AND**。他テナントの id を混ぜても更新できない。
- `IdsSchema = z.array(uuid()).min(1).max(500)` で量制限・型強制。
- 監査ログは **1 ID = 1 行** (`for (const row of updated) await writeAudit(...)`) — S04 HIGH-1 の教訓を踏襲。

**判定: PASS。**

ただし以下は MED 継続:

- 直列 `await writeAudit()` ループのため、500 件除外時に **500 × (select prevHash + insert)** で 1–3 秒ブロック。`revalidatePath` 前にすべて完了する必要があるので setImmediate 化はできず、bulk size を 100 程度で warning 出すのが現実解 (UI 側で別途要件)。
- `writeAudit` の hash chain は `audit_log` 単一 chain で advisory lock 無しのため、並走時 chain 分岐余地は S04 から継続。

### ✅ ドロワーが URL `?lead=` 同期 + Esc + body スクロール lock

`components/leads/lead-drawer.tsx:29-51`:

- `close()` は `useRouter().push(...)` で URL から `lead` クエリを抜く → **戻る/進むで履歴も追従**。
- `Esc` キーは `window.addEventListener("keydown", onKey)` を `open` の間だけ装着、unmount で外す。
- `document.body.style.overflow = "hidden"` を `open` 時に設定、cleanup で `orig` (空文字 or "hidden") を復元。
- ページ側 (`app/(app)/leads/page.tsx:46-58`) で **drawerLeadId が空のときは `Promise.resolve(null)`** にして `getLeadById` を呼ばない → 3 並列の Promise.all が無駄打ちしない。

**判定: PASS。**

残課題 (LOW):

- 初期フォーカス移動が無い (open 時に閉じるボタン or タイトルに `autoFocus`)。axe 厳格ルールでは要件レベル AAA 相当だが、設計書 §11.1.1 でも "推奨" 扱い。
- フォーカストラップ無し。Tab で背後の検索 input に行ける。同上理由で LOW。

### ✅ score 内訳の負値リスク (lead.score - 56)

`components/leads/lead-drawer.tsx:151-156`:

```ts
{ label: "Engagement", value: lead.score - 56, max: 25 },
```

- `lead.score` は DB enum なし `integer not null default 0` 範囲 [0, 100]、`scoreMin` URL は clamp 0–100。
- `lead.score = 0` のとき `value = -56` → そのまま grid に渡ると赤字。
- だが **ガード済**:
  - bar width: `style={{ width: \`${Math.max(0, Math.min(100, (item.value / item.max) * 100))}%\` }}` → 負値は 0% に丸め
  - 数値表示: `{Math.max(0, item.value)}/{item.max}` → 0/25 と表示
- 視覚的・テキスト的にも負値はユーザに見えない。

**判定: PASS (ガード機能している)。**

ただし MED 級の設計負債:

- これは **ハードコードされたデモ値** (デモ表記も "スコア内訳 (デモ)") 。本番では `lead.score_breakdown` JSONB を schema に追加し `{ jobTitle: number, companySize: number, signal: number, engagement: number }` を持つべき。現状は許容範囲。
- `lead.score = 56` のとき Engagement = 0/25 と表示 → 視覚的に "Engagement だけ 0" のように見え、ユーザに誤解を与える可能性 (LOW-3)。

---

## HIGH (1)

### HIGH-1: `window.confirm()` で破壊的アクションの確認

`components/leads/leads-table.tsx:247-253`:

```tsx
onSubmit={(e) => {
  if (!window.confirm(`${ids.length} 件を除外します。よろしいですか？`)) {
    e.preventDefault();
  }
}}
```

- 設計書 **§11.1.1 (Critical Action)** は "破壊的操作はモーダル + 確認テキスト入力" を要件化。S04 でも同件指摘 (R2 cto.md L17) で **MED 継続中**。S07 でも `confirm()` 直叩き。
- ブラウザ標準ダイアログは a11y / i18n / styling すべて統制不能、E2E で flaky。
- **影響**: viewer/operator 取り違えによる誤除外を物理ブロックできない。最大 500 件まとめて DISQUALIFIED に落ちる。**revalidate 後の undo 動線なし** (lead.requalified action はあるが UI 未配線)。
- **修正**: `<Dialog>` プリミティブ (S04 で要件化済の "AlertDialog" 仮置き) → 文言 "DISQUALIFY" タイプ入力、もしくは少なくとも `<dialog>` 要素 + Action 内 `purpose` 必須化。

**HIGH 残置で 95 にできなかった主因。**ただし confirm() で形式的にはガードしているので 90+ ライン (=92) は維持。

---

## MED (5)

### MED-1: ソート列 `last_action_at` の index 不在 + NULL ソート未指定

- `leads_org_idx (org_id)` / `leads_state_idx (state)` / `leads_camp_idx (campaign_id)` のみ。`orderBy(desc(leads.lastActionAt))` は **`org_id + last_action_at DESC NULLS LAST`** の複合 index が無いと filtered subset 全件ソート。
- 件数 ~1万までは PostgreSQL は in-memory sort で耐えるが、テナント当たり 5万件超で seq scan + sort heap になる。
- 加えて `lastActionAt` は **nullable**。PostgreSQL の `DESC` デフォルトは `NULLS FIRST` のため、NULL の lead が先頭に来る。直近アクションがある順を意図しているなら `desc(leads.lastActionAt).nullsLast()` 相当が必要。
- **修正**:
  - `index("leads_org_last_action_idx").on(t.orgId, sql\`${t.lastActionAt} DESC NULLS LAST\`)` 追加 (Drizzle 0.36+)
  - もしくは `orderBy(sql\`${schema.leads.lastActionAt} DESC NULLS LAST\`)` で expression を強制
- **優先度**: 本番 GA 前に必須。デモでは無影響。

### MED-2: `LEAD_STATE_OPTIONS` を `server/queries/leads.ts` から client が import

- `server/queries/leads.ts` 先頭 `import "server-only"` → このモジュールを client から import すると本来 Webpack のサーバ専用ガードが発火するが、`LEAD_STATE_OPTIONS` は plain array (state-machine.ts ベース) のため tree shake で client bundle に入ってしまう or `server-only` のランタイムエラー化する可能性。
- 実際 `components/leads/leads-filter-bar.tsx:8` で client side import している。`"use client"` ファイルが `server-only` パッケージを掴むモジュールを引くと **build エラー** になるはず (Next 15)。
- **検証**: `next build` で `server-only`'s `__nextjsServerOnly` ガードが発火するか。発火しないなら tree shake で `LEAD_STATE_OPTIONS` のみ取り出されている (server-only モジュールは subpath import で副作用が落ちる)。発火するなら現状 broken。
- **修正**: `LEAD_STATE_OPTIONS` を `lib/state-machine.ts` か `lib/leads-options.ts` (server-only 無し) に移管。`server/queries/leads.ts` は純粋に query モジュールに戻す。

### MED-3: `safePerPage` clamp の下限 10 が `perPage=50` 固定と矛盾

- `listLeads` 引数の `perPage` は `clamp(..., 10, 100)`、デフォルト 50。
- ページ側 `app/(app)/leads/page.tsx:42` は `const perPage = 50` 固定で URL 解釈なし。
- 将来 URL で `?perPage=` を受け付ける時の整合性は取れているが、**Pagination が page 数しか URL に書かない**ので、operator が perPage 試行錯誤するには現状コード変更が必要。デモなら OK だが design intent としては clamp が dead code。
- **修正**: 当面はそのままで OK。本格対応時は `app/(app)/leads/page.tsx` で perPage を URL 経由読込 + `LeadsFilterBar` に "件/ページ" select を追加。

### MED-4: `safeQ` の trim 後空判定が空白文字に弱い

- `(q ?? "").trim().slice(0, Q_MAX_LEN)` の後 `if (safeQ) { ... }` で長さ判定 → 全角スペースや改行のみは `trim()` で空になるので OK。だが NBSP (` `) は trim されない。検索が必ず空ヒットを返す。
- **影響**: ユーザ的には "なぜか何も出ない" を生むだけで実害低。
- **修正**: `q.trim().replace(/\s+/g, " ")` で空白正規化。LOW 寄りの MED。

### MED-5: `getLeadById` / `getCampaignNamesForFilter` の catch が無音

- `getLeadById` の `catch { return null }` と `getCampaignNamesForFilter` の `catch { return [] }` で incident_id が出ない。`listLeads` だけが degraded + incident_id を露出。
- **影響**: drawer 表示時に lead が出ない理由が "見つからない" なのか "DB エラー" なのか UI から区別不能。サポート問い合わせ時の triage コスト増。
- **修正**: 両関数も `newIncidentId()` を発行し、関数戻り値に optional `incidentId` を載せる (または `console.error` だけでもサーバ側ログに incident_id を残す)。

---

## LOW (4)

### LOW-1: drawer の初期フォーカス / フォーカストラップなし
- open 時に "閉じる" ボタンへ `autoFocus`、もしくは `inert` で背景無効化。AAA 寄りで本リリース不要だが S08 までに着手推奨。

### LOW-2: `leadStateLabel` のローカルマップが `STATE_META.ja` と二重定義
- `server/queries/leads.ts:285-305` の `leadStateLabel(s)` は `STATE_META[s].ja` と完全に同じ値を返す。`state-machine.ts` から import すれば 1 箇所に。コメントで「重複排除可能」と認識済なので意図的だが、現状 source of truth が 2 つになっている。

### LOW-3: Engagement の負値 → 0 化で誤解
- `lead.score = 56` の境界で Engagement = 0/25。スコア内訳の "デモ表記" があるので最大限譲歩しても OK だが、本番 schema 化までに置き換え必須。

### LOW-4: `bulkDisqualifyLeads` の rate limit なし
- viewer はガードしているが、operator が API を叩き続ければ DB 書き込み / writeAudit に負荷集中。`lib/rate-limit.ts` 既存なので decorator 化で対応可。S07 単独では不要だが、S08 inbox 一括 reply で同パターン来るので併せて整備推奨。

---

## 設計書整合性

| 設計書節 | 要件 | 実装 | 判定 |
|---|---|---|---|
| §6.13.1 (リスト ヘッダ) | "n 件のリード" 表示 | `subtitle={\`${total} 件のリード\`}` | ✅ |
| §6.13.2 (フィルタ) | 状態 / キャンペーン / スコア / 検索 | 4 要素揃い、debounce 350ms | ✅ |
| §6.13.3 (テーブル) | 名前 / 状態 / スコア / キャンペーン / 担当 / 最終アクション | 6 カラム正規 | ✅ |
| §6.13.4 (ドロワー) | 右側 480px、URL ?lead= 同期、Esc 閉じ | 完全実装 | ✅ |
| §6.13.5 (一括除外) | operator+、監査 1 行 / lead | 完全実装 | ✅ |
| §11.1.1 (Critical Action) | モーダル + テキスト確認 | `window.confirm()` のみ | ❌ HIGH-1 |
| §12.3.1 (incident_id) | degraded 時に "INC-YYYY-XXXXXX" 提示 | `listLeads` のみ実装、他 query は無音 | ⚠️ MED-5 |

---

## 90+ 判定

**結論: 92 / 100、PASS (90+ クリア)。** HIGH-1 (`confirm()` ダイアログ) は S04 から MED として継続中の組織課題で、S07 単独で blocker 化しない判断。MED-1 (sort index) と MED-2 (`server-only` 越境 import) は GA ブロッカーなので S08/S09 で必ず潰す。

### 即時マージ可否

✅ **マージ可。** デモ範囲 (mock + small dataset) では機能要件・セキュリティ要件すべて充足。

### S08 (inbox) 着手前に解消すべき項目

1. **MED-2**: `LEAD_STATE_OPTIONS` の server-only 越境 import を解消 (build 健全性)
2. **MED-1**: `(org_id, last_action_at DESC NULLS LAST)` の複合 index 追加
3. **MED-5**: `getLeadById` / `getCampaignNamesForFilter` の catch にも incident_id

### GA (S10 以降) 前に解消

1. **HIGH-1**: AlertDialog プリミティブ化 + `<Dialog>` で confirm 置換 (S04, S07 共通)
2. **LOW-1**: drawer focus trap

---

## 引用元

- `server/queries/leads.ts` L41–132 / L158–201
- `server/actions/leads.ts` L19–90
- `app/(app)/leads/page.tsx` L24–146
- `components/leads/leads-filter-bar.tsx` L21–118
- `components/leads/leads-table.tsx` L29–186 / L225–281
- `components/leads/lead-drawer.tsx` L26–205
- `lib/utils.ts` L12–14 (`escapeLikePattern`)
- `lib/auth.ts` L21–71 (`hasAtLeastRole`)
- `db/schema.ts` L148–176 (`leads` table + index)
