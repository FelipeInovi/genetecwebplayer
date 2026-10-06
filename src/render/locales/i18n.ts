import { createInstance } from "i18next";
import { initReactI18next } from "react-i18next";
import en from "@/render/locales/translations/en.json";
import es from "@/render/locales/translations/es.json";
import fr from "@/render/locales/translations/fr.json";

const i18n = createInstance();

i18n.use(initReactI18next).init({
  resources: {
    es: { translation: es },
    en: { translation: en },
    fr: { translation: fr }
  },
  initImmediate: false,
  lng: "es",
  fallbackLng: "es",
  interpolation: { escapeValue: false }
});

export default i18n;
