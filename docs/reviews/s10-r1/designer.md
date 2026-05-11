# S10 会話画面 デザイナーレビュー (r1)

**対象**: `app/(app)/inbox/[leadId]/page.tsx`, `components/inbox/conversation-view.tsx`, `components/inbox/composer.tsx`, `components/inbox/message-bubble.tsx`, `server/queries/conversation.ts`, `server/actions/conversation.ts`
**設計書**: `docs/ui-ux/UI_UX_Design.md` v1.3 §6.4
**評価者**: designer-agent
**Date**: 2026-05-11

---

## 総合スコア: **84 / 100** — 判定: **NEAR** (90+ には未達、HIGH を 1 件解消すれば到達可能)

| 軸 | スコア | 主要所見 |
| --- | ---:| --- |
| 1. ビジュアル (吹き出し / AI 3 案 / 5 秒キュー / 配信 4 段階) | **18 / 20** | 吹き出しのグラデ・配信 4 段階・Undo バーの可視性は秀逸。AI 3 案カードは `line-clamp-4` で長文が切れた際の全文表示動線が無い |
| 2. 設計書整合 (確認モーダル + 5s Undo / AI 3 案 + 編集/採用しない/根拠 / DLP / 商談化) | **15 / 20** | 「採用しない」アクションが UI に存在せず、AI 出力の必須 3 操作 (§9.2) を満たさない。「根拠を見る」も `disabled` で Phase2 送り |
| 3. インタラクション (キュー / Optimistic / 商談化 / IME) | **17 / 20** | Optimistic 吹き出しは丁寧。一方 IME の `compositionend` ハンドリングは textarea に Enter ハンドラ自体が無いため未実装。商談化が `window.confirm` のみで設計書 §6.4 の「右ペインで Calendly URL の貼付ガイド + Deal プレビュー」を満たしていない |
| 4. a11y (role=dialog/status/alert, aria-live, focus, 三重表現) | **15 / 20** | Toast / Undo / Result の role 設計は良好。`window.confirm` はネイティブダイアログで role=dialog やフォーカストラップを担保できない。Undo バーに残り秒数の aria-live polite はあるが、200ms 間隔で更新されるため screen reader が読み上げ過多になる |
| 5. 日本語 B2B トーン | **19 / 20** | 「ご返信ありがとうございます」「ご状況に合わせて」など丁寧度が安定。Draft C の「25 分ほどお時間頂戴できますでしょうか」も自然。減点は「取り消す」と「キャンセル」の表記揺れのみ |

---

## HIGH (90+ ブロッカー)

### H1. AI ドラフト「採用しない」「根拠を見る」が存在しない (設計書 §9.2 必須 3 操作違反)

**該当**: `components/inbox/composer.tsx:189-228`

設計書 §9.2 は **すべての AI 出力** に `[編集して送信]` `[この案は使わない]` `[根拠を見る]` の 3 操作を必須としている。

```
すべての AI 出力に次の 3 操作が並ぶ:
[編集して送信]   [この案は使わない]   [根拠を見る]
```

現状の実装:
- 「編集して使う」 ... カード全体クリックで採用 (OK)
- 「採用しない」 ... **存在しない** (案 A を選んで気が変わっても、案 B/C を上書き or 手動クリアしかない)
- 「根拠を見る」 ... `disabled` で Phase2 送り (`title="Phase2 で実装予定"`)

設計書 §3「AI is a Draft, not a Decision」の根幹に関わる要件なので **MVP で「採用しない」だけは少なくとも実装すべき**。具体策:

1. 各 Draft カードに hover 時の 右上 × ボタン (`この案を非表示`) を出し、`dismissedKeys` state でカード非表示にする
2. もしくは textarea にコピーした後の「下書きをクリア」ボタンを `aria-label="この AI 案は使わない"` で配置

「根拠を見る」も Phase2 で良いが、ボタンが `disabled` だと **設計書必須要件を満たしていないように見える**。「(Phase2)」とラベルを付けて存在自体は見せる、もしくは設計書側に Phase2 と明記する PR を併走させる必要がある。

