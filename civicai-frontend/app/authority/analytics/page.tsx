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

function getAreaName(complaint: ComplaintRow) {
  return (
    complaint.city_area ||
    complaint.upazila ||
    complaint.district ||
    complaint.address_label ||
    "Unknown"
  );
}

function niceLabel(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (m) => m.toUpperCase());
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
}: {
  status?: string;
  review?: string;
  area?: string;
  category?: string;
}) {
  const search = new URLSearchParams();
  search.set("source", "analytics");
  if (status) search.set("status", status);
  if (review) search.set("review", review);
  if (area) search.set("area", area);
  if (category) search.set("category", category);

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

function BarChart({
  title,
  items,
  fillClass,
}: {
  title: string;
  items: RankedItem[];
  fillClass: string;
}) {
  const height = Math.max(220, items.length * 46 + 26);
  const max = Math.max(...items.map((item) => item.count), 1);

  return (
    <article className={styles.analyticsChartCard}>
      <p className={styles.kvLabel}>{title}</p>

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
                  {niceLabel(item.label)}
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
        set() {},
        remove() {},
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
      duplicate_of
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

  const statusCounts = new Map<string, number>();
  const categoryCounts = new Map<string, number>();
  const areaCounts = new Map<string, number>();
  const repeatedPatternCounts = new Map<string, number>();
  const clusterCounts = new Map<string, number>();

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
      clusterCounts.set(
        complaint.cluster_id,
        (clusterCounts.get(complaint.cluster_id) ?? 0) + 1
      );
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

  const statusChartItems = [
    { label: "submitted", count: submittedCount, share: 0 },
    { label: "processing", count: processingCount, share: 0 },
    { label: "resolved", count: resolvedCombinedCount, share: 0 },
    { label: "rejected", count: rejectedCount, share: 0 },
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

  const repeatedClusterGroups = Array.from(clusterCounts.values()).filter(
    (count) => count > 1
  ).length;

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
                A clearer analytics dashboard for operational trends, priority
                visibility, and category or area drill-downs into the complaints queue.
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
                />
                <MetricCard
                  label="Reliable AI"
                  value={reliableCount}
                  text="Complaints where AI can be used as a strong starting point."
                />
                <MetricCard
                  label="Manual review"
                  value={manualReviewCount}
                  text="Cases flagged for careful authority verification."
                  href={buildComplaintsHref({ review: "manual_review" })}
                />
              </div>
            </section>

            <section className={styles.section}>
              <div className={styles.sectionHeader}>
                <div>
                  <h2 className={styles.sectionTitle}>AI review insights</h2>
                  <p className={styles.sectionText}>
                    High-level AI performance signals that authorities can understand quickly.
                  </p>
                </div>

                <Link href="/authority" className={styles.secondaryLink}>
                  Back to dashboard
                </Link>
              </div>

              <div className={styles.summaryGrid}>
                <div className={styles.summaryCard}>
                  <p className={styles.summaryLabel}>Average AI confidence</p>
                  <h3 className={styles.summaryValue}>
                    {confidenceLabel(avgFusionConfidence)}
                  </h3>
                  <p className={styles.summaryText}>
                    Average confidence of saved AI category suggestions.
                  </p>
                </div>

                <div className={styles.summaryCard}>
                  <p className={styles.summaryLabel}>Priority computed</p>
                  <h3 className={styles.summaryValue}>{priorityComputedCount}</h3>
                  <p className={styles.summaryText}>
                    Complaints with a computed queue position from the current priority logic.
                  </p>
                </div>

                <div className={styles.summaryCard}>
                  <p className={styles.summaryLabel}>Needs escalation now</p>
                  <h3 className={styles.summaryValue}>{escalateNowCount}</h3>
                  <p className={styles.summaryText}>
                    Complaints that have exceeded the current response window.
                  </p>
                </div>
              </div>

              <div className={styles.statStrip}>
                <MetricCard
                  label="Conflict cases"
                  value={conflictCount}
                  text="Cases where AI and complaint signals do not align cleanly."
                  href={buildComplaintsHref({ review: "conflict" })}
                />
                <MetricCard
                  label="Duplicate linked"
                  value={duplicateLinkedCount}
                  text="Complaints already linked to another complaint."
                />
                <MetricCard
                  label="Repeated clusters"
                  value={repeatedClusterGroups}
                  text="Cluster groups containing more than one complaint."
                />
                <MetricCard
                  label="Avg confidence"
                  value={nicePercent(avgFusionConfidence)}
                  text="Average saved fusion confidence across AI-scored complaints."
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
                  items={statusChartItems}
                  fillClass={styles.analyticsChartFillTeal}
                />

                <BarChart
                  title="Top complaint categories"
                  items={topCategories.slice(0, 5)}
                  fillClass={styles.analyticsChartFillBlue}
                />
              </div>

              <div className={styles.analyticsChartGrid}>
                <BarChart
                  title="Top affected areas"
                  items={topAreas.slice(0, 5)}
                  fillClass={styles.analyticsChartFillTeal}
                />

                <BarChart
                  title="Repeated issue patterns"
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

            <section className={styles.section}>
              <div className={styles.sectionHeader}>
                <div>
                  <h2 className={styles.sectionTitle}>Repeated issue patterns</h2>
                  <p className={styles.sectionText}>
                    Click a repeated pattern card to open complaints filtered by both area and category.
                  </p>
                </div>
              </div>

              <MiniCardGrid items={repeatedPatterns} type="pattern" />
            </section>
          </div>
        </section>
      </div>
    </main>
  );
}