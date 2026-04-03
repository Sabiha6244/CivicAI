"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import styles from "./report.module.css";
import {
  divisions,
  districts,
  upazilas,
  dhakaCityAreas,
  parseCoordinate,
} from "./bdAddress";

const LocationPicker = dynamic(() => import("./LocationPicker"), {
  ssr: false,
});

type MessageType = "info" | "error";

type AreaCenter = {
  lat: number;
  lng: number;
  zoom?: number;
} | null;

const MAX_IMAGE_SIZE_MB = 8;
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp"];

function sanitizeFileName(name: string) {
  return name.replace(/\s+/g, "-").replace(/[^a-zA-Z0-9._-]/g, "").toLowerCase();
}

export default function ReportForm({ userId }: { userId: string }) {
  const router = useRouter();

  const [reporterName, setReporterName] = useState("");
  const [division, setDivision] = useState("");
  const [district, setDistrict] = useState("");
  const [upazila, setUpazila] = useState("");
  const [cityArea, setCityArea] = useState("");
  const [locationDetails, setLocationDetails] = useState("");
  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);

  const [msg, setMsg] = useState<string | null>(null);
  const [msgType, setMsgType] = useState<MessageType>("info");
  const [loading, setLoading] = useState(false);

  const availableDistricts = useMemo(() => {
    if (!division) return [];
    const selectedDivision = divisions.find((item) => item.name === division);
    if (!selectedDivision) return [];
    return districts.filter((item) => item.division_id === selectedDivision.id);
  }, [division]);

  const isDhakaDistrict = division === "Dhaka" && district === "Dhaka";

  const availableUpazilas = useMemo(() => {
    if (!district) return [];
    const selectedDistrict = districts.find((item) => item.name === district);
    if (!selectedDistrict) return [];
    return upazilas.filter((item) => item.district_id === selectedDistrict.id);
  }, [district]);

  const availableDhakaCityAreas = useMemo(() => {
    if (!isDhakaDistrict) return [];
    const selectedDistrict = districts.find((item) => item.name === district);
    if (!selectedDistrict) return [];
    return dhakaCityAreas.filter((item) => item.district_id === selectedDistrict.id);
  }, [district, isDhakaDistrict]);

  const selectedAreaCenter = useMemo<AreaCenter>(() => {
    const selectedDistrict = districts.find((item) => item.name === district);
    const selectedDivision = divisions.find((item) => item.name === division);

    if (selectedDistrict) {
      const districtLat = parseCoordinate(selectedDistrict.lat);
      const districtLng = parseCoordinate(selectedDistrict.long);

      if (districtLat !== null && districtLng !== null) {
        return {
          lat: districtLat,
          lng: districtLng,
          zoom: isDhakaDistrict ? 11 : 10,
        };
      }
    }

    if (selectedDivision) {
      const divisionLat = parseCoordinate(selectedDivision.lat);
      const divisionLng = parseCoordinate(selectedDivision.long);

      if (divisionLat !== null && divisionLng !== null) {
        return {
          lat: divisionLat,
          lng: divisionLng,
          zoom: 8,
        };
      }
    }

    return null;
  }, [division, district, isDhakaDistrict]);

  function resetForm() {
    setReporterName("");
    setDivision("");
    setDistrict("");
    setUpazila("");
    setCityArea("");
    setLocationDetails("");
    setLat(null);
    setLng(null);
    setTitle("");
    setDescription("");
    setImageFile(null);
    setImagePreviewUrl(null);
  }

  function handleImageChange(file: File | null) {
    if (!file) {
      setImageFile(null);
      setImagePreviewUrl(null);
      return;
    }

    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      setMsgType("error");
      setMsg("Please upload a JPG, PNG, or WEBP image.");
      return;
    }

    const maxBytes = MAX_IMAGE_SIZE_MB * 1024 * 1024;
    if (file.size > maxBytes) {
      setMsgType("error");
      setMsg(`Please upload an image smaller than ${MAX_IMAGE_SIZE_MB} MB.`);
      return;
    }

    setMsg(null);
    setImageFile(file);
    setImagePreviewUrl(URL.createObjectURL(file));
  }

  async function uploadComplaintImage(complaintId: string) {
    if (!imageFile) return { ok: true as const };

    const safeFileName = sanitizeFileName(imageFile.name || "complaint-image");
    const storagePath = `complaints/${complaintId}/${Date.now()}-${safeFileName}`;

    const uploadResult = await supabase.storage
      .from("complaint-images")
      .upload(storagePath, imageFile, {
        cacheControl: "3600",
        upsert: false,
      });

    if (uploadResult.error) {
      return {
        ok: false as const,
        error: `Complaint was submitted, but image upload failed: ${uploadResult.error.message}`,
      };
    }

    const publicUrlResult = supabase.storage
      .from("complaint-images")
      .getPublicUrl(storagePath);

    const publicUrl = publicUrlResult.data.publicUrl;

    const mediaInsert = await supabase.from("complaint_media").insert({
      complaint_id: complaintId,
      media_type: "image",
      storage_path: storagePath,
      public_url: publicUrl,
      original_filename: imageFile.name,
    });

    if (mediaInsert.error) {
      return {
        ok: false as const,
        error: `Complaint was submitted and image uploaded, but media record save failed: ${mediaInsert.error.message}`,
      };
    }

    return { ok: true as const };
  }

  async function triggerAiInference(complaintId: string) {
    try {
      await fetch(`http://127.0.0.1:8000/ai/run/${complaintId}`, {
        method: "POST",
        keepalive: true,
      });
    } catch {
      // Ignore background AI request errors during redirect/navigation
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);

    const missingBase =
      !reporterName.trim() ||
      !division ||
      !district ||
      !locationDetails.trim() ||
      !title.trim() ||
      !description.trim() ||
      lat === null ||
      lng === null;

    const missingAreaSelection = isDhakaDistrict ? !upazila && !cityArea : !upazila;

    if (missingBase || missingAreaSelection) {
      setMsgType("error");
      setMsg("Please complete all required fields and mark the complaint location on the map.");
      return;
    }

    setLoading(true);

    const areaLabel = cityArea || upazila;

    const addressLabel = [
      locationDetails.trim(),
      areaLabel,
      district,
      division,
      "Bangladesh",
    ]
      .filter(Boolean)
      .join(", ");

    const complaintInsert = await supabase
      .from("complaints")
      .insert({
        created_by: userId,
        reporter_name: reporterName.trim(),
        division,
        district,
        upazila: upazila || null,
        city_area: cityArea || null,
        post_code: null,
        location_details: locationDetails.trim(),
        address_label: addressLabel,
        lat,
        lng,
        title: title.trim(),
        description: description.trim(),
        status: "submitted",
      })
      .select("id")
      .single();

    if (complaintInsert.error || !complaintInsert.data?.id) {
      setLoading(false);
      setMsgType("error");
      setMsg(
        `Unable to submit complaint: ${
          complaintInsert.error?.message ?? "Complaint ID was not returned."
        }`
      );
      return;
    }

    const complaintId = complaintInsert.data.id;
    const imageResult = await uploadComplaintImage(complaintId);

    if (!imageResult.ok) {
      setLoading(false);
      setMsgType("error");
      setMsg(imageResult.error);
      return;
    }

    triggerAiInference(complaintId);

    setLoading(false);
    resetForm();
    setMsgType("info");
    setMsg("Your complaint has been submitted successfully. Redirecting...");
    setTimeout(() => router.replace("/"), 2000);
  }

  return (
    <main className={styles.page}>
      <div className={styles.wrapper}>
        <section className={styles.hero}>
          <p className={styles.eyebrow}>Verified complaint reporting</p>
          <h1 className={styles.title}>Report a civic complaint</h1>
          <p className={styles.subtitle}>
            Share the issue location, a clear description, and an optional image so the
            complaint can be reviewed faster and more accurately.
          </p>
        </section>

        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <div>
              <h2 className={styles.cardTitle}>Complaint submission form</h2>
              <p className={styles.cardText}>
                Complete the required details below. Use the map to mark the exact
                problem location, not just your current location.
              </p>
            </div>
            <div className={styles.cardBadge}>Citizen report</div>
          </div>

          <form onSubmit={submit} className={styles.form}>
            <div className={styles.section}>
              <h3 className={styles.sectionTitle}>Reporter information</h3>

              <div className={styles.gridTwo}>
                <div className={styles.inputGroup}>
                  <label className={styles.label}>Reporter name</label>
                  <input
                    value={reporterName}
                    onChange={(e) => setReporterName(e.target.value)}
                    placeholder="Enter your full name"
                    className={styles.input}
                    disabled={loading}
                  />
                </div>

                <div className={styles.inputGroup}>
                  <label className={styles.label}>Complaint title</label>
                  <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="For example, Broken street light near main road"
                    className={styles.input}
                    disabled={loading}
                  />
                </div>
              </div>
            </div>

            <div className={styles.section}>
              <h3 className={styles.sectionTitle}>Address information</h3>

              <div className={styles.gridTwo}>
                <div className={styles.inputGroup}>
                  <label className={styles.label}>Division</label>
                  <select
                    value={division}
                    onChange={(e) => {
                      setDivision(e.target.value);
                      setDistrict("");
                      setUpazila("");
                      setCityArea("");
                      setLat(null);
                      setLng(null);
                    }}
                    className={styles.input}
                    disabled={loading}
                  >
                    <option value="">Select division</option>
                    {divisions.map((item) => (
                      <option key={item.id} value={item.name}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className={styles.inputGroup}>
                  <label className={styles.label}>District</label>
                  <select
                    value={district}
                    onChange={(e) => {
                      setDistrict(e.target.value);
                      setUpazila("");
                      setCityArea("");
                      setLat(null);
                      setLng(null);
                    }}
                    className={styles.input}
                    disabled={loading || !division}
                  >
                    <option value="">Select district</option>
                    {availableDistricts.map((item) => (
                      <option key={item.id} value={item.name}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className={styles.inputGroup}>
                  <label className={styles.label}>
                    Upazila {isDhakaDistrict ? "(choose this or Dhaka city area)" : ""}
                  </label>
                  <select
                    value={upazila}
                    onChange={(e) => {
                      setUpazila(e.target.value);
                      setLat(null);
                      setLng(null);
                      if (isDhakaDistrict && e.target.value) {
                        setCityArea("");
                      }
                    }}
                    className={styles.input}
                    disabled={loading || !district || (isDhakaDistrict && !!cityArea)}
                  >
                    <option value="">Select upazila</option>
                    {availableUpazilas.map((item) => (
                      <option key={item.id} value={item.name}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </div>

                {isDhakaDistrict && (
                  <div className={styles.inputGroup}>
                    <label className={styles.label}>Dhaka city area</label>
                    <select
                      value={cityArea}
                      onChange={(e) => {
                        setCityArea(e.target.value);
                        setLat(null);
                        setLng(null);
                        if (e.target.value) {
                          setUpazila("");
                        }
                      }}
                      className={styles.input}
                      disabled={loading || !!upazila}
                    >
                      <option value="">Select city area</option>
                      {availableDhakaCityAreas.map((item, index) => (
                        <option
                          key={`${item.city_corporation}-${item.name}-${index}`}
                          value={item.name}
                        >
                          {item.name} ({item.city_corporation})
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              <div className={styles.inputGroup}>
                <label className={styles.label}>Location details</label>
                <textarea
                  value={locationDetails}
                  onChange={(e) => setLocationDetails(e.target.value)}
                  placeholder="Road name, village, market, nearby landmark, ward number, building name, or any details that help identify the place."
                  className={`${styles.input} ${styles.textarea}`}
                  disabled={loading}
                />
              </div>
            </div>

            <div className={styles.section}>
              <h3 className={styles.sectionTitle}>Map location</h3>
              <div className={styles.mapShell}>
                <LocationPicker
                  lat={lat}
                  lng={lng}
                  areaCenter={selectedAreaCenter}
                  onChange={(newLat, newLng) => {
                    setLat(newLat);
                    setLng(newLng);
                  }}
                />
              </div>
            </div>

            <div className={styles.section}>
              <h3 className={styles.sectionTitle}>Complaint details</h3>

              <div className={styles.inputGroup}>
                <label className={styles.label}>Description</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Describe the issue clearly. Include what is happening, how long it has existed, who is affected, and any safety or access concerns."
                  className={`${styles.input} ${styles.textareaLarge}`}
                  disabled={loading}
                />
              </div>

              <div className={styles.inputGroup}>
                <label className={styles.label}>Upload an image (optional)</label>
                <div className={styles.uploadBox}>
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/jpg,image/webp"
                    onChange={(e) => handleImageChange(e.target.files?.[0] ?? null)}
                    className={styles.uploadInput}
                    disabled={loading}
                  />
                  <p className={styles.uploadHint}>
                    Supported formats: JPG, PNG, WEBP. Maximum size: {MAX_IMAGE_SIZE_MB} MB.
                  </p>
                </div>

                {imagePreviewUrl && (
                  <div className={styles.imagePreview}>
                    <div className={styles.imagePreviewHeader}>
                      <div>
                        <p className={styles.imagePreviewTitle}>Selected image</p>
                        <p className={styles.imagePreviewMeta}>{imageFile?.name}</p>
                      </div>
                      <button
                        type="button"
                        className={styles.removeButton}
                        onClick={() => handleImageChange(null)}
                        disabled={loading}
                      >
                        Remove
                      </button>
                    </div>

                    <img
                      src={imagePreviewUrl}
                      alt="Complaint preview"
                      className={styles.imageThumb}
                    />
                  </div>
                )}
              </div>
            </div>

            <div className={styles.actionsRow}>
              <button type="submit" disabled={loading} className={styles.primaryButton}>
                {loading ? "Submitting complaint..." : "Submit complaint"}
              </button>
            </div>
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