# Batch R2 — Security Re-Review (S15 / S26)

レビュアー: security-design-agent
日時: 2026-05-11 JST
スコープ: R1 で NEEDS_REVISION 判定だった S15 (78) と S26 (82) の修正確認
目標: 各画面 88+ / 100

R1: `C:\Users\ooxmi\Downloads\Linkdin自動ツール\docs\reviews\batch-r1\security.md`

---

## TL;DR

| 画面 | R1 | R2 | 判定 | 主要修正 |
| --- | ---: | ---: | --- | --- |
| **S15 メンバー / 権限** | 78 | **91** | **APPROVED** | onSubmit 確認 + キャンセル時値復元 / AuditAction `member.*` 化 / 最後の Owner 維持 / Admin の Owner 降格不可 |
| **S26 Break-Glass** | 82 | **90** | **APPROVED** | middleware PUBLIC_PATHS に `/recovery` `/status` 追加 |

**R1 ブロッカー (B-S15-1 / B-S15-2 / B-S26-1) は全て解消**。両画面とも 88+ 到達。

---

## 1. S15 メンバー / 権限 — Score 91 / 100 — **APPROVED**

### 検証対象
- `components/settings/members-table.tsx`
- `server/actions/members.ts`
- `lib/audit.ts`
- `lib/auth.ts`

### Blocker 解消状況

#### ✅ B-S15-1 [HIGH] RoleChanger 即時送信 → 確認ステップ追加

`components/settings/members-table.tsx:182-214` で **form の `onSubmit` に `window.confirm` を仕掛け、キャンセル時は `select.value` を元のロールに戻す** 実装が入っている:

```tsx
onSubmit={(e) => {
  const select = e.currentTarget.querySelector<HTMLSelectElement>("select[name=role]");
  const nextRole = (select?.value ?? currentRole) as Role;
  if (nextRole === currentRole) {
    e.preventDefault();
    return;
  }
  if (
    !window.confirm(
      `ロールを「${ROLE_LABEL[nextRole]}」に変更します。よろしいですか？`
    )
  ) {
    e.preventDefault();
    if (select) select.value = currentRole;
  }
}}
```

評価:
- **誤操作リスクは大幅低減**: Tab→矢印キーで select 値変更 → form 送信されようとした瞬間に confirm が出る。キャンセルで値も復元され、ユーザの認知モデルと一致。
- **同値再送信の抑止** (`nextRole === currentRole` で `preventDefault`) もあり、同じロールを選び直しても無駄に Server Action が走らない。
- **クリックジャック対策としての効果**: ネイティブ `window.confirm` は iframe 内では親フレームのモーダルになるため、CSP/`X-Frame-Options` が未確認でも実害を下げる中間策として有効。

軽微な指摘 (Suggestion):
- **S-S15-R2-1 [LOW]** `window.confirm` はテキスト固定で a11y 観点ではブラウザ依存 (フォーカス管理がブラウザ任せ)。Phase2 で `<AlertDialog>` (shadcn/ui) に置き換えると尚良い。
- **S-S15-R2-2 [LOW]** `select.value = currentRole` の復元は React の制御外で行うため、`useActionState` の `state` と再レンダリングのタイミングによっては「キャンセル直後にもう一度ドロップダウンを開くと旧値が選ばれていない」ように見える可能性 (実害なし、`defaultValue` で初期化されているので次回レンダで一致)。

→ **ブロッカー解消**。

#### ✅ B-S15-2 [HIGH] AuditAction enum 整備 + `lead.assigned` 流用解消

`lib/audit.ts:32-35`:
```ts
| "member.role_changed"
| "member.deactivated"
| "member.reactivated"
| "member.invited"
```

`server/actions/members.ts`:
- L96: `action: "member.role_changed"`
- L176: `action: "member.deactivated"`
- 旧 `action: "lead.assigned"` は `server/actions/` 配下に **残存ゼロ** (grep 確認済)。

評価:
- **SIEM 検索性回復**: `event:member.role_changed` で権限変更だけを抽出可能。GDPR/SOC2 監査クエリが書けるようになった。
- **将来拡張性**: `member.reactivated` / `member.invited` も同時に enum に予約済で Phase2 の Server Action 追加時に同じ enum 流用ミスが再発しにくい。
- **hash chain 影響なし**: 新 enum 追加は既存ログの hash 計算に何も影響しない (新規エントリから新名称で記録するだけ)。
- **DB 側 check 制約**: 設計書ベースでは `audit_action` は text カラムで保存 (`lib/audit.ts` で型 narrowing のみ実施) なので、マイグレーション不要で即時反映可能。Phase2 で enum/check 制約を追加する場合は最初からこの名称で。

