# S10 会話画面 精密コードレビュー (r1)

**対象**
- `components/inbox/composer.tsx`
- `components/inbox/message-bubble.tsx`
- `components/inbox/conversation-view.tsx`
- `app/(app)/inbox/[leadId]/page.tsx`
- `server/actions/conversation.ts`
- `server/queries/conversation.ts`

**レビュー日**: 2026-05-11
**判定**: **PASS (92 / 100)**

---

## 総合スコア

| 軸 | 配点 | 得点 | 主因 |
|---|---|---|---|
| 1. 型安全 (any / as cast / narrowing) | 20 | **19** | `any` / `as` ゼロ、`safeParse` narrowing 厳格。`z.coerce.boolean()` のみ要件と微妙にズレ |
| 2. React 19 / Next.js 15 (use client境界・useActionState・ref+formAction) | 20 | **17** | `formActionRef` パターンは動くが `<form>` 外運用ゆえ `useFormStatus` が機能しない (ResultPing が dead-code 化) |
| 3. a11y (role/aria/Tab/IME) | 20 | **18** | role/aria は丁寧。AI 下書きボタンの `aria-pressed` 欠如、Undo バー内の秒数読み上げが煩い |
| 4. エッジケース (空・長文・特殊文字・ID 重複) | 20 | **18** | maxLength + zod 二重ガード ◯、`temp-${Date.now()}` は同一 ms 衝突可能性 |
| 5. コード匂い (重複・未使用・命名) | 20 | **20** | 重複ほぼ無し、未使用 import ゼロ、命名一貫 |
| **合計** | **100** | **92** | **PASS (90+)** |

---

## HIGH (要修正 — リリース前)

### H-1. `ResultPing` の `useFormStatus` が常に `pending=false` を返す
**ファイル**: `components/inbox/composer.tsx:315-337`

`useFormStatus` は **`<form>` 要素の子孫からのみ pending を取得できる** (React 19 公式仕様)。Composer は textarea を `<form>` で包まずに `formActionRef.current?.(fd)` で imperative に dispatch しているため、`ResultPing` は `<form>` のスコープ外にいる。

結果として:
- `const { pending } = useFormStatus();` は常に `{ pending: false, data: null, method: null, action: null }` を返す
- `if (pending) return null;` は **dead code**
- 「送信中はメッセージを抑制する」という意図が機能していない

**影響**: 機能的には害無し (5 秒キュー Undo の最中は別 UI を出しているため重なりは発生しにくい)。ただし `useFormStatus` の hook 呼び出しコストと、誤解を招くコードが残る。

**修正案** (どれか 1 つ):
1. `useFormStatus` を削除し、`pendingContent != null` を親から prop で受けて自前で抑制する
2. `<form action={formAction}>` で textarea を囲み、submit ボタンに `formAction` を渡す古典的構成に変更 (この場合 `formActionRef` 自体が不要)
3. `useActionState` 由来の `isPending` (React 19.0+ で第3戻り値として復活) を使う:
   ```tsx
   const [result, formAction, isPending] = useActionState(sendMessage, INITIAL_SEND_RESULT);
   ```
   こちらは form の有無に関係なく pending を取得できる。**最も簡潔で推奨**。

---

### H-2. `formActionRef.current?.(fd)` パターンの型安全性
**ファイル**: `components/inbox/composer.tsx:87, 93, 125`

```ts
const formActionRef = React.useRef<((fd: FormData) => void) | null>(null);
// ...
formActionRef.current = formAction;
```

`useActionState` が返す `formAction` の型は実際には `(payload: P) => void` だが **React 19 内部では Server Action としても dispatcher としても受け取れる union 型** であり、上記の手書き型は実装に対して narrow すぎる。

加えて **render 中に ref を直接書き換える** (93 行目) のは React の strict mode で 2 回 commit → 2 回代入されるためたまたま動くが、本来は `useEffect` でセットすべき。Concurrent Rendering で transition 中の中断が起きると、古い `formAction` がキャプチャされる可能性 (実害は極小だが原理上のレース)。

**修正案**:
```tsx
React.useEffect(() => {
  formActionRef.current = formAction;
}, [formAction]);
```

もしくは H-1 と同じく `isPending` 3rd return を使えばこのパターンごと不要 (5 秒タイマー終端から `startTransition(() => formAction(fd))` を呼ぶ形に置き換え可)。

---

## MEDIUM (リリース後の改善推奨)

### M-1. 楽観メッセージ ID `temp-${Date.now()}` の衝突可能性
**ファイル**: `components/inbox/conversation-view.tsx:51`

`Date.now()` はミリ秒精度。同一 ms 内に 2 回 `handleQueueing` が呼ばれると同一キー。S10 仕様上は 5 秒 Undo がシリアル化するので現実的なリスクは低い。ただし:

- `<MessageBubble key={m.id} />` で React に key 衝突警告が出る経路は理屈上ある (例: 開発時にダブルクリックで Submit が 2 回走るケース)
- 永続化前のクラッシュ復元ハンドラを将来追加した場合に「同一 ms に複数キュー復元」が起きる

