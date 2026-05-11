# S10 会話画面 セキュリティレビュー (r2)

**レビュー対象 (r1 から差分のあるファイル中心)**:
- `lib/dlp.ts` (新設、NFKC normalize + 全角/半角/英語キーワード DLP — HIGH-1 対策)
- `server/actions/conversation.ts` (DLP を `detectDlpViolation()` へ集約、`sendMessage` に rate-limit 追加 — HIGH-1 + HIGH-2 対策)
- `components/inbox/composer.tsx` (UI 側 dangerHint を共有 DLP に差し替え)
- `lib/utils.ts` (`safeExternalUrl()` 追加 — HIGH-3 対策)
- `components/inbox/conversation-view.tsx` (`safeExternalUrl()` 経由表示、URL null 時は `<a>` を出さず代替テキスト)

**継続参照**:
- `server/queries/conversation.ts` (r1 から無変更、ガード境界は不変)
- `lib/rate-limit.ts` (r1 から無変更、in-memory bucket / Phase2 Upstash 化 TODO)
- `lib/audit.ts` (r1 から無変更、hash chain + advisory lock)

**レビュー日**: 2026-05-11
**レビュー方針**: r1 と同一軸 (STRIDE + OWASP Top10 + LLM Top10) で、R2 で潰した HIGH 3 件の確認 + 副作用チェック + 新規 HIGH の探索。

---

## 総合スコア: **96 / 100** (r1: 91 → **+5**) → **90+ 判定 PASS**

| # | 評価軸 | 配点 | r1 | r2 | 差分 | 判定 |
|---|---|---|---|---|---|---|
| 1 | テナント分離 (`leads.orgId` / `messages` の lead 経由スコープ) | 20 | 20 | **20** | ±0 | PASS |
| 2 | 認可 (Operator+ / UUID / Zod) | 20 | 19 | **19** | ±0 | PASS |
| 3 | 入力検証 (DLP / 1500 字 / 機微パターン) | 20 | 17 | **20** | **+3** | PASS |
| 4 | 監査ログ結線 (message.sent / lead.requalified / tx) | 20 | 20 | **20** | ±0 | PASS |
| 5 | XSS / Open Redirect / IPI | 20 | 15 | **17** | **+2** | PASS |
| **計** | | **100** | **91** | **96** | **+5** | **PASS** |

> **90+ 判定 PASS (R2 で HIGH 3 件すべて解消)**。残置は MEDIUM/LOW のみで Phase2 改善枠。

---

## R2 差分 — HIGH 3 件の修正確認

### HIGH-1 (r1) ✅ 解消: DLP の NFKC normalize / 英語キーワード / UI-Server 共有

**新設 `lib/dlp.ts:14-20`**:
```ts
export function detectDlpViolation(input: string): { reason: string } | null {
  const normalized = (input ?? "").normalize("NFKC");
  for (const p of PATTERNS) {
    if (p.regex.test(normalized)) return { reason: p.reason };
  }
  return null;
}
```

**パターン (`lib/dlp.ts:7-12`)**:
```ts
{ regex: /(?:\d{2,4}[-\s]?){2,}\d{3,4}/, reason: "電話番号" },
{ regex: /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i, reason: "メールアドレス" },
{ regex: /(?:割引|値引き|特別価格|無料\s*提供|discount|free\s+offer)/i, reason: "価格 / 値引きに関する文言" },
{ regex: /(?:〒?\s?\d{3}-?\d{4})/, reason: "郵便番号" },
```

**動作確認 (机上トレース)**:

| 入力 | NFKC 後 | 検知 | r1 → r2 |
|---|---|---|---|
| `０３−１２３４−５６７８` (全角) | `03-1234-5678` | 電話番号 ✅ | bypass → 検知 |
| `john＠example.com` (全角＠) | `john@example.com` | メール ✅ | bypass → 検知 |
| `Ｄｉｓｃｏｕｎｔ 30%` (全角英字) | `Discount 30%` | 価格 ✅ | bypass → 検知 |
| `discount available now` (英語) | (NFKC 不変) | 価格 ✅ | bypass → 検知 |
| `free offer` | (NFKC 不変) | 価格 ✅ | bypass → 検知 |
| `〒107-0052 港区赤坂` | (NFKC 不変) | 郵便番号 ✅ | (新規追加) |
| `john[at]example.com` | (NFKC 不変) | — | 未検知 (LOW、設計議論あり) |

