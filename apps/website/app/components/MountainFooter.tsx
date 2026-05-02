export function MountainFooter() {
  return (
    <footer className="relative overflow-hidden border-t border-rule-soft bg-bg-card">
      <div className="relative mx-auto w-full max-w-[1240px]">
        <svg
          aria-label="Cascade range silhouette"
          className="block h-[180px] w-full"
          preserveAspectRatio="none"
          role="img"
          viewBox="0 0 1240 180"
        >
          <title>Cascade range silhouette with chairlift</title>
          <defs>
            <linearGradient id="mf-sky" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#fff8f1" />
              <stop offset="100%" stopColor="#fde0c0" />
            </linearGradient>
          </defs>
          <rect x="0" y="0" width="1240" height="180" fill="url(#mf-sky)" />
          {/* Back range */}
          <polygon
            fill="#fde0c0"
            opacity="0.8"
            points="0,180 0,110 140,55 260,90 380,30 520,80 680,20 830,75 1000,40 1160,80 1240,55 1240,180"
            stroke="#b45309"
            strokeOpacity="0.18"
            strokeWidth="0.6"
          />
          {/* Front range */}
          <polygon
            fill="#f5e6d3"
            opacity="0.95"
            points="0,180 0,140 110,90 230,120 360,75 490,115 640,65 800,110 960,80 1120,115 1240,90 1240,180"
          />
          {/* Chairlift cable */}
          <line
            stroke="#1c1917"
            strokeOpacity="0.32"
            strokeWidth="1"
            x1="100"
            x2="1140"
            y1="65"
            y2="48"
          />
          {/* Towers */}
          <line stroke="#1c1917" strokeOpacity="0.42" strokeWidth="1" x1="320" x2="320" y1="55" y2="120" />
          <line stroke="#1c1917" strokeOpacity="0.42" strokeWidth="1" x1="640" x2="640" y1="48" y2="100" />
          <line stroke="#1c1917" strokeOpacity="0.42" strokeWidth="1" x1="960" x2="960" y1="50" y2="92" />
          {/* Two amber chairs */}
          <rect fill="#ea580c" height="6" rx="1" width="8" x="416" y="60" />
          <line stroke="#1c1917" strokeOpacity="0.4" strokeWidth="0.6" x1="420" x2="420" y1="60" y2="55" />
          <rect fill="#ea580c" height="6" rx="1" width="8" x="780" y="55" />
          <line stroke="#1c1917" strokeOpacity="0.4" strokeWidth="0.6" x1="784" x2="784" y1="55" y2="50" />
        </svg>
        <p className="pb-8 pt-3 text-center font-mono text-[11px] uppercase tracking-[0.14em] text-text-muted">
          Built in Bend, OR.
        </p>
      </div>
    </footer>
  );
}
