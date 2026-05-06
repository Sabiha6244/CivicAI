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
    district: string | null;
    verification_status: string | null;
    is_active: boolean | null;
};

type ProfileRow = {
    role: string;
    full_name: string | null;
    is_verified: boolean;
};

type AccessRequestRow = {
    id: string;
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
    updated_at: string;
};

type RequestAccessPageProps = {
    searchParams?: Promise<{
        success?: string;
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

function getOfficeTypeLabel(office: AuthorityOfficeRow) {
    const name = office.office_name.toLowerCase();
    const bodyType = office.authority_body_type?.toLowerCase() ?? "";

    if (name.includes("city corporation") || bodyType.includes("city")) {
        return "City corporation";
    }

    return "Local authority";
}

function getOfficeAreaLabel(office: AuthorityOfficeRow) {
    return office.service_area_name || office.district || "Area not available";
}

function requestStatusClass(status: string) {
    switch (status) {
        case "approved":
            return styles.priorityLow;
        case "pending":
            return styles.chipWarn;
        case "rejected":
            return styles.priorityHigh;
        case "cancelled":
            return styles.chip;
        default:
            return styles.chip;
    }
}

async function submitAuthorityAccessRequest(formData: FormData) {
    "use server";

    const officeId = String(formData.get("officeId") ?? "").trim();
    const fullName = String(formData.get("fullName") ?? "").trim();
    const officialEmail = String(formData.get("officialEmail") ?? "").trim();
    const designation = String(formData.get("designation") ?? "").trim();
    const phone = String(formData.get("phone") ?? "").trim();
    const requestNote = String(formData.get("requestNote") ?? "").trim();

    if (!officeId || !fullName || !officialEmail || !designation) {
        redirect("/authority/request-access?error=missing_required");
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
        redirect("/login?next=/authority/request-access");
    }

    const { data: profile } = await supabase
        .from("profiles")
        .select("role, is_verified")
        .eq("id", user.id)
        .single();

    if (!profile?.is_verified) {
        redirect("/login?next=/authority/request-access&verify=1");
    }

    const { data: selectedOffice, error: officeError } = await supabase
        .from("authority_offices")
        .select(
            `
      id,
      office_name,
      office_type,
      authority_body_type,
      service_area_name,
      district,
      is_active,
      verification_status
    `
        )
        .eq("id", officeId)
        .eq("office_type", "local_authority_service_desk")
        .eq("is_active", true)
        .maybeSingle();

    if (officeError || !selectedOffice) {
        redirect("/authority/request-access?error=office_not_found");
    }

    const { data: existingPending } = await supabase
        .from("authority_access_requests")
        .select("id")
        .eq("user_id", user.id)
        .eq("request_status", "pending")
        .maybeSingle();

    if (existingPending?.id) {
        redirect("/authority/request-access?error=pending_exists");
    }

    const office = selectedOffice as AuthorityOfficeRow;

    const { error } = await supabase.from("authority_access_requests").insert({
        user_id: user.id,
        requested_office_id: office.id,
        requested_office_name: office.office_name,
        requested_authority_type: office.authority_body_type || office.office_type,
        full_name: fullName,
        official_email: officialEmail,
        designation,
        phone: phone || null,
        request_note: requestNote || null,
        request_status: "pending",
        updated_at: new Date().toISOString(),
    });

    if (error) {
        redirect("/authority/request-access?error=insert_failed");
    }

    redirect("/authority/request-access?success=1");
}

export default async function AuthorityRequestAccessPage({
    searchParams,
}: RequestAccessPageProps) {
    const query = await searchParams;
    const success = query?.success === "1";
    const errorCode = query?.error ?? "";

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
        redirect("/login?next=/authority/request-access");
    }

    const { data: profileData } = await supabase
        .from("profiles")
        .select("role, full_name, is_verified")
        .eq("id", user.id)
        .single();

    const profile = profileData as ProfileRow | null;

    if (!profile?.is_verified) {
        redirect("/login?next=/authority/request-access&verify=1");
    }

    const [{ data: officesData }, { data: requestsData }] = await Promise.all([
        supabase
            .from("authority_offices")
            .select(
                `
        id,
        office_name,
        office_type,
        authority_body_type,
        service_area_name,
        district,
        verification_status,
        is_active
      `
            )
            .eq("office_type", "local_authority_service_desk")
            .eq("is_active", true)
            .order("office_name", { ascending: true }),

        supabase
            .from("authority_access_requests")
            .select(
                `
        id,
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
        updated_at
      `
            )
            .eq("user_id", user.id)
            .order("created_at", { ascending: false }),
    ]);

    const offices = (officesData ?? []) as AuthorityOfficeRow[];
    const requests = (requestsData ?? []) as AccessRequestRow[];
    const latestPendingRequest = requests.find(
        (request) => request.request_status === "pending"
    );

    const defaultFullName = profile?.full_name ?? "";
    const defaultEmail = user.email ?? "";

    function getErrorMessage() {
        switch (errorCode) {
            case "missing_required":
                return "Please fill in the required fields before submitting your request.";
            case "office_not_found":
                return "The selected service desk could not be found or is currently inactive.";
            case "pending_exists":
                return "You already have a pending authority access request. Please wait for central authority review.";
            case "insert_failed":
                return "Failed to submit the authority access request. Please try again.";
            default:
                return "";
        }
    }

    const errorMessage = getErrorMessage();

    return (
        <main className={styles.page}>
            <MobileUserMenu
                active="request-access"
                role={
                    profile?.role === "admin"
                        ? "admin"
                        : profile?.role === "authority"
                            ? "authority"
                            : "citizen"
                }
            />
            <div className={styles.wrapper}>
                <section className={styles.pageGrid}>
                    <aside className={styles.sidebar}>
                        <div className={styles.sidebarCard}>
                            <p className={styles.sidebarEyebrow}>Authority access</p>
                            <h2 className={styles.sidebarTitle}>Request access</h2>
                            <p className={styles.sidebarText}>
                                Submit an official request to be linked with a city corporation
                                or local authority service desk.
                            </p>

                            <nav className={styles.sidebarNav}>
                                <Link href="/" className={styles.sidebarLink}>
                                    Back to homepage
                                </Link>

                                <Link href="/authority/request-access" className={styles.sidebarLinkActive}>
                                    Request authority access
                                </Link>

                                <Link href="/authority/complaints" className={styles.sidebarLink}>
                                    Authority complaints
                                </Link>

                                <Link href="/authority/registry" className={styles.sidebarLink}>
                                    Authority registry
                                </Link>
                            </nav>
                        </div>
                    </aside>

                    <div className={styles.mainContent}>
                        <section className={styles.detailHero}>
                            <div className={styles.detailTop}>
                                <div className={styles.detailMetaBlock}>
                                    <p className={styles.eyebrow}>Authority access request</p>
                                    <h1 className={styles.title}>Request authority workspace access</h1>
                                    <p className={styles.subtitle}>
                                        Verified users can request access under a responsible
                                        service desk. The request must be reviewed and approved by
                                        central authority before the user can manage assigned
                                        complaints.
                                    </p>

                                    <div className={styles.detailMetaRow}>
                                        <span className={styles.metaPill}>
                                            Signed in as: {defaultEmail}
                                        </span>
                                        <span className={styles.metaPill}>
                                            Current role: {humanizeValue(profile?.role)}
                                        </span>
                                    </div>
                                </div>

                                <div className={styles.detailActions}>
                                    <Link href="/" className={styles.secondaryLink}>
                                        Back to homepage
                                    </Link>
                                </div>
                            </div>
                        </section>

                        <section className={styles.detailGrid}>
                            <div className={styles.leftColumn}>
                                <article className={styles.panel}>
                                    <h2 className={styles.panelTitle}>Submit request</h2>

                                    <div className={styles.panelBody}>
                                        {success ? (
                                            <div className={styles.infoBox}>
                                                <p className={styles.kvLabel}>Request submitted</p>
                                                <p className={styles.kvValue}>
                                                    Your authority access request for{" "}
                                                    <strong>
                                                        {latestPendingRequest?.requested_office_name || "the selected service desk"}
                                                    </strong>{" "}
                                                    has been submitted and is waiting for central authority review.
                                                </p>
                                            </div>
                                        ) : errorMessage ? (
                                            <div className={styles.alertBox}>{errorMessage}</div>
                                        ) : latestPendingRequest ? (
                                            <div className={styles.warningBox}>
                                                <p className={styles.kvLabel}>Request under review</p>
                                                <p className={styles.kvValue}>
                                                    You already have a pending authority access request for{" "}
                                                    <strong>
                                                        {latestPendingRequest.requested_office_name || "a service desk"}
                                                    </strong>
                                                    . Please wait for central authority review before submitting another request.
                                                </p>
                                            </div>
                                        ) : (
                                            <form
                                                action={submitAuthorityAccessRequest}
                                                className={styles.formGrid}
                                            >
                                                <div>
                                                    <label className={styles.label} htmlFor="officeId">
                                                        Requested service desk *
                                                    </label>
                                                    <select
                                                        id="officeId"
                                                        name="officeId"
                                                        className={styles.input}
                                                        required
                                                        defaultValue=""
                                                    >
                                                        <option value="" disabled>
                                                            Select a city corporation or local authority
                                                        </option>

                                                        {offices.map((office) => (
                                                            <option key={office.id} value={office.id}>
                                                                {office.office_name} — {getOfficeAreaLabel(office)}
                                                            </option>
                                                        ))}
                                                    </select>
                                                </div>

                                                <div>
                                                    <label className={styles.label} htmlFor="fullName">
                                                        Full name *
                                                    </label>
                                                    <input
                                                        id="fullName"
                                                        name="fullName"
                                                        className={styles.input}
                                                        defaultValue={defaultFullName}
                                                        placeholder="Your full official name"
                                                        required
                                                    />
                                                </div>

                                                <div>
                                                    <label className={styles.label} htmlFor="officialEmail">
                                                        Official email *
                                                    </label>
                                                    <input
                                                        id="officialEmail"
                                                        name="officialEmail"
                                                        type="email"
                                                        className={styles.input}
                                                        defaultValue={defaultEmail}
                                                        placeholder="official@example.gov.bd"
                                                        required
                                                    />
                                                </div>

                                                <div>
                                                    <label className={styles.label} htmlFor="designation">
                                                        Designation *
                                                    </label>
                                                    <input
                                                        id="designation"
                                                        name="designation"
                                                        className={styles.input}
                                                        placeholder="Example: Assistant Engineer, Ward Officer"
                                                        required
                                                    />
                                                </div>

                                                <div>
                                                    <label className={styles.label} htmlFor="phone">
                                                        Phone number
                                                    </label>
                                                    <input
                                                        id="phone"
                                                        name="phone"
                                                        className={styles.input}
                                                        placeholder="Official contact number"
                                                    />
                                                </div>

                                                <div>
                                                    <label className={styles.label} htmlFor="requestNote">
                                                        Request note / proof
                                                    </label>
                                                    <textarea
                                                        id="requestNote"
                                                        name="requestNote"
                                                        className={styles.textarea}
                                                        placeholder="Briefly explain your authority role, office, and why access is needed."
                                                    />
                                                </div>

                                                <div className={styles.buttonGrid}>
                                                    <button type="submit" className={styles.primaryButton}>
                                                        Submit access request
                                                    </button>

                                                    <Link href="/" className={styles.secondaryLink}>
                                                        Cancel
                                                    </Link>
                                                </div>
                                            </form>
                                        )}
                                    </div>
                                </article>
                            </div>

                            <div className={styles.rightColumn}>
                                <article className={`${styles.panel} ${styles.actionPanel}`}>
                                    <h2 className={styles.panelTitle}>Available service desks</h2>

                                    <div className={styles.panelBody}>
                                        {offices.length === 0 ? (
                                            <div className={styles.emptyBox}>
                                                No active service desk is available for access requests.
                                            </div>
                                        ) : (
                                            <div className={styles.dashboardInboxList}>
                                                {offices.slice(0, 8).map((office) => (
                                                    <div key={office.id} className={styles.dashboardInboxItem}>
                                                        <div className={styles.dashboardInboxItemTop}>
                                                            <h3 className={styles.dashboardInboxItemTitle}>
                                                                {office.office_name}
                                                            </h3>
                                                            <span className={styles.chip}>
                                                                {getOfficeTypeLabel(office)}
                                                            </span>
                                                        </div>

                                                        <p className={styles.dashboardInboxItemMeta}>
                                                            Area: {getOfficeAreaLabel(office)} • Status:{" "}
                                                            {humanizeValue(office.verification_status)}
                                                        </p>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                </article>

                                <article className={styles.panel}>
                                    <h2 className={styles.panelTitle}>Your request history</h2>

                                    <div className={styles.panelBody}>
                                        {requests.length === 0 ? (
                                            <div className={styles.emptyBox}>
                                                You have not submitted any authority access request yet.
                                            </div>
                                        ) : (
                                            <div className={styles.dashboardInboxList}>
                                                {requests.map((request) => (
                                                    <div key={request.id} className={styles.dashboardInboxItem}>
                                                        <div className={styles.dashboardInboxItemTop}>
                                                            <h3 className={styles.dashboardInboxItemTitle}>
                                                                {request.requested_office_name ||
                                                                    "Requested service desk"}
                                                            </h3>
                                                            <span className={requestStatusClass(request.request_status)}>
                                                                {humanizeValue(request.request_status)}
                                                            </span>
                                                        </div>

                                                        <p className={styles.dashboardInboxItemMeta}>
                                                            {request.designation || "Designation not provided"} •{" "}
                                                            Submitted {formatDate(request.created_at)}
                                                        </p>

                                                        {request.review_note ? (
                                                            <p className={styles.dashboardInboxItemMeta}>
                                                                Review note: {request.review_note}
                                                            </p>
                                                        ) : null}
                                                    </div>
                                                ))}
                                            </div>
                                        )}
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