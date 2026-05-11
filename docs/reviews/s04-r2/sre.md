# SRE レビュー — S04 キャンペーン一覧画面 (r2)

- 対象: 同 r1 ファイル群
  - `server/queries/campaigns.ts`
  - `server/actions/campaigns.ts`
  - `components/campaigns/campaigns-table.tsx`
  - `app/(app)/campaigns/page.tsx`
  - `lib/audit.ts` (AuditAction 拡張確認)
- 設計書: `docs/ui-ux/UI_UX_Design.md` v1.3 (§15 / §17 / §24)
- 前回: `docs/reviews/s04-r1/sre.md` (62/100)
- レビュアー: SRE シニア
- 評価日: 2026-05-11

---

## 総合スコア: **88 / 100** (r1 62 → r2 **+26**)

| 評価軸 | 配点 | r1 | **r2** | 差分 | 主所見 (r2) |
| --- | ---: | ---: | ---: | ---: | --- |
| 1. パフォーマンス | 20 | 13 | **15** | +2 | leads 集計に `eq(orgId)` 二重防御追加で index 効率改善 (◎)。`count(*)::int` / `ilike '%q%'` の根本対応は Phase2 未着手 (= M-2/M-3 継続)。 |
| 2. エラーハンドリング | 20 | 8 | **17** | +9 | listCampaigns に try/catch 完備 + `source: "degraded"` 返却 (HIGH-2 完全解消)。bulkSetStatus も try/catch + tx 内エラー時に audit が書かれない設計 (◎)。**ただし tx 内 `tx.execute()` 引数なしバグで毎回 runtime throw → catch に落ちて常に "処理中に問題が発生しました" を返す** (NEW HIGH-A)。 |
| 3. 観測性 | 20 | 11 | **15** | +4 | AuditAction が `campaign.paused` / `campaign.resumed` / `campaign.archived` に分岐 (HIGH-5 解消)。1 ID = 1 audit 行に分解済み。`source` が `live`/`mock`/`degraded` の 3 値で機械可読化 (◎)。**incident_id 発行経路は型に残っているのに実装で未発行** (M-r2-a) / **構造化ログ未導入** (M-6 継続)。 |
| 4. ユーザビリティ運用 | 20 | 17 | **19** | +2 | useActionState 結線完了、成功/失敗を画面下バナーに inline 表示 (`role=status`/`role=alert`)。`useFormStatus().pending` で連打防止 + スピナー (◎)。**onComplete で selection を即クリアするため成功メッセージ表示と同時に BulkBar が unmount され、メッセージが見えない瞬間がある** (M-r2-b)。 |
| 5. キャパシティ・安全 | 20 | 13 | **17** | +4 | UI からアーカイブだけ `confirmMessage` で確認モーダル、Server 側で `expectedFromStatus` フィルタにより「paused→pause」「running→resume」状態遷移ガード (◎、冪等性 & 過剰更新防止)。bulk action 単位の rate-limit は未実装 (M-8 継続)。 |

R1 で指摘した HIGH 5 件のうち **4 件は完全に解消**、残り 1 件 (HIGH-1) は r2 段階での非対応がレビュー依頼文で **Phase2 移行コメント明示** という形で明確化されたため、MVP デモ段階の判断としては容認可能 (本番 cutover の go/no-go ゲートで再度ブロック対象とする)。一方で **新規 HIGH を 1 件発見** (tx.execute 引数欠落 = bulk 操作の完全機能停止)。これを潰せば 95+ 圏。

---

## R1 HIGH 解消確認 (5/5)