**修正コスト**: 30 分 (「採用しない」UI 追加のみで HIGH 解消可)

---

## MEDIUM

### M1. 確認モーダルが `window.confirm` ネイティブで設計書 §6.4 違反

**該当**: `components/inbox/composer.tsx:140`, `conversation-view.tsx:242`

設計書 §6.4:
> 送信ボタンは **2 段階**: クリック→**確認モーダル**（送信先・本文・参照ナレッジを再確認）→確定で 5 秒キュー Undo

`window.confirm` では以下が満たせない:

- role=dialog / aria-modal=true / フォーカストラップ (設計書 §7 Modal の「フォーカス制御」)
- 本文プレビュー (`slice(0, 200)` の生文字列のみ、改行・装飾無し)
- 参照ナレッジの再確認 UI
- Esc / Cmd+Z 対応 (§6.4 で明記)
- ブラウザによってボタン順 (Cancel/OK) が逆になり B2B 信頼性が落ちる

加えて、Storybook / Playwright での E2E テストが事実上不可能になる (`window.confirm` は jsdom で `undefined`)。

**修正**: Radix UI の `Dialog` か自前モーダルへ差し替え。送信モーダルは「宛先カード + 本文 (preserveWhitespace) + ナレッジ参照 placeholder + [送信 / キャンセル]」の構成にする。

### M2. 商談化が `window.confirm` で右ペイン展開が無い (設計書 §6.4)

**該当**: `conversation-view.tsx:240-254`

設計書 §6.4:
> 「商談化」を押すと右ペインで Calendly URL の貼付ガイド + CRM Deal 作成プレビュー

現状は `window.confirm("このリードを商談化として記録します。よろしいですか？")` で即 `markAsMeeting` 発火。右ペインは「未連携 (Phase2)」と表示するのみで、

- Calendly URL の貼付フィールドが無い
- Deal 作成プレビューが無い
- `MeetingSchema` には `note` フィールドがあるのに UI から渡されない (常に空)

**修正案**:
1. ヘッダー「商談化」ボタンを押すと右ペイン上部にステップアウト UI が展開
2. Calendly URL `<input>` + note `<textarea>` + 「CRM (Phase2)」プレビュー
3. 「確定」で `markAsMeeting` 発火

少なくとも `note` を渡す textarea を 1 個生やせば、Server Action の Schema を活用できて整合性が上がる。

### M3. IME 中の Enter 送信抑止が未実装

**該当**: `components/inbox/composer.tsx:278-286`

設計書 §8.2「Form の鉄則」:
> IME（日本語入力）変換中は Enter で送信しない（イベントは `compositionend` 後）

現状の textarea には `onKeyDown` ハンドラも `onCompositionStart/End` ハンドラも無い。Enter で送信する設計でないなら placeholder の「IME 中の Enter では送信されません」は **誤情報** (そもそも Enter 単独で送信しない)。

選択肢:
- (A) Cmd/Ctrl+Enter で送信ショートカット追加 + `isComposing` で抑止する標準的な実装
- (B) Enter ショートカットを設けないなら placeholder の「IME 中の Enter では送信されません」を削除する

B2B SaaS としては (A) が一般的 (Slack/Gmail と同じ感覚)。設計書 §6.4 のキーバインド `R` 返信フォーカスとも揃う。

### M4. 配信状態が常に `delivered` / `sending` の 2 値のみ

**該当**: `conversation-view.tsx:114`, `message-bubble.tsx:71-101`

```ts
status={m.id.startsWith("temp-") ? "sending" : "delivered"}
```

`MessageBubble` は 4 状態 (`sending` / `sent` / `delivered` / `failed`) のアイコンを定義しているのに、呼び出し側は 2 状態しか使っていない。設計書 §8 ConversationBubble:

> 配信状態 4 段階: 送信中 (`Loader`) / 送信済 (`Check`) / 配信済 (`CheckCheck`) / 失敗 (`AlertCircle` + 再試行)

