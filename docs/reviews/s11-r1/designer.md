# S11 LinkedIn 接続管理 デザイナーレビュー (r1)

**対象**:
- `app/(app)/connections/linkedin/page.tsx`
- `components/connections/account-card.tsx`
- `components/connections/connections-container.tsx`
- `server/queries/connections.ts`
- `server/actions/connections.ts`

**設計書**: `docs/ui-ux/UI_UX_Design.md` v1.3 §6.5 (S11) / §10 レート制御 & ウォームアップ / §17 セキュリティ UX・監査
**評価者**: designer-agent
**Date**: 2026-05-11

---

## 総合スコア: **92 / 100** — 判定: **PASS**

| 軸 | スコア | 主要所見 |
| --- | ---: | --- |
| 1. ビジュアル (カード / 三重ステータス / プログレス / 安全モード強調) | **19 / 20** | カードレイアウト・アバター・三重ステータス表現 (Badge tone + アイコン + 文言) が揃い、安全モード時のみカード自体を `border-[#FECACA] + bg-danger-50/30` に変質させて視覚的に "別状態" を明示。`pulse-soft` を warming Hourglass にだけ載せて時間進行を比喩する細部が良い。`shadow-[0_8px_24px_-12px_rgba(14,165,233,0.55)]` も brand 系 CTA に限定されており乱用なし |
| 2. 設計書整合 (§6.5 / §10 / §17) | **18 / 20** | Day N/14 / 14 日上限 / 失敗連続 5 回で safe_mode / DISCONNECT 文字確認 / 一時停止の理由メモ必須 / 監査ログ書込み が揃い、§6.5 本文の必須 4 要件 (段階バーと残日数の **両方**、理由メモ必須、DISCONNECT 確認、7 日復元) を全て実装。`updateDailyLimit` の理由メモ欠落と監査 action enum 不足は要修正 (後述 H1/H2) |
| 3. インタラクション (インライン編集 / 確認 / useActionState) | **19 / 20** | `mode` ステートマシン (`view → limit / pause / disconnect`) で 4 アクション全てがインライン展開、モーダル不在で文脈損失ゼロ。`useActionState` + `useFormStatus` + `reported.current` ガードによる「同一 state を二度 onResult に流さない」防御が手堅い。DISCONNECT は文字一致まで submit ボタン `disabled`、`SubmitButton` 内で `pending` スピナー + `pointer-events-none` で二重 submit を物理ブロック |
| 4. a11y | **18 / 20** | `aria-labelledby={acc-${id}}` で article をスクリーンリーダー向けに命名、`role="progressbar" + aria-valuenow/min/max`、`role="alert"` (安全モード) / `role="status"` (DEMO バナー)、toast の `aria-live="polite"` まで揃う。`size-3.5` 内のアイコンは全て `aria-hidden`。残課題は `disabled` ボタンの説明性 (title 依存)、ProgressBar の label 関連付け (H3) |
| 5. 日本語 B2B トーン | **18 / 20** | 「安全モード作動中 — 自動送信を停止しています」「クールダウン期間として 24h 停止」「7 日以内は復元可能」「実行時に押し戻されます」など、機械翻訳臭・カタカナ過多・命令調を回避した B2B 業務語彙が一貫。`接続を切る` / `一時停止する` の終止形動詞と、状態を述べる体言止めが綺麗に使い分けられている |

---

## ハイライト (good design moves)

### G1. 三重ステータス表現の徹底

`StatusBadge` は **色 (tone) + アイコン + 文言** の 3 軸全てで状態を伝える:

```tsx
// account-card.tsx:198-225
if (status === "safe_mode")   → Badge tone="danger"  + ShieldAlert + "安全モード"
if (status === "warming")     → Badge tone="warning" + Hourglass (pulse-soft) + "ウォームアップ"
if (status === "disconnected")→ Badge tone="neutral" + Unplug + "切断済"
default (active)              → Badge tone="success" + CheckCircle2 + "アクティブ"
```

色盲ユーザでもアイコン形状で識別可能、スクリーンリーダーは文言を読み上げる。設計書 §6.5 の `🟢 アクティブ / 🟡 ウォームアップ / 🔴 安全モード` の三層 emoji を、a11y 適合形式に正しく翻訳できている。

### G2. 安全モードのカード全体への汎化

```tsx
// account-card.tsx:50-55
className={cn(
  "card-solid p-5 space-y-4 transition",
  isSafeMode && "border-[#FECACA] bg-[var(--color-danger-50)]/30",
  isDisconnected && "opacity-70"
)}
```

