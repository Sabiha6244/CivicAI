import { redirect } from "next/navigation";
import Link from "next/link";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import styles from "../authority.module.css";
import AuthorityDashboardThumb from "../AuthorityDashboardThumb";

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
  duplicate_of: string | null;
  cluster_id: string | null;
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
  conflict_flag: boolean | null;
  summary: string | null;
  model_versions: Record<string, string> | null;
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

function getAreaName(complaint: ComplaintRow) {
  return complaint.city_area || complaint.upazila || complaint.district || "Unknown";
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

function parseNumber(value?: string | null) {
  if (!value) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function parseBoolean(value?: string | null) {
  if (!value) return false;
  return value.toLowerCase() === "true";
}

function parseStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map(String)
      .map((v) => v.trim())
      .filter(Boolean)
      .filter((v) => v !== "[]" && v.toLowerCase() !== "null");
  }

  if (typeof value === "string") {
    const raw = value.trim();

    if (!raw || raw === "[]" || raw.toLowerCase() === "null") {
      return [];
    }

    if (raw.startsWith("[") && raw.endsWith("]")) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          return parsed
            .map(String)
            .map((v) => v.trim())
            .filter(Boolean)
            .filter((v) => v !== "[]" && v.toLowerCase() !== "null");
        }
      } catch { }
    }

    return raw
      .split(",")
      .map((v) =>
        v
          .trim()
          .replace(/^\[/, "")
          .replace(/\]$/, "")
          .replace(/^"+|"+$/g, "")
          .replace(/^'+|'+$/g, "")
      )
      .filter(Boolean)
      .filter((v) => v !== "[]" && v.toLowerCase() !== "null");
  }

  return [];
}

function getSavedDuplicateIds(ai?: InferenceRow | null): string[] {
  return parseStringList(ai?.model_versions?.duplicate_ids);
}

function normalizeIdList(ids: string[]): string[] {
  return Array.from(new Set(ids.map((v) => v.trim()).filter(Boolean)));
}

function getReciprocalDuplicateIds(
  complaintId: string,
  duplicateMap: Map<string, string[]>
): string[] {
  const ownIds = duplicateMap.get(complaintId) ?? [];

  return ownIds.filter((otherId) => {
    const otherIds = duplicateMap.get(otherId) ?? [];
    return otherIds.includes(complaintId);
  });
}

function getEffectiveClusterId(
  complaint: ComplaintRow,
  ai?: InferenceRow | null
): string | null {
  const fromComplaint =
    typeof complaint.cluster_id === "string" && complaint.cluster_id.trim()
      ? complaint.cluster_id.trim()
      : null;

  if (fromComplaint) return fromComplaint;

  const fromModelVersions =
    typeof ai?.model_versions?.cluster_id === "string" &&
      ai.model_versions.cluster_id.trim()
      ? ai.model_versions.cluster_id.trim()
      : null;

  return fromModelVersions;
}

