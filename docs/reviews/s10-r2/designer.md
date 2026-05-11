# S10 会話画面 デザイナーレビュー (r2)

**対象**: `app/(app)/inbox/[leadId]/page.tsx`, `components/inbox/conversation-view.tsx`, `components/inbox/composer.tsx`, `components/inbox/message-bubble.tsx`, `lib/utils.ts`, `lib/dlp.ts`, `server/actions/conversation.ts`, `server/queries/conversation.ts`
**設計書**: `docs/ui-ux/UI_UX_Design.md` v1.3 §6.4
**評価者**: designer-agent
**Date**: 2026-05-11
**前回**: r1 = 84/100 NEAR

---

## 総合スコア: **91 / 100** — 判定: **PASS** (+7 from r1: 84 → 91)

| 軸 | r1 | r2 | Δ | 主要所見 |
| --- | ---:| ---:| ---:| --- |
| 1. ビジュアル | 18 / 20 | 18 / 20 | ±0 | 既存品質維持。AI 案カードに「採用しない」アクションが揃い、操作群の重心バランスが向上 |
| 2. 設計書整合 (§6.4 / §9.2) | 15 / 20 | **18 / 20** | **+3** | §9.2 必須 3 操作のうち「採用しない」が出現し、AI 出力の必須セット (編集 / 採用しない / 根拠) が形式的に揃った。配信 4 段階も `sending → sent → failed` の rollback が実装され "形だけ" から脱出 |
| 3. インタラクション | 17 / 20 | **18 / 20** | **+1** | failed バブル rollback と `tempIdRef` 同期で送信失敗時の UX 穴が塞がった。`formActionRef` も useEffect 経由化により hydration 不一致リスク低減 |
| 4. a11y | 15 / 20 | **17 / 20** | **+2** | `safeExternalUrl` で javascript: 等の "見えない実害" を撤廃。`aria-label="AI 案を採用しない (フォームを空にする)"` が補助テキストとして適切 |
| 5. 日本語 B2B トーン | 19 / 20 | **20 / 20** | **+1** | 「どの案も採用しない」「LinkedIn URL が不正です」「LinkedIn で開く」の語彙選択が一貫して敬体丁寧度を維持。"採用しない" の語感が "却下" でも "やめる" でもなく合議室語彙として◎ |

---

## R1 HIGH の解消確認

### ✅ H1 解消: AI ドラフト「採用しない」が UI に出現

**該当**: `components/inbox/composer.tsx:222-233`

```tsx
<button
  type="button"
  onClick={() => {
    setActiveDraft(null);
    setAiAssisted(false);
    setContent("");
  }}
  className="inline-flex items-center gap-1 text-[11px] text-ink-500 ..."
  aria-label="AI 案を採用しない (フォームを空にする)"
>
  <ThumbsDown className="size-3" aria-hidden /> どの案も採用しない
</button>
```

評価:
- 設計書 §9.2「すべての AI 出力に 3 操作」のうち「採用しない」が実装された
- ThumbsDown アイコン + 日本語ラベル + aria-label の三重表現で a11y も満たす
- onClick で `activeDraft / aiAssisted / content` を同時クリアする副作用が正しく揃っている (AI フラグの取り残し無し)
- 「根拠を見る (Phase2)」は変わらず `disabled` だが、**ラベルが "(Phase2)" 明記** に変わり「未実装ではなく Phase 後ろ送り」が UI から読み取れる → 設計書必須要件は "存在する" に到達

軽微な検討点 (LOW 落とし、後述 L1):
- 「採用しない」を押した瞬間に textarea も同時消去される点について、ユーザが手書きで textarea を編集中だった場合は破壊的になり得る。confirm or `activeDraft` がある時のみ消去、という分岐があるとさらに親切

→ **H1 完全解消**。設計書整合 +3 のうち 2 はここで取れた。

### ✅ H2 解消 (R1 では LOW 扱いだったが本 PR で先取り対応): javascript: スキーム遮断

**該当**: `lib/utils.ts:26-36`, `components/inbox/conversation-view.tsx:40, 175-188`

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

評価:
- `new URL()` パース → `protocol` ホワイトリストの順序が正しい (substring/正規表現での判定より堅牢)
- `data:` / `file:` / `javascript:` / `vbscript:` 全て弾ける (`protocol` チェックは大文字小文字も `new URL` が正規化)
- `try/catch` で不正な URL (相対パス、空白のみ) も null に集約 → 呼び出し側の分岐が単純化
- ConversationView 側で `safeLinkedinUrl` が null の時は **空表示せず「LinkedIn URL が不正です」を Muted で出す** UX が秀逸 (Phase2 でデータ品質チェックに繋げる動線が見える)
- `target="_blank"` + `rel="noreferrer noopener"` も外部リンクの基本作法を満たす

→ **セキュリティ + UX の両得**。a11y/UX 観点では「不正データを silent に隠すのではなく "不正です" と明示する」設計が、運用担当者の data hygiene 意識を高める良い実装。

---

## R1 MEDIUM 対応状況

