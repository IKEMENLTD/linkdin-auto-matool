# CTO Batch Review — batch-r2 (R1 HIGH 修正確認)

- 対象画面: **S15 / S14 / S17 / S19 / S24 / S21 / S25 / S26** (R1 と同一)
- 比較対象: `C:\Users\ooxmi\Downloads\Linkdin自動ツール\docs\reviews\batch-r1\cto.md` (平均 90.0/100, HIGH 4 件)
- レビュー日: 2026-05-11
- 観点: R1 で指摘した Phase1 ブロッカー (HIGH × 4) の解消確認 + 周辺リグレッション検査

---

## 総合サマリ

| 画面 | R1 → R2 | 判定 | HIGH 残 | コメント |
| --- | --- | --- | --- | --- |
| S15 メンバー / 権限 | **86 → 95 / 100** (+9) | APPROVED (Phase1) | 0 | H1 (action 名) / H2 (権限階段) ともに完全解消。確認ダイアログ + 最後の Owner ガードまで実装 |
| S14 プラン / 請求 | **92 → 92 / 100** (±0) | APPROVED (Phase1) | 0 | R1 対象外。差分なし |
| S17 通知センター | **90 → 90 / 100** (±0) | APPROVED (Phase1) | 0 | R1 対象外。dead import (LOW) は未着手だが Phase1 出荷阻害ではない |
| S19 監査ログ | **89 → 95 / 100** (+6) | APPROVED (Phase1) | 0 | `verified: true` → `verifiedAt: string \| null` への型変更 + UI 切替まで完了。`未検証 (Phase2)` バッジが Honest |
| S24 ステータス | **91 → 92 / 100** (+1) | APPROVED (Phase1) | 0 | middleware の `PUBLIC_PATHS` に `/status` 追加で SSO 外公開が明示的に成立 (副次効果) |
| S21 利用上の注意 | **94 → 94 / 100** (±0) | APPROVED (Phase1) | 0 | R1 対象外。差分なし |
| S25 ジョブ / DLQ | **88 → 95 / 100** (+7) | APPROVED (Phase1) | 0 | `getSession()` + `hasAtLeastRole(session.role, "operator")` のページガード追加完了。Viewer 拒否を Forbidden ビューで明示 |
| S26 Break-Glass | **90 → 91 / 100** (+1) | APPROVED (Phase1) | 0 | middleware で `/recovery` が公開パス化、SSO ロックアウト中の到達性が hardening された |

**平均: 90.0 → 93.0 / 100** (+3.0 / 目標 92+ クリア)
**Phase1 HIGH ブロッカー: 4 → 0 件 (全消化)**

---

## R1 HIGH 解消状況 (詳細)

### [S15 H1] `audit action="lead.assigned"` 流用 — RESOLVED

- 修正ファイル: `C:\Users\ooxmi\Downloads\Linkdin自動ツール\lib\audit.ts:32-35` / `server\actions\members.ts:96, 100, 176, 180`
- 確認した変更:
  - `AuditAction` ユニオンに `member.role_changed` / `member.deactivated` / `member.reactivated` / `member.invited` を追加。Phase2 予約も含まれており拡張性 OK
  - `changeRole` の writeAudit が `action: "member.role_changed"` + `diff: { role: { from: target.role, to: parsed.data.role } }` に変更。**`from` も入っている** (R1 修正案の必須項目)
  - `deactivateMember` の writeAudit が `action: "member.deactivated"` + `diff: { isActive: { from: target.isActive, to: false } }` に変更
  - DB schema 側は `varchar(64)` のため migration 不要 (R1 想定通り)
- 副次効果: S19 監査ログ UI で「ロール変更だけ抽出」「無効化だけ抽出」が action フィルタで成立する基盤が整った。SOC2 / ISO27001 / GDPR 監査アーティファクトとして説明可能な状態に
- 残課題: なし。完全解消

### [S15 H2] 権限階段の穴 — RESOLVED

- 修正ファイル: `C:\Users\ooxmi\Downloads\Linkdin自動ツール\server\actions\members.ts:57-84, 143-165`
- 確認した変更:
  - `changeRole` のトランザクション内で対象ユーザの現 role を SELECT、`target.role === "owner" && parsed.data.role !== "owner" && session.role !== "owner"` で **Admin による Owner 降格** を拒否 (`CANNOT_DEMOTE_OWNER`)
  - `target.role === "owner" && parsed.data.role !== "owner"` の場合、アクティブ Owner 数を `count(*)` で確認し `<= 1` なら `MUST_KEEP_ONE_OWNER` で拒否 (最後の Owner ガード)
  - `deactivateMember` 側も対称に `target.role === "owner"` 経路に同じ 2 段ガードを実装 (`session.role !== "owner"` 拒否 + 最後の Owner ガード)
  - エラーメッセージは日本語 i18n で UI 側に渡る (`Owner の降格は他の Owner のみが行えます` / `組織に最低 1 名の Owner が必要です`)
