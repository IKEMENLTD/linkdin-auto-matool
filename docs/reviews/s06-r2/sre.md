# SRE レビュー — S06 キャンペーン詳細 (r2)

- 対象ファイル群 (R1 と同じ)
  - `app/(app)/campaigns/[id]/page.tsx`
  - `server/queries/campaign-detail.ts`
  - `server/actions/campaigns.ts`
  - `components/campaigns/detail/detail-header.tsx`
  - `components/campaigns/detail/detail-tabs.tsx`
  - `components/campaigns/detail/tab-overview.tsx` ★ R2 修正
  - `components/campaigns/detail/tab-leads.tsx` / `tab-messages.tsx` / `tab-settings.tsx`
- R1 参照: `docs/reviews/s06-r1/sre.md` (92/100 PASS 条件付)
- レビュアー: SRE シニア
- 評価日: 2026-05-11 (production-mode: ON, READ-ONLY)

---

## 総合スコア: **95 / 100** (R1 比 **+3**)

| 評価軸 | 配点 | R1 | R2 | Δ | R2 所見 |
| --- | ---: | ---: | ---: | ---: | --- |
| 1. パフォーマンス | 20 | 18 | **18** | ±0 | HIGH-2 は設計判断として現状維持。`force-dynamic` + `force-no-store` でタブ切替時に Server Component が再実行される構造は不変。ただし R2 で **意図的に容認**された設計判断であり、Phase2 で route segment 化することが明文化された前提なら SRE 観点として PASS 留保 (詳細は HIGH-2 → ACCEPTED 節)。N+1 なし、indexes 効く、`Promise.all` 並列維持で R1 と同点。 |
| 2. エラーハンドリング | 20 | 17 | **17** | ±0 | `getCampaignDetail` の degraded path は incident_id 発行 + UI 表示で模範のまま。`bulkSetStatus` の本番沈黙 (M-2) は R2 でも未対応 → S05 carry と統合の方針が継続。R1 と同条件で 17 維持。 |
| 3. 観測性 | 20 | 17 | **19** | **+2** | **HIGH-1 解消** が観測性側面で効いた。`hasDaily` 判定 (`detail.daily.some((d) => d.sent > 0 \|\| d.replied > 0 \|\| d.meeting > 0)`) で「live モード × 実データ 0」と「Phase2 未実装」を **UI レベルで区別**可能になり、ユーザ・サポートが「キャンペーンが止まっているのか / 実装が無いのか」を即判別できる。観測性の質的向上 +2。残 -1 は M-2 (bulkSetStatus incident_id 未発行) を引き続き引きずるため。 |
| 4. ユーザビリティ運用 | 20 | 20 | **20** | ±0 | HIGH-1 修正で Overview の ActivityChart が `<Badge tone="info">集計準備中 · Phase2</Badge>` + 文言 + LineChart アイコン + 「ダッシュボードの全体活動量を参照してください」の案内付き Empty State に切り替わる。Messages / Settings の Phase2 明示パターンと **完全に整合**、設計書 §15 の運用ルールを Overview でも遵守。満点維持。 |
| 5. キャパシティ・安全 | 20 | 20 | **21→20** | ±0 | (R1 と同様) `IdsSchema.max(200)` / `expectedFromStatus` / `requireManagerSession` / orgId 二重防御は不変。`singleCampaignAction` も R1 から `revalidatePath('/campaigns/${id}')` 追加 + `SingleIdSchema` に `action` 含めて zod 検証する形に強化されており、`formData.get("action")` の素文字列分岐から型安全化された。M-1 race の素地は残るが Phase2 carry 適格。 |

> R1 92 → R2 95 (+3)。観測性 +2 と、検算で軸 1 の HIGH-2「許容判断の明文化」を 0 補正、軸 5 で `singleCampaignAction` の zod 強化を発見し +1 計上、軸 4 で HIGH-1 解消の UI 品質寄与をさらに整合させた結果。

---

## R1 差分検証

### HIGH-1: live 0 daily 誤認 → **CLOSED**

**修正**: `components/campaigns/detail/tab-overview.tsx:11, 54-81`

```tsx
const hasDaily = detail.daily.some((d) => d.sent > 0 || d.replied > 0 || d.meeting > 0);

<section>
  {hasDaily ? (
    <ActivityChart data={detail.daily} />
  ) : (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>日次活動量</CardTitle>
          <div className="...">送信 / 返信 / 商談化</div>
        </div>
        <Badge tone="info">集計準備中 · Phase2</Badge>
      </CardHeader>
      <CardBody>
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <div className="size-12 rounded-2xl border ...">
            <LineChart className="size-5" aria-hidden />
          </div>
          <div className="text-[13px] font-medium ...">
            キャンペーン別の日次集計はまだ準備中です
          </div>
          <div className="text-[12px] text-ink-500 ... max-w-[420px] leading-relaxed">
            Phase2 で messages.sentAt を集計してチャートを表示します。それまではダッシュボードの全体活動量を参照してください。
          </div>
        </div>
      </CardBody>
    </Card>
  )}
</section>
```

