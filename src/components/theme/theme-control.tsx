"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent } from "react";
import { Icon } from "@/components/ui/icon";
import { readThemePreference, serverThemePreference, setThemePreference, subscribeThemePreference, type ThemePreference } from "./theme-preference";
import styles from "./theme-control.module.css";

function useThemePreference() {
  return useSyncExternalStore(subscribeThemePreference, readThemePreference, serverThemePreference);
}

/** Mounted only by the existing authenticated shell; never wraps application state. */
export function ThemeControl() {
  useLayoutEffect(() => {
    const root = document.documentElement;
    const apply = () => { root.dataset.theme = readThemePreference(); };
    apply();
    const unsubscribe = subscribeThemePreference(apply);
    return () => {
      unsubscribe();
      delete root.dataset.theme;
    };
  }, []);
  return <noscript><style>{"[data-authenticated-theme] { visibility: visible; }"}</style></noscript>;
}

const themeOptions = [
  { value: "light", label: "Light", description: "Bright and clean" },
  { value: "dark", label: "Dark", description: "Comfortable in low light" },
  { value: "system", label: "System", description: "Match your device" },
] as const;

function ThemeIcon({ theme }: { theme: ThemePreference }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    {theme === "light" ? <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.4 1.4m11.2 11.2L19 19M5 19l1.4-1.4M17.6 6.4 19 5" /></>
      : theme === "dark" ? <path d="M20.8 13a9 9 0 0 1-9.8-9.8A9 9 0 1 0 20.8 13Z" />
      : <><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M8 21h8m-4-4v4" /></>}
  </svg>;
}

export function ThemeSelector({ expanded = false }: { expanded?: boolean }) {
  const preference = useThemePreference();
  const [open, setOpen] = useState(false);
  const controlRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const selected = themeOptions.find(option => option.value === preference)!;

  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
    function dismissOutside(event: PointerEvent) {
      if (event.target instanceof Node && !controlRef.current?.contains(event.target)) setOpen(false);
    }
    document.addEventListener("pointerdown", dismissOutside);
    return () => document.removeEventListener("pointerdown", dismissOutside);
  }, [open]);

  function closeMenu() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  function handleMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeMenu();
      return;
    }
    if (event.key === "Tab") {
      closeMenu();
      return; // Native Tab/Shift+Tab continues from the trigger, outside this menu.
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? []);
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
      : (current + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
  }

  return <div ref={controlRef} className={`${styles.control} ${expanded ? styles.expanded : ""}`}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
    <button ref={triggerRef} type="button" className={styles.trigger} aria-label="Color theme"
      aria-describedby={`${id}-current`} aria-haspopup="menu" aria-expanded={open} aria-controls={`${id}-menu`}
      onClick={() => setOpen(current => !current)}
      onKeyDown={event => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setOpen(true); }
        else if (event.key === "Escape" && open) { event.preventDefault(); event.stopPropagation(); closeMenu(); }
      }}>
      <ThemeIcon theme={preference} />
      {expanded && <><span className={styles.triggerLabel}>Appearance</span><span className={styles.current}>{selected.label}</span></>}
      <svg className={styles.chevron} viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="m5 6 3 3 3-3" /></svg>
    </button>
    <span id={`${id}-current`} className={styles.srOnly}>Current appearance: {selected.label}</span>
    {open && <div ref={menuRef} id={`${id}-menu`} role="menu" aria-labelledby={`${id}-heading`}
      className={styles.menu} onKeyDown={handleMenuKeyDown}>
      <p id={`${id}-heading`} className={styles.heading}>Appearance</p>
      {themeOptions.map(option => <button key={option.value} type="button" role="menuitemradio"
        aria-checked={preference === option.value} tabIndex={-1} className={styles.option}
        onClick={() => { setThemePreference(option.value); closeMenu(); }}>
        <span className={styles.optionIcon}><ThemeIcon theme={option.value} /></span>
        <span className={styles.optionText}><span className={styles.optionLabel}>{option.label}</span><span className={styles.description}>{option.description}</span></span>
        <span className={styles.check}>{preference === option.value && <Icon name="check" size={16} />}</span>
      </button>)}
    </div>}
  </div>;
}
