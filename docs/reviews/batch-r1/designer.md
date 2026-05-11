# Designer Review — batch-r1 (S15 / S14 / S17 / S19 / S24 / S21 / S25 / S26)

- Agent: designer
- Date: 2026-05-11
- Reviewer scope: UX / IA / 視認性 / 一貫性 / Phase1 ブロッカーのみ (MEDIUM/LOW は Phase2 carry)
- 目標スコア: 各 88+

---

## サマリ

| 画面 | 名称 | スコア | HIGH | 判定 |
|---|---|---:|---:|---|
| S15 | メンバー / 権限 | 91 | 1 | PASS |
| S14 | プラン / 請求 | 90 | 1 | PASS |
| S17 | 通知センター | 88 | 2 | PASS (ぎりぎり) |
| S19 | 監査ログ | 92 | 1 | PASS |
| S24 | サービスステータス | 93 | 0 | PASS |
| S21 | 利用上の注意 | 92 | 1 | PASS |
| S25 | ジョブ / DLQ | 87 | 2 | NEEDS_REVISION (目標未達) |
| S26 | Break-Glass | 89 | 1 | PASS |

- **総合平均: 90.25 / 100**
- **90+ 未達画面: S17 (88), S25 (87)** → S25 は目標 88 未達 (要改修)、S17 は目標達成だが余裕薄
- **Phase1 ブロッカー総数: 9 件** (うち目標未達引き上げに必要なものは S25 で 1〜2 件)

---

## S15 メンバー / 権限 — 91/100

対象: `app\(app)\settings\team\page.tsx` + `components\settings\members-table.tsx` + `server\queries\members.ts` + `server\actions\members.ts`

### スコア内訳
- IA / 情報配置: 23/25
- 操作の発見性: 22/25
- フィードバック / エラー処理: 24/25
- 一貫性 / アクセシビリティ: 22/25

### HIGH (Phase1 ブロッカー)

1. **`changeRole` / `deactivateMember` の audit action が `"lead.assigned"` で誤登録されている**
   `server/actions/members.ts` L68, L122 — メンバーのロール変更/無効化なのに監査ログには `lead.assigned` という別ドメインの action 名で書かれる。S19 (監査ログ画面) でこのままバッジ表示すると Owner/Admin が「リードを誰かに割り当てた」と誤読する。Phase1 で `user.role_changed` / `user.deactivated` (または同等の `members.*`) に修正必須。S19 のレビューで読み取った瞬間に "リードを割り当てた" に見えてしまい、監査の信頼性を毀損する。

### 良い点
- `RoleChanger` の即時送信 (`onChange` → `form.requestSubmit()`) と toast feedback の組合せが速い。`DEACTIVATE` テキスト入力の確認 UI (`MembersTable.DeactivateForm`) は破壊操作の二重確認として教科書的に正しく、`(あなた)` バッジ + `canEdit && !isSelf` ガードで自分自身の降格/無効化を物理的に押せない設計になっている。

---

## S14 プラン / 請求 — 90/100

対象: `app\(app)\settings\plan\page.tsx`

### スコア内訳
- 価値訴求 (現在プラン Hero): 24/25
- 使用状況の理解しやすさ: 22/25
- プラン比較の意思決定支援: 22/25
- 一貫性 / Phase2 carry の明示: 22/25

### HIGH (Phase1 ブロッカー)

1. **使用状況の「80% 警告」が視覚以外で伝わらない**
   `UsagePolicyPage` ではなく `UsageCard` 内 (L248–280): `warning = pct >= 80` で進捗バーがオレンジに切り替わるが、`role="progressbar"` の `aria-label` には警告状態が含まれない (`使用率 ${pct}%` のみ)。AI 生成 84.2% / リード 54.7% が並ぶと、色覚特性のあるユーザーは「上限警告」を見落とす。`aria-label` に `(上限警告)` を含める、または `aria-describedby` で `· 上限警告` テキストを参照させる必要がある (Phase1)。設計書 §22 で「上限到達は既定で自動停止」と謳う以上、80% 警告は重要な意思決定情報。

