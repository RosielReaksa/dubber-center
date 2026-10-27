"use client";

import { useEffect, useRef, useState } from "react";
import { request, type FileTicket } from "@/lib/api/client";

export function UploadProgress({ file, onUploaded, onError }: { file: File; onUploaded: (ticket: FileTicket) => void; onError: (message: string) => void }) {
  const [progress, setProgress] = useState(0);
  const [state, setState] = useState<"uploading" | "done">("uploading");
  const xhr = useRef<XMLHttpRequest | null>(null);
  useEffect(() => {
    let alive = true;
    const send = async () => {
      try {
        const ticket = await request<FileTicket>("/v1/files", { method: "POST", body: { filename: file.name, content_type: file.type || "application/octet-stream", size: file.size } });
        if (!alive) return;
        const upload = new XMLHttpRequest();
        xhr.current = upload;
        upload.open(ticket.upload_method || "PUT", ticket.upload_url);
        if (ticket.content_type) upload.setRequestHeader("Content-Type", ticket.content_type);
        upload.upload.onprogress = (event) => { if (event.lengthComputable) setProgress(Math.round(event.loaded / event.total * 100)); };
        upload.onerror = () => onError("Upload failed. Check your connection and try again.");
        upload.onabort = () => onError("Upload canceled.");
        upload.onload = () => {
          if (upload.status >= 200 && upload.status < 300) { setProgress(100); setState("done"); onUploaded(ticket); }
          else onError(`Upload failed (${upload.status}). Try again.`);
        };
        upload.send(file);
      } catch (error) { if (alive) onError(error instanceof Error ? error.message : "Could not start the upload."); }
    };
    void send();
    return () => { alive = false; xhr.current?.abort(); };
  }, [file, onError, onUploaded]);
  return <div className="mt-3 space-y-2" aria-live="polite"><div className="flex justify-between text-xs"><span>{state === "done" ? "Upload complete" : "Uploading video…"}</span><span>{progress}%</span></div><div className="h-2 overflow-hidden rounded-full" style={{ background: "var(--surface-2)" }}><div className="h-full transition-[width]" style={{ width: `${progress}%`, background: "var(--accent)" }} /></div><button type="button" className="btn btn-ghost btn-sm" onClick={() => xhr.current?.abort()} disabled={state === "done"}>Cancel upload</button></div>;
}
