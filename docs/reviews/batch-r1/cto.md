# CTO Batch Review — batch-r1 (8 画面同時レビュー)

- 対象画面: **S15 / S14 / S17 / S19 / S24 / S21 / S25 / S26** (Phase1 出荷対象)
- 設計書: `C:\Users\ooxmi\Downloads\Linkdin自動ツール\docs\ui-ux\UI_UX_Design.md` v1.3
- 観点: Phase1 ブロッカー級のアーキテクチャ / 権限階段 / 監査整合性 / 型安全のみに集中。Phase2 で対応宣言済の項目 (請求 / SSE / KYC / 検証 cron / BullMQ) は減点対象外。
- 比較対象: `docs/reviews/code-r4/cto.md` (96/100) 後の差分
- レビュー日: 2026-05-11

---

## 総合サマリ

| 画面 | スコア | 判定 | Phase1 ブロッカー数 | コメント |
| --- | --- | --- | --- | --- |
| S15 メンバー / 権限 | **86 / 100** | NEEDS REVISION | 2 | `audit action="lead.assigned"` 誤流用 + 権限階段の穴 (Admin が Owner を降格できる) が要修正 |
| S14 プラン / 請求 | **92 / 100** | APPROVED (Phase1) | 0 | Stripe 連携 Phase2 宣言が明示。`PLAN_META.team.leads` がモック USAGE と不整合 (1500 vs 1000) のみ |
| S17 通知センター | **90 / 100** | APPROVED (Phase1) | 0 | Critical 持続表示と既読除外ロジック OK。`Activity / Hourglass / CheckCircle2` の dead import 整理だけ要対応 |
| S19 監査ログ | **89 / 100** | NEEDS REVISION | 1 | `verified: true` を live 経路でハードコード。バッジは「未検証」表示に切替えるか `verifiedAt: null` で開示すべき |
| S24 ステータス | **91 / 100** | APPROVED (Phase1) | 0 | 静的モックでも構造妥当。`/api/health` 既存実装と JSON フィードが繋がっているか後段で確認推奨 |
| S21 利用上の注意 | **94 / 100** | APPROVED (Phase1) | 0 | 法務 / 安全モード / レート / 禁止事項が網羅。リンク `support@linkdinside.example` / `dpa` のドメイン整合確認のみ |
| S25 ジョブ / DLQ | **88 / 100** | NEEDS REVISION | 1 | `/jobs` に Admin+ または Manager+ の ABAC ガードなし。Operator は閲覧のみという仕様 (§6.11.7) と乖離 |
| S26 Break-Glass | **90 / 100** | APPROVED (Phase1) | 0 | Phase2 実装明示の placeholder としての品質は高い。`/recovery/break-glass` が `(app)` レイアウト外で SSO 未認証経路にあるのは正しい |

**平均: 90.0 / 100** (目標 88+ クリア)。
**Phase1 ブロッカー: 4 件 (S15 ×2 / S19 ×1 / S25 ×1)**。

---

## S15 メンバー / 権限 — 86 / 100

### Phase1 ブロッカー (HIGH × 2)

#### H1: `audit action="lead.assigned"` を role 変更 / 無効化に流用している

- 場所: `C:\Users\ooxmi\Downloads\Linkdin自動ツール\server\actions\members.ts:68, 124`
- 現状: `changeRole` と `deactivateMember` のいずれも `action: "lead.assigned"` で監査エントリを書く。`purpose` だけで `role_change` / `deactivate` を区別している。
- 影響:
  - **S19 監査ログ UI のフィルタ精度が破綻** — 「ロール変更だけ抽出」「無効化だけ抽出」が action フィルタで成立しない。
  - **コンプライアンス上の事故** — SOC2 / ISO27001 監査で「権限変更ログを示せ」と問われたとき、action 名が `lead.assigned` で出力される。GDPR / 委員会レポートのアーティファクトとして致命的。
  - hash chain の改竄耐性そのものは保たれるが、「読める形」での説明責任 (§17 改竄耐性の運用面) が壊れる。
