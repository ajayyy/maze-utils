import type { LanguageIdentifier } from "cld3-asm";
import { chromeP } from "../browserApi";

declare const LOAD_CLD: boolean;
export let cld: Promise<LanguageIdentifier> | null = null;
if (LOAD_CLD) {
    const cldLib = import("cld3-asm");
    cld = cldLib.then(({ loadModule }) => loadModule()).then((m) => m.create(0, 700))
}


async function getLanguageFromBrowserApi(title: string) {
    const result = await chromeP.i18n.detectLanguage(title);
    return result.languages.map((l) => ({...l, isReliable: result.isReliable}));
}

export async function getLangInfo(str: string, options: { useThoroughEnglishCheck?: boolean }): Promise<{
    isGreek: boolean;
    isTurkiq: boolean;
    isEnglish: boolean;
}> {
    if (str.split(" ").length > 1) {
        // Remove hashtags
        str = str.replace(/#[^\s]+/g, "").trim();
    }

    const threshold = 30;
    const result = await checkLanguages(str, ["el", "tr", "az", "en"], threshold);

    return {
        isGreek: result.results[0],
        isTurkiq: result.results[1] || result.results[2],

        // Not english if it detects no english, it is reliable, and the top language is the same when one word is removed
        // Helps remove false positives
        isEnglish: !(!result.results[3]
            && result.isReliable
            && options.useThoroughEnglishCheck
            && result.topLanguage === ((await checkLanguages(str.replace(/[^ ]+$/, ""), [], threshold)).topLanguage))
    }
}

export async function checkAnyLanguage(title: string, languages: string[], percentage: number): Promise<boolean> {
    return (await checkLanguages(title, languages, percentage)).results.every((v) => v);
}

export async function checkLanguages(title: string, languages: string[], percentage: number): Promise<{
    results: boolean[];
    topLanguage?: string | null;
    isReliable: boolean;
}> {
    if (!cld && (typeof chrome === "undefined"
            || !("detectLanguage" in chrome.i18n))
            || typeof(window) === "undefined"
            || window.location.pathname.includes(".html")) {
        return {
            results: languages.map(() => false),
            isReliable: false
        };
    }

    try {
        const detectedLanguages = cld
            ? [(await (await cld).findLanguage(title))].map((l) => ({ language: l.language,
                    percentage: l.probability * 100, isReliable: l.is_reliable }))
            : await getLanguageFromBrowserApi(title);

        const result: boolean[] = [];
        for (const language of languages) {
            const matchingLanguage = detectedLanguages.find((l) => l.language === language);
            result.push(!!matchingLanguage && matchingLanguage.percentage > percentage);
        }

        return {
            results: result,
            topLanguage: detectedLanguages[0]?.language,
            isReliable: detectedLanguages.some((l) => l.isReliable)
        };
    } catch (e) {
        return {
            results: languages.map(() => false),
            isReliable: false
        };
    }
}
