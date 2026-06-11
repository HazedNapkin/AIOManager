// Short, rewritten setup walkthroughs for the providers whose credentials aren't obvious.
// Keyed by catalog id; surfaced in the Add-key dialog when that provider is selected.

export interface ProviderSetup {
    intro?: string
    steps: string[]
    note?: string
}

export const PROVIDER_SETUP: Record<string, ProviderSetup> = {
    showbox: {
        intro: 'ShowBox streams come from Febbox, so paste the "ui" cookie from a logged-in session.',
        steps: [
            'Sign in at febbox.com.',
            'Open your browser DevTools → Application (or Storage) → Cookies.',
            'Copy the value of the cookie named "ui" and paste it here.',
        ],
    },
    trakt: {
        intro: 'Trakt needs a Client ID at minimum; add an access token for profile details.',
        steps: [
            'Create an app at trakt.tv/oauth/applications.',
            'Set the redirect URI to urn:ietf:wg:oauth:2.0:oob.',
            'Paste the Client ID, or enter ClientID:AccessToken after authorizing the app.',
        ],
    },
    tmdb: {
        intro: 'Either credential works; the v4 token also surfaces your username.',
        steps: [
            'Open themoviedb.org → Settings → API.',
            'Copy the v4 "API Read Access Token" (long) for full details, or the v3 "API Key" (32 chars) to just validate.',
            'Paste it here.',
        ],
        note: 'TMDB is free, so there is no subscription to track.',
    },
    alldebrid: {
        intro: 'AllDebrid may email you to authorize a new connection.',
        steps: [
            'Grab your API key at alldebrid.com/apikeys and paste it here.',
            'Watch your inbox for an AllDebrid authorization email.',
            'Click Confirm in that email to allow access.',
        ],
    },
    streamfusion: {
        intro: 'StreamFusion keys are issued by the StremioFR Telegram bot.',
        steps: [
            'Open Telegram and find the StremioFR bot (t.me/Stremiofr_bot).',
            'Send the command /generate.',
            'Copy the key it returns and paste it here.',
        ],
    },
}
