import { Link } from "@tanstack/react-router";

export function LogoMark({ className = "h-10 w-10" }: { className?: string }) {
  return (
    <span className={`flex shrink-0 items-center justify-center rounded-xl border-2 border-primary bg-primary text-primary-foreground shadow-brutal ${className}`}>
      <svg viewBox="0 0 24 24" className="h-[68%] w-[68%]" fill="none" aria-hidden="true">
        <path
          d="M12 1.8c-4.02 0-7.3 3.2-7.3 7.18 0 5.27 7.3 12.62 7.3 12.62s7.3-7.35 7.3-12.62C19.3 5 16.02 1.8 12 1.8Z"
          fill="var(--primary-foreground)"
        />
        <circle cx="12" cy="9.2" r="4.3" fill="var(--primary)" />
        <path d="m10 9.3 1.45 1.45 2.65-2.9" stroke="var(--primary-foreground)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

export function Logo({ tagline = false, className = "" }: { tagline?: boolean; className?: string }) {
  return (
    <Link to="/" aria-label="CampusFound home" className={`inline-flex items-center gap-3 ${className}`}>
      <LogoMark />
      <span className="flex flex-col">
        <span className="font-display text-[1.35rem] font-bold leading-none tracking-tight text-primary">
          Campus<span className="text-primary">Found</span>
        </span>
        {tagline && (
          <span className="mt-1.5 text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
            Lost &amp; Found
          </span>
        )}
      </span>
    </Link>
  );
}
