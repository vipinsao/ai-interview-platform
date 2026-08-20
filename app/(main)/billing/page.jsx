"use client";
import { useUser } from "@/app/provider";
import { CreditCard, PlusCircle } from "lucide-react";
import React from "react";
import PayButton from "./_components/PayButton";

const plans = [
  {
    name: "Basic",
    price: "5",
    interviews: 20,
    features: ["Basic interview templates", "Email support"],
  },
  {
    name: "Standard",
    price: "12",
    interviews: 50,
    features: [
      "All interview templates",
      "Priority support",
      "Basic analytics",
    ],
  },
  {
    name: "Pro",
    price: "25",
    interviews: 120,
    features: ["All interview templates", "24/7 support", "Advanced analytics"],
  },
];

function Billing() {
  const user = useUser();
  // This was previously reassigned inside a useEffect, where the new value was
  // discarded on every render. It is just a derived value.
  const creditsLeft = user?.user?.credits ?? 0;
  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold mb-2">Billing</h1>
      <p className="text-gray-500 mb-6">Manage your Payment and credits</p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        {/* Your Credits */}
        <div className="bg-white p-6 rounded-xl shadow-sm border col-span-1">
          <h2 className="font-semibold text-lg mb-2">Your Credits</h2>
          <p className="text-sm text-gray-500 mb-4">
            Current usage and remaining credits
          </p>

          <div className="flex items-center gap-3 p-4 bg-gray-100 rounded-lg font-bold text-blue-600 text-lg">
            <CreditCard className="w-5 h-5 text-blue-600" />
            {creditsLeft} interviews left
          </div>

          <button className="mt-5 flex items-center gap-2 bg-blue-600 text-white font-medium py-2 px-4 rounded-md hover:bg-blue-700 cursor-pointer">
            <PlusCircle className="w-5 h-5" />
            Add More Credits
          </button>
        </div>

        {/* Purchase Credits */}
        <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-3 gap-6">
          {plans.map((plan) => (
            <div
              key={plan.name}
              className="p-6 bg-white rounded-xl border shadow-sm hover:shadow-md transition"
            >
              <h3 className="text-xl font-semibold mb-1">{plan.name}</h3>
              <p className="text-gray-800 text-2xl font-bold mb-1">
                ${plan.price}
              </p>
              <p className="text-sm text-gray-500 mb-4">
                {plan.interviews} interviews
              </p>

              <ul className="text-sm text-gray-700 mb-4 space-y-2">
                {plan.features.map((feature, index) => (
                  <li key={index} className="flex items-start gap-2">
                    <span className="text-blue-600 font-bold">•</span> {feature}
                  </li>
                ))}
              </ul>
              <PayButton amount={plan.price} credits={plan.interviews} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default Billing;
