# S10 会話画面 SRE レビュー (r1)

- 対象:
  - `app/(app)/inbox/[leadId]/page.tsx`
  - `server/queries/conversation.ts`
  - `server/actions/conversation.ts`
  - `components/inbox/conversation-view.tsx`
  - `components/inbox/composer.tsx`
  - `lib/audit.ts`, `lib/incident.ts`
  - `db/schema.ts` (messages / leads index)
- 観点: SRE (パフォーマンス・エラーハンドリング・観測性・運用UX・キャパシティ/安全)
- 評価日: 2026-05-11
- 参考: S09 r2 で `(lead_id, sent_at)` 複合 index `msg_lead_sent_idx` は既に導入済み (`db/schema.ts:199-202`)

---

## 総合スコア: **88 / 100** — 判定: **NEAR (90+未到達)**

| # | 観点 | 配点 | スコア | 主因 |
|---|------|------|------:|------|
| 1 | パフォーマンス | 20 | **17** | `(lead_id, sent_at)` index ヒット + LIMIT 200 で支配的クエリは速い。ただし 1万件超の長期スレッドに **paginate/keyset が無く ASC 200 固定** = 古いメッセージ側に切り捨てが起こる構造欠陥 |
| 2 | エラーハンドリング | 20 | **17** | `degraded + incidentId` 経路、`LEAD_NOT_FOUND` を tx 内 throw で再判定、UI の DEMO バッジまで揃っている。**ただし「Optimistic バブルが onConfirmed 失敗時に消えない」「5秒タイマー中ブラウザ閉じ/リロードで送信ロスト/二重送信」がSRE視点で HIGH** |
| 3 | 観測性 | 20 | **16** | `INC-YYYY-XXXXXXXX` + `writeAudit` の hash chain + advisory lock は◎。**Composer 側に correlation_id が無く、UI で発生した Undo/cancel/duplicate-send などのフロント事象がサーバ監査と紐づかない** |
| 4 | ユーザビリティ運用 | 20 | **19** | DEMO バッジ・空状態・state 4 段階 (`PENDING/MESSAGED/REPLIED/MEETING`)・5秒キュー Undo・confirm() 二段ゲートは秀逸 |
| 5 | キャパシティ・安全 | 20 | **19** | DLP 3 パターン (電話/メール/値引き) の二重チェック (UI hint + Action 強制ブロック) + UUID 検証 + role guard + audit。**rate limit が未配線** で MEDIUM |

> 合計: 17 + 17 + 16 + 19 + 19 = **88 / 100 (NEAR)**

90+ 到達には HIGH-1 / HIGH-2 のいずれか解消 + MEDIUM 1 件解消で `+3 ~ +5` 取り戻し可能。

---

## HIGH (必修 — 90+ 到達のために最低 2 件解消が必要)

### HIGH-1: Composer の **Optimistic バブルが永久に "sending" のまま固着**するリカバリ困難
**ファイル:** `components/inbox/conversation-view.tsx:49-62, 107-116` / `components/inbox/composer.tsx:97-107`

```tsx
// conversation-view.tsx:49
const handleQueueing = (content: string, aiAssisted: boolean) => {
  const tempId = `temp-${Date.now()}`;
  setMessages((prev) => [
    ...prev,
    { id: tempId, direction: "outbound", content, aiAssisted, sentAt: ... },
  ]);
};
```

```tsx
// composer.tsx:97
React.useEffect(() => {
  if (!result.message) return;
  if (reportedRef.current === result) return;
  reportedRef.current = result;
  onConfirmed(result);
  if (result.ok) {
    setContent(""); setActiveDraft(null); setAiAssisted(false);
  }
}, [result, onConfirmed]);
```

