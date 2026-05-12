# Seven-Layer Defense Specification

| | |
| --- | --- |
| Document version | v1.0 (public) |
| Target product | LinkdInside (LinkedIn outreach automation SaaS) |
| Related design docs | UI/UX Design v1.3 §9.2.1 / §17 / §26 / §27, `lib/state-machine.ts`, `lib/incident.ts` |
| Intended audience | Backend implementers / SRE / security reviewers |
| Status | Phase 1 mandatory (prerequisite for unlocking FULL_AUTO mode) |

---

## 0. TL;DR

LinkdInside treats **"zero misdelivery, zero account restriction"** as an absolute SLO. A single check in front of `message.send` is structurally insufficient: send actions execute only after **seven independent verification layers arranged in series** have all passed. The moment one layer fails the send is aborted; three consecutive failures escalate to `BREAK_GLASS` (organization-wide halt). This document defines the purpose, implementation sketch, and test strategy for each layer.

This specification is the **data-layer realisation** of the CircuitBreaker pattern described in design doc §9.2.1 and the HITL state machine in §27. §9.2.1 defines *when* to demote; this document defines *what concrete detection logic fires the demotion*.

---

## 1. Background: Why Seven Layers

### 1.1 The class of failure being defended against

Production-grade automation against any large social platform faces a recurring failure mode: **recipient URN mismatch** — the system intends to message lead A but actually delivers to lead B. This typically arises when the only source of truth for "who am I about to message?" is the DOM of a page that the platform may freely re-render, including unrelated profile cards in side rails, "people you may know" widgets, or thread suggestion panels.

A naive resolution pipeline often looks like:

1. Pull `public_id` (the human-readable slug) from the lead database.
2. Visit the profile page and extract the `recipient=...` parameter from the "Message" button's `href`.

The structural defect: step (2) can pick up a Message button that belongs to a *different* profile rendered on the same page. The resulting DM is sent to the wrong person, generates spam signals on the platform side, and degrades the sending account's standing — sometimes to the point where non-public endpoints begin returning hard errors and automation halts entirely.

### 1.2 Why "Triple Check" alone is insufficient

A common mitigation is a "triple check" comparing URN, thread URL, and profile link. As an industry-general anti-pattern, this fails whenever **all three checks read from the same DOM source**: when the DOM is poisoned, the three checks lie in unison (a correlated false positive: all agree, all wrong).

### 1.3 Design principle

Defence is therefore built around **source independence**. Each of the seven layers must consult a *different* data source — official API, distinct DOM regions, application database, inter-process shared state, LLM output — so that no single platform-side anomaly can simultaneously deceive every layer. This is a proactive design constraint, not a reaction to a specific incident.

---

## 2. Seven-Layer Overview

| # | Layer | Information source | What it verifies | Failure behaviour |
| --- | --- | --- | --- | --- |
| L1 | URN Fetch | Unipile API | `public_id → URN` via official provider API | Abort send / transition to `FAILED` |
| L2 | Triple Check | URN + thread URL + profile link | URN identity across three independent sources | Abort send / `triple_check_failed` audit |
| L3 | Recipient Verify | Thread DOM (live attendee meta) | UI-displayed recipient family name matches `lead.full_name` | Abort send / `recipient_mismatch` audit |
| L4 | Delivery Verify | Unipile messages API | Latest conversation URN matches expectation post-send | Record mismatch → counted in L5 |
| L5 | Safety Halt (per-account) | App DB `linkedin_accounts.consecutive_mismatch` | Three consecutive mismatches on a single account | Demote that account to `SAFE_MODE` |
| L6 | Global Halt | `incidents` table + `services.web` state | Any account triggers BREAK_GLASS | Halt all accounts / persistent banner |
| L7 | AI DM Guardrail | LLM output + `lead.full_name` | Family name present in first 100 chars of DM | Re-queue / `quarantined` |

Design invariants:

