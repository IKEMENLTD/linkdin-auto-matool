/**
 * Campaign preset 定義 (4 種類)。
 *
 * - DB の `campaigns.product_docs` jsonb には `{ presetId: "TM_xxx", ... }` を保存
 * - dm-generator は preset.senderName / icpDescription / productDocs を参照して DM 生成
 * - 実値は seed (db/seeds/campaigns.ts) で投入されるか、UI / API で個別設定する
 */

import { z } from "zod";

/** preset ID の Zod enum (boundary 検証で使う) */
export const CAMPAIGN_PRESET_IDS = ["TM_backoffice", "TM_sales", "TM_ceo", "TM_jinji"] as const;
export const CampaignPresetIdSchema = z.enum(CAMPAIGN_PRESET_IDS);
export type CampaignPresetId = z.infer<typeof CampaignPresetIdSchema>;

/** 1 つの preset を表す構造化データ */
export interface CampaignPreset {
  /** preset 識別子。campaigns.product_docs.presetId に保存される */
  id: CampaignPresetId;
  /** UI 表示用の人間可読名 */
  name: string;
  /** 差出人名 (DM 末尾の署名 + ガードレールで参照) */
  senderName: string;
  /** 想定読者 (役職層) */
  recipientTitle: string;
  /** 業種キーワード (system prompt に先頭 3 件を渡す) */
  keywords: string[];
  /** ICP (理想顧客像) の自然言語記述 */
  icpDescription: string;
  /** プロダクト情報 (自己紹介ビートで Claude が参照) */
  productDocs: string;
  /** DM の口調 / トーン傾向 */
  dmStyle: "warm" | "consultative" | "executive" | "operational";
}

export const CAMPAIGN_PRESETS: Readonly<Record<CampaignPresetId, CampaignPreset>> = {
  TM_backoffice: {
    id: "TM_backoffice",
    name: "バックオフィス自動化",
    senderName: "池田",
    recipientTitle: "バックオフィス責任者 / 管理部長 / 経理財務リーダー",
    keywords: ["バックオフィス", "業務効率化", "GAS開発", "請求書", "勤怠"],
    icpDescription:
      "従業員 30-300 名規模、Google Workspace を全社採用、月次決算や請求書発行で属人化が起きており、" +
      "管理部 1-3 名が定型作業に時間を奪われている中小企業。ERP/SaaS 導入は重すぎるが Excel 手作業は限界、" +
      "という \"中間ゾーン\" の業務効率化ニーズを持つ層。",
    productDocs: [
      "提供価値: Google Apps Script による業務自動化を内製化支援",
      "代表的な実績:",
      "- 請求書発行 / 勤怠集計など月40時間の手作業を平均3時間まで圧縮",
      "- 累計80社に導入、133システムのカタログから即適用可能",
      "- ERP 導入 (数百万円) なしでバックオフィス効率化を実現",
      "ターゲット課題: 経理・総務の属人化、月末月初の作業集中、Excel への過度な依存",
    ].join("\n"),
    dmStyle: "operational",
  },

  TM_sales: {
    id: "TM_sales",
    name: "営業オペレーション自動化",
    senderName: "池田",
    recipientTitle: "営業マネージャー / インサイドセールス責任者 / 事業開発リーダー",
    keywords: ["営業オペレーション", "SFA", "リード管理", "商談ログ", "営業効率化"],
    icpDescription:
      "営業組織 5-50 名規模、Salesforce/HubSpot を使うほどでもないが Excel/Spreadsheet 管理が限界の SMB。" +
      "リード割当・商談ログ・日報・案件進捗の自動化に課題があり、" +
      "営業マネージャーが集計作業に時間を取られている。",
    productDocs: [
      "提供価値: 営業のリード管理・商談ログ・日報集計を軽量自動化",
      "代表的な実績:",
      "- 営業日報の手集計を撤廃し、マネージャーの集計作業を週5時間削減",
      "- リードの自動割当により、初回コンタクト SLA を平均48時間→6時間に短縮",
      "- 商談ログから Pipeline ダッシュボードを自動生成、定例 MTG 準備時間を 80% カット",
      "ターゲット課題: SFA 未導入の営業組織、属人的なリード管理、日報の形骸化",
    ].join("\n"),
    dmStyle: "consultative",
  },

  TM_ceo: {
    id: "TM_ceo",
    name: "経営者向け業務自動化",
    senderName: "池田",
    recipientTitle: "代表取締役 / CEO / COO (従業員 10-200 名)",
    keywords: ["経営者", "業務自動化", "中小企業", "生産性", "業務改革"],
    icpDescription:
      "従業員 10-200 名規模の中小企業経営者で、現場の業務効率化を経営課題として認識しているが、" +
      "情シス専任がおらず ERP/SaaS の重い投資にも踏み切れない層。" +
      "「現場の小さい改善を 100 個積み上げる」アプローチに共感する経営者。",
    productDocs: [
      "提供価値: 経営者が現場の小さい属人作業を1つずつ自動化していくための軽量基盤",
      "代表的な実績:",
      "- 1 社あたり平均 4 業務を自動化し、月60時間の工数削減を実現",
      "- 累計80社、133システムのテンプレートカタログから即適用",
      "- LINE Bot UI でエンジニア不要、現場社員が自分で導入できる",
      "ターゲット課題: 情シス不在、ERP 投資判断の重さ、現場の属人化、人を採るほどでもない作業",
    ].join("\n"),
    dmStyle: "executive",
  },

  TM_jinji: {
    id: "TM_jinji",
    name: "人事/採用業務自動化",
    senderName: "池田",
    recipientTitle: "人事責任者 / 採用マネージャー / HRBP",
    keywords: ["人事", "採用", "勤怠管理", "オンボーディング", "HR"],
    icpDescription:
      "従業員 30-300 名規模、ATS (採用管理) や HRIS は導入済みだが、" +
      "それらの隙間業務 (候補者連絡 / 入社書類 / 勤怠例外処理) で人事 1-3 名が消耗している組織。" +
      "「採用を科学する」「人事を型化する」志向を持つ人事リーダー。",
    productDocs: [
      "提供価値: ATS/HRIS の \"隙間業務\" を自動化し、人事の手作業を撲滅",
      "代表的な実績:",
      "- 候補者への日程調整連絡を自動化し、人事 1 人あたり週8時間を解放",
      "- 入社書類の収集 / 督促を自動化、入社オンボーディングのリードタイムを 40% 短縮",
      "- 勤怠例外処理 (打刻漏れ / 申請差し戻し) の自動アラートで管理工数を半減",
      "ターゲット課題: 人事 1-3 名の属人化、ATS では拾えない連絡業務、入社オンボーディングの遅延",
    ].join("\n"),
    dmStyle: "warm",
  },
};

/**
 * preset ID から preset を引く。未知 ID は throw する。
 */
export function getCampaignPreset(id: string): CampaignPreset {
  const parsed = CampaignPresetIdSchema.safeParse(id);
  if (!parsed.success) {
    throw new Error(`[campaign-presets] Unknown preset id: ${id}`);
  }
  return CAMPAIGN_PRESETS[parsed.data];
}

/** preset を一覧で取得 (UI のドロップダウン用) */
export function listCampaignPresets(): readonly CampaignPreset[] {
  return CAMPAIGN_PRESET_IDS.map((id) => CAMPAIGN_PRESETS[id]);
}
