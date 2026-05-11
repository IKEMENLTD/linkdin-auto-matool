# S10 会話画面 精密コードレビュー (r2)

**対象**
- `components/inbox/composer.tsx`
- `components/inbox/message-bubble.tsx`
- `components/inbox/conversation-view.tsx`
- `app/(app)/inbox/[leadId]/page.tsx`
- `server/actions/conversation.ts`
- `server/queries/conversation.ts`

**レビュー日**: 2026-05-11
**前回判定**: PASS (92 / 100) @ r1
**今回判定**: **PASS (97 / 100)**

---

## 総合スコア + R1 差分

| 軸 | 配点 | r1 | r2 | 差分 | 主因 |
|---|---|---|---|---|---|
| 1. 型安全 (any / as cast / narrowing) | 20 | 19 | **19** | ±0 | `z.coerce.boolean()` の挙動緩さは未対応 (M-5 据置) |
| 2. React 19 / Next.js 15 | 20 | 17 | **20** | **+3** | H-1 `ResultPing` 削除完了、H-2 `useEffect` ラップ完了。`useActionState` 正規パターン到達 |
| 3. a11y (role/aria/Tab/IME) | 20 | 18 | **18** | ±0 | M-4 (秒数ライブリージョン読み上げ過多)、M-6 (`aria-pressed` 欠如) 未対応 |
| 4. エッジケース (空・長文・特殊文字・ID 重複) | 20 | 18 | **20** | **+2** | M-1 `crypto.randomUUID()` 化完了。`temp-uuid` 命名で衝突確率 1/2^122 まで低減 |
| 5. コード匂い (重複・未使用・命名) | 20 | 20 | **20** | ±0 | 引き続き重複ほぼ無し、未使用 import ゼロ |
| **合計** | **100** | **92** | **97** | **+5** | **PASS (90+)** |

---

## R2 で潰した HIGH/MEDIUM の検証

### ✅ H-1. `ResultPing` の `useFormStatus` dead-code 削除
**確認**: `composer.tsx` 全体 (1-328 行) に `ResultPing`/`useFormStatus` が一切残っていない (grep 確認済)。
**新方式**: result 通知は `reportedRef` (composer.tsx:97-108) で同値スキップしつつ `onConfirmed(result)` 経由で `ConversationView` の `toast` (conversation-view.tsx:74-91, 234-256) に流す形に変更。
**評価**: 仕様通り。`useFormStatus` の `<form>` 子孫制約を回避し、imperative dispatch の自然な使い方になった。

### ✅ H-2. `formActionRef.current` 代入を `useEffect` でラップ
**確認**: `composer.tsx:92-94`
```tsx
React.useEffect(() => {
  formActionRef.current = formAction;
}, [formAction]);
```
**評価**: 完璧。render 中の ref 書き換えに伴う Concurrent Rendering 中断時のレース可能性が消えた。Strict Mode の 2 回 commit でも依存配列で安定化される。

