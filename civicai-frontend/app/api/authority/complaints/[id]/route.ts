import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

type UpdateComplaintBody = {
  status?: string;
  resolution_note?: string | null;
  final_category?: string | null;
  notify_reporter?: boolean;
  email_subject?: string | null;
  email_text?: string | null;
};

const ALLOWED_STATUSES = new Set([
  "submitted",
  "processing",
  "completed",
  "resolved",
  "rejected",
]);

function normalizeText(value: unknown) {
  if (value == null) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function isFinalStatus(status: string) {
  return status === "completed" || status === "resolved" || status === "rejected";
}

function buildEmailFallback({
  title,
  areaText,
  status,
  finalCategory,
  resolutionNote,
}: {
  title: string;
  areaText: string;
  status: string;
  finalCategory: string;
  resolutionNote: string | null;
}) {
  const readableStatus =
    status === "processing"
      ? "processing"
      : status === "submitted"
        ? "submitted"
        : status === "resolved"
          ? "resolved"
          : status === "completed"
            ? "completed"
            : "rejected";

  return `Hello,

Your complaint "${title}" for ${areaText} has received a status update.

Current status: ${readableStatus}
Final category: ${finalCategory || "Not specified"}

${
  resolutionNote
    ? `Authority note: ${resolutionNote}`
    : "Please check the platform for the latest authority update."
}

Regards,
CivicAI Authority Team`;
}

type ReporterEmailResult = {
  sent: boolean;
  skippedReason?: string;
};

async function sendReporterEmail({
  to,
  subject,
  text,
}: {
  to: string;
  subject: string;
  text: string;
}): Promise<ReporterEmailResult> {
  const apiKey = process.env.BREVO_API_KEY;
  const senderEmail = process.env.BREVO_SENDER_EMAIL;
  const senderName = process.env.BREVO_SENDER_NAME || "CivicAI Authority Team";

  if (!senderEmail || !apiKey) {
    return {
      sent: false,
      skippedReason:
        "Email configuration is missing. Add BREVO_API_KEY and BREVO_SENDER_EMAIL to the frontend server environment.",
    };
  }

  const escapeHtml = (value: string) =>
    value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

  const html = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join("");

  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "api-key": apiKey,
    },
    body: JSON.stringify({
      sender: {
        name: senderName,
        email: senderEmail,
      },
      to: [{ email: to }],
      subject,
      textContent: text,
      htmlContent: html,
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    return {
      sent: false,
      skippedReason: `Brevo send failed: ${response.status} ${await response.text()}`,
    };
  }

  return {
    sent: true,
    skippedReason: undefined,
  };
}

async function recomputePriorityQueue() {
  const backendBase =
    process.env.BACKEND_URL ||
    process.env.NEXT_PUBLIC_BACKEND_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    process.env.NEXT_PUBLIC_API_BASE_URL;

  if (!backendBase) {
    return {
      ok: false,
      error: "Backend URL is not configured.",
      data: null,
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);

  try {
    const response = await fetch(`${backendBase}/priority/recompute`, {
      method: "POST",
      headers: {
        Accept: "application/json",
      },
      cache: "no-store",
      signal: controller.signal,
    });

    const raw = await response.text();

    if (!response.ok) {
      return {
        ok: false,
        error: raw || `Priority recompute failed with status ${response.status}.`,
        data: null,
      };
    }

    let parsed: unknown = null;

    try {
      parsed = raw ? JSON.parse(raw) : null;
    } catch {
      parsed = raw;
    }

    return {
      ok: true,
      error: null,
      data: parsed,
    };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.name === "AbortError"
            ? "Priority recompute timed out."
            : error.message
          : "Priority recompute failed.",
      data: null,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
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
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("role, is_verified")
      .eq("id", user.id)
      .single();

    const isAdmin = profile?.role === "admin";
    const isLocalAuthority = profile?.role === "authority";

    if (profileError || !profile?.is_verified || (!isAdmin && !isLocalAuthority)) {
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    }

    const body = (await request.json()) as UpdateComplaintBody;

    const requestedStatus = normalizeText(body.status);
    const nextResolutionNote =
      body.resolution_note === undefined
        ? undefined
        : normalizeText(body.resolution_note);
    const nextFinalCategory =
      body.final_category === undefined
        ? undefined
        : normalizeText(body.final_category);
    const notifyReporter = Boolean(body.notify_reporter);
    const nextEmailSubject = normalizeText(body.email_subject);
    const nextEmailText = normalizeText(body.email_text);

    if (!requestedStatus || !ALLOWED_STATUSES.has(requestedStatus)) {
      return NextResponse.json(
        { error: "A valid complaint status is required." },
        { status: 400 }
      );
    }

    const effectiveStatus =
      requestedStatus === "submitted" ? "processing" : requestedStatus;

    /*
      This uses RLS:
      admin can access any complaint.
      local authority can access only complaints assigned to their active verified office.
    */
    const { data: complaintRow, error: complaintError } = await supabase
      .from("complaints")
      .select(`
        id,
        title,
        created_by,
        reporter_name,
        district,
        upazila,
        city_area,
        address_label,
        status,
        final_category,
        resolution_note,
        resolved_at
      `)
      .eq("id", id)
      .maybeSingle();

    if (complaintError) {
      return NextResponse.json(
        { error: complaintError.message || "Failed to verify complaint access." },
        { status: 500 }
      );
    }

    if (!complaintRow) {
      return NextResponse.json(
        { error: "Complaint not found or not accessible." },
        { status: 404 }
      );
    }

    const updatePayload: Record<string, unknown> = {
      status: effectiveStatus,
    };

    if (nextResolutionNote !== undefined) {
      updatePayload.resolution_note = nextResolutionNote;
    }

    if (nextFinalCategory !== undefined) {
      updatePayload.final_category = nextFinalCategory;

      if (nextFinalCategory) {
        updatePayload.category_source = "authority";
      }
    }

    if (isFinalStatus(effectiveStatus)) {
      updatePayload.resolved_at =
        complaintRow.resolved_at || new Date().toISOString();
    } else {
      updatePayload.resolved_at = null;
    }

    /*
      This also uses RLS:
      admin can update any complaint.
      local authority can update only assigned active verified office complaints.
    */
    const { data: updatedComplaint, error: updateError } = await supabase
      .from("complaints")
      .update(updatePayload)
      .eq("id", id)
      .select(`
        id,
        status,
        final_category,
        resolution_note,
        resolved_at
      `)
      .single();

    if (updateError) {
      return NextResponse.json(
        { error: updateError.message || "Failed to update complaint." },
        { status: 500 }
      );
    }

    const recomputeResult = await recomputePriorityQueue();

    let emailSent = false;
    let emailSkippedReason: string | null = null;

    if (notifyReporter) {
      const createdBy = complaintRow.created_by as string | null;

      if (!createdBy) {
        emailSkippedReason =
          "Complaint reporter account could not be resolved for email delivery.";
      } else {
        const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

        if (!serviceRoleKey) {
          emailSkippedReason =
            "Reporter email could not be loaded because SUPABASE_SERVICE_ROLE_KEY is missing from the server environment.";
        } else {
          const admin = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            serviceRoleKey,
            {
              auth: {
                autoRefreshToken: false,
                persistSession: false,
              },
            }
          );

          const { data: reporterAuth, error: reporterError } =
            await admin.auth.admin.getUserById(createdBy);

          const reporterEmail = reporterAuth.user?.email ?? null;

          if (reporterError || !reporterEmail) {
            emailSkippedReason =
              "Reporter email could not be loaded from Supabase Auth.";
          } else {
            const areaText =
              complaintRow.city_area ||
              complaintRow.upazila ||
              complaintRow.district ||
              complaintRow.address_label ||
              "the reported area";

            const fallbackSubject = `CivicAI status update: ${effectiveStatus} - ${
              complaintRow.title || "Complaint"
            }`;

            const fallbackText = buildEmailFallback({
              title: complaintRow.title || "Complaint",
              areaText,
              status: effectiveStatus,
              finalCategory:
                nextFinalCategory ||
                complaintRow.final_category ||
                "Not specified",
              resolutionNote:
                nextResolutionNote === undefined
                  ? complaintRow.resolution_note
                  : nextResolutionNote,
            });

            try {
              const emailResult = await sendReporterEmail({
                to: reporterEmail,
                subject: nextEmailSubject || fallbackSubject,
                text: nextEmailText || fallbackText,
              });

              emailSent = emailResult.sent;
              emailSkippedReason = emailResult.skippedReason ?? null;
            } catch (emailError) {
              emailSkippedReason =
                emailError instanceof Error
                  ? emailError.message
                  : "Failed to send reporter email.";
            }
          }
        }
      }
    }

    return NextResponse.json({
      ok: true,
      complaint: updatedComplaint,
      requested_status: requestedStatus,
      effective_status: effectiveStatus,
      email_sent: emailSent,
      email_skipped_reason: emailSkippedReason,
      queue_recomputed: recomputeResult.ok,
      queue_recompute_error: recomputeResult.error,
      queue_recompute_result: recomputeResult.data,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unexpected error while updating complaint.",
      },
      { status: 500 }
    );
  }
}