- **Serial** — L1 → L2 → L3 must all pass before any send action is invoked.
- **Independent** — each layer reads from a different data source; no layer is purely DOM-derived.
- **Append-only audit** — every layer outcome is written to `audit_log` with a `prev_hash` chain (`lib/audit.ts`).
- **Idempotent** — re-running the same `leadId` / `correlationId` cannot produce duplicate sends.

---

## 3. Layer-by-Layer Specification

### Layer 1: URN Fetch (canonical identifier resolution)

#### Purpose

Resolve a stored `public_id` (LinkedIn slug) into the currently valid immutable identifier (URN; `urn:li:fsd_profile:ACoAA...`) via the **official provider API**, so that slug changes, renames, and account deletions are detected immediately.

#### Failure modes

| ID | Symptom | Root cause | Response |
| --- | --- | --- | --- |
| L1-F1 | Not-found response | Lead has left the platform / profile deleted | Lead → `DISQUALIFIED` (reason=`profile_gone`) |
| L1-F2 | Forbidden / gone response | Account restriction or provider session expiry | Account → `SAFE_MODE`, queue provider re-auth |
| L1-F3 | Rate-limit or timeout | Throttling | Exponential backoff (60s/180s/600s); three failures → `FAILED` |
| L1-F4 | URN does not match `ACoAA` prefix | Upstream schema drift / corrupted response | Abort send + open incident (`INC-YYYY-XXXX`) |

#### Implementation sketch (TypeScript)

```ts
// server/linkedin/urn.ts
import "server-only";
import { z } from "zod";

const UrnResponse = z.object({
  provider_id: z.string().regex(/^ACoAA[A-Za-z0-9_-]+$/),
  public_identifier: z.string(),
  is_open_profile: z.boolean().optional(),
});

export type UrnFetchResult =
  | { ok: true; urn: string; fetchedAt: Date }
  | { ok: false; reason: "gone" | "forbidden" | "rate_limited" | "schema"; status?: number };

export async function fetchRecipientUrn(
  unipileAccountId: string,
  publicId: string,
): Promise<UrnFetchResult> {
  const r = await unipileFetch(`/users/${encodeURIComponent(publicId)}`, {
    method: "GET",
    accountId: unipileAccountId,
  });

  if (r.status >= 400 && r.status < 500) {
    if (r.status === 404) return { ok: false, reason: "gone", status: r.status };
    if (r.status === 429) return { ok: false, reason: "rate_limited", status: r.status };
    return { ok: false, reason: "forbidden", status: r.status };
  }

  const parsed = UrnResponse.safeParse(await r.json());
  if (!parsed.success) return { ok: false, reason: "schema" };

  return { ok: true, urn: parsed.data.provider_id, fetchedAt: new Date() };
}
```

#### Test approach

- **Unit** — stub representative 2xx/4xx/5xx and malformed-JSON responses via nock; assert the discriminated-union return covers every branch.
- **Contract** — weekly job against a Unipile sandbox: resolve a known `public_id` and confirm the URN matches the stored value.
- **Chaos** — inject 50% rate-limited responses via middleware; verify retries grow exponentially.

> **Architectural note**: Implementations that scrape or directly call non-public LinkedIn endpoints are **out of scope** for LinkdInside. All identifier resolution flows through the Unipile provider, which is the supported abstraction for partner-style integrations.

---

### Layer 2: Triple Check (URN ↔ thread URL ↔ profile link)

#### Purpose

Confirm that the URN obtained in L1 matches the recipient of the thread about to receive the send, by cross-checking **three independent sources**. The textbook anti-pattern (three DOM-sourced checks) is avoided by deliberately drawing each check from a distinct origin:

| Check | Source | Content |
| --- | --- | --- |
| C1 | Unipile API (re-fetch of L1, cache bypassed) | Confirms deterministic identifier resolution |
| C2 | Thread-create response (`POST /chats`) field `attendee_provider_id` | URN the provider associates with the new thread |
| C3 | App DB `leads.profile_urn` (value persisted at enrichment) | The expected URN snapshot |