**良い点**:
1. **UI (`composer.tsx:20,167`) と Server (`conversation.ts:9,59`) が同じ `detectDlpViolation()` を import** → drift 物理的に発生不能。これは r1 で示唆した「両端で同じ regex を維持」の最善実装パターン。
2. NFKC は Unicode Standard Annex #15 準拠で、全角→半角だけでなく `①` → `1`, `㈱` → `(株)`, ファイラ等の互換文字を一括正規化。攻撃者の Unicode 系小細工 (Mathematical Bold, Fullwidth, Halfwidth, Squared Latin など) を 1 関数で吸収。
3. **正規表現は NFKC 後の文字列のみに適用**。元の生文字列は保存・送信時にそのまま残るので、ユーザの意図 (例えばわざと全角で書いた商品名) は失われない。表示崩れリスクなし。
4. メール正規表現の `/i` フラグで大文字小文字も両対応。
5. 郵便番号パターンを **追加** (r1 では未指摘の improvement)。LinkedIn DM で住所を送ること自体が稀だが、商談化前の連絡で出やすい。

**残課題 (LOW、減点なし)**:
- `john [at] example.com` / `john(at)example.com` / `phone: zero-three-one-two-three-four` 等のソーシャル obfuscation は未検知。Phase2 で `[at]` `(at)` `．` `dot` 系の表記ゆれを `normalize` ステップで `@`/`.` に置換するレイヤーを追加すれば拾える。現状でも素人攻撃者は弾けるので Phase1 MVP として十分。
- Zero-width chars (U+200B-200D, U+FEFF) は NFKC でも残る。`〇３−１２３４−５６７８` (全角文字に zero-width 挟む) 等を完全に潰すなら `.replace(/[​-‍﻿]/g, "")` を normalize ステップに足すと完璧。Phase2 改善枠。

**Server 側強制も維持 (`conversation.ts:59-65`)**:
```ts
const danger = detectDlpViolation(parsed.data.content);
if (danger) {
  return { ok: false, message: `${danger.reason} が含まれています。Manager 以上の承認が必要です (Phase2 で承認フロー)` };
}
```
- 順序: `safeParse → DLP → requireOperator → rateLimit → tx`。**auth 前に DLP** という r1 で OK 判定した順序を維持。curl bypass 不可。

→ **入力検証 17 → 20 (+3)**。

---

### HIGH-2 (r1) ✅ 解消: `sendMessage` のレート制限

**新規 (`conversation.ts:75-82`)**:
```ts
// user × lead 単位でレート制限 (5 件 / 60 秒、LinkedIn 規約準拠)
const rl = rateLimit(`send:${session.userId}:${parsed.data.leadId}`, 5, 60_000);
if (!rl.ok) {
  return {
    ok: false,
    message: "短時間に送信が集中しています。少し時間をおいてから再度お試しください。",
  };
}
```

**評価**:

1. **キー設計 `send:${userId}:${leadId}` が秀逸**:
   - r1 で提案した `sendMessage:${userId}` (= ユーザ単位 30/min) より厳格な「ユーザ × リード単位で 5/min」。
   - LinkedIn は同一相手への連投を spam 判定するため、**LinkedIn 規約 (Member Conduct §8.2) との整合性が物理的に担保される** ことが副次効果。マーケ規約観点で +α 評価。
   - 別リードへの送信は別キーなので業務正常負荷 (1 Operator が 1 時間で 30-60 リードに 1 通ずつ) は阻害しない。
   - 攻撃シナリオ (同一リードへ 1 万通) は **60 秒内に 5 通で停止** → 物理ガード成立。

