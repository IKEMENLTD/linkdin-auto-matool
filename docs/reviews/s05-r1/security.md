# S05 キャンペーン作成 Wizard — Security Review (s05-r1)

- **対象**: `lib/wizard-schema.ts` / `server/actions/wizard.ts` / `components/campaigns/wizard/*` / `app/(app)/campaigns/new/page.tsx`
- **依存基盤**: `lib/auth.ts` (getSession + RBAC) / `lib/audit.ts` (hash chain) / `db/client.ts` / `db/schema.ts` / `next.config.ts` (CSP) / `middleware.ts`
- **レビュア**: Security Design Agent
- **判定**: **PASS (90+)**
- **総合スコア**: **93 / 100**

---

## サマリ

S05 ウィザードはサーバーアクションでの zod 二重バリデーション、`getSession` ベースの認証、`hasAtLeastRole` による Manager 強制、`(id, orgId)` 複合 WHERE による横テナント改変阻止、`writeAudit` への結線、テンプレ変数残存の `superRefine` ブロックが揃っており、設計レベルで実装ガードが効いている。Server Actions という性質上 CSRF は Next.js が origin チェックで防いでくれる前提だが、ペイロード経由のロジック攻撃面を一通り潰せている。

一方で次の MEDIUM 級ギャップが残る:
- saveDraft の `state` ペイロードに**サーバ側サイズ上限が無い**(zod の文字数制限はフィールド単位で網羅されているが、JSON 全体のバイト数上限が無く DoS / メモリ膨張耐性が弱い)
- saveDraft 時の **`hasAtLeastRole("operator")` チェックが行われた後でも、未ログイン分岐で `ok:true` を返す**ため、Authn 失敗と「未接続環境のローカル保存」が UI 上区別できない (情報遮蔽は OK だが、本番では未認証時は 401 を返したい)
- launch 時の **draftId に対する所有者(ownerUserId)同一性チェックなし**: 同一 org 内であれば他 operator の draft を manager が踏み台にして running 化できる。テナント越境はないが org 内権限分離の観点では LOW〜MEDIUM
- 監査ログの `diff` に `firstDm` / `connectMessage` の**本文を含めていない**のは PII 観点では適切だが、規約違反疑義時のフォレンジック要件次第ではハッシュだけでも残したい(LOW)

XSS / Open Redirect / コード匂いは概ねクリーン。`redirect()` 先 `campaignId` は **DB の `.returning({ id })` で取得したサーバ生成 UUID** のため、ユーザー入力を一切経由していない。AI 下書き本文は `textarea` の value で React がエスケープするため XSS 面なし。`dangerouslySetInnerHTML` も 0 件。

---

## 各軸スコア (各 20 点)

| 軸 | スコア | コメント |
|---|---:|---|
| 1. 入力検証 (zod / 文字数 / URL / テンプレ変数 / JSON parse) | **17 / 20** | 全 step zod・`firstDm` のテンプレ変数残存 superRefine・`accountIds` UUID・時刻 regex・`startsAt` 必須・`endTime > startTime` まで網羅。減点は JSON ペイロード総量の上限欠如・`JSON.parse` のメモリ爆食い耐性・`Step3.headcountMin > headcountMax` の交差バリデ未実装 |
| 2. テナント分離 (orgId 強制 / draftId 改変) | **18 / 20** | `update().where(and(eq(id, draftId), eq(orgId, session.orgId)))` で他テナント上書きは完全に阻止。`listLinkedinAccounts(session.orgId)` も org スコープ。減点は同一 org 内で他人 draft への上書きを許す点 (ownerUserId 突合無し) |
| 3. CSRF / Server Action 認可 / 権限検査 | **19 / 20** | Next.js Server Actions のため origin チェックは Next.js が担保。saveDraft = operator、launch = manager と段階分け。Role 比較は数値ランクで型安全。減点は saveDraft の「未ログインなら 200 OK でローカル保存扱い」分岐がデモ要件としては妥当だが、認証必須運用に切替えるフラグが無いこと |
| 4. 機微情報 / ログ / 監査 | **20 / 20** | `writeAudit` で hash chain (`SHA-256(prev_hash + normalized)`)、`campaign.launched` を `targetType=campaign, targetId=campaignId` で記録。`diff` には objective / accounts(count) / dailyLimit / reviewMode のみで、メッセージ本文・JobTitles を含めていない (PII 最小化)。`process.env.NODE_ENV !== "production"` で console.error をガード。localStorage のキーは `linkdin:campaign-wizard:v1` でユーザー識別子なし |
| 5. XSS / Open Redirect / コード匂い | **19 / 20** | `redirect(/campaigns/${campaignId})` の `campaignId` は DB returning の UUID で完全サーバー由来 (open redirect 不能)。AI 下書きは textarea 経由のため React がエスケープ。`dangerouslySetInnerHTML` ゼロ。CSP `frame-ancestors 'none'` + `X-Frame-Options: DENY`。減点は CSP が現状 **`Content-Security-Policy-Report-Only`** に留まっており、`script-src 'unsafe-inline'/'unsafe-eval'` が有効でないかは別途要確認 (本ファイル群とは別 PR) |

