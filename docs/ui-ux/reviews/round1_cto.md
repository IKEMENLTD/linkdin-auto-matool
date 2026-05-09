# CTO技術レビュー — UI/UX設計書 v1.0

- 対象: `docs/ui-ux/UI_UX_Design.md` (v1.0 / 2026-05-09)
- 親仕様: `LinkedIn自動営業SaaS構築設計書.docx`
- レビュー観点: フロントエンドアーキテクチャ / リアルタイム整合性 / パフォーマンス / 計測SLO / 状態機械-UI整合
- レビュア: CTO Agent
- 作成日: 2026-05-09
- イテレーション: round1

---

## 総合スコア: 71 / 100

| # | 評価軸 | スコア | コメント |
| --- | --- | --- | --- |
| 1 | フロントエンドアーキテクチャ妥当性 (App Router / RSC / Streaming / Cache) | **13 / 20** | App Router採用は明示されているが、RSC vs Client Componentの境界、Streaming SSR、Server Actions、TanStack Query (Client) との責務分離が未定義。Cache戦略 (revalidate / tag-based revalidation / `unstable_cache`) も空白。 |
| 2 | リアルタイム / SSE / Webhook UI反映の整合性とフォールトトレランス | **14 / 20** | SSE/WS方針・5秒以内反映目標は良。ただし接続戦略 (SSE vs WS / Edge Runtime制約)、再接続backoff、メッセージ重複排除、順序保証、HTTP/2接続上限、Webhook → DB → Push の伝搬経路 (LangGraphノード境界) が未記述。 |
| 3 | パフォーマンス予算 (仮想化 / bundle / INP) | **15 / 20** | 数値目標 (LCP 2.5s / INP 200ms / 1万行60fps / 200KB gzip) はB2B SaaSとして妥当。が、shadcn/ui + Recharts (推測) + Tiptap (AI Draft編集) + TanStack Table + Virtualizer + LangGraph SDK込みで200KB gzipは現実的に厳しい。bundle内訳のpredictionが不足。 |
| 4 | 計測 (PostHog/Sentry/RUM) と SLO の関係 | **13 / 20** | イベントスキーマと数式の透明性は秀逸。だがWeb Vitals → SLO → アラート閾値の連結が無く、Sentry sample rate / PostHog session replay PII redaction / RUM経路が未定義。SLOバジェット運用設計が抜けている。 |
| 5 | 状態機械・データモデルとUI表現の一貫性 | **16 / 20** | ステータス11種を色・アイコン・ラベル三重で統一する設計思想は強い。ただしFAILEDが汎用すぎる (regulatory/transient/permanentの区別なし)、PENDING→EXPIRED→DISQUALIFIED経路など分岐状態の遷移条件と権限が未明。LangGraph ノードと UI状態のマッピング表が必要。 |

---

## HIGH 指摘 (実装前に必ず解決)

### H1. RSC / Client Component / Server Actionsの責務分離が未定義
- **該当**: §6 全画面 / §15 パフォーマンス予算 / §11 リアルタイム
- **問題**: Next.js 15 App Router採用と書かれているがRSC前提なのか、`"use client"`境界をどこに引くかが空白。受信箱・会話画面は完全にClient (TanStack Query + SSE)、ダッシュボード集計KPIはRSC + Streaming、リード一覧はハイブリッド (RSC初期表示 + Client filter) というように、画面ごとのレンダリングモデル選定が無いと、bundle 200KB目標とINP 200ms目標が同時達成できない。
- **推奨**:
  - 画面別マトリクスを §6 に追加: `画面 / RSC / Streaming(Suspense境界) / Server Action / TanStack Query / Cache key / revalidate` の6列
  - 原則: 「読み取り中心の集計画面はRSC、双方向ステートフル画面はClient + TanStack Query、フォーム送信はServer Actions + `revalidatePath`/`revalidateTag`」
  - LangGraph呼び出しはServer Action経由 (Client → Server Actionが単方向)、長時間ジョブはServer Action内でenqueueしてSSEでpush
- **期待効果**: bundle圧縮 (RSCはJS送信ゼロ)、INP改善、Cache invalidation設計の明確化

