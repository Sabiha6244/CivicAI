"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "../authority.module.css";

type Props = {
  complaintId: string;
  complaintTitle: string;
  reporterName: string;
  areaText: string;
  currentStatus: string;
  currentResolutionNote: string | null;
  resolvedAt: string | null;
  currentFinalCategory?: string | null;
  suggestedCategory?: string | null;
  reliabilityStatus?: string | null;
  manualReviewRequired?: boolean;
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

function toStatusTitle(status: string) {
  switch (status) {
    case "submitted":
      return "Submitted";
    case "processing":
      return "Processing";
    case "completed":
      return "Completed";
    case "resolved":
      return "Resolved";
    case "rejected":
      return "Rejected";
    default:
      return status;
  }
}

function defaultEmailMessage(status: string, category: string, note: string, title: string, areaText: string) {
  const safeCategory = category || "under authority review";
  const safeNote = note.trim();

  switch (status) {
    case "processing":
      return `Hello,

Your complaint "${title}" for ${areaText} is now under authority processing.

Current working category: ${safeCategory}

${safeNote ? `Authority note: ${safeNote}` : "The authority team has started reviewing the issue and will update you again after field verification."}

Regards,
CivicAI Authority Team`;

    case "resolved":
    case "completed":
      return `Hello,

Your complaint "${title}" for ${areaText} has been marked as ${toStatusTitle(status).toLowerCase()}.

Final category: ${safeCategory}

${safeNote ? `Resolution update: ${safeNote}` : "The authority has closed this complaint after review."}

Regards,
CivicAI Authority Team`;

    case "rejected":
      return `Hello,

Your complaint "${title}" for ${areaText} has been marked as rejected after authority review.

Final category: ${safeCategory}

${safeNote ? `Review note: ${safeNote}` : "The complaint could not be accepted in its current form."}

Regards,
CivicAI Authority Team`;

    default:
      return `Hello,

Your complaint "${title}" for ${areaText} has received an authority status update.

Current status: ${toStatusTitle(status)}
Current category: ${safeCategory}

${safeNote ? `Authority note: ${safeNote}` : "Please check the latest complaint status in the platform."}

Regards,
CivicAI Authority Team`;
  }
}

export default function AuthorityActionPanel({
  complaintId,
  complaintTitle,
  reporterName,
  areaText,
  currentStatus,
  currentResolutionNote,
  resolvedAt,
  currentFinalCategory,
  suggestedCategory,
  reliabilityStatus,
  manualReviewRequired,
}: Props) {
  const router = useRouter();
  const [status, setStatus] = useState(currentStatus);
  const [resolutionNote, setResolutionNote] = useState(currentResolutionNote ?? "");
  const [finalCategory, setFinalCategory] = useState(currentFinalCategory ?? "");
  const [saving, setSaving] = useState(false);
  const [runningAi, setRunningAi] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [msgType, setMsgType] = useState<"info" | "error">("info");
  const [notifyReporter, setNotifyReporter] = useState(true);

  const effectiveCategory = finalCategory || suggestedCategory || "Not selected";
  const emailSubject = useMemo(
    () => `CivicAI status update: ${toStatusTitle(status)} - ${complaintTitle}`,
    [status, complaintTitle]
  );

  const emailBody = useMemo(
    () =>
      defaultEmailMessage(
        status,
        effectiveCategory,
        resolutionNote,
        complaintTitle,
        areaText
      ),
    [status, effectiveCategory, resolutionNote, complaintTitle, areaText]
  );

  async function saveUpdate() {
    setSaving(true);
    setMsg(null);

    if ((status === "resolved" || status === "completed" || status === "rejected") && !resolutionNote.trim()) {
      setMsgType("error");
      setMsg("Please write a resolution or review note before saving this final status.");
      setSaving(false);
      return;
    }

    if ((status === "processing" || status === "resolved" || status === "completed" || status === "rejected") && !finalCategory.trim()) {
      setMsgType("error");
      setMsg("Please confirm the final category before saving this authority decision.");
      setSaving(false);
      return;
    }

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
          notify_reporter: notifyReporter,
          email_subject: emailSubject,
          email_text: emailBody,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data?.error || "Failed to update complaint.");
      }

      setMsgType("info");
      setMsg(
        notifyReporter
          ? "Complaint updated successfully. Reporter notification request was sent with this save action."
          : "Complaint updated successfully."
      );
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
            Confirm category, reliability, and evidence first. Then save the authority decision
            and optionally send a status update email to the complainant.
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

        <div className={styles.infoBox}>
          <p className={styles.kvLabel}>Current decision summary</p>
          <p className={styles.kvValue}>
            Working category: {effectiveCategory}. Reliability: {reliabilityStatus || "not available"}.
            {manualReviewRequired ? " Manual review is currently recommended." : " Manual review is not currently required."}
          </p>
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
          <p className={styles.kvLabel}>Reporter notification</p>
          <p className={styles.kvValue}>
            Prepare an automatic status-update email for {reporterName}. The backend route must
            support the email payload for actual delivery.
          </p>

          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              marginTop: 12,
              fontSize: 15,
              color: "#d9e7ff",
            }}
          >
            <input
              type="checkbox"
              checked={notifyReporter}
              onChange={(e) => setNotifyReporter(e.target.checked)}
              disabled={saving || runningAi}
            />
            <span>Send status email after saving</span>
          </label>
        </div>

        <div className={styles.noteBox}>
          <p className={styles.kvLabel}>Email subject</p>
          <p className={styles.kvValue}>{emailSubject}</p>
        </div>

        <div className={styles.noteBox}>
          <p className={styles.kvLabel}>Email preview</p>
          <p className={styles.kvValue} style={{ whiteSpace: "pre-line" }}>
            {emailBody}
          </p>
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
            Run AI when needed, confirm the final category, write a clean review note,
            then save the authority decision and publish the reporter update.
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
