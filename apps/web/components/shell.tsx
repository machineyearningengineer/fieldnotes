"use client";
import { ThemeMenu } from "./theme-menu";
import Link from "next/link";
import { BookOpen, GitCompareArrows, Sprout } from "lucide-react";
export function Shell({
  children,
  kind = "discover",
  inert = false,
}: {
  children: React.ReactNode;
  kind?: "discover" | "compare";
  inert?: boolean;
}) {
  return (
    <div className="app-shell" inert={inert}>
      <a href="#main-content" className="skip-link">
        Skip to research
      </a>
      <header className="site-header">
        <Link className="wordmark" href="/discover" aria-label="Fieldnotes home">
          <Sprout size={23} strokeWidth={1.6} />
          <span>
            fieldnotes<span className="wordmark-dot">.</span>
          </span>
        </Link>
        <div className="header-tools">
          {process.env.NEXT_PUBLIC_APP_MODE !== "production" && (
            <span className="simulation-mark">Local simulation</span>
          )}
          <ThemeMenu />
        </div>
      </header>
      <nav className="journey-nav" aria-label="Research journey">
        <Link href="/discover" aria-current={kind === "discover" ? "page" : undefined}>
          <BookOpen size={16} />
          Discover
          <svg className="nav-stroke" viewBox="0 0 100 8" aria-hidden="true">
            <path
              d="M1 5 C20 3 41 5 58 3 S82 2 99 3"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              pathLength="100"
            />
          </svg>
        </Link>
        <Link href="/compare" aria-current={kind === "compare" ? "page" : undefined}>
          <GitCompareArrows size={16} />
          Compare
          <svg className="nav-stroke" viewBox="0 0 100 8" aria-hidden="true">
            <path
              d="M1 4 C19 5 39 2 59 3 S82 4 99 2"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              pathLength="100"
            />
          </svg>
        </Link>
      </nav>
      <main id="main-content" tabIndex={-1}>
        {children}
      </main>
    </div>
  );
}