**問題:**
- `handleQueueing` で `temp-<ts>` バブルを push する一方、`onConfirmed` (= sendMessage 完了時) でも `revalidatePath` 経由でしか温度バブルは消えない
- **失敗時 (`result.ok === false`) はバブルが残ったまま** "sending" 表示が継続する。トーストは赤で出るが、ユーザの目には「再送が必要なのか送れたのか」が判断不能
- `temp-` バブルを除去する明示コードがどこにも存在しない (`conversation-view.tsx:39-41` の useEffect は `detail.messages` を **代入で上書きするが、temp バブルは detail に存在しないため revalidate 成功時に自然消滅するのみ**、失敗時は detail が変わらない → 残留)
- 加えて、`result` 失敗時に **Composer の content がクリアされない** (`composer.tsx:102 if (result.ok) setContent("")`) のは妥当だが、ユーザは "送信中バブル" と "復元されたテキスト" の両方を見ることになり、`同じ文面を再送 → 重複バブル 2つ` の操作ミスを誘発する

**SRE 影響:** P1 — 重複送信 = LinkedIn 側 Rate-limit/警告/凍結リスク (設計書 §6 LinkedIn 接続点)。デモ運用でも UX 上の信頼喪失が大きい。

**推奨修正:**
```tsx
// conversation-view.tsx
React.useEffect(() => {
  setMessages((prev) => {
    // server detail に存在しない temp-* は失敗とみなして 30 秒で除去
    const ids = new Set(detail.messages.map((m) => m.id));
    return detail.messages.concat(
      prev.filter(
        (m) => m.id.startsWith("temp-") && !ids.has(m.id) &&
        Date.now() - new Date(m.sentAt).getTime() < 30_000
      )
    );
  });
}, [detail.messages]);

// onConfirmed 失敗時に temp バブルを除去
const handleConfirmed = (s: SendResult) => {
  if (!s.ok) {
    setMessages((prev) => prev.filter((m) => !m.id.startsWith("temp-")));
  }
  setToast({ kind: s.ok ? "success" : "error", text: s.message ?? "" });
};
```

**点数影響:** エラーハンドリング `-2`

---

### HIGH-2: 5秒キュー Undo の **タイマーがブラウザ閉じ/リロード/タブ切替で消滅**、送信ロスト or 二重送信
**ファイル:** `components/inbox/composer.tsx:84-135, 137-145`

```tsx
// 5 秒キュー Undo
const [pendingContent, setPendingContent] = React.useState<string | null>(null);
intervalRef.current = setInterval(() => {
  const remaining = Math.max(0, UNDO_MS - (Date.now() - startedAt));
  ...
  if (remaining <= 0) {
    formActionRef.current?.(fd); // ← ここで初めてサーバ送信
    setPendingContent(null);
  }
}, 200);
```

**問題:**
1. **送信ロスト (silent data loss):**
   ユーザが "送信する" を押し → 5秒タイマー作動中に **タブを閉じる/リロード/ブラウザクラッシュ/PC スリープ** すると、`formAction(fd)` は永遠に呼ばれない。`startQueue` 時点ではサーバには何も送られていない (`composer.tsx:140-145` の `setPendingContent` は client state のみ)。**ユーザは「送信した」と認識、相手には届かない** — SRE 観点で最悪のサイレントロス。
2. **二重送信 (visibility 復帰時):**
   タブを 5秒待たずに閉じても interval が止まるだけだが、`navigator.sendBeacon` 等の保険が無いため、ユーザは「あれ送ったっけ？」となり再操作 → 2 重送信 (HIGH-1 と合成して被害が拡大)。
3. **タイマー精度 200ms:**
   `setInterval(fn, 200)` は **タブが非アクティブのとき Chrome では throttling され最低 1000ms** にまるめられる。表示上 `5 → 4 → 3 → …` のカウントは backgrounded で `5 → 4 → ...` が止まるが、`Date.now() - startedAt` の数式で実時間補正してるため最終発火は遅延しても起きる。**ここはバグではないが「ユーザが画面に戻ったときに突然送信される」UX 上の予測困難さ**は残る。
4. **メモリ消費:**
   `pendingContent` が解放されないまま離脱した場合、`leadId` ごとの長い文章を保持し続ける。React のレンダリングツリーが破棄されれば回収されるが、**ユーザ視点では「下書きが消える」** に等しい。

