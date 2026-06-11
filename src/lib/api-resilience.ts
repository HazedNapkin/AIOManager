export interface ResilientFetchOptions extends RequestInit {
    timeout?: number;
    retries?: number;
    retryDelay?: number;
    // Override for POST/PATCH that are safe to repeat (a read-shaped RPC, or one carrying an
    // idempotency key). By default only spec-idempotent methods are retried on ambiguous failures.
    idempotent?: boolean;
}

export async function resilientFetch(
    url: string,
    options: ResilientFetchOptions = {}
): Promise<Response> {
    const {
        timeout = 10000, // 10s default
        retries = 2,
        retryDelay = 1000,
        idempotent,
        ...fetchOptions
    } = options;

    // 5xx/timeout/network are ambiguous: the write may have executed server-side, so retrying a
    // non-idempotent POST (AddonCollectionSet, DatastorePut, signup) can double-write. Only retry
    // those for idempotent methods (or when the caller explicitly opts in). 429 is different (the
    // server rejected the request before processing), so it stays retryable for any method below.
    const method = (fetchOptions.method || 'GET').toUpperCase();
    const isIdempotent = idempotent ?? ['GET', 'HEAD', 'OPTIONS', 'PUT', 'DELETE'].includes(method);

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= retries; attempt++) {
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), timeout);

        let combinedSignal: AbortSignal;
        if (fetchOptions.signal) {
            try {
                combinedSignal = AbortSignal.any([fetchOptions.signal, controller.signal]);
            } catch {
                fetchOptions.signal.addEventListener('abort', () => controller.abort(), { once: true });
                combinedSignal = controller.signal;
            }
        } else {
            combinedSignal = controller.signal;
        }

        try {
            const response = await fetch(url, {
                ...fetchOptions,
                signal: combinedSignal,
            });

            clearTimeout(id);

            // Handle 429 Too Many Requests - consider it a temporary failure
            if (response.status === 429 && attempt < retries) {
                const retryAfter = response.headers.get('Retry-After');
                const delay = retryAfter ? parseInt(retryAfter) * 1000 : retryDelay * Math.pow(2, attempt);
                import.meta.env.DEV && console.warn(`[API] 429 Too Many Requests. Retrying in ${delay}ms...`);
                await new Promise(resolve => setTimeout(resolve, delay));
                continue;
            }

            // Handle 5xx Server Errors - consider them temporary (idempotent methods only)
            if (response.status >= 500 && attempt < retries && isIdempotent) {
                import.meta.env.DEV && console.warn(`[API] Server Error ${response.status}. Retrying in ${retryDelay * Math.pow(2, attempt)}ms...`);
                await new Promise(resolve => setTimeout(resolve, retryDelay * Math.pow(2, attempt)));
                continue;
            }

            return response;
        } catch (err: any) {
            clearTimeout(id);
            lastError = err instanceof Error ? err : new Error(String(err));

            if (attempt < retries && isIdempotent) {
                const isTimeout = err.name === 'AbortError';
                const isNetworkError = err.message === 'Failed to fetch';

                if (isTimeout || isNetworkError) {
                    import.meta.env.DEV && console.warn(`[API] ${isTimeout ? 'Timeout' : 'Network Error'} on attempt ${attempt + 1}. Retrying...`);
                    await new Promise(resolve => setTimeout(resolve, retryDelay * Math.pow(2, attempt)));
                    continue;
                }
            }
            throw lastError;
        }
    }

    throw lastError || new Error(`Failed to fetch ${url} after ${retries} retries`);
}
