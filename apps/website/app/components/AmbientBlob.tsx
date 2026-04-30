interface AmbientBlobProps {
  className?: string;
  color?: string;
}

export function AmbientBlob({
  className,
  color = "rgba(56, 189, 248, 0.12)",
}: AmbientBlobProps) {
  return (
    <div
      aria-hidden
      className={`pointer-events-none rounded-full ${className ?? ""}`}
      style={{
        background: `radial-gradient(circle at center, ${color}, transparent 70%)`,
        filter: "blur(40px)",
      }}
    />
  );
}
