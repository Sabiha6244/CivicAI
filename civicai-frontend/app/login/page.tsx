"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import styles from "./login.module.css";

type Mode = "login" | "register";

type FieldErrors = {
  fullName?: string;
  email?: string;
  password?: string;
  confirmPassword?: string;
  otp?: string;
  form?: string;
};

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:8000";

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

  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");

  const [fullName, setFullName] = useState("");
  const [regEmail, setRegEmail] = useState("");
  const [regPassword, setRegPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [regStep, setRegStep] = useState<1 | 2>(1);
  const [otp, setOtp] = useState("");
  const [otpUserId, setOtpUserId] = useState<string | null>(null);

  const [msg, setMsg] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [loading, setLoading] = useState(false);
  const [otpSending, setOtpSending] = useState(false);

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

  function goNext() {
    window.location.assign(nextUrl || "/");
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
      const r = await fetch(`${API_BASE_URL}/otp/send`, {
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
        const sec = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
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

      setOtpUserId(userId);
      setRegEmail(email);
      setRegStep(2);
      setOtp("");
      setCooldownLeft(0);
      setExpiresLeft(0);
      setLastOtpSentAt(null);

      setMsg(
        "Your account has been created successfully. Please request a verification code to activate your account."
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
      const r = await fetch(`${API_BASE_URL}/otp/verify`, {
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

  const heroTitle =
    mode === "login"
      ? "Welcome back"
      : regStep === 1
      ? "Create your account"
      : "Verify your email";

  const heroText =
    mode === "login"
      ? "Sign in to continue to complaint reporting and protected pages."
      : regStep === 1
      ? "Register to submit complaints and access verified reporting features."
      : "Enter the latest 6-digit code sent to your email address.";

  return (
    <main className={styles.page}>
      <div className={styles.wrapper}>
        <div className={styles.authShell}>
          <div className={styles.brandBlock}>
            <Link href="/" className={styles.brandLink}>
              CivicAI
            </Link>
            <p className={styles.brandText}>Secure access for complaint reporting</p>
          </div>

          <div className={styles.card}>
            <div className={styles.header}>
              <p className={styles.eyebrow}>Secure access</p>
              <h1 className={styles.title}>{heroTitle}</h1>
              <p className={styles.subtitle}>{heroText}</p>
              <p className={styles.redirectText}>
                Continue to <b>{nextUrl}</b> after successful authentication.
              </p>
            </div>

            <div className={styles.tabs}>
              <button
                type="button"
                onClick={() => {
                  setMode("login");
                  setRegStep(1);
                  setOtp("");
                  clearMessages();
                }}
                disabled={loading || otpSending}
                className={`${styles.tabButton} ${mode === "login" ? styles.tabActive : ""}`}
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
                className={`${styles.tabButton} ${mode === "register" ? styles.tabActive : ""}`}
              >
                Register
              </button>
            </div>

            {errors.form && <InlineAlert text={errors.form} variant="error" />}
            {msg && <InlineAlert text={msg} variant="info" />}

            {mode === "login" ? (
              <form onSubmit={login} className={styles.form}>
                <Label text="Email address" />
                <Input
                  placeholder="name@example.com"
                  value={loginEmail}
                  onChange={setLoginEmail}
                  disabled={loading}
                />

                <div className={styles.spacer12} />

                <Label text="Password" />
                <Input
                  placeholder="Enter your password"
                  type="password"
                  value={loginPassword}
                  onChange={setLoginPassword}
                  disabled={loading}
                />

                <div className={styles.spacer18} />

                <PrimaryButton disabled={loading} text={loading ? "Signing in..." : "Sign in"} />
              </form>
            ) : (
              <>
                {regStep === 1 ? (
                  <form onSubmit={registerStep1} className={styles.form}>
                    <Label text="Full name" />
                    <Input
                      placeholder="Nico Robin"
                      value={fullName}
                      onChange={setFullName}
                      disabled={loading}
                      invalid={!!errors.fullName}
                    />
                    {errors.fullName && <FieldError text={errors.fullName} />}

                    <div className={styles.spacer12} />

                    <Label text="Email address" />
                    <Input
                      placeholder="name@example.com"
                      value={regEmail}
                      onChange={setRegEmail}
                      disabled={loading}
                      invalid={!!errors.email}
                    />
                    {errors.email && <FieldError text={errors.email} />}

                    <div className={styles.spacer12} />

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

                    <div className={styles.spacer12} />

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

                    <div className={styles.spacer18} />

                    <PrimaryButton
                      disabled={loading}
                      text={loading ? "Creating account..." : "Create account"}
                    />
                  </form>
                ) : (
                  <form onSubmit={verifyOtp} className={styles.form}>
                    <Label text="Verification code" />
                    <Input
                      placeholder="Enter the latest 6-digit code"
                      value={otp}
                      onChange={setOtp}
                      disabled={loading}
                      invalid={!!errors.otp}
                    />
                    {errors.otp && <FieldError text={errors.otp} />}

                    <div className={styles.statusBox}>
                      <div className={styles.statusTitle}>Verification status</div>
                      <div className={styles.statusText}>{otpStatusText}</div>
                      <div className={styles.statusText}>{otpExpiryText}</div>
                      {lastOtpSentAt && (
                        <div className={styles.statusSubtext}>
                          Last code sent: {formatDateTime(lastOtpSentAt)}
                        </div>
                      )}
                    </div>

                    <div className={styles.spacer12} />

                    <button
                      type="button"
                      disabled={
                        loading || otpSending || cooldownLeft > 0 || !otpUserId || !regEmail
                      }
                      onClick={() => {
                        if (otpUserId && regEmail) sendOtpNow(otpUserId, regEmail);
                      }}
                      className={styles.secondaryButton}
                    >
                      {otpSending
                        ? "Sending code..."
                        : cooldownLeft > 0
                        ? `Resend available in ${formatTime(cooldownLeft)}`
                        : "Send verification code"}
                    </button>

                    <div className={styles.spacer12} />

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
                      className={styles.backButton}
                    >
                      Back
                    </button>
                  </form>
                )}
              </>
            )}

            <div className={styles.footerRow}>
              <Link href="/" className={styles.footerLink}>
                Back to homepage
              </Link>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

function InlineAlert({
  text,
  variant = "info",
}: {
  text: string;
  variant?: "info" | "error";
}) {
  const className =
    variant === "error"
      ? `${styles.alert} ${styles.alertError}`
      : `${styles.alert} ${styles.alertInfo}`;

  return <div className={className}>{text}</div>;
}

function FieldError({ text }: { text: string }) {
  return <div className={styles.fieldError}>{text}</div>;
}

function Label({ text }: { text: string }) {
  return <div className={styles.label}>{text}</div>;
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
      className={`${styles.input} ${invalid ? styles.inputInvalid : ""}`}
    />
  );
}

function PrimaryButton({ text, disabled }: { text: string; disabled?: boolean }) {
  return (
    <button type="submit" disabled={disabled} className={styles.primaryButton}>
      {text}
    </button>
  );
}