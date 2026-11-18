import { Link } from "@tanstack/react-router";

export function LogoMark({ className = "h-14 w-14" }: { className?: string }) {
  return (
    <span className={`flex shrink-0 items-center justify-center ${className}`}>
      <img src="/iba-mark.png" alt="IBA" className="h-full w-full object-contain drop-shadow-sm" />
    </span>
  );
}

export function Logo({
  tagline = false,
  className = "",
}: {
  tagline?: boolean;
  className?: string;
}) {
  return (
    <Link
      to="/"
      aria-label="CampusFound home"
      className={`inline-flex items-center gap-3 ${className}`}
    >
      <LogoMark />
      <span className="flex flex-col">
        <span className="font-display text-[1.35rem] font-bold leading-none tracking-tight text-primary">
          Campus Found
        </span>
        {tagline && (
          <span className="mt-1.5 text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
            IBA Lost &amp; Found
          </span>
        )}
      </span>
    </Link>
  );
}
