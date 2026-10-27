"use client";

import { useRef, useState } from "react";
import { FileVideo, UploadCloud, X } from "lucide-react";

const ACCEPT = ".mp4,.mov,.mkv,.webm,video/mp4,video/quicktime,video/x-matroska,video/webm";

export function Dropzone({ file, onChange, disabled = false }: { file: File | null; onChange: (file: File | null) => void; disabled?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const choose = (candidate?: File) => {
    if (!candidate) return;
    if (!/\.(mp4|mov|mkv|webm)$/i.test(candidate.name)) return;
    onChange(candidate);
  };
  return (
    <div>
      <input ref={input} type="file" accept={ACCEPT} className="sr-only" aria-label="Choose a video" disabled={disabled} onChange={(e) => choose(e.target.files?.[0])} />
      {file ? (
        <div className="flex items-center gap-3 rounded-md border p-4" style={{ background: "var(--surface)" }}>
          <FileVideo aria-hidden size={20} style={{ color: "var(--accent)" }} />
          <div className="min-w-0 flex-1"><p className="truncate font-medium">{file.name}</p><p className="text-xs" style={{ color: "var(--text-muted)" }}>{(file.size / 1024 / 1024).toFixed(1)} MB</p></div>
          <button type="button" className="btn btn-ghost btn-sm" aria-label="Remove selected video" disabled={disabled} onClick={() => { onChange(null); if (input.current) input.current.value = ""; }}><X size={16} /></button>
        </div>
      ) : (
        <button type="button" disabled={disabled} onClick={() => input.current?.click()} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={(e) => { e.preventDefault(); setOver(false); choose(e.dataTransfer.files[0]); }} className="flex min-h-36 w-full flex-col items-center justify-center gap-2 rounded-md border border-dashed p-6 text-center transition-colors" style={{ background: over ? "var(--accent-soft)" : "var(--surface)", color: "var(--text-muted)" }}>
          <UploadCloud size={24} aria-hidden style={{ color: "var(--accent)" }} /><span className="font-medium" style={{ color: "var(--text)" }}>Drop a video here or browse</span><span className="text-xs">MP4, MOV, MKV or WebM</span>
        </button>
      )}
    </div>
  );
}
