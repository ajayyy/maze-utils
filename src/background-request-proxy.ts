import { isFirefoxOrSafari, objectToURI } from ".";
import { isSafari } from "./config";
import { isBodyGarbage } from "./formating";
import { getHash } from "./hash";

export interface FetchResponse {
    responseText: string;
    headers: Record<string, string> | null;
    status: number;
    ok: boolean;
}

export interface FetchResponseBinary {
    responseBinary: Blob | number[];
    headers: Record<string, string> | null;
    status: number;
    ok: boolean;
}

/**
 * Sends a request to the specified url
 *
 * @param type The request type "GET", "POST", etc.
 * @param address The address to add to the SponsorBlock server address
 * @param callback
 */
export async function sendRealRequestToCustomServer(type: string, url: string,
        data: Record<string, unknown> | null = {}, headers: Record<string, unknown> = {}) {
    // If GET, convert JSON to parameters
    if (type.toLowerCase() === "get") {
        url = objectToURI(url, data, true);

        data = null;
    }

    const response = await fetch(url, {
        method: type,
        headers: {
            'Content-Type': 'application/json',
            ...(headers || {})
        },
        redirect: 'follow',
        body: data ? JSON.stringify(data) : null
    });

    return response;
}

/**
 * Checks whether the value is safe to send using .postMessage()
 *
 * @param value The value to check
 * @returns true if the value is serializable, false otherwise
 */
export function isSerializable(value: unknown): boolean {
    try {
        window.structuredClone(value);
        return true;
    } catch {
        return false;
    }
}

interface MaybeError {
    toString?: () => string,
}

/**
 * Ensures the value is serializable by converting to a string if it's not
 *
 * Useful for sending errors cause you never really know what "error" you may get with JS
 *
 * @param value The value to check
 * @returns Unmodified value if serializable, stringified version otherwise
 */
export function serializeOrStringify<T>(value: T & MaybeError): T | string {
    return isSerializable(value)
        ? value
        : (
            "toString" in value && typeof value.toString === 'function'
            ? value.toString()
            : String(value)
        );
}

export function setupBackgroundRequestProxy() {
    chrome.runtime.onMessage.addListener((request, sender, callback) => {
        if (request.message === "sendRequest") {
            sendRealRequestToCustomServer(request.type, request.url, request.data, request.headers).then(async (response) => {
                const buffer = request.binary 
                    ? ((isFirefoxOrSafari() && !isSafari())
                        ? await response.blob()
                        : Array.from(new Uint8Array(await response.arrayBuffer())))
                    : null;

                callback({
                    responseText: !request.binary ? await response.text() : "",
                    responseBinary: buffer,
                    headers: (request.returnHeaders && response.headers)
                            ? [...response.headers.entries()].reduce((acc, [key, value]) => {
                                acc[key] = value;
                                return acc;
                            }
                        , {})
                        : null,
                    status: response.status,
                    ok: response.ok
                });
            }).catch(error => {
                console.error("Proxied request failed:", error)
                callback({
                    error: serializeOrStringify(error),
                });
            });

            return true;
        }

        if (request.message === "getHash") {
            getHash(request.value, request.times).then(callback).catch((e) => {
                console.error("Hash request failed:", e)
                callback({
                    error: serializeOrStringify(e),
                });
            });

            return true;
        }

        return false;
    });
}

export function sendRequestToCustomServer(type: string, url: string, data = {}, headers = {}): Promise<FetchResponse> {
    return new Promise((resolve, reject) => {
        // Ask the background script to do the work
        chrome.runtime.sendMessage({
            message: "sendRequest",
            type,
            url,
            data,
            headers
        }, (response) => {
            if ("error" in response) {
                reject(response.error);
            } else {
                resolve(response);
            }
        });
    });
}

export function sendBinaryRequestToCustomServer(type: string, url: string, data = {}, headers = {}): Promise<FetchResponseBinary> {
    return new Promise((resolve, reject) => {
        // Ask the background script to do the work
        chrome.runtime.sendMessage({
            message: "sendRequest",
            type,
            url,
            data,
            headers,
            binary: true,
            returnHeaders: true
        }, (response) => {
            if ("error" in response) {
                reject(response.error);
            } else {
                resolve(response);
            }
        });
    });
}

/**
 * Formats and `console.warn`s the given request
 *
 * Use this to log failed requests.
 *
 * @param request The request to log
 * @param prefix Extension prefix, such as "SB" or "CB". Brackets will be added automatically
 * @param requestDescription A string describing what the failed request was, such as "segment skip log", which would produce "Server responded ... to a segment skip log request"
 */
export function logRequest(request: FetchResponse | FetchResponseBinary, prefix: string, requestDescription: string) {
    const body = ("responseText" in request && !isBodyGarbage(request.responseText)) ? `: ${request.responseText}` : ""
    console.warn(`[${prefix}] Server responded with code ${request.status} to a ${requestDescription} request${body}`);
}