**SRE 影響:** P1 — サイレント data loss は監視できない (サーバに到達しないログは観測不能)。LinkedIn 自動営業の商談機会損失に直結。

**推奨修正:**
- **Optimistic 永続化:** `startQueue` の時点で `messages` に `status='queued'` で **DB 書き込み** し、5秒経過後 `status='sent'` に遷移 / cancel 時に `status='cancelled'` に遷移。タブクローズしても `status='queued'` のジョブが残るため、`/api/cron` か `BullMQ` のような外部ワーカーがピックアップ可能 (設計書 §6.4 の本来の意図)。
- **暫定 (Phase MVP):** `beforeunload` イベントで `pendingContent` を **localStorage に保存** し、再来訪時に「未送信の下書きがあります」を表示。完全な解決ではないが silent loss は防げる。
- **タイマー精度:** `requestAnimationFrame` か `Page Visibility API` の `visibilitychange` で `Date.now()` 比較を強制する (現状 `Date.now()` 補正は入っているのでギリギリ許容)。

**点数影響:** エラーハンドリング `-1`, 観測性 `-1`

---

## MEDIUM

### MEDIUM-1: messages 取得 ASC LIMIT 200 ハード上限、**1万件スレッドで先頭 9,800 件が見えない**
**ファイル:** `server/queries/conversation.ts:81-92`

```ts
const msgs = await db
  .select({...})
  .from(schema.messages)
  .where(eq(schema.messages.leadId, leadId))
  .orderBy(asc(schema.messages.sentAt))
  .limit(200);
```

**問題:**
- `asc(sent_at) LIMIT 200` は **最古 200 件**を返す。LinkedIn 自動営業のコンテキストで最も見たいのは **直近の応酬**であり、設計意図と挙動が逆。
- かつ、1リードあたり数千件超えるケースはエンタープライズで現実的 (長期ナーチャリング)。**paginate / keyset 無し**で UI 側は無自覚に古いメッセージを表示し続ける。
- `msg_lead_sent_idx` は (lead_id ASC, sent_at ASC) なので Backward Index Scan で DESC も Sort Node 無しで取れる。

**SRE 影響:** P2 — データが見えない=ユーザ判断ミス。古い文脈で AI 下書きが生成され (composer.tsx:36 `buildDrafts` は `recentInboundSnippet` を使うが、その snippet は `messages.filter(...).pop()` で最後の inbound = 200 件中の最新だが、実体の最新は別)、**ユーザに気づかれずに変な返信を送る**ベクトル。

**推奨修正:**
```ts
// 最新 200 件を取って UI で reverse、もしくは keyset paginate
.orderBy(desc(schema.messages.sentAt))
.limit(200);
// ↑ クエリ側で逆順を取り、UI で .reverse() して時系列表示
```
さらに、次フェーズで `?before=<sentAt>` クエリパラメタを受けて keyset paginate 化。

**点数影響:** パフォーマンス `-2`, ユーザビリティ運用 `-1` (ただし他軸に分散済み)

---

### MEDIUM-2: **rate limit 未配線**、DLP は機能するが連射攻撃に無防備
**ファイル:** `server/actions/conversation.ts:49-145`

**問題:**
- `requireOperator()` でロール検査はあるが、**1 ユーザあたりの送信頻度制限 (per-lead / per-org / per-user) が存在しない**
- 攻撃ベクトル: 認可済みオペレータがスクリプトで `sendMessage` を秒間 100 回叩く → audit log の hash chain が advisory lock で直列化されているため、**`pg_advisory_xact_lock(hashtext(org_id))` の取得待ちが累積し DB 全体の write を巻き込む遅延**が発生する (audit.ts:69-71)。
- LinkedIn 公式 API 側のレート制限を超過 → アカウント凍結リスク (設計書 §13 にもある通り)

**推奨修正:**
- Upstash / `lru-cache` ベースで `org:user:lead` キーの簡易 token bucket (例: 10/min/lead, 60/min/org)
- 超過時は `429` 相当 = `{ ok: false, message: "送信頻度が高すぎます (RATE_LIMIT)" }` を返し audit に `CIRCUIT_BREAKER` で記録

