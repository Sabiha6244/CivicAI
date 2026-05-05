import { redirect } from "next/navigation";
import Link from "next/link";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import styles from "../../authority.module.css";
import MobileUserMenu from "../../../components/MobileUserMenu";

type NewServiceDeskPageProps = {
    searchParams?: Promise<{
        error?: string;
    }>;
};

function humanizeValue(value?: string | null) {
    if (!value) return "Not available";

    return value
        .replace(/[_-]+/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/\b\w/g, (match) => match.toUpperCase());
}

function getErrorMessage(errorCode: string) {
    switch (errorCode) {
        case "missing_required":
            return "Please fill in office name, service area, district, authority body type, and coverage level.";
        case "create_failed":
            return "Failed to create the service desk. Please check duplicate office name, selected values, and admin permission.";
        default:
            return "";
    }
}

async function createServiceDeskAction(formData: FormData) {
    "use server";

    const officeName = String(formData.get("officeName") ?? "").trim();
    const authorityBodyType = String(formData.get("authorityBodyType") ?? "").trim();
    const serviceAreaName = String(formData.get("serviceAreaName") ?? "").trim();
    const division = String(formData.get("division") ?? "").trim();
    const district = String(formData.get("district") ?? "").trim();
    const coverageLevel = String(formData.get("coverageLevel") ?? "").trim();
    const verificationNote = String(formData.get("verificationNote") ?? "").trim();

    if (
        !officeName ||
        !authorityBodyType ||
        !serviceAreaName ||
        !district ||
        !coverageLevel
    ) {
        redirect("/authority/registry/new?error=missing_required");
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
        redirect("/login?next=/authority/registry/new");
    }

    const { data: profile } = await supabase
        .from("profiles")
        .select("role, is_verified")
        .eq("id", user.id)
        .single();

    if (!profile?.is_verified) {
        redirect("/login?next=/authority/registry/new&verify=1");
    }

    if (profile.role !== "admin") {
        redirect("/");
    }

    const { data, error } = await supabase.rpc("create_authority_service_desk", {
        p_office_name: officeName,
        p_authority_body_type: authorityBodyType,
        p_service_area_name: serviceAreaName,
        p_division: division || null,
        p_district: district,
        p_coverage_level: coverageLevel,
        p_verification_note:
            verificationNote ||
            "Manually created by central authority. Pending setup until a real authority user account is approved and linked.",
    });

    if (error) {
        console.error("Create service desk error:", error.message);
        redirect("/authority/registry/new?error=create_failed");
    }

    const createdOfficeId = Array.isArray(data) ? data[0]?.office_id : null;

    if (createdOfficeId) {
        redirect(`/authority/registry/${createdOfficeId}`);
    }

    redirect("/authority/registry");
}

