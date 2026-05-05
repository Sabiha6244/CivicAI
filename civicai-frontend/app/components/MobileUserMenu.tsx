"use client";

import { useState } from "react";
import Link from "next/link";
import LogoutButton from "./LogoutButton";
import styles from "../home.module.css";

type MobileMenuRole = "admin" | "authority" | "citizen";

type MobileUserMenuProps = {
  active?:
    | "home"
    | "my-reports"
    | "my-profile"
    | "report"
    | "request-access"
    | "authority"
    | "authority-complaints"
    | "authority-registry"
    | "authority-analytics"
    | "authority-hotspots";
  role?: MobileMenuRole;

  // Kept only so old pages do not break immediately.
  // Prefer role="admin" | "authority" | "citizen".
  showAuthority?: boolean;
};

export default function MobileUserMenu({
  active = "home",
  role,
  showAuthority = false,
}: MobileUserMenuProps) {
  const [open, setOpen] = useState(false);

  const resolvedRole: MobileMenuRole =
    role ?? (showAuthority ? "admin" : "citizen");

  const isAdmin = resolvedRole === "admin";
  const isLocalAuthority = resolvedRole === "authority";
  const isCitizen = resolvedRole === "citizen";

  function linkClass(key: MobileUserMenuProps["active"]) {
    return active === key ? styles.mobileMenuLinkActive : styles.mobileMenuLink;
  }

  return (
    <div className={styles.mobileNav}>
      <div className={styles.mobileNavInner}>
        <div className={styles.mobileNavTop}>
          <Link href="/" className={styles.mobileNavBrand}>
            CivicAI
          </Link>

          <button
            type="button"
            className={styles.mobileMenuButton}
            onClick={() => setOpen((current) => !current)}
            aria-expanded={open}
            aria-controls="mobile-user-menu"
          >
            {open ? "Close" : "Menu"}
          </button>
        </div>

        {open ? (
          <nav id="mobile-user-menu" className={styles.mobileMenuPanel}>
            <Link href="/" className={linkClass("home")}>
              Home
            </Link>

            {isAdmin ? (
              <>
                <Link href="/authority" className={linkClass("authority")}>
                  Authority dashboard
                </Link>

                <Link
                  href="/authority/complaints"
                  className={linkClass("authority-complaints")}
                >
                  Manage complaints
                </Link>

                <Link
                  href="/authority/registry"
                  className={linkClass("authority-registry")}
                >
                  Authority registry
                </Link>

                <Link
                  href="/authority/analytics"
                  className={linkClass("authority-analytics")}
                >
                  Analytics
                </Link>

                <Link
                  href="/authority/analytics/hotspots"
                  className={linkClass("authority-hotspots")}
                >
                  Hotspots
                </Link>

                <Link href="/report" className={linkClass("report")}>
                  Create report
                </Link>

                <Link href="/my-profile" className={linkClass("my-profile")}>
                  My Profile
                </Link>
              </>
            ) : null}

            {isLocalAuthority ? (
              <>
                <Link href="/authority" className={linkClass("authority")}>
                  Local dashboard
                </Link>

                <Link
                  href="/authority/complaints"
                  className={linkClass("authority-complaints")}
                >
                  Assigned complaints
                </Link>

                <Link href="/report" className={linkClass("report")}>
                  Create report
                </Link>

                <Link href="/my-profile" className={linkClass("my-profile")}>
                  My Profile
                </Link>
              </>
            ) : null}

            {isCitizen ? (
              <>
                <Link href="/my-reports" className={linkClass("my-reports")}>
                  My Reports
                </Link>

                <Link href="/my-profile" className={linkClass("my-profile")}>
                  My Profile
                </Link>

                <Link href="/report" className={linkClass("report")}>
                  Report complaint
                </Link>

                <Link
                  href="/authority/request-access"
                  className={linkClass("request-access")}
                >
                  Request authority access
                </Link>
              </>
            ) : null}

            <LogoutButton className={styles.mobileMenuLogout} />
          </nav>
        ) : null}
      </div>
    </div>
  );
}