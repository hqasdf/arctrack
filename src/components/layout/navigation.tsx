"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/ui/icon";
import { SignOutButton } from "@/features/auth/components/sign-out-button";
import styles from "./shell.module.css";

const links = [
  { href: "/sessions", label: "Sessions", icon: "sessions" },
  { href: "/arrow-counter", label: "Arrow Counter", icon: "target" },
  { href: "/analytics", label: "Analytics", icon: "analytics" },
  { href: "/organization", label: "Coach's Workspace", icon: "organization" },
  { href: "/profile", label: "Profile", icon: "profile" },
] as const;

export function Navigation({ authenticated = false }: { authenticated?: boolean }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const navigationRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    function closeOnHistoryNavigation() { setOpen(false); }
    window.addEventListener("popstate", closeOnHistoryNavigation);
    return () => window.removeEventListener("popstate", closeOnHistoryNavigation);
  }, []);

  useEffect(() => {
    if (!open) return;
    function handleOutside(event: PointerEvent) {
      if (event.target instanceof Node && !navigationRef.current?.contains(event.target)) setOpen(false);
    }
    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        menuButtonRef.current?.focus();
      }
    }
    document.addEventListener("pointerdown", handleOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("pointerdown", handleOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  return (
    <nav ref={navigationRef} aria-label="Main navigation" className={styles.navigation}>
      <div className={styles.navLinks}>
        {links.map(({ href, label, icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link key={href} href={href} className={styles.navLink} aria-current={active ? "page" : undefined}>
              <Icon name={icon} size={17} />
              {label}
            </Link>
          );
        })}
      </div>
      <button
        ref={menuButtonRef}
        className={styles.mobileMenuButton}
        type="button"
        aria-label={open ? "Close navigation menu" : "Open navigation menu"}
        aria-expanded={open}
        aria-controls="arc-track-mobile-menu"
        onClick={() => setOpen((current) => !current)}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          {open ? <><path d="m6 6 12 12M18 6 6 18" /></> : <><path d="M4 7h16M4 12h16M4 17h16" /></>}
        </svg>
      </button>
      <div id="arc-track-mobile-menu" className={`${styles.mobileMenu} ${open ? styles.mobileMenuOpen : ""}`} aria-hidden={!open}>
        {links.map(({ href, label, icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return <Link key={href} href={href} className={styles.mobileMenuLink} aria-current={active ? "page" : undefined} onClick={() => setOpen(false)}>
            <Icon name={icon} size={18} />{label}
          </Link>;
        })}
        <div className={styles.mobileMenuSignOut}>
          {authenticated ? <SignOutButton /> : <Link href="/sign-in" className={styles.mobileMenuLink} onClick={() => setOpen(false)}>Sign in</Link>}
        </div>
      </div>
    </nav>
  );
}
