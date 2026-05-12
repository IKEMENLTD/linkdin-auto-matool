import { z } from "zod";

/**
 * 自前 CSV パーサ (papaparse 等の依存を増やさない方針)。
 *
 * 対応仕様:
 *  - UTF-8 BOM (﻿) 除去
 *  - CRLF / LF / CR の改行
 *  - "..." クォート + "" によるエスケープ
 *  - クォート内の改行
 *  - 全角空白 (　) のトリム
 */

export type LeadRow = {
  lineNumber: number; // 1-based, ヘッダを 1 とする
  public_id: string;
  full_name: string;
  company: string;
  title: string;
  campaign_name: string;
  /** 元 CSV の profile_url。空なら public_id から構築。 */
  linkedinUrl: string;
  source_account?: string;
  legacy_lead_id?: string;
  location?: string;
  linkedin_status?: string;
  linkedin_connected_at?: string;
  linkedin_dm_sent_at?: string;
};

export type ParseError = { row: number; message: string };
export type ParseResult = { rows: LeadRow[]; errors: ParseError[] };

const LeadRowSchema = z.object({
  public_id: z.string().trim().min(1, "public_id が空です").max(120),
  full_name: z.string().trim().min(1, "full_name が空です").max(160),
  company: z.string().trim().min(1, "company が空です").max(160),
  title: z.string().trim().min(1, "title が空です").max(256),
  campaign_name: z.string().trim().min(1, "campaign_name が空です").max(160),
});

function fullTrim(s: string): string {
  return s.replace(/^[\s　]+|[\s　]+$/g, "");
}

/**
 * LinkedIn URL 正規化。
 *  - 正規形: `https://www.linkedin.com/in/{public_id}` (末尾 / なし、クエリなし)
 */
export function normalizeLinkedinUrl(input: string | null | undefined): string | null {
  if (!input) return null;
  const raw = fullTrim(String(input));
  if (!raw) return null;

  if (!/^https?:\/\//i.test(raw)) {
    const id = raw.replace(/^\/+|\/+$/g, "").split(/[/?#]/)[0];
    if (!/^[a-zA-Z0-9\-_%.]+$/.test(id)) return null;
    return `https://www.linkedin.com/in/${id.toLowerCase()}`;
  }

  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (!/linkedin\.com$/i.test(u.hostname.replace(/^www\./i, ""))) return null;

  const m = u.pathname.match(/\/in\/([^/?#]+)/i);
  if (!m) return null;
  const id = decodeURIComponent(m[1]).toLowerCase();
  if (!/^[a-zA-Z0-9\-_%.]+$/.test(id)) return null;

  return `https://www.linkedin.com/in/${id}`;
}

function tokenizeCsv(text: string): string[][] {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const rows: string[][] = [];
  let cur: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ",") {
      cur.push(field);
      field = "";
      i += 1;
      continue;
    }
    if (ch === "\n" || ch === "\r") {
      cur.push(field);
      rows.push(cur);
      cur = [];
      field = "";
      i += 1;
      if (ch === "\r" && text[i] === "\n") i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }

  if (field.length > 0 || cur.length > 0) {
    cur.push(field);
    rows.push(cur);
  }

  return rows;
}

const HEADER_ALIASES: Record<string, string> = {
  public_id: "public_id",
  publicid: "public_id",
  name: "full_name",
  full_name: "full_name",
  fullname: "full_name",
  company: "company",
  company_extracted: "company",
  company_name: "company",
  title: "title",
  title_raw: "title",
  headline: "title",
  campaign: "campaign_name",
  campaign_name: "campaign_name",
  profile_url: "profile_url",
  linkedin_url: "profile_url",
  source_account: "source_account",
  lead_id: "legacy_lead_id",
  legacy_lead_id: "legacy_lead_id",
  location: "location",
  linkedin_status: "linkedin_status",
  linkedin_connected_at: "linkedin_connected_at",
  linkedin_dm_sent_at: "linkedin_dm_sent_at",
};

function normalizeHeader(h: string): string {
  return fullTrim(h).toLowerCase().replace(/\s+/g, "_");
}

const REQUIRED_KEYS = ["public_id", "full_name", "company", "title", "campaign_name"] as const;

/**
 * CSV テキストを LeadRow[] に変換。
 */
export function parseLeadsCsv(text: string): ParseResult {
  const errors: ParseError[] = [];

  const tokenized = tokenizeCsv(text);
  if (tokenized.length === 0) {
    return { rows: [], errors };
  }

  while (tokenized.length > 0) {
    const last = tokenized[tokenized.length - 1];
    if (last.length === 1 && fullTrim(last[0]) === "") {
      tokenized.pop();
    } else {
      break;
    }
  }

  const rawHeader = tokenized[0];
  if (!rawHeader) return { rows: [], errors };

  const headerKeys: (string | null)[] = rawHeader.map((h) => {
    const n = normalizeHeader(h);
    return HEADER_ALIASES[n] ?? null;
  });

  const present = new Set(headerKeys.filter((k): k is string => !!k));
  const missing = REQUIRED_KEYS.filter((k) => !present.has(k));
  if (missing.length > 0) {
    errors.push({
      row: 1,
      message: `必須カラムが不足しています: ${missing.join(", ")}`,
    });
    return { rows: [], errors };
  }

  const rows: LeadRow[] = [];

  for (let i = 1; i < tokenized.length; i += 1) {
    const cells = tokenized[i];
    if (cells.length === 1 && fullTrim(cells[0]) === "") continue;

    const lineNumber = i + 1;

    const rec: Record<string, string> = {};
    for (let c = 0; c < headerKeys.length; c += 1) {
      const key = headerKeys[c];
      if (!key) continue;
      const val = cells[c] ?? "";
      rec[key] = fullTrim(val);
    }

    const required = LeadRowSchema.safeParse(rec);
    if (!required.success) {
      errors.push({
        row: lineNumber,
        message: required.error.issues.map((iss) => iss.message).join(" / "),
      });
      continue;
    }

    const linkedinUrl =
      rec.profile_url && rec.profile_url.length > 0
        ? rec.profile_url
        : required.data.public_id;

    rows.push({
      lineNumber,
      public_id: required.data.public_id,
      full_name: required.data.full_name,
      company: required.data.company,
      title: required.data.title,
      campaign_name: required.data.campaign_name,
      linkedinUrl,
      source_account: rec.source_account || undefined,
      legacy_lead_id: rec.legacy_lead_id || undefined,
      location: rec.location || undefined,
      linkedin_status: rec.linkedin_status || undefined,
      linkedin_connected_at: rec.linkedin_connected_at || undefined,
      linkedin_dm_sent_at: rec.linkedin_dm_sent_at || undefined,
    });
  }

  return { rows, errors };
}
