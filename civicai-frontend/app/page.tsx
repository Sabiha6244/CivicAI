import Link from "next/link";
import {
  Building2,
  ClipboardCheck,
  Droplets,
  Eye,
  FileImage,
  FileSearch,
  FileText,
  Lightbulb,
  LucideIcon,
  MapPinned,
  MoreHorizontal,
  Route,
  ShieldAlert,
  Tags,
  Toilet,
  Trash2,
  TriangleAlert,
  Trees,
  Waves,
  Zap,
} from "lucide-react";
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

const ISSUE_CATEGORIES: {
  name: string;
  helper: string;
  icon: LucideIcon;
}[] = [
    {
      name: "Garbage / Waste",
      helper: "Improper waste disposal or unclean public areas.",
      icon: Trash2,
    },
    {
      name: "Streetlights",
      helper: "Broken or non-functioning public lights.",
      icon: Lightbulb,
    },
    {
      name: "Roads / Footpaths",
      helper: "Damaged roads, pavements, or walking paths.",
      icon: Route,
    },
    {
      name: "Traffic / Road Safety",
      helper: "Unsafe traffic conditions or road safety concerns.",
      icon: TriangleAlert,
    },
    {
      name: "Water Supply",
      helper: "Public water access or supply-related issues.",
      icon: Droplets,
    },
    {
      name: "Sewerage / Drainage",
      helper: "Blocked drains, flooding, or wastewater flow problems.",
      icon: Waves,
    },
    {
      name: "Electricity",
      helper: "Public electricity and local power-related complaints.",
      icon: Zap,
    },
    {
      name: "Public Toilets",
      helper: "Sanitation, damage, or maintenance issues.",
      icon: Toilet,
    },
    {
      name: "Parks / Trees / Lakes",
      helper: "Problems affecting parks, greenery, or water bodies.",
      icon: Trees,
    },
    {
      name: "Crime / Safety",
      helper: "Public safety concerns reported through civic channels.",
      icon: ShieldAlert,
    },
    {
      name: "Community Services",
      helper: "Service gaps affecting public community needs.",
      icon: Building2,
    },
    {
      name: "Other",
      helper: "Issues that do not clearly fit the listed categories.",
      icon: MoreHorizontal,
    },
  ];

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
      <section className={styles.publicHero} id="top">
        <div className={styles.publicGlowOne} />
        <div className={styles.publicGlowTwo} />

        <div className={styles.container}>
          <header className={styles.publicTopbar}>
            <div className={styles.publicBrandBlock}>
              <div className={styles.publicBrand}>CivicAI</div>
              <div className={styles.publicBrandSub}>
                Citizen complaint platform for reporting local civic issues with
                clearer structure, public visibility, and better complaint
                tracking.
              </div>
            </div>

            <div className={styles.publicTopbarActions}>
              <Link href="#categories" className={styles.publicNavSecondary}>
                Issue categories
              </Link>
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
              <p className={styles.publicEyebrow}>Public civic reporting platform</p>

              <h1 className={styles.publicHeroTitle}>
                Report local civic problems and help authorities respond faster.
              </h1>

              <p className={styles.publicHeroText}>
                CivicAI helps residents report local issues such as waste,
                streetlights, roads, drainage, utilities, and public service
                problems through a clear complaint submission process with
                location and image evidence.
              </p>

              <div className={styles.publicHeroActions}>
                <Link href="/report" className={styles.publicHeroPrimary}>
                  Report a problem
                </Link>
                <Link href="/login" className={styles.publicHeroSecondary}>
                  Sign in / Register
                </Link>
                <Link href="#recent-complaints" className={styles.publicHeroTertiary}>
                  Browse recent complaints
                </Link>
              </div>

              <div className={styles.publicHeroHighlights}>
                <div className={styles.publicHighlightChip}>
                  <span className={styles.publicHighlightValue}>Public</span>
                  <span className={styles.publicHighlightLabel}>
                    complaint visibility
                  </span>
                </div>
                <div className={styles.publicHighlightChip}>
                  <span className={styles.publicHighlightValue}>Location</span>
                  <span className={styles.publicHighlightLabel}>
                    based reporting
                  </span>
                </div>
                <div className={styles.publicHighlightChip}>
                  <span className={styles.publicHighlightValue}>Image</span>
                  <span className={styles.publicHighlightLabel}>
                    supported submissions
                  </span>
                </div>
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
                  <span className={styles.publicStatMiniValue}>
                    {ISSUE_CATEGORIES.length}
                  </span>
                  <span className={styles.publicStatMiniLabel}>
                    Supported complaint categories
                  </span>
                </div>
              </div>
            </div>

            <div className={styles.publicHeroPanel}>
              <div className={styles.publicInfoCard}>
                <p className={styles.publicPanelEyebrow}>Service summary</p>
                <h2 className={styles.publicInfoTitle}>How CivicAI works</h2>
                <div className={styles.publicSummaryList}>
                  <div className={styles.publicSummaryItem}>
                    <strong>Choose the issue location</strong>
                    <span>Identify where the local problem exists.</span>
                  </div>
                  <div className={styles.publicSummaryItem}>
                    <strong>Select the right category</strong>
                    <span>Use the category list to match the issue type.</span>
                  </div>
                  <div className={styles.publicSummaryItem}>
                    <strong>Add description and image</strong>
                    <span>Submit clear supporting details and evidence.</span>
                  </div>
                  <div className={styles.publicSummaryItem}>
                    <strong>Save for review and tracking</strong>
                    <span>
                      Complaints remain available in the system for follow-up.
                    </span>
                  </div>
                </div>
              </div>

              <div className={styles.publicInfoCard}>
                <p className={styles.publicPanelEyebrow}>Why this matters</p>
                <div className={styles.publicReasonGrid}>
                  <div className={styles.publicReasonItem}>
                    <strong>Structured reporting</strong>
                    <span>Clear categories and guided complaint submission.</span>
                  </div>
                  <div className={styles.publicReasonItem}>
                    <strong>Transparency</strong>
                    <span>Recent complaint activity can stay publicly visible.</span>
                  </div>
                  <div className={styles.publicReasonItem}>
                    <strong>Authority workflow</strong>
                    <span>
                      Complaints can be reviewed inside a dedicated workspace.
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className={styles.publicCategoriesSection} id="categories">
        <div className={styles.container}>
          <div className={styles.publicSectionHeader}>
            <p className={styles.publicSectionEyebrow}>Issue categories</p>
            <h2 className={styles.publicSectionTitle}>
              What issues can you report?
            </h2>
            <p className={styles.publicSectionText}>
              Citizens can submit complaints under the following categories.
              Choose the option that best matches the issue during reporting.
            </p>
          </div>

          <div className={styles.publicCategoriesGrid}>
            {ISSUE_CATEGORIES.map((category) => {
              const Icon = category.icon;

              return (
                <article key={category.name} className={styles.publicCategoryCard}>
                  <div className={styles.publicCategoryIcon}>
                    <Icon size={22} strokeWidth={2.1} />
                  </div>
                  <h3 className={styles.publicCategoryTitle}>{category.name}</h3>
                  <p className={styles.publicCategoryText}>{category.helper}</p>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <section className={styles.publicProcessSection} id="how-it-works">
        <div className={styles.container}>
          <div className={styles.publicSectionHeader}>
            <p className={styles.publicSectionEyebrow}>Reporting process</p>
            <h2 className={styles.publicSectionTitle}>How CivicAI works</h2>
            <p className={styles.publicSectionText}>
              The platform is designed to help citizens submit clearer complaints
              and help authorities review them more efficiently.
            </p>
          </div>

          <div className={styles.publicProcessGrid}>
            <article className={styles.publicProcessCard}>
              <div className={styles.publicCategoryIcon}>
                <MapPinned size={22} strokeWidth={2.1} />
              </div>

              <h3 className={styles.publicProcessTitle}>Choose location</h3>
              <p className={styles.publicProcessText}>
                Select the problem area or mark the location relevant to the
                complaint.
              </p>
            </article>

            <article className={styles.publicProcessCard}>
              <div className={styles.publicCategoryIcon}>
                <Tags size={22} strokeWidth={2.1} />
              </div>

              <h3 className={styles.publicProcessTitle}>Select category</h3>
              <p className={styles.publicProcessText}>
                Choose the category that best matches the issue from the
                available list.
              </p>
            </article>

            <article className={styles.publicProcessCard}>
              <div className={styles.publicCategoryIcon}>
                <FileImage size={22} strokeWidth={2.1} />
              </div>

              <h3 className={styles.publicProcessTitle}>Add details and image</h3>
              <p className={styles.publicProcessText}>
                Write a short description and upload an image when available.
              </p>
            </article>

            <article className={styles.publicProcessCard}>
              <div className={styles.publicCategoryIcon}>
                <ClipboardCheck size={22} strokeWidth={2.1} />
              </div>
              <h3 className={styles.publicProcessTitle}>Submit and review</h3>
              <p className={styles.publicProcessText}>
                The complaint is saved in the platform for review, tracking, and
                follow-up.
              </p>
            </article>
          </div>
        </div>
      </section>

      <section className={styles.publicTrustSection} id="why-civicai">
        <div className={styles.container}>
          <div className={styles.publicSectionHeader}>
            <p className={styles.publicSectionEyebrow}>Why CivicAI</p>
            <h2 className={styles.publicSectionTitle}>
              A clearer way to report and monitor local issues
            </h2>
            <p className={styles.publicSectionText}>
              CivicAI is designed to make local issue reporting more structured,
              visible, and easier to understand for both citizens and reviewing
              authorities.
            </p>
          </div>

          <div className={styles.publicTrustGrid}>
            <article className={styles.publicTrustCard}>
              <div className={styles.publicCategoryIcon}>
                <ClipboardCheck size={22} strokeWidth={2.1} />
              </div>
              <h3 className={styles.publicTrustTitle}>Structured reporting</h3>
              <p className={styles.publicTrustText}>
                Submit complaints using location, category, description, and
                image evidence.
              </p>
            </article>

            <article className={styles.publicTrustCard}>
              <div className={styles.publicCategoryIcon}>
                <Eye size={22} strokeWidth={2.1} />
              </div>
              <h3 className={styles.publicTrustTitle}>Public visibility</h3>
              <p className={styles.publicTrustText}>
                Recent complaint activity can be shown on the platform for
                transparency.
              </p>
            </article>

            <article className={styles.publicTrustCard}>
              <div className={styles.publicCategoryIcon}>
                <Building2 size={22} strokeWidth={2.1} />
              </div>
              <h3 className={styles.publicTrustTitle}>Authority workflow</h3>
              <p className={styles.publicTrustText}>
                Authorities can review complaint records through a dedicated
                workspace.
              </p>
            </article>

            <article className={styles.publicTrustCard}>
              <div className={styles.publicCategoryIcon}>
                <FileSearch size={22} strokeWidth={2.1} />
              </div>
              <h3 className={styles.publicTrustTitle}>
                Better issue understanding
              </h3>
              <p className={styles.publicTrustText}>
                Standardized reporting helps reduce confusion and improves
                complaint clarity.
              </p>
            </article>
          </div>
        </div>
      </section>

      <section
        className={styles.publicComplaintsSection}
        id="recent-complaints"
      >
        <div className={styles.container}>
          <div className={styles.publicSectionHeaderRow}>
            <div>
              <p className={styles.publicSectionEyebrow}>Recent activity</p>
              <h2 className={styles.publicSectionTitle}>Latest public complaints</h2>
              <p className={styles.publicSectionText}>
                Browse recent complaint submissions shared on the platform
                homepage.
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
                          <p className={styles.publicComplaintNote}>
                            {getComplaintNote(item.status)}
                          </p>
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

      <section className={styles.publicGuidanceSection} id="guidance">
        <div className={styles.container}>
          <div className={styles.publicSectionHeader}>
            <p className={styles.publicSectionEyebrow}>Reporting guidance</p>
            <h2 className={styles.publicSectionTitle}>Before you report</h2>
            <p className={styles.publicSectionText}>
              A few simple reporting practices can make complaints clearer and
              easier to review.
            </p>
          </div>

          <div className={styles.publicGuidanceGrid}>
            <article className={styles.publicGuidanceCard}>
              <div className={styles.publicCategoryIcon}>
                <MapPinned size={22} strokeWidth={2.1} />
              </div>
              <h3 className={styles.publicGuidanceTitle}>Use clear location details</h3>
              <p className={styles.publicGuidanceText}>
                Make sure the complaint points to the actual problem area.
              </p>
            </article>

            <article className={styles.publicGuidanceCard}>
              <div className={styles.publicCategoryIcon}>
                <FileText size={22} strokeWidth={2.1} />
              </div>
              <h3 className={styles.publicGuidanceTitle}>Write a specific description</h3>
              <p className={styles.publicGuidanceText}>
                Keep the complaint short, relevant, and easy to understand.
              </p>
            </article>

            <article className={styles.publicGuidanceCard}>
              <div className={styles.publicCategoryIcon}>
                <FileImage size={22} strokeWidth={2.1} />
              </div>
              <h3 className={styles.publicGuidanceTitle}>Add image evidence</h3>
              <p className={styles.publicGuidanceText}>
                Upload a supporting image when possible to improve complaint clarity.
              </p>
            </article>

            <article className={styles.publicGuidanceCard}>
              <div className={styles.publicCategoryIcon}>
                <Tags size={22} strokeWidth={2.1} />
              </div>
              <h3 className={styles.publicGuidanceTitle}>Use the right category</h3>
              <p className={styles.publicGuidanceText}>
                Choose the closest matching category from the available list.
              </p>
            </article>

            <article className={styles.publicGuidanceCard}>
              <div className={styles.publicCategoryIcon}>
                <TriangleAlert size={22} strokeWidth={2.1} />
              </div>
              <h3 className={styles.publicGuidanceTitle}>Emergency matters</h3>
              <p className={styles.publicGuidanceText}>
                For immediate emergencies, contact the relevant emergency service directly.
              </p>
            </article>
          </div>
        </div>
      </section>

      <footer className={styles.publicFooter}>
        <div className={styles.container}>
          <div className={styles.publicFooterGrid}>
            <div className={styles.publicFooterBlock}>
              <h3 className={styles.publicFooterTitle}>CivicAI</h3>
              <p className={styles.publicFooterText}>
                A civic complaint reporting platform for local issue visibility
                and structured citizen reporting.
              </p>
            </div>

            <div className={styles.publicFooterBlock}>
              <h3 className={styles.publicFooterTitle}>Platform</h3>
              <div className={styles.publicFooterLinks}>
                <Link href="/">Home</Link>
                <Link href="/report">Report a problem</Link>
                <Link href="/login">Sign in / Register</Link>
              </div>
            </div>

            <div className={styles.publicFooterBlock}>
              <h3 className={styles.publicFooterTitle}>Information</h3>
              <div className={styles.publicFooterLinks}>
                <Link href="#how-it-works">How it works</Link>
                <Link href="#categories">Issue categories</Link>
                <Link href="#guidance">Reporting guidance</Link>
              </div>
            </div>

            <div className={styles.publicFooterBlock}>
              <h3 className={styles.publicFooterTitle}>Authority</h3>
              <div className={styles.publicFooterLinks}>
                <Link href="/login">Authority sign in</Link>
                <Link href="/authority">Complaint review workspace</Link>
              </div>
            </div>
          </div>

          <div className={styles.publicFooterBottom}>
            © CivicAI — Civic complaint reporting platform
          </div>
        </div>
      </footer>
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
            <p className={styles.dashboardStatLabel}>Categories</p>
            <h2 className={styles.dashboardStatValueSmall}>
              {ISSUE_CATEGORIES.length} supported
            </h2>
            <p className={styles.dashboardStatSubtext}>
              Complaint categories available in the reporting system
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
        <div className={styles.loggedSectionHeaderRow}>
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
                        <p className={styles.complaintNoteDark}>
                          {getComplaintNote(item.status)}
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

              {!isAuthority ? (
                <Link href="/my-reports" className={styles.sidebarLink}>
                  My Reports
                </Link>
              ) : null}

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
  else if (value.includes("progress") || value.includes("processing")) {
    className = styles.badgeProgress;
  } else if (value.includes("resolved") || value.includes("completed")) {
    className = styles.badgeResolved;
  } else if (value.includes("submitted")) {
    className = styles.badgeNeutral;
  }

  return <span className={`${styles.badge} ${className}`}>{label}</span>;
}

function getComplaintNote(status: string | null) {
  const value = (status ?? "").toLowerCase();

  if (value.includes("resolved") || value.includes("completed")) {
    return "Complaint record marked as resolved.";
  }

  if (value.includes("processing") || value.includes("progress")) {
    return "Complaint is currently under review.";
  }

  if (value.includes("rejected")) {
    return "Complaint record was marked as rejected.";
  }

  return "Recent local issue report submitted to the platform.";
}