- 良い点:
  - すべてのチェックが `db.transaction` 内で完結している (race 防止)
  - エラー throw → catch でメッセージ分岐の構造が見通しよく、Phase2 で監査ログ side-effect を増やしても整合性が壊れない
- 残課題 (LOW):
  - L1: `SELECT ... FOR UPDATE` までは付与されていない。並行 Owner 降格には脆弱だが、Phase1 では現実的攻撃ベクタは小さい
  - L2: R1 で示した「Admin が自分自身を Admin 未満に降格」のガード (4-eye 観点) は未実装。L46 は `session.role === "owner"` 限定のまま。`if (parsed.data.userId === session.userId && !hasAtLeastRole(parsed.data.role, "admin"))` を追加する余地あり (推奨 / 5 分)

### [S19 H1] `verified: true` ハードコード — RESOLVED

- 修正ファイル: `C:\Users\ooxmi\Downloads\Linkdin自動ツール\server\queries\audit.ts:23-32, 48, 85` / `app\(app)\audit\page.tsx:54, 83-93`
- 確認した変更:
  - `AuditResult.ok = true` 分岐に `verifiedAt: string | null` を追加 (R1 修正案通り、`boolean` ではなく日時を返せる型に変更されている)
  - live / mock いずれの経路でも `verifiedAt: null` を返す (Phase1 では常に未検証)
  - UI 側で `verifiedAt ? ✓ 検証済 (日時) : 未検証 (Phase2)` の三項分岐。`Badge tone="warning"` の `未検証 (Phase2)` バッジが Honest かつ Phase2 への期待値も伝えている
  - `title="日次検証ジョブは Phase2 で実装予定です"` で hover ヒントも完備
- 監査人視点: 「verified ✓ と書いてあるのに実検証ジョブが存在しない」という **Material weakness のリスクが完全に消えた**。Phase1 出荷判定で監査人が指摘する根拠がなくなった

### [S25 H1] `/jobs` の ABAC ガード欠落 — RESOLVED

- 修正ファイル: `C:\Users\ooxmi\Downloads\Linkdin自動ツール\app\(app)\jobs\page.tsx:17, 66-79`
- 確認した変更:
  - `import { getSession, hasAtLeastRole } from "@/lib/auth"` を追加
  - ページ先頭 (`searchParams` パース直後) で `getSession()` → `!hasAtLeastRole(session.role, "operator")` を判定
  - Forbidden 時は `Header subtitle="権限が不足しています"` + Lock icon + 「Operator 以上の権限が必要です」のアラート bowl を表示。`role="alert"` 付き
  - `session === null` (DB 未接続 / 未ログイン) のときは素通り → DEMO モードのまま見える (S19 と同じパターンで一貫)
- 良い点: 設計書 §6.11.7 の「ABAC: Operator 読み取りのみ、再試行 Manager+、DLQ 廃棄 Owner」の **第 1 段** が確実に建立。Phase2 で再試行ボタンを enable する際は `hasAtLeastRole(role, "manager")` を渡せばよい構造に
- 残課題 (LOW):
  - L1: モックデータの ABAC 絞り込み (Operator は自身担当のみ) は未実装。R1 同様 Phase1 では緩和可。Phase2 で `mockJobs(session.userId)` 化することを推奨

### [middleware 改善] `/recovery` / `/status` 公開パス追加 — APPROVED

- 修正ファイル: `C:\Users\ooxmi\Downloads\Linkdin自動ツール\lib\supabase\middleware.ts:42-53`
- 確認した変更:
  - `PUBLIC_PATHS` に `/status` / `/recovery` / `/api/health` / `/api/csp-report` / `/legal` が追加
  - `isPublic` 判定が `pathname === p || pathname.startsWith(p + "/")` で **prefix-match の罠** (`/status-foo` が `/status` 配下と誤判定される問題) も回避済
- 効果:
  - S24 ステータスページ: SSO 未認証でも到達できることが middleware レベルで保証される (= 設計書 §15 「Static + ISR」「外部公開」要件と整合)
  - S26 Break-Glass: SSO ロックアウト中のリカバリ動線が middleware で阻害されなくなった
- 評価: R1 で各画面 LOW として残していた「`(app)` 外配置の意図が middleware で担保されているか不透明」という指摘が解消。CTO 観点で意図がコード上明示された

