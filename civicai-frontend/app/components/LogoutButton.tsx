"use client";

import { supabase } from "@/lib/supabaseClient";

export default function LogoutButton() {
  return (
    <button
      onClick={async () => {
        await supabase.auth.signOut();
        window.location.href = "/";
      }}
      style={{
        padding: "10px 14px",
        borderRadius: 10,
        border: "1px solid #d1d5db",
        background: "#fff",
        color: "#111827",
        fontSize: 14,
        fontWeight: 700,
        cursor: "pointer",
      }}
    >
      Logout
    </button>
  );
}