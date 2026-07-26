/** Function that can be used to wait for a condition before returning. */
export async function waitFor<T>(condition: () => T, timeout = 5000, check = 100, predicate?: (obj: T) => boolean): Promise<T> {
    return await new Promise((resolve, reject) => {
        let interval: NodeJS.Timeout | null = null;

        const intervalCheck = () => {
            const result = condition();
            if (predicate ? predicate(result) : result) {
                resolve(result);
                if (interval) clearInterval(interval);
                return true;
            }
            return false;
        };

        // Run the check once first, this speeds it up a lot
        if (intervalCheck()) return;
        // Otherwise proceed to set up the timeout & interval

        // create the error outside of the setTimeout loop, to make sure it has the correct stack trace
        const error = new Error(`TIMEOUT waiting for ${condition?.toString()}`);
        setTimeout(() => {
            clearInterval(interval!);
            reject(error);
        }, timeout);

        interval = setInterval(intervalCheck, check);
    });
}

export function objectToURI<T>(url: string, data: T, includeQuestionMark: boolean): string {
    let counter = 0;
    for (const key in data) {
        const seperator = (url.includes("?") || counter > 0) ? "&" : (includeQuestionMark ? "?" : "");
        const value = (typeof(data[key]) === "string") ? data[key] as unknown as string : JSON.stringify(data[key]);
        url += seperator + encodeURIComponent(key) + "=" + encodeURIComponent(value);

        counter++;
    }

    return url;
}

export class PromiseTimeoutError<T> extends Error {
    promise?: Promise<T>;

    constructor(promise?: Promise<T>) {
        super("Promise timed out");

        this.promise = promise;
    }
}

export function timeoutPomise<T>(timeout?: number): Promise<T> {
    return new Promise((resolve, reject) => {
        if (timeout) {
            setTimeout(() => {
                reject(new PromiseTimeoutError());
            }, timeout);
        }
    });
}

const onFirefoxOrSafari = typeof(chrome) !== "undefined" && !!chrome.runtime.getManifest().browser_specific_settings;
const onFirefox = typeof(chrome) !== "undefined" && !!chrome.runtime.getManifest().browser_specific_settings?.gecko;
export function isFirefox(): boolean {
    return onFirefox;
}
export function isFirefoxOrSafari(): boolean {
    return onFirefoxOrSafari;
}

let cachedUserAgent: string;
export function extensionUserAgent(): string {
    cachedUserAgent ??= `${chrome.runtime.id}/v${chrome.runtime.getManifest().version}`;
    return cachedUserAgent;
}
