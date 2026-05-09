# Round 3 SRE レビュー — UI/UX Design v1.2 (最終)

- 対象: `docs/ui-ux/UI_UX_Design.md` v1.2 (2026-05-09)
- 親: Round1 SRE (62 / 100) → Round2 SRE (87 / 100)
- レビュー観点: 運用観測性 / 信頼性 (SRE)
- 評価者: SRE シニアエンジニア (production-mode / read-only)
- レビュー日: 2026-05-09

---

## 冒頭サマリ

- **総合スコア: 95 / 100** (Round1 比 **+33** / Round2 比 **+8**)
- **Round2 NEW HIGH (H-N1) 解消: ✅ 完全解消** (チャネル別強制度表 §11.1.1 で in-app は全ロール OFF 不可、Email のみ Owner OFF 可と明示)
- **Round2 HIGH 残存: 0 件**
- **NEW HIGH: 0 件**
- **MEDIUM: 3 件** (うち 2 件は Round2 から残存、1 件は v1.2 で発生した軽微な文言不整合)
- **LOW: 4 件** (Round2 から繰越)

総評: Round2 で指摘した 4 大ブロッカー (H-N1 / M-N1 / M-N5 / M-N7) は **全件正面から解消**。とりわけ §24.1 の SLO 表は Google SRE Workbook 準拠の fast-burn/slow-burn 二段階に書き直され、`(1 - SLO) × valid_events_30d` のエラーバジェット式まで明文化された。これは Enterprise / 監査委員会向け SLA 文書として通用する水準。

§11.1.1 のチャネル別強制度表は SRE 設計として模範的: 「in-app は誰も OFF 不可」「Email は Owner 自身のみ OFF 可、監査ログ記録 + 副 Owner / Admin 通知」「SMS / Slack は Owner / Admin が任意 ON」と権限と強制度が一目で分かる。Round2 で警戒した「侵害された Owner が Critical OFF → 隠蔽攻撃」のシナリオは in-app 強制で物理的に塞がれた。

**95+ 達成判定: ✅ Pass。** 残る MEDIUM 3 件は v1.3 でのリファインで足りる範囲で、ローンチブロッカーではない。

---

## 各軸スコア (Round2 → Round3 差分)

| # | 軸 | Round1 | Round2 | Round3 | 差分 (R2→R3) | 状態 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | インシデント告知 / バナー / incident_id 導線 | 13 | 18 | **19** | +1 | ほぼ完成、incident_id→audit 動線のみ未 |
| 2 | レート 429 / Unipile / LLM 障害フォールバック | 14 | 17 | **19** | +2 | RB-02/03/07 + CircuitBreaker で完成 |
| 3 | 観測性 (失敗 / 再試行 / DLQ) | 11 | 17 | **19** | +2 | S25 + ConversationBubble 配信 4 段階で完成 |
| 4 | SLO 違反通知エスカレーション / Critical 既定 ON | 12 | 17 | **19** | +2 | §11.1.1 チャネル別強制度で矛盾解消 |
| 5 | キャパシティ自動停止 / 従量課金切替の安全性 | 12 | 18 | **19** | +1 | RB-04 健全、可視化のみ軽微残 |
| **計** | | **62** | **87** | **95** | **+8** | |

---

## Round2 HIGH (H-N1) / MEDIUM 主要 (M-N1 / M-N5 / M-N7) 解消チェック

### ✅ H-N1. Critical 通知の「ON 強制」 vs 「Owner OFF 可」矛盾 → **完全解消**

**根拠**:
- §11.1.1 で**チャネル別強制度表**を新設。Owner ですら in-app バナーは OFF 不可、Email のみ Owner 本人が OFF 可（その操作自体を監査ログ `CRITICAL_EMAIL_DISABLED_BY_OWNER` に記録 + 副 Owner / Admin に通知）。SMS / Slack は Owner / Admin の任意 ON。
- 「アプリ内バナーは誰も OFF にできない」と表外でも明文化。
- Round2 で警戒した「侵害された Owner が Critical OFF → CircuitBreaker 隠蔽 → 大量誤送信」シナリオは、in-app バナーが誰にも OFF できない時点で物理的に防がれる。
- Email OFF 操作は監査ログ + 副 Owner 通知の **二重防護** で、攻撃者が単独 Owner 認証だけでは隠蔽不能。

