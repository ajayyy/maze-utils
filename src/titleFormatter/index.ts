import {
    toCapitalizeCase,
    toTitleCase,
    toSentenceCase,
    toLowerCaseTitle,
    toFirstLetterUppercase
} from "./formatters";
import { cleanEmojis, cleanUnformattedTitle } from "./helpers";

export enum TitleFormatting {
    Disable = -1,
    CapitalizeWords,
    TitleCase,
    SentenceCase,
    LowerCase,
    FirstLetterUppercase
}

/**
 * Useful regex expressions:
 *
 * Characters: \p{L}
 * Upper: \p{Lu}
 * Lower: \p{Ll}
 *
 * https://javascript.info/regexp-unicode#example-hexadecimal-numbers
 * https://util.unicode.org/UnicodeJsps/character.jsp
 */

export async function formatTitle(
    title: string,
    isCustom: boolean,
    titleFormatting: TitleFormatting,
    shouldCleanEmojis: boolean,
    onlyTitleCaseInEnglish: boolean
): Promise<string> {
    if (shouldCleanEmojis) {
        title = cleanEmojis(title);
    }

    switch (titleFormatting) {
        case TitleFormatting.CapitalizeWords:
            return await toCapitalizeCase(title, isCustom);
        case TitleFormatting.TitleCase:
            return await toTitleCase(title, isCustom, onlyTitleCaseInEnglish);
        case TitleFormatting.SentenceCase:
            return await toSentenceCase(title, isCustom);
        case TitleFormatting.LowerCase:
            return await toLowerCaseTitle(title);
        case TitleFormatting.FirstLetterUppercase:
            return await toFirstLetterUppercase(title);
        default: {
            return cleanUnformattedTitle(title);
        }
    }
}