The send pipeline advances to L3 only when `C1 == C2 == C3`.

#### Failure modes

- **C1 ≠ C3** — the lead's URN has changed (rename / profile merge / different person now owns the slug) → push to `requalify` queue.
- **C1 ≠ C2** — provider created a chat with an unexpected attendee (very rare) → open incident, abort.
- **All empty** — network outage → automatic retry.

#### Implementation sketch

```ts
// server/linkedin/triple-check.ts
export async function tripleCheck(args: {
  leadId: string;
  unipileAccountId: string;
  publicId: string;
  expectedUrn: string; // leads.profile_urn (DB snapshot)
}): Promise<{ ok: true; chatId: string } | { ok: false; reason: string }> {
  // C1: re-fetch
  const c1 = await fetchRecipientUrn(args.unipileAccountId, args.publicId);
  if (!c1.ok) return { ok: false, reason: `c1_${c1.reason}` };

  // C2: create or resolve thread (idempotent by leadId)
  const chat = await unipileFetch("/chats", {
    method: "POST",
    accountId: args.unipileAccountId,
    body: { attendees_ids: [c1.urn] },
    idempotencyKey: `chat-${args.leadId}`,
  });
  const chatJson = await chat.json();
  const c2Urn = chatJson?.attendee_provider_id;

  // C3: compare with DB
  if (c1.urn !== args.expectedUrn) return { ok: false, reason: "c1_neq_c3" };
  if (c1.urn !== c2Urn) return { ok: false, reason: "c1_neq_c2" };

  return { ok: true, chatId: chatJson.id };
}
```

#### Test approach

- **Property test** — inject random URN pairs (A, B) across C1/C2/C3 and assert any disagreement yields `ok: false`.
- **Regression** — simulate the classic DOM-poisoning false-positive scenario and verify API-sourced separation does not reproduce it.
- **Chaos** — delay C2 by 100 ms; return empty C3; assert correct failure reasons.

---

### Layer 3: Recipient Verify (pre-send name re-check)

#### Purpose

Immediately before `POST /chats/:id/messages`, fetch `GET /chats/:id` and verify that the chat's **current attendee display name** matches the **family name** of `leads.full_name`. Even if L1/L2 hold at the URN level, this final guard catches the unlikely case where the provider mutates the chat's attendee set between resolution and send.

#### Failure modes

- **Family name mismatch** — UI display name and DB disagree (rename / marriage / legal change) → demote to HITL `REVIEW_REQUIRED`.
- **Empty / unresolved** — chat meta returns blank → safety-first refusal.

#### Family-name extraction logic

- Unicode NFC normalization; collapse fullwidth space to ASCII space.
- For Japanese (CJK / kana) names the **first** token is the family name.
- For Latin-script names the **last** token is the family name.
- Reject family names shorter than 2 characters (single CJK characters are too ambiguous to ground on).

#### Implementation sketch

```ts
// server/linkedin/recipient-verify.ts
import unorm from "unorm";

function familyName(name: string): string {
  const norm = unorm.nfc(name).replace(/　/g, " ").trim();
  const parts = norm.split(/\s+/);
  if (!parts.length) return "";
  const isJa = /[぀-ヿ一-鿿]/.test(norm);
  return isJa ? parts[0] : parts[parts.length - 1];
}

export async function verifyRecipient(args: {
  chatId: string;
  expectedFullName: string;
  unipileAccountId: string;
}): Promise<{ ok: true; uiName: string } | { ok: false; uiName: string; reason: string }> {
  const r = await unipileFetch(`/chats/${args.chatId}`, {
    method: "GET",
    accountId: args.unipileAccountId,
  });
  const json = await r.json();
  const uiName: string = json?.attendees?.[0]?.name ?? "";

  if (!uiName) return { ok: false, uiName: "", reason: "empty" };

  const expFam = familyName(args.expectedFullName);
  const uiFam = familyName(uiName);
  if (expFam.length < 2 || uiFam.length < 2)
    return { ok: false, uiName, reason: "family_too_short" };
  if (expFam !== uiFam) return { ok: false, uiName, reason: "family_mismatch" };

  return { ok: true, uiName };
}
```

