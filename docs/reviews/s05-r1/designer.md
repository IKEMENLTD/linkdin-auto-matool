# S05 キャンペーン作成 Wizard — Designer Review (R1)

- 対象: `app/(app)/campaigns/new/page.tsx` + `components/campaigns/wizard/*` (6) + `components/ui/tag-input.tsx` + `lib/wizard-schema.ts` + `server/actions/wizard.ts` + `server/queries/accounts.ts`
- 設計書: `docs/ui-ux/UI_UX_Design.md` v1.3 §6.2 / §5.6.1
- 基準: Refined Hydro Minimalism (白+sky/cyan, Manrope/Geist/Noto Sans JP, Lucide SVG)
- レビュー日: 2026-05-11

---

## 総合スコア: 91 / 100  → 90+ 判定: **PASS**

| 評価軸 | スコア | 備考 |
| --- | ---: | --- |
| 1. ビジュアル (Refined Hydro Minimalism) | 19 / 20 | sky グラデ + ring shadow + tabular font-mono まで徹底。Stepper 中段ドットの色トーンのみ微改善余地 |
| 2. 設計書整合 (5 step / 警告 / 押し戻し / 変数検知) | 19 / 20 | §6.2 主要要素は完備。§5.6.1 のコラボ・差分は Phase2 注記済みだが UI 上のフックなし |
| 3. インタラクション (URL同期 / debounce / Draft / useActionState) | 18 / 20 | useActionState + useFormStatus は教科書通り。reach 警告の preview 反映と aria-live が惜しい |
| 4. a11y / レスポンシブ | 17 / 20 | Stepper は完璧。Step1 ラジオがキーボード矢印キーで切替不可、consent error が label 外 |
| 5. 日本語 B2B トーン | 18 / 20 | keigo / 警告コピー / "御社" / "突然のご連絡失礼いたします" まで自然 |

---

## 良い点 (Top 3)

1. **Refined Hydro Minimalism のトークン運用が一貫している**
   - `bg-[linear-gradient(180deg,rgba(186,230,253,0.55),rgba(240,249,255,0.7))]` の薄水色グラデを Stepper 現在 step / ICP リーチ正常 / Step5 レビュー必須カード / プレビューカード全てで使い回し、ブランド体験が崩れていない。
   - `shadow-[0_8px_24px_-16px_rgba(14,165,233,0.55)]` の sky リング影が選択 chip と Step1 アクティブカードのみに限定され、視覚ノイズが出ていない。
   - Lucide アイコン (`Target / Calendar / UserPlus / Microscope / Sparkles / Hourglass / ShieldAlert / ShieldCheck / Rocket / Wand2`) が状況と完全に一致しており、絵文字や独自 SVG への退行がない。

2. **設計書 §6.2 の "ガード" 仕様が文字通り実装され、危険操作を物理的にブロック**
   - `estimateReach` < 50 → 黄バナー (`AlertTriangle`)、> 100,000 → 赤バナー (`AlertOctagon`)。設計書の "条件を緩めますか？/絞り込みを推奨" コピーが日本語そのまま再現。
   - Step4 で `{{ }}` 変数残存を `/\{\{\s*[a-zA-Z_]+\s*\}\}/` で検知し、UI 警告 + `superRefine` で Zod レベルでも送信ブロックする二重ガード。
   - Step5 で `WARMUP_DAILY_CAP_BY_DAY` から選択中アカウントの最小キャップを算出し、超過時に「ローンチ時に自動で押し戻されます」と "押し戻し" コピーまで再現。`safe_mode` アカウントは `opacity-60 cursor-not-allowed` + Checkbox 無視で物理的に選択不可。

3. **`useActionState` + `useFormStatus` + localStorage のハイブリッド永続化が堅実**
   - 1.5s debounce で localStorage に `{state, furthest, draftId}` 保存。未ログイン時は Header 上に `DEMO · 未ログインのため、下書きはローカル保存のみ` の Badge が出て期待値が明確。
   - `useActionState` の戻り値で `draftId` を受け取り、以降の保存リクエストに hidden input で同梱 → 同一 Draft への upsert が成立。Server Action 側で `eq(orgs)` を含めて他テナント改変も封じている (`server/actions/wizard.ts:75`)。
   - `useFormStatus` ベースの `DraftButton` / `LaunchSubmit` で pending を Button に伝播。Submit 中の二重送信が UI レベルで止まる。

