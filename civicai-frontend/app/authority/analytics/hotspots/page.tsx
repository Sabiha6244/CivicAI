import { redirect } from "next/navigation";
import Link from "next/link";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import styles from "../../authority.module.css";
import HotspotMapShell from "./HotspotMapShell";

type ComplaintRow = {
    id: string;
    title: string | null;
    district: string | null;
    upazila: string | null;
    city_area: string | null;
    address_label: string | null;
    status: string;
    created_at: string;
    user_category: string | null;
    final_category: string | null;
    lat: number | null;
    lng: number | null;
};

type RankedItem = {
    label: string;
    count: number;
    share: number;
};

function getAreaName(complaint: ComplaintRow) {
    return (
        complaint.city_area ||
        complaint.upazila ||
        complaint.district ||
        complaint.address_label ||
        "Unknown"
    );
}

function countMapToSortedList(
    map: Map<string, number>,
    total: number,
    limit = 10
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

function buildComplaintsHref({ area }: { area?: string }) {
    const search = new URLSearchParams();
    search.set("source", "analytics");
    if (area) search.set("area", area);
    return `/authority/complaints?${search.toString()}`;
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

export default async function AuthorityAnalyticsHotspotsPage() {
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
        redirect("/login?next=/authority/analytics/hotspots");
    }

    const { data: profile } = await supabase
        .from("profiles")
        .select("role, is_verified")
        .eq("id", user.id)
        .single();

    if (!profile?.is_verified) {
        redirect("/login?next=/authority/analytics/hotspots&verify=1");
    }

    if (profile.role !== "authority") {
        redirect("/");
    }

    const { data: complaintsData, error } = await supabase
        .from("complaints")
        .select(`
      id,
      title,
      district,
      upazila,
      city_area,
      address_label,
      status,
      created_at,
      user_category,
      final_category,
      lat,
      lng
    `)
        .not("lat", "is", null)
        .not("lng", "is", null)
        .order("created_at", { ascending: false });

    if (error) {
        return (
            <main className={styles.page}>
                <div className={styles.wrapper}>
                    <div className={styles.alertBox}>
                        Failed to load hotspot map data: {error.message}
                    </div>
                </div>
            </main>
        );
    }

    const complaints = (complaintsData ?? []) as ComplaintRow[];
    const totalMappedComplaints = complaints.length;

    const grouped = new Map<
        string,
        {
            lat: number;
            lng: number;
            count: number;
            area: string;
            category: string;
            sampleTitle: string;
        }
    >();

    const areaCounts = new Map<string, number>();

    for (const complaint of complaints) {
        if (complaint.lat == null || complaint.lng == null) continue;

        const area = getAreaName(complaint);
        const category =
            complaint.final_category || complaint.user_category || "Uncategorized";

        areaCounts.set(area, (areaCounts.get(area) ?? 0) + 1);

        const key = `${complaint.lat.toFixed(4)}:${complaint.lng.toFixed(4)}`;
        const existing = grouped.get(key);

        if (existing) {
            existing.count += 1;
        } else {
            grouped.set(key, {
                lat: complaint.lat,
                lng: complaint.lng,
                count: 1,
                area,
                category,
                sampleTitle: complaint.title || "Untitled complaint",
            });
        }
    }

    const points = Array.from(grouped.values())
        .sort((a, b) => b.count - a.count)
        .map((item, index) => ({
            id: `${item.area}-${index}`,
            lat: item.lat,
            lng: item.lng,
            count: item.count,
            area: item.area,
            category: item.category,
            sampleTitle: item.sampleTitle,
        }));

    const topAreas = countMapToSortedList(areaCounts, totalMappedComplaints, 6);
    const uniqueHotspotPoints = points.length;
    const strongestHotspot = points[0]?.count ?? 0;
    const strongestArea = points[0]?.area ?? "N/A";

    return (
        <main className={styles.page}>
            <div className={styles.wrapper}>
                <section className={styles.pageGrid}>
                    <aside className={styles.sidebar}>
                        <div className={styles.sidebarCard}>
                            <p className={styles.sidebarEyebrow}>Authority workspace</p>
                            <h2 className={styles.sidebarTitle}>Hotspot map</h2>
                            <p className={styles.sidebarText}>
                                View a real interactive heatmap of complaint locations using a free
                                map layer and complaint coordinate data.
                            </p>

                            <nav className={styles.sidebarNav}>
                                <Link href="/" className={styles.sidebarLink}>
                                    Back to homepage
                                </Link>
                                <Link href="/authority" className={styles.sidebarLink}>
                                    Authority dashboard
                                </Link>
                                <Link href="/authority/complaints" className={styles.sidebarLink}>
                                    Manage complaints
                                </Link>
                                <Link href="/authority/analytics" className={styles.sidebarLink}>
                                    Authority analytics
                                </Link>
                                <Link
                                    href="/authority/analytics/hotspots"
                                    className={styles.sidebarLinkActive}
                                >
                                    Hotspot map
                                </Link>
                            </nav>
                        </div>
                    </aside>

                    <div className={styles.mainContent}>
                        <section className={styles.hero}>
                            <p className={styles.eyebrow}>Interactive hotspot workspace</p>
                            <h1 className={styles.title}>Real complaint heatmap</h1>
                            <p className={styles.subtitle}>
                                This page shows a real interactive map heat layer built from complaint
                                latitude and longitude values. Zoom and pan to inspect local complaint
                                clusters.
                            </p>

                            <div className={styles.statStrip}>
                                <MetricCard
                                    label="Mapped complaints"
                                    value={totalMappedComplaints}
                                    text="Complaints that currently have usable coordinates."
                                />
                                <MetricCard
                                    label="Hotspot points"
                                    value={uniqueHotspotPoints}
                                    text="Grouped map points contributing to the heat layer."
                                />
                                <MetricCard
                                    label="Strongest hotspot"
                                    value={strongestHotspot}
                                    text={`Largest grouped hotspot currently centered near ${strongestArea}.`}
                                />
                                <MetricCard
                                    label="Back to analytics"
                                    value="Overview"
                                    text="Return to the broader analytics page."
                                    href="/authority/analytics"
                                />
                            </div>
                        </section>

                        <section className={styles.section}>
                            <div className={styles.sectionHeader}>
                                <div>
                                    <h2 className={styles.sectionTitle}>Map heat layer</h2>
                                    <p className={styles.sectionText}>
                                        Use the real map below to inspect hotspot concentration.
                                        Permanent labels show the nearby area name for each grouped point.
                                    </p>
                                </div>

                                <div className={styles.complaintsFilterActions}>
                                    <Link href="/authority/analytics" className={styles.secondaryLink}>
                                        Back to analytics
                                    </Link>
                                    <Link href="/authority/complaints" className={styles.primaryLink}>
                                        Manage complaints
                                    </Link>
                                </div>
                            </div>

                            <HotspotMapShell points={points} />
                        </section>

                        <section className={styles.section}>
                            <div className={styles.sectionHeader}>
                                <div>
                                    <h2 className={styles.sectionTitle}>Most affected areas</h2>
                                    <p className={styles.sectionText}>
                                        Click a card to open the complaints queue filtered to that area.
                                    </p>
                                </div>
                            </div>

                            <div className={styles.statStrip}>
                                {topAreas.map((item) => (
                                    <MetricCard
                                        key={item.label}
                                        label={item.label}
                                        value={item.count}
                                        text={`${item.share.toFixed(1)}% of mapped complaints`}
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
