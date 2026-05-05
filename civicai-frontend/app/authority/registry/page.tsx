import { redirect } from "next/navigation";
import Link from "next/link";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import styles from "../authority.module.css";
import MobileUserMenu from "../../components/MobileUserMenu";

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
};

type ComplaintOfficeRow = {
    assigned_office_id: string | null;
};

type RequestedOfficeRow = {
    office_name: string | null;
};

type AccessRequestRow = {
    id: string;
    user_id: string;
    requested_office_id: string | null;
    requested_office_name: string | null;
    requested_authority_type: string | null;
    full_name: string | null;
    official_email: string | null;
    designation: string | null;
    phone: string | null;
    request_note: string | null;
    request_status: string;
    review_note: string | null;
    created_at: string;
    requested_office: RequestedOfficeRow | RequestedOfficeRow[] | null;
};

type RegistryPageProps = {
    searchParams?: Promise<{
        q?: string;
        type?: string;
        status?: string;
        page?: string;
        requestError?: string;
    }>;
};

const PAGE_SIZE = 10;

function getStringParam(value?: string | string[]) {
    if (Array.isArray(value)) return value[0] ?? "";
    return value ?? "";
}

function getPageNumber(value?: string) {
    const parsed = Number.parseInt(value || "1", 10);
    if (Number.isNaN(parsed) || parsed < 1) return 1;
    return parsed;
}

