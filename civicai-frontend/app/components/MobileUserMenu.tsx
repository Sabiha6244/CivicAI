"use client";

import { useState } from "react";
import Link from "next/link";
import LogoutButton from "./LogoutButton";
import styles from "../home.module.css";

type MobileUserMenuProps = {
  active?:
    | "home"
    | "my-reports"
    | "my-profile"
    | "report"
    | "authority"
    | "authority-complaints"
    | "authority-analytics"
    | "authority-hotspots";
  showAuthority?: boolean;
};

export default function MobileUserMenu({
  active = "home",
  showAuthority = false,
}: MobileUserMenuProps) {
  const [open, setOpen] = useState(false);

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
            <Link
              href="/"
              className={
                active === "home"
                  ? styles.mobileMenuLinkActive
                  : styles.mobileMenuLink
              }
            >
              Home
            </Link>

            {showAuthority ? (
              <>
                <Link
                  href="/authority"
                  className={
                    active === "authority"
                      ? styles.mobileMenuLinkActive
                      : styles.mobileMenuLink
                  }
                >
                  Authority dashboard
                </Link>

                <Link
                  href="/authority/complaints"
                  className={
                    active === "authority-complaints"
                      ? styles.mobileMenuLinkActive
                      : styles.mobileMenuLink
                  }
                >
                  Manage complaints
                </Link>

                <Link
                  href="/authority/analytics"
                  className={
                    active === "authority-analytics"
                      ? styles.mobileMenuLinkActive
                      : styles.mobileMenuLink
                  }
                >
                  Analytics
                </Link>

                <Link
                  href="/authority/analytics/hotspots"
                  className={
                    active === "authority-hotspots"
                      ? styles.mobileMenuLinkActive
                      : styles.mobileMenuLink
                  }
                >
                  Hotspots
                </Link>

                <Link
                  href="/report"
                  className={
                    active === "report"
                      ? styles.mobileMenuLinkActive
                      : styles.mobileMenuLink
                  }
                >
                  Report complaint
                </Link>

                <Link
                  href="/my-profile"
                  className={
                    active === "my-profile"
                      ? styles.mobileMenuLinkActive
                      : styles.mobileMenuLink
                  }
                >
                  My Profile
                </Link>
              </>
            ) : (
              <>
                <Link
                  href="/my-reports"
                  className={
                    active === "my-reports"
                      ? styles.mobileMenuLinkActive
                      : styles.mobileMenuLink
                  }
                >
                  My Reports
                </Link>

                <Link
                  href="/my-profile"
                  className={
                    active === "my-profile"
                      ? styles.mobileMenuLinkActive
                      : styles.mobileMenuLink
                  }
                >
                  My Profile
                </Link>

                <Link
                  href="/report"
                  className={
                    active === "report"
                      ? styles.mobileMenuLinkActive
                      : styles.mobileMenuLink
                  }
                >
                  Report complaint
                </Link>
              </>
            )}

            <LogoutButton className={styles.mobileMenuLogout} />
          </nav>
        ) : null}
      </div>
    </div>
  );
}