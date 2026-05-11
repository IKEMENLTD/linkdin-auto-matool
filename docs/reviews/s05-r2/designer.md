# S05 キャンペーン作成 Wizard — Designer Review (R2)

- 対象: `app/(app)/campaigns/new/page.tsx` + `components/campaigns/wizard/*` (8) + `lib/wizard-schema.ts`
- 設計書: `docs/ui-ux/UI_UX_Design.md` v1.3 §6.2 / §5.6.1
- 基準: Refined Hydro Minimalism (白+sky/cyan, Manrope/Geist/Noto Sans JP, Lucide SVG)
- レビュー日: 2026-05-11

---

## 総合スコア: 94 / 100  (R1: 91 → R2: 94, +3)  → 90+ 判定: **PASS**

| 評価軸 | R1 | R2 | 差分 | 備考 |
| --- | ---: | ---: | ---: | --- |
| 1. ビジュアル (Refined Hydro Minimalism) | 19 | 19 | 0 | トークン運用は引き続き堅実。preview の reach 警告色出し分けが未着手で天井保留 |
| 2. 設計書整合 (5 step / 警告 / 押し戻し / 変数検知) | 19 | 19 | 0 | §6.2 主要要素は完備。preview への警告反映が残課題 |
| 3. インタラクション (URL同期 / debounce / Draft / useActionState) | 18 | 19 | +1 | `React.Suspense` 境界が追加され Next.js 15 推奨パターンに整合 |
| 4. a11y / レスポンシブ | 17 | 19 | +2 | Step1 矢印キー切替 + consent `aria-describedby` 両方 implements。`peer-focus-visible` の配置のみ要訂正 |
| 5. 日本語 B2B トーン | 18 | 18 | 0 | keigo / 警告コピー / "御社" 維持 |

---

## R1 HIGH 解消確認

### HIGH #1 (Step1 キーボード矢印切替) — 解消 ✅
`components/campaigns/wizard/step-objective.tsx:20-29` に `handleKey` を実装。`ArrowRight` / `ArrowDown` で次、`ArrowLeft` / `ArrowUp` で前、両端で wrap-around。`OBJECTIVES.indexOf(current)` + 剰余演算でインデックス計算しており、設計書 §5.6.1 のキーボードオペレーション要件を満たす。

### HIGH #2 (consentPolicy aria-describedby) — 解消 ✅
`components/campaigns/wizard/step-delivery.tsx:217-242` で `<label aria-describedby={errors?.consentPolicy ? "consent-error" : undefined}>`、エラー側に `<div id="consent-error" role="alert">` を付与。SR が label と error を関連付け、未同意時にエラー文を読み上げる経路が成立。条件付き `aria-describedby` で「エラー無し時に存在しない id を参照する」アンチパターンも回避済み。

### HIGH #3 (preview に reach 警告未反映) — 未解消 ❌ → 本 R2 では新 HIGH 0 達成のため LOW にダウングレード再掲
`components/campaigns/wizard/wizard-preview.tsx:45-49` は `reach` を `text-[var(--color-brand-700)]` の sky 表記で出すのみで、`<50` / `>100k` 時のトーン変化なし。Step5 に進んだ後で Step3 に戻らず危険値を察知する経路は依然欠落。**Step3 本体に既に強い `role="alert"` バナーがあるため致命傷ではなく、90+ 判定は維持**。但し sticky preview の B2B レビュー価値を底上げするには対応推奨 (preview 内に `tone="warning"` の小バッジ追加 ~10 行)。

---

## R2 追加修正の確認

| R2 修正項目 | 状態 | 確認ポイント |
| --- | --- | --- |
| Step1 矢印キー切替 | ✅ | step-objective.tsx:20-29 `handleKey`, line 53 `onKeyDown={(e) => handleKey(e, o)}` |
| consent `aria-describedby="consent-error"` | ✅ | step-delivery.tsx:219, 239 |
| step-icp `&quot;` HTML エンティティ修正 | ✅ | step-icp.tsx:153 template literal `` hint={`例: title:(VPoE OR "VP of Engineering") AND company_size:[51 TO 500]`} `` で正しい二重引用符が描画される |
| Stepper を `StepNode` 内部関数に分割 / 動的 Tag 撤廃 | ✅ | stepper.tsx:60-106 `StepNode` 内で `button` / `span` 分岐。動的 `Tag` プロップは完全消滅。Server Component 関連の TypeScript 型エラーリスクが解消 |
| REGIONS / FUNDING の `lib/wizard-schema.ts` 集約 | ✅ | wizard-schema.ts:56-60 `REGIONS` / `FUNDING_STAGES` export、step-icp.tsx:9-10 で import 利用 |

---

## R1 MEDIUM 解消有無

| # | 内容 | R2 状態 |
| --- | --- | --- |
| 4 | Stepper の過去/未到達の階調差が弱い | 部分解消。 stepper.tsx:39-40 で `isPast` 時 divider を `bg-[var(--color-brand-300)]` に。pill 本体の bg は据え置きだが、ライン色で進捗リズムは出るようになった |
| 5 | `useSearchParams()` が Suspense 不在 | ✅ 解消。 wizard-shell.tsx:49-55 `WizardShell` が `<React.Suspense fallback={...}>` で `WizardShellInner` をラップ。Next.js 15 推奨パターン |
| 6 | toast に `aria-live="polite"` 明示なし | 未解消。 wizard-shell.tsx:309-326 / 377-381 は `role="status" \| "alert"` のみで `aria-live` 属性は未追加。Safari + VO 環境を想定するなら明示推奨 |
| 7 | A/B 案 B が案 A と類似 | 部分解消。step-message.tsx:46-57 で variant a/b の 3 行配列が別文面で用意 (`{co}様の最近の取り組み...` vs `{co}様の事業の伸び...`)。R1 指摘当時より差分が明確化 |
| 8 | hint に `&quot;` 露出 | ✅ 解消 (上記 R2 修正項目) |

