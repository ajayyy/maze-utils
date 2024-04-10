import { acronymBlocklist, allowlistedWords, notStartOfSentence, titleCaseDetectionNotCapitalized } from "./data";
import { checkAnyLanguage } from "./lang";

// #region Checks

export function startOfSentence(index: number, words: string[]): boolean {
    return index === 0 || isDelimeter(words[index - 1]);
}

export function endOfSentence(index: number, words: string[]): boolean {
    return index === words.length - 1
        || isDelimeter(words[index]) // "word!" counts as delimeter
        || (!!words[index + 1] && isEntirelyDelimeter(words[index + 1]));
}

export function isYear(word: string): boolean {
    return !!word.match(/^[「〈《【〔⦗『〖〘<({["'‘]*[0-9]{2,4}'?s[〙〗』⦘〕】》〉」)}\]"']*$/);
}

/**
 * 3rd, 45th
 */
export function isNumberThenLetter(word: string): boolean {
    return !!word.match(/^[「〈《【〔⦗『〖〘<({["'‘]*[0-9]+\p{L}[〙〗』⦘〕】》〉」)}\]"']*/u);
}

export function isWordCapitalCase(word: string): boolean {
    return !!word.match(/^[^\p{L}]*[\p{Lu}][^\p{Lu}]+$/u);
}

/**
 * Not just capital at start
 */
export function isWordCustomCapitalization(word: string): boolean {
    const capitalMatch = word.match(/[\p{Lu}]/gu);
    if (!capitalMatch) return false;

    const capitalNumber = capitalMatch.length;
    return capitalNumber > 1 || (capitalNumber === 1 && !isFirstLetterCapital(word) && !isHyphenatedFirstLetterCapital(word));
}

/**
 * non-Newtonian
 * Non-Newtonian
 *
 * If the only capitals are after the dash
 */
function isHyphenatedFirstLetterCapital(word: string): boolean {
    return !!word.match(/^[\p{L}]{2,}-[\p{Lu}][\p{Ll}]+$/u);
}

export function isAcronym(word: string): boolean {
    // 2 - 3 chars, or has dots after each letter except last word
    // U.S.A allowed
    // US allowed
    return ((word.length <= 3 || countLetters(word) <= 3)
        && word.length > 1 && isAllCaps(word) && !listHasWord(acronymBlocklist, word.toLowerCase()))
        || isAcronymStrict(word);
}

export function isAcronymStrict(word: string): boolean {
    // U.S.A allowed
    return !!word.match(/^[^\p{L}]*(\S\.)+(\S)?$/u);
}

export function isFirstLetterCapital(word: string): boolean {
    return !!word.match(/^[^\p{L}]*[\p{Lu}]/u);
}

function isWordAllLower(word: string): boolean {
    return !!word.match(/^[\p{Ll}]+$/u);
}

function isEntirelyDelimeter(word: string): boolean {
    return word.match(/^[-:;~—–|]$/) !== null;
}

function isDelimeter(word: string): boolean {
    return (isEntirelyDelimeter(word)
        || word.match(/[:?.!\]]$/) !== null)
        && !listHasWord(allowlistedWords, word)
        && !listHasWord(notStartOfSentence, word)
        && (!isAcronymStrict(word) || !word.endsWith("."));
}

export function listHasWord(list: Set<string>, word: string): boolean {
    return list.has(word.replace(/[[「〈《【〔⦗『〖〘<({:〙〗』⦘〕】》〉」)}\]]/g, ""))
}

export function forceKeepFormatting(word: string, ignorePunctuation = true): boolean {
    let result = !!word.match(/^>/)
        || listHasWord(allowlistedWords, word);

    if (ignorePunctuation) {
        const withoutPunctuation = word.replace(/[:?.!+\]]+$|^[[+:/]+/, "");
        if (word !== withoutPunctuation) {
            result ||= listHasWord(allowlistedWords, withoutPunctuation);
        }
    }

    // Allow hashtags
    if (!isAllCaps(word) && word.startsWith("#")) {
        return true;
    }

    return result;
}


export function isInTitleCase(words: string[]): boolean {
    let count = 0;
    let ignored = 0;
    for (const word of words) {
        if (isWordCapitalCase(word)) {
            count++;
        } else if (!isWordAllLower(word) ||
                listHasWord(titleCaseDetectionNotCapitalized, word.toLowerCase())) {
            ignored++;
        }
    }

    const length = words.length - ignored;
    return (length > 4 && count >= Math.min(length - 1, length * 0.9)) || count >= length;
}


export function shouldTrustCaps(mostlyAllCaps: boolean, words: string[], index: number): boolean {
    return !mostlyAllCaps &&
        !((isAllCaps(words[index - 1]) && !forceKeepFormatting(words[index - 1]))
            || isAllCaps(words[index + 1]) && !forceKeepFormatting(words[index + 1]));
}

export function isMostlyAllCaps(words: string[]): boolean {
    let count = 0;
    for (const word of words) {
        // Has at least one char and is upper case
        if (isAllCaps(word)) {
            count++;
        }
    }

    return count > words.length * 0.5;
}

/**
 * Has at least one char and is upper case
 */
export function isAllCaps(word: string): boolean {
    return !!word && !!word.match(/[\p{L}]/u)
        && word.toUpperCase() === word
        && !isAcronymStrict(word)
        && !word.match(/^[\p{L}]{1,3}[-~—]/u); // USB-C not all caps, HANDS-ON is
}


/**
 * Allow mathematical greek symbols
 */
export function greekLetterAllowed(word: string): boolean {
    return !!word.match(/[Ͱ-Ͽ]/);
}

function startsWithEmojiLetter(word: string): boolean {
    return !!word.match(/^[^\p{L}]*[🅰🆎🅱🆑🅾][^\p{Lu}]+$/u);
}

// #endregion Checks

// #region Casing

export async function toLowerCase(word: string, isTurkiq: boolean): Promise<string> {
    if (isTurkiq || word.match(/ı|İ/u) || await checkAnyLanguage(word, ["tr", "az"], 10)) {
        return word.toLocaleLowerCase("tr-TR")
    } else {
        return word.toLowerCase();
    }
}

export async function toUpperCase(word: string, isTurkiq: boolean): Promise<string> {
    if (isTurkiq || word.match(/ı|İ/u) || await checkAnyLanguage(word, ["tr", "az"], 10)) {
        return word.toLocaleUpperCase("az-AZ")
    } else {
        return word.toUpperCase();
    }
}

export async function capitalizeFirstLetter(word: string, isTurkiq: boolean): Promise<string> {
    const result: string[] = [];

    if (startsWithEmojiLetter(word)) {
        // Emoji letter is already "capitalized"
        return await toLowerCase(word, isTurkiq);
    }

    for (const char of word) {
        if (char.match(/[\p{L}]/u)) {
            // converts to an array in order to slice by Unicode code points
            // (for Unicode characters outside the BMP)
            result.push(await toUpperCase(char, isTurkiq) + await toLowerCase([...word].slice(result.length + 1).join(""), isTurkiq));
            break;
        } else {
            result.push(char);
        }
    }

    return result.join("");
}

// #endregion Casing

// #region Clean

export function cleanEmojis(title: string): string {
    // \uFE0F is the emoji variation selector, it comes after non colored symbols to turn them into emojis
    // \uFE0E is similar but makes colored emojis into non colored ones
    // \u200D is the zero width joiner, it joins emojis together

    const cleaned = title
        // Clear extra spaces between emoji "words"
        .replace(/ ((?=\p{Extended_Pictographic}|☆)(?=[^🅰🆎🅱🆑🅾])\S(?:\uFE0F?\uFE0E?\p{Emoji_Modifier}?\u200D?)*)+(?= )/ug, "")
        // Emojis in between letters should be spaces, varient selector is allowed before to allow B emoji
        .replace(/(\p{L}|[\uFE0F\uFE0E🆎🆑])(?:(?=\p{Extended_Pictographic}|☆)(?=[^🅰🆎🅱🆑🅾])\S(?:\uFE0F?\uFE0E?\p{Emoji_Modifier}?\u200D?)*)+(?=\p{L}|[🅰🆎🅱🆑🅾])/ug, "$1 ")
        .replace(/(?=\p{Extended_Pictographic}|☆)(?=[^🅰🆎🅱🆑🅾])\S(?:\uFE0F?\uFE0E?\p{Emoji_Modifier}?\u200D?)*/ug, "")
        .trim();

    if (cleaned.length > 0) {
        return cleaned;
    } else {
        return title;
    }
}

export function cleanResultingTitle(title: string): string {
    return cleanUnformattedTitle(cleanPunctuation(title));
}

export function cleanUnformattedTitle(title: string): string {
    return title.replace(/(^|\s)>(\S)/g, "$1$2").trim();
}

function cleanWordPunctuation(title: string): string {
    const words = title.trim().split(" ");
    if (words.length > 0
            && (forceKeepFormatting(words[words.length - 1], false)
                || (isAcronymStrict(words[words.length - 1]) && words[words.length - 1].endsWith(".")))) {
        return title;
    }

    let toTrim = 0;
    let questionMarkCount = 0;
    for (let i = title.length - 1; i >= 0; i--) {
        toTrim = i;

        if (title[i] === "?") {
            questionMarkCount++;
        } else if (title[i] !== "!" && title[i] !== "." && title[i] !== " ") {
            break;
        }
    }

    let cleanTitle = toTrim === title.length ? title : title.substring(0, toTrim + 1);
    if (questionMarkCount > 0) {
        cleanTitle += "?";
    }

    return cleanTitle;
}

export function cleanPunctuation(title: string): string {
    title = cleanWordPunctuation(title);
    const words = title.split(" ");

    let result = "";
    let index = 0;
    for (let word of words) {
        if (!forceKeepFormatting(word, false)
            && index !== words.length - 1) { // Last already handled
            if (word.includes("?")) {
                word = cleanWordPunctuation(word);
            } else if (word.match(/[!]+$/)) {
                if (words.length > index + 1 && !isDelimeter(words[index + 1])) {
                    // Insert a period instead
                    word = cleanWordPunctuation(word) + ". ";
                } else {
                    word = cleanWordPunctuation(word);
                }
            }
        }

        word = word.trim();
        if (word.trim().length > 0) {
            result += word + " ";
        }

        index++;
    }

    return result.trim();
}

// #endregion Clean

// #region Count

function countLetters(word: string): number {
    return word.match(/[\p{L}]/gu)?.length ?? 0;
}

// #endregion Count
