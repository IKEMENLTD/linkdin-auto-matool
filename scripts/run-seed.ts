/**
 * CLI entrypoint for seeding the 4 campaign presets.
 *
 * Usage:
 *   tsx scripts/run-seed.ts --org=<uuid> --owner=<uuid>
 *
 * Optional:
 *   --dry-run    DB に書き込まず preset 一覧だけ表示
 */

/* eslint-disable no-console */

import { z } from "zod";
import {
  seedCampaignPresets,
  listCampaignPresets,
} from "../db/seeds/campaigns";

interface CliArgs {
  org: string;
  owner: string;
  dryRun: boolean;
}

class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

function parseArgs(argv: ReadonlyArray<string>): CliArgs {
  const map = new Map<string, string>();
  let dryRun = false;

  for (const arg of argv) {
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    const m = /^--([a-zA-Z][a-zA-Z0-9-]*)=(.*)$/.exec(arg);
    if (m) map.set(m[1], m[2]);
  }

  const Schema = z.object({
    org: z.string().uuid({ message: "--org must be a UUID" }),
    owner: z.string().uuid({ message: "--owner must be a UUID" }),
  });

  const parsed = Schema.safeParse({
    org: map.get("org") ?? "",
    owner: map.get("owner") ?? "",
  });

  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `  - ${i.message}`).join("\n");
    throw new UsageError(
      `引数が不正です。\n${msg}`
    );
  }

  return { org: parsed.data.org, owner: parsed.data.owner, dryRun };
}

async function main(): Promise<void> {
  console.log("[seed] 4 campaign presets seeder");
  console.log("[seed] -------------------------------------------");

  const args = parseArgs(process.argv.slice(2));

  if (args.dryRun) {
    console.log("[seed] DRY RUN — DB には書き込みません");
    const presets = listCampaignPresets();
    for (const p of presets) {
      console.log(
        `[seed]   - ${p.presetId.padEnd(14)} : ${p.name} (HITL=${p.recommendedHitl})`
      );
    }
    console.log(`[seed] 合計 ${presets.length} preset (dry-run)`);
    return;
  }

  if (!process.env.DATABASE_URL) {
    throw new UsageError(
      "環境変数 DATABASE_URL が設定されていません。"
    );
  }

  console.log(`[seed] orgId   = ${args.org}`);
  console.log(`[seed] ownerId = ${args.owner}`);
  console.log("[seed] DB 接続中...");

  const start = Date.now();
  const result = await seedCampaignPresets(args.org, args.owner);
  const elapsed = Date.now() - start;

  console.log("[seed] -------------------------------------------");
  if (result.inserted.length > 0) {
    console.log(`[seed] inserted (${result.inserted.length}):`);
    for (const id of result.inserted) console.log(`[seed]   + ${id}`);
  } else {
    console.log("[seed] inserted: (none)");
  }
  if (result.skipped.length > 0) {
    console.log(`[seed] skipped (${result.skipped.length}, already exists):`);
    for (const id of result.skipped) console.log(`[seed]   = ${id}`);
  }
  console.log(`[seed] done in ${elapsed}ms`);
}

main().then(
  () => {
    process.exit(0);
  },
  (err: unknown) => {
    if (err instanceof UsageError) {
      console.error(`\n[seed] ${err.message}\n`);
      process.exit(1);
    }
    console.error("[seed] FAILED:", err);
    process.exit(2);
  }
);
