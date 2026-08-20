"use client";
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
import { toast } from "sonner";
import moment from "moment/moment";
import ReportBody from "@/components/ReportBody";
import { shareLinkState, shareUrl } from "@/lib/share";
import { postWithAuth } from "@/services/apiClient";

function CandidateFeedbackDialog({ candidate }) {
  const [link, setLink] = useState(() =>
    shareLinkState({
      token: candidate?.share_token,
      expiresAt: candidate?.share_expires_at,
    }) === "valid"
      ? { token: candidate.share_token, expiresAt: candidate.share_expires_at }
      : null
  );
  const [busy, setBusy] = useState(false);

  const onShare = async () => {
    setBusy(true);
    try {
      const result = await postWithAuth("/api/feedback/share", {
        feedbackId: candidate.id,
      });
      setLink({ token: result.token, expiresAt: result.expiresAt });
      // The URL is rendered below as well, because clipboard access is refused
      // on insecure origins and a silent failure would look like a broken button.
      await navigator.clipboard
        ?.writeText(shareUrl(window.location.origin, result.token))
        .then(() => toast.success("Share link copied."))
        .catch(() => toast.success("Share link created."));
    } catch (error) {
      toast.error(error.message ?? "That report could not be shared.");
    } finally {
      setBusy(false);
    }
  };

  const onRevoke = async () => {
    setBusy(true);
    try {
      await postWithAuth("/api/feedback/share", {
        feedbackId: candidate.id,
        revoke: true,
      });
      setLink(null);
      toast.success("Share link revoked.");
    } catch (error) {
      toast.error(error.message ?? "That link could not be revoked.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant={"outline"} className={"text-primary cursor-pointer"}>
          View Report
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Candidate report</DialogTitle>
          <DialogDescription asChild>
            <div>
              <ReportBody
                userName={candidate?.userName}
                subtitle={candidate?.userEmail ?? "no email provided"}
                report={candidate?.feedback}
                contact={
                  candidate?.userEmail ? (
                    <a href={`mailto:${candidate.userEmail}`}>
                      <Button className="cursor-pointer">Email candidate</Button>
                    </a>
                  ) : null
                }
              />

              <div className="mt-6 border-t pt-4">
                <h3 className="font-bold text-sm">Share this report</h3>
                <p className="text-xs text-gray-500 mt-1">
                  Creates a read-only link that needs no account. It expires,
                  and you can revoke it at any time.
                </p>
                {link && (
                  <p className="text-xs mt-2 break-all">
                    <span className="text-gray-600">
                      Expires {moment(link.expiresAt).format("DD MMM, YYYY")}:
                    </span>{" "}
                    {shareUrl(
                      typeof window === "undefined" ? "" : window.location.origin,
                      link.token
                    )}
                  </p>
                )}
                <div className="flex gap-2 mt-3">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy}
                    onClick={onShare}
                    className="cursor-pointer"
                  >
                    {link ? "Copy link" : "Create share link"}
                  </Button>
                  {link && (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={busy}
                      onClick={onRevoke}
                      className="cursor-pointer text-red-700"
                    >
                      Revoke link
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </DialogDescription>
        </DialogHeader>
      </DialogContent>
    </Dialog>
  );
}

export default CandidateFeedbackDialog;