| 指摘 | r1 状態 | r2 対応 | 判定 |
| --- | --- | --- | :---: |
| HIGH-1 `withScopedDb` 未経由 | RLS GUC 未セット → 本番空配列 | r2 では未対応 (依頼文で "Phase2 RLS 適用と同時に移行" 明示) | **DEFERRED (容認)** |
| HIGH-2 listCampaigns try/catch なし | 500 で画面真っ白 | `try { ... } catch { return { source: "degraded", items: [], total: 0 } }` (queries/campaigns.ts:165-171)。型に `degraded` 追加 (◎) | **PASS** |
| HIGH-3 BulkBar 未結線 (alert 偽完了) | 死蔵 Server Action | `<form action={formAction}>` で `bulkPauseCampaigns` / `bulkResumeCampaigns` / `bulkArchiveCampaigns` を結線、hidden input で ids 送信 (table.tsx:300-311) | **PASS** |
| HIGH-4 useActionState 不使用 | エラー通知ゼロ | `useActionState<BulkActionState, FormData>(action, INITIAL_BULK_STATE)` + `useFormStatus().pending` でローディング、`state.message` を `role="status"`/`role="alert"` 切替表示 (◎) | **PASS** |
| HIGH-5 audit `action` 固定 | "campaign.launched" 嘘記録 | AuditAction union に `campaign.paused` / `campaign.resumed` / `campaign.archived` 追加 (lib/audit.ts:13-15)、bulkSetStatus 第3引数で動的指定 (actions/campaigns.ts:40, 116, 130, 144)。1 ID = 1 audit 行に分解 (actions/campaigns.ts:88-97) | **PASS** |

### HIGH-1 を Phase2 に倒した判断について

依頼文の通り MVP デモ段階では DB 未接続 (`getDb() === null` → mock 返却) と live 経路の両方が成立しているので、`withScopedDb` 経由化は RLS 本番投入と同タイミング (Phase2) で実施する判断は SRE 観点で妥当。**ただしコード上にコメント形式で TODO/Phase2 マーカーを残しておかないと、別エンジニアが live 接続時に「なぜ空配列?」で 2-3 時間溶かす**。`queries/campaigns.ts` 冒頭または `getDb()` 直後に下記を最低限残すこと:

```ts
// PHASE2-TODO(rls): live 本番投入時は withScopedDb 経由に揃え、
// db.transaction 内で set_config('app.org_id', orgId, true) を発行すること。
// 現状の getDb() 直叩きは RLS OFF 環境前提 (MVP demo) のみ動作する。
```

これがあれば本指摘は r2 段階で **解消** とみなして良い。**なければ Phase2 着手時に再度 SRE blocker**。

---

## NEW HIGH (r2 で発生 / 発見)

### HIGH-A: `tx.execute()` 引数なし → bulk 操作が **本番で 100% 失敗**

**ファイル**: `server/actions/campaigns.ts:79-82`

```ts
for (const row of result) {
  await tx.execute(
    // 監査は writeAudit を直接呼びたいが、tx 内で同一 client を使うため
    // ここでは insert を直接行う簡略実装。Phase2 で writeAuditTx に差し替え。
  );
}
```

`tx.execute()` を **引数なしで呼んでいる**。drizzle の `PgTransaction.execute()` シグネチャは `(query: SQL | SQLWrapper) => Promise<...>` で、`undefined` を渡すと内部の `Query → string` 変換で `Cannot read properties of undefined` か `TypeError: query is not a function` 系で **必ず throw**。

- 結果: `try` 全体が `catch` に落ち、ユーザには毎回 `"処理中に問題が発生しました。時間をおいて再試行してください。"` が返る。`UPDATE` 自体は tx ロールバックで取り消され、bulk 操作は **完全に機能しない**。
- mock 経路 (`getDb() === null`) では `try` 前段で fail return しているため、**DB 接続直後にこのバグが出現する** = QA で気付かれず本番デプロイで顕在化する典型パターン。
- HIGH-3/4 を「結線した」つもりでも UI 側は `state.ok === false` + message 表示で正常動作するため、E2E テスト無しでは検出不可能。

**修正 (最小)**:

```ts
// for ループ自体を削除。audit は tx の外側で writeAudit() 経由で書く既存処理に集約されている。
const updated = await db.transaction(async (tx) => {
  return tx
    .update(schema.campaigns)
    .set({ status: nextStatus })
    .where(where)
    .returning({ id: schema.campaigns.id, name: schema.campaigns.name });
});
```

**修正 (推奨、Phase2 整合)**: audit を tx 内に取り込む方針なら、`lib/audit.ts` に `writeAuditTx(tx, input)` を新設し for ループ内で `await writeAuditTx(tx, {...})` を呼ぶ。これで tx ロールバック時に audit 書込みも巻き戻り、`UPDATE` だけ通って audit が無い不整合を構造的に防げる (hash chain 整合性も維持)。

