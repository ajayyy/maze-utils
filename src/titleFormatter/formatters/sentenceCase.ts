import { capitalizeFirstLetter, cleanResultingTitle, forceKeepFormatting, greekLetterAllowed, isAcronym, isAcronymStrict, isAllCaps, isInTitleCase, isMostlyAllCaps, isNumberThenLetter, isWordCapitalCase, isWordCustomCapitalization, shouldTrustCaps, startOfSentence, toLowerCase } from "../helpers";
import { getLangInfo } from "../lang";

export async function toSentenceCase(str: string, isCustom: boolean): Promise<string> {
    const words = str.split(" ");
    const inTitleCase = isInTitleCase(words);
    const mostlyAllCaps = isMostlyAllCaps(words);
    const { isGreek, isTurkiq } = await getLangInfo(str, {});

    let result = "";
    let index = 0;
    for (const word of words) {
        const trustCaps = shouldTrustCaps(mostlyAllCaps, words, index);

        if (word.match(/^[Ii]$|^[Ii]['’][\p{L}]{1,3}$/u)) {
            result += await capitalizeFirstLetter(word, isTurkiq) + " ";
        } else if (forceKeepFormatting(word)
            || isAcronymStrict(word)
            || ((!inTitleCase || !isWordCapitalCase(word)) && trustCaps && isAcronym(word))
            || (!inTitleCase && isWordCapitalCase(word))
            || (isCustom && isWordCustomCapitalization(word))
            || (!isAllCaps(word) && isWordCustomCapitalization(word))
            || (!isGreek && await greekLetterAllowed(word))) {
            // For custom titles, allow any not just first capital
            // For non-custom, allow any that isn't all caps
            // Trust it with capitalization
            result += word + " ";
        } else {
            if (startOfSentence(index, words) && !isNumberThenLetter(word)) {
                if (!isAllCaps(word) && isWordCustomCapitalization(word)) {
                    result += word + " ";
                } else {
                    result += await capitalizeFirstLetter(word, isTurkiq) + " ";
                }
            } else {
                result += await toLowerCase(word, isTurkiq) + " ";
            }
        }

        index++;
    }

    return cleanResultingTitle(result);
}
