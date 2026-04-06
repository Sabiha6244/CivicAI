"use client";

import { useEffect, useState } from "react";
import styles from "./authority.module.css";

type Props = {
  src: string | null;
  alt: string;
};

export default function AuthorityDashboardThumb({ src, alt }: Props) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  if (!src) {
    return (
      <div className={styles.dashboardThumbEmpty}>
        No image
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        className={styles.dashboardThumbButton}
        onClick={() => setOpen(true)}
        aria-label="Open complaint image"
      >
        <img src={src} alt={alt} className={styles.dashboardThumbImage} />
      </button>

      {open ? (
        <div
          className={styles.lightboxBackdrop}
          onClick={() => setOpen(false)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className={styles.lightboxContent}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className={styles.lightboxClose}
              onClick={() => setOpen(false)}
              aria-label="Close image preview"
            >
              ×
            </button>

            <img src={src} alt={alt} className={styles.lightboxImage} />
          </div>
        </div>
      ) : null}
    </>
  );
}