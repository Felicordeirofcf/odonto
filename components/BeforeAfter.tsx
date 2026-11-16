"use client";

import { useState } from "react";
import { ChevronsLeftRight } from "lucide-react";

/** Comparação antes/depois: arraste a linha para revelar. */
export default function BeforeAfter({ before, after, label }: { before: string; after: string; label: string }) {
  const [pos, setPos] = useState(50);
  return (
    <div className="relative mt-3 aspect-square w-full select-none overflow-hidden rounded-xl border bg-gray-100">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={after} alt={label} draggable={false} className="absolute inset-0 h-full w-full object-cover" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={before}
        alt="Antes"
        draggable={false}
        className="absolute inset-0 h-full w-full object-cover"
        style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}
      />
      <span className="absolute left-2 top-2 rounded-md bg-black/55 px-2 py-0.5 text-xs font-semibold text-white">
        Antes
      </span>
      <span className="absolute right-2 top-2 rounded-md bg-brand-600/90 px-2 py-0.5 text-xs font-semibold text-white">
        {label}
      </span>
      <div className="pointer-events-none absolute inset-y-0 w-0.5 bg-white shadow" style={{ left: `${pos}%` }}>
        <div className="absolute top-1/2 flex size-10 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white text-gray-700 shadow-lg">
          <ChevronsLeftRight className="size-5" />
        </div>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        step={0.5}
        value={pos}
        onChange={(e) => setPos(Number(e.target.value))}
        aria-label="Comparar antes e depois"
        className="absolute inset-0 h-full w-full cursor-ew-resize touch-pan-y opacity-0"
      />
    </div>
  );
}
