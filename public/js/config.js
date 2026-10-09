/* Schedly front-end config.
   mode:
     'auto' – use the live backend (/api/*) when it answers /api/health, otherwise fall back to mock data.
     'mock' – always use the in-browser sample data (works by just opening index.html).
     'live' – always call the backend.
   Never put API keys here: Hindsight and Groq keys live in the server's .env file. */
window.SCHEDLY_CONFIG = {
  mode: 'auto',
  apiBase: '',            // '' = same origin as the page. e.g. 'http://localhost:3000' if hosted elsewhere
  userName: 'there',      // used in the greeting
};
