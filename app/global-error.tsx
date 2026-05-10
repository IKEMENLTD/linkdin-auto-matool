"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    if (typeof window !== "undefined") console.error("[Global Error]", error);
  }, [error]);
  const fallback = (() => {
    const buf = new Uint8Array(3);
    if (typeof crypto !== "undefined" && "getRandomValues" in crypto) {
      crypto.getRandomValues(buf);
    } else {
      for (let i = 0; i < buf.length; i++) buf[i] = Math.floor(Math.random() * 256);
    }
    const hex = Array.from(buf)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase();
    return `INC-${new Date().getUTCFullYear()}-${hex}`;
  })();
  const incident = error.digest ?? fallback;
  return (
    <html lang="ja">
      <body
        style={{
          minHeight: "100vh",
          display: "grid",
          placeContent: "center",
          fontFamily: "system-ui, sans-serif",
          background: "#FFFFFF",
          color: "#0B1220",
          padding: 24,
          textAlign: "center",
        }}
      >
        <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 12 }}>
          重大なエラーが発生しました
        </h1>
        <p style={{ fontSize: 14, color: "#475569", marginBottom: 16 }}>
          時間をおいて再度お試しください。問題が続く場合は下記をサポートへ。
        </p>
        <code
          style={{
            display: "inline-block",
            padding: "6px 12px",
            border: "1px solid #E2E8F0",
            borderRadius: 8,
            background: "#F8FAFC",
            marginBottom: 16,
          }}
        >
          {incident}
        </code>
        <div>
          <button
            onClick={reset}
            style={{
              padding: "10px 18px",
              borderRadius: 999,
              border: 0,
              background: "#0EA5E9",
              color: "white",
              fontWeight: 600,
            }}
          >
            再試行する
          </button>
        </div>
      </body>
    </html>
  );
}
