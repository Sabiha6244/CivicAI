"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import styles from "../authority.module.css";

type Props = {
  complaintId: string;
  currentStatus: string;
  currentResolutionNote: string | null;
  resolvedAt: string | null;
};

export default function AuthorityActionPanel({
  complaintId,
  currentStatus,
  currentResolutionNote,
  resolvedAt,
}: Props) {
  const router = useRouter();
  const [status, setStatus] = useState(currentStatus);
  const [resolutionNote, setResolutionNote] = useState(currentResolutionNote ?? "");
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
      setMsg("AI processing completed successfully.");
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

        {msg ? (
          <div className={msgType === "error" ? styles.messageError : styles.message}>
            {msg}
          </div>
        ) : null}
      </div>
    </article>
  );
}