# CTO技術レビュー — UI/UX設計書 v1.1（Round2）

- 対象: `docs/ui-ux/UI_UX_Design.md` (v1.1 / 2026-05-09)
- 親レビュー: `docs/ui-ux/reviews/round1_cto.md` (Round1 / 71 / 100)
- レビュー観点: フロントエンドアーキテクチャ / リアルタイム整合性 / パフォーマンス / 計測SLO / 状態機械-UI整合
- レビュア: CTO Agent（Round1と同一）
- 作成日: 2026-05-09
- イテレーション: round2

---

## 冒頭サマリ

- **Round1 HIGH 7件**: **解消 6 / 部分解消 1 / 残存 0**
- **NEW HIGH（v1.1で生じた）**: **2 件**（CIRCUIT BREAKER の根拠データ経路 / Liveblocks採用と§17 PII / §23 と §15 のbundle数値矛盾）
- **総合スコア**: **89 / 100**（Round1: 71 → +18）
- **Verdict**: **APPROVED with conditions**（NEW HIGH 2件と、§15 §23.6 の数値矛盾を v1.2 で解消すれば 95+ 到達）

---

## 総合スコア: 89 / 100

| # | 評価軸 | v1.1スコア | v1.0スコア | 差分 | コメント |
| --- | --- | --- | --- | --- | --- |
| 1 | フロントエンドアーキ妥当性 (App Router / RSC / Streaming / Cache) | **18 / 20** | 13 | **+5** | §23.1 全画面マトリクス化 + §23.2 命名規約で R1-H1/H2 完全解消。残るのは「RSC streaming の Suspense 境界」「Server Action と TanStack mutation の helper 規約」の **コード側ガイドラインへの落とし込み**のみ。 |
| 2 | リアルタイム / SSE / Webhook 整合性 | **17 / 20** | 14 | **+3** | §23.3 で SSE 採用 / Last-Event-ID / backoff jitter / Redis pub/sub / 5万同時 → Centrifugo の上限プランまで明記。R1-H3 解消。残るのは「Webhook → DB → SSE relay の **順序保証 sequence number** をどう発行するか」「Edge Runtime か Node Runtime か」が未明（§23.3 は Vercel か AWS かに依存）。 |
| 3 | パフォーマンス予算の達成可能性 | **16 / 20** | 15 | **+1** | §23.6 で経路別 bundle 予算（180 / 220 / 240KB）に rebase。R1-H5 部分解消。**ただし §15 が「初回 < 200KB gzip」のまま放置されており、§23.6 と矛盾**（NEW HIGH-1）。CI gate（`size-limit` / `bundlewatch`）の閾値ソースが二重定義になる。 |
| 4 | 計測 (PostHog/Sentry/RUM) と SLO の関係 | **18 / 20** | 13 | **+5** | §24.1 SLO 表 + エラーバジェット + アラート閾値が完備、§11.2.1 Critical SLA / §12.3.1 incident_id / correlation_id / trace_id の階層が明示。R1-H6 完全解消。残るのは「PostHog session replay の PII masking ルール」「Sentry traces sample rate 数値」が未記述（§17.3 で PII サニタイズはあるが **計測パイプライン側の sample rate / replay masking** が空白）。 |
| 5 | 状態機械・データモデルとUI表現の一貫性 | **20 / 20** | 16 | **+4** | §3.3 を Lucide アイコン + aria-label + EXPIRED / SAFE_MODE / QUARANTINED 追加で 14 状態に拡張、§27 HITL ステートマシン（REVIEW_REQUIRED / SEMI_AUTO / FULL_AUTO）+ §9.2.1 CircuitBreaker + §23.7 LangGraph ノード境界の対応で R1-H4/H7 完全解消。状態機械 → UI → 監査ログ → 計測イベントが直線で繋がっている。本軸は **満点**。 |

---

## Round1 HIGH 解消チェック（1件ずつ）

### H1. RSC / Client / Server Actions の責務分離 → **解消**