#### Test approach

- **Adversarial samples** — `Yamamoto` vs `Yamamoto Taro` / `Yamada Taro` vs `Hanako Yamada` / variant CJK characters that NFC must normalize.
- **i18n** — track Russian (family-given-patronymic) and Hungarian (family-given) ordering as a separate enum in a Phase 2 issue.

---

### Layer 4: Delivery Verify (post-send delivery confirmation)

#### Purpose

After `POST /messages` returns success (with a small settle delay), call `GET /chats/:id/messages?limit=1` and confirm the latest message's `sender_id` (self) and `chat.attendee_provider_id` (recipient URN) match expectation — catching race conditions or proxy-level misroutes at the last possible moment.

#### Failure modes

- **`attendee_provider_id` differs from expected URN** — critical; record `delivery_mismatch`; increments L5 counter.
- **API error or timeout** — treated strictly as a mismatch (safety-first default).
- **Sent message does not appear in history** — three retries (5 s each); still missing → mismatch.

#### Implementation sketch

```ts
// server/linkedin/delivery-verify.ts
export async function verifyDelivery(args: {
  chatId: string;
  expectedUrn: string;
  unipileAccountId: string;
}): Promise<{ ok: true } | { ok: false; reason: string; actualUrn?: string }> {
  for (let attempt = 0; attempt < 3; attempt++) {
    await sleep(attempt === 0 ? 3000 : 5000);
    const r = await unipileFetch(`/chats/${args.chatId}/messages?limit=1`, {
      method: "GET",
      accountId: args.unipileAccountId,
    });
    if (!r.ok) continue;
    const json = await r.json();
    const last = json?.items?.[0];
    if (!last) continue;
    const actualUrn = last?.chat?.attendee_provider_id ?? last?.attendee_provider_id;
    if (actualUrn === args.expectedUrn) return { ok: true };
    return { ok: false, reason: "urn_mismatch", actualUrn };
  }
  return { ok: false, reason: "no_history" };
}
```

#### Test approach

- **Happy path** — send, then message visible after 100 ms → `ok: true`.
- **Eventual consistency** — first poll empty, second poll populated → `ok: true`.
- **Misroute** — inject a deliberately wrong `expectedUrn` → `ok: false` with `reason: urn_mismatch`.

---

### Layer 5: Safety Halt (per-account auto-pause)

#### Purpose

When L4 records **three consecutive failures on a single account**, demote that account alone to `SAFE_MODE` (automated send disabled). This couples to the HITL state machine in UI/UX §27 (SEMI_AUTO → REVIEW_REQUIRED auto-demotion).

#### Implementation sketch

```ts
// server/linkedin/safety-halt.ts
import { getDb, schema } from "@/db/client";
import { eq, sql } from "drizzle-orm";
import { writeAudit } from "@/lib/audit";

const THRESHOLD = 3;

export async function recordMismatch(args: {
  orgId: string;
  accountId: string;
  correlationId: string;
}) {
  const db = getDb()!;
  await db.transaction(async (tx) => {
    const [acc] = await tx
      .update(schema.linkedinAccounts)
      .set({
        consecutiveMismatch: sql`${schema.linkedinAccounts.consecutiveMismatch} + 1`,
        lastMismatchAt: new Date(),
      })
      .where(eq(schema.linkedinAccounts.id, args.accountId))
      .returning();

    if (acc.consecutiveMismatch >= THRESHOLD) {
      await tx
        .update(schema.linkedinAccounts)
        .set({ status: "SAFE_MODE", pausedAt: new Date() })
        .where(eq(schema.linkedinAccounts.id, args.accountId));

      await writeAudit({
        orgId: args.orgId,
        action: "linkedin.account_paused",
        targetType: "linkedin_account",
        targetId: args.accountId,
        purpose: `safety_halt_${acc.consecutiveMismatch}_mismatches`,
        correlationId: args.correlationId,
      }, tx);
    }
  });
}

export async function resetMismatch(accountId: string) {
  const db = getDb()!;
  await db
    .update(schema.linkedinAccounts)
    .set({ consecutiveMismatch: 0 })
    .where(eq(schema.linkedinAccounts.id, accountId));
}
```