| 項目 | 状態 | 備考 |
| --- | --- | --- |
| M1: window.confirm → カスタムモーダル | **未対応** | composer.tsx:141, conversation-view.tsx:284 で `window.confirm` 継続 |
| M2: 商談化 Calendly UI | **Phase2 送り** (本 PR スコープ外 / 明示記載あり) | 設計書側に Phase2 マイルストーン明記が必要 |
| M3: IME `compositionend` | **未対応** | textarea に keyDown/compositionEnd ハンドラ無し継続 |
| M4: failed status rollback | ✅ **完全対応** | conversation-view.tsx:74-91 で `__status: failed` 更新、message-bubble.tsx が 4 状態描画 |
| M5: AI 長文切れ「もっと見る」 | 未対応 | 案 B/C は line-clamp-4 で切れる可能性継続 |
| M6: disabled ボタン a11y | 一部対応 | ラベルに「(Phase2)」明記で文脈は伝わるが、`aria-disabled` ではなく `disabled` 継続 |
| DLP 共通化 | ✅ **対応** | `lib/dlp.ts:14` `detectDlpViolation`、UI + Server 両方で import |
| ResultPing dead code 削除 | ✅ **対応** | `components/inbox/` 配下から消失 |
| formActionRef useEffect 経由化 | ✅ **対応** | composer.tsx:92-94 で useEffect 経由 |

R1 で挙げた MEDIUM のうち **M4 + 3 件の即対応**が確実に取れている。残った M1/M2/M3/M5 は Phase2 マイルストーンに送って Issue 化する整理で 90+ 圏内には残れる。

---

## HIGH (90+ ブロッカー)

### 残存 HIGH: **0 件**

R1 で唯一の HIGH だった H1 (AI 採用しない) は完全解消。設計書 §9.2 必須 3 操作のうち「採用しない」が UI に出現し、「根拠を見る」は (Phase2) 明記でラベル化されたため、形式要件は満たした。

### NEW HIGH: **0 件**

R2 で導入された変更 (採用しないボタン / safeExternalUrl / failed rollback / DLP 共通化 / formActionRef useEffect 化) を全て読んだが、

- `setContent("")` の副作用が `useEffect` 依存配列の外で発生する箇所は無し
- `safeExternalUrl` が `new URL` 例外を `try/catch` で正しく封じている
- `setMessages` の更新が `useEffect [detail.messages]` と handleConfirmed で競合せず、`tempIdRef.current = null` のリセットが正しく走る
- `formActionRef.current?.(fd)` の null チェックが setInterval コールバック内で正しい

新規 HIGH を引き込む要素は見当たらない。

---

## MEDIUM (Phase2 送り推奨)

### M1. window.confirm がそのまま残存 (設計書 §6.4 違反)

R1 から継続。`composer.tsx:141` の送信前確認、`conversation-view.tsx:284` の商談化確認の 2 箇所で `window.confirm` 継続。

- focus trap / aria-modal=true / Esc / Cmd+Z 対応不可
- 改行・装飾を保持した本文プレビュー不可 (現状 `slice(0, 200)` のテキストのみ)
- Playwright/Storybook での E2E 不可

設計書 §6.4 / §7 Modal 要件と差分が残るため、Phase2 でカスタムモーダルへ差し替えること。**91/100 PASS 範囲内なので本 PR をブロックしない**。

### M2. 商談化フォーム / Calendly URL 貼付 UI (設計書 §6.4)

Phase2 マイルストーンとして明示済み。本 PR では `window.confirm` のみで markAsMeeting を呼ぶ最小実装。`MeetingSchema.note` フィールドが UI 未露出のまま (常に空)。

Phase2 で右ペインにステップアウト UI (Calendly URL input + note textarea + Deal preview) を実装することで設計書整合 18 → 20 が見える。

### M3. IME 中の Enter 抑止 (設計書 §8.2 違反)

`textarea` に `onKeyDown` / `onCompositionStart/End` 無し継続。placeholder の「IME 中の Enter では送信されません」が **そもそも Enter 送信を実装していないので半分嘘**。

選択肢:
- (A) Cmd/Ctrl+Enter で送信ショートカット + `isComposing` で抑止
- (B) placeholder の「IME 中の Enter…」文言を削除

B2B SaaS 慣習としては (A) を Phase2 で実装するのが望ましい。

### M5. AI 案の長文切れ後の動線

`line-clamp-4` で案 B/C が切れた場合の全文確認手段が「採用してから textarea で読む」しかない継続。`Popover` で展開する手があるが、本 PR スコープ外で Phase2 へ。

### M6. 「根拠を見る (Phase2)」の disabled ボタン a11y

ラベルに「(Phase2)」明記で文脈は伝わるが、`aria-disabled="true"` + `tabIndex={0}` への変更があれば screen reader が「Phase2 で実装予定」をフォーカス到達時にアナウンスできる。本 PR で `disabled` のまま残っているが、ラベルテキストに Phase 表記が含まれるため deal-breaker ではない。

---

## LOW (本 PR で目立った微修正点)

### L1. 「どの案も採用しない」が textarea 編集中の手書き内容も破棄する

