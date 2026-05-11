# Designer 軽量レビュー — Batch2 (S02 / S08 / S16 / S20)

**Agent**: designer
**Date**: 2026-05-11
**Spec**: 設計書 v1.3 (§5.1 / §6.11.3 / §17 / §17.2 / §17.6)
**目標**: 各画面 88+

---

## S02 オンボーディング — `app/onboarding/page.tsx`

**スコア: 90 / 100**

5 ステップカードの視覚階層が明快で、§5.1 の「10 分セットアップ」の意図がヒーロー文と Step インジケータで一貫表現できている。「安全側の既定」セクションがオンボーディング中の不安解消に効いており、設計書の自動送信抑止思想がフロントから可視化されている。

- **MEDIUM**: `step` クエリパラメータで進捗を持つが、UI に対話的な「次へ / 前へ」操作がない。`step > 1` の判定により完了状態は表示されるが、ユーザーが Step 1〜4 をどう完了させるか動線が不明。CTA は `Step n` に関わらず常に「キャンペーン作成へ進む」(Step 5 相当) に固定されており、Step 2 時点で押すとフローを飛ばす結果になる。Step 別 CTA の出し分け、または各 StepCard に個別の遷移リンクが必要。
- **良い点**: 「スキップして始める」を `header` 右上に控えめに配置しつつ、メイン CTA は brand 色で明示。離脱と前進の両方を 1 画面で許容する § 5.1 の完了率 70% 目標に整合的。

---

## S08 リード詳細 — `app/(app)/leads/[id]/page.tsx`

**スコア: 89 / 100**

ヘッダ (名前 / headline / company / StateChip / score / LinkedIn) → 3 カラム MetaCard → タイムライン → CRM の F パターンが自然で、§6.11.3 の情報順位 (Identity → Context → Activity → Integration) に正しくマップされている。Phase2 のプレースホルダも `Badge tone="info"` で一貫しており、現状の実装範囲がユーザーに明確。

- **MEDIUM**: `linkedinUrl = safeExternalUrl(`https://www.linkedin.com/in/${lead.id}`)` がデモ値で UUID をスラッグに使っており、本物の LinkedIn URL を期待したユーザーが 404 に飛ぶ。少なくとも `// demo` コメントだけでなく、`lead.linkedinSlug` が未設定なら LinkedIn ボタンを非表示にする条件分岐が必要 (現在は常時表示)。設計書 §6.11.3 の「外部リンクは検証済みのみ」原則に反する。
- **良い点**: 「現在の会話を見る」リンクで Phase2 不在のタイムラインから `/inbox/[id]` への抜け道を用意。空状態を行き止まりにしない DX 配慮が秀逸。

---

## S16 セキュリティ — `app/(app)/settings/security/page.tsx`

**スコア: 88 / 100**

6 枚の FeatureCard + 脅威モデル 7 件で §17 / §26 をワンビューに圧縮。`stage` バッジで Phase2 / Scale / Enterprise / 実装済の差を Badge tone で読み分けできるのが優秀。`role="status"` でページ上部に Phase2 告知を置き、SR ユーザーにも実装ステータスが伝わる。

- **MEDIUM**: 監査ログカードのみ `done` + `href="/audit"` で能動 (クリック可能) なのに、視覚的には他 5 枚と同じ FeatureCard 装飾で `hover:shadow` だけが差異。クリック可能性のアフォーダンス不足。能動カードには右上に `ArrowRight` アイコン or `tone="success"` バッジ強調 + カーソルポインタを明示する、もしくは `FeatureCard` の `href` 有版で枠線色を brand-200 に変える等で「ここだけ押せる」を視認可能にすべき。
- **良い点**: 脅威モデルを番号付きで列挙し §26 の 7 件と 1:1 対応。経営層 / 監査人が見た時に「設計書のどこを実装しているか」を瞬時に照合できる、コンプラ説明資料としての価値が高い。

---

## S20 データ管理 — `app/(app)/settings/data/page.tsx`

