import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import AuthorityActionPanel from "./AuthorityActionPanel";
import AuthorityImageLightbox from "./AuthorityImageLightbox";
import styles from "../authority.module.css";

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
  user_category: string | null;
  final_category: string | null;
  category_source: string | null;
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
  if (value == null) return "N/A";
  return `${(value * 100).toFixed(1)}%`;
}

function parseNumber(value?: string | null) {
  if (!value) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function parseBoolean(value?: string | null) {
  if (!value) return false;
  return value.toLowerCase() === "true";
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

function reliabilityLabel(value?: string | null) {
  switch (value) {
    case "reliable":
      return "Reliable";
    case "manual_review_needed":
      return "Manual review needed";
    case "insufficient_evidence":
      return "Insufficient evidence";
    default:
      return "Not available";
  }
}

function reliabilityClass(value?: string | null) {
  switch (value) {
    case "reliable":
      return styles.priorityLow;
    case "manual_review_needed":
      return styles.chipWarn;
    case "insufficient_evidence":
      return styles.priorityHigh;
    default:
      return styles.chip;
  }
}

function ordinal(value?: number | null) {
  if (value == null) return "N/A";
  const v = Math.abs(value);
  const mod10 = v % 10;
  const mod100 = v % 100;
  if (mod10 === 1 && mod100 !== 11) return `${value}st`;
  if (mod10 === 2 && mod100 !== 12) return `${value}nd`;
  if (mod10 === 3 && mod100 !== 13) return `${value}rd`;
  return `${value}th`;
}

function confidenceLabel(value?: number | null) {
  if (value == null) return "Not available";
  if (value >= 0.85) return `High (${nicePercent(value)})`;
  if (value >= 0.6) return `Moderate (${nicePercent(value)})`;
  return `Low (${nicePercent(value)})`;
}

function friendlyEscalation(value?: string | null) {
  switch (value) {
    case "escalate_now":
      return "Needs escalation now";
    case "within_threshold":
      return "Within response window";
    default:
      return "Not available";
  }
}

function reviewRecommendation(
  manualReviewRequired: boolean,
  reliabilityStatus?: string | null
) {
  if (manualReviewRequired || reliabilityStatus === "manual_review_needed") {
    return "Authority should verify the complaint details and evidence before taking action.";
  }
  if (reliabilityStatus === "reliable") {
    return "AI result looks usable as a starting point for authority review.";
  }
  return "Review the complaint details and evidence before acting.";
}

function visualEvidenceText(
  labels?: string[] | null,
  confidences?: number[] | null
) {
  if (!labels || labels.length === 0) return "No clear visual evidence detected.";
  const label = labels[0];
  const conf = confidences?.[0];
  if (conf == null) return label;
  return `${label} (${nicePercent(conf)})`;
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
      created_at,
      user_category,
      final_category,
      category_source
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
  const modelVersions = ai?.model_versions ?? null;

  const reliabilityStatus = modelVersions?.reliability_status ?? null;
  const manualReviewRequired = parseBoolean(modelVersions?.manual_review_required);
  const citizenAiConflict = parseBoolean(modelVersions?.citizen_ai_conflict);

  const priorityStatus = modelVersions?.priority_status ?? null;
  const priorityReason = modelVersions?.priority_reason || null;
  const priorityRank = parseNumber(modelVersions?.priority_rank);
  const escalationStatus =
    modelVersions?.escalation_status || modelVersions?.escalation || null;

  const readableConfidence = confidenceLabel(ai?.fusion_confidence);
  const readableEscalation = friendlyEscalation(escalationStatus);
  const readableReviewRecommendation = reviewRecommendation(
    manualReviewRequired,
    reliabilityStatus
  );
  const readableVisualEvidence = visualEvidenceText(
    ai?.image_labels,
    ai?.image_confidences
  );

  const priorityNote =
    priorityStatus === "computed"
      ? priorityRank != null
        ? `This complaint is currently ranked ${ordinal(
            priorityRank
          )} among open complaints waiting for attention.`
        : "Priority was computed for this complaint."
      : priorityReason || "Priority could not be computed.";

  return (
    <main className={styles.page}>
      <div className={styles.wrapper}>
        <section className={styles.pageGrid}>
          <aside className={styles.sidebar}>
            <div className={styles.sidebarCard}>
              <p className={styles.sidebarEyebrow}>Authority workspace</p>
              <h2 className={styles.sidebarTitle}>Complaint review</h2>
              <p className={styles.sidebarText}>
                Inspect the complaint, review AI outputs, and save status or
                resolution updates from the action panel.
              </p>

              <nav className={styles.sidebarNav}>
                <Link href="/" className={styles.sidebarLink}>
                  Back to homepage
                </Link>
                <Link href="/authority" className={styles.sidebarLink}>
                  Authority dashboard
                </Link>
                <Link href={`/authority/${id}`} className={styles.sidebarLinkActive}>
                  Current complaint
                </Link>
              </nav>
            </div>
          </aside>

          <div className={styles.mainContent}>
            <section className={styles.detailHero}>
              <div className={styles.detailTop}>
                <div className={styles.detailMetaBlock}>
                  <p className={styles.eyebrow}>Authority review</p>
                  <h1 className={styles.title}>
                    {complaint.title || "Complaint detail"}
                  </h1>
                  <p className={styles.subtitle}>
                    Review this case, verify the evidence, and update its final
                    handling from the authority action panel.
                  </p>

                  <div className={styles.detailMetaRow}>
                    <span className={styles.metaPill}>
                      Reporter: {complaint.reporter_name || "Unknown"}
                    </span>
                    <span className={styles.metaPill}>
                      Submitted: {formatDate(complaint.created_at)}
                    </span>
                    <span className={styles.metaPill}>
                      Area:{" "}
                      {[complaint.city_area, complaint.upazila, complaint.district]
                        .filter(Boolean)
                        .join(", ") || "Not provided"}
                    </span>
                  </div>
                </div>

                <div className={styles.detailActions}>
                  <span className={statusClass(complaint.status)}>
                    {complaint.status}
                  </span>
                  <Link href="/authority" className={styles.secondaryLink}>
                    Back to dashboard
                  </Link>
                </div>
              </div>
            </section>

            <div className={styles.detailGrid}>
              <section className={styles.leftColumn}>
                <article className={styles.panel}>
                  <h2 className={styles.panelTitle}>Case overview</h2>

                  <div className={styles.panelBody}>
                    <div className={styles.kvBlock}>
                      <p className={styles.kvLabel}>Complaint description</p>
                      <p className={styles.kvValue}>{complaint.description}</p>
                    </div>

                    <div className={styles.kvGrid}>
                      <div className={styles.kvBlock}>
                        <p className={styles.kvLabel}>Address</p>
                        <p className={styles.kvValue}>
                          {complaint.address_label || "Not provided"}
                        </p>
                      </div>

                      <div className={styles.kvBlock}>
                        <p className={styles.kvLabel}>Administrative area</p>
                        <p className={styles.kvValue}>
                          {[
                            complaint.city_area,
                            complaint.upazila,
                            complaint.district,
                            complaint.division,
                            complaint.division,
                          ]
                            .filter(Boolean)
                            .join(", ") || "Not provided"}
                        </p>
                      </div>

                      <div className={styles.kvBlock}>
                        <p className={styles.kvLabel}>Location details</p>
                        <p className={styles.kvValue}>
                          {complaint.location_details || "Not provided"}
                        </p>
                      </div>

                      <div className={styles.kvBlock}>
                        <p className={styles.kvLabel}>Coordinates</p>
                        <p className={styles.kvValue}>
                          {complaint.lat != null && complaint.lng != null
                            ? `${complaint.lat}, ${complaint.lng}`
                            : "Not provided"}
                        </p>
                      </div>
                    </div>
                  </div>
                </article>

                <article className={styles.panel}>
                  <h2 className={styles.panelTitle}>Category and review source</h2>

                  <div className={styles.panelBody}>
                    <div className={styles.kvGrid}>
                      <div className={styles.infoBox}>
                        <p className={styles.kvLabel}>Citizen selected category</p>
                        <p className={styles.kvValue}>
                          {complaint.user_category || "Not provided"}
                        </p>
                      </div>

                      <div className={styles.infoBox}>
                        <p className={styles.kvLabel}>AI suggested category</p>
                        <p className={styles.kvValue}>
                          {ai?.fusion_label || "N/A"}
                        </p>
                      </div>

                      <div className={styles.infoBox}>
                        <p className={styles.kvLabel}>Final operational category</p>
                        <p className={styles.kvValue}>
                          {complaint.final_category || "Not set"}
                        </p>
                      </div>

                      <div className={styles.infoBox}>
                        <p className={styles.kvLabel}>Category source</p>
                        <p className={styles.kvValue}>
                          {complaint.category_source || "Not set"}
                        </p>
                      </div>
                    </div>

                    {citizenAiConflict ? (
                      <div className={styles.warningBox}>
                        <p className={styles.kvLabel}>Citizen and AI mismatch</p>
                        <p className={styles.kvValue}>
                          The citizen-selected category and the AI-suggested
                          category do not match. Authority confirmation is
                          recommended.
                        </p>
                      </div>
                    ) : null}
                  </div>
                </article>

                <article className={styles.panel}>
                  <h2 className={styles.panelTitle}>Evidence and images</h2>

                  <div className={styles.panelBody}>
                    <div className={styles.evidenceGrid}>
                      <article className={styles.evidenceCard}>
                        <div className={styles.evidenceCardHead}>
                          <h3 className={styles.evidenceTitle}>Uploaded complaint image</h3>
                          <p className={styles.evidenceCardText}>
                            Original image submitted by the citizen for this complaint.
                          </p>
                        </div>

                        <div className={styles.evidenceMediaSurface}>
                          <div className={styles.thumbWrapLarge}>
                            {media?.public_url ? (
                              <AuthorityImageLightbox
                                src={media.public_url}
                                alt={complaint.title || "Complaint image"}
                              />
                            ) : (
                              <div className={styles.noImageLarge}>No image uploaded</div>
                            )}
                          </div>
                        </div>

                        <div className={styles.evidenceMeta}>
                          <span className={styles.evidenceMetaLabel}>Source file</span>
                          <span className={styles.evidenceMetaValue}>
                            {media?.original_filename || "Not available"}
                          </span>
                        </div>
                      </article>

                      <article className={styles.evidenceCard}>
                        <div className={styles.evidenceCardHead}>
                          <h3 className={styles.evidenceTitle}>Detected image output</h3>
                          <p className={styles.evidenceCardText}>
                            Annotated visual evidence produced by the backend image model.
                          </p>
                        </div>

                        <div className={styles.evidenceMediaSurface}>
                          <div className={styles.detectedWrap}>
                            {ai?.detected_image_url ? (
                              <AuthorityImageLightbox
                                src={ai.detected_image_url}
                                alt="Detected complaint output"
                              />
                            ) : (
                              <div className={styles.noImageLarge}>
                                No detected output available
                              </div>
                            )}
                          </div>
                        </div>

                        <div className={styles.evidenceMeta}>
                          <span className={styles.evidenceMetaLabel}>Visual evidence</span>
                          <span className={styles.evidenceMetaValue}>
                            {readableVisualEvidence}
                          </span>
                        </div>
                      </article>
                    </div>
                  </div>
                </article>

                <article className={styles.panel}>
                  <h2 className={styles.panelTitle}>AI assessment</h2>

                  <div className={styles.panelBody}>
                    <div className={styles.highlightBox}>
                      <p className={styles.kvLabel}>Suggested category</p>
                      <p className={styles.kvValue}>{ai?.fusion_label || "N/A"}</p>
                    </div>

                    <div className={styles.aiStatGrid}>
                      <div className={styles.aiStatCard}>
                        <p className={styles.aiStatLabel}>AI confidence</p>
                        <p className={styles.aiStatValue}>{readableConfidence}</p>
                      </div>

                      <div className={styles.aiStatCard}>
                        <p className={styles.aiStatLabel}>Reliability</p>
                        <p className={styles.aiStatValue}>
                          <span className={reliabilityClass(reliabilityStatus)}>
                            {reliabilityLabel(reliabilityStatus)}
                          </span>
                        </p>
                      </div>

                      <div className={styles.aiStatCard}>
                        <p className={styles.aiStatLabel}>Manual review</p>
                        <p className={styles.aiStatValue}>
                          {manualReviewRequired ? "Needed" : "Not needed"}
                        </p>
                      </div>

                      <div className={styles.aiStatCard}>
                        <p className={styles.aiStatLabel}>Visual evidence</p>
                        <p className={styles.aiStatValue}>{readableVisualEvidence}</p>
                      </div>
                    </div>

                    <div className={styles.infoBox}>
                      <p className={styles.kvLabel}>Summary for authority</p>
                      <p className={styles.kvValue}>
                        {ai?.summary || "No AI summary available yet."}
                      </p>
                    </div>

                    <div className={manualReviewRequired ? styles.warningBox : styles.infoBox}>
                      <p className={styles.kvLabel}>Recommended review action</p>
                      <p className={styles.kvValue}>{readableReviewRecommendation}</p>
                    </div>
                  </div>
                </article>

                <article className={styles.panel}>
                  <h2 className={styles.panelTitle}>Priority status</h2>

                  <div className={styles.panelBody}>
                    <div className={styles.aiStatGrid}>
                      <div className={styles.aiStatCard}>
                        <p className={styles.aiStatLabel}>Queue position</p>
                        <p className={styles.aiStatValue}>
                          {priorityRank != null ? ordinal(priorityRank) : "N/A"}
                        </p>
                      </div>

                      <div className={styles.aiStatCard}>
                        <p className={styles.aiStatLabel}>Response window</p>
                        <p className={styles.aiStatValue}>{readableEscalation}</p>
                      </div>
                    </div>

                    <div
                      className={
                        priorityStatus === "not_computed"
                          ? styles.warningBox
                          : styles.infoBox
                      }
                    >
                      <p className={styles.kvLabel}>Priority note</p>
                      <p className={styles.kvValue}>{priorityNote}</p>
                    </div>
                  </div>
                </article>
              </section>

              <aside className={styles.rightColumn}>
                <AuthorityActionPanel
                  complaintId={complaint.id}
                  currentStatus={complaint.status}
                  currentResolutionNote={complaint.resolution_note}
                  resolvedAt={complaint.resolved_at}
                  currentFinalCategory={complaint.final_category}
                />
              </aside>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}