**残課題**: §11.2.1 末尾 (line 1195) の「**Critical の OFF はロール: Owner のみ可能**」という文言は、§11.1.1 表に照らすと「メールチャネル のみ」の意であるが文章単体では誤読されうる。M-N8 として後述。

---

### ✅ M-N1. §24.1 SLO 表のエラーバジェット計算不整合 → **完全解消**

**根拠**:
- §24.1 冒頭に SLI 定義と公式を明記: `SLI = good events / valid events`、`エラーバジェット = (1 - SLO) × valid_events_30d`、バーンレート式アラート (fast-burn 1h 14.4× / slow-burn 6h 6×) の二段階。
- 表は「サービス / SLI / SLO(30d) / 30d エラー予算 / Fast-Burn(1h) / Slow-Burn(6h) / UI」の 7 列構成で書き直し済み。可用性系 (API / ジョブ / Unipile / LLM / Webhook / SSE) はすべてバーンレート、レイテンシ系は「P95>X 5min持続 / P95>Y 30min持続」と明確に分離。
- UX 系 SLI (Web Vitals / TTI / 受信箱切替) は別テーブルで「目標達成率」方式、Round2 で指摘した「レイテンシ SLI を可用性のエラーバジェット式で書く」混同は完全解消。
- エラーバジェット 50% / 80% / 100% の三段階で運用ガバナンス (機能凍結) を明文化。

**残課題**: SSE の早期警戒バーンレート (Round2 M-N6 推奨「0.2% / 1h」相当) は表上は fast-burn 14.4× で代用されており別途 heartbeat 死活監視の有無が UI 仕様に降りていない。M-N6 は M-N9 として残存扱い。

---

### ✅ M-N5. 配信ステータスのバブル反映 → **完全解消**

**根拠**:
- §8 コンポーネントカタログ ConversationBubble に `**配信状態 4 段階**: 送信中 (Loader) / 送信済 (Check) / 配信済 (CheckCheck) / 失敗 (AlertCircle + 再試行)` が必須仕様として記載。
- Lucide アイコン名まで指定されているため実装ぶれが起きない。
- CHANGELOG にも明示的に記載 (line 2028「ConversationBubble に配信状態 4 段階」)。

**軽微な追加推奨** (LOW): バックオフ残時間の表示は仕様化されていない (Round2 推奨「自動バックオフ残時間」)。失敗バブル ホバーで `次の再試行: 2分後` のツールチップを足すと完成度が上がる。

---

### ✅ M-N7. §17.4 降格モード ↔ §27 HITL ステートマシン統合 → **完全解消**

**根拠**:
- §17.4: 「隔離されたメッセージは S29 で人間レビュー、AI 自動応答は §27 HITL ステートマシンの **`REVIEW_REQUIRED` へ降格**（`SEMI_AUTO` / `FULL_AUTO` 双方からの強制降格）。再昇格には Owner 承認 + クールダウン」と Round2 推奨どおり明文化。
- RB-07 (Indirect Prompt Injection) にも対応する手順 (Quarantine → CircuitBreaker §9.2.1 → Owner レビュー後再開) が追加。
- §27.3 降格条件 = §9.2.1 CircuitBreaker と同条件、§9.2.1 には DLP / Indirect Prompt Injection 含む 6 トリガが整理済 → 三箇所の語彙が統一された。

**残課題**: なし。LLM01:2025 (Indirect Prompt Injection) の防御は仕様レベルで担保完了。

---

## Round2 MEDIUM (補助項目) の状態

