import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabaseServer";
import LogoutButton from "../components/LogoutButton";
import styles from "../home.module.css";
import reportStyles from "../report/report.module.css";
import MobileUserMenu from "../components/MobileUserMenu";

type MyProfilePageProps = {
    searchParams?: Promise<{
        saved?: string;
        error?: string;
    }>;
};

type ProfileRow = {
    full_name: string | null;
    role: string | null;
    is_verified: boolean | null;
};

async function updateProfileName(formData: FormData) {
    "use server";

    const supabase = await createClient();

    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
        redirect("/login?next=/my-profile");
    }

    const fullName = String(formData.get("full_name") ?? "").trim();

    if (!fullName) {
        redirect("/my-profile?error=name");
    }

    const { error } = await supabase
        .from("profiles")
        .update({
            full_name: fullName,
        })
        .eq("id", user.id);

    if (error) {
        redirect("/my-profile?error=save");
    }

    revalidatePath("/my-profile");
    redirect("/my-profile?saved=1");
}

export default async function MyProfilePage({
    searchParams,
}: MyProfilePageProps) {
    const params = (await searchParams) ?? {};
    const supabase = await createClient();

    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
        redirect("/login?next=/my-profile");
    }

    const { data: profileData } = await supabase
        .from("profiles")
        .select("full_name, role, is_verified")
        .eq("id", user.id)
        .maybeSingle();

    const profile: ProfileRow | null = profileData;

    const { count: totalReports } = await supabase
        .from("complaints")
        .select("id", { count: "exact", head: true })
        .eq("created_by", user.id);

    const { count: activeReports } = await supabase
        .from("complaints")
        .select("id", { count: "exact", head: true })
        .eq("created_by", user.id)
        .in("status", ["submitted", "processing"]);

    const { count: resolvedReports } = await supabase
        .from("complaints")
        .select("id", { count: "exact", head: true })
        .eq("created_by", user.id)
        .in("status", ["resolved", "completed"]);

    const roleLabel = profile?.role || "citizen";
    const verificationLabel = profile?.is_verified ? "Verified" : "Not verified";
    const isAuthority =
        profile?.is_verified === true && profile?.role === "authority";

    return (
        <main className={styles.page}>
            <MobileUserMenu active="my-profile" showAuthority={isAuthority} />

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

                            <Link href="/my-reports" className={styles.sidebarLink}>
                                My Reports
                            </Link>

                            <Link href="/my-profile" className={styles.sidebarLinkPrimary}>
                                My Profile
                            </Link>

                            <Link href="/report" className={styles.sidebarLink}>
                                Report complaint
                            </Link>

                            {isAuthority ? (
                                <Link href="/authority" className={styles.sidebarLink}>
                                    Authority dashboard
                                </Link>
                            ) : null}
                        </nav>

                        <div className={styles.sidebarFooter}>
                            <LogoutButton className={styles.sidebarLogoutButton} />
                        </div>
                    </div>
                </aside>

                <div className={styles.loggedContent}>
                    <div className={styles.dashboardPage}>
                        <section className={styles.dashboardHero}>
                            <div className={styles.dashboardHeroTop}>
                                <div>
                                    <p className={styles.dashboardEyebrow}>Citizen account</p>
                                    <h1 className={styles.dashboardTitle}>My Profile</h1>
                                    <p className={styles.dashboardText}>
                                        Manage your basic account name and review your CivicAI
                                        reporting activity. Your saved name will be used
                                        automatically when you submit a new complaint.
                                    </p>
                                </div>

                                <div className={styles.dashboardActions}>
                                    <Link href="/report" className={styles.dashboardPrimary}>
                                        Report a problem
                                    </Link>

                                    <Link href="/my-reports" className={styles.dashboardSecondary}>
                                        My Reports
                                    </Link>
                                </div>
                            </div>

                            <div className={styles.dashboardStats}>
                                <div className={styles.dashboardStatCard}>
                                    <p className={styles.dashboardStatLabel}>Total reports</p>
                                    <h2 className={styles.dashboardStatValue}>
                                        {totalReports ?? 0}
                                    </h2>
                                    <p className={styles.dashboardStatSubtext}>
                                        Complaints submitted from your account
                                    </p>
                                </div>

                                <div className={styles.dashboardStatCard}>
                                    <p className={styles.dashboardStatLabel}>Under review</p>
                                    <h2 className={styles.dashboardStatValue}>
                                        {activeReports ?? 0}
                                    </h2>
                                    <p className={styles.dashboardStatSubtext}>
                                        Submitted or processing complaints
                                    </p>
                                </div>

                                <div className={styles.dashboardStatCard}>
                                    <p className={styles.dashboardStatLabel}>Resolved</p>
                                    <h2 className={styles.dashboardStatValue}>
                                        {resolvedReports ?? 0}
                                    </h2>
                                    <p className={styles.dashboardStatSubtext}>
                                        Complaints marked resolved or completed
                                    </p>
                                </div>
                            </div>
                        </section>

                        <section className={styles.loggedInfoSection}>
                            <div className={styles.loggedInfoGrid}>
                                <div className={styles.loggedInfoCard}>
                                    <p className={styles.loggedCardEyebrow}>Account details</p>
                                    <h3 className={styles.loggedCardTitle}>
                                        {profile?.full_name || "Name not added"}
                                    </h3>

                                    <ul className={styles.loggedSummaryList}>
                                        <li>Email: {user.email || "Not available"}</li>
                                        <li>Role: {roleLabel}</li>
                                        <li>Verification: {verificationLabel}</li>
                                    </ul>
                                </div>

                                <div className={styles.loggedInfoCard}>
                                    <p className={styles.loggedCardEyebrow}>Profile update</p>
                                    <h3 className={styles.loggedCardTitle}>Saved reporter name</h3>

                                    {params.saved ? (
                                        <div className={styles.emptyBoxDark}>
                                            Profile name updated successfully.
                                        </div>
                                    ) : null}

                                    {params.error === "name" ? (
                                        <div className={styles.alertBoxDark}>
                                            Please enter your full name.
                                        </div>
                                    ) : null}

                                    {params.error === "save" ? (
                                        <div className={styles.alertBoxDark}>
                                            Unable to update profile name. Please try again.
                                        </div>
                                    ) : null}

                                    <form action={updateProfileName} className={reportStyles.form}>
                                        <div className={reportStyles.inputGroup}>
                                            <label className={reportStyles.label}>Full name</label>
                                            <input
                                                name="full_name"
                                                defaultValue={profile?.full_name ?? ""}
                                                placeholder="Enter your full name"
                                                className={reportStyles.input}
                                            />
                                        </div>

                                        <div className={reportStyles.actionsRow}>
                                            <button
                                                type="submit"
                                                className={reportStyles.primaryButton}
                                            >
                                                Save profile
                                            </button>
                                        </div>
                                    </form>
                                </div>
                            </div>
                        </section>

                        <section className={styles.loggedInfoSection}>
                            <div className={styles.loggedInfoCard}>
                                <p className={styles.loggedCardEyebrow}>Privacy note</p>
                                <h3 className={styles.loggedCardTitle}>
                                    Your profile is not public
                                </h3>
                                <p className={styles.dashboardText}>
                                    Your saved name is used to submit complaints more easily.
                                    Public complaint pages should not expose private account
                                    details unless you intentionally choose to show them.
                                </p>
                            </div>
                        </section>
                    </div>
                </div>
            </div>
        </main>
    );
}