# S10 会話画面 SRE レビュー (r2)

- 対象:
  - `app/(app)/inbox/[leadId]/page.tsx`
  - `server/queries/conversation.ts`
  - `server/actions/conversation.ts`
  - `components/inbox/conversation-view.tsx`
  - `components/inbox/composer.tsx`
  - `components/inbox/message-bubble.tsx`
  - `lib/audit.ts`, `lib/incident.ts`, `lib/rate-limit.ts`
  - `db/schema.ts`
- 観点: SRE (パフォーマンス・エラーハンドリング・観測性・運用UX・キャパシティ/安全)
- 評価日: 2026-05-11
- 前回 (r1): **88 / 100 NEAR**

---

## 総合スコア: **93 / 100** — 判定: **PASS (90+到達)**

| # | 観点 | 配点 | r1 | r2 | Δ | 主因 |
|---|------|------|---:|---:|---:|------|
| 1 | パフォーマンス | 20 | 17 | **19** | **+2** | `desc(sent_at) LIMIT 200 + .reverse()` 化で「直近 200 件」が UI に出るようになり、`msg_lead_sent_idx` の Backward Index Scan で Sort Node も発生せず。MEDIUM-1 解消 |
| 2 | エラーハンドリング | 20 | 17 | **19** | **+2** | `tempIdRef` + `handleConfirmed` で **成功は `__status: sent`**、**失敗は `__status: failed`** に確定遷移。永久 sending 固着が消滅、HIGH-1 解消 |
| 3 | 観測性 | 20 | 16 | **17** | **+1** | audit hash chain + incident は既に堅牢。failed バブルが UI に残ることでユーザ起点の再送オペが追跡可能になり SRE→CS フローが繋がった (correlation はまだ未配線) |
| 4 | ユーザビリティ運用 | 20 | 19 | **19** | **±0** | HIGH-2 を「5 秒 UX 維持 + サーバ未到達=未送信扱い」という設計判断で受容。Phase2 で `sessionStorage` 退避方針が明文化されているため減点据置 |
| 5 | キャパシティ・安全 | 20 | 19 | **19** | **±0** | `lib/rate-limit.ts` 導入 + `send:${userId}:${leadId}` キー 5 件/60s が actions に配線済 (MEDIUM-2 解消)。一方 advisory lock 直列化 (MEDIUM-3 残) は据置 |

> 合計: 19 + 19 + 17 + 19 + 19 = **93 / 100 (PASS)**

r1 比 **+5**。HIGH-1 / MEDIUM-1 を完全解消、HIGH-2 は設計合意で受容、MEDIUM-2 (rate limit) も追加配線でクリア。

---

## r1 → r2 差分の検証

### HIGH-1: 永久 sending バブル — **解消**
`components/inbox/conversation-view.tsx:48-91`

```tsx
const tempIdRef = React.useRef<string | null>(null);

const handleQueueing = (content, aiAssisted) => {
  const tempId = newTempId();
  tempIdRef.current = tempId;
  setMessages((prev) => [
    ...prev,
    { id: tempId, ..., __status: "sending" },
  ]);
};

const handleConfirmed = (s: SendResult) => {
  setToast({ kind: s.ok ? "success" : "error", text: s.message ?? "" });
  const tempId = tempIdRef.current;
  if (!tempId) return;
  if (s.ok) {
    setMessages((prev) => prev.map((m) => m.id === tempId ? { ...m, __status: "sent" } : m));
  } else {
    setMessages((prev) => prev.map((m) => m.id === tempId ? { ...m, __status: "failed" } : m));
  }
  tempIdRef.current = null;
};

React.useEffect(() => {
  setMessages(detail.messages);   // server confirm 後は temp が消える
}, [detail.messages]);
```

**SRE 検証:**
- 成功時: `__status="sent"` で Check アイコン (`message-bubble.tsx:78-83`) → revalidate で本物の id に差し替わる。中間状態が表示確定するためユーザ判断は明確。
- 失敗時: `__status="failed"` で AlertCircle (赤) アイコン (`message-bubble.tsx:93-100`) → ユーザが「未送信である」事を即座に視認可能、再送/削除の判断が UI 駆動で可能。
- `tempIdRef` を成否確定後に `null` に戻しているため、次回送信時の前回バブル誤更新も無し。
- 唯一の残課題: `__status="failed"` バブルを **削除する UI ボタン**は composer 側に未実装 (テキストエリアは `result.ok===false` でクリアされない動作なので、ユーザは「同じテキストを再送 = 新しい temp が積まれて failed と並ぶ」になりがち)。これは LOW 相当。

**判定: HIGH-1 → 解消 (パフォーマンス指摘なし、エラーハンドリング +2)**

---

### MEDIUM-1: messages ASC LIMIT 200 — **解消**
`server/queries/conversation.ts:81-94`

```ts
// 直近 200 件を DESC で取得して反転
const msgsDesc = await db
  .select({...})
  .from(schema.messages)
  .where(eq(schema.messages.leadId, leadId))
  .orderBy(desc(schema.messages.sentAt))
  .limit(200);
const msgs = msgsDesc.reverse();
```