- **対応箇所**: §23.1 画面別レンダリング戦略マトリクス
- **検証**:
  - 13 画面すべてに「レンダリング / データ取得 / キャッシュ / リアルタイム / 理由」5列で記述あり
  - ダッシュ = RSC + Streaming + サーバ集約 RPC、受信箱 = Client + SSE、ウィザード = Client + Server Action という Round1 で求めた配分が完全反映
  - `/login` `/signup` を Static / SSR、`/status` を Static + ISR と公開系を分離している点も適切
- **未消化**: 「Server Action 完了 → revalidateTag → TanStack invalidateQueries の helper を必ず使う」と§23.2 に書かれているが、helper 関数のシグネチャ例（疑似コード）が無い。コード規約として落とすには十分だが、エンジニアによって書き方が分散するリスク。**MEDIUM**級。

### H2. Cache 戦略（staleTime / fetch cache / revalidate）→ **解消**

- **対応箇所**: §23.1（画面ごとの `staleTime: 0 / 30s / 5min / Infinity` の 4 段階明示）、§23.2 命名規約
- **検証**:
  - グローバル `staleTime` 禁止 → 4 段階のみ、という縛りが秀逸
  - `cache:<resource>:<id>:<params hash>` / `tag:<resource>:<id>` / TanStack key の 3 系統の命名規約あり
  - Webhook → `revalidateTag` 経路は §23.1 の `/connections/*` で「OAuth callback で revalidate」と部分記述、§24 の `Webhook 受信 → 反映 P99 < 30s` SLO とも整合
- **未消化**: `revalidatePath` vs `revalidateTag` の選定基準が空白。Tag ベースで統一する判断を §23.2 に 1 行追記推奨。**LOW**級。

### H3. SSE スケール / フォールトトレランス → **解消**

- **対応箇所**: §23.3
- **検証**:
  - SSE 採用 + ロングポーリング fallback、`Last-Event-ID`、backoff jitter ±20%、5s 切断検知 + 3s チラつき防止、Cookie 認証 / CSRF 対策、Redis pub/sub、5万同時 → Centrifugo / Ably 切替の上限プランまで明記
  - Round1 で要求した全項目を網羅
- **未消化（NEW MEDIUM）**: 順序保証（Webhook 並列受信 → DB 単調増加 sequence の発行）が空白。`event_id` だけでは並行受信時の順序保証にならない。「DB INSERT 時に `LATERAL nextval('seq_event')` で seq を発行 → SSE event の `id:` フィールドに seq、Last-Event-ID 復帰時は `WHERE seq > :lastSeq` で抜け漏れ補完」を §23.3 に追記推奨。

### H4. Optimistic UI 粒度 → **解消**

- **対応箇所**: §23.4（Optimistic UI ポリシー表 9 行）
- **検証**:
  - 既読化 / Draft / タグ / スヌーズ = ✓、送信 / 状態遷移 / 削除 / プラン / 権限変更 = ✗
  - 「他セッションの SSE 受信と Optimistic の競合 → サーバ ID 一致なら無視 / 不一致なら merge」の競合解決ルールが明示
  - §6.4 会話画面の「5 秒キュー Undo」と整合
- **完全解消**

### H5. 200KB gzip の現実性 → **部分解消**

- **対応箇所**: §23.6 経路別 bundle 予算
- **検証**:
  - `/login`(80KB) / `/`(180KB) / `/inbox/:id`(220KB) / `/campaigns/new`(240KB) / vendor < 120KB に rebase
  - dynamic import で Tiptap, Visx, ファイル DnD を切り出す方針も明示
  - 経路別の現実的な数値設定は Round1 推奨どおり
- **NEW HIGH-1**: §15 のテーブルが **「バンドル 初回 | < 200KB gzip」のまま**で、§23.6 と数値矛盾。CI ゲートの根拠が二重化する（どちらが正？）。§15 は §23.6 を SoT として参照する形に書き換え必須。

### H6. SLO / Error Budget / アラート閾値 → **解消**

