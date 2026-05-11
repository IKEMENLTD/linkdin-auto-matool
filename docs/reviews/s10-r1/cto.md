# S10 会話画面 — CTO レビュー (r1)

- **対象** (S10 関連ファイル群):
  - `app/(app)/inbox/[leadId]/page.tsx`
  - `server/queries/conversation.ts`
  - `server/actions/conversation.ts`
  - `components/inbox/conversation-view.tsx`
  - `components/inbox/composer.tsx`
  - `components/inbox/message-bubble.tsx`
- **参照** (依存系):
  - `lib/auth.ts` / `lib/audit.ts` / `lib/incident.ts` / `lib/state-machine.ts`
  - `db/schema.ts` (`leads`, `messages`, `audit_log`)
- **評価者**: cto-agent
- **基準**: 90+ 合格

---

## 総合スコア: **93 / 100** — 90+ **合格 (PASS)**

| 軸 | 配点 | スコア | 主観メモ |
|---|---|---|---|
| 1. Next.js 15 RSC / Client境界 / Server Action / generateMetadata | 20 | **18** | `force-dynamic` + `force-no-store` の RSC、`generateMetadata` は `await params` で Next 15 規約準拠。Client は `ConversationView` / `Composer` のみ。Server Action 2 本 (`sendMessage` / `markAsMeeting`) は `useActionState` で連結し、`revalidatePath` を server 側で叩いて Optimistic→Confirmed のループを閉じている。`MeetingForm` の `onSubmit` で `window.confirm` を使った確認は progressive enhancement を壊さない範囲で動作する(`form action` は Server Action のまま) |
| 2. TypeScript / Drizzle (orgId 強制 / tx) | 20 | **19** | `getConversation` は `where(and(eq(leads.id), eq(leads.orgId, orgId)))` で必ず orgId スコープ。`sendMessage` / `markAsMeeting` ともに `db.transaction(tx => {...})` 内で **取得→検証→書き込み→audit** を 1 トランザクションに閉じている。`writeAudit(payload, tx)` を渡している点が秀逸 (`lib/audit.ts:62` の `AnyTx` 型で受ける契約と一致)。`LeadState` 型は `lib/state-machine.ts` の union から再利用、`SendResult` も discriminated union 風に閉じている |
| 3. データ取得 (messages 最大 200 件 ASC) | 20 | **18** | `orderBy(asc(messages.sentAt)).limit(200)` で会話ビューに最適な並び。複合 index `msg_lead_sent_idx (lead_id, sent_at)` (`db/schema.ts:202`) が直接効くので EXPLAIN 上も問題ない。Phase1 用件としては十分。ただし「200 件で切れたかどうか」のシグナルが UI に出ていないため、200 件超ヒット時に古いログが黙って欠落して見える可能性が残る (M-1 / Phase2 で遅延ロード) |
| 4. エラーハンドリング (degraded + incident_id, LEAD_NOT_FOUND) | 20 | **19** | `ConversationResult` は `ok=false` 側を `reason: "not_found" \| "degraded"` で正規化、degraded のみ `incidentId` を載せる discriminated union。RSC 側 (`page.tsx:42`) は `not_found` を `notFound()` (404)、`degraded` を **インライン alert + incident_id 表示** に分岐していて、ユーザー文言とサポート導線が両立。Server Action 側でも `LEAD_NOT_FOUND` を `throw new Error` → catch → 文言化のパターンが両 action で揃っている (将来 sentinel error 化したいが現状で破綻はなし) |
| 5. 再利用性 / 命名 / UI プリミティブ | 20 | **19** | `Button` / `Badge` / `StateChip` / `Header` / `MessageBubble` の既存プリミティブを忠実に再利用。`Composer` の `formActionRef` パターンは「`useActionState` の formAction を ref で握って timer で遅延発火」する責務切り分けが明快で、命名 (`pendingContent` / `secondsLeft` / `cancelQueue` / `startQueue`) も一貫。`MessageBubble` は `status` を `"sending"\|"sent"\|"delivered"\|"failed"` の閉じた union にしており、ステータス遷移を厳密に絞れている |

> 合計: 18 + 19 + 18 + 19 + 19 = **93 / 100**

---

## 焦点項目の判定

### F-1. `sendMessage` が tx 内で **leads.state 遷移 + messages insert + writeAudit** を atomic に — ✅ 適合

`server/actions/conversation.ts:90-133`:

```ts
const messageId = await db.transaction(async (tx) => {
  const [lead] = await tx.select(...).from(leads).where(and(eq(id), eq(orgId)));
  if (!lead) throw new Error("LEAD_NOT_FOUND");

  const [inserted] = await tx.insert(messages).values({...}).returning({...});

  const nextState = lead.state === "REPLIED" ? "REPLIED" : "MESSAGED";
  await tx.update(leads).set({ state: nextState, lastActionAt: new Date() })
          .where(eq(leads.id, lead.id));

  await writeAudit({...}, tx);
  return inserted.id;
});
```