### H2. Cache戦略 (TanStack Query staleTime / Next.js fetch cache / revalidate) が画面ごとに未定義
- **該当**: §6.1 ダッシュボード / §6.3 リード一覧 / §15
- **問題**: 「TanStack Queryで画面間キャッシュ、staleTimeを画面ごとに最適化」と書いてあるだけで具体値が無い。受信箱は数秒、ダッシュKPIは5分、ナレッジは1時間など段階定義が無いと、過剰fetchかstale表示の二択で破綻する。Next.js fetch APIの`cache: 'force-cache' | 'no-store'`、`next.tags`、`revalidatePath`の使い分けも未定。
- **推奨**:
  - 画面別 `staleTime / gcTime / refetchOnWindowFocus / refetchInterval` 表
  - Next.js側 `unstable_cache`タグ命名規約: `workspace:{wsId}:campaign:{id}:leads`
  - Webhook受信時のtag-based revalidation経路 (Webhook handler → `revalidateTag('inbox:'+wsId)`) を §11 に追記
- **期待効果**: ネットワーク60-80%削減、stale表示によるUX破綻回避

### H3. SSE接続のスケール設計とフォールトトレランスが浅い
- **該当**: §11.2 リアルタイム / §21.3
- **問題**: 「SSE または WebSocket、切断時バナー + 自動再接続」の一行のみ。HTTP/2でも同一originへのSSE接続は6本制限 (Chrome) があり、複数タブで詰まる。Vercel Edge Runtime / Node Runtimeでの接続維持時間制限、Last-Event-IDによる欠損補完、再接続時のexponential backoff jitter、メッセージ順序保証 (Webhook並列受信→DB単調増加seqを発行) が未記述。
- **推奨**:
  - 採用: SSE単一接続 + 全イベント多重化 (`event: inbox.message_received` / `event: campaign.status_changed`) を1本のSSEに集約 (BroadcastChannelで他タブ共有)
  - サーバ: Supabase Realtime (Postgres Changes) または独自SSE + Redis Pub/Sub。LangGraph nodeから `pg_notify` → SSE relayという経路を明示
  - クライアント: `EventSource` + `Last-Event-ID` ヘッダ、再接続backoff (1s, 2s, 4s, jitter ±20%, max 30s)
  - 重複排除: `eventId` (ULID) でクライアント側Set管理、5分window
  - フォールトトレランス: SSE切断 60秒継続でTanStack Queryに `refetchOnReconnect` 強制発火
- **期待効果**: マルチタブ運用でも詰まらない、欠損ゼロ、Webhook→UI反映の5秒SLO達成

### H4. Optimistic UI禁止ルールの粒度が粗い (送信は禁止だが、状態遷移のpush更新と楽観更新の整合が未定義)
- **該当**: §11.2 / §6.4 会話画面
- **問題**: 「送信はOptimistic禁止」は正しいが、ユーザーが送信ボタンを押した直後にSSEが未到達でも、サーバは2-phase commit (DB write → SSE push) で時差がある。会話画面で「送信中→送信済」遷移がDB→SSE→UIで行われると、自分で送ったメッセージが他人のセッションのSSE順より遅れて見える事故が起きる。
- **推奨**:
  - 送信フロー: `Server Action 完了 = サーバ確定 + 自セッションは即座にlocal mutation適用`、他セッションはSSE経由で受信。`messageId`重複でmergeする
  - 送信中の表示: `status: 'queued' | 'sending' | 'sent' | 'failed'` を内部stateで持ち、UIには「送信中…」を200ms以上表示してから「送信済」へ遷移 (チラつき抑止)
  - 失敗時: ローカルmutationをrollbackせず `failed` で残し、再送/破棄UIを出す
- **期待効果**: 「送ったのに消えた」「2回送られた」の苦情ゼロ

### H5. パフォーマンス予算 200KB gzipの実現可能性に懐疑
- **該当**: §15 パフォーマンス予算
- **問題**: shadcn/ui (Radix UI tree-shake後) + TanStack Query + TanStack Table + react-virtuoso + Recharts/Visx + Tiptap (AI Draft編集) + zod + react-hook-form + dayjs/date-fns + LangGraph client SDK + PostHog snippet + Sentry snippet で初回 200KB gzip は達成困難。特にRecharts単体でgzip 80KB級。
- **推奨**:
  - 初回ルート (ダッシュ) のbundle内訳を**予測表**で書く: `framework 45KB + shadcn 25KB + TanStack 20KB + chart 35KB (visx選定) + own code 30KB = 155KB` 形式で先に試算
  - 重ライブラリは画面別にdynamic import: AI Draftエディタ (Tiptap) は会話画面のみ、Charts は ダッシュ・キャンペーン詳細のみ
  - Rechartsではなく**Visx** または **uPlot** (時系列) を選定検討。Visx は使う部品だけimport可能でgzip 8-15KB
  - PostHogは `posthog-js/dist/array.js` でlazy load、Sentryは `@sentry/nextjs` のautoInstrumentationを精査
  - 初期目標を `初回ルート 250KB / セカンダリ 80KB delta` に**現実的にrebase**
