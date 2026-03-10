import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";

export default async function Home() {
  // Public list (RLS allows anon/auth to read complaints)
  const { data: complaints, error } = await supabase
    .from("v_complaints_dashboard")
    .select("id, title, description, created_at, status, fusion_label, priority")
    .order("created_at", { ascending: false })
    .limit(20);

  return (
    <main style={{ minHeight: "100vh", background: "#f5f7fb" }}>
      <div style={{ maxWidth: 900, margin: "0 auto", padding: "28px 16px" }}>
        {/* Header */}
        <header
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            marginBottom: 16,
          }}
        >
          <div>
            <h1 style={{ margin: 0, fontSize: 26, color: "#111827" }}>CivicAI</h1>
            <p style={{ margin: "6px 0 0", color: "#6b7280", fontSize: 14 }}>
              Report, view, and track local problems (public complaints list).
            </p>
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Link href="/login" style={btnOutline}>
              Login / Register
            </Link>
            <Link href="/report" style={btnPrimary}>
              Report a complaint
            </Link>
          </div>
        </header>

        {/* Content */}
        <section
          style={{
            background: "#fff",
            border: "1px solid #e6e8ef",
            borderRadius: 12,
            boxShadow: "0 6px 18px rgba(20, 20, 43, 0.06)",
            padding: 16,
          }}
        >
          <h2 style={{ margin: "4px 0 12px", fontSize: 18, color: "#111827" }}>
            Recent complaints
          </h2>

          {error ? (
            <div style={alertBox}>
              Error loading complaints: <b>{error.message}</b>
            </div>
          ) : !complaints || complaints.length === 0 ? (
            <div style={emptyBox}>No complaints yet. Be the first to report one.</div>
          ) : (
            <div style={{ display: "grid", gap: 12 }}>
              {complaints.map((c) => (
                <div key={c.id} style={card}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 16, fontWeight: 700, color: "#111827" }}>
                        {c.title?.trim() ? c.title : "Untitled complaint"}
                      </div>
                      <div style={{ marginTop: 6, color: "#374151", fontSize: 14, lineHeight: 1.4 }}>
                        {c.description?.length > 140
                          ? c.description.slice(0, 140) + "…"
                          : c.description}
                      </div>
                    </div>

                    <div style={{ textAlign: "right", minWidth: 150 }}>
                      <Badge label={c.priority ?? "—"} />
                      <div style={{ height: 8 }} />
                      <div style={{ fontSize: 12, color: "#6b7280" }}>
                        {new Date(c.created_at).toLocaleString()}
                      </div>
                    </div>
                  </div>

                  <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <SmallTag label={`Status: ${c.status ?? "—"}`} />
                    <SmallTag label={`AI: ${c.fusion_label ?? "pending"}`} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

/* Simple UI styles */
const btnPrimary: React.CSSProperties = {
  display: "inline-block",
  padding: "10px 14px",
  borderRadius: 10,
  border: "1px solid #2563eb",
  background: "#2563eb",
  color: "#fff",
  fontSize: 14,
  fontWeight: 700,
  textDecoration: "none",
};

const btnOutline: React.CSSProperties = {
  display: "inline-block",
  padding: "10px 14px",
  borderRadius: 10,
  border: "1px solid #d1d5db",
  background: "#fff",
  color: "#111827",
  fontSize: 14,
  fontWeight: 700,
  textDecoration: "none",
};

const card: React.CSSProperties = {
  border: "1px solid #e5e7eb",
  borderRadius: 12,
  padding: 14,
  background: "#fff",
};

const alertBox: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: 10,
  background: "#fff7ed",
  border: "1px solid #fed7aa",
  color: "#9a3412",
  fontSize: 14,
};

const emptyBox: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: 10,
  background: "#f9fafb",
  border: "1px solid #e5e7eb",
  color: "#111827",
  fontSize: 14,
};

function Badge({ label }: { label: string }) {
  const normalized = label.toLowerCase();
  const style: React.CSSProperties = {
    display: "inline-block",
    padding: "4px 10px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 800,
    border: "1px solid #d1d5db",
    background: "#f9fafb",
    color: "#111827",
  };

  if (normalized === "high") {
    style.background = "#fee2e2";
    style.border = "1px solid #fecaca";
    style.color = "#991b1b";
  } else if (normalized === "medium") {
    style.background = "#ffedd5";
    style.border = "1px solid #fed7aa";
    style.color = "#9a3412";
  } else if (normalized === "low") {
    style.background = "#dcfce7";
    style.border = "1px solid #bbf7d0";
    style.color = "#166534";
  }

  return <span style={style}>{label}</span>;
}

function SmallTag({ label }: { label: string }) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "4px 10px",
        borderRadius: 999,
        fontSize: 12,
        border: "1px solid #e5e7eb",
        background: "#f9fafb",
        color: "#374151",
      }}
    >
      {label}
    </span>
  );
}