"use client";
import React, { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import { toast, Toaster } from "react-hot-toast";
import { supabase } from "@/services/supabaseClient";
import Image from "next/image";
import Link from "next/link";

export default function LandingPage() {
  const router = useRouter();
  const [hasSession, setHasSession] = useState(false);
  const [showContactModal, setShowContactModal] = useState(false);
  useEffect(() => {
    const checkSession = async () => {
      const { data } = await supabase.auth.getSession();
      setHasSession(!!data.session);
    };

    checkSession();
  }, []);

  const handleDashboardClick = () => {
    if (hasSession) {
      router.push("/dashboard");
    } else {
      toast.error("Please sign in to access the dashboard.");
    }
  };

  const handleSignInClick = () => {
    if (hasSession) {
      router.push("/dashboard");
    } else {
      router.push("/auth");
    }
  };

  const handleCreateInterview = () => {
    if (hasSession) {
      router.push("/dashboard");
    } else {
      router.push("/auth");
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#f9fbff] to-[#f0f4ff] text-gray-900 select-none">
      <Toaster position="top-center" />

      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 shadow-sm bg-white">
        <div className="text-2xl font-bold text-blue-600 flex items-center gap-2">
          <Image
            src={"/logo.png"}
            alt="logo"
            height={60}
            width={60}
            className="w-[45px] h-[45px]"
          />
          <span className="text-black">AI</span>Recruiter
        </div>
        <nav className="hidden md:flex gap-6 text-sm">
          <a href="#features" className="hover:text-blue-600">
            Features
          </a>
          <a href="#whatsnew" className="hover:text-blue-600">
            What&apos;s New
          </a>
          <a href="#pricing" className="hover:text-blue-600">
            Pricing
          </a>
        </nav>
        <div className="flex gap-2">
          <Button
            className="bg-green-400 text-white hover:bg-green-700 cursor-pointer"
            onClick={handleSignInClick}
          >
            {hasSession ? "Go to Dashboard" : "Sign In"}
          </Button>
        </div>
      </header>

      {/* Hero Section */}
      <main className="grid grid-cols-1 md:grid-cols-2 gap-8 items-center px-10 md:px-20 py-16">
        <div>
          <h1 className="text-4xl md:text-5xl font-bold mb-6">
            AI-Powered{" "}
            <span className="text-blue-600">Interview Assistant</span>
            <br />
            for Modern Recruiters
          </h1>
          <p className="text-lg text-gray-600 mb-8">
            Let our AI voice agent conduct candidate interviews while you focus
            on finding the perfect match. Save time, reduce bias, and improve
            your hiring process.
          </p>
          <div className="flex flex-wrap gap-4">
            <Button
              className="bg-blue-600 text-white hover:bg-blue-700 cursor-pointer"
              onClick={handleCreateInterview}
            >
              Create Interview
            </Button>
            <a href={"/demo.mp4"} target="_blank" rel={"noopener noreferrer"}>
              <Button
                variant="outline"
                className="border-gray-300 text-gray-700 hover:bg-gray-100 cursor-pointer"
              >
                Watch Demo
              </Button>
            </a>
          </div>
        </div>
        <div className="flex justify-center">
          <Image
            src="/dashboard.png"
            alt="Dashboard Preview"
            width={1200}
            height={800}
            priority
            className="rounded-xl shadow-lg max-w-full h-auto"
          />
        </div>
      </main>

      {/* Features Section */}
      <section id="features" className="bg-white py-16 px-6 md:px-20">
        <h2 className="text-3xl font-bold text-center text-blue-600 mb-10">
          Key Features
        </h2>
        <div className="grid md:grid-cols-3 gap-8">
          <div className="p-6 bg-gray-50 rounded-lg shadow hover:shadow-md transition">
            <h3 className="text-xl font-semibold mb-2">
              Mock Interview Sessions
            </h3>
            <p className="text-gray-600">
              Simulate real-world interviews with AI-driven questions tailored
              to your domain.
            </p>
          </div>
          <div className="p-6 bg-gray-50 rounded-lg shadow hover:shadow-md transition">
            <h3 className="text-xl font-semibold mb-2">Detailed Feedback</h3>
            <p className="text-gray-600">
              Receive insights on your communication, confidence, and answer
              quality.
            </p>
          </div>
          <div className="p-6 bg-gray-50 rounded-lg shadow hover:shadow-md transition">
            <h3 className="text-xl font-semibold mb-2">Track Progress</h3>
            <p className="text-gray-600">
              Monitor your improvement over time with session history and
              analytics.
            </p>
          </div>
        </div>
      </section>

      {/* What's New Section */}
      <section
        id="whatsnew"
        className="bg-gradient-to-br from-blue-50 to-blue-100 py-16 px-6 md:px-20"
      >
        <h2 className="text-3xl font-bold text-center text-blue-600 mb-10">
          What&apos;s New
        </h2>
        <div className="grid md:grid-cols-2 gap-8">
          <div className="bg-white p-6 rounded-lg shadow hover:shadow-md transition">
            <h3 className="text-xl font-semibold mb-2">🔥 AI Voice Support</h3>
            <p className="text-gray-700">
              Experience seamless voice interviews using real-time speech
              recognition.
            </p>
          </div>
          <div className="bg-white p-6 rounded-lg shadow hover:shadow-md transition">
            <h3 className="text-xl font-semibold mb-2">
              🎯 Smart Recommending System
            </h3>
            <p className="text-gray-700">
              Recommend candidates by analyzing their interview performance
              using AI-driven insights.
            </p>
          </div>
        </div>
      </section>

      {/* Pricing Section */}
      <section id="pricing" className="bg-white py-16 px-6 md:px-20">
        <h2 className="text-3xl font-bold text-center text-blue-600 mb-10">
          Pricing Plans
        </h2>
        <div className="grid md:grid-cols-3 gap-8">
          <div className="p-6 border rounded-lg shadow hover:shadow-md transition">
            <h3 className="text-xl font-semibold mb-2">Free</h3>
            <p className="text-gray-600 mb-4">Ideal for beginners</p>
            <ul className="text-gray-600 space-y-2 mb-4">
              <li>✔️ 5 mock interviews/month</li>
              <li>✔️ Basic feedback</li>
              <li>❌ No real-time support</li>
            </ul>
            <Button className="bg-blue-600 text-white w-full hover:bg-blue-700 cursor-pointer">
              Get Started
            </Button>
          </div>
          <div className="p-6 border-2 border-blue-600 rounded-lg shadow-lg bg-blue-50">
            <div className="flex flex-row justify-between">
              <h3 className="text-xl font-semibold mb-2">Pro</h3>
              <h3 className="text-[14px] font-semibold mb-2 text-white bg-blue-800 p-2 rounded-md">
                Recommonded
              </h3>
            </div>
            <p className="text-gray-600 mb-4">Best for job seekers</p>
            <ul className="text-gray-600 space-y-2 mb-4">
              <li>✔️ Unlimited interviews</li>
              <li>✔️ AI voice assistant</li>
              <li>✔️ Analytics & feedback</li>
            </ul>
            <Button className="bg-blue-600 text-white w-full hover:bg-blue-700 cursor-pointer">
              Upgrade Now
            </Button>
          </div>
          <div className="p-6 border rounded-lg shadow hover:shadow-md transition">
            <h3 className="text-xl font-semibold mb-2">Enterprise</h3>
            <p className="text-gray-600 mb-4">For HR teams</p>
            <ul className="text-gray-600 space-y-2 mb-4">
              <li>✔️ Team dashboard</li>
              <li>✔️ API access</li>
              <li>✔️ Dedicated support</li>
            </ul>
            <Button className="bg-blue-600 text-white w-full hover:bg-blue-700 cursor-pointer">
              Contact Sales
            </Button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-gray-900 text-white py-10 px-6 md:px-20 mt-10">
        <div className="flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="text-center md:text-left">
            <h3 className="text-lg font-bold">AI Recruiter</h3>
            <p className="text-sm text-gray-400">
              © {new Date().getFullYear()} All rights reserved.
            </p>
          </div>
          <div className="flex gap-6">
            <a href="#" className="text-gray-400 hover:text-white">
              Privacy Policy
            </a>
            <a href="#" className="text-gray-400 hover:text-white">
              Terms of Service
            </a>
            <a
              href="#"
              className="text-gray-400 hover:text-white"
              onClick={() => setShowContactModal(true)}
            >
              Contact
            </a>
          </div>
        </div>
      </footer>
      {showContactModal && (
        <div className="fixed inset-0 z-50 bg-black bg-opacity-50 flex items-center justify-center">
          <div className="bg-white p-6 rounded-lg w-[90%] max-w-md shadow-lg relative">
            <button
              onClick={() => setShowContactModal(false)}
              className="absolute top-2 right-2 text-gray-500 hover:text-red-500 cursor-pointer"
            >
              ✕
            </button>
            <h2 className="text-xl font-semibold mb-4 text-center text-gray-800">
              Contact Info
            </h2>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="font-medium text-gray-700">𝕏 Twitter(X):</span>
                <a
                  href="https://twitter.com/vipinSao1"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:underline"
                >
                  @vipinSao1
                </a>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