> **Migration required** — add `consecutive_mismatch INTEGER NOT NULL DEFAULT 0` and `last_mismatch_at TIMESTAMP` to `linkedin_accounts`.

#### Test approach

- **Counter** — two consecutive failures do not trigger; the third does.
- **Reset** — any successful delivery zeroes the counter.
- **Audit chain** — pause event is appended to `audit_log` with `prev_hash`.

---

### Layer 6: Global Halt (organization-wide stop)

#### Purpose

While L5 pauses a single account, L6 **immediately stops all automated sends across the organization (or tenant)** — a true break-glass. It fires when any of:

- Two or more accounts in the same org enter `SAFE_MODE` within a short window;
- Any incident is opened with `severity=critical` (`writeAudit({ action: "BREAK_GLASS" })`);
- An Owner manually triggers it via `/recovery/break-glass`.

#### Why a DB-backed implementation

File-based inter-process mutexes (e.g. a sentinel flag on disk) do not synchronize across multi-replica deployments. LinkdInside therefore models the halt as a row in an `incidents` table; the `incident_id` is minted by `lib/incident.ts:newIncidentId` in the form `INC-YYYY-XXXXXXXX`.

#### Implementation sketch

```ts
// server/safety/global-halt.ts
import { newIncidentId } from "@/lib/incident";
import { writeAudit } from "@/lib/audit";

export async function triggerGlobalHalt(args: {
  orgId: string;
  reason: string;
  triggeredBy: "auto" | "manual";
  actorUserId?: string;
}): Promise<{ incidentId: string }> {
  const db = getDb()!;
  const incidentId = newIncidentId();

  return await db.transaction(async (tx) => {
    await tx.insert(schema.incidents).values({
      id: incidentId,
      orgId: args.orgId,
      severity: "critical",
      title: "Global send halt",
      detail: args.reason,
      status: "open",
    });

    await tx
      .update(schema.linkedinAccounts)
      .set({ status: "SAFE_MODE", pausedAt: new Date() })
      .where(eq(schema.linkedinAccounts.orgId, args.orgId));

    await writeAudit({
      orgId: args.orgId,
      actorUserId: args.actorUserId,
      action: "BREAK_GLASS",
      purpose: args.reason,
      correlationId: incidentId,
    }, tx);

    return { incidentId };
  });
}

/** Every send worker calls this before any outbound action. */
export async function assertNotHalted(orgId: string) {
  const db = getDb()!;
  const [open] = await db
    .select()
    .from(schema.incidents)
    .where(and(eq(schema.incidents.orgId, orgId), eq(schema.incidents.status, "open")))
    .limit(1);
  if (open) throw new Error(`SAFETY_HALT: incident ${open.id} open`);
}
```

> **Migration required** — create `incidents` (`id VARCHAR PRIMARY KEY`, `org_id UUID`, `severity`, `title`, `detail`, `status`, `created_at`, `resolved_at`).

In the UI, §11.2.2 surfaces the `incident_id` in a persistent status banner; only Owners can resolve via `/recovery/break-glass`.

#### Test approach

