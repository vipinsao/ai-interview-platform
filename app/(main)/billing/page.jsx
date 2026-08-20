"use client";
import { useUser } from "@/app/provider";
import { CreditCard } from "lucide-react";
import React from "react";
import PayButton from "./_components/PayButton";
import { PayPalScriptProvider } from "@paypal/react-paypal-js";
import { CREDIT_PLANS, PLAN_CURRENCY } from "@/lib/plans";

const paypalClientId = process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID;

/**
 * The PayPal SDK is mounted here rather than in the root provider: it is 59 kB
 * of third-party payments JavaScript, and this is the only page that has any
 * use for it. A candidate taking an interview should never load it.
 */
function Billing() {
  const { user } = useUser();
  // This was previously reassigned inside a useEffect, where the new value was
  // discarded on every render. It is just a derived value.
  const creditsLeft = user?.credits ?? 0;

  const page = (
    <div className="p-8">
      <h1 className="text-3xl font-bold mb-2">Billing</h1>
      <p className="text-gray-500 mb-6">Manage your payments and credits</p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        <div className="bg-white p-6 rounded-xl shadow-sm border col-span-1">
          <h2 className="font-semibold text-lg mb-2">Your Credits</h2>
          <p className="text-sm text-gray-500 mb-4">
            One credit creates one interview.
          </p>

          <div className="flex items-center gap-3 p-4 bg-gray-100 rounded-lg font-bold text-blue-600 text-lg">
            <CreditCard className="w-5 h-5 text-blue-600" />
            {creditsLeft} interviews left
          </div>
        </div>

        <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-3 gap-6">
          {CREDIT_PLANS.map((plan) => (
            <div
              key={plan.id}
              className="p-6 bg-white rounded-xl border shadow-sm hover:shadow-md transition"
            >
              <h3 className="text-xl font-semibold mb-1">{plan.name}</h3>
              <p className="text-gray-800 text-2xl font-bold mb-1">${plan.price}</p>
              <p className="text-sm text-gray-500 mb-4">{plan.credits} interviews</p>

              <ul className="text-sm text-gray-700 mb-4 space-y-2">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2">
                    <span className="text-blue-600 font-bold">•</span> {feature}
                  </li>
                ))}
              </ul>
              <PayButton plan={plan} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  // Without a client id the SDK cannot load, and mounting the provider anyway
  // fills the console with errors. PayButton renders a disabled control in
  // that case, so the page still explains itself.
  if (!paypalClientId) return page;

  return (
    <PayPalScriptProvider
      options={{ clientId: paypalClientId, currency: PLAN_CURRENCY, intent: "capture" }}
    >
      {page}
    </PayPalScriptProvider>
  );
}

export default Billing;