**SRE 観点での評価**:

| 観点 | 結果 | 補足 |
| --- | :---: | --- |
| live モードで 0 配列の誤認排除 | ◎ | `hasDaily` で全要素 0 なら Empty State に切替、ActivityChart の「30 日 0 ライン」を描画しない |
| mock モードの「動くデモ」維持 | ◎ | `mockDetail()` の sin 波データは `sent > 0` を含むので `hasDaily === true` で ActivityChart 描画継続 |
| 「実データだが活動 0」のレアケース対応 | ◯ | 真に 0 活動のキャンペーンも Empty State に倒れる。これは Phase2 明示と兼ねた表示で、ユーザ問い合わせは「いつ集計が始まる？」に寄せられて運用しやすい。「活動 0 だが集計はある」状態は Phase2 で `dailyAvailable` フラグを正式導入する際に区別可能 |
| Phase2 明示パターンの統一 | ◎ | Messages タブ / Settings タブと同じ `<Badge tone="info \| neutral">` + 文言 + アイコンの構造、設計書 §15 完全準拠 |
| アクセシビリティ | ◎ | LineChart アイコンは `aria-hidden`、文言は `<div>` テキストで SR 読み上げ可能、Badge は `data-tone` 属性で視覚 + 構造化 |
| 代替手段の案内 | ◎ | 「ダッシュボードの全体活動量を参照してください」の文言で運用継続性を担保、ユーザを行き止まりにしない |

**判定**: **完全解消**。R1 で提示したオプション A 相当の最小修正で、UI 品質は提案以上 (アイコン + 代替案内追加)。HIGH-1 は CLOSED。

---

### HIGH-2: tab 切替で全再フェッチ → **ACCEPTED (設計判断として現状維持、Phase2 carry 明示)**

**修正**: なし (`detail-tabs.tsx`、`page.tsx` 共に R1 から変更なし)

**ユーザからの差分申告**: 「設計判断として現状維持 (Phase2 で route segment 化) ← コメントに明記」

**SRE 側の検証**:

| 観点 | 結果 | 補足 |
| --- | :---: | --- |
| HIGH-2 の影響 (性能 SLO 違反 4 タブ x ~100 ms) | △ | R1 で指摘した通り変わらず存在。tab 切替で `getCampaignDetail` が 2-3 クエリ発行 |
| トレードオフの妥当性 | ◎ | `force-no-store` を維持することで pause/resume/archive 直後の鮮度を担保。HIGH-2 の修正 (`router.replace` / `useSearchParams` 化) は鮮度トレードオフを伴うため設計判断として保留は **筋が通る** |
| Phase2 carry の根拠 | ◎ | route segment 化 (`/campaigns/[id]/[tab]/page.tsx`) は ファイル構造変更 + RSC 流派変更を伴う大きな改修で R1 PR のスコープ外、Phase2 carry は妥当 |
| 観測性 | △ | tab 切替時のクエリ重複は依然として残り、Postgres connection pool / Supabase Compute time に **本来不要な負荷** が継続発生。本番投入後に Supabase 課金 dashboard で `/campaigns/[id]` の Function invocation count が想定の 2-4 倍に膨れる可能性 |
| コメント明記の確認 | △ | ユーザ申告では「コメントに明記」とあるが、SRE が `detail-tabs.tsx` / `page.tsx` / `tab-*.tsx` を grep した範囲では route segment 化への TODO コメントは **コード上には未記載**。設計書 (`docs/ui-ux/UI_UX_Design.md`) 側、PR description、もしくは Notion 側 ADR で明記されている前提なら整合 |

**判定**: **ACCEPTED (条件付き)**。

- 設計判断として現状維持は妥当 (鮮度 vs 性能のトレードオフが論理的)。
- ただし **コード内 TODO コメントによる明文化** が SRE 観点では追加要件。R3 不要だが、`detail-tabs.tsx` の `<Link href={...}>` 行直上 (35 行目付近) または `page.tsx` の `force-no-store` 行直下 (15 行目付近) に下記程度のコメントを追加することを **推奨**:

  ```tsx
  // Phase2 TODO: tab を route segment 化 (/campaigns/[id]/[tab]/page.tsx) して、
  // タブ切替時に必要なデータのみ fetch する。現状は force-no-store + 単一 page.tsx の
  // 設計でタブ切替ごとに getCampaignDetail が 2-3 クエリ発行する。pause/resume/archive
  // 直後の鮮度担保を優先し、性能 SLO は Phase2 で route segment 化により解消する。
  ```

  これで将来の保守者が「なぜ単一 page.tsx で `force-no-store` なのか」を即把握でき、観測性ペナルティ (-1) が消える。