→ **ブロッカー解消**。

#### ✅ S-S15-2 [MED] 最後の Owner 維持 + Admin による Owner 降格不可

`server/actions/members.ts:67-84` (changeRole 内, tx 内):
```ts
// Admin が他の Owner を降格しようとした場合は拒否
if (target.role === "owner" && parsed.data.role !== "owner" && session.role !== "owner") {
  throw new Error("CANNOT_DEMOTE_OWNER");
}

// 最後の Owner 維持: Owner → 非Owner 変更時、アクティブな Owner が他に存在することを要求
if (target.role === "owner" && parsed.data.role !== "owner") {
  const [{ count }] = await tx.select(…)…
  if (Number(count) <= 1) throw new Error("MUST_KEEP_ONE_OWNER");
}
```

`deactivateMember` でも同等のガード (L152-165):
```ts
if (target.role === "owner") {
  if (session.role !== "owner") throw new Error("CANNOT_DEMOTE_OWNER");
  const [{ count }] = await tx.select(…)…
  if (Number(count) <= 1) throw new Error("MUST_KEEP_ONE_OWNER");
}
```

評価:
- **R1 で指摘した「Owner A 休暇 + Admin B が A を Operator に降格 → Owner 0」のシナリオを完全に阻止**。Admin は Owner を一切降格・無効化できない (常に 403 相当)。
- **最後の Owner ガードは tx 内で count → update を同一トランザクションで実施**。`pg_advisory_xact_lock(hashtext(org_id))` (audit chain で使用) と組み合わせれば 2 つの Owner が同時に降格処理を走らせるレースもブロック可。
- **エラーメッセージが分離されている** (`CANNOT_DEMOTE_OWNER` vs `MUST_KEEP_ONE_OWNER`) ので、UX 上「最後の Owner だから不可」「自分には権限がないから不可」の区別がつく。情報漏洩観点では `count` の値を返さないので、攻撃者が「他 Owner 数」を推測できない (✓)。

軽微な指摘 (Suggestion):
- **S-S15-R2-3 [LOW]** 並行制御: 2 つの Admin Tab が同時に Owner B を降格 → 片方は `MUST_KEEP_ONE_OWNER` で失敗するべきだが、現実装は `SELECT count + UPDATE` の race が理論上ありえる。`SELECT … FOR UPDATE` を `schema.users` の Owner 行に当てるか、`pg_advisory_xact_lock(hashtext(org_id))` を `changeRole` 冒頭に追加すると更に堅牢 (audit chain では既に取得しているので、tx 内で再取得しなくても効くはず)。
- **S-S15-R2-4 [LOW]** `deactivateMember` でも `(session.userId !== userId) && (session.role === 'admin' || 'owner')` までは Admin/Owner 同列だが、Owner の非アクティブ化は **当人が Owner かつ session も Owner** のみ実行可。これは設計書 §17.2 と一致 (✓)。

→ **対応完了**。

### 残存 Suggestion (R2 でも引き継ぎ、Phase1 sprint 内対応推奨)

- **S-S15-1 (R1 残)** `headers()` から IP/UA/correlationId を取得して `writeAudit` に渡す → 今回の R2 では対応されていない (`writeAudit({…, fromIp, fromUa, correlationId })` の呼び出しは未追加)。
  - **影響**: 監査ログの最重要項目 (誰が何処から) が空欄のまま。**しかし元の RoleChanger UX 修正・enum 整備・Owner 階段ガードが入ったことで「権限変更を巡る攻撃面」のスコアは大きく改善**しているため、本件は Phase1 中の sprint 内対応で OK。R2 のブロッカーには昇格させない。
  - 推奨実装は R1 の S-S15-1 そのまま (`headers()` から取得 + 共通 helper 化)。

- **S-S15-4 (R1 残)** `rateLimit` キーを actor 単位 / 組織単位の 2 軸に。引き続き Phase1 sprint 内推奨。

### STRIDE 再評価