特に問題:
- Server Action が ok=false で戻ったとき、Optimistic に追加した `temp-*` バブルが消えず、`delivered` 扱いで残り続ける (`conversation-view.tsx` に失敗時の rollback が無い)
- `failed` の場合に必要な「再試行」ボタンも未実装

**修正**:
1. `ConversationMessage` に `status` を持たせる
2. `result.ok === false` を `useEffect` で受け、対応する `temp-*` の status を `failed` に上書き
3. `failed` バブル横に再試行 `<button>`

これは「設計書整合」と「インタラクション」両軸を引き下げている。

### M5. AI ドラフトの長文切れ後の動線が無い

**該当**: `components/inbox/composer.tsx:210`

```tsx
<p className="... line-clamp-4">{d.body}</p>
```

案 A は短いが、案 B/C は line-clamp-4 で切れる可能性がある。カードクリック = 採用なので、`...` で切れた後の全文確認手段が「採用してから textarea で読む」しかない。

**修正**: カードの右下に `... もっと見る` / `... 全文` リンクで Popover or 展開を提供。もしくは hover で aria-expanded する。

### M6. `disabled` の「根拠を見る」ボタンが a11y 違反

**該当**: `components/inbox/composer.tsx:220-227`

```tsx
<button type="button" disabled className="... cursor-not-allowed" title="Phase2 で実装予定">
```

`disabled` ボタンに `title` のみは:
- マウスユーザー: hover で tooltip 出る
- キーボードユーザー: フォーカス自体が当たらない (disabled なので)
- スクリーンリーダー: 「Phase2 で実装予定」が読まれない

**修正**: `aria-disabled="true"` + `tabIndex={0}` にして、または最初から表示しない (M1 と関連)。

---

## LOW

### L1. Undo バーの aria-live が 200ms ごとに更新され過剰アナウンス

**該当**: `components/inbox/composer.tsx:244-264`

`role="status" aria-live="polite"` の中に「{secondsLeft} 秒後に送信されます」を入れているが、secondsLeft が 5→4→3→2→1→0 と 1 秒ごとに変わるたびにスクリーンリーダーが読み上げる可能性がある。

**修正**: カウントダウンの数値は `aria-hidden` で分離し、aria-live は「送信を 5 秒後に予約しました。キャンセル可」の固定文だけ読ませる。

### L2. 「キャンセル」と「取り消す」の表記揺れ

**該当**: `components/inbox/composer.tsx:256, 261`

Undo バーは「取り消す」ボタンだが、その上に「キャンセルすると下書きはフォームに戻ります」と書かれている。日本語 B2B トーンとしては **どちらかに統一** (推奨: 「取り消す」)。

### L3. 「送信する」/「送信」の表記揺れ

`Button` 文言が「送信する」(composer.tsx:304)。設計書 §6.4 のワイヤーは「送信」。動詞型「送信する」は最近の Google IME・MS Word 系に親和しており悪くないが、INBOX 一覧側 (S09) との統一を確認すべき。

### L4. `MOCK_PREFIXES = ["l", "00000000"]` の "l" prefix がスカスカ

**該当**: `app/(app)/inbox/[leadId]/page.tsx:15`

mock id が `l1`, `l8`, `l9` の 3 件のみ。受信箱で `l2`〜`l7` をクリックすると notFound に落ちる UX。INBOX 一覧側の mock とリードリストを揃えるか、page.tsx で `l[0-9]+` 全部を許容して mockConversation 側で fallback を返すのが親切。

### L5. ヘッダーの「商談化」ボタンが state=MEETING 時に消える ≠ disabled

**該当**: `conversation-view.tsx:87-89`

```tsx
{lead.state !== "MEETING" && <MeetingForm ... />}
```

消すよりも `disabled` + tooltip「既に商談化済」が UX 的に親切。今は再開可能性 (REPLIED に戻す) や、商談化済バッジが右ペインにしか無いため、ヘッダーから「すでに商談化された」ことが分かりにくい。

### L6. Optimistic message の `aiAssisted` flag が常に最新の値

**該当**: `composer.tsx:135-145`

