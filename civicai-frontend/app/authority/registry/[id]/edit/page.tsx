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

type EditOfficePageProps = {
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

async function updateOfficeAction(formData: FormData) {
    "use server";

    const officeId = String(formData.get("officeId") ?? "").trim();

    if (!officeId) {
        redirect("/authority/registry");
    }

    const serviceAreaName = String(formData.get("serviceAreaName") ?? "").trim();
    const division = String(formData.get("division") ?? "").trim();
    const district = String(formData.get("district") ?? "").trim();
    const authorityBodyType = String(formData.get("authorityBodyType") ?? "").trim();
    const coverageLevel = String(formData.get("coverageLevel") ?? "").trim();
    const verificationNote = String(formData.get("verificationNote") ?? "").trim();

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
        redirect(`/login?next=/authority/registry/${officeId}/edit`);
    }

    const { data: profile } = await supabase
        .from("profiles")
        .select("role, is_verified")
        .eq("id", user.id)
        .single();

    if (!profile?.is_verified) {
        redirect(`/login?next=/authority/registry/${officeId}/edit&verify=1`);
    }

    if (profile.role !== "admin") {
        redirect("/");
    }

    const { error } = await supabase.rpc("update_authority_office_details", {
        p_office_id: officeId,
        p_service_area_name: serviceAreaName,
        p_division: division,
        p_district: district,
        p_authority_body_type: authorityBodyType,
        p_coverage_level: coverageLevel,
        p_verification_note: verificationNote,
    });

    if (error) {
        console.error("Update office error:", error.message);
        redirect(`/authority/registry/${officeId}/edit?error=1`);
    }

    redirect(`/authority/registry/${officeId}`);
}

