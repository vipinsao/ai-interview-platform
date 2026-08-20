"use client";
import { Button } from "@/components/ui/button";
import { supabase } from "@/services/supabaseClient";
import Image from "next/image";
import React from "react";

function Login() {
  //use to sign with google
  const signInWithGoogle = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
    });
    if (error) {
      console.log("Error signing in with Google:", error.message);
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
              className="mt-2 cursor-pointer rounded-2xl w-full hover:bg-gray-700 hover:border-blue-200"
            >
              Sign in With Google
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Login;