**スコア: 91 / 100**

GDPR Art.17 / 個情法 28 条 (DSAR) を冒頭 1 行で示し、エクスポート / 削除 / リージョンの 3 ブロック構成。削除カードの danger 色 + 「監査ログは削除不可」警告ブロック + 30 日 grace の説明が §17.2 / §17.6 の保持期間思想を画面表現に翻訳できている。`Pill active` で JSON / 全期間を既定として可視化、`Phase2` ボタンが disabled + tooltip で「動作しないがどこにあるか」を明示している点も良。

- **MEDIUM**: ScopeRow が `Checkbox checked={true} onCheckedChange={() => {}}` で全項目が常時チェック済かつトグル不能。「対象 (チェックされたデータを 30 日 grace 後に物理削除)」という文言と矛盾し、ユーザーは「ナレッジ / 埋め込みベクトル」だけ外したいケースで操作できると誤認する。Phase2 までは `disabled` + 文言を「削除対象 (全項目固定)」に修正、または ScopeRow から Checkbox を外して一覧表示に変える方が正直。`onCheckedChange={() => {}}` の no-op は a11y 観点でも欺瞞。
- **良い点**: hidden 透かし `__watermark` + 7 日 URL 失効 + 撤回可能 (`/audit/exports`) を本文に明示。エクスポート機能で起きがちな「出した後の責任所在」まで先に説明しており、Owner / 法務にレビュー依頼しやすい仕様書化された UI。

---

## 総合判定

**APPROVED** — 4 画面とも目標 88+ をクリア (88〜91)。

Phase2 仕様可視化系として一貫性が高く、`Badge tone="info"` の Phase2 ラベル / `role="status"` 告知バナー / `disabled` + Phase2 サフィックス CTA という 3 つの規約が全画面で守られている。設計書 v1.3 との対応 (§参照) を本文に書く運用も、コンプラ説明・引き継ぎの両面で実装ステータスを誤読させない。

実装ブロッカーなし。上記 MEDIUM 4 件は Phase2 実装前の文言・条件分岐の小修正で吸収可能。

### 共通の MEDIUM 改善優先度

1. **S08** デモ LinkedIn URL の常時表示 — 本番リスク中 (実在しない LinkedIn プロフィールへ飛ばす)
2. **S20** ScopeRow Checkbox の no-op — UX 中 (操作可能と誤認)
3. **S02** Step 別 CTA の出し分け — UX 中 (Step 1〜4 で Step 5 CTA は不整合)
4. **S16** 能動 FeatureCard のアフォーダンス — UX 低 (発見性のみ)

### 良い点 (横展開推奨)

- S02 「安全側の既定」セクションは S04 (キャンペーン作成) / S07 (送信レビュー) でも同パターン採用推奨
- S20 「監査ログは削除不可」danger ブロックは S16 監査タブの注意書きとして再利用可能
- S16 番号付き脅威モデル列挙は §26 を扱う他ページ (Owner ダッシュボード等) のテンプレ化候補

---

## 出力 (Design Review Gate 集約用 JSON)

```json
{
  "agent": "designer",
  "verdict": "APPROVED",
  "scores": {
    "S02_onboarding": 90,
    "S08_lead_detail": 89,
    "S16_security": 88,
    "S20_data": 91
  },
  "blockers": [],
  "suggestions": [
    "S08: lead.linkedinSlug 未設定時は LinkedIn ボタンを非表示にする条件分岐を追加 (現在 UUID で常時表示=デッドリンク)",
    "S20: ScopeRow の Checkbox を Phase2 まで disabled もしくは表示専用化 (現在 no-op で操作可能と誤認)",
    "S02: step クエリパラメータの値に応じて CTA を出し分け (Step 1〜4 で Step 5 用 CTA が固定表示)",
    "S16: 監査ログカード (href 有) に ArrowRight or success バッジでクリック可能性を視覚的に強調"
  ],
  "questions": []
}
```
