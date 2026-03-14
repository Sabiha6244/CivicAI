import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabaseServer";
import ReportForm from "./ReportForm";

export default async function ReportPage() {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();

  // Not logged in -> go to login and then come back to /report
  if (!user) {
    redirect("/login?next=/report");
  }

  // Must be OTP verified
  const { data: profile } = await supabase
    .from("profiles")
    .select("is_verified")
    .eq("id", user.id)
    .single();

  if (!profile?.is_verified) {
    redirect("/login?next=/report&verify=1");
  }

  return <ReportForm userId={user.id} />;
}