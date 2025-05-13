import { isFirefoxOrSafari, objectToURI } from ".";
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

export function setupBackgroundRequestProxy() {
    chrome.runtime.onMessage.addListener((request, sender, callback) => {
        if (request.message === "sendRequest") {
            sendRealRequestToCustomServer(request.type, request.url, request.data, request.headers).then(async (response) => {
                const buffer = request.binary 
                    ? (isFirefoxOrSafari()
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
            }).catch(() => {
                callback({
                    responseText: "",
                    responseBinary: null,
                    headers: null,
                    status: -1,
                    ok: false
                });
            });

            return true;
        }

        if (request.message === "getHash") {
            getHash(request.value, request.times).then(callback).catch((e) => {
                callback({
                    error: e?.message
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
            if (response.status !== -1) {
                resolve(response);
            } else {
                reject(response);
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
            if (response.status !== -1) {
                resolve(response);
            } else {
                reject(response);
            }
        });
    });
}