判定:
- 3 つの DML が全て `tx` を経由しており、PG レベルで 1 トランザクション。
- `writeAudit` の **hash chain advisory lock** (`pg_advisory_xact_lock(hashtext(orgId))`, `lib/audit.ts:69-71`) も同一 tx で取得 → 並行送信の hash chain race も封じる。設計書 §17 改竄耐性の要件を満たす。
- 例外時は Drizzle の transaction が自動 ROLLBACK し、messages の orphan も lead.state の中途半端な遷移も生じない。
- ただし `lead.state === "REPLIED"` 維持以外の遷移ルールは hard-coded で state-machine の単体関数に切り出されていない (L-2)。

### F-2. `DANGER_PATTERNS` が server で検証 — ✅ 適合 / UI 先出しも妥当

`server/actions/conversation.ts:28-32` で server 側に 3 パターン定義:
- 電話番号: `/(?:\d{2,4}[-\s]?){2,}\d{3,4}/`
- メール: `/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i`
- 値引き系: `/(?:割引|値引き|特別価格|無料\s*提供)/`

Server で hard reject → `{ ok:false, message: "...承認が必要です..." }` を返す。`Composer:164-169` の `dangerHint` は **同等パターンの UI ヒント** で、submit 前にユーザーへ予告する。

判定: 「UI 先出し」は **server を信頼できる単一の真実源としつつ、UX を改善する補助警告** として機能している。UI は `aria-live="alert"` 相当の `role="alert"` で表示 (Composer:288)、コピペ抑止にも効く。Defense-in-Depth として妥当。ただし正規表現が server / UI で **二箇所に定義** されており drift リスクがある → M-2。

### F-3. Composer の `formActionRef` を使った遅延発火 (React 19 安全性) — ✅ 適合

`components/inbox/composer.tsx:87-135`:

```ts
const formActionRef = React.useRef<((fd: FormData) => void) | null>(null);
const [result, formAction] = useActionState<SendResult, FormData>(sendMessage, INITIAL_SEND_RESULT);
formActionRef.current = formAction;

// 5 秒タイマー後に:
const fd = new FormData();
fd.append("leadId", leadId); fd.append("content", pendingContent);
if (aiAssisted) fd.append("aiAssisted", "true");
formActionRef.current?.(fd);
```

React 19 の `useActionState` が返す `formAction` は **stable identity ではない** (state 更新ごとに新しい binding になり得る) ため、effect の closure に固定して持つと stale binding を踏みやすい。**ref で握って常に最新を呼ぶ** 方針は React 19 環境で safe な作法。

加えて:
- `formActionRef.current = formAction;` を **render 中に代入** している。これは `useEffect(() => { ref.current = formAction; })` でも等価だが、render 中の ref 書き込みは React 公式が許容しているパターン (no observable side-effect, identity 同期のみ)。React 19 strict mode の double-render でも `formAction` 自体が deterministic なら問題は発生しない。
- 確定送信時に **新規 FormData をプログラマブルに組み立てて呼ぶ** → form 要素や `formData` 引数の現在値に依存せず、`pendingContent` を真実源にできる。タイマー発火時にユーザーが textarea を再編集していても、キュー時点のスナップショットで送信される。
- `useEffect` の cleanup (composer.tsx:129-134) で `clearInterval` を行うため、アンマウント/leadId 変更時の二重発火やリークも回避。

懸念点:
- `aiAssisted` を effect の依存配列に入れているため、ユーザーがキュー中に AI バッジを変えると **タイマーがリセット** される (composer.tsx:135)。要件上は問題ないがビヘイビアとして説明されていない (L-3)。
- ページ遷移直前 (`beforeunload`) でキュー破棄するハンドラはない → タブを閉じた人は「5 秒経たない=送られない」前提に依存。設計書 §6.4 と整合するなら OK。

判定: **React 19 の `useActionState` を ref 経由で遅延発火するパターンとしては最も安全な実装**。

### F-4. `markAsMeeting` が `state = "MEETING"` に直接遷移 (途中状態を経由していない) — ⚠️ MEDIUM

`server/actions/conversation.ts:179-203`:
```ts
await tx.update(leads).set({ state: "MEETING", lastActionAt: new Date() })
        .where(and(eq(leads.id), eq(leads.orgId)))
        .returning({ id: leads.id });
```

