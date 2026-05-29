/**
 * Workers Analytics Engine writer for raw engagement events.
 *
 * Blob layout (fixed positions for SQL queries):
 *   [0] tenant_id
 *   [1] product_code
 *   [2] anonymous_id
 *   [3] session_id
 *   [4] event_type
 *   [5] section_id  (lp_section) or vsl_section_key (VSL events)
 *
 * Double layout:
 *   [0] visible_pct / vsl_max_pct (0 if absent)
 *   [1] video_time_sec (0 if absent)
 *   [2] section_index (0 if absent)
 */

import type { FunnelEvent } from "../../../../packages/shared/src/funnel-event";
import type { AnalyticsEngineDataset } from "../dispatcher";

const ENGAGEMENT_EVENT_TYPES = new Set([
  "SECTION_VIEW",
  "SECTION_ENGAGED",
  "VSL_SECTION_START",
  "VSL_SECTION_END",
  "VSL_SECTION_PROGRESS",
  "ENGAGEMENT_SNAPSHOT",
]);

function asNum(v: unknown, fallback = 0): number {
  return typeof v === "number" && isFinite(v) ? v : fallback;
}

function asStr(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

export function writeEngagementAe(
  event: FunnelEvent,
  ae: AnalyticsEngineDataset | undefined,
  tenantId: string
): void {
  if (!ae) return;
  if (!ENGAGEMENT_EVENT_TYPES.has(event.event_type)) return;

  const p = event.payload;
  const anonymousId = asStr(event.identity?.anonymous_id) || asStr(event.identity?.session_id);
  const sessionId   = asStr(event.identity?.session_id);

  // blob[5]: section identifier depends on event type
  const sectionKey =
    event.event_type.startsWith("VSL_")
      ? asStr(p["vsl_section_key"])
      : asStr(p["section_id"]);

  ae.writeDataPoint({
    blobs: [
      tenantId,
      event.product_code,
      anonymousId,
      sessionId,
      event.event_type,
      sectionKey,
    ],
    doubles: [
      asNum(p["visible_pct"] ?? p["vsl_max_pct"]),
      asNum(p["video_time_sec"]),
      asNum(p["section_index"]),
    ],
    indexes: anonymousId ? [anonymousId] : undefined,
  });
}
