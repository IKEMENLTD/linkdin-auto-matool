# Round 3 Security / Privacy Review — UI_UX_Design.md v1.2

- 対象: `docs/ui-ux/UI_UX_Design.md` (v1.2 / 2026-05-09)
- 親仕様: `LinkedIn自動営業SaaS構築設計書.docx`
- レビュー観点: OWASP ASVS 4.0.3 / B2B SaaS Best Practice / GDPR / 個人情報保護法 / LinkedIn UA / OWASP LLM Top 10 (2025) / SOC2 CC7 / ISO27001 A.12.4
- レビューア: Security Architect (round3 — Round1 64/100 / Round2 86/100 採点と同一人物)
- 作成日: 2026-05-09

---

## 0. 総合スコア

**Total: 96 / 100** (Round1: 64 → Round2: 86 → Round3: **+10**)

**Round2 NEW HIGH 2件 (NH-1 Idle Timeout / NH-2 監査ログ改竄耐性) は両方とも CLOSED。** ただし v1.2 改訂によるドキュメント整合性 1 点 (S20 と §17 の矛盾) を NEW MEDIUM として検出。HIGH 残存はゼロ。**B2B SaaS Enterprise IT 購買ライン (95+/100) を初めて越え、Phase1 ローンチ可。**

| HIGH 状況 | 件数 |
| --- | --- |
| Round1 HIGH 解消 (CLOSED) | 16 / 16 |
| Round2 NEW HIGH 解消 (CLOSED) | 2 / 2 |
| **Round3 NEW HIGH** | **0** |
| Round3 NEW MEDIUM | 1 |
| Round2 PARTIAL → CLOSED | 2 / 3 (H5-2 / H5-3 のうち H5-3 は依然 PARTIAL) |

| # | 評価軸 | スコア (R3) | R1 | R2 | R3 差分 | 一言 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 認証・セッション・MFA・SSO・退職者ハンドオフ | **20 / 20** | 13 | 16 | +4 | NH-1 Idle Timeout (一般 30m / Mgr 15m / Owner 10m / Break-Glass 5m) + デバイス管理画面で完成 |
| 2 | RBAC/ABAC と監査ログ | **19 / 20** | 14 | 18 | +1 | NH-2 完璧解消 (WORM + hash chain + Owner も削除不可 + 整合性検証バッジ常時表示)。S20 文言の整合だけ残 |
| 3 | PII マスキング・ログ・データエクスポート/削除 UX | **19 / 20** | 12 | 18 | +1 | v1.1 から維持、整合性も保たれた |
| 4 | Prompt Injection / AI 誤送信 / 機微情報検出 UX | **19 / 20** | 11 | 17 | +2 | §17.4 降格モードを §27 HITL に統合 (CHANGELOG 整合)、Quarantine + CircuitBreaker + 5s Undo の三層完成 |
| 5 | リージョン分離・DPA・外部連携同意/撤回 UX | **19 / 20** | 14 | 17 | +2 | §23.5.1 共同編集レジデンシーで H5-2 サブプロセッサ可視化が大幅前進。NM-2 の 30 日前事前通知 UI のみ未着 |

---

## 1. Round2 NEW HIGH 2件 解消トラッキング

### NH-1. Idle Timeout 未定義 → **CLOSED**

**v1.2 該当箇所**: §17 line 1397、§5.9 S26 Step 4 line 925 (`セッション Idle Timeout: 5 分`)

**確認事項**:

| 確認項目 | Round2 推奨 | v1.2 反映 |
| --- | --- | --- |
| ロール別 Idle Timeout 値 | Operator 30m / Mgr+ 15m | **一般 30m / Mgr 15m / Owner 10m / Break-Glass 5m** (4 段階で推奨より厳格) |
| タイムアウト直前の警告 | 必須 | **「あと 60 秒で自動ログアウト」モーダル + 操作で延長** |
| 危険操作の Idle 5 分超 2FA | 推奨 | §17 line 1399 で「危険操作: 二要素再認証 (CSV 出力 / プラン変更 / メンバー削除 / 自動送信 ON / Break-Glass / API キー再生成 / リージョン変更)」と網羅 |
| §26.1 脅威モデル反映 | 「退職者持ち出し」の対策列に Idle Timeout 追記 | **未反映** (line 1881 は「§17 セッション 8h」のまま、Idle Timeout の文言が脅威モデル側に追記されていない) |

> Round2 推奨を全て上回る粒度で実装。脅威モデル §26.1 の対策列文言だけが「セッション 8h」のまま残るが、§17 本文を読めば自明であり LOW 扱い (NL-1 として後述)。

**評価**: **CLOSED** (Operator/Manager/Owner/Break-Glass の 4 段階タイムアウトと事前警告は ASVS V3.3.1〜V3.3.3 完全適合)

