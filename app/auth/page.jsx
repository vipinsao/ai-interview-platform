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
  // This used to console.log the error and return. Nothing on the page changed,
  // so a failure and a slow redirect looked identical: the button appeared to
  // do nothing at all. That is also exactly how an unreachable Supabase project
  // presents, which is the one failure a visitor is most likely to meet.
  const signInWithGoogle = async () => {
    if (pending) return;
    setPending(true);
    setError("");

    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
      });
      if (error) {
        setError(error.message);
        setPending(false);
      }
      // On success the browser is redirected to Google, so nothing below runs
      // and `pending` deliberately stays set.
    } catch (e) {
      // Thrown rather than returned when the project cannot be reached at all
      // — DNS failure, paused project, no network.
      setError(
        `Could not reach the authentication service. ${e?.message || ""}`.trim()
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