**SRE 検証:**
- `msg_lead_sent_idx (lead_id, sent_at)` に対し `desc(sent_at)` は **Backward Index Scan** で取得 → Sort Node 不要、`LIMIT 200` で Index Only Access 可能。
- `.reverse()` は最大 200 要素の in-memory 反転 = O(200)、p95 影響ゼロ。
- 「直近の応酬を見たい」という現実の UX と挙動が整合。AI 下書きの `recentInboundSnippet` も真の最新を参照できるようになる (composer.tsx:165 経由)。
- 1 万件超スレッドはまだ paginate が無いが、**少なくとも先頭が消えるサイレント切り捨ては消滅**。完全 keyset paginate は Phase 2。

**判定: MEDIUM-1 → 解消 (パフォーマンス +2)**

---

### HIGH-2: 5 秒キュー Undo の data loss — **設計判断で受容 (PASS)**

R2 で取った方針: 「5 秒間は **確認猶予のための完全クライアント状態**」と定義し、**タブを閉じた=送信意思を放棄=未送信扱い**で正式合意。

**SRE 観点での評価:**
- ✅ サイレント送信 (画面では送信済表示・実体は未送信) の可能性は **構造的に消えた**。`pendingContent` が null になる前に閉じた = 画面にもサーバにも残らない = 監査・ユーザ認識・実体が一貫。
- ✅ 二重送信リスクも同様に低下 (画面残留が無いため「送ったか不明」が消える)。
- ⚠️ 残課題 (許容): タブクローズで文面そのものはロスト。営業 1 通分=数 KB の文章を失うストレスはあるが「未送信」が明示されているため SRE 観点での silent data loss には該当しない。
- ⚠️ Phase 2 で `sessionStorage` 退避にして送信意思も保持する方針が明示されている (MEDIUM-4 解消の伏線)。

**判定: HIGH-2 → 設計上クローズ。減点維持 (`ユーザビリティ運用 19/20` のまま) で 90+ ライン到達可能。SRE 視点では「未送信を未送信と扱う」決定が観測性上クリーンであり、むしろ NEAR 時より状態整合性は向上。**

---

### MEDIUM-2: rate limit 未配線 — **解消 (ボーナス対応)**
`server/actions/conversation.ts:10, 76`

```ts
import { rateLimit } from "@/lib/rate-limit";
...
const rl = rateLimit(`send:${session.userId}:${parsed.data.leadId}`, 5, 60_000);
```

**SRE 検証:**
- `send:userId:leadId` キー (lead 単位の連射防止) で 5 通/60 秒 = 12 秒/通の floor。LinkedIn 公式 API の per-recipient throttle と整合性のある粒度。
- `lib/rate-limit.ts` が in-memory token-bucket 実装である前提なら **Vercel/Edge の multi-instance 環境では穴が残る** (各 instance で 5 通許容)。これは LOW 級で残置可。Phase 2 で Upstash 等に差し替え推奨。
- audit advisory lock の累積 DoS (MEDIUM-3) も間接的に緩和。

**判定: MEDIUM-2 → 解消 (キャパシティ・安全 +1相当だが、配線品質に課題があるため `19/20` 維持で吸収)。**

---

## HIGH 残存 / NEW HIGH

### HIGH 残存
**なし。** r1 で挙げた HIGH-1 / HIGH-2 はそれぞれ「実装解消」「設計受容」で 90+ ラインを超える形で着地。

### NEW HIGH
**なし。** r2 で追加されたコード経路 (`handleConfirmed` の `__status` 遷移 / `desc + reverse` クエリ / `rateLimit` 配線) はいずれも追加リスクを生まない実装。`tempIdRef` の reset を `null` に戻しているため、競合パスでの 「前回 temp を今回成功で誤更新」も発生しない。

---

## 残課題 (90+ PASS 後、Phase 2 ターゲット)

| 残課題 | 重大度 | 由来 |
|--------|--------|------|
| failed バブルの再送/削除 UI が無い | LOW | HIGH-1 派生 |
| `pendingContent` の sessionStorage 退避未実装 | MEDIUM (受容済) | HIGH-2 |
| audit advisory lock の org スコープ直列化 | MEDIUM | r1 MEDIUM-3 |
| `getConversation` failure の production console.error 欠落 | LOW | r1 LOW-1 |
| Composer / Action 側の DLP 正規表現未共通化 | LOW | r1 LOW-3 |
| `instrumentation.ts` で OTel/metric 未配線 | LOW | r1 LOW-4 |
| `lib/rate-limit.ts` がインスタンス分散環境で漏れる可能性 | LOW | r2 NEW |
| messages の keyset paginate (`?before=<sentAt>`) | MEDIUM | r1 MEDIUM-1 派生 |

---

## 判定: **PASS (93/100)**

- 総合スコア: **93 / 100** (r1 比 +5)
- HIGH 残存: **0**
- NEW HIGH: **0**
- 90+ 判定: **PASS**

S09/S10 共通の "クエリ + audit + tx 整合" の基盤がそのまま活き、UI 状態機械 (`__status` の sending → sent/failed 遷移) を 1 つ追加しただけで NEAR から PASS に到達。HIGH-2 を「設計上の受容」で閉じた判断は、SRE の **「観測できない状態を作らない」原則** と整合しており、Phase 2 で `sessionStorage` 退避を入れた時点で `ユーザビリティ運用` も 20/20 が見える形 (理論最大 95 ライン)。

参考ファイル:
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\components\inbox\conversation-view.tsx`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\components\inbox\composer.tsx`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\components\inbox\message-bubble.tsx`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\server\queries\conversation.ts`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\server\actions\conversation.ts`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\lib\rate-limit.ts`
