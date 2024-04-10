import { capitalizeFirstLetter, cleanResultingTitle, forceKeepFormatting, greekLetterAllowed, isAcronym, isAcronymStrict, isAllCaps, isFirstLetterCapital, isMostlyAllCaps, isWordCustomCapitalization, isYear } from "../helpers";
import { getLangInfo } from "../lang";

export async function toCapitalizeCase(str: string, isCustom: boolean): Promise<string> {
    const words = str.split(" ");
    const mostlyAllCaps = isMostlyAllCaps(words);
    const { isGreek, isTurkiq } = await getLangInfo(str, {});

    let result = "";
    for (const word of words) {
        if (forceKeepFormatting(word)
            || (isCustom && isWordCustomCapitalization(word))
            || (!isAllCaps(word) && isWordCustomCapitalization(word))
            || (isFirstLetterCapital(word) &&
                ((!mostlyAllCaps && isAcronym(word)) || isAcronymStrict(word)))
            || isYear(word)
            || (!isGreek && await greekLetterAllowed(word))) {
            // For custom titles, allow any not just first capital
            // For non-custom, allow any that isn't all caps
            // Trust it with capitalization
            result += word + " ";
        } else {
            result += await capitalizeFirstLetter(word, isTurkiq) + " ";
        }
    }

    return cleanResultingTitle(result);
}