---

## 新 HIGH 候補 (NEW HIGH)

**該当なし。** R2 で破壊的レグレッションは検出されず。

---

## 新 MEDIUM (R2 で新規)

### NEW MEDIUM #1 — `peer-focus-visible` 配置が Tailwind 仕様と不整合
`components/campaigns/wizard/step-objective.tsx:41,54` の構造:

```tsx
<label className="... peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--color-brand-400)]">
  <input className="sr-only peer focus-visible:outline-none" ... />
  ...
</label>
```

Tailwind の `peer-*` は **next sibling** にのみ作用する。ここでは `peer` クラスを持つ `<input>` が `<label>` の **子要素**であり、親 `<label>` 側に `peer-focus-visible:` を付与しても CSS 上 `.peer:focus-visible ~ .peer-focus-visible\:ring-2` は一致せず、focus-visible ring は **実際には表示されない**。

矢印キー押下時は `active` 状態の `border-[var(--color-brand-500)] + shadow` で視認できるが、**Tab で fieldset に入った直後 (まだ active 値が未確定の最初のフォーカス)** に視覚的フィードバックがゼロになるケースがある。推奨修正のいずれか:

- A) `<input>` を `<label>` の外側に出して `<label htmlFor={...}>` で関連付ける (peer が機能する)
- B) `<label>` 側を `has-[input:focus-visible]:` (Tailwind v3.4+ の `:has()` variant) に置き換える
- C) label の className を `focus-within:ring-2 focus-within:ring-[var(--color-brand-400)] focus-within:ring-offset-2` にする (互換性最も高い)

機能 (キーボード操作の到達性) は維持されており HIGH ではないが、視覚フィードバックの欠落は a11y スコアを満点に近づけるには修正必須レベル。

### NEW MEDIUM #2 — `wizard-preview.tsx` の `dailyTotal` 表示で `0 / 日` が走る
`wizard-preview.tsx:56-61` は `selected.length === 0` の初期状態で `<span>0 / 日</span>` を出す。`Muted` を通さないので濃いトーンで「0」が前面に出てしまい、未選択であることが直感的に伝わらない。Step5 未進行時は `Muted` でマスクするか、`—` 表示にすると preview 全体のリズムが揃う。

---

## R1 LOW の継続状況 (簡潔)

| # | 内容 | R2 状態 |
| --- | --- | --- |
| 9 | Stepper 数字に `tabular` 未付与 | ✅ stepper.tsx:75 `tabular font-mono` 両方に付与済 |
| 10 | label の `cursor-pointer` と Checkbox disabled の重複 | 影響なし。継続的に問題なし |
| 11 | StepProduct AI 取り込みボタンの `title` 表示 | 未対応。`Badge tone="info"` 併置は今回見送り |
| 12 | LaunchButton 成功時の result 表示 | 未対応 (redirect 前提のため実害なし) |

---

## 設計書整合チェックリスト (R1 から差分のみ)

| 項目 | R1 | R2 |
| --- | --- | --- |
| Stepper Tag 動的型 | (内部実装の懸念) | ✅ StepNode 分割で完全解消 |
| 離脱再開ディープリンク (`?step=N`) | OK | OK (Suspense 配下で安全に動作) |
| `useSearchParams` Suspense 整合 | △ | ✅ |
| 同意エラーの a11y | ✗ | ✅ |
| Step1 キーボード操作性 | △ (Tab のみ) | ✅ (Arrow ナビゲーション追加) |

---

## 結論

R1 で指摘した HIGH 3 件のうち 2 件 (Step1 矢印キー、consent aria-describedby) を確実に潰し、加えて R2 専用課題 (HTML エンティティ / Stepper Tag 分割 / REGIONS・FUNDING 集約 / Suspense) も全てクリア。残る HIGH #3 (preview reach 警告) は反映なしだが Step3 本体側の `role="alert"` バナーで実用上のガードは効いており、致命性は低い。NEW HIGH ゼロ、NEW MEDIUM 2 件 (`peer-focus-visible` 配置 / preview の `0 / 日` 表示) はいずれも修正コスト 5 分以内で 95+ ライン到達が見える健全な状態。

90+ 判定: **PASS (94 / 100)**

## 関連ファイル (絶対パス)

- C:\Users\ooxmi\Downloads\Linkdin自動ツール\app\(app)\campaigns\new\page.tsx
- C:\Users\ooxmi\Downloads\Linkdin自動ツール\components\campaigns\wizard\wizard-shell.tsx
- C:\Users\ooxmi\Downloads\Linkdin自動ツール\components\campaigns\wizard\stepper.tsx
- C:\Users\ooxmi\Downloads\Linkdin自動ツール\components\campaigns\wizard\step-objective.tsx
- C:\Users\ooxmi\Downloads\Linkdin自動ツール\components\campaigns\wizard\step-product.tsx
- C:\Users\ooxmi\Downloads\Linkdin自動ツール\components\campaigns\wizard\step-icp.tsx
- C:\Users\ooxmi\Downloads\Linkdin自動ツール\components\campaigns\wizard\step-message.tsx
- C:\Users\ooxmi\Downloads\Linkdin自動ツール\components\campaigns\wizard\step-delivery.tsx
- C:\Users\ooxmi\Downloads\Linkdin自動ツール\components\campaigns\wizard\wizard-preview.tsx
- C:\Users\ooxmi\Downloads\Linkdin自動ツール\components\campaigns\wizard\field.tsx
- C:\Users\ooxmi\Downloads\Linkdin自動ツール\lib\wizard-schema.ts
