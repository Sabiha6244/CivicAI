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

function niceLabel(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (m) => m.toUpperCase());
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
      return "Not available";
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

function shortenText(text?: string | null, max = 120) {
  if (!text) return "";
  const clean = text.trim().replace(/\s+/g, " ");
  if (clean.length <= max) return clean;

  const sliced = clean.slice(0, max);
  const lastSpace = sliced.lastIndexOf(" ");
  const shortened = lastSpace > 0 ? sliced.slice(0, lastSpace) : sliced;

  return `${shortened}...`;
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

  const totalComplaints = complaints.length;
  const submittedCount = complaints.filter((item) => item.status === "submitted").length;
  const processingCount = complaints.filter((item) => item.status === "processing").length;
  const resolvedOnlyCount = complaints.filter((item) => item.status === "resolved").length;
  const completedCount = complaints.filter((item) => item.status === "completed").length;
  const rejectedCount = complaints.filter((item) => item.status === "rejected").length;
  const resolvedCount = resolvedOnlyCount + completedCount;

  const manualReviewCount = complaints.filter((item) => {
    const ai = inferenceByComplaint.get(item.id);
    return ai?.model_versions?.manual_review_required === "true";
  }).length;

  const reliableCount = complaints.filter((item) => {
    const ai = inferenceByComplaint.get(item.id);
    return ai?.model_versions?.reliability_status === "reliable";
  }).length;

  const conflictCount = complaints.filter((item) => {
    const ai = inferenceByComplaint.get(item.id);
    const citizenAiConflict = ai?.model_versions?.citizen_ai_conflict === "true";
    return !!ai?.conflict_flag || citizenAiConflict;
  }).length;

  const priorityComputedCount = complaints.filter((item) => {
    const ai = inferenceByComplaint.get(item.id);
    return ai?.model_versions?.priority_status === "computed";
  }).length;

  const categoryCounts = new Map<string, number>();
  const areaCounts = new Map<string, number>();

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

  const queueComplaints = complaints
    .map((complaint) => {
      const ai = inferenceByComplaint.get(complaint.id);
      const rank = parseNumber(ai?.model_versions?.priority_rank);
      const escalation =
        ai?.model_versions?.escalation_status || ai?.model_versions?.escalation || null;

      return {
        complaint,
        ai,
        rank,
        escalation,
      };
    })
    .filter((item) => item.rank != null)
    .sort((a, b) => (a.rank! - b.rank!))
    .slice(0, 3);

  const recentComplaints = complaints.slice(0, 6);

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
                the cases that need authority attention first.
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
                A cleaner dashboard for daily monitoring, manual review, and quick
                movement into complaint detail pages.
              </p>

              <div className={styles.statStrip}>
                <MetricCard
                  label="Total complaints"
                  value={totalComplaints}
                  text="Complaint records currently visible in the dashboard."
                  href={buildComplaintsHref({})}
                />
                <MetricCard
                  label="Submitted"
                  value={submittedCount}
                  text="New complaints waiting in the authority queue."
                  href={buildComplaintsHref({ status: "submitted" })}
                />
                <MetricCard
                  label="Reliable AI"
                  value={reliableCount}
                  text="Cases where AI can be used as a strong starting point."
                  href={buildComplaintsHref({ review: "reliable" })}
                />
                <MetricCard
                  label="Manual review"
                  value={manualReviewCount}
                  text="Cases that should be checked carefully before action."
                  href={buildComplaintsHref({ review: "manual_review" })}
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
                  label="Resolved"
                  value={resolvedCount}
                  text="Complaints already closed by authority action."
                  href={buildComplaintsHref({ status: "resolved" })}
                />
                <MetricCard
                  label="Conflict cases"
                  value={conflictCount}
                  text="Complaints where AI and complaint signals do not align cleanly."
                  href={buildComplaintsHref({ review: "conflict" })}
                />
                <MetricCard
                  label="Priority scored"
                  value={priorityComputedCount}
                  text="Complaints with computed queue position."
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
                    Compact previews for cases that need faster authority attention.
                  </p>
                </div>
              </div>

              <div className={styles.dashboardInboxGrid}>
                <InboxPanel
                  title="Manual review"
                  subtitle="Complaints where authority should verify the AI suggestion before acting."
                  emptyText="No manual-review complaints right now."
                  badgeClass={styles.chipWarn}
                  items={manualReviewComplaints.map((complaint) => {
                    const ai = inferenceByComplaint.get(complaint.id);
                    const reliability = ai?.model_versions?.reliability_status ?? null;
                    return {
                      id: complaint.id,
                      title: complaint.title || "Untitled complaint",
                      meta: `${getAreaName(complaint)} • ${formatDate(
                        complaint.created_at
                      )} • ${reliabilityLabel(reliability)}`,
                      badge: "Review",
                    };
                  })}
                />

                <InboxPanel
                  title="Queue priority"
                  subtitle="Complaints currently highest in the computed queue order."
                  emptyText="No ranked complaints available right now."
                  badgeClass={styles.priorityMedium}
                  items={queueComplaints.map(({ complaint, ai, rank, escalation }) => ({
                    id: complaint.id,
                    title: complaint.title || "Untitled complaint",
                    meta: `${getAreaName(complaint)} • Queue ${ordinal(rank)} • ${friendlyEscalation(
                      escalation
                    )} • ${confidenceLabel(ai?.fusion_confidence)}`,
                    badge: ordinal(rank),
                  }))}
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
                    Recent complaint previews with only the values authorities actually need.
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
                    const priorityRank = parseNumber(ai?.model_versions?.priority_rank);
                    const escalation =
                      ai?.model_versions?.escalation_status || ai?.model_versions?.escalation || null;

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
                            AI confidence {confidenceLabel(ai?.fusion_confidence)} •{" "}
                            {priorityRank != null ? `Queue ${ordinal(priorityRank)}` : "Queue not computed"} •{" "}
                            {friendlyEscalation(escalation)}
                          </p>

                          {ai?.summary ? (
                            <p className={styles.dashboardQueueSubMeta}>
                              {shortenText(ai.summary, 150)}
                            </p>
                          ) : null}

                          <div className={styles.chipRow}>
                            <span className={styles.chip}>
                              AI: {ai?.fusion_label || "Not available"}
                            </span>
                            <span className={reliabilityClass(reliability)}>
                              {reliabilityLabel(reliability)}
                            </span>
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