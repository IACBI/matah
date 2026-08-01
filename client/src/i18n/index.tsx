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

const STORAGE_KEY = "matah.lang";
const RTL_LANGS = new Set<Language>(["ar"]);

function detectLanguage(): Language {
  let saved: Language | null = null;
  try {
    saved = localStorage.getItem(STORAGE_KEY) as Language | null;
  } catch {
    // Storage can be unavailable in hardened/private browser contexts.
  }
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

  const setLang = useCallback((next: Language) => {
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Keep the in-memory choice when persistence is unavailable.
    }
    setLangState(next);
  }, []);

  const t = useCallback(
    (key: TKey, params?: Record<string, string | number>) =>
      translate(lang, key, params),
    [lang]
  );

  // Keep document metadata in sync for assistive technology and browser UI.
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = RTL_LANGS.has(lang) ? "rtl" : "ltr";
    document.title = `Matah · ${t("tagline")}`;
  }, [lang, t]);

  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used within I18nProvider");
  return ctx;
}
