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

export default async function HomePage() {
  const supabase = await createClient();

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
    .limit(6);

  const recentComplaints: ComplaintRow[] = complaints ?? [];

  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <div className={styles.container}>
          <header className={styles.topbar}>
            <div>
              <div className={styles.brand}>CivicAI</div>
              <div className={styles.brandSub}>
                Report and track local civic issues
              </div>
            </div>

            <div className={styles.topbarActions}>
              <Link href="/login" className={styles.navButtonSecondary}>
                Sign in / Register
              </Link>
              <Link href="/report" className={styles.navButtonPrimary}>
                Report a problem
              </Link>
              <LogoutButton />
            </div>
          </header>

          <div className={styles.heroGrid}>
            <div className={styles.heroContent}>
              <p className={styles.eyebrow}>Community reporting platform</p>
              <h1 className={styles.heroTitle}>
                Help improve your area by reporting problems that matter.
              </h1>
              <p className={styles.heroText}>
                CivicAI allows residents to report civic complaints, follow
                progress, and stay informed about recent issues in their
                community through a simple public-facing platform.
              </p>

              <div className={styles.heroActions}>
                <Link href="/report" className={styles.heroPrimary}>
                  Report a complaint
                </Link>
                <Link href="/login" className={styles.heroSecondary}>
                  Create an account
                </Link>
              </div>
            </div>

            <div className={styles.heroPanel}>
              <div className={styles.statCard}>
                <div className={styles.statValue}>{recentComplaints.length}</div>
                <div className={styles.statLabel}>Recent public complaints shown</div>
              </div>

              <div className={styles.infoCard}>
                <h2 className={styles.infoTitle}>How it works</h2>
                <ol className={styles.infoList}>
                  <li>Read public complaint activity on the homepage.</li>
                  <li>Create an account and verify your email.</li>
                  <li>Submit complaints and track their status.</li>
                </ol>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className={styles.featuresSection}>
        <div className={styles.container}>
          <div className={styles.sectionHeader}>
            <p className={styles.sectionEyebrow}>Platform features</p>
            <h2 className={styles.sectionTitle}>Designed for citizens and transparency</h2>
            <p className={styles.sectionText}>
              The homepage is public so visitors can understand the platform,
              review recent complaint activity, and decide whether to sign in to
              report an issue.
            </p>
          </div>

          <div className={styles.featureGrid}>
            <div className={styles.featureCard}>
              <h3 className={styles.featureTitle}>Public visibility</h3>
              <p className={styles.featureText}>
                Visitors can view recent complaints and understand the purpose of
                the platform before creating an account.
              </p>
            </div>

            <div className={styles.featureCard}>
              <h3 className={styles.featureTitle}>Verified reporting</h3>
              <p className={styles.featureText}>
                Users register with email verification before reporting
                complaints, helping keep submissions accountable.
              </p>
            </div>

            <div className={styles.featureCard}>
              <h3 className={styles.featureTitle}>Complaint tracking</h3>
              <p className={styles.featureText}>
                Reported issues can be reviewed with status information and
                location-related details for better follow-up.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className={styles.complaintsSection}>
        <div className={styles.container}>
          <div className={styles.sectionHeaderRow}>
            <div>
              <p className={styles.sectionEyebrow}>Recent activity</p>
              <h2 className={styles.sectionTitle}>Latest public complaints</h2>
            </div>
            <Link href="/report" className={styles.inlineAction}>
              Report a new issue
            </Link>
          </div>

          {error ? (
            <div className={styles.alertBox}>
              Unable to load recent complaints: <b>{error.message}</b>
            </div>
          ) : recentComplaints.length === 0 ? (
            <div className={styles.emptyBox}>
              No public complaints are available yet.
            </div>
          ) : (
            <div className={styles.complaintList}>
              {recentComplaints.map((item) => {
                const imageUrl =
                  item.complaint_media?.find((media) => !!media.public_url)?.public_url ?? null;

                return (
                  <article key={item.id} className={styles.complaintCard}>
                    <div className={styles.complaintTop}>
                      <div className={styles.complaintMain}>
                        <h3 className={styles.complaintTitle}>
                          {item.title?.trim() || "Untitled complaint"}
                        </h3>

                        <div className={styles.metaRow}>
                          <span className={styles.metaItem}>
                            {item.address_label?.trim() || "Location not specified"}
                          </span>
                          <span className={styles.metaDot}>•</span>
                          <span className={styles.metaItem}>
                            {new Date(item.created_at).toLocaleString()}
                          </span>
                        </div>
                      </div>

                      <StatusBadge label={item.status ?? "unknown"} />
                    </div>

                    <div className={styles.complaintBody}>
                      {imageUrl ? (
  <div className={styles.complaintImageWrap}>
    <ImageLightbox
      src={imageUrl}
      alt={item.title?.trim() || "Complaint image"}
    />
  </div>
) : null}

                      <div className={styles.complaintTextCol}>
                        {(item.lat !== null && item.lng !== null) && (
                          <p className={styles.coords}>
                            Coordinates: {item.lat}, {item.lng}
                          </p>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </section>
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