- **Integration** — after `triggerGlobalHalt`, `POST /messages` returns a service-unavailable response.
- **Audit** — the `BREAK_GLASS` event is correctly chained.
- **DR drill** — monthly exercise: manually fire, confirm full halt, measure recovery time (integrated with §24 Runbook RB-04).

---

### Layer 7: AI DM Guardrail (family-name guardrail)

#### Purpose

Programmatically vet every LLM-generated DM body **before send**, so that hallucinations (wrong salutation, injected URLs, prohibited terms) cannot reach the wire. This layer complements UI/UX §17.4 (indirect prompt-injection defence on the inbound side) and §17.5 (DLP).

#### Checks

| # | Check | Failure handling |
| --- | --- | --- |
| G1 | Body length 150–450 chars | Re-queue for regeneration |
| G2 | No URLs in body (booking URLs are appended separately) | Regenerate |
| G3 | Zero hits against `_NG_WORDS` dictionary | Quarantine |
| G4 | Zero hits against price-expression patterns (`_PRICE_NG_PATTERNS`) | DLP §17.5 hard block |
| G5 | Sender display name appears in body | Regenerate |
| G6 | **Family name + honorific within first 100 chars** | Regenerate |
| G7 | At least one numeric (concreteness anchor) | Regenerate |
| G8 | No org affiliation leakage in signature lines | Regenerate |

G6 (family-name guardrail) is the most load-bearing. Even with prompt-level instructions like "open with `{family_name}-sama`", LLMs may drift; the program-side check is the actual enforcement.

#### Implementation sketch

```ts
// server/ai/guardrail.ts
const NG_WORDS = ["残念ながら", "申し訳"];
const PRICE_PATTERNS = [/\d+\s*円/, /\d+\s*万/, /無料/];

export type GuardrailResult =
  | { ok: true }
  | { ok: false; reason: string };

export function checkDmGuardrails(args: {
  text: string;
  leadFullName: string;
  senderName: string;
}): GuardrailResult {
  const t = args.text ?? "";
  if (!t) return { ok: false, reason: "empty" };
  if (t.length < 150) return { ok: false, reason: `too_short_${t.length}` };
  if (t.length > 450) return { ok: false, reason: `too_long_${t.length}` };
  if (/https?:\/\//.test(t)) return { ok: false, reason: "url_in_body" };

  for (const w of NG_WORDS) if (t.includes(w)) return { ok: false, reason: `ng_${w}` };
  for (const p of PRICE_PATTERNS) if (p.test(t)) return { ok: false, reason: `price_${p}` };

  if (args.senderName && !t.includes(args.senderName))
    return { ok: false, reason: "missing_sender" };

  const fam = familyName(args.leadFullName);
  if (fam.length >= 2) {
    const head = t.slice(0, 100);
    if (!head.includes(`${fam}様`) && !head.includes(`${fam}さん`))
      return { ok: false, reason: `wrong_salutation_${fam}` };
  }

  if (!/\d+[円件時間社名年月分%％]/.test(t)) return { ok: false, reason: "missing_number" };

  const tail = t.split("\n").slice(-3).join("\n");
  if (/(株式会社|代表取締役|CEO)/.test(tail))
    return { ok: false, reason: "signature_affiliation" };

  return { ok: true };
}
```

#### Test approach

- **Golden set** — 100 valid DMs and 100 invalid DMs (wrong family name, URL leak, price leak) frozen as fixtures.
- **Mutation test** — replace the family name in a valid DM with another family name; assert `wrong_salutation` always trips.
- **Cross-implementation regression** — any reference implementation in a second language is diffed against the TS canonical implementation.

---

## 4. LinkdInside Implementation Guide (where to wire it in)

### 4.1 End-to-end send action

