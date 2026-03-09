"use client";
// components/ui/tooltip.tsx
//
// A small info icon (?) that shows a tooltip on hover.
// Usage: <Tooltip text="..." />
//        <Tooltip text="..." align="right" />  ← use in right sidebars to avoid overflow

interface TooltipProps {
  text: string;
  // "center" (default) centers the bubble over the icon.
  // "right" anchors it to the right edge — use when the icon is near the right side of the screen.
  align?: "center" | "right";
}

export default function Tooltip({ text, align = "center" }: TooltipProps) {
  const bubbleClass =
    align === "right"
      ? // Anchor to right edge of the icon, grow leftward
        "pointer-events-none absolute bottom-full right-0 z-10 mb-1.5 w-52 rounded-lg bg-gray-800 px-3 py-2 text-xs text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100"
      : // Center over the icon
        "pointer-events-none absolute bottom-full left-1/2 z-10 mb-1.5 w-52 -translate-x-1/2 rounded-lg bg-gray-800 px-3 py-2 text-xs text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100";

  const arrowClass =
    align === "right"
      ? "absolute right-2 top-full border-4 border-transparent border-t-gray-800"
      : "absolute left-1/2 top-full -translate-x-1/2 border-4 border-transparent border-t-gray-800";

  return (
    <span className="group relative inline-flex items-center">
      {/* Trigger icon */}
      <span className="ml-1.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-gray-200 text-gray-500 text-[10px] font-bold leading-none cursor-default select-none">
        ?
      </span>

      {/* Tooltip bubble */}
      <span className={bubbleClass}>
        {text}
        <span className={arrowClass} />
      </span>
    </span>
  );
}