Badge だけでなくカード境界・背景まで danger 系に変質、`opacity-70` で disconnected を半透明化 — 一覧スキャン時に「危険カードが何枚あるか」が瞬時に把握できる。`ConnectionsContainer` の sort で safe_mode を先頭に並べる挙動と合わせ、トリアージ動線が成立。

### G3. ウォームアップ "段階バー + 残日数 + 上限件数" の三点同時表示

設計書 §6.5「段階バーと残日数の **両方** 表示」を超えて、上限件数 (`安全上限 25 件/日 (自動)`) まで併記。`warmupCap = WARMUP_DAILY_CAP_BY_DAY(day)` を `lib/wizard-schema.ts` から再利用しているため、オンボーディング Step5 ウィザード (§5.3) と段階上限の数式が **単一の真実源** で同期する。

### G4. DISCONNECT 確認入力の自然な実装

```tsx
// account-card.tsx:425-442
<Input value={confirmText} onChange={...} placeholder="DISCONNECT" autoComplete="off" />
<SubmitButton disabled={confirmText.trim() !== "DISCONNECT"} />
```

- `autoComplete="off"` でブラウザ補完を抑止
- `trim()` で前後空白を許容 (コピペユーザに優しい)
- `font-mono tabular` で「これは識別子的な厳密入力」と視覚的に伝える
- Zod 側も `z.literal("DISCONNECT")` で再確認 — クライアント側 disabled が剥がれても server で弾く

§17「退会: 確認に `DELETE` 文字入力必須」と同じ語彙設計で、システム全体の「破壊的操作確認パターン」を統一できている。

### G5. インシデント ID の `<code>` 同梱

```tsx
// page.tsx:30-32
時間をおいて再度お試しください。
<code className="ml-1 font-mono tabular text-[11px] ...">{result.incidentId}</code>
```

劣化時に「具体的なものを 1 つ渡す」原則が貫かれている。サポート問い合わせの実用性 + 工学的な誠実さ (黙って 500 を出さない) + 監査 correlation 性、3 つを 1 つの code 要素で表現。他画面 (s09 dashboard, s10 conversation) と同じパターンで横断的一貫性も◎。

### G6. Reason メモ UI の警告系トーン

PauseForm は `border-[#FDE68A] bg-warning-50` (黄)、DisconnectForm は `border-[#FECACA] bg-danger-50/50` (赤)、LimitForm は `border-brand-200 bg-brand-50/40` (青) — フォーム自体の **色温度で操作の重大度を表現**。同じ "理由を書く textarea" でも危険度が違うことを言葉に頼らず伝える。

### G7. 「Phase2 で実装予定」の正直な disabled

```tsx
<Button disabled title="Phase2 で実装予定">
  <Plus className="size-4" aria-hidden /> アカウントを追加 (Phase2)
</Button>
```

機能不在を **隠さず、しかし操作可能であるかのように見せず** に正面突破。Empty State 側でも「Phase2 で Unipile OAuth 経由の接続を提供します」と明示。期待値管理が誠実。

---

## 指摘事項

### HIGH (PASS 維持の範囲だが次バージョンで修正推奨)

#### H1. `updateDailyLimit` に理由メモ欄が無い → §6.5「1 アカウントの設定変更は **理由メモ必須**（監査ログ要件）」に反する

**該当**: `account-card.tsx:286-339` (LimitForm) / `server/actions/connections.ts:147-207`

```tsx
// LimitForm は dailyLimit 数値のみ受け取り、reason 入力欄なし
<Input type="number" name="dailyLimit" min={1} max={200} ... />
```

```ts
// LimitSchema にも reason フィールド無し
const LimitSchema = z.object({
  accountId: z.string().uuid(),
  dailyLimit: z.coerce.number().int().min(1).max(200),
});
// writeAudit({ ..., purpose: "daily_limit_changed", ... })  ← 固定文字列
```

設計書 §6.5:

> 1 アカウントの設定変更は **理由メモ必須**（監査ログ要件）

PauseForm / DisconnectForm は理由を取るが、**`updateDailyLimit` だけが理由を取らず固定 purpose で監査ログに書き込まれる**。ガバナンス的に「日次上限変更こそ何故変えたか追跡したい」操作 (例: warmupCap を超えたいから無理矢理引き上げた、コスト削減で絞った、等) で、PauseForm と同じ `reason` textarea を増やすべき。