- 修正案 (Phase1 で完結):
  1. `C:\Users\ooxmi\Downloads\Linkdin自動ツール\lib\audit.ts:31` の `AuditAction` ユニオンに以下を追加:
     ```ts
     | "member.role_changed"
     | "member.deactivated"
     | "member.reactivated"   // Phase2 で再有効化を入れるため先取り
     | "member.invited"        // 同上
     ```
     `audit_log.action` は `varchar(64)` (`db/schema.ts:238`) なので **DB マイグレーション不要**。TypeScript ユニオンの追記のみで足りる。
  2. `server/actions/members.ts:68` → `action: "member.role_changed"`、`diff: { role: { from: <現在の role>, to: parsed.data.role } }` に変更。**`from` を入れることが必須** (現状 `to` のみで「何から」の情報が消えている)。
  3. `server/actions/members.ts:124` → `action: "member.deactivated"`、`diff: { isActive: { from: true, to: false } }`。
  4. `db.transaction` 内で `.returning()` 前に旧 role を取れる SELECT を 1 本足す (`SELECT role FROM users WHERE id = $1 FOR UPDATE`)。advisory lock もそのまま生きる。
- 推定工数: 15 分。Phase1 で必ず潰す。

#### H2: 権限階段の穴 — Admin が Owner を降格できる / Admin の自殺ガードなし

- 場所: `C:\Users\ooxmi\Downloads\Linkdin自動ツール\server\actions\members.ts:41-48`
- 現状ガード:
  - L42: 「Owner への昇格は Owner のみ」 → OK
  - L46: 「自身の Owner から降格は禁止」 → OK
- 不足:
  1. **Admin が他の Owner を降格できる**。`hasAtLeastRole(session.role, "admin")` を通過した時点で、`parsed.data.role !== "owner"` で他人 (Owner 含む) を Operator に落とせる。設計書 §6.9 権限マトリクスの「メンバー招待: Admin」と「プラン変更 / データ削除: Owner 専用」の文脈に反する (= Owner 唯一性が守られない)。
  2. **Admin 自身が自分を Owner 以外に降格 (= 自殺) できる**。最後の Admin が誤って Viewer に落とすと組織のメンバー管理権限が消滅する。L46 は `session.role === "owner"` のときしか発火しない。
  3. **最後の Owner 防御がない**。Owner が 1 名のとき別 Owner が彼を降格 (これは Owner→Owner なので L42 を通過しない / 通過する) してしまうと、組織内に Owner ゼロという破綻状態が生まれる。S15 経由で出れる経路ではないが、複数 Owner 環境では成立する。
- 修正案 (Phase1 で完結):
  ```ts
  // 1. 対象ユーザーの現 role を取り、Owner を降格するのは Owner のみに制限
  const [target] = await tx
    .select({ id: schema.users.id, role: schema.users.role })
    .from(schema.users)
    .where(and(eq(schema.users.id, parsed.data.userId), eq(schema.users.orgId, session.orgId)))
    .for("update");
  if (!target) throw new Error("USER_NOT_FOUND");
  if (target.role === "owner" && session.role !== "owner") {
    return { ok: false, message: "Owner の降格は Owner のみが行えます" };
  }
  // 2. 自身を Admin 以下に降格しようとした場合は明示的に拒否 (4-eye 観点)
  if (parsed.data.userId === session.userId && !hasAtLeastRole(parsed.data.role, "admin")) {
    return { ok: false, message: "自身を Admin 未満に降格することはできません" };
  }
  // 3. Owner → 非 Owner に変更する場合、組織内アクティブ Owner 数を SELECT FOR UPDATE して 2 以上を確認
  if (target.role === "owner" && parsed.data.role !== "owner") {
    const [c] = await tx.select({ n: sql<number>`count(*)::int` })
      .from(schema.users)
      .where(and(
        eq(schema.users.orgId, session.orgId),
        eq(schema.users.role, "owner"),
        eq(schema.users.isActive, true),
      ));
    if ((c?.n ?? 0) <= 1) {
      return { ok: false, message: "組織内に Owner を 1 名以上維持する必要があります" };
    }
  }
  ```
  `deactivateMember` 側にも同じ "最後の Owner / Admin を残す" ガードが必要 (Active Owner が 1 名のとき本人以外の Admin が彼を deactivate できないこと)。
