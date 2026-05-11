# S09 受信箱 — Designer Review (r1)

- 対象: `app/(app)/inbox/page.tsx`, `components/inbox/inbox-filter-tabs.tsx`, `components/inbox/inbox-thread-list.tsx`, `server/queries/inbox.ts`
- 設計書: `docs/ui-ux/UI_UX_Design.md` v1.3 §6.11.4 / §25.3
- レビュー観点: UX / ビジュアル / API DX / a11y / 日本語B2Bトーン
- 判定基準: 90+ で PASS

---

## 総合スコア

**合計: 91 / 100 → PASS (BORDERLINE)**

| 軸 | スコア | 重み | コメント要約 |
|----|------:|------|--------------|
| 1. ビジュアル (Refined Hydro Minimalism) | 18 / 20 | 20% | 水色グラデ・左赤バー・Lucide徹底。Owner 行が右寄せで Brand 名と混ざりやすい点だけ MEDIUM |
| 2. 設計書整合 (§6.11.4 / §25.3) | 18 / 20 | 20% | SLA超過セクション分離 / フィルタタブ / キャンペーン+担当列は完備。設計書記載の `J/K` `G then I` キーボードと「スコア」「保存ビュー」が未実装で −2 |
| 3. インタラクション (URL同期/debounce/遷移) | 19 / 20 | 20% | filter/q の URL 同期、350ms debounce、Link 遷移、`/inbox?q=...` シリアライズ全て妥当。SR告知欠如のみ MEDIUM |
| 4. a11y (tablist / listitem / SLA三重表現) | 17 / 20 | 20% | tablist/tab + ul/li + 視覚+icon+text の三重表現はある。`aria-controls` / `aria-current` / 検索結果 `aria-live` 欠落で −3 |
| 5. 日本語 B2B トーン (敬体 / 絵文字なし / §25.3) | 19 / 20 | 20% | 敬体統一、絵文字ゼロ、§25.3 を明示参照。「NEW」「DEMO」のラベル語のみ MEDIUM |

---

## 軸別詳細

### 1. ビジュアル (18 / 20)

良い点
- フィルタタブの active 状態に `linear-gradient(180deg, rgba(186,230,253,.55), rgba(240,249,255,.7))` + `brand-200` border は Refined Hydro Minimalism の "水のグラデ" を正しく踏襲。
- SLA 超過行の左 3px 赤バー (`absolute inset-y-0 left-0 w-[3px] bg-danger-500`) は設計書ワイヤーフレームの「赤フラグ」を立体感を抑えつつ的確に表現。
- アイコンは全て Lucide (`AlertOctagon`, `AlertTriangle`, `ArrowDownLeft`, `ArrowUpRight`, `MessageSquare`, `MessagesSquare`, `ChevronRight`, `Search`, `X`) で統一済み。絵文字ゼロ。
- inbound/outbound のミニ円バッジ (`size-5 rounded-full border`) は CRM 系インボックスとして直感的。
- `card-solid` + `divide-y divide-ink-100` の薄罫リストは白基調ミニマルに合致。

MEDIUM
- `inbox-thread-list.tsx:118` の grid `1.5fr_120px_minmax(180px,2.4fr)_120px_24px` は `md:` 同値で実質ブレイクポイント分岐していない。狭幅 (~768〜960px) でキャンペーン名+担当者が右寄せに潰れる懸念。`lg:` で 5 列、それ未満は 3 列にすると視認性が上がる。
- `lastDirection` のミニ円バッジは inbound/outbound が同径同テイストで、色 (brand vs ink-200) のみで識別される。色弱でも見分くつくが、`title` 属性 (`受信` / `送信`) があるとマウスオーバ可読性が上がる。

LOW
- "新着順" / "通常" の見出しが `tracking-[0.18em] uppercase` で全部英大文字風になっているが、日本語ラベルに字間 0.18em は若干広い。`0.12em` 程度が日本語 caps の読み心地として標準。

### 2. 設計書整合 (18 / 20)

