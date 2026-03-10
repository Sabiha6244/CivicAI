"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabaseClient";

export default function ReportPage() {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);

    if (!title.trim() || !description.trim()) {
      setMsg("Please fill in title and description.");
      return;
    }

    setLoading(true);

    const { data: auth } = await supabase.auth.getUser();
const userId = auth.user?.id ?? null;

if (!userId) {
  setLoading(false);
  setMsg("You must login first to report a complaint.");
  return;
}

// OPTIONAL (recommended): require verified profile
const { data: profile, error: profErr } = await supabase
  .from("profiles")
  .select("is_verified")
  .eq("id", userId)
  .single();

if (profErr) {
  setLoading(false);
  setMsg(`Profile error: ${profErr.message}`);
  return;
}

if (!profile?.is_verified) {
  setLoading(false);
  setMsg("Please verify your email (OTP) before reporting a complaint.");
  return;
}

    const { error } = await supabase.from("complaints").insert({
  title: title.trim(),
  description: description.trim(),
  created_by: userId,
  status: "submitted",
});

    setLoading(false);

    if (error) {
      setMsg(`Error: ${error.message}`);
      return;
    }

    setTitle("");
    setDescription("");
    setMsg("Complaint submitted ✅");
  }

  return (
    <main style={{ minHeight: "100vh", background: "#f5f7fb" }}>
      <div style={{ maxWidth: 700, margin: "0 auto", padding: "28px 16px" }}>
        <div
          style={{
            background: "#fff",
            border: "1px solid #e6e8ef",
            borderRadius: 12,
            boxShadow: "0 6px 18px rgba(20, 20, 43, 0.06)",
            padding: 16,
          }}
        >
          <h1 style={{ margin: 0, fontSize: 22, color: "#111827" }}>Report a complaint</h1>
          <p style={{ margin: "6px 0 16px", color: "#6b7280", fontSize: 14 }}>
            Submit a short title and a detailed description.
          </p>

          <form onSubmit={submit}>
            <label style={label}>Title</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., Broken street light near ULAB gate"
              style={input}
              disabled={loading}
            />

            <div style={{ height: 12 }} />

            <label style={label}>Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe the problem, location, and any important details..."
              style={{ ...input, height: 140, resize: "vertical" }}
              disabled={loading}
            />

            <div style={{ height: 18 }} />

            <button
              type="submit"
              disabled={loading}
              style={{
                width: "100%",
                padding: "11px 12px",
                borderRadius: 10,
                border: "1px solid #2563eb",
                background: loading ? "#93c5fd" : "#2563eb",
                color: "#ffffff",
                fontSize: 14,
                fontWeight: 700,
                cursor: loading ? "not-allowed" : "pointer",
              }}
            >
              {loading ? "Submitting..." : "Submit"}
            </button>
          </form>

          {msg && (
            <div
              style={{
                marginTop: 16,
                padding: "10px 12px",
                borderRadius: 10,
                background: "#f9fafb",
                border: "1px solid #e5e7eb",
                color: "#111827",
                fontSize: 14,
              }}
            >
              {msg}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

const label: React.CSSProperties = {
  display: "block",
  fontSize: 13,
  fontWeight: 700,
  color: "#374151",
  marginBottom: 6,
};

const input: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid #d1d5db",
  outline: "none",
  fontSize: 14,
  color: "#111827",
  background: "#ffffff",
};