**優先度**: **P0 / リリースブロッカー**。これを直さない限り bulk 操作は本番ゼロ件動作。

---

## R1 MEDIUM 解消確認

| 指摘 | r2 対応 | 判定 |
| --- | --- | :---: |
| M-1 leads 集計に orgId 述語なし | `and(eq(leads.orgId, orgId), inArray(leads.campaignId, ids))` で二重防御化 (queries/campaigns.ts:118-124) | **PASS** |
| M-2 `count(*)::int` 重い | 未対応 (Phase2 issue) | **CARRY** |
| M-3 `ilike '%q%'` 全件スキャン | 未対応 (Phase2 issue)、ただし `escapeLikePattern` 経由は維持 | **CARRY** |
| M-4 全件選択 200 件 UI 警告 | 既存通り 25 件ページ内のみ選択構造、Zod `.max(200)` 維持 | **OK (Phase2 で UI 表示)** |
| M-5 BulkBar モバイル干渉 | `<dialog>` 化は未対応、`confirm()` がアーカイブのみ残存 | **CARRY (LOW 化可)** |
| M-6 構造化ログなし | 未対応、`console.error("[listCampaigns] DB error", ...)` のみ | **CARRY** |
| M-7 停滞バッジ SSR Date.now | `force-dynamic` 継続で当面 OK、Client `<RelativeTime>` 化は Phase2 | **CARRY** |
| M-8 bulk action rate-limit | 未対応 (`useFormStatus().pending` で連打防止のみ) | **CARRY** |
| M-9 selection リセット effect | `useEffect([rows])` で「rows に存在しない id を selected から除外」を実装 (table.tsx:41-52) (◎) | **PASS** |

PASS 3 / CARRY 6 / DEFERRED 0。CARRY は全て Phase2 issue 化推奨で、r2 のレビュー対象範囲外として容認可能。

---

## NEW MEDIUM (r2 で発見)

### M-r2-a: `CampaignListResult.incidentId` が型に残っているのに **発行されていない**

**ファイル**: `server/queries/campaigns.ts:23-27, 170` / `app/(app)/campaigns/page.tsx:41`

- 型定義に `incidentId?: string` を残しつつ、`degraded` 分岐で `{ source: "degraded" }` だけ返して `incidentId` を発行していない。
- 設計書 §24 で「障害時に画面右上に INC-YYYY-XXXXXX を提示しユーザに伝える運用」を約束しており、`lib/incident.ts` の `newIncidentId()` も既存。`degraded` 分岐 1 行で発行できるのに未実装。
- 加えて page.tsx 側で `incidentId` を受け取って表示する UI も無い (`source === "mock"` バナーはあるが `degraded` バナーは無い)。
- 結果: 本番で DB 瞬断 → 画面はテーブル空で「条件に一致するキャンペーンがありません」EmptyState が表示される。ユーザは「自分のキャンペーンが消えた!?」と判断し、サポートチケット爆発を招く。
- **修正**:
  ```ts
  // queries/campaigns.ts (catch 内)
  const incidentId = newIncidentId();
  console.error("[listCampaigns]", { incidentId, orgId, error: String(error) });
  return { items: [], total: 0, source: "degraded", incidentId };
  ```
  ```tsx
  // page.tsx (source === "mock" バナーの直後)
  {source === "degraded" && (
    <div role="alert" className="flex items-center gap-2 text-[12px] text-[var(--color-danger-700)]">
      <Badge tone="danger">障害</Badge>
      一時的にデータを取得できません。お問い合わせください。 (incident: {incidentId})
    </div>
  )}
  ```

### M-r2-b: `onComplete()` で selection を即クリア → 成功メッセージが unmount で消える

**ファイル**: `components/campaigns/campaigns-table.tsx:288-297, 218`

