type BrandMarkProps = {
  size?: number;
  shadow?: string;
};

type BrandLogoProps = {
  align?: "left" | "center";
  gap?: number;
  markSize?: number;
  subtitle?: string;
  titleSize?: number;
};

export function BrandMark({
  size = 48,
  shadow = "0 20px 40px rgba(15, 23, 42, 0.18)",
}: BrandMarkProps) {
  const radius = Math.max(16, Math.round(size * 0.28));
  const innerRadius = Math.max(14, radius - 1);
  const dotSize = Math.max(8, Math.round(size * 0.18));

  return (
    <div
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        position: "relative",
        overflow: "hidden",
        flexShrink: 0,
        background: "linear-gradient(145deg, #0f172a 0%, #1d4ed8 42%, #14b8a6 100%)",
        boxShadow: shadow,
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 1,
          borderRadius: innerRadius,
          border: "1px solid rgba(255,255,255,0.18)",
          background: "linear-gradient(180deg, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0.03) 58%, rgba(255,255,255,0) 100%)",
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "radial-gradient(circle at 16% 18%, rgba(255,255,255,0.38) 0%, transparent 42%)",
        }}
      />
      <svg
        viewBox="0 0 72 72"
        width={size}
        height={size}
        style={{ position: "absolute", inset: 0 }}
      >
        <defs>
          <linearGradient id="w-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="rgba(255,255,255,0.95)" />
            <stop offset="100%" stopColor="rgba(255,255,255,0.3)" />
          </linearGradient>
          <linearGradient id="w-bg" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0%" stopColor="rgba(14, 165, 233, 0.8)" />
            <stop offset="100%" stopColor="rgba(16, 185, 129, 0.8)" />
          </linearGradient>
        </defs>
        
        {/* Background shadow shape for depth */}
        <path
          d="M17 25 L 26 50 L 36 32 L 46 50 L 55 25"
          fill="none"
          stroke="url(#w-bg)"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="10"
          style={{ transform: "translateY(2px)", filter: "blur(2px)" }}
        />
        
        {/* Main 'W' shape */}
        <path
          d="M17 23 L 26 48 L 36 30 L 46 48 L 55 23"
          fill="none"
          stroke="url(#w-grad)"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="8"
        />
      </svg>
      <div
        style={{
          position: "absolute",
          top: Math.round(size * 0.17),
          right: Math.round(size * 0.14),
          width: dotSize,
          height: dotSize,
          borderRadius: 999,
          background: "#fb923c",
          boxShadow: "0 0 0 6px rgba(251,146,60,0.16)",
        }}
      />
    </div>
  );
}

export default function BrandLogo({
  align = "left",
  gap = 14,
  markSize = 48,
  subtitle,
  titleSize = 20,
}: BrandLogoProps) {
  const isCentered = align === "center";
  const subtitleSize = Math.max(10, Math.round(titleSize * 0.42));

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: isCentered ? "center" : "flex-start",
        gap,
        textAlign: isCentered ? "center" : "left",
        overflow: "hidden",
        minWidth: 0,
        width: "100%",
      }}
    >
      <BrandMark size={markSize} />
      <div style={{ display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0, flex: 1 }}>
        <div
          style={{
            fontSize: titleSize,
            fontWeight: 800,
            color: "var(--text-main)",
            letterSpacing: "-0.05em",
            lineHeight: 1.1,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          Workdocker
        </div>
        {subtitle && (
          <div
            style={{
              fontSize: subtitleSize,
              fontWeight: 700,
              color: "var(--text-muted)",
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              lineHeight: 1.25,
              marginTop: 3,
              overflow: "hidden",
              display: "-webkit-box",
              WebkitBoxOrient: "vertical",
              WebkitLineClamp: 2,
              overflowWrap: "anywhere",
            }}
          >
            {subtitle}
          </div>
        )}
      </div>
    </div>
  );
}