---

## チェックリスト別所見

### A. `WizardSchema.parse(JSON.parse(raw))` の安全性

`server/actions/wizard.ts:47-53` および `:120-124`。

- `JSON.parse` を `try / catch` で囲み、失敗時はユーザー向けに安全な汎用文字列のみ返す (`"下書きの形式が正しくありません"` / `"ウィザードの状態が不正です"`)。スタックトレース流出なし。 ✅
- 直後の `WizardSchema.parse` が **strict ではないため未知フィールドは黙って drop**。これは意図通り(余分なクライアントフィールドは無害化)で OK。
- **MEDIUM: JSON ペイロード総量に上限が無い**。`String(formData.get("state"))` をそのまま `JSON.parse` に渡しているため、`firstDm` 1500 文字 + `customQuery` 1024 文字 + `jobTitles[20] * 80` などをすべて埋めても上限は約 30KB 程度には収まるが、攻撃者は zod に弾かれる前提で **巨大な未知配列 (e.g. `step1: {objective:"outbound", junk: [...100MB]}`)** を投げ込み JSON parser を圧迫する DoS が可能。Next.js Server Actions のデフォルト bodySize 1MB が一次防御だが、明示的に `if (raw.length > 64_000) return {ok:false}` を入れることを強く推奨。

### B. launch 時の最終バリデーションでテンプレ変数残存が弾かれるか

- `Step4Schema.superRefine` (`lib/wizard-schema.ts:87-104`) が `/\{\{\s*[a-zA-Z_]+\s*\}\}/` を `firstDm` に対して検査し、issue を `path:["firstDm"]` で発火する。✅
- launch アクション内で `Step4Schema.safeParse(state.step4)` を呼んでおり、ここでも同じ refine が走る。✅
- **LOW: connectMessage / abVariantB に対するテンプレ変数チェックが無い**。case 文上 firstDm のみ。LinkedIn の Connect 申請文に `{{name}}` が残ったまま送信されると顧客側で「ロボ送信」の証跡となり評判リスク。可能なら `connectMessage` と `abVariantB` 両方に同様の superRefine を足したい。

### C. localStorage に書く内容に PII が含まれる懸念

`components/campaigns/wizard/wizard-shell.tsx:41,92-103`。

- key: `"linkdin:campaign-wizard:v1"` (固定、ユーザー ID 含まず)
- 値: `{ state, furthest, draftId }` → state には会社名・製品概要・ジョブタイトル・**メッセージ本文(下書き)**・accountIds(UUID) が入る。
- **LOW**: 会社名・製品概要は組織の業務情報であって直接 PII ではないが、共有 PC で同一ブラウザを別ユーザーが使った場合、前任者の下書き(顧客向け文面ドラフト) が見える。`hydrated` 直後の `setState(parsed.state)` で復元するため、ログアウト時に key を消すユーティリティを `lib/auth.ts` 経由で呼ぶ運用が望ましい。
- `accountIds` は UUID であり、それ単体では他 org からアクセス不能(server 側で `(id, orgId)` 突合される) → クリティカルではない。
- 推奨: 「サインアウト時に localStorage 内 `linkdin:*` を一括クリア」のフックを追加。