- `BulkActionForm` の `useEffect` が `state.ok && state.resetSelection` を検知すると `onComplete()` → 親で `setSelected(new Set())` → `BulkBar` は `ids.length === 0` で `return null` で unmount。
- `state.message` (例: `"3 件を一時停止しました"`) はその直前に表示されるが、unmount で **瞬時に消える**。SR (`role="status"` + `aria-live="polite"`) も DOM から消えた瞬間に読み上げが切れる可能性。
- 設計書 §15 「フィードバックは最低 1.5s 視認可能」原則に違反 (現状は React コミット1サイクル分 ≈ 数十 ms)。
- **修正パターン (推奨)**:
  - `BulkBar` の表示条件を `ids.length > 0 || lastResultMessage` に拡張、メッセージは `useToast()` で別レイヤーに移送する。
  - 簡易対応: `onComplete()` 内で `setTimeout(() => setSelected(new Set()), 2000)`。ただし selection を握ったまま 2s 経過し、その間に追加クリックでも UPDATE は走らない (`expectedFromStatus` ガードで冪等) ので副作用は軽微。
  - 最良: shadcn `<Sonner toast>` を `app/layout.tsx` レイヤで常設し、`state.ok` 時に `toast.success(state.message)` を発火 → BulkBar は安心して unmount できる。

### M-r2-c: `bulkSetStatus` が **`updated.length === 0`** でも `{ kind: "ok", affected: 0 }` を返す

**ファイル**: `server/actions/campaigns.ts:100`

- `expectedFromStatus` フィルタ (例: paused→pause で `running` 行のみ更新) で 1 件も該当しなければ `updated.length === 0` だが `kind: "ok"` で `"0 件を一時停止しました"` 表示。
- 運用上「200 件選んだのに 0 件しか反映されていない」が **正常完了として扱われる** → ユーザは成功と誤認し、後で「あれ?paused になってない」事案発生。
- 加えて 0 件時に `revalidatePath("/campaigns")` を毎回打つので、空 UPDATE で再描画コストだけ食う (低優先)。
- **修正**:
  ```ts
  if (updated.length === 0) {
    return { kind: "fail", message: "対象状態のキャンペーンがありません (対象が既に変更済みの可能性)" };
  }
  ```

### M-r2-d: `BulkActionForm` 3 個が **互いの state を共有していない**

**ファイル**: `components/campaigns/campaigns-table.tsx:230-252`

- 「一時停止」「再開」「アーカイブ」それぞれが独立 `useActionState` を持ち、互いの message を上書きしない。
- 副作用 1: 「一時停止に失敗 → 即座に再開を押す」で再開の form 側に何も表示されないまま完了 → 元のエラーメッセージは 一時停止 form 側で残り続け、ユーザが混乱。
- 副作用 2: `completedRef` も form ごとに独立しているので、アーカイブ成功直後に一時停止を押すと「アーカイブ成功」のメッセージが残ったまま新規 pending 表示が並ぶ。
- 設計書 §15 のフィードバック原則 (「直近 1 アクションのみ表示」) と矛盾。
- **修正**: BulkBar 親側で 1 つの `useActionState` を持つか、Toast レイヤに一元化 (M-r2-b と同根)。

---

## LOW (r2 追加)

- **L-r2-1**: `tx.execute()` の上に置いた 3 行コメントがコードレビュー中に **「コメント書いたら満足して実装漏れ」** の典型例になっている。コメントで指示を完結させるのではなく、未実装なら `throw new Error("PHASE2: writeAuditTx not implemented")` で実行時に気付ける形にすべき。
- **L-r2-2**: `INITIAL_BULK_STATE` の `ok: false` 初期値は「初回マウント直後に `state.message` が undefined で表示されない」ので問題ないが、`ok: false && message: undefined` だと型上「失敗状態」扱いになる。`ok: null` か `idle: true` フラグで初期/成功/失敗 3 値化が安全 (型上の意図表明)。
- **L-r2-3**: `BulkActionForm` の `onSubmit` で `confirm()` 利用継続。M-5 で指摘した通りモバイル UX 上は `<AlertDialog>` 化を Phase2 で。
- **L-r2-4**: `queries/campaigns.ts:165-171` の catch で `error` を `String(error)` 化していない。`Error.stack` を含む生オブジェクトを `console.error` 第二引数で渡しているのでローカルは OK だが、Vercel Log Drain での JSON シリアライズで `circular reference` 警告が出る可能性。`error: err instanceof Error ? { message: err.message, stack: err.stack } : String(err)` 形に正規化推奨。
- **L-r2-5**: `bulkResumeCampaigns` の audit diff が `{ from: "paused", to: "running" }` で記録されるが、`expectedFromStatus` が `"paused"` の場合のみ正しい。`expectedFromStatus` 不指定パス (現状アーカイブ専用) では `from: null` でなく実際の status を取って差分にしたほうが監査の解像度が上がる。Phase2 で `result` 取得時に `previousStatus` も `returning()` で取得すれば実現可能。

