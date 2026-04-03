"use client";

import { useEffect, useState } from "react";
import styles from "../home.module.css";

export default function ImageLightbox({
  src,
  alt,
}: {
  src: string;
  alt: string;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <>
      <button
        type="button"
        className={styles.complaintImageButton}
        onClick={() => setOpen(true)}
        aria-label="Open complaint image"
      >
        <img src={src} alt={alt} className={styles.complaintImage} />
        <span className={styles.imageOverlay}>Click to view full image</span>
      </button>

      {open && (
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
              aria-label="Close image"
            >
              ×
            </button>

            <img src={src} alt={alt} className={styles.lightboxImage} />
          </div>
        </div>
      )}
    </>
  );
}