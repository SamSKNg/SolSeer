import React, { useEffect, useRef, useState } from "react";
import { Link2, Check } from "lucide-react";
import { joinUrl } from "../shared/roblox-links.js";
import "./sharing.css";

export function CopyServerLink({ id }) {
  return <CopyLink key={id} id={id} />;
}

function CopyLink({ id }) {
  const [status, setStatus] = useState("idle");
  const alive = useRef(true);
  const timer = useRef(null);
  const url = joinUrl(id);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      clearTimeout(timer.current);
    };
  }, []);
  const copy = async () => {
    clearTimeout(timer.current);
    setStatus("copying");
    try {
      if (!navigator.clipboard?.writeText)
        throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(url);
      if (!alive.current) return;
      setStatus("copied");
      timer.current = setTimeout(() => setStatus("idle"), 2000);
    } catch {
      if (alive.current) setStatus("fallback");
    }
  };
  return (
    <div className="copy-link-wrap">
      <button
        type="button"
        className="copy-server-link"
        onClick={copy}
        disabled={status === "copying"}
        aria-label="Copy server link"
        title="Copy direct Roblox app link. Requires Roblox installed; some chats won't make this link clickable."
      >
        {status === "copied" ? (
          <Check size={14} aria-hidden="true" />
        ) : (
          <Link2 size={14} aria-hidden="true" />
        )}
        {status === "copied"
          ? "Copied"
          : status === "copying"
            ? "Copying…"
            : "Copy server link"}
      </button>
      <span className="copy-announcement" role="status">
        {status === "copied"
          ? "Server link copied"
          : status === "fallback"
            ? "Clipboard unavailable. Select and copy the link below."
            : ""}
      </span>
      {status === "fallback" && (
        <label className="copy-link-fallback">
          Select and copy this link
          <input
            aria-label="Server link to copy"
            readOnly
            value={url}
            onFocus={(event) => event.currentTarget.select()}
          />
        </label>
      )}
    </div>
  );
}