**修正案** (どれでも):
```ts
const tempId = `temp-${crypto.randomUUID()}`;
// または
const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
```

`crypto.randomUUID()` は client component で安全 (SSR 経路を通らない)。

---

### M-2. `MessageBubble.aiAssisted` を direction で防御していない
**ファイル**: `components/inbox/message-bubble.tsx:56-64`

要望仕様: AI バッジは **outbound (自分側) のみ** 表示。実装はデータ層で `aiAssisted` を inbound に書かない前提に依存。

```tsx
{aiAssisted && (   // ← direction を見ていない
  <span ... aria-label="AI 補助あり">
```

データ層のバグ・テスト用フィクスチャ・将来の API 変更で inbound に `aiAssisted: true` が入った瞬間に相手側にも AI バッジが出る。**Defense-in-depth** として:

```tsx
{isOutbound && aiAssisted && (
  <span ...>
```

を推奨。1 文字追加で堅牢化される割に効果大。

---

### M-3. `BubbleStatus` の `"sent"`/`"failed"` が dead branch
**ファイル**: `components/inbox/conversation-view.tsx:114`、`components/inbox/message-bubble.tsx:71-100`

```tsx
status={m.id.startsWith("temp-") ? "sending" : "delivered"}
```

実データに status カラムが無いため、`MessageBubble` 側の `"sent"`/`"failed"` 分岐は永久に到達しない。S10 範囲では許容可能だが:
- 既存配信 (delivered) と確定送信完了 (sent) の区別がつかない
- 楽観メッセージが失敗したときに視覚的に「失敗」へ落とせない

**修正案**: Composer の `result.ok === false` で対応する temp 行を `"failed"` に書き換えるか、`MessageBubble`/`BubbleStatus` を S10 範囲では `"sending" | "delivered"` に絞る。後者の方が安全。

---

### M-4. `useFormStatus` 由来の Undo バー読み上げ過多
**ファイル**: `components/inbox/composer.tsx:244-264`

```tsx
<div role="status" aria-live="polite">
  ...
  <div className="font-medium">{secondsLeft} 秒後に送信されます</div>
```

`secondsLeft` は 200ms 間隔で更新され、5,4,3,2,1 と数値が変わるたびに `aria-live="polite"` で読み上げが走る → スクリーンリーダーが 5 回連続発話してしまう。

**修正案**:
- ライブリージョンを「送信されます (取り消すには…)」の固定文だけに絞り、`secondsLeft` 表示は `aria-hidden="true"` に
- もしくは初回のみ `aria-live="polite"`、その後は `aria-live="off"` にする

---

### M-5. `aiAssisted` の zod coerce が緩い
**ファイル**: `server/actions/conversation.ts:25, 56`

```ts
aiAssisted: z.coerce.boolean().optional().default(false),
```

`z.coerce.boolean()` は JavaScript の `Boolean(x)` 規則で `"false"` を `true` に変換する。Composer 側は truthy 時のみ `"true"` を append するので実害は無いが、**他経路 (テスト・カスタムクライアント) から `aiAssisted=false` 文字列が来ると true に化ける**。

**修正案**:
```ts
aiAssisted: z
  .preprocess((v) => v === "true" || v === true, z.boolean())
  .optional()
  .default(false),
```

---

### M-6. AI 下書きカードに `aria-pressed` が無い
**ファイル**: `components/inbox/composer.tsx:193-217`

3 つの下書き案 (案 A/B/C) は `<button type="button">` で実装され、選択状態は色とラベル「編集中」だけで表現されている。トグルボタン群として `aria-pressed={active}` を付与すべき。

```tsx
<button
  type="button"
  aria-pressed={active}
  ...
>
```

---

## LOW (任意)

### L-1. `buildDrafts` の `firstName` 抽出が ASCII space 前提
**ファイル**: `components/inbox/composer.tsx:38`

```ts
const firstName = name.split(" ")[0] ?? name;
```

日本語名で全角スペース U+3000 が混じると姓名分割が機能しない。`fmtRelative` 周りも踏まえると i18n 配慮として:

```ts
const firstName = name.split(/[\s　]/)[0] ?? name;
```

---

### L-2. `reportedRef` 重複ロジック
**ファイル**: `components/inbox/composer.tsx:96-107`、`components/inbox/conversation-view.tsx:230-236`

Composer と MeetingForm の双方に「同じ `result` を二度 toast しないため `useRef` で同値比較する」パターンがある。

```ts
function useReportOnce(result: SendResult, onReport: (r: SendResult) => void) {
  const reported = React.useRef<SendResult | null>(null);
  React.useEffect(() => {
    if (!result.message) return;
    if (reported.current === result) return;
    reported.current = result;
    onReport(result);
  }, [result, onReport]);
}
```

抽出すれば 2 ヶ所のロジック (~10 行) が消える。任意。

---

### L-3. プレースホルダ文言が IME ハンドラの存在を匂わせる
**ファイル**: `components/inbox/composer.tsx:283`

```
placeholder="返信を書く…（IME 中の Enter では送信されません）"
```