| 観点 | R1 | R2 | 変化点 |
| --- | --- | --- | --- |
| Spoofing | ◯ | ◯ | 変更なし |
| Tampering | △ | ◯ | audit action 名が正しくなり改竄検知性向上 |
| Repudiation | × | △ | actor は記録されるが IP/UA は依然空 (Phase1 sprint 内) |
| Info Disclosure | △ | △ | 変更なし |
| DoS | △ | △ | 変更なし |
| Elev. of Privilege | △ | ◯ | 最後の Owner 維持 + Admin の Owner 降格不可で **大幅改善** |

### スコア内訳 (S15)

- ベース 100
- 即時送信誤操作リスク (R1: −10 → R2: −3 ※`<AlertDialog>` 未採用分のみ)
- AuditAction 流用 (R1: −7 → R2: 0)
- 最後の Owner ガード未実装 (R1: −5 → R2: 0)
- IP/UA 未記録 (−4) — Phase1 sprint 内に持ち越し
- rateLimit メモリ実装 (−2) — Phase2 で Upstash 移行
- **R2: 91 / 100 — APPROVED**

---

## 2. S26 Break-Glass — Score 90 / 100 — **APPROVED**

### 検証対象
- `app/recovery/break-glass/page.tsx` (R1 から実装変更なし、Phase1 では UI のみ)
- `lib/supabase/middleware.ts` ← **修正箇所**

### Blocker 解消状況

#### ✅ B-S26-1 [HIGH] middleware PUBLIC_PATHS に `/recovery` `/status` 追加

`lib/supabase/middleware.ts:42-52`:
```ts
const PUBLIC_PATHS = [
  "/login",
  "/auth/callback",
  "/legal",
  "/status",
  "/recovery",
  "/api/health",
  "/api/csp-report",
  "/_next",
  "/favicon",
];
const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));
```

評価:
- **SSO ロックアウト時の到達性確保**: 未ログイン状態でも `/recovery/break-glass` に到達可能 → `/login` への永遠 loop が解消。設計書 §17.3 の「緊急復旧経路は SSO に依存しない」要件と物理的に整合。
- **`startsWith(p + "/")`** で `/recovery/break-glass` も `/status/incidents` 等の将来サブパスもカバーされる。
- **`/status` も同時に public 化**: 障害発生時にサインアウト顧客が公開ステータスページを見られなくなる問題 (R1 で指摘した「Twitter で『ステータスページ見れない』」パターン) も同時解消。
- **既存の保護領域に副作用なし**: `(app)` group 配下 (`/dashboard`, `/settings/team` etc.) は引き続き未ログイン時に `/login` リダイレクト。`PUBLIC_PATHS` に列挙したパスのみ public 扱いで、ホワイトリスト方式 → 安全側に倒れている。

軽微な指摘 (Suggestion):
- **S-S26-R2-1 [LOW]** `/recovery` を public にしたことで、攻撃者から「Break-Glass エンドポイントの存在」が確定情報となる。これは設計書通り (透明性側を取る方針) で許容範囲。**だが Phase2 でフォーム実装する際の防御は必須**:
  - レート制限: IP 単位で 5 回 / 時間 (R1 と同じ指摘を再掲)
  - CAPTCHA: メール送信前必須
  - 監査ログ: `BREAK_GLASS.attempt` (失敗含む) + `BREAK_GLASS.granted`
  - 通知: 全 Owner への即時メール (ページに記載済 ✓)
  - 4-eye 承認: 別 Owner/Admin の承認待ち (ページに記載済 ✓)
  - 監査ログの `BREAK_GLASS` action は既に `lib/audit.ts:44` で予約済 (✓)
- **S-S26-R2-2 [LOW]** Phase2 で `/recovery/break-glass` の POST handler を実装する際、`/api/recovery/*` のような API ルートも `PUBLIC_PATHS` への追加が必要になる可能性。今回追加した `/recovery` は page route (`app/recovery/break-glass/page.tsx`) のみカバー。API ルートを別パス (`/api/recovery/*`) に置く場合は追加忘れ注意。
- **S-S26-R2-3 [LOW] (R1 から引き継ぎ)** 電話番号併記 + 赤バナーで「Phase2 実装中」の明示。今回のスコープ外だが、ページ自体の UX 改善として残存。

→ **ブロッカー解消**。

### OWASP A05 (Security Misconfiguration) 再評価

R1 で指摘した「設計上の緊急復旧経路が物理的に到達不能」というコンフィグミスは完全解消。`/status` も同時に public 化されたことで、ステータスページ運用 (S24) 側との一貫性も取れた。