export default async function EditOfficePage({
    params,
    searchParams,
}: EditOfficePageProps) {
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
        redirect(`/login?next=/authority/registry/${id}/edit`);
    }

    const { data: profile } = await supabase
        .from("profiles")
        .select("role, is_verified")
        .eq("id", user.id)
        .single();

    if (!profile?.is_verified) {
        redirect(`/login?next=/authority/registry/${id}/edit&verify=1`);
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

    return (
        <main className={styles.page}>
            <MobileUserMenu active="authority-registry" role="admin" />
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
                                    <p className={styles.eyebrow}>Edit service desk</p>
                                    <h1 className={styles.title}>{office.office_name}</h1>
                                    <p className={styles.subtitle}>
                                        Update safe registry details for this service desk. The
                                        office name and system office type are locked to prevent
                                        routing mismatch or duplicate service-desk creation.
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
                                    <h2 className={styles.panelTitle}>Editable registry details</h2>

                                    <div className={styles.panelBody}>
                                        {hasError ? (
                                            <div className={styles.alertBox}>
                                                Failed to update this service desk. Please check the
                                                entered values and your authority permission, then try
                                                again.
                                            </div>
                                        ) : null}

                                        <div className={styles.infoBox}>
                                            <p className={styles.kvLabel}>Locked routing fields</p>
                                            <p className={styles.kvValue}>
                                                Office name and office type are shown below but cannot
                                                be edited here because the routing function depends on
                                                stable service-desk names.
                                            </p>
                                        </div>

                                        <div className={styles.kvGrid}>
                                            <div className={styles.kvBlock}>
                                                <p className={styles.kvLabel}>Office name</p>
                                                <p className={styles.kvValue}>{office.office_name}</p>
                                            </div>

                                            <div className={styles.kvBlock}>
                                                <p className={styles.kvLabel}>System office type</p>
                                                <p className={styles.kvValue}>
                                                    {humanizeValue(office.office_type)}
                                                </p>
                                            </div>

                                            <div className={styles.kvBlock}>
                                                <p className={styles.kvLabel}>Current status</p>
                                                <p className={styles.kvValue}>
                                                    {getStatusLabel(office)}
                                                </p>
                                            </div>

                                            <div className={styles.kvBlock}>
                                                <p className={styles.kvLabel}>Last updated</p>
                                                <p className={styles.kvValue}>
                                                    {formatDate(office.updated_at)}
                                                </p>
                                            </div>
                                        </div>

                                        <form action={updateOfficeAction} className={styles.formGrid}>
                                            <input type="hidden" name="officeId" value={office.id} />

                                            <div>
                                                <label className={styles.label} htmlFor="serviceAreaName">
                                                    Service area name
                                                </label>
                                                <input
                                                    id="serviceAreaName"
                                                    name="serviceAreaName"
                                                    className={styles.input}
                                                    defaultValue={office.service_area_name ?? ""}
                                                    placeholder="Example: Dhaka North"
                                                />
                                            </div>

                                            <div>
                                                <label className={styles.label} htmlFor="division">
                                                    Division
                                                </label>
                                                <input
                                                    id="division"
                                                    name="division"
                                                    className={styles.input}
                                                    defaultValue={office.division ?? ""}
                                                    placeholder="Example: Dhaka"
                                                />
                                            </div>

                                            <div>
                                                <label className={styles.label} htmlFor="district">
                                                    District
                                                </label>
                                                <input
                                                    id="district"
                                                    name="district"
                                                    className={styles.input}
                                                    defaultValue={office.district ?? ""}
                                                    placeholder="Example: Dhaka"
                                                />
                                            </div>

                                            <div>
                                                <label className={styles.label} htmlFor="authorityBodyType">
                                                    Authority body type
                                                </label>
                                                <select
                                                    id="authorityBodyType"
                                                    name="authorityBodyType"
                                                    className={styles.input}
                                                    defaultValue={
                                                        office.authority_body_type ?? "local_authority_service_desk"
                                                    }
                                                >
                                                    <option value="city_corporation">
                                                        City corporation
                                                    </option>
                                                    <option value="local_authority_service_desk">
                                                        Local authority
                                                    </option>
                                                    <option value="local_government">
                                                        Local government
                                                    </option>
                                                </select>
                                            </div>

                                            <div>
                                                <label className={styles.label} htmlFor="coverageLevel">
                                                    Coverage level
                                                </label>
                                                <select
                                                    id="coverageLevel"
                                                    name="coverageLevel"
                                                    className={styles.input}
                                                    defaultValue={office.coverage_level ?? "district"}
                                                >
                                                    <option value="district">District</option>
                                                    <option value="city_corporation">
                                                        City corporation
                                                    </option>
                                                    <option value="upazila">Upazila</option>
                                                    <option value="union">Union</option>
                                                </select>
                                            </div>

                                            <div>
                                                <label className={styles.label} htmlFor="verificationNote">
                                                    Registry / verification note
                                                </label>
                                                <textarea
                                                    id="verificationNote"
                                                    name="verificationNote"
                                                    className={styles.textarea}
                                                    defaultValue={office.verification_note ?? ""}
                                                    placeholder="Add a short note explaining this office setup or verification status."
                                                />
                                            </div>

                                            <div className={styles.buttonGrid}>
                                                <button type="submit" className={styles.primaryButton}>
                                                    Save changes
                                                </button>

                                                <Link
                                                    href={`/authority/registry/${office.id}`}
                                                    className={styles.secondaryLink}
                                                >
                                                    Cancel
                                                </Link>
                                            </div>
                                        </form>
                                    </div>
                                </article>
                            </div>

                            <div className={styles.rightColumn}>
                                <article className={`${styles.panel} ${styles.actionPanel}`}>
                                    <h2 className={styles.panelTitle}>Office summary</h2>

                                    <div className={styles.panelBody}>
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
                                            <p className={styles.kvLabel}>Office ID</p>
                                            <p className={styles.kvValue}>{office.id}</p>
                                        </div>
                                    </div>
                                </article>

                                <article className={styles.panel}>
                                    <h2 className={styles.panelTitle}>Editing guidance</h2>

                                    <div className={styles.panelBody}>
                                        <div className={styles.infoBox}>
                                            <p className={styles.kvLabel}>When to edit</p>
                                            <p className={styles.kvValue}>
                                                Use this page for correcting area, district, authority
                                                type, coverage level, or registry notes.
                                            </p>
                                        </div>

                                        <div className={styles.warningBox}>
                                            <p className={styles.kvLabel}>When not to edit</p>
                                            <p className={styles.kvValue}>
                                                Do not use this page to verify an authority account.
                                                Verification should happen later through the authority
                                                registration and approval workflow.
                                            </p>
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