Undo バーが回っている間に AI ドラフトを再採用すると `aiAssisted` が変わってしまう可能性 (現状は pendingContent 中は AI Panel 非表示なので実害なし、ただしロジック観察として明記)。`pendingAiAssisted` を pendingContent と同時に snapshot しておくと安全。

### L7. mock の「(DEMO) 送信を受け付けました」が永続化されない警告と message が混在

`actions/conversation.ts:84-87` で DEMO モードのレスポンスが返るが、`conversation-view.tsx` 側の Optimistic 吹き出しは server からの確定 history で上書きされない (`revalidatePath` も DB なしでは効かない)。結果として、`temp-*` のままページがリロードされるまで吹き出しが残る。

DEMO バナー (`page.tsx:84-87`) で「送信は永続化されません」と書いてあるので致命傷ではないが、テストや SQA 視点では「送信後リロードしたら消える」体験への落差がある。

### L8. 「メッセージを送信しました」直後にも吹き出しは Optimistic のまま (id が temp-* のまま)

`composer.tsx:103` で result.ok のとき content クリアはするが、`conversation-view.tsx` 側で `temp-*` を server returned id に差し替えるロジックが無い。revalidatePath で `detail.messages` が降ってきた瞬間 `useEffect` で同期されるが、その間 `temp-*` と server id の 2 重表示が一瞬発生しうる。

**修正**: handleQueueing 側で `messageId` 返却後に temp- を server id に置換、または revalidate 同期時に temp- 全部捨てる。

---

## 評価軸別の詳細

### 1. ビジュアル (18/20)

**良い点**:
- 吹き出しのグラデ (`#38BDF8 → #0EA5E9 → #0284C7`) + 影 `0_8px_24px_-12px_rgba(14,165,233,0.55)` で B2B らしい品の良さ
- `rounded-br-md` / `rounded-bl-md` で発話方向を視覚化 (iMessage 流)
- AI 3 案カードの active 状態が border + 微グラデ + 影でフィードバック明確
- Undo バーが `linear-gradient` + brand-300 border で「目立つが派手すぎない」
- メッセージ件数の分割線 (`h-px flex-1 bg-ink-200`) が会話ログを読みやすく整理
- 配信 4 段階アイコンの色付け (`brand-600` / `danger-700`) がアクセシブル

**改善点**:
- 案 B/C カードの長文が line-clamp-4 で切れる (M5)
- Score Badge `tone="brand"` + TrendingUp が「上昇傾向」と誤読されうる (score は静的値)
- 右ペインの「未連携 (Phase2)」が灰色 Muted のみで CTA が無い (Phase2 だから OK だが、Phase1 で何をするかが見えない)

### 2. 設計書整合 (15/20)

| §6.4 / §9.2 要件 | 実装 | 評価 |
| --- | --- | --- |
| 確認モーダル | `window.confirm` | △ (M1) |
| 5 秒キュー Undo | 実装済 | ◎ |
| AI 3 案 (A/B/C) | 実装済 | ◎ |
| 編集して使う | 実装済 | ◎ |
| **採用しない** | **未実装** | × (H1) |
| **根拠を見る** | disabled placeholder | △ (H1 関連) |
| 機微情報黄色警告 | dangerHint + Server Action 検査 二重 | ◎ |
| 商談化 → Calendly + Deal preview | window.confirm のみ | × (M2) |
| 配信 4 段階 | 2 状態しか使われない | △ (M4) |
| キーボード (J/K/R/E/S) | 未実装 | △ (S10 単体スコープ外なら OK だが該当機能無し) |

### 3. インタラクション (17/20)

**良い点**:
- Optimistic 吹き出し → Undo バー → confirm 送信 → toast の流れがスムーズ
- Undo タイマーが 200ms ポーリングで 1 秒の体感ズレが少ない
- AI 採用 → textarea 反映 → `aiAssisted=true` フラグ → AuditLog に渡る一気通貫
- pendingContent 中は AI Panel と Composer を消して「もう編集できない」を視覚的に明示

