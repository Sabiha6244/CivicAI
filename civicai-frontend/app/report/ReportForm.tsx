"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import styles from "./report.module.css";
import {
  divisions,
  districts,
  upazilas,
  dhakaCityAreas,
  postcodes,
} from "./bdAddress";

export default function ReportForm({ userId }: { userId: string }) {
  const router = useRouter();

  const [reporterName, setReporterName] = useState("");
  const [division, setDivision] = useState("");
  const [district, setDistrict] = useState("");
  const [upazila, setUpazila] = useState("");
  const [cityArea, setCityArea] = useState("");
  const [postCode, setPostCode] = useState("");
  const [locationDetails, setLocationDetails] = useState("");

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  const [msg, setMsg] = useState<string | null>(null);
  const [msgType, setMsgType] = useState<"info" | "error">("info");
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

  const availablePostcodes = useMemo(() => {
    const selectedDivision = divisions.find((item) => item.name === division);
    const selectedDistrict = districts.find((item) => item.name === district);

    if (!selectedDivision || !selectedDistrict) return [];

    return postcodes.filter((item) => {
      const sameDivision = item.division_id === selectedDivision.id;
      const sameDistrict = item.district_id === selectedDistrict.id;

      if (!sameDivision || !sameDistrict) return false;

      if (upazila) {
        return item.upazila === upazila;
      }

      return true;
    });
  }, [division, district, upazila]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);

    const missingBase =
      !reporterName.trim() ||
      !division ||
      !district ||
      !locationDetails.trim() ||
      !title.trim() ||
      !description.trim();

    const missingAreaSelection = isDhakaDistrict
      ? !upazila && !cityArea
      : !upazila;

    if (missingBase || missingAreaSelection) {
      setMsgType("error");
      setMsg("Please complete all required fields before submitting.");
      return;
    }

    setLoading(true);

    const areaLabel = cityArea || upazila;

    const addressLabel = [
      locationDetails.trim(),
      areaLabel,
      district,
      division,
      postCode,
      "Bangladesh",
    ]
      .filter(Boolean)
      .join(", ");

    const { error } = await supabase.from("complaints").insert({
      created_by: userId,
      reporter_name: reporterName.trim(),
      division,
      district,
      upazila: upazila || null,
      city_area: cityArea || null,
      post_code: postCode || null,
      location_details: locationDetails.trim(),
      address_label: addressLabel,
      title: title.trim(),
      description: description.trim(),
      status: "submitted",
    });

    setLoading(false);

    if (error) {
      setMsgType("error");
      setMsg(`Unable to submit complaint: ${error.message}`);
      return;
    }

    setReporterName("");
    setDivision("");
    setDistrict("");
    setUpazila("");
    setCityArea("");
    setPostCode("");
    setLocationDetails("");
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
            Provide your complaint details and location using Bangladesh address fields.
          </p>
        </section>

        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <h2 className={styles.cardTitle}>Complaint details</h2>
            <p className={styles.cardText}>
              Fill in your name, address, and complaint details carefully.
            </p>
          </div>

          <form onSubmit={submit} className={styles.form}>
            <div>
              <label className={styles.label}>Reporter name</label>
              <input
                value={reporterName}
                onChange={(e) => setReporterName(e.target.value)}
                placeholder="Enter your full name"
                className={styles.input}
                disabled={loading}
              />
            </div>

            <div>
              <label className={styles.label}>Division</label>
              <select
                value={division}
                onChange={(e) => {
                  setDivision(e.target.value);
                  setDistrict("");
                  setUpazila("");
                  setCityArea("");
                  setPostCode("");
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

            <div>
              <label className={styles.label}>District</label>
              <select
                value={district}
                onChange={(e) => {
                  setDistrict(e.target.value);
                  setUpazila("");
                  setCityArea("");
                  setPostCode("");
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

            <div>
              <label className={styles.label}>
                Upazila {isDhakaDistrict ? "(choose this or Dhaka city area)" : ""}
              </label>
              <select
                value={upazila}
                onChange={(e) => {
                  setUpazila(e.target.value);
                  setPostCode("");
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
              <div>
                <label className={styles.label}>
                  Dhaka city area (choose this or Upazila)
                </label>
                <select
                  value={cityArea}
                  onChange={(e) => {
                    setCityArea(e.target.value);
                    if (e.target.value) {
                      setUpazila("");
                      setPostCode("");
                    }
                  }}
                  className={styles.input}
                  disabled={loading || !!upazila}
                >
                  <option value="">Select city area</option>
                  {availableDhakaCityAreas.map((item, index) => (
                    <option key={`${item.city_corporation}-${item.name}-${index}`} value={item.name}>
                      {item.name} ({item.city_corporation})
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label className={styles.label}>Post code</label>
              <select
                value={postCode}
                onChange={(e) => setPostCode(e.target.value)}
                className={styles.input}
                disabled={loading || !district}
              >
                <option value="">Select post code</option>
                {availablePostcodes.map((item, index) => (
                  <option key={`${item.postCode}-${item.postOffice}-${index}`} value={item.postCode}>
                    {item.postCode} - {item.postOffice}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className={styles.label}>Location details</label>
              <textarea
                value={locationDetails}
                onChange={(e) => setLocationDetails(e.target.value)}
                placeholder="Road name, village, market, nearby landmark, ward number, etc."
                className={`${styles.input} ${styles.textarea}`}
                disabled={loading}
              />
            </div>

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