---

## 指摘

### HIGH (90+ 維持に必須・最低 1 件は対応推奨)

1. **Step1 目的選択がキーボード矢印キーで切り替えできない**
   `step-objective.tsx:21` は `<fieldset>` で囲んでいるが、各 `<input type="radio">` は `className="sr-only"` で隠されラジオに対応するフォーカススタイルも見えない。`<label>` 全体をクリック可能にしているが、Tab で `<label>` に入っても矢印キーで隣の選択肢に移動できない (ブラウザ既定は input 同士のみ)。設計書 §5.6.1 で重視される "離脱・再開" のキーボード操作性を満たすには、 (a) `:focus-visible` で外枠 ring を追加する、(b) `tabIndex={0}` + `onKeyDown` で `ArrowLeft/Right` を実装する、いずれかが必要。

2. **`consentPolicy` のエラーメッセージが `<label>` の外に描画される**
   `step-delivery.tsx:217-241` で同意 Checkbox を持つ `<label>` の "外" にエラーが出る。SR は label との関連を失い、`aria-describedby` も付いていないため、未同意エラーがフォーカス時に読まれない。`Field` コンポーネントでラップするか、`<label>` 内に `role="alert"` を入れて `aria-invalid` を Checkbox に付与する。

3. **`<aside>` プレビューに reach 警告 (50 未満 / 100k 超) が反映されない**
   `wizard-preview.tsx:44` は `estimateReach(state.step3)` を表示するだけで、警告色や注意アイコンを付けない。設計書 §6.2 プレビュー欄は "推定到達 3,420 件 / 想定 90 日" の正常系のみ掲載されているが、Step5 まで進んだ後で Step3 に戻らずに reach 危険値を察知させるには、preview 側にも `tone="warning"` の縮小バッジを出すべき。

### MEDIUM

4. **Stepper の「過去ステップ」と「未到達ステップ」の階調差が弱い**
   `stepper.tsx:32-41` で過去 step は `text-ink-700`、未到達は `text-ink-400`。両方とも背景は透過なので、横一列で見ると "過去" と "現在以外" の差がアイコン (`Check` vs 数字) のみに依存し、急いで読むと進捗が把握しにくい。`isPast` 側にも `border-[var(--color-brand-200)]` か `bg-[var(--color-brand-50)]/40` を薄く乗せるとリズムが出る。

5. **`useSearchParams()` が Suspense boundary なしで使われている**
   `wizard-shell.tsx:50` で `useSearchParams()` を直接利用しているが、Next.js 15+ では `<Suspense>` での囲みを警告するケースがある。`app/(app)/campaigns/new/page.tsx` 側で `<Suspense fallback>` を入れるか、`force-dynamic` で十分なら現状維持を README で根拠化する (`dynamic = "force-dynamic"` は宣言済みなのでビルドは通るが、推奨パターンには沿っていない)。

6. **Draft 保存・ローンチ結果トーストに `aria-live="polite"` が抜けている**
   `wizard-shell.tsx:312-329` で `role={saved.ok ? "status" : "alert"}` は付いているが、`aria-live` 属性は明示なし。`role="status"` は実質 `aria-live="polite"` 相当だが、Safari + VoiceOver の組み合わせで読まれないケースがあるため、`aria-live="polite" aria-atomic="true"` を併記したい。

7. **A/B テスト案 B の AI 生成は同じ "案 A" のソースを使い回している**
   `step-message.tsx:48-57` で variant a/b の本文がハードコードされた 2 セットのみ。実機 Phase2 で AI 接続するまでの暫定実装としては OK だが、現在は "案 A" を生成後に "案 B" を押すと類似テキストになる。ユーザーの心理的期待 (= "別案") を裏切るため、デモでも語尾やセクション順を変えるか、せめてプレースホルダで `// Phase2 で別 LLM 呼び出し` を残してほしい。

8. **`hint` プロップに HTML エンティティ `&quot;` が露出**
   `step-icp.tsx:149` の `hint="例: title:(VPoE OR &quot;VP of Engineering&quot;) AND ..."`。React は文字列リテラルの `&quot;` をそのまま表示してしまう (JSX は文字列の中の HTML エンティティを解釈しない)。ユーザー画面に `&quot;` がそのまま出る。`{'例: title:("VP of Engineering")'}` に置換。