- **対応箇所**: §24.1 SLO 一覧 9 行 + §24.2 Runbook 7 件 + §11.2.1 Critical SLA + §12.3.1 incident_id 階層
- **検証**:
  - Web TTI P95 < 3.0s（バジェット 5h）、API 可用性 99.9%（43min）、SSE 接続維持 99.5%（3.6h）、Webhook 受信→反映 P99 < 30s など Round1 で要求した粒度を満たす
  - 「エラーバジェット枯渇時は新機能リリース凍結 + SLO 復帰までスケール優先」のポリシー明記
  - Runbook が安全モード / Unipile 障害 / LLM ベンダフェイルオーバー / プラン上限暴走 / Postmortem / 退職者ハンドオフ / Prompt Injection と網羅
- **未消化（NEW MEDIUM）**: PostHog session replay の PII masking 設定（`*[data-pii]` セレクタ等）と Sentry `tracesSampleRate` の数値が空白。§17.3 の PII サニタイズは **LLM 送信前**の話で、**計測パイプライン側の masking** とは別レイヤー。

### H7. LangGraph ノード境界と UI ストリーミング表現 → **解消**

- **対応箇所**: §23.7 + §6.4 + §9.2.1
- **検証**:
  - LangGraph ノード（`qualify` `enrich` `personalize` `respond`）ごとにイベント送信
  - UI: 「現在のステップ: パーソナライズ中…」進度バー
  - **段落単位ストリーミング**（token-by-token 禁止）= Round1 でタイプライター禁止を求めた延長として正しい
  - Esc キャンセル / 段落ごとに再試行 / チャンク ID マップで出典紐付け
  - §17.4 の Indirect Prompt Injection 防御まで連携している
- **完全解消**

---

## NEW HIGH（v1.1 で生じた問題）

### NH1. §15 と §23.6 のバンドル予算が **数値矛盾**したまま放置

- **該当**: §15「バンドル 初回 < 200KB gzip」 vs §23.6「`/`(180KB) / `/inbox/:id`(220KB) / `/campaigns/new`(240KB) / vendor < 120KB」
- **問題**:
  - 同一文書内に 2 つの予算定義があり、CI 上の `size-limit.config.js` をどちらに合わせるか実装側で混乱する
  - QA で「200KB を超えた」レポートが上がっても §23.6 の経路別予算では合格、というすれ違いが起きる
  - §22 の DoD で「主要ユーザーフローでパフォーマンス予算遵守」と書かれているが、どちらの予算を指すか不明
- **修正案**:
  - §15 の表を「経路別予算は §23.6 を Source of Truth とする」と書き換え、初回値は削除 or `vendor chunk < 120KB` のみ残す
  - DoD §20 に「§23.6 の経路別予算を `size-limit` で CI gate」と 1 行追加
  - もし「最も軽い経路（`/login`）= 80KB を SoT」とするなら、§15 を `/login` 基準に置き換える
- **影響**: HIGH（CI gate の閾値が確定しないとパフォーマンス予算は実効性ゼロ）

### NH2. §23.5 Liveblocks 採用と §17.3 PII サニタイズが **未整合**

- **該当**: §23.5「共同編集 = Liveblocks 採用、Phase2」 / §17.3「PII を LLM プロバイダ送信前に正規表現 + ML 検知でマスク」
- **問題**:
  - Liveblocks は **第三者 SaaS（米国 Vercel系）にデータが渡る**。キャンペーン作成ウィザードの共同編集（§5.6.1）で「製品概要」「ICP 検索式」「メッセージ案」が Liveblocks サーバを通る
  - これらは **顧客の機微営業情報**であり、§17 の Region（JP/EU 切替）原則と整合しない
  - §26.1 脅威モデル 5 + 2 にも「越境データ移転 / 同意撤回」が挙がっているが、Liveblocks のデータ保管リージョンへの言及が無い
  - Liveblocks は当初 us-east-1 のみで、EU リージョンはエンタープライズプランのみ。Scale プラン（§22.1 リージョン JP/EU）と不整合の可能性
