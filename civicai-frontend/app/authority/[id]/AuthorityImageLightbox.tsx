"use client";

import { useEffect, useState } from "react";
import styles from "../authority.module.css";

type Props = {
  src: string;
  alt: string;
};

export default function AuthorityImageLightbox({ src, alt }: Props) {
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
        className={styles.imageButton}
        onClick={() => setOpen(true)}
        aria-label="Open full image"
      >
        <img src={src} alt={alt} className={styles.largeImage} />
        <span className={styles.imageOverlay}>Click to view full image</span>
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