**改善点**:
- IME 抑止 placeholder と実装の乖離 (M3)
- failed status の rollback が無い (M4)
- 商談化フォームの note 欄が未露出 (M2)

### 4. a11y (15/20)

**良い点**:
- Toast: success=role=status / error=role=alert で出し分け
- Undo バー: role=status + aria-live=polite
- ResultPing: 同様の出し分け
- 配信状態アイコン: `aria-label="送信中" / "送信済" / "配信済" / "送信失敗"` の三重表現 (icon + label + 色)
- `aria-hidden` を装飾 icon に一貫付与

**改善点**:
- `window.confirm` で focus trap / aria-modal が担保不能 (M1)
- `disabled` ボタンに title のみ (M6)
- Undo バー aria-live が過剰更新 (L1)
- textarea の error/warning メッセージが `role="alert"` を持つが、入力中に regex hit する度に出っぱなしになる (低負荷だが煩い可能性)
- `<form action={formAction} onSubmit={...}>` の `onSubmit` で `window.confirm` を回し preventDefault は React 19 で問題ないが、submit 後 focus が宙に浮く

### 5. 日本語 B2B トーン (19/20)

**良い点**:
- Draft A/B/C の文体が安定して敬体・丁寧度高い
- 「差し支えなければ」「いただけますと幸いです」「いかがでしょうか」など定型を適切利用
- エラーメッセージ「送信中に問題が発生しました」「対象のリードが見つかりません」が自責回避 + 行動指示
- DEMO バナー「(DB 未接続 / 送信は永続化されません)」が明示的でハマりにくい
- 機微情報警告「Manager 以上の承認が必要です」がスコープを明示

**改善点**:
- 「キャンセル」 vs 「取り消す」表記揺れ (L2)
- ヘッダー subtitle が `lead.name` で同じ名前がタイトルと右ペインで 3 重表示
- 「(DEMO) 商談化として記録しました」の `(DEMO)` プレフィックスは Toast 表示時に若干カジュアル。「[DEMO]」のほうが B2B 文書らしい

---

## 90+ 到達ロードマップ

| 優先 | 項目 | 期待スコア upgrade | 工数目安 |
| --- | --- | --- | --- |
| **HIGH** | H1: 「採用しない」ボタン追加 + 「根拠を見る」visible 化 | +3 (15→18 設計書整合) | 30 分 |
| **MED** | M1: window.confirm → カスタムモーダル | +2 (a11y + 設計書整合) | 1.5h |
| **MED** | M2: 商談化フォーム (note + Calendly placeholder) | +2 (設計書整合 + UX) | 1h |
| **MED** | M3: IME `compositionend` + Cmd+Enter | +1 (インタラクション) | 30 分 |
| **MED** | M4: failed status rollback + 再試行 | +2 (ビジュアル + インタラクション) | 45 分 |

HIGH 解消だけで **84 → 87**、MED 2-3 個追加で **90+ PASS** 圏。

---

## 判定: **NEAR (84/100)**

設計書 §9.2 必須 3 操作違反の **H1 が唯一の真のブロッカー**。AI ドラフトの「採用しない」を最低限実装すれば 87 まで上がり、MED から 2 件 (M1 モーダル + M2 商談化) を追加すれば 90+ PASS が確実。

ビジュアル品質と日本語トーンは設計書水準に達しているため、設計書整合性の隙間を埋める作業を r2 で集中対応すれば 90+ は射程圏内。

---

## 参考: 良かった実装 (継続維持)

- **Optimistic + Undo の同期設計**: pendingContent 中は AI Panel/Composer を非表示にし、ユーザーが「もう編集できない」を一目で理解できる
- **DLP の二重検査** (`composer.tsx:164-169` の UI 事前ヒント + `actions/conversation.ts:28-32` の Server 確定検査)
- **Toast の role 出し分け** (success=status / error=alert)
- **配信状態 4 段階アイコンの aria-label 三重表現**
- **`status` icon の `aria-label` + 色 + 形状の三重符号化**
- **Server Action の audit ログ統合トランザクション** (`actions/conversation.ts:90-133`)