### D. AI 生成下書きの XSS 表面

- `aiDraft()` は文字列連結のみ、入出力は `<textarea value={...}>` 経由 → React が自動エスケープ。✅
- `WizardPreview` でも `state.step2?.companyName` を `<span>{...}</span>` で出力するだけで `dangerouslySetInnerHTML` 不使用。 ✅
- `dangerouslySetInnerHTML` 全文検索: S05 配下 0 件。✅
- **NIT (LOW)**: 将来 `connectMessage` を SSR レンダープレビューに含める時、Markdown を許可するなら必ず `DOMPurify` 経由にすること。現状は LOW のまま。

### E. redirect 先 (campaignId) の検証

- `server/actions/wizard.ts:193-195`。`campaignId` は `db.update(...).returning({ id })` または `db.insert(...).returning({ id })` で取得した値。**ユーザー入力経由ではない**。 ✅
- `draftId` はユーザー入力(formData) → `LaunchSchema` で `z.string().uuid()` 検証済 → さらに WHERE 句で orgId と AND されるため、悪意ある UUID を送られても他テナント or 存在しない id はマッチせず `upd[0]?.id` は undefined となり redirect されない。 ✅
- Open Redirect 不能。✅

### F. saveDraft / launch のテナント分離詳細

#### F1. orgId 強制

- saveDraft `:75`: `where(and(eq(campaigns.id, draftId), eq(campaigns.orgId, session.orgId)))` → 他テナントの draft id を渡されても WHERE が空ヒット → `returning` が空配列 → `row[0]?.id` が undefined → クライアントは draftId 更新できず追跡破棄 (= silent fail だが副作用なし)。 ✅
- launch `:159`: 同じパターン。 ✅

#### F2. 同一 org 内の他人 draft 改変

- saveDraft / launch とも `ownerUserId` 突合を行っていない。
- 例: Operator A が draft を作る → Operator B がブラウザコンソールから A の draftId を localStorage に注入 → 自身の state でロード → 上書きが成功する。Manager B にとっては「他の operator のドラフトを running 化」も可能。
- **MEDIUM**: テナント越境は無いので CRITICAL ではないが、組織内 RBAC 粒度として `eq(campaigns.ownerUserId, session.userId)` または `OR role=manager+` 条件を追加した方が安全。
- 監査ログ的には誰が launch したかは `actorUserId` で記録されるためフォレンジックは可。

### G. CSRF / Server Action

- Next.js Server Actions は `POST` + フォーム由来 + Next.js が同一オリジン強制 + nonce 付き action ID で CSRF を防止する設計 (Next 14+)。本ファイル群は `"use server"` + `formAction={formAction}` 経由なので前提を満たす。 ✅
- 追加で `middleware.ts` が Supabase セッション cookie を毎リクエスト更新しているため、stale session でのスパム launch も抑制。✅

### H. 監査ログ結線

- `writeAudit` (`lib/audit.ts`) は hash chain で改竄耐性。`campaign.launched` を targetType=campaign で記録、`diff` には dailyLimit / reviewMode / accountIds.length / objective を保存。 ✅
- **LOW**: saveDraft 側で `campaign.created` を発火していない (status=draft のレコードが追加されているのに監査ログには現れない)。S05 のスコープ外として許容できるが、削除/差し替えの追跡で穴になる可能性あり。

### I. CSP / Headers / Coding smells