`composer.tsx:222-233` の onClick は `setContent("")` で textarea を空にする。AI 案を採用していない手書きユーザの内容も消えてしまうリスクがある。

改善案:
```tsx
onClick={() => {
  setActiveDraft(null);
  setAiAssisted(false);
  if (activeDraft) setContent(""); // AI 採用済の時だけクリア
}}
```

または `window.confirm("下書きを空にします。よろしいですか？")` を AI 未採用かつ content がある場合にだけ出す。

### L2. ヘッダー右上「商談化済」が消える挙動 (R1 L5 と同じ、未対応)

`conversation-view.tsx:121` で `lead.state !== "MEETING"` の時だけ MeetingForm を出す → 商談化済の lead を開いたときヘッダーから「商談化」ボタンが消える。
代わりに右ペインの CRM 状態セクションに「商談化済」バッジが出るが、ヘッダー高さの構造が左右で変わる微妙な体験。`disabled` + tooltip「既に商談化済」がより親切。

### L3. Optimistic message の id 置換が依然として無い (R1 L8 から残存)

`handleConfirmed` で `__status: sent` に更新するのみで `id` は `temp-*` のまま。`detail.messages` revalidate 同期で `useEffect [detail.messages]` 内の `setMessages(detail.messages)` で `__status` ごと丸ごと差し替えされる → 一瞬「temp-* と server id の二重表示」可能性。

`handleConfirmed` 時に server returned `messageId` で `temp-*` → server id 置換するか、`detail.messages` 同期側で「temp-* 全部捨てる」「server id とマージ」を行う。

### L4. 「採用しない」ボタンの位置が AI Panel 左下、「根拠を見る」が右下で **対角配置**

`composer.tsx:221-242` の最下段 flex-row-between で配置されているが、設計書 §9.2 のワイヤー (3 操作を横並び) と比較すると微妙にレイアウトが違う。視線移動的には許容範囲だが、「3 操作の cardinality (集合) が同列」を強調するなら 3 つを横並びにする手もある。

### L5. ConversationMessage の `__status` プロパティ名が `__` prefix

`conversation-view.tsx:30` の `OptimisticMessage = ConversationMessage & { __status?: BubbleStatus }` の prefix `__` は Python convention で意図は伝わるが、TypeScript 慣習では `_status` / `optimisticStatus` のような明示的名が一般的。意図 (server 由来でない attr であることのマーク) が読みづらい命名。

---

## 90+ 判定: **PASS (91/100)**

| 判定基準 | 結果 |
| --- | --- |
| 残存 HIGH = 0 | ✅ (H1 解消) |
| NEW HIGH = 0 | ✅ |
| 総合スコア ≥ 90 | ✅ (91/100) |
| 設計書 §9.2 必須 3 操作 | ✅ 形式要件達成 (採用しない実装、根拠を見るは Phase2 明記) |
| a11y 重大欠陥 (XSS/フォーカストラップ不在) | ⚠️ window.confirm のみ残存 (Phase2) |

**結論**: 90+ PASS。R1 で指摘した HIGH を 30 分以内コストで解消し、ボーナスで MEDIUM 4 件 + LOW 関連 (DLP 共通化 / ResultPing 削除 / formActionRef useEffect 化 / safeExternalUrl) まで取りに行った PR。残った M1/M2/M3/M5 を Phase2 Issue に切り出せば設計書整合 18 → 20 まで上がり、次フェーズで 95+ も射程に入る。

特に **`safeExternalUrl` の追加**は今回 R1 では LOW 扱いだったが、b2b SaaS としての data hygiene + セキュリティ層の両得で、デザイナー視点でも好印象。

---

## 維持・継続したい R2 の好実装

- `lib/dlp.ts` の独立化 — UI hint と Server 確定検査の drift を仕組み的に防げる
- `safeExternalUrl` の `new URL` ホワイトリスト方式 — 文字列マッチではなくパース結果を信頼する設計
- `OptimisticMessage.__status` の `sending → sent / failed` 切替 + `tempIdRef` 同期 — 失敗バブルが残り続ける UX 穴を塞ぐ
- 「LinkedIn URL が不正です」を silent に隠さず Muted で明示 — 運用担当者の data hygiene 意識を高める
- `formActionRef` の `useEffect` 経由化 — render 中の ref 書き込み回避で React Strict Mode / hydration 一貫性向上
- AI 採用しないボタンの `aria-label="AI 案を採用しない (フォームを空にする)"` 補足 — 動作の副作用まで a11y で開示

---

## 参考: R3 不要、ただし Phase2 必達リスト

- M1: window.confirm → Radix Dialog (focus trap / aria-modal / Cmd+Z)
- M2: 商談化フォーム (Calendly URL + note + Deal preview)
- M3: IME `compositionend` + Cmd+Enter ショートカット
- M5: AI 案長文の「もっと見る」 Popover
- L1: 「採用しない」の破壊的副作用回避 (AI 採用済時だけクリア)
- L3: Optimistic message id の server id 置換

これらは Phase2 マイルストーンに割り当てて Issue 化することを推奨。
