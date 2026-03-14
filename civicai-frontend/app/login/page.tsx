"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type Mode = "login" | "register";

type FieldErrors = {
  fullName?: string;
  email?: string;
  password?: string;
  confirmPassword?: string;
  otp?: string;
  form?: string;
};

function validateFullName(name: string) {
  const trimmed = name.trim();
  if (!trimmed) return "Full name is required.";
  if (!/^[A-Za-z\s]+$/.test(trimmed)) return "Use letters and spaces only.";

  const words = trimmed.split(/\s+/);
  for (const w of words) {
    if (!/^[A-Z][a-z]*$/.test(w)) {
      return "Each word must start with a capital letter (e.g., Nico Robin).";
    }
  }
  return undefined;
}

export default function LoginPage() {
  // read redirect target from URL (server redirects to /login?next=/report&verify=1)
  const [nextUrl, setNextUrl] = useState<string>("/");
  const [verifyRequired, setVerifyRequired] = useState(false);

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);

    const n = p.get("next");
    if (n && n.startsWith("/")) setNextUrl(n);
    else setNextUrl("/");

    setVerifyRequired(p.get("verify") === "1");
  }, []);

  const [mode, setMode] = useState<Mode>("login");

  // login
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");

  // register step 1
  const [fullName, setFullName] = useState("");
  const [regEmail, setRegEmail] = useState("");
  const [regPassword, setRegPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  // register step 2 (otp)
  const [regStep, setRegStep] = useState<1 | 2>(1);
  const [otp, setOtp] = useState("");

  // Keep userId so we can send OTP after login if needed
  const [otpUserId, setOtpUserId] = useState<string | null>(null);

  const [msg, setMsg] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (verifyRequired) {
      setMsg("Email verification required to continue. Please login, then request OTP.");
    }
  }, [verifyRequired]);

  function clearMessages() {
    setMsg(null);
    setErrors({});
  }

  function goNext() {
    window.location.href = nextUrl || "/";
  }

  async function sendOtpNow(userId: string, email: string) {
    try {
      const r = await fetch("http://127.0.0.1:8000/otp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: userId, email }),
      });

      const json = await r.json();

      if (!r.ok) {
        setErrors({ form: `OTP send failed: ${json?.detail ?? "Unknown error"}` });
        return;
      }

      setMsg(json?.message ? `${json.message}` : "OTP sent to your email.");
    } catch (err: any) {
      setErrors({ form: `OTP send failed: ${err?.message ?? "Network error"}` });
    }
  }

  // ✅ LOGIN: redirect if verified, otherwise show OTP step only when verification is required
  async function login(e: React.FormEvent) {
    e.preventDefault();
    clearMessages();
    setLoading(true);

    const { error } = await supabase.auth.signInWithPassword({
      email: loginEmail,
      password: loginPassword,
    });

    if (error) {
      setLoading(false);
      setMsg(`Login error: ${error.message}`);
      return;
    }

    // Get user id
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;

    if (!userId) {
      setLoading(false);
      setMsg("Logged in, but user session not found. Try again.");
      return;
    }

    // Check verification
    const { data: profile, error: profErr } = await supabase
      .from("profiles")
      .select("is_verified")
      .eq("id", userId)
      .single();

    if (profErr) {
      setLoading(false);
      setMsg(`Profile error: ${profErr.message}`);
      return;
    }

    // ✅ If verified -> go to next page
    if (profile?.is_verified) {
      setLoading(false);
      setMsg("Logged in successfully ✅ Redirecting...");
      setTimeout(goNext, 600);
      return;
    }

    // ✅ If NOT verified and verification is required -> show OTP step (do NOT auto-send)
    if (verifyRequired || nextUrl === "/report") {
      setLoading(false);

      setMode("register");     // reuse OTP UI
      setRegStep(2);
      setOtp("");
      setOtpUserId(userId);

      // put login credentials into reg fields so verifyOtp can login after success (if needed)
      setRegEmail(loginEmail);
      setRegPassword(loginPassword);

      setMsg("Your account is not verified. Click 'Send OTP' then enter the code.");
      return;
    }

    // fallback
    setLoading(false);
    setMsg("Logged in ✅");
  }

  async function registerStep1(e: React.FormEvent) {
    e.preventDefault();
    clearMessages();

    const newErrors: FieldErrors = {};
    const nameErr = validateFullName(fullName);
    if (nameErr) newErrors.fullName = nameErr;

    if (!regEmail.trim()) newErrors.email = "Email is required.";
    if (!regPassword) newErrors.password = "Password is required.";
    if (regPassword && regPassword.length < 6)
      newErrors.password = "Password must be at least 6 characters.";
    if (!confirmPassword) newErrors.confirmPassword = "Confirm password is required.";
    if (regPassword && confirmPassword && regPassword !== confirmPassword) {
      newErrors.confirmPassword = "Passwords do not match.";
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    setLoading(true);

    // 1) Create auth user
    const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
      email: regEmail,
      password: regPassword,
      options: { data: { full_name: fullName.trim() } },
    });

    if (signUpError) {
      setLoading(false);
      setErrors({ form: `Register error: ${signUpError.message}` });
      return;
    }

    // 2) Update profiles
    const userId = signUpData.user?.id;
    if (userId) {
      const { error: profileError } = await supabase
        .from("profiles")
        .update({ full_name: fullName.trim() })
        .eq("id", userId);

      if (profileError) {
        setLoading(false);
        setErrors({
          form: `Registered, but profile update failed: ${profileError.message}`,
        });
        return;
      }
    }

    setLoading(false);
    setRegStep(2);
    setOtp("");
    setOtpUserId(userId ?? null);
    setMsg("Account created. Click 'Send OTP' to verify your email.");
  }

  async function verifyOtp(e: React.FormEvent) {
    e.preventDefault();
    clearMessages();

    const newErrors: FieldErrors = {};
    const otpTrim = otp.trim();

    if (!otpTrim) newErrors.otp = "OTP is required.";
    if (otpTrim && !/^\d{6}$/.test(otpTrim)) newErrors.otp = "OTP must be 6 digits.";

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    setLoading(true);

    try {
      const r = await fetch("http://127.0.0.1:8000/otp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: regEmail,
          otp: otpTrim,
        }),
      });

      const json = await r.json();

      if (!r.ok) {
        setLoading(false);
        setErrors({ form: `OTP verify failed: ${json?.detail ?? "Unknown error"}` });
        return;
      }

      // After verification, ensure user is logged in
      const { error: loginError } = await supabase.auth.signInWithPassword({
        email: regEmail,
        password: regPassword,
      });

      setLoading(false);

      if (loginError) {
        setErrors({ form: `Verified, but login failed: ${loginError.message}` });
        return;
      }

      setMsg("Email verified ✅ Redirecting...");
      setTimeout(goNext, 700);
    } catch (err: any) {
      setLoading(false);
      setErrors({ form: `OTP verify failed: ${err?.message ?? "Network error"}` });
    }
  }

  return (
    <main style={{ minHeight: "100vh", background: "#f5f7fb" }}>
      <div style={{ maxWidth: 460, margin: "0 auto", padding: "48px 16px" }}>
        <div
          style={{
            background: "#fff",
            border: "1px solid #e6e8ef",
            borderRadius: 12,
            boxShadow: "0 6px 18px rgba(20, 20, 43, 0.06)",
            padding: 24,
          }}
        >
          <div style={{ marginBottom: 16 }}>
            <h1 style={{ margin: 0, fontSize: 24, color: "#111827" }}>CivicAI</h1>
            <p style={{ margin: "6px 0 0", color: "#6b7280", fontSize: 14 }}>
              Login or create an account to submit complaints.
            </p>

            <p style={{ margin: "10px 0 0", color: "#6b7280", fontSize: 12 }}>
              After login you will be redirected to: <b>{nextUrl}</b>
            </p>
          </div>

          {/* Tabs */}
          <div
            style={{
              display: "flex",
              background: "#f3f4f6",
              borderRadius: 10,
              padding: 4,
              marginBottom: 18,
              gap: 4,
            }}
          >
            <button
              type="button"
              onClick={() => {
                setMode("login");
                setRegStep(1);
                setOtp("");
                clearMessages();
              }}
              disabled={loading}
              style={tabStyle(mode === "login")}
            >
              Login
            </button>

            <button
              type="button"
              onClick={() => {
                setMode("register");
                clearMessages();
              }}
              disabled={loading}
              style={tabStyle(mode === "register")}
            >
              Register
            </button>
          </div>

          {errors.form && <InlineAlert text={errors.form} />}
          {msg && <InlineAlert text={msg} />}

          {mode === "login" ? (
            <form onSubmit={login}>
              <Label text="Email" />
              <Input
                placeholder="name@example.com"
                value={loginEmail}
                onChange={setLoginEmail}
                disabled={loading}
              />

              <div style={{ height: 12 }} />

              <Label text="Password" />
              <Input
                placeholder="Your password"
                type="password"
                value={loginPassword}
                onChange={setLoginPassword}
                disabled={loading}
              />

              <div style={{ height: 18 }} />

              <PrimaryButton disabled={loading} text={loading ? "Signing in..." : "Sign in"} />
            </form>
          ) : (
            <>
              {regStep === 1 ? (
                <form onSubmit={registerStep1}>
                  <Label text="Full name" />
                  <Input
                    placeholder="Nico Robin"
                    value={fullName}
                    onChange={setFullName}
                    disabled={loading}
                    invalid={!!errors.fullName}
                  />
                  {errors.fullName && <FieldError text={errors.fullName} />}

                  <div style={{ height: 12 }} />

                  <Label text="Email" />
                  <Input
                    placeholder="name@example.com"
                    value={regEmail}
                    onChange={setRegEmail}
                    disabled={loading}
                    invalid={!!errors.email}
                  />
                  {errors.email && <FieldError text={errors.email} />}

                  <div style={{ height: 12 }} />

                  <Label text="Password" />
                  <Input
                    placeholder="Minimum 6 characters"
                    type="password"
                    value={regPassword}
                    onChange={setRegPassword}
                    disabled={loading}
                    invalid={!!errors.password}
                  />
                  {errors.password && <FieldError text={errors.password} />}

                  <div style={{ height: 12 }} />

                  <Label text="Confirm password" />
                  <Input
                    placeholder="Re-type password"
                    type="password"
                    value={confirmPassword}
                    onChange={setConfirmPassword}
                    disabled={loading}
                    invalid={!!errors.confirmPassword}
                  />
                  {errors.confirmPassword && <FieldError text={errors.confirmPassword} />}

                  <div style={{ height: 18 }} />

                  <PrimaryButton
                    disabled={loading}
                    text={loading ? "Creating account..." : "Create account"}
                  />
                </form>
              ) : (
                <form onSubmit={verifyOtp}>
                  <Label text="Enter OTP (6 digits)" />
                  <Input
                    placeholder="123456"
                    value={otp}
                    onChange={setOtp}
                    disabled={loading}
                    invalid={!!errors.otp}
                  />
                  {errors.otp && <FieldError text={errors.otp} />}

                  <div style={{ height: 12 }} />

                  <button
                    type="button"
                    disabled={loading || !otpUserId || !regEmail}
                    onClick={() => {
                      if (otpUserId && regEmail) sendOtpNow(otpUserId, regEmail);
                    }}
                    style={{
                      width: "100%",
                      padding: "11px 12px",
                      borderRadius: 10,
                      border: "1px solid #d1d5db",
                      background: "#ffffff",
                      color: "#111827",
                      fontSize: 14,
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    Send OTP
                  </button>

                  <div style={{ height: 12 }} />

                  <PrimaryButton disabled={loading} text={loading ? "Verifying..." : "Verify OTP"} />

                  <button
                    type="button"
                    onClick={() => {
                      setRegStep(1);
                      setOtp("");
                      clearMessages();
                    }}
                    disabled={loading}
                    style={{
                      width: "100%",
                      marginTop: 10,
                      padding: "11px 12px",
                      borderRadius: 10,
                      border: "1px solid #d1d5db",
                      background: "#ffffff",
                      color: "#111827",
                      fontSize: 14,
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    Back
                  </button>
                </form>
              )}
            </>
          )}
        </div>
      </div>
    </main>
  );
}

/** UI helpers */
function tabStyle(active: boolean): React.CSSProperties {
  return {
    flex: 1,
    border: "none",
    borderRadius: 8,
    padding: "10px 12px",
    cursor: "pointer",
    background: active ? "#ffffff" : "transparent",
    color: "#111827",
    fontWeight: 600,
  };
}

function InlineAlert({ text }: { text: string }) {
  return (
    <div
      style={{
        marginBottom: 12,
        padding: "10px 12px",
        borderRadius: 10,
        background: "#f9fafb",
        border: "1px solid #e5e7eb",
        color: "#111827",
        fontSize: 14,
      }}
    >
      {text}
    </div>
  );
}

function FieldError({ text }: { text: string }) {
  return <div style={{ marginTop: 6, fontSize: 12, color: "#b91c1c" }}>{text}</div>;
}

function Label({ text }: { text: string }) {
  return (
    <div style={{ marginBottom: 6, fontSize: 13, color: "#374151", fontWeight: 600 }}>
      {text}
    </div>
  );
}

function Input({
  value,
  onChange,
  placeholder,
  type = "text",
  disabled,
  invalid,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  type?: string;
  disabled?: boolean;
  invalid?: boolean;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      type={type}
      disabled={disabled}
      style={{
        width: "100%",
        padding: "10px 12px",
        borderRadius: 10,
        border: invalid ? "1px solid #ef4444" : "1px solid #d1d5db",
        outline: "none",
        fontSize: 14,
        background: disabled ? "#f3f4f6" : "#ffffff",
        color: "#111827",
      }}
    />
  );
}

function PrimaryButton({ text, disabled }: { text: string; disabled?: boolean }) {
  return (
    <button
      type="submit"
      disabled={disabled}
      style={{
        width: "100%",
        padding: "11px 12px",
        borderRadius: 10,
        border: "1px solid #2563eb",
        background: disabled ? "#93c5fd" : "#2563eb",
        color: "#ffffff",
        fontSize: 14,
        fontWeight: 700,
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      {text}
    </button>
  );
}