### NH-2. 監査ログ append-only / hash chain / Owner 操作の改竄耐性 → **CLOSED**

**v1.2 該当箇所**: §17 lines 1401-1405、§6.11.6 S19 lines 880-888

**確認事項**:

| 確認項目 | Round2 推奨 | v1.2 反映 |
| --- | --- | --- |
| 物理 append-only | WORM ストレージ | **S3 Object Lock Compliance Mode** (line 1402、米国 SEC 規制適合の最強モード) |
| 論理 hash chain | SHA-256 prev_hash | **各エントリ `prev_hash` + 毎日 root を Postgres と外部 KMS 両方に署名保存** (line 1403、二重署名で内部攻撃も防止) |
| Owner も削除不可 | 必須 | **`/audit` には削除/編集ボタン無し (Owner でも不可)、誤投稿訂正は打ち消しエントリ追記のみ** (line 1404) |
| 整合性検証 UI | バッジ表示 | **「整合性検証 ✓ 2026-05-09 09:00 JST」常時表示** (line 1404 / S19 line 885) |
| 保持期間後削除の co-sign | 4-eye 必須 | **Owner 2 名 4-eye + 監査委員会承認** (line 1405、3 者必須で Round2 推奨を超過) |
| DSAR 削除スコープから監査ログ除外 | 明示除外要 | §17.6 削除スコープ表 (line 1465-1477) に監査ログは記載されず、§17 line 1401-1405 で「Owner も削除不可」と上書き定義 |

> SOC2 CC7.2 / ISO27001 A.12.4.2 / GDPR Art.30 を完全に満たす設計。**国内大手・金融・医療顧客の購買稟議で問題なく通せる強度**。

**ただし以下 1 点が NEW MEDIUM (NM-1) として残る**: §6.11 S20 の line 765 に「対象: ☑ 監査ログ(Owner のみ)」というチェックボックスが残存しており、§17 line 1404 の「Owner も削除不可」と矛盾。仕様書の整合性問題。

**評価**: **CLOSED** (NM-1 はドキュメント編集ミスの整合問題で、設計思想自体は一貫している)

---

## 2. Round2 PARTIAL 残件の状況

### H5-2 (サブプロセッサ別データ処理マップ) → **大幅前進、PARTIAL → ほぼ CLOSED**

§23.5.1 共同編集レジデンシー方針 (lines 1707-1721) で `候補 / リージョン / DPA SOC2 / リージョン分離 (JP/EU) / 採否` のサブプロセッサ評価マトリクスが追加。Liveblocks/Hocuspocus/Yjs/Convex/Replicache の 5 候補を一覧化。これにより Round2 NM-2 (S28 サブプロセッサ表) の主要部分は満たされた。

**ただし以下が未着**: (a) Anthropic / OpenAI / Unipile / Stripe / Sentry / PostHog の本番サブプロセッサ全社の同形式表が S28 `/legal/dpa` 仕様に明示されていない、(b) サブプロセッサ追加時の **30 日前事前通知 UI** (GDPR Art.28(2)) は依然未追加。

### H5-3 (OAuth `oauth.origin_mismatch` 等専用エラーコード) → **PARTIAL のまま**

§29.3 エラー文テンプレ集 (lines 1989-2001) に汎用 4xx/5xx/Network は揃ったが、`oauth.origin_mismatch` / `oauth.state_invalid` / `oauth.pkce_failed` の **OAuth 専用 3 コードは追加されていない**。Round2 NM-1 と同じ位置取り。LOW 相当。

---

## 3. NEW MEDIUM 指摘 (v1.2 改訂で生じた / 残った)

### NM-1. §6.11 S20 と §17 の整合不一致 (監査ログ削除の文言矛盾) — **要修正 P0**

- **該当箇所**: §6.11 S20 line 765 vs §17 line 1404
- **問題**:
  - §6.11 S20 のワイヤーで「対象: ☑ リード ☑ 会話 ☑ ナレッジ **☑ 監査ログ(Owner のみ)**」と記載されている。
  - §17 line 1404 では「`/audit` には削除/編集ボタン無し (**Owner でも不可**)」と明確に上書き定義されている。
  - 設計者の意図は §17 が正 (Round2 NH-2 解消)。S20 ワイヤーが v1.1 の旧仕様を引きずっている。
  - 実装時にエンジニアが S20 の文言を見て「Owner なら監査ログ削除可」と誤実装するリスク。
- **推奨**:
  - §6.11 S20 (line 765) を次に修正:
    ```
    データの削除
      対象: ☑ リード ☑ 会話 ☑ ナレッジ
      （※ 監査ログは法令上の保持義務により削除対象外。保持期間経過後にのみ自動削除）
      確認: 「DELETE」と入力 ___  [削除リクエスト]
    ```
  - §17.6 DSAR スコープ表 (line 1465-1477) にも「☒ 監査ログ — 法令保持義務により本リクエストでは削除されません」を 1 行追加。