```ts
// app/(app)/inbox/_actions/send-message.ts (server action)
"use server";
export async function sendMessage(input: SendInput) {
  const correlationId = newCorrelationId();          // shared trace across all layers
  const session = await requireSession(["owner", "admin", "manager", "operator"]);

  // L7: AI Guardrail (also performed at draft time; re-checked here)
  const g = checkDmGuardrails({ text: input.body, leadFullName: lead.fullName, senderName: sender });
  if (!g.ok) return fail("guardrail", g.reason);

  // L6: Global halt assertion
  await assertNotHalted(session.orgId);

  // L1: URN fetch
  const urn = await fetchRecipientUrn(account.unipileId, lead.publicId);
  if (!urn.ok) return fail("l1", urn.reason);

  // L2: Triple check
  const tc = await tripleCheck({
    leadId: lead.id, unipileAccountId: account.unipileId,
    publicId: lead.publicId, expectedUrn: lead.profileUrn,
  });
  if (!tc.ok) return fail("l2", tc.reason);

  // L3: Recipient verify
  const rv = await verifyRecipient({
    chatId: tc.chatId, expectedFullName: lead.fullName, unipileAccountId: account.unipileId,
  });
  if (!rv.ok) return fail("l3", rv.reason);

  // === Send ===
  const sent = await unipileFetch(`/chats/${tc.chatId}/messages`, {
    method: "POST", accountId: account.unipileId,
    body: { text: input.body },
    idempotencyKey: `msg-${lead.id}-${correlationId}`,
  });
  if (!sent.ok) return fail("send", sent.statusText);

  // L4: Delivery verify
  const dv = await verifyDelivery({
    chatId: tc.chatId, expectedUrn: urn.urn, unipileAccountId: account.unipileId,
  });
  if (!dv.ok) {
    await recordMismatch({ orgId: session.orgId, accountId: account.id, correlationId }); // L5
    // Escalate to L6 when multiple accounts are simultaneously in SAFE_MODE
    if (await countSafeAccounts(session.orgId) >= 2) {
      await triggerGlobalHalt({
        orgId: session.orgId, reason: "multi_account_safe_mode", triggeredBy: "auto",
      });
    }
    return fail("l4", dv.reason);
  }
  await resetMismatch(account.id);

  await writeAudit({
    orgId: session.orgId, actorUserId: session.userId,
    action: "message.sent",
    targetType: "lead", targetId: lead.id,
    correlationId,
    diff: { chatId: tc.chatId, urn: urn.urn },
  });
}
```

### 4.2 Required Drizzle migration

```sql
-- 0007_seven_layer_defense.sql
ALTER TABLE linkedin_accounts
  ADD COLUMN consecutive_mismatch INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN last_mismatch_at TIMESTAMPTZ;

CREATE TABLE incidents (
  id           VARCHAR(32) PRIMARY KEY,             -- INC-YYYY-XXXXXXXX
  org_id       UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  severity     VARCHAR(16) NOT NULL,                -- critical / warning / info
  title        VARCHAR(256) NOT NULL,
  detail       TEXT,
  status       VARCHAR(16) NOT NULL DEFAULT 'open', -- open / resolved
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at  TIMESTAMPTZ
);
CREATE INDEX incidents_org_status_idx ON incidents(org_id, status);

ALTER TABLE leads
  ADD COLUMN profile_urn VARCHAR(64);   -- L2 C3 source
```

### 4.3 `audit_log` integration

Every layer outcome — both success and failure — is appended via `writeAudit` (`lib/audit.ts`) into the hash chain. The `AuditAction` enum is extended with:

- `safety.l1_failed`, `safety.l2_failed`, `safety.l3_failed`, `safety.l4_failed`
- `safety.l5_safe_mode`
- `BREAK_GLASS` (L6, existing)
- `safety.guardrail_failed` (L7)

All entries are correlated by `correlationId` so the full timeline of a single send attempt is queryable end to end.

---

## 5. Daily Audit Checklist

The `/audit` screen (§6.11.6 S19) is reviewed by SRE each morning:

