"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import styles from "../authority.module.css";

type DuplicateItem = {
  id: string;
  title: string | null;
  status: string;
  created_at: string;
};

type DuplicateResponse = {
  ok?: boolean;
  duplicate_count?: number;
  duplicates?: DuplicateItem[];
  error?: string;
  source?: string;
};

function formatDate(value: string) {
  return new Date(value).toLocaleString("en-BD", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function statusClass(status: string) {
  switch (status) {
    case "submitted":
      return styles.badgeSubmitted;
    case "processing":
      return styles.badgeProcessing;
    case "completed":
    case "resolved":
      return styles.badgeResolved;
    case "rejected":
      return styles.badgeRejected;
    default:
      return styles.badge;
  }
}

export default function DuplicateComplaintsPanel({
  complaintId,
}: {
  complaintId: string;
}) {
  const [items, setItems] = useState<DuplicateItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadDuplicates() {
      setLoading(true);
      setError(null);

      try {
        const res = await fetch(`/api/authority/complaints/${complaintId}/duplicates`, {
          method: "GET",
          cache: "no-store",
        });

        const data = (await res.json()) as DuplicateResponse;

        if (!res.ok) {
          throw new Error(data?.error || "Failed to load duplicate complaints.");
        }

        if (!cancelled) {
          setItems(Array.isArray(data.duplicates) ? data.duplicates : []);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load duplicate complaints.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadDuplicates();

    return () => {
      cancelled = true;
    };
  }, [complaintId]);

  if (loading) {
    return <p className={styles.helperText}>Loading saved duplicate matches...</p>;
  }

  if (error) {
    return <p className={styles.messageError}>{error}</p>;
  }

  if (items.length === 0) {
    return <p className={styles.kvValue}>No similar complaints found nearby.</p>;
  }

  return (
    <ul className={styles.duplicateList}>
      {items.map((dup) => (
        <li key={dup.id} className={styles.duplicateItem}>
          <Link href={`/authority/${dup.id}`} className={styles.duplicateLink}>
            <span className={styles.duplicateTitle}>{dup.title || "Untitled complaint"}</span>
            <span className={styles.duplicateMetaRow}>
              <span className={statusClass(dup.status)}>{dup.status}</span>
              <span className={styles.duplicateDate}>{formatDate(dup.created_at)}</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
