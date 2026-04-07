import { redirect } from "next/navigation";
import Link from "next/link";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import styles from "./authority.module.css";
import AuthorityDashboardThumb from "./AuthorityDashboardThumb";

type ComplaintRow = {
  id: string;
  title: string | null;
  description: string;
  reporter_name: string | null;
  district: string | null;
  upazila: string | null;
  city_area: string | null;
  address_label: string | null;
  status: string;
  created_at: string;
  user_category: string | null;
  final_category: string | null;
  category_source: string | null;
};

type ComplaintMediaRow = {
  complaint_id: string;
  public_url: string | null;
  created_at: string;
};

type InferenceRow = {
  complaint_id: string;
  fusion_label: string | null;
  fusion_confidence: number | null;
  priority: string | null;
  priority_score: number | null;
  conflict_flag: boolean | null;
  summary: string | null;
  model_versions: Record<string, string> | null;
};

type RankedItem = {
  label: string;
  count: number;
  share: number;
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-BD", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Dhaka",
  }).format(new Date(value));
}

function parseNumber(value?: string | null) {
  if (!value) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function nicePercent(value?: number | null) {
  if (value == null) return "Pending";
  return `${(value * 100).toFixed(1)}%`;
}

function statusClass(status: string) {
  switch (status) {
    case "submitted":
      return styles.badgeSubmitted;
    case "processing":
      return styles.badgeProcessing;
    case "completed":
    case "resolved":
      return styles.badgeResolved;
    case "rejected":
      return styles.badgeRejected;
    default:
      return styles.badge;
  }
}

function priorityClass(priority?: string | null) {
  switch (priority) {
    case "high":
      return styles.priorityHigh;
    case "medium":
      return styles.priorityMedium;
    case "low":
      return styles.priorityLow;
    default:
      return styles.chip;
  }
}

function reliabilityClass(value?: string | null) {
  switch (value) {
    case "reliable":
      return styles.priorityLow;
    case "needs_review":
      return styles.chipWarn;
    case "low_confidence":
      return styles.chipWarn;
    case "conflict_detected":
      return styles.priorityMedium;
    case "insufficient_evidence":
      return styles.priorityHigh;
    default:
      return styles.chip;
  }
}

function reliabilityLabel(value?: string | null) {
  switch (value) {
    case "reliable":
      return "Reliable";
    case "needs_review":
      return "Needs review";
    case "low_confidence":
      return "Low confidence";
    case "conflict_detected":
      return "Conflict";
    case "insufficient_evidence":
      return "Insufficient evidence";
    default:
      return "Pending";
  }
}

function getAreaName(complaint: ComplaintRow) {
  return complaint.city_area || complaint.upazila || complaint.district || "Unknown";
}

function niceLabel(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function countMapToSortedList(
  map: Map<string, number>,
  total: number,
  limit = 6
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

function average(values: number[]) {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
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
  if (status) search.set("status", status);
  if (review) search.set("review", review);
  if (area) search.set("area", area);
  if (category) search.set("category", category);

  const qs = search.toString();
  return qs ? `/authority/complaints?${qs}` : "/authority/complaints";
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

function InboxPanel({
  title,
  subtitle,
  items,
  emptyText,
  badgeClass,
}: {
  title: string;
  subtitle: string;
  items: Array<{
    id: string;
    title: string;
    meta: string;
    badge: string;
  }>;
  emptyText: string;
  badgeClass?: string;
}) {
  return (
    <article className={styles.dashboardInboxCard}>
      <div className={styles.dashboardInboxHeader}>
        <div>
          <h3 className={styles.dashboardInboxTitle}>{title}</h3>
          <p className={styles.dashboardInboxText}>{subtitle}</p>
        </div>
      </div>

      {items.length === 0 ? (
        <div className={styles.emptyBox}>{emptyText}</div>
      ) : (
        <div className={styles.dashboardInboxList}>
          {items.map((item) => (
            <Link
              key={item.id}
              href={`/authority/${item.id}`}
              className={styles.dashboardInboxItem}
            >
              <div className={styles.dashboardInboxItemTop}>
                <h4 className={styles.dashboardInboxItemTitle}>{item.title}</h4>
                <span className={badgeClass || styles.chip}>{item.badge}</span>
              </div>
              <p className={styles.dashboardInboxItemMeta}>{item.meta}</p>
            </Link>
          ))}
        </div>
      )}
    </article>
  );
}

export default async function AuthorityPage() {
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
    redirect("/login?next=/authority");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, is_verified")
    .eq("id", user.id)
    .single();

  if (!profile?.is_verified) {
    redirect("/login?next=/authority&verify=1");
  }

  if (profile.role !== "authority") {
    redirect("/");
  }

  const { data: complaintsData, error: complaintsError } = await supabase
    .from("complaints")
    .select(`
      id,
      title,
      description,
      reporter_name,
      district,
      upazila,
      city_area,
      address_label,
      status,
      created_at,
      user_category,
      final_category,
      category_source
    `)
    .order("created_at", { ascending: false });

  if (complaintsError) {
    return (
      <main className={styles.page}>
        <div className={styles.wrapper}>
          <div className={styles.alertBox}>
            Failed to load complaints: {complaintsError.message}
          </div>
        </div>
      </main>
    );
  }

  const complaints = (complaintsData ?? []) as ComplaintRow[];
  const complaintIds = complaints.map((item) => item.id);

  const mediaByComplaint = new Map<string, ComplaintMediaRow>();
  const inferenceByComplaint = new Map<string, InferenceRow>();

  if (complaintIds.length > 0) {
    const { data: mediaRows } = await supabase
      .from("complaint_media")
      .select("complaint_id, public_url, created_at")
      .in("complaint_id", complaintIds)
      .eq("media_type", "image")
      .order("created_at", { ascending: true });

    const { data: inferenceRows } = await supabase
      .from("inference_results")
      .select(`
        complaint_id,
        fusion_label,
        fusion_confidence,
        priority,
        priority_score,
        conflict_flag,
        summary,
        model_versions
      `)
      .in("complaint_id", complaintIds);

    for (const row of (mediaRows ?? []) as ComplaintMediaRow[]) {
      if (!mediaByComplaint.has(row.complaint_id)) {
        mediaByComplaint.set(row.complaint_id, row);
      }
    }

    for (const row of (inferenceRows ?? []) as InferenceRow[]) {
      inferenceByComplaint.set(row.complaint_id, row);
    }
  }

  const totalComplaints = complaints.length;
  const submittedCount = complaints.filter((item) => item.status === "submitted").length;
  const processingCount = complaints.filter((item) => item.status === "processing").length;
  const resolvedOnlyCount = complaints.filter((item) => item.status === "resolved").length;
  const completedCount = complaints.filter((item) => item.status === "completed").length;
  const rejectedCount = complaints.filter((item) => item.status === "rejected").length;
  const resolvedCount = resolvedOnlyCount + completedCount;

  const highPriorityCount = complaints.filter((item) => {
    const ai = inferenceByComplaint.get(item.id);
    return ai?.priority === "high";
  }).length;

  const manualReviewCount = complaints.filter((item) => {
    const ai = inferenceByComplaint.get(item.id);
    return ai?.model_versions?.manual_review_required === "true";
  }).length;

  const conflictCount = complaints.filter((item) => {
    const ai = inferenceByComplaint.get(item.id);
    const citizenAiConflict = ai?.model_versions?.citizen_ai_conflict === "true";
    return !!ai?.conflict_flag || citizenAiConflict;
  }).length;

  const categoryCounts = new Map<string, number>();
  const areaCounts = new Map<string, number>();

  for (const complaint of complaints) {
    const category =
      complaint.final_category ||
      complaint.user_category ||
      inferenceByComplaint.get(complaint.id)?.fusion_label ||
      "Uncategorized";

    categoryCounts.set(category, (categoryCounts.get(category) ?? 0) + 1);

    const area = getAreaName(complaint);
    areaCounts.set(area, (areaCounts.get(area) ?? 0) + 1);
  }

  const topCategories = countMapToSortedList(categoryCounts, totalComplaints, 5);
  const topAreas = countMapToSortedList(areaCounts, totalComplaints, 5);

  const statusChartItems: RankedItem[] = [
    { label: "submitted", count: submittedCount, share: 0 },
    { label: "processing", count: processingCount, share: 0 },
    { label: "resolved", count: resolvedCount, share: 0 },
    { label: "rejected", count: rejectedCount, share: 0 },
  ].filter((item) => item.count > 0);

  const manualReviewComplaints = complaints
    .filter((complaint) => {
      const ai = inferenceByComplaint.get(complaint.id);
      return ai?.model_versions?.manual_review_required === "true";
    })
    .slice(0, 3);

  const conflictComplaints = complaints
    .filter((complaint) => {
      const ai = inferenceByComplaint.get(complaint.id);
      const citizenAiConflict = ai?.model_versions?.citizen_ai_conflict === "true";
      return !!ai?.conflict_flag || citizenAiConflict;
    })
    .slice(0, 3);

  const recentComplaints = complaints.slice(0, 6);

  const aiRows = complaints
    .map((complaint) => inferenceByComplaint.get(complaint.id))
    .filter((item): item is InferenceRow => Boolean(item));

  const adaptiveFusionCount = aiRows.filter((row) => {
    const strategy = row.model_versions?.fusion_strategy || "";
    const textWeight = parseNumber(row.model_versions?.text_weight);
    const imageWeight = parseNumber(row.model_versions?.image_weight);
    return strategy.includes("adaptive") || textWeight != null || imageWeight != null;
  }).length;

  const areaSignalCount = aiRows.filter((row) => {
    const score = parseNumber(row.model_versions?.area_frequency_score);
    return score != null && score > 0;
  }).length;

  const thresholdConflictCount = aiRows.filter((row) => {
    const textThreshold = parseNumber(row.model_versions?.conflict_threshold_text);
    const imageThreshold = parseNumber(row.model_versions?.conflict_threshold_image);
    return textThreshold != null && imageThreshold != null;
  }).length;

  const avgFusionConfidence = average(
    aiRows
      .map((row) => row.fusion_confidence)
      .filter((value): value is number => value != null)
  );

  const avgTextWeight = average(
    aiRows
      .map((row) => parseNumber(row.model_versions?.text_weight))
      .filter((value): value is number => value != null)
  );

  return (
    <main className={styles.page}>
      <div className={styles.wrapper}>
        <section className={styles.pageGrid}>
          <aside className={styles.sidebar}>
            <div className={styles.sidebarCard}>
              <p className={styles.sidebarEyebrow}>Authority workspace</p>
              <h2 className={styles.sidebarTitle}>Dashboard</h2>
              <p className={styles.sidebarText}>
                Review complaint submissions, inspect AI reliability, and focus on
                cases that require manual authority attention.
              </p>

              <nav className={styles.sidebarNav}>
                <Link href="/" className={styles.sidebarLink}>
                  Back to homepage
                </Link>
                <Link href="/authority" className={styles.sidebarLinkActive}>
                  Authority dashboard
                </Link>
                <Link href="/authority/complaints" className={styles.sidebarLink}>
                  Manage complaints
                </Link>
                <Link href="/authority/analytics" className={styles.sidebarLink}>
                  Open analytics
                </Link>
              </nav>
            </div>
          </aside>

          <div className={styles.mainContent}>
            <section className={styles.hero}>
              <p className={styles.eyebrow}>Authority review workspace</p>
              <h1 className={styles.title}>Complaint operations dashboard</h1>
              <p className={styles.subtitle}>
                A cleaner authority dashboard for day-to-day monitoring, urgent review,
                and quick movement into analytics or complaint detail pages.
              </p>

              <div className={styles.statStrip}>
                <MetricCard
                  label="Total complaints"
                  value={totalComplaints}
                  text="Complaint records currently visible in the dashboard."
                  href={buildComplaintsHref({})}
                />
                <MetricCard
                  label="Manual review"
                  value={manualReviewCount}
                  text="Cases flagged by the backend as requiring human review."
                  href={buildComplaintsHref({ review: "manual_review" })}
                />
                <MetricCard
                  label="Conflict cases"
                  value={conflictCount}
                  text="Text-image disagreement or citizen-AI mismatch cases."
                  href={buildComplaintsHref({ review: "conflict" })}
                />
                <MetricCard
                  label="High priority"
                  value={highPriorityCount}
                  text="Complaints marked high by the current AI priority logic."
                  href={buildComplaintsHref({ review: "high_priority" })}
                />
              </div>
            </section>

            <section className={styles.section}>
              <div className={styles.sectionHeader}>
                <div>
                  <h2 className={styles.sectionTitle}>Backend evidence overview</h2>
                  <p className={styles.sectionText}>
                    Publication-oriented monitoring of the new adaptive fusion and priority signals.
                  </p>
                </div>
              </div>

              <div className={styles.summaryGrid}>
                <div className={styles.summaryCard}>
                  <p className={styles.summaryLabel}>Adaptive fusion used</p>
                  <h3 className={styles.summaryValue}>{adaptiveFusionCount}</h3>
                  <p className={styles.summaryText}>
                    Complaints that already contain adaptive text-image weighting evidence.
                  </p>
                </div>

                <div className={styles.summaryCard}>
                  <p className={styles.summaryLabel}>Average fusion confidence</p>
                  <h3 className={styles.summaryValue}>{nicePercent(avgFusionConfidence)}</h3>
                  <p className={styles.summaryText}>
                    Mean fused confidence across complaints with saved AI results.
                  </p>
                </div>

                <div className={styles.summaryCard}>
                  <p className={styles.summaryLabel}>Area repetition signal</p>
                  <h3 className={styles.summaryValue}>{areaSignalCount}</h3>
                  <p className={styles.summaryText}>
                    Complaints where same-area repetition contributes to the priority logic.
                  </p>
                </div>
              </div>

              <div className={styles.statStrip}>
                <MetricCard
                  label="Average text weight"
                  value={nicePercent(avgTextWeight)}
                  text="Average contribution of the text branch in adaptive fusion."
                />
                <MetricCard
                  label="AI-scored complaints"
                  value={aiRows.length}
                  text="Complaints that already contain saved multimodal AI outputs."
                />
                <MetricCard
                  label="Thresholded conflicts"
                  value={thresholdConflictCount}
                  text="Complaints with stored threshold-based conflict evidence."
                />
                <MetricCard
                  label="Area signal cases"
                  value={areaSignalCount}
                  text="Complaints where area repetition contributes to priority."
                />
              </div>
            </section>

            <section className={styles.section}>
              <div className={styles.sectionHeader}>
                <div>
                  <h2 className={styles.sectionTitle}>Operations overview</h2>
                  <p className={styles.sectionText}>
                    A quick command-center view of complaint status and top complaint categories.
                  </p>
                </div>

                <div className={styles.complaintsFilterActions}>
                  <Link href="/authority/complaints" className={styles.primaryLink}>
                    Manage complaints
                  </Link>
                  <Link href="/authority/analytics" className={styles.secondaryLink}>
                    Open analytics
                  </Link>
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
                  items={topCategories}
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
                  label="Resolved"
                  value={resolvedOnlyCount}
                  text="Complaints marked resolved by authorities."
                  href={buildComplaintsHref({ status: "resolved" })}
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
                  <h2 className={styles.sectionTitle}>Priority inbox</h2>
                  <p className={styles.sectionText}>
                    Compact previews for urgent authority attention instead of full long queues.
                  </p>
                </div>
              </div>

              <div className={styles.dashboardInboxGrid}>
                <InboxPanel
                  title="Manual review"
                  subtitle="Complaints where AI suggestions should not be used without human verification."
                  emptyText="No manual-review complaints right now."
                  badgeClass={styles.chipWarn}
                  items={manualReviewComplaints.map((complaint) => {
                    const ai = inferenceByComplaint.get(complaint.id);
                    const reliability = ai?.model_versions?.reliability_status ?? null;
                    const fusionConfidence = ai?.fusion_confidence;

                    return {
                      id: complaint.id,
                      title: complaint.title || "Untitled complaint",
                      meta: `${getAreaName(complaint)} • ${formatDate(
                        complaint.created_at
                      )} • ${reliabilityLabel(reliability)} • Fusion ${nicePercent(
                        fusionConfidence
                      )}`,
                      badge: "Review",
                    };
                  })}
                />

                <InboxPanel
                  title="Conflict cases"
                  subtitle="Complaints with category mismatch or signal disagreement that need closer inspection."
                  emptyText="No conflict cases right now."
                  badgeClass={styles.priorityMedium}
                  items={conflictComplaints.map((complaint) => {
                    const ai = inferenceByComplaint.get(complaint.id);
                    const textThreshold = parseNumber(ai?.model_versions?.conflict_threshold_text);
                    const imageThreshold = parseNumber(ai?.model_versions?.conflict_threshold_image);

                    return {
                      id: complaint.id,
                      title: complaint.title || "Untitled complaint",
                      meta: `${getAreaName(complaint)} • AI: ${
                        ai?.fusion_label || "Pending"
                      } • T ${nicePercent(textThreshold)} • I ${nicePercent(imageThreshold)}`,
                      badge: "Conflict",
                    };
                  })}
                />

                <article className={styles.dashboardInboxCard}>
                  <div className={styles.dashboardInboxHeader}>
                    <div>
                      <h3 className={styles.dashboardInboxTitle}>Area hotspots</h3>
                      <p className={styles.dashboardInboxText}>
                        Most affected areas based on the latest complaint distribution.
                      </p>
                    </div>
                  </div>

                  {topAreas.length === 0 ? (
                    <div className={styles.emptyBox}>No area data available.</div>
                  ) : (
                    <div className={styles.dashboardInboxList}>
                      {topAreas.map((item) => (
                        <Link
                          key={item.label}
                          href={buildComplaintsHref({ area: item.label })}
                          className={styles.dashboardInboxItem}
                        >
                          <div className={styles.dashboardInboxItemTop}>
                            <h4 className={styles.dashboardInboxItemTitle}>{item.label}</h4>
                            <span className={styles.chip}>{item.count}</span>
                          </div>
                          <p className={styles.dashboardInboxItemMeta}>
                            {item.share.toFixed(1)}% of total complaints
                          </p>
                        </Link>
                      ))}
                    </div>
                  )}
                </article>
              </div>
            </section>

            <section className={styles.section}>
              <div className={styles.sectionHeader}>
                <div>
                  <h2 className={styles.sectionTitle}>Recent complaints</h2>
                  <p className={styles.sectionText}>
                    A shorter recent complaint preview list for daily review without crowding the dashboard.
                  </p>
                  <div className={styles.complaintsFilterActions}>
                    <Link href="/authority/complaints" className={styles.primaryLink}>
                      Manage complaints
                    </Link>
                    <Link href="/authority/analytics" className={styles.secondaryLink}>
                      Open analytics
                    </Link>
                  </div>
                </div>
              </div>

              {recentComplaints.length === 0 ? (
                <div className={styles.emptyBox}>No complaints available yet.</div>
              ) : (
                <div className={styles.dashboardQueueList}>
                  {recentComplaints.map((complaint) => {
                    const ai = inferenceByComplaint.get(complaint.id);
                    const media = mediaByComplaint.get(complaint.id);
                    const reliability = ai?.model_versions?.reliability_status ?? null;
                    const citizenAiConflict =
                      ai?.model_versions?.citizen_ai_conflict === "true";

                    const textWeight = parseNumber(ai?.model_versions?.text_weight);
                    const imageWeight = parseNumber(ai?.model_versions?.image_weight);
                    const areaSignal = parseNumber(ai?.model_versions?.area_frequency_score);

                    return (
                      <article key={complaint.id} className={styles.dashboardQueueRow}>
                        <div className={styles.dashboardQueueThumb}>
                          <AuthorityDashboardThumb
                            src={media?.public_url ?? null}
                            alt={complaint.title || "Complaint image"}
                          />
                        </div>

                        <div className={styles.dashboardQueueMain}>
                          <div className={styles.dashboardQueueTitleRow}>
                            <h3 className={styles.dashboardQueueTitle}>
                              {complaint.title || "Untitled complaint"}
                            </h3>
                            <span className={statusClass(complaint.status)}>
                              {complaint.status}
                            </span>
                          </div>

                          <p className={styles.dashboardQueueMeta}>
                            Reporter: {complaint.reporter_name || "Unknown"} • Area:{" "}
                            {getAreaName(complaint)} • Submitted: {formatDate(complaint.created_at)}
                          </p>

                          <p className={styles.dashboardQueueSubMeta}>
                            Fusion {nicePercent(ai?.fusion_confidence)} • Text{" "}
                            {nicePercent(textWeight)} • Image {nicePercent(imageWeight)} • Area signal{" "}
                            {areaSignal != null ? areaSignal.toFixed(3) : "Pending"}
                          </p>

                          <div className={styles.chipRow}>
                            <span className={styles.chip}>
                              Final: {complaint.final_category || "Not set"}
                            </span>
                            <span className={styles.chip}>
                              AI: {ai?.fusion_label || "Pending"}
                            </span>
                            <span className={priorityClass(ai?.priority)}>
                              Priority: {ai?.priority || "Pending"}
                            </span>
                            <span className={reliabilityClass(reliability)}>
                              {reliabilityLabel(reliability)}
                            </span>
                            {ai?.conflict_flag ? (
                              <span className={styles.chipWarn}>Text/Image conflict</span>
                            ) : null}
                            {citizenAiConflict ? (
                              <span className={styles.chipWarn}>Citizen/AI mismatch</span>
                            ) : null}
                          </div>
                        </div>

                        <div className={styles.dashboardQueueAction}>
                          <Link
                            href={`/authority/${complaint.id}`}
                            className={styles.primaryLink}
                          >
                            Open review
                          </Link>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        </section>
      </div>
    </main>
  );
}