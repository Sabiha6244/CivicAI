import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function POST(
  _req: Request,
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

    /*
      This access check uses Supabase RLS.

      admin:
        can access any complaint.

      local authority:
        can access only complaints assigned to their active, verified linked office.

      citizen:
        blocked above.
    */
    const { data: targetComplaint, error: targetComplaintError } = await supabase
      .from("complaints")
      .select("id")
      .eq("id", id)
      .maybeSingle();

    if (targetComplaintError) {
      return NextResponse.json(
        {
          error:
            targetComplaintError.message ||
            "Failed to verify complaint access.",
        },
        { status: 500 }
      );
    }

    if (!targetComplaint) {
      return NextResponse.json(
        { error: "Complaint not found or not accessible." },
        { status: 404 }
      );
    }

    const backendBase =
      process.env.BACKEND_URL ||
      process.env.NEXT_PUBLIC_BACKEND_URL ||
      process.env.NEXT_PUBLIC_API_BASE_URL;

    if (!backendBase) {
      return NextResponse.json(
        { error: "Backend URL is not configured." },
        { status: 500 }
      );
    }

    const controller = new AbortController();
    const timeoutMs = 120_000;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const aiRes = await fetch(`${backendBase}/ai/run/${id}`, {
        method: "POST",
        headers: {
          Accept: "application/json",
        },
        cache: "no-store",
        signal: controller.signal,
      });

      const rawText = await aiRes.text();

      if (!aiRes.ok) {
        return NextResponse.json(
          {
            error: `AI run failed: ${rawText || aiRes.statusText}`,
          },
          { status: aiRes.status }
        );
      }

      let parsed: unknown = null;

      try {
        parsed = rawText ? JSON.parse(rawText) : null;
      } catch {
        parsed = rawText;
      }

      return NextResponse.json({
        ok: true,
        result: parsed,
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return NextResponse.json(
          {
            error:
              "AI run timed out after 120 seconds. The backend is taking too long, most likely during duplicate detection or model work.",
          },
          { status: 504 }
        );
      }

      throw error;
    } finally {
      clearTimeout(timeout);
    }
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