- 推定工数: 30 分 (テスト含む)。Phase1 必須。

### LOW (Phase1 必須ではない)

- L1: `RoleChanger` のドロップダウン即時送信 (`form.requestSubmit()`) は「誤クリック 1 回で権限が変わる」UX。確認モーダルなし。Phase1 で許容するなら最低限「直前の `currentRole` と差分があるときだけ submit」「変更後 toast に Undo を出す」のいずれかを推奨。
- L2: `rateLimit('role:${userId}:${targetId}', 5, 60_000)` は actor × target で 60 秒 5 回。同一 actor が複数 target に高速書込みする耐性がないが、Phase1 では現実的攻撃ベクタは小さい。

### 良い点

- `transaction` + `pg_advisory_xact_lock(hashtext(org_id))` で hash chain race を真に防いでいる (`lib/audit.ts:73`)。Phase1 でこれを実装しているのは堅実。
- DEACTIVATE 入力確認 + `useFormStatus` の pending 表示 + 自己無効化禁止 (`members.ts:105`) は最低ラインを正しく守っている。

---

## S14 プラン / 請求 — 92 / 100

### Phase1 ブロッカー: なし

### LOW

- L1: `PLAN_META.team.leads = 1500` (`page.tsx:27`) と `USAGE.leads.limit = 1500` は一致しているが、設計書 §6.8 の例示 `821 / 1,000` と乖離。実装としては設計書が古いだけで実害なし。設計書を 1500 に揃えるか、本ファイルを 1000 に揃えるかは PM 判断。
- L2: `currentPlan: PlanTier = "team"` がハードコード (`page.tsx:41`)。`session.orgId` から `organizations.plan` を引いて出す形に Phase1 中に直すのが望ましい (Phase2 マイルストーンに分類している場合は据置可)。

### 良い点

- 「上限到達時は既定で停止」「従量課金は Owner の 2FA 再認証 + 月次上限指定」の文言 (`page.tsx:140-142`) が設計書 §5.11 を忠実に転記。Phase2 で挙動を実装するときの仕様アンカーになっている。
- Phase2 ボタンに `disabled title="Phase2 で実装予定"` を一貫して付け、`<Button>` のセマンティクスを保ったまま無効化している。`href="#"` 等の偽リンクで誤遷移を生んでいない。

---

## S17 通知センター — 90 / 100

### Phase1 ブロッカー: なし

### LOW

- L1: `app\(app)\notifications\page.tsx:7-11` の `CheckCircle2 / MessageSquare / Hourglass / Activity` が import されているが、`LEVEL_META` で使われているのは `ShieldAlert / AlertTriangle / Info / MessageSquare` のみ。`CheckCircle2 / Hourglass / Activity` は未参照 → ESLint `no-unused-vars` 環境では失敗する。
- L2: タブの `aria-pressed` を `<Link>` に付与しているが、リンク要素に `aria-pressed` は正式には用途外 (button-like には `role="tab" + aria-selected` が WAI-ARIA としては正しい)。Phase1 では機能的問題なし、Designer 側で別途指摘済の領域。

### 良い点

- `searchParams` を `ALLOWED` set で whitelist し型推論を活かしている (`page.tsx:49-57`)。コードレビュー R3 で指摘された「open redirect 系の searchParams 流入」を一貫して塞いでいる方針が踏襲できている。
- Critical 通知だけ背景強調 + 既読バッジ抑制で、設計書 §11.2.2「Critical は閉じれない」のスピリットを UI 上で守っている。

