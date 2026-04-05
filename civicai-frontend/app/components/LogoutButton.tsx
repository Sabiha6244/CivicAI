"use client";

import { supabase } from "@/lib/supabaseClient";

type LogoutButtonProps = {
  className?: string;
};

export default function LogoutButton({ className = "" }: LogoutButtonProps) {
  return (
    <button
      className={className}
      onClick={async () => {
        await supabase.auth.signOut();
        window.location.href = "/";
      }}
      style={!className ? {
        padding: "10px 14px",
        borderRadius: 10,
        border: "1px solid #d1d5db",
        background: "#fff",
        color: "#111827",
        fontSize: 14,
        fontWeight: 700,
        cursor: "pointer",
      } : undefined}
    >
      Logout
    </button>
  );
}