**点数影響:** キャパシティ・安全 `-1`

---

### MEDIUM-3: **markAsMeeting と sendMessage の audit が同一 tx 内** = 正しいが、`writeAudit` 内部の advisory lock が **org 全体の audit 書込みを直列化**する
**ファイル:** `lib/audit.ts:65-71` / `server/actions/conversation.ts:116-130, 192-202`

**評価:** これは **「同一 tx 内に audit を入れる」自体は HIGH 仕様としては正しい (atomicity 保証)**。Wave2 で改善した正答パスを踏襲できている。

**懸念 (P3 級):**
- `pg_advisory_xact_lock(hashtext(org_id))` は tx スコープ自動解放だが、`sendMessage` のような hot path で **同一 org の他オペレータの sendMessage / lead.requalified / campaign.* が全部 serialize される**。
- 100 オペレータ × 1 org の SaaS シナリオでは audit が **書込み bottleneck** になりうる。
- 設計書 §17 の hash chain 要件と SRE スループット要件 (`p95 < 300ms`) の **両立可否は要キャパシティ計画**。

**推奨修正 (Phase 2):**
- Audit を **append-only ストリーム (Kafka / SQS) → 非同期 sink** に分離し、ユーザ操作の応答時間と audit の永続化を decouple
- 短期: advisory lock を `hashtext(org_id || date_trunc('minute', now()))` の粒度に下げて衝突確率を分散

**点数影響:** 観測性 `-1` (キャパ視点では既知の構造)

---

### MEDIUM-4: **ConversationView の `messages` / `toast` 状態がリロードで失われる**
**ファイル:** `components/inbox/conversation-view.tsx:35-47`

**問題:**
- `useState` 初期値が `detail.messages` なので、リロード時に **HIGH-1 の temp バブル / HIGH-2 の pendingContent / Composer の編集中 textarea** が全部消える
- 「あ、間違って F5 押した」で 5秒 Undo 中の送信が **未送信ロストする**
- toast は短命なので問題は小さい

**推奨修正:**
- `pendingContent` を **sessionStorage** にも書き出す (`useEffect([pendingContent])`)
- 復帰時に `pendingContent` を復元し、残り秒数を `Date.now() - startedAt` から計算
- Composer の `content` も同様に sessionStorage で draft 保存 (商談文章は重要)

**点数影響:** エラーハンドリング `-0.5` (HIGH-2 と合算で計上)

---

## LOW

### LOW-1: `getConversation` の error が **production で console.error されない**
**ファイル:** `server/queries/conversation.ts:120-126`

```ts
if (process.env.NODE_ENV !== "production") {
  console.error(`[getConversation] ${incidentId}`, e);
}
return { ok: false, reason: "degraded", incidentId };
```

**問題:**
- production で incidentId は UI に出るが、**サーバ側 stdout に出力されない** → Vercel/CloudWatch のログ集約からも見えない → サポートが INC を受け取っても **クエリ不能**
- これは S09 r2 でも同じ指摘あり → 横展開漏れ

**推奨:**
```ts
// 構造化ログとして必ず出す (production 含む)
console.error(JSON.stringify({
  level: "error",
  event: "getConversation.failed",
  incidentId, leadId, orgId,
  err: e instanceof Error ? e.message : String(e),
  stack: e instanceof Error ? e.stack : undefined,
}));
```

**点数影響:** 観測性 `-1`

---

### LOW-2: `markAsMeeting` の **confirm() がモーダルブロッキング**、且つ Server Action 経路の場合 `e.preventDefault()` で止められない可能性
**ファイル:** `components/inbox/conversation-view.tsx:241-245`

```tsx
onSubmit={(e) => {
  if (!window.confirm(...)) {
    e.preventDefault();
  }
}}
```

**評価:**
- Next.js 15 の Server Actions では `<form action={formAction}>` の `onSubmit` で `preventDefault` は基本的に効くが、**form action が `useActionState` 経由でクライアント関数になるためタイミング依存**
- 動作はするが、確実性のためには `useState<boolean>` で `confirmed` フラグを建てて、ボタンクリックで `confirm` → `formAction(fd)` 明示呼び出しのほうが堅牢