- **修正案**:
  - §23.5 に「Liveblocks 採用は **メタデータのみ**（カーソル位置・選択範囲のみ送信）、本文は自社 WebSocket + Yjs CRDT で保持」の分割設計を明記
  - または Yjs + 自前 WebSocket 採用に切替、Liveblocks は OSS 風のラッパーのみ使う
  - §17 / §26 に「Liveblocks → SubProcessor リスト」「DPA 締結」「リージョン制約」を追記
  - Phase2 開始時に Architecture Review を再開、と §19 に追記
- **影響**: HIGH（Phase2 の共同編集機能が SOC2 / Pマーク監査で引っかかる可能性）

---

## MEDIUM 指摘（v1.1 で新たに気づいた / Round1 で深掘り）

### NM1. SSE 順序保証の sequence 発行が未明（H3 残課題）

- **該当**: §23.3
- **問題**: `event_id` (ULID) はあるが、Webhook 並列受信時の **DB 単調増加 sequence** が無い
- **修正案**: `events` テーブルに `seq BIGSERIAL`、SSE で `id: <seq>` を送信、再接続時 `Last-Event-ID: <seq>` で `WHERE seq > :lastSeq ORDER BY seq` で欠損補完

### NM2. PostHog session replay の PII masking ルール空白

- **該当**: §16 + §17.3
- **問題**: §17.3 は LLM 送信前 PII マスクのみ。PostHog session replay は **DOM ノードを録画する**ため、別途 `data-private` 属性 + `maskTextSelector` 設定が必要
- **修正案**: §16 に「session replay は `data-private` 属性のあるノードを `maskTextSelector` で完全マスク。`<input type="email">` 等は `maskInputOptions` で type 別マスク。Sentry `tracesSampleRate: 0.1`、`replaysOnErrorSampleRate: 1.0`、`replaysSessionSampleRate: 0.05`」を追記

### NM3. Server Action / TanStack mutation helper のシグネチャ未定義（H1 残課題）

- **該当**: §23.2
- **問題**: 「mutate 時は Server Action で `revalidateTag` + クライアントは `invalidateQueries` を 1 セットで呼ぶ helper を必ず使う」とあるが、helper の関数シグネチャ例が無い
- **修正案**: 疑似コードで `mutateWithRevalidation({ action, tags, queryKeys })` のシグネチャを §23.2 に 5 行追加

### NM4. §22.1 のリージョン JP/EU と §23 の SaaS（Liveblocks / PostHog / Sentry）の整合性

- **該当**: §22.1 Scale プラン「リージョン JP/EU」 / §23.5
- **問題**: 採用 SaaS 5 つ（Liveblocks / PostHog / Sentry / Vercel / Anthropic / OpenAI）の **データ保管リージョン**と、Scale プランの「リージョン JP/EU 切替」の整合性が空白
- **修正案**: §17 に「サブプロセッサ一覧」表を追加、各 SaaS の保管リージョン（PostHog: EU / US 選択可、Sentry: US 既定 / EU プラン、Anthropic: US 既定 / Bedrock経由でリージョン分離可）を明記

### NM5. §23.7 の段落単位ストリーミングと §6.4 のローダー表現の整合

- **該当**: §6.4 の「左上ローダーと `ESC で中止`」 / §23.7 の「現在のステップ: パーソナライズ中…」進度バー
- **問題**: §6.4（Round1 から残存）は単一ローダー、§23.7（v1.1 追加）はステップ進度バー。同じ画面（会話）で表現が二重定義
- **修正案**: §6.4 を §23.7 ベースに書き換え、「左上に LangGraph ステップチップ（`qualify → enrich → personalize → respond`）+ Esc 中止」に統一

### NM6. CircuitBreaker の発動データ経路が未記述

- **該当**: §9.2.1 / §23.3 / §27
- **問題**: 「失敗率 > 5%」「単位時間レート > 平常時 3 倍」は **どこで集計するか**（API 側 PostgreSQL クエリ / リアルタイム集計 Redis / 監視 Prometheus）が空白
- **修正案**: §9.2.1 末尾に「集計は API 層の Redis Sorted Set（24h ローリングウィンドウ）+ 1min cron で評価。発動時は `circuit_breaker_events` テーブルへ INSERT → SSE 経由で全画面の HITL バッジを更新」を追記