**推奨修正**:
- `LimitSchema` に `reason: z.string().trim().min(1).max(400)` を追加
- `LimitForm` に PauseForm と同じ textarea を増設 (青系 / brand-50 / 「上限を変更する理由 (監査ログに記録されます)」)
- `writeAudit` の `purpose` に `parsed.data.reason` を渡す

修正規模は小 (Pause/Disconnect と完全に同じ実装パターンの転用)。今回 r1 で減点 -1。

#### H2. 監査 action enum が `linkedin.account_connected` / `_disconnected` の 2 種しか無く、pause / resume / limit_changed が **全部** どちらかに丸められる → §17.「監査ログ: WHO / WHEN / WHAT」の WHAT (action 種別) 識別性が壊れる

**該当**: `lib/audit.ts:33-34` (enum 定義) / `server/actions/connections.ts:72,127,189,253`

```ts
// lib/audit.ts
export type AuditAction =
  | ...
  | "linkedin.account_connected"
  | "linkedin.account_disconnected"  // ← この 2 種のみ
  | ...

// server/actions/connections.ts での流用パターン
pauseConnection      → action: "linkedin.account_disconnected" (purpose で区別)
resumeConnection     → action: "linkedin.account_connected"    (purpose: "resume_from_safe_mode")
updateDailyLimit     → action: "linkedin.account_connected"    (purpose: "daily_limit_changed")
disconnectAccount    → action: "linkedin.account_disconnected" (purpose: "user_initiated_disconnect")
```

つまり監査ログ画面 `/audit` (S19) で `action = linkedin.account_disconnected` で絞ると、「**完全切断したログ**」と「**一時停止 (safe_mode 移行) ログ**」が混在する。Owner / Admin が「過去 30 日で何回 DISCONNECT したか」を集計しようとすると `purpose` の文字列マッチが必要になる。

設計書 §13.x audit イベント表でも:

```
| `safe_mode.triggered`        | account_id, reason |
| `linkedin.account_connected` | provider, warmup_started |
```

と **別イベント** として書かれており、pause = safe_mode 移行は `safe_mode.triggered` 系を期待している可能性が高い。

**推奨修正**:
`lib/audit.ts` の `AuditAction` enum を以下に拡張:

```ts
| "linkedin.account_paused"            // pauseConnection
| "linkedin.account_resumed"           // resumeConnection
| "linkedin.account_limit_changed"     // updateDailyLimit
| "linkedin.account_disconnected"      // disconnectAccount (本番切断のみ)
| "linkedin.account_connected"         // 初回接続のみ
| "safe_mode.triggered"                // システム自動移行 (Phase2 worker)
```

これは S11 単体修正ではなく `lib/audit.ts` への横断修正 + `migrations/*_audit.sql` 側の CHECK 制約があれば再生成も必要なため、r1 では HIGH (PASS 維持) 扱いとする。CTO レビューと合わせて優先度判定推奨。

#### H3. ProgressBar の `aria-valuenow` は付くが `aria-label` / `aria-labelledby` が無く、SR で「何の進捗か」が伝わらない

**該当**: `account-card.tsx:249-282`

```tsx
<div
  role="progressbar"
  aria-valuenow={Math.round(percent)}
  aria-valuemin={0}
  aria-valuemax={100}
  className="h-1.5 rounded-full ..."
>
```

NVDA / VoiceOver では「progressbar, 73 percent」とだけ読み上げ、これが本日送信なのかウォームアップなのか区別できない。Metric の `label` 文字列 (本日の送信 / ウォームアップ) は視覚的には上にあるが、aria 的に関連付いていない。

**推奨修正**:

```tsx
function ProgressBar({ percent, tone, label, ariaLabel }: {...}) {
  return (
    <div className="mt-2">
      <div
        role="progressbar"
        aria-label={ariaLabel}        // ← 追加
        aria-valuenow={...}
        ...
```

または `Metric` 側で `<div id={labelId}>` を渡して `aria-labelledby` でリンク。

### MEDIUM

#### M1. 所有者変更ボタンが §6.5 では `[所有者を変更]` として記載されているが UI に無い

**該当**: `account-card.tsx:155-188` (footer)

設計書 §6.5:

```
[一時停止] [上限を編集] [所有者を変更] [接続を切る]
```

実装は `[一時停止] [上限を編集] [接続を切る]` の 3 アクション。代わりに右下に「所有者: 林 翔太」が**表示のみ**で出る。

