import { cleanResultingTitle, greekLetterAllowed, toLowerCase } from "../helpers";
import { getLangInfo } from "../lang";

export async function toLowerCaseTitle(str: string): Promise<string> {
    const words = str.split(" ");
    const { isGreek, isTurkiq } = await getLangInfo(str, {});

    let result = "";
    for (const word of words) {
        if (!isGreek && await greekLetterAllowed(word)) {
            result += word + " ";
        } else {
            result += await toLowerCase(word, isTurkiq) + " ";
        }
    }

    return cleanResultingTitle(result);
}
