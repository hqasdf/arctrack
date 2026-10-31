"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent, type UIEvent, type WheelEvent } from "react";
import { addArrows, COUNTER_STORAGE_KEY, DEFAULT_COUNTER, lastAdditionDisplay, readCounter, resetCounter, setIncrement, undoLastAddition, type ArrowCounterState } from "../counter-model";
import styles from "./arrow-counter.module.css";
import { useDraftGuard } from "@/features/notes-feedback/draft-guard";

export function ArrowCounter({onStorageChange}:{onStorageChange?:(safe:boolean)=>void}={}) {
  const [counter, setCounter] = useState<ArrowCounterState>(DEFAULT_COUNTER);
  const [ready, setReady] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const currentCounter = useRef(DEFAULT_COUNTER);
  const writable = useRef(false);
  const [previewIncrement, setPreviewIncrement] = useState(DEFAULT_COUNTER.increment);
  const [incrementInput, setIncrementInput] = useState(String(DEFAULT_COUNTER.increment));
  const [confirmReset, setConfirmReset] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [unpreserved,setUnpreserved]=useState(false);
  const selectorRef = useRef<HTMLDivElement>(null);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewRef = useRef(DEFAULT_COUNTER.increment);
  useDraftGuard(unpreserved||previewIncrement!==counter.increment,"Counter changes are not yet safely saved on this device. Leave and risk losing the latest changes?");
  const wheelRemainder = useRef(0);
  const wheelStart = Math.max(1, counter.increment - 20);
  const wheelValues = Array.from({ length: 41 }, (_, index) => wheelStart + index);

  useLayoutEffect(() => {
    const selector = selectorRef.current;
    if (!selector) return;
    const selected = selector.querySelector<HTMLElement>(`[data-increment="${counter.increment}"]`);
    if (selected) selector.scrollTop += selected.getBoundingClientRect().top + selected.offsetHeight / 2 - (selector.getBoundingClientRect().top + selector.clientHeight / 2);
  }, [counter.increment, ready]);

  useEffect(() => () => { if (settleTimer.current) clearTimeout(settleTimer.current); }, []);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      writable.current = false;
      let stored = DEFAULT_COUNTER;
      try {
        const raw = window.localStorage.getItem(COUNTER_STORAGE_KEY);
        if (raw !== null) {
          const parsed: unknown = JSON.parse(raw);
          stored = readCounter(parsed);
        }
      } catch {
        onStorageChange?.(false);
        setMessage("This browser could not load the saved counter.");
        setLoadFailed(true);
        setReady(false);
        return;
      }
      currentCounter.current = stored;
      writable.current = true;
      setCounter(stored);
      setPreviewIncrement(stored.increment);
      previewRef.current = stored.increment;
      setIncrementInput(String(stored.increment));
      setReady(true);
      setLoadFailed(false);
      setMessage(null);
      onStorageChange?.(true);
    });
    return () => { active = false; };
  }, [loadAttempt,onStorageChange]);

  function apply(change: (current: ArrowCounterState) => ArrowCounterState) {
    if (!writable.current) return;
    const next = change(currentCounter.current);
    currentCounter.current = next;
    setCounter(next);
    setPreviewIncrement(next.increment);
    previewRef.current = next.increment;
    setMessage(null);
    try {
      window.localStorage.setItem(COUNTER_STORAGE_KEY, JSON.stringify(next));
      setUnpreserved(false);onStorageChange?.(true);
    } catch {
      setUnpreserved(true);onStorageChange?.(false);
      setMessage("This browser could not save the counter. Keep this page open to retain the current tally.");
    }
  }

  function chooseIncrement(increment: number) {
    if (!writable.current || !Number.isSafeInteger(increment) || increment < 1) return;
    if (settleTimer.current) clearTimeout(settleTimer.current);
    const next = setIncrement(currentCounter.current, increment);
    setIncrementInput(String(next.increment));
    apply(current => setIncrement(current, increment));
  }

  function editIncrement(value: string) {
    setIncrementInput(value);
    if (/^\d+$/.test(value)) chooseIncrement(Number(value));
  }

  function submitIncrement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!/^\d+$/.test(incrementInput) || !Number.isSafeInteger(Number(incrementInput)) || Number(incrementInput) < 1) {
      setMessage("Enter a positive whole-number increment.");
      setIncrementInput(String(counter.increment));
      return;
    }
    chooseIncrement(Number(incrementInput));
  }

  function adjustIncrement(amount: number) {
    chooseIncrement(Math.max(1, currentCounter.current.increment + amount));
  }

  function handleSelectorScroll(event: UIEvent<HTMLDivElement>) {
    if (!writable.current) return;
    const selector = event.currentTarget;
    const firstRow = selector.querySelector<HTMLElement>("[data-increment]");
    if (!firstRow) return;
    const center = selector.getBoundingClientRect().top + selector.clientHeight / 2;
    const firstCenter = firstRow.getBoundingClientRect().top + firstRow.offsetHeight / 2;
    const value = Number(firstRow.dataset.increment) + Math.round((center - firstCenter) / firstRow.offsetHeight);
    if (Number.isSafeInteger(value) && value > 0) {
      if (previewRef.current !== value) {
        previewRef.current = value;
        setPreviewIncrement(value);
        onStorageChange?.(value===currentCounter.current.increment&&!unpreserved);
        if (window.matchMedia("(pointer: coarse)").matches && typeof navigator.vibrate === "function") {
          try { navigator.vibrate(8); } catch { /* Haptics are optional and browser-controlled. */ }
        }
      }
      if (document.activeElement !== document.getElementById("arrow-increment")) setIncrementInput(String(value));
    }
    if (settleTimer.current) clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(() => {
      if (Number.isSafeInteger(value) && value > 0 && value !== currentCounter.current.increment) chooseIncrement(value);
    }, 70);
  }

  function handleSelectorWheel(event: WheelEvent<HTMLDivElement>) {
    event.preventDefault();
    const selector = event.currentTarget;
    if (event.deltaMode !== 0) {
      wheelRemainder.current = 0;
      selector.scrollTop += Math.sign(event.deltaY) * 42;
      return;
    }
    wheelRemainder.current += event.deltaY;
    if (Math.abs(wheelRemainder.current) >= 42) {
      selector.scrollTop += Math.sign(wheelRemainder.current) * 42;
      wheelRemainder.current = 0;
    }
  }

  function handleSelectorKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      adjustIncrement(event.key === "ArrowUp" ? 1 : -1);
    }
  }

  return <section className={styles.counter} data-arrow-counter-root aria-label="Arrow Counter">
    {unpreserved&&<button type="button" onClick={()=>apply(current=>({...current}))}>Retry device save</button>}
    <h1 className={styles.srOnly}>Arrow Counter</h1>
    <div className={styles.toolbar}>
      <Link href="/sessions" className={styles.back} aria-label="Back to Sessions"><Icon name="back"/></Link>
      <div className={styles.tools}>
        <button type="button" aria-label="Undo last addition" title="Undo last addition" disabled={!ready || counter.history.length === 0} onClick={() => apply(undoLastAddition)}><Icon name="undo"/></button>
        <button type="button" aria-label="Reset counter" title="Reset counter" disabled={!ready || (counter.totalArrows === 0 && counter.history.length === 0)} onClick={() => setConfirmReset(true)}><Icon name="reset"/></button>
      </div>
    </div>

    <div className={styles.centerRow}>
      <div className={styles.display} aria-live="polite" aria-atomic="true">
        <span className={styles.totalLabel}>TOTAL</span>
        <strong className={styles.total}>{counter.totalArrows}</strong>
      </div>
      <div className={styles.selectorShell}>
      <div ref={selectorRef} className={styles.selector} onScroll={handleSelectorScroll} onWheel={handleSelectorWheel} onKeyDown={handleSelectorKeyDown} role="spinbutton" aria-label="Arrow increment selector" aria-valuemin={1} aria-valuenow={previewIncrement} tabIndex={0}>
        <div className={styles.wheelSpacer} aria-hidden="true" />
        {wheelValues.map((value) => <div key={value} data-increment={value} className={styles.nearby} aria-hidden="true">+{value}</div>)}
        <div className={styles.wheelSpacer} aria-hidden="true" />
      </div>
      <form className={styles.selectedIncrement} onSubmit={submitIncrement}>
        <label className={styles.srOnly} htmlFor="arrow-increment">Selected addition amount</label>
        <span aria-hidden="true">+</span><input id="arrow-increment" type="text" inputMode="numeric" pattern="[0-9]*" value={incrementInput} disabled={!ready} onChange={(event) => editIncrement(event.target.value)} onBlur={() => setIncrementInput(String(counter.increment))}/>
      </form>
      </div>
    </div>

    <div className={styles.lastAdded} aria-live="polite"><span>Last added</span><strong>{lastAdditionDisplay(counter).time}</strong><small>{lastAdditionDisplay(counter).detail}</small></div>
    <button className={styles.clicker} type="button" aria-label={`Add ${previewIncrement} arrows`} disabled={!ready || counter.totalArrows > Number.MAX_SAFE_INTEGER - previewIncrement} onClick={() => apply(current => addArrows(setIncrement(current, previewRef.current)))}>
      <Icon name="up"/><span>+{previewIncrement}</span>
    </button>
    {message && <p className={styles.message} role="alert">{message}</p>}
    {loadFailed && <button type="button" onClick={() => setLoadAttempt(value => value + 1)}>Retry loading saved counter</button>}

    {confirmReset && <div className={styles.modalBackdrop}>
      <div className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="counter-confirm-title" onKeyDown={(event) => { if (event.key === "Escape") setConfirmReset(false); }}>
        <h2 id="counter-confirm-title">Reset the count?</h2>
        <p>The total and Undo history will be cleared.</p>
        <div className={styles.confirmActions}>
          <button type="button" onClick={() => setConfirmReset(false)}>Cancel</button>
          <button type="button" className={styles.apply} onClick={() => { if (settleTimer.current) clearTimeout(settleTimer.current); apply(resetCounter); setConfirmReset(false); }}>Reset</button>
        </div>
      </div>
    </div>}
  </section>;
}

function Icon({name}: {name: "back" | "undo" | "reset" | "up"}) {
  const paths = {
    back: <><path d="m14 5-7 7 7 7"/><path d="M7 12h13"/></>,
    undo: <><path d="M9 7 4 12l5 5"/><path d="M4 12h10a6 6 0 0 1 0 12"/></>,
    reset: <><path d="M4 11a8 8 0 1 1 2 6"/><path d="M4 4v7h7"/></>,
    up: <><path d="m5 14 7-7 7 7"/><path d="M12 7v12"/></>,
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