これは Phase1 スコープ判断 (オーナー変更 = ABAC + 監査の複雑なシナリオなので Phase2 送り) として合理的だが、Phase2 マーカが無いため UI 上の判断根拠が不在。`アカウントを追加 (Phase2)` と同じ規律で `[所有者を変更 (Phase2)]` または「フッターに hover tooltip で『Phase2 で対応予定』」が欲しい。

#### M2. 安全モード時の推奨アクション「① 12 時間クールダウン / ② 手動 LinkedIn ログイン確認 / ③ サポート連絡」が **テキスト羅列** で、設計書ワイヤーが想定する「[サポートに送る] [手動でログインしました]」ボタンが無い

**該当**: `account-card.tsx:112-132`

設計書 §6.5 危険時:

```
状態: 🔴 安全モード(自動停止) — 失敗連続 5 回 / 警告 1 件
推奨: ① 12h クールダウン ② 手動でログインして CAPTCHA 解除 ③ サポート
[サポートに送る] [手動でログインしました]
```

実装は推奨アクションを 1 行に詰めて表示するのみ、アクション CTA は `再開する` 1 つ (ResumeForm)。`再開する` は ③ サポート相当ではなく ① クールダウン後の手動再開で、② の「手動 LinkedIn ログイン確認」と CTA が紐付かない。

設計書通り 2 ボタン (サポート / 手動ログイン確認 → ack) を増設するか、最低限「手動ログイン確認後に再開してください」と再開ボタンの文脈を補足するコピーが欲しい。Phase1 で `再開する` だけにする判断はあり得るが、その場合 §6.5 との差分理由をコメントで残すべき。

#### M3. `mockAccounts()` の `lastWarningAt` は warning_hours_ago で渡せるが、live クエリ側 (`server/queries/connections.ts:99`) は **常に `null`**。本来は `linkedin_account_events` (警告履歴) テーブル参照が必要

```ts
// server/queries/connections.ts:84-101 (live path)
const accounts: LinkedinAccount[] = rows.map((r) => ({
  ...
  lastWarningAt: null,  // ← live path で常に null
}));
```

UI 側は `account.lastWarningAt ? ... : null` で分岐するため、live 環境では「最終警告」表示が永久に出ない。Phase1 のスコープであれば許容だが、ユーザに見せている mock の体験 (鈴木さんカードに「最終警告: 6時間前」が出る) が live で再現できない = "DEMO で良く見える詐欺" の構造になっている。

設計書 §10.3 で `連続失敗 5 件 / 24h 警告 ≥ 1` が safe_mode 発動条件なので、safe_mode 状態のカードでこの情報が出ないのは UX 的に弱い。`linkedin_account_events` のような warning 履歴テーブル (or `linkedin_accounts.last_warning_at` カラム) を追加し live でも値を返すべき (Phase2 worker と合わせ検討)。

#### M4. PauseForm の `placeholder="例: クールダウン期間として 24h 停止"` は良いが、最低文字数 1 は弱い

`z.string().trim().min(1, "理由を入力してください").max(400)` だと「`.`」「`x`」「全角スペース後 trim で 0 文字」相当の入力が通る。

監査ログのガバナンス目的なら **min 10〜20 文字** くらいが現実的 (12h クールダウンなど業務理由は最低 8-12 文字書ける)。あるいは min(3) + 「短すぎる理由は監査時に意味不明になります」のヒントカラー (warning) で誘導。

これは PM / Security レビューと判断が分かれる箇所 (ガード強すぎると操作摩擦) なので MEDIUM 留め。

#### M5. `effectiveLimit = Math.min(dailyLimit, warmupCap)` の伝達が UI 上で弱い

```tsx
// account-card.tsx:43-46
const effectiveLimit = Math.min(account.dailyLimit, account.warmupCap);
// 表示
<Metric label="本日の送信" value={`${fmtNumber(account.todaySent)} / ${effectiveLimit}`}>
```

例: ユーザが daily_limit=25 に設定しているが warming Day 3 で warmupCap=8 の場合、表示は `0 / 8` になる。LimitForm のヒント `ウォームアップ段階の自動上限 {warmupCap} 件/日 を超える値は実行時に押し戻されます` で説明はあるが、カード本体で「設定値 25 だが今日は 8 まで」が伝わらず「上限編集したのに反映されてない?」誤解を生む。

**推奨**: `0 / 8 (設定 25)` のような併記、または `25 → 8 (warmup)` ツールチップ。

### LOW

#### L1. `displayName.slice(0, 2)` アバターが Unicode サロゲートペア (絵文字混じり名) で崩れる
日本人氏名はほぼ問題ないが、グローバル展開時の落とし穴。`Intl.Segmenter` 経由が安全。