現状は `onKeyDown` が未設定で、Enter は単に改行となる (IME 関係なく)。文言は技術的には嘘ではないが、将来「Cmd+Enter で送信」のような機能を追加した瞬間に IME 中も発火しないよう `isComposing` ガードを追加する必要が出る。**この文言を約束として扱う**ためのテスト or コードコメントを残しておくと安心:

```tsx
// NOTE: Cmd+Enter 送信を追加する場合は e.nativeEvent.isComposing で IME 中を必ず除外する
```

---

### L-4. `MeetingForm` 確認 dialog → action キャンセル経路は仕様通り
**確認結果**: ✅ 問題なし

`<form action={formAction} onSubmit={(e) => { if (!confirm(...)) e.preventDefault(); }}>` の組み合わせは React 19 で **`onSubmit` が action より先に走り、`preventDefault()` で action 抑止可能**。実機検証および React 19 RFC 通り。

ただし `confirm` は browser native dialog のため SSR 環境下では呼べないが、`onSubmit` は client-side event でしか発火しないので問題なし。

---

### L-5. `INITIAL_SEND_RESULT = { ok: false }` の意味論
**ファイル**: `server/actions/conversation.ts:16`

初期値が `ok: false` だが、まだ何も送信していない状態を「失敗」として扱うのは違和感。`message` プロパティで早期 return しているので実害ゼロだが、型として `{ ok: null | true | false; ... }` とするか、初期値を `{ ok: true, message: undefined }` のような中立値にする検討余地あり。

---

## 個別チェック項目への回答

### Q1. `formActionRef.current?.(fd)` は useActionState の API として正しいか
**A**: 動作はする (React 19 では `useActionState` 戻りの `formAction` は普通の関数として呼び出せる) が、推奨パターンではない。`<form action={...}>` の中で使うか、新しい 3rd return `isPending` を活用するのが理想。さらに **render 中に ref を直接書き換えている** ため `useEffect` でラップすべき (H-2)。

### Q2. `temp-${Date.now()}` ID 重複可能性
**A**: 同一ミリ秒衝突は理論上あり。5 秒 Undo がシリアル化するので現実リスクは低いが、`crypto.randomUUID()` で潰すのが正解 (M-1)。

### Q3. `ResultPing` が form 外で `useFormStatus` を呼んでいる件
**A**: **指摘通り `pending` は永遠に `false`**。`useFormStatus` は `<form>` の子孫からのみ pending を取得する仕様。`pending` 判定は dead-code (H-1)。

### Q4. IME 中の Enter で送信されないか
**A**: 現状 `onKeyDown` 未設定のため Enter は改行のみ。IME 安全 (構造的に)。プレースホルダ文言だけが将来の地雷 (L-3)。

### Q5. MessageBubble の aiAssisted が両 direction で出ないか
**A**: 実装上は `aiAssisted && (...)` だけで direction を見ていない (M-2)。今のデータ層が inbound に `aiAssisted: true` を入れない前提で動いているが、Defense-in-depth として `isOutbound && aiAssisted && (...)` に直すべき。

### Q6. MeetingForm の confirm キャンセル時に formAction が呼ばれていないか
**A**: ✅ 呼ばれない。React 19 の form action 仕様で `onSubmit` の `preventDefault()` は action dispatch を抑止する (L-4)。

---

## 良かった点

- **`safeParse` の徹底**: server action 側で zod の `safeParse` を使い、エラー詳細を握りつぶさず `issues[0]?.message` で UI に返している
- **transaction 内 audit**: `sendMessage` で messages INSERT + leads UPDATE + audit を同一 tx に閉じている (S10 観点でなくとも良い設計)
- **org スコープ強制**: WHERE 句で `eq(schema.leads.orgId, session.orgId)` が必ず入っている。tenant isolation 守備堅い
- **DEMO モード**: `getDb() === null` での自動フォールバックが綺麗に分岐 (`source: "mock"` を返して UI で Badge 表示)
- **a11y 基礎**: `aria-hidden` on icons / `role="alert"` on danger hint / `role="status"` on undo / `aria-label` on textarea / `aria-live` on toast。S10 内で目立つ抜けは少ない
- **DANGER_PATTERNS の二重防御**: UI 側でも事前警告 (Composer:164-169)、server 側でも拒否 (conversation.ts:28-32, 62-69)
- **`whitespace-pre-wrap break-words`** で改行・長単語・特殊文字を堅実にハンドル
- **`fetchCache = "force-no-store"` + `dynamic = "force-dynamic"`** で会話ページが正しく動的化されている

---

## 修正優先度サマリ

| Priority | 件数 | 推奨アクション |
|---|---|---|
| HIGH | 2 | リリース前に対応 (H-1, H-2 は連動して 1 件のリファクタで解消可能) |
| MEDIUM | 6 | 次イテレーションで順次解消 |
| LOW | 5 | 任意 / 後続 PR で OK |

**90+ 判定**: **PASS** (92/100)

HIGH 2 件はいずれも「動いている」状態のままだが、`useActionState` の正しい使い方への migration として 1 PR でまとめて修正可能。MEDIUM の M-1 (uuid 化), M-2 (defense-in-depth) は 2-3 行の修正で完了するので、HIGH と同 PR に同梱推奨。
