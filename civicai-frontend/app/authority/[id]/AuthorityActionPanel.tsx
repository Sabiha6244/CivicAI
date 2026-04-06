"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import styles from "../authority.module.css";

type Props = {
  complaintId: string;
  currentStatus: string;
  currentResolutionNote: string | null;
  resolvedAt: string | null;
  currentFinalCategory?: string | null;
};

const CATEGORY_OPTIONS = [
  "Animal Husbandry",
  "Certificates",
  "Community Infrastructure and Services",
  "Crime and Safety",
  "Electricity and Power Supply",
  "Garbage and Unsanitary Practices",
  "Lakes",
  "Mobility - Roads, Footpaths and Infrastructure",
  "Mobility - Roads, Public transport",
  "Parks & Recreation",
  "Pollution",
  "Public Toilets",
  "Sewerage Systems",
  "Storm Water Drains",
  "Streetlights",
  "Traffic and Road Safety",
  "Trees and Saplings",
  "Water Supply and Services",
  "Other",
] as const;

export default function AuthorityActionPanel({
  complaintId,
  currentStatus,
  currentResolutionNote,
  resolvedAt,
  currentFinalCategory,
}: Props) {
  const router = useRouter();
  const [status, setStatus] = useState(currentStatus);
  const [resolutionNote, setResolutionNote] = useState(currentResolutionNote ?? "");
  const [finalCategory, setFinalCategory] = useState(currentFinalCategory ?? "");
  const [saving, setSaving] = useState(false);
  const [runningAi, setRunningAi] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [msgType, setMsgType] = useState<"info" | "error">("info");

  async function saveUpdate() {
    setSaving(true);
    setMsg(null);

    try {
      const res = await fetch(`/api/authority/complaints/${complaintId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          status,
          resolution_note: resolutionNote,
          final_category: finalCategory || null,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data?.error || "Failed to update complaint.");
      }

      setMsgType("info");
      setMsg("Complaint updated successfully.");
      router.refresh();
    } catch (error) {
      setMsgType("error");
      setMsg(error instanceof Error ? error.message : "Failed to update complaint.");
    } finally {
      setSaving(false);
    }
  }

  async function runAiNow() {
    setRunningAi(true);
    setMsg(null);

    try {
      const res = await fetch(`/api/authority/complaints/${complaintId}/run-ai`, {
        method: "POST",
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data?.error || "Failed to run AI.");
      }

      setMsgType("info");
      setMsg("AI processing completed successfully. Review the updated AI assessment before taking action.");
      router.refresh();
    } catch (error) {
      setMsgType("error");
      setMsg(error instanceof Error ? error.message : "Failed to run AI.");
    } finally {
      setRunningAi(false);
    }
  }

  return (
    <article className={`${styles.panel} ${styles.actionPanel}`}>
      <h2 className={styles.panelTitle}>Authority action panel</h2>

      <div className={styles.formGrid}>
        <div className={styles.noteBox}>
          <p className={styles.kvLabel}>Authority guidance</p>
          <p className={styles.kvValue}>
            AI output is advisory only. Confirm the complaint details, evidence,
            and reliability indicators before saving the final operational decision.
          </p>
        </div>

        <div className={styles.buttonGrid}>
          <button
            type="button"
            onClick={runAiNow}
            disabled={runningAi || saving}
            className={styles.primaryButton}
          >
            {runningAi ? "Running AI..." : "Run AI now"}
          </button>

          <button
            type="button"
            onClick={saveUpdate}
            disabled={saving || runningAi}
            className={styles.darkButton}
          >
            {saving ? "Saving update..." : "Save update"}
          </button>
        </div>

        <div>
          <label className={styles.label}>Complaint status</label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            disabled={saving || runningAi}
            className={styles.input}
          >
            <option value="submitted">submitted</option>
            <option value="processing">processing</option>
            <option value="completed">completed</option>
            <option value="resolved">resolved</option>
            <option value="rejected">rejected</option>
          </select>
        </div>

        <div>
          <label className={styles.label}>Final category</label>
          <select
            value={finalCategory}
            onChange={(e) => setFinalCategory(e.target.value)}
            disabled={saving || runningAi}
            className={styles.input}
          >
            <option value="">Select final category</option>
            {CATEGORY_OPTIONS.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className={styles.label}>Resolution note</label>
          <textarea
            value={resolutionNote}
            onChange={(e) => setResolutionNote(e.target.value)}
            disabled={saving || runningAi}
            placeholder="Write the action taken, field observation, or final resolution note."
            className={styles.textarea}
          />
        </div>

        <div className={styles.noteBox}>
          <p className={styles.kvLabel}>Current resolved time</p>
          <p className={styles.kvValue}>
            {resolvedAt ? new Date(resolvedAt).toLocaleString("en-BD") : "Not resolved yet"}
          </p>
        </div>

        <div className={styles.noteBox}>
          <p className={styles.kvLabel}>Recommended workflow</p>
          <p className={styles.kvValue}>
            Run AI when needed, inspect category mismatch or conflict warnings,
            confirm the final category manually, then save the final human decision.
          </p>
        </div>

        {msg ? (
          <div className={msgType === "error" ? styles.messageError : styles.message}>
            {msg}
          </div>
        ) : null}
      </div>
    </article>
  );
}