- **期待効果**: 達成可能な予算でCI gate設置 → 後退検知

### H6. SLO / Error Budget / アラート閾値の不在
- **該当**: §16 計測 / §15
- **問題**: イベントスキーマは充実しているが、SLO (Service Level Objective) と Error Budget の定義が無い。「LCP < 2.5s 目標」と書いてあるだけでは運用回らない。何%のセッションでLCP 2.5s以下を達成するか (例: P75)、月次バジェット消費がXX%超でリリース凍結、というポリシーが無い。
- **推奨**:
  - SLO表を§16に新設:
    | SLI | SLO | 計測 | バジェット | アラート |
    | --- | --- | --- | --- | --- |
    | LCP P75 | < 2.5s | PostHog Web Vitals | 月99% | 7d burn rate > 2x |
    | INP P75 | < 200ms | PostHog | 月99% | 同上 |
    | SSE反映遅延 P95 | < 5s | カスタム計測 (server send TS - client receive TS) | 月99% | 1h burn rate > 14x |
    | Webhook → 受信箱表示 P95 | < 8s | Sentry custom span | 月99% | 同上 |
    | 送信API失敗率 | < 0.5% | Sentry | 月99.5% | 5min burn rate |
  - Sentry: traces sample rate `production: 0.1`、PII scrubber設定 (LinkedIn URL / email / 電話番号)
  - PostHog session replay: PII masking (`*[data-pii]`) ルール追加、デフォルトOFF + opt-in
- **期待効果**: 数値運用が回り、Phase2以降の品質劣化を機械的に検知

### H7. LangGraphノード境界とUIストリーミング表現の対応未記述
- **該当**: §6.4 会話画面 / §9 HITL UX / §11
- **問題**: AI Draftの「生成中」表示はあるが、LangGraphの各ノード (retrieve → reason → draft → guardrail) の進捗をUIに何段階で出すか未定義。タイプライター禁止と書いてあるが、代替の「ステップインジケータ」「Suspense境界」がどう貼られるか不明。長時間ジョブ (キャンペーン作成時のICP検索→エンリッチ→QUALIFY) のストリーミング表現も同じ問題。
- **推奨**:
  - LangGraph nodeにUI metadata `{ uiPhase: 'retrieving_knowledge' | 'drafting' | 'safety_check' }` を含めてSSE中継
  - 会話画面: AI Draftパネル内に3段階のステップチップ ("根拠を探しています" → "下書き中" → "安全確認")
  - 長時間ジョブ: Server Action + ReadableStream + Suspense (`<Suspense fallback={<Stepper/>}>`)
  - 中断: `AbortController` を `Esc` キーバインドに紐付け、サーバ側はLangGraphの interrupt API で停止
- **期待効果**: AI体感品質とObservabilityが両立、§9のHITL原則と整合

---

## MEDIUM 指摘

### M1. ICP検索の「ヒット推定数」のSLA/UX未定義
- **該当**: §5.2 / §6.2 Step3
- **問題**: 「約3,420件 [更新]」と表示する仕様だが、Sales Nav APIに直接叩けない (Unipile経由でスクレイピング相当) ため取得遅延が秒オーダーになる可能性が高い。debounce戦略・キャッシュ・レート制御が未定義。
- **推奨**: debounce 600ms + AbortController、推定値はキャッシュ (workspace+queryHash, TTL 1h)、初回はskeleton + 5秒超で「概算は数分後に通知します」フォールバック

### M2. リード一覧10,000+行 仮想化の前提と現実
- **該当**: §6.3 / §15
- **問題**: 仮想化は良いが、フィルタ・ソート・選択状態保持・URL同期・列固定 を全て満たすテーブルライブラリ選定が未定 (TanStack Table + react-virtuoso か AG Grid Communityか)。AG Grid Enterpriseは不要だが、列ピン留め+仮想化+選択は素のTanStack Tableでは結構書く。
- **推奨**: TanStack Table v8 + `@tanstack/react-virtual` を明記、CSV エクスポートは クライアントではなく Server Action で生成 (5万行超対策)

### M3. Drawer URL同期戦略
- **該当**: §6.3 / §8 Drawer仕様
- **問題**: 「Drawer は URL同期」と書いてあるが、`/leads?selected=:id` か `/leads/:id` (parallel route + intercepting routes) かで実装難度が違う。後者はNext.js 15のparallel routes機能を使える。
- **推奨**: Next.js Parallel Routes + Intercepting Routes で `/leads/(.)leads/[id]` を採用、URLからの直接アクセスは詳細ページにfallback

