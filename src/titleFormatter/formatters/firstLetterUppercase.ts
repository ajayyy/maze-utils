import { capitalizeFirstLetter, cleanResultingTitle, greekLetterAllowed, isNumberThenLetter, startOfSentence, toLowerCase } from "../helpers";
import { getLangInfo } from "../lang";

export async function toFirstLetterUppercase(str: string): Promise<string> {
    const words = str.split(" ");
    const { isGreek, isTurkiq } = await getLangInfo(str, {});

    let result = "";
    let index = 0;
    for (const word of words) {
        if (!isGreek && await greekLetterAllowed(word)) {
            result += word + " ";
        } else if (startOfSentence(index, words) && !isNumberThenLetter(word)) {
            result += await capitalizeFirstLetter(word, isTurkiq) + " ";
        } else {
            result += await toLowerCase(word, isTurkiq) + " ";
        }

        index++;
    }

    return cleanResultingTitle(result);
}
