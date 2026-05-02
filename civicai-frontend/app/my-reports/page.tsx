import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabaseServer";
import LogoutButton from "../components/LogoutButton";
import ImageLightbox from "../components/ImageLightbox";
import styles from "../home.module.css";
import MobileUserMenu from "../components/MobileUserMenu";

type ComplaintImageRow = {
  public_url: string | null;
  original_filename: string | null;
  created_at: string;
};

type InferenceResultRow = {
  complaint_id: string;
  fusion_label: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type ComplaintRow = {
  id: string;
  title: string | null;
  description: string | null;
  status: string | null;
  created_at: string;
  updated_at: string | null;
  address_label: string | null;
  lat: number | null;
  lng: number | null;
  resolved_at: string | null;
  resolution_note: string | null;

  user_category: string | null;
  final_category: string | null;
  category_source: string | null;

  division: string | null;
  district: string | null;
  upazila: string | null;
  union_name: string | null;
  city_area: string | null;
  post_code: string | null;
  location_details: string | null;

  duplicate_of: string | null;
  cluster_id: string | null;

  complaint_media?: ComplaintImageRow[] | null;
  inference_results?: InferenceResultRow[] | InferenceResultRow | null;
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
      updated_at,
      address_label,
      lat,
      lng,
      resolved_at,
      resolution_note,
      user_category,
      final_category,
      category_source,
      division,
      district,
      upazila,
      union_name,
      city_area,
      post_code,
      location_details,
      duplicate_of,
      cluster_id,
      complaint_media (
        public_url,
        original_filename,
        created_at
      ),
      inference_results (
        complaint_id,
        fusion_label,
        created_at,
        updated_at
      )
    `
    )
    .eq("created_by", user.id)
    .order("created_at", { ascending: false });

  const myComplaints = (complaints ?? []) as ComplaintRow[];

  const totalReports = myComplaints.length;
  const activeReports = myComplaints.filter((item) =>
    isActiveStatus(item.status)
  ).length;
  const resolvedReports = myComplaints.filter((item) =>
    isResolvedStatus(item.status)
  ).length;
  const aiCheckedReports = myComplaints.filter((item) =>
    Boolean(getInferenceResult(item))
  ).length;

  return (
    <main className={styles.page}>
      <MobileUserMenu active="my-reports" showAuthority={isAuthority} />

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

              <Link href="/my-profile" className={styles.sidebarLink}>
                My Profile
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
                    Track the complaints submitted from your account and check
                    their current status, category, and authority update.
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
                    Reports waiting for final action
                  </p>
                </div>

                <div className={styles.dashboardStatCard}>
                  <p className={styles.dashboardStatLabel}>Resolved</p>
                  <h2 className={styles.dashboardStatValue}>
                    {resolvedReports}
                  </h2>
                  <p className={styles.dashboardStatSubtext}>
                    Reports marked resolved or completed
                  </p>
                </div>

                <div className={styles.dashboardStatCard}>
                  <p className={styles.dashboardStatLabel}>AI checked</p>
                  <h2 className={styles.dashboardStatValue}>
                    {aiCheckedReports}
                  </h2>
                  <p className={styles.dashboardStatSubtext}>
                    Reports processed by CivicAI
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
                    <li>Current status and submission time</li>
                    <li>Complaint category and AI checked status</li>
                    <li>Authority update or resolution note</li>
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
                  <p className={styles.sectionEyebrowLogged}>
                    My complaint history
                  </p>
                  <h2 className={styles.sectionTitleLogged}>
                    Submitted reports
                  </h2>
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
                  <p>You have not submitted any complaints yet.</p>
                  <Link href="/report" className={styles.inlineActionDark}>
                    Submit your first complaint
                  </Link>
                </div>
              ) : (
                <div className={styles.complaintListLogged}>
                  {myComplaints.map((item) => {
                    const imageUrl =
                      item.complaint_media?.find((media) => !!media.public_url)
                        ?.public_url ?? null;

                    const inference = getInferenceResult(item);
                    const readableLocation = getReadableLocation(item);
                    const categoryLabel = getCitizenCategoryLabel(
                      item,
                      inference
                    );
                    const aiStatus = inference ? "AI checked" : "AI pending";
                    const areaSignal = getAreaSignal(item);
                    const authorityUpdate = getAuthorityUpdate(
                      item.status,
                      item.resolution_note,
                      item.resolved_at
                    );

                    return (
                      <article
                        key={item.id}
                        className={styles.complaintCardDark}
                      >
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
                              <div className={styles.noImageBoxDark}>
                                No image
                              </div>
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
                                    {readableLocation}
                                  </span>
                                  <span className={styles.metaDotDark}>•</span>
                                  <span className={styles.metaItem}>
                                    Submitted {formatDate(item.created_at)}
                                  </span>
                                </div>
                              </div>

                              <StatusBadge label={item.status ?? "unknown"} />
                            </div>

                            <div className={styles.metaRowDark}>
                              <SimpleBadge label={categoryLabel} />
                              <SimpleBadge label={aiStatus} />
                              {areaSignal ? (
                                <SimpleBadge label={areaSignal} />
                              ) : null}
                            </div>

                            <div className={styles.complaintTextCol}>
                              <p className={styles.complaintCaptionDark}>
                                Description
                              </p>
                              <p className={styles.complaintNoteDark}>
                                {getShortText(
                                  item.description,
                                  "No description was provided for this complaint."
                                )}
                              </p>

                              <p className={styles.complaintCaptionDark}>
                                Authority update
                              </p>
                              <p className={styles.complaintNoteDark}>
                                {authorityUpdate}
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

  if (value.includes("open")) {
    className = styles.badgeOpen;
  } else if (value.includes("progress") || value.includes("processing")) {
    className = styles.badgeProgress;
  } else if (value.includes("resolved") || value.includes("completed")) {
    className = styles.badgeResolved;
  } else if (value.includes("submitted")) {
    className = styles.badgeNeutral;
  } else if (value.includes("rejected")) {
    className = styles.badgeNeutral;
  }

  return <span className={`${styles.badge} ${className}`}>{label}</span>;
}

function SimpleBadge({ label }: { label: string }) {
  return (
    <span className={`${styles.badge} ${styles.badgeNeutral}`}>{label}</span>
  );
}

function getInferenceResult(item: ComplaintRow): InferenceResultRow | null {
  const result = item.inference_results;

  if (!result) {
    return null;
  }

  if (Array.isArray(result)) {
    return result[0] ?? null;
  }

  return result;
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
      return `${resolutionNote.trim()} Updated on ${formatDate(resolvedAt)}.`;
    }

    return resolutionNote.trim();
  }

  const value = (status ?? "").toLowerCase();

  if (value.includes("resolved") || value.includes("completed")) {
    return resolvedAt
      ? `This complaint was marked as resolved on ${formatDate(resolvedAt)}.`
      : "This complaint was marked as resolved.";
  }

  if (value.includes("rejected")) {
    return "This complaint was rejected during authority review.";
  }

  if (value.includes("processing") || value.includes("progress")) {
    return "Your complaint is currently under authority review.";
  }

  if (value.includes("submitted") || value.includes("open")) {
    return "Your complaint has been submitted and is waiting for authority review.";
  }

  return "No authority update is available yet.";
}

function getReadableLocation(item: ComplaintRow) {
  const directAddress = item.address_label?.trim();

  if (directAddress) {
    return directAddress;
  }

  const locationParts = [
    item.location_details,
    item.city_area,
    item.union_name,
    item.upazila,
    item.district,
    item.division,
    item.post_code ? `Post code ${item.post_code}` : null,
  ]
    .map((part) => part?.trim())
    .filter(Boolean);

  if (locationParts.length > 0) {
    return locationParts.join(", ");
  }

  if (typeof item.lat === "number" && typeof item.lng === "number") {
    return `${item.lat.toFixed(5)}, ${item.lng.toFixed(5)}`;
  }

  return "Location not specified";
}

function getCitizenCategoryLabel(
  item: ComplaintRow,
  inference: InferenceResultRow | null
) {
  const finalCategory =
    item.final_category?.trim() ||
    inference?.fusion_label?.trim() ||
    item.user_category?.trim();

  if (!finalCategory) {
    return "Category pending";
  }

  return `Category: ${finalCategory}`;
}

function getAreaSignal(item: ComplaintRow) {
  if (item.duplicate_of) {
    return "Similar report linked";
  }

  if (item.cluster_id) {
    return "Area pattern linked";
  }

  return null;
}

function getShortText(value: string | null, fallback: string) {
  const clean = value?.trim();

  if (!clean) {
    return fallback;
  }

  if (clean.length <= 170) {
    return clean;
  }

  return `${clean.slice(0, 170).trim()}...`;
}

function formatDate(value: string | null) {
  if (!value) {
    return "date not available";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "date not available";
  }

  return date.toLocaleString();
}