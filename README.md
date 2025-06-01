# Nuvio Streams Addon for Stremio

Welcome to Nuvio Streams! This addon for Stremio fetches direct streaming links for movies and TV shows from a variety of online providers.

Based on community feedback and continued development, this addon aims to offer a customizable and user-friendly streaming alternative.

## About Nuvio Streams

Nuvio Streams is a scraper-based addon. It currently searches across several diverse providers, including specialized options for anime (HiAnime) and multi-source capabilities. Users can customize which providers are active and set minimum quality preferences (e.g., 480p, 720p, 1080p) for compatible sources. The addon attempts to find streams when available, with some providers supporting 4K, HDR, and Dolby Vision content. Backend optimizations have also been implemented for better stability.

**This addon is for Stremio users who:**

1.  Prefer direct HTTP streaming links as an alternative to debrid services.
2.  Understand the nature of scrapers (public sources can be unreliable or change).
3.  Are willing to configure settings, like a personal cookie, for the best experience.

**Key Features:**

*   **Multiple Providers:** Access streams from ShowBox, Xprime.tv, HollyMovieHD, SoaperTV, Cuevana, Hianime (for anime), and VidSrc.
*   **Personal Cookie Configuration:** **Extremely Recommended** for ShowBox to get the best performance, avoid shared quotas, and unlock all stream qualities (including 4K HDR/DV).
*   **Provider & Quality Customization:** Tailor the addon to your needs by selecting active providers and setting minimum stream qualities.
*   **No Torrents/P2P:** Nuvio Streams only scrapes direct HTTP streams.
*   **TMDB & IMDb Support:** Works with both ID types.
*   **User-Friendly Configuration:** All settings are managed through the addon's main page.

## Installation & Configuration

The easiest way to install and configure Nuvio Streams is through its main page:

*   **Install & Configure Here:** [**https://nuvioaddon.vercel.app**](https://nuvioaddon.vercel.app)

You can also find it on the Stremio Community Addons list:

*   **Stremio Community Addons:** [https://beta.stremio-addons.net/addons/nuvio-streams](https://beta.stremio-addons.net/addons/nuvio-streams)

On the main addon page, you can:
*   Install the addon into Stremio.
*   Configure your personal cookie for ShowBox (FebBox).
*   Select your preferred server region for ShowBox.
*   Choose which content providers to enable/disable.
*   Set minimum stream quality for each provider.

## Personal Cookie Token Setup (Extremely Recommended)

For the ShowBox provider (which uses FebBox), personalizing your setup with your own cookie token is crucial for the best experience.

*   **Why personalize?** Without it, you share a limited 100GB/month bandwidth quota with all other non-personalized users, leading to slower speeds, failed streams, and a restriction to streams under 9GB (often excluding 4K HDR/DV). With your own cookie, you get your own 100GB quota and access to all qualities.
*   **How to set it up:** Visit the [Nuvio Streams Addon Page](https://nuvioaddon.vercel.app) and follow the "Personal Cookie Configuration" section, which includes a "How to Get" guide.

## Self-Hosting (For Advanced Users)

If you prefer to run your own instance of Nuvio Streams, follow these steps:

**1. Prerequisites:**

*   [Node.js](https://nodejs.org/) (LTS version recommended)
*   [npm](https://www.npmjs.com/) (usually comes with Node.js) or [yarn](https://yarnpkg.com/)

**2. Get the Code:**

(Once the repository is public)
```bash
git clone <repository-url>
cd nuvio-streams-addon 
```

**3. Install Dependencies:**

```bash
npm install
# or
yarn install
```

**4. Configure Your Instance (`.env` file):**

Create a `.env` file in the project root by copying the example:
```bash
cp .env.example .env
```
Now, edit your `.env` file. Here are the key settings:

*   `TMDB_API_KEY`: **Required.** Get this from [The Movie Database (TMDB)](https://www.themoviedb.org/settings/api).
*   `ENABLE_CUEVANA_PROVIDER`: Set to `true` to enable Cuevana. It will use your server's direct IP address. (Note: This is often disabled on public instances. If Cuevana is geo-restricted for your server's IP, this won't bypass it.)
*   `ENABLE_HOLLYMOVIEHD_PROVIDER`: Set to `true` or `false`.
*   `DISABLE_CACHE`: (Optional) `true` to disable caching.

*   **Proxies (Optional but Recommended for ShowBox/Xprime):**
    *   **Why?** Your server's IP (especially from cloud providers) might be blocked by ShowBox or Xprime. A proxy can improve reliability.
    *   **How?** You can deploy a [simple proxy using Netlify](https://app.netlify.com/start/deploy?repository=https://github.com/p-stream/simple-proxy).
    *   **In `.env`:**
        *   `SHOWBOX_PROXY_URL_VALUE`: If using the simple proxy, format as `https://your-proxy.netlify.app/?destination=`.
        *   `XPRIME_PROXY_URL`: Similar format if using the simple proxy for Xprime.
        *   `XPRIME_USE_PROXY`: Set to `true` if you configure `XPRIME_PROXY_URL`.
    *   You can leave proxy URLs blank to attempt direct connections.

*   **ShowBox Cookie Configuration (for self-hosting):**
    *   **Method 1: `cookies.txt` file (Recommended for simplicity on self-host):**
        *   Create a `cookies.txt` file in the project root.
        *   Add one ShowBox/FebBox cookie token per line.
        *   **Important:** Add `cookies.txt` to your `.gitignore` file.
    *   **Method 2: Addon Configuration UI:** Access your self-hosted addon in a browser (e.g., `http://localhost:7000`) and use the configuration page to set the cookie (similar to the public instance).

**5. Run the Addon:**

```bash
npm start 
# Or your designated start script, e.g., node server.js
```
Your self-hosted addon will typically run on `http://localhost:7000` (or as configured). The console will show the manifest URL to install it in Stremio.

## Support Development

If you find Nuvio Streams useful, please consider supporting its development. Your support helps maintain reliable streams, find new providers, and keep things running smoothly.

*   **[Buy Me a Coffee](https://buymeacoffee.com/tapframe)**

You can also follow on GitHub: [https://github.com/tapframe](https://github.com/tapframe)

## Disclaimer

*   Nuvio Streams is an addon that scrapes content from third-party websites. The availability, legality, and quality of the content are the responsibility of these external sites.
*   Ensure you are complying with the terms of service of any websites being accessed and any applicable local laws.
*   This addon is provided for educational and personal use. The developers are not responsible for any misuse. 