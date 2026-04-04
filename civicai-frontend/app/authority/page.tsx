import { redirect } from "next/navigation";
import Link from "next/link";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

type ComplaintRow = {
  id: string;
  title: string | null;
  description: string;
  reporter_name: string | null;
  district: string | null;
  upazila: string | null;
  city_area: string | null;
  address_label: string | null;
  status: string;
  created_at: string;
  complaint_media: {
    public_url: string | null;
  }[] | null;
  inference_results: {
    fusion_label: string | null;
    fusion_confidence: number | null;
    priority: string | null;
    priority_score: number | null;
    conflict_flag: boolean;
    summary: string | null;
  }[] | null;
};

function formatDate(value: string) {
  return new Date(value).toLocaleString("en-BD", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function badgeStyle(status: string) {
  switch (status) {
    case "submitted":
      return {
        background: "#eff6ff",
        color: "#1d4ed8",
        border: "1px solid #bfdbfe",
      };
    case "processing":
      return {
        background: "#fffbeb",
        color: "#b45309",
        border: "1px solid #fde68a",
      };
    case "completed":
      return {
        background: "#ecfdf5",
        color: "#047857",
        border: "1px solid #a7f3d0",
      };
    case "resolved":
      return {
        background: "#ecfdf5",
        color: "#047857",
        border: "1px solid #a7f3d0",
      };
    case "rejected":
      return {
        background: "#fef2f2",
        color: "#991b1b",
        border: "1px solid #fecaca",
      };
    default:
      return {
        background: "#f8fafc",
        color: "#475569",
        border: "1px solid #cbd5e1",
      };
  }
}

export default async function AuthorityPage() {
  const cookieStore = await cookies();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set() {},
        remove() {},
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/authority");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, is_verified")
    .eq("id", user.id)
    .single();

  if (!profile?.is_verified) {
    redirect("/login?next=/authority&verify=1");
  }

  if (profile.role !== "authority") {
    redirect("/");
  }

  const { data, error } = await supabase
    .from("complaints")
    .select(`
      id,
      title,
      description,
      reporter_name,
      district,
      upazila,
      city_area,
      address_label,
      status,
      created_at,
      complaint_media (
        public_url
      ),
      inference_results (
        fusion_label,
        fusion_confidence,
        priority,
        priority_score,
        conflict_flag,
        summary
      )
    `)
    .order("created_at", { ascending: false });

  if (error) {
    return (
      <main style={{ padding: "32px", maxWidth: 1200, margin: "0 auto" }}>
        <h1 style={{ fontSize: "2rem", fontWeight: 800, marginBottom: 12 }}>
          Authority dashboard
        </h1>
        <div
          style={{
            padding: 16,
            borderRadius: 14,
            border: "1px solid #fecaca",
            background: "#fef2f2",
            color: "#991b1b",
          }}
        >
          Failed to load complaints: {error.message}
        </div>
      </main>
    );
  }

  const complaints = (data ?? []) as ComplaintRow[];

  return (
    <main
      style={{
        minHeight: "100vh",
        background:
          "linear-gradient(180deg, rgba(15,118,110,0.06) 0%, rgba(15,118,110,0) 28%), #f8fafc",
      }}
    >
      <div style={{ maxWidth: 1240, margin: "0 auto", padding: "42px 20px 64px" }}>
        <section style={{ marginBottom: 28 }}>
          <p
            style={{
              margin: 0,
              fontSize: "0.8rem",
              fontWeight: 800,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "#0f766e",
            }}
          >
            Authority review workspace
          </p>
          <h1
            style={{
              margin: "10px 0 0",
              fontSize: "clamp(2rem, 4vw, 3rem)",
              lineHeight: 1.08,
              letterSpacing: "-0.03em",
              color: "#0f172a",
              fontWeight: 800,
            }}
          >
            Complaint review dashboard
          </h1>
          <p
            style={{
              margin: "14px 0 0",
              maxWidth: 760,
              color: "#475569",
              lineHeight: 1.7,
              fontSize: "1rem",
            }}
          >
            Review citizen complaints with AI-assisted category, confidence, and
            priority signals before taking action.
          </p>
        </section>

        <section
          style={{
            background: "#ffffff",
            border: "1px solid #dbe3e8",
            borderRadius: 22,
            boxShadow: "0 18px 40px rgba(15,23,42,0.08)",
            padding: 24,
          }}
        >
          <div
            style={{
              display: "grid",
              gap: 18,
            }}
          >
            {complaints.length === 0 ? (
              <div
                style={{
                  padding: 24,
                  borderRadius: 16,
                  border: "1px solid #e2e8f0",
                  background: "#f8fafc",
                  color: "#475569",
                }}
              >
                No complaints available yet.
              </div>
            ) : (
              complaints.map((complaint) => {
                const media = complaint.complaint_media?.[0];
                const ai = complaint.inference_results?.[0];
                const area =
                  complaint.city_area || complaint.upazila || complaint.district || "Unknown";
                const statusChip = badgeStyle(complaint.status);

                return (
                  <article
                    key={complaint.id}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "180px minmax(0, 1fr)",
                      gap: 18,
                      padding: 18,
                      borderRadius: 18,
                      border: "1px solid #e2e8f0",
                      background: "#fcfdff",
                    }}
                  >
                    <div
                      style={{
                        width: "100%",
                        aspectRatio: "16 / 11",
                        borderRadius: 14,
                        overflow: "hidden",
                        border: "1px solid #dbe3e8",
                        background: "#f8fafc",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      {media?.public_url ? (
                        <img
                          src={media.public_url}
                          alt={complaint.title ?? "Complaint image"}
                          style={{
                            width: "100%",
                            height: "100%",
                            objectFit: "cover",
                            display: "block",
                          }}
                        />
                      ) : (
                        <span style={{ color: "#64748b", fontSize: "0.9rem" }}>
                          No image
                        </span>
                      )}
                    </div>

                    <div style={{ minWidth: 0 }}>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          gap: 12,
                          alignItems: "flex-start",
                          flexWrap: "wrap",
                        }}
                      >
                        <div style={{ minWidth: 0 }}>
                          <h2
                            style={{
                              margin: 0,
                              fontSize: "1.15rem",
                              fontWeight: 800,
                              color: "#0f172a",
                            }}
                          >
                            {complaint.title || "Untitled complaint"}
                          </h2>
                          <p
                            style={{
                              margin: "8px 0 0",
                              color: "#64748b",
                              fontSize: "0.92rem",
                            }}
                          >
                            Reporter: {complaint.reporter_name || "Unknown"} • Area: {area}
                          </p>
                        </div>

                        <div
                          style={{
                            padding: "7px 11px",
                            borderRadius: 999,
                            fontSize: "0.8rem",
                            fontWeight: 800,
                            ...statusChip,
                          }}
                        >
                          {complaint.status}
                        </div>
                      </div>

                      <p
                        style={{
                          margin: "14px 0 0",
                          color: "#334155",
                          lineHeight: 1.65,
                          fontSize: "0.94rem",
                        }}
                      >
                        {ai?.summary || complaint.description}
                      </p>

                      <div
                        style={{
                          display: "flex",
                          flexWrap: "wrap",
                          gap: 10,
                          marginTop: 14,
                        }}
                      >
                        <span
                          style={{
                            padding: "7px 10px",
                            borderRadius: 999,
                            background: "#ecfeff",
                            border: "1px solid #bae6fd",
                            color: "#0f766e",
                            fontSize: "0.8rem",
                            fontWeight: 800,
                          }}
                        >
                          AI: {ai?.fusion_label || "Pending"}
                        </span>

                        <span
                          style={{
                            padding: "7px 10px",
                            borderRadius: 999,
                            background: "#f8fafc",
                            border: "1px solid #cbd5e1",
                            color: "#334155",
                            fontSize: "0.8rem",
                            fontWeight: 800,
                          }}
                        >
                          Confidence:{" "}
                          {ai?.fusion_confidence != null
                            ? `${(ai.fusion_confidence * 100).toFixed(1)}%`
                            : "Pending"}
                        </span>

                        <span
                          style={{
                            padding: "7px 10px",
                            borderRadius: 999,
                            background:
                              ai?.priority === "high"
                                ? "#fef2f2"
                                : ai?.priority === "medium"
                                ? "#fffbeb"
                                : "#f0fdf4",
                            border:
                              ai?.priority === "high"
                                ? "1px solid #fecaca"
                                : ai?.priority === "medium"
                                ? "1px solid #fde68a"
                                : "1px solid #bbf7d0",
                            color:
                              ai?.priority === "high"
                                ? "#991b1b"
                                : ai?.priority === "medium"
                                ? "#92400e"
                                : "#166534",
                            fontSize: "0.8rem",
                            fontWeight: 800,
                          }}
                        >
                          Priority: {ai?.priority || "Pending"}
                        </span>

                        {ai?.conflict_flag ? (
                          <span
                            style={{
                              padding: "7px 10px",
                              borderRadius: 999,
                              background: "#fff7ed",
                              border: "1px solid #fdba74",
                              color: "#9a3412",
                              fontSize: "0.8rem",
                              fontWeight: 800,
                            }}
                          >
                            Text/Image conflict
                          </span>
                        ) : null}
                      </div>

                      <div
                        style={{
                          marginTop: 16,
                          display: "flex",
                          justifyContent: "space-between",
                          gap: 12,
                          alignItems: "center",
                          flexWrap: "wrap",
                        }}
                      >
                        <span style={{ color: "#64748b", fontSize: "0.86rem" }}>
                          Submitted: {formatDate(complaint.created_at)}
                        </span>

                        <Link
                          href={`/authority/${complaint.id}`}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            textDecoration: "none",
                            padding: "10px 14px",
                            borderRadius: 12,
                            background: "#0f766e",
                            border: "1px solid #0f766e",
                            color: "#ffffff",
                            fontSize: "0.9rem",
                            fontWeight: 800,
                          }}
                        >
                          Open review
                        </Link>
                      </div>
                    </div>
                  </article>
                );
              })
            )}
          </div>
        </section>
      </div>
    </main>
  );
}