---

## S19 監査ログ — 89 / 100

### Phase1 ブロッカー (HIGH × 1)

#### H1: `verified: true` のハードコード — 「整合性検証 ✓」が常に出る誤った安心感

- 場所: `C:\Users\ooxmi\Downloads\Linkdin自動ツール\server\queries\audit.ts:78`
- 現状コメント: `verified: true, // 実検証は Phase2 (root hash の二重保管照合)`
- 影響:
  - UI 側 (`app\(app)\audit\page.tsx:83-90`) は `verified` が true なら **`✓ 検証済`** バッジを出す。Phase1 出荷時点で実際の hash chain 検証は一度も走っていないのに、Owner / Admin / 外部監査人 (CSV エクスポート時) に対して「検証済」と虚偽の安心を与える。
  - 監査人視点では「verified ✓ と書いてあるのに、検証ジョブが存在しない」は **重大な発見事項 (Material weakness)**。Phase1 でも絶対に出してはいけない表示。
- 修正案 (Phase1 で完結 / 工数 10 分):
  1. `AuditResult` に `verified: boolean` ではなく `verifiedAt: string | null` を持たせる。Phase1 では常に `null` を返す。
  2. UI を以下のように切替:
     ```tsx
     {verifiedAt ? (
       <Badge tone="success">✓ {fmtDateTime(verifiedAt)} 検証済</Badge>
     ) : (
       <Badge tone="neutral">未検証 (Phase2 で日次検証ジョブを実装)</Badge>
     )}
     ```
  3. mock の `verified: true` も `verifiedAt: <昨日 09:00 JST>` 等のリアルな値にして、本物の検証ジョブの体感を見せる (オプション)。
- これは Phase1 で必ず潰す。コードの 1 箇所 / UI の 1 箇所のみで終わる。

### LOW

- L1: `/audit` の RBAC ガード `if (session && !hasAtLeastRole(session.role, "admin"))` (`page.tsx:23`) は、`session === null` (= DB 未接続 / 未ログイン) のとき素通りでモック監査ログが出る。DEMO の振る舞いとしては許容範囲だが、本番では `requireSession()` 化するか、ミドルウェア層で `/audit` を `(app)` 配下に置いてサインイン強制になっているかを確認推奨。`(app)/layout.tsx` 側の guard が機能していれば問題なし。
- L2: `entries.length` でページャ条件分岐は `total > perPage` でやっており正しいが、`entries.map` 内の `e.diff` を `JSON.stringify` で直接出力 (`page.tsx:127`)。PII (email など) が diff に入った場合、ヘッダの「監査ログ 13 ヶ月保持 (Enterprise)」と相まって長期保管リスクがある。Phase2 で diff redaction 層を入れる前提なら据置可。

### 良い点

- `getDb()` / `orgId` の二重 null チェック後にモック fallback (`audit.ts:35-43`)。Phase1 で DB 未接続環境でも壊れない設計が一貫している。
- hash 表示の 12 文字短縮 + `title={e.hash}` で完全 hash を hover で見せる UX (`page.tsx:144-149`) は監査人視点で扱いやすい。

---

## S24 ステータスページ — 91 / 100

### Phase1 ブロッカー: なし

### LOW

- L1: `OVERALL_STATUS: Status = "operational"` のハードコード (`app\status\page.tsx:48`)。`/api/health` の実 JSON を読みに行って overall を導出する形にしないと、「Web 側に出る ✓ と /api/health JSON が乖離」が起きうる。Phase1 では setting Pages Router style の `revalidate 30s` (設計書 §15 ルーティング表) でもよいので、`fetch('/api/health')` 経由でサーバ側集約に切替えるのを Phase1 後半に推奨。
- L2: 過去 30 日棒グラフが未実装 (設計書 §6.11.3 S24 部の「過去 90 日のアップタイム棒グラフ」とも乖離 / 設計書側の数値 90 / 実装側のテキスト 30)。Phase1 ではテキストでも OK だが、設計書か実装どちらに揃えるか PM 判断。