良い点
- 設計書 §6.11.4 のワイヤー「未対応 SLA 超過 (赤フラグ) N 件」「通常 (新着順)」のセクション分離をそのまま実装 (`inbox-thread-list.tsx:38-52`)。
- フィルタタブ: 設計書「未読 / 要レビュー / 商談化」は揃っている。"すべて" を追加して 4 タブ化したのは UX 改善として妥当。
- 各行に「state / キャンペーン / 担当 / 最終アクション (相対時間)」が揃っており、設計書「各行のスコア / 状態 / 担当 / 最終アクションを表示」を満たす。
- §25.3 への明示参照 (`SLA: 一次応答 2 時間 (営業時間内) · 設計書 §25.3`) を header 直下に置いている。社内 B2B SaaS で SLA 根拠を画面上に出すのはアカウンタビリティとして◎。
- ABAC: Operator/Manager の権限差は `orgId` ベースで分離されており、設計書「Operator は担当分のみ、Manager 以上は全件」の素地は `server/queries/inbox.ts` 側で対応可能。

HIGH (-2)
- **設計書 §6.11.4 仕様「⌨ `J/K` で前後、`G then I` で受信箱、検索 `⌘K`」が未実装**。受信箱のヘビーユーザ (営業) は必須機能として記述されており、機能としては HIGH。ただし MVP S09 r1 のスコープ次第なので blocker ではない。フォロー実装チケットを必ず切ること。
- 設計書「各行の**スコア**」が表示されていない。`InboxThread.score` データは渡っているがレンダリングなし。設計書のワイヤー優先順位ではキャンペーン名・担当のほうが上だが、スコアが完全に消えるのは仕様逸脱。

MEDIUM
- 設計書「[+保存ビュー]」「並び替え: 新着 / 未対応SLA超過 / スコア順」未実装。SLA超過を自動でセクション分離している現状で順序プルダウンが必要かは議論あり。ただし保存ビューは S09 v2 で再検討必須。
- "未読" タブが内部的に `REPLIED + MEETING` 状態のことを指しており、ユーザの「未読 = まだ自分が読んでいない」直感とは違うラベリング。`unread` ではなく `要対応` 等の方が誤認しにくい。

LOW
- 設計書では `タグ`, `担当者` がフィルタ次元として挙がっているが、現状はステータス由来 3 タブのみ。MVP として許容。

### 3. インタラクション (19 / 20)

良い点
- フィルタタブ click → `router.push` で URL 同期 (`inbox-filter-tabs.tsx:32-38`)。`page` を必ず `delete` して 1 ページ目に戻すのは正しい挙動。
- 検索 350ms debounce + `useEffect` の cleanup で前回タイマー解除 (`inbox-filter-tabs.tsx:40-50`)。再入力で query が連発しない設計で◎。
- URL の `q`/`filter` 同期で深いリンク / ブラウザ戻る・進むに耐える。
- 検索ボックスのクリア (×) ボタン、空のとき非表示、押下で即 `setQ("")` → debounce 経由で URL から `q` を消す動作はストレスがない。
- スレッド行は `<Link href="/inbox/:id">` で SSR friendly、middle-click でタブ開きが可能。SPA 内 push なので Next.js prefetch も効く。
- 状態カウンタ (`counts.all` etc.) は同一クエリで返却される (`server/queries/inbox.ts:131-141`)。N+1 や追加 RTT が不要で UX 的に高速。

MEDIUM
- 検索結果件数の変化が SR (スクリーンリーダ) に伝わらない。`Header` の subtitle (`${total} 件の会話`) は更新されるが `aria-live` が付いていない。視覚ユーザは subtitle で気づくが SR 利用者は変化を察知できない。
- フォーカス可視: フィルタタブの button に `:focus-visible` のリングが宣言されていない (`focus-visible:ring-2` 等)。ブラウザ既定のフォーカスリングは効くが、`focus:outline-none` が `<Input>` 側にもしあれば確認したい。