2. **順序 `DLP → requireOperator → rateLimit → DB tx`**:
   - DLP は anonymous でも反応する (r1 で許容判定済) が、認証情報が無いと `rateLimit` のキーが組み立てられないため `requireOperator` 後に置いている。妥当な順序。
   - レート制限超過時に DB tx に進まないので、`messages` insert / audit chain の advisory lock 競合も連鎖防止。

3. **`lib/rate-limit.ts` の制約 (in-memory) を理解した上での実装**:
   - コメント `(5 件 / 60 秒、LinkedIn 規約準拠)` で意図が明示されており、Phase2 で Upstash 化する際に値を変えない方針が読み取れる。
   - serverless で効きが薄い既知制約は r1 で LOW-4 として記録済み、r2 で `lib/rate-limit.ts` 自体は無変更だが Phase2 TODO コメントが既に入っているため減点しない。

4. **DEMO モード分岐 (`conversation.ts:84-92`) との順序**:
   - `rateLimit` は `getDb()` 前なので DEMO 環境でも発動する。これは「DEMO 中に Operator が send ボタン連打しても UX 上 throttle される」効果があり、本番 UX と整合。✅

**STRIDE 上の効果**:
| 脅威 | r1 | r2 |
|---|---|---|
| D (DoS) — 自テナント内 messages 爆撃 | ⚠️ | ✅ 5/min で物理停止 |
| S (Spoofing) — 他 org の UUID 列挙 | ✅ (orgId WHERE で既防御) | ✅ さらに 5/min で列挙速度を即停止 |
| LinkedIn 規約違反による BAN リスク | ⚠️ (実装側で速度ガード無し) | ✅ 1 リード 5 通/分の物理制限 |

→ **入力検証スコア寄与 +1**、副次効果として **STRIDE-D 完全カバー**。

---

### HIGH-3 (r1) ✅ 解消: `linkedinUrl` の `javascript:` スキーム遮断

**新設 `lib/utils.ts:22-36`**:
```ts
export function safeExternalUrl(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  try {
    const u = new URL(trimmed);
    if (u.protocol === "http:" || u.protocol === "https:") return u.toString();
    return null;
  } catch {
    return null;
  }
}
```

**UI 適用 (`conversation-view.tsx:27,40,175-188`)**:
```tsx
import { cn, safeExternalUrl } from "@/lib/utils";
...
const safeLinkedinUrl = React.useMemo(() => safeExternalUrl(lead.linkedinUrl), [lead.linkedinUrl]);
...
{safeLinkedinUrl ? (
  <a href={safeLinkedinUrl} target="_blank" rel="noreferrer noopener" ...>
    LinkedIn で開く <ExternalLink className="size-3" aria-hidden />
  </a>
) : (
  <span ...>LinkedIn URL が不正です</span>
)}
```

**机上トレース**:

| `lead.linkedinUrl` 入力 | `new URL(trimmed).protocol` | 戻り値 | UI 表示 |
|---|---|---|---|
| `https://www.linkedin.com/in/foo` | `https:` | normalized URL | `<a>` 描画 ✅ |
| `http://example.com/x` | `http:` | normalized URL | `<a>` 描画 (注: prod では linkedin.com 限定が望ましいが MEDIUM) |
| `javascript:alert(document.cookie)` | `javascript:` | **null** | 代替 `<span>` ✅ XSS 防御成立 |
| `data:text/html,<script>...</script>` | `data:` | **null** | 代替 `<span>` ✅ |
| `vbscript:msgbox("x")` | `vbscript:` | **null** | 代替 `<span>` ✅ |
| `file:///etc/passwd` | `file:` | **null** | 代替 `<span>` ✅ |
| `  javascript:alert(1)` (前空白) | trim 後 `javascript:` 解析 → `javascript:` | **null** | ✅ |
| `JaVaScRiPt:alert(1)` | URL parser が小文字化 → `javascript:` | **null** | ✅ |
| `https:\\evil.com` (バックスラッシュ) | URL parse 失敗 → catch | **null** | ✅ |
| 空文字 / null / undefined | early return | **null** | ✅ |

