import { supabase } from "@/lib/supabaseClient";

export default async function Home() {
  const { data, error } = await supabase
    .from("complaints")
    .select("id", { count: "exact" });

  return (
    <main className="p-10">
      <h1 className="text-3xl font-bold">CivicAI</h1>

      {error ? (
        <p className="mt-4 text-red-500">Error: {error.message}</p>
      ) : (
        <p className="mt-4">
          Complaints in database: <b>{data?.length ?? 0}</b>
        </p>
      )}
    </main>
  );
}