### NM7. §11.2.3 の `/status` ページ Source of Truth と §23 の §RSC 整合

- **該当**: §11.2.3 / §23.1
- **問題**: §11.2.3 は `incidents` テーブル、§23.1 では `/status` = Static + ISR (revalidate 30s)。**インシデント発生時に 30s 反映遅延**は §11.2.1 の `T+0:00 アプリ内 Critical バナー` SLA と矛盾する可能性
- **修正案**: `/status` は ISR 30s + on-demand revalidation（`revalidatePath('/status')` を inicident 作成 webhook で発火）と §23.1 に明記

---

## LOW 指摘

### NL1. 日付ライブラリの選定変更（Round1 提案 → v1.1 採用）

- §23.5 で `date-fns` 採用と明記。Round1 では dayjs を推奨したが、date-fns でも tree-shake すれば十分小さい。OK。ただし **`date-fns-tz`** の追加 import が必要（タイムゾーン処理）、§23.5 に追記推奨

### NL2. Aikon セット選定の確定

- §3.3 で `lucide-react` 採用明記。Round1 提案どおり。OK

### NL3. CHANGELOG の粒度

- v1.1 のエントリが「§1.1.1 NSM / §1.1.2 復帰導線、§3.3 Lucide ...」と網羅的に書かれている。Round1 LOW で求めたとおり。OK

### NL4. キーボードショートカット衝突の `event.isComposing` 抑止

- Round1 M8 で指摘した IME 中の発火抑止が §8.2 Form の鉄則に「IME（日本語入力）変換中は Enter で送信しない（イベントは `compositionend` 後）」として反映済み。OK
- ただし §6.4 の `J/K/R/E/S/G I` ショートカットへの IME 抑止は未明。§8.2 の原則を §6.4 にも適用、と §6.4 に 1 行明記推奨

### NL5. Drawer URL 同期戦略

- Round1 M3 で Parallel Routes + Intercepting Routes を提案したが、v1.1 §6.3 ではドロワー / §8 でも詳細化されていない。Phase2 で再検討と書くか §23.1 の `/leads` 行に注記

### NL6. Stripe Webhook 整合

- Round1 M6 の指摘は §22 で「アップ/ダウングレードは画面 1 操作で即時切替」とあるが Webhook 経由の整合は未記述。§22.1 + §23.1 の `/settings/plan` 行に「Stripe Webhook → `revalidateTag('billing:'+wsId)`」を 1 行追記推奨

---

## 良い点（v1.1 改訂で特筆すべき箇所）

1. **§3.3 状態機械の Lucide アイコン化 + EXPIRED / SAFE_MODE / QUARANTINED 追加（14 状態）**
   Round1 で「FAILED が汎用すぎる」と指摘した箇所を、QUARANTINED（DLP/規約検査保留）/ EXPIRED（コネクト承認期限切れ）と分割して語彙を増やしたうえで、`aria-label`（日本語）と クラス名（英語）を分離する設計は a11y / i18n / 実装の三方向に効く強い意思決定。Round1 の 16/20 → 20/20 に押し上げた最大要因。

2. **§9.2.1 CircuitBreaker + §27 HITL ステートマシンの三段階化**
   `REVIEW_REQUIRED / SEMI_AUTO / FULL_AUTO` を 30 日採用率 / 失敗率 / DLP / Owner 2FA / 4-eye principle で機械的に管理する設計は、AI 自動送信 SaaS で最も事故りやすい部分（Round1 H4 の延長）を **状態機械として封じ込めた**。降格条件 = CircuitBreaker 発動条件 = 計測アラート閾値、と 3 層が同期している。

