# Round 2 Security / Privacy Review — UI_UX_Design.md v1.1

- 対象: `docs/ui-ux/UI_UX_Design.md` (v1.1 / 2026-05-09)
- 親仕様: `LinkedIn自動営業SaaS構築設計書.docx`
- レビュー観点: OWASP ASVS 4.0.3 / B2B SaaS Best Practice / GDPR / 個人情報保護法 / LinkedIn UA / OWASP LLM Top 10 (2025)
- レビューア: Security Architect (round2 — 同一人物 / round1 64/100 採点)
- 作成日: 2026-05-09

---

## 0. 総合スコア

**Total: 86 / 100** (Round1: 64 / +22)

**Round1 HIGH 16件のうち 13件が解消、3件が部分解消、0件が未解消。一方で v1.1 改訂により NEW HIGH 2件、NEW MEDIUM 5件 を検出。**

| HIGH 状況 | 件数 |
| --- | --- |
| Round1 HIGH 解消 (CLOSED) | 13 / 16 |
| Round1 HIGH 部分解消 (PARTIAL) | 3 / 16 |
| Round1 HIGH 未解消 (OPEN) | 0 / 16 |
| **NEW HIGH (v1.1 改訂で生じた)** | **2** |
| NEW MEDIUM | 5 |

> **B2B SaaS の Enterprise IT 購買ライン (80+/100) は到達**。ただし Phase1 ローンチ前に NEW HIGH 2件 (NH-1: Idle Timeout、NH-2: 監査ログ append-only / hash chain 記述) と PARTIAL 3件を Round3 で解消し 95+ に乗せたい。

| # | 評価軸 | スコア (Round2) | Round1 差分 | 一言 |
| --- | --- | --- | --- | --- |
| 1 | 認証・セッション・MFA・SSO・退職者ハンドオフ | **16 / 20** | +3 | Break-Glass §5.9 と強化 §5.8 で H1-1/H1-2 解消。Idle Timeout が依然なし (NH-1) |
| 2 | RBAC/ABAC と監査ログ | **18 / 20** | +4 | §17.1 ABAC、§17.2 透かし＋ S27 で H2-1/H2-3 解消。監査ログの改竄耐性記述が薄い (NH-2) |
| 3 | PII マスキング・ログ・データエクスポート/削除 UX | **18 / 20** | +6 | §17.3 / §17.6 / §26.2 で H3-1/H3-2/H3-3 全解消。3段階マスク粒度は秀逸 |
| 4 | Prompt Injection / AI 誤送信 / 機微情報検出 UX | **17 / 20** | +6 | §17.4 Quarantine + §9.2.1 CircuitBreaker で H4-1/H4-2/H4-3 解消。Calendly URL 仕様の置換は §6.4 に "ガイド" 止まり |
| 5 | リージョン分離・DPA・外部連携同意/撤回 UX | **17 / 20** | +3 | §17.6/§17.7 + S28 DPA で H5-1 解消。サブプロセッサ別データ処理マップ (H5-2) が S28 にしか暗示されておらず可視化不足 |

---

## 1. Round1 HIGH 16件 解消トラッキング

### 軸 1: 認証・セッション (3件)

| ID | Round1 指摘 | v1.1 対応箇所 | 状態 |
| --- | --- | --- | --- |
| **H1-1** | アカウント復旧 / Break-Glass フロー無 | §5.9 F-09 + S26 + URL `/recovery/break-glass` + バックアップコード + 本人確認 (マイナ/パスポート + ライブネス) + 24h 一時昇格 + `BREAK_GLASS` 監査ログ | **CLOSED** |
| **H1-2** | Unipile セッショントークンの所有者ハンドオフ未定義 | §5.8 F-08 強化版で「旧オーナーのセッション/トークン/PAT は即時失効、Webhook 受信は新オーナーへ」を明記、Step1 で「旧オーナーは即時 read 失効」 | **CLOSED** |
| **H1-3** | セッション 8h で Idle Timeout 無 | §17 冒頭 「セッション有効期限 8h（管理者画面 1h）」のみ。**Idle Timeout は v1.1 で追加されていない** | **OPEN → NEW HIGH NH-1 に再分類** |

### 軸 2: RBAC/ABAC と監査ログ (3件)