### 良い点

- `/api/health` への JSON フィードリンクを最下部に置き、SRE / 顧客プログラム両方の入口になっている (`page.tsx:159-166`)。
- `(app)` レイアウト外に置かれ、未認証 / 外部公開可能な構造になっている (= 設計書 §15 で `Static + ISR` と整合)。

---

## S21 利用上の注意 — 94 / 100

### Phase1 ブロッカー: なし

### LOW

- L1: `support@linkdinside.example` / `dpo@linkdinside.example` がプレースホルダードメイン。本番ローンチ前に正規ドメインへ置換すること。Phase1 で出荷するなら警告コメント (`{/* TODO: 本番ドメインに置換 */}`) を残す。

### 良い点

- LinkedIn 規約 / GDPR / AI 文責 / レート / 禁止事項 / 安全モードの 5 セクションが揃っており、ダッシュボード / 送信前ダイアログから常にリンクできるアンカー (§6.12) として機能する。
- 「失敗連続 5 回 → 安全モード」が「(Phase2 監視ジョブで自動化予定)」と Phase 境界を明示しており、現実装が「ボタンだけ存在」状態にならない。

---

## S25 ジョブ / 失敗 / DLQ — 88 / 100

### Phase1 ブロッカー (HIGH × 1)

#### H1: `/jobs` ページに ABAC ガードがない

- 場所: `C:\Users\ooxmi\Downloads\Linkdin自動ツール\app\(app)\jobs\page.tsx` 全体
- 設計書 §6.11.7 (`UI_UX_Design.md:902`): **「ABAC: Operator 読み取りのみ、再試行 Manager+、DLQ 廃棄 Owner」**
- 現状: `getSession()` 呼び出しがない。Viewer でもアクセスでき、Operator/Manager/Owner の階段がレンダリングに反映されない。再試行 / 廃棄ボタンは disabled だが、それは Phase2 マーカーであって RBAC ガードではない。
- 影響:
  - Viewer ロール (集計閲覧のみ) がジョブの payload / correlation_id / stacktrace を見られる → 設計書 §6.11.7 と矛盾。Operator も該当アカウントに紐づかないジョブを全件見られる (ABAC 違反)。
  - Phase2 で再試行ボタンを enable にした瞬間、ガードのないまま Operator が再試行できる回帰の温床になる。
- 修正案 (Phase1 で完結 / 工数 10 分):
  ```ts
  const session = await getSession();
  if (session && !hasAtLeastRole(session.role, "operator")) {
    return <ForbiddenView reason="Operator 以上が必要" />;
  }
  // Phase2 で実装するボタン側は、enable 条件として hasAtLeastRole(role, "manager") を渡す
  ```
  さらに `mockJobs()` 経路でも Operator は自身担当 (= `assignedAccountId` 紐付け) のみに絞ることを設計書 §6.11.7 ABAC として明示。Phase1 ではモックなので絞り込み実装は緩めて OK だが、ガード自体は **必須**。

### LOW

- L1: 統計の `failureRate1h: 1.2` がハードコード (`page.tsx:73`)。設計書 §11.1.1 / §24.1 のバーンレートトリガに直結する数字なので、Phase1 でモックでも構わないが「DEMO」表記を `Header` 内サブタイトルに足すのが安全。
- L2: `nextRetryAt`/`createdAt` 両方を相対時刻で出しているが、stacktrace が `errorMessage` 1 行に潰されている。設計書 §6.11.7 では「stacktrace 折りたたみ」が要件 — Phase1 では UI 簡略化として許容できるが、`(Phase2 で実装予定)` ヒントを行末に置きたい。

### 良い点