3. **§24 SLO + §11.2.1 Critical SLA + §12.3.1 incident_id 階層の三位一体**
   SLO（数値）→ アラート（検知）→ Critical SLA（T+0:00〜T+0:30 のエスカレーション）→ incident_id / correlation_id / trace_id の階層的識別子 → Status Page までを線形に繋いだ。Round1 H6 で SLO 単独の追記を求めたが、v1.1 はそれを **観測性パイプライン全体**へ昇華させており、SRE 観点で 13/20 → 18/20 に到達した最大要因。

---

## 95+到達のために残るブロッカー（v1.2 で必須）

優先度順：

1. **NH1 §15 と §23.6 のバンドル予算統一**（HIGH）
   - §15 を「§23.6 を SoT として参照」に書き換え
   - DoD §20 に CI gate の閾値ソースを明記
   - 推定工数: 5 分（書き換えのみ）

2. **NH2 Liveblocks のデータ保管リージョン明記**（HIGH）
   - §23.5 に「Liveblocks はカーソル / 選択範囲のみ、本文は Yjs + 自前 WebSocket」の分割設計
   - §17 に SaaS サブプロセッサ一覧表（リージョン / DPA / 撤回 API）
   - 推定工数: 30 分（設計判断 + 表作成）

3. **NM1 SSE 順序保証 sequence 発行**（MEDIUM）
   - §23.3 に DB BIGSERIAL + Last-Event-ID 補完経路を追記

4. **NM2 PostHog session replay PII masking + Sentry sample rate**（MEDIUM）
   - §16 に session replay masking ルール / sample rate 数値を追記

5. **NM3 mutateWithRevalidation helper の擬似シグネチャ**（MEDIUM）
   - §23.2 に 5 行の擬似コード追加

6. **NM6 CircuitBreaker 集計データ経路**（MEDIUM）
   - §9.2.1 に Redis Sorted Set + 1min cron + DB INSERT + SSE push の経路を追記

上記 6 件で合計推定工数 90 分。すべて **既存設計の 1〜10 行追記**であり、新規設計判断は NH2 の Liveblocks 分割設計のみ。

---

## 結論

**Verdict: APPROVED with conditions**

Round1 で指摘した HIGH 7 件のうち 6 件が完全解消、1 件（H5 bundle 予算）は §23.6 で経路別 rebase したが §15 の旧値が放置されており **NEW HIGH-1**として残存。加えて §23 の追加で **NEW HIGH-2**（Liveblocks のデータ保管リージョン未確認）が露出。

総合 89/100 は v1.0 の 71/100 から **+18 点**で、Round1 で要求した「画面別レンダリング戦略 / SSE スケール / SLO / LangGraph ノード境界」の 4 大ブランクをすべて埋めた成果。状態機械軸（§3.3 + §27）は **20/20 満点**到達。

NH1 / NH2 + MEDIUM 6 件を v1.2 で解消すれば、5 軸全体で 95+ 到達が見える。**Phase 1 の本実装着手は条件付き許可**（NH1 / NH2 のうち少なくとも NH1 は scaffold 段階で解消すること、NH2 は Phase2 共同編集機能の着手前までに解消）。

---

## 次アクション（Architect への差戻し事項 / v1.2）

- §15 のバンドル予算行を §23.6 参照に統一、DoD §20 に CI gate の閾値ソースを明記（NH1）
- §23.5 の Liveblocks 採用に「データ分割（カーソル / 本文）」設計を追加、§17 に SaaS サブプロセッサ一覧表（NH2）
- §23.3 に SSE 順序保証 sequence 発行と Last-Event-ID 補完経路を追加（NM1）
- §16 に session replay masking ルール + Sentry sample rate 数値を追加（NM2）
- §23.2 に `mutateWithRevalidation` helper シグネチャ 5 行を追加（NM3）
- §9.2.1 に CircuitBreaker 集計データ経路（Redis + cron + DB + SSE）を追加（NM6）
- §6.4 の AI Draft ローダー表現を §23.7 ベース（ステップチップ）に統一（NM5）
- §22.1 リージョン JP/EU の整合のため §17 に SaaS サブプロセッサ一覧表を追加（NM4、NH2 と統合可）
- §11.2.3 の `/status` を ISR 30s + on-demand revalidation と §23.1 に明記（NM7）