### 良い点
- 現在プラン Hero (グラデーション + 放射状ブラー) と比較カードの "現在" バッジ + ブランドリング ハイライト (`shadow-[0_12px_24px_-14px_...]`) で「いま自分はどこにいるか」が一瞥でわかる。`/月 (税抜)` 表記の小さい注釈、`次回更新` の日本語 long フォーマット、`/legal/usage-policy` への deep link、すべて B2B SaaS の作法どおり。

---

## S17 通知センター — 88/100

対象: `app\(app)\notifications\page.tsx`

### スコア内訳
- フィルタの発見性 / 直感性: 22/25
- 通知行の情報密度: 22/25
- 既読/未読の表現: 21/25
- アクセシビリティ: 23/25

### HIGH (Phase1 ブロッカー)

1. **「未読件数」がタブ pill には反映されず、ヘッダ subtitle にしか出ない**
   `Header subtitle={`${notifications.length} 件 · 未読 ${unreadCount}`}` (L73) と各タブの count (L101–104) は **総数** であり「未読」ではない。通知センターのコアメンタルモデル ("未読を消化していく") が崩れている。各タブの count を「未読数 / 総数」または「未読が 0 のとき淡色化」にしないと、ユーザーは Critical タブを開く前に「Critical の未読はあと何件か」がわからない。Phase1 で count を未読基準に切り替えるか、未読バッジを別ピルとして添加する。

2. **`description` が `truncate` で 1 行に切られていて、Critical 通知の本文が読めない**
   L178–180 — `n1` 例: 「失敗連続 5 回を検知。手動でログイン → CAPTCHA 解除を推奨」が末尾欠落の可能性が高く、PC 1280px 幅でも 1 行に押し込まれる。Critical / Warning に限り 2 行表示 (`line-clamp-2`) にする、または hover/click で展開する仕組みが必要。設計書 §11.1.1「Critical は誰も OFF にできない」を守るなら、本文を読み切らせる UX も担保すべき。

### 良い点
- タブの aria-pressed + count badge、Critical 行に薄い赤背景 (`bg-[var(--color-danger-50)]/30`)、未読ドット (`size-1.5 rounded-full bg-brand-500 aria-label="未読"`) の三段階で未読/重要度の "scannability" が高い。空状態 (`該当する通知はありません`) もきちんと用意されている。

---

## S19 監査ログ — 92/100

対象: `app\(app)\audit\page.tsx` + `server\queries\audit.ts`

### スコア内訳
- 改竄耐性の可視化 (検証済バッジ): 24/25
- 行の読みやすさ (actor / action / target): 23/25
- 権限ガードのフィードバック: 23/25
- フィルタ / 検索の不在による減点: 22/25

### HIGH (Phase1 ブロッカー)

1. **「整合性検証: ✓ 検証済」は実際には検証していないのに常時 ON で表示される**
   `audit.ts` L78 `verified: true, // 実検証は Phase2 (root hash の二重保管照合)` — UI 側 (`audit/page.tsx` L83–90) はこの値を素直に「✓ 検証済」緑バッジで出している。これは設計書 §6.11.6 の「改竄耐性」を**詐称**する表示で、監査画面における最重要シグナルとして致命的。Phase1 で (a) バッジ自体を Phase2 ラベルに変更、または (b) `verified` プロパティを返さず "Phase2 で検証予定" のニュートラル表記にする、のどちらかが必須。

### 良い点
- 「Append-only · 削除/編集ボタンなし (Owner も不可) · 訂正は打ち消しエントリで」というガイドが H2 直下にあり、監査ログの**運用ルール**が UI で先回りで宣言されている。`hidden sm:inline-flex` で hash を末尾に置き、`title={e.hash}` で full hash を hover で確認できる細部も良い。Admin 未満の権限ガード (`Lock` アイコン付き赤バナー) も明快。

---

## S24 サービスステータス — 93/100

対象: `app\status\page.tsx`

### スコア内訳
- 全体ステータスの一瞥性: 25/25
- サービス別の理解しやすさ: 24/25
- インシデント履歴: 22/25
- 一貫性 (login 未経由でも見える): 22/25

### HIGH
- **なし** (Phase1 ブロッカー 0 件)