### [S15 UX] RoleChanger 確認ダイアログ — APPROVED

- 修正ファイル: `C:\Users\ooxmi\Downloads\Linkdin自動ツール\components\settings\members-table.tsx:181-216`
- 確認した変更:
  - `<form onSubmit>` 内で `select?.value` を取得し、`nextRole === currentRole` なら `e.preventDefault()` で no-op
  - `window.confirm(``ロールを「${ROLE_LABEL[nextRole]}」に変更します。よろしいですか？``)` で確認
  - キャンセル時は `select.value = currentRole` で **UI 側の表示も元に戻す**。`requestSubmit` 起因の "DOM 上は変更後の表示で送信は止まる" 不整合を回避
- 評価: R1 LOW (誤クリック 1 回で権限が変わる UX) を Phase1 中に解消したのは堅実。`window.confirm` は a11y 上の最小ラインだが、`disabled title` 規約と同等の Phase1 妥協として許容範囲
- 残課題 (LOW): Phase2 でモーダル化する場合は `<Dialog>` (Radix) ベースに置き換え、SR 読み上げ / フォーカストラップを正式化することを推奨

---

## 画面別 LOW 残課題 (Phase1 出荷ブロッカーではない)

| # | 画面 | LOW | 推奨対応時期 |
| --- | --- | --- | --- |
| 1 | S15 | `SELECT ... FOR UPDATE` 追加 (並行 Owner 降格 race の最終蓋) | Phase1 後半 (15 分) |
| 2 | S15 | Admin 自身を Admin 未満に降格するガード | Phase1 後半 (5 分) |
| 3 | S15 | `window.confirm` → `<Dialog>` (Radix) 化 | Phase2 |
| 4 | S14 | `PLAN_META.team.leads` の設計書整合 (1500 vs 1000) | PM 判断 |
| 5 | S14 | `currentPlan` ハードコードを `organizations.plan` 引きに変更 | Phase1 後半〜Phase2 |
| 6 | S17 | `CheckCircle2 / Hourglass / Activity` dead import 削除 | Phase1 (5 分) |
| 7 | S19 | diff redaction 層 (PII 長期保管リスク) | Phase2 (設計書 §17) |
| 8 | S24 | `/api/health` JSON 読み込みで overall を導出 | Phase1 後半 |
| 9 | S24 | 過去 30/90 日棒グラフ | Phase1 or 設計書整合 |
| 10 | S21 | `linkdinside.example` ドメインを本番ドメインに置換 | 出荷直前 |
| 11 | S25 | mockJobs を session.userId で ABAC 絞込み | Phase2 |
| 12 | S25 | `failureRate1h: 1.2` ハードコード → DEMO 表記追加 | Phase1 (5 分) |
| 13 | S26 | `<form>` 化 + Idle Timeout 5 分の middleware 実装 | Phase2 |

---

## CTO 観点での総括

- **R1 で指摘した HIGH × 4 はすべて解消**。修正範囲がコンパクトで (`audit.ts` ユニオン追加 + `members.ts` トランザクション内ガード + `audit.ts` 型変更 + `audit/page.tsx` 三項分岐 + `jobs/page.tsx` セッションガード)、リグレッションリスクが小さい設計通り
- 副次的改善 (middleware の `PUBLIC_PATHS` 拡張 + RoleChanger 確認ダイアログ) は R1 では LOW 扱いだったが、Phase1 中に潰せたのは堅実。**「権限階段」「監査整合性」「公開境界」の 3 軸が Phase1 出荷品質に到達**
- 平均スコア **93.0/100 (前回比 +3.0)**、目標 92+ をクリア。Phase1 出荷の CTO ブロッカーは **ゼロ**
- 残課題はすべて LOW で、SOC2 / ISO27001 / GDPR 監査の説明責任に直接影響するものは存在しない。Phase2 マイルストーンとして引き継ぎ可
- 推奨次アクション:
  1. S15 LOW #1 (SELECT FOR UPDATE) と LOW #2 (Admin self-demote ガード) を 20 分以内で潰してから出荷
  2. S17 dead import (LOW #6) は ESLint failure を引き起こす可能性があるため出荷前に削除
  3. S21 のドメイン置換 (LOW #10) は出荷直前のチェックリスト項目に追加
  4. これら 3 件を消化すれば平均は **94+/100** に到達見込み

### R2 判定: **全画面 APPROVED (Phase1)**

R3 は不要。Phase1 出荷ゲートは CTO 観点で通過済。LOW を Phase2 バックログに移し、出荷に進んでよい。
