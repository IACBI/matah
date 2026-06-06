import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Language } from "../../../shared/src/index";
import { LANGUAGES } from "../../../shared/src/index";
import { translate, type TKey } from "./translations";

const STORAGE_KEY = "quibble.lang";

function detectLanguage(): Language {
  const saved = localStorage.getItem(STORAGE_KEY) as Language | null;
  if (saved && LANGUAGES.includes(saved)) return saved;
  const nav = navigator.language.slice(0, 2) as Language;
  return LANGUAGES.includes(nav) ? nav : "tr";
}

interface I18nContextValue {
  lang: Language;
  setLang: (lang: Language) => void;
  t: (key: TKey, params?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Language>(detectLanguage);

  // Keep <html lang> in sync (initial detect + switches) for a11y and SEO.
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = useCallback((next: Language) => {
    localStorage.setItem(STORAGE_KEY, next);
    setLangState(next);
  }, []);

  const t = useCallback(
    (key: TKey, params?: Record<string, string | number>) =>
      translate(lang, key, params),
    [lang]
  );

  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used within I18nProvider");
  return ctx;
}