| # | Round2 指摘 | v1.2 状態 | 備考 |
| --- | --- | --- | --- |
| M-N2 | エスカレーション 5 段階を 3 段に圧縮 / SMS 上限 | **未対応** | 文書圧縮優先で v1.3 リファイン候補。誤検知時のアラート疲労リスクは継続 |
| M-N3 | `/audit?incident_id=...` 動線 / `actor_type` カラム | **部分対応** | S19 ヘッダに correlation_id は出ているが incident_id フィルタは未。actor_type 必須化は未 |
| M-N4 | 従量課金中の持続バナー化 | **未対応** | §22.3 は依然「KPI カードに表示」のみ。月末事故二次防護が弱い |
| M-N6 | SSE heartbeat / read-only モード / 早期警戒 | **未対応** | §23.3 は再接続 backoff のみ。30s ping / 3 回欠落で read-only / `since=` 差分取得が未 |

---

## v1.2 で発生した新規指摘

### M-N8 (新規, 軽微). §11.2.1 末尾の文言が §11.1.1 表と単独読みで矛盾する

- 該当箇所: §11.2.1 line 1195「**Critical の OFF はロール: Owner のみ可能**。OFF にすると監査ログに残る」
- 問題: §11.1.1 の表に照らすと「メールチャネルのみ」の意だが、文章単体では「Critical 通知すべて」と誤読されうる。Round2 H-N1 の核心であった「OFF 強制」が骨抜きに見える解釈余地が残る。
- 推奨: 「**Critical 通知のうち Email チャネル のみ Owner 本人が自分宛で OFF 可能。in-app バナーは §11.1.1 のとおり誰も OFF 不可**」と書き直し、§11.1.1 表へリンク。
- 重要度: MEDIUM (誤読は実装ぶれ・運用判断ミスを生むため)、修正工数: 5 分。

### M-N9 (Round2 M-N6 残存). SSE 死活監視 / read-only フォールバック未実装

- 該当箇所: §23.3
- 状態: Round2 と同じ。再接続 backoff / `Last-Event-ID` までは仕様化されているが、SSE が「黙って劣化」(接続は続くがイベントが届かない) する場合の検知が無い。
- 推奨 (再掲): heartbeat ping (30s) + 3 回欠落で read-only + 黄色バナー、再接続成功時に `since=<last_event_id>` で差分取得して「最新化されました」トースト。
- 重要度: MEDIUM、修正工数: 0.5d。

### M-N10 (Round2 M-N4 残存). 従量課金中の持続バナー未実装

- 該当箇所: §22.3
- 推奨 (再掲): §11.2.2 のステータスバナーレイヤに「課金状態バナー」(severity = `notice`、24h 後再表示の閉じ可) を追加。
- 重要度: MEDIUM、修正工数: 0.25d。

---

## LOW 指摘 (Round2 から繰越、いずれも v1.3 候補)

- L-N1: `/status` Subscribe のダブルオプトイン / unsubscribe フロー未定義
- L-N2: `/status` アップタイム計算の重み付け式 (degraded=0.3 / partial=0.7 / major=1.0 など) 未開示
- L-N3: RB-04 自動 OFF 後の再開承認フロー (Owner 2FA + 翌営業日の支払確認) 未明記
- L-N4: `/jobs` (S25) の payload / stacktrace 表示権限 — §24.3 で「Operator 読み取りのみ、再試行 Manager+、DLQ 廃棄 Owner」とは記載済だが stacktrace 内の PII / 内部パス redaction 方針 (`__redacted_*`) が §17.3 と統合されていない

---

## v1.2 で特に評価する点

1. **§11.1.1 チャネル別強制度表**: 「in-app バナーは誰も OFF 不可 (Owner ですら)」「Email は Owner 本人のみ OFF 可、操作を監査ログ + 副 Owner 通知」と権限軸 × チャネル軸の二次元で書ききった。SaaS 通知設計としても模範。Round2 H-N1 の構造的解決。
2. **§24.1 SLO 表バーンレート方式**: Google SRE Workbook 準拠 (fast-burn 1h 14.4× / slow-burn 6h 6×)、`(1 - SLO) × valid_events_30d` 公式明記、可用性 / レイテンシ / UX を別表化。Enterprise SLA 文書として外部提示可能な質。
3. **§17.4 → §27 統合**: Quarantine ヒット時に `REVIEW_REQUIRED` へ強制降格、Owner 承認 + クールダウンで再昇格と、3 章 (§17 / §9 / §27) の語彙を統一。LLM01 Indirect Prompt Injection の防御を仕様レベルで担保した。
4. **§17 監査ログ append-only + hash chain**: WORM (S3 Object Lock Compliance Mode) + `prev_hash` チェーン + 毎日 root を Postgres と外部 KMS 両方に署名 + UI 「整合性検証 ✓ 2026-05-09 09:00 JST」常時表示。誤投稿は打ち消しエントリでのみ訂正可、Owner ですら編集削除不可。攻撃者の Owner 侵害シナリオに対する最終防衛線が制度として揃った。