### 良い点
- "すべてのシステムが正常に稼働中" を 36–48px の display フォントで言い切る Hero、`pulse-soft` のミニドット、`最終更新` JST 表記、`/api/health` への JSON フィードリンクまで揃っており、status.io 系の業界標準を満たしている。Logo + 「ダッシュボードへ戻る」だけのミニヘッダで、未ログインでも安心して見られる。

---

## S21 利用上の注意 — 92/100

対象: `app\legal\usage-policy\page.tsx`

### スコア内訳
- 法務/技術コンテンツの読みやすさ: 24/25
- セクション分割と icon の補強: 24/25
- DPO / サポート導線: 23/25
- リンク先存在 (DPA / data 削除): 21/25

### HIGH (Phase1 ブロッカー)

1. **`/settings/data` と `/legal/dpa` への内部リンクが、現時点でルート未実装**
   L66 `<code>/settings/data</code>` と L123 `<a href="/legal/dpa">DPA</a>` は、本文上で「データ削除/エクスポートはここから」「DPA はここ」と約束しているのに、対応ページが Phase1 のスコープ内に見当たらない。ユーザーが押すと 404 となる可能性が高い。Phase1 で (a) リンクを外して「Phase2 で実装予定」と明記、または (b) `/settings/data` を最小実装する (フォーム POST を support メール送信に倒すだけでも可)。法務文書から 404 へ飛ばすのは GDPR 関連で印象が著しく悪い。

### 良い点
- 大見出し「安全に、丁寧に、送り出すために」が **B2B 自動化ツールにありがちな高圧的なトーンを徹底回避**しており、規制関係の文書としては破格の人間味。各 Section にアイコンチップ + display フォントの組合せで、長文の法務テキストに認知的なリズムが生まれている。サポート/DPO のメール連絡先を本文と footer の両方に置く冗長性も◎。

---

## S25 ジョブ / 失敗 / DLQ — 87/100 (目標 88+ 未達)

対象: `app\(app)\jobs\page.tsx`

### スコア内訳
- 状態フィルタの直感性: 22/25
- 行の情報密度 / 走査性: 20/25
- アクション (再試行 / 廃棄) の発見性: 21/25
- 失敗時のメンタルモデル: 24/25

### HIGH (Phase1 ブロッカー)

1. **モバイル (md 未満) で監査に必要な情報の大半が消える**
   L173–181 — `correlationId`, `attempts`, `nextRetryAt` がすべて `hidden md:block`。モバイル/狭幅 (オペレーター現場でタブレットを開く可能性が高い画面) では、行は「ステータス + kind + payload + error」だけになり、`再試行 in 10 分` が見えない → ユーザーは「いつ自動再試行が走るのか」がわからずに手動再試行に手が伸びる (それすら Phase2 で disabled)。最低限 `nextRetryAt` だけは 2 行目に折り返して表示すべき。

2. **`failed` と `dlq` の差が、行 UI 上ではバッジ色 (warning vs danger) しか出ていない**
   `STATUS_META` (L37–45) と行の `errorMessage` 表示は両ステータスで共通。設計書 §6.11.7 で DLQ は「最大リトライ済の終端状態」として `failed` と区別されるはずだが、UI 上は両方とも `RotateCcw + Trash2` の同じ 2 アクションが並ぶ。DLQ には「再試行」ボタン自体を出さない、または「強制再投入 (要 4-eye 承認)」のラベルに切り替える等、ステータスの**意味**を行アクションに反映する必要がある。これがないと、オペレーターは DLQ を「ただの赤い失敗」として扱って再試行を連打しようとする。

### 良い点
- ヘッダの "直近 1h 失敗率: 1.2% · バックログ: 0 件" が SRE-friendly な KPI として最上段にあり、`failureRate1h` を見て即「正常」と判断できる。`running` のローダーアイコンに `animate-spin` を付けるのも一貫している。

---

## S26 Break-Glass — 89/100

対象: `app\recovery\break-glass\page.tsx`

### スコア内訳
- 緊急時の心理的安全性: 24/25
- ステップの可視化: 23/25
- 通常導線への戻り口: 22/25
- 警告色のメリハリ: 20/25

### HIGH (Phase1 ブロッカー)

