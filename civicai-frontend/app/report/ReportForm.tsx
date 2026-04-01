"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import styles from "./report.module.css";

export default function ReportForm({ userId }: { userId: string }) {
  const router = useRouter();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [msgType, setMsgType] = useState<"info" | "error">("info");
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);

    if (!title.trim() || !description.trim()) {
      setMsgType("error");
      setMsg("Please complete both the title and description fields.");
      return;
    }

    setLoading(true);

    const { error } = await supabase.from("complaints").insert({
      title: title.trim(),
      description: description.trim(),
      created_by: userId,
      status: "submitted",
    });

    setLoading(false);

    if (error) {
      setMsgType("error");
      setMsg(`Unable to submit complaint: ${error.message}`);
      return;
    }

    setTitle("");
    setDescription("");
    setMsgType("info");
    setMsg("Your complaint has been submitted successfully. Redirecting...");
    setTimeout(() => router.replace("/"), 900);
  }

  return (
    <main className={styles.page}>
      <div className={styles.wrapper}>
        <section className={styles.hero}>
          <p className={styles.eyebrow}>Verified complaint reporting</p>
          <h1 className={styles.title}>Report a civic complaint</h1>
          <p className={styles.subtitle}>
            Submit a clear summary and a detailed description so the issue can be
            reviewed more effectively.
          </p>
        </section>

        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <h2 className={styles.cardTitle}>Complaint details</h2>
            <p className={styles.cardText}>
              Provide a short title and enough detail to explain the location,
              condition, and impact of the issue.
            </p>
          </div>

          <form onSubmit={submit} className={styles.form}>
            <div>
              <label className={styles.label}>Title</label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="For example, Broken street light near main road"
                className={styles.input}
                disabled={loading}
              />
            </div>

            <div>
              <label className={styles.label}>Description</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe the problem, location, when you noticed it, and any important details..."
                className={`${styles.input} ${styles.textarea}`}
                disabled={loading}
              />
            </div>

            <button type="submit" disabled={loading} className={styles.primaryButton}>
              {loading ? "Submitting..." : "Submit complaint"}
            </button>
          </form>

          {msg && (
            <div
              className={`${styles.alert} ${
                msgType === "error" ? styles.alertError : styles.alertInfo
              }`}
            >
              {msg}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}