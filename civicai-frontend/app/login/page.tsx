"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
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
      return "Each word must start with a capital letter (for example, Nico Robin).";
    }
  }
  return undefined;
}

function formatTime(seconds: number) {
  const s = Math.max(0, seconds);
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

function formatDateTime(date: Date | null) {
  if (!date) return "";
  return date.toLocaleString();
}

export default function LoginPage() {
  const router = useRouter();

  const [nextUrl, setNextUrl] = useState<string>("/");
  const [verifyRequired, setVerifyRequired] = useState(false);

  const [mode, setMode] = useState<Mode>("login");

  // login
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");

  // register
  const [fullName, setFullName] = useState("");
  const [regEmail, setRegEmail] = useState("");
  const [regPassword, setRegPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  // otp
  const [regStep, setRegStep] = useState<1 | 2>(1);
  const [otp, setOtp] = useState("");
  const [otpUserId, setOtpUserId] = useState<string | null>(null);

  const [msg, setMsg] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [loading, setLoading] = useState(false);
  const [otpSending, setOtpSending] = useState(false);

  // timing
  const [cooldownLeft, setCooldownLeft] = useState(0);
  const [expiresLeft, setExpiresLeft] = useState(0);
  const [lastOtpSentAt, setLastOtpSentAt] = useState<Date | null>(null);

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);

    const n = p.get("next");
    if (n && n.startsWith("/")) setNextUrl(n);
    else setNextUrl("/");

    setVerifyRequired(p.get("verify") === "1");
  }, []);

  useEffect(() => {
    if (verifyRequired) {
      setMsg(
        "Verification is required before you can continue. Please sign in and complete email verification."
      );
    }
  }, [verifyRequired]);

  useEffect(() => {
    const t = setInterval(() => {
      setCooldownLeft((prev) => (prev > 0 ? prev - 1 : 0));
      setExpiresLeft((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);

    return () => clearInterval(t);
  }, []);

  function clearMessages() {
    setMsg(null);
    setErrors({});
  }

  async function goNext() {
    router.replace(nextUrl || "/");
    router.refresh();
  }

  async function getCurrentUser() {
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error || !user) {
      throw new Error("Authenticated user not found.");
    }

    return user;
  }

  async function getVerifiedStatus(userId: string) {
    const { data, error } = await supabase
      .from("profiles")
      .select("is_verified")
      .eq("id", userId)
      .maybeSingle();

    if (error) {
      throw new Error(`Profile lookup failed: ${error.message}`);
    }

    return !!data?.is_verified;
  }

  async function sendOtpNow(userId: string, email: string) {
    clearMessages();

    if (cooldownLeft > 0) return;

    setOtpSending(true);

    try {
      const r = await fetch("http://127.0.0.1:8000/otp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: userId, email: email.trim() }),
      });

      const json = await r.json();

      if (!r.ok) {
        setErrors({
          form: `Unable to send verification code: ${json?.detail ?? "Unknown error"}`,
        });
        return;
      }

      const sentAt = json?.sent_at ? new Date(json.sent_at) : new Date();
      const expiresAt = json?.expires_at ? new Date(json.expires_at) : null;
      const cooldownSeconds =
        typeof json?.cooldown_seconds === "number" ? json.cooldown_seconds : 60;

      setLastOtpSentAt(sentAt);
      setCooldownLeft(cooldownSeconds);

      if (expiresAt) {
        const sec = Math.max(
          0,
          Math.floor((expiresAt.getTime() - Date.now()) / 1000)
        );
        setExpiresLeft(sec);
      } else {
        setExpiresLeft(10 * 60);
      }

      setMsg(
        "A verification code has been sent to your email address. Please enter the most recent code you received."
      );
    } catch (err: any) {
      setErrors({
        form: `Unable to send verification code: ${err?.message ?? "Network error"}`,
      });
    } finally {
      setOtpSending(false);
    }
  }

  async function login(e: React.FormEvent) {
    e.preventDefault();
    clearMessages();
    setLoading(true);

    try {
      const email = loginEmail.trim();

      const { error } = await supabase.auth.signInWithPassword({
        email,
        password: loginPassword,
      });

      if (error) {
        setErrors({ form: `Sign-in failed: ${error.message}` });
        return;
      }

      const user = await getCurrentUser();
      const isVerified = await getVerifiedStatus(user.id);

      if (isVerified) {
        setMsg("Sign-in successful. Redirecting...");
        await goNext();
        return;
      }

      setMode("register");
      setRegStep(2);
      setRegEmail(email);
      setRegPassword(loginPassword);
      setOtpUserId(user.id);
      setOtp("");
      setCooldownLeft(0);
      setExpiresLeft(0);
      setLastOtpSentAt(null);

      setMsg(
        "Your account has not been verified yet. Please request a verification code and enter it below."
      );
    } catch (err: any) {
      setErrors({ form: err?.message ?? "Something went wrong during sign-in." });
    } finally {
      setLoading(false);
    }
  }

  async function registerStep1(e: React.FormEvent) {
    e.preventDefault();
    clearMessages();

    const newErrors: FieldErrors = {};
    const nameErr = validateFullName(fullName);
    if (nameErr) newErrors.fullName = nameErr;

    if (!regEmail.trim()) newErrors.email = "Email is required.";
    if (!regPassword) newErrors.password = "Password is required.";
    if (regPassword && regPassword.length < 6) {
      newErrors.password = "Password must be at least 6 characters.";
    }
    if (!confirmPassword) newErrors.confirmPassword = "Please confirm your password.";
    if (regPassword && confirmPassword && regPassword !== confirmPassword) {
      newErrors.confirmPassword = "Passwords do not match.";
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    setLoading(true);

    try {
      const email = regEmail.trim();

      const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
        email,
        password: regPassword,
        options: {
          data: { full_name: fullName.trim() },
        },
      });

      if (signUpError) {
        setErrors({ form: `Registration failed: ${signUpError.message}` });
        return;
      }

      const userId = signUpData.user?.id;

      if (!userId) {
        setErrors({
          form: "Your account was created, but the user ID was not returned. Please try signing in.",
        });
        return;
      }

      const { error: profileError } = await supabase.from("profiles").upsert(
        {
          id: userId,
          full_name: fullName.trim(),
          is_verified: false,
        },
        { onConflict: "id" }
      );

      if (profileError) {
        setErrors({
          form: `Your account was created, but profile setup failed: ${profileError.message}`,
        });
        return;
      }

      setOtpUserId(userId);
      setRegEmail(email);
      setRegStep(2);
      setOtp("");
      setCooldownLeft(0);
      setExpiresLeft(0);
      setLastOtpSentAt(null);

      setMsg(
        "Your account has been created. Please request a verification code to activate your account."
      );
    } catch (err: any) {
      setErrors({ form: err?.message ?? "Something went wrong during registration." });
    } finally {
      setLoading(false);
    }
  }

  async function verifyOtp(e: React.FormEvent) {
    e.preventDefault();
    clearMessages();

    const otpTrim = otp.trim();
    const newErrors: FieldErrors = {};

    if (!otpUserId) {
      newErrors.form = "User ID is missing. Please request a new verification code.";
    }

    if (!otpTrim) newErrors.otp = "Verification code is required.";
    if (otpTrim && !/^\d{6}$/.test(otpTrim)) {
      newErrors.otp = "Verification code must contain exactly 6 digits.";
    }

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
          user_id: otpUserId,
          email: regEmail.trim(),
          otp: otpTrim,
        }),
      });

      const json = await r.json();

      if (!r.ok) {
        setErrors({
          form: `Verification failed: ${json?.detail ?? "Unknown error"}`,
        });
        return;
      }

      const { error: loginError } = await supabase.auth.signInWithPassword({
        email: regEmail.trim(),
        password: regPassword,
      });

      if (loginError) {
        setErrors({
          form: `Verification succeeded, but automatic sign-in failed: ${loginError.message}`,
        });
        return;
      }

      const user = await getCurrentUser();
      const isVerified = await getVerifiedStatus(user.id);

      if (!isVerified) {
        setErrors({
          form: "Verification was accepted, but your profile is not yet marked as verified.",
        });
        return;
      }

      setMsg("Your email address has been verified successfully. Redirecting...");
      await goNext();
    } catch (err: any) {
      setErrors({ form: err?.message ?? "Something went wrong during verification." });
    } finally {
      setLoading(false);
    }
  }

  const otpStatusText = useMemo(() => {
    if (cooldownLeft > 0) {
      return `You can request a new code in ${formatTime(cooldownLeft)}.`;
    }
    return "You may request a new verification code now.";
  }, [cooldownLeft]);

  const otpExpiryText = useMemo(() => {
    if (expiresLeft > 0) {
      return `Current code expires in ${formatTime(expiresLeft)}.`;
    }
    if (lastOtpSentAt) {
      return "The previous code may have expired. Please request a new one if needed.";
    }
    return "A verification code becomes active after you request one.";
  }, [expiresLeft, lastOtpSentAt]);

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
              Sign in or create an account to continue.
            </p>
            <p style={{ margin: "10px 0 0", color: "#6b7280", fontSize: 12 }}>
              After authentication, you will be redirected to: <b>{nextUrl}</b>
            </p>
          </div>

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
              disabled={loading || otpSending}
              style={tabStyle(mode === "login")}
            >
              Sign in
            </button>

            <button
              type="button"
              onClick={() => {
                setMode("register");
                setRegStep(1);
                setOtp("");
                clearMessages();
              }}
              disabled={loading || otpSending}
              style={tabStyle(mode === "register")}
            >
              Register
            </button>
          </div>

          {errors.form && <InlineAlert text={errors.form} variant="error" />}
          {msg && <InlineAlert text={msg} variant="info" />}

          {mode === "login" ? (
            <form onSubmit={login}>
              <Label text="Email address" />
              <Input
                placeholder="name@example.com"
                value={loginEmail}
                onChange={setLoginEmail}
                disabled={loading}
              />

              <div style={{ height: 12 }} />

              <Label text="Password" />
              <Input
                placeholder="Enter your password"
                type="password"
                value={loginPassword}
                onChange={setLoginPassword}
                disabled={loading}
              />

              <div style={{ height: 18 }} />

              <PrimaryButton
                disabled={loading}
                text={loading ? "Signing in..." : "Sign in"}
              />
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

                  <Label text="Email address" />
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
                    placeholder="Re-enter your password"
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
                  <Label text="Verification code" />
                  <Input
                    placeholder="Enter the latest 6-digit code"
                    value={otp}
                    onChange={setOtp}
                    disabled={loading}
                    invalid={!!errors.otp}
                  />
                  {errors.otp && <FieldError text={errors.otp} />}

                  <div
                    style={{
                      marginTop: 10,
                      padding: "10px 12px",
                      borderRadius: 10,
                      background: "#f9fafb",
                      border: "1px solid #e5e7eb",
                    }}
                  >
                    <div style={{ fontSize: 13, color: "#111827", fontWeight: 600 }}>
                      Verification status
                    </div>
                    <div style={{ marginTop: 6, fontSize: 13, color: "#4b5563" }}>
                      {otpStatusText}
                    </div>
                    <div style={{ marginTop: 6, fontSize: 13, color: "#4b5563" }}>
                      {otpExpiryText}
                    </div>
                    {lastOtpSentAt && (
                      <div style={{ marginTop: 6, fontSize: 12, color: "#6b7280" }}>
                        Last code sent: {formatDateTime(lastOtpSentAt)}
                      </div>
                    )}
                  </div>

                  <div style={{ height: 12 }} />

                  <button
                    type="button"
                    disabled={loading || otpSending || cooldownLeft > 0 || !otpUserId || !regEmail}
                    onClick={() => {
                      if (otpUserId && regEmail) sendOtpNow(otpUserId, regEmail);
                    }}
                    style={{
                      width: "100%",
                      padding: "11px 12px",
                      borderRadius: 10,
                      border: "1px solid #d1d5db",
                      background:
                        loading || otpSending || cooldownLeft > 0 || !otpUserId || !regEmail
                          ? "#f3f4f6"
                          : "#ffffff",
                      color: "#111827",
                      fontSize: 14,
                      fontWeight: 700,
                      cursor:
                        loading || otpSending || cooldownLeft > 0 || !otpUserId || !regEmail
                          ? "not-allowed"
                          : "pointer",
                    }}
                  >
                    {otpSending
                      ? "Sending code..."
                      : cooldownLeft > 0
                      ? `Resend available in ${formatTime(cooldownLeft)}`
                      : "Send verification code"}
                  </button>

                  <div style={{ height: 12 }} />

                  <PrimaryButton
                    disabled={loading}
                    text={loading ? "Verifying..." : "Verify and continue"}
                  />

                  <button
                    type="button"
                    onClick={() => {
                      setRegStep(1);
                      setOtp("");
                      clearMessages();
                    }}
                    disabled={loading || otpSending}
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

function InlineAlert({
  text,
  variant = "info",
}: {
  text: string;
  variant?: "info" | "error";
}) {
  const isError = variant === "error";

  return (
    <div
      style={{
        marginBottom: 12,
        padding: "10px 12px",
        borderRadius: 10,
        background: isError ? "#fef2f2" : "#f9fafb",
        border: isError ? "1px solid #fecaca" : "1px solid #e5e7eb",
        color: isError ? "#991b1b" : "#111827",
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