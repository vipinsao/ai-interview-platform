"use client";
import { useUser } from "@/app/provider";
import Image from "next/image";
import React from "react";
import { useRouter } from "next/navigation";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { supabase } from "@/services/supabaseClient";

function WelcomeContainer() {
  const { user, setUser } = useUser();
  const router = useRouter();

  // The inner function here was defined and never called, so "Logout" only
  // navigated away: the Supabase session survived and the next visit went
  // straight back into the dashboard as the same user.
  const handleLogout = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) {
      console.error("Sign out failed:", error.message);
    }
    setUser(null);
    router.push("/auth");
  };

  return (
    <div className="border bg-white p-5 rounded-2xl flex  justify-between items-center">
      <div>
        <h2 className="text-lg font-bold">
          Welcome back{user?.name ? `, ${user.name}` : ""}
        </h2>
        <h2 className="text-gray-500">
          AI-Driven Interviews, Hassel-Free Hiring
        </h2>
      </div>
      {user && (
        <DropdownMenu>
          {/* asChild used to put the trigger props straight onto the <img>,
              which is neither focusable nor a button, so logout was
              unreachable by keyboard. The button is the trigger now. */}
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Account menu"
              className="rounded-full cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
            >
              {/* next/image throws on an undefined src, and a Google account
                  without a photo has none. */}
              {user?.picture ? (
                <Image
                  src={user.picture}
                  alt=""
                  width={40}
                  height={40}
                  className="rounded-full select-none"
                />
              ) : (
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-white font-bold">
                  {user?.name?.charAt(0)?.toUpperCase() ?? "?"}
                </span>
              )}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-32 ">
            <DropdownMenuItem
              onClick={handleLogout}
              className={"cursor-pointer text-white font-bold  bg-red-800"}
            >
              Logout
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

export default WelcomeContainer;