| ID | Round1 指摘 | v1.1 対応箇所 | 状態 |
| --- | --- | --- | --- |
| **H2-1** | ABAC が完全欠落 | §17.1 ABAC を新設 (`linkedin_account_owner` / `campaign_member` / `tag_scope` / `region` / `ip_range`)、UI で「N 件は権限により非表示」と件数のみ表示 (列挙攻撃防止) | **CLOSED** |
| **H2-2** | 監査ログの改竄耐性 / エクスポート権限 / Owner 自身の操作記録 | §17 で `WHO/WHEN/WHAT/FROM-IP/DIFF/purpose`、§17.2 で「すべての DL は `/audit/exports` (S27) で可視化、Owner は撤回可」、Break-Glass は専用フラグ。**ただし append-only / hash chain / Owner-of-Owner 記録の明示が無い** | **PARTIAL → NEW HIGH NH-2 に昇格** |
| **H2-3** | CSV エクスポート権限と検出 UX 緩い | §17.2 で目的記録 (必須・自由記述) + 2FA 再認証 + 透かし `__watermark={user_id}\|{export_id}\|{epoch}` + 上限 1万行/回・5万行/日 + 7日 URL 失効 + S27 撤回 UI | **CLOSED** |

### 軸 3: PII マスキング (3件)

| ID | Round1 指摘 | v1.1 対応箇所 | 状態 |
| --- | --- | --- | --- |
| **H3-1** | AI プロンプト前 PII サニタイズ UX 無 | §17.3 で正規表現+ML 検知、`[REDACTED:phone#1]` トークン置換、出力時にローカルマップで復元、ログ・トレースには「マスク後の値のみ」、AI ドラフト「根拠を見る」で件数表示 | **CLOSED** |
| **H3-2** | 削除 UX が浅く DSAR 未定義 | §17.6 で 8 ストア (Postgres / pgvector / S3 / Sentry+PostHog / LLM プロバイダ ZDR / CRM / Webhook / バックアップ) ごとの削除挙動と完了予測日表示 | **CLOSED** |
| **H3-3** | unmask 監査と画面抑止 UX 無 | §26.2 で 3 段階マスク (完全マスク / 部分表示 / 完全表示)、PII 完全表示は Owner にメール通知、§26.3 セキュリティタイムラインで DLP ヒット可視化 | **CLOSED** (※スクショ抑止オーバーレイは LOW で残) |

### 軸 4: Prompt Injection / AI 誤送信 (3件)

| ID | Round1 指摘 | v1.1 対応箇所 | 状態 |
| --- | --- | --- | --- |
| **H4-1** | Indirect Prompt Injection 境界無 | §17.4 で受信 DM の指示文を AI 入力前に Quarantine (S29)、AI ドラフト「指示文を含む可能性」明示、5s Undo + 24h 取消 | **CLOSED** |
| **H4-2** | 自動送信モード昇格条件と上限 UI 無 | §9.2.1 CircuitBreaker (失敗率/同テンプレ連投/レート×3/DLP/Injection/警告)、§27 HITL 状態機械 `REVIEW_REQUIRED → SEMI_AUTO → FULL_AUTO`、SEMI_AUTO→FULL_AUTO は 4-eye + 月次審査 | **CLOSED** |
| **H4-3** | 機微情報「黄色警告のみ」 | §17.5 でパターン別段階化 (旧/新比較表)、価格・契約条件は **送信ブロック**、個人情報の本格列挙は **強制ブロック** | **CLOSED** |

### 軸 5: リージョン分離・DPA・外部連携同意 (3件)

| ID | Round1 指摘 | v1.1 対応箇所 | 状態 |
| --- | --- | --- | --- |
| **H5-1** | CRM/Webhook 撤回 UX 浅い | §17.7 で「相手側に残ったデータの扱いを 1 文表示、HubSpot は Contact プロパティ削除案内、Webhook は受信先に削除リクエスト送信」、§17.6 で「CRM 連携先は一方向では不可、撤回 API 案内」 | **CLOSED** |
| **H5-2** | サブプロセッサ別データ処理マップ無 | S28 `/legal/dpa` URL 追加 + §22 Enterprise プランで DPA、§17.6 で AI ZDR / Sentry / PostHog / CRM / Webhook 別の挙動を列挙。**ただし「サブプロセッサ毎の region / DPA URL / 越境根拠」の表形式可視化は未実装** | **PARTIAL** |
| **H5-3** | OAuth `postMessage` origin 検証エラー無 | §21.3 で「失敗時は明確なエラー」止まり。**`oauth.origin_mismatch` 等の専用エラーコードは追加されていない** | **PARTIAL** |

