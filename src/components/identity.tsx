"use client";
import { useState } from "react";

export function FranchiseMark({ className = "" }: { className?: string }) {
  return (
    // The owner's original logo is served locally with its full aspect ratio.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className={`franchise-mark ${className}`}
      src="/brand/fantasy-franchise-logo.jpg"
      alt="Fantasy Franchise — crowned football logo"
      width={1206}
      height={795}
      fetchPriority="high"
      decoding="async"
    />
  );
}

export function TeamLogo({
  id,
  className = "",
}: {
  id: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  return failed ? (
    <span className={`team-logo-fallback ${className}`}>{id}</span>
  ) : (
    // Team artwork is served locally; avoid runtime CDN dependence in the draft room.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className={`team-logo ${className}`}
      src={`/teams/${id}.png`}
      alt={`${id} logo`}
      width={64}
      height={64}
      onError={() => setFailed(true)}
    />
  );
}
