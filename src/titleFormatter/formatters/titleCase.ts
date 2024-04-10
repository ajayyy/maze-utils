import { titleCaseNotCapitalized } from "../data";
import { capitalizeFirstLetter, cleanResultingTitle, endOfSentence, forceKeepFormatting, greekLetterAllowed, isAcronym, isAcronymStrict, isAllCaps, isFirstLetterCapital, isMostlyAllCaps, isNumberThenLetter, isWordCustomCapitalization, isYear, listHasWord, shouldTrustCaps, startOfSentence, toLowerCase } from "../helpers";
import { getLangInfo } from "../lang";

export async function toTitleCase(str: string, isCustom: boolean, onlyInEnglish: boolean): Promise<string> {
    const words = str.split(" ");
    const mostlyAllCaps = isMostlyAllCaps(words);
    const { isGreek, isTurkiq, isEnglish } = await getLangInfo(str, { useThoroughEnglishCheck: onlyInEnglish });

    let result = "";
    let index = 0;
    for (const word of words) {
        const trustCaps = shouldTrustCaps(mostlyAllCaps, words, index);

        if (forceKeepFormatting(word)
            || (isCustom && isWordCustomCapitalization(word))
            || (!isAllCaps(word) && (isWordCustomCapitalization(word) || isNumberThenLetter(word)))
            || isYear(word)
            || (!isGreek && await greekLetterAllowed(word))) {
            // For custom titles, allow any not just first capital
            // For non-custom, allow any that isn't all caps
            result += word + " ";
        } else if ((!onlyInEnglish || isEnglish)
                && !startOfSentence(index, words) && !endOfSentence(index, words)
                    && listHasWord(titleCaseNotCapitalized, word.toLowerCase())) {
            // Skip lowercase check for the first word
            result += await toLowerCase(word, isTurkiq) + " ";
        } else if (isFirstLetterCapital(word) &&
            ((trustCaps && isAcronym(word)) || isAcronymStrict(word))) {
            // Trust it with capitalization
            result += word + " ";
        } else {
            result += await capitalizeFirstLetter(word, isTurkiq) + " ";
        }

        index++;
    }

    return cleanResultingTitle(result);
}
