
import { redirect } from "next/navigation";
import Link from "next/link";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import styles from "../authority.module.css";

type ComplaintRow = {
  id: string;
  title: string | null;
  district: string | null;
  upazila: string | null;
  city_area: string | null;
  address_label: string | null;
  status: string;
  created_at: string;
  user_category: string | null;
  final_category: string | null;
  cluster_id: string | null;
  duplicate_of: string | null;
  lat: number | null;
  lng: number | null;
};

type InferenceRow = {
  complaint_id: string;
  fusion_label: string | null;
  fusion_confidence: number | null;
  conflict_flag: boolean | null;
  model_versions: Record<string, string> | null;
};

type RankedItem = {
  label: string;
  count: number;
  share: number;
};

type ClusterSummary = {
  clusterId: string;
  count: number;
  sampleArea: string;
  sampleCategory: string;
};

function getAreaName(complaint: ComplaintRow) {
  return (
    complaint.city_area ||
    complaint.upazila ||
    complaint.district ||
    complaint.address_label ||
    "Unknown"
  );
}

function parseBoolean(value?: string | null) {
  if (!value) return false;
  return value.toLowerCase() === "true";
}

function average(values: number[]) {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function nicePercent(value?: number | null) {
  if (value == null) return "N/A";
  return `${(value * 100).toFixed(1)}%`;
}

function confidenceLabel(value?: number | null) {
  if (value == null) return "Not available";
  if (value >= 0.85) return `High (${nicePercent(value)})`;
  if (value >= 0.6) return `Moderate (${nicePercent(value)})`;
  return `Low (${nicePercent(value)})`;
}

function countMapToSortedList(
  map: Map<string, number>,
  total: number,
  limit = 10
): RankedItem[] {
  return Array.from(map.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([label, count]) => ({
      label,
      count,
      share: total > 0 ? (count / total) * 100 : 0,
    }));
}

function buildComplaintsHref({
  status,
  review,
  area,
  category,
  duplicate,
  duplicateOf,
  cluster,
  clusterId,
  pattern,
}: {
  status?: string;
  review?: string;
  area?: string;
  category?: string;
  duplicate?: string;
  duplicateOf?: string;
  cluster?: string;
  clusterId?: string;
  pattern?: string;
}) {
  const search = new URLSearchParams();
  search.set("source", "analytics");
  if (status) search.set("status", status);
  if (review) search.set("review", review);
  if (area) search.set("area", area);
  if (category) search.set("category", category);
  if (duplicate) search.set("duplicate", duplicate);
  if (duplicateOf) search.set("duplicateOf", duplicateOf);
  if (cluster) search.set("cluster", cluster);
  if (clusterId) search.set("clusterId", clusterId);
  if (pattern) search.set("pattern", pattern);

  return `/authority/complaints?${search.toString()}`;
}

function MetricCard({
  label,
  value,
  text,
  href,
}: {
  label: string;
  value: string | number;
  text: string;
  href?: string;
}) {
  const content = (
    <div className={styles.statMiniCard}>
      <p className={styles.statMiniLabel}>{label}</p>
      <h3 className={styles.statMiniValue}>{value}</h3>
      <p className={styles.statMiniText}>{text}</p>
    </div>
  );

  if (href) {
    return (
      <Link href={href} className={styles.metricCardLink}>
        {content}
      </Link>
    );
  }

  return content;
}

function InsightCard({
  label,
  value,
  text,
}: {
  label: string;
  value: string | number;
  text: string;
}) {
  return (
    <div className={styles.summaryCard}>
      <p className={styles.summaryLabel}>{label}</p>
      <h3 className={styles.summaryValue}>{value}</h3>
      <p className={styles.summaryText}>{text}</p>
    </div>
  );
}

function BarChart({
  title,
  subtitle,
  items,
  fillClass,
}: {
  title: string;
  subtitle: string;
  items: RankedItem[];
  fillClass: string;
}) {
  const height = Math.max(220, items.length * 46 + 26);
  const max = Math.max(...items.map((item) => item.count), 1);

  return (
    <article className={styles.analyticsChartCard}>
      <h3 className={styles.sectionTitle} style={{ marginBottom: 8 }}>
        {title}
      </h3>
      <p className={styles.sectionText} style={{ marginBottom: 14 }}>
        {subtitle}
      </p>

      {items.length === 0 ? (
        <p className={styles.kvValue}>No data available.</p>
      ) : (
        <svg
          viewBox={`0 0 700 ${height}`}
          width="100%"
          height="100%"
          role="img"
          aria-label={title}
          className={styles.analyticsChartSvg}
        >
          {items.map((item, index) => {
            const y = 34 + index * 46;
            const barWidth = (item.count / max) * 320;

            return (
              <g key={item.label}>
                <text x="16" y={y} className={styles.analyticsChartLabel}>
                  {item.label}
                </text>

                <rect
                  x="250"
                  y={y - 14}
                  width="360"
                  height="12"
                  rx="999"
                  className={styles.analyticsChartTrack}
                />

                <rect
                  x="250"
                  y={y - 14}
                  width={barWidth}
                  height="12"
                  rx="999"
                  className={fillClass}
                />

                <text
                  x="680"
                  y={y}
                  textAnchor="end"
                  className={styles.analyticsChartValue}
                >
                  {item.count}
                </text>
              </g>
            );
          })}
        </svg>
      )}
    </article>
  );
}

function buildPatternHref(label: string) {
  const parts = label.split(" — ");
  const area = parts[0]?.trim() || "";
  const category = parts.slice(1).join(" — ").trim();

  return buildComplaintsHref({
    area: area || undefined,
    category: category || undefined,
  });
}

function MiniCardGrid({
  items,
  type,
}: {
  items: RankedItem[];
  type: "category" | "area" | "pattern";
}) {
  if (items.length === 0) {
    return <div className={styles.emptyBox}>No data available.</div>;
  }

  const toneClass =
    type === "category"
      ? styles.analyticsMiniBarFillCategory
      : type === "area"
        ? styles.analyticsMiniBarFillArea
        : styles.analyticsMiniBarFillPattern;

  return (
    <div className={styles.analyticsMiniGrid}>
      {items.map((item) => {
        const href =
          type === "category"
            ? buildComplaintsHref({ category: item.label })
            : type === "area"
              ? buildComplaintsHref({ area: item.label })
              : buildPatternHref(item.label);

        return (
          <Link key={item.label} href={href} className={styles.analyticsMiniLink}>
            <article className={styles.analyticsMiniCard}>
              <div className={styles.analyticsMiniTop}>
                <h3 className={styles.analyticsMiniTitle}>{item.label}</h3>
              </div>

              <div className={styles.analyticsMiniBottom}>
                <div className={styles.analyticsMiniMetaRow}>
                  <span className={styles.analyticsMiniMetaLabel}>Complaints</span>
                  <span className={styles.analyticsMiniMetaValue}>{item.count}</span>
                </div>

                <div className={styles.analyticsMiniBar}>
                  <div
                    className={`${styles.analyticsMiniBarFill} ${toneClass}`}
                    style={{ width: `${Math.max(item.share, 8)}%` }}
                  />
                </div>

                <p className={styles.analyticsMiniShare}>
                  {item.share.toFixed(1)}% of total complaints
                </p>
              </div>
            </article>
          </Link>
        );
      })}
    </div>
  );
}

function ClusterGrid({ items }: { items: ClusterSummary[] }) {
  if (items.length === 0) {
    return <div className={styles.emptyBox}>No repeated cluster groups available.</div>;
  }

  return (
    <div className={styles.analyticsMiniGrid}>
      {items.map((item) => (
        <Link
          key={item.clusterId}
          href={buildComplaintsHref({ cluster: "repeated", clusterId: item.clusterId })}
          className={styles.analyticsMiniLink}
        >
          <article className={styles.analyticsMiniCard}>
            <div className={styles.analyticsMiniTop}>
              <h3 className={styles.analyticsMiniTitle}>Cluster {item.clusterId}</h3>
            </div>

            <div className={styles.analyticsMiniBottom}>
              <div className={styles.analyticsMiniMetaRow}>
                <span className={styles.analyticsMiniMetaLabel}>Complaints</span>
                <span className={styles.analyticsMiniMetaValue}>{item.count}</span>
              </div>

              <div className={styles.analyticsMiniBar}>
                <div
                  className={`${styles.analyticsMiniBarFill} ${styles.analyticsMiniBarFillPattern}`}
                  style={{ width: `${Math.min(100, 18 + item.count * 16)}%` }}
                />
              </div>

              <p className={styles.analyticsMiniShare}>
                {item.sampleArea} • {item.sampleCategory}
              </p>
            </div>
          </article>
        </Link>
      ))}
    </div>
  );
}

function DuplicateLinkedList({
  items,
}: {
  items: Array<{
    id: string;
    title: string;
    area: string;
    duplicateOf: string;
  }>;
}) {
  if (items.length === 0) {
    return <div className={styles.emptyBox}>No duplicate-linked complaints available.</div>;
  }

  return (
    <div className={styles.dashboardInboxList}>
      {items.map((item) => (
        <Link
          key={item.id}
          href={buildComplaintsHref({ duplicate: "linked", duplicateOf: item.duplicateOf })}
          className={styles.dashboardInboxItem}
        >
          <div className={styles.dashboardInboxItemTop}>
            <h4 className={styles.dashboardInboxItemTitle}>{item.title}</h4>
            <span className={styles.chip}>Duplicate</span>
          </div>
          <p className={styles.dashboardInboxItemMeta}>
            {item.area} • Linked to complaint {item.duplicateOf}
          </p>
        </Link>
      ))}
    </div>
  );
}

export default async function AuthorityAnalyticsPage() {
  const cookieStore = await cookies();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set() { },
        remove() { },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/authority/analytics");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, is_verified")
    .eq("id", user.id)
    .single();

  if (!profile?.is_verified) {
    redirect("/login?next=/authority/analytics&verify=1");
  }

  if (profile.role !== "authority") {
    redirect("/");
  }

  const { data: complaintsData, error: complaintsError } = await supabase
    .from("complaints")
    .select(`
      id,
      title,
      district,
      upazila,
      city_area,
      address_label,
      status,
      created_at,
      user_category,
      final_category,
      cluster_id,
      duplicate_of,
      lat,
      lng
    `)
    .order("created_at", { ascending: false });

  if (complaintsError) {
    return (
      <main className={styles.page}>
        <div className={styles.wrapper}>
          <div className={styles.alertBox}>
            Failed to load analytics data: {complaintsError.message}
          </div>
        </div>
      </main>
    );
  }

  const complaints = (complaintsData ?? []) as ComplaintRow[];
  const complaintIds = complaints.map((item) => item.id);
  const inferenceByComplaint = new Map<string, InferenceRow>();

  if (complaintIds.length > 0) {
    const { data: inferenceRows } = await supabase
      .from("inference_results")
      .select(`
        complaint_id,
        fusion_label,
        fusion_confidence,
        conflict_flag,
        model_versions
      `)
      .in("complaint_id", complaintIds);

    for (const row of (inferenceRows ?? []) as InferenceRow[]) {
      inferenceByComplaint.set(row.complaint_id, row);
    }
  }

  const totalComplaints = complaints.length;
  const mappedComplaintCount = complaints.filter(
    (item) => item.lat != null && item.lng != null
  ).length;

  const statusCounts = new Map<string, number>();
  const categoryCounts = new Map<string, number>();
  const areaCounts = new Map<string, number>();
  const repeatedPatternCounts = new Map<string, number>();
  const clusterMeta = new Map<string, ClusterSummary>();

  let manualReviewCount = 0;
  let reliableCount = 0;
  let conflictCount = 0;
  let duplicateLinkedCount = 0;
  let priorityComputedCount = 0;
  let escalateNowCount = 0;

  for (const complaint of complaints) {
    const ai = inferenceByComplaint.get(complaint.id);

    const status = complaint.status || "unknown";
    statusCounts.set(status, (statusCounts.get(status) ?? 0) + 1);

    const category =
      complaint.final_category ||
      ai?.fusion_label ||
      complaint.user_category ||
      "Uncategorized";

    categoryCounts.set(category, (categoryCounts.get(category) ?? 0) + 1);

    const area = getAreaName(complaint);
    areaCounts.set(area, (areaCounts.get(area) ?? 0) + 1);

    const repeatedKey = `${area} — ${category}`;
    repeatedPatternCounts.set(
      repeatedKey,
      (repeatedPatternCounts.get(repeatedKey) ?? 0) + 1
    );

    if (complaint.cluster_id) {
      const existing = clusterMeta.get(complaint.cluster_id);
      if (existing) {
        existing.count += 1;
      } else {
        clusterMeta.set(complaint.cluster_id, {
          clusterId: complaint.cluster_id,
          count: 1,
          sampleArea: area,
          sampleCategory: category,
        });
      }
    }

    if (complaint.duplicate_of) {
      duplicateLinkedCount += 1;
    }

    const reliabilityStatus = ai?.model_versions?.reliability_status;
    const manualReviewRequired = parseBoolean(
      ai?.model_versions?.manual_review_required
    );
    const citizenAiConflict = parseBoolean(
      ai?.model_versions?.citizen_ai_conflict
    );
    const priorityStatus = ai?.model_versions?.priority_status;
    const escalationStatus =
      ai?.model_versions?.escalation_status || ai?.model_versions?.escalation;

    if (reliabilityStatus === "reliable") {
      reliableCount += 1;
    }

    if (manualReviewRequired) {
      manualReviewCount += 1;
    }

    if (ai?.conflict_flag || citizenAiConflict) {
      conflictCount += 1;
    }

    if (priorityStatus === "computed") {
      priorityComputedCount += 1;
    }

    if (escalationStatus === "escalate_now") {
      escalateNowCount += 1;
    }
  }

  const submittedCount = statusCounts.get("submitted") ?? 0;
  const processingCount = statusCounts.get("processing") ?? 0;
  const resolvedOnlyCount = statusCounts.get("resolved") ?? 0;
  const completedCount = statusCounts.get("completed") ?? 0;
  const resolvedCombinedCount = resolvedOnlyCount + completedCount;
  const rejectedCount = statusCounts.get("rejected") ?? 0;
  const openCount = submittedCount + processingCount;

  const topCategories = countMapToSortedList(categoryCounts, totalComplaints, 10);
  const topAreas = countMapToSortedList(areaCounts, totalComplaints, 10);
  const repeatedPatterns = countMapToSortedList(
    repeatedPatternCounts,
    totalComplaints,
    10
  );

  const repeatedClusters = Array.from(clusterMeta.values())
    .filter((item) => item.count > 1)
    .sort((a, b) => b.count - a.count);

  const duplicateLinkedItems = complaints
    .filter((item) => Boolean(item.duplicate_of))
    .slice(0, 8)
    .map((item) => ({
      id: item.id,
      title: item.title || "Untitled complaint",
      area: getAreaName(item),
      duplicateOf: item.duplicate_of || "",
    }));

  const statusChartItems = [
    { label: "Submitted", count: submittedCount, share: 0 },
    { label: "Processing", count: processingCount, share: 0 },
    { label: "Resolved / Completed", count: resolvedCombinedCount, share: 0 },
    { label: "Rejected", count: rejectedCount, share: 0 },
  ]
    .filter((item) => item.count > 0)
    .map((item) => ({
      ...item,
      share: totalComplaints > 0 ? (item.count / totalComplaints) * 100 : 0,
    }));

  const aiRows = complaints
    .map((complaint) => inferenceByComplaint.get(complaint.id))
    .filter((item): item is InferenceRow => Boolean(item));

  const avgFusionConfidence = average(
    aiRows
      .map((row) => row.fusion_confidence)
      .filter((value): value is number => value != null)
  );

  const manualReviewRate = totalComplaints > 0 ? manualReviewCount / totalComplaints : 0;
  const reliableRate = totalComplaints > 0 ? reliableCount / totalComplaints : 0;
  const conflictRate = totalComplaints > 0 ? conflictCount / totalComplaints : 0;
  const closureRate = totalComplaints > 0 ? resolvedCombinedCount / totalComplaints : 0;
  const mapCoverage = totalComplaints > 0 ? mappedComplaintCount / totalComplaints : 0;

  return (
    <main className={styles.page}>
      <div className={styles.wrapper}>
        <section className={styles.pageGrid}>
          <aside className={styles.sidebar}>
            <div className={styles.sidebarCard}>
              <p className={styles.sidebarEyebrow}>Authority workspace</p>
              <h2 className={styles.sidebarTitle}>Analytics</h2>
              <p className={styles.sidebarText}>
                Review complaint patterns, hotspots, category trends, and AI review
                signals in a cleaner analytics workspace.
              </p>

              <nav className={styles.sidebarNav}>
                <Link href="/" className={styles.sidebarLink}>
                  Back to homepage
                </Link>
                <Link href="/authority" className={styles.sidebarLink}>
                  Authority dashboard
                </Link>
                <Link href="/authority/complaints" className={styles.sidebarLink}>
                  Manage complaints
                </Link>

                <Link href="/authority/analytics/hotspots" className={styles.sidebarLink}>
                  View Hotspots
                </Link>

                <Link href="/authority/analytics" className={styles.sidebarLinkActive}>
                  Authority analytics
                </Link>

              </nav>
            </div>
          </aside>

          <div className={styles.mainContent}>
            <section className={styles.hero}>
              <p className={styles.eyebrow}>Authority analytics workspace</p>
              <h1 className={styles.title}>Complaint analytics and issue insights</h1>
              <p className={styles.subtitle}>
                A cleaner analytics dashboard for operational trends, hotspot visibility,
                and direct drill-downs into the complaint queue.
              </p>

              <div className={styles.statStrip}>
                <MetricCard
                  label="Total complaints"
                  value={totalComplaints}
                  text="All complaint records in the current analytics scope."
                  href={buildComplaintsHref({})}
                />
                <MetricCard
                  label="Open cases"
                  value={openCount}
                  text="Submitted and processing complaints still needing action."
                  href={buildComplaintsHref({ status: "open" })}
                />
                <MetricCard
                  label="Manual review"
                  value={manualReviewCount}
                  text="Cases flagged for careful authority verification."
                  href={buildComplaintsHref({ review: "manual_review" })}
                />
                <MetricCard
                  label="Conflict cases"
                  value={conflictCount}
                  text="Complaints where complaint signals do not align cleanly."
                  href={buildComplaintsHref({ review: "conflict" })}
                />
              </div>
            </section>

            <section className={styles.section}>
              <div className={styles.sectionHeader}>
                <div>
                  <h2 className={styles.sectionTitle}>AI review insights</h2>
                  <p className={styles.sectionText}>
                    This section gives a broader analytical overview of AI usage, review load, closure behaviour, and priority activity.
                  </p>
                </div>

                <div className={styles.complaintsFilterActions}>
                  <Link href="/authority/complaints" className={styles.primaryLink}>
                    Manage complaints
                  </Link>
                  <Link href="/authority" className={styles.secondaryLink}>
                    Back to dashboard
                  </Link>
                </div>
              </div>

              <div className={styles.summaryGrid}>
                <InsightCard
                  label="Average AI confidence"
                  value={confidenceLabel(avgFusionConfidence)}
                  text="Average confidence of saved AI category suggestions."
                />
                <InsightCard
                  label="Priority computed"
                  value={priorityComputedCount}
                  text="Complaints with a computed queue position from the current priority logic."
                />
                <InsightCard
                  label="Needs escalation now"
                  value={escalateNowCount}
                  text="Complaints that have exceeded the current response window."
                />
                <InsightCard
                  label="Reliable AI cases"
                  value={reliableCount}
                  text="Complaints where the saved AI output is marked reliable."
                />
                <InsightCard
                  label="Manual review rate"
                  value={nicePercent(manualReviewRate)}
                  text="Share of complaints currently needing closer human verification."
                />
                <InsightCard
                  label="Conflict rate"
                  value={nicePercent(conflictRate)}
                  text="Share of complaints where complaint signals do not align cleanly."
                />
                <InsightCard
                  label="Closure rate"
                  value={nicePercent(closureRate)}
                  text="Share of complaints already resolved or completed."
                />
                <InsightCard
                  label="Map coverage"
                  value={nicePercent(mapCoverage)}
                  text="Share of complaints that currently include coordinates for hotspot mapping."
                />
              </div>
            </section>

            <section className={styles.section}>
              <div className={styles.sectionHeader}>
                <div>
                  <h2 className={styles.sectionTitle}>Clickable drill-down cards</h2>
                  <p className={styles.sectionText}>
                    These cards open the complaint queue or the separate hotspot page with the intended filter or view.
                  </p>
                </div>
              </div>

              <div className={styles.statStrip}>
                <MetricCard
                  label="Open real hotspot map"
                  value={mappedComplaintCount}
                  text="Open the separate real map heatmap page built from complaint coordinates."
                  href="/authority/analytics/hotspots"
                />
                <MetricCard
                  label="Duplicate linked"
                  value={duplicateLinkedCount}
                  text="Opens the complaint queue using the future duplicate-linked filter."
                  href={buildComplaintsHref({ duplicate: "linked" })}
                />
                <MetricCard
                  label="Repeated clusters"
                  value={repeatedClusters.length}
                  text="Opens the complaint queue using the future repeated-cluster filter."
                  href={buildComplaintsHref({ cluster: "repeated" })}
                />
                <MetricCard
                  label="Frequent / repeated issues"
                  value={repeatedPatterns.length}
                  text="Opens the complaint queue using the future repeated-issue filter."
                  href={buildComplaintsHref({ pattern: "repeated" })}
                />
              </div>
            </section>

            <section className={styles.section}>
              <div className={styles.sectionHeader}>
                <div>
                  <h2 className={styles.sectionTitle}>Operational charts</h2>
                  <p className={styles.sectionText}>
                    Status flow, category spread, and area concentration from the current complaint data.
                  </p>
                </div>
              </div>

              <div className={styles.analyticsChartGrid}>
                <BarChart
                  title="Complaint status distribution"
                  subtitle="Current complaint counts by workflow stage."
                  items={statusChartItems}
                  fillClass={styles.analyticsChartFillTeal}
                />

                <BarChart
                  title="Top complaint categories"
                  subtitle="Final category when available, otherwise the best available complaint category."
                  items={topCategories.slice(0, 5)}
                  fillClass={styles.analyticsChartFillBlue}
                />
              </div>

              <div className={styles.analyticsChartGrid}>
                <BarChart
                  title="Top affected areas"
                  subtitle="Areas currently receiving the highest number of complaints."
                  items={topAreas.slice(0, 5)}
                  fillClass={styles.analyticsChartFillTeal}
                />

                <BarChart
                  title="Repeated issue patterns"
                  subtitle="Area and category combinations that recur most often."
                  items={repeatedPatterns.slice(0, 5)}
                  fillClass={styles.analyticsChartFillBlue}
                />
              </div>

              <div className={styles.statStrip}>
                <MetricCard
                  label="Submitted"
                  value={submittedCount}
                  text="New complaints waiting in queue."
                  href={buildComplaintsHref({ status: "submitted" })}
                />
                <MetricCard
                  label="Processing"
                  value={processingCount}
                  text="Cases currently under authority handling."
                  href={buildComplaintsHref({ status: "processing" })}
                />
                <MetricCard
                  label="Resolved / Completed"
                  value={resolvedCombinedCount}
                  text="Issues already closed by authority action."
                  href={buildComplaintsHref({ status: "resolved_all" })}
                />
                <MetricCard
                  label="Rejected"
                  value={rejectedCount}
                  text="Complaints rejected after review."
                  href={buildComplaintsHref({ status: "rejected" })}
                />
              </div>
            </section>

            <section className={styles.section}>
              <div className={styles.sectionHeader}>
                <div>
                  <h2 className={styles.sectionTitle}>Category intelligence</h2>
                  <p className={styles.sectionText}>
                    Click a category card to open filtered complaints in the operational queue.
                  </p>
                </div>
              </div>

              <MiniCardGrid items={topCategories} type="category" />
            </section>

            <section className={styles.section}>
              <div className={styles.sectionHeader}>
                <div>
                  <h2 className={styles.sectionTitle}>Area hotspot overview</h2>
                  <p className={styles.sectionText}>
                    Click an area card to open hotspot-related complaints in the operational queue.
                  </p>
                </div>
              </div>

              <MiniCardGrid items={topAreas} type="area" />
            </section>

            <section className={styles.section} id="repeated-patterns">
              <div className={styles.sectionHeader}>
                <div>
                  <h2 className={styles.sectionTitle}>Frequent / repeated issue patterns</h2>
                  <p className={styles.sectionText}>
                    Click a repeated pattern card to open complaints filtered by both area and category.
                  </p>
                </div>
              </div>

              <MiniCardGrid items={repeatedPatterns} type="pattern" />
            </section>

            <section className={styles.section} id="repeated-clusters">
              <div className={styles.sectionHeader}>
                <div>
                  <h2 className={styles.sectionTitle}>Repeated cluster groups</h2>
                  <p className={styles.sectionText}>
                    Cluster cards now carry future queue filter parameters for repeated-cluster review.
                  </p>
                </div>
              </div>

              <ClusterGrid items={repeatedClusters} />
            </section>

            <section className={styles.section} id="duplicate-linked">
              <div className={styles.sectionHeader}>
                <div>
                  <h2 className={styles.sectionTitle}>Duplicate-linked complaints</h2>
                  <p className={styles.sectionText}>
                    These links now carry future duplicate filter parameters into the complaint queue.
                  </p>
                </div>
              </div>

              <article className={styles.dashboardInboxCard}>
                <DuplicateLinkedList items={duplicateLinkedItems} />
              </article>
            </section>
          </div>
        </section>
      </div>
    </main>
  );
}