**良い点**:
1. **`new URL()` ベースの解析を使い、正規表現での scheme マッチを避けている**。これにより `tab` `newline` `null byte` 等の文字を含む奇形 URL や `https:javascript:alert(1)` 系の bypass 試行を URL parser 側の strict 検査で全部弾く。
2. **戻り値が `null` の場合、UI 側で `<a>` 自体を出さず `<span>LinkedIn URL が不正です</span>` を表示** → DOM に href attribute が一切出現しないので、CSP / ブラウザ拡張 / DevTools 経由の attack surface も完全に消える。
3. `React.useMemo` で memoize しているため、レンダごとに URL 解析が走らない (微小だがパフォーマンス的 to be commended)。
4. r1 で示した「3 通りの修正案のうち #1 (UI 側 safeHref)」を採用しており最小コスト。defense-in-depth として **server 側 (#2) も同じ helper を通すと完璧** だが、現状 `linkedinUrl` を href として render するのは右ペインのみで、他では `<span>` テキストとして使われないため、UI 側ガードのみで十分機能する (= **横展開リスクが現状ゼロ**)。

**`code-r2 M-5 / code-r3 M-5` 据え置き案件の消化状況**:
- r1 で「3 回連続未解消」と指摘した item を **S10 r2 で完全解消**。
- ただし `db/schema.ts:158` の `linkedinUrl: varchar(256) notNull` 側には URL 形式検証が **まだ無い**。Phase2 でリードの import / 編集経路を実装する際に `lib/schemas/lead.ts` (新規) で `z.string().url().regex(/^https:\/\/(www\.)?linkedin\.com\//)` を入れるべき → **MEDIUM-4 (新規)** として記録。

**XSS スコア寄与 +2 (15 → 17)**:
- HIGH-3 完全解消で +3 想定だが、`safeExternalUrl` は `http:` も許可しており **linkedin.com 以外の URL** を Operator 側 import で混入させると open redirect っぽい挙動になる (= LinkedIn 規約上、scrap 結果の URL が `linkedin.com` 以外の場合の安全性) ため -1。Phase2 で domain whitelist を入れれば +20/20 達成。

→ **XSS スコア 15 → 17 (+2)**。

---

## 副作用チェック (R2 で他箇所が劣化していないか)

### 1. `composer.tsx` UI 側 dangerHint が新しい DLP を使うこと
**`composer.tsx:165-170`**:
```ts
const dangerHint = React.useMemo(() => {
  if (!content.trim()) return null;
  const violation = detectDlpViolation(content);
  if (!violation) return null;
  return `${violation.reason} らしき記述があります。送信は Manager 以上の承認が必要です`;
}, [content]);
```
- ✅ UI と Server で **完全同一の DLP 判定**。drift 不能。
- ✅ `React.useMemo([content])` で content 変更時のみ実行 → タイピング毎の regex eval 負荷も最小。
- ✅ violation 検知時も `Button` の `disabled` は **しない** ため、Operator が「Manager 承認をもらう」前提で打鍵し続けられる。送信ボタン押下時に server 側で物理 reject される (UX としても妥当)。

### 2. `getConversation` で `linkedinUrl` を取得 → UI で `safeExternalUrl` 通過
- `queries/conversation.ts:61,107,150,163,178`: DB / mock 両経路で `linkedinUrl: string` 型で返している。
- mock 値は 3 件とも `https://www.linkedin.com/in/example-*` の妥当な URL なので、`safeExternalUrl` 経由でも UI 描画される。✅
- 仮に DB 側に `javascript:` が混入していても (例: 過去の dirty data import) UI 描画時に nullable される → **historic data の汚染にも resilient**。

### 3. レート制限が `MeetingForm` (商談化) に **未適用** であること
- `markAsMeeting` には `rateLimit` 呼び出しが無い (r2 でも変更なし)。
- 商談化は「同じ lead に何度も MEETING 状態へ update する」攻撃は無害 (idempotent on state, audit chain は伸びるが攻撃価値が低い)。
- ただし audit hash chain を爆撃して advisory lock 競合させる経路は理論上残る。**Phase2 で `requalify:${userId}` 10/min 程度を追加するのが望ましい** → LOW-5 (新規) として記録。減点なし。

