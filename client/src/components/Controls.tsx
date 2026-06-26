import { useEffect, useRef, useState } from "react";
import { LANGUAGES } from "../../../shared/src/index";
import { useI18n } from "../i18n";
import { LANGUAGE_LABELS } from "../i18n/translations";
import { Flag } from "./Flag";
import { isMuted, playSfx, setMuted } from "../sound";

export function LanguageSwitcher() {
  const { lang, setLang } = useI18n();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Close on outside click and on Escape; Escape returns focus to the trigger.
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="lang-switcher" ref={wrapRef}>
      <button
        ref={triggerRef}
        className="lang-current"
        onClick={() => setOpen((o) => !o)}
        aria-label="Language"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Flag code={lang} /> <span className="lang-caret">▾</span>
      </button>
      {open && (
        <div className="lang-menu" role="menu">
          {LANGUAGES.map((l) => (
            <button
              key={l}
              role="menuitemradio"
              aria-checked={l === lang}
              className={`lang-opt ${l === lang ? "active" : ""}`}
              onClick={() => {
                setLang(l);
                setOpen(false);
                triggerRef.current?.focus();
                playSfx("click");
              }}
            >
              <Flag code={l} /> {LANGUAGE_LABELS[l]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function SoundToggle() {
  const [on, setOn] = useState(!isMuted());
  return (
    <button
      className="sound-toggle"
      aria-label="Sound"
      aria-pressed={on}
      onClick={() => {
        const next = !on;
        setOn(next);
        setMuted(!next);
        if (next) playSfx("click");
      }}
    >
      {on ? "🔊" : "🔇"}
    </button>
  );
}

export function TopBar() {
  return (
    <div className="top-bar">
      <SoundToggle />
      <LanguageSwitcher />
    </div>
  );
}
