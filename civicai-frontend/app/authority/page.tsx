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
  image_labels?: string[] | null;
  image_confidences?: number[] | null;
};

type RankedItem = {
  label: string;
  count: number;
  share: number;
};

type SeriesDef = {
  label: string;
  values: number[];
  stroke: string;
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

function parseBoolean(value?: string | null) {
  if (!value) return false;
  return value.toLowerCase() === "true";
}

function nicePercent(value?: number | null) {
  if (value == null) return "N/A";
  return `${(value * 100).toFixed(1)}%`;
}

function shortenText(value: string, max = 36) {
  const clean = value.trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1).trimEnd()}…`;
}

function niceLabel(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function chartLabel(value: string, max = 34) {
  return shortenText(niceLabel(value), max);
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

function reliabilityClass(value?: string | null) {
  switch (value) {
    case "reliable":
      return styles.priorityLow;
    case "manual_review_needed":
      return styles.chipWarn;
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
    case "manual_review_needed":
      return "Manual review needed";
    case "insufficient_evidence":
      return "Insufficient evidence";
    default:
      return "Review status unavailable";
  }
}

function confidenceLabel(value?: number | null) {
  if (value == null) return "Not available";
  if (value >= 0.85) return `High (${nicePercent(value)})`;
  if (value >= 0.6) return `Moderate (${nicePercent(value)})`;
  return `Low (${nicePercent(value)})`;
}

function ordinal(value?: number | null) {
  if (value == null) return "N/A";
  const v = Math.abs(value);
  const mod10 = v % 10;
  const mod100 = v % 100;
  if (mod10 === 1 && mod100 !== 11) return `${value}st`;
  if (mod10 === 2 && mod100 !== 12) return `${value}nd`;
  if (mod10 === 3 && mod100 !== 13) return `${value}rd`;
  return `${value}th`;
}

function friendlyEscalation(value?: string | null) {
  switch (value) {
    case "escalate_now":
      return "Needs escalation now";
    case "within_threshold":
      return "Within response window";
    default:
      return "Not available";
  }
}

function getAreaName(complaint: ComplaintRow) {
  return complaint.city_area || complaint.upazila || complaint.district || "Unknown";
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

function buildComplaintsHref({
  status,
  review,
  area,
  category,
  source,
}: {
  status?: string;
  review?: string;
  area?: string;
  category?: string;
  source?: string;
}) {
  const search = new URLSearchParams();
  if (status) search.set("status", status);
  if (review) search.set("review", review);
  if (area) search.set("area", area);
  if (category) search.set("category", category);
  if (source) search.set("source", source);

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
      <h3 className={styles.sectionTitle} style={{ marginBottom: 10 }}>{title}</h3>
      <p className={styles.sectionText} style={{ marginBottom: 14 }}>{subtitle}</p>

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
                  {chartLabel(item.label)}
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

function LineChart({
  title,
  subtitle,
  yAxisLabel,
  labels,
  series,
}: {
  title: string;
  subtitle: string;
  yAxisLabel: string;
  labels: string[];
  series: SeriesDef[];
}) {
  const width = 760;
  const height = 340;
  const margin = { top: 54, right: 26, bottom: 56, left: 56 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const maxValue = Math.max(1, ...series.flatMap((item) => item.values));
  const ticks = 4;

  const xFor = (index: number) => {
    if (labels.length <= 1) return margin.left + plotWidth / 2;
    return margin.left + (plotWidth * index) / (labels.length - 1);
  };

  const yFor = (value: number) =>
    margin.top + plotHeight - (value / maxValue) * plotHeight;

  const pathFor = (values: number[]) =>
    values
      .map((value, index) => {
        const x = xFor(index);
        const y = yFor(value);
        return `${index === 0 ? "M" : "L"} ${x} ${y}`;
      })
      .join(" ");

  return (
    <article className={styles.analyticsChartCard}>
      <h3 className={styles.sectionTitle} style={{ marginBottom: 10 }}>{title}</h3>
      <p className={styles.sectionText} style={{ marginBottom: 6 }}>{subtitle}</p>
      <p className={styles.kvLabel} style={{ marginBottom: 14 }}>
        Y-axis: {yAxisLabel}
      </p>

      <div className={styles.chipRow} style={{ marginBottom: 12 }}>
        {series.map((item) => (
          <span key={item.label} className={styles.chip}>
            <span
              aria-hidden="true"
              style={{
                display: "inline-block",
                width: 8,
                height: 8,
                borderRadius: 999,
                background: item.stroke,
                marginRight: 8,
                verticalAlign: "middle",
              }}
            />
            {item.label}
          </span>
        ))}
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height="100%"
        role="img"
        aria-label={title}
        className={styles.analyticsChartSvg}
      >
        {Array.from({ length: 5 }).map((_, index) => {
          const value = (maxValue / 4) * index;
          const y = yFor(value);
          return (
            <g key={index}>
              <line
                x1={margin.left}
                y1={y}
                x2={width - margin.right}
                y2={y}
                stroke="rgba(148, 163, 184, 0.18)"
                strokeWidth="1"
              />
              <text
                x={margin.left - 12}
                y={y + 4}
                textAnchor="end"
                style={{ fill: "#9fb3d9", fontSize: 11, fontWeight: 600 }}
              >
                {Math.round(value)}
              </text>
            </g>
          );
        })}

        {labels.map((label, index) => (
          <text
            key={label}
            x={xFor(index)}
            y={height - 18}
            textAnchor="middle"
            style={{ fill: "#dbe7ff", fontSize: 11, fontWeight: 700 }}
          >
            {label}
          </text>
        ))}

        {series.map((item) => (
          <g key={item.label}>
            <path
              d={pathFor(item.values)}
              fill="none"
              stroke={item.stroke}
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {item.values.map((value, index) => (
              <circle
                key={`${item.label}-${index}`}
                cx={xFor(index)}
                cy={yFor(value)}
                r="3.5"
                fill={item.stroke}
              />
            ))}
          </g>
        ))}
      </svg>
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
    fullTitle?: string;
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
              title={item.fullTitle || item.title}
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

function buildTimeBuckets(complaints: ComplaintRow[]) {
  const timestamps = complaints.map((item) => new Date(item.created_at).getTime());
  const minTs = Math.min(...timestamps);
  const maxTs = Math.max(...timestamps);
  const spanDays = Math.max(1, Math.ceil((maxTs - minTs) / (1000 * 60 * 60 * 24)));

  const useWeekly = spanDays > 18;
  const formatter = new Intl.DateTimeFormat("en-BD", {
    month: "short",
    day: "numeric",
    timeZone: "Asia/Dhaka",
  });

  const getBucket = (value: string) => {
    const date = new Date(value);
    const dayStart = new Date(date);
    dayStart.setUTCHours(0, 0, 0, 0);

    if (!useWeekly) {
      return dayStart.toISOString().slice(0, 10);
    }

    const day = dayStart.getUTCDay();
    const diff = (day + 6) % 7;
    dayStart.setUTCDate(dayStart.getUTCDate() - diff);
    return dayStart.toISOString().slice(0, 10);
  };

  const sortedKeys = Array.from(new Set(complaints.map((item) => getBucket(item.created_at)))).sort();

  const labels = sortedKeys.map((key) => {
    const date = new Date(`${key}T00:00:00Z`);
    return useWeekly ? `Week of ${formatter.format(date)}` : formatter.format(date);
  });

  return { keys: sortedKeys, labels, getBucket };
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
        model_versions,
        image_labels,
        image_confidences
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

  const submittedComplaints = complaints.filter((item) => item.status === "submitted");

  const totalComplaints = complaints.length;
  const submittedCount = complaints.filter((item) => item.status === "submitted").length;
  const processingCount = complaints.filter((item) => item.status === "processing").length;
  const resolvedOnlyCount = complaints.filter((item) => item.status === "resolved").length;
  const completedCount = complaints.filter((item) => item.status === "completed").length;
  const rejectedCount = complaints.filter((item) => item.status === "rejected").length;
  const resolvedCount = resolvedOnlyCount + completedCount;
  const openQueueCount = submittedCount + processingCount;

  const activeManualReviewCount = submittedComplaints.filter((item) => {
    const ai = inferenceByComplaint.get(item.id);
    return parseBoolean(ai?.model_versions?.manual_review_required);
  }).length;

  const conflictCount = complaints.filter((item) => {
    const ai = inferenceByComplaint.get(item.id);
    const citizenAiConflict = parseBoolean(ai?.model_versions?.citizen_ai_conflict);
    return !!ai?.conflict_flag || citizenAiConflict;
  }).length;

  const categoryCounts = new Map<string, number>();
  const areaCounts = new Map<string, number>();
  const submittedAreaCounts = new Map<string, number>();

  for (const complaint of complaints) {
    const category =
      complaint.final_category ||
      inferenceByComplaint.get(complaint.id)?.fusion_label ||
      complaint.user_category ||
      "Uncategorized";

    categoryCounts.set(category, (categoryCounts.get(category) ?? 0) + 1);

    const area = getAreaName(complaint);
    areaCounts.set(area, (areaCounts.get(area) ?? 0) + 1);
  }

  for (const complaint of submittedComplaints) {
    const area = getAreaName(complaint);
    submittedAreaCounts.set(area, (submittedAreaCounts.get(area) ?? 0) + 1);
  }

  const topCategories = countMapToSortedList(categoryCounts, totalComplaints, 4);
  const topAreas = countMapToSortedList(areaCounts, totalComplaints, 5);
  const submittedTopAreas = countMapToSortedList(
    submittedAreaCounts,
    submittedComplaints.length,
    5
  );

  const statusChartItems: RankedItem[] = [
    { label: "submitted", count: submittedCount, share: 0 },
    { label: "processing", count: processingCount, share: 0 },
    { label: "resolved / completed", count: resolvedCount, share: 0 },
    { label: "rejected", count: rejectedCount, share: 0 },
  ].filter((item) => item.count > 0);

  const { keys: bucketKeys, labels: bucketLabels, getBucket } = buildTimeBuckets(complaints);
  const bucketIndex = new Map(bucketKeys.map((key, index) => [key, index]));

  const statusSeriesMap = {
    submitted: Array(bucketKeys.length).fill(0) as number[],
    processing: Array(bucketKeys.length).fill(0) as number[],
    resolved: Array(bucketKeys.length).fill(0) as number[],
    rejected: Array(bucketKeys.length).fill(0) as number[],
  };

  const aiSeriesMap = {
    reliable: Array(bucketKeys.length).fill(0) as number[],
    manualReview: Array(bucketKeys.length).fill(0) as number[],
    conflict: Array(bucketKeys.length).fill(0) as number[],
  };

  for (const complaint of complaints) {
    const bucketKey = getBucket(complaint.created_at);
    const idx = bucketIndex.get(bucketKey);
    if (idx == null) continue;

    if (complaint.status === "submitted") statusSeriesMap.submitted[idx] += 1;
    if (complaint.status === "processing") statusSeriesMap.processing[idx] += 1;
    if (complaint.status === "resolved" || complaint.status === "completed") {
      statusSeriesMap.resolved[idx] += 1;
    }
    if (complaint.status === "rejected") statusSeriesMap.rejected[idx] += 1;

    const ai = inferenceByComplaint.get(complaint.id);
    const reliability = ai?.model_versions?.reliability_status ?? null;
    const manualReviewRequired = parseBoolean(ai?.model_versions?.manual_review_required);
    const citizenAiConflict = parseBoolean(ai?.model_versions?.citizen_ai_conflict);

    if (reliability === "reliable") aiSeriesMap.reliable[idx] += 1;
    if (manualReviewRequired || reliability === "manual_review_needed") {
      aiSeriesMap.manualReview[idx] += 1;
    }
    if (!!ai?.conflict_flag || citizenAiConflict) aiSeriesMap.conflict[idx] += 1;
  }

  const manualReviewComplaints = submittedComplaints
    .filter((complaint) => {
      const ai = inferenceByComplaint.get(complaint.id);
      return parseBoolean(ai?.model_versions?.manual_review_required);
    })
    .slice(0, 3);

  const queueComplaints = submittedComplaints
    .map((complaint) => {
      const ai = inferenceByComplaint.get(complaint.id);
      const rank = parseNumber(ai?.model_versions?.priority_rank);
      const escalation =
        ai?.model_versions?.escalation_status || ai?.model_versions?.escalation || null;

      return { complaint, ai, rank, escalation };
    })
    .filter((item) => item.rank != null)
    .sort((a, b) => (a.rank! - b.rank!))
    .slice(0, 3);

  const reviewQueueComplaints = submittedComplaints
    .map((complaint) => {
      const ai = inferenceByComplaint.get(complaint.id);
      return { complaint, ai };
    })
    .sort((a, b) => {
      const aRank = parseNumber(a.ai?.model_versions?.priority_rank) ?? Number.MAX_SAFE_INTEGER;
      const bRank = parseNumber(b.ai?.model_versions?.priority_rank) ?? Number.MAX_SAFE_INTEGER;
      return aRank - bRank;
    })
    .slice(0, 6);

  return (
    <main className={styles.page}>
      <div className={styles.wrapper}>
        <section className={styles.pageGrid}>
          <aside className={styles.sidebar}>
            <div className={styles.sidebarCard}>
              <p className={styles.sidebarEyebrow}>Authority workspace</p>
              <h2 className={styles.sidebarTitle}>Dashboard</h2>
              <p className={styles.sidebarText}>
                Review complaint submissions, inspect AI suggestions, and focus on
                the cases that still need first authority attention.
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
                <Link href="/authority/analytics/hotspots" className={styles.sidebarLink}>
                  View hotspots
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
                A cleaner authority dashboard for first-review triage, daily
                monitoring, and quick movement into detailed complaint handling.
              </p>

              <div className={styles.statStrip}>
                <MetricCard
                  label="Total complaints"
                  value={totalComplaints}
                  text="All complaints currently visible to the authority dashboard."
                  href={buildComplaintsHref({})}
                />
                <MetricCard
                  label="Open queue"
                  value={openQueueCount}
                  text="Submitted and processing complaints still waiting for closure."
                  href={buildComplaintsHref({ status: "open" })}
                />
                <MetricCard
                  label="Active manual review"
                  value={activeManualReviewCount}
                  text="Submitted complaints that still need authority verification."
                  href={buildComplaintsHref({ status: "submitted", review: "manual_review" })}
                />
                <MetricCard
                  label="Conflict cases"
                  value={conflictCount}
                  text="Cases where complaint signals do not align cleanly."
                  href={buildComplaintsHref({ review: "conflict" })}
                />
              </div>
            </section>

            <section className={styles.section}>
              <div className={styles.sectionHeader}>
                <div>
                  <h2 className={styles.sectionTitle}>Operations overview</h2>
                  <p className={styles.sectionText}>
                    Quick summaries for complaint status, complaint categories, and current authority workload.
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
                  subtitle="Current complaint counts by workflow stage."
                  items={statusChartItems}
                  fillClass={styles.analyticsChartFillTeal}
                />

                <BarChart
                  title="Top complaint categories"
                  subtitle="Final category when available, otherwise the best available complaint category."
                  items={topCategories}
                  fillClass={styles.analyticsChartFillBlue}
                />
              </div>

              <div className={styles.analyticsChartGrid} style={{ marginTop: 18 }}>
                <LineChart
                  title="Complaint activity over time"
                  subtitle="Complaints grouped by submission time bucket and shown by current status."
                  yAxisLabel="Number of complaints"
                  labels={bucketLabels}
                  series={[
                    { label: "Submitted", values: statusSeriesMap.submitted, stroke: "#FFB020" },
                    { label: "Processing", values: statusSeriesMap.processing, stroke: "#22C55E" },
                    { label: "Resolved / completed", values: statusSeriesMap.resolved, stroke: "#60A5FA" },
                    { label: "Rejected", values: statusSeriesMap.rejected, stroke: "#FF4D6D" },
                  ]}
                />

                <LineChart
                  title="AI review trend over time"
                  subtitle="Cases grouped by submission time bucket and shown by review outcome type."
                  yAxisLabel="Number of complaints"
                  labels={bucketLabels}
                  series={[
                    { label: "Reliable AI", values: aiSeriesMap.reliable, stroke: "#19D3D1" },
                    { label: "Manual review needed", values: aiSeriesMap.manualReview, stroke: "#FF7A1A" },
                    { label: "Conflict cases", values: aiSeriesMap.conflict, stroke: "#FF4D4F" },
                  ]}
                />
              </div>
            </section>

            <section className={styles.section}>
              <div className={styles.sectionHeader}>
                <div>
                  <h2 className={styles.sectionTitle}>Quick drill-downs</h2>
                  <p className={styles.sectionText}>
                    Click a card below to open the complaint management page with that filter already applied.
                  </p>
                </div>
              </div>

              <div className={styles.statStrip}>
                <MetricCard
                  label="Submitted"
                  value={submittedCount}
                  text="New complaints waiting for initial authority action."
                  href={buildComplaintsHref({ status: "submitted" })}
                />
                <MetricCard
                  label="Processing"
                  value={processingCount}
                  text="Complaints already under active authority handling."
                  href={buildComplaintsHref({ status: "processing" })}
                />
                <MetricCard
                  label="Resolved / closed"
                  value={resolvedCount}
                  text="Complaints already completed or resolved."
                  href={buildComplaintsHref({ status: "resolved_all" })}
                />
                <MetricCard
                  label="Rejected"
                  value={rejectedCount}
                  text="Complaints closed after authority rejection."
                  href={buildComplaintsHref({ status: "rejected" })}
                />
              </div>

              <div className={styles.sectionHeader} style={{ marginTop: 18 }}>
                <div>
                  <h3 className={styles.sectionTitle}>Category filters</h3>
                  <p className={styles.sectionText}>
                    Open the complaints page directly with one of the main complaint categories selected.
                  </p>
                </div>
              </div>

              <div className={styles.statStrip}>
                {topCategories.map((item) => (
                  <MetricCard
                    key={item.label}
                    label={niceLabel(item.label)}
                    value={item.count}
                    text={`${item.share.toFixed(1)}% of total complaints in this category.`}
                    href={buildComplaintsHref({ category: item.label })}
                  />
                ))}
              </div>
            </section>

            <section className={styles.section}>
              <div className={styles.sectionHeader}>
                <div>
                  <h2 className={styles.sectionTitle}>Priority inbox</h2>
                  <p className={styles.sectionText}>
                    This inbox shows only submitted complaints that still need first authority attention.
                    Reviewed, processing, resolved, completed, and rejected complaints are intentionally excluded.
                  </p>
                </div>
              </div>

              <div className={styles.dashboardInboxGrid}>
                <InboxPanel
                  title="Manual review"
                  subtitle="Submitted complaints where authority should verify the AI output before taking action."
                  emptyText="No submitted complaints are waiting for manual review right now."
                  badgeClass={styles.chipWarn}
                  items={manualReviewComplaints.map((complaint) => {
                    const ai = inferenceByComplaint.get(complaint.id);
                    const reliability = ai?.model_versions?.reliability_status ?? null;
                    const fullTitle = complaint.title || "Untitled complaint";
                    return {
                      id: complaint.id,
                      title: shortenText(fullTitle, 30),
                      fullTitle,
                      meta: `${getAreaName(complaint)} • ${formatDate(
                        complaint.created_at
                      )} • ${reliabilityLabel(reliability)}`,
                      badge: "Review",
                    };
                  })}
                />

                <InboxPanel
                  title="Queue priority"
                  subtitle="Submitted complaints currently highest in the computed first-review queue order."
                  emptyText="No submitted complaints with queue ranking are available right now."
                  badgeClass={styles.priorityMedium}
                  items={queueComplaints.map(({ complaint, ai, rank, escalation }) => {
                    const fullTitle = complaint.title || "Untitled complaint";
                    return {
                      id: complaint.id,
                      title: shortenText(fullTitle, 30),
                      fullTitle,
                      meta: `${getAreaName(complaint)} • Queue ${ordinal(rank)} • ${friendlyEscalation(
                        escalation
                      )} • ${confidenceLabel(ai?.fusion_confidence)}`,
                      badge: ordinal(rank),
                    };
                  })}
                />

                <article className={styles.dashboardInboxCard}>
                  <div className={styles.dashboardInboxHeader}>
                    <div>
                      <h3 className={styles.dashboardInboxTitle}>Submitted area hotspots</h3>
                      <p className={styles.dashboardInboxText}>
                        Areas with the highest concentration of submitted complaints still waiting for first review.
                      </p>
                    </div>
                  </div>

                  {submittedTopAreas.length === 0 ? (
                    <div className={styles.emptyBox}>No submitted area data available.</div>
                  ) : (
                    <div className={styles.dashboardInboxList}>
                      {submittedTopAreas.map((item) => (
                        <Link
                          key={item.label}
                          href={buildComplaintsHref({ status: "submitted", area: item.label })}
                          className={styles.dashboardInboxItem}
                        >
                          <div className={styles.dashboardInboxItemTop}>
                            <h4 className={styles.dashboardInboxItemTitle}>{item.label}</h4>
                            <span className={styles.chip}>{item.count}</span>
                          </div>
                          <p className={styles.dashboardInboxItemMeta}>
                            {item.share.toFixed(1)}% of submitted complaints
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
                  <h2 className={styles.sectionTitle}>Quick complaint review list</h2>
                  <p className={styles.sectionText}>
                    A short list of submitted complaints with only the key facts needed before opening the full review page.
                  </p>
                </div>

                <div className={styles.complaintsFilterActions}>
                  <Link href="/authority/complaints" className={styles.primaryLink}>
                    Manage complaints
                  </Link>
                  <Link href={buildComplaintsHref({ status: "submitted" })} className={styles.secondaryLink}>
                    View submitted only
                  </Link>
                </div>
              </div>

              {reviewQueueComplaints.length === 0 ? (
                <div className={styles.emptyBox}>
                  No submitted complaints are waiting for first authority review.
                </div>
              ) : (
                <div className={styles.dashboardQueueList}>
                  {reviewQueueComplaints.map(({ complaint, ai }) => {
                    const media = mediaByComplaint.get(complaint.id);
                    const reliability = ai?.model_versions?.reliability_status ?? null;
                    const manualReviewRequired = parseBoolean(
                      ai?.model_versions?.manual_review_required
                    );
                    const priorityRank = parseNumber(ai?.model_versions?.priority_rank);
                    const urgencyScore = parseNumber(ai?.model_versions?.urgency_score);
                    const urgencyPercent =
                      urgencyScore != null ? Math.round(urgencyScore * 100) : null;

                    const finalCategory =
                      complaint.final_category ||
                      ai?.fusion_label ||
                      complaint.user_category ||
                      "Not available";

                    const fullTitle = complaint.title || "Untitled complaint";

                    const reviewChipLabel =
                      manualReviewRequired || reliability === "manual_review_needed"
                        ? "Manual review needed"
                        : reliability === "reliable"
                          ? "Reliable"
                          : reliabilityLabel(reliability);

                    const reviewChipClass =
                      manualReviewRequired || reliability === "manual_review_needed"
                        ? styles.chipWarn
                        : reliabilityClass(reliability);

                    return (
                      <article key={complaint.id} className={styles.dashboardQueueRow}>
                        <div className={styles.dashboardQueueThumb}>
                          <AuthorityDashboardThumb
                            src={media?.public_url ?? null}
                            alt={fullTitle}
                          />
                        </div>

                        <div className={styles.dashboardQueueMain}>
                          <div className={styles.dashboardQueueTitleRow}>
                            <h3
                              className={styles.dashboardQueueTitle}
                              title={fullTitle}
                            >
                              {shortenText(fullTitle, 48)}
                            </h3>
                            <span className={statusClass(complaint.status)}>
                              {complaint.status}
                            </span>
                          </div>

                          <p className={styles.dashboardQueueMeta}>
                            Submitted {formatDate(complaint.created_at)} • Area: {getAreaName(complaint)} • Reporter:{" "}
                            {complaint.reporter_name || "Unknown"}
                          </p>

                          <div className={styles.chipRow}>
                            <span className={styles.chip}>Final: {finalCategory}</span>
                            <span className={reviewChipClass}>{reviewChipLabel}</span>
                            <span className={styles.chip}>
                              {priorityRank != null ? `Queue ${ordinal(priorityRank)}` : "Queue N/A"}
                            </span>
                            <span className={styles.chip}>
                              {urgencyPercent != null ? `Urgency ${urgencyPercent}%` : "Urgency N/A"}
                            </span>
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

            <section className={styles.section}>
              <div className={styles.sectionHeader}>
                <div>
                  <h2 className={styles.sectionTitle}>Area overview</h2>
                  <p className={styles.sectionText}>
                    Overall hotspot areas across the full complaint dataset, including already reviewed complaints.
                  </p>
                </div>
              </div>

              <div className={styles.statStrip}>
                {topAreas.map((item) => (
                  <MetricCard
                    key={item.label}
                    label={item.label}
                    value={item.count}
                    text={`${item.share.toFixed(1)}% of total complaints in this area.`}
                    href={buildComplaintsHref({ area: item.label })}
                  />
                ))}
              </div>
            </section>
          </div>
        </section>
      </div>
    </main>
  );
}