**点数影響:** ユーザビリティ運用 `-0.5` (許容範囲)

---

### LOW-3: Composer の DLP 正規表現と Action 側 DLP 正規表現が **微妙に違う** (case sensitivity)
**ファイル:** `components/inbox/composer.tsx:164-169` vs `server/actions/conversation.ts:28-32`

```ts
// composer.tsx:166 (UI hint)
/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/    // case-aware
// conversation.ts:30 (server enforcement)
/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i            // /i flag
```

**評価:** 結果的に同じものをマッチするが、**「UI hint が出なかったが server で拒否される」エッジケース**を防ぐため正規表現は **共通モジュール化** すべき。

**推奨:** `lib/dlp-patterns.ts` を切って両者から import。

**点数影響:** 観測性 / 保守性で軽微減点 → スコア上は計上せず

---

### LOW-4: `instrumentation.ts` で OpenTelemetry / metric が **未配線**
**ファイル:** `instrumentation.ts` (確認した範囲では空)

**評価:**
- `sendMessage` / `markAsMeeting` / `getConversation` の latency / error rate / 5秒 Undo 発動率 / Undo cancel 率などの **business metric が観測不能**
- 設計書 §24 の SLI/SLO 計測には必須

**推奨:** Phase2 で `@vercel/otel` 配線。今期は LOW でよい。

---

## 個別チェック項目への回答

| 項目 | 評価 |
|------|------|
| **Composer の 5秒タイマー: ブラウザ閉じ/リロード** | HIGH-2 で指摘済み。**send 完全ロスト**。LocalStorage 退避必要 |
| **5秒タイマー: メモリ消費** | 単一スレッドでは無視可。複数タブで複数会話を開いた場合も React tree がアンマウントで GC される |
| **setInterval 200ms 精度** | `Date.now()` で時刻補正済みなので精度問題は無し。ただし backgrounded tab で interval throttling は残る (UX 表示のみ) |
| **Optimistic 送信中バブル / onConfirmed 失敗時** | HIGH-1 で指摘済み。**temp バブルが永久に残る**。リカバリ困難 |
| **messages ASC 200 件 / 1万件超 paginate 必要** | MEDIUM-1 で指摘済み。**かつ ASC で取ってるので最古 200 件しか見えない設計欠陥** |
| **markAsMeeting と sendMessage の audit が同一 tx 内** | OK (atomicity 確保)。ただし advisory lock の serialize は MEDIUM-3 で別途指摘 |
| **ConversationView の状態 (messages, toast) がリロードで失われる** | MEDIUM-4 で指摘済み。**特に Composer pendingContent の loss が致命的** |

---

## 改善ロードマップ (90+ 到達に必要な最小セット)

| 順位 | 項目 | 想定工数 | 期待 Δ |
|------|------|---------|-------|
| 1 | HIGH-1 (temp バブル除去ロジック) | 30分 | +2 |
| 2 | HIGH-2 (sessionStorage / localStorage 退避) | 1.5h | +2 |
| 3 | MEDIUM-1 (`desc(sent_at)` に変更 + UI で reverse) | 15分 | +2 |
| 4 | LOW-1 (production でも構造化ログ出力) | 15分 | +1 |

合計 **+7** で **88 → 95** 達成見込み。**最低でも HIGH-1 / HIGH-2 / MEDIUM-1 の 3 件**を r2 で対応すれば 90+ PASS。

---

## 判定: **NEAR (88/100)** — r2 で HIGH-1/HIGH-2/MEDIUM-1 を必修対応のこと

S09 r2 と異なり、S10 は **UI 側のフロー設計** (5秒キュー Undo) が SRE 観点での data loss / silent failure ベクトルになっている点が NEAR 留まりの主因。クエリレイヤと audit chain はベースが固いので、Composer の状態永続化に手を入れれば一気に PASS ラインに到達できる。
