import { useState } from "react";
import { LANGUAGES } from "../../../shared/src/index";
import { useI18n } from "../i18n";
import { LANGUAGE_FLAGS, LANGUAGE_LABELS } from "../i18n/translations";
import { isMuted, playSfx, setMuted } from "../sound";

export function LanguageSwitcher() {
  const { lang, setLang } = useI18n();
  const [open, setOpen] = useState(false);

  return (
    <div className="lang-switcher">
      <button
        className="lang-current"
        onClick={() => setOpen((o) => !o)}
        aria-label="Language"
      >
        {LANGUAGE_FLAGS[lang]} <span className="lang-caret">▾</span>
      </button>
      {open && (
        <div className="lang-menu" role="menu">
          {LANGUAGES.map((l) => (
            <button
              key={l}
              className={`lang-opt ${l === lang ? "active" : ""}`}
              onClick={() => {
                setLang(l);
                setOpen(false);
                playSfx("click");
              }}
            >
              {LANGUAGE_FLAGS[l]} {LANGUAGE_LABELS[l]}
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
