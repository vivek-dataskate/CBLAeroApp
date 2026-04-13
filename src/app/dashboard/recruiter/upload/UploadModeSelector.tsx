"use client";

import { useState } from "react";

import CsvUploadWizard from "./CsvUploadWizard";
import ResumeUploadWizard from "./ResumeUploadWizard";

type UploadMode = "csv" | "resume";

export default function UploadModeSelector() {
  const [mode, setMode] = useState<UploadMode>("csv");

  return (
    <div className="space-y-4">
      <div className="flex gap-1 rounded-xl border border-gray-200 bg-gray-50 p-1">
        <button
          type="button"
          onClick={() => setMode("csv")}
          className={`flex-1 rounded-lg px-4 py-2 text-sm font-medium transition ${
            mode === "csv"
              ? "bg-white text-gray-900 shadow-sm border border-gray-200"
              : "text-gray-500 hover:text-gray-700"
          }`}
        >
          Upload CSV
        </button>
        <button
          type="button"
          onClick={() => setMode("resume")}
          className={`flex-1 rounded-lg px-4 py-2 text-sm font-medium transition ${
            mode === "resume"
              ? "bg-white text-gray-900 shadow-sm border border-gray-200"
              : "text-gray-500 hover:text-gray-700"
          }`}
        >
          Upload Resumes
        </button>
      </div>

      {mode === "csv" ? <CsvUploadWizard /> : <ResumeUploadWizard />}
    </div>
  );
}