LOW
- スレッド行をホバすると `bg-brand-50/60` に変わるが、フォーカスリング (`focus-visible:ring`) は `<Link>` に明示されていない。キーボード Tab で行を辿る時の視認性が落ちる可能性。

### 4. a11y (17 / 20)

良い点
- `nav role="tablist" aria-label="受信箱フィルタ"` + 各 button `role="tab"` `aria-selected={active}` は WAI-ARIA タブパターンの基本を踏襲。
- 検索 input に `aria-label="受信箱を検索"`、クリアボタンに `aria-label="検索をクリア"`、装飾アイコンには `aria-hidden`。アイコンと意味は分離されている。
- SLA 超過の三重表現は概ね達成: (a) 行背景 `danger-50/30`, 左赤バー、(b) `AlertTriangle` アイコン、(c) "SLA 超過" テキスト + セクション見出し "未対応 SLA 超過" + Header subtitle "未対応 SLA 超過あり"。色覚多様性に配慮済み。
- DEMO バナーは `role="status"`、degraded バナーは `role="alert"`。ライブリージョン使い分けが正確。
- `EmptyState` は `MessageSquare` icon + 説明文 + CTA で 3 重に空状態を提示。

HIGH (-2)
- **`role="tab"` button に `aria-controls`(対応する tabpanel の id)も対応する `role="tabpanel"` も無い**。完全な WAI-ARIA tabs パターンを名乗るには、スレッドリスト側に `role="tabpanel"` + `id` + `aria-labelledby` を付与すべき。または、これは単なるフィルタ群なので `role="tablist"` を **やめる** という選択肢もある。"tablist にするなら tabpanel まで揃える、揃えないなら nav に role を付けない" のどちらかを選ぶ必要がある。MEDIUM〜HIGH。
- **active タブが `aria-selected` のみで `aria-current="page"` 相当の見出し連動が無い**。SR は active を区別できるが、URL 同期視点では `aria-current` のほうが直感的なケースもある (tabパターンを採るなら aria-selected で正)。これは矛盾しないが、tabpanel が無い問題と合わせると HIGH。

MEDIUM (-1)
- スレッドリストの `<ul>` 自体には `aria-label` が無い。「未対応 SLA 超過 3 件」のセクション見出しがあるため致命ではないが、`<ul aria-labelledby="...">` で見出しと紐付けると SR navigation が改善する。
- 検索結果件数の変化通知 (上の §3 と同じ)。

LOW
- "NEW" バッジ (`inbox-thread-list.tsx:133-140`) は `aria-label="要レビュー"` が付いており SR では正しく読まれる。視覚は「NEW」だが SR は「要レビュー」と一致しないラベル分離。意図的な可能性が高いが、視覚ラベル = SR ラベル に揃える方が WCAG 2.5.3 "Label in Name" 適合性が高い。"要レビュー" バッジを視覚にも出すか、`aria-label="NEW (要レビュー)"` 等にする。

### 5. 日本語 B2B トーン (19 / 20)

良い点
- 全テキスト敬体統一 (「サンプルの会話を表示しています」「時間をおいて再度お試しください」「フィルタを切り替えるか、しばらくお待ちください」)。
- 絵文字ゼロ徹底。設計書のワイヤーでは⚠を使っていたが、実装は Lucide アイコンに置き換えており B2B トーン規範に沿う。
- §25.3 への明示参照 (`受信箱 page.tsx:99`) は B2B SaaS の説明責任表現として強い。
- インシデント文言「サポートへの連絡時は <code>incident-xxx</code> をお伝えください」が丁寧で実務的。
- EmptyState 文言「新しい返信は自動で受信箱に届きます」は受動表現で安心感がある。
- "未対応 SLA 超過 / 受信から 2 時間を経過した返信があります" は事実ベースで責任所在を曖昧化せず◎。

MEDIUM
- フィルタタブ "未読" は日本語 B2B として直感だが、内部実装が `REPLIED + MEETING` を指しており、ラベルと実装の意味乖離がある (§2 参照)。"要対応" のほうがトーン的にも実装的にも一致。
- "NEW" だけ英大文字。他の状態 chip は日本語ラベル (`STATE_META[state].ja`) で統一されているため一貫性で気になる。「要レビュー」または「未読」バッジに置き換えるべき。