判定: 現状の運用では **operator が会話を見て手動で商談化を確定する** UX のため、`DISCOVERED` / `QUALIFIED` / `MESSAGED` / `REPLIED` のいずれから来ても **直接 `MEETING` に飛ぶ** ことが許容されている (`lib/state-machine.ts:23-37` の union に `MEETING` 自体は登録済)。これは UI/UX 設計書 §3.3 の「Manager は短絡的に商談化を確定できる」ガードと整合的。

ただし:
- 状態機械の **許容遷移** が型ではなく hard-coded な update 文に隠されている → state-machine.ts に `canTransitionTo(from, to)` のような表現を持たせれば、`DISQUALIFIED` / `FAILED` / `SAFE_MODE` / `QUARANTINED` からの不正遷移を **コードレビューだけでなく実行時にブロック** できる。現状ではこれらの「死に近い state」からも `MEETING` に飛んでしまえる (M-3)。
- `audit_log` には `action: "lead.requalified"` で記録されており、from/to を `diff` に入れているが **from を取り損ねている** (composer のように `select` してから `update` していない)。`updated[0]` も from を保持していない → 監査トレース上「どこから商談化したか」が辿れない (M-4)。

軽度の MEDIUM 2 件として記録。直接遷移そのものは仕様内なので **設計違反ではない**。

### F-5. 200 件 LIMIT で十分か / 古いログは Phase2 で遅延ロード — ⚠️ LOW

`server/queries/conversation.ts:81-92`:
```ts
const msgs = await db.select({...}).from(messages)
  .where(eq(messages.leadId, leadId))
  .orderBy(asc(messages.sentAt)).limit(200);
```

- **典型ケース**: LinkedIn 1:1 スレッドで 200 メッセージは年単位の対話に相当。Phase1 では 99% のリードで十分。
- **エッジケース**: 既存顧客との長期スレッドや、テストアカウントで 200 超のヒットは起こり得る。`ASC` + `LIMIT 200` は **古いメッセージから 200 件** を返すため、200 を超えると **新しい (重要な) メッセージが取得対象から落ちる** という最悪パターンを踏む。
- 推奨: Phase1 でも `desc(sentAt).limit(200)` で「直近 200 件」を取得し、UI 側で client reverse する方が ASC で古い側が欠落するより安全。または `count(*) > 200` の判定値を返して UI に「古いログを読み込む」CTA を出す (M-1)。

判定: Phase1 として致命的ではないが、**LIMIT の方向 (asc vs desc)** は仕様判断として一度設計書に明示すべき。HIGH ではないが、200 ヒット時の挙動を UI に出す MEDIUM。

---

## HIGH (= 90+ ブロッカー)

なし。

---

## MEDIUM (= リファクタ推奨, 90+ 維持には必須ではない)

### M-1. messages 200 件超ヒット時のシグナルが UI に出ない (軸 3)
**場所**: `server/queries/conversation.ts:81-92`, `components/inbox/conversation-view.tsx:101-106`
**問題**: `LIMIT 200` で切れたかどうかが client から判別不能。ASC オーダーで切れると **新しい側 (operator が読みたい側) が欠落** する最悪パターン。
**修正案 (Phase1 範囲)**:
- 取得を `desc(sentAt).limit(201)` に変えて UI 側で `slice(0, 200).reverse()`、`length > 200` フラグを返す。
- UI: メッセージ件数ヘッダの隣に「古いログを読み込む (Phase2)」disabled ボタン or 「+α 件あり」表示。

### M-2. DANGER_PATTERNS が server と UI に二重定義 → drift リスク (軸 2 / 5)
**場所**: `server/actions/conversation.ts:28-32` と `components/inbox/composer.tsx:164-169`
**問題**: 同一の正規表現が server 側と UI 側に独立に書かれている。片方を更新して片方を忘れる確率が高い。
**修正案**: `lib/dlp-patterns.ts` (server-safe な定数モジュール) に 1 箇所定義し、両者がインポート。client 側でも regex は実行できるので "server-only" を要らない pure module にする。

### M-3. `markAsMeeting` が dead state (DISQUALIFIED/FAILED/SAFE_MODE/QUARANTINED) からの遷移を許す (軸 2 / F-4)
**場所**: `server/actions/conversation.ts:179-203`
**問題**: 任意 state から `MEETING` に直接 update する SQL になっており、安全モード中・隔離中のリードも商談化できてしまう。
**修正案**: `lib/state-machine.ts` に `canBecomeMeeting(from: LeadState): boolean` を追加し、tx 内の `update` の `WHERE` に `state in (...)` を追加 (もしくは select 後 application 層で reject)。