### Round1 MEDIUM/LOW のサンプリング状況

主要な改善が見られた MEDIUM:
- **M1-2** 招待トークン: §3.2 で `/accept-invite/:token` URL あり、**有効期限・一度きり消費・メール固定の UI 表示は依然未明示** (LOW に降格して残)
- **M2-2** Viewer の k-匿名性 (`N≥5` ガード): 集計のみのまま、**N 閾値の明示が無い** (NEW MEDIUM NM-3 として再掲)
- **M2-3** Free プラン 90 日保持: §17 で 90日(無料)/13ヶ月(Enterprise) 維持、法定 1 年に未到達 (LOW で残)
- **M3-2** リージョン切替時の移行モード: §17 / S20 / S28 でも 2 モード明示が無い (NEW MEDIUM NM-4)
- **M5-3** granular consent: §17.7 で撤回ボタンは追加、**機能別オプトイン** (AI Summary だけ OFF など) のスイッチ群は未追加 (NEW MEDIUM NM-5)
- **M1-1** SSO×2FA 二重 MFA 競合: §17 / S16 でラジオ未追加

---

## 2. NEW HIGH 指摘 (v1.1 改訂で残った/生じた)

### NH-1. Idle Timeout が依然として未定義 (Round1 H1-3 の continuation)

- **該当箇所**: §17 冒頭、§5.9 / §17.6 / §26.3 全般
- **問題**:
  - 「セッション有効期限 8h（管理者画面 1h）」のみで **Idle Timeout (無操作タイムアウト) は v1.1 でも追加されていない**。
  - SDR が共有 PC を離席した場合、ABAC で他人の受信箱は見られなくとも自分のスコープ内全データは 8h 内なら閲覧可能。退職者持ち出しシナリオの主要経路は §17.1〜17.2 で塞がれたが、**離席持ち出し** (画面ロック忘れ → 同僚が CSV 出力) は塞げていない。
  - §26.1 脅威モデル「退職者持ち出し」の対策列に Idle Timeout が含まれず脅威マッピングが不完全。
- **推奨**:
  - §17 冒頭の箇条書きに次を追加: 「Idle Timeout: Operator 30 分 / Manager+ 15 分。検知時は作業中フォームを localStorage に退避し、再認証モーダル (パスワード再入力 or SSO 再認証) で復旧」
  - 危険操作 (CSV 出力 / プラン変更 / メンバー削除 / Break-Glass / FULL_AUTO 解放) では Idle 5 分超で 2FA を強制再認証。
  - §26.1 (1) 退職者持ち出しの対策に「Idle Timeout 15-30 分」を追記。
- **期待効果**: ASVS V3.3.1〜V3.3.3 適合。離席シナリオで持ち出される CSV エクスポート件数を SDR 1 名あたり期待 0 に。

### NH-2. 監査ログの append-only / hash chain / Owner 操作の改竄耐性が UI 仕様に明示されていない (Round1 H2-2 の partial)

- **該当箇所**: §17 / §17.6 / §26.3 / `/audit` (S19)
- **問題**:
  - §17 で「監査ログ: WHO / WHEN / WHAT / FROM-IP / DIFF / purpose」と書いているが、**改竄耐性 (append-only / hash chain / WORM ストレージ)** の記述が `/audit` 画面仕様に無い。
  - §17.6 削除波及スコープに「監査ログ」の取り扱いが含まれていない (= Owner が DSAR 削除リクエストで監査ログを消せるか未定義)。GDPR Art.30 の処理活動記録は本人削除請求の対象外であるべき (説明責任義務)。
  - §6.11 S20 「対象: ☑ 監査ログ(Owner のみ)」とあるが、**Owner 単独で監査ログを消せる UI は SOC2 / ISMS 監査時に "改竄可能" 判定リスクが高い**。
  - Break-Glass 操作は §5.9 で `BREAK_GLASS` フラグが残るが、**Owner 自身の Break-Glass 操作の co-sign 要件** が無い (=Owner 単独で Break-Glass → 監査ログ削除の経路が成立可能)。