- **期待効果**: 仕様書整合性 100%、実装ミスリスク排除。

### NM-2. S28 `/legal/dpa` のサブプロセッサ表が本番サービス分が未列挙 (Round2 NM-2 partial)

- **該当箇所**: §23.5.1 (Phase2 共同編集のみ列挙)、S28 (URL のみ)
- **問題**: 本番運用で必須の Anthropic / OpenAI / Unipile / Stripe / Sentry / PostHog / HubSpot / Salesforce の同形式マトリクスが S28 に未明示。30 日前事前通知 UI も未追加。
- **推奨**: S28 仕様セクションを §6.11.x として追加し、`サブプロセッサ / データカテゴリ / リージョン / DPA URL / 越境根拠 (SCC / 個情法 28条) / 採否切替` のテーブルを記述。新規追加時 Owner にメール + アプリ内バナー (30 日前)。
- **期待効果**: GDPR Art.28(2) 適合、Enterprise DPIA 質問票対応。

### NM-3. OAuth 専用エラーコード未追加 (Round2 NM-1 partial)

- **該当箇所**: §12.3 / §29.3 / §21.3
- **問題**: `oauth.origin_mismatch` / `oauth.state_invalid` / `oauth.pkce_failed` の 3 専用コードが §29.3 エラー文テンプレ集に未追加。§26.1 (6) で「PKCE / State 検証 / トークン暗号化」と書かれているが UI 表現は汎用 401 のまま。
- **推奨**: §29.3 のテンプレに 3 行追加:
  ```
  [oauth.origin_mismatch] 予期しないドメインから戻ってきました ({incident_id})。サポートへ
  [oauth.state_invalid]   認証セッションが一致しませんでした。最初からやり直してください
  [oauth.pkce_failed]     認証検証に失敗しました ({incident_id})。サポートへ
  ```
- **期待効果**: OAuth MITM 攻撃検知時の incident triage が高速化。LOW でも OK。

---

## 4. NEW LOW 指摘

- **NL-1.** §26.1 (1) Insider Exfiltration 対策列に Idle Timeout の追記が未反映 (line 1881 は「§17 セッション 8h」のまま)。本文 §17 line 1397 で完備されているため実害なし。
- **NL-2.** Round2 NM-3〜NM-5 (k-匿名性 N≥5 / リージョン切替 2 モード / granular consent スイッチ) は v1.2 で未着手のまま。Phase2 機能が中心のため Phase1 ブロッカーではない。
- **NL-3.** Round2 NL-1 (Calendly URL の AI 生成禁止 → 接続済みカレンダー API セレクト) は v1.2 で未着手。§6.4 のままで「貼付ガイド」止まり。Phase1 ローンチまでに 1 行追記推奨。
- **NL-4.** Round2 NL-3 (Break-Glass の本人確認画像の保管期間・リージョン・DSAR 削除対象) は §5.9 / §17.6 で明示されず。実装入り前に詰める必要。
- **NL-5.** §27.2 HITL 昇格条件 (line 1928-1939) で `SEMI_AUTO → FULL_AUTO` が **Owner + Admin 2 名の 4-eye + 月次審査** と強化されている (Round2 推奨完全反映)。良い点として特筆。

---

## 5. 95+ 判定

### 判定: **PASS (96 / 100)**

**根拠**:
1. Round1 HIGH 16件 / Round2 NEW HIGH 2件 の **計 18 件すべて CLOSED**。
2. NH-2 監査ログ改竄耐性は **WORM + hash chain + Owner 削除不可 + 整合性検証バッジ常時表示 + 4-eye 削除** という SOC2 CC7 / ISO27001 A.12.4 / GDPR Art.30 をすべて満たす最高水準の設計。
3. NH-1 Idle Timeout は Round2 推奨の 2 段階を超え **4 段階 (一般/Manager/Owner/Break-Glass)** に細分化、危険操作の 2FA 再認証も網羅。
4. 残る指摘 (NM-1〜NM-3, NL-1〜NL-5) は **すべてドキュメント整合性問題 or LOW 相当**で、設計思想自体に脆弱性なし。
5. NM-1 (S20 文言矛盾) は **5 分で修正可能**な編集ミス。実装ブロッカーではない。

### Phase1 ローンチ可否: **GO**

- B2B SaaS Enterprise IT 購買ライン (95+/100) を初めて到達。
- 国内大手・金融・医療の DPIA 質問票・情シス稟議で **想定される質問の 95% に答えられる**。
- 残る 5% (NM-2 サブプロセッサ表、NM-3 OAuth エラーコード) は Phase1 ローンチ後の v1.3 で吸収可能。