export default async function NewServiceDeskPage({
    searchParams,
}: NewServiceDeskPageProps) {
    const query = await searchParams;
    const errorMessage = getErrorMessage(query?.error ?? "");

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
        redirect("/login?next=/authority/registry/new");
    }

    const { data: profile } = await supabase
        .from("profiles")
        .select("role, is_verified")
        .eq("id", user.id)
        .single();

    if (!profile?.is_verified) {
        redirect("/login?next=/authority/registry/new&verify=1");
    }

    if (profile.role !== "admin") {
        redirect("/");
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
                                Create a main city corporation or local authority service desk
                                for routing and account access management.
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

                                <Link href="/authority/registry" className={styles.sidebarLinkActive}>
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
                                    <p className={styles.eyebrow}>Add service desk</p>
                                    <h1 className={styles.title}>Create a responsible authority service desk</h1>
                                    <p className={styles.subtitle}>
                                        Add a main city corporation or local authority desk when an
                                        area is missing from the registry. New desks remain pending
                                        setup until an authority user is approved and linked.
                                    </p>

                                    <div className={styles.detailMetaRow}>
                                        <span className={styles.metaPill}>Admin only</span>
                                        <span className={styles.metaPill}>Default status: Pending setup</span>
                                        <span className={styles.metaPill}>Office type locked</span>
                                    </div>
                                </div>

                                <div className={styles.detailActions}>
                                    <Link href="/authority/registry" className={styles.secondaryLink}>
                                        Back to registry
                                    </Link>
                                </div>
                            </div>
                        </section>

                        <section className={styles.detailGrid}>
                            <div className={styles.leftColumn}>
                                <article className={styles.panel}>
                                    <h2 className={styles.panelTitle}>Service desk details</h2>

                                    <div className={styles.panelBody}>
                                        {errorMessage ? (
                                            <div className={styles.alertBox}>{errorMessage}</div>
                                        ) : null}

                                        <div className={styles.infoBox}>
                                            <p className={styles.kvLabel}>Creation rule</p>
                                            <p className={styles.kvValue}>
                                                Use this page only for main authority desks. 
                                            </p>
                                        </div>

                                        <form action={createServiceDeskAction} className={styles.formGrid}>
                                            <div>
                                                <label className={styles.label} htmlFor="officeName">
                                                    Office name *
                                                </label>
                                                <input
                                                    id="officeName"
                                                    name="officeName"
                                                    className={styles.input}
                                                    placeholder="Example: Gazipur City Corporation Service Desk"
                                                    required
                                                />
                                            </div>

                                            <div>
                                                <label className={styles.label} htmlFor="authorityBodyType">
                                                    Authority body type *
                                                </label>
                                                <select
                                                    id="authorityBodyType"
                                                    name="authorityBodyType"
                                                    className={styles.input}
                                                    defaultValue="local_authority_service_desk"
                                                    required
                                                >
                                                    <option value="city_corporation">City corporation</option>
                                                    <option value="local_authority_service_desk">
                                                        Local authority
                                                    </option>
                                                    <option value="local_government">Local government</option>
                                                </select>
                                            </div>

                                            <div>
                                                <label className={styles.label} htmlFor="serviceAreaName">
                                                    Service area name *
                                                </label>
                                                <input
                                                    id="serviceAreaName"
                                                    name="serviceAreaName"
                                                    className={styles.input}
                                                    placeholder="Example: Gazipur"
                                                    required
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
                                                    placeholder="Example: Dhaka"
                                                />
                                            </div>

                                            <div>
                                                <label className={styles.label} htmlFor="district">
                                                    District *
                                                </label>
                                                <input
                                                    id="district"
                                                    name="district"
                                                    className={styles.input}
                                                    placeholder="Example: Gazipur"
                                                    required
                                                />
                                            </div>

                                            <div>
                                                <label className={styles.label} htmlFor="coverageLevel">
                                                    Coverage level *
                                                </label>
                                                <select
                                                    id="coverageLevel"
                                                    name="coverageLevel"
                                                    className={styles.input}
                                                    defaultValue="district"
                                                    required
                                                >
                                                    <option value="district">District</option>
                                                    <option value="city_corporation">City corporation</option>
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
                                                    placeholder="Explain why this service desk was created or what area it covers."
                                                    defaultValue="Manually created by central authority. Pending setup until a real authority user account is approved and linked."
                                                />
                                            </div>

                                            <div className={styles.buttonGrid}>
                                                <button type="submit" className={styles.primaryButton}>
                                                    Create service desk
                                                </button>

                                                <Link href="/authority/registry" className={styles.secondaryLink}>
                                                    Cancel
                                                </Link>
                                            </div>
                                        </form>
                                    </div>
                                </article>
                            </div>

                            <div className={styles.rightColumn}>
                                <article className={`${styles.panel} ${styles.actionPanel}`}>
                                    <h2 className={styles.panelTitle}>Default values</h2>

                                    <div className={styles.panelBody}>
                                        <div className={styles.kvBlock}>
                                            <p className={styles.kvLabel}>System office type</p>
                                            <p className={styles.kvValue}>
                                                {humanizeValue("local_authority_service_desk")}
                                            </p>
                                        </div>

                                        <div className={styles.kvBlock}>
                                            <p className={styles.kvLabel}>Active status</p>
                                            <p className={styles.kvValue}>Active</p>
                                        </div>

                                        <div className={styles.kvBlock}>
                                            <p className={styles.kvLabel}>Verification status</p>
                                            <p className={styles.kvValue}>Pending setup</p>
                                        </div>

                                        <div className={styles.kvBlock}>
                                            <p className={styles.kvLabel}>Created by system</p>
                                            <p className={styles.kvValue}>No</p>
                                        </div>
                                    </div>
                                </article>

                                <article className={styles.panel}>
                                    <h2 className={styles.panelTitle}>Examples</h2>

                                    <div className={styles.panelBody}>
                                        <div className={styles.infoBox}>
                                            <p className={styles.kvLabel}>City corporation</p>
                                            <p className={styles.kvValue}>
                                                Gazipur City Corporation Service Desk
                                            </p>
                                        </div>

                                        <div className={styles.infoBox}>
                                            <p className={styles.kvLabel}>Local authority</p>
                                            <p className={styles.kvValue}>
                                                Rajbari Local Authority Service Desk
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