function formatDate(value: string) {
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

function requestStatusClass(status: string) {
    switch (status) {
        case "approved":
            return styles.priorityLow;
        case "pending":
            return styles.chipWarn;
        case "rejected":
            return styles.priorityHigh;
        default:
            return styles.chip;
    }
}

function getRequestedOfficeName(value: AccessRequestRow["requested_office"]) {
    if (!value) return null;
    if (Array.isArray(value)) return value[0]?.office_name ?? null;
    return value.office_name;
}

function isServiceDesk(office: AuthorityOfficeRow) {
    return office.office_type === "local_authority_service_desk";
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

function getDeskInitials(office: AuthorityOfficeRow) {
    const label = getDeskTypeLabel(office).toLowerCase();

    if (label.includes("city corporation")) return "CC";
    if (label.includes("local authority")) return "LA";
    return "OF";
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

function getAccountStatusLabel(office: AuthorityOfficeRow) {
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

function getAccountStatusClass(office: AuthorityOfficeRow) {
    if (office.is_active === false || office.verification_status === "inactive") {
        return `${styles.registryBadge} ${styles.registryBadgeMuted}`;
    }

    if (office.verification_status === "verified" && office.is_verified_office) {
        return `${styles.registryBadge} ${styles.registryBadgeSuccess}`;
    }

    if (office.verification_status === "provisional") {
        return `${styles.registryBadge} ${styles.registryBadgeInfo}`;
    }

    if (office.verification_status === "rejected") {
        return `${styles.registryBadge} ${styles.registryBadgeDanger}`;
    }

    return `${styles.registryBadge} ${styles.registryBadgeWarning}`;
}

function officeMatchesSearch(office: AuthorityOfficeRow, query: string) {
    if (!query.trim()) return true;

    const searchableText = [
        office.office_name,
        office.office_type,
        office.authority_body_type,
        office.service_area_name,
        office.division,
        office.district,
        office.upazila,
        office.city_area,
        office.union_name,
        office.verification_status,
    ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

    return searchableText.includes(query.trim().toLowerCase());
}

function officeMatchesType(office: AuthorityOfficeRow, type: string) {
    if (type === "all") return true;

    const label = getDeskTypeLabel(office).toLowerCase();

    if (type === "city") return label.includes("city corporation");
    if (type === "local") return label.includes("local authority");

    return true;
}

function officeMatchesStatus(office: AuthorityOfficeRow, status: string) {
    if (status === "all") return true;

    if (status === "inactive") {
        return office.is_active === false || office.verification_status === "inactive";
    }

    return office.verification_status === status;
}

async function approveAccessRequestAction(formData: FormData) {
    "use server";

    const requestId = String(formData.get("requestId") ?? "").trim();

    if (!requestId) {
        redirect("/authority/registry?requestError=missing_request");
    }

    const reviewNote =
        String(formData.get("reviewNote") ?? "").trim() ||
        "Approved by central authority and linked to the requested service desk.";

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

    const { error } = await supabase.rpc("approve_authority_access_request", {
        p_request_id: requestId,
        p_access_role: "reviewer",
        p_review_note: reviewNote,
    });

    if (error) {
        console.error("Approve authority request error:", error.message);
        redirect("/authority/registry?requestError=approve_failed");
    }

    redirect("/authority/registry");
}

async function rejectAccessRequestAction(formData: FormData) {
    "use server";

    const requestId = String(formData.get("requestId") ?? "").trim();

    if (!requestId) {
        redirect("/authority/registry?requestError=missing_request");
    }

    const reviewNote =
        String(formData.get("reviewNote") ?? "").trim() ||
        "Rejected by central authority.";

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

    const { error } = await supabase.rpc("reject_authority_access_request", {
        p_request_id: requestId,
        p_review_note: reviewNote,
    });

    if (error) {
        console.error("Reject authority request error:", error.message);
        redirect("/authority/registry?requestError=reject_failed");
    }

    redirect("/authority/registry");
}

export default async function AuthorityRegistryPage({
    searchParams,
}: RegistryPageProps) {
    const params = await searchParams;

    const searchQuery = getStringParam(params?.q);
    const typeFilter = getStringParam(params?.type) || "all";
    const statusFilter = getStringParam(params?.status) || "all";
    const requestedPage = getPageNumber(getStringParam(params?.page));
    const requestError = getStringParam(params?.requestError);

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
        redirect("/login?next=/authority/registry");
    }

    const { data: profile } = await supabase
        .from("profiles")
        .select("role, is_verified")
        .eq("id", user.id)
        .single();

    if (!profile?.is_verified) {
        redirect("/login?next=/authority/registry&verify=1");
    }

    if (profile.role !== "admin") {
        redirect("/");
    }

    const [
        { data: officesData, error: officesError },
        { data: requestsData, error: requestsError },
        { data: complaintsData },
    ] = await Promise.all([
        supabase
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
        created_at
      `)
            .eq("office_type", "local_authority_service_desk")
            .order("office_name", { ascending: true }),

        supabase
            .from("authority_access_requests")
            .select(`
        id,
        user_id,
        requested_office_id,
        requested_office_name,
        requested_authority_type,
        full_name,
        official_email,
        designation,
        phone,
        request_note,
        request_status,
        review_note,
        created_at,
        requested_office:authority_offices (
          office_name
        )
      `)
            .order("created_at", { ascending: false }),

        supabase.from("complaints").select("assigned_office_id"),
    ]);

    if (officesError || requestsError) {
        return (
            <main className={styles.page}>
                <MobileUserMenu active="authority" showAuthority={true} />
                <div className={styles.wrapper}>
                    <div className={styles.alertBox}>
                        Failed to load registry data:{" "}
                        {officesError?.message || requestsError?.message}
                    </div>
                </div>
            </main>
        );
    }

    const serviceDesks = (officesData ?? []) as AuthorityOfficeRow[];
    const requests = (requestsData ?? []) as unknown as AccessRequestRow[];
    const complaintOfficeRows = (complaintsData ?? []) as ComplaintOfficeRow[];

    const complaintCountByOffice = new Map<string, number>();

    for (const row of complaintOfficeRows) {
        if (!row.assigned_office_id) continue;

        complaintCountByOffice.set(
            row.assigned_office_id,
            (complaintCountByOffice.get(row.assigned_office_id) ?? 0) + 1
        );
    }

    const cityCorporationDesks = serviceDesks.filter((office) =>
        getDeskTypeLabel(office).toLowerCase().includes("city corporation")
    );

    const localAuthorityDesks = serviceDesks.filter((office) =>
        getDeskTypeLabel(office).toLowerCase().includes("local authority")
    );

    const pendingRequestsCount = requests.filter(
        (item) => item.request_status === "pending"
    ).length;

    const filteredOffices = serviceDesks.filter(
        (office) =>
            officeMatchesSearch(office, searchQuery) &&
            officeMatchesType(office, typeFilter) &&
            officeMatchesStatus(office, statusFilter)
    );

    const totalPages = Math.max(1, Math.ceil(filteredOffices.length / PAGE_SIZE));
    const currentPage = Math.min(requestedPage, totalPages);
    const startIndex = (currentPage - 1) * PAGE_SIZE;
    const paginatedOffices = filteredOffices.slice(
        startIndex,
        startIndex + PAGE_SIZE
    );

    const showingFrom = filteredOffices.length === 0 ? 0 : startIndex + 1;
    const showingTo = Math.min(startIndex + PAGE_SIZE, filteredOffices.length);

    function buildRegistryHref(updates: Record<string, string | number>) {
        const nextParams = new URLSearchParams();

        if (searchQuery) nextParams.set("q", searchQuery);
        if (typeFilter !== "all") nextParams.set("type", typeFilter);
        if (statusFilter !== "all") nextParams.set("status", statusFilter);
        if (currentPage > 1) nextParams.set("page", String(currentPage));

        for (const [key, value] of Object.entries(updates)) {
            if (value === "" || value === "all") {
                nextParams.delete(key);
            } else {
                nextParams.set(key, String(value));
            }
        }

        const query = nextParams.toString();
        return query ? `/authority/registry?${query}` : "/authority/registry";
    }

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
                                access requests.
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
                        <section className={styles.hero}>
                            <p className={styles.eyebrow}>Central authority management</p>
                            <h1 className={styles.title}>
                                Authority Registry & Access Management
                            </h1>
                            <p className={styles.subtitle}>
                                Manage city corporation and local authority service desks, check
                                account setup status, and review authority access requests from
                                one central workspace.
                            </p>

                            <div className={styles.statStrip}>
                                <div className={styles.statMiniCard}>
                                    <p className={styles.statMiniLabel}>City corporation desks</p>
                                    <h3 className={styles.statMiniValue}>
                                        {cityCorporationDesks.length}
                                    </h3>
                                    <p className={styles.statMiniText}>
                                        City corporation-level responsible authority records.
                                    </p>
                                </div>

                                <div className={styles.statMiniCard}>
                                    <p className={styles.statMiniLabel}>Local authority desks</p>
                                    <h3 className={styles.statMiniValue}>
                                        {localAuthorityDesks.length}
                                    </h3>
                                    <p className={styles.statMiniText}>
                                        District or local government responsible authority records.
                                    </p>
                                </div>

                                <div className={styles.statMiniCard}>
                                    <p className={styles.statMiniLabel}>Pending requests</p>
                                    <h3 className={styles.statMiniValue}>
                                        {pendingRequestsCount}
                                    </h3>
                                    <p className={styles.statMiniText}>
                                        Authority access requests waiting for review.
                                    </p>
                                </div>
                            </div>
                        </section>

                        <section className={styles.section}>
                            <div className={styles.sectionHeader}>
                                <div>
                                    <h2 className={styles.sectionTitle}>
                                        Responsible authority service desks
                                    </h2>
                                    <p className={styles.sectionText}>
                                        Only main city corporation and local authority service desks
                                        are shown here. Category-wise routing offices have been
                                        removed from the registry.
                                    </p>
                                </div>

                                <Link
                                    href="/authority/registry/new"
                                    className={styles.registryAddButton}
                                >
                                    + Add service desk
                                </Link>
                            </div>

                            <div className={styles.registryBanner}>
                                <div className={styles.registryBannerIcon}>!</div>
                                <p className={styles.registryBannerText}>
                                    <strong>Current rule:</strong> every office remains{" "}
                                    <strong>Pending setup</strong> until a real authority user
                                    account is connected and verified.
                                </p>
                            </div>

                            <form className={styles.registryFilterForm}>
                                <div className={styles.registryFilterGridCompact}>
                                    <div>
                                        <label className={styles.label} htmlFor="q">
                                            Search by office, area, or district
                                        </label>
                                        <input
                                            id="q"
                                            name="q"
                                            defaultValue={searchQuery}
                                            className={styles.input}
                                            placeholder="Example: Dhaka, Barishal, Narayanganj..."
                                        />
                                    </div>

                                    <div>
                                        <label className={styles.label} htmlFor="type">
                                            Office type
                                        </label>
                                        <select
                                            id="type"
                                            name="type"
                                            defaultValue={typeFilter}
                                            className={styles.input}
                                        >
                                            <option value="all">All types</option>
                                            <option value="city">City corporation</option>
                                            <option value="local">Local authority</option>
                                        </select>
                                    </div>

                                    <div>
                                        <label className={styles.label} htmlFor="status">
                                            Account status
                                        </label>
                                        <select
                                            id="status"
                                            name="status"
                                            defaultValue={statusFilter}
                                            className={styles.input}
                                        >
                                            <option value="all">All statuses</option>
                                            <option value="pending">Pending setup</option>
                                            <option value="provisional">Provisional</option>
                                            <option value="verified">Verified</option>
                                            <option value="rejected">Rejected</option>
                                            <option value="inactive">Inactive</option>
                                        </select>
                                    </div>
                                </div>

                                <input type="hidden" name="page" value="1" />

                                <div className={styles.registryFilterActions}>
                                    <button type="submit" className={styles.primaryButton}>
                                        Search registry
                                    </button>

                                    <Link
                                        href="/authority/registry"
                                        className={styles.secondaryLink}
                                    >
                                        Reset filters
                                    </Link>
                                </div>
                            </form>

                            {paginatedOffices.length === 0 ? (
                                <div className={styles.emptyBox}>
                                    No service desk matched your current filters.
                                </div>
                            ) : (
                                <div className={styles.registryTableCard}>
                                    <div className={styles.registryTableTop}>
                                        <div>
                                            <h3 className={styles.registryTableTitle}>
                                                Service desk registry
                                            </h3>
                                            <p className={styles.registryTableSubtitle}>
                                                Showing {showingFrom}–{showingTo} of{" "}
                                                {filteredOffices.length} matching service desks.
                                            </p>
                                        </div>

                                        <span className={styles.registryTableCount}>
                                            Page {currentPage} of {totalPages}
                                        </span>
                                    </div>

                                    <div className={styles.registryTableScroll}>
                                        <table className={styles.registryDataTable}>
                                            <colgroup>
                                                <col className={styles.registryColDesk} />
                                                <col className={styles.registryColArea} />
                                                <col className={styles.registryColDistrict} />
                                                <col className={styles.registryColComplaints} />
                                                <col className={styles.registryColSetup} />
                                                <col className={styles.registryColActions} />
                                            </colgroup>

                                            <thead>
                                                <tr>
                                                    <th>Office</th>
                                                    <th>Service area</th>
                                                    <th>District</th>
                                                    <th className={styles.registryCenterCell}>
                                                        Complaints
                                                    </th>
                                                    <th>Status</th>
                                                    <th>Actions</th>
                                                </tr>
                                            </thead>

                                            <tbody>
                                                {paginatedOffices.map((office) => {
                                                    const assignedCount =
                                                        complaintCountByOffice.get(office.id) ?? 0;

                                                    return (
                                                        <tr key={office.id}>
                                                            <td>
                                                                <div className={styles.registryDeskCell}>
                                                                    <span className={styles.registryDeskIcon}>
                                                                        {getDeskInitials(office)}
                                                                    </span>

                                                                    <div className={styles.registryDeskContent}>
                                                                        <p className={styles.registryDeskTitle}>
                                                                            {getDisplayOfficeName(office)}
                                                                        </p>
                                                                        <p className={styles.registryDeskMeta}>
                                                                            {getDeskTypeLabel(office)}
                                                                        </p>
                                                                    </div>
                                                                </div>
                                                            </td>

                                                            <td>
                                                                <span className={styles.registryStrongText}>
                                                                    {getAreaLabel(office)}
                                                                </span>
                                                            </td>

                                                            <td>
                                                                <span className={styles.registryStrongText}>
                                                                    {office.district || "Not available"}
                                                                </span>
                                                            </td>

                                                            <td className={styles.registryCenterCell}>
                                                                <span className={styles.registryCountBadge}>
                                                                    {assignedCount}
                                                                </span>
                                                            </td>

                                                            <td>
                                                                <span className={getAccountStatusClass(office)}>
                                                                    {getAccountStatusLabel(office)}
                                                                </span>
                                                            </td>

                                                            <td>
                                                                <div className={styles.registryActionGroup}>
                                                                    <Link
                                                                        href={`/authority/registry/${office.id}`}
                                                                        className={styles.registryActionView}
                                                                    >
                                                                        View
                                                                    </Link>

                                                                    <Link
                                                                        href={`/authority/registry/${office.id}/edit`}
                                                                        className={styles.registryActionEdit}
                                                                    >
                                                                        Edit
                                                                    </Link>

                                                                    {office.is_active === false || office.verification_status === "inactive" ? (
                                                                        <Link
                                                                            href={`/authority/registry/${office.id}/reactivate`}
                                                                            className={styles.registryActionEdit}
                                                                        >
                                                                            Reactivate
                                                                        </Link>
                                                                    ) : (
                                                                        <Link
                                                                            href={`/authority/registry/${office.id}/disable`}
                                                                            className={styles.registryActionDisable}
                                                                        >
                                                                            Disable
                                                                        </Link>
                                                                    )}
                                                                </div>
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>

                                    <div className={styles.registryPagination}>
                                        <p className={styles.registryPaginationInfo}>
                                            Showing {showingFrom}–{showingTo} of{" "}
                                            {filteredOffices.length} service desks
                                        </p>

                                        <div className={styles.registryPaginationActions}>
                                            {currentPage > 1 ? (
                                                <Link
                                                    href={buildRegistryHref({ page: currentPage - 1 })}
                                                    className={styles.secondaryLink}
                                                >
                                                    Previous
                                                </Link>
                                            ) : (
                                                <span className={styles.complaintsPaginationDisabled}>
                                                    Previous
                                                </span>
                                            )}

                                            <span className={styles.registryPageIndicator}>
                                                Page {currentPage} of {totalPages}
                                            </span>

                                            {currentPage < totalPages ? (
                                                <Link
                                                    href={buildRegistryHref({ page: currentPage + 1 })}
                                                    className={styles.secondaryLink}
                                                >
                                                    Next
                                                </Link>
                                            ) : (
                                                <span className={styles.complaintsPaginationDisabled}>
                                                    Next
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            )}
                        </section>

                        <section className={styles.section}>
                            <div className={styles.sectionHeader}>
                                <div>
                                    <h2 className={styles.sectionTitle}>
                                        Authority access requests
                                    </h2>
                                    <p className={styles.sectionText}>
                                        Users who request authority access will appear here. These
                                        requests can later be approved and linked to a service desk.
                                    </p>
                                </div>
                            </div>
                            {requestError ? (
                                <div className={styles.alertBox}>
                                    {requestError === "approve_failed"
                                        ? "Failed to approve this authority access request. Please check the request, office status, and admin permission."
                                        : requestError === "reject_failed"
                                            ? "Failed to reject this authority access request. Please check your admin permission."
                                            : "Request action failed. Please try again."}
                                </div>
                            ) : null}
                            {requests.length === 0 ? (
                                <div className={styles.emptyBox}>
                                    No authority access requests have been submitted yet.
                                </div>
                            ) : (
                                <div className={styles.registryTableCard}>
                                    <div className={styles.registryTableTop}>
                                        <div>
                                            <h3 className={styles.registryTableTitle}>
                                                Access request queue
                                            </h3>
                                            <p className={styles.registryTableSubtitle}>
                                                Review submitted authority account requests before
                                                linking users to local authority service desks.
                                            </p>
                                        </div>

                                        <span className={styles.registryTableCount}>
                                            {requests.length} requests
                                        </span>
                                    </div>

                                    <div className={styles.registryTableScroll}>
                                        <table className={styles.registryDataTable}>
                                            <colgroup>
                                                <col className={styles.registryColRequester} />
                                                <col className={styles.registryColRequestedDesk} />
                                                <col className={styles.registryColContact} />
                                                <col className={styles.registryColStatus} />
                                                <col className={styles.registryColSubmitted} />
                                                <col className={styles.registryColNote} />
                                                <col className={styles.registryColActions} />
                                            </colgroup>

                                            <thead>
                                                <tr>
                                                    <th>Requester</th>
                                                    <th>Requested service desk</th>
                                                    <th>Designation / contact</th>
                                                    <th>Status</th>
                                                    <th>Submitted</th>
                                                    <th>Request note</th>
                                                    <th>Actions</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {requests.map((request) => {
                                                    const requestedOfficeName =
                                                        getRequestedOfficeName(request.requested_office) ||
                                                        request.requested_office_name ||
                                                        "Requested authority not selected";

                                                    return (
                                                        <tr key={request.id}>
                                                            <td>
                                                                <div className={styles.registryInfoStack}>
                                                                    <span className={styles.registryDeskTitle}>
                                                                        {request.full_name || "Unnamed requester"}
                                                                    </span>
                                                                    <span className={styles.registrySmallText}>
                                                                        {request.official_email || "No official / office email"}
                                                                    </span>
                                                                </div>
                                                            </td>

                                                            <td>
                                                                <div className={styles.registryInfoStack}>
                                                                    <span className={styles.registryStrongText}>
                                                                        {requestedOfficeName}
                                                                    </span>
                                                                    <span className={styles.registrySmallText}>
                                                                        {humanizeValue(request.requested_authority_type)}
                                                                    </span>
                                                                </div>
                                                            </td>

                                                            <td>
                                                                <div className={styles.registryInfoStack}>
                                                                    <span className={styles.registryStrongText}>
                                                                        {request.designation || "Role not provided"}
                                                                    </span>
                                                                    <span className={styles.registrySmallText}>
                                                                        {request.phone || "Phone not provided"}
                                                                    </span>
                                                                </div>
                                                            </td>

                                                            <td>
                                                                <span className={requestStatusClass(request.request_status)}>
                                                                    {humanizeValue(request.request_status)}
                                                                </span>
                                                            </td>

                                                            <td>
                                                                <span className={styles.registrySmallText}>
                                                                    {formatDate(request.created_at)}
                                                                </span>
                                                            </td>

                                                            <td>
                                                                <p className={styles.registryRequestNote}>
                                                                    {request.request_note || "No request note"}
                                                                </p>

                                                                {request.review_note ? (
                                                                    <p className={styles.registryReviewNote}>
                                                                        Review: {request.review_note}
                                                                    </p>
                                                                ) : null}
                                                            </td>

                                                            <td>
                                                                {request.request_status === "pending" ? (
                                                                    <div className={styles.registryActionGroup}>
                                                                        <form action={approveAccessRequestAction}>
                                                                            <input type="hidden" name="requestId" value={request.id} />
                                                                            <input
                                                                                type="hidden"
                                                                                name="reviewNote"
                                                                                value="Approved by central authority and linked to the requested service desk."
                                                                            />
                                                                            <button type="submit" className={styles.registryActionEdit}>
                                                                                Approve
                                                                            </button>
                                                                        </form>

                                                                        <form action={rejectAccessRequestAction}>
                                                                            <input type="hidden" name="requestId" value={request.id} />
                                                                            <input
                                                                                type="hidden"
                                                                                name="reviewNote"
                                                                                value="Rejected by central authority after reviewing the submitted access request."
                                                                            />
                                                                            <button type="submit" className={styles.registryActionDisable}>
                                                                                Reject
                                                                            </button>
                                                                        </form>
                                                                    </div>
                                                                ) : (
                                                                    <span className={styles.registryReviewedText}>Reviewed</span>
                                                                )}
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )}
                        </section>
                    </div>
                </section>
            </div>
        </main>
    );
}