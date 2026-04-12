import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

type DuplicateComplaintRow = {
  id: string;
  title: string | null;
  status: string;
  created_at: string;
};

export async function GET(
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
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("role, is_verified")
      .eq("id", user.id)
      .single();

    if (profileError || !profile?.is_verified || profile.role !== "authority") {
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    }

    const backendBase =
      process.env.BACKEND_URL ||
      process.env.NEXT_PUBLIC_BACKEND_URL ||
      "http://127.0.0.1:8000";

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
      const dupRes = await fetch(`${backendBase}/complaints/${id}/duplicates`, {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
        cache: "no-store",
        signal: controller.signal,
      });

      const payload = await dupRes.json().catch(() => ({}));

      if (!dupRes.ok) {
        return NextResponse.json(
          { error: payload?.detail || payload?.error || "Failed to load duplicates." },
          { status: dupRes.status }
        );
      }

      const duplicateIds = Array.isArray(payload?.duplicate_ids)
        ? payload.duplicate_ids.map((item: unknown) => String(item)).filter(Boolean)
        : [];

      let duplicates: DuplicateComplaintRow[] = [];

      if (duplicateIds.length > 0) {
        const { data: rows, error: duplicateRowsError } = await supabase
          .from("complaints")
          .select("id, title, status, created_at")
          .in("id", duplicateIds)
          .order("created_at", { ascending: false });

        if (duplicateRowsError) {
          return NextResponse.json(
            { error: duplicateRowsError.message || "Failed to load duplicate rows." },
            { status: 500 }
          );
        }

        duplicates = (rows || []) as DuplicateComplaintRow[];
      }

      return NextResponse.json({
        ok: true,
        duplicate_count: duplicateIds.length,
        duplicates,
        source: payload?.source || "saved_inference",
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return NextResponse.json(
          { error: "Duplicate lookup timed out." },
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
          error instanceof Error
            ? error.message
            : "Unexpected server error while loading duplicates.",
      },
      { status: 500 }
    );
  }
}
