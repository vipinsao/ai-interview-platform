import { Button } from "@/components/ui/button";
import Image from "next/image";
import Link from "next/link";
import React from "react";

function page() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100 mt-4 w-full">
      <div className="bg-white rounded-lg shadow-md p-8 w-full max-w-lg flex flex-col items-center">
        {/* Logo */}
        <div className="flex items-center gap-2 mb-4">
          <Image src="/completed.png" alt="Logo" width={40} height={40} />
          <h1 className="text-2xl font-bold text-gray-700">
            Interview Completed
          </h1>
        </div>

        {/* Subtitle */}
        <h2 className="text-gray-600 mb-2 text-center">
          Thank you for participating in the AI-driven interview with{" "}
          <span className="text-primary">AIcruiter</span>
        </h2>

        {/* Illustration Image */}
        {/* A fixed 400x400 needed 464px inside this p-8 card, and the
            interview layout is overflow-x-hidden, so on a phone the image was
            clipped rather than scrollable. */}
        <Image
          src="/completion.jpg"
          alt="Interview Illustration"
          width={320}
          height={320}
          className="w-full max-w-[320px] h-auto"
        />

        <div className="flex gap-4 items-center">
          <Image
            src={"/send.png"}
            alt="send"
            width={100}
            height={100}
            className="w-[50px] h-[50px]"
          />
          <h2 className="font-semibold text-xl">What&apos;s Next?</h2>
        </div>
        <p className="text-center text-gray-400">
          The Recruiter will review your interview response and will contact you
          regarding the next steps in next 3 to 5 days.
        </p>
        <p className="text-sm mt-1 text-purple-700 font-bold">
          {" "}
          BEST OF LUCK!!
        </p>
        <Link href={"/dashboard"}>
          <Button className={"mt-2 cursor-pointer w-[100px]"}>Exit</Button>
        </Link>
      </div>
    </div>
  );
}

export default page;
