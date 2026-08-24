"use client";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";

import React, { useEffect } from "react";
import { useRouter } from "next/navigation";
import { AppSidebar } from "./_components/AppSidebar";
import WelcomeContainer from "./dashboard/_components/WelcomeContainer";
import { useUser } from "@/app/provider";

function DashboardProvider({ children }) {
  const { authStatus } = useUser();
  const router = useRouter();

  // Every route in this group is the recruiter's signed-in application. There
  // was no guard of any kind, so an anonymous visitor was served the whole
  // shell - sidebar, "Welcome Back,", the billing screen - and each data panel
  // then waited for ever on a user that was never going to arrive.
  useEffect(() => {
    if (authStatus === "signed-out") router.replace("/auth");
  }, [authStatus, router]);

  if (authStatus !== "signed-in") {
    return (
      <div className="flex min-h-screen items-center justify-center p-10">
        <p className="text-gray-500">
          {authStatus === "loading" ? "Checking your session…" : "Redirecting to sign in…"}
        </p>
      </div>
    );
  }

  return (
    <SidebarProvider className={" bg-gray-100"}>
      <AppSidebar />
      <div className="w-full">
        <SidebarTrigger className="lg:hidden md:block text-primary font-bold mb-4" />
        <WelcomeContainer />
        {children}
      </div>
    </SidebarProvider>
  );
}

export default DashboardProvider;
