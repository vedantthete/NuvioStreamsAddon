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
*   `SHOWBOX_PROXY_URL_VALUE`: (Optional but Recommended) URL for a proxy to be used with the Showbox provider. Using a proxy is recommended as direct scraping from server IPs can sometimes be blocked or rate-limited by content sources. If deploying the `simple-proxy` (see Proxy Setup section), ensure the URL ends with `/?destination=` (e.g., `https://your-proxy.netlify.app/?destination=`). Users can leave this blank to attempt direct scraping.
*   `TMDB_API_KEY`: **(Required)** Your API key from [The Movie Database (TMDB)](https://www.themoviedb.org/settings/api).
*   `XPRIME_PROXY_URL`: (Optional but Recommended if `XPRIME_USE_PROXY=true`) URL for a proxy for Xprime.tv. Similar to Showbox, using a proxy can improve scraping reliability if direct server IP access is restricted. Format may require `/?destination=` if using a generic proxy like `simple-proxy`.
*   `XPRIME_USE_PROXY`: (Optional) Set to `true` to use a proxy for Xprime.tv (recommended for reliability).
*   `ENABLE_CUEVANA_PROVIDER`: (Optional) Set to `true` to enable the Cuevana provider for your self-hosted instance. When enabled, it will attempt to fetch links using your server's direct IP address. This provider is disabled by default on public instances due to potential IP exposure or regional access complexities. If Cuevana content is geo-restricted for your server's IP, enabling it here might not bypass that; it simply allows the addon to *try* fetching from Cuevana using your server's IP.
*   `ENABLE_HOLLYMOVIEHD_PROVIDER`: (Optional) Set to `true` (default) or `false`.

### Proxy Setup (Recommended for ShowBox/Xprime to improve scraping reliability)

When self-hosting, your server's IP address (especially from common cloud providers) might be blocked or rate-limited by some content providers (like ShowBox or Xprime.tv). Using a proxy routes scraping requests through a different IP, which can significantly improve the chances of successfully fetching stream links. Users can still attempt to use the addon without a proxy for these providers, but results may vary.

*   **Deploy a Simple Proxy:** For this purpose, you can deploy a basic proxy service using Netlify:
    
    [![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/p-stream/simple-proxy)

*   **Proxy URL Formatting:** When using the `simple-proxy` for providers that expect the target URL to be passed as a query parameter (like ShowBox often does), you typically need to append `/?destination=` to your deployed proxy URL. For example, if your deployed proxy is `https://my-cool-proxy.netlify.app`, you would use `https://my-cool-proxy.netlify.app/?destination=` in the `SHOWBOX_PROXY_URL_VALUE` or `XPRIME_PROXY_URL` field in your `.env` file.
    *   The `XPRIME_PROXY_URL` in the original `.env` example (`https://frolicking-semolina-769185.netlify.app`) does not include `/?destination=`. This suggests that particular proxy might be specifically configured for Xprime, or Xprime integration handles URLs differently. Always test your setup.
    *   The `SHOWBOX_PROXY_URL_VALUE` in the original `.env` example (`https://starlit-valkyrie-39f5ab.netlify.app/?destination=`) *does* include `/?destination=`. Adapt your proxy URLs accordingly based on the proxy you deploy and the provider's needs.

**Note on Cuevana & Proxies:** The `ENABLE_CUEVANA_PROVIDER` setting allows your self-hosted instance to attempt fetching Cuevana links directly with your server's IP. The general proxy settings above (`SHOWBOX_PROXY_URL_VALUE`, `XPRIME_PROXY_URL`) are typically not used by the Cuevana integration in this addon. If Cuevana is geo-restricted for your server's IP, a simple general-purpose proxy like the one linked might not be sufficient or correctly routed for Cuevana within this addon; dedicated solutions or VPNs at the server level would be needed, which is outside the scope of this addon's proxy configuration.

### Cookie Configuration for Self-Hosting

For self-hosted instances, you have two ways to configure cookies for ShowBox (FebBox):

1. **Using the Addon Configuration Page**: After setting up your addon, you can use the configuration interface in Stremio to add your cookie, as described earlier in this document.

2. **Using a `cookies.txt` File**: Alternatively, you can create a `cookies.txt` file in the root directory of the project. This method is useful if you:
   - Don't want to manually configure cookies each time through the UI
   - Are maintaining multiple self-hosted instances
   - Prefer to store settings in files rather than through a UI

The `cookies.txt` file should contain one valid cookie token per line. The addon will automatically use these cookies when needed.

**Important:** Make sure to add `cookies.txt` to your `.gitignore` file to prevent accidentally sharing your personal cookies in public repositories.

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