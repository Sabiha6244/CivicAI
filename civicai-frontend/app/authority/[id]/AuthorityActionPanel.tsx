"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

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

  return (
    <article
      style={{
        background: "#ffffff",
        border: "1px solid #dbe3e8",
        borderRadius: 22,
        boxShadow: "0 18px 40px rgba(15,23,42,0.08)",
        padding: 22,
      }}
    >
      <h2
        style={{
          margin: 0,
          fontSize: "1.08rem",
          fontWeight: 800,
          color: "#0f172a",
        }}
      >
        Authority action panel
      </h2>

      <div style={{ marginTop: 16, display: "grid", gap: 14 }}>
        <div>
          <label
            style={{
              display: "block",
              marginBottom: 8,
              fontSize: "0.84rem",
              fontWeight: 800,
              color: "#334155",
            }}
          >
            Complaint status
          </label>
          <select
  value={status}
  onChange={(e) => setStatus(e.target.value)}
  disabled={saving}
  style={{
    width: "100%",
    padding: "12px 14px",
    borderRadius: 12,
    border: "1px solid #cbd5e1",
    outline: "none",
    fontSize: "0.95rem",
    background: "#ffffff",
    color: "#0f172a",
    boxSizing: "border-box",
  }}
>
  <option value="submitted">submitted</option>
  <option value="processing">processing</option>
  <option value="completed">completed</option>
  <option value="resolved">resolved</option>
  <option value="rejected">rejected</option>
</select>
        </div>

        <div>
          <label
            style={{
              display: "block",
              marginBottom: 8,
              fontSize: "0.84rem",
              fontWeight: 800,
              color: "#334155",
            }}
          >
            Resolution note
          </label>
          <textarea
            value={resolutionNote}
            onChange={(e) => setResolutionNote(e.target.value)}
            disabled={saving}
            placeholder="Write the action taken, field observation, or final resolution note."
            style={{
              width: "100%",
              minHeight: 140,
              padding: "12px 14px",
              borderRadius: 12,
              border: "1px solid #cbd5e1",
              outline: "none",
              fontSize: "0.95rem",
              background: "#ffffff",
              color: "#0f172a",
              boxSizing: "border-box",
              resize: "vertical",
              lineHeight: 1.6,
            }}
          />
        </div>

        <div
          style={{
            padding: 14,
            borderRadius: 16,
            border: "1px solid #e2e8f0",
            background: "#f8fafc",
          }}
        >
          <p
            style={{
              margin: 0,
              fontSize: "0.82rem",
              fontWeight: 800,
              color: "#64748b",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
            Current resolved time
          </p>
          <p
            style={{
              margin: "8px 0 0",
              color: "#0f172a",
              fontSize: "0.94rem",
              lineHeight: 1.7,
            }}
          >
            {resolvedAt ? new Date(resolvedAt).toLocaleString("en-BD") : "Not resolved yet"}
          </p>
        </div>

        <button
          type="button"
          onClick={saveUpdate}
          disabled={saving}
          style={{
            minWidth: 180,
            padding: "13px 18px",
            borderRadius: 12,
            border: "1px solid #0f766e",
            background: saving ? "#99d5cf" : "#0f766e",
            color: "#ffffff",
            fontSize: "0.95rem",
            fontWeight: 800,
            cursor: saving ? "not-allowed" : "pointer",
            boxShadow: saving ? "none" : "0 8px 18px rgba(15,118,110,0.18)",
          }}
        >
          {saving ? "Saving update..." : "Save update"}
        </button>

        {msg ? (
          <div
            style={{
              padding: "12px 14px",
              borderRadius: 12,
              fontSize: "0.92rem",
              lineHeight: 1.5,
              background: msgType === "error" ? "#fef2f2" : "#f0fdfa",
              border:
                msgType === "error"
                  ? "1px solid #fecaca"
                  : "1px solid #99f6e4",
              color: msgType === "error" ? "#991b1b" : "#115e59",
            }}
          >
            {msg}
          </div>
        ) : null}
      </div>
    </article>
  );
}