LOW
- "DEMO" バナーラベルも英大文字。B2B 文脈なら "サンプル" や "デモ表示" 等で揃えると統一感が出る。MVP として許容。

---

## 主要指摘の一覧

### HIGH (PASS 条件は満たすが次イテレーションで解消推奨)

1. **設計書 §6.11.4 キーボードショートカット (`J/K`, `G then I`, `⌘K`) 未実装** — 受信箱ヘビーユーザ向け仕様、明示的に欠落。S09 r2 or 別チケットでフォロー。
2. **WAI-ARIA tabs パターンが不完全** — `role="tab"` に `aria-controls` も `role="tabpanel"` も無い。完全に揃えるか、`role="tablist"` を撤回して `<nav aria-label="...">` のままにするか、どちらかへ統一。
3. **設計書記載の "各行のスコア" 表示が欠落** — `InboxThread.score` は API 上は返るがレンダリングされていない。狭幅レイアウトでも視認できる位置 (例: 名前横にミニ chip) で表示。

### MEDIUM (次イテレーションで対処)

4. 検索結果件数変化が `aria-live` で SR に伝わらない。Header の subtitle に `aria-live="polite"` を付ける。
5. フィルタタブ "未読" のラベルと実装の意味乖離 (`REPLIED+MEETING` を unread と呼ぶ)。"要対応" に rename を検討。
6. 設計書「保存ビュー」「並び替え (新着/SLA超過/スコア順)」未実装。
7. 狭幅 (~960px) でキャンペーン名+担当者の右寄せが潰れる。grid を `lg:` で 5 列、それ未満で 3 列にブレークするか、ロウシュリンク幅を再調整。
8. "NEW" バッジが英大文字で他の chip と一貫性なし。日本語ラベル化または `aria-label` を視覚ラベルと一致させる (WCAG 2.5.3)。
9. `<ul>` に `aria-labelledby` が無く SR 文脈リンクが弱い。

### LOW (任意)

10. inbound/outbound ミニ円バッジに `title="受信"/"送信"` を付与。
11. セクション見出しの `tracking-[0.18em]` を日本語向けに `0.12em` 程度へ。
12. スレッド行 `<Link>` に `focus-visible:ring` を明示。
13. "DEMO" を "サンプル" or "デモ表示" に和文化。

---

## 質問 / 確認事項 (Open Questions)

- Q1: 設計書 §6.11.4 のキーボードショートカット (`J/K`, `G then I`, `⌘K`) は MVP S09 スコープ内か、別 PR で扱うか。PM/CTO の確認が必要。
- Q2: "未読" タブのラベル変更 (→ "要対応") は backward-compatible か (URL `?filter=unread` を変える場合は redirect か)。
- Q3: スコア表示位置は名前横 / 状態 chip 横 / 担当列の上 のどれが意匠的に望ましいか (PM と相談)。

---

## 判定

**PASS (91/100) — BORDERLINE**

理由:
- 視覚・トーン・URL 同期・SLA 三重表現はいずれも 90+ レンジ。
- a11y は role="tablist" の不完全さで −3 だが、最低限のキーボード操作と SR 認識は確保されている。
- HIGH 指摘 3 件はいずれも MVP リリース blocker ではなく、機能追加 (キーボード, スコア表示) または ARIA 形式整備で対処可能。

次イテレーション (r2) で HIGH 3 件のうち 2 件以上を解消すれば 93+ レンジに乗る見込み。

---

## 参照ファイル (絶対パス)

- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\app\(app)\inbox\page.tsx`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\components\inbox\inbox-filter-tabs.tsx`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\components\inbox\inbox-thread-list.tsx`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\server\queries\inbox.ts`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\components\ui\state-chip.tsx`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\docs\ui-ux\UI_UX_Design.md` (§6.11.4 line 838, §25.3 line 1861)