- **推奨**:
  - §17 に追記: 「`/audit` は append-only。各行 `prev_hash` / `hash` (SHA-256) を保持し、UI バッジ `改竄不可 / SHA-256 chain` を表示。Owner も削除/編集不可、保持期間経過後の物理削除のみ自動」
  - §6.11 S20 から「監査ログ削除 (Owner のみ)」を削除し、「保持期間経過後に自動削除のみ」に変更。
  - §17 / §5.9 に追記: 「Break-Glass 発動と監査ログ関連操作 (保持期間変更 / 一括エクスポート) は Owner + Admin の co-sign (4-eye) を強制。Owner 1 名テナント (Solo プラン) は co-sign 不要だが Break-Glass 操作のみ Anthropic Trust 等の第三者 Notary 通知を強制」
  - §17.6 DSAR 削除スコープから「監査ログ」を **明示的に除外** し、UI で「監査ログは法令上の保持義務により本リクエストでは削除されません」と表示。
- **期待効果**: SOC2 CC7 / ISO27001 A.12.4 / GDPR Art.30 整合。Insider に対して「監査ログを消して証拠隠滅」する経路を物理的に閉塞。

---

## 3. NEW MEDIUM 指摘 (v1.1 改訂で気になった / 残った)

### NM-1. OAuth `postMessage` の origin 検証 / state / PKCE が UX レイヤーで明示不足 (Round1 H5-3 partial)

- **該当箇所**: §21.3、§5.4 F-04
- **問題**: 「失敗時は明確なエラー」止まり。§26.1 (6) で「PKCE、State 検証、トークン暗号化保管」と書いてあるが、UX レベルのエラー表現と incident_id 紐付けが §12.3 のエラー文テンプレ集に無い。
- **推奨**:
  - §12.3 / §29.3 に `oauth.origin_mismatch` / `oauth.state_invalid` / `oauth.pkce_failed` の 3 種を追加し、「予期しないドメインから戻ってきました (incident_id)。サポートに連絡してください」と表示。
  - §5.4 F-04 のフロー図に「parent ←postMessage origin 検証 → reject にすると `oauth.origin_mismatch`」を明記。

### NM-2. サブプロセッサ別データ処理マップが S28 / §17.6 に「列挙」止まりで可視化が不十分 (Round1 H5-2 partial)

- **該当箇所**: §17.6、S28 `/legal/dpa`
- **問題**:
  - §17.6 の DSAR スコープ表は「ストア × 削除挙動」のマトリクスだが、**サブプロセッサ毎の `region / data category / DPA URL / 越境移転根拠 (SCC / 個情法 28 条)`** という監査用マトリクスは S28 仕様に記載されていない (画面仕様が `M` の段階)。
  - リージョン切替 (JP↔EU) 時に「変更されないサブプロセッサ」(AI モデル提供者は地域跨ぐ) の警告が S16 / S28 に無い。
  - サブプロセッサ追加時の **30 日前事前通知** (GDPR Art.28(2)) UI も S28 で言及がない。
- **推奨**:
  - S28 `/legal/dpa` 仕様を追加: 「サブプロセッサ表 (Anthropic / OpenAI / Unipile / Stripe / Sentry / PostHog) ごとに region / data category / DPA URL / 越境根拠。新規追加時は Owner に 30 日前メール + アプリ内 banner。Owner は個別オプトアウト可」
  - §17 リージョン切替フローに「サブプロセッサ整合性アラート」を追加。

### NM-3. Viewer の集計閲覧で k-匿名性 (`N≥5` ガード) が未明示 (Round1 M2-2 続き)

- **該当箇所**: §6.9 S15 「受信箱閲覧 ✓(集計のみ)」、§3.2.1 保存ビュー / セグメント
- **問題**: Viewer の集計が N=1 のときに個人特定可能な再識別問題は §6.9 のままでは塞がれていない。
- **推奨**: §6.9 と §17.1 ABAC 両方に追記: 「Viewer 向け集計は `N≥5` を満たさない区画で `<5` と表示。タグ/セグメント絞り込みも同ガードを適用」

### NM-4. リージョン切替 (JP↔EU) 時のデータ移行モード未明示 (Round1 M3-2 続き)