### ✅ M-1. 楽観メッセージ ID `temp-${Date.now()}` 衝突
**確認**: `conversation-view.tsx:50-55`
```tsx
const newTempId = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `temp-${crypto.randomUUID()}`;
  }
  return `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
};
```
**評価**:
- `crypto.randomUUID()` で実質衝突なし (1/2^122)
- `typeof crypto !== "undefined" && "randomUUID" in crypto` のガードで古い WebView (iOS 14 以前) でも fallback が効く
- `m.id.startsWith("temp-")` (conversation-view.tsx:149) との互換性も維持
**指摘**: なし。`typeof crypto !== "undefined"` の判定は厳密だが、Next.js client component なら `crypto` は常に Web Crypto API として存在するため過剰防御。ただし害も無い。

### ✅ M-2. `MessageBubble.aiAssisted` を `isOutbound` で gate
**確認**: `message-bubble.tsx:56`
```tsx
{isOutbound && aiAssisted && (
  <span ... aria-label="AI 補助あり">
```
**評価**: Defense-in-depth 達成。データ層が inbound に `aiAssisted: true` を入れる将来バグでも UI は防御される。

---

## R2 で副次的に改善された項目 (bonus)

### 🎉 M-3. `BubbleStatus` の `"sent"`/`"failed"` 分岐が生きた
**確認**: `conversation-view.tsx:74-91`
```tsx
const handleConfirmed = (s: SendResult) => {
  setToast({ kind: s.ok ? "success" : "error", text: s.message ?? "" });
  const tempId = tempIdRef.current;
  if (!tempId) return;
  if (s.ok) {
    setMessages((prev) => prev.map((m) => (m.id === tempId ? { ...m, __status: "sent" } : m)));
  } else {
    setMessages((prev) => prev.map((m) => (m.id === tempId ? { ...m, __status: "failed" } : m)));
  }
  tempIdRef.current = null;
};
```
**評価**: R1 で「dead branch」と指摘した `"sent"`/`"failed"` が `__status` 経由で活用された。`OptimisticMessage = ConversationMessage & { __status?: BubbleStatus }` (line 30) という型拡張も綺麗。失敗時にユーザが視覚的に検知できるようになり、UX 上重要な改善。

---

## HIGH 残存 / NEW HIGH

### HIGH 残存: **0 件**
R1 で指摘した H-1 / H-2 は完全に解消。

### NEW HIGH: **0 件**
R2 の変更で新規に HIGH レベルの問題は発生していない。

### NEW MEDIUM (1 件)

#### NM-1. `tempIdRef` の race condition (連続送信時)
**ファイル**: `conversation-view.tsx:48, 60, 76-90`

`tempIdRef.current` は単一スロットなので、送信 A の 5 秒待機中に送信 B を始めることはできない (`pendingContent != null` で Composer 側がガード)。しかし将来「複数の楽観メッセージを同時に並べる」拡張をした際に、最後の `tempId` で上書きされて以前の temp メッセージが永久に `"sending"` のままになるリスクがある。

**現状**: S10 仕様 (シリアル 5 秒キュー) ではバグにならない。設計上の制約として `Composer` 側で `pendingContent != null` 中は送信ボタンを無効化 (composer.tsx:282 で `pendingContent == null` のときのみ Composer UI 表示) しているため OK。

**修正案** (Phase2 で): `tempIdRef` を `Map<string, ...>` または queue に拡張。R2 範囲では **対応不要**。

---

## MEDIUM 残存 (R1 から持ち越し)

| ID | 内容 | r2 状態 | 優先度 |
|---|---|---|---|
| M-4 | Undo バー `aria-live="polite"` で秒数を 5 回読み上げ | **未対応** | 次イテレ |
| M-5 | `aiAssisted: z.coerce.boolean()` は `"false"` を `true` に化かす | **未対応** | 次イテレ |
| M-6 | AI 下書きカードに `aria-pressed` 欠如 | **未対応** | 次イテレ |

いずれも R2 のスコープ外であり 1-3 行で潰せるため、次イテレで一括 PR 推奨。

---

## LOW 残存 (R1 から持ち越し)

| ID | 内容 | r2 状態 |
|---|---|---|
| L-1 | `firstName = name.split(" ")[0]` が全角スペース U+3000 で失敗 | 未対応 (任意) |
| L-2 | `reportedRef` の重複ロジックを `useReportOnce` に抽出可能 | 未対応 (任意) |
| L-3 | プレースホルダ「IME 中の Enter では送信されません」と実装の整合 | 未対応 (任意) |
| L-5 | `INITIAL_SEND_RESULT = { ok: false }` の意味論 | 未対応 (任意) |

---

## 90+ 判定

✅ **PASS (97 / 100)**

R1 (92) → R2 (97) で **+5 点**。HIGH 0 件、NEW HIGH 0 件、NEW MEDIUM 1 件 (将来拡張時のみ問題化、現仕様では実害無し)。

**リリース可否**: ✅ **リリース可**
- HIGH ゼロ
- R1 で指摘した H-1 / H-2 / M-1 / M-2 全て完了
- bonus で M-3 (失敗状態の視覚化) まで対応済み

**次イテレ推奨**: M-4 (a11y 読み上げ過多)、M-5 (zod coerce 厳密化)、M-6 (`aria-pressed`) の 3 件を 1 PR にまとめると半日工数。LOW 群は時間があれば。

---

## 良かった点 (R2 で追加)

- **H-1 解消方法の選択が綺麗**: `useFormStatus` を捨てて `reportedRef` + `onConfirmed` 経由で親に通知する設計は、`<form>` を使わない imperative dispatch との相性が良く、責務分離も明確 (Composer は送信だけ、Toast は親が出す)
- **M-1 の `newTempId()` ヘルパ抽出**: 単にインラインで `crypto.randomUUID()` を呼ぶのではなく、SSR 環境を意識した `typeof crypto !== "undefined"` ガード付き fallback を関数化したのは良い設計
- **M-3 bonus 対応**: `__status` を `OptimisticMessage` 型に追加して `handleConfirmed` で sent/failed に遷移させた。R1 で指摘した dead branch を活用しつつ、失敗時の UX を改善
- **`reportedRef` パターンの一貫性**: Composer 側 (composer.tsx:97-108) と MeetingForm 側 (conversation-view.tsx:272-278) で同じ「同値スキップ→onReport」パターンを採用し、二重通知を防いでいる
