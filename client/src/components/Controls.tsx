import { useState } from "react";
import { LANGUAGES } from "../../../shared/src/index";
import { useI18n } from "../i18n";
import { LANGUAGE_LABELS } from "../i18n/translations";
import { Flag } from "./Flag";
import { IconChevron, IconSound } from "./icons";
import { isMuted, playSfx, setMuted } from "../sound";

export function LanguageSwitcher() {
  const { lang, setLang, t } = useI18n();

  return (
    <div className="lang-switcher">
      <label className="lang-current" title={t("language")}>
        <span className="sr-only">{t("language")}</span>
        <select
          className="lang-native"
          value={lang}
          aria-label={t("language")}
          onChange={(event) => {
            setLang(event.target.value as (typeof LANGUAGES)[number]);
            playSfx("click");
          }}
        >
          {LANGUAGES.map((language) => (
            <option key={language} value={language}>
              {LANGUAGE_LABELS[language]}
            </option>
          ))}
        </select>
        <Flag code={lang} />
        <IconChevron className="lang-caret" />
      </label>
    </div>
  );
}

export function SoundToggle() {
  const { t } = useI18n();
  const [on, setOn] = useState(!isMuted());
  return (
    <button
      className="sound-toggle"
      aria-label={t(on ? "soundOn" : "soundOff")}
      title={t(on ? "soundOn" : "soundOff")}
      aria-pressed={on}
      onClick={() => {
        const next = !on;
        setOn(next);
        setMuted(!next);
        if (next) playSfx("click");
      }}
    >
      <IconSound on={on} />
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