### LOW

9. **`font-mono` クラスを使っているが `tabular` も別途必要な箇所がある**
   reach 数値、カウンタ、日次上限など `tabular font-mono` がほぼ全箇所で揃っているが、Stepper 内の `font-mono` (`stepper.tsx:46`) には `tabular` が併記されていない。1〜5 のシングル桁なので影響は微小だが、トークンを揃えると DX が一貫する。

10. **`label` 内に `cursor-pointer` を付けているが `disabled` 状態と相反する**
    `step-delivery.tsx:82` の `safe` 分岐は `opacity-60 cursor-not-allowed` で正しいが、その他 `<label className="...cursor-pointer">` の中の `<Checkbox>` も `cursor-pointer` を継承するので、Checkbox 自体に明示的 `cursor` を持たせなくても問題ない (現状の "watch / change" 影響は無い)。

11. **`StepProduct` の "AI 取り込み" ボタンが `cursor-not-allowed` + `disabled` + `title` の 3 重表現**
    無効化は意図的だが、`title` ツールチップはモバイルで読めない。`<Badge tone="info">Phase2</Badge>` を併置する方が B2B プロダクトの "未提供" 表現として明示的。

12. **`LaunchButton` の result が `ok=true` 時に表示されない**
    `wizard-shell.tsx:362-367` は失敗時のみ message 表示。成功時は `redirect()` が走るので不要だが、`redirect()` が失敗した稀ケースでサイレントになる。`saved.ok && saved.message` のフォールバック表示があると安全。

---

## 設計書整合チェックリスト (§6.2 / §5.6.1)

| 項目 | 実装 | 評価 |
| --- | --- | --- |
| 5 ステップ Stepper | `STEPS` 配列 + `Stepper` | OK |
| 過去 step ジャンプ可 | `furthest` 管理 + `isReachable` | OK |
| Step1 目的カード 4 種 | outbound/event/hiring/research | OK |
| Step2 製品URL 取り込み | `disabled` + Phase2 | OK (注記済) |
| Step3 リーチ < 50 黄バナー | `AlertTriangle` | OK |
| Step3 リーチ > 100k 赤バナー | `AlertOctagon` | OK |
| Step4 コネクト 300 文字制限 | `maxLength={300}` + Zod | OK |
| Step4 テンプレ変数残存検知 | `/{{...}}/` UI + superRefine | OK |
| Step4 A/B テスト 50/50 | `abEnabled` + `abVariantB` | OK |
| Step5 ウォームアップ自動上限 | `WARMUP_DAILY_CAP_BY_DAY` | OK |
| Step5 押し戻しコピー | "自動で押し戻されます" | OK |
| Step5 レビュー必須 vs セミ自動 | `REVIEW_MODES` | OK |
| Step5 利用規約同意 | `consentPolicy: literal(true)` | OK |
| プレビューカード | `WizardPreview` sticky | OK |
| Draft 自動保存 (1.5s debounce) | localStorage + Server Action | OK |
| 離脱再開ディープリンク | `?step=N` URL 同期 | OK (`draftId` URL 同期はなし) |
| §5.6.1 同時編集者アバター | 未実装 | Phase2 と整合 |
| §5.6.1 ローンチ後の差分表示 | preview footer の説明文のみ | Phase2 と整合 |

---

## 結論

設計書 §6.2 の主要要件はほぼ完全に満たされており、Refined Hydro Minimalism の表現品質は高い。HIGH 3 件は a11y と認知負荷に関わる小修正で、対応すれば 94 点台に伸びる。**現状で 90+ 判定 PASS**。

90+ 判定: **PASS (91 / 100)**

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
- C:\Users\ooxmi\Downloads\Linkdin自動ツール\components\ui\tag-input.tsx
- C:\Users\ooxmi\Downloads\Linkdin自動ツール\lib\wizard-schema.ts
- C:\Users\ooxmi\Downloads\Linkdin自動ツール\server\actions\wizard.ts
- C:\Users\ooxmi\Downloads\Linkdin自動ツール\server\queries\accounts.ts