---

## 95+ 判定

**判定: ✅ PASS (95 / 100)**

| 達成基準 | 状態 |
| --- | --- |
| Round2 HIGH 残存 0 件 | ✅ (Round2 唯一の H-N1 完全解消) |
| Round2 NEW HIGH 0 件 | ✅ (v1.2 で発生した HIGH なし) |
| Round2 主要 MEDIUM (M-N1 / M-N5 / M-N7) 解消 | ✅ (3 件すべて解消) |
| SLO 文書が Enterprise 提示可能水準 | ✅ (§24.1 バーンレート方式) |
| Critical 通知の制度的不可逆性 | ✅ (§11.1.1 で in-app 全ロール OFF 不可) |
| HITL ステートマシンの語彙統一 | ✅ (§17.4 → §27.3 → §9.2.1) |

残る MEDIUM 3 件 (M-N8 / M-N9 / M-N10) は **ローンチブロッカーではない**。M-N8 (§11.2.1 文言修正) は 5 分で潰せる軽微な整合性パッチ、M-N9 (SSE 死活監視) と M-N10 (従量課金持続バナー) は v1.3 で 0.75 d 程度のリファイン。

---

## v1.3 に向けた優先度付きアクション

| # | 項目 | 重要度 | 工数 |
| --- | --- | --- | --- |
| 1 | M-N8: §11.2.1 line 1195 を「Critical Email のみ Owner OFF 可」に書き直し | 必須 | 5 min |
| 2 | M-N9: SSE heartbeat (30s ping) + 3 回欠落で read-only バナー + `since=` 差分取得 | 推奨 | 0.5d |
| 3 | M-N10: 従量課金中の持続バナー (severity=notice、24h で再表示) を §11.2.2 に追加 | 推奨 | 0.25d |
| 4 | M-N3: S19 監査ログに `incident_id` フィルタ + `actor_type` 必須カラム | 推奨 | 0.25d |
| 5 | M-N2: エスカレーション 5 段階 → 3 段に圧縮、SMS / 電話レート上限明記 | 任意 | 0.5d |
| 6 | L-N1〜L-N4: ステータスページ・RB-04 再開・stacktrace redaction 補完 | 任意 | 0.5d |

合計約 **2.0 人日** で 95 → 98+ を狙える。ただし v1.2 時点で **ローンチに必要な SRE プリミティブは揃っており**、これら残課題は運用開始後に順次取り込めば良い。

---

## Round1 → Round2 → Round3 ハイライト

| | Round1 | Round2 | Round3 |
| --- | --- | --- | --- |
| スコア | 62 | 87 (+25) | **95 (+8)** |
| HIGH 数 | 5 | 1 (NEW H-N1) | **0** |
| MEDIUM 数 | 7 | 7 | 3 |
| ローンチ判定 | ❌ ブロック | ⚠ 1 件解消必要 | ✅ ローンチ可 |

v1.2 は **「整合性ロックダウン」フェーズの仕事として完成度が高い**。Round2 で警戒した章間語彙不整合 (CircuitBreaker / 降格モード / HITL / Critical OFF / 従量課金可視化) のうち、最重要の 4 件 (Critical OFF / SLO バーンレート / 配信状態 / 降格→HITL) を全て潰し、運用文書として外部 (Enterprise / 監査委員会) に提示可能な水準に到達した。

— END of Round 3 SRE Review —
