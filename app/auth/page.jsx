"use client";
import { Button } from "@/components/ui/button";
import { supabase } from "@/services/supabaseClient";
import Image from "next/image";
import React, { useState } from "react";

function Login() {
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  // Sign in with Google.
  //
  // supabase-js does NOT make a network request here. In a browser
  // signInWithOAuth builds the authorize URL and hands it straight to
  // window.location.assign, then returns { error: null }. So when the project
  // is unreachable it does not fail - it navigates the visitor away and the
  // browser renders its own DNS error page showing the raw project hostname.
  // An earlier attempt to surface the failure by reporting `error` and
  // catching a throw could never run: neither happens, and the page is gone
  // before either could paint.
  //
  // skipBrowserRedirect keeps us on the page so the redirect is ours to make,
  // and a reachability probe decides whether making it is worth doing.
  const signInWithGoogle = async () => {
    if (pending) return;
    setPending(true);
    setError("");

    try {
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { skipBrowserRedirect: true },
      });

      if (error) {
        setError(error.message);
        setPending(false);
        return;
      }
      if (!data?.url) {
        setError("Could not build a sign-in URL for Google.");
        setPending(false);
        return;
      }

      // no-cors gives an opaque response we cannot read, which is fine: we only
      // need to know whether the host answers at all. DNS failure, a paused
      // project or no network all reject here instead of stranding the visitor
      // on a browser error page.
      const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
      try {
        await fetch(`${base}/auth/v1/health`, {
          mode: "no-cors",
          cache: "no-store",
          signal: AbortSignal.timeout(8000),
        });
      } catch {
        setError(
          "The authentication service is not reachable, so sign-in cannot start. This deployment's Supabase project is unavailable."
        );
        setPending(false);
        return;
      }

      window.location.assign(data.url);
    } catch (e) {
      setError(
        `Could not start sign-in. ${e?.message || ""}`.trim()
      );
      setPending(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center h-screen bg-gradient-to-r from-[#dc7fbf] to-[#2a4675] px-4">
      <div className="flex flex-col items-center border p-6 sm:p-12 border-blue-300 rounded-2xl w-full max-w-[400px]">
        <Image
          src={"/logo.png"}
          alt="logo"
          width={400}
          height={100}
          className="w-[180px] drag-none"
        />
        <div className="w-full">
          <Image
            src={"/login.jpg"}
            alt="login"
            width={600}
            height={400}
            onClick={signInWithGoogle}
            className="w-full max-w-[400px] h-[250px] rounded-2xl object-cover border-2 hover:border-blue-300 mt-4 hover:scale-105 transition-all duration-75 cursor-pointer drag-none"
          />
          <div className="flex flex-col items-center mt-2">
            <h2 className="text-2xl font-bold">Welcome To AI Recruiter</h2>
            <p className="text-gray-700 text-center">
              Sign in With Google Authentication
            </p>
            <Button
              onClick={signInWithGoogle}
              disabled={pending}
              className="mt-2 cursor-pointer rounded-2xl w-full hover:bg-gray-700 hover:border-blue-200"
            >
              {pending ? "Signing in…" : "Sign in With Google"}
            </Button>
            {error && (
              <p
                role="alert"
                data-testid="auth-error"
                className="mt-3 w-full rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800"
              >
                {error}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default Login;
