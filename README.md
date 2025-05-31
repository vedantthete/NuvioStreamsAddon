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

## Reality Check: The Nature of Scraper Addons

It's important to be transparent about how Nuvio Streams works:

*   **External Reliance:** This is a scraper addon. Its functionality depends entirely on external, third-party providers. These providers can change their website structure, implement stricter anti-bot measures, or shut down at any time without notice.
*   **No Long-Term Guarantees:** While efforts will be made to maintain the addon, providers may stop working unexpectedly.
*   **Limited Resources:** As a solo-developed project, fixes and updates will be made when possible.
*   **Educational Project:** This addon is primarily a personal project that has grown with community interest.

## Frequently Asked Questions (FAQ)

*   **Q: How reliable is this addon long-term?**
    *   A: As a scraper addon, its reliability depends entirely on the external providers. They can change or disappear at any time. Updates will be attempted when possible, but there are no guarantees.
*   **Q: What's the difference between personalized (cookie) and non-personalized usage?**
    *   A: Non-personalized users share limited ShowBox/FebBox bandwidth and are restricted to streams under 9GB. Personalized users get their own 100GB monthly FebBox quota and access to all quality levels from ShowBox.
*   **Q: Does this addon use torrents or P2P technology?**
    *   A: No. This addon only scrapes direct HTTP streams from websites.
*   **Q: Why do some streams not work?**
    *   A: Providers can change their websites or go offline. When this happens, streams may stop working until the addon is updated.
*   **Q: How often is the addon updated?**
    *   A: As an indie developer, updates are made when time and resources allow.
*   **Q: Will more providers be added?**
    *   A: New, reliable providers are always being considered.

## Future Development

*   **Regional Providers (e.g., LATAM):** Research is ongoing for adding more region-specific providers, which often require proxy solutions. This is a roadmap item, and contributions or expertise in this area are welcome.
*   **Community Involvement:** With the codebase becoming public (see below), community contributions will be encouraged.

## Self-Hosting (For Advanced Users)

If you prefer to run your own instance of the Nuvio Streams addon:

### Prerequisites

*   [Node.js](https://nodejs.org/) (LTS version recommended)
*   [npm](https://www.npmjs.com/) (usually comes with Node.js) or [yarn](https://yarnpkg.com/)

### 1. Clone the Repository

(Once the repository is public)
```bash
git clone <repository-url>
cd nuvio-streams-addon 
```

### 2. Install Dependencies

```bash
npm install
# or
yarn install
```

### 3. Configure Environment Variables

Create a `.env` file in the root of the project by copying the example file:
```bash
cp .env.example .env
```
Edit the `.env` file with your values:

*   `DISABLE_CACHE`: (Optional) Set to `true` to disable caching. Defaults to `false`.
*   `SHOWBOX_PROXY_URL_VALUE`: (Optional) URL for a proxy to be used with the Showbox provider. If deploying the `simple-proxy` (see Proxy Setup section below), ensure the URL ends with `/?destination=` (e.g., `https://your-proxy.netlify.app/?destination=`).
*   `TMDB_API_KEY`: **(Required)** Your API key from [The Movie Database (TMDB)](https://www.themoviedb.org/settings/api).
*   `XPRIME_PROXY_URL`: (Optional) URL for a proxy to be used with Xprime.tv if `XPRIME_USE_PROXY=true`. Some providers might require the proxy URL to have a specific path or query string (e.g., `/?destination=`) if you use a generic proxy like `simple-proxy`.
*   `XPRIME_USE_PROXY`: (Optional) Set to `true` to use a proxy for Xprime.tv.
*   `ENABLE_CUEVANA_PROVIDER`: (Optional) Set to `true` to enable the Cuevana provider. Defaults to `false` as it often requires a proxy (see Proxy Setup section). This might be disabled on public instances but can be enabled for your self-hosted version if you configure a proxy.
*   `ENABLE_HOLLYMOVIEHD_PROVIDER`: (Optional) Set to `true` (default) or `false`.

### Proxy Setup (for Cuevana and potentially other providers)

Some providers, like Cuevana, may require a proxy to function correctly, especially if you are outside their intended region or if they have strict access controls.

*   **Deploy a Simple Proxy:** You can easily deploy a basic proxy service using Netlify by clicking the button below. This proxy is suitable for many use cases.
    
    [![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/p-stream/simple-proxy)

*   **Proxy URL Formatting:** When using the `simple-proxy` (or a similar one) for providers that expect the target URL to be passed as a query parameter, you typically need to append `/?destination=` to your deployed proxy URL. For example, if your deployed proxy is `https://my-cool-proxy.netlify.app`, you would use `https://my-cool-proxy.netlify.app/?destination=` in the `.env` file for the relevant provider's proxy URL field (e.g., `SHOWBOX_PROXY_URL_VALUE` or a dedicated proxy URL for Cuevana if the addon supports it).
    *   The `XPRIME_PROXY_URL` in the provided `.env` example (`https://frolicking-semolina-769185.netlify.app`) does not include `/?destination=`. This implies that particular proxy or the Xprime provider integration might handle the destination URL differently or the proxy itself is specifically configured for Xprime. Always check the provider's requirements or test.
    *   The `SHOWBOX_PROXY_URL_VALUE` in the provided `.env` example (`https://starlit-valkyrie-39f5ab.netlify.app/?destination=`) *does* include `/?destination=`. Adapt your proxy URLs accordingly.

### 4. Run the Addon

```bash
npm start 
# Or your designated start script, e.g., node server.js
```
The addon will typically run on `http://localhost:7000` (or as configured). The console will show the URL to install your local instance in Stremio.

## Support Development

If you find Nuvio Streams useful, please consider supporting its development. Your support helps maintain reliable streams, find new providers, and keep things running smoothly.

*   **[Buy Me a Coffee](https://buymeacoffee.com/tapframe)**

You can also follow on GitHub: [https://github.com/tapframe](https://github.com/tapframe)

## Disclaimer

*   Nuvio Streams is an addon that scrapes content from third-party websites. The availability, legality, and quality of the content are the responsibility of these external sites.
*   Ensure you are complying with the terms of service of any websites being accessed and any applicable local laws.
*   This addon is provided for educational and personal use. The developers are not responsible for any misuse. 