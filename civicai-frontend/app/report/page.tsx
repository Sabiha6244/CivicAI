import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabaseServer";
import ReportForm from "./ReportForm";

export default async function ReportPage() {
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    redirect("/login?next=/report");
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("is_verified")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError || !profile?.is_verified) {
    redirect("/login?next=/report&verify=1");
  }

  return <ReportForm userId={user.id} />;
}