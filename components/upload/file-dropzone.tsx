"use client";
// components/upload/file-dropzone.tsx
//
// Drag-and-drop (or click-to-browse) file uploader.
//
// On drop/select:
//   1. Validates file type and size client-side (fast feedback before network round-trip)
//   2. POSTs to /api/sessions/:sessionId/upload as multipart/form-data
//   3. Calls onUploadSuccess with the server's response (schema + preview)
//
// Supports: CSV, TSV, XLSX

import { useState, useRef, DragEvent, ChangeEvent } from "react";

const ACCEPTED_EXTENSIONS = [".csv", ".tsv", ".xlsx", ".xls"];
const MAX_MB = 100;

interface UploadResult {
  filename: string;
  rowCount: number;
  columnCount: number;
  schema: unknown;
  preview: Record<string, unknown>[];
}

interface FileDropzoneProps {
  sessionId: string;
  onUploadSuccess: (result: UploadResult) => void;
}

export default function FileDropzone({ sessionId, onUploadSuccess }: FileDropzoneProps) {
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Validate before hitting the server
  function validateFile(file: File): string | null {
    const ext = "." + file.name.split(".").pop()?.toLowerCase();
    if (!ACCEPTED_EXTENSIONS.includes(ext)) {
      return `Unsupported format. Please upload: ${ACCEPTED_EXTENSIONS.join(", ")}`;
    }
    if (file.size > MAX_MB * 1024 * 1024) {
      return `File too large (max ${MAX_MB} MB)`;
    }
    return null;
  }

  async function uploadFile(file: File) {
    const validationError = validateFile(file);
    if (validationError) {
      setError(validationError);
      return;
    }

    setError(null);
    setUploading(true);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch(`/api/sessions/${sessionId}/upload`, {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Upload failed");
        return;
      }

      onUploadSuccess(data as UploadResult);
    } catch {
      setError("Network error — could not reach the server");
    } finally {
      setUploading(false);
    }
  }

  // Drag-and-drop event handlers
  function onDragOver(e: DragEvent) {
    e.preventDefault();
    setDragging(true);
  }

  function onDragLeave() {
    setDragging(false);
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) uploadFile(file);
  }

  // Click-to-browse handler
  function onFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) uploadFile(file);
    // Reset input so the same file can be re-uploaded after an error
    e.target.value = "";
  }

  return (
    <div>
      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        className={[
          "flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-10 cursor-pointer transition",
          dragging ? "border-blue-500 bg-blue-50" : "border-gray-300 hover:border-gray-400 bg-white",
          uploading ? "opacity-60 pointer-events-none" : "",
        ].join(" ")}
      >
        {/* Upload icon */}
        <svg className="mb-3 h-8 w-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
        </svg>

        {uploading ? (
          <p className="text-sm text-gray-500">Uploading…</p>
        ) : (
          <>
            <p className="text-sm font-medium text-gray-700">
              Drop a file here, or click to browse
            </p>
            <p className="mt-1 text-xs text-gray-400">
              CSV, TSV, XLSX — up to {MAX_MB} MB
            </p>
          </>
        )}
      </div>

      {/* Hidden file input — triggered by the dropzone click */}
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        accept={ACCEPTED_EXTENSIONS.join(",")}
        onChange={onFileChange}
      />

      {/* Error message */}
      {error && (
        <p className="mt-2 text-sm text-red-600">{error}</p>
      )}
    </div>
  );
}