### M-4. `markAsMeeting` の audit diff に `state.from` が入っていない (軸 4 / F-4)
**場所**: `server/actions/conversation.ts:198-200`
**問題**: `diff: { state: { to: "MEETING" }, note }` で **from を欠いている**。`sendMessage` 側は `lead.state` を select してから遷移しているのと対照的。改竄耐性 audit としては「商談化前の状態がどこだったか」が記録されないため、後から監査でレビューしづらい。
**修正案**: `tx.select({ state }).from(leads).where(...).limit(1)` を先に取り、`diff: { state: { from: prev.state, to: "MEETING" } }` を入れる。advisory lock の取り都合上も「select → update → audit」の順は良いパターン。

---

## LOW (= ナイス・トゥ・ハブ)

### L-1. `getConversation` の lead select で `name` が `null` の時 `"(名前未取得)"` を埋めている (軸 5)
`server/queries/conversation.ts:100` で server 側でローカライズ済み文字列を埋めている。設計書 §i18n が将来動き出すと server 文字列の hard-code が散らばる。
**修正案**: server は `null` のまま返し、UI 層でフォールバック ("(名前未取得)" / "(Unknown)") を担当。

### L-2. `nextState` の遷移ルールが `sendMessage` 内に hard-coded (軸 2 / F-1)
`server/actions/conversation.ts:110`:
```ts
const nextState = lead.state === "REPLIED" ? "REPLIED" : "MESSAGED";
```
動作上は正しいが、`DISQUALIFIED` / `FAILED` / `SAFE_MODE` 等の死に近い state からのメッセージ送信は本来禁止すべき。state-machine.ts に `canSendMessageFrom(from)` を切り出して action 冒頭でガードしておくと、SAFE_MODE 中の送信を防げる。

### L-3. `aiAssisted` を effect 依存に入れているため、キュー中に切り替えるとタイマー再開 (軸 1 / F-3)
`components/inbox/composer.tsx:135`:
```ts
}, [pendingContent, leadId, aiAssisted]);
```
タイマー起動中に AI バッジを変えると effect が再 trigger され `setSecondsLeft(5)` から再カウントになる。要件上問題はないが、ユーザーが「あれ、5 秒戻った？」と感じる UX。
**修正案**: `aiAssisted` を `useRef` で受けるか、`startQueue` 時に `pendingContent` を `{ content, aiAssisted }` のオブジェクトに昇格してそのスナップショットで送信する。effect 依存からは `aiAssisted` を外す。

### L-4. RSC の degraded 表示に `incidentId` が無くても箱だけ出る分岐がある (軸 4)
`app/(app)/inbox/[leadId]/page.tsx:54-63`:
```tsx
{result.incidentId && (
  <> ... <code>{result.incidentId}</code> ...</>
)}
```
判定: `getConversation` の degraded 分岐は必ず `incidentId` を返す (`server/queries/conversation.ts:121-125`) ため実害なし。ただし型レベルで `degraded ⇒ incidentId is string` を保証できると安全 (現在は optional)。
**修正案**: `ConversationResult` の `degraded` ブランチで `incidentId: string` を required にする。

### L-5. `notFound()` 後の Drawer URL 直叩き時の DEMO mock fallback (軸 1)
`app/(app)/inbox/[leadId]/page.tsx:13-35`: dev only で `l` / `00000000` プレフィックスを許容しているが、`getConversation` 側の mock も `l1`/`l8`/`l9` のみ。範囲外のモック ID は **`STRICT_UUID_RE` 不一致で 404 になる前に `mockConversation(leadId)` の `not_found` を返す導線** がきちんとあるが、`mockConversation(l99)` → `not_found` → `notFound()` 経由となるため、page.tsx の **UUID チェックを通った後で query 側で 404 になる二段構え**。ユーザー影響なし、ドキュメント上の補足のみ。

---

## 90+ 判定

**合格 (93/100 PASS)**。

- HIGH 0 件、MEDIUM 4 件 (M-1〜M-4)、LOW 5 件 (L-1〜L-5)。
- MEDIUM はいずれも **アーキテクチャ違反ではなく、Phase2 で改善すべき品質向上項目**。
- 特筆すべき強み:
  - tx 内で 3 つの DML + audit を atomic にまとめ、`writeAudit(payload, tx)` に tx を渡して **hash chain advisory lock を同一トランザクションで取得** している (`lib/audit.ts:69`)。改竄耐性 + 並行安全の両立として模範的。
  - `useActionState` の `formAction` を ref で握って timer 後に呼ぶパターンは、React 19 の identity instability を踏まない実装で他コンポーネントの参考になる。
  - `ConversationResult` の discriminated union と RSC 側での `not_found`/`degraded`/`ok` 三分岐が、UX 文言・404 status・incident_id 表示の各責務を綺麗に分離している。

S10 は r1 で 90+ 合格。M-1 (LIMIT 方向) と M-3/M-4 (markAsMeeting の dead-state ガード & from 記録) は次回スプリント or Phase2 起票推奨。
