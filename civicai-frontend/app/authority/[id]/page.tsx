import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import AuthorityActionPanel from "./AuthorityActionPanel";

type ComplaintDetail = {
  id: string;
  title: string | null;
  description: string;
  reporter_name: string | null;
  division: string | null;
  district: string | null;
  upazila: string | null;
  city_area: string | null;
  location_details: string | null;
  address_label: string | null;
  lat: number | null;
  lng: number | null;
  status: string;
  resolution_note: string | null;
  resolved_at: string | null;
  created_at: string;
};

type ComplaintMediaRow = {
  complaint_id: string;
  public_url: string | null;
  original_filename: string | null;
  created_at: string;
};

type InferenceRow = {
  complaint_id: string;
  text_label: string | null;
  text_confidence: number | null;
  image_labels: string[] | null;
  image_confidences: number[] | null;
  image_boxes: number[][] | null;
  fusion_label: string | null;
  fusion_confidence: number | null;
  conflict_flag: boolean | null;
  priority: string | null;
  priority_score: number | null;
  summary: string | null;
  model_versions: Record<string, string> | null;
  detected_image_url: string | null;
  detected_image_path: string | null;
  created_at: string | null;
  updated_at: string | null;
};

function formatDate(value: string) {
  return new Date(value).toLocaleString("en-BD", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function nicePercent(value?: number | null) {
  if (value == null) return "Pending";
  return `${(value * 100).toFixed(1)}%`;
}

function statusChip(status: string) {
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

function priorityChip(priority?: string | null) {
  switch (priority) {
    case "high":
      return {
        background: "#fef2f2",
        color: "#991b1b",
        border: "1px solid #fecaca",
      };
    case "medium":
      return {
        background: "#fffbeb",
        color: "#92400e",
        border: "1px solid #fde68a",
      };
    case "low":
      return {
        background: "#f0fdf4",
        color: "#166534",
        border: "1px solid #bbf7d0",
      };
    default:
      return {
        background: "#f8fafc",
        color: "#475569",
        border: "1px solid #cbd5e1",
      };
  }
}

export default async function AuthorityComplaintDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
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
    redirect(`/login?next=/authority/${id}`);
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, is_verified")
    .eq("id", user.id)
    .single();

  if (!profile?.is_verified) {
    redirect(`/login?next=/authority/${id}&verify=1`);
  }

  if (profile.role !== "authority") {
    redirect("/");
  }

  const { data: complaintData, error } = await supabase
    .from("complaints")
    .select(`
      id,
      title,
      description,
      reporter_name,
      division,
      district,
      upazila,
      city_area,
      location_details,
      address_label,
      lat,
      lng,
      status,
      resolution_note,
      resolved_at,
      created_at
    `)
    .eq("id", id)
    .single();

  if (error || !complaintData) {
    notFound();
  }

  const complaint = complaintData as ComplaintDetail;

  const { data: mediaRows } = await supabase
    .from("complaint_media")
    .select("complaint_id, public_url, original_filename, created_at")
    .eq("complaint_id", id)
    .eq("media_type", "image")
    .order("created_at", { ascending: true })
    .limit(1);

  const { data: inferenceRow } = await supabase
    .from("inference_results")
    .select(`
      complaint_id,
      text_label,
      text_confidence,
      image_labels,
      image_confidences,
      image_boxes,
      fusion_label,
      fusion_confidence,
      conflict_flag,
      priority,
      priority_score,
      summary,
      model_versions,
      detected_image_url,
      detected_image_path,
      created_at,
      updated_at
    `)
    .eq("complaint_id", id)
    .maybeSingle();

  const media = ((mediaRows ?? [])[0] ?? null) as ComplaintMediaRow | null;
  const ai = (inferenceRow ?? null) as InferenceRow | null;
  const statusStyles = statusChip(complaint.status);
  const priorityStyles = priorityChip(ai?.priority);

  return (
    <main
      style={{
        minHeight: "100vh",
        background:
          "linear-gradient(180deg, rgba(15,118,110,0.06) 0%, rgba(15,118,110,0) 28%), #f8fafc",
      }}
    >
      <div style={{ maxWidth: 1280, margin: "0 auto", padding: "40px 20px 64px" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 16,
            alignItems: "flex-start",
            flexWrap: "wrap",
            marginBottom: 24,
          }}
        >
          <div>
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
              Authority review
            </p>
            <h1
              style={{
                margin: "10px 0 0",
                fontSize: "clamp(1.8rem, 4vw, 2.7rem)",
                lineHeight: 1.08,
                letterSpacing: "-0.03em",
                color: "#0f172a",
                fontWeight: 800,
              }}
            >
              {complaint.title || "Complaint detail"}
            </h1>
            <p
              style={{
                margin: "12px 0 0",
                color: "#64748b",
                fontSize: "0.96rem",
                lineHeight: 1.7,
              }}
            >
              Submitted by {complaint.reporter_name || "Unknown"} on{" "}
              {formatDate(complaint.created_at)}
            </p>
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <div
              style={{
                padding: "8px 12px",
                borderRadius: 999,
                fontSize: "0.8rem",
                fontWeight: 800,
                ...statusStyles,
              }}
            >
              {complaint.status}
            </div>

            <div
              style={{
                padding: "8px 12px",
                borderRadius: 999,
                fontSize: "0.8rem",
                fontWeight: 800,
                ...priorityStyles,
              }}
            >
              Priority: {ai?.priority || "Pending"}
            </div>

            <Link
              href="/authority"
              style={{
                textDecoration: "none",
                padding: "9px 14px",
                borderRadius: 12,
                border: "1px solid #cbd5e1",
                background: "#ffffff",
                color: "#0f172a",
                fontSize: "0.9rem",
                fontWeight: 800,
              }}
            >
              Back to dashboard
            </Link>
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1.15fr) minmax(320px, 0.85fr)",
            gap: 22,
          }}
        >
          <section style={{ display: "grid", gap: 22 }}>
            <article
              style={{
                background: "#ffffff",
                border: "1px solid #dbe3e8",
                borderRadius: 22,
                boxShadow: "0 18px 40px rgba(15,23,42,0.08)",
                padding: 22,
              }}
            >
              <h2 style={{ margin: 0, fontSize: "1.08rem", fontWeight: 800, color: "#0f172a" }}>
                Complaint summary
              </h2>

              <div style={{ marginTop: 16, display: "grid", gap: 16 }}>
                <div>
                  <p style={{ margin: 0, fontSize: "0.84rem", fontWeight: 800, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    Description
                  </p>
                  <p style={{ margin: "8px 0 0", color: "#334155", lineHeight: 1.75, fontSize: "0.96rem" }}>
                    {complaint.description}
                  </p>
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                    gap: 16,
                  }}
                >
                  <div>
                    <p style={{ margin: 0, fontSize: "0.84rem", fontWeight: 800, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                      Address
                    </p>
                    <p style={{ margin: "8px 0 0", color: "#0f172a", lineHeight: 1.7 }}>
                      {complaint.address_label || "Not provided"}
                    </p>
                  </div>

                  <div>
                    <p style={{ margin: 0, fontSize: "0.84rem", fontWeight: 800, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                      Administrative area
                    </p>
                    <p style={{ margin: "8px 0 0", color: "#0f172a", lineHeight: 1.7 }}>
                      {[complaint.city_area, complaint.upazila, complaint.district, complaint.division]
                        .filter(Boolean)
                        .join(", ") || "Not provided"}
                    </p>
                  </div>

                  <div>
                    <p style={{ margin: 0, fontSize: "0.84rem", fontWeight: 800, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                      Location details
                    </p>
                    <p style={{ margin: "8px 0 0", color: "#0f172a", lineHeight: 1.7 }}>
                      {complaint.location_details || "Not provided"}
                    </p>
                  </div>

                  <div>
                    <p style={{ margin: 0, fontSize: "0.84rem", fontWeight: 800, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                      Coordinates
                    </p>
                    <p style={{ margin: "8px 0 0", color: "#0f172a", lineHeight: 1.7 }}>
                      {complaint.lat != null && complaint.lng != null
                        ? `${complaint.lat}, ${complaint.lng}`
                        : "Not provided"}
                    </p>
                  </div>
                </div>
              </div>
            </article>

            <article
              style={{
                background: "#ffffff",
                border: "1px solid #dbe3e8",
                borderRadius: 22,
                boxShadow: "0 18px 40px rgba(15,23,42,0.08)",
                padding: 22,
              }}
            >
              <h2 style={{ margin: 0, fontSize: "1.08rem", fontWeight: 800, color: "#0f172a" }}>
                Complaint image
              </h2>

              <div
                style={{
                  marginTop: 16,
                  borderRadius: 18,
                  overflow: "hidden",
                  border: "1px solid #dbe3e8",
                  background: "#f8fafc",
                  minHeight: 280,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {media?.public_url ? (
                  <img
                    src={media.public_url}
                    alt={complaint.title || "Complaint image"}
                    style={{
                      display: "block",
                      width: "100%",
                      maxHeight: 560,
                      objectFit: "contain",
                      background: "#f8fafc",
                    }}
                  />
                ) : (
                  <span style={{ color: "#64748b", fontSize: "0.95rem" }}>
                    No image uploaded
                  </span>
                )}
              </div>

              {media?.original_filename ? (
                <p style={{ margin: "10px 0 0", color: "#64748b", fontSize: "0.88rem" }}>
                  File: {media.original_filename}
                </p>
              ) : null}
            </article>

            {ai?.detected_image_url ? (
              <article
                style={{
                  background: "#ffffff",
                  border: "1px solid #dbe3e8",
                  borderRadius: 22,
                  boxShadow: "0 18px 40px rgba(15,23,42,0.08)",
                  padding: 22,
                }}
              >
                <h2 style={{ margin: 0, fontSize: "1.08rem", fontWeight: 800, color: "#0f172a" }}>
                  Detected image output
                </h2>

                <div
                  style={{
                    marginTop: 16,
                    borderRadius: 18,
                    overflow: "hidden",
                    border: "1px solid #dbe3e8",
                    background: "#f8fafc",
                    minHeight: 280,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <img
                    src={ai.detected_image_url}
                    alt="Detected complaint output"
                    style={{
                      display: "block",
                      width: "100%",
                      maxHeight: 560,
                      objectFit: "contain",
                      background: "#f8fafc",
                    }}
                  />
                </div>
              </article>
            ) : null}
          </section>

          <aside style={{ display: "grid", gap: 22 }}>
            <AuthorityActionPanel
              complaintId={complaint.id}
              currentStatus={complaint.status}
              currentResolutionNote={complaint.resolution_note}
              resolvedAt={complaint.resolved_at}
            />

            <article
              style={{
                background: "#ffffff",
                border: "1px solid #dbe3e8",
                borderRadius: 22,
                boxShadow: "0 18px 40px rgba(15,23,42,0.08)",
                padding: 22,
              }}
            >
              <h2 style={{ margin: 0, fontSize: "1.08rem", fontWeight: 800, color: "#0f172a" }}>
                AI review summary
              </h2>

              <div style={{ marginTop: 16, display: "grid", gap: 14 }}>
                <div
                  style={{
                    padding: 14,
                    borderRadius: 16,
                    border: "1px solid #dbe7ec",
                    background: "#f8fbfc",
                  }}
                >
                  <p style={{ margin: 0, fontSize: "0.82rem", fontWeight: 800, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    Fusion label
                  </p>
                  <p style={{ margin: "8px 0 0", fontSize: "1rem", fontWeight: 800, color: "#0f172a" }}>
                    {ai?.fusion_label || "Pending"}
                  </p>
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                    gap: 12,
                  }}
                >
                  <div
                    style={{
                      padding: 14,
                      borderRadius: 16,
                      border: "1px solid #e2e8f0",
                      background: "#ffffff",
                    }}
                  >
                    <p style={{ margin: 0, fontSize: "0.82rem", fontWeight: 800, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                      Fusion confidence
                    </p>
                    <p style={{ margin: "8px 0 0", fontSize: "1rem", fontWeight: 800, color: "#0f172a" }}>
                      {nicePercent(ai?.fusion_confidence)}
                    </p>
                  </div>

                  <div
                    style={{
                      padding: 14,
                      borderRadius: 16,
                      border: "1px solid #e2e8f0",
                      background: "#ffffff",
                    }}
                  >
                    <p style={{ margin: 0, fontSize: "0.82rem", fontWeight: 800, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                      Priority score
                    </p>
                    <p style={{ margin: "8px 0 0", fontSize: "1rem", fontWeight: 800, color: "#0f172a" }}>
                      {ai?.priority_score != null ? ai.priority_score.toFixed(1) : "Pending"}
                    </p>
                  </div>
                </div>

                <div
                  style={{
                    padding: 14,
                    borderRadius: 16,
                    border: ai?.conflict_flag ? "1px solid #fdba74" : "1px solid #cbd5e1",
                    background: ai?.conflict_flag ? "#fff7ed" : "#f8fafc",
                  }}
                >
                  <p style={{ margin: 0, fontSize: "0.82rem", fontWeight: 800, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    Consistency check
                  </p>
                  <p
                    style={{
                      margin: "8px 0 0",
                      fontSize: "0.95rem",
                      fontWeight: 700,
                      color: ai?.conflict_flag ? "#9a3412" : "#0f172a",
                    }}
                  >
                    {ai?.conflict_flag ? "Text and image signals conflict" : "No major conflict detected"}
                  </p>
                </div>

                <div
                  style={{
                    padding: 14,
                    borderRadius: 16,
                    border: "1px solid #e2e8f0",
                    background: "#ffffff",
                  }}
                >
                  <p style={{ margin: 0, fontSize: "0.82rem", fontWeight: 800, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    Summary
                  </p>
                  <p style={{ margin: "8px 0 0", lineHeight: 1.7, color: "#334155", fontSize: "0.93rem" }}>
                    {ai?.summary || "No AI summary available yet."}
                  </p>
                </div>
              </div>
            </article>

            <article
              style={{
                background: "#ffffff",
                border: "1px solid #dbe3e8",
                borderRadius: 22,
                boxShadow: "0 18px 40px rgba(15,23,42,0.08)",
                padding: 22,
              }}
            >
              <h2 style={{ margin: 0, fontSize: "1.08rem", fontWeight: 800, color: "#0f172a" }}>
                Model outputs
              </h2>

              <div style={{ marginTop: 16, display: "grid", gap: 16 }}>
                <div>
                  <p style={{ margin: 0, fontSize: "0.82rem", fontWeight: 800, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    Text model
                  </p>
                  <p style={{ margin: "8px 0 0", color: "#0f172a", lineHeight: 1.7 }}>
                    Label: {ai?.text_label || "Pending"}
                  </p>
                  <p style={{ margin: "4px 0 0", color: "#64748b", lineHeight: 1.7 }}>
                    Confidence: {nicePercent(ai?.text_confidence)}
                  </p>
                </div>

                <div>
                  <p style={{ margin: 0, fontSize: "0.82rem", fontWeight: 800, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    Image model
                  </p>

                  {ai?.image_labels && ai.image_labels.length > 0 ? (
                    <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
                      {ai.image_labels.map((label, index) => (
                        <div
                          key={`${label}-${index}`}
                          style={{
                            padding: 10,
                            borderRadius: 12,
                            border: "1px solid #e2e8f0",
                            background: "#f8fafc",
                            color: "#0f172a",
                            fontSize: "0.9rem",
                          }}
                        >
                          <strong>{label}</strong>
                          <span style={{ color: "#64748b" }}>
                            {" "}
                            — {nicePercent(ai.image_confidences?.[index] ?? null)}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p style={{ margin: "8px 0 0", color: "#64748b", lineHeight: 1.7 }}>
                      No image detections available.
                    </p>
                  )}
                </div>

                <div>
                  <p style={{ margin: 0, fontSize: "0.82rem", fontWeight: 800, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    Model versions
                  </p>

                  {ai?.model_versions ? (
                    <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
                      {Object.entries(ai.model_versions).map(([key, value]) => (
                        <div
                          key={key}
                          style={{
                            padding: 10,
                            borderRadius: 12,
                            border: "1px solid #e2e8f0",
                            background: "#f8fafc",
                            fontSize: "0.9rem",
                            color: "#0f172a",
                          }}
                        >
                          <strong>{key}</strong>: {value}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p style={{ margin: "8px 0 0", color: "#64748b", lineHeight: 1.7 }}>
                      No model version information available.
                    </p>
                  )}
                </div>
              </div>
            </article>
          </aside>
        </div>
      </div>
    </main>
  );
}