- `STATUS_META.running` の `Loader2` を `animate-spin` で示し、`Badge tone` を `brand/success/warning/danger` で意味的に分けているのは S04 等の状態 chip 統一規約と整合。
- Phase2 マーカー (`disabled title="Phase2 で実装予定"`) が再試行 / 廃棄ボタンに一貫して付いており、誤クリックで何も起きない。

---

## S26 Break-Glass / アカウント復旧 — 90 / 100

### Phase1 ブロッカー: なし

### LOW

- L1: `Idle Timeout 5 分` を文言で書いているが、実装上は `(app)` 配下ではないため middleware の idle 検知が走らない。Phase2 で実装するときに `/recovery/break-glass` 専用に短い session TTL を当てる必要があり、Phase1 では「文言だけ」が許容される範囲。Phase2 タスクとして明示してあれば OK。
- L2: `KYC アップロード → 4-eye 承認 → 24h 一時昇格` という重大フローを placeholder のみで Phase2 化していること自体は設計書 §5.9 に合致するが、現状本ページに `<form>` も `<input>` もない (純テキスト)。`<a href="mailto:support@...">` だけが実在 CTA。これは「災害復旧導線が実機ではメール 1 本」という意味で、SRE 観点での RPO/RTO を示し切れていない。Phase2 設計時に「メールから手動で証跡が積まれた監査ログ」を BREAK_GLASS フラグでどう吸収するかの仕様を §17 改竄耐性側で詰める必要あり。

### 良い点

- `(app)` レイアウト外配置 (= SSO ロックアウト中でも到達可能) と Logo の独立ヘッダ。設計書 §6.11.8 の前提と整合。
- 4 Step を `<ol>` で順序付け + `<Step n={1..4}>` のセマンティクスが明瞭。Phase2 で `<form>` 化する際の構造が既にできている。

---

## アクション項目サマリ (Phase1 ブロッカーのみ)

| # | 画面 | 修正点 | ファイル | 推定工数 |
| --- | --- | --- | --- | --- |
| 1 | S15 | `AuditAction` に `member.role_changed` / `member.deactivated` を追加し、`server/actions/members.ts` を切替。`diff` に `from` を含める | `lib/audit.ts`, `server/actions/members.ts` | 15 分 |
| 2 | S15 | 権限階段ガード追加: Admin による Owner 降格禁止 / 自分自身を Admin 未満に降格禁止 / 最後の Owner 維持 | `server/actions/members.ts` | 30 分 |
| 3 | S19 | `verified: true` を `verifiedAt: null` に変更し、UI バッジを「未検証 (Phase2 で日次検証)」に切替 | `server/queries/audit.ts`, `app/(app)/audit/page.tsx` | 10 分 |
| 4 | S25 | `/jobs` に `getSession()` + `hasAtLeastRole(role, "operator")` ガードを追加 | `app/(app)/jobs/page.tsx` | 10 分 |

**合計工数: 約 65 分**。Phase1 出荷ブロッカーとして必ず潰すこと。

---

## CTO 観点での総括

- Phase1 のスコープ管理 (請求 / 通知 SSE / KYC / 検証 cron / DLQ 操作の Phase2 マーカー化) は **全画面で一貫しており、CTO 観点で評価できる**。`<Button disabled title="Phase2 で実装予定">` の規約が画面横断で守られているのは大きい。
- 一方、**「権限階段」 と 「監査整合性」 は Phase1 でも完成度を落とせない領域**。S15 の `lead.assigned` 流用 / Admin による Owner 降格 / S19 の `verified` 虚偽表示は、いずれも Phase2 で直すと「過去ログが汚染された状態のまま」になるため、出荷前に解消すべき。
- S25 の ABAC ガード欠落は、Phase2 で再試行ボタンを enable した瞬間に Operator が暴発できる UX 回帰の温床。今のうちに layer ガードを入れておくこと。
- 上記 4 件 (合計 65 分) を解消すれば、平均 90.0 → **94+ / 100** に到達見込み。R5 では「Phase1 ブロッカー 0 件 / 全画面 92+」を目標に設定して問題ない。