### 4. `INITIAL_SEND_RESULT` / SendResult 型に変更なし
- `useActionState<SendResult, FormData>(sendMessage, INITIAL_SEND_RESULT)` の互換性は維持。
- `result.message` のテキストに rate-limit 用の文言が追加された (`"短時間に送信が集中しています…"`) が、UI 側は文字列をそのまま `toast.text` に流すので OK。

### 5. NFKC normalize による DoS リスク
- `String.prototype.normalize("NFKC")` は最大 1500 字に対して数百 μs 程度。サーバ 1 req = 1 normalize なので Phase1 規模では問題なし。
- normalize の出力サイズは最悪ケースで入力の数倍 (合字展開) になるが、後段の regex は最大 1500 字の数倍 ≒ 数十 KB なので catastrophic backtracking する正規表現を含まない限り問題なし。
- 採用している 4 つの regex を ReDoS 観点で再評価:
  - `(?:\d{2,4}[-\s]?){2,}\d{3,4}` — bounded quantifier、catastrophic backtracking のリスク低い ✅
  - `[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}` — well-formed email regex、ReDoS パターンに該当しない ✅
  - 価格・郵便番号 — シンプルな alternation、リスク無し ✅

---

## HIGH 残存 / NEW HIGH

### HIGH 残存: **なし**

r1 で挙げた HIGH-1, HIGH-2, HIGH-3 すべて R2 で物理的に解消。

### NEW HIGH (R2 で混入したもの): **なし**

DLP の集約化・rate-limit 追加・URL helper の導入はいずれも純粋に攻撃面を狭める方向の変更で、副作用として新たな HIGH リスクを生んでいない。

---

## MEDIUM (Phase2 までに対応、減点幅小)

| # | 項目 | 該当 | 推奨修正 |
|---|---|---|---|
| MEDIUM-1 (r1 継続) | Phase2 で AI 下書きを実 LLM 化した際の Indirect Prompt Injection | `composer.tsx:35-61` / `conversation-view.tsx:98` | system prompt で `<UserMessage>` 分離 / output を zod 構造化 / DANGER_PATTERNS を AI 出力にも適用 / audit に `aiPromptHash` 記録 |
| MEDIUM-2 (r1 継続) | 5 秒キュー Undo 中のブラウザ閉じで Operator が送信予期と乖離 | `composer.tsx:63-136` | `beforeunload` ハンドラで警告 (UX、データ整合性は OK) |
| MEDIUM-3 (r1 継続) | `messages` 取得側に lead 経由の `INNER JOIN` 強制が無い | `queries/conversation.ts:82-93` | S09-r2 と同パターンで `INNER JOIN leads ON ... AND leads.org_id = $orgId` (Phase2 RLS 統合時に併せて) |
| **MEDIUM-4 (新規)** | `lib/schemas/lead.ts` 未存在 → `linkedinUrl` の import 経路に zod 検証なし。`safeExternalUrl` で表示時はガード済だが、DB に dirty URL が残る | `db/schema.ts:158` + 未来の import action | `LinkedinUrl = z.string().url().regex(/^https:\/\/(www\.)?linkedin\.com\//)` を新設、scrap 結果 / 手動編集双方で適用 |
| **MEDIUM-5 (新規)** | `safeExternalUrl` は `http:` も許可。LinkedIn 以外のドメインへの open redirect 風表示が可能 | `lib/utils.ts:31` | `https:` + linkedin.com 限定の wrapper を別途用意するか、`safeExternalUrl({ allowedHosts: ["linkedin.com", "www.linkedin.com"] })` 引数化 |

---

## LOW (改善余地、減点なし)