function nicePercent(value?: number | null) {
  if (value == null) return "N/A";
  return `${(value * 100).toFixed(1)}%`;
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

function matchesStatusFilter(filterValue: string, statusValue: string) {
  if (filterValue === "all") return true;
  if (filterValue === "open") {
    return statusValue === "submitted" || statusValue === "processing";
  }
  if (filterValue === "resolved_all") {
    return (
      statusValue === "resolved" ||
      statusValue === "completed" ||
      statusValue === "rejected"
    );
  }
  return statusValue === filterValue;
}

function statusFilterLabel(filterValue: string) {
  switch (filterValue) {
    case "open":
      return "Open cases";
    case "resolved_all":
      return "Resolved / closed";
    case "submitted":
      return "Submitted";
    case "processing":
      return "Processing";
    case "resolved":
      return "Resolved";
    case "completed":
      return "Completed";
    case "rejected":
      return "Rejected";
    default:
      return filterValue;
  }
}

function reviewFilterLabel(filterValue: string) {
  switch (filterValue) {
    case "manual_review":
      return "Manual review";
    case "conflict":
      return "Conflict cases";
    case "high_priority":
      return "Top queue / urgent";
    case "reliable":
      return "Reliable AI result";
    default:
      return filterValue;
  }
}

export default async function AuthorityComplaintsPage({
  searchParams,
}: {
  searchParams?: Promise<{
    q?: string;
    status?: string;
    review?: string;
    category?: string;
    area?: string;
    source?: string;
    page?: string;
    duplicate?: string;
    duplicateOf?: string;
    cluster?: string;
    clusterId?: string;
    pattern?: string;
  }>;
}) {
  const params = (await searchParams) ?? {};
  const queryText = (params.q ?? "").trim();
  const selectedStatus = (params.status ?? "all").trim();
  const selectedReview = (params.review ?? "all").trim();
  const selectedCategory = (params.category ?? "").trim();
  const selectedArea = (params.area ?? "").trim();
  const sourceContext = (params.source ?? "").trim();
  const selectedDuplicate = (params.duplicate ?? "").trim();
  const selectedDuplicateOf = (params.duplicateOf ?? "").trim();
  const selectedCluster = (params.cluster ?? "").trim();
  const selectedClusterId = (params.clusterId ?? "").trim();
  const selectedPattern = (params.pattern ?? "").trim();
  const currentPage = Math.max(Number(params.page ?? "1") || 1, 1);
  const pageSize = 12;

  const formResetKey = JSON.stringify({
    q: queryText,
    status: selectedStatus,
    review: selectedReview,
    category: selectedCategory,
    area: selectedArea,
    source: sourceContext,
    page: currentPage,
    duplicate: selectedDuplicate,
    duplicateOf: selectedDuplicateOf,
    cluster: selectedCluster,
    clusterId: selectedClusterId,
    pattern: selectedPattern,
  });

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
    redirect("/login?next=/authority/complaints");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, is_verified")
    .eq("id", user.id)
    .single();

  if (!profile?.is_verified) {
    redirect("/login?next=/authority/complaints&verify=1");
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
      duplicate_of,
      cluster_id
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

  const savedDuplicateMap = new Map<string, string[]>();

  for (const complaint of complaints) {
    const ai = inferenceByComplaint.get(complaint.id);
    const duplicateIds = normalizeIdList(getSavedDuplicateIds(ai));
    savedDuplicateMap.set(complaint.id, duplicateIds);
  }

  const clusterCounts = new Map<string, number>();
  const repeatedPatternCounts = new Map<string, number>();

  for (const complaint of complaints) {
    const ai = inferenceByComplaint.get(complaint.id);
    const effectiveClusterId = getEffectiveClusterId(complaint, ai);

    if (effectiveClusterId) {
      clusterCounts.set(
        effectiveClusterId,
        (clusterCounts.get(effectiveClusterId) ?? 0) + 1
      );
    }

    const derivedCategory =
      complaint.final_category ||
      ai?.fusion_label ||
      complaint.user_category ||
      "Uncategorized";

    const derivedArea = getAreaName(complaint);
    const pairKey = `${derivedArea}__${derivedCategory}`;

    repeatedPatternCounts.set(
      pairKey,
      (repeatedPatternCounts.get(pairKey) ?? 0) + 1
    );
  }

  const filteredComplaints = complaints.filter((complaint) => {
    const ai = inferenceByComplaint.get(complaint.id);
    const reliability = ai?.model_versions?.reliability_status ?? null;
    const citizenAiConflict = parseBoolean(ai?.model_versions?.citizen_ai_conflict);
    const manualReviewRequired = parseBoolean(
      ai?.model_versions?.manual_review_required
    );
    const priorityRank = parseNumber(ai?.model_versions?.priority_rank);
    const escalationStatus =
      ai?.model_versions?.escalation_status ||
      ai?.model_versions?.escalation ||
      null;

    const derivedCategory =
      complaint.final_category ||
      ai?.fusion_label ||
      complaint.user_category ||
      "Uncategorized";

    const derivedArea = getAreaName(complaint);
    const searchLower = queryText.toLowerCase();
    const categoryLower = selectedCategory.toLowerCase();
    const areaLower = selectedArea.toLowerCase();
    const pairKey = `${derivedArea}__${derivedCategory}`;

    const savedDuplicateIds = getReciprocalDuplicateIds(
      complaint.id,
      savedDuplicateMap
    );
    const effectiveClusterId = getEffectiveClusterId(complaint, ai);
    const isRepeatedPattern = (repeatedPatternCounts.get(pairKey) ?? 0) > 1;

    const matchesSearch =
      !queryText ||
      (complaint.title ?? "").toLowerCase().includes(searchLower) ||
      complaint.description.toLowerCase().includes(searchLower) ||
      (complaint.reporter_name ?? "").toLowerCase().includes(searchLower) ||
      derivedCategory.toLowerCase().includes(searchLower) ||
      derivedArea.toLowerCase().includes(searchLower);

    const matchesStatus = matchesStatusFilter(selectedStatus, complaint.status);

    const matchesReview =
      selectedReview === "all" ||
      (selectedReview === "manual_review" && manualReviewRequired) ||
      (selectedReview === "conflict" &&
        (!!ai?.conflict_flag || citizenAiConflict)) ||
      (selectedReview === "high_priority" &&
        (priorityRank != null
          ? priorityRank <= 5
          : escalationStatus === "escalate_now")) ||
      (selectedReview === "reliable" && reliability === "reliable");

    const matchesCategory =
      !selectedCategory || derivedCategory.toLowerCase().includes(categoryLower);

    const matchesArea =
      !selectedArea || derivedArea.toLowerCase().includes(areaLower);

    const matchesDuplicate =
      !selectedDuplicate ||
      (selectedDuplicate === "linked" && savedDuplicateIds.length > 0);

    const matchesDuplicateOf =
      !selectedDuplicateOf ||
      savedDuplicateIds.includes(selectedDuplicateOf);

    const matchesCluster =
      !selectedCluster ||
      (selectedCluster === "repeated" &&
        ((effectiveClusterId &&
          (clusterCounts.get(effectiveClusterId) ?? 0) > 1) ||
          isRepeatedPattern));

    const matchesClusterId =
      !selectedClusterId || effectiveClusterId === selectedClusterId;

    const matchesPattern =
      !selectedPattern ||
      (selectedPattern === "repeated" && isRepeatedPattern);

    return (
      matchesSearch &&
      matchesStatus &&
      matchesReview &&
      matchesCategory &&
      matchesArea &&
      matchesDuplicate &&
      matchesDuplicateOf &&
      matchesCluster &&
      matchesClusterId &&
      matchesPattern
    );
  });

  const totalFiltered = filteredComplaints.length;
  const totalPages = Math.max(Math.ceil(totalFiltered / pageSize), 1);
  const safePage = Math.min(currentPage, totalPages);
  const startIndex = (safePage - 1) * pageSize;
  const paginatedComplaints = filteredComplaints.slice(
    startIndex,
    startIndex + pageSize
  );

  const submittedCount = filteredComplaints.filter(
    (item) => item.status === "submitted"
  ).length;

  const processingCount = filteredComplaints.filter(
    (item) => item.status === "processing"
  ).length;

  const resolvedCount = filteredComplaints.filter(
    (item) => item.status === "resolved" || item.status === "completed"
  ).length;

  const rejectedCount = filteredComplaints.filter(
    (item) => item.status === "rejected"
  ).length;

  const duplicateLinkedCount = filteredComplaints.filter((item) => {
    return getReciprocalDuplicateIds(item.id, savedDuplicateMap).length > 0;
  }).length;

  const repeatedClusterCount = filteredComplaints.filter((item) => {
    const ai = inferenceByComplaint.get(item.id);
    const effectiveClusterId = getEffectiveClusterId(item, ai);

    const derivedCategory =
      item.final_category ||
      ai?.fusion_label ||
      item.user_category ||
      "Uncategorized";

    const derivedArea = getAreaName(item);
    const pairKey = `${derivedArea}__${derivedCategory}`;

    return (
      (effectiveClusterId &&
        (clusterCounts.get(effectiveClusterId) ?? 0) > 1) ||
      (repeatedPatternCounts.get(pairKey) ?? 0) > 1
    );
  }).length;

  const prevPage = safePage > 1 ? safePage - 1 : null;
  const nextPage = safePage < totalPages ? safePage + 1 : null;

  const hasActiveFilters =
    Boolean(queryText) ||
    selectedStatus !== "all" ||
    selectedReview !== "all" ||
    Boolean(selectedCategory) ||
    Boolean(selectedArea) ||
    Boolean(selectedDuplicate) ||
    Boolean(selectedDuplicateOf) ||
    Boolean(selectedCluster) ||
    Boolean(selectedClusterId) ||
    Boolean(selectedPattern);

  function buildPageHref(page: number) {
    const search = new URLSearchParams();
    if (queryText) search.set("q", queryText);
    if (selectedStatus !== "all") search.set("status", selectedStatus);
    if (selectedReview !== "all") search.set("review", selectedReview);
    if (selectedCategory) search.set("category", selectedCategory);
    if (selectedArea) search.set("area", selectedArea);
    if (sourceContext) search.set("source", sourceContext);
    if (selectedDuplicate) search.set("duplicate", selectedDuplicate);
    if (selectedDuplicateOf) search.set("duplicateOf", selectedDuplicateOf);
    if (selectedCluster) search.set("cluster", selectedCluster);
    if (selectedClusterId) search.set("clusterId", selectedClusterId);
    if (selectedPattern) search.set("pattern", selectedPattern);
    search.set("page", String(page));
    return `/authority/complaints?${search.toString()}`;
  }

  const heroSubtitle =
    sourceContext === "analytics"
      ? "A filtered operational queue opened from analytics, so authorities can move directly from pattern discovery into complaint review."
      : "A structured complaint management page for reviewing new, unresolved, duplicate-linked, clustered, and flagged complaints without overloading the dashboard.";

  return (
    <main className={styles.page}>
      <div className={styles.wrapper}>
        <section className={styles.pageGrid}>
          <aside className={styles.sidebar}>
            <div className={styles.sidebarCard}>
              <p className={styles.sidebarEyebrow}>Authority workspace</p>
              <h2 className={styles.sidebarTitle}>All complaints</h2>
              <p className={styles.sidebarText}>
                Search, filter, and manage complaint records from one operational work queue.
              </p>

              <nav className={styles.sidebarNav}>
                <Link href="/" className={styles.sidebarLink}>
                  Back to homepage
                </Link>
                <Link href="/authority" className={styles.sidebarLink}>
                  Authority dashboard
                </Link>
                <Link href="/authority/complaints" className={styles.sidebarLinkActive}>
                  All complaints
                </Link>
                <Link href="/authority/analytics/hotspots" className={styles.sidebarLink}>
                  View Hotspots
                </Link>
                <Link href="/authority/analytics" className={styles.sidebarLink}>
                  Open analytics
                </Link>
              </nav>
            </div>
          </aside>

          <div className={styles.mainContent}>
            <section className={styles.hero}>
              <p className={styles.eyebrow}>Authority complaint management</p>
              <h1 className={styles.title}>All complaints work queue</h1>
              <p className={styles.subtitle}>{heroSubtitle}</p>

              <div className={styles.statStrip}>
                <div className={styles.statMiniCard}>
                  <p className={styles.statMiniLabel}>Filtered results</p>
                  <h3 className={styles.statMiniValue}>{totalFiltered}</h3>
                  <p className={styles.statMiniText}>Complaints matching the current filters.</p>
                </div>

                <div className={styles.statMiniCard}>
                  <p className={styles.statMiniLabel}>Submitted</p>
                  <h3 className={styles.statMiniValue}>{submittedCount}</h3>
                  <p className={styles.statMiniText}>New complaints still waiting in queue.</p>
                </div>

                <div className={styles.statMiniCard}>
                  <p className={styles.statMiniLabel}>Processing</p>
                  <h3 className={styles.statMiniValue}>{processingCount}</h3>
                  <p className={styles.statMiniText}>Complaints currently under review.</p>
                </div>

                <div className={styles.statMiniCard}>
                  <p className={styles.statMiniLabel}>Resolved / closed</p>
                  <h3 className={styles.statMiniValue}>{resolvedCount + rejectedCount}</h3>
                  <p className={styles.statMiniText}>Handled complaints in this filtered view.</p>
                </div>

                <div className={styles.statMiniCard}>
                  <p className={styles.statMiniLabel}>Duplicate linked</p>
                  <h3 className={styles.statMiniValue}>{duplicateLinkedCount}</h3>
                  <p className={styles.statMiniText}>Complaints already linked to another complaint.</p>
                </div>

                <div className={styles.statMiniCard}>
                  <p className={styles.statMiniLabel}>Repeated clusters</p>
                  <h3 className={styles.statMiniValue}>{repeatedClusterCount}</h3>
                  <p className={styles.statMiniText}>Complaints grouped into repeated cluster cases.</p>
                </div>
              </div>
            </section>

            <section className={styles.section}>
              <div className={styles.sectionHeader}>
                <div>
                  <h2 className={styles.sectionTitle}>Filter complaints</h2>
                  <p className={styles.sectionText}>
                    Use search, category, area, review, duplicate, and cluster filters to find unreviewed, urgent, or analytics-selected complaints.
                  </p>
                </div>
              </div>

              {hasActiveFilters ? (
                <div className={styles.activeFilterSummary}>
                  <div className={styles.activeFilterHeader}>
                    <div>
                      <h3 className={styles.activeFilterTitle}>Active filter summary</h3>
                      <p className={styles.activeFilterText}>
                        {sourceContext === "analytics"
                          ? "These filters were opened from analytics and can be refined further below."
                          : "These filters are currently shaping the complaint queue."}
                      </p>
                    </div>

                    <Link href="/authority/complaints" className={styles.secondaryLink}>
                      Clear all filters
                    </Link>
                  </div>

                  <div className={styles.activeFilterChips}>
                    {queryText ? <span className={styles.chip}>Search: {queryText}</span> : null}
                    {selectedCategory ? (
                      <span className={styles.chip}>Category: {selectedCategory}</span>
                    ) : null}
                    {selectedArea ? <span className={styles.chip}>Area: {selectedArea}</span> : null}
                    {selectedStatus !== "all" ? (
                      <span className={styles.chip}>
                        Status: {statusFilterLabel(selectedStatus)}
                      </span>
                    ) : null}
                    {selectedReview !== "all" ? (
                      <span className={styles.chip}>
                        Review: {reviewFilterLabel(selectedReview)}
                      </span>
                    ) : null}
                    {selectedDuplicate === "linked" ? (
                      <span className={styles.chip}>Duplicate linked</span>
                    ) : null}
                    {selectedDuplicateOf ? (
                      <span className={styles.chip}>Duplicate source: {selectedDuplicateOf}</span>
                    ) : null}
                    {selectedCluster === "repeated" ? (
                      <span className={styles.chip}>Repeated clusters</span>
                    ) : null}
                    {selectedClusterId ? (
                      <span className={styles.chip}>Cluster: {selectedClusterId}</span>
                    ) : null}
                    {selectedPattern === "repeated" ? (
                      <span className={styles.chip}>Repeated issue patterns</span>
                    ) : null}
                  </div>
                </div>
              ) : null}

              <form
                key={formResetKey}
                method="get"
                className={styles.complaintsFilterForm}
              >
                <div className={styles.complaintsFilterGrid}>
                  <div className={styles.complaintsFilterSearchCell}>
                    <label className={styles.label}>Search</label>
                    <input
                      type="text"
                      name="q"
                      defaultValue={queryText}
                      placeholder="Search by title, reporter, description, area, or category"
                      className={styles.input}
                    />
                  </div>

                  <div>
                    <label className={styles.label}>Category</label>
                    <input
                      type="text"
                      name="category"
                      defaultValue={selectedCategory}
                      placeholder="Streetlights, Garbage, Roads..."
                      className={styles.input}
                    />
                  </div>

                  <div>
                    <label className={styles.label}>Area</label>
                    <input
                      type="text"
                      name="area"
                      defaultValue={selectedArea}
                      placeholder="Mirpur, Dhanmondi, Gulshan..."
                      className={styles.input}
                    />
                  </div>

                  <div>
                    <label className={styles.label}>Status</label>
                    <select
                      name="status"
                      defaultValue={selectedStatus}
                      className={styles.input}
                    >
                      <option value="all">All statuses</option>
                      <option value="open">Open cases</option>
                      <option value="submitted">Submitted</option>
                      <option value="processing">Processing</option>
                      <option value="resolved_all">Resolved / closed</option>
                      <option value="resolved">Resolved</option>
                      <option value="completed">Completed</option>
                      <option value="rejected">Rejected</option>
                    </select>
                  </div>

                  <div>
                    <label className={styles.label}>Review type</label>
                    <select
                      name="review"
                      defaultValue={selectedReview}
                      className={styles.input}
                    >
                      <option value="all">All complaints</option>
                      <option value="manual_review">Manual review</option>
                      <option value="conflict">Conflict cases</option>
                      <option value="high_priority">Top queue / urgent</option>
                      <option value="reliable">Reliable AI result</option>
                    </select>
                  </div>
                </div>

                {sourceContext ? (
                  <input type="hidden" name="source" value={sourceContext} />
                ) : null}
                {selectedDuplicate ? (
                  <input type="hidden" name="duplicate" value={selectedDuplicate} />
                ) : null}
                {selectedDuplicateOf ? (
                  <input type="hidden" name="duplicateOf" value={selectedDuplicateOf} />
                ) : null}
                {selectedCluster ? (
                  <input type="hidden" name="cluster" value={selectedCluster} />
                ) : null}
                {selectedClusterId ? (
                  <input type="hidden" name="clusterId" value={selectedClusterId} />
                ) : null}
                {selectedPattern ? (
                  <input type="hidden" name="pattern" value={selectedPattern} />
                ) : null}

                <div className={styles.complaintsFilterActions}>
                  <button type="submit" className={styles.primaryButton}>
                    Apply filters
                  </button>
                  <Link href="/authority/complaints" className={styles.secondaryLink}>
                    Clear filters
                  </Link>
                </div>
              </form>
            </section>

            <section className={styles.section}>
              <div className={styles.sectionHeader}>
                <div>
                  <h2 className={styles.sectionTitle}>Complaint list</h2>
                  <p className={styles.sectionText}>
                    Compact operational list with only the key facts authorities need before opening the full review page.
                  </p>
                </div>
              </div>

              {paginatedComplaints.length === 0 ? (
                <div className={styles.emptyBox}>No complaints match the current filters.</div>
              ) : (
                <div className={styles.complaintsManagementList}>
                  {paginatedComplaints.map((complaint) => {
                    const ai = inferenceByComplaint.get(complaint.id);
                    const media = mediaByComplaint.get(complaint.id);
                    const reliability = ai?.model_versions?.reliability_status ?? null;
                    const manualReviewRequired = parseBoolean(
                      ai?.model_versions?.manual_review_required
                    );
                    const priorityRank = parseNumber(ai?.model_versions?.priority_rank);
                    const urgencyScore = parseNumber(ai?.model_versions?.urgency_score);

                    const finalCategory =
                      complaint.final_category ||
                      ai?.fusion_label ||
                      complaint.user_category ||
                      "Uncategorized";

                    const savedDuplicateIds = getReciprocalDuplicateIds(
                      complaint.id,
                      savedDuplicateMap
                    );
                    const effectiveClusterId = getEffectiveClusterId(complaint, ai);
                    const pairKey = `${getAreaName(complaint)}__${finalCategory}`;

                    const isRepeatedCluster =
                      (effectiveClusterId &&
                        (clusterCounts.get(effectiveClusterId) ?? 0) > 1) ||
                      (repeatedPatternCounts.get(pairKey) ?? 0) > 1;

                    return (
                      <article key={complaint.id} className={styles.complaintsManagementRow}>
                        <div className={styles.complaintsManagementThumb}>
                          <AuthorityDashboardThumb
                            src={media?.public_url ?? null}
                            alt={complaint.title || "Complaint image"}
                          />
                        </div>

                        <div className={styles.complaintsManagementMain}>
                          <div className={styles.complaintsManagementTitleRow}>
                            <h3 className={styles.complaintsManagementTitle}>
                              {complaint.title || "Untitled complaint"}
                            </h3>
                            <span className={statusClass(complaint.status)}>
                              {complaint.status}
                            </span>
                          </div>

                          <p className={styles.complaintsManagementMeta}>
                            Submitted {formatDate(complaint.created_at)} • Area: {getAreaName(complaint)} • Reporter: {complaint.reporter_name || "Unknown"}
                          </p>

                          <div className={styles.chipRow}>
                            <span className={styles.chip}>Final: {finalCategory}</span>
                            <span className={reliabilityClass(reliability)}>
                              {manualReviewRequired
                                ? "Manual review needed"
                                : reliabilityLabel(reliability)}
                            </span>
                            <span className={styles.chip}>
                              Queue {priorityRank != null ? ordinal(priorityRank) : "N/A"}
                            </span>
                            <span className={styles.chip}>
                              Urgency {urgencyScore != null ? nicePercent(urgencyScore) : "N/A"}
                            </span>
                            {savedDuplicateIds.length > 0 ? (
                              <span className={styles.chipWarn}>Duplicate linked</span>
                            ) : null}
                            {isRepeatedCluster ? (
                              <span className={styles.chipWarn}>Repeated cluster</span>
                            ) : null}
                          </div>
                        </div>

                        <div className={styles.complaintsManagementAction}>
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

              <div className={styles.complaintsPagination}>
                <div className={styles.complaintsPaginationInfo}>
                  Page {safePage} of {totalPages}
                </div>

                <div className={styles.complaintsPaginationActions}>
                  {prevPage ? (
                    <Link href={buildPageHref(prevPage)} className={styles.secondaryLink}>
                      Previous
                    </Link>
                  ) : (
                    <span className={styles.complaintsPaginationDisabled}>Previous</span>
                  )}

                  {nextPage ? (
                    <Link href={buildPageHref(nextPage)} className={styles.secondaryLink}>
                      Next
                    </Link>
                  ) : (
                    <span className={styles.complaintsPaginationDisabled}>Next</span>
                  )}
                </div>
              </div>
            </section>
          </div>
        </section>
      </div>
    </main>
  );
}