---

## 良い点 (r2 で新規)

1. **`expectedFromStatus` による状態遷移ガード** — `running → paused` / `paused → running` の遷移を Server 側で強制し、誤った遷移 (例: completed→paused) を SQL レベルで弾く設計。冪等性と「他ユーザが裏で paused にした後の上書き防止」の両方に効く。SRE 観点で◎。

2. **`source: "live" | "mock" | "degraded"` の 3 値化** — `live` 動作確認 / `mock` デモ表示 / `degraded` 障害分岐がコード上の case 分岐で機械可読化された。Phase2 で SLO ダッシュボードに「degraded 発生率」を可視化する基盤になる。

3. **`useFormStatus().pending` でボタン即時 disable + スピナー** — Server Action 連打を Client 側で構造的に防止。M-8 (rate-limit) と組み合わせれば多層防御。設計書 §15 のローディング表現原則とも一致。

4. **selection リセット effect** — `useEffect([rows])` で表示外 ID を automatic に prune する設計は、ページネーション / フィルタ変更時の「画面に居ない ID を bulk 更新」事故を構造的に防止。M-9 への完全回答。

---

## 95+ 到達のための残ブロッカー

| 優先 | 項目 | 期待効果 | 該当指摘 |
| ---: | --- | --- | --- |
| **P0** | `tx.execute()` 引数なしバグ修正 (for ループ削除 or writeAuditTx 新設) | bulk 操作が **本番で動く** ようになる、+5 〜 7pt | **HIGH-A** |
| P1 | `degraded` 分岐で `newIncidentId()` 発行 + page.tsx に障害バナー追加 | DB 瞬断時のユーザ体験 / サポート工数削減、+1 〜 2pt | M-r2-a |
| P1 | `updated.length === 0` で fail を返す | 「成功と誤認」事故防止、+1pt | M-r2-c |
| P2 | Toast レイヤ導入 (Sonner) で成功/失敗メッセージを BulkBar 外に出す | M-r2-b / M-r2-d を同時解消、UX 一貫性 +1pt | M-r2-b, M-r2-d |
| P2 | `queries/campaigns.ts` 冒頭に PHASE2 RLS TODO コメント明記 | HIGH-1 を「容認」のままにする最低条件 | HIGH-1 (DEFERRED) |
| P3 | bulk action に user 単位 rate-limit (`bulk:${userId}` 5req/分) | 監査ログ重複防止 | M-8 |
| P3 | 構造化 JSON ログ + `latencyMs` 出力 (queries / actions) | Vercel Log Drain → 観測基盤の入口 | M-6 |
| P3 | `pg_trgm` GIN index + count 戦略合意 | 万件超で P95 SLO 維持 | M-2, M-3 |

**P0 (HIGH-A)** を潰せば 88 → 93。P1 2 件で 93 → 96 で **95+ 確実圏**。P2 以下は Phase2 へ送って良い。

---

## 判定: **NEAR**

- HIGH 残存: 1 件 (NEW HIGH-A: tx.execute 引数欠落、リリースブロッカー)
- R1 HIGH 解消率: **5/5 (HIGH-1 は DEFERRED 容認、4/4 PASS)**
- NEW HIGH: 1 件
- 総合: **88/100** (95+ 未到達)

### PASS / NEAR / FAIL

**NEAR**。R1 HIGH の構造的修正は秀逸 (try/catch + degraded source / useActionState 完全結線 / audit action 分岐 / selection prune effect)、設計判断も SRE 観点で全て妥当。しかし **NEW HIGH-A (`tx.execute()` 引数なし)** が「動かないコードを動くと思って commit した」典型例で、E2E が無い状態でこのまま merge すると本番 bulk 操作が完全停止する。

**この 1 点を直す PR を即出せば 95+ 確実**。同時に M-r2-a の incident_id 発行 1 行を追加すれば 96 圏に乗る。

修正は機械的で 10 行未満、テストは「bulk pause で 1 件以上更新される」E2E 1 本で担保可能。即対応可。