- `next.config.ts` で `frame-ancestors 'none'` / `X-Frame-Options: DENY` / `Referrer-Policy` / `Permissions-Policy` を設定済 (Report-Only)。
- Wizard 内で `eval` / `Function` / `setTimeout(string)` 0 件。
- `Math.max/min`・`Set` ベースの distinct 化など、危険な代入動作なし。
- `customQuery` (`Step3.customQuery`) は AI / LinkedIn の検索式として後段に渡される予定 (Phase 2)。今は表示のみだが、Phase2 で SQL/LDAP/外部 API に直接連結するときは別途 sanitization を必須化。

---

## 検出された Issue (重大度別)

### HIGH
- (なし)

### MEDIUM

1. **saveDraft / launch の JSON ペイロード上限欠如** (`server/actions/wizard.ts:47, 121`)
   - `JSON.parse` 前に `raw.length` 上限(推奨 64 KB)を強制し、超過時は 400 相当のレスポンス。Next.js bodySize 1 MB に依存するのは setting-leak 耐性として弱い。
2. **同一 org 内 draft の所有者突合なし** (`server/actions/wizard.ts:75, 159`)
   - `eq(campaigns.ownerUserId, session.userId)` を AND するか、`manager+` のみ他人の draft 更新を許可する RBAC を入れる。
3. **未認証 saveDraft 時のステータスが `ok:true`** (`server/actions/wizard.ts:38-42`)
   - デモ要件として現状は妥当だが、`process.env.NEXT_PUBLIC_DEMO_MODE` のような明示フラグで本番では 401 を返すよう切替可能にする。

### LOW

4. **`connectMessage` / `abVariantB` のテンプレ変数残存チェック未実装** (`lib/wizard-schema.ts:87-104`)
   - `firstDm` と同じ `superRefine` を両フィールドにも適用。
5. **localStorage `linkdin:campaign-wizard:v1` のクリア戦略未定義** (`components/campaigns/wizard/wizard-shell.tsx:60-71, 92-103`)
   - サインアウト時 / 他ユーザーログイン時のクリアハンドラを `lib/auth` に追加。
6. **`Step3.headcountMin > headcountMax` の交差バリデなし** (`lib/wizard-schema.ts:56-68`)
   - 業務的には逆転していると ICP 推定が破綻するが、UI 値域はリーチ計算ロジックで吸収。Step5 の時刻交差は実装済なので、対称性として入れたい。
7. **saveDraft が `campaign.created` を監査ログに残していない** (`server/actions/wizard.ts:34-95`)
   - 改竄耐性チェーンの連続性として残しておく方が望ましい。
8. **CSP が Report-Only** (`next.config.ts`)
   - S05 単体の責務外だが、Wizard の AI 下書きや動的 textarea を含むページが本番 Enforce に切り替わったら回帰テスト必須。

---

## 90+ 判定

- **総合 93 / 100** … **PASS**
- HIGH なし、MEDIUM 3 件はいずれも「正常運用ではテナント分離が保たれる」設計上の防御深化に関する指摘で、ローンチ承認をブロックする性質のものではない。
- Next.js Server Actions + zod 二重検証 + 監査ログ hash chain + ABAC 互換の `(id, orgId)` WHERE 句がすべて噛み合っており、S05 の Wizard は本番投入可能なセキュリティ品質に達している。
- 上記 MEDIUM #1 (ペイロード上限) と #2 (ownerUserId 突合) の 2 点は **Phase 2 着手前**には対応することを強く推奨する。

---

## 関連ファイル (絶対パス)

- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\lib\wizard-schema.ts`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\server\actions\wizard.ts`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\components\campaigns\wizard\wizard-shell.tsx`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\components\campaigns\wizard\wizard-preview.tsx`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\components\campaigns\wizard\step-product.tsx`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\components\campaigns\wizard\step-icp.tsx`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\components\campaigns\wizard\step-message.tsx`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\components\campaigns\wizard\step-delivery.tsx`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\app\(app)\campaigns\new\page.tsx`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\lib\auth.ts`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\lib\audit.ts`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\db\schema.ts`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\server\queries\accounts.ts`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\middleware.ts`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\next.config.ts`