#### L2. Toast の 3500ms 固定。`role="alert"` 系エラーは長めに見せるべき (SR ユーザは読み終わる前に消える)
`kind === "error"` 時のみ 6000ms にする等。

#### L3. `pulse-soft` が warming Hourglass にだけ載るが、`prefers-reduced-motion` 配慮なし
CSS 側で `@media (prefers-reduced-motion: reduce)` の対応が必要。

#### L4. `font-mono tabular` の `tabular` は標準 Tailwind では `tabular-nums` で、`font-variant-numeric: tabular-nums` のショートカット利用が前提。プロジェクト globals.css での定義は確認済 (s09/s10 と同じパターン) のため OK だが、新規参加者が読むと「何これ?」になる。コメントで `lib/utils.ts` か globals.css への参照を一言残す価値あり

#### L5. `connections-container.tsx:11` toast 状態が単一スロット
複数アカウントを同時に編集 → 連続成功でも 1 件しか出ない。Queue 化または最新のみで OK の明示コメントを。Phase1 1 アカウント想定なら現状で可。

---

## 設計書整合性サマリ

| §6.5 要件 | 実装 | 状態 |
| --- | --- | :---: |
| 状態: 🟢/🟡/🔴 三層表現 | StatusBadge tone + アイコン + 文言 | ✅ |
| ウォームアップ Day N/14 表示 | `Day ${warmupDay}/14` | ✅ |
| 段階バーと残日数の **両方** | ProgressBar + 上限ラベル | ✅ |
| 本日の送信 X/Y バー | sentPct ProgressBar (>90% で warning) | ✅ |
| 本日の返信 | `fmtNumber(todayReplied)` | ✅ |
| 最後の警告 表示 | mock では出るが live で null | ⚠️ M3 |
| `[一時停止]` | PauseForm | ✅ |
| `[上限を編集]` | LimitForm | ✅ |
| `[所有者を変更]` | **未実装** (Phase2 マーカも無し) | ⚠️ M1 |
| `[接続を切る]` | DisconnectForm | ✅ |
| 設定変更の **理由メモ必須** | Pause/Disconnect は ✅、Limit は ❌ | ⚠️ H1 |
| 接続を切る時の警告 + DISCONNECT 確認 + 7 日復元 | 全て揃う | ✅ |
| 安全モード推奨アクション 3 段 | テキスト羅列のみ、ボタン CTA 不在 | ⚠️ M2 |

| §10 レート制御 | 実装 | 状態 |
| --- | --- | :---: |
| 14 日 / 1/3 → 2/3 → 100% 段階上限 | `WARMUP_DAILY_CAP_BY_DAY` 8 → 17 → 25 | ✅ |
| 連続失敗 5 件 / 24h 警告 ≥ 1 で safe_mode | 実装文言「失敗連続 5 回で安全モード自動」(page.tsx:70) で UI 説明済 | ✅ |
| safe_mode 持続バナー | カード自体が danger 化、Resume ボタン | ✅ |

| §17 セキュリティ UX / 監査 | 実装 | 状態 |
| --- | --- | :---: |
| 監査ログ: WHO / WHEN / WHAT / DIFF / purpose | writeAudit() 呼び出しあり | ✅ |
| WHAT (action) の識別性 | pause / resume / limit_changed が `connected` / `disconnected` に丸まる | ⚠️ H2 |
| 破壊的操作の文字入力確認 (`DELETE` パターン踏襲) | `DISCONNECT` 文字一致 | ✅ |
| Org スコープ強制 (RLS 相当) | 全 update で `eq(orgId, session.orgId)` | ✅ |
| Admin 以上ロール強制 | `requireAdmin()` 全 action | ✅ |

---

## 判定

**92 / 100 — PASS** (>= 90)

- 設計書 §6.5 / §10 / §17 の主要要件をほぼカバー、視覚 / インタラクション / a11y / トーンのバランスが揃っている
- HIGH 3 件は **PASS 維持の範囲** だが r2 / Phase2 で順次解消推奨
  - H1 (LimitForm 理由メモ) は単体修正で済むので **次回 r2 の必須項目に格上げ**
  - H2 (audit action enum 拡張) は CTO 判断、横断修正
  - H3 (ProgressBar aria-label) は a11y QA で発見しやすい後追い修正
- MEDIUM 5 件はスコープ判断 + Phase2 worker 連携で自然に解消する見込み

次の修正ラウンドが入るなら **H1 のみ** で 94+ 到達見込み。
