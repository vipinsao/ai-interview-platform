"use client";
import { PayPalButtons } from "@paypal/react-paypal-js";
import React, { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import toast from "react-hot-toast";
import { useUser } from "@/app/provider";
import { postWithAuth } from "@/services/apiClient";
import { PLAN_CURRENCY } from "@/lib/plans";

/**
 * This component used to add the credits itself: onApprove ran an UPDATE on the
 * Users table straight from the browser, with nothing checking that PayPal had
 * taken any money. It now sends the order id to the server and displays what
 * the server says happened. The number of credits is not in its gift.
 */
function PayButton({ plan }) {
  const { setUser } = useUser();
  const [pending, setPending] = useState(false);
  const configured = Boolean(process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID);

  const onApprove = async (data) => {
    setPending(true);
    try {
      const result = await postWithAuth("/api/billing/capture", {
        orderId: data.orderID,
      });

      // The balance shown is the one the server returned, not one this
      // component worked out for itself.
      setUser((current) =>
        current ? { ...current, credits: result.creditsTotal ?? current.credits } : current
      );

      toast.success(
        result.alreadyGranted
          ? "Those credits were already added to your account."
          : `${result.credits} credits added.`
      );
    } catch (error) {
      toast.error(error.message ?? "That payment could not be completed.");
    } finally {
      setPending(false);
    }
  };

  if (!configured) {
    return (
      <Button className="w-full" disabled title="NEXT_PUBLIC_PAYPAL_CLIENT_ID is not set">
        Purchasing unavailable
      </Button>
    );
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button className="w-full bg-blue-600 text-white py-2 rounded-md font-medium hover:bg-blue-700 cursor-pointer">
          Purchase Credits
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {plan.name} — {plan.credits} credits for ${plan.price}
          </DialogTitle>
          <DialogDescription asChild>
            <div className="paypal-container w-full max-w-xs mx-auto scale-95 overflow-x-auto">
              {pending && (
                <p className="text-sm text-gray-600 mb-2">
                  Confirming your payment with PayPal…
                </p>
              )}
              <PayPalButtons
                style={{ layout: "vertical" }}
                disabled={pending}
                onApprove={onApprove}
                onCancel={() => toast("Payment cancelled.")}
                onError={() => toast.error("PayPal could not process that payment.")}
                createOrder={(data, actions) =>
                  actions.order.create({
                    intent: "CAPTURE",
                    purchase_units: [
                      {
                        amount: { value: plan.price, currency_code: PLAN_CURRENCY },
                        description: `${plan.name}: ${plan.credits} interview credits`,
                        // Convenience for reading the PayPal dashboard. The
                        // server ignores it and resolves the plan from the
                        // amount PayPal reports as captured.
                        custom_id: plan.id,
                      },
                    ],
                  })
                }
              />
            </div>
          </DialogDescription>
        </DialogHeader>
      </DialogContent>
    </Dialog>
  );
}

export default PayButton;