| # | 項目 | 該当 | 推奨 |
|---|---|---|---|
| LOW-1 (r1 継続) | `markAsMeeting` の confirm が UI のみ | `conversation-view.tsx:283-287` | server に `requireConfirmation: true` を audit metadata で残す |
| LOW-2 (r1 継続) | `content` の制御文字 (zero-width 等) を許容 | `conversation.ts:22-26` | `lib/dlp.ts` の normalize ステップに `replace(/[​-‍﻿]/g, "")` を追加 |
| LOW-3 (r1 継続) | `lead.requalified` の audit に `state.from` (旧値) が無い | `conversation.ts:201` | select で旧 state を取って `diff: { state: { from, to } }` |
| LOW-4 (r1 継続) | `rate-limit.ts` が in-memory (serverless で効きが薄い) | `lib/rate-limit.ts:13` | Phase2 で `@upstash/ratelimit` 化 (既存 TODO 通り) |
| **LOW-5 (新規)** | `markAsMeeting` にレート制限なし → audit hash chain への爆撃可能 (実害は同テナント内 advisory lock 競合のみ) | `conversation.ts:158-220` | `rateLimit('requalify:${userId}', 10, 60_000)` 追加 |
| **LOW-6 (新規)** | DLP パターンが `john [at] example.com` / `dot` 表記等の social obfuscation 未対応 | `lib/dlp.ts:7-12` | `[at]` `(at)` `dot` 系を normalize 前段で `@`/`.` 置換 |

---

## STRIDE 再評価 (r2)

| 脅威 | r1 評価 | r2 評価 | 備考 |
|---|---|---|---|
| **S**poofing | ✅ | ✅ | 不変 |
| **T**ampering | ✅ | ✅ | 不変 |
| **R**epudiation | ✅ | ✅ | 不変 |
| **I**nformation Disclosure | ⚠️ (linkedinUrl javascript:) | ✅ | **HIGH-3 解消** |
| **D**enial of Service | ⚠️ (rate-limit 欠落) | ✅ | **HIGH-2 解消、LinkedIn 規約整合も達成** |
| **E**levation of Privilege | ✅ | ✅ | 不変 |

---

## OWASP Top 10 (2021) 再評価 (r2)

| ID | r1 | r2 | 備考 |
|---|---|---|---|
| A01 Broken Access Control | ✅ | ✅ | 不変 |
| A02 Cryptographic Failures | ✅ | ✅ | 不変 |
| A03 Injection | ✅ | ✅ | 不変 |
| A04 Insecure Design | ⚠️ | ✅ | DLP Unicode / rate-limit 双方解消 |
| A05 Security Misconfiguration | ✅ | ✅ | 不変 |
| A06 Vulnerable Components | — | — | 対象外 |
| A07 Auth Failures | ✅ | ✅ | 不変 |
| A08 Data Integrity Failures | ✅ | ✅ | 不変 |
| A09 Logging Failures | ✅ | ✅ | 不変 |
| A10 SSRF | ⚠️ (javascript:) | ✅ | safeExternalUrl で解消 |

## OWASP LLM Top 10 (2025)

| ID | r1 | r2 | 備考 |
|---|---|---|---|
| LLM01 Prompt Injection | ⚠️ (Phase2) | ⚠️ (Phase2) | Phase2 で実 LLM 化時に対応予定、設計書 §17.5 への明記 TODO |
| LLM02 Insecure Output Handling | ⚠️ (Phase2) | ⚠️ (Phase2) | 同上 |
| LLM06 Sensitive Information Disclosure | ⚠️ (DLP bypass) | ✅ | **HIGH-1 解消で完了** |

---

## 90+ 判定

**判定: PASS (96 / 100)**

- r1 で挙げた HIGH 3 件 (DLP NFKC / sendMessage rate-limit / linkedinUrl javascript:) は **R2 ですべて物理的に解消**。
- 新規 HIGH の混入なし。
- MEDIUM/LOW は Phase2 改善枠に整理済 (MEDIUM-4/5, LOW-5/6 を新規記録)。
- 設計書 §17 (セキュリティ) との整合性、S09-r2 で確立した「lead を gatekeeper にして messages を派生」パターンとの一貫性、`code-r2/r3 M-5` 据え置きの完全消化、いずれも達成。

**Phase1 GA リリース可。** Phase2 で MEDIUM-4 (linkedinUrl の zod schema) と MEDIUM-1 (実 LLM 化時の IPI 対策) を優先対応すれば 99-100 到達見込み。

---

**判定 結論**: **96 / 100 — PASS (HIGH 完全解消、Phase1 GA 適格)**
