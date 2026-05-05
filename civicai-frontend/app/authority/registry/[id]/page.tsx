import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import styles from "../../authority.module.css";
import MobileUserMenu from "../../../components/MobileUserMenu";

type AuthorityOfficeRow = {
    id: string;
    office_name: string;
    office_type: string | null;
    authority_body_type: string | null;
    service_area_name: string | null;
    division: string | null;
    district: string | null;
    upazila: string | null;
    city_area: string | null;
    union_name: string | null;
    coverage_level: string | null;
    is_active: boolean | null;
    created_by_system: boolean | null;
    is_verified_office: boolean | null;
    verification_status: string | null;
    verification_note: string | null;
    created_at: string;
    updated_at: string | null;
};

type ComplaintRow = {
    id: string;
    title: string | null;
    status: string;
    created_at: string;
    user_category: string | null;
    final_category: string | null;
    district: string | null;
    upazila: string | null;
    city_area: string | null;
};

type RegistryDetailPageProps = {
    params: Promise<{
        id: string;
    }>;
};

function formatDate(value?: string | null) {
    if (!value) return "Not available";

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

function humanizeValue(value?: string | null) {
    if (!value) return "Not available";

    return value
        .replace(/[_-]+/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/\b\w/g, (match) => match.toUpperCase());
}

function getDeskTypeLabel(office: AuthorityOfficeRow) {
    const name = office.office_name.toLowerCase();
    const bodyType = office.authority_body_type?.toLowerCase() ?? "";

    if (name.includes("city corporation") || bodyType.includes("city")) {
        return "City corporation";
    }

    return "Local authority";
}

function getDisplayOfficeName(office: AuthorityOfficeRow) {
    const rawName = office.office_name?.trim() || "Unnamed office";
    const lowerName = rawName.toLowerCase();

    if (lowerName.includes("dhaka city corporation service desk")) {
        return "Dhaka Metropolitan Service Desk";
    }

    return rawName;
}

function getAreaLabel(office: AuthorityOfficeRow) {
    return (
        office.service_area_name ||
        office.city_area ||
        office.upazila ||
        office.district ||
        office.division ||
        "Not available"
    );
}

function getComplaintArea(complaint: ComplaintRow) {
    return (
        [complaint.city_area, complaint.upazila, complaint.district]
            .filter(Boolean)
            .join(", ") || "Area not available"
    );
}

function getComplaintCategory(complaint: ComplaintRow) {
    return complaint.final_category || complaint.user_category || "Uncategorized";
}

function getStatusLabel(office: AuthorityOfficeRow) {
    if (office.is_active === false || office.verification_status === "inactive") {
        return "Inactive";
    }

    if (office.verification_status === "verified" && office.is_verified_office) {
        return "Verified";
    }

    if (office.verification_status === "provisional") {
        return "Provisional";
    }

    if (office.verification_status === "rejected") {
        return "Rejected";
    }

    return "Pending setup";
}

function getStatusClass(office: AuthorityOfficeRow) {
    if (office.is_active === false || office.verification_status === "inactive") {
        return styles.registryBadgeMuted;
    }

    if (office.verification_status === "verified" && office.is_verified_office) {
        return styles.registryBadgeSuccess;
    }

    if (office.verification_status === "provisional") {
        return styles.registryBadgeInfo;
    }

    if (office.verification_status === "rejected") {
        return styles.registryBadgeDanger;
    }

    return styles.registryBadgeWarning;
}

function complaintStatusClass(status: string) {
    switch (status) {
        case "submitted":
            return styles.badgeSubmitted;
        case "processing":
            return styles.badgeProcessing;
        case "resolved":
        case "completed":
            return styles.badgeResolved;
        case "rejected":
            return styles.badgeRejected;
        default:
            return styles.badge;
    }
}

export default async function RegistryOfficeDetailPage({
    params,
}: RegistryDetailPageProps) {
    const { id } = await params;
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
        redirect(`/login?next=/authority/registry/${id}`);
    }

    const { data: profile } = await supabase
        .from("profiles")
        .select("role, is_verified")
        .eq("id", user.id)
        .single();

    if (!profile?.is_verified) {
        redirect(`/login?next=/authority/registry/${id}&verify=1`);
    }

    if (profile.role !== "admin") {
        redirect("/");
    }

    const { data: officeData, error: officeError } = await supabase
        .from("authority_offices")
        .select(`
      id,
      office_name,
      office_type,
      authority_body_type,
      service_area_name,
      division,
      district,
      upazila,
      city_area,
      union_name,
      coverage_level,
      is_active,
      created_by_system,
      is_verified_office,
      verification_status,
      verification_note,
      created_at,
      updated_at
    `)
        .eq("id", id)
        .eq("office_type", "local_authority_service_desk")
        .single();

    if (officeError || !officeData) {
        notFound();
    }

    const office = officeData as AuthorityOfficeRow;

    const [
        { data: recentComplaintsData, count: assignedComplaintsCount },
        { count: linkedUsersCount },
        { count: accessRequestsCount },
    ] = await Promise.all([
        supabase
            .from("complaints")
            .select(
                `
        id,
        title,
        status,
        created_at,
        user_category,
        final_category,
        district,
        upazila,
        city_area
      `,
                { count: "exact" }
            )
            .eq("assigned_office_id", office.id)
            .order("created_at", { ascending: false })
            .limit(6),

        supabase
            .from("authority_office_users")
            .select("id", { count: "exact", head: true })
            .eq("office_id", office.id),

        supabase
            .from("authority_access_requests")
            .select("id", { count: "exact", head: true })
            .eq("requested_office_id", office.id),
    ]);

    const recentComplaints = (recentComplaintsData ?? []) as ComplaintRow[];
    const assignedCount = assignedComplaintsCount ?? 0;
    const linkedCount = linkedUsersCount ?? 0;
    const requestCount = accessRequestsCount ?? 0;

    return (
        <main className={styles.page}>
            <MobileUserMenu active="authority" showAuthority={true} />

            <div className={styles.wrapper}>
                <section className={styles.pageGrid}>
                    <aside className={styles.sidebar}>
                        <div className={styles.sidebarCard}>
                            <p className={styles.sidebarEyebrow}>Authority workspace</p>
                            <h2 className={styles.sidebarTitle}>Registry</h2>
                            <p className={styles.sidebarText}>
                                Review responsible authorities, service desks, and authority
                                access requests from one central workspace.
                            </p>

                            <nav className={styles.sidebarNav}>
                                <Link href="/" className={styles.sidebarLink}>
                                    Back to homepage
                                </Link>

                                <Link href="/authority" className={styles.sidebarLink}>
                                    Authority dashboard
                                </Link>

                                <Link
                                    href="/authority/complaints"
                                    className={styles.sidebarLink}
                                >
                                    Manage complaints
                                </Link>

                                <Link
                                    href="/authority/registry"
                                    className={styles.sidebarLinkActive}
                                >
                                    Authority registry
                                </Link>

                                <Link href="/authority/analytics" className={styles.sidebarLink}>
                                    Open analytics
                                </Link>

                                <Link
                                    href="/authority/analytics/hotspots"
                                    className={styles.sidebarLink}
                                >
                                    View hotspots
                                </Link>
                            </nav>
                        </div>
                    </aside>

                    <div className={styles.mainContent}>
                        <section className={styles.detailHero}>
                            <div className={styles.detailTop}>
                                <div className={styles.detailMetaBlock}>
                                    <p className={styles.eyebrow}>Service desk details</p>

                                    <h1 className={styles.title}>{getDisplayOfficeName(office)}</h1>

                                    <p className={styles.subtitle}>
                                        View this service desk&apos;s coverage, setup status,
                                        linked authority activity, and recently assigned complaints.
                                    </p>

                                    <div className={styles.detailMetaRow}>
                                        <span className={styles.metaPill}>
                                            {getDeskTypeLabel(office)}
                                        </span>

                                        <span
                                            className={`${styles.registryBadge} ${getStatusClass(
                                                office
                                            )}`}
                                        >
                                            {getStatusLabel(office)}
                                        </span>

                                        <span className={styles.metaPill}>
                                            Area: {getAreaLabel(office)}
                                        </span>
                                    </div>
                                </div>

                                <div className={styles.detailActions}>
                                    <Link href="/authority/registry" className={styles.secondaryLink}>
                                        Back to registry
                                    </Link>

                                    <Link
                                        href={`/authority/registry/${office.id}/edit`}
                                        className={styles.primaryLink}
                                    >
                                        Edit office
                                    </Link>

                                    {office.is_active === false || office.verification_status === "inactive" ? (
                                        <Link
                                            href={`/authority/registry/${office.id}/reactivate`}
                                            className={styles.primaryLink}
                                        >
                                            Reactivate
                                        </Link>
                                    ) : (
                                        <Link
                                            href={`/authority/registry/${office.id}/disable`}
                                            className={styles.secondaryLink}
                                        >
                                            Disable
                                        </Link>
                                    )}
                                </div>
                            </div>

                            <div className={styles.statStrip}>
                                <div className={styles.statMiniCard}>
                                    <p className={styles.statMiniLabel}>Assigned complaints</p>
                                    <h3 className={styles.statMiniValue}>{assignedCount}</h3>
                                    <p className={styles.statMiniText}>
                                        Complaints currently routed to this service desk.
                                    </p>
                                </div>

                                <div className={styles.statMiniCard}>
                                    <p className={styles.statMiniLabel}>Linked users</p>
                                    <h3 className={styles.statMiniValue}>{linkedCount}</h3>
                                    <p className={styles.statMiniText}>
                                        Authority users connected to this office.
                                    </p>
                                </div>

                                <div className={styles.statMiniCard}>
                                    <p className={styles.statMiniLabel}>Access requests</p>
                                    <h3 className={styles.statMiniValue}>{requestCount}</h3>
                                    <p className={styles.statMiniText}>
                                        Requests submitted for this service desk.
                                    </p>
                                </div>

                                <div className={styles.statMiniCard}>
                                    <p className={styles.statMiniLabel}>Current status</p>
                                    <h3 className={styles.statMiniValue}>
                                        {getStatusLabel(office)}
                                    </h3>
                                    <p className={styles.statMiniText}>
                                        Verification status for this authority office.
                                    </p>
                                </div>
                            </div>
                        </section>

                        <section className={styles.detailGrid}>
                            <div className={styles.leftColumn}>
                                <article className={styles.panel}>
                                    <h2 className={styles.panelTitle}>Office information</h2>

                                    <div className={styles.panelBody}>
                                        <div className={styles.kvGrid}>
                                            <div className={styles.kvBlock}>
                                                <p className={styles.kvLabel}>Office name</p>
                                                <p className={styles.kvValue}>
                                                    {getDisplayOfficeName(office)}
                                                </p>
                                            </div>

                                            <div className={styles.kvBlock}>
                                                <p className={styles.kvLabel}>Office type</p>
                                                <p className={styles.kvValue}>
                                                    {humanizeValue(office.office_type)}
                                                </p>
                                            </div>

                                            <div className={styles.kvBlock}>
                                                <p className={styles.kvLabel}>Authority body type</p>
                                                <p className={styles.kvValue}>
                                                    {humanizeValue(office.authority_body_type)}
                                                </p>
                                            </div>

                                            <div className={styles.kvBlock}>
                                                <p className={styles.kvLabel}>Service area</p>
                                                <p className={styles.kvValue}>{getAreaLabel(office)}</p>
                                            </div>

                                            <div className={styles.kvBlock}>
                                                <p className={styles.kvLabel}>Division</p>
                                                <p className={styles.kvValue}>
                                                    {office.division || "Not available"}
                                                </p>
                                            </div>

                                            <div className={styles.kvBlock}>
                                                <p className={styles.kvLabel}>District</p>
                                                <p className={styles.kvValue}>
                                                    {office.district || "Not available"}
                                                </p>
                                            </div>

                                            <div className={styles.kvBlock}>
                                                <p className={styles.kvLabel}>Upazila / city area</p>
                                                <p className={styles.kvValue}>
                                                    {[office.city_area, office.upazila]
                                                        .filter(Boolean)
                                                        .join(", ") || "Not available"}
                                                </p>
                                            </div>

                                            <div className={styles.kvBlock}>
                                                <p className={styles.kvLabel}>Coverage level</p>
                                                <p className={styles.kvValue}>
                                                    {humanizeValue(office.coverage_level)}
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                </article>

                                <article className={styles.panel}>
                                    <h2 className={styles.panelTitle}>Recent assigned complaints</h2>

                                    <div className={styles.panelBody}>
                                        {recentComplaints.length === 0 ? (
                                            <div className={styles.emptyBox}>
                                                No complaints are currently assigned to this service
                                                desk.
                                            </div>
                                        ) : (
                                            <div className={styles.dashboardInboxList}>
                                                {recentComplaints.map((complaint) => (
                                                    <Link
                                                        key={complaint.id}
                                                        href={`/authority/${complaint.id}`}
                                                        className={styles.dashboardInboxItem}
                                                    >
                                                        <div className={styles.dashboardInboxItemTop}>
                                                            <h3 className={styles.dashboardInboxItemTitle}>
                                                                {complaint.title || "Untitled complaint"}
                                                            </h3>

                                                            <span className={complaintStatusClass(complaint.status)}>
                                                                {humanizeValue(complaint.status)}
                                                            </span>
                                                        </div>

                                                        <p className={styles.dashboardInboxItemMeta}>
                                                            {getComplaintArea(complaint)} •{" "}
                                                            {getComplaintCategory(complaint)} •{" "}
                                                            {formatDate(complaint.created_at)}
                                                        </p>
                                                    </Link>
                                                ))}
                                            </div>
                                        )}

                                        {assignedCount > recentComplaints.length ? (
                                            <Link
                                                href={`/authority/complaints?office=${office.id}`}
                                                className={styles.secondaryLink}
                                            >
                                                View all assigned complaints
                                            </Link>
                                        ) : null}
                                    </div>
                                </article>
                            </div>

                            <div className={styles.rightColumn}>
                                <article className={`${styles.panel} ${styles.actionPanel}`}>
                                    <h2 className={styles.panelTitle}>Account setup status</h2>

                                    <div className={styles.panelBody}>
                                        <div className={styles.highlightBox}>
                                            <p className={styles.kvLabel}>Current status</p>
                                            <p className={styles.kvValue}>
                                                <span
                                                    className={`${styles.registryBadge} ${getStatusClass(
                                                        office
                                                    )}`}
                                                >
                                                    {getStatusLabel(office)}
                                                </span>
                                            </p>
                                        </div>

                                        <div className={styles.infoBox}>
                                            <p className={styles.kvLabel}>Verification note</p>
                                            <p className={styles.kvValue}>
                                                {office.verification_note ||
                                                    "No verification note has been added yet."}
                                            </p>
                                        </div>

                                        <div className={styles.infoBox}>
                                            <p className={styles.kvLabel}>Linked authority users</p>
                                            <p className={styles.kvValue}>
                                                {linkedCount === 0
                                                    ? "No local authority user is linked to this service desk yet."
                                                    : `${linkedCount} authority user(s) linked to this service desk.`}
                                            </p>
                                        </div>
                                    </div>
                                </article>

                                <article className={styles.panel}>
                                    <h2 className={styles.panelTitle}>Registry metadata</h2>

                                    <div className={styles.panelBody}>
                                        <div className={styles.kvBlock}>
                                            <p className={styles.kvLabel}>Created by system</p>
                                            <p className={styles.kvValue}>
                                                {office.created_by_system ? "Yes" : "No"}
                                            </p>
                                        </div>

                                        <div className={styles.kvBlock}>
                                            <p className={styles.kvLabel}>Created at</p>
                                            <p className={styles.kvValue}>
                                                {formatDate(office.created_at)}
                                            </p>
                                        </div>

                                        <div className={styles.kvBlock}>
                                            <p className={styles.kvLabel}>Last updated</p>
                                            <p className={styles.kvValue}>
                                                {formatDate(office.updated_at)}
                                            </p>
                                        </div>

                                        <div className={styles.kvBlock}>
                                            <p className={styles.kvLabel}>Office ID</p>
                                            <p className={styles.kvValue}>{office.id}</p>
                                        </div>
                                    </div>
                                </article>
                            </div>
                        </section>
                    </div>
                </section>
            </div>
        </main>
    );
}