### M4. ダーク対応のCSS変数戦略
- **該当**: §7.1
- **問題**: ライト変数のみ列挙、ダークは「別パレット」とだけ。`prefers-color-scheme` と手動切替の両対応をどうCSS変数で実現するか (data-theme属性 / CSS媒体クエリ / next-themes採用) が未明。
- **推奨**: `next-themes` + `data-theme="dark"`属性ベース。Tailwind v3.4以降の `dark:` modifier と CSS variable両立

### M5. i18n採用の具体実装
- **該当**: §14
- **問題**: 「ICU MessageFormat採用」とあるが、`next-intl` か `lingui` か `react-intl` か未定。RSCとの相性 (next-intl はApp Router対応進んでいる) で選定根拠が必要。
- **推奨**: `next-intl` を明記、message catalog配置 (`/messages/ja.json`, `/messages/en.json`)

### M6. Stripe / 請求UIのWebhook整合
- **該当**: §6.8
- **問題**: 利用状況の数値はリアルタイム性が低くてよいが、Stripe Webhook受信から反映までの経路がない。
- **推奨**: Stripe Webhook → DB → `revalidateTag('billing:'+wsId)` → 次回アクセスで反映で十分。「最終更新 X分前」表記を明示

### M7. Optimistic UI許容範囲 (下書き保存・既読化) の競合解決
- **該当**: §11.2
- **問題**: 既読化を Optimistic にすると、別端末で先に既読された場合の解決が未定義。
- **推奨**: 既読は `read_at: timestamp` のmin () 採用、Last-Write-Winsを避ける。SSEで `read_at` 上書きされたら mergeする

### M8. キーボードショートカット衝突とdiscoverability
- **該当**: §6.4 (J/K/R/E/S/G I)
- **問題**: Gmail風ショートカットは便利だが、shortcut help overlay (`?` キー) と日本語IME中の発火抑止が未記述。
- **推奨**: `cmdk` ベースの ⌘K + `?` で help overlay、`event.isComposing` チェックで IME中は全shortcut抑止

### M9. WCAG 2.2 AAの新項目反映が浅い
- **該当**: §13
- **問題**: 2.2新項目 (2.4.11 Focus Not Obscured / 2.5.7 Dragging Movements / 2.5.8 Target Size Minimum 24x24) のうち24x24は記載があるが、Drag操作 (ナレッジDnD) の代替操作が未定義。
- **推奨**: DnDには「クリックで開いてアップロード」の代替UI併記、Focus visibilityはsticky header背景で隠れない設計

### M10. PostHog feature flag戦略
- **該当**: §16
- **問題**: 「自動送信モード解放」「ベータ機能」のflag運用が未記述。
- **推奨**: PostHog feature flag + RSCでの読み取り (`getFeatureFlag` server-side) を採用、`Suspense` 境界外で評価

---

## LOW 指摘

### L1. アイコンセット選定
shadcn/ui標準の Lucide React で統一すれば自動 tree-shaking 効果が大きい。FontAwesome等への寄り道はbundle肥大要因。

### L2. 画像最適化
§15で「AVIF/WebP + CDN」とあるが、Next.js `<Image>` のremotePatterns / 画像source (LinkedInプロフィール画像) のキャッシュポリシーが未明。LinkedIn直リンクは画像URLが署名付きで失効するのでproxy必須。

### L3. 日付ライブラリ
dayjs を推奨明記 (date-fns はtree-shakeしてもlocale込で増える)。タイムゾーン処理は `dayjs/plugin/timezone`。

### L4. ⌘K グローバル検索の検索ソース
キャンペーン / リード / ナレッジ / 設定 のうちどこまで横断検索するか、indexはサーバ (Postgres FTS / Supabase) かクライアントkeystrokeか未定。Phase2なら最初はサーバ単純検索でよい。

### L5. CHANGELOGの粒度
「v1.0 初稿」だけでは追跡困難。今後 `### v1.1 (2026-05-XX) - §11 にSSE多重化方針追加` のような単位で書く。

### L6. 用語の英日揺れ
「コネクト」「コネクション」「接続」が混在 (§3.3 / §6.5 / §21.1)。表記ガイドラインを§14に1行追加。

---

## 良い点 3つ

1. **状態機械をUIメンタルモデルにする原則 (§1.1.4 / §3.3 / §21.2)**
   ステータス11種を「ラベル + 色 + アイコン + 説明」のテーブルで一元化し、IA・コンポーネント・通知設計まで貫通させている。これは保守性とa11yを同時に成立させる強い意思決定。多くのSaaSが状態語彙の揺れで苦しむ箇所を最初に潰している。

