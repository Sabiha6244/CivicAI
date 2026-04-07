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
  if (value == null) return "Pending";
  return `${(value * 100).toFixed(1)}%`;
}

function niceScore(value?: number | null) {
  if (value == null) return "Pending";
  return value.toFixed(3);
}

function niceInteger(value?: number | null) {
  if (value == null) return "Pending";
  return String(value);
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

function priorityClass(priority?: string | null) {
  switch (priority) {
    case "high":
      return styles.priorityHigh;
    case "medium":
      return styles.priorityMedium;
    case "low":
      return styles.priorityLow;
    default:
      return styles.chip;
  }
}

function reliabilityLabel(value?: string | null) {
  switch (value) {
    case "reliable":
      return "Reliable AI result";
    case "needs_review":
      return "Needs review";
    case "low_confidence":
      return "Low confidence";
    case "conflict_detected":
      return "Conflict detected";
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
    case "needs_review":
      return styles.chipWarn;
    case "low_confidence":
      return styles.chipWarn;
    case "conflict_detected":
      return styles.priorityMedium;
    case "insufficient_evidence":
      return styles.priorityHigh;
    default:
      return styles.chip;
  }
}

function parseQualityFlags(modelVersions: Record<string, string> | null) {
  const raw = modelVersions?.quality_flags;
  if (!raw || raw === "none") return [];
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function prettifyFlag(flag: string) {
  return flag
    .replaceAll("_", " ")
    .replace(/\b\w/g, (m) => m.toUpperCase());
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

function parseJsonObject<T>(value?: string | null): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function prettifyKey(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (m) => m.toUpperCase());
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
  const qualityFlags = parseQualityFlags(modelVersions);

  const textBranchConfidence = parseNumber(modelVersions?.text_branch_confidence);
  const imageBranchConfidence = parseNumber(modelVersions?.image_branch_confidence);
  const imageTopCivicProbability = parseNumber(modelVersions?.image_top_civic_probability);
  const textWeight = parseNumber(modelVersions?.text_weight);
  const imageWeight = parseNumber(modelVersions?.image_weight);
  const usedTextOnly = parseBoolean(modelVersions?.used_text_only);
  const usedImageOnly = parseBoolean(modelVersions?.used_image_only);
  const conflictThresholdText = parseNumber(modelVersions?.conflict_threshold_text);
  const conflictThresholdImage = parseNumber(modelVersions?.conflict_threshold_image);
  const areaFrequencyScore = parseNumber(modelVersions?.area_frequency_score);
  const areaFrequencyRepeatCount = parseNumber(modelVersions?.area_frequency_repeat_count);
  const areaFrequencyMatchingCount = parseNumber(modelVersions?.area_frequency_matching_count);
  const areaFrequencyWindowDays = parseNumber(modelVersions?.area_frequency_window_days);
  const areaFrequencyAreaField = modelVersions?.area_frequency_area_field || "";
  const areaFrequencyAreaValue = modelVersions?.area_frequency_area_value || "";
  const severityScore = parseNumber(modelVersions?.severity_score);
  const recencyScore = parseNumber(modelVersions?.recency_score);

  const priorityComponents = parseJsonObject<Record<string, number>>(
    modelVersions?.priority_components
  );

  const fusionModeLabel = usedTextOnly
    ? "Text-only fallback used"
    : usedImageOnly
    ? "Image-only mode used"
    : "Adaptive multimodal fusion used";

  const technicalEntries = modelVersions
    ? Object.entries(modelVersions).filter(
        ([key]) =>
          ![
            "quality_flags",
            "priority_components",
            "reliability_status",
            "manual_review_required",
            "citizen_ai_conflict",
            "text_branch_confidence",
            "image_branch_confidence",
            "text_weight",
            "image_weight",
            "used_text_only",
            "used_image_only",
            "conflict_threshold_text",
            "conflict_threshold_image",
            "area_frequency_score",
            "area_frequency_repeat_count",
            "area_frequency_matching_count",
            "area_frequency_window_days",
            "area_frequency_area_field",
            "area_frequency_area_value",
            "severity_score",
            "recency_score",
            "image_top_civic_probability",
          ].includes(key)
      )
    : [];

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
                      {[
                        complaint.city_area,
                        complaint.upazila,
                        complaint.district,
                      ]
                        .filter(Boolean)
                        .join(", ") || "Not provided"}
                    </span>
                  </div>
                </div>

                <div className={styles.detailActions}>
                  <span className={statusClass(complaint.status)}>
                    {complaint.status}
                  </span>
                  <span className={priorityClass(ai?.priority)}>
                    Priority: {ai?.priority || "Pending"}
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

                      <div className={styles.infoBox}>
                        <p className={styles.kvLabel}>AI fusion category</p>
                        <p className={styles.kvValue}>
                          {ai?.fusion_label || "Pending"}
                        </p>
                      </div>
                    </div>

                    {citizenAiConflict ? (
                      <div className={styles.warningBox}>
                        <p className={styles.kvLabel}>Citizen and AI mismatch</p>
                        <p className={styles.kvValue}>
                          The citizen-selected category and AI fusion category do
                          not match. Manual authority confirmation is recommended
                          before relying on AI.
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
                          <span className={styles.evidenceMetaLabel}>Detection status</span>
                          <span className={styles.evidenceMetaValue}>
                            {ai?.detected_image_url ? "Detection available" : "No detection saved"}
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
                      <p className={styles.kvLabel}>Fusion label</p>
                      <p className={styles.kvValue}>{ai?.fusion_label || "Pending"}</p>
                    </div>

                    <div className={styles.aiStatGrid}>
                      <div className={styles.aiStatCard}>
                        <p className={styles.aiStatLabel}>Fusion confidence</p>
                        <p className={styles.aiStatValue}>
                          {nicePercent(ai?.fusion_confidence)}
                        </p>
                      </div>

                      <div className={styles.aiStatCard}>
                        <p className={styles.aiStatLabel}>Priority score</p>
                        <p className={styles.aiStatValue}>
                          {ai?.priority_score != null
                            ? ai.priority_score.toFixed(1)
                            : "Pending"}
                        </p>
                      </div>

                      <div className={styles.aiStatCard}>
                        <p className={styles.aiStatLabel}>Text confidence</p>
                        <p className={styles.aiStatValue}>
                          {nicePercent(textBranchConfidence ?? ai?.text_confidence)}
                        </p>
                      </div>

                      <div className={styles.aiStatCard}>
                        <p className={styles.aiStatLabel}>Image confidence</p>
                        <p className={styles.aiStatValue}>
                          {nicePercent(imageBranchConfidence)}
                        </p>
                      </div>
                    </div>

                    <div className={styles.kvGrid}>
                      <div className={styles.infoBox}>
                        <p className={styles.kvLabel}>AI reliability status</p>
                        <p className={styles.kvValue}>
                          <span className={reliabilityClass(reliabilityStatus)}>
                            {reliabilityLabel(reliabilityStatus)}
                          </span>
                        </p>
                      </div>

                      <div className={manualReviewRequired ? styles.warningBox : styles.infoBox}>
                        <p className={styles.kvLabel}>Manual review</p>
                        <p className={styles.kvValue}>
                          {manualReviewRequired
                            ? "Required before trusting this AI result for action."
                            : "No extra manual-review warning from the backend."}
                        </p>
                      </div>
                    </div>

                    <div className={ai?.conflict_flag ? styles.warningBox : styles.infoBox}>
                      <p className={styles.kvLabel}>Consistency check</p>
                      <p className={styles.kvValue}>
                        {ai?.conflict_flag
                          ? "Text and image signals conflict after confidence threshold checks."
                          : "No major text-image conflict detected after threshold checks."}
                      </p>
                      <p className={styles.subtleText}>
                        Text threshold: {nicePercent(conflictThresholdText)} • Image threshold:{" "}
                        {nicePercent(conflictThresholdImage)}
                      </p>
                    </div>

                    <div className={styles.infoBox}>
                      <p className={styles.kvLabel}>AI summary</p>
                      <p className={styles.kvValue}>
                        {ai?.summary || "No AI summary available yet."}
                      </p>
                    </div>

                    <div className={styles.infoBox}>
                      <p className={styles.kvLabel}>Quality flags</p>
                      {qualityFlags.length > 0 ? (
                        <div className={styles.outputList}>
                          {qualityFlags.map((flag) => (
                            <div key={flag} className={styles.outputItem}>
                              {prettifyFlag(flag)}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className={styles.kvValue}>No quality flags recorded.</p>
                      )}
                    </div>
                  </div>
                </article>

                <article className={styles.panel}>
                  <h2 className={styles.panelTitle}>Adaptive multimodal fusion</h2>

                  <div className={styles.panelBody}>
                    <div className={styles.infoBox}>
                      <p className={styles.kvLabel}>Fusion mode</p>
                      <p className={styles.kvValue}>{fusionModeLabel}</p>
                      <p className={styles.subtleText}>
                        This complaint uses backend adaptive weighting instead of fixed
                        0.6 / 0.4 fusion.
                      </p>
                    </div>

                    <div className={styles.aiStatGrid}>
                      <div className={styles.aiStatCard}>
                        <p className={styles.aiStatLabel}>Text weight</p>
                        <p className={styles.aiStatValue}>{nicePercent(textWeight)}</p>
                      </div>

                      <div className={styles.aiStatCard}>
                        <p className={styles.aiStatLabel}>Image weight</p>
                        <p className={styles.aiStatValue}>{nicePercent(imageWeight)}</p>
                      </div>

                      <div className={styles.aiStatCard}>
                        <p className={styles.aiStatLabel}>Text top label</p>
                        <p className={styles.aiStatValue}>{ai?.text_label || "Pending"}</p>
                      </div>

                      <div className={styles.aiStatCard}>
                        <p className={styles.aiStatLabel}>Top image civic prob.</p>
                        <p className={styles.aiStatValue}>
                          {nicePercent(imageTopCivicProbability)}
                        </p>
                      </div>
                    </div>

                    <div className={styles.kvGrid}>
                      <div className={styles.infoBox}>
                        <p className={styles.kvLabel}>Text branch interpretation</p>
                        <p className={styles.kvValue}>
                          The text branch contributes according to its calibrated confidence.
                          Higher confidence increases its influence in the fused decision.
                        </p>
                      </div>

                      <div className={styles.infoBox}>
                        <p className={styles.kvLabel}>Image branch interpretation</p>
                        <p className={styles.kvValue}>
                          The image branch uses mapped YOLO evidence in the civic label
                          space before contributing to the final fused category.
                        </p>
                      </div>
                    </div>
                  </div>
                </article>

                <article className={styles.panel}>
                  <h2 className={styles.panelTitle}>Priority reasoning</h2>

                  <div className={styles.panelBody}>
                    <div className={styles.aiStatGrid}>
                      <div className={styles.aiStatCard}>
                        <p className={styles.aiStatLabel}>Severity</p>
                        <p className={styles.aiStatValue}>{niceScore(severityScore)}</p>
                      </div>

                      <div className={styles.aiStatCard}>
                        <p className={styles.aiStatLabel}>Recency</p>
                        <p className={styles.aiStatValue}>{niceScore(recencyScore)}</p>
                      </div>

                      <div className={styles.aiStatCard}>
                        <p className={styles.aiStatLabel}>Area frequency</p>
                        <p className={styles.aiStatValue}>{niceScore(areaFrequencyScore)}</p>
                      </div>

                      <div className={styles.aiStatCard}>
                        <p className={styles.aiStatLabel}>Repeated complaints</p>
                        <p className={styles.aiStatValue}>
                          {niceInteger(areaFrequencyRepeatCount)}
                        </p>
                      </div>
                    </div>

                    <div className={styles.kvGrid}>
                      <div className={styles.infoBox}>
                        <p className={styles.kvLabel}>Area-frequency evidence</p>
                        <p className={styles.kvValue}>
                          {areaFrequencyAreaValue
                            ? `The backend checked recent complaints in ${areaFrequencyAreaField.replaceAll(
                                "_",
                                " "
                              )}: ${areaFrequencyAreaValue}.`
                            : "No area-based repetition signal was available for this complaint."}
                        </p>
                        <p className={styles.subtleText}>
                          Matching complaints in time window:{" "}
                          {niceInteger(areaFrequencyMatchingCount)} • Window:{" "}
                          {niceInteger(areaFrequencyWindowDays)} days
                        </p>
                      </div>

                      <div className={styles.infoBox}>
                        <p className={styles.kvLabel}>Priority explanation</p>
                        <p className={styles.kvValue}>
                          Priority is based on severity, fusion confidence, repeated
                          complaints in the same area, recency, and conflict penalty.
                        </p>
                      </div>
                    </div>

                    <div className={styles.infoBox}>
                      <p className={styles.kvLabel}>Priority component breakdown</p>
                      {priorityComponents ? (
                        <div className={styles.tightList}>
                          {Object.entries(priorityComponents).map(([key, value]) => (
                            <div key={key} className={styles.tightItem}>
                              <strong>{prettifyKey(key)}</strong>: {niceScore(value)}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className={styles.kvValue}>
                          No priority component breakdown available yet.
                        </p>
                      )}
                    </div>
                  </div>
                </article>

                <article className={styles.panel}>
                  <h2 className={styles.panelTitle}>Technical model details</h2>

                  <div className={styles.panelBody}>
                    <div className={styles.kvBlock}>
                      <p className={styles.kvLabel}>Image model detections</p>
                      {ai?.image_labels && ai.image_labels.length > 0 ? (
                        <div className={styles.outputList}>
                          {ai.image_labels.map((label, index) => (
                            <div key={`${label}-${index}`} className={styles.outputItem}>
                              <strong>{label}</strong> —{" "}
                              {nicePercent(ai.image_confidences?.[index] ?? null)}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className={styles.kvValue}>No image detections available.</p>
                      )}
                    </div>

                    <div className={styles.infoBox}>
                      <p className={styles.kvLabel}>Core backend configuration</p>
                      {technicalEntries.length > 0 ? (
                        <div className={styles.tightList}>
                          {technicalEntries.map(([key, value]) => (
                            <div key={key} className={styles.tightItem}>
                              <strong>{prettifyKey(key)}</strong>: {value || "N/A"}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className={styles.kvValue}>
                          No model version information available.
                        </p>
                      )}
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