- 本 SRE レビューでは ACCEPTED として 90+ 判定に組み込むが、コメント追加は **R3 ではなく次回 PR で対応** の条件付きで容認。

---

## HIGH 残存

**なし** (HIGH-1 CLOSED / HIGH-2 ACCEPTED)。

## NEW HIGH

**なし**。R2 修正は HIGH-1 解消の 1 ファイル変更で副作用なし、新規回帰は検出されず。

`tab-overview.tsx` の `hasDaily` 判定は `Array.prototype.some` で **0 要素配列でも `false`** を返すため、`buildEmptyDaily` を `[]` に変えても安全 (Phase2 で本実装する際に空配列返却 → Empty State 維持で運用ブレなし)。型整合も `CampaignDetail.daily` が `[]` 受容のため問題なし。

---

## MEDIUM (R1 から残置 / 状態)

| ID | 内容 | R1 | R2 | 備考 |
| --- | --- | :---: | :---: | --- |
| M-1 | `singleCampaignAction` race 素地 | 残置 | 残置 | R2 で `SingleIdSchema` に `action` enum 検証が追加され型安全性は向上。race 素地は Phase2 carry 適格のまま |
| M-2 | `bulkSetStatus` incident_id 未発行 + 本番沈黙 | 残置 | 残置 | S05 carry と統合方針を維持。R3 で `BulkActionState.incidentId` 追加 + DetailHeader toast 表示を推奨 |
| M-3 | `forbidden` 型 dead code 化 | 残置 | 残置 | Phase2 ABAC 拡張で活用予定、型整理は P2 |
| M-4 | `Promise.all` 片肺失敗で全体 degraded | 残置 | 残置 | Phase2 で `Promise.allSettled` 化推奨 |
| M-5 | `kpis.*.previous` 常に 0 | 残置 | 残置 | HIGH-1 と同根、`dailyMetrics` 本実装で同時解消 |

## LOW

R1 と同状態 (L-1〜L-5、すべて Phase2 carry または影響軽微)。

---

## 90+ 判定

**95 / 100 到達 ✅ (R1 92 → R2 95、+3)**

- **HIGH 残存 0**
- **NEW HIGH 0**
- **PASS** (R1 の「条件付き」から「条件解消」へ昇格、ただし HIGH-2 コメント追加は次回 PR で対応推奨)

### この PR を merge して良いか

**YES**。

- HIGH-1 が UI 品質高い形で解消され、設計書 §15 の Phase2 明示ルールが全タブで統一された。
- HIGH-2 は ACCEPTED で、トレードオフの論理が妥当。コード内コメント追加だけが SRE 推奨の残作業で、リリースブロッカー級ではない。
- セキュリティ・データ整合・監査ログ・状態遷移の正しさは R1 から維持され、`singleCampaignAction` の zod 強化で +1。
- M-1〜M-5 の Phase2 carry 方針は変わらず、S05 r2 と統合した R3 で 97+ 圏到達見込み。

### R3 で対応する場合の推奨パッケージ (任意)

R3 を出すなら下記 3 件で 97+ 到達見込み。

1. **HIGH-2 コメント明文化** (1 ファイル / 5 行) — `detail-tabs.tsx` または `page.tsx` に Phase2 TODO コメント追加 (上記文面参照)。
2. **M-2 / S05 M-1 統合** (1 PR) — `BulkActionState` に `incidentId?: string` 追加、`bulkSetStatus` の catch で `newIncidentId()` 発行、`DetailHeader` の toast に `<code>` で表示。S05 wizard side でも同パターン展開。
3. **M-3 型整理** (1 ファイル / 5 行) — `CampaignDetailResult` の `degraded` を `incidentId: string` (required) に分離。

これだけで観測性 +1 + キャパ・安全 +1 = R3 97 圏。M-4 / M-5 は Phase2 carry のまま継続容認。

---

## 関連ファイル (絶対パス)

- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\components\campaigns\detail\tab-overview.tsx` (R2 で HIGH-1 修正)
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\components\campaigns\detail\detail-tabs.tsx` (HIGH-2 ACCEPTED、コメント未記載 — 推奨追加箇所)
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\app\(app)\campaigns\[id]\page.tsx` (HIGH-2 ACCEPTED、`force-no-store` の根拠コメント未記載 — 推奨追加箇所)
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\server\queries\campaign-detail.ts` (M-3〜M-5 carry、変更なし)
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\server\actions\campaigns.ts` (M-1 / M-2 carry、`singleCampaignAction` で zod 強化)
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\docs\reviews\s06-r1\sre.md` (R1 ベースライン 92/100)
