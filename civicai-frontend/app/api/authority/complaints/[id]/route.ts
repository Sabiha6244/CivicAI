import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

type ComplaintStatus = "submitted" | "processing" | "completed" | "resolved" | "rejected";

type UpdateBody = {
  status?: ComplaintStatus;
  resolution_note?: string | null;
  final_category?: string | null;
};

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const body = (await req.json()) as UpdateBody;

    const nextStatus = body.status;
    const resolutionNoteRaw = body.resolution_note;
    const finalCategoryRaw = body.final_category;

    const resolutionNote =
      typeof resolutionNoteRaw === "string" ? resolutionNoteRaw.trim() : null;

    const finalCategory =
      typeof finalCategoryRaw === "string" ? finalCategoryRaw.trim() : null;

    if (
      !nextStatus ||
      !["submitted", "processing", "completed", "resolved", "rejected"].includes(nextStatus)
    ) {
      return NextResponse.json(
        { error: "A valid status is required." },
        { status: 400 }
      );
    }

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
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("role, is_verified")
      .eq("id", user.id)
      .single();

    if (profileError || !profile) {
      return NextResponse.json({ error: "Profile not found." }, { status: 403 });
    }

    if (!profile.is_verified || profile.role !== "authority") {
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    }

    const updatePayload: {
      status: ComplaintStatus;
      updated_at: string;
      resolved_at?: string | null;
      resolution_note?: string | null;
      final_category?: string | null;
      category_source?: string;
    } = {
      status: nextStatus,
      updated_at: new Date().toISOString(),
    };

    if (nextStatus === "resolved" || nextStatus === "completed") {
      updatePayload.resolved_at = new Date().toISOString();
      updatePayload.resolution_note = resolutionNote || null;
    } else {
      updatePayload.resolved_at = null;

      if (resolutionNoteRaw !== undefined) {
        updatePayload.resolution_note = resolutionNote || null;
      }
    }

    if (finalCategoryRaw !== undefined) {
      updatePayload.final_category = finalCategory || null;
      updatePayload.category_source = finalCategory ? "authority" : "authority";
    }

    const { data, error } = await supabase
      .from("complaints")
      .update(updatePayload)
      .eq("id", id)
      .select(
        "id, status, resolved_at, resolution_note, updated_at, final_category, category_source"
      )
      .single();

    if (error) {
      return NextResponse.json(
        { error: `Failed to update complaint: ${error.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      complaint: data,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Unexpected server error.",
      },
      { status: 500 }
    );
  }
}