### Round4 (任意) で潰すべき残作業

| Priority | ID | タスク | Est | 該当 § |
| --- | --- | --- | --- | --- |
| **P0 (5 分)** | NM-1 | §6.11 S20 line 765 の「監査ログ(Owner のみ)」削除 + §17.6 表に「☒ 監査ログ」明示 | 0.05d | §6.11 / §17.6 |
| **P1** | NM-2 | S28 `/legal/dpa` に本番サブプロセッサ表 (8 社) と 30 日前通知 UI 追加 | 1d | S28 |
| **P2** | NM-3 | §29.3 に `oauth.*` エラーコード 3 行追加 | 0.1d | §29.3 |
| **P3** | NL-1〜5 | §26.1 / §6.4 / §5.9 / §17.6 / Round2 NM-3〜NM-5 の細部反映 | 1d | 多数 |

合計工数: **約 2.5 人日**。Phase1 ローンチ前に 0.5 日 (NM-1 + NM-3 + NL-1) を当てれば 97-98/100 まで伸ばせる。

---

## 6. 良い点 (round3 で特筆すべき強化点)

1. **§17 監査ログの WORM + hash chain + 二重署名は SaaS 業界トップクラス**
   S3 Object Lock Compliance Mode (米国 SEC 17a-4(f) 適合) + SHA-256 prev_hash + 毎日 root を Postgres と外部 KMS 両方に署名する「二重ノタリゼーション」は、insider が Postgres を直接書き換えても外部 KMS で検知可能な構造。**SOC2 監査人を黙らせる強度**。
2. **§17 Idle Timeout の 4 段階階層化**
   一般 30m / Manager 15m / Owner 10m / Break-Glass 5m と権限が高くなるほど短くする「Privilege-Inverse Timeout」は ASVS V3.3 の理想実装。Owner ほど離席リスクが高いという脅威モデルを正しく反映。
3. **§6.11.6 S19 監査ログ画面の整合性検証バッジ常時表示**
   `整合性検証 ✓ 2026-05-09 09:00 JST` を毎日 root 署名と紐付けて UI に常時表示する設計は、**監査人が来たときに 1 画面で説明完了**できる稀有な UX。
4. **§17 の「打ち消しエントリ追記でのみ訂正可能」**
   削除/編集ボタンを物理的に存在させない設計判断は、開発者がショートカット実装で「Soft Delete」を入れる誘惑を排除する。CHANGELOG が「監査人視点のレビュー」を通った証拠。
5. **§23.5.1 共同編集レジデンシーマトリクスの先回り追加**
   Phase2 機能の共同編集について、リードタイムの長いサブプロセッサ評価を Phase1 設計時点で文書化したのは PM/CTO/Security 連携が機能している証左。

---

## 7. ローンチ前の脅威モデル最終確認

| シナリオ | Round1 | Round2 | Round3 | 残作業 |
| --- | --- | --- | --- | --- |
| 退職者持ち出し | 部分 | NH-1 残 | **完全 mitigate** | NL-1 (§26.1 文言) のみ |
| Indirect Prompt Injection | 部分 | CLOSED | **完全 mitigate** | NL-4 Quarantine 誤検知リリース UI |
| テナントロックアウト | 未対応 | CLOSED | **完全 mitigate** | NL-4 KYC 画像保管期間 |
| 越境データ移転・同意撤回 | 部分 | PARTIAL | **概ね mitigate** | NM-2 S28 サブプロセッサ表 |
| AI 自動送信暴走 | 部分 | CLOSED | **完全 mitigate** | NL-3 Calendly URL AI 生成禁止 |
| OAuth トークン漏洩 | — | — | **概ね mitigate** | NM-3 専用エラーコード |
| 監査ログ改竄 (insider証拠隠滅) | — | NH-2 残 | **完全 mitigate** | NM-1 S20 文言整合 |

> **Round3 結論**: 7 つの主要脅威シナリオのうち **5 つが完全 mitigate、2 つが概ね mitigate**。Phase1 ローンチに対して **GO 判定**。残作業はすべて v1.3 で吸収可能な LOW〜MEDIUM。

---

> 本レビューは UI/UX 仕様レイヤーのセキュリティ・プライバシー観点であり、**実装レイヤー (CSP / SQLi / TLS 設定 / hash chain 実装の正しさ / S3 Object Lock の Retention Period 設定 / KMS の鍵分離) は対象外**。Phase1 実装入り前に別途 OWASP ASVS V1-V14 のコード/インフラレビューを必ず実施すること。Round1→Round2→Round3 で **64 → 86 → 96** の +32 点改善を達成したのは設計者の真摯さの証。
