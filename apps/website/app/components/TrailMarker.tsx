type TrailMarkerVariant = "green" | "blue" | "black" | "double-black";

interface TrailMarkerProps {
  variant: TrailMarkerVariant;
  label: string;
  className?: string;
  size?: number;
}

export function TrailMarker({
  variant,
  label,
  className,
  size = 18,
}: TrailMarkerProps) {
  return (
    <svg
      aria-label={label}
      className={className}
      height={size}
      role="img"
      viewBox="0 0 18 18"
      width={size}
    >
      <title>{label}</title>
      {variant === "green" && <circle cx="9" cy="9" r="7.5" fill="#15803d" />}
      {variant === "blue" && (
        <rect x="2" y="2" width="14" height="14" fill="#1d4ed8" />
      )}
      {variant === "black" && (
        <polygon points="9,1 17,9 9,17 1,9" fill="#0c0a09" />
      )}
      {variant === "double-black" && (
        <>
          <polygon points="5,1 11,9 5,17 -1,9" fill="#0c0a09" />
          <polygon points="13,1 19,9 13,17 7,9" fill="#0c0a09" />
        </>
      )}
    </svg>
  );
}

export type { TrailMarkerVariant };