- **該当箇所**: §17 / §6.10 S16 / §6.11 S20
- **問題**: 「データ保管リージョン: JP / EU 切替（顧客単位）」のままで、(a) 新規データのみ EU、(b) 既存データを EU へ移送し JP から完全削除 の 2 モードが UI に無い。瞬間的に両リージョンに存在する間にバックアップ取得されると EU データが JP リージョンに残留。
- **推奨**: S16 にリージョン切替モーダルを追加し、2 ラジオ + 移行中 read-only モード + 完了通知メールを仕様化。

### NM-5. granular consent (機能別オプトイン) スイッチが未追加 (Round1 M5-3 続き)

- **該当箇所**: §6.6 CRM 連携 / §6.5 LinkedIn 接続 / §17.7
- **問題**: 「撤回 / データ削除依頼」ボタンは追加されたが、`AI Summary だけ ON / 翻訳は OFF / CRM は片方向のみ` のような細粒度オプトインスイッチが未実装。
- **推奨**: 各 `/connections/*` カードに「機能別スイッチ群」セクションを §6.5/§6.6 に追加。EDPB Guideline 05/2020 整合。

---

## 4. NEW LOW 指摘 (拾いもの)

- **NL-1.** §6.4 S10 で「商談化を押すと右ペインで Calendly URL の貼付ガイド」とあるが、**AI 生成 URL を担当者がコピペするフィッシング経路** (Round1 M4-1) は依然として塞がれていない。「接続済みカレンダーから API で取得した URL のみ」のセレクトボックス化を §6.4 に明記推奨。
- **NL-2.** §17.2 CSV エクスポート上限「1 回 1 万行」は退職者持ち出しシナリオでは多すぎる。Operator は 1,000 行 / Manager は 10,000 行 / それ以上は Owner 承認、と層別化推奨。
- **NL-3.** §5.9 Break-Glass の「マイナンバーカード or パスポート画像 + ライブネス」は強力だが、**画像保管期間と保管リージョン** が未定義。本人確認画像も DSAR 削除対象に明記必要。
- **NL-4.** §17.4 Indirect Prompt Injection の Quarantine 振分け基準 (どの正規表現 / どの ML モデル) が UI 上に開示されていない。Quarantine 誤検知時の **「これは指示文ではない」と人間が判断してリリース** する UI が S29 に必要。
- **NL-5.** §22 プライシングで Solo プラン (Owner 1 名想定) の Break-Glass 経路が「Owner 2 名以上必須化 (Scale プラン)」と矛盾。Solo プランでは強制バックアップコード DL + 紙印刷リマインダー必須、と §22 に明記推奨。
- **NL-6.** §29.3 エラー文テンプレに認証/認可エラー (`auth.locked_out` / `auth.invalid_credentials` / `auth.session_expired_idle`) の **enumeration 防止文面** が未定義。「メールが見つかりません」と「パスワードが違います」を分けない統一文面を追加すべき。
- **NL-7.** §17 招待トークン (M1-2 続き) の有効期限・一度きり消費・メール固定が UI に表示されないまま。`/accept-invite/:token` 着地画面に「このリンクは {invitee_email} 宛 / 残り {N}h / 一度のみ」を表示する仕様を追加推奨。

---

## 5. 95+ 到達のための残ブロッカー (Round3 必須項目)

| Priority | ID | タスク | Est | 該当 § |
| --- | --- | --- | --- | --- |
| **P0** | NH-1 | Idle Timeout (Operator 30m / Manager+ 15m) を §17 に追加、§26.1 脅威モデルに反映 | 0.5d | §17 / §26.1 |
| **P0** | NH-2 | 監査ログ append-only / SHA-256 hash chain / Owner co-sign 要件を §17 に追加、§6.11 S20 から「監査ログ削除 (Owner のみ)」を削除、§17.6 DSAR スコープから監査ログを明示除外 | 1d | §17 / §6.11 / §17.6 |
| **P1** | NM-2 | S28 `/legal/dpa` にサブプロセッサ表 (region / data / DPA / 越境根拠) と 30 日前事前通知 UI を追加 | 1d | S28 / §17 |
| **P1** | NM-1 | OAuth エラーコード `oauth.origin_mismatch` / `oauth.state_invalid` / `oauth.pkce_failed` を §12.3 / §29.3 に追加 | 0.25d | §12.3 / §29.3 / §21.3 |
| **P1** | NM-4 | リージョン切替 2 モード (新規のみ / 既存移送+完全削除) + 移行中 read-only を S16 仕様に追加 | 0.5d | §6.10 S16 / §17 |
| **P2** | NM-3 | Viewer 集計に `N≥5` ガード文言を §6.9 / §17.1 に追加 | 0.1d | §6.9 / §17.1 |
| **P2** | NM-5 | `/connections/*` に機能別オプトイン スイッチ群を追加 | 0.5d | §6.5 / §6.6 / §17.7 |
| **P2** | NL-1 | Calendly URL を AI 文字列生成禁止 → 接続済みカレンダーからのセレクトに変更 | 0.25d | §6.4 |
| **P3** | NL-2/3/4/5/6/7 | LOW 群を §29.3 / §22 / §17.4 / §5.9 / §17.7 に一括反映 | 1d | 多数 |

