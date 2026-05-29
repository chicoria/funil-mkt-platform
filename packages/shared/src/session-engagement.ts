export type FunnelStage =
  | "AWARENESS"
  | "CONSIDERATION"
  | "CONVERSION"
  | "PURCHASE"
  | "RETENTION";

export interface VslSection {
  section_id: string;
  watched_sec: number;
}

export interface CtaClick {
  cta_id: string;
  count: number;
}

export interface SessionEngagementSnapshot {
  session_id: string;
  tenant_id: string;
  product_code: string;
  anonymous_id?: string;
  profile_id?: string;
  funnel_stage?: FunnelStage;
  first_seen_at: string;
  last_seen_at: string;
  page_views: number;
  max_scroll_pct: number;
  lp_sections_viewed: string[];
  lp_sections_engaged: string[];
  cta_clicks: CtaClick[];
  vsl_version?: string;
  vsl_max_pct: number;
  vsl_sections: VslSection[];
  became_lead: boolean;
  purchased: boolean;
}

const FUNNEL_STAGE_ORDER: FunnelStage[] = [
  "AWARENESS",
  "CONSIDERATION",
  "CONVERSION",
  "PURCHASE",
  "RETENTION",
];

function maxFunnelStage(a: FunnelStage | undefined, b: FunnelStage | undefined): FunnelStage | undefined {
  if (!a) return b;
  if (!b) return a;
  return FUNNEL_STAGE_ORDER.indexOf(a) >= FUNNEL_STAGE_ORDER.indexOf(b) ? a : b;
}

function mergeVslSections(current: VslSection[], patch: VslSection[]): VslSection[] {
  const map = new Map<string, number>(current.map((s) => [s.section_id, s.watched_sec]));
  for (const s of patch) {
    map.set(s.section_id, (map.get(s.section_id) ?? 0) + s.watched_sec);
  }
  return Array.from(map.entries()).map(([section_id, watched_sec]) => ({ section_id, watched_sec }));
}

function mergeCtaClicks(current: CtaClick[], patch: CtaClick[]): CtaClick[] {
  const map = new Map<string, number>(current.map((c) => [c.cta_id, c.count]));
  for (const c of patch) {
    map.set(c.cta_id, (map.get(c.cta_id) ?? 0) + c.count);
  }
  return Array.from(map.entries()).map(([cta_id, count]) => ({ cta_id, count }));
}

function unionStringArray(current: string[], patch: string[]): string[] {
  const set = new Set(current);
  for (const s of patch) set.add(s);
  return Array.from(set);
}

export function mergeSnapshot(
  current: SessionEngagementSnapshot,
  patch: Partial<SessionEngagementSnapshot>
): SessionEngagementSnapshot {
  return {
    ...current,
    anonymous_id: patch.anonymous_id ?? current.anonymous_id,
    profile_id: patch.profile_id ?? current.profile_id,
    funnel_stage: maxFunnelStage(current.funnel_stage, patch.funnel_stage),
    last_seen_at: patch.last_seen_at ?? current.last_seen_at,
    page_views: current.page_views + (patch.page_views ?? 0),
    max_scroll_pct: Math.max(current.max_scroll_pct, patch.max_scroll_pct ?? 0),
    lp_sections_viewed: patch.lp_sections_viewed
      ? unionStringArray(current.lp_sections_viewed, patch.lp_sections_viewed)
      : current.lp_sections_viewed,
    lp_sections_engaged: patch.lp_sections_engaged
      ? unionStringArray(current.lp_sections_engaged, patch.lp_sections_engaged)
      : current.lp_sections_engaged,
    cta_clicks: patch.cta_clicks
      ? mergeCtaClicks(current.cta_clicks, patch.cta_clicks)
      : current.cta_clicks,
    vsl_version: patch.vsl_version ?? current.vsl_version,
    vsl_max_pct: Math.max(current.vsl_max_pct, patch.vsl_max_pct ?? 0),
    vsl_sections: patch.vsl_sections
      ? mergeVslSections(current.vsl_sections, patch.vsl_sections)
      : current.vsl_sections,
    became_lead: current.became_lead || (patch.became_lead ?? false),
    purchased: current.purchased || (patch.purchased ?? false),
  };
}
