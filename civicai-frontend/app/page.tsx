import Link from "next/link";
import { createClient } from "@/lib/supabaseServer";
import LogoutButton from "./components/LogoutButton";
import styles from "./home.module.css";
import ImageLightbox from "./components/ImageLightbox";

type ComplaintImageRow = {
  public_url: string | null;
  original_filename: string | null;
  created_at: string;
};

type ComplaintRow = {
  id: string;
  title: string | null;
  status: string | null;
  created_at: string;
  address_label: string | null;
  lat: number | null;
  lng: number | null;
  complaint_media?: ComplaintImageRow[] | null;
};

type ProfileRow = {
  role: string | null;
  is_verified: boolean | null;
};

export default async function HomePage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  let profile: ProfileRow | null = null;

  if (user) {
    const { data: profileData } = await supabase
      .from("profiles")
      .select("role, is_verified")
      .eq("id", user.id)
      .maybeSingle();

    profile = profileData;
  }

  const isAuthority =
    !!user && profile?.is_verified === true && profile?.role === "authority";

  const { data: complaints, error } = await supabase
    .from("complaints")
    .select(
      `
      id,
      title,
      status,
      created_at,
      address_label,
      lat,
      lng,
      complaint_media (
        public_url,
        original_filename,
        created_at
      )
    `
    )
    .order("created_at", { ascending: false })
    .limit(10);

  const recentComplaints: ComplaintRow[] = complaints ?? [];

  const publicContent = (
    <>
      <section className={styles.publicHero}>
        <div className={styles.publicGlowOne} />
        <div className={styles.publicGlowTwo} />

        <div className={styles.container}>
          <header className={styles.publicTopbar}>
            <div className={styles.publicBrandBlock}>
              <div className={styles.publicBrand}>CivicAI</div>
              <div className={styles.publicBrandSub}>
                Report and track local civic issues
              </div>
            </div>

            <div className={styles.publicTopbarActions}>
              <Link href="/login" className={styles.publicNavSecondary}>
                Sign in / Register
              </Link>

              <Link href="/report" className={styles.publicNavPrimary}>
                Report a problem
              </Link>
            </div>
          </header>

          <div className={styles.publicHeroGrid}>
            <div className={styles.publicHeroContent}>
              <p className={styles.publicEyebrow}>Community reporting platform</p>

              <h1 className={styles.publicHeroTitle}>
                Report civic problems clearly and help authorities respond faster.
              </h1>

              <p className={styles.publicHeroText}>
                CivicAI is a public-facing complaint platform where residents can
                submit civic issues, follow recent complaint activity, and help
                improve transparency in local problem reporting.
              </p>

              <div className={styles.publicHeroActions}>
                <Link href="/report" className={styles.publicHeroPrimary}>
                  Report a complaint
                </Link>
                <Link href="/login" className={styles.publicHeroSecondary}>
                  Create an account
                </Link>
              </div>

              <div className={styles.publicHeroStats}>
                <div className={styles.publicStatMini}>
                  <span className={styles.publicStatMiniValue}>
                    {recentComplaints.length}
                  </span>
                  <span className={styles.publicStatMiniLabel}>
                    Recent complaints shown
                  </span>
                </div>

                <div className={styles.publicStatMini}>
                  <span className={styles.publicStatMiniValue}>Public</span>
                  <span className={styles.publicStatMiniLabel}>
                    Homepage access
                  </span>
                </div>
              </div>
            </div>

            <div className={styles.publicHeroPanel}>
              <div className={styles.publicInfoCard}>
                <p className={styles.publicPanelEyebrow}>Platform overview</p>
                <h2 className={styles.publicInfoTitle}>How the platform works</h2>
                <ol className={styles.publicInfoList}>
                  <li>View recent public complaint activity.</li>
                  <li>Create an account and complete verification.</li>
                  <li>Submit complaints with location and image evidence.</li>
                </ol>
              </div>

              <div className={styles.publicInfoCard}>
                <p className={styles.publicPanelEyebrow}>Why use CivicAI</p>
                <div className={styles.publicReasonGrid}>
                  <div className={styles.publicReasonItem}>
                    <strong>Clear reporting</strong>
                    <span>Submit structured civic complaints</span>
                  </div>
                  <div className={styles.publicReasonItem}>
                    <strong>Public visibility</strong>
                    <span>Review recent complaint activity</span>
                  </div>
                  <div className={styles.publicReasonItem}>
                    <strong>Verified access</strong>
                    <span>Protected reporting and review flow</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className={styles.publicComplaintsSection}>
        <div className={styles.container}>
          <div className={styles.publicSectionHeaderRow}>
            <div>
              <p className={styles.publicSectionEyebrow}>Recent activity</p>
              <h2 className={styles.publicSectionTitle}>Latest public complaints</h2>
              <p className={styles.publicSectionText}>
                Browse recent complaint submissions shared on the public homepage.
              </p>
            </div>

            <Link href="/report" className={styles.publicInlineAction}>
              Report a new issue
            </Link>
          </div>

          {error ? (
            <div className={styles.publicAlertBox}>
              Unable to load recent complaints: <b>{error.message}</b>
            </div>
          ) : recentComplaints.length === 0 ? (
            <div className={styles.publicEmptyBox}>
              No public complaints are available yet.
            </div>
          ) : (
            <div className={styles.publicComplaintList}>
              {recentComplaints.map((item) => {
                const imageUrl =
                  item.complaint_media?.find((media) => !!media.public_url)
                    ?.public_url ?? null;

                return (
                  <article key={item.id} className={styles.publicComplaintCard}>
                    <div className={styles.complaintCompactRow}>
                      <div className={styles.complaintThumbArea}>
                        {imageUrl ? (
                          <div className={styles.publicComplaintImageWrap}>
                            <ImageLightbox
                              src={imageUrl}
                              alt={item.title?.trim() || "Complaint image"}
                            />
                          </div>
                        ) : (
                          <div className={styles.publicNoImageBox}>No image</div>
                        )}
                      </div>

                      <div className={styles.complaintInfoArea}>
                        <div className={styles.complaintTop}>
                          <div className={styles.complaintMain}>
                            <h3 className={styles.publicComplaintTitle}>
                              {item.title?.trim() || "Untitled complaint"}
                            </h3>

                            <div className={styles.publicMetaRow}>
                              <span className={styles.metaItem}>
                                {item.address_label?.trim() ||
                                  "Location not specified"}
                              </span>
                              <span className={styles.publicMetaDot}>•</span>
                              <span className={styles.metaItem}>
                                {new Date(item.created_at).toLocaleString()}
                              </span>
                            </div>
                          </div>

                          <StatusBadge label={item.status ?? "unknown"} />
                        </div>

                        <div className={styles.complaintTextCol}>
                          <p className={styles.publicComplaintCaption}>
                            Public complaint record
                          </p>

                          {item.lat !== null && item.lng !== null ? (
                            <p className={styles.publicCoords}>
                              Coordinates: {item.lat}, {item.lng}
                            </p>
                          ) : (
                            <p className={styles.publicCoords}>
                              Coordinates not provided
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </>
  );

  const loggedInContent = (
    <div className={styles.dashboardPage}>
      <section className={styles.dashboardHero}>
        <div className={styles.dashboardHeroTop}>
          <div>
            <p className={styles.dashboardEyebrow}>
              {isAuthority ? "Authority workspace" : "Citizen workspace"}
            </p>
            <h1 className={styles.dashboardTitle}>
              {isAuthority
                ? "Manage complaints and monitor recent public activity."
                : "Track public complaints and submit new civic reports."}
            </h1>
            <p className={styles.dashboardText}>
              {isAuthority
                ? "Use your dashboard tools to review incoming complaints, open the authority workspace, and stay updated with the latest public submissions."
                : "Use your account to report new civic issues and stay informed about recent public complaints in your community."}
            </p>
          </div>

          <div className={styles.dashboardActions}>
            <Link href="/report" className={styles.dashboardPrimary}>
              Report a problem
            </Link>

            {isAuthority ? (
              <Link href="/authority" className={styles.dashboardSecondary}>
                Open Authority Dashboard
              </Link>
            ) : null}
          </div>
        </div>

        <div className={styles.dashboardStats}>
          <div className={styles.dashboardStatCard}>
            <p className={styles.dashboardStatLabel}>Recent complaints</p>
            <h2 className={styles.dashboardStatValue}>
              {recentComplaints.length}
            </h2>
            <p className={styles.dashboardStatSubtext}>
              Latest public complaints shown on homepage
            </p>
          </div>

          <div className={styles.dashboardStatCard}>
            <p className={styles.dashboardStatLabel}>Access type</p>
            <h2 className={styles.dashboardStatValueSmall}>
              {isAuthority ? "Authority" : "Citizen"}
            </h2>
            <p className={styles.dashboardStatSubtext}>
              Current account role in the platform
            </p>
          </div>

          <div className={styles.dashboardStatCard}>
            <p className={styles.dashboardStatLabel}>Next action</p>
            <h2 className={styles.dashboardStatValueSmall}>
              {isAuthority ? "Review" : "Report"}
            </h2>
            <p className={styles.dashboardStatSubtext}>
              {isAuthority
                ? "Open dashboard and process complaint updates"
                : "Submit a civic issue using the report form"}
            </p>
          </div>
        </div>
      </section>

      <section className={styles.loggedInfoSection}>
        <div className={styles.loggedInfoGrid}>
          <div className={styles.loggedInfoCard}>
            <p className={styles.loggedCardEyebrow}>Quick actions</p>
            <h3 className={styles.loggedCardTitle}>What you can do here</h3>
            <div className={styles.loggedActionList}>
              <Link href="/report" className={styles.loggedActionItem}>
                Submit a new complaint
              </Link>
              <Link href="/" className={styles.loggedActionItem}>
                Review homepage activity
              </Link>
              {isAuthority ? (
                <Link href="/authority" className={styles.loggedActionItem}>
                  Open authority review workspace
                </Link>
              ) : null}
            </div>
          </div>

          <div className={styles.loggedInfoCard}>
            <p className={styles.loggedCardEyebrow}>Account summary</p>
            <h3 className={styles.loggedCardTitle}>Workspace overview</h3>
            <ul className={styles.loggedSummaryList}>
              <li>
                Signed in as a{" "}
                <strong>{isAuthority ? "verified authority" : "verified citizen"}</strong>
              </li>
              <li>Homepage shows the latest public complaint activity</li>
              <li>Use the left navigation for faster access to important pages</li>
            </ul>
          </div>
        </div>
      </section>

      <section className={styles.complaintsSectionLogged}>
        <div className={styles.sectionHeaderRow}>
          <div>
            <p className={styles.sectionEyebrowLogged}>Recent activity</p>
            <h2 className={styles.sectionTitleLogged}>Latest public complaints</h2>
          </div>

          <Link href="/report" className={styles.inlineActionDark}>
            Report a new issue
          </Link>
        </div>

        {error ? (
          <div className={styles.alertBoxDark}>
            Unable to load recent complaints: <b>{error.message}</b>
          </div>
        ) : recentComplaints.length === 0 ? (
          <div className={styles.emptyBoxDark}>
            No public complaints are available yet.
          </div>
        ) : (
          <div className={styles.complaintListLogged}>
            {recentComplaints.map((item) => {
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
                          Public complaint record
                        </p>

                        {item.lat !== null && item.lng !== null ? (
                          <p className={styles.coordsDark}>
                            Coordinates: {item.lat}, {item.lng}
                          </p>
                        ) : (
                          <p className={styles.coordsDark}>
                            Coordinates not provided
                          </p>
                        )}
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
  );

  if (!user) {
    return <main className={styles.page}>{publicContent}</main>;
  }

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
              <Link href="/report" className={styles.sidebarLink}>
                Report complaint
              </Link>
              {isAuthority ? (
                <Link href="/authority" className={styles.sidebarLinkPrimary}>
                  Authority dashboard
                </Link>
              ) : null}
            </nav>

            <div className={styles.sidebarFooter}>
              <LogoutButton className={styles.sidebarLogoutButton} />
            </div>
          </div>
        </aside>

        <div className={styles.loggedContent}>{loggedInContent}</div>
      </div>
    </main>
  );
}

function StatusBadge({ label }: { label: string }) {
  const value = label.toLowerCase();

  let className = styles.badgeNeutral;
  if (value.includes("open")) className = styles.badgeOpen;
  else if (value.includes("progress")) className = styles.badgeProgress;
  else if (value.includes("resolved")) className = styles.badgeResolved;
  else if (value.includes("submitted")) className = styles.badgeNeutral;

  return <span className={`${styles.badge} ${className}`}>{label}</span>;
}