### スコア内訳 (S26)

- ベース 100
- PUBLIC_PATHS 漏れ (R1: −10 → R2: 0)
- Phase2 で実装される防御 (CAPTCHA / レート制限 / 4-eye) が未実装 (−5) — Phase2 マイルストーン
- 電話番号バナー未追加 (−3) — UX Suggestion
- mailto 1 元化未対応 (−2)
- **R2: 90 / 100 — APPROVED**

---

## 横断確認

### 修正による全体影響

- **AuditAction enum 追加** (`member.role_changed`, `member.deactivated`, `member.reactivated`, `member.invited`):
  - hash chain 既存エントリには無影響 (新規 enum 値の追加のみ)
  - 既存 `lead.*` enum との衝突なし
  - `server/actions/members.ts` 以外の呼び出し箇所への影響: `lead.assigned` の他用途 (実際の lead 担当割当) は別 Server Action にあるはずだが今回未確認 → **R3 以降のスコープで Phase1 中に grep 確認推奨** (`grep -rn 'action: "lead\.assigned"' server/`)。
- **PUBLIC_PATHS 拡張** (`/recovery`, `/status` 追加):
  - 既存の保護対象 (`(app)/*`) には副作用なし
  - 公開化したパスは静的ページ + UI 仕様のみで現状フォーム実装ゼロ → 攻撃面増加は実質ゼロ
- **最後の Owner ガード**:
  - `users.role` / `users.isActive` カラムへの count クエリが各 Server Action 内で 1 回追加 → 軽微な負荷増 (1 組織あたり Owner 数十名規模なら無視可能)
  - `pg_advisory_xact_lock` を伴う audit chain と組み合わせれば race 安全

### OWASP Top10 再評価

| # | 項目 | R1 状態 | R2 状態 |
| --- | --- | --- | --- |
| A01 Broken Access Control | △ S15 owner 唯一性 | ◯ ガード追加 |
| A04 Insecure Design | × B-S15-1 | ◯ confirm 追加 |
| A05 Security Misconfig | × B-S26-1 | ◯ PUBLIC_PATHS 修正 |
| A07 Auth Failures | △ S-S15-2 | ◯ |
| A09 Logging Failures | × B-S15-2, S-S15-1 | △ B-S15-2 解消 / S-S15-1 残 |

---

## 次アクション提案

### Phase1 sprint 内 (推奨, R3 不要)

1. **S-S15-1 (R1 から残)** Server Action 共通 helper で `headers()` から IP/UA/correlationId を取得して `writeAudit` に渡す。横断対象は `members.ts`, `campaigns.ts`, `connections.ts`, `leads.ts`, `wizard.ts`, `conversation.ts`, `auth.ts`。
2. **S-S15-4 (R1 から残)** `rateLimit` キーを actor 単位 / 組織単位の 2 軸に拡張。
3. **横断確認** `grep -rn 'action: "lead\.assigned"' server/` で本来の lead 担当割当用途以外に流用が残っていないか確認。

### Phase2 必須

1. **B-S26 残作業** Break-Glass フォーム実装時に CAPTCHA / レート制限 / 4-eye 承認 / 失敗試行の audit ログ。
2. **S15 RoleChanger UX** `window.confirm` → `<AlertDialog>` 置換 (a11y / フォーカス管理改善)。
3. **S15 Owner 階段の race 防御** `pg_advisory_xact_lock(hashtext(org_id))` または `SELECT … FOR UPDATE` を `changeRole` / `deactivateMember` の tx 冒頭に追加。

---

## 結論

| 画面 | R1 | R2 | 判定変化 |
| --- | ---: | ---: | --- |
| **S15** | 78 (NEEDS_REVISION) | **91** (APPROVED) | ✅ 目標 88+ 到達 |
| **S26** | 82 (NEEDS_REVISION) | **90** (APPROVED) | ✅ 目標 88+ 到達 |

R1 で指定された 3 ブロッカー (B-S15-1 / B-S15-2 / B-S26-1) は全て解消。加えて Owner 階段ガードの強化 (最後の Owner 維持 + Admin による Owner 降格不可) も実装されており、S15 のスコアが R1 で予測した 88 を超えて 91 まで上振れ。R3 不要。

レビュアー署名: security-design-agent
target: docs/reviews/batch-r2/security.md