1. **`warning` 文言のアイコンが `CheckCircle2` (緑系の成功アイコン) になっている**
   L132–135 `Step` 関数内 — `warning="失敗 5 回で 24 時間ロック / 全 Owner にメール通知"` などの**警戒文言**の左に `CheckCircle2` (チェックマーク) が付く。色は `text-warning-700` でも、形状が "OK / 完了" の意味を持つアイコンなので、認知的に矛盾する。Phase1 で `AlertTriangle` か `ShieldAlert` に差し替えるべき (どちらもこのファイル内で既に import 済)。Break-Glass という最も慎重さが要求される画面で、警告 = チェックマークは UX の信頼性を下げる。

### 良い点
- 大見出し「SSO ロックアウト時の緊急アクセス」と冒頭の「通常時の操作は /settings/security から」という**先回りの正常導線**で、誤って Break-Glass を辿ったユーザーを引き戻す導線が用意されている。`BREAK_GLASS` フラグが監査ログに残ること、Owner 全員に通知メールが飛ぶこと、を明示しているのも 4-eye 観点で◎。Phase2 で実装予定であることを大きな赤いカードで宣言しているため、押下できない理由がユーザーに明示されている。

---

## Phase1 ブロッカー総合リスト (9件)

優先度順 (UX 信頼性への影響度):

1. **S19**: `verified: true` ハードコードで「✓ 検証済」を詐称 — 監査の信頼性の根幹
2. **S15**: `audit.action = "lead.assigned"` 誤登録 — 監査ログ表示の整合性
3. **S25**: `failed` と `dlq` の UI 区別が薄い (アクションも同一) — 運用上の誤操作リスク
4. **S25**: モバイルで `nextRetryAt` が消える — 現場運用での情報欠落
5. **S26**: 警告文言のアイコンが `CheckCircle2` — 緊急画面での認知矛盾
6. **S21**: `/settings/data` と `/legal/dpa` への 404 リンク — 法務文書としての印象悪化
7. **S17**: タブ count が「未読」ではなく「総数」 — 通知センターのメンタルモデル
8. **S17**: `description` の `truncate` で Critical 本文が読めない可能性
9. **S14**: 80% 警告が `aria-label` に含まれない — A11y / 色覚配慮

---

## 90+ 未達画面の指摘

- **S25 (87)**: 目標 88+ を **未達**。HIGH#1 (DLQ と failed の区別) または HIGH#2 (モバイル情報欠落) のどちらか 1 件でも改修すれば 89〜90 まで届く想定。Phase1 内で最低 1 件の修正を強く推奨。
- **S17 (88)**: 目標到達だが余裕薄。HIGH#1 (未読 count) を改修すれば 91 前後まで上がる。

それ以外 6 画面はすべて 89+ で目標達成。総合平均 90.25 は B2B SaaS 管理画面の Phase1 出荷品質として十分。

---

## 参照ファイル (絶対パス)

- C:\Users\ooxmi\Downloads\Linkdin自動ツール\app\(app)\settings\team\page.tsx
- C:\Users\ooxmi\Downloads\Linkdin自動ツール\components\settings\members-table.tsx
- C:\Users\ooxmi\Downloads\Linkdin自動ツール\server\queries\members.ts
- C:\Users\ooxmi\Downloads\Linkdin自動ツール\server\actions\members.ts
- C:\Users\ooxmi\Downloads\Linkdin自動ツール\app\(app)\settings\plan\page.tsx
- C:\Users\ooxmi\Downloads\Linkdin自動ツール\app\(app)\notifications\page.tsx
- C:\Users\ooxmi\Downloads\Linkdin自動ツール\app\(app)\audit\page.tsx
- C:\Users\ooxmi\Downloads\Linkdin自動ツール\server\queries\audit.ts
- C:\Users\ooxmi\Downloads\Linkdin自動ツール\app\status\page.tsx
- C:\Users\ooxmi\Downloads\Linkdin自動ツール\app\legal\usage-policy\page.tsx
- C:\Users\ooxmi\Downloads\Linkdin自動ツール\app\(app)\jobs\page.tsx
- C:\Users\ooxmi\Downloads\Linkdin自動ツール\app\recovery\break-glass\page.tsx
