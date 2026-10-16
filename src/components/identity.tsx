"use client";
import { useState } from "react";

export function FranchiseMark({ className = "" }: { className?: string }) {
  return (
    <svg
      className={`franchise-mark ${className}`}
      viewBox="0 0 100 100"
      fill="none"
      aria-label="Fantasy Franchise dynasty crest"
      role="img"
    >
      <path
        d="M50 5 88 27v43L50 95 12 70V27Z"
        fill="#0A0F2C"
        stroke="#C9D1DB"
        strokeWidth="2"
      />
      <path d="m27 24 8 6 15-14 15 14 8-6-5 16H32Z" fill="#00E5FF" />
      <path
        d="M26 48h25v8H35v7h13v8H35v11l-9-6Zm30 0h21v8H65v7h10v8H65v8l-9 6Z"
        fill="#F4F8FF"
      />
      <path
        d="m17 37 6-4m54 0 6 4M42 90l8-5 8 5"
        stroke="#00E5FF"
        strokeWidth="3"
      />
    </svg>
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
