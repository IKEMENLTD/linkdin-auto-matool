# LinkedIn 自動営業 SaaS — UI/UX 設計

このリポジトリは LinkedIn を活用した日本語 B2B 自動営業 SaaS の **設計フェーズ成果物** を保管する。

## ディレクトリ

```
.
├─ LinkedIn自動営業SaaS構築設計書.docx    親ドキュメント（戦略・アーキテクチャ）
├─ docs/
│  └─ ui-ux/
│     ├─ UI_UX_Design.md                  UI/UX 設計書 v1.3（メイン）
│     └─ reviews/
│        ├─ round1_designer.md            Round1 Designer (78/100)
│        ├─ round1_pm.md                  Round1 PM (73/100)
│        ├─ round1_cto.md                 Round1 CTO (71/100)
│        ├─ round1_security.md            Round1 Security (64/100)
│        ├─ round1_sre.md                 Round1 SRE (62/100)
│        ├─ round2_*.md                   Round2 5観点（平均 88.4/100）
│        └─ round3_*.md                   Round3 5観点（平均 95.0/100 達成）
└─ README.md
```

## 設計書の到達点

5観点（UX デザイナー / PM / CTO / Security / SRE）の並列レビューを 3 ラウンド回し、**平均スコア 95.0/100 で APPROVED**。Phase1 実装着手可能。

| 観点 | Round1 | Round2 | Round3 |
| --- | --- | --- | --- |
| Designer (UX) | 78 | 91 | **94** |
| PM | 73 | 89 | **96** |
| CTO | 71 | 89 | **94** |
| Security | 64 | 86 | **96** |
| SRE | 62 | 87 | **95** |
| **平均** | **69.6** | **88.4** | **95.0** |

## メインドキュメント

`docs/ui-ux/UI_UX_Design.md` を参照。約 2,000 行 / 29 章 / Phase 別ロードマップ付き。

主要トピック:
- プロダクト原則 / North Star Metric / Activation 復帰導線
- ペルソナ × JTBD × 画面マッピング（4 ペルソナ × 6 JTBD × 30 画面）
- 状態機械（DISCOVERED→...→COMPLETED）を IA / 色 / アイコン / 文言で統一
- HITL ステートマシン（REVIEW_REQUIRED / SEMI_AUTO / FULL_AUTO）
- レート制御 / ウォームアップ / CircuitBreaker（自動送信暴走防止）
- 監査ログ append-only + hash chain（SOC2 / ISO27001 / GDPR 適合）
- SLO バーンレート方式 + Runbook 7 件
- プライシング 4 階層 + 休止プラン + 14 日無料トライアル
- 受信箱オーナーシップ / ルーティング / SLA
- 脅威モデル 7 件と対策
- 文言ガイドライン / エラー文テンプレ集

## 親ドキュメント

`LinkedIn自動営業SaaS構築設計書.docx` — 戦略 / アーキテクチャ / ライセンス（GPL汚染回避）/ Phase ロードマップ / ランニングコスト。
