import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabaseServer";
import LogoutButton from "../components/LogoutButton";
import ImageLightbox from "../components/ImageLightbox";
import styles from "../home.module.css";

type ComplaintImageRow = {
  public_url: string | null;
  original_filename: string | null;
  created_at: string;
};

type ComplaintRow = {
  id: string;
  title: string | null;
  description: string | null;
  status: string | null;
  created_at: string;
  address_label: string | null;
  lat: number | null;
  lng: number | null;
  resolved_at: string | null;
  resolution_note: string | null;
  complaint_media?: ComplaintImageRow[] | null;
};

type ProfileRow = {
  role: string | null;
  is_verified: boolean | null;
};

export default async function MyReportsPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/my-reports");
  }

  const { data: profileData } = await supabase
    .from("profiles")
    .select("role, is_verified")
    .eq("id", user.id)
    .maybeSingle();

  const profile: ProfileRow | null = profileData;
  const isAuthority =
    profile?.is_verified === true && profile?.role === "authority";

  const { data: complaints, error } = await supabase
    .from("complaints")
    .select(
      `
      id,
      title,
      description,
      status,
      created_at,
      address_label,
      lat,
      lng,
      resolved_at,
      resolution_note,
      complaint_media (
        public_url,
        original_filename,
        created_at
      )
    `
    )
    .eq("created_by", user.id)
    .order("created_at", { ascending: false });

  const myComplaints: ComplaintRow[] = complaints ?? [];

  const totalReports = myComplaints.length;
  const activeReports = myComplaints.filter((item) =>
    isActiveStatus(item.status)
  ).length;
  const resolvedReports = myComplaints.filter((item) =>
    isResolvedStatus(item.status)
  ).length;

  return (
    <main className={styles.page}>
      <div className={styles.loggedShell}>
        <aside className={styles.sidebar}>
          <div className={styles.sidebarInner}>
            <div className={styles.sidebarBrand}>CivicAI</div>
            <p className={styles.sidebarText}>
              Quick navigation for signed-in users.
            </p>

            <nav className={styles.sidebarNav}>
              <Link href="/" className={styles.sidebarLink}>
                Home
              </Link>

              <Link href="/my-reports" className={styles.sidebarLinkPrimary}>
                My Reports
              </Link>

              <Link href="/report" className={styles.sidebarLink}>
                Report complaint
              </Link>

              {isAuthority ? (
                <Link href="/authority" className={styles.sidebarLink}>
                  Authority dashboard
                </Link>
              ) : null}
            </nav>

            <div className={styles.sidebarFooter}>
              <LogoutButton className={styles.sidebarLogoutButton} />
            </div>
          </div>
        </aside>

        <div className={styles.loggedContent}>
          <div className={styles.dashboardPage}>
            <section className={styles.dashboardHero}>
              <div className={styles.dashboardHeroTop}>
                <div>
                  <p className={styles.dashboardEyebrow}>Citizen workspace</p>
                  <h1 className={styles.dashboardTitle}>My Reports</h1>
                  <p className={styles.dashboardText}>
                    View only the complaints submitted from your account, check
                    their current status, and review authority notes or
                    resolution updates when available.
                  </p>
                </div>

                <div className={styles.dashboardActions}>
                  <Link href="/report" className={styles.dashboardPrimary}>
                    Report a problem
                  </Link>
                  <Link href="/" className={styles.dashboardSecondary}>
                    Back to Home
                  </Link>
                </div>
              </div>

              <div className={styles.dashboardStats}>
                <div className={styles.dashboardStatCard}>
                  <p className={styles.dashboardStatLabel}>Total reports</p>
                  <h2 className={styles.dashboardStatValue}>{totalReports}</h2>
                  <p className={styles.dashboardStatSubtext}>
                    Complaints submitted from your account
                  </p>
                </div>

                <div className={styles.dashboardStatCard}>
                  <p className={styles.dashboardStatLabel}>Under review</p>
                  <h2 className={styles.dashboardStatValue}>{activeReports}</h2>
                  <p className={styles.dashboardStatSubtext}>
                    Reports still awaiting final resolution
                  </p>
                </div>

                <div className={styles.dashboardStatCard}>
                  <p className={styles.dashboardStatLabel}>Resolved</p>
                  <h2 className={styles.dashboardStatValue}>{resolvedReports}</h2>
                  <p className={styles.dashboardStatSubtext}>
                    Reports marked resolved or completed
                  </p>
                </div>
              </div>
            </section>

            <section className={styles.loggedInfoSection}>
              <div className={styles.loggedInfoGrid}>
                <div className={styles.loggedInfoCard}>
                  <p className={styles.loggedCardEyebrow}>What you can see</p>
                  <h3 className={styles.loggedCardTitle}>Report tracking</h3>
                  <ul className={styles.loggedSummaryList}>
                    <li>Your own submitted complaints only</li>
                    <li>Current complaint status and submission time</li>
                    <li>Authority resolution note when available</li>
                  </ul>
                </div>

                <div className={styles.loggedInfoCard}>
                  <p className={styles.loggedCardEyebrow}>Quick actions</p>
                  <h3 className={styles.loggedCardTitle}>Next steps</h3>
                  <div className={styles.loggedActionList}>
                    <Link href="/report" className={styles.loggedActionItem}>
                      Submit another complaint
                    </Link>
                    <Link href="/" className={styles.loggedActionItem}>
                      Review public homepage activity
                    </Link>
                  </div>
                </div>
              </div>
            </section>

            <section className={styles.complaintsSectionLogged}>
              <div className={styles.loggedSectionHeaderRow}>
                <div>
                  <p className={styles.sectionEyebrowLogged}>My complaint history</p>
                  <h2 className={styles.sectionTitleLogged}>Submitted reports</h2>
                </div>

                <Link href="/report" className={styles.inlineActionDark}>
                  Report a new issue
                </Link>
              </div>

              {error ? (
                <div className={styles.alertBoxDark}>
                  Unable to load your reports: <b>{error.message}</b>
                </div>
              ) : myComplaints.length === 0 ? (
                <div className={styles.emptyBoxDark}>
                  You have not submitted any complaints yet.
                </div>
              ) : (
                <div className={styles.complaintListLogged}>
                  {myComplaints.map((item) => {
                    const imageUrl =
                      item.complaint_media?.find((media) => !!media.public_url)
                        ?.public_url ?? null;

                    return (
                      <article key={item.id} className={styles.complaintCardDark}>
                        <div className={styles.complaintCompactRow}>
                          <div className={styles.complaintThumbArea}>
                            {imageUrl ? (
                              <div className={styles.complaintImageWrapDark}>
                                <ImageLightbox
                                  src={imageUrl}
                                  alt={item.title?.trim() || "Complaint image"}
                                />
                              </div>
                            ) : (
                              <div className={styles.noImageBoxDark}>No image</div>
                            )}
                          </div>

                          <div className={styles.complaintInfoArea}>
                            <div className={styles.complaintTop}>
                              <div className={styles.complaintMain}>
                                <h3 className={styles.complaintTitleDark}>
                                  {item.title?.trim() || "Untitled complaint"}
                                </h3>

                                <div className={styles.metaRowDark}>
                                  <span className={styles.metaItem}>
                                    {item.address_label?.trim() ||
                                      "Location not specified"}
                                  </span>
                                  <span className={styles.metaDotDark}>•</span>
                                  <span className={styles.metaItem}>
                                    {new Date(item.created_at).toLocaleString()}
                                  </span>
                                </div>
                              </div>

                              <StatusBadge label={item.status ?? "unknown"} />
                            </div>

                            <div className={styles.complaintTextCol}>
                              <p className={styles.complaintCaptionDark}>
                                Complaint description
                              </p>
                              <p className={styles.complaintNoteDark}>
                                {item.description?.trim() ||
                                  "No description was provided for this complaint."}
                              </p>

                              <p className={styles.complaintCaptionDark}>
                                Authority update
                              </p>
                              <p className={styles.complaintNoteDark}>
                                {getAuthorityUpdate(
                                  item.status,
                                  item.resolution_note,
                                  item.resolved_at
                                )}
                              </p>
                            </div>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        </div>
      </div>
    </main>
  );
}

function StatusBadge({ label }: { label: string }) {
  const value = label.toLowerCase();

  let className = styles.badgeNeutral;
  if (value.includes("open")) className = styles.badgeOpen;
  else if (value.includes("progress") || value.includes("processing")) {
    className = styles.badgeProgress;
  } else if (value.includes("resolved") || value.includes("completed")) {
    className = styles.badgeResolved;
  } else if (value.includes("submitted")) {
    className = styles.badgeNeutral;
  }

  return <span className={`${styles.badge} ${className}`}>{label}</span>;
}

function isResolvedStatus(status: string | null) {
  const value = (status ?? "").toLowerCase();
  return value.includes("resolved") || value.includes("completed");
}

function isActiveStatus(status: string | null) {
  const value = (status ?? "").toLowerCase();
  return (
    value.includes("submitted") ||
    value.includes("processing") ||
    value.includes("progress") ||
    value.includes("open")
  );
}

function getAuthorityUpdate(
  status: string | null,
  resolutionNote: string | null,
  resolvedAt: string | null
) {
  if (resolutionNote?.trim()) {
    if (resolvedAt) {
      return `${resolutionNote.trim()} (Updated on ${new Date(
        resolvedAt
      ).toLocaleString()})`;
    }
    return resolutionNote.trim();
  }

  const value = (status ?? "").toLowerCase();

  if (value.includes("resolved") || value.includes("completed")) {
    return resolvedAt
      ? `This complaint was marked as resolved on ${new Date(
          resolvedAt
        ).toLocaleString()}.`
      : "This complaint was marked as resolved.";
  }

  if (value.includes("rejected")) {
    return "This complaint record was marked as rejected during review.";
  }

  if (value.includes("processing") || value.includes("progress")) {
    return "Your complaint is currently under authority review.";
  }

  if (value.includes("submitted") || value.includes("open")) {
    return "Your complaint has been submitted and is waiting for review.";
  }

  return "No authority update is available yet.";
}