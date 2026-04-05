import { redirect } from "next/navigation";
import Link from "next/link";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import styles from "./authority.module.css";

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
};

function formatDate(value: string) {
  return new Date(value).toLocaleString("en-BD", {
    dateStyle: "medium",
    timeStyle: "short",
  });
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
      created_at
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

  let mediaByComplaint = new Map<string, ComplaintMediaRow>();
  let inferenceByComplaint = new Map<string, InferenceRow>();

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
        summary
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

  return (
    <main className={styles.page}>
      <div className={styles.wrapper}>
        <section className={styles.pageGrid}>
          <aside className={styles.sidebar}>
            <div className={styles.sidebarCard}>
              <p className={styles.sidebarEyebrow}>Authority workspace</p>
              <h2 className={styles.sidebarTitle}>Dashboard</h2>
              <p className={styles.sidebarText}>
                Review complaint submissions, inspect AI results, and open each
                case for a full decision workflow.
              </p>

              <nav className={styles.sidebarNav}>
                <Link href="/" className={styles.sidebarLink}>
                  Back to homepage
                </Link>
                <Link href="/authority" className={styles.sidebarLinkActive}>
                  Authority dashboard
                </Link>
              </nav>

              <div className={styles.sidebarHelp}>
                <p className={styles.sidebarHelpTitle}>Review priorities</p>
                <ul className={styles.sidebarHelpList}>
                  <li>Check AI label and confidence</li>
                  <li>Review image and complaint summary</li>
                  <li>Update status and resolution notes</li>
                  <li>Use detail page for full complaint review</li>
                </ul>
              </div>
            </div>
          </aside>

          <div className={styles.mainContent}>
            <section className={styles.hero}>
              <p className={styles.eyebrow}>Authority review workspace</p>
              <h1 className={styles.title}>Complaint review dashboard</h1>
              <p className={styles.subtitle}>
                Review citizen complaints with AI-assisted category, confidence,
                and priority signals before taking action.
              </p>

              <div className={styles.summaryGrid}>
                <div className={styles.summaryCard}>
                  <p className={styles.summaryLabel}>Total complaints</p>
                  <h3 className={styles.summaryValue}>{complaints.length}</h3>
                  <p className={styles.summaryText}>
                    Complaint records currently visible in the dashboard
                  </p>
                </div>

                <div className={styles.summaryCard}>
                  <p className={styles.summaryLabel}>Workspace role</p>
                  <h3 className={styles.summaryValue}>Authority</h3>
                  <p className={styles.summaryText}>
                    This page is restricted to verified authority users
                  </p>
                </div>

                <div className={styles.summaryCard}>
                  <p className={styles.summaryLabel}>Main action</p>
                  <h3 className={styles.summaryValue}>Review cases</h3>
                  <p className={styles.summaryText}>
                    Open each complaint to update status and run AI when needed
                  </p>
                </div>
              </div>
            </section>

            <section className={styles.section}>
              <div className={styles.sectionHeader}>
                <div>
                  <h2 className={styles.sectionTitle}>Complaint queue</h2>
                  <p className={styles.sectionText}>
                    Browse the latest submitted complaints with compact AI and
                    priority details.
                  </p>
                </div>
              </div>

              {complaints.length === 0 ? (
                <div className={styles.emptyBox}>No complaints available yet.</div>
              ) : (
                <div className={styles.cardList}>
                  {complaints.map((complaint) => {
                    const media = mediaByComplaint.get(complaint.id);
                    const ai = inferenceByComplaint.get(complaint.id);
                    const area =
                      complaint.city_area ||
                      complaint.upazila ||
                      complaint.district ||
                      "Unknown";

                    return (
                      <article key={complaint.id} className={styles.dashboardCard}>
                        <div className={styles.thumbWrap}>
                          {media?.public_url ? (
                            <img
                              src={media.public_url}
                              alt={complaint.title ?? "Complaint image"}
                              className={styles.thumbImage}
                            />
                          ) : (
                            <div className={styles.noImage}>No image</div>
                          )}
                        </div>

                        <div className={styles.cardBody}>
                          <div className={styles.cardTop}>
                            <div>
                              <h3 className={styles.cardTitle}>
                                {complaint.title || "Untitled complaint"}
                              </h3>
                              <p className={styles.metaText}>
                                Reporter: {complaint.reporter_name || "Unknown"} • Area: {area}
                              </p>
                            </div>

                            <span className={statusClass(complaint.status)}>
                              {complaint.status}
                            </span>
                          </div>

                          <p className={styles.bodyText}>
                            {ai?.summary || complaint.description}
                          </p>

                          <div className={styles.chipRow}>
                            <span className={styles.chip}>
                              AI: {ai?.fusion_label || "Pending"}
                            </span>
                            <span className={styles.chip}>
                              Confidence:{" "}
                              {ai?.fusion_confidence != null
                                ? `${(ai.fusion_confidence * 100).toFixed(1)}%`
                                : "Pending"}
                            </span>
                            <span className={priorityClass(ai?.priority)}>
                              Priority: {ai?.priority || "Pending"}
                            </span>
                            {ai?.conflict_flag ? (
                              <span className={styles.chipWarn}>Text/Image conflict</span>
                            ) : null}
                          </div>

                          <div className={styles.cardFooter}>
                            <span className={styles.subtleText}>
                              Submitted: {formatDate(complaint.created_at)}
                            </span>

                            <Link
                              href={`/authority/${complaint.id}`}
                              className={styles.primaryLink}
                            >
                              Open review
                            </Link>
                          </div>
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