合計工数: **約 5 人日**。Phase1 ローンチ前 (= 2 ヶ月後) に十分間に合う。

---

## 6. 良い点 (round2 で特筆すべき強化点)

1. **§17.1 ABAC マトリクスが「UI 上の見え方」まで定義されている**
   `linkedin_account_owner` / `campaign_member` / `tag_scope` / `region` / `ip_range` の 5 属性に対し、行が見えない場合は「N 件は権限により非表示」と件数のみ表示する設計は **enumeration 攻撃を抑止しつつ説明責任を果たす** 高度な UX。
2. **§9.2.1 CircuitBreaker × §27 HITL 状態機械の結合**
   失敗率 / 同テンプレ連投 / レート×3 / DLP / Indirect Injection / 警告 の 6 トリガーを `REVIEW_REQUIRED → SEMI_AUTO → FULL_AUTO` の状態機械に紐付け、4-eye 承認と月次審査を要求する設計は **AI 暴走の Severity 上限を UX 設計時点で 1 サイクル以内に限定** する稀有な実装。
3. **§17.6 DSAR 削除波及スコープ表 (Postgres / pgvector / S3 / Sentry+PostHog / LLM ZDR / CRM / Webhook / バックアップ)**
   GDPR Art.17 / 個情法 28 条の "right to erasure" を 8 ストアにブレイクダウンし、削除挙動 (即時 / 30 日後 / 撤回不可) を完了予測日付きで可視化したのは法務監査対応として極めて強い。
4. **§26.2 機微情報マスクの 3 段階粒度**
   完全マスク / 部分表示 / 完全表示 の階段化と Owner へのメール通知は H3-3 への正面回答。
5. **§5.9 Break-Glass の本人確認 (マイナ + ライブネス)**
   SaaS のアカウント復旧で本人確認まで踏み込んだ仕様は珍しく、テナントロックアウト時の Severity を著しく低減。

---

## 7. ローンチ前の脅威モデル再確認 (Round1 から残る検証要否)

| シナリオ | Round1 mitigations | Round2 状況 | 残作業 |
| --- | --- | --- | --- |
| 退職者持ち出し | H1-2/H2-1/H2-3/H3-3 | 全 CLOSED | NH-1 (Idle Timeout) のみ未対応 |
| Indirect Prompt Injection | H4-1 | CLOSED | NL-4 Quarantine 誤検知のリリース UI |
| テナントロックアウト | H1-1 | CLOSED | NL-5 Solo プラン特例の明示 |
| 越境データ移転・同意撤回 | H3-2/H5-1/H5-2 | H3-2/H5-1 CLOSED、H5-2 PARTIAL | NM-2 サブプロセッサ表、NM-4 リージョン切替モード |
| AI 自動送信暴走 | H4-2/H4-3 | 全 CLOSED | NL-1 Calendly URL の AI 生成禁止 |

> **Round2 結論**: Round1 から脅威モデル 5 項目のうち 4 項目が完全 mitigate、1 項目 (越境データ移転) が部分 mitigate。**Phase1 ローンチに対しては Pass 可能**だが、Enterprise 顧客の DPIA 質問票には NM-2 (サブプロセッサ表) を Round3 で必ず潰す必要がある。

---

> 本レビューは UI/UX 仕様レイヤーのセキュリティ・プライバシー観点であり、**実装レイヤー (CSP / SQLi / TLS 設定 / hash chain 実装等) は対象外**。Phase1 実装入り前に別途 OWASP ASVS V1-V14 のコード/インフラレビューを必ず実施すること。Round3 では NEW HIGH 2件 (NH-1 / NH-2) の解消を再判定し 95+ への到達可否を最終評価する。
