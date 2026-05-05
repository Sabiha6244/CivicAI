import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import styles from "../../../authority.module.css";
import MobileUserMenu from "../../../../components/MobileUserMenu";

type AuthorityOfficeRow = {
    id: string;
    office_name: string;
    office_type: string | null;
    authority_body_type: string | null;
    service_area_name: string | null;
    division: string | null;
    district: string | null;
    coverage_level: string | null;
    is_active: boolean | null;
    is_verified_office: boolean | null;
    verification_status: string | null;
    verification_note: string | null;
    created_at: string;
    updated_at: string | null;
};

type DisableOfficePageProps = {
    params: Promise<{
        id: string;
    }>;
    searchParams?: Promise<{
        error?: string;
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

function getAreaLabel(office: AuthorityOfficeRow) {
    return (
        office.service_area_name ||
        office.district ||
        office.division ||
        "Not available"
    );
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

async function disableOfficeAction(formData: FormData) {
    "use server";

    const officeId = String(formData.get("officeId") ?? "").trim();

    if (!officeId) {
        redirect("/authority/registry");
    }

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
        redirect(`/login?next=/authority/registry/${officeId}/disable`);
    }

    const { data: profile } = await supabase
        .from("profiles")
        .select("role, is_verified")
        .eq("id", user.id)
        .single();

    if (!profile?.is_verified) {
        redirect(`/login?next=/authority/registry/${officeId}/disable&verify=1`);
    }

    if (profile.role !== "admin") {
        redirect("/");
    }

    const { data: office } = await supabase
        .from("authority_offices")
        .select("id, office_type, office_name")
        .eq("id", officeId)
        .eq("office_type", "local_authority_service_desk")
        .maybeSingle();

    if (!office) {
        redirect("/authority/registry");
    }

    const reason =
        String(formData.get("reason") ?? "").trim() ||
        "Disabled by central authority from the authority registry.";

    const { error } = await supabase.rpc("disable_authority_office", {
        p_office_id: officeId,
        p_note: reason,
    });

    if (error) {
        console.error("Disable office error:", error.message);
        redirect(`/authority/registry/${officeId}/disable?error=1`);
    }

    redirect(`/authority/registry/${officeId}`);
}

export default async function DisableOfficePage({
    params,
    searchParams,
}: DisableOfficePageProps) {
    const { id } = await params;
    const query = await searchParams;
    const hasError = query?.error === "1";
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
        redirect(`/login?next=/authority/registry/${id}/disable`);
    }

    const { data: profile } = await supabase
        .from("profiles")
        .select("role, is_verified")
        .eq("id", user.id)
        .single();

    if (!profile?.is_verified) {
        redirect(`/login?next=/authority/registry/${id}/disable&verify=1`);
    }

    if (profile.role !== "authority" && profile.role !== "admin") {
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
      coverage_level,
      is_active,
      is_verified_office,
      verification_status,
      verification_note,
      created_at,
      updated_at
    `)
        .eq("id", id)
        .eq("office_type", "local_authority_service_desk")
        .maybeSingle();

    if (officeError || !officeData) {
        notFound();
    }

    const office = officeData as AuthorityOfficeRow;

    const [
        { count: assignedComplaintsCount },
        { count: linkedUsersCount },
        { count: accessRequestsCount },
    ] = await Promise.all([
        supabase
            .from("complaints")
            .select("id", { count: "exact", head: true })
            .eq("assigned_office_id", office.id),

        supabase
            .from("authority_office_users")
            .select("id", { count: "exact", head: true })
            .eq("office_id", office.id),

        supabase
            .from("authority_access_requests")
            .select("id", { count: "exact", head: true })
            .eq("requested_office_id", office.id),
    ]);

    const assignedCount = assignedComplaintsCount ?? 0;
    const linkedCount = linkedUsersCount ?? 0;
    const requestCount = accessRequestsCount ?? 0;
    const alreadyInactive =
        office.is_active === false || office.verification_status === "inactive";

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
                                    <p className={styles.eyebrow}>Disable service desk</p>
                                    <h1 className={styles.title}>{office.office_name}</h1>
                                    <p className={styles.subtitle}>
                                        Disable this service desk when it should no longer be used
                                        for authority assignment. Existing complaint history will
                                        remain linked for record keeping.
                                    </p>

                                    <div className={styles.detailMetaRow}>
                                        <span className={styles.metaPill}>
                                            {getDeskTypeLabel(office)}
                                        </span>

                                        <span className={styles.metaPill}>
                                            Area: {getAreaLabel(office)}
                                        </span>

                                        <span className={styles.metaPill}>
                                            Status: {getStatusLabel(office)}
                                        </span>
                                    </div>
                                </div>

                                <div className={styles.detailActions}>
                                    <Link
                                        href={`/authority/registry/${office.id}`}
                                        className={styles.secondaryLink}
                                    >
                                        Cancel
                                    </Link>

                                    <Link href="/authority/registry" className={styles.secondaryLink}>
                                        Back to registry
                                    </Link>
                                </div>
                            </div>
                        </section>

                        <section className={styles.detailGrid}>
                            <div className={styles.leftColumn}>
                                <article className={styles.panel}>
                                    <h2 className={styles.panelTitle}>Disable confirmation</h2>

                                    <div className={styles.panelBody}>
                                        {hasError ? (
                                            <div className={styles.alertBox}>
                                                Failed to disable this service desk. Please check the database function and
                                                your authority permission, then try again.
                                            </div>
                                        ) : null}
                                        {alreadyInactive ? (
                                            <div className={styles.infoBox}>
                                                <p className={styles.kvLabel}>Already inactive</p>
                                                <p className={styles.kvValue}>
                                                    This service desk is already inactive. No further
                                                    disable action is needed.
                                                </p>
                                            </div>
                                        ) : (
                                            <div className={styles.warningBox}>
                                                <p className={styles.kvLabel}>Important warning</p>
                                                <p className={styles.kvValue}>
                                                    This will mark the service desk as inactive and remove
                                                    its verified status. It will not delete old complaint
                                                    history, linked records, or previous routing
                                                    references.
                                                </p>
                                            </div>
                                        )}

                                        <div className={styles.kvGrid}>
                                            <div className={styles.kvBlock}>
                                                <p className={styles.kvLabel}>Assigned complaints</p>
                                                <p className={styles.kvValue}>{assignedCount}</p>
                                            </div>

                                            <div className={styles.kvBlock}>
                                                <p className={styles.kvLabel}>Linked authority users</p>
                                                <p className={styles.kvValue}>{linkedCount}</p>
                                            </div>

                                            <div className={styles.kvBlock}>
                                                <p className={styles.kvLabel}>Access requests</p>
                                                <p className={styles.kvValue}>{requestCount}</p>
                                            </div>

                                            <div className={styles.kvBlock}>
                                                <p className={styles.kvLabel}>Current status</p>
                                                <p className={styles.kvValue}>
                                                    {humanizeValue(office.verification_status)}
                                                </p>
                                            </div>
                                        </div>

                                        {!alreadyInactive ? (
                                            <form action={disableOfficeAction} className={styles.formGrid}>
                                                <input type="hidden" name="officeId" value={office.id} />

                                                <div>
                                                    <label className={styles.label} htmlFor="reason">
                                                        Disable reason / note
                                                    </label>
                                                    <textarea
                                                        id="reason"
                                                        name="reason"
                                                        className={styles.textarea}
                                                        defaultValue={`Disabled by central authority. This office should not receive new complaint routing until it is reviewed again.`}
                                                    />
                                                </div>

                                                <div className={styles.buttonGrid}>
                                                    <button type="submit" className={styles.darkButton}>
                                                        Confirm disable
                                                    </button>

                                                    <Link
                                                        href={`/authority/registry/${office.id}`}
                                                        className={styles.secondaryLink}
                                                    >
                                                        Keep active
                                                    </Link>
                                                </div>
                                            </form>
                                        ) : (
                                            <Link
                                                href={`/authority/registry/${office.id}`}
                                                className={styles.primaryLink}
                                            >
                                                Return to details
                                            </Link>
                                        )}
                                    </div>
                                </article>
                            </div>

                            <div className={styles.rightColumn}>
                                <article className={`${styles.panel} ${styles.actionPanel}`}>
                                    <h2 className={styles.panelTitle}>Office summary</h2>

                                    <div className={styles.panelBody}>
                                        <div className={styles.kvBlock}>
                                            <p className={styles.kvLabel}>Office name</p>
                                            <p className={styles.kvValue}>{office.office_name}</p>
                                        </div>

                                        <div className={styles.kvBlock}>
                                            <p className={styles.kvLabel}>Service area</p>
                                            <p className={styles.kvValue}>{getAreaLabel(office)}</p>
                                        </div>

                                        <div className={styles.kvBlock}>
                                            <p className={styles.kvLabel}>District</p>
                                            <p className={styles.kvValue}>
                                                {office.district || "Not available"}
                                            </p>
                                        </div>

                                        <div className={styles.kvBlock}>
                                            <p className={styles.kvLabel}>Coverage level</p>
                                            <p className={styles.kvValue}>
                                                {humanizeValue(office.coverage_level)}
                                            </p>
                                        </div>
                                    </div>
                                </article>

                                <article className={styles.panel}>
                                    <h2 className={styles.panelTitle}>Registry metadata</h2>

                                    <div className={styles.panelBody}>
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