| Item | Threshold | Response |
| --- | --- | --- |
| Delivery-verify (L4) mismatches | > 0 per day | Review each; resolve if false positive |
| Daily-limit breaches | > 0 | Revisit warm-up plan (§10.2) |
| L1 forbidden/gone runs | 3 consecutive on a single account | Treat as restriction signal → `SAFE_MODE` |
| Triple-check (L2) mismatches | > 0 | Enqueue URN re-resolution for the lead |
| L7 guardrail rejection rate | > 30 % | Tune prompts / refresh NG-word list |
| Open incidents (L6) | > 0 | Escalate to Owner (Slack `#incidents`) |
| `audit_log` hash-chain verification | Any inconsistency | Forensic procedure per §17 |

The `/audit` screen exposes a "daily report" section that can export CSV (watermarked per §17.2) for external auditors.

---

## 6. Incident-Response Runbook

This integrates with the broader UI/UX §24 SLO / Runbook; only seven-layer-specific procedures are listed here.

### RB-SLD-01: Immediate response to a detected misdelivery (Critical)

1. **Detect** — confirm an L4 mismatch in `audit_log`, or receive an external report.
2. **Stop immediately** — Owner fires manual `BREAK_GLASS` via `/recovery/break-glass` (`triggerGlobalHalt`).
3. **Scope** — enumerate the last 24 h of `message.sent` events from `audit_log` keyed on `correlationId`; identify any unintended recipient URNs.
4. **Apology** — human operators craft individual apology DMs under HITL `REVIEW_REQUIRED`.
5. **Postmortem** — publish within 72 h tagged with the `incident_id` (§11.2.3 status page).
6. **Reopen** — after root-cause fix lands with passing tests, an Owner + Admin four-eye approval flips `incident.status = 'resolved'`.

### RB-SLD-02: Manual global-halt activation

```bash
# Emergency: Owners may also fire from CLI.
pnpm tsx scripts/trigger-halt.ts --org $ORG_ID --reason "manual_emergency"
# → emits incident_id to STDOUT
# → persistent banner appears across all UI surfaces
# → all cron jobs and queue workers stop at the next assertNotHalted check
```

### RB-SLD-03: Releasing a single account from SAFE_MODE

1. Open the target account at `/connections/linkedin`.
2. Inspect "last mismatch detail" — trace `correlationId` through `audit_log`.
3. Confirm the trigger was a false positive.
4. Owner clicks "reset `consecutive_mismatch` and resume" (invokes `resetMismatch`).
5. The action is appended to the audit hash chain as `linkedin.account_resumed`.

### RB-SLD-04: Restriction-signal handling

1. When L1 returns forbidden/gone three consecutive times on a single account, automatic `SAFE_MODE` engages.
2. A cool-off window is observed (commonly 30–90 days, per platform behaviour) before any automated resumption is considered.
3. During cool-off the account is constrained to HITL `REVIEW_REQUIRED` — manual DM only.
4. After the window, a lightweight daily probe (single profile GET) verifies a clean response before the account becomes a candidate for `SAFE_MODE` release.

---

## 7. Consistency with Design Doc v1.3

- §9.2.1 CircuitBreaker triggers (failure rate / DLP / warning events) are realised by **L5 or L6**. §9.2.1 is the contract; this document is the implementation.
- §17.4 prompt-injection defence covers the **inbound** path; L7 is the **outbound** complement.
- §26.1 threat "AI auto-send runaway" is mitigated by the combination of L5 + L6 + L7.
- §27 HITL state-machine auto-demotion is **driven directly by L5** (`account.status = SAFE_MODE` cascades to `org.hitl_state = REVIEW_REQUIRED`).
- The TS implementation defined in this document is the **Phase 1 canonical implementation** for the LinkdInside platform.

---

## 8. Revision History

| Version | Date | Notes |
| --- | --- | --- |
| v1.0 (public) | 2026-05-12 | Initial public release; seven independent verification layers built on the Unipile provider abstraction. |