2. **HITL原則とAI出力の3操作 (§9.2)**
   `[編集して送信] [この案は使わない] [根拠を見る]` の3点セットを全AI出力に強制し、ナレッジチャンクへの逆引きまで含める設計は、Trust & Safetyとプロダクト品質を両立する。LangGraphのretrievalノードが返したsource_idsをUIに必ず流す契約が読み取れる。

3. **「Optimistic UIを送信に使わない」「危険操作は2段階+Undo」 (§11.2 / §1.2 Reversible First / §6.4)**
   LinkedIn自動送信SaaSという文脈で最も事故りやすいUXを、原則レベルで縛っている。送信ボタンの「3秒で送信／取消」スナックバー、自動送信モード解放に「3通連続の人間採用ログ + 同意」を要求する仕組みは、実運用クレーム激減につながる地味だが効く設計。

---

## 実装着手前に決めるべき技術選定 5項目

1. **レンダリング戦略マトリクスの確定**
   全23画面を `RSC / Client / Hybrid` × `Streaming境界 / Server Action / TanStack Query / Cache tag` で表化。特にダッシュボード(RSC + Streaming)、受信箱(Client + SSE)、リード一覧(Hybrid: RSC初期+Client filter)、キャンペーン作成ウィザード(Server Actions主導+Client preview) のパターンを先に決める。これが決まらないと bundle / INP / cache のすべてが流動的になる。

2. **リアルタイム配信基盤の選定 (Supabase Realtime / 独自SSE+Redis / Pusher / Ably)**
   Webhook受信→DB→クライアントpushの経路と、LangGraphノードからの中間進捗pushを同一基盤で扱うか分離するか。Supabase Realtimeを既存インフラ前提で採用するなら Postgres Changes + Broadcast、独自実装ならNode (Edge不可・Node Runtime固定) で SSE relay + Redis Pub/Sub。マルチタブ・順序保証・Last-Event-IDの実装複雑度が選定で決まる。

3. **チャート / テーブル / リッチエディタ ライブラリの確定とbundle予算**
   `Visx vs Recharts vs uPlot` (チャート)、`TanStack Table + react-virtual vs AG Grid Community` (10万行表)、`Tiptap vs Lexical vs textarea+slate` (AI Draft編集)。各候補のgzipサイズ実測 → 初回ルートbundle 内訳予測表を確定 → CIで `bundlewatch` or `size-limit` のしきい値設置。これを決めずに実装が走ると§15のパフォーマンス予算は形骸化する。

4. **Cache key / Tag 命名規約と revalidation 経路**
   Next.js `unstable_cache`タグ命名 (`workspace:{id}:resource:{id}`)、TanStack Query の queryKey 命名 (`['inbox', wsId, threadId]`)、Webhook handler / Server Action / SSE eventからの `revalidateTag` / `queryClient.invalidateQueries` のフロー。これを最初に契約化しないと、TanStack QueryとNext fetch cacheが二重キャッシュで矛盾する事故が起きる。

5. **SLO / Error Budget / 計測パイプラインの先行確定**
   PostHog (RUM + Web Vitals + Session Replay) + Sentry (Error + Performance) の役割分担、PII scrubber ルール、sample rate、SLO数値 (LCP P75 / INP P75 / SSE遅延P95 / 送信API失敗率)、月次Error Budget。実装着手と同時に計測が動かないとPhase 1終了時点で「現状計測してないので分からない」になる。Sentry DSN・PostHog projectKey はコード commit 0 日目から接続必須。

---

## 結論

**Verdict: NEEDS REVISION**

設計思想 (状態機械中心 / HITL / Reversible First / 透明性) は強く、製品理解の解像度が高い。一方で **技術選定の解像度が画面ワイヤーの解像度に追いついていない**。Next.js 15のRSC/Streaming/Cache戦略、SSE基盤、bundle予算、SLO運用の4点が空白のまま実装に入ると、Phase 1のMVPは出るがPhase 2以降にrewriteコストが大量発生する。

上記 HIGH 7件のうち最低 H1 / H2 / H3 / H5 / H6 を v1.1 で解消すること。それまでは **scaffold 段階の着手は可、画面別の本実装は保留** が技術判断。

---

## 次アクション (Architectへの差戻し事項)

- v1.1 で §6 各画面に「レンダリング戦略 / Cache key / SSE event」3行を追加
- v1.1 で §11 にSSE多重化・Last-Event-ID・backoff jitter を明記
- v1.1 で §15 にbundle内訳予測表とライブラリ確定リスト
- v1.1 で §16 にSLO表とError Budget運用ポリシー
- v1.1 